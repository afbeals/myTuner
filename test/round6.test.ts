import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/database.js";
import { EncoderAdmission } from "../src/encoder-admission.js";
import { playbackDecision } from "../src/playback-policy.js";
import { playbackReadiness } from "../src/readiness.js";
import { collectionDependencies } from "../src/collection-dependencies.js";
import { createServer } from "../src/server.js";
import { ProgrammingService } from "../src/programming.js";
import { PlaybackService } from "../src/playback.js";
import { StreamingService } from "../src/streaming.js";
import { noBreaks } from "../src/scheduler.js";
import { saveCollection } from "../src/library.js";
import { digest } from "../src/security.js";
import { account, channel, profile, source, media } from "./helpers.js";
import { readResourceRoute, resourceLink } from "../web/src/resource-route.js";
import type { Programming } from "../src/contracts.js";
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release };
};
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

async function fixture(t: { after: (fn: () => unknown) => void }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "mytuner-round6-")));
  for (const dir of ["data", "media", "commercials", "cache", "generated"])
    await mkdir(join(root, dir));
  const store = new Store(join(root, "data", "mytuner.db")),
    admin = account(store, "admin"),
    editor = account(store, "editor"),
    stranger = account(store, "editor"),
    viewer = account(store, "viewer"),
    p = profile(store, editor),
    src = source(store, join(root, "media")),
    ads = source(store, join(root, "commercials"), "commercials");
  store.db.prepare("INSERT INTO source_grants VALUES(?,?,'')").run(p, src.id);
  store.db.prepare("INSERT INTO source_grants VALUES(?,?,'')").run(p, ads.id);
  const one = media(store, src.id, "one.mp4", 20000),
    two = media(store, src.id, "two.mkv", 20000),
    ad = media(store, ads.id, "one-ad.mp4", 12000),
    ad2 = media(store, ads.id, "two-ad.mp4", 12000);
  const technical = {
    durationMs: 20000,
    format: "mov,mp4",
    streams: [
      { index: 0, type: "video", codec: "h264", default: true, forced: false },
      {
        index: 1,
        type: "audio",
        codec: "aac",
        language: "eng",
        default: true,
        forced: false,
      },
      {
        index: 2,
        type: "subtitle",
        codec: "hdmv_pgs_subtitle",
        default: false,
        forced: false,
      },
      {
        index: 3,
        type: "subtitle",
        codec: "subrip",
        language: "eng",
        default: false,
        forced: false,
      },
    ],
  };
  for (const item of [one, two, ad, ad2]) {
    item.metadata_json = JSON.stringify({
      technical,
      seriesTitle: "Synthetic",
      seasonNumber: 1,
      episodeNumber: 1,
    });
    store.db
      .prepare("UPDATE media SET metadata_json=? WHERE id=?")
      .run(item.metadata_json, item.id);
  }
  const ch = channel(store, editor),
    programming = new ProgrammingService(store, 120000);
  const config: Programming = {
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
  const app = createServer(store, {
    generatedRoot: join(root, "generated"),
    cacheRoot: join(root, "cache"),
    writableRoots: [
      join(root, "data"),
      join(root, "generated"),
      join(root, "cache"),
    ],
  });
  const headers = (actor: typeof admin, kind = "api") => {
    const token = randomBytes(32).toString("base64url");
    store.db
      .prepare(
        "INSERT INTO sessions(token_hash,account_id,expires_at,kind) VALUES(?,?,?,?)",
      )
      .run(digest(token), actor.id, Date.now() + 60000, kind);
    return { authorization: `Bearer ${token}` };
  };
  t.after(async () => {
    await app.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    store,
    admin,
    editor,
    stranger,
    viewer,
    p,
    src,
    ads,
    one,
    two,
    ad,
    ad2,
    ch,
    programming,
    config,
    app,
    headers,
  };
}

test("shared encoder budget reserves interactive capacity, prioritizes queued playback and cancels waiting generation", async () => {
  const admission = new EncoderAdmission(2),
    heldBackground = gate(),
    heldPlayback = gate(),
    heldNext = gate(),
    signal = new AbortController(),
    order: string[] = [];
  const background = admission.run(
    "background",
    new AbortController().signal,
    () => {},
    async () => {
      order.push("background");
      await heldBackground.promise;
    },
  );
  const playback = admission.run(
    "interactive",
    new AbortController().signal,
    () => {},
    async () => {
      order.push("playback");
      await heldPlayback.promise;
    },
  );
  await turn();
  const cancelled = admission.run(
    "background",
    signal.signal,
    () => {},
    async () => {
      throw Error("cancelled work started");
    },
  );
  const cancellation = assert.rejects(cancelled, { name: "AbortError" });
  const next = admission.run(
    "interactive",
    new AbortController().signal,
    () => {},
    async () => {
      order.push("next-playback");
      await heldNext.promise;
    },
  );
  assert.equal(admission.snapshot().active, 2);
  signal.abort();
  await cancellation;
  heldPlayback.release();
  await playback;
  await turn();
  assert.deepEqual(order, ["background", "playback", "next-playback"]);
  assert.equal(admission.snapshot().active, 2);
  heldNext.release();
  heldBackground.release();
  await Promise.all([next, background]);
  assert.equal(admission.snapshot().active, 0);
});

test("encoder admission rechecks queued authority, drains shutdown and eventually admits optional work", async () => {
  const admission = new EncoderAdmission(2),
    a = gate(),
    b = gate();
  const first = admission.run(
      "interactive",
      new AbortController().signal,
      () => {},
      () => a.promise,
    ),
    second = admission.run(
      "interactive",
      new AbortController().signal,
      () => {},
      () => b.promise,
    );
  let allowed = true,
    executed = false;
  const revoked = admission.run(
    "interactive",
    new AbortController().signal,
    () => assert.ok(allowed, "revoked"),
    async () => {
      executed = true;
    },
  );
  const rejection = assert.rejects(revoked, /revoked/);
  allowed = false;
  a.release();
  await first;
  await rejection;
  assert.equal(executed, false);
  const thirdGate = gate();
  const third = admission.run(
    "interactive",
    new AbortController().signal,
    () => {},
    () => thirdGate.promise,
  );
  const backgroundGate = gate();
  let backgroundStarted = false;
  const optional = admission.run(
    "background",
    new AbortController().signal,
    () => {},
    async () => {
      backgroundStarted = true;
      await backgroundGate.promise;
    },
  );
  const burst = Array.from({ length: 12 }, () =>
    admission.run(
      "interactive",
      new AbortController().signal,
      () => {},
      async () => {},
    ),
  );
  thirdGate.release();
  await third;
  await turn();
  assert.equal(
    backgroundStarted,
    true,
    "waiting optional work must receive a turn during an interactive burst",
  );
  const queued = admission.run(
    "interactive",
    new AbortController().signal,
    () => {},
    async () => {
      throw Error("started after shutdown");
    },
  );
  const stopped = assert.rejects(queued, /stopping/);
  const burstResults = Promise.allSettled(burst);
  admission.stop();
  await stopped;
  b.release();
  backgroundGate.release();
  await Promise.all([second, optional, burstResults]);
  assert.equal(admission.snapshot().active, 0);
});

test("collection dependency reports omit foreign-private names/counts and deletion preserves retained scheduled playback", async (t) => {
  const f = await fixture(t),
    collection = saveCollection(f.store, f.editor, f.p, "Weekend mix", [
      f.one.id,
    ]);
  const config: Programming = {
    ...f.config,
    groups: [
      {
        id: "collection",
        mode: "ordered",
        selection: { type: "collection", id: collection.id },
      },
    ],
  };
  const now = Date.now();
  f.programming.publish(f.editor, f.ch.id, config, now, 120000);
  const another = channel(f.store, f.editor),
    hidden = channel(f.store, f.stranger);
  f.store.db
    .prepare("UPDATE channels SET name='Foreign secret' WHERE id=?")
    .run(hidden.id);
  f.programming.publish(f.editor, another.id, config, now, 120000);
  f.programming.publish(f.admin, hidden.id, config, now, 120000);
  const player = new PlaybackService(f.store, f.programming),
    session = player.join(f.editor, f.p, f.ch.id, now + 100);
  player.pause(f.editor, session.id, now + 200);
  const report = collectionDependencies(
    f.store,
    f.editor,
    f.p,
    collection.id,
    0,
    1,
  );
  assert.equal(report.total, 2);
  assert.equal(report.items.length, 1);
  assert.ok(report.items[0]!.recurring);
  assert.equal(
    collectionDependencies(f.store, f.editor, f.p, collection.id, 100, 1).total,
    2,
  );
  assert.equal(
    collectionDependencies(f.store, f.admin, f.p, collection.id).total,
    3,
  );
  const response = await f.app.inject({
    url: `/api/profiles/${f.p}/collections/${collection.id}/dependencies`,
    headers: f.headers(f.editor),
  });
  assert.equal(response.statusCode, 200);
  assert.ok(!response.body.includes("Foreign secret"));
  const denied = await f.app.inject({
    url: `/api/profiles/${f.p}/collections/${collection.id}/dependencies`,
    headers: f.headers(f.stranger),
  });
  assert.equal(denied.statusCode, 404);
  const removed = await f.app.inject({
    method: "DELETE",
    url: `/api/profiles/${f.p}/collections/${collection.id}`,
    headers: f.headers(f.editor),
  });
  assert.equal(removed.statusCode, 204);
  assert.equal(player.describe(f.editor, session.id, now + 500).paused, true);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM media").get()?.n,
    4,
  );
});

