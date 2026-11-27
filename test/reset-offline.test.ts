import { pathToFileURL } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  realpath,
  readdir,
  symlink,
  link,
} from "node:fs/promises";
import syncFs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { Store, schemaVersion } from "../src/database.js";
import { createAccount, verifySecret } from "../src/security.js";
import { account, profile, source, media } from "./helpers.js";
import { planReset, applyResetTransaction } from "../src/reset-data.js";
import {
  previewOfflineReset,
  executeOfflineReset,
} from "../src/reset-offline.js";
import { openOfflineReset } from "../src/reset-backup.js";
import {
  inspectMetadata,
  inspectAuthorizedMetadata,
  saveMetadata,
} from "../src/display-metadata.js";
import { showKey } from "../src/catalog-identity.js";
import { seal, unseal } from "../src/refresh.js";
import { acquireDataLock } from "../src/runtime-lock.js";
import { restoreApplication } from "../src/recovery.js";
import type { ResetRequest } from "../src/reset-data.js";
const password = "synthetic-reset-password";
async function fixture(t: import("node:test").TestContext) {
  const root = await realpath(
      await mkdtemp(join(tmpdir(), "mytuner-reset-offline-")),
    ),
    dataRoot = join(root, "data"),
    mediaRoot = join(root, "source");
  await mkdir(dataRoot, { mode: 0o700 });
  await mkdir(mediaRoot, { mode: 0o700 });
  await writeFile(join(mediaRoot, "original.mp4"), "SYNTHETIC ORIGINAL VIDEO");
  await writeFile(
    join(dataRoot, "operator-notes.txt"),
    "UNOWNED OPERATOR FILE",
  );
  const store = new Store(join(dataRoot, "mytuner.db"));
  const admin = await createAccount(store, "z_current", password, "admin"),
    other = await createAccount(
      store,
      "a_other",
      "another-admin-password",
      "admin",
    );
  const p = profile(store, admin),
    src = source(store, mediaRoot, "shows"),
    item = media(store, src.id, "Show/Show.S01E01.mp4");
  const key = Buffer.alloc(32, 9);
  await writeFile(join(dataRoot, "integration.key"), key, { mode: 0o600 });
  store.db
    .prepare(
      "INSERT INTO integrations(id,source_id,provider,url,encrypted_key,mappings_json) VALUES('reset-integration',?,'sonarr','http://unused.invalid',?,'[]')",
    )
    .run(src.id, seal(key, "synthetic-provider-key"));
  store.db
    .prepare(
      "INSERT INTO sessions(token_hash,account_id,expires_at) VALUES('synthetic-session',?,9999999999999)",
    )
    .run(admin.id);
  store.close();
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const request: ResetRequest = {
    mode: "fresh",
    categories: [],
    retainedAdminId: admin.id,
  };
  return {
    root,
    dataRoot,
    mediaRoot,
    admin,
    other,
    p,
    src,
    item,
    key,
    request,
  };
}
function inspectFileDatabase(root: string, read: (db: DatabaseSync) => void) {
  const db = new DatabaseSync(
    pathToFileURL(join(root, "mytuner.db")).href + "?immutable=1",
    { readOnly: true },
  );
  try {
    read(db);
  } finally {
    db.close();
  }
}

