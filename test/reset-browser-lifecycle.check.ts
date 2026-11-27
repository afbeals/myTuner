import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
  readdir,
  utimes,
  realpath,
} from "node:fs/promises";
import { writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer as createNetServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, expect } from "@playwright/test";
import { Store } from "../src/database.js";
import { createAccount } from "../src/security.js";
import { addSource, scanSource } from "../src/catalog.js";
import { profile, channel } from "./helpers.js";
import { ProgrammingService } from "../src/programming.js";
import { noBreaks } from "../src/scheduler.js";
import { GenerationRunner, assetRelativePath } from "../src/generation.js";
import { ManagedCache } from "../src/managed-cache.js";
import { captureStorageSafety } from "../src/storage-safety.js";
import type { Media } from "../src/domain.js";

// Independently authored operator journey. No author reset-test fixtures are used.
const cwd = resolve("."),
  password = "synthetic-lifecycle-password";
async function run(
  root: string,
  script: string,
  args: string[] = [],
  input = "",
) {
  const child = spawn(process.execPath, ["--import", "tsx", script, ...args], {
    cwd,
    env: {
      ...process.env,
      MYTUNER_DATA_DIR: join(root, "data"),
      npm_config_offline: "true",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(input);
  const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
  const [code, signal] = await once(child, "exit");
  clearTimeout(timer);
  return { code, signal, stdout, stderr };
}
const json = (text: string) =>
  text
    .trim()
    .split(/\n(?=\{)/)
    .map((part) => JSON.parse(part));
async function freePort() {
  const socket = createNetServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();
  assert(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((done) => socket.close(() => done()));
  return port;
}
async function start(root: string) {
  const port = await freePort(),
    base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd,
    env: {
      ...process.env,
      MYTUNER_DATA_DIR: join(root, "data"),
      MYTUNER_GENERATED_DIR: join(root, "generated"),
      MYTUNER_CACHE_DIR: join(root, "cache"),
      HOST: "127.0.0.1",
      PORT: String(port),
      npm_config_offline: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw Error(`Server exited: ${logs}`);
    try {
      if ((await fetch(base + "/api/health")).ok)
        return { child, base, logs: () => logs };
    } catch {}
    await delay(50);
  }
  child.kill("SIGKILL");
  throw Error(`Server did not start: ${logs}`);
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
  const [code, signal] = await closed;
  clearTimeout(timer);
  assert.equal(
    signal,
    null,
    "Clean SIGTERM must drain and exit without SIGKILL",
  );
  assert.equal(code, 0);
}
async function request(
  base: string,
  path: string,
  token?: string,
  body?: unknown,
) {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
async function signIn(base: string, username: string) {
  const response = await request(base, "/api/auth/login", undefined, {
    username,
    password,
  });
  assert.equal(response.status, 200, JSON.stringify(response));
  return response.body.token as string;
}
async function fingerprint(paths: string[]) {
  return Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => {
        const value = await stat(path);
        return [
          path,
          {
            size: value.size,
            sha256: createHash("sha256")
              .update(await readFile(path))
              .digest("hex"),
          },
        ];
      }),
    ),
  );
}
async function files(root: string): Promise<string[]> {
  return (
    await Promise.all(
      (await readdir(root, { withFileTypes: true })).map(async (entry) =>
        entry.isDirectory()
          ? files(join(root, entry.name))
          : [join(root, entry.name)],
      ),
    )
  ).flat();
}

test(
  "independent reset lifecycle: browser review, live scan/playback refusal, offline CLI, restart, pressure, restore",
  { timeout: 120000 },
  async (t) => {
    const root = await mkdtemp(
      join(await realpath(tmpdir()), "mytuner-reset-r1-lifecycle-"),
    );
    let server: Awaited<ReturnType<typeof start>> | undefined;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    t.after(async () => {
      if (browser) await browser.close();
      if (server) await stop(server.child);
      await rm(root, { recursive: true, force: true });
    });
    const evidence: Record<string, unknown> = {};
    for (const folder of [
      "data",
      "source",
      "metadata",
      "subtitles",
      "generated",
      "cache",
      "cache/subtitles",
      "neighbor",
    ])
      await mkdir(join(root, folder), { recursive: true, mode: 0o700 });
    const sentinels: [string, string][] = [
      ["source/episode.mp4", "synthetic-original-video\0unchanged"],
      ["source/episode.nfo", "<movie><title>Original sentinel</title></movie>"],
      [
        "source/episode.en.srt",
        "1\n00:00:00,000 --> 00:00:01,000\nOriginal subtitle\n",
      ],
      ["metadata/operator.nfo", "operator metadata sentinel"],
      ["subtitles/operator.srt", "operator subtitle sentinel"],
      ["neighbor/unrelated-video.mkv", "neighbor video never owned by myTuner"],
      ["data/operator-video.mp4", "unknown appdata video must survive"],
      ["data/operator-note.txt", "unknown appdata note must survive"],
      ["generated/operator-video.mp4", "unknown generated video must survive"],
      ["generated/operator-note.txt", "unknown output note must survive"],
      ["cache/operator-video.mp4", "unknown cache video must survive"],
      [
        `cache/subtitles/${"a".repeat(64)}.vtt`,
        "WEBVTT\n\n00:00.000 --> 00:01.000\nold cached sentinel\n",
      ],
    ];
    for (const [path, value] of sentinels)
      await writeFile(join(root, path), value);
    await utimes(join(root, "cache/subtitles", "a".repeat(64) + ".vtt"), 0, 0);
    let store = new Store(join(root, "data/mytuner.db"));
    // Create an earlier, alphabetically first administrator to expose wrong identity inference.
    const secondary = await createAccount(
      store,
      "aaa-secondary",
      password,
      "admin",
    );
    const retained = await createAccount(
      store,
      "zeta-retained",
      password,
      "admin",
    );
    const viewer = await createAccount(
      store,
      "ordinary-viewer",
      password,
      "viewer",
    );
    const p = profile(store, retained),
      vp = profile(store, viewer);
    const source = await addSource(
      store,
      {
        name: "Lifecycle synthetic source",
        root: join(root, "source"),
        kind: "videos",
        recursive: true,
      },
      [join(root, "data"), join(root, "generated"), join(root, "cache")],
    );
    store.db
      .prepare("UPDATE sources SET metadata_root=?,subtitle_root=? WHERE id=?")
      .run(join(root, "metadata"), join(root, "subtitles"), source.id);
    await scanSource(store, source, async () => 3600000);
    const media = store.db
      .prepare("SELECT * FROM media")
      .get() as unknown as Media;
    const generatedPath = assetRelativePath(media, "conversion");
    await mkdir(join(root, "generated", generatedPath, ".."), {
      recursive: true,
    });
    await writeFile(
      join(root, "generated", generatedPath),
      "synthetic-old-generated-video",
    );
    sentinels.push([
      `generated/${generatedPath}`,
      "synthetic-old-generated-video",
    ]);
    const ch = channel(store, retained, "shared");
    for (const pid of [p, vp]) {
      store.db
        .prepare("INSERT INTO source_grants VALUES(?,?,'')")
        .run(pid, source.id);
      store.db
        .prepare("INSERT INTO subscriptions(profile_id,channel_id) VALUES(?,?)")
        .run(pid, ch.id);
    }
    new ProgrammingService(store).publish(retained, ch.id, {
      profileId: p,
      groups: [
        {
          id: "original",
          mode: "ordered",
          selection: { type: "media", ids: [media.id] },
        },
      ],
      rules: noBreaks,
      seed: 17,
    });
    const credential = store.db
      .prepare("SELECT password_hash FROM accounts WHERE id=?")
      .get(retained.id)!.password_hash;
    store.close();
    const initial = await fingerprint(
      sentinels.map(([path]) => join(root, path)),
    );
    evidence.before = initial;
    const backup = await run(root, "src/backup-cli.ts");
    assert.equal(backup.code, 0, backup.stderr);
    const oldBackup = backup.stdout.trim();
    const oldBackupHashes = await fingerprint(await files(oldBackup));
    server = await start(root);
    const token = await signIn(server.base, retained.username);
    const viewerToken = await signIn(server.base, viewer.username);
    const options = await request(
      server.base,
      "/api/admin/reset/options",
      token,
    );
    assert.equal(options.body.retainedAdmin.id, retained.id);
    assert.equal(
      (await request(server.base, "/api/admin/reset/options", viewerToken))
        .status,
      403,
    );
    assert.equal(
      (
        await request(server.base, "/api/admin/reset/preview", viewerToken, {
          mode: "fresh",
          categories: [],
          retainedAdminId: retained.id,
        })
      ).status,
      403,
    );
    for (const endpoint of [
      "/api/admin/reset",
      "/api/admin/reset/execute",
      "/api/admin/reset/apply",
    ])
      assert.equal(
        (await request(server.base, endpoint, token, {})).status,
        404,
      );

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    await page.goto(server.base);
    await page.getByLabel("Username", { exact: true }).fill(retained.username);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Who’s watching?", exact: true })
      .locator(".profile-card")
      .first()
      .click();
    await page.goto(server.base + "/#operations");
    await page
      .getByText("Reset application data · offline execution", { exact: true })
      .click();
    await page
      .getByRole("button", { name: "Review reset options", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(retained.id, { exact: true })).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Review exact changes", exact: true }),
    ).toBeDisabled();
    await dialog
      .getByRole("checkbox", { name: "Sources and integrations", exact: true })
      .check();
    for (const name of [
      "Catalog and discovery",
      "Imported and local metadata",
      "Custom information",
      "Collections",
      "Channels and programming",
      "Playback and activity",
    ]) {
      await expect(
        dialog.getByRole("checkbox", { name, exact: true }),
      ).toBeChecked();
      await expect(
        dialog.getByRole("checkbox", { name, exact: true }),
      ).toBeDisabled();
    }
    await expect(
      dialog.getByRole("checkbox", {
        name: "Accounts and profiles",
        exact: true,
      }),
    ).not.toBeChecked();
    await dialog
      .getByRole("button", { name: "Review exact changes", exact: true })
      .click();
    await expect(
      dialog.getByRole("heading", {
        name: "Review selective reset",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      dialog.getByText("Continue with the server stopped", { exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Change choices", exact: true })
      .click();
    await dialog
      .getByLabel("Reset mode", { exact: true })
      .selectOption("fresh");
    for (const checkbox of await dialog.getByRole("checkbox").all()) {
      await expect(checkbox).toBeChecked();
      await expect(checkbox).toBeDisabled();
    }
    await dialog
      .getByRole("button", { name: "Review exact changes", exact: true })
      .click();
    await expect(
      dialog.getByRole("heading", { name: "Review fresh start", exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await page
      .getByRole("button", { name: "Review reset options", exact: true })
      .click();
    await dialog
      .getByRole("checkbox", { name: "Custom information", exact: true })
      .check();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(
      (await request(server.base, "/api/accounts", token)).body.length,
      3,
      "Review/cancel never changes accounts",
    );
    await page.close();
    const viewerPage = await browser.newPage();
    await viewerPage.goto(server.base);
    await viewerPage
      .getByLabel("Username", { exact: true })
      .fill(viewer.username);
    await viewerPage.getByLabel("Password", { exact: true }).fill(password);
    await viewerPage
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await viewerPage.goto(server.base + "/#operations");
    await expect(
      viewerPage.getByRole("button", {
        name: "Review reset options",
        exact: true,
      }),
    ).toHaveCount(0);
    await viewerPage.close();
    await browser.close();
    browser = undefined;
    evidence.browser =
      "Current administrator UUID retained; source dependencies checked+disabled; fresh selects all; Done/cancel read-only; viewer has no reset UI/API; execute endpoints 404";

    const playback = await request(
      server.base,
      "/api/playback/sessions",
      token,
      { profileId: p, channelId: ch.id },
    );
    assert.equal(playback.status, 201, JSON.stringify(playback));
    const scan = request(server.base, `/api/sources/${source.id}/scan`, token, {
      metadata: false,
    });
    let background: Awaited<ReturnType<typeof request>> | undefined;
    for (let i = 0; i < 30; i++) {
      background = await request(server.base, "/api/admin/background", token);
      if (background.body.paused && background.body.waiting > 0) break;
      await delay(50);
    }
    assert.equal(background!.body.paused, true);
    assert(background!.body.waiting > 0, JSON.stringify(background));
    evidence.live = {
      playback: playback.body.id,
      background: background!.body,
    };
    const args = ["--admin-id", retained.id, "--mode", "fresh"];
    const liveAttempt = await run(
      root,
      "src/reset-cli.ts",
      args,
      password + "\n",
    );
    assert.equal(liveAttempt.code, 1);
    assert.match(
      liveAttempt.stderr,
      /stop myTuner|WAL\/SHM\/journal|database is locked/i,
    );
    evidence.liveCliRefusal = liveAttempt.stderr.replaceAll(root, "$FIXTURE");
    await stop(server.child);
    server = undefined;
    await scan.catch(() => undefined);
    for (const sidecar of [
      "mytuner.db-wal",
      "mytuner.db-shm",
      "runtime-lock.db-journal",
    ])
      assert(!(await readdir(join(root, "data"))).includes(sidecar), sidecar);
    assert.deepEqual(await fingerprint(Object.keys(initial)), initial);
    const denied = await run(
      root,
      "src/reset-cli.ts",
      args,
      "wrong-synthetic-password\n",
    );
    assert.equal(denied.code, 1);
    assert.match(denied.stderr, /identity or password was not confirmed/);
    const preview = await run(root, "src/reset-cli.ts", args, password + "\n");
    assert.equal(preview.code, 0, preview.stderr);
    let plan = json(preview.stdout)[0];
    assert.equal(plan.retainedAdmin.id, retained.id);
    store = new Store(join(root, "data/mytuner.db"));
    try {
      store.db
        .prepare("UPDATE media SET title=? WHERE id=?")
        .run("changed after offline review", media.id);
    } finally {
      store.close();
    }
    const stale = await run(
      root,
      "src/reset-cli.ts",
      [...args, "--apply", "--revision", plan.revision],
      password + "\n" + plan.confirmationText + "\n",
    );
    assert.equal(stale.code, 1);
    assert.match(stale.stderr, /Database changed since the offline preview/);
    const updated = await run(root, "src/reset-cli.ts", args, password + "\n");
    assert.equal(updated.code, 0, updated.stderr);
    const currentPlan = json(updated.stdout)[0];
    assert.notEqual(currentPlan.revision, plan.revision);
    plan = currentPlan;
    evidence.offlineGuards =
      "Wrong password, stale prior revision after a real metadata update, and incorrect typed confirmation all rejected; only a fresh full revision succeeds";
    const wrongConfirmation = await run(
      root,
      "src/reset-cli.ts",
      [...args, "--apply", "--revision", plan.revision],
      password + "\nWRONG\n",
    );
    assert.equal(wrongConfirmation.code, 1);
    assert.match(
      wrongConfirmation.stderr,
      /Typed reset confirmation did not match/,
    );
    const applied = await run(
      root,
      "src/reset-cli.ts",
      [...args, "--apply", "--revision", plan.revision],
      password + "\n" + plan.confirmationText + "\n",
    );
    assert.equal(applied.code, 0, applied.stderr);
    const result = json(applied.stdout)[1];
    assert.equal(result.reset, true);
    evidence.offlineApply = {
      retainedAdmin: plan.retainedAdmin,
      revision: plan.revision,
      records: plan.totalRecords,
      backup: result.backup.directory.replaceAll(root, "$FIXTURE"),
    };
    assert.deepEqual(await fingerprint(Object.keys(initial)), initial);
    assert.deepEqual(
      await fingerprint(Object.keys(oldBackupHashes)),
      oldBackupHashes,
    );
    const resetBackupHashes = await fingerprint(
      await files(result.backup.directory),
    );

    server = await start(root);
    assert.equal(
      (await request(server.base, "/api/auth/me", token)).status,
      401,
    );
    const freshToken = await signIn(server.base, retained.username);
    for (const username of [secondary.username, viewer.username])
      assert.equal(
        (
          await request(server.base, "/api/auth/login", undefined, {
            username,
            password,
          })
        ).status,
        401,
      );
    assert.equal(
      (await request(server.base, "/api/sources", freshToken)).body.length,
      0,
    );
    assert.equal(
      (
        await request(server.base, "/api/admin/assets/cleanup", freshToken, {
          dryRun: true,
        })
      ).status,
      200,
    );
    for (const reconcile of [false, true]) {
      const cleanup = await request(
        server.base,
        "/api/admin/assets/cleanup",
        freshToken,
        { dryRun: false, reconcile },
      );
      assert.equal(cleanup.status, 409, JSON.stringify(cleanup));
      assert.match(
        cleanup.body.error,
        /permanently disabled after a data reset/,
      );
    }
    await stop(server.child);
    server = undefined;
    store = new Store(join(root, "data/mytuner.db"));
    try {
      assert.equal(
        store.db.prepare("SELECT COUNT(*) AS n FROM accounts").get()!.n,
        1,
      );
      assert.equal(
        store.db
          .prepare("SELECT password_hash FROM accounts WHERE id=?")
          .get(retained.id)!.password_hash,
        credential,
      );
      const safety = captureStorageSafety(store);
      assert.equal(safety.cleanupDisabled, true);
      for (const name of ["source", "metadata", "subtitles"])
        assert(safety.protectedRoots.includes(join(root, name)));
      const cache = new ManagedCache(
        join(root, "cache/subtitles"),
        4096,
        0,
        1,
        store,
      );
      assert.equal(await cache.get("a".repeat(64) + ".vtt", () => {}), null);
      await assert.rejects(
        cache.publish(
          "a".repeat(64) + ".vtt",
          Buffer.from("replacement"),
          () => {},
        ),
        /preserved after a data reset/,
      );
      await cache.publish(
        "b".repeat(64) + ".vtt",
        Buffer.from("WEBVTT\nnew synthetic subtitle"),
        () => {},
      );
      await assert.rejects(
        new ManagedCache(join(root, "cache/subtitles"), 1, 0, 1, store).ensure(
          2,
          () => {},
        ),
        /Insufficient managed cache space/,
      );
      const freshSource = await addSource(
        store,
        {
          name: "Re-added synthetic source",
          root: join(root, "source"),
          kind: "videos",
          recursive: true,
        },
        [join(root, "data"), join(root, "generated"), join(root, "cache")],
      );
      await scanSource(store, freshSource, async () => 3600000);
      let calls = 0;
      const execute = async (
        _args: string[],
        _signal: AbortSignal,
        output?: { fd: number; format: string },
      ) => {
        calls++;
        assert(output);
        writeSync(
          output.fd,
          Buffer.from("synthetic newly generated thumbnail"),
        );
      };
      const runner = new GenerationRunner(
        store,
        join(root, "generated"),
        execute,
        { maxBytes: 4 * 1024 ** 2, reserveBytes: 0, maxPendingJobs: 5 },
      );
      const job = await runner.enqueue({
        sourceId: freshSource.id,
        directory: "",
        recursive: true,
        kinds: ["thumbnail"],
        regenerate: false,
      });
      await runner.drain();
      assert.equal(
        runner.get(job.id).status,
        "completed",
        JSON.stringify(runner.tasks(job.id)),
      );
      assert.equal(calls, 1);
      await runner.stop();
      const quota = new GenerationRunner(
        store,
        join(root, "generated"),
        execute,
        { maxBytes: 1, reserveBytes: 0, maxPendingJobs: 5 },
      );
      const deniedJob = await quota.enqueue({
        sourceId: freshSource.id,
        directory: "",
        recursive: true,
        kinds: ["gif"],
        regenerate: false,
      });
      await quota.drain();
      assert.equal(quota.get(deniedJob.id).status, "failed");
      assert.equal(
        calls,
        1,
        "Quota rejects new generation before encoder executes",
      );
      assert.match(
        String(
          store.db
            .prepare("SELECT error FROM generation_items WHERE job_id=?")
            .get(deniedJob.id)!.error,
        ),
        /quota/,
      );
      await quota.stop();
      evidence.afterResetStorage = {
        safety,
        newCacheWrite: true,
        existingCacheReplacementRefused: true,
        newGeneration: "completed using synthetic descriptor writer",
        quota: "failed before writer execution",
      };
    } finally {
      store.close();
    }
    assert.deepEqual(await fingerprint(Object.keys(initial)), initial);
    const restored = await run(root, "src/restore-cli.ts", [oldBackup]);
    assert.equal(restored.code, 0, restored.stderr);
    server = await start(root);
    const restoredToken = await signIn(server.base, retained.username);
    assert.equal(
      (await request(server.base, "/api/sources", restoredToken)).body.length,
      1,
    );
    const postRestoreCleanup = await request(
      server.base,
      "/api/admin/assets/cleanup",
      restoredToken,
      { dryRun: false, reconcile: true },
    );
    assert.equal(
      postRestoreCleanup.status,
      409,
      JSON.stringify(postRestoreCleanup),
    );
    await stop(server.child);
    server = undefined;
    store = new Store(join(root, "data/mytuner.db"));
    try {
      assert.equal(captureStorageSafety(store).cleanupDisabled, true);
    } finally {
      store.close();
    }
    const after = await fingerprint(Object.keys(initial));
    assert.deepEqual(after, initial);
    assert.deepEqual(
      await fingerprint(Object.keys(oldBackupHashes)),
      oldBackupHashes,
    );
    assert.deepEqual(
      await fingerprint(Object.keys(resetBackupHashes)),
      resetBackupHashes,
    );
    evidence.after = after;
    evidence.restored =
      "Real restore CLI of pre-reset backup, normal main restart, retained admin signs in, cleanup still refuses, original and both backup bundle hashes identical";
    console.log("LIFECYCLE_EVIDENCE " + JSON.stringify(evidence));
  },
);
