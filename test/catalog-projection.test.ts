import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store, migrations, schemaVersion } from "../src/database.js";
import { DatabaseSync } from "node:sqlite";
import { account, profile, source, media } from "./helpers.js";
import { browseLibraryPage } from "../src/library-page.js";
import {
  browseMediaPage,
  programmingOptions,
  saveCollection,
  withCatalogCancellation,
} from "../src/library.js";
import {
  ensureCatalogProjection,
  projectionState,
  readCatalogProjection,
  projectionBatchRows,
  projectionBatchBytes,
} from "../src/catalog-projection.js";
import { inspectMetadata, saveMetadata } from "../src/display-metadata.js";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "mytuner-projection-"));
  const store = new Store(join(root, "catalog.db"));
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  return store;
}
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const pageInput = { search: "", kind: "all", offset: 0, limit: 24 };

test("persisted neutral projection preserves grouped/raw/options semantics, metadata choices and authorized representatives", async (t) => {
  const store = await fixture(t),
    owner = account(store),
    admin = account(store, "admin"),
    p = profile(store, owner);
  const tv = source(store, "/synthetic-tv", "shows"),
    movies = source(store, "/synthetic-movies", "movies"),
    videos = source(store, "/synthetic-videos", "videos");
  for (const [id, subtree] of [
    [tv.id, "Allowed"],
    [movies.id, ""],
    [videos.id, "Category"],
  ])
    store.db
      .prepare("INSERT INTO source_grants VALUES(?,?,?)")
      .run(p, id!, subtree!);
  const hidden = media(store, tv.id, "Hidden/000-private.mp4"),
    one = media(store, tv.id, "Allowed/Show/Season 1/needle-one.mp4"),
    two = media(store, tv.id, "Allowed/Show/Season 1/two.mp4"),
    special = media(store, tv.id, "Allowed/Show/Season 0/special.mp4");
  for (const [i, item] of [hidden, one, two, special].entries())
    store.db
      .prepare(
        "UPDATE media SET title=?,metadata_json=?,available=? WHERE id=?",
      )
      .run(
        i === 0 ? "000 hidden" : `Episode ${i}`,
        JSON.stringify({
          seriesId: 7,
          seriesTitle: "Stored Series",
          seasonNumber: i === 3 ? 0 : 1,
          episodeNumber: i,
          images: [{ coverType: i === 0 ? "secret" : "poster" }],
        }),
        i === 2 ? 0 : 1,
        item.id,
      );
  const movie = media(store, movies.id, "Film/feature.mp4");
  store.db.prepare("UPDATE media SET metadata_json=? WHERE id=?").run(
    JSON.stringify({
      title: "Raw film",
      collection: { title: "Saga", tmdbId: 20 },
      local: { title: "NFO film" },
      localNfoValid: true,
    }),
    movie.id,
  );
  const custom = media(store, videos.id, "Category/Nested/lesson.mp4");
  const info = inspectMetadata(store, { kind: "media", mediaId: one.id });
  await saveMetadata(
    store,
    admin,
    p,
    { kind: "media", mediaId: one.id },
    info.revision,
    {
      title: { source: "manual", manual: "Custom épisode 10" },
      description: { source: "manual", manual: "Description outside search" },
    },
  );
  saveCollection(store, owner, p, "Saved Saga", [one.id, custom.id]);
  // The legacy adapter is only used to capture pre-index behavior in this test.
  const legacy = Object.assign(Object.create(store) as Store, {
    filename: ":memory:",
  });
  const searches = [
    "",
    "needle-one",
    "Custom épisode",
    "Stored Series",
    "Saga",
    "Source",
    "%",
    "Description outside search",
  ];
  const expected = searches.map((search) => ({
    library: browseLibraryPage(legacy, owner, p, { ...pageInput, search }),
    media: browseMediaPage(legacy, owner, p, { search, page: 1, limit: 24 }),
    options: programmingOptions(legacy, owner, p, {
      search,
      offset: 0,
      limit: 100,
    }),
  }));
  await ensureCatalogProjection(store);
  assert.equal(projectionState(store).ready, true);
  for (const [i, search] of searches.entries()) {
    assert.deepEqual(
      json(browseLibraryPage(store, owner, p, { ...pageInput, search })),
      json(expected[i]!.library),
    );
    assert.deepEqual(
      json(browseMediaPage(store, owner, p, { search, page: 1, limit: 24 })),
      json(expected[i]!.media),
    );
    assert.deepEqual(
      json(
        programmingOptions(store, owner, p, { search, offset: 0, limit: 100 }),
      ),
      json(expected[i]!.options),
    );
  }
  const show = browseLibraryPage(store, owner, p, {
    ...pageInput,
    kind: "shows",
    search: "needle-one",
  }).shows[0]!;
  assert.deepEqual(show.seasons, [
    { number: 0, available: 1, unavailable: 0 },
    { number: 1, available: 1, unavailable: 1 },
  ]);
  assert.equal(show.artwork[0]!.mediaId, one.id);
  assert.doesNotMatch(JSON.stringify(show), /secret|000-private/);
  store.db
    .prepare("DELETE FROM source_grants WHERE profile_id=? AND source_id=?")
    .run(p, tv.id);
  assert.equal(projectionState(store).ready, false);
  await ensureCatalogProjection(store);
  assert.equal(
    browseLibraryPage(store, owner, p, { ...pageInput, kind: "shows" })
      .pagination.total,
    0,
  );
});