test("offline fresh start creates a verified restorable backup, retains the explicitly named administrator, and preserves every unrelated/source file", async (t) => {
  const f = await fixture(t),
    plan = await previewOfflineReset(f.dataRoot, f.request, password);
  assert.equal(plan.retainedAdmin.id, f.admin.id);
  assert.equal(plan.retainedAdmin.username, "z_current");
  assert.equal(plan.revisionScope, "offline-full");
  const beforeKey = await readFile(join(f.dataRoot, "integration.key"));
  const result = await executeOfflineReset({
    dataRoot: f.dataRoot,
    request: f.request,
    password,
    revision: plan.revision,
    confirmation: plan.confirmationText,
  });
  assert.equal(result.reset, true);
  assert.equal(result.backup.verified, true);
  inspectFileDatabase(f.dataRoot, (db) => {
    assert.deepEqual(
      db
        .prepare("SELECT id,username,role,disabled FROM accounts")
        .all()
        .map((row) => ({ ...row })),
      [{ id: f.admin.id, username: "z_current", role: "admin", disabled: 0 }],
    );
    for (const table of [
      "profiles",
      "sources",
      "media",
      "integrations",
      "sessions",
    ])
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n,
        0,
      );
    assert.equal(
      db.prepare("PRAGMA user_version").get()!.user_version,
      schemaVersion,
    );
    assert.equal(
      db.prepare("SELECT cleanup_disabled FROM storage_safety_state").get()!
        .cleanup_disabled,
      1,
    );
    assert.equal(
      db.prepare("SELECT path FROM protected_source_roots").get()!.path,
      f.mediaRoot,
    );
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  });
  assert.equal(
    await readFile(join(f.mediaRoot, "original.mp4"), "utf8"),
    "SYNTHETIC ORIGINAL VIDEO",
  );
  assert.equal(
    await readFile(join(f.dataRoot, "operator-notes.txt"), "utf8"),
    "UNOWNED OPERATOR FILE",
  );
  assert.deepEqual(
    await readFile(join(f.dataRoot, "integration.key")),
    beforeKey,
  );
  const manifest = JSON.parse(
    await readFile(join(result.backup.directory, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.keyIncluded, true);
  assert.equal(manifest.format, 1);
  const restoredRoot = join(f.root, "restored");
  await restoreApplication(restoredRoot, result.backup.directory);
  const restored = new Store(join(restoredRoot, "mytuner.db"));
  try {
    assert.equal(
      restored.db.prepare("SELECT COUNT(*) AS n FROM accounts").get()!.n,
      2,
    );
    assert.equal(
      restored.db.prepare("SELECT COUNT(*) AS n FROM media").get()!.n,
      1,
    );
    assert.equal(
      await verifySecret(
        password,
        String(
          restored.db
            .prepare("SELECT password_hash FROM accounts WHERE id=?")
            .get(f.admin.id)!.password_hash,
        ),
      ),
      true,
    );
    assert.equal(
      unseal(
        await readFile(join(restoredRoot, "integration.key")),
        String(
          restored.db.prepare("SELECT encrypted_key FROM integrations").get()!
            .encrypted_key,
        ),
      ),
      "synthetic-provider-key",
    );
  } finally {
    restored.close();
  }
  await assert.rejects(
    executeOfflineReset({
      dataRoot: f.dataRoot,
      request: f.request,
      password,
      revision: plan.revision,
      confirmation: plan.confirmationText,
    }),
    /changed/,
  );
});

test("metadata-only reset retains applied manual media/show choices, identity/order and technical data, without resurrecting stale replacement choices", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const admin = account(store, "admin"),
    p = profile(store, admin),
    src = source(store, "/synthetic-reset-shows", "shows"),
    item = media(store, src.id, "Named/Show.S01E01.mp4");
  const raw = {
    seriesId: 7,
    seriesTitle: "Imported series",
    seasonNumber: 1,
    episodeNumber: 3,
    overview: "Cached provider description",
    integrationReference: { provider: "sonarr", externalId: "7" },
    technical: { format: "mp4", streams: [] },
  };
  store.db
    .prepare(
      "UPDATE media SET title='Indexed ordering title',metadata_json=? WHERE id=?",
    )
    .run(JSON.stringify(raw), item.id);
  store.db
    .prepare(
      "INSERT INTO integration_metadata(source_id,provider,external_id,media_id,metadata_json) VALUES(?,'sonarr','7',?,?)",
    )
    .run(
      src.id,
      item.id,
      JSON.stringify({
        ...raw,
        displayCandidate: {
          title: "Provider title",
          description: "Provider description",
        },
      }),
    );
  const target = { kind: "media" as const, mediaId: item.id },
    show = { kind: "show" as const, sourceId: src.id, key: "series:7" };
  const choice = (manual: string) => ({
    title: { source: "manual" as const, manual },
    description: { source: "local" as const },
  });
  await saveMetadata(
    store,
    admin,
    p,
    target,
    inspectMetadata(store, target).revision,
    choice("Custom episode"),
  );
  await saveMetadata(
    store,
    admin,
    p,
    show,
    inspectMetadata(store, show).revision,
    choice("Custom show"),
  );
  const replacement = media(store, src.id, "Replacement.mp4"),
    replacementTarget = { kind: "media" as const, mediaId: replacement.id };
  await saveMetadata(
    store,
    admin,
    p,
    replacementTarget,
    inspectMetadata(store, replacementTarget).revision,
    choice("Do not apply to replacement"),
  );
  store.db
    .prepare("UPDATE media SET size=size+1 WHERE id=?")
    .run(replacement.id);
  const request: ResetRequest = {
      mode: "selective",
      categories: ["metadata"],
      retainedAdminId: admin.id,
    },
    plan = planReset(store, admin, request, true);
  applyResetTransaction(store, admin, request, plan.revision);
  assert.equal(
    inspectAuthorizedMetadata(store, admin, p, target).effective.title.value,
    "Custom episode",
  );
  assert.equal(
    inspectAuthorizedMetadata(store, admin, p, show).effective.title.value,
    "Custom show",
  );
  const current = store.db
    .prepare("SELECT * FROM media WHERE id=?")
    .get(item.id)!;
  assert.equal(showKey(current as unknown as typeof item), "series:7");
  assert.equal(current.title, "Indexed ordering title");
  assert.deepEqual(
    JSON.parse(String(current.metadata_json)).technical,
    raw.technical,
  );
  assert.equal(JSON.parse(String(current.metadata_json)).overview, undefined);
  assert.equal(JSON.parse(String(current.metadata_json)).episodeNumber, 3);
  assert.equal(inspectMetadata(store, replacementTarget).requiresReview, true);
  assert.notEqual(
    inspectMetadata(store, replacementTarget).effective.title.value,
    "Do not apply to replacement",
  );
});

