import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  rm,
  realpath,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { Store, schemaVersion, migrations } from "../src/database.js";
import {
  backupApplication,
  restoreApplication,
  verifyApplicationBackup,
  recoverInterruptedRestore,
} from "../src/recovery.js";
import { loadIntegrationKey, RefreshService } from "../src/refresh.js";
import {
  CollectionRecovery,
  ProblemReports,
  recentlyAired,
} from "../src/retained.js";
import { createServer } from "../src/server.js";
import { ProgrammingService } from "../src/programming.js";
import { PlaybackService } from "../src/playback.js";
import {
  saveCollection,
  selectMedia,
  programmingOptions,
} from "../src/library.js";
import { digest } from "../src/security.js";
import { noBreaks } from "../src/scheduler.js";
import type { Programming } from "../src/contracts.js";
import { account, profile, source, media, channel } from "./helpers.js";
function fixture(t: { after: (fn: () => unknown) => void }) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const owner = account(store),
    admin = account(store, "admin"),
    stranger = account(store),
    p = profile(store, owner),
    src = source(store, "/synthetic/shows", "shows"),
    ads = source(store, "/synthetic/ads", "commercials"),
    one = media(store, src.id, "one.mp4", 20000),
    two = media(store, src.id, "two.mp4", 20000),
    ad = media(store, ads.id, "old/ad.mp4", 12000),
    ch = channel(store, owner);
  for (const s of [src, ads])
    store.db.prepare("INSERT INTO source_grants VALUES(?,?,'')").run(p, s.id);
  store.db
    .prepare("INSERT INTO subscriptions(profile_id,channel_id) VALUES(?,?)")
    .run(p, ch.id);
  const programming = new ProgrammingService(store, 120000),
    config: Programming = {
      profileId: p,
      groups: [
        {
          id: "g",
          mode: "ordered",
          selection: { type: "media", ids: [one.id, two.id] },
        },
      ],
      rules: noBreaks,
      seed: 42,
    };
  return {
    store,
    owner,
    admin,
    stranger,
    p,
    src,
    ads,
    one,
    two,
    ad,
    ch,
    programming,
    config,
  };
}
function schedule(store: Store) {
  return JSON.stringify(
    store.db.prepare("SELECT * FROM schedule_entries ORDER BY id").all(),
  );
}

test("R7-02 saved retired exclusions never require revoked or missing out-of-pool media; new hidden IDs still fail", (t) => {
  const f = fixture(t),
    now = Date.now(),
    config = {
      ...f.config,
      commercialSelection: {
        type: "folder" as const,
        sourceId: f.ads.id,
        directory: "old",
        recursive: true,
      },
      disabledCommercialIds: [f.ad.id],
    };
  f.programming.publish(f.owner, f.ch.id, config, now, 40000);
  f.store.db
    .prepare("DELETE FROM source_grants WHERE source_id=?")
    .run(f.ads.id);
  const removed = { ...config, commercialSelection: undefined };
  assert.ok(
    f.programming.preview(f.owner, f.ch.id, removed, now + 100).entries.length,
  );
  f.programming.publish(f.owner, f.ch.id, removed, now + 100, 40000);
  f.programming.ensure(f.ch.id, now + 200000);
  const hidden = media(f.store, f.ads.id, "hidden.mp4");
  assert.throws(
    () =>
      f.programming.preview(
        f.owner,
        f.ch.id,
        { ...removed, disabledCommercialIds: [hidden.id] },
        now + 100,
      ),
    /Commercial not found/,
  );
  assert.throws(
    () =>
      f.programming.preview(
        f.owner,
        f.ch.id,
        { ...removed, disabledCommercialIds: [f.one.id] },
        now + 100,
      ),
    /Commercial not found/,
  );
  f.store.db.prepare("UPDATE media SET available=0 WHERE id=?").run(f.ad.id);
  assert.ok(
    f.programming.preview(f.owner, f.ch.id, removed, now + 100).entries.length,
  );
});

