import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/database.js";
import { account, profile, source, media } from "./helpers.js";
import { browseLibrary, selectMedia, saveCollection } from "../src/library.js";
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

test("main library hides nested folder and fallback-show cards before paging without changing selection or stored data", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const owner = account(store),
    p = profile(store, owner),
    tv = source(store, "/synthetic-tv", "shows"),
    custom = source(store, "/synthetic-custom"),
    movieSource = source(store, "/synthetic-films", "movies"),
    hidden = source(store, "/synthetic-hidden", "shows");
  for (const src of [tv, custom, movieSource])
    store.db.prepare("INSERT INTO source_grants VALUES(?,?,'')").run(p, src.id);
  const episodes = [
    media(store, tv.id, "Orbit/Season 1/one.mp4"),
    media(store, tv.id, "Orbit/Season 2/two.mp4"),
  ];
  for (const [i, item] of episodes.entries())
    store.db.prepare("UPDATE media SET metadata_json=? WHERE id=?").run(
      JSON.stringify({
        seriesId: 7,
        seriesTitle: "Orbit",
        seasonNumber: i + 1,
        episodeNumber: 1,
      }),
      item.id,
    );
  media(store, tv.id, "Orbit/Featurettes/interview.mp4");
  media(store, tv.id, "Orbit/Featurettes/Behind the scenes/making-of.mp4");
  media(store, tv.id, "Orbit/untagged.mp4");
  const local = media(store, tv.id, "Local Show/Season 1/episode.mp4");
  media(store, tv.id, "Local Show/Featurettes/interview.mp4");
  media(store, tv.id, "Orbiting/Season 1/episode.mp4");
  media(store, hidden.id, "Private Show/Season 1/private.mp4");
  media(store, custom.id, "Family/Trips/Featurettes/clip.mp4");
  media(store, custom.id, "Lessons/Featurettes/clip.mp4");
  const rootVideo = media(store, custom.id, "loose.mp4"),
    film = media(store, movieSource.id, "Film/main.mp4");
  store.db
    .prepare("UPDATE media SET metadata_json=? WHERE id=?")
    .run(
      JSON.stringify({ collection: { title: "Film set", tmdbId: 99 } }),
      film.id,
    );
  const saved = saveCollection(store, owner, p, "Saved clips", [
    local.id,
    rootVideo.id,
  ]);
  const shape = {
    search: "",
    titleOnly: true,
    kind: "all",
    offset: 0,
    limit: 100,
  };
  const raw = browseLibraryPage(store, owner, p, shape);
  assert.ok(
    raw.folders.some((folder) => folder.directory.includes("Featurettes")),
  );
  assert.ok(raw.shows.some((show) => show.key === "folder:Orbit/Featurettes"));
  const before = store.db.prepare("SELECT total_changes() AS n").get()!.n;
  const page = browseLibraryPage(store, owner, p, { ...shape, topLevel: true });
  assert.deepEqual(
    page.shows.map((show) => show.key).sort(),
    ["series:7", "folder:Local Show", "folder:Orbiting"].sort(),
  );
  assert.deepEqual(
    page.folders.map((folder) => [folder.sourceId, folder.directory]).sort(),
    [
      [custom.id, ""],
      [custom.id, "Family"],
      [custom.id, "Lessons"],
    ].sort(),
  );
  assert.equal(
    page.folders.find(
      (folder) => folder.sourceId === custom.id && folder.directory === "",
    )!.available,
    3,
  );
  assert.deepEqual(
    page.movies.map((movie) => movie.id),
    [film.id],
  );
  assert.deepEqual(
    page.movieCollections.map((collection) => collection.title),
    ["Film set"],
  );
  assert.deepEqual(
    page.savedCollections.map((collection) => collection.id),
    [saved.id],
  );
  assert.equal(page.pagination.total, 9);
  assert.doesNotMatch(JSON.stringify(page), /Private Show|Featurettes/);
  const selected = selectMedia(store, owner, p, {
    type: "show",
    sourceId: tv.id,
    key: "series:7",
    includeSpecials: false,
  });
  assert.deepEqual(
    selected.map((item) => item.id).sort(),
    episodes.map((item) => item.id).sort(),
  );
  assert.equal(
    selectMedia(store, owner, p, {
      type: "folder",
      sourceId: custom.id,
      directory: "Family",
      recursive: true,
    }).length,
    1,
  );
  assert.equal(
    selectMedia(store, owner, p, {
      type: "folder",
      sourceId: tv.id,
      directory: "Orbit/Featurettes",
      recursive: true,
    }).length,
    2,
  );
  const search = browseLibraryPage(store, owner, p, {
    ...shape,
    topLevel: true,
    search: "Featurettes",
  });
  assert.equal(search.pagination.total, 0);
  assert.equal(
    browseLibraryPage(store, owner, p, {
      ...shape,
      topLevel: true,
      kind: "shows",
    }).pagination.total,
    3,
  );
  assert.equal(
    browseLibraryPage(store, owner, p, {
      ...shape,
      topLevel: true,
      sourceId: tv.id,
    }).pagination.total,
    3,
  );
  assert.equal(
    store.db.prepare("SELECT total_changes() AS n").get()!.n,
    before,
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(browseLibraryPage(store, owner, p, shape))),
    JSON.parse(JSON.stringify(raw)),
  );
});