test("custom-only reset clears choices/manual drafts while preserving cached local/provider and technical information", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const admin = account(store, "admin"),
    p = profile(store, admin),
    src = source(store, "/synthetic-reset-custom"),
    item = media(store, src.id),
    target = { kind: "media" as const, mediaId: item.id };
  const raw = JSON.stringify({
    technical: { format: "mp4" },
    local: { title: "Local title" },
    localNfoValid: true,
  });
  store.db
    .prepare("UPDATE media SET metadata_json=? WHERE id=?")
    .run(raw, item.id);
  await saveMetadata(
    store,
    admin,
    p,
    target,
    inspectMetadata(store, target).revision,
    {
      title: { source: "manual", manual: "Custom" },
      description: { source: "manual", manual: "" },
    },
  );
  const local = JSON.stringify({
    values: { title: "Cached local" },
    status: "available",
  });
  store.db.prepare("UPDATE display_metadata SET local_json=?").run(local);
  const request: ResetRequest = {
      mode: "selective",
      categories: ["custom"],
      retainedAdminId: admin.id,
    },
    plan = planReset(store, admin, request, true);
  applyResetTransaction(store, admin, request, plan.revision);
  assert.equal(
    store.db.prepare("SELECT metadata_json FROM media").get()!.metadata_json,
    raw,
  );
  assert.equal(
    store.db.prepare("SELECT local_json FROM display_metadata").get()!
      .local_json,
    local,
  );
  assert.deepEqual(inspectMetadata(store, target).choices, {
    title: { source: "automatic" },
    description: { source: "automatic" },
  });
});

test("wrong password, typed confirmation or retained inactive account cannot mutate data or create a completed backup", async (t) => {
  const f = await fixture(t),
    plan = await previewOfflineReset(f.dataRoot, f.request, password);
  const options = {
    dataRoot: f.dataRoot,
    request: f.request,
    password,
    revision: plan.revision,
    confirmation: plan.confirmationText,
  };
  await assert.rejects(
    executeOfflineReset({ ...options, password: "wrong-password" }),
    /password|identity/,
  );
  await assert.rejects(
    executeOfflineReset({ ...options, confirmation: "RESET somebody else" }),
    /confirmation/,
  );
  const db = new Store(join(f.dataRoot, "mytuner.db"));
  db.db.prepare("UPDATE accounts SET disabled=1 WHERE id=?").run(f.admin.id);
  db.close();
  await assert.rejects(
    previewOfflineReset(f.dataRoot, f.request, password),
    /password|identity/,
  );
  assert.deepEqual(
    await readdir(f.dataRoot),
    [...(await readdir(f.dataRoot))].filter((name) => name !== "backups"),
  );
  inspectFileDatabase(f.dataRoot, (db) =>
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM accounts").get()!.n, 2),
  );
});

