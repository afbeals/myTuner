import test from "node:test";
import assert from "node:assert/strict";
import { Maintenance } from "../src/maintenance.js";

test("a blocked refresh never blocks schedule/lifecycle work and duplicate lane runs coalesce", async () => {
  let release!: () => void,
    started!: () => void,
    refreshes = 0,
    schedules = 0,
    cleanups = 0;
  const held = new Promise<void>((resolve) => {
      release = resolve;
    }),
    entered = new Promise<void>((resolve) => {
      started = resolve;
    });
  const maintenance = new Maintenance(
    {
      refresh: async () => {
        refreshes++;
        started();
        await held;
      },
      schedules: () => {
        schedules++;
      },
      housekeeping: () => {
        cleanups++;
      },
    },
    () => assert.fail("Unexpected failure"),
  );
  const pending = maintenance.run("refresh");
  await entered;
  assert.equal(maintenance.run("refresh"), pending);
  await maintenance.run("schedules");
  await maintenance.run("housekeeping");
  await maintenance.run("schedules");
  assert.equal(refreshes, 1);
  assert.equal(schedules, 2);
  assert.equal(cleanups, 1);
  const stop = maintenance.stop();
  await maintenance.run("schedules");
  assert.equal(schedules, 2);
  release();
  await stop;
});
test("maintenance reports a failed lane, recovers and skips work queued before shutdown", async () => {
  let calls = 0,
    failures = 0;
  const maintenance = new Maintenance(
    {
      refresh: () => {
        if (++calls === 1) throw Error("synthetic");
      },
      housekeeping: () => {},
      schedules: () => {},
    },
    (lane) => {
      assert.equal(lane, "refresh");
      failures++;
    },
  );
  await maintenance.run("refresh");
  await maintenance.run("refresh");
  assert.equal(calls, 2);
  assert.equal(failures, 1);
  const skipped = maintenance.run("refresh");
  await maintenance.stop();
  await skipped;
  assert.equal(calls, 2);
});