test("I43 atomic revision conflicts preserve schedules/checkpoints including first and pending publication", (t) => {
  const f = fixture(t),
    now = Date.now(),
    first = f.programming.publish(
      f.owner,
      f.ch.id,
      { ...f.config, expectedRevisionId: null },
      now,
      60000,
    );
  const before = schedule(f.store),
    state = f.store.db
      .prepare("SELECT state_json FROM rotation_state WHERE channel_id=?")
      .get(f.ch.id)?.state_json;
  for (const expected of [null, randomUUID()]) {
    const stale = {
      ...f.config,
      expectedRevisionId: expected,
      checkpointActions: [{ groupId: "g", action: "restart" as const }],
    };
    assert.throws(
      () => f.programming.preview(f.owner, f.ch.id, stale, now + 10),
      /changed elsewhere/,
    );
    assert.throws(
      () => f.programming.publish(f.owner, f.ch.id, stale, now + 10),
      /changed elsewhere/,
    );
  }
  assert.equal(schedule(f.store), before);
  assert.equal(
    f.store.db
      .prepare("SELECT state_json FROM rotation_state WHERE channel_id=?")
      .get(f.ch.id)?.state_json,
    state,
  );
  f.programming.ensure(f.ch.id, now + 180000);
  const second = f.programming.publish(
    f.owner,
    f.ch.id,
    { ...f.config, expectedRevisionId: first.revisionId },
    now + 20,
    60000,
  );
  assert.ok(second.effectiveMs > now + 20);
  assert.throws(
    () =>
      f.programming.publish(
        f.owner,
        f.ch.id,
        { ...f.config, expectedRevisionId: first.revisionId },
        now + 30,
      ),
    /changed elsewhere/,
  );
  const third = f.programming.publish(
    f.owner,
    f.ch.id,
    { ...f.config, expectedRevisionId: second.revisionId },
    now + 40,
    60000,
  );
  assert.equal(third.effectiveMs, second.effectiveMs);
  assert.equal(
    JSON.parse(f.programming.active(f.ch.id)!.config_json!).expectedRevisionId,
    undefined,
  );
  assert.throws(
    () =>
      f.programming.preview(f.stranger, f.ch.id, {
        ...f.config,
        expectedRevisionId: third.revisionId,
      }),
    /Channel not found/,
  );
  // Legacy clients can still omit the precondition.
  f.programming.publish(f.owner, f.ch.id, f.config, now + 50, 60000);
});

test("I42 deleted collection retains exact membership and ID, hides normal selectors, blocks revoked restores and expires metadata only", (t) => {
  const f = fixture(t),
    now = Date.now(),
    c = saveCollection(f.store, f.owner, f.p, "Mix", [f.one.id, f.two.id]),
    recovery = new CollectionRecovery(f.store);
  f.programming.publish(
    f.owner,
    f.ch.id,
    {
      ...f.config,
      groups: [
        {
          id: "g",
          mode: "ordered",
          selection: { type: "collection", id: c.id },
        },
      ],
    },
    now,
    60000,
  );
  const before = schedule(f.store);
  f.store.db
    .prepare("UPDATE collections SET deleted_ms=?,expires_ms=? WHERE id=?")
    .run(now, now + 1000, c.id);
  f.store.db.prepare("UPDATE media SET available=0 WHERE id=?").run(f.two.id);
  assert.throws(
    () => selectMedia(f.store, f.owner, f.p, { type: "collection", id: c.id }),
    /Collection not found/,
  );
  assert.throws(
    () => saveCollection(f.store, f.owner, f.p, "Overwrite", [f.one.id], c.id),
    /Collection not found/,
  );
  assert.ok(
    !JSON.stringify(
      programmingOptions(f.store, f.owner, f.p, {
        search: "",
        offset: 0,
        limit: 100,
      }),
    ).includes(c.id),
  );
  assert.equal(recovery.list(f.owner, f.p, now + 1).items[0]!.count, 2);
  const otherProfile = profile(f.store, f.stranger);
  assert.equal(
    recovery.list(f.stranger, otherProfile, now + 1).items.length,
    0,
  );
  f.store.db
    .prepare("DELETE FROM source_grants WHERE source_id=?")
    .run(f.src.id);
  assert.equal(recovery.list(f.owner, f.p, now + 2).items.length, 0);
  assert.throws(
    () => recovery.restore(f.owner, f.p, c.id, now + 2),
    /Collection not found/,
  );
  f.store.db
    .prepare("INSERT INTO source_grants VALUES(?,?,'')")
    .run(f.p, f.src.id);
  assert.equal(recovery.restore(f.owner, f.p, c.id, now + 3).id, c.id);
  assert.equal(
    f.store.db
      .prepare(
        "SELECT COUNT(*) AS n FROM collection_items WHERE collection_id=?",
      )
      .get(c.id)?.n,
    2,
  );
  assert.equal(schedule(f.store), before);
  f.store.db
    .prepare("UPDATE collections SET deleted_ms=?,expires_ms=? WHERE id=?")
    .run(now, now + 1000, c.id);
  assert.throws(
    () => recovery.restore(f.owner, f.p, c.id, now + 1000),
    /Collection not found/,
  );
  recovery.purge(now + 1000);
  assert.equal(
    f.store.db
      .prepare(
        "SELECT COUNT(*) AS n FROM collection_items WHERE collection_id=?",
      )
      .get(c.id)?.n,
    0,
  );
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM media").get()?.n,
    3,
  );
  assert.equal(schedule(f.store), before);
});

