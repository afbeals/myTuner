import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/database.js";
import {
  mapIntegrationPath,
  readIntegration,
  importMetadata,
} from "../src/integrations.js";
import type { Fetcher } from "../src/integrations.js";
import { media, source } from "./helpers.js";

test("path mapping uses boundaries, longest prefix, Windows separators, and rejects traversal", () => {
  assert.equal(
    mapIntegrationPath("/tv/Show/a.mkv", [{ from: "/tv", to: "/media" }]),
    "/media/Show/a.mkv",
  );
  assert.equal(
    mapIntegrationPath("/tv2/Show/a.mkv", [{ from: "/tv", to: "/media" }]),
    null,
  );
  assert.equal(
    mapIntegrationPath("/tv/private/a.mkv", [
      { from: "/tv", to: "/shared" },
      { from: "/tv/private", to: "/private" },
    ]),
    "/private/a.mkv",
  );
  assert.equal(
    mapIntegrationPath("C:\\TV\\show\\a.mkv", [
      { from: "c:/tv", to: "/media" },
    ]),
    "/media/show/a.mkv",
  );
  assert.equal(
    mapIntegrationPath("/tv/../secret", [{ from: "/tv", to: "/media" }]),
    null,
  );
});
test("Sonarr joins multiple episodes to one file and never imports undownloaded episodes", async () => {
  const paths: string[] = [];
  const fetcher: Fetcher = async (input, init) => {
    const url = new URL(String(input));
    paths.push(url.pathname + url.search);
    assert.equal(
      (init?.headers as Record<string, string>)["X-Api-Key"],
      "secret",
    );
    assert.equal(url.searchParams.get("apiKey"), null);
    assert.equal(init?.redirect, "error");
    const body = url.pathname.endsWith("/series")
      ? [{ id: 1, title: "Show", images: [] }]
      : url.pathname.endsWith("/episodefile")
        ? [{ id: 7, path: "/tv/Show/double.mkv" }]
        : [
            {
              id: 1,
              episodeFileId: 7,
              seasonNumber: 1,
              episodeNumber: 1,
              title: "One",
            },
            {
              id: 2,
              episodeFileId: 7,
              seasonNumber: 1,
              episodeNumber: 2,
              title: "Two",
            },
            {
              id: 3,
              episodeFileId: 0,
              seasonNumber: 1,
              episodeNumber: 3,
              title: "Missing",
            },
          ];
    return new Response(JSON.stringify(body));
  };
  const result = await readIntegration(
    "sonarr",
    "http://sonarr:8989/base",
    "secret",
    fetcher,
  );
  assert.equal(result.length, 1);
  assert.equal((result[0]!.metadata.episodes as unknown[]).length, 2);
  assert.ok(paths.includes("/base/api/v3/episode?seriesId=1"));
  assert.ok(paths.includes("/base/api/v3/episodefile?seriesId=1"));
});
test("Radarr imports available files and movie collection metadata", async () => {
  const fetcher: Fetcher = async () =>
    new Response(
      JSON.stringify([
        {
          id: 1,
          title: "Film",
          year: 2000,
          hasFile: true,
          movieFile: { path: "/movies/film.mkv" },
          collection: { title: "Series", tmdbId: 123 },
        },
        { id: 2, title: "Missing", hasFile: false },
      ]),
    );
  const result = await readIntegration(
    "radarr",
    "http://radarr:7878",
    "key",
    fetcher,
  );
  assert.equal(result.length, 1);
  assert.deepEqual(result[0]!.metadata.collection, {
    title: "Series",
    tmdbId: 123,
  });
});
test("metadata attaches only to verified files and integration outages preserve it", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const src = source(store, "/media/shows", "shows"),
    item = media(store, src.id, "show/ep.mkv");
  const result = importMetadata(
    store,
    src,
    [
      {
        provider: "sonarr",
        externalId: "1",
        path: "/tv/show/ep.mkv",
        title: "Show episode",
        metadata: { seasonNumber: 1, episodeNumber: 1 },
      },
      {
        provider: "sonarr",
        externalId: "2",
        path: "/tv/missing.mkv",
        title: "Missing",
        metadata: {},
      },
    ],
    [{ from: "/tv", to: "/media/shows" }],
  );
  assert.deepEqual(result, { matched: 1, unmatched: 1 });
  assert.equal(
    store.db.prepare("SELECT title FROM media WHERE id=?").get(item.id)?.title,
    "Show episode",
  );
  await assert.rejects(
    readIntegration("sonarr", "http://offline", "key", async () => {
      throw new Error("offline");
    }),
  );
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM integration_metadata").get()?.n,
    1,
  );
});

test("independent sources can import identical upstream IDs without overwriting another source association", () => {
  const store = new Store(":memory:");
  try {
    const first = source(store, "/first", "shows"),
      second = source(store, "/second", "shows");
    for (const src of [first, second]) {
      media(store, src.id, "ep.mkv");
      importMetadata(
        store,
        src,
        [
          {
            provider: "sonarr",
            externalId: "1",
            path: "/tv/ep.mkv",
            title: src.root_path,
            metadata: { seriesId: 1 },
          },
        ],
        [{ from: "/tv", to: src.root_path }],
      );
    }
    assert.equal(
      store.db.prepare("SELECT COUNT(*) AS n FROM integration_metadata").get()
        ?.n,
      2,
    );
  } finally {
    store.close();
  }
});

test("Radarr accepts nullable legacy hasFile/movieFile fields and trusts mapped existing files", async () => {
  const items = await readIntegration(
    "radarr",
    "http://localhost:7878",
    "key",
    async () =>
      new Response(
        JSON.stringify([
          {
            id: 1,
            title: "Downloaded",
            hasFile: null,
            movieFile: { path: "/movies/file.mkv" },
            overview: null,
            images: null,
            collection: null,
          },
          {
            id: 2,
            title: "Missing",
            hasFile: null,
            movieFile: null,
            overview: null,
            images: null,
          },
          {
            id: 3,
            title: "Undownloaded",
            hasFile: false,
            movieFile: { path: null },
          },
        ]),
      ),
  );
  assert.equal(items.length, 1);
  assert.equal(items[0]?.path, "/movies/file.mkv");
});