test("top-level pages count parent cards rather than hidden descendants and preserve same-named folders across sources", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const owner = account(store),
    p = profile(store, owner),
    first = source(store, "/one"),
    second = source(store, "/two");
  for (const src of [first, second])
    store.db.prepare("INSERT INTO source_grants VALUES(?,?,'')").run(p, src.id);
  for (let i = 0; i < 30; i++) {
    const folder = `Show ${String(i).padStart(2, "0")}`;
    media(store, first.id, `${folder}/Season 1/video.mp4`);
    media(store, first.id, `${folder}/Featurettes/interview.mp4`);
  }
  media(store, second.id, "Show 00/Featurettes/second.mp4");
  const input = {
    search: "",
    kind: "videos",
    topLevel: true,
    offset: 0,
    limit: 24,
  };
  const a = browseLibraryPage(store, owner, p, input),
    b = browseLibraryPage(store, owner, p, { ...input, offset: 24 });
  assert.equal(a.pagination.total, 31);
  assert.equal(b.pagination.total, 31);
  assert.equal(a.folders.length, 24);
  assert.equal(b.folders.length, 7);
  const folders = [...a.folders, ...b.folders];
  assert.equal(
    new Set(folders.map((folder) => `${folder.sourceId}:${folder.directory}`))
      .size,
    31,
  );
  assert.equal(
    folders.filter((folder) => folder.directory === "Show 00").length,
    2,
  );
  assert.ok(folders.every((folder) => !folder.directory.includes("/")));
  assert.ok(
    folders
      .filter((folder) => folder.sourceId === first.id)
      .every((folder) => folder.available === 2),
  );
});

test("admin profile library hides ungranted sources by default scope and annotates inspection without granting access", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const admin = account(store, "admin"),
    editor = account(store),
    p = profile(store, editor),
    tv = source(store, "/scoped-tv", "shows"),
    other = source(store, "/scoped-other", "shows");
  const granted = media(store, tv.id, "Show/Season 1/one.mp4"),
    restricted = media(store, tv.id, "Show/Season 2/two.mp4"),
    outside = media(store, other.id, "Other/Season 1/episode.mp4");
  for (const item of [granted, restricted])
    store.db.prepare("UPDATE media SET metadata_json=? WHERE id=?").run(
      JSON.stringify({
        seriesId: 7,
        seriesTitle: "Show",
        seasonNumber: item.id === granted.id ? 1 : 2,
      }),
      item.id,
    );
  store.db.prepare("INSERT INTO source_grants VALUES(?,?,'')").run(p, tv.id);
  const mixed = saveCollection(store, admin, p, "Mixed seasons", [
    granted.id,
    restricted.id,
  ]);
  store.db.prepare("DELETE FROM source_grants WHERE profile_id=?").run(p);
  store.db
    .prepare("INSERT INTO source_grants VALUES(?,?,'Show/Season 1')")
    .run(p, tv.id);
  const shape = {
    search: "",
    titleOnly: true,
    topLevel: true,
    kind: "all",
    offset: 0,
    limit: 100,
  };
  const before = store.db.prepare("SELECT total_changes() AS n").get()!.n;
  const normal = browseLibraryPage(store, admin, p, {
    ...shape,
    access: "profile",
  });
  assert.equal(normal.shows.length, 1);
  assert.equal(normal.shows[0]!.profileAllowed, true);
  assert.deepEqual(
    normal.shows[0]!.seasons.map((season) => season.number),
    [1],
  );
  assert.equal(normal.sources.length, 1);
  assert.equal(normal.savedCollections.length, 0);
  const all = browseLibraryPage(store, admin, p, { ...shape, access: "all" });
  assert.equal(all.shows.length, 2);
  assert.equal(all.sources.length, 2);
  assert.ok(all.shows.every((show) => show.profileAllowed === false));
  assert.equal(
    all.savedCollections.find((collection) => collection.id === mixed.id)!
      .profileAllowed,
    false,
  );
  assert.equal(
    store.db.prepare("SELECT total_changes() AS n").get()!.n,
    before,
  );
  assert.throws(
    () => browseLibraryPage(store, editor, p, { ...shape, access: "all" }),
    /Administrator access/,
  );
  const noGrants = profile(store, admin);
  assert.equal(
    browseLibraryPage(store, admin, noGrants, { ...shape, access: "profile" })
      .pagination.total,
    0,
  );
});
