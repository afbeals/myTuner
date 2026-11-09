import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  rm,
  readFile,
  writeFile,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import { Store } from "../src/database.js";
import { addSource, scanSource, probeMedia } from "../src/catalog.js";
import { PlaybackService } from "../src/playback.js";
import { runFFmpeg } from "../src/generation.js";
import { SubtitleService } from "../src/subtitles.js";
import { StreamingService } from "../src/streaming.js";
import { buildSchedule, noBreaks, persistSchedule } from "../src/scheduler.js";
import { account, profile, channel } from "./helpers.js";
import type { Media } from "../src/domain.js";
const execute = promisify(execFile);
async function fixture(t: { after: (fn: () => unknown) => void }) {
  const root = await mkdtemp(join(tmpdir(), "mytuner-hls-")),
    store = new Store(":memory:"),
    owner = account(store),
    p = profile(store, owner),
    ch = channel(store, owner);
  await mkdir(join(root, "media"));
  await writeFile(
    join(root, "captions.srt"),
    "1\n00:00:00,500 --> 00:00:01,500\nSynthetic caption\n",
  );
  await execute("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x90:rate=30",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-i",
    join(root, "captions.srt"),
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-map",
    "2:s:0",
    "-c:s",
    "mov_text",
    "-t",
    "4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    join(root, "media", "Test.S01E02.mp4"),
  ]);
  await writeFile(
    join(root, "media", "Test.S01E02.nfo"),
    "<episodedetails><title>NFO episode</title><showtitle>Local show</showtitle><season>1</season><episode>2</episode><plot>Read only</plot></episodedetails>",
  );
  const src = await addSource(
    store,
    {
      name: "Shows",
      root: join(root, "media"),
      kind: "shows",
      recursive: true,
    },
    [join(root, "cache")],
  );
  await scanSource(store, src);
  const item = store.db
    .prepare("SELECT * FROM media")
    .get() as unknown as Media;
  store.db.prepare("INSERT INTO source_grants VALUES(?,?,'')").run(p, src.id);
  const now = Date.now(),
    schedule = buildSchedule({
      channelId: ch.id,
      startMs: now - 100,
      untilMs: now + 20000,
      groups: [
        {
          id: "program",
          mode: "ordered",
          clips: [{ id: item.id, durationMs: item.duration_ms }],
        },
      ],
      commercials: [{ id: item.id, durationMs: 500 }],
      rules: {
        ...noBreaks,
        positions: [{ kind: "timestamp", value: 2000 }],
        maxClips: 1,
        maxDurationMs: 500,
      },
    });
  persistSchedule(store, ch.id, schedule.entries, schedule.state);
  const playback = new PlaybackService(store),
    session = playback.join(owner, p, ch.id, now),
    streaming = new StreamingService(store, playback, join(root, "cache"));
  t.after(async () => {
    await streaming.stop();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    store,
    owner,
    p,
    ch,
    src,
    item,
    now,
    playback,
    session,
    streaming,
  };
}
test("real media inspection, NFO metadata, normalized HLS before/after a commercial, and source hashes", async (t) => {
  const f = await fixture(t),
    metadata = JSON.parse(f.item.metadata_json),
    input = join(f.root, "media", "Test.S01E02.mp4"),
    hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex"),
    before = hash(await readFile(input));
  assert.equal(f.item.title, "NFO episode");
  assert.equal(metadata.seasonNumber, 1);
  assert.equal(
    metadata.technical.streams.find((s: { type: string }) => s.type === "audio")
      .codec,
    "aac",
  );
  const direct = await f.streaming.negotiate(f.owner, f.session.id, {
    containers: ["mp4"],
    videoCodecs: ["h264"],
    audioCodecs: ["aac"],
  });
  assert.equal(direct.mode, "direct");
  assert.equal(
    (
      await f.streaming.negotiate(f.owner, f.session.id, {
        containers: [],
        videoCodecs: [],
        audioCodecs: [],
      })
    ).mode,
    "hls",
  );
  const manifest = f.streaming.manifest(f.owner, f.session.id);
  assert.match(manifest, /#EXTM3U/);
  assert.match(manifest, /#EXT-X-DISCONTINUITY/);
  assert.doesNotMatch(manifest, /token|authorization|\/media\//i);
  const entries = f.store.db
    .prepare(
      "SELECT * FROM schedule_entries WHERE revision_id=? ORDER BY start_ms LIMIT 3",
    )
    .all(f.session.revisionId) as {
    id: string;
    start_ms: number;
    offset_ms: number;
    kind: string;
  }[];
  assert.deepEqual(
    entries.map((e) => e.kind),
    ["program", "commercial", "program"],
  );
  assert.equal(entries[2]!.offset_ms, 2000);
  for (const [i, e] of entries.entries()) {
    const bytes = await f.streaming.segment(
      () => f.owner,
      f.session.id,
      e.id,
      e.start_ms,
    );
    assert.equal(bytes[0], 0x47);
    const path = join(f.root, `segment-${i}.ts`);
    await writeFile(path, bytes);
    const inspected = await probeMedia(path);
    assert.equal(
      inspected.streams.find((s) => s.type === "video")?.codec,
      "h264",
    );
    assert.equal(
      inspected.streams.find((s) => s.type === "audio")?.codec,
      "aac",
    );
    assert.ok(inspected.durationMs < 4500);
  }
  assert.equal(hash(await readFile(input)), before);
  f.store.db.prepare("DELETE FROM source_grants WHERE profile_id=?").run(f.p);
  await assert.rejects(
    f.streaming.segment(
      () => f.owner,
      f.session.id,
      entries[0]!.id,
      entries[0]!.start_ms,
    ),
    /not found/,
  );
});
test("delivery events are idempotent and overlapping intervals do not inflate delivery totals", async (t) => {
  const f = await fixture(t),
    entry = f.session.playback!.entry,
    start = entry.startMs;
  const first = {
    id: randomUUID(),
    entryId: entry.id,
    startMs: start,
    endMs: start + 50,
  };
  f.playback.record(f.owner, f.session.id, first, f.now + 1000);
  f.playback.record(f.owner, f.session.id, first, f.now + 1000);
  f.playback.record(
    f.owner,
    f.session.id,
    { ...first, id: randomUUID(), startMs: start + 20, endMs: start + 80 },
    f.now + 1000,
  );
  assert.deepEqual(f.playback.history(f.owner, f.session.id), {
    deliveredMs: 80,
    eventCount: 2,
  });
  assert.throws(
    () =>
      f.playback.record(
        f.owner,
        f.session.id,
        { ...first, endMs: start + 90 },
        f.now + 1000,
      ),
    /already used/,
  );
  assert.throws(
    () =>
      f.playback.record(
        f.owner,
        f.session.id,
        { ...first, id: randomUUID(), endMs: start + 90000 },
        f.now + 1000,
      ),
    /Invalid delivered/,
  );
});

test("text subtitles are extracted as source-time WebVTT, cached, and reauthorized", async (t) => {
  const f = await fixture(t),
    service = new SubtitleService(join(f.root, "subtitle-cache"));
  t.after(() => service.stop());
  const tracks = JSON.parse(f.item.metadata_json).technical.streams as {
      type: string;
      index: number;
    }[],
    track = tracks.find((s) => s.type === "subtitle")!;
  let allowed = true;
  const authorize = () => assert.ok(allowed, "revoked");
  const bytes = await service.get(f.src, f.item, track.index, authorize);
  assert.match(bytes.toString(), /WEBVTT/);
  assert.match(bytes.toString(), /Synthetic caption/);
  assert.deepEqual(
    await service.get(f.src, f.item, track.index, authorize),
    bytes,
  );
  allowed = false;
  await assert.rejects(
    service.get(f.src, f.item, track.index, authorize),
    /revoked/,
  );
});

test("idle playlists launch no encoder and concurrent requests share normalized VP9/silent-source conversion", async (t) => {
  const f = await fixture(t);
  await execute("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x90:rate=15",
    "-t",
    "1",
    "-c:v",
    "libvpx-vp9",
    "-threads",
    "2",
    "-an",
    join(f.root, "media", "Silent.webm"),
  ]);
  await scanSource(f.store, f.src);
  const item = f.store.db
      .prepare("SELECT * FROM media WHERE relative_path='Silent.webm'")
      .get() as unknown as Media,
    ch = channel(f.store, f.owner),
    now = Date.now(),
    built = buildSchedule({
      channelId: ch.id,
      startMs: now - 100,
      untilMs: now + 3000,
      groups: [
        {
          id: "silent",
          mode: "ordered",
          clips: [{ id: item.id, durationMs: item.duration_ms }],
        },
      ],
      rules: noBreaks,
      commercials: [],
    });
  persistSchedule(f.store, ch.id, built.entries, built.state);
  const session = f.playback.join(f.owner, f.p, ch.id, now);
  let calls = 0;
  const streaming = new StreamingService(
    f.store,
    f.playback,
    join(f.root, "silent-cache"),
    512 * 1024 * 1024,
    async (args, signal) => {
      calls++;
      await runFFmpeg(args, signal);
    },
  );
  t.after(() => streaming.stop());
  streaming.manifest(f.owner, session.id);
  assert.equal(calls, 0);
  const entry = session.playback!.entry,
    [first, second] = await Promise.all([
      streaming.segment(() => f.owner, session.id, entry.id, entry.startMs),
      streaming.segment(() => f.owner, session.id, entry.id, entry.startMs),
    ]);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(
    await streaming.segment(() => f.owner, session.id, entry.id, entry.startMs),
    first,
  );
  assert.equal(calls, 1);
  const output = join(f.root, "silent-normalized.ts");
  await writeFile(output, first);
  const inspected = await probeMedia(output);
  assert.equal(
    inspected.streams.find((s) => s.type === "video")?.codec,
    "h264",
  );
  assert.equal(inspected.streams.find((s) => s.type === "audio")?.codec, "aac");
});

test("selected HLS audio survives manifest segment URLs and absent tracks fall back safely", async (t) => {
  const f = await fixture(t);
  const manifest = f.streaming.manifest(f.owner, f.session.id, Date.now(), 1);
  assert.match(manifest, /\.ts\?audioTrack=1/);
  assert.doesNotMatch(
    f.streaming.manifest(f.owner, f.session.id, Date.now(), 999),
    /audioTrack/,
  );
  assert.doesNotMatch(
    f.streaming.manifest(f.owner, f.session.id),
    /audioTrack/,
  );
});

test("a shortened commercial negotiates bounded HLS even on a direct-capable client and leaves the source untouched", async (t) => {
  const f = await fixture(t),
    input = join(f.root, "media", "Test.S01E02.mp4"),
    before = createHash("sha256")
      .update(await readFile(input))
      .digest("hex"),
    ch = channel(f.store, f.owner),
    start = Date.now() - 100,
    schedule = buildSchedule({
      channelId: ch.id,
      startMs: start,
      untilMs: start + 1,
      groups: [
        {
          id: "show",
          mode: "ordered",
          clips: [{ id: f.item.id, durationMs: f.item.duration_ms }],
        },
      ],
      commercials: [{ id: f.item.id, durationMs: f.item.duration_ms }],
      rules: {
        ...noBreaks,
        positions: [{ kind: "timestamp", value: 2000 }],
        maxClips: 1,
        maxDurationMs: 1000,
        overflowPolicy: "truncate",
        minRemainingMs: 0,
      },
    });
  persistSchedule(f.store, ch.id, schedule.entries, schedule.state);
  const ad = schedule.entries[1]!,
    after = schedule.entries[2]!,
    session = f.playback.join(f.owner, f.p, ch.id, ad.startMs),
    capabilities = {
      containers: ["mp4"],
      videoCodecs: ["h264"],
      audioCodecs: ["aac"],
    };
  assert.equal(ad.endMs - ad.startMs, 1000);
  assert.equal(
    (await f.streaming.negotiate(f.owner, session.id, capabilities, ad.startMs))
      .mode,
    "hls",
  );
  const manifest = f.streaming.manifest(f.owner, session.id, ad.startMs);
  assert.ok(manifest.includes(`#EXTINF:1.000,\n${ad.id}/${ad.startMs}.ts`));
  const bytes = await f.streaming.segment(
      () => f.owner,
      session.id,
      ad.id,
      ad.startMs,
      undefined,
      ad.startMs,
    ),
    output = join(f.root, "cutoff.ts");
  await writeFile(output, bytes);
  const inspected = await probeMedia(output);
  assert.ok(
    inspected.durationMs >= 950 && inspected.durationMs <= 1150,
    `Encoded duration ${inspected.durationMs}ms exceeds frame/audio padding tolerance`,
  );
  const resumed = f.playback.describe(f.owner, session.id, ad.endMs);
  assert.equal(resumed.playback?.entry.id, after.id);
  assert.equal(resumed.playback?.offsetMs, 2000);
  assert.equal(
    (await f.streaming.negotiate(f.owner, session.id, capabilities, ad.endMs))
      .mode,
    "direct",
  );
  await assert.rejects(
    f.streaming.segment(
      () => f.owner,
      session.id,
      ad.id,
      ad.endMs,
      undefined,
      ad.startMs,
    ),
    /unavailable/,
  );
  assert.equal(
    createHash("sha256")
      .update(await readFile(input))
      .digest("hex"),
    before,
  );
});

test("concurrent cache eviction and segment conversion complete without losing playback", async (t) => {
  const f = await fixture(t),
    root = join(f.root, "cache");
  await mkdir(root, { recursive: true });
  for (let i = 0; i < 50; i++)
    await writeFile(
      join(root, i.toString(16).padStart(64, "0") + ".ts"),
      "expired",
    );
  const entry = f.session.playback!.entry;
  const results = await Promise.all([
    f.streaming.cleanup(Date.now() + 11 * 60000),
    f.streaming.cleanup(Date.now() + 11 * 60000),
    f.streaming.segment(() => f.owner, f.session.id, entry.id, entry.startMs),
  ]);
  assert.equal(results[2][0], 0x47);
});

test("stop drains segment setup and prevents conversion admission after filesystem awaits", async (t) => {
  const f = await fixture(t);
  let executions = 0;
  const streaming = new StreamingService(
    f.store,
    f.playback,
    join(f.root, "shutdown-cache"),
    512 * 1024 * 1024,
    async () => {
      executions++;
    },
  );
  const entry = f.session.playback!.entry;
  const pending = streaming.segment(
    () => f.owner,
    f.session.id,
    entry.id,
    entry.startMs,
    undefined,
    f.now,
  );
  const rejected = assert.rejects(pending, /stopping/);
  await streaming.stop();
  await rejected;
  assert.equal(executions, 0);
  await assert.rejects(
    streaming.segment(
      () => f.owner,
      f.session.id,
      entry.id,
      entry.startMs,
      undefined,
      f.now,
    ),
    /stopping/,
  );
});

test("subtitle stop drains pending setup without starting an encoder or publishing cache", async (t) => {
  const f = await fixture(t),
    cache = join(f.root, "stop-subtitles");
  const before = await readFile(join(f.root, "media", "Test.S01E02.mp4"));
  let starts = 0;
  const service = new SubtitleService(cache, async () => {
    starts++;
    throw Error("must not encode");
  });
  const track = JSON.parse(f.item.metadata_json).technical.streams.find(
    (s: { type: string }) => s.type === "subtitle",
  );
  const request = service.get(f.src, f.item, track.index, () => {});
  const rejected = assert.rejects(request, /stopping/);
  await service.stop();
  await rejected;
  assert.equal(starts, 0);
  assert.deepEqual(await readdir(cache).catch(() => []), []);
  assert.deepEqual(
    await readFile(join(f.root, "media", "Test.S01E02.mp4")),
    before,
  );
  await assert.rejects(
    service.get(f.src, f.item, track.index, () => {}),
    /stopping/,
  );
});

test("subtitle stop aborts and drains an already active extraction", async (t) => {
  const f = await fixture(t),
    cache = join(f.root, "active-subtitles");
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const service = new SubtitleService(cache, async (_args, signal) => {
    started();
    await new Promise<void>((_resolve, reject) => {
      if (signal?.aborted) reject(signal.reason);
      else
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
    });
  });
  const track = JSON.parse(f.item.metadata_json).technical.streams.find(
    (s: { type: string }) => s.type === "subtitle",
  );
  const request = service.get(f.src, f.item, track.index, () => {}),
    rejected = assert.rejects(request);
  await ready;
  await service.stop();
  await rejected;
  assert.deepEqual(await readdir(cache), []);
});