test("background playback protection requires available current media and recent delivery after startup", async (t) => {
  const { Store } = await import("../src/database.js"),
    { createServer } = await import("../src/server.js"),
    { account, profile, channel, source, media } = await import("./helpers.js"),
    { digest } = await import("../src/security.js"),
    { randomUUID } = await import("node:crypto"),
    { mkdtemp, rm } = await import("node:fs/promises"),
    { tmpdir } = await import("node:os"),
    { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "mytuner-maintenance-")),
    store = new Store(":memory:"),
    now = Date.now();
  const owner = account(store, "admin"),
    p = profile(store, owner),
    c = channel(store, owner),
    src = source(store, join(root, "originals")),
    m = media(store, src.id),
    revision = randomUUID(),
    session = randomUUID(),
    token = randomUUID(),
    entry = randomUUID();
  store.db
    .prepare(
      "INSERT INTO schedule_revisions(id,channel_id,created_at) VALUES(?,?,?)",
    )
    .run(revision, c.id, now);
  store.db
    .prepare(
      "INSERT INTO playback_sessions(id,account_id,profile_id,channel_id,revision_id,position_ms,anchor_ms,last_seen,auth_session_hash) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(session, owner.id, p, c.id, revision, now, now, now, digest(token));
  store.db
    .prepare(
      "INSERT INTO sessions(token_hash,account_id,expires_at) VALUES(?,?,?)",
    )
    .run(digest(token), owner.id, now + 60000);
  const app = createServer(store, {
    autoMaintenance: true,
    writableRoots: [join(root, "data")],
    generatedRoot: join(root, "generated"),
    cacheRoot: join(root, "cache"),
  });
  t.after(async () => {
    await app.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const headers = { authorization: `Bearer ${token}` },
    url = "/api/admin/background";
  assert.equal((await app.inject({ url })).statusCode, 401);
  // A session without actual current programming must not starve its recovery scan.
  assert.equal((await app.inject({ url, headers })).json().paused, false);
  store.db
    .prepare(
      "INSERT INTO schedule_entries(id,revision_id,channel_id,media_id,program_id,start_ms,end_ms,offset_ms,kind,source_size,source_mtime_ms) VALUES(?,?,?,?,?,?,?,0,'program',?,?)",
    )
    .run(
      entry,
      revision,
      c.id,
      m.id,
      randomUUID(),
      now - 60000,
      now + 60000,
      m.size,
      m.mtime_ms,
    );
  assert.equal((await app.inject({ url, headers })).json().paused, true);
  store.db.prepare("UPDATE media SET available=0 WHERE id=?").run(m.id);
  assert.equal((await app.inject({ url, headers })).json().paused, false);
  store.db.prepare("UPDATE media SET available=1 WHERE id=?").run(m.id);
  store.db
    .prepare(
      "UPDATE playback_sessions SET position_ms=?,anchor_ms=? WHERE id=?",
    )
    .run(now - 20000, now - 20000, session);
  // Polling alone after startup is not delivery.
  assert.equal((await app.inject({ url, headers })).json().paused, false);
  await app.inject({ url: `/api/playback/sessions/${session}`, headers });
  assert.equal((await app.inject({ url, headers })).json().paused, false);
  const recorded = await app.inject({
    method: "POST",
    url: `/api/playback/sessions/${session}/events`,
    headers,
    payload: {
      id: randomUUID(),
      entryId: entry,
      startMs: now - 1000,
      endMs: now,
    },
  });
  assert.equal(recorded.statusCode, 204, recorded.body);
  assert.equal((await app.inject({ url, headers })).json().paused, true);
  store.db
    .prepare("UPDATE playback_sessions SET paused=1 WHERE id=?")
    .run(session);
  assert.equal((await app.inject({ url, headers })).json().paused, false);
  store.db
    .prepare("UPDATE playback_sessions SET paused=0,last_seen=? WHERE id=?")
    .run(now - 91000, session);
  assert.equal((await app.inject({ url, headers })).json().paused, false);
  store.db
    .prepare("UPDATE accounts SET role='viewer' WHERE id=?")
    .run(owner.id);
  assert.equal((await app.inject({ url, headers })).statusCode, 403);
});

test("server shutdown keeps generation queued when it is waiting for the paused background lane", async (t) => {
  const { Store } = await import("../src/database.js"),
    { createServer } = await import("../src/server.js"),
    { BackgroundWork } = await import("../src/background-work.js"),
    { source, media } = await import("./helpers.js"),
    { randomUUID } = await import("node:crypto"),
    { mkdtemp, mkdir, rm } = await import("node:fs/promises"),
    { tmpdir } = await import("node:os"),
    { join } = await import("node:path"),
    { setImmediate } = await import("node:timers/promises");
  const root = await mkdtemp(join(tmpdir(), "mytuner-maintenance-stop-")),
    store = new Store(":memory:");
  await mkdir(join(root, "originals"));
  const src = source(store, join(root, "originals")),
    m = media(store, src.id),
    job = randomUUID(),
    item = randomUUID(),
    gate = new BackgroundWork();
  gate.setPaused(true);
  store.db
    .prepare(
      "INSERT INTO generation_jobs(id,source_id,directory,recursive,status,regenerate,created_at) VALUES(?,?,'',1,'queued',0,0)",
    )
    .run(job, src.id);
  store.db
    .prepare(
      "INSERT INTO generation_items(id,job_id,media_id,kind,status) VALUES(?,?,?,'thumbnail','queued')",
    )
    .run(item, job, m.id);
  const app = createServer(store, {
    backgroundWork: gate,
    writableRoots: [join(root, "data")],
    generatedRoot: join(root, "generated"),
    cacheRoot: join(root, "cache"),
  });
  t.after(async () => {
    await app.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  await app.ready();
  await setImmediate();
  assert.equal(gate.snapshot().waiting, 1);
  await app.close();
  assert.equal(
    store.db.prepare("SELECT status FROM generation_jobs WHERE id=?").get(job)!
      .status,
    "queued",
  );
  assert.equal(
    store.db
      .prepare("SELECT status FROM generation_items WHERE id=?")
      .get(item)!.status,
    "queued",
  );
});