test("readiness shares real negotiation decisions including shortened ads, metadata unknowns and unsupported captions without creating jobs", async (t) => {
  const f = await fixture(t),
    caps = { containers: ["mp4"], videoCodecs: ["h264"], audioCodecs: ["aac"] },
    unknown = media(f.store, f.src.id, "unknown.mp4", 10000);
  const input = {
    profileId: f.p,
    selection: {
      type: "media" as const,
      ids: [f.one.id, f.two.id, unknown.id],
    },
    capabilities: caps,
    offset: 0,
    limit: 25,
  };
  const response = await f.app.inject({
    method: "POST",
    url: "/api/admin/playback-readiness",
    headers: f.headers(f.admin),
    payload: input,
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().counts, {
    direct: 1,
    hls: 1,
    unknown: 1,
    unavailable: 0,
    unsupportedCaptionTracks: 2,
  });
  for (const table of [
    "playback_sessions",
    "generation_jobs",
    "generated_assets",
  ])
    assert.equal(
      f.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n,
      0,
    );
  for (const headers of [f.headers(f.editor), f.headers(f.admin, "device")])
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/admin/playback-readiness",
          headers,
          payload: input,
        })
      ).statusCode,
      403,
    );
  const now = Date.now(),
    config: Programming = {
      ...f.config,
      commercialSelection: { type: "media", ids: [f.ad.id] },
      rules: {
        ...noBreaks,
        positions: [{ kind: "percent", value: 50 }],
        maxClips: 1,
        maxDurationMs: 10000,
        overflowPolicy: "truncate",
        minRemainingMs: 6000,
      },
    };
  f.programming.publish(f.admin, f.ch.id, config, now, 90000);
  const player = new PlaybackService(f.store, f.programming),
    playback = player.join(f.admin, f.p, f.ch.id, now + 11000),
    streaming = new StreamingService(
      f.store,
      player,
      join(f.root, "cache", "hls"),
    );
  assert.equal(
    (await streaming.negotiate(f.admin, playback.id, caps, now + 11000)).mode,
    "hls",
  );
  const report = playbackReadiness(
    f.store,
    f.admin,
    {
      profileId: f.p,
      channelId: f.ch.id,
      capabilities: caps,
      offset: 0,
      limit: 100,
    },
    now,
  );
  assert.ok(
    report.items.some((i) =>
      i.reasons.includes("Commercial is shortened to its scheduled interval"),
    ),
  );
  assert.equal(playbackDecision(f.one, caps).mode, "direct");
  await streaming.stop();
});