test("stale database changes after backup await abort reset and retain the verified snapshot", async (t) => {
  const f = await fixture(t),
    plan = await previewOfflineReset(f.dataRoot, f.request, password);
  let backup = "";
  await assert.rejects(
    executeOfflineReset(
      {
        dataRoot: f.dataRoot,
        request: f.request,
        password,
        revision: plan.revision,
        confirmation: plan.confirmationText,
      },
      {
        backupCreated: async (value) => {
          backup = value.directory;
          const writer = new DatabaseSync(join(f.dataRoot, "mytuner.db"));
          try {
            writer
              .prepare(
                "UPDATE accounts SET username='changed-after-backup' WHERE id=?",
              )
              .run(f.other.id);
          } finally {
            writer.close();
          }
        },
      },
    ),
    /changed/,
  );
  assert.ok(backup);
  assert.equal(
    JSON.parse(await readFile(join(backup, "manifest.json"), "utf8")).format,
    1,
  );
  inspectFileDatabase(f.dataRoot, (db) => {
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sources").get()!.n, 1);
    assert.equal(
      db.prepare("SELECT cleanup_disabled FROM storage_safety_state").get()!
        .cleanup_disabled,
      0,
    );
  });
});

test("backup allocation failure leaves the application unchanged and never deletes the partial bundle", async (t) => {
  const f = await fixture(t),
    plan = await previewOfflineReset(f.dataRoot, f.request, password),
    original = syncFs.openSync;
  syncFs.openSync = ((path, ...args) => {
    if (
      String(path).includes("reset-snapshot-") &&
      String(path).endsWith("mytuner.db")
    )
      throw Object.assign(new Error("synthetic ENOSPC"), { code: "ENOSPC" });
    return original(
      path,
      ...(args as Parameters<typeof syncFs.openSync> extends [
        unknown,
        ...infer T,
      ]
        ? T
        : never),
    );
  }) as typeof syncFs.openSync;
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      executeOfflineReset({
        dataRoot: f.dataRoot,
        request: f.request,
        password,
        revision: plan.revision,
        confirmation: plan.confirmationText,
      }),
      /ENOSPC/,
    );
  } finally {
    syncFs.openSync = original;
    syncBuiltinESMExports();
  }
  const partials = await readdir(join(f.dataRoot, "backups"));
  assert.equal(partials.length, 1);
  assert.deepEqual(
    await readdir(join(f.dataRoot, "backups", partials[0]!)),
    [],
  );
  inspectFileDatabase(f.dataRoot, (db) =>
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM media").get()!.n, 1),
  );
});

for (const basename of [
  "mytuner.db-wal",
  "mytuner.db-shm",
  "mytuner.db-journal",
  "runtime-lock.db-wal",
  "runtime-lock.db-shm",
  "runtime-lock.db-journal",
])
  test(`preexisting unknown ${basename} bytes are refused before SQLite can alter them`, async (t) => {
    const f = await fixture(t),
      path = join(f.dataRoot, basename),
      bytes = Buffer.from("VIDEO / OPERATOR SENTINEL");
    await writeFile(path, bytes);
    await assert.rejects(openOfflineReset(f.dataRoot), /WAL\/SHM\/journal/);
    assert.deepEqual(await readFile(path), bytes);
  });

for (const target of ["mytuner.db", "integration.key", "runtime-lock.db"])
  for (const kind of ["symlink", "hardlink"] as const)
    test(`offline reset refuses ${kind} ${target} without changing the other file`, async (t) => {
      const f = await fixture(t),
        path = join(f.dataRoot, target),
        outside = join(f.root, `unowned-${target}`);
      let bytes: Buffer;
      try {
        bytes = await readFile(path);
        await rm(path);
      } catch {
        bytes = Buffer.from("VIDEO / UNOWNED FILE");
      }
      await writeFile(outside, bytes);
      if (kind === "symlink") await symlink(outside, path);
      else await link(outside, path);
      await assert.rejects(openOfflineReset(f.dataRoot), /linked|shared/);
      assert.deepEqual(await readFile(outside), bytes);
    });