test("I39 recent airings collapse split programs, use only active retained prefix and never generate or mutate", (t) => {
  const f = fixture(t),
    now = Date.now();
  f.store.db.prepare("UPDATE media SET metadata_json=? WHERE id=?").run(
    JSON.stringify({
      seriesTitle: "Midnight show",
      seasonNumber: 1,
      episodeNumber: 2,
    }),
    f.one.id,
  );
  const first = f.programming.publish(
    f.owner,
    f.ch.id,
    {
      ...f.config,
      commercialSelection: { type: "media", ids: [f.ad.id] },
      rules: {
        ...noBreaks,
        positions: [{ kind: "percent", value: 50 }],
        maxClips: 1,
        maxDurationMs: 12000,
      },
    },
    now - 90000,
    120000,
  );
  const rows = f.store.db
    .prepare(
      "SELECT program_id FROM schedule_entries WHERE revision_id=? GROUP BY program_id HAVING COUNT(*)>1",
    )
    .all(first.revisionId);
  assert.ok(rows.length);
  const second = f.programming.publish(
    f.owner,
    f.ch.id,
    f.config,
    now - 1000,
    60000,
  );
  // A paused-only old revision can be extended; it must not appear in recent lookup.
  f.store.db
    .prepare(
      "INSERT INTO schedule_entries(id,revision_id,channel_id,media_id,program_id,start_ms,end_ms,offset_ms,kind) VALUES(?,?,?,?,?,?,?,0,'program')",
    )
    .run(
      randomUUID(),
      first.revisionId,
      f.ch.id,
      f.one.id,
      "paused-only",
      now - 2000,
      now - 1000,
    );
  const before = f.store.db.prepare("SELECT total_changes() AS n").get()?.n,
    result = recentlyAired(f.store, f.owner, f.p, f.ch.id, now);
  assert.ok(result.items.length > 0);
  assert.equal(
    new Set(result.items.map((r) => r.programId)).size,
    result.items.length,
  );
  assert.ok(!result.items.some((r) => r.programId === "paused-only"));
  assert.ok(
    result.items.some((r) => r.seasonNumber === 1 && r.episodeNumber === 2),
  );
  assert.equal(
    f.store.db.prepare("SELECT total_changes() AS n").get()?.n,
    before,
  );
  assert.equal(f.programming.active(f.ch.id)?.id, second.revisionId);
  f.store.db
    .prepare("DELETE FROM source_grants WHERE source_id=?")
    .run(f.src.id);
  assert.throws(
    () => recentlyAired(f.store, f.owner, f.p, f.ch.id, now),
    /Channel not found/,
  );
  assert.throws(
    () =>
      recentlyAired(
        f.store,
        f.stranger,
        profile(f.store, f.stranger),
        f.ch.id,
        now,
      ),
    /Channel not found/,
  );
});