test("commercial retirement is channel-local, preserves old choices, supports all-disabled and rejects unauthorized IDs", async (t) => {
  const f = await fixture(t),
    config: Programming = {
      ...f.config,
      commercialSelection: { type: "media", ids: [f.ad.id, f.ad2.id] },
      rules: { ...noBreaks, between: true, maxClips: 1, maxDurationMs: 15000 },
    };
  const first = f.programming.publish(f.editor, f.ch.id, config, 0, 100000),
    other = channel(f.store, f.editor);
  f.programming.publish(f.editor, other.id, config, 0, 100000);
  const retired = { ...config, disabledCommercialIds: [f.ad.id] };
  const preview = f.programming.preview(
      f.editor,
      f.ch.id,
      retired,
      100,
      100000,
    ),
    result = f.programming.publish(f.editor, f.ch.id, retired, 100, 100000);
  assert.deepEqual(
    preview.entries.map((e) => e.mediaId),
    result.entries.map((e) => e.mediaId),
  );
  assert.ok(
    !result.entries.some(
      (e) => e.kind === "commercial" && e.mediaId === f.ad.id,
    ),
  );
  assert.ok(
    f.store.db
      .prepare(
        "SELECT id FROM schedule_entries WHERE revision_id=? AND media_id=?",
      )
      .get(first.revisionId, f.ad.id),
  );
  assert.ok(
    f.programming
      .preview(f.editor, other.id, config, 100, 100000)
      .entries.some((e) => e.mediaId === f.ad.id),
  );
  const empty = f.programming.preview(
    f.editor,
    f.ch.id,
    { ...retired, disabledCommercialIds: [f.ad.id, f.ad2.id] },
    200,
    100000,
  );
  assert.ok(empty.entries.every((e) => e.kind === "program"));
  for (let i = 1; i < empty.entries.length; i++)
    assert.equal(empty.entries[i]!.startMs, empty.entries[i - 1]!.endMs);
  assert.ok(
    f.programming
      .preview(f.editor, f.ch.id, config, 300, 100000)
      .entries.some((e) => e.mediaId === f.ad.id),
  );
  const hiddenSource = source(f.store, join(f.root, "hidden"), "commercials"),
    hidden = media(f.store, hiddenSource.id);
  assert.throws(
    () =>
      f.programming.preview(
        f.editor,
        f.ch.id,
        { ...config, disabledCommercialIds: [hidden.id] },
        400,
        100000,
      ),
    /Commercial not found/,
  );
  assert.throws(
    () =>
      f.programming.preview(
        f.editor,
        f.ch.id,
        { ...config, disabledCommercialIds: [f.one.id] },
        400,
        100000,
      ),
    /Commercial not found/,
  );
});

