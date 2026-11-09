import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { mount, cleanupOwned } from "./docker-support.mjs";

export async function acceptance(
  run,
  { root, candidate, signal, report, startupMs = 30000 },
) {
  const prefix = `mytuner-accept-${randomBytes(8).toString("hex")}`;
  const containers = [],
    volumes = [],
    password = randomBytes(24).toString("hex");
  const guest = resolve(root, "scripts/container-fixture.mjs");
  let base, service, token, before, failure;
  report.resourcePrefix = prefix;
  const mounts = [];
  async function gate(name, task) {
    const start = Date.now();
    const gate = { name, status: "running" };
    report.gates.push(gate);
    try {
      await task();
      gate.status = "passed";
    } catch (e) {
      gate.status = "failed";
      throw e;
    } finally {
      gate.elapsedMs = Date.now() - start;
    }
  }
  function common(fixtureReadonly = true, dataReadonly = false) {
    return [
      "--platform",
      "linux/amd64",
      "--network",
      "none",
      "-e",
      "MYTUNER_ACCEPTANCE_DISPOSABLE=1",
      ...mounts.flatMap(([name, path]) => [
        "--mount",
        mount(
          "volume",
          name,
          path,
          (path === "/fixtures" && fixtureReadonly) ||
            (path === "/app/data" && dataReadonly),
        ),
      ]),
      "--mount",
      mount("bind", guest, "/acceptance.mjs", true),
    ];
  }
  async function oneoff(
    args,
    { rootUser = false, readonly = true, dataReadonly = false, env = [] } = {},
  ) {
    const name = `${prefix}-task-${containers.length}`;
    containers.push(name);
    return run(
      [
        "run",
        "--name",
        name,
        "--rm",
        ...common(readonly, dataReadonly),
        ...(rootUser ? ["--user", "0:0"] : []),
        ...env.flatMap((e) => ["-e", e]),
        "--entrypoint",
        "node",
        candidate.imageId,
        ...args,
      ],
      { signal },
    );
  }
  async function stop() {
    if (!service) return;
    await run(["stop", "--time", "20", service], { timeoutMs: 30000, signal });
    const state = JSON.parse(
      (
        await run(["inspect", "--format", "{{json .State}}", service], {
          signal,
        })
      ).stdout,
    );
    assert.equal(state.Running, false);
    assert.equal(state.OOMKilled, false);
    assert.equal(state.ExitCode, 0, "Bounded graceful shutdown");
  }
  async function start() {
    service = `${prefix}-server-${containers.length}`;
    containers.push(service);
    const args = common().filter(
      (a, i, list) => a !== "--network" && list[i - 1] !== "--network",
    );
    await run(
      [
        "run",
        "--detach",
        "--init",
        "--name",
        service,
        ...args,
        "-p",
        "127.0.0.1::8777",
        candidate.imageId,
      ],
      { signal },
    );
    const port = (await run(["port", service, "8777/tcp"], { signal })).stdout;
    assert.match(port, /^127\.0\.0\.1:\d+$/);
    base = `http://${port}`;
    const end = Date.now() + startupMs;
    while (true) {
      try {
        const health = await request(
          "/api/health",
          "GET",
          undefined,
          200,
          false,
        );
        assert.equal(health.version, candidate.version);
        assert.equal(health.service, "mytuner");
        assert.equal(health.apiVersion, 1);
        return;
      } catch (e) {
        if (signal?.aborted || Date.now() >= end) throw e;
      }
      await delay(200, undefined, { signal });
    }
  }
  async function response(
    path,
    method = "GET",
    body,
    auth = true,
    extraHeaders = {},
  ) {
    assert.ok(
      path.startsWith("/") && !path.startsWith("//"),
      "Same-origin request",
    );
    return fetch(base + path, {
      method,
      headers: {
        ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([
        AbortSignal.timeout(10000),
        ...(signal ? [signal] : []),
      ]),
    });
  }
  async function request(
    path,
    method = "GET",
    body,
    expected = 200,
    auth = true,
  ) {
    const r = await response(path, method, body, auth);
    assert.equal(r.status, expected, `${method} ${path}`);
    return expected === 204 ? undefined : r.json();
  }
  async function login() {
    token = (
      await request(
        "/api/auth/login",
        "POST",
        { username: "acceptance_admin", password },
        200,
        false,
      )
    ).token;
    assert.ok(token);
  }
  try {
    await gate("disposable-storage", async () => {
      for (const [kind, path] of [
        ["source", "/fixtures"],
        ["data", "/app/data"],
        ["generated", "/generated"],
        ["cache", "/cache"],
      ]) {
        const name = `${prefix}-${kind}`;
        volumes.push(name);
        await run(
          [
            "volume",
            "create",
            "--label",
            `tv.mytuner.acceptance=${prefix}`,
            name,
          ],
          { signal },
        );
        mounts.push([name, path]);
      }
      before = JSON.parse(
        (
          await oneoff(["/acceptance.mjs", "prepare"], {
            rootUser: true,
            readonly: false,
          })
        ).stdout,
      );
      assert.deepEqual(
        JSON.parse((await oneoff(["/acceptance.mjs", "audit"])).stdout),
        before,
      );
    });
    await gate("runtime-artifact", async () => {
      report.runtime = JSON.parse(
        (await oneoff(["/acceptance.mjs", "runtime"])).stdout,
      );
    });
    await gate("bootstrap-health-assets-auth", async () => {
      await oneoff(["dist/bootstrap.js", "acceptance_admin"], {
        env: [`MYTUNER_ADMIN_PASSWORD=${password}`],
      });
      await start();
      await request("/api/sources", "GET", undefined, 401, false);
      const html = await response("/", "GET", undefined, false);
      assert.equal(html.status, 200);
      const text = await html.text();
      assert.match(text, /<div id="root"/);
      const asset = text.match(/src="(\/assets\/[^\"]+\.js)"/);
      assert.ok(asset);
      const js = await response(asset[1], "GET", undefined, false);
      assert.equal(js.status, 200);
      assert.ok((await js.text()).length > 1000);
      await login();
      await request("/api/accounts");
    });
    let profile, source, item, channel, session;
    await gate("scan-range-hls-captions-generation", async () => {
      profile = await request(
        "/api/profiles",
        "POST",
        { name: "Acceptance room", kind: "room" },
        201,
      );
      source = await request(
        "/api/sources",
        "POST",
        {
          name: "Synthetic source",
          root: "/fixtures",
          kind: "shows",
          recursive: true,
        },
        201,
      );
      const scan = await request(`/api/sources/${source.id}/scan`, "POST");
      assert.equal(scan.complete, true);
      assert.equal(scan.updated, 1);
      await request(
        `/api/profiles/${profile.id}/grants`,
        "POST",
        { sourceId: source.id, subtree: "" },
        201,
      );
      const selected = await request(
        `/api/profiles/${profile.id}/selection`,
        "POST",
        { type: "folder", sourceId: source.id, directory: "", recursive: true },
      );
      item = selected.items[0];
      assert.equal(item.title, "Synthetic pilot");
      channel = await request(
        "/api/channels",
        "POST",
        {
          name: "Acceptance channel",
          visibility: "private",
          profileId: profile.id,
        },
        201,
      );
      await request(
        `/api/channels/${channel.id}`,
        "PATCH",
        {
          description: "Persistent synthetic channel",
          expectedDetailsRevision: 0,
        },
        204,
      );
      const target = { kind: "media", mediaId: item.id };
      const metadata = await request(
        `/api/profiles/${profile.id}/metadata/inspect`,
        "POST",
        { target },
      );
      await request(`/api/profiles/${profile.id}/metadata/save`, "POST", {
        target,
        revision: metadata.revision,
        choices: {
          title: { source: "manual", manual: "My pilot title" },
          description: {
            source: "manual",
            manual: "Persistent manual description",
          },
        },
      });
      await request(
        `/api/channels/${channel.id}/programming?horizonMs=3600000`,
        "PUT",
        {
          profileId: profile.id,
          seed: 42,
          groups: [
            {
              id: "pilot",
              mode: "ordered",
              episodesPerTurn: 2,
              selection: { type: "media", ids: [item.id] },
            },
          ],
          rules: {
            between: false,
            positions: [],
            maxClips: 0,
            maxDurationMs: 0,
            repeatAllowance: 1,
            maxPerBreak: 1,
            cooldownMs: 0,
          },
        },
      );
      await request(
        `/api/profiles/${profile.id}/subscriptions/${channel.id}`,
        "PUT",
        undefined,
        204,
      );
      session = await request(
        "/api/playback/sessions",
        "POST",
        { profileId: profile.id, channelId: channel.id },
        201,
      );
      const direct = await request(
        `/api/playback/sessions/${session.id}/negotiate`,
        "POST",
        { containers: ["mp4"], videoCodecs: ["h264"], audioCodecs: ["aac"] },
      );
      assert.equal(direct.mode, "direct");
      const range = await response(direct.url, "GET", undefined, true, {
        Range: "bytes=0-31",
      });
      assert.equal(range.status, 206);
      assert.equal((await range.arrayBuffer()).byteLength, 32);
      const track = direct.tracks.find((t) => t.type === "subtitle" && t.url);
      assert.ok(track);
      const caption = await response(track.url);
      assert.equal(caption.status, 200);
      assert.match(await caption.text(), /Synthetic acceptance caption/);
      const hls = await request(
        `/api/playback/sessions/${session.id}/negotiate`,
        "POST",
        { containers: [], videoCodecs: [], audioCodecs: [] },
      );
      assert.equal(hls.mode, "hls");
      const manifest = await response(hls.url);
      assert.equal(manifest.status, 200);
      const lines = (await manifest.text()).split("\n");
      assert.equal(lines[0], "#EXTM3U");
      const segmentPath = lines.find((l) => l && !l.startsWith("#"));
      assert.ok(segmentPath);
      const segmentUrl = new URL(segmentPath, base + hls.url);
      assert.equal(segmentUrl.origin, base);
      const segment = await response(segmentUrl.pathname + segmentUrl.search);
      assert.equal(segment.status, 200);
      assert.ok((await segment.arrayBuffer()).byteLength > 188);
      const scope = {
        sourceId: source.id,
        directory: "",
        recursive: false,
        kinds: ["thumbnail"],
        regenerate: false,
      };
      const preview = await request("/api/generation/preview", "POST", scope);
      assert.equal(preview.count, 1);
      const job = await request("/api/generation/jobs", "POST", scope, 202);
      const end = Date.now() + 60000;
      while (true) {
        const current = await request(`/api/generation/jobs/${job.id}`);
        if (current.status === "completed") break;
        assert.notEqual(
          current.status,
          "failed",
          "Synthetic generation failed",
        );
        assert.ok(Date.now() < end, "Generation timed out");
        await delay(200, undefined, { signal });
      }
      const asset = await response(
        `/api/profiles/${profile.id}/media/${item.id}/assets/thumbnail`,
      );
      assert.equal(asset.status, 200);
      assert.ok((await asset.arrayBuffer()).byteLength > 0);
    });
    await gate("exclusive-owner-backup-verification", async () => {
      containers.push(`${prefix}-owner`);
      const second = await run(
        [
          "run",
          "--name",
          `${prefix}-owner`,
          "--rm",
          ...common(),
          candidate.imageId,
        ],
        { allowFailure: true, signal, timeoutMs: 15000 },
      );
      assert.notEqual(second.code, 0);
      assert.match(second.stderr, /in use/);
      report.snapshot = (
        await run(["exec", service, "node", "dist/backup-cli.js"], { signal })
      ).stdout;
      assert.match(report.snapshot, /^\/app\/data\/backups\//);
      const verified = JSON.parse(
        (
          await oneoff(["dist/verify-cli.js", report.snapshot, "--json"], {
            dataReadonly: true,
          })
        ).stdout,
      );
      assert.equal(verified.status, "valid");
      report.backupSchema = verified.checkedSchemaVersion;
      const restoreWhileLive = await run(
        ["exec", service, "node", "dist/restore-cli.js", report.snapshot],
        { allowFailure: true, signal },
      );
      assert.notEqual(restoreWhileLive.code, 0);
    });
    async function assertDisplayPersistence() {
      const metadata = await request(
        `/api/profiles/${profile.id}/metadata/inspect`,
        "POST",
        { target: { kind: "media", mediaId: item.id } },
      );
      assert.equal(metadata.choices.title.source, "manual");
      assert.equal(metadata.choices.title.manual, "My pilot title");
      assert.equal(
        metadata.effective.description.value,
        "Persistent manual description",
      );
      const channels = await request("/api/admin/channels");
      assert.equal(
        channels.items.find((c) => c.id === channel.id)?.description,
        "Persistent synthetic channel",
      );
    }
    await gate("recreation-persistence", async () => {
      await request(`/api/playback/sessions/${session.id}/pause`, "POST");
      await stop();
      await start();
      await request("/api/auth/me");
      await assertDisplayPersistence();
      const rows = await request(`/api/profiles/${profile.id}/guide`);
      assert.ok(
        rows.channels.some(
          (c) => c.id === channel.id || c.channelId === channel.id,
        ),
      );
      const config = await request(`/api/channels/${channel.id}/programming`);
      assert.equal(config.config.groups[0].episodesPerTurn, 2);
      const paused = await request(`/api/playback/sessions/${session.id}`);
      assert.equal(paused.paused, true);
      const asset = await response(
        `/api/profiles/${profile.id}/media/${item.id}/assets/thumbnail`,
      );
      assert.equal(asset.status, 200);
      await asset.arrayBuffer();
    });
    await gate("offline-restore-session-revocation-restart", async () => {
      await stop();
      await oneoff(["dist/restore-cli.js", report.snapshot]);
      await start();
      await request("/api/auth/me", "GET", undefined, 401);
      await login();
      await assertDisplayPersistence();
      await request(`/api/profiles/${profile.id}/library`);
      await stop();
      assert.deepEqual(
        JSON.parse((await oneoff(["/acceptance.mjs", "audit"])).stdout),
        before,
      );
    });
    report.gates.push({
      name: "prior-image-upgrade-rollback",
      status: "skipped",
      reason:
        "Requires a previously accepted compatible image and full pre-upgrade bundle; follow the Unraid rehearsal.",
    });
    report.gates.push({
      name: "forced-interrupted-restore-active-worker-soak",
      status: "skipped",
      reason:
        "Deterministic recovery/shutdown covered by host regression tests; destructive interruption and pressure need a disposable target-host rehearsal.",
    });
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    // Cleanup does not share the cancelled signal. All names belong to this invocation.
    try {
      await cleanupOwned(run, containers, volumes);
      report.cleanup = { status: "passed" };
    } catch (error) {
      report.cleanup = { status: "failed", error: error.message };
      if (!failure) throw error;
    }
  }
}
