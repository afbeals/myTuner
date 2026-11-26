import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/database.js";
import { account, profile, source, media } from "./helpers.js";
import { browseLibrary, selectMedia } from "../src/library.js";
import { browseLibraryPage } from "../src/library-page.js";
import {
  createMediaProjector,
  displayMedia,
  inspectMetadata,
  saveMetadata,
} from "../src/display-metadata.js";

test("large library pages are bounded, stable and permission-filtered before counts", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const owner = account(store),
    p = profile(store, owner),
    visible = source(store, "/visible"),
    hidden = source(store, "/hidden");
  store.db
    .prepare(
      "INSERT INTO source_grants(profile_id,source_id,subtree) VALUES(?,?,'')",
    )
    .run(p, visible.id);
  store.transaction(() => {
    for (let i = 0; i < 300; i++)
      media(
        store,
        visible.id,
        `Folder ${String(i).padStart(4, "0")}/video.mp4`,
      );
    for (let i = 0; i < 12; i++)
      media(store, hidden.id, `Secret ${i}/video.mp4`);
  });
  const read = (offset: number) =>
    browseLibraryPage(store, owner, p, {
      search: "",
      kind: "all",
      offset,
      limit: 24,
    });
  const a = read(0),
    b = read(24);
  assert.equal(a.pagination.total, 301);
  assert.equal(a.folders.length, 24);
  assert.equal(b.folders.length, 24);
  assert.equal(
    new Set([...a.folders, ...b.folders].map((f) => f.directory)).size,
    48,
  );
  assert.equal(a.sources.length, 1);
  assert.doesNotMatch(JSON.stringify(a), /Secret/);
  store.db.prepare("DELETE FROM source_grants WHERE profile_id=?").run(p);
  const revoked = read(0);
  assert.equal(revoked.pagination.total, 0);
  assert.equal(revoked.sources.length, 0);
});
test("cached library projections invalidate after metadata changes and preserve filename search grouping", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const owner = account(store, "admin"),
    p = profile(store, owner),
    src = source(store, "/tv", "shows");
  const one = media(store, src.id, "Series/episode-one.mp4"),
    two = media(store, src.id, "Series/episode-two.mp4");
  for (const item of [one, two])
    store.db.prepare("UPDATE media SET metadata_json=? WHERE id=?").run(
      JSON.stringify({
        seriesTitle: "Series",
        seasonNumber: 1,
        episodeNumber: item.id === one.id ? 1 : 2,
      }),
      item.id,
    );
  const first = browseLibrary(store, owner, p);
  assert.equal(first.shows[0]!.seasons[0]!.available, 2);
  const searched = browseLibraryPage(store, owner, p, {
    search: "episode-one",
    kind: "shows",
    offset: 0,
    limit: 24,
  });
  assert.equal(searched.shows[0]!.seasons[0]!.available, 2);
  store.db.prepare("UPDATE media SET available=0 WHERE id=?").run(two.id);
  assert.equal(
    browseLibrary(store, owner, p).shows[0]!.seasons[0]!.available,
    1,
  );
});
test("batch metadata display matches individual resolution, including durable manual choices, with constant lookup count", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const owner = account(store, "admin"),
    p = profile(store, owner),
    src = source(store, "/tv", "shows");
  store.transaction(() => {
    for (let i = 0; i < 500; i++) {
      const m = media(store, src.id, `Series/Season 1/S01E${i + 1}.mp4`);
      store.db.prepare("UPDATE media SET metadata_json=? WHERE id=?").run(
        JSON.stringify({
          seriesTitle: "Series",
          seasonNumber: 1,
          episodeNumber: i + 1,
        }),
        m.id,
      );
    }
  });
  const rows = store.db
    .prepare("SELECT * FROM media ORDER BY relative_path")
    .all() as unknown as import("../src/domain.js").Media[];
  const target = { kind: "media" as const, mediaId: rows[0]!.id },
    before = inspectMetadata(store, target);
  await saveMetadata(store, owner, p, target, before.revision, {
    title: { source: "manual", manual: "Custom title" },
    description: { source: "manual", manual: "Custom description" },
  });
  const expected = rows.slice(0, 2).map((m) => displayMedia(store, m));
  const original = store.db.prepare.bind(store.db);
  let queries = 0;
  store.db.prepare = ((...args: Parameters<typeof original>) => {
    queries++;
    return original(...args);
  }) as typeof store.db.prepare;
  const project = createMediaProjector(store),
    projected = rows.map(project);
  assert.deepEqual(projected.slice(0, 2), expected);
  assert.ok(queries < 15, `Expected bounded lookups, got ${queries}`);
  assert.equal(projected.length, 500);
});
test("two folder channels can resolve independent subtrees of a single custom source", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const owner = account(store, "admin"),
    p = profile(store, owner),
    src = source(store);
  const a = media(store, src.id, "Category A/Nested/one.mp4"),
    b = media(store, src.id, "Category B/two.mp4");
  assert.ok(
    browseLibrary(store, owner, p).folders.some(
      (f) => f.directory === "Category A" && f.available === 1,
    ),
  );
  assert.deepEqual(
    selectMedia(store, owner, p, {
      type: "folder",
      sourceId: src.id,
      directory: "Category A",
      recursive: true,
    }).map((m) => m.id),
    [a.id],
  );
  assert.deepEqual(
    selectMedia(store, owner, p, {
      type: "folder",
      sourceId: src.id,
      directory: "Category B",
      recursive: true,
    }).map((m) => m.id),
    [b.id],
  );
});

test(
  "real blocked ffprobe processes abort promptly instead of waiting for the 30-second inspection limit",
  { skip: process.platform === "win32", timeout: 5000 },
  async (t) => {
    const { mkdtemp, rm } = await import("node:fs/promises"),
      { join } = await import("node:path"),
      { tmpdir } = await import("node:os"),
      { execFile } = await import("node:child_process"),
      { promisify } = await import("node:util"),
      { probeMedia } = await import("../src/catalog.js");
    const root = await mkdtemp(join(tmpdir(), "mytuner-probe-cancel-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const fifo = join(root, "synthetic-input");
    await promisify(execFile)("mkfifo", [fifo]);
    const controller = new AbortController(),
      started = Date.now(),
      pending = probeMedia(fifo, controller.signal);
    const timer = setTimeout(() => controller.abort(), 100);
    try {
      await assert.rejects(
        pending,
        (error) => error instanceof Error && error.name === "AbortError",
      );
      assert.ok(Date.now() - started < 3000);
    } finally {
      clearTimeout(timer);
    }
  },
);
