import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { writeSync } from "node:fs";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/database.js";
import { ManagedCache } from "../src/managed-cache.js";
import { OutputPaths } from "../src/output-paths.js";
import { cleanupAssets, validateStorage } from "../src/storage.js";
import { reconcileAssets } from "../src/asset-reconciliation.js";
import {
  assertSafeOutputRoot,
  outputCleanupDisabled,
} from "../src/storage-safety.js";
import { StreamingService } from "../src/streaming.js";
import { PlaybackService } from "../src/playback.js";
import { buildSchedule, noBreaks, persistSchedule } from "../src/scheduler.js";
import { account, channel, media, profile, source } from "./helpers.js";

async function temporary(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "mytuner-reset-storage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
function protect(store: Store) {
  store.db
    .prepare(
      "UPDATE storage_safety_state SET cleanup_disabled=1,reset_ms=123 WHERE id=1",
    )
    .run();
}

test("historical media/subtitle/metadata roots remain protected after source reset and database reopen, including aliases", async (t) => {
  const root = await temporary(t);
  const paths = [
    join(root, "media"),
    join(root, "subtitles"),
    join(root, "metadata"),
  ];
  for (const path of paths) {
    await mkdir(path);
    await writeFile(join(path, "operator.txt"), "untouched");
  }
  const filename = join(root, "app", "mytuner.db");
  let store = new Store(filename);
  t.after(() => store.close());
  const original = source(store, paths[0]!);
  store.db
    .prepare("UPDATE sources SET subtitle_root=?,metadata_root=? WHERE id=?")
    .run(paths[1]!, paths[2]!, original.id);
  for (const path of paths)
    store.db
      .prepare("INSERT INTO protected_source_roots(path) VALUES(?)")
      .run(path);
  protect(store);
  store.db.prepare("DELETE FROM sources").run();
  store.close();
  store = new Store(filename);
  assert.equal(outputCleanupDisabled(store), true);
  const generated = join(root, "generated"),
    cache = join(root, "cache");
  for (const path of paths) {
    await assert.rejects(
      validateStorage(store, [path], generated, cache),
      /overlaps/,
    );
    assert.throws(
      () => new OutputPaths(join(path, "nested"), store).create([]),
      /protected read-only/,
    );
    assert.equal(
      await readFile(join(path, "operator.txt"), "utf8"),
      "untouched",
    );
    assert.deepEqual(await readdir(path), ["operator.txt"]);
  }
  const alias = join(root, "alias");
  await symlink(paths[0]!, alias, "dir");
  assert.throws(
    () => assertSafeOutputRoot(store, join(alias, "outputs")),
    /protected read-only/,
  );
  await validateStorage(
    store,
    [join(root, "app"), generated, cache],
    generated,
    cache,
  );
});

test("post-reset direct generated cleanup and orphan reconciliation never remove previous files or references", async (t) => {
  const root = await temporary(t),
    store = new Store(":memory:");
  t.after(() => store.close());
  const relative = `${randomUUID()}/${"a".repeat(64)}/thumbnail.jpg`;
  await mkdir(join(root, relative, ".."), { recursive: true });
  await writeFile(join(root, relative), "old derivative");
  const partial = `.partial-${randomUUID()}.mp4`;
  await writeFile(join(root, partial), "interrupted previous work");
  await utimes(join(root, partial), new Date(1000), new Date(1000));
  await writeFile(join(root, "operator.txt"), "unknown retained file");
  protect(store);
  const report = await reconcileAssets(store, root, true, undefined, () => {});
  assert.equal(report.orphanFiles, 1);
  assert.equal(report.interruptedFiles, 1);
  await assert.rejects(
    reconcileAssets(store, root, false, report.review, () => {}),
    /permanently disabled/,
  );
  await assert.rejects(
    cleanupAssets(store, root, false),
    /permanently disabled/,
  );
  assert.equal(await readFile(join(root, relative), "utf8"), "old derivative");
  assert.equal(
    await readFile(join(root, partial), "utf8"),
    "interrupted previous work",
  );
  assert.equal(
    await readFile(join(root, "operator.txt"), "utf8"),
    "unknown retained file",
  );
});

test("protected cache retains expired/partial/unknown files and fails quota or replacement while new empty roots remain usable", async (t) => {
  const root = await temporary(t),
    store = new Store(":memory:");
  t.after(() => store.close());
  protect(store);
  const name = "a".repeat(64) + ".json",
    partial = name + "." + randomUUID() + ".partial";
  await writeFile(join(root, name), "previous");
  await writeFile(join(root, partial), "partial");
  await writeFile(join(root, "operator.txt"), "unknown");
  await utimes(join(root, name), new Date(1000), new Date(1000));
  await utimes(join(root, partial), new Date(1000), new Date(1000));
  const before = await stat(join(root, name));
  const cache = new ManagedCache(root, 24, 0, 1000, store);
  assert.equal(await cache.get(name, () => {}), null);
  await assert.rejects(
    cache.publish(name, Buffer.from("replacement"), () => {}),
    /preserved/,
  );
  await assert.rejects(
    cache.publish("b".repeat(64) + ".json", Buffer.alloc(20), () => {}),
    /Insufficient managed cache space/,
  );
  assert.equal(await readFile(join(root, name), "utf8"), "previous");
  assert.equal((await stat(join(root, name))).mtimeMs, before.mtimeMs);
  assert.equal(await readFile(join(root, partial), "utf8"), "partial");
  assert.equal(await readFile(join(root, "operator.txt"), "utf8"), "unknown");
  const fresh = join(root, "fresh");
  const freshCache = new ManagedCache(fresh, 24, 0, 86400000, store);
  await freshCache.publish(name, Buffer.from("new valid cache"), () => {});
  assert.equal(
    (await freshCache.get(name, () => {}))!.toString(),
    "new valid cache",
  );
  assert.deepEqual(await readdir(fresh), [name]);
  assert.equal(outputCleanupDisabled(store), true);
});

test("generated no-replace publication keeps old finals and closes only its own inode-verified temporary", async (t) => {
  const root = await temporary(t),
    store = new Store(":memory:");
  t.after(() => store.close());
  protect(store);
  const outputs = new OutputPaths(root, store);
  const old = outputs.prepare("old.mp4", false);
  await writeFile(old.path, "old content");
  const stage = outputs.stage(`.partial-${randomUUID()}.mp4`);
  writeSync(stage.fd, Buffer.from("replacement"));
  assert.throws(() => outputs.publish(stage, old), /preserved/);
  outputs.close(stage);
  assert.equal(await readFile(old.path, "utf8"), "old content");
  const fresh = outputs.stage(`.partial-${randomUUID()}.mp4`);
  writeSync(fresh.fd, Buffer.from("fresh output"));
  outputs.publish(fresh, outputs.prepare("fresh.mp4", false));
  outputs.close(fresh);
  assert.equal(await readFile(join(root, "fresh.mp4"), "utf8"), "fresh output");
  assert.deepEqual((await readdir(root)).sort(), ["fresh.mp4", "old.mp4"]);
  const switched = outputs.stage(`.partial-${randomUUID()}.mp4`);
  await rm(switched.path);
  await writeFile(switched.path, "operator replacement");
  outputs.close(switched);
  assert.equal(await readFile(switched.path, "utf8"), "operator replacement");
});

test("protected HLS cleanup skips old cache, conversion counts retained bytes, and fresh-root publication stays bounded", async (t) => {
  const root = await temporary(t),
    store = new Store(":memory:");
  t.after(() => store.close());
  const mediaRoot = join(root, "media"),
    cache = join(root, "cache");
  await mkdir(mediaRoot);
  await mkdir(cache);
  await writeFile(join(mediaRoot, "clip.mp4"), Buffer.alloc(10));
  const src = source(store, await realpath(mediaRoot)),
    item = media(store, src.id, "clip.mp4", 120000),
    info = await stat(join(mediaRoot, "clip.mp4"));
  store.db
    .prepare("UPDATE media SET mtime_ms=?,metadata_json=? WHERE id=?")
    .run(
      info.mtimeMs,
      JSON.stringify({
        technical: {
          format: "mp4",
          streams: [
            { index: 0, type: "video", codec: "h264" },
            { index: 1, type: "audio", codec: "aac", default: true },
          ],
        },
      }),
      item.id,
    );
  const owner = account(store, "admin"),
    p = profile(store, owner),
    ch = channel(store, owner),
    now = Date.now();
  const schedule = buildSchedule({
    channelId: ch.id,
    startMs: now - 100,
    untilMs: now + 4000,
    groups: [
      {
        id: "one",
        mode: "ordered",
        clips: [{ id: item.id, durationMs: item.duration_ms }],
      },
    ],
    commercials: [],
    rules: noBreaks,
  });
  persistSchedule(store, ch.id, schedule.entries, schedule.state);
  const playback = new PlaybackService(store),
    session = playback.join(owner, p, ch.id, now),
    entry = session.playback!.entry;
  const name = "c".repeat(64) + ".ts";
  await writeFile(join(cache, name), "previous HLS");
  await utimes(join(cache, name), new Date(1000), new Date(1000));
  protect(store);
  let executions = 0;
  const execute = async (
    _args: string[],
    _signal: AbortSignal,
    output?: { fd: number; format: string },
  ) => {
    executions++;
    writeSync(output!.fd, Buffer.from("synthetic normalized bytes"));
  };
  const full = new StreamingService(
    store,
    playback,
    cache,
    16 * 1024 * 1024,
    execute,
  );
  t.after(() => full.stop());
  await full.cleanup(Date.now() + 86400000);
  assert.equal(await readFile(join(cache, name), "utf8"), "previous HLS");
  await assert.rejects(
    full.segment(
      () => owner,
      session.id,
      entry.id,
      entry.startMs,
      undefined,
      now,
    ),
    /Preserved playback cache is full/,
  );
  assert.equal(executions, 0);
  const fresh = join(root, "fresh-hls"),
    service = new StreamingService(
      store,
      playback,
      fresh,
      16 * 1024 * 1024,
      execute,
    );
  t.after(() => service.stop());
  assert.equal(
    (
      await service.segment(
        () => owner,
        session.id,
        entry.id,
        entry.startMs,
        undefined,
        now,
      )
    ).toString(),
    "synthetic normalized bytes",
  );
  assert.equal(executions, 1);
  assert.equal((await readdir(fresh)).length, 1);
  assert.equal(await readFile(join(cache, name), "utf8"), "previous HLS");
});

test("pre-migration validation preserves legacy behavior but current missing or invalid policy fails closed", () => {
  const old = new DatabaseSync(":memory:");
  try {
    old.exec(
      "PRAGMA user_version=20; CREATE TABLE sources(root_path TEXT,metadata_root TEXT,subtitle_root TEXT)",
    );
    assert.equal(outputCleanupDisabled({ db: old }), false);
  } finally {
    old.close();
  }
  const store = new Store(":memory:");
  try {
    store.db.exec("DELETE FROM storage_safety_state");
    assert.throws(() => outputCleanupDisabled(store), /invalid/);
    store.db.exec("DROP TABLE protected_source_roots");
    assert.throws(() => outputCleanupDisabled(store), /unavailable/);
  } finally {
    store.close();
  }
});

test("uncertain damaged-restore policy blocks every output writer while direct read-only delivery stays available", async (t) => {
  const { GenerationRunner } = await import("../src/generation.js"),
    { ArtworkService } = await import("../src/artwork.js"),
    { SubtitleService } = await import("../src/subtitles.js"),
    { seal } = await import("../src/refresh.js");
  const root = await temporary(t),
    store = new Store(":memory:");
  t.after(() => store.close());
  const mediaRoot = join(root, "media");
  await mkdir(mediaRoot);
  await writeFile(join(mediaRoot, "clip.mp4"), Buffer.alloc(10));
  const src = source(store, await realpath(mediaRoot)),
    item = media(store, src.id, "clip.mp4", 120000),
    info = await stat(join(mediaRoot, "clip.mp4"));
  const metadata = {
    images: [{ url: "/MediaCover/1/poster.jpg" }],
    technical: {
      format: "mp4",
      streams: [
        { index: 0, type: "video", codec: "h264" },
        { index: 1, type: "audio", codec: "aac", default: true },
        { index: 2, type: "subtitle", codec: "subrip" },
      ],
    },
  };
  store.db
    .prepare("UPDATE media SET mtime_ms=?,metadata_json=? WHERE id=?")
    .run(info.mtimeMs, JSON.stringify(metadata), item.id);
  const current = store.db
    .prepare("SELECT * FROM media WHERE id=?")
    .get(item.id) as unknown as typeof item;
  const key = Buffer.alloc(32, 7);
  store.db
    .prepare(
      "INSERT INTO integrations(id,source_id,provider,url,encrypted_key,mappings_json) VALUES(?,?,'sonarr','http://127.0.0.1:8989',?,'[]')",
    )
    .run(randomUUID(), src.id, seal(key, "synthetic"));
  protect(store);
  store.db
    .prepare(
      "UPDATE storage_safety_state SET output_writes_disabled=1 WHERE id=1",
    )
    .run();
  const owner = account(store, "admin"),
    p = profile(store, owner),
    ch = channel(store, owner),
    now = Date.now();
  const schedule = buildSchedule({
    channelId: ch.id,
    startMs: now - 100,
    untilMs: now + 4000,
    groups: [
      {
        id: "one",
        mode: "ordered",
        clips: [{ id: item.id, durationMs: item.duration_ms }],
      },
    ],
    commercials: [],
    rules: noBreaks,
  });
  persistSchedule(store, ch.id, schedule.entries, schedule.state);
  const playback = new PlaybackService(store),
    session = playback.join(owner, p, ch.id, now),
    streaming = new StreamingService(store, playback, join(root, "hls"));
  t.after(() => streaming.stop());
  assert.equal(
    (
      await streaming.negotiate(
        owner,
        session.id,
        { containers: ["mp4"], videoCodecs: ["h264"], audioCodecs: ["aac"] },
        now,
      )
    ).mode,
    "direct",
  );
  await assert.rejects(
    streaming.segment(
      () => owner,
      session.id,
      session.playback!.entry.id,
      session.playback!.entry.startMs,
      undefined,
      now,
    ),
    /Output writes are blocked/,
  );
  let encodes = 0,
    fetches = 0;
  const generation = new GenerationRunner(
    store,
    join(root, "generated"),
    async () => {
      encodes++;
    },
  );
  t.after(() => generation.stop());
  await assert.rejects(
    generation.enqueue({
      sourceId: src.id,
      directory: "",
      recursive: true,
      kinds: ["thumbnail"],
      regenerate: false,
    }),
    /Output writes are blocked/,
  );
  const subtitles = new SubtitleService(
    join(root, "subtitles-output"),
    async () => {
      encodes++;
    },
    undefined,
    store,
  );
  t.after(() => subtitles.stop());
  await assert.rejects(
    subtitles.get(src, current, 2, () => {}),
    /Output writes are blocked/,
  );
  const artwork = new ArtworkService(
    store,
    join(root, "artwork-output"),
    key,
    async () => {
      fetches++;
      throw Error("must not fetch");
    },
  );
  t.after(() => artwork.stop());
  await assert.rejects(artwork.get(current, 0), /Output writes are blocked/);
  assert.equal(encodes, 0);
  assert.equal(fetches, 0);
  for (const path of ["hls", "generated", "subtitles-output", "artwork-output"])
    await assert.rejects(stat(join(root, path)), { code: "ENOENT" });
  assert.deepEqual(
    await readFile(join(mediaRoot, "clip.mp4")),
    Buffer.alloc(10),
  );
});