test("I40 explicit reviewed reports are sanitized, idempotent, authorized and leave playback unchanged", (t) => {
  const f = fixture(t),
    now = Date.now();
  f.owner.sessionHash = "synthetic-auth";
  f.programming.publish(f.owner, f.ch.id, f.config, now, 120000);
  const player = new PlaybackService(f.store),
    s = player.join(f.owner, f.p, f.ch.id, now + 100),
    reports = new ProblemReports(f.store, 30);
  const before = JSON.stringify(
    f.store.db.prepare("SELECT * FROM playback_sessions").all(),
  );
  const draft = reports.preview(f.owner, s.id, "captions", "tv", now + 200);
  assert.deepEqual(
    Object.keys(draft.summary).sort(),
    [
      "appVersion",
      "category",
      "channelId",
      "client",
      "entryId",
      "route",
      "serverTime",
      "state",
    ].sort(),
  );
  assert.equal(reports.list(f.admin, 0, 25, now + 200).total, 0);
  assert.ok(!JSON.stringify(draft).includes("synthetic-auth"));
  const request = randomUUID(),
    sent = reports.send(f.owner, draft.draftId, request, now + 300);
  assert.deepEqual(sent.summary, draft.summary);
  assert.deepEqual(
    reports.send(f.owner, draft.draftId, request, now + 400),
    sent,
  );
  assert.equal(
    JSON.stringify(f.store.db.prepare("SELECT * FROM playback_sessions").all()),
    before,
  );
  assert.equal(reports.list(f.stranger, 0, 25, now + 500).total, 0);
  assert.throws(
    () => reports.send(f.stranger, draft.draftId, request, now + 500),
    /Report expired/,
  );
  assert.equal(reports.list(f.owner, 0, 25, now + 500).total, 1);
  assert.throws(
    () => reports.acknowledge(f.owner, String(sent.id)),
    /Administrator/,
  );
  reports.acknowledge(f.admin, String(sent.id), now + 600);
  assert.equal(
    reports.list(f.admin, 0, 25, now + 700).items[0]?.acknowledgedMs,
    now + 600,
  );
  const changed = reports.preview(f.owner, s.id, "sound", "browser", now + 800);
  player.pause(f.owner, s.id, now + 900);
  assert.throws(
    () => reports.send(f.owner, changed.draftId, randomUUID(), now + 1000),
    /Playback changed/,
  );
  const revoked = reports.preview(
    f.owner,
    s.id,
    "other",
    "browser",
    now + 1100,
  );
  f.store.db
    .prepare("DELETE FROM source_grants WHERE source_id=?")
    .run(f.src.id);
  assert.throws(
    () => reports.send(f.owner, revoked.draftId, randomUUID(), now + 1200),
    /Channel not found/,
  );
  assert.equal(reports.list(f.owner, 0, 25, now + 1200).total, 0);
  assert.equal(reports.list(f.admin, 0, 25, now + 1200).total, 1);
  reports.purge(now + 31 * 86400000);
  assert.equal(reports.list(f.admin, 0, 25, now + 31 * 86400000).total, 0);
});

test("I40 bounds explicit send rate, preview capacity and expiry", (t) => {
  const f = fixture(t),
    now = Date.now();
  f.programming.publish(f.owner, f.ch.id, f.config, now, 120000);
  const s = new PlaybackService(f.store).join(f.owner, f.p, f.ch.id, now),
    reports = new ProblemReports(f.store);
  const drafts = Array.from({ length: 6 }, () =>
    reports.preview(f.owner, s.id, "picture", "browser", now),
  );
  assert.throws(
    () => reports.send(f.owner, drafts[0]!.draftId, randomUUID(), now),
    /Report expired/,
  );
  for (let i = 0; i < 10; i++) {
    const d = reports.preview(f.owner, s.id, "other", "browser", now);
    reports.send(f.owner, d.draftId, randomUUID(), now);
  }
  const next = reports.preview(f.owner, s.id, "other", "browser", now);
  assert.throws(
    () => reports.send(f.owner, next.draftId, randomUUID(), now),
    /Report limit/,
  );
  assert.throws(
    () => reports.send(f.owner, next.draftId, randomUUID(), now + 300001),
    /Report expired/,
  );
});