test("dirty IDs coalesce, skip unchanged writes, move group membership and retain deletion tombstones", async (t) => {
  const store = await fixture(t),
    owner = account(store, "admin"),
    p = profile(store, owner),
    src = source(store, "/synthetic", "shows");
  const item = media(store, src.id, "Old/Season 1/episode.mp4");
  store.db
    .prepare("UPDATE media SET metadata_json=? WHERE id=?")
    .run(
      JSON.stringify({ seriesId: 1, seriesTitle: "Old", seasonNumber: 1 }),
      item.id,
    );
  await ensureCatalogProjection(store);
  const before = store.db
    .prepare("SELECT data_json FROM catalog_projection_rows WHERE media_id=?")
    .get(item.id)!.data_json;
  store.db.exec(
    "CREATE TABLE projection_writes(n INTEGER); INSERT INTO projection_writes VALUES(0); CREATE TRIGGER count_projection_write AFTER UPDATE ON catalog_projection_rows BEGIN UPDATE projection_writes SET n=n+1; END;",
  );
  for (let i = 0; i < 4; i++)
    store.db
      .prepare("UPDATE media SET metadata_json=metadata_json WHERE id=?")
      .run(item.id);
  assert.equal(
    Number(
      store.db
        .prepare("SELECT COUNT(*) n FROM catalog_projection_dirty_media")
        .get()!.n,
    ),
    1,
  );
  await ensureCatalogProjection(store);
  assert.equal(
    store.db
      .prepare("SELECT data_json FROM catalog_projection_rows WHERE media_id=?")
      .get(item.id)!.data_json,
    before,
  );
  assert.equal(
    Number(store.db.prepare("SELECT n FROM projection_writes").get()!.n),
    0,
  );
  const changes = store.db.prepare("SELECT total_changes() n").get()!.n;
  await ensureCatalogProjection(store);
  assert.equal(store.db.prepare("SELECT total_changes() n").get()!.n, changes);
  store.db
    .prepare("UPDATE media SET metadata_json=?,relative_path=? WHERE id=?")
    .run(
      JSON.stringify({ seriesId: 2, seriesTitle: "New", seasonNumber: 3 }),
      "New/Season 3/episode.mp4",
      item.id,
    );
  await ensureCatalogProjection(store);
  const groups = store.db
    .prepare(
      "SELECT kind,group_key FROM catalog_projection_members WHERE media_id=?",
    )
    .all(item.id);
  assert.ok(groups.some((g) => String(g.group_key).includes("series:2")));
  assert.ok(groups.every((g) => !String(g.group_key).includes("series:1")));
  store.db.prepare("DELETE FROM media WHERE id=?").run(item.id);
  assert.equal(
    Number(
      store.db
        .prepare("SELECT COUNT(*) n FROM catalog_projection_dirty_media")
        .get()!.n,
    ),
    1,
  );
  await ensureCatalogProjection(store);
  assert.equal(
    browseLibraryPage(store, owner, p, pageInput).pagination.total,
    0,
  );
  assert.equal(
    Number(
      store.db
        .prepare("SELECT COUNT(*) n FROM catalog_projection_members")
        .get()!.n,
    ),
    0,
  );
});

