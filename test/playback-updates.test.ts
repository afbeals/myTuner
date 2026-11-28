import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/database.js";
import { PlaybackService } from "../src/playback.js";
import { ProgrammingService } from "../src/programming.js";
import { StreamingService } from "../src/streaming.js";
import { noBreaks } from "../src/scheduler.js";
import { account, profile, source, media, channel } from "./helpers.js";
import type { Programming } from "../src/contracts.js";
function setup(
  t: { after: (fn: () => unknown) => void },
  filename = ":memory:",
) {
  let store = new Store(filename);
  t.after(() => store.close());
  const owner = account(store),
    p = profile(store, owner),
    src = source(store),
    one = media(store, src.id, "One.mp4", 10000),
    two = media(store, src.id, "Two.mp4", 10000),
    three = media(store, src.id, "Three.mp4", 10000),
    ch = channel(store, owner),
    ads = source(store, "/ads", "commercials"),
    ad = media(store, ads.id, "Ad.mp4", 1000);
  store.db.prepare("INSERT INTO source_grants VALUES(?,?,'')").run(p, src.id);
  store.db.prepare("INSERT INTO source_grants VALUES(?,?,'')").run(p, ads.id);
  const programming = new ProgrammingService(store, 60000);
  const config: Programming = {
    profileId: p,
    groups: [
      {
        id: "content",
        mode: "ordered",
        selection: { type: "media", ids: [one.id] },
      },
    ],
    rules: noBreaks,
    seed: 42,
  };
  const old = programming.publish(owner, ch.id, config, 0, 60000);
  const player = new PlaybackService(store, programming);
  const replace = (id: string): Programming => ({
    ...config,
    groups: [{ ...config.groups[0]!, selection: { type: "media", ids: [id] } }],
  });
  return {
    get store() {
      return store;
    },
    owner,
    p,
    src,
    one,
    two,
    three,
    ch,
    ads,
    ad,
    programming,
    player,
    config,
    old,
    replace,
    reopen() {
      store.close();
      store = new Store(filename);
      return new PlaybackService(store, new ProgrammingService(store, 60000));
    },
  };
}
test("a delayed session adopts edited commercials at a complete-airing boundary without polling or losing delay", (t) => {
  const f = setup(t),
    s = f.player.join(f.owner, f.p, f.ch.id, 100);
  f.player.pause(f.owner, s.id, 1000);
  const next = f.programming.publish(
    f.owner,
    f.ch.id,
    {
      ...f.replace(f.two.id),
      commercialSelection: { type: "media", ids: [f.ad.id] },
      rules: {
        ...noBreaks,
        positions: [
          { kind: "timestamp", value: 2000 },
          { kind: "timestamp", value: 6000 },
        ],
        maxClips: 1,
        maxDurationMs: 1000,
        repeatAllowance: 100,
      },
    },
    2000,
    60000,
  );
  const staged = f.store.db
    .prepare(
      "SELECT pending_revision_id,pending_at_ms FROM playback_sessions WHERE id=?",
    )
    .get(s.id)!;
  assert.equal(staged.pending_revision_id, next.revisionId);
  assert.equal(staged.pending_at_ms, 10000);
  assert.equal(f.player.describe(f.owner, s.id, 5000).paused, true);
  f.player.resume(f.owner, s.id, 5000);
  const before = f.player.describe(f.owner, s.id, 13999);
  assert.equal(before.positionMs, 9999);
  assert.equal(before.revisionId, f.old.revisionId);
  assert.equal(before.context?.next?.title, f.two.title);
  const at = f.player.describe(f.owner, s.id, 14000);
  assert.equal(at.positionMs, 10000);
  assert.equal(at.behindLiveMs, 4000);
  assert.equal(at.revisionId, next.revisionId);
  assert.equal(at.playback?.entry.mediaId, f.two.id);
  assert.equal(at.playback?.offsetMs, 0);
  const ad = f.player.describe(f.owner, s.id, 16000);
  assert.equal(ad.context?.kind, "commercial");
  assert.equal(ad.playback?.entry.mediaId, f.ad.id);
  assert.equal(
    f.player.describe(f.owner, s.id, 17000).playback?.offsetMs,
    2000,
  );
  assert.equal(
    f.player.describe(f.owner, s.id, 21000).context?.kind,
    "commercial",
  );
});
test("frequent edits retain an early handover and preserve the canonical history before the broadcast edit", (t) => {
  const f = setup(t),
    s = f.player.join(f.owner, f.p, f.ch.id, 100);
  f.player.pause(f.owner, s.id, 2000);
  f.programming.publish(f.owner, f.ch.id, f.replace(f.two.id), 25000, 60000);
  const last = f.programming.publish(
    f.owner,
    f.ch.id,
    f.replace(f.three.id),
    26000,
    60000,
  );
  assert.equal(last.effectiveMs, 30000);
  assert.equal(
    f.store.db
      .prepare("SELECT pending_at_ms FROM playback_sessions WHERE id=?")
      .get(s.id)?.pending_at_ms,
    10000,
  );
  f.player.resume(f.owner, s.id, 28000);
  const adopted = f.player.describe(f.owner, s.id, 36001);
  assert.equal(adopted.positionMs, 10001);
  assert.equal(adopted.behindLiveMs, 26000);
  assert.equal(adopted.revisionId, last.revisionId);
  assert.equal(adopted.playback?.entry.mediaId, f.one.id);
  const updated = f.player.describe(f.owner, s.id, 56000);
  assert.equal(updated.positionMs, 30000);
  assert.equal(updated.playback?.entry.mediaId, f.three.id);
});
test("a later publication settles a due unobserved handover before staging the next one", (t) => {
  const f = setup(t),
    s = f.player.join(f.owner, f.p, f.ch.id, 100);
  f.player.pause(f.owner, s.id, 1000);
  f.player.resume(f.owner, s.id, 5000);
  const first = f.programming.publish(
    f.owner,
    f.ch.id,
    f.replace(f.two.id),
    6000,
    60000,
  );
  const second = f.programming.publish(
    f.owner,
    f.ch.id,
    f.replace(f.three.id),
    18000,
    60000,
  );
  const row = f.store.db
    .prepare("SELECT * FROM playback_sessions WHERE id=?")
    .get(s.id)!;
  assert.equal(row.revision_id, first.revisionId);
  assert.equal(row.pending_revision_id, second.revisionId);
  assert.equal(row.pending_at_ms, 20000);
  const next = f.player.describe(f.owner, s.id, 24050);
  assert.equal(next.positionMs, 20050);
  assert.equal(next.playback?.entry.mediaId, f.three.id);
  assert.equal(next.playback?.offsetMs, 50);
  assert.equal(next.behindLiveMs, 4000);
});
test("pausing in a midroll retains its continuation and trailing break before handover", (t) => {
  const f = setup(t);
  const initial = f.programming.publish(
    f.owner,
    f.ch.id,
    {
      ...f.config,
      commercialSelection: { type: "media", ids: [f.ad.id] },
      rules: {
        ...noBreaks,
        between: true,
        positions: [{ kind: "timestamp", value: 5000 }],
        maxClips: 1,
        maxDurationMs: 1000,
        repeatAllowance: 100,
      },
    },
    0,
    60000,
  );
  const s = f.player.join(f.owner, f.p, f.ch.id, 10500);
  // The first changed airing begins at 10,000; its midroll and trailing break end at 22,000.
  f.player.pause(f.owner, s.id, 15500);
  const next = f.programming.publish(
    f.owner,
    f.ch.id,
    f.replace(f.two.id),
    17000,
    60000,
  );
  assert.equal(next.effectiveMs, 22000);
  assert.equal(
    f.player.describe(f.owner, s.id, 30000).revisionId,
    initial.revisionId,
  );
  f.player.resume(f.owner, s.id, 30000);
  assert.equal(
    f.player.describe(f.owner, s.id, 30499).context?.kind,
    "commercial",
  );
  assert.equal(
    f.player.describe(f.owner, s.id, 30500).playback?.offsetMs,
    5000,
  );
  assert.equal(
    f.player.describe(f.owner, s.id, 35500).context?.kind,
    "commercial",
  );
  const at = f.player.describe(f.owner, s.id, 36500);
  assert.equal(at.revisionId, next.revisionId);
  assert.equal(at.playback?.offsetMs, 0);
  assert.equal(at.behindLiveMs, 14500);
});
test("empty programming ends the delayed timeline at its canonical boundary without extending old content", (t) => {
  const f = setup(t),
    s = f.player.join(f.owner, f.p, f.ch.id, 100);
  f.player.pause(f.owner, s.id, 1000);
  f.player.resume(f.owner, s.id, 5000);
  const oldEnd = f.store.db
    .prepare(
      "SELECT MAX(end_ms) AS end FROM schedule_entries WHERE revision_id=?",
    )
    .get(f.old.revisionId)?.end;
  const empty = f.programming.publish(
    f.owner,
    f.ch.id,
    { ...f.config, groups: [] },
    6000,
    60000,
  );
  const ended = f.player.describe(f.owner, s.id, 14000);
  assert.equal(ended.revisionId, empty.revisionId);
  assert.equal(ended.available, false);
  assert.equal(ended.playback, null);
  assert.equal(ended.positionMs, 10000);
  assert.equal(
    f.store.db
      .prepare(
        "SELECT MAX(end_ms) AS end FROM schedule_entries WHERE revision_id=?",
      )
      .get(f.old.revisionId)?.end,
    oldEnd,
  );
});
test("handover and final old-entry delivery events survive restart while preserving idempotence and access", (t) => {
  const root = mkdtempSync(join(tmpdir(), "mytuner-handover-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = setup(t, join(root, "db.sqlite")),
    s = f.player.join(f.owner, f.p, f.ch.id, 100),
    entry = s.playback!.entry;
  f.player.pause(f.owner, s.id, 1000);
  f.player.resume(f.owner, s.id, 5000);
  const next = f.programming.publish(
    f.owner,
    f.ch.id,
    f.replace(f.two.id),
    6000,
    60000,
  );
  const player = f.reopen(),
    after = player.describe(f.owner, s.id, 14010);
  assert.equal(after.revisionId, next.revisionId);
  assert.equal(after.positionMs, 10010);
  assert.equal(after.behindLiveMs, 4000);
  const event = {
    id: randomUUID(),
    entryId: entry.id,
    startMs: 9000,
    endMs: 10000,
  };
  player.record(f.owner, s.id, event, 14010);
  player.record(f.owner, s.id, event, 14010);
  assert.equal(
    f.store.db
      .prepare("SELECT COUNT(*) AS n FROM playback_events WHERE id=?")
      .get(event.id)?.n,
    1,
  );
  const oldFuture = f.store.db
    .prepare(
      "SELECT id FROM schedule_entries WHERE revision_id=? AND start_ms=10000",
    )
    .get(f.old.revisionId)!;
  assert.throws(
    () =>
      player.record(
        f.owner,
        s.id,
        {
          id: randomUUID(),
          entryId: String(oldFuture.id),
          startMs: 10000,
          endMs: 10001,
        },
        14010,
      ),
    /Invalid delivered/,
  );
  assert.throws(
    () => player.record(f.owner, s.id, { ...event, id: randomUUID() }, 75001),
    /Invalid delivered/,
  );
});
test("pending targets remain retained and target grant revocation never leaks Next or bypasses handover checks", (t) => {
  const f = setup(t),
    s = f.player.join(f.owner, f.p, f.ch.id, 100);
  f.player.pause(f.owner, s.id, 1000);
  const hidden = source(f.store, "/new"),
    secret = media(f.store, hidden.id, "Secret.mp4", 10000);
  f.store.db
    .prepare("INSERT INTO source_grants VALUES(?,?,'')")
    .run(f.p, hidden.id);
  const next = f.programming.publish(
    f.owner,
    f.ch.id,
    f.replace(secret.id),
    2000,
    60000,
  );
  f.store.db
    .prepare("DELETE FROM source_grants WHERE source_id=?")
    .run(hidden.id);
  assert.equal(f.player.describe(f.owner, s.id, 3000).context?.next, null);
  f.player.resume(f.owner, s.id, 5000);
  assert.equal(
    f.player.describe(f.owner, s.id, 13999).playback?.entry.mediaId,
    f.one.id,
  );
  assert.throws(() => f.player.describe(f.owner, s.id, 14000), /not found/);
  assert.throws(
    () => f.player.describe(account(f.store), s.id, 14000),
    /not found/,
  );
  assert.equal(
    f.store.db
      .prepare("SELECT id FROM schedule_revisions WHERE id=?")
      .get(next.revisionId)?.id,
    next.revisionId,
  );
});
test("a legacy diverged session requests explicit rejoin instead of jumping into another show's middle", (t) => {
  const f = setup(t),
    s = f.player.join(f.owner, f.p, f.ch.id, 100);
  f.player.pause(f.owner, s.id, 1000);
  f.player.resume(f.owner, s.id, 5000);
  const next = f.programming.publish(
    f.owner,
    f.ch.id,
    f.replace(f.two.id),
    6000,
    60000,
  );
  f.store.db
    .prepare(
      "UPDATE playback_sessions SET pending_revision_id=NULL,pending_at_ms=NULL WHERE id=?",
    )
    .run(s.id);
  const legacy = f.player.describe(f.owner, s.id, 15000);
  assert.equal(legacy.revisionId, f.old.revisionId);
  assert.equal(legacy.positionMs, 11000);
  assert.equal(legacy.scheduleUpdate?.rejoinRequired, true);
  assert.equal(legacy.playback?.entry.mediaId, f.one.id);
  const live = f.player.goLive(f.owner, s.id, 15000);
  assert.equal(live.revisionId, next.revisionId);
  assert.equal(live.behindLiveMs, 0);
  assert.equal(live.scheduleUpdate, null);
});
test("old HLS manifests and segments cannot prefetch a future airing beyond a staged handover", async (t) => {
  const f = setup(t),
    s = f.player.join(f.owner, f.p, f.ch.id, 100);
  f.player.pause(f.owner, s.id, 1000);
  f.player.resume(f.owner, s.id, 5000);
  const streaming = new StreamingService(f.store, f.player, "/unused");
  t.after(() => streaming.stop());
  const before = streaming.manifest(f.owner, s.id, 6000);
  const oldFuture = f.store.db
    .prepare(
      "SELECT id FROM schedule_entries WHERE revision_id=? AND start_ms=10000",
    )
    .get(f.old.revisionId)!;
  assert.ok(!before.includes(String(oldFuture.id)));
  f.programming.publish(f.owner, f.ch.id, f.replace(f.two.id), 6000, 60000);
  const manifest = streaming.manifest(f.owner, s.id, 7000);
  assert.ok(!manifest.includes(String(oldFuture.id)));
  await assert.rejects(
    streaming.segment(
      () => f.owner,
      s.id,
      String(oldFuture.id),
      10000,
      undefined,
      7000,
    ),
    /unavailable/,
  );
  const after = streaming.manifest(f.owner, s.id, 14000);
  assert.ok(!after.includes(s.playback!.entry.id));
});
test("pending descriptor polls reuse staged work without writing every second and Go Live clears it", (t) => {
  const f = setup(t),
    s = f.player.join(f.owner, f.p, f.ch.id, 100);
  f.player.pause(f.owner, s.id, 1000);
  f.programming.publish(f.owner, f.ch.id, f.replace(f.two.id), 2000, 60000);
  const changes = f.store.db.prepare("SELECT total_changes() AS n").get()?.n;
  for (let now = 3000; now < 3020; now++) f.player.describe(f.owner, s.id, now);
  assert.equal(
    f.store.db.prepare("SELECT total_changes() AS n").get()?.n,
    changes,
  );
  const live = f.player.goLive(f.owner, s.id, 12000);
  assert.equal(live.behindLiveMs, 0);
  assert.equal(live.scheduleUpdate, null);
  assert.equal(
    f.store.db
      .prepare("SELECT pending_revision_id FROM playback_sessions WHERE id=?")
      .get(s.id)?.pending_revision_id,
    null,
  );
});

test("cleanup protects a superseded pending target until its session releases it", (t) => {
  const f = setup(t),
    s = f.player.join(f.owner, f.p, f.ch.id, 100);
  f.player.pause(f.owner, s.id, 1000);
  const target = f.programming.publish(
    f.owner,
    f.ch.id,
    f.replace(f.two.id),
    2000,
    60000,
  );
  const latest = f.programming.publish(
    f.owner,
    f.ch.id,
    f.replace(f.three.id),
    3000,
    60000,
  );
  // A previously staged target may remain when a newer target is incompatible.
  f.store.db
    .prepare("UPDATE playback_sessions SET pending_revision_id=? WHERE id=?")
    .run(target.revisionId, s.id);
  f.store.db
    .prepare("UPDATE schedule_revisions SET created_at=? WHERE id=?")
    .run(-10 * 86400000, target.revisionId);
  f.player.collect(4000);
  assert.equal(
    f.store.db
      .prepare("SELECT id FROM schedule_revisions WHERE id=?")
      .get(target.revisionId)?.id,
    target.revisionId,
  );
  f.store.db.prepare("DELETE FROM playback_sessions WHERE id=?").run(s.id);
  f.player.collect(4001);
  assert.equal(
    f.store.db
      .prepare("SELECT id FROM schedule_revisions WHERE id=?")
      .get(target.revisionId),
    undefined,
  );
  assert.equal(
    f.store.db
      .prepare("SELECT id FROM schedule_revisions WHERE id=?")
      .get(latest.revisionId)?.id,
    latest.revisionId,
  );
});

test("problem reports authorize only the retained airing before a handover and the effective target afterward", async (t) => {
  const { ProblemReports } = await import("../src/retained.js");
  const f = setup(t),
    retired = source(f.store, "/retired"),
    retiredItem = media(f.store, retired.id, "Retired.mp4", 10000);
  f.store.db
    .prepare("INSERT INTO source_grants VALUES(?,?,'')")
    .run(f.p, retired.id);
  const cfg: Programming = {
    ...f.config,
    groups: [
      {
        ...f.config.groups[0]!,
        selection: { type: "media", ids: [f.one.id, retiredItem.id] },
      },
    ],
  };
  f.programming.publish(f.owner, f.ch.id, cfg, 0, 60000);
  const s = f.player.join(f.owner, f.p, f.ch.id, 10500);
  f.player.pause(f.owner, s.id, 11000);
  f.programming.publish(f.owner, f.ch.id, f.replace(f.two.id), 12000, 60000);
  f.store.db
    .prepare("INSERT INTO subscriptions(profile_id,channel_id) VALUES(?,?)")
    .run(f.p, f.ch.id);
  f.store.db
    .prepare("DELETE FROM source_grants WHERE source_id=?")
    .run(retired.id);
  const reports = new ProblemReports(f.store),
    preview = reports.preview(f.owner, s.id, "picture", "browser", 13000);
  assert.equal(preview.summary.state, "paused");
  f.player.resume(f.owner, s.id, 15000);
  const after = reports.preview(f.owner, s.id, "picture", "browser", 24001);
  assert.equal(after.summary.state, "behind-live");
  assert.equal(
    after.summary.entryId,
    f.store.db
      .prepare(
        "SELECT id FROM schedule_entries e JOIN active_schedules a ON a.revision_id=e.revision_id WHERE e.start_ms<=20001 AND e.end_ms>20001",
      )
      .get()?.id,
  );
});

test("stale pre-handover browser descriptors cannot replace a newer session state or rewind within it", async (t) => {
  const { olderPlayback } = await import("../web/src/playback-state.js");
  const f = setup(t),
    s = f.player.join(f.owner, f.p, f.ch.id, 100);
  f.player.pause(f.owner, s.id, 1000);
  f.player.resume(f.owner, s.id, 5000);
  f.programming.publish(f.owner, f.ch.id, f.replace(f.two.id), 6000, 60000);
  const old = f.player.describe(f.owner, s.id, 13999),
    next = f.player.describe(f.owner, s.id, 14001);
  assert.ok(next.stateVersion > old.stateVersion);
  assert.equal(olderPlayback(old, next), true);
  assert.equal(olderPlayback(next, old), false);
  assert.equal(
    olderPlayback({ ...next, positionMs: next.positionMs - 1 }, next),
    true,
  );
  const paused = f.player.pause(f.owner, s.id, 14002);
  assert.equal(olderPlayback(next, paused), true);
  assert.equal(olderPlayback({ ...old, id: randomUUID() }, paused), false);
});

test("schema 21 upgrades retain existing session clocks and reject a partial handover", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { migrations, schemaVersion } = await import("../src/database.js");
  const root = mkdtempSync(join(tmpdir(), "mytuner-handover-migration-")),
    path = join(root, "db.sqlite");
  let previous: InstanceType<typeof DatabaseSync> | undefined,
    upgraded: Store | undefined;
  try {
    previous = new DatabaseSync(path);
    previous.exec(migrations.slice(0, 21).join("\n"));
    previous.exec("PRAGMA user_version=21");
    const oldStore = { db: previous } as unknown as Store,
      owner = account(oldStore),
      p = profile(oldStore, owner),
      ch = channel(oldStore, owner),
      rev = randomUUID(),
      id = randomUUID();
    previous
      .prepare(
        "INSERT INTO schedule_revisions(id,channel_id,created_at) VALUES(?,?,0)",
      )
      .run(rev, ch.id);
    previous
      .prepare(
        "INSERT INTO playback_sessions(id,account_id,profile_id,channel_id,revision_id,position_ms,anchor_ms,paused,last_seen) VALUES(?,?,?,?,?,100,500,1,500)",
      )
      .run(id, owner.id, p, ch.id, rev);
    previous.close();
    previous = undefined;
    upgraded = new Store(path);
    const row = upgraded.db
      .prepare("SELECT * FROM playback_sessions WHERE id=?")
      .get(id)!;
    assert.equal(row.position_ms, 100);
    assert.equal(row.anchor_ms, 500);
    assert.equal(row.paused, 1);
    assert.equal(row.pending_revision_id, null);
    assert.equal(row.pending_at_ms, null);
    assert.equal(row.state_version, 0);
    assert.equal(
      upgraded.db.prepare("PRAGMA user_version").get()?.user_version,
      schemaVersion,
    );
    assert.throws(
      () =>
        upgraded!.db
          .prepare(
            "UPDATE playback_sessions SET pending_revision_id=? WHERE id=?",
          )
          .run(rev, id),
      /CHECK/,
    );
    assert.deepEqual(upgraded.db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    previous?.close();
    upgraded?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