for (const kind of [
  "short",
  "long",
  "missing",
  "mismatched",
  "short-empty",
] as const)
  test(`R7-03 valid restore survives ${kind} live key and preserves forensic application bytes`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "mytuner-key-repair-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const store = new Store(join(root, "mytuner.db")),
      owner = account(store),
      key = await loadIntegrationKey(root);
    if (kind !== "short-empty") {
      const src = source(store, "/synthetic/movies", "movies");
      new RefreshService(store, key).configure(src.id, {
        provider: "radarr",
        url: "http://127.0.0.1:9",
        apiKey: "never-print-this",
        mappings: [{ from: "/remote", to: "/synthetic/movies" }],
      });
    }
    const snapshot = await backupApplication(store.db, root);
    account(store);
    store.close();
    const damaged =
      kind === "missing"
        ? null
        : kind === "long"
          ? Buffer.alloc(48)
          : kind === "mismatched"
            ? randomBytes(32)
            : Buffer.alloc(3);
    if (damaged) await writeFile(join(root, "integration.key"), damaged);
    else await rm(join(root, "integration.key"));
    const before = await readFile(join(root, "mytuner.db"));
    await restoreApplication(root, snapshot);
    const quarantine = join(
      root,
      "backups",
      (await readdir(join(root, "backups"))).find((n) =>
        n.startsWith("damaged-"),
      )!,
    );
    assert.deepEqual(await readFile(join(quarantine, "mytuner.db")), before);
    if (damaged)
      assert.deepEqual(
        await readFile(join(quarantine, "integration.key")),
        damaged,
      );
    assert.match(
      await readFile(join(quarantine, "damage.json"), "utf8"),
      /Live integration encryption key/,
    );
    const restored = new Store(join(root, "mytuner.db"));
    assert.equal(
      restored.db.prepare("SELECT id FROM accounts").get()?.id,
      owner.id,
    );
    restored.close();
    assert.deepEqual(await readFile(join(root, "integration.key")), key);
    // Interrupted key-repair restores retry the good bundle, never forensic bytes.
    await writeFile(
      join(root, "restore.pending.json"),
      JSON.stringify({ previous: null, quarantine, source: snapshot }),
    );
    await writeFile(join(root, "integration.key"), Buffer.alloc(2));
    await recoverInterruptedRestore(root);
    assert.deepEqual(await readFile(join(root, "integration.key")), key);
  });