test("media inspector returns stored relative metadata only after current profile/source authorization", async (t) => {
  const f = await fixture(t),
    url = `/api/profiles/${f.p}/media/${f.one.id}/details`,
    headers = f.headers(f.editor);
  const response = await f.app.inject({ url, headers });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().relativePath, "one.mp4");
  assert.equal(response.json().technical.streams.length, 4);
  assert.ok(!response.body.includes(f.root));
  assert.equal(
    (await f.app.inject({ url, headers: f.headers(f.stranger) })).statusCode,
    404,
  );
  f.store.db
    .prepare("DELETE FROM source_grants WHERE profile_id=? AND source_id=?")
    .run(f.p, f.src.id);
  assert.equal((await f.app.inject({ url, headers })).statusCode, 404);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM playback_sessions").get()?.n,
    0,
  );
});

test("management resource links accept stable IDs only and preserve pairing/top-level routes", () => {
  const p = "11111111-1111-4111-8111-111111111111",
    id = "22222222-2222-4222-8222-222222222222";
  for (const kind of ["channel", "collection"] as const)
    assert.deepEqual(readResourceRoute(resourceLink(kind, p, id)), {
      kind,
      profileId: p,
      id,
    });
  for (const hash of [
    `#channels?profile=${p}&channel=../../private`,
    `#library?profile=${p}&collection=${id}&token=secret`,
    `#channels?profile=${p}&channel=${id}&channel=${id}`,
    `#watch?profile=${p}&channel=${id}`,
  ])
    assert.equal(readResourceRoute(hash), "invalid");
  assert.equal(readResourceRoute("#connect-tv?code=012345ABCD"), null);
  assert.equal(readResourceRoute("#channels"), null);
});