test("live owner lock, pending restore, linked backup root and source-overlapping data roots fail closed", async (t) => {
  const f = await fixture(t),
    release = await acquireDataLock(f.dataRoot);
  try {
    await assert.rejects(
      openOfflineReset(f.dataRoot),
      /in use|locked|clean server shutdown/,
    );
  } finally {
    await release();
  }
  await writeFile(join(f.dataRoot, "restore.pending.json"), "unowned marker");
  await assert.rejects(openOfflineReset(f.dataRoot), /restore/);
  await rm(join(f.dataRoot, "restore.pending.json"));
  const outside = join(f.root, "operator-backups");
  await mkdir(outside);
  await writeFile(join(outside, "keep.txt"), "KEEP");
  await symlink(outside, join(f.dataRoot, "backups"));
  await assert.rejects(openOfflineReset(f.dataRoot), /linked/);
  assert.equal(await readFile(join(outside, "keep.txt"), "utf8"), "KEEP");
  await rm(join(f.dataRoot, "backups"));
  const store = new Store(join(f.dataRoot, "mytuner.db"));
  store.db.prepare("UPDATE sources SET root_path=?").run(f.root);
  store.close();
  await assert.rejects(openOfflineReset(f.dataRoot), /overlaps/);
});

test("offline CLI reads private stdin confirmations and has no command-line password or backup bypass", async (t) => {
  const f = await fixture(t);
  const run = (args: string[], input: string) =>
    new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (done, reject) => {
        const child = spawn(
          process.execPath,
          ["--import", "tsx", "src/reset-cli.ts", ...args],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              MYTUNER_DATA_DIR: f.dataRoot,
              npm_config_offline: "true",
              npm_config_yes: "false",
            },
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
        let stdout = "",
          stderr = "";
        child.stdout.on("data", (value) => (stdout += value));
        child.stderr.on("data", (value) => (stderr += value));
        child.on("error", reject);
        child.on("close", (code) => done({ code, stdout, stderr }));
        child.stdin.end(input);
      },
    );
  const flags = ["--admin-id", f.admin.id, "--mode", "fresh"],
    preview = await run(flags, password + "\n");
  assert.equal(preview.code, 0, preview.stderr);
  assert.equal(preview.stdout.includes(password), false);
  assert.equal(preview.stderr.includes(password), false);
  const plan = JSON.parse(preview.stdout);
  const applied = await run(
    [...flags, "--apply", "--revision", plan.revision],
    password + "\n" + plan.confirmationText + "\n",
  );
  assert.equal(applied.code, 0, applied.stderr);
  assert.match(applied.stdout, /"reset": true/);
  assert.equal(applied.stderr.includes(password), false);
  for (const arg of ["--password", "--skip-backup", "--force", "--db"]) {
    const denied = await run([...flags, arg, "forbidden"], "");
    assert.equal(denied.code, 1);
  }
});

for (const base of ["mytuner.db", "runtime-lock.db"])
  for (const suffix of ["-wal", "-shm", "-journal"])
    test(`late foreign ${base}${suffix} survives reset rejection and every SQLite connection close`, async (t) => {
      const f = await fixture(t);
      // Cover a legacy empty owner-lock database carrying a WAL-mode header too.
      const legacyLock = new DatabaseSync(join(f.dataRoot, "runtime-lock.db"));
      legacyLock.exec("PRAGMA journal_mode=WAL; VACUUM");
      legacyLock.close();
      const context = await openOfflineReset(f.dataRoot);
      const path = join(f.dataRoot, base + suffix),
        bytes = Buffer.from("LATE FOREIGN VIDEO CONTENT");
      await writeFile(path, bytes, { flag: "wx" });
      await assert.rejects(context.assertCurrent(), /sidecar|control/);
      await context.close();
      assert.deepEqual(await readFile(path), bytes);
    });