async function bundle(
  t: { after: (fn: () => unknown) => void },
  encrypted: boolean,
) {
  const root = await mkdtemp(join(tmpdir(), "mytuner-verify-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new Store(join(root, "mytuner.db"));
  account(store);
  const key = await loadIntegrationKey(root);
  if (encrypted) {
    const src = source(store, "/synthetic/movies", "movies");
    new RefreshService(store, key).configure(src.id, {
      provider: "radarr",
      url: "http://127.0.0.1:9",
      apiKey: "never-print-this",
      mappings: [{ from: "/remote", to: "/synthetic/movies" }],
    });
  }
  const snapshot = await backupApplication(store.db, root);
  store.close();
  return { root, snapshot, key };
}
async function hashes(root: string) {
  return Promise.all(
    (await readdir(root)).sort().map(async (name) => [
      name,
      createHash("sha256")
        .update(await readFile(join(root, name)))
        .digest("hex"),
    ]),
  );
}
for (const encrypted of [false, true])
  test(`I38 verifies ${encrypted ? "encrypted" : "empty"} bundle without modifying live/bundle bytes`, async (t) => {
    const f = await bundle(t, encrypted),
      before = await hashes(f.snapshot),
      live = await readFile(join(f.root, "mytuner.db")),
      ownedScratch: string[] = [],
      originalMkdtemp = fs.mkdtemp,
      scratch = t.mock.method(
        fs,
        "mkdtemp",
        async (...args: Parameters<typeof fs.mkdtemp>) => {
          const path = await originalMkdtemp(...args);
          if (String(args[0]) === join(tmpdir(), "mytuner-verify-"))
            ownedScratch.push(String(path));
          return path;
        },
      );
    syncBuiltinESMExports();
    try {
      const result = await verifyApplicationBackup(f.snapshot);
      assert.equal(result.status, "valid");
      assert.equal(result.checkedSchemaVersion, schemaVersion);
      assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
      assert.deepEqual(await hashes(f.snapshot), before);
      assert.deepEqual(await readFile(join(f.root, "mytuner.db")), live);
      assert.ok(!(await readdir(f.root)).includes("restore.pending.json"));
      assert.equal(ownedScratch.length, 1);
      await assert.rejects(stat(ownedScratch[0]!), { code: "ENOENT" });
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        verifyApplicationBackup(f.snapshot, controller.signal),
      );
      assert.equal(ownedScratch.length, 2);
      for (const path of ownedScratch)
        await assert.rejects(stat(path), { code: "ENOENT" });
      assert.deepEqual(await hashes(f.snapshot), before);
      assert.deepEqual(await readFile(join(f.root, "mytuner.db")), live);
    } finally {
      scratch.mock.restore();
      syncBuiltinESMExports();
      await Promise.all(
        ownedScratch.map((path) => rm(path, { recursive: true, force: true })),
      );
    }
  });
test("I38 rejects corrupt, future, manifest mismatch and required key errors; migrations affect scratch only", async (t) => {
  const f = await bundle(t, true),
    db = await readFile(join(f.snapshot, "mytuner.db")),
    manifest = await readFile(join(f.snapshot, "manifest.json"));
  for (const key of [
    Buffer.alloc(3),
    Buffer.alloc(40),
    randomBytes(32),
    null,
  ]) {
    if (key) await writeFile(join(f.snapshot, "integration.key"), key);
    else await rm(join(f.snapshot, "integration.key"));
    await assert.rejects(verifyApplicationBackup(f.snapshot));
  }
  await writeFile(join(f.snapshot, "integration.key"), f.key);
  await writeFile(join(f.snapshot, "mytuner.db"), "corrupt");
  await assert.rejects(verifyApplicationBackup(f.snapshot));
  await writeFile(join(f.snapshot, "mytuner.db"), db);
  const future = new DatabaseSync(join(f.snapshot, "mytuner.db"));
  future.exec("PRAGMA user_version=999");
  future.close();
  await assert.rejects(verifyApplicationBackup(f.snapshot), /Unsupported/);
  await writeFile(join(f.snapshot, "mytuner.db"), db);
  await writeFile(
    join(f.snapshot, "manifest.json"),
    JSON.stringify({ format: 1, schemaVersion: 999, keyIncluded: true }),
  );
  await assert.rejects(verifyApplicationBackup(f.snapshot), /manifest/);
  await writeFile(join(f.snapshot, "manifest.json"), manifest);
  const old = join(f.root, "old");
  await mkdir(old);
  const oldDb = new DatabaseSync(join(old, "mytuner.db"));
  for (const sql of migrations.slice(0, -1)) oldDb.exec(sql);
  oldDb.exec(`PRAGMA user_version=${schemaVersion - 1}`);
  oldDb.close();
  await writeFile(
    join(old, "manifest.json"),
    JSON.stringify({
      format: 1,
      schemaVersion: schemaVersion - 1,
      keyIncluded: false,
    }),
  );
  const before = await hashes(old),
    result = await verifyApplicationBackup(old);
  assert.equal(result.sourceSchemaVersion, schemaVersion - 1);
  assert.equal(result.checkedSchemaVersion, schemaVersion);
  assert.deepEqual(await hashes(old), before);
});

test("R7 API collection delete/restart/restore retains metadata, filters selectors and honors configured expiry", async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "mytuner-r7-api-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of ["data", "media", "cache", "generated"])
    await mkdir(join(root, dir));
  let store = new Store(join(root, "data", "mytuner.db"));
  const owner = account(store),
    admin = account(store, "admin"),
    stranger = account(store),
    p = profile(store, owner),
    src = source(store, join(root, "media")),
    m = media(store, src.id),
    c = saveCollection(store, admin, p, "Recover original ID", [m.id]);
  store.db.prepare("INSERT INTO source_grants VALUES(?,?,'')").run(p, src.id);
  const token = randomUUID();
  store.db
    .prepare(
      "INSERT INTO sessions(token_hash,account_id,expires_at) VALUES(?,?,?)",
    )
    .run(digest(token), admin.id, Date.now() + 3600000);
  const headers = { authorization: `Bearer ${token}` },
    make = () =>
      createServer(store, {
        writableRoots: [
          join(root, "data"),
          join(root, "cache"),
          join(root, "generated"),
        ],
        cacheRoot: join(root, "cache"),
        generatedRoot: join(root, "generated"),
        collectionRetentionDays: 1,
      });
  let app = make();
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: `/api/profiles/${p}/collections/${c.id}`,
        headers,
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (
      await app.inject({
        url: `/api/profiles/${p}/collections/${c.id}`,
        headers,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({ url: `/api/profiles/${p}/collections`, headers })
    ).json().items.length,
    0,
  );
  const deleted = store.db
    .prepare("SELECT deleted_ms,expires_ms FROM collections WHERE id=?")
    .get(c.id)!;
  assert.ok(
    Math.abs(
      Number(deleted.expires_ms) - Number(deleted.deleted_ms) - 86400000,
    ) < 10,
  );
  await app.close();
  store.close();
  store = new Store(join(root, "data", "mytuner.db"));
  app = make();
  try {
    const list = await app.inject({
      url: `/api/profiles/${p}/deleted-collections`,
      headers,
    });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().items[0].id, c.id);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/profiles/${p}/deleted-collections/${c.id}/restore`,
          headers,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          url: `/api/profiles/${p}/collections/${c.id}`,
          headers,
        })
      ).json().items[0].id,
      m.id,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/profiles/${p}/deleted-collections/${c.id}/restore`,
          headers,
        })
      ).statusCode,
      404,
    );
  } finally {
    await app.close();
    store.close();
  }
  void owner;
  void stranger;
});