test("show choices rebuild the complete show, and replaced media cannot retain stale manual choices", async (t) => {
  const store = await fixture(t),
    admin = account(store, "admin"),
    p = profile(store, admin),
    src = source(store, "/synthetic", "shows");
  const items = [
    media(store, src.id, "Show/one.mp4"),
    media(store, src.id, "Show/two.mp4"),
  ];
  for (const item of items)
    store.db
      .prepare("UPDATE media SET metadata_json=? WHERE id=?")
      .run(JSON.stringify({ seriesId: 9, seriesTitle: "Original" }), item.id);
  await ensureCatalogProjection(store);
  const target = { kind: "show" as const, sourceId: src.id, key: "series:9" };
  await saveMetadata(
    store,
    admin,
    p,
    target,
    inspectMetadata(store, target).revision,
    {
      title: { source: "manual", manual: "Renamed show" },
      description: { source: "automatic" },
    },
  );
  await ensureCatalogProjection(store);
  assert.equal(
    readCatalogProjection(store, { profileId: p, admin: true }).filter(
      (i) => i.seriesTitle === "Renamed show",
    ).length,
    2,
  );
  const itemTarget = { kind: "media" as const, mediaId: items[0]!.id };
  await saveMetadata(
    store,
    admin,
    p,
    itemTarget,
    inspectMetadata(store, itemTarget).revision,
    {
      title: { source: "manual", manual: "Old identity title" },
      description: { source: "automatic" },
    },
  );
  await ensureCatalogProjection(store);
  store.db
    .prepare("UPDATE media SET mtime_ms=mtime_ms+1 WHERE id=?")
    .run(items[0]!.id);
  await ensureCatalogProjection(store);
  assert.notEqual(
    readCatalogProjection(store, { profileId: p, admin: true }).find(
      (i) => i.id === items[0]!.id,
    )!.title,
    "Old identity title",
  );
});

test("backfill resumes after cancellation and file reopen without publishing partial rows", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-projection-resume-")),
    filename = join(root, "catalog.db");
  let store = new Store(filename);
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const src = source(store, "/synthetic");
  store.transaction(() => {
    for (let i = 0; i < 400; i++) media(store, src.id, `Folder/${i}.mp4`);
  });
  const controller = new AbortController(),
    building = ensureCatalogProjection(store, { signal: controller.signal });
  controller.abort();
  await assert.rejects(building, { name: "AbortError" });
  assert.equal(projectionState(store).ready, false);
  const cursor = projectionState(store).backfill_cursor;
  assert.ok(cursor);
  store.close();
  store = new Store(filename);
  assert.equal(projectionState(store).backfill_cursor, cursor);
  await ensureCatalogProjection(store);
  assert.equal(projectionState(store).ready, true);
  assert.equal(
    Number(
      store.db.prepare("SELECT COUNT(*) n FROM catalog_projection_rows").get()!
        .n,
    ),
    400,
  );
  assert.equal(
    Number(
      store.db
        .prepare("SELECT COUNT(*) n FROM catalog_projection_dirty_media")
        .get()!.n,
    ),
    0,
  );
});

test("realistic mixed JSON beyond 64 MiB indexes in bounded batches and never persists descriptions", async (t) => {
  const store = await fixture(t),
    admin = account(store, "admin"),
    p = profile(store, admin);
  const sources = [
    source(store, "/synthetic-shows", "shows"),
    source(store, "/synthetic-films", "movies"),
    source(store, "/synthetic-videos", "videos"),
  ];
  const insert = store.db.prepare(
    "INSERT INTO media(id,source_id,relative_path,title,duration_ms,size,mtime_ms,metadata_json) VALUES(?,?,?,?,1000,1,0,?)",
  );
  store.transaction(() => {
    for (let i = 0; i < 12000; i++) {
      const src = sources[i < 8000 ? 0 : i < 10000 ? 1 : 2]!;
      insert.run(
        `synthetic-${String(i).padStart(6, "0")}`,
        src.id,
        `Group ${Math.floor(i / 100)}/item ${i}.mp4`,
        `Item ${i}`,
        JSON.stringify({
          seriesId: Math.floor(i / 100),
          seriesTitle: `Show ${Math.floor(i / 100)}`,
          seasonNumber: 1,
          overview:
            "PRIVATE DESCRIPTION " + "x".repeat([2048, 6144, 10240][i % 3]!),
          technical: { fixture: true },
        }),
      );
    }
  });
  assert.ok(
    Number(
      store.db.prepare("SELECT SUM(length(metadata_json)) n FROM media").get()!
        .n,
    ) >
      64 * 1024 * 1024,
  );
  const prepare = store.db.prepare.bind(store.db),
    batches: number[] = [];
  store.db.prepare = ((sql: string, ...args: []) => {
    const statement = prepare(sql, ...args);
    if (sql.startsWith("SELECT * FROM media WHERE id IN")) {
      const all = statement.all.bind(statement);
      statement.all = ((...parameters: Parameters<typeof all>) => {
        const rows = all(...parameters);
        batches.push(rows.length);
        assert.ok(rows.length <= projectionBatchRows);
        return rows;
      }) as typeof statement.all;
    }
    return statement;
  }) as typeof store.db.prepare;
  await ensureCatalogProjection(store);
  assert.ok(batches.length > 90);
  assert.equal(projectionState(store).ready, true);
  const result = browseLibraryPage(store, admin, p, {
    ...pageInput,
    kind: "shows",
  });
  assert.equal(result.shows.length, 24);
  assert.ok(
    !String(
      store.db
        .prepare("SELECT data_json FROM catalog_projection_rows LIMIT 1")
        .get()!.data_json,
    ).includes("PRIVATE DESCRIPTION"),
  );
  assert.ok(projectionBatchBytes <= 4 * 1024 * 1024);
});