test("I40 API validates structured input, rejects cross-auth context, supports admin inbox and enforces 1000-row cap", async (t) => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "mytuner-report-api-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of ["data", "media", "cache", "generated"])
    await mkdir(join(root, dir));
  const store = new Store(join(root, "data", "mytuner.db")),
    owner = account(store),
    admin = account(store, "admin"),
    viewer = account(store, "viewer"),
    p = profile(store, owner),
    src = source(store, join(root, "media")),
    m = media(store, src.id, "safe.mp4", 60000),
    ch = channel(store, owner),
    now = Date.now();
  store.db.prepare("INSERT INTO source_grants VALUES(?,?,'')").run(p, src.id);
  store.db
    .prepare("INSERT INTO subscriptions(profile_id,channel_id) VALUES(?,?)")
    .run(p, ch.id);
  const headers = (a: typeof owner) => {
      const token = randomUUID();
      store.db
        .prepare(
          "INSERT INTO sessions(token_hash,account_id,expires_at) VALUES(?,?,?)",
        )
        .run(digest(token), a.id, now + 3600000);
      return { authorization: `Bearer ${token}` };
    },
    ownHeaders = headers(owner),
    otherAuth = headers(owner),
    adminHeaders = headers(admin),
    viewerHeaders = headers(viewer);
  new ProgrammingService(store).publish(
    owner,
    ch.id,
    {
      profileId: p,
      groups: [
        { id: "g", mode: "ordered", selection: { type: "media", ids: [m.id] } },
      ],
      rules: noBreaks,
      seed: 42,
    },
    now,
    120000,
  );
  const app = createServer(store, {
    writableRoots: [
      join(root, "data"),
      join(root, "cache"),
      join(root, "generated"),
    ],
    cacheRoot: join(root, "cache"),
    generatedRoot: join(root, "generated"),
    reportRetentionDays: 2,
  });
  t.after(async () => {
    await app.close();
    store.close();
  });
  const session = (
    await app.inject({
      method: "POST",
      url: "/api/playback/sessions",
      headers: ownHeaders,
      payload: { profileId: p, channelId: ch.id },
    })
  ).json();
  const previewUrl = `/api/playback/sessions/${session.id}/report-preview`;
  for (const body of [
    { category: "raw-errors", client: "browser" },
    { category: "sound", client: "browser", error: "/hidden/secret" },
  ])
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: previewUrl,
          headers: ownHeaders,
          payload: body,
        })
      ).statusCode,
      400,
    );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: previewUrl,
        headers: otherAuth,
        payload: { category: "sound", client: "browser" },
      })
    ).statusCode,
    404,
  );
  const d = (
    await app.inject({
      method: "POST",
      url: previewUrl,
      headers: ownHeaders,
      payload: { category: "sound", client: "browser" },
    })
  ).json();
  const r = (
    await app.inject({
      method: "POST",
      url: "/api/problem-reports",
      headers: ownHeaders,
      payload: { draftId: d.draftId, requestId: randomUUID() },
    })
  ).json();
  assert.ok(r.id);
  assert.equal(r.summary.category, "sound");
  assert.equal(
    (
      await app.inject({
        url: "/api/admin/problem-reports",
        headers: viewerHeaders,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({ url: "/api/problem-reports", headers: viewerHeaders })
    ).json().total,
    0,
  );
  const list = (
    await app.inject({
      url: "/api/admin/problem-reports",
      headers: adminHeaders,
    })
  ).json();
  assert.equal(list.total, 1);
  assert.equal(list.retentionDays, 2);
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: `/api/admin/problem-reports/${r.id}`,
        headers: adminHeaders,
        payload: { acknowledged: true },
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: `/api/admin/problem-reports/${r.id}`,
        headers: adminHeaders,
      })
    ).statusCode,
    204,
  );
  const deviceToken = randomUUID();
  store.db
    .prepare(
      "INSERT INTO sessions(token_hash,account_id,expires_at,kind) VALUES(?,?,?,'device')",
    )
    .run(digest(deviceToken), admin.id, now + 3600000);
  const deviceHeaders = { authorization: `Bearer ${deviceToken}` };
  assert.equal(
    (
      await app.inject({
        url: `/api/profiles/${p}/channels/${ch.id}/recent`,
        headers: deviceHeaders,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        url: "/api/admin/problem-reports",
        headers: deviceHeaders,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ url: "/api/problem-reports", headers: deviceHeaders }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        url: `/api/profiles/${p}/deleted-collections`,
        headers: deviceHeaders,
      })
    ).statusCode,
    403,
  );
  const deviceSession = (
    await app.inject({
      method: "POST",
      url: "/api/playback/sessions",
      headers: deviceHeaders,
      payload: { profileId: p, channelId: ch.id },
    })
  ).json();
  const deviceDraft = (
    await app.inject({
      method: "POST",
      url: `/api/playback/sessions/${deviceSession.id}/report-preview`,
      headers: deviceHeaders,
      payload: { category: "picture", client: "tv" },
    })
  ).json();
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/problem-reports",
        headers: deviceHeaders,
        payload: { draftId: deviceDraft.draftId, requestId: randomUUID() },
      })
    ).statusCode,
    200,
  );
  await app.inject({
    method: "DELETE",
    url: `/api/playback/sessions/${deviceSession.id}`,
    headers: deviceHeaders,
  });
  const existing = JSON.stringify(r.summary),
    reports = new ProblemReports(store, 2);
  const insert = store.db.prepare(
    "INSERT INTO problem_reports(id,account_id,request_id,profile_id,channel_id,media_id,created_ms,summary_json) VALUES(?,?,?,?,?,?,?,?)",
  );
  store.transaction(() => {
    for (let i = 0; i < 1000; i++)
      insert.run(
        randomUUID(),
        owner.id,
        randomUUID(),
        p,
        ch.id,
        m.id,
        now - 700000 - i,
        existing,
      );
  });
  owner.sessionHash = digest(ownHeaders.authorization.slice(7));
  const next = reports.preview(
    owner,
    session.id,
    "other",
    "browser",
    now + 100,
  );
  reports.send(owner, next.draftId, randomUUID(), now + 200);
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM problem_reports").get()?.n,
    1000,
  );
});