test("oversized individual provider information fails boundedly and retries after repair", async (t) => {
  const store = await fixture(t),
    src = source(store, "/synthetic"),
    item = media(store, src.id);
  store.db
    .prepare("INSERT INTO integration_metadata VALUES(?,?,?,?,?)")
    .run(
      src.id,
      "sonarr",
      "1",
      item.id,
      JSON.stringify({ overview: "x".repeat(projectionBatchBytes) }),
    );
  await assert.rejects(
    ensureCatalogProjection(store),
    /provider information exceed/,
  );
  assert.equal(projectionState(store).ready, false);
  store.db
    .prepare("DELETE FROM integration_metadata WHERE media_id=?")
    .run(item.id);
  await ensureCatalogProjection(store);
  assert.equal(projectionState(store).ready, true);
});

test("page hydration refuses combined large rows before loading full movie metadata", async (t) => {
  const store = await fixture(t),
    admin = account(store, "admin"),
    p = profile(store, admin),
    src = source(store, "/synthetic", "movies");
  for (let i = 0; i < 3; i++) {
    const item = media(store, src.id, `film-${i}.mp4`);
    store.db
      .prepare("UPDATE media SET metadata_json=? WHERE id=?")
      .run(JSON.stringify({ overview: "x".repeat(3 * 1024 * 1024) }), item.id);
  }
  await ensureCatalogProjection(store);
  const prepare = store.db.prepare.bind(store.db);
  store.db.prepare = ((sql: string) => {
    assert.ok(
      !sql.startsWith("SELECT * FROM media"),
      "Reject selected-page volume before raw row hydration",
    );
    return prepare(sql);
  }) as typeof store.db.prepare;
  assert.throws(
    () => browseLibraryPage(store, admin, p, { ...pageInput, kind: "movies" }),
    /page metadata budget exceeded/,
  );
  assert.throws(
    () => browseMediaPage(store, admin, p, { search: "", page: 1, limit: 100 }),
    /page metadata budget exceeded/,
  );
});

test("schema 18 upgrade creates an empty deferred read model and preserves the authoritative catalog", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-projection-upgrade-")),
    filename = join(root, "catalog.db");
  const db = new DatabaseSync(filename);
  for (const migration of migrations.slice(0, 18)) db.exec(migration);
  db.exec(
    "PRAGMA user_version=18; INSERT INTO sources(id,name,root_path,kind) VALUES('source','Synthetic','/synthetic','shows'); INSERT INTO media(id,source_id,relative_path,title,duration_ms,size,mtime_ms,metadata_json) VALUES('media','source','Show/episode.mp4','Episode',1000,1,0,'{\"seriesId\":1,\"seriesTitle\":\"Show\"}');",
  );
  db.close();
  const store = new Store(filename);
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  assert.equal(
    Number(store.db.prepare("PRAGMA user_version").get()!.user_version),
    schemaVersion,
  );
  assert.equal(projectionState(store).backfill_complete, 0);
  assert.equal(
    Number(
      store.db.prepare("SELECT COUNT(*) n FROM catalog_projection_rows").get()!
        .n,
    ),
    0,
  );
  assert.equal(
    Number(store.db.prepare("SELECT COUNT(*) n FROM media").get()!.n),
    1,
  );
  await ensureCatalogProjection(store);
  assert.equal(projectionState(store).ready, true);
  assert.equal(
    Number(
      store.db.prepare("SELECT COUNT(*) n FROM catalog_projection_rows").get()!
        .n,
    ),
    1,
  );
});
