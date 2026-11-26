import {
  displayMedia,
  createMediaProjector,
  createCompactMediaProjector,
} from "./display-metadata.js";
import {
  projectionState,
  readCatalogProjection,
  assertHydrationBudget,
} from "./catalog-projection.js";
import { showKey } from "./catalog-identity.js";
export { showKey } from "./catalog-identity.js";
import { randomUUID } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { posix } from "node:path";
import type { Store } from "./database.js";
import type { Account, Media } from "./domain.js";
import { invariant } from "./domain.js";
import {
  createMediaAuthorizer,
  normalizeSubtree,
  requireProfile,
  withinSubtree,
} from "./security.js";
import type { Selection } from "./contracts.js";
let cancellationCheck: (() => void) | undefined;
export function withCatalogCancellation<T>(
  check: () => void,
  operation: () => T,
): T {
  const before = cancellationCheck;
  cancellationCheck = check;
  try {
    check();
    return operation();
  } finally {
    cancellationCheck = before;
  }
}
function compactCatalog(
  store: Store,
  account: Account,
  profileId: string,
  availableOnly = false,
  sourceId?: string,
) {
  requireProfile(store, account, profileId);
  if (projectionState(store).ready)
    return readCatalogProjection(
      store,
      {
        profileId,
        admin: account.role === "admin",
        availableOnly,
        ...(sourceId === undefined ? {} : { sourceId }),
      },
      cancellationCheck,
    );
  // Preserve the explicitly synchronous legacy API/reference callers under
  // their existing input admission. The production worker always calls
  // requireCatalogProjection before entering these readers, so it cannot use
  // this compatibility path while a file-backed index is incomplete.
  const items = catalog(
    store,
    account,
    profileId,
    availableOnly,
    sourceId,
    100001,
  );
  return items.map(createCompactMediaProjector(store, items));
}
export interface Metadata {
  seriesId?: number;
  seriesTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  collection?: { title: string; tmdbId?: number };
  [key: string]: unknown;
}
export function metadata(item: Media): Metadata {
  return JSON.parse(item.metadata_json) as Metadata;
}
export function seasonNumber(data: Metadata): number {
  return data.seasonNumber ?? 1;
}
export function movieCollectionKey(item: Media): string | null {
  const c = metadata(item).collection;
  return c ? String(c.tmdbId ?? c.title) : null;
}
export function catalog(
  store: Store,
  account: Account,
  profileId: string,
  availableOnly = true,
  sourceId?: string,
  limit?: number,
): Media[] {
  requireProfile(store, account, profileId);
  const predicates: string[] = [],
    parameters: (string | number)[] = [];
  if (sourceId !== undefined) {
    predicates.push("m.source_id=?");
    parameters.push(sourceId);
  }
  if (availableOnly) predicates.push("m.available=1");
  if (account.role !== "admin") {
    predicates.push(`EXISTS (SELECT 1 FROM source_grants g WHERE g.profile_id=? AND g.source_id=m.source_id AND
      (g.subtree='' OR m.relative_path=g.subtree OR substr(m.relative_path,1,length(g.subtree)+1)=g.subtree||'/'))`);
    parameters.push(profileId);
  }
  if (limit !== undefined) {
    // Admission runs inside SQLite before materializing metadata objects. A row
    // count alone cannot protect a shared host from very large descriptions.
    const volume = store.db
      .prepare(
        `SELECT COUNT(*) AS items,COALESCE(SUM(
      length(CAST(m.metadata_json AS BLOB))+length(CAST(m.title AS BLOB))+
      length(CAST(m.relative_path AS BLOB))+length(CAST(m.id AS BLOB))+length(CAST(m.source_id AS BLOB))
    ),0) AS bytes FROM media m${predicates.length ? " WHERE " + predicates.join(" AND ") : ""}`,
      )
      .get(...parameters)!;
    invariant(
      Number(volume.items) < limit && Number(volume.bytes) <= 64 * 1024 * 1024,
      503,
      browseLimitMessage,
    );
    parameters.push(limit);
  }
  return store.db
    .prepare(
      `SELECT m.* FROM media m${predicates.length ? " WHERE " + predicates.join(" AND ") : ""} ORDER BY m.title,m.id${limit === undefined ? "" : " LIMIT ?"}`,
    )
    .all(...parameters) as unknown as Media[];
}
export function selectMedia(
  store: Store,
  account: Account,
  profileId: string,
  selection: Selection,
  includeUnavailable = false,
): Media[] {
  requireProfile(store, account, profileId);
  const authorized = createMediaAuthorizer(store, account, profileId);
  let rows: Media[];
  if (selection.type === "media") {
    const found = new Map(
      (
        store.db
          .prepare(
            "SELECT * FROM media WHERE id IN (SELECT value FROM json_each(?))",
          )
          .all(JSON.stringify(selection.ids)) as unknown as Media[]
      ).map((item) => [item.id, item]),
    );
    rows = selection.ids.map((id) => {
      const item = found.get(id);
      invariant(item && authorized(item), 404, "Media not found");
      return item;
    });
  } else if (selection.type === "collection") {
    const collection = store.db
      .prepare(
        "SELECT owner_account_id FROM collections WHERE id=? AND deleted_ms IS NULL",
      )
      .get(selection.id) as { owner_account_id: string } | undefined;
    invariant(
      collection &&
        (account.role === "admin" ||
          collection.owner_account_id === account.id),
      404,
      "Collection not found",
    );
    rows = store.db
      .prepare(
        "SELECT m.* FROM collection_items ci JOIN media m ON m.id=ci.media_id WHERE ci.collection_id=?",
      )
      .all(selection.id) as unknown as Media[];
    invariant(rows.every(authorized), 404, "Collection not found");
  } else {
    rows = catalog(
      store,
      account,
      profileId,
      !includeUnavailable,
      selection.sourceId,
    ).filter((m) => m.source_id === selection.sourceId);
    if (selection.type === "folder") {
      const directory = normalizeSubtree(selection.directory);
      rows = rows.filter((m) =>
        selection.recursive
          ? withinSubtree(m.relative_path, directory)
          : posix.dirname(m.relative_path) === (directory || "."),
      );
    } else if (selection.type === "show")
      rows = rows.filter((m) => {
        const season = seasonNumber(metadata(m));
        return (
          showKey(m) === selection.key &&
          (selection.season === undefined || season === selection.season) &&
          (selection.includeSpecials || season !== 0)
        );
      });
    else rows = rows.filter((m) => movieCollectionKey(m) === selection.key);
  }
  return [
    ...new Map(
      rows
        .filter((m) => includeUnavailable || m.available === 1)
        .map((m) => [m.id, m]),
    ).values(),
  ];
}
// Retain byte-accounted buffers rather than unbounded object graphs. Movie
// metadata is hydrated only for the requested page, never stored in this cache.
const browseBudget = 8 * 1024 * 1024;
const browseExpandedBudget = 64 * 1024 * 1024;
const browseLimitMessage =
  "Library browsing budget exceeded; choose a smaller source";
type BrowseEntry = { data: Buffer; compressed: boolean } | { error: string };
const browseCache = new WeakMap<
  Store,
  {
    version: number;
    entries: Map<string, BrowseEntry>;
    bytes: number;
  }
>();
function cachedBrowseValue<T>(store: Store, key: string, build: () => T): T {
  const version = Number(
    store.db.prepare("SELECT revision FROM catalog_revision WHERE id=1").get()!
      .revision,
  );
  let cache = browseCache.get(store);
  if (!cache || cache.version !== version) {
    cache = { version, entries: new Map(), bytes: 0 };
    browseCache.set(store, cache);
  }
  // Transaction revisions can roll back and later be reused. Never publish or
  // consume a shared cache entry from an uncommitted SQLite transaction.
  const cacheable = !store.db.isTransaction;
  const hit = cacheable ? cache.entries.get(key) : undefined;
  if (hit) {
    invariant(
      !("error" in hit),
      503,
      "error" in hit ? hit.error : browseLimitMessage,
    );
    return JSON.parse(
      (hit.compressed
        ? inflateRawSync(hit.data, { maxOutputLength: browseExpandedBudget })
        : hit.data
      ).toString(),
    ) as T;
  }
  const remember = (entry: BrowseEntry) => {
    if (!cacheable) return;
    const bytes = "data" in entry ? entry.data.byteLength : 0;
    while (
      cache.entries.size &&
      (cache.entries.size >= 4 || cache.bytes + bytes > browseBudget)
    ) {
      const oldest = cache.entries.keys().next().value!;
      const previous = cache.entries.get(oldest)!;
      cache.bytes -= "data" in previous ? previous.data.byteLength : 0;
      cache.entries.delete(oldest);
    }
    cache.entries.set(key, entry);
    cache.bytes += bytes;
  };
  let value: T;
  try {
    value = build();
  } catch (error) {
    if (error instanceof Error && error.message === browseLimitMessage)
      remember({ error: browseLimitMessage });
    throw error;
  }
  const raw = Buffer.from(JSON.stringify(value));
  if (raw.byteLength > browseExpandedBudget) {
    remember({ error: browseLimitMessage });
    invariant(false, 503, browseLimitMessage);
  }
  const compressed = raw.byteLength > 128 * 1024;
  const data = compressed ? deflateRawSync(raw, { level: 1 }) : raw;
  if (data.byteLength > browseBudget) {
    remember({ error: browseLimitMessage });
    invariant(false, 503, browseLimitMessage);
  }
  remember({ data, compressed });
  return value;
}
type LibrarySearchItem = {
  fields: string[];
  folders: string[];
  show?: string;
  movieId?: string;
  collection?: string;
};
export function browseLibrarySummary(
  store: Store,
  account: Account,
  profileId: string,
  search = "",
  sourceId?: string,
): Omit<ReturnType<typeof buildBrowseLibrary>, "searchItems"> {
  requireProfile(store, account, profileId);
  const build = () => buildBrowseLibrary(store, account, profileId, sourceId);
  const { searchItems, ...library } =
    store.filename === ":memory:"
      ? cachedBrowseValue(
          store,
          JSON.stringify([
            "summary",
            account.id,
            account.role,
            profileId,
            sourceId,
          ]),
          build,
        )
      : build();
  const query = search.trim().toLocaleLowerCase();
  if (!query) return library;
  const shows = new Set<string>(),
    movies = new Set<string>(),
    folders = new Set<string>(),
    collections = new Set<string>();
  let searched = 0;
  for (const item of searchItems) {
    if (searched++ % 128 === 0) cancellationCheck?.();
    if (!item.fields.some((field) => field.includes(query))) continue;
    if (item.show) shows.add(item.show);
    if (item.movieId) movies.add(item.movieId);
    for (const folder of item.folders) folders.add(folder);
    if (item.collection) collections.add(item.collection);
  }
  return {
    sources: library.sources,
    shows: library.shows.filter((show) =>
      shows.has(show.sourceId + ":" + show.key),
    ),
    movies: library.movies.filter((movie) => movies.has(movie.id)),
    folders: library.folders.filter((folder) =>
      folders.has(folder.sourceId + ":" + folder.directory),
    ),
    movieCollections: library.movieCollections.filter((collection) =>
      collections.has(collection.sourceId + ":" + collection.key),
    ),
  };
}

// Raw media search keeps its existing per-field substring matching and canonical
// stored-title/id order. Only compact lowercase search fields survive the request.
export function browseMediaPage(
  store: Store,
  account: Account,
  profileId: string,
  input: { search: string; page: number; limit: number },
) {
  requireProfile(store, account, profileId);
  let total: number;
  let rows: Media[];
  if (!input.search) {
    const access =
      account.role === "admin"
        ? ""
        : ` AND EXISTS (SELECT 1 FROM source_grants g WHERE g.profile_id=? AND g.source_id=m.source_id AND (g.subtree='' OR m.relative_path=g.subtree OR substr(m.relative_path,1,length(g.subtree)+1)=g.subtree||'/'))`;
    const parameters = account.role === "admin" ? [] : [profileId];
    total = Number(
      store.db
        .prepare(
          `SELECT COUNT(*) AS total FROM media m WHERE m.available=1${access}`,
        )
        .get(...parameters)!.total,
    );
    const ids = store.db
      .prepare(
        `SELECT m.id FROM media m WHERE m.available=1${access} ORDER BY m.title,m.id LIMIT ? OFFSET ?`,
      )
      .all(...parameters, input.limit, (input.page - 1) * input.limit)
      .map((row) => String(row.id));
    assertHydrationBudget(store, ids);
    const found = new Map(
      (
        store.db
          .prepare(
            "SELECT * FROM media WHERE id IN (SELECT value FROM json_each(?))",
          )
          .all(JSON.stringify(ids)) as unknown as Media[]
      ).map((item) => [item.id, item]),
    );
    rows = ids.map((id) => found.get(id)!);
  } else {
    const buildIndex = () =>
      compactCatalog(store, account, profileId, true).map(
        (item): [string, string, string, string] => [
          item.id,
          item.mediaFields[0]!,
          item.mediaFields[1]!,
          item.mediaFields[2]!,
        ],
      );
    const index =
      store.filename === ":memory:"
        ? cachedBrowseValue(
            store,
            JSON.stringify([
              "media-search",
              account.id,
              account.role,
              profileId,
            ]),
            buildIndex,
          )
        : buildIndex();
    const query = input.search.toLowerCase();
    const matching = index.filter(
      (entry) =>
        entry[1].includes(query) ||
        entry[2].includes(query) ||
        entry[3].includes(query),
    );
    total = matching.length;
    const ids = matching
      .slice((input.page - 1) * input.limit, input.page * input.limit)
      .map((entry) => entry[0]);
    assertHydrationBudget(store, ids);
    const found = new Map(
      (
        store.db
          .prepare(
            "SELECT * FROM media WHERE id IN (SELECT value FROM json_each(?))",
          )
          .all(JSON.stringify(ids)) as unknown as Media[]
      ).map((item) => [item.id, item]),
    );
    rows = ids.map((id) => found.get(id)!);
  }
  const project = createMediaProjector(store, rows);
  return {
    total,
    items: rows.map(project).map(({ mtime_ms, size, ...item }) => item),
  };
}

export function hydrateLibraryMovies(
  store: Store,
  movies: ReturnType<typeof buildBrowseLibrary>["movies"],
) {
  if (!movies.length) return [];
  assertHydrationBudget(
    store,
    movies.map((movie) => movie.id),
  );
  const rows = store.db
    .prepare("SELECT * FROM media WHERE id IN (SELECT value FROM json_each(?))")
    .all(JSON.stringify(movies.map((movie) => movie.id))) as unknown as Media[];
  const items = new Map(rows.map((item) => [item.id, item]));
  const project = createMediaProjector(store, rows);
  return movies.map((movie) => ({
    ...movie,
    metadata: metadata(project(items.get(movie.id)!)),
  }));
}
export function browseLibrary(
  store: Store,
  account: Account,
  profileId: string,
  search = "",
) {
  const library = browseLibrarySummary(store, account, profileId, search);
  return { ...library, movies: hydrateLibraryMovies(store, library.movies) };
}
function buildBrowseLibrary(
  store: Store,
  account: Account,
  profileId: string,
  sourceId?: string,
) {
  const items = compactCatalog(store, account, profileId, false, sourceId);
  const searchItems: LibrarySearchItem[] = [];
  const sources = store.db
    .prepare("SELECT id,name,kind FROM sources")
    .all() as { id: string; name: string; kind: string }[];
  const shows = new Map<
    string,
    {
      key: string;
      sourceId: string;
      title: string;
      artwork: { mediaId: string; index: number; coverType: string }[];
      seasons: Map<
        number,
        { number: number; available: number; unavailable: number }
      >;
    }
  >();
  const movies: {
      id: string;
      title: string;
      sourceId: string;
      available: boolean;
    }[] = [],
    folders = new Map<
      string,
      { sourceId: string; directory: string; available: number }
    >(),
    collections = new Map<
      string,
      { sourceId: string; key: string; title: string; available: number }
    >();
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  let processed = 0;
  for (const compact of items) {
    if (processed++ % 128 === 0) cancellationCheck?.();
    const item = {
      id: compact.id,
      source_id: compact.sourceId,
      relative_path: compact.relativePath,
      title: compact.storedTitle,
      available: compact.available,
    };
    const src = sourceMap.get(item.source_id)!,
      display = { title: compact.title },
      data = {
        seasonNumber: compact.season,
        collection:
          compact.collectionKey === null
            ? undefined
            : {
                title: compact.collectionTitle!,
                tmdbId: compact.collectionKey,
              },
        images: compact.artworkTypes.map((coverType) => ({ coverType })),
      },
      displayData = { seriesTitle: compact.seriesTitle },
      directory =
        posix.dirname(item.relative_path) === "."
          ? ""
          : posix.dirname(item.relative_path);
    const searchItem: LibrarySearchItem = {
      fields: compact.fields,
      folders: [],
    };
    const folderKey = item.source_id + ":" + directory,
      folder = folders.get(folderKey) ?? {
        sourceId: item.source_id,
        directory,
        available: 0,
      };
    searchItem.folders.push(folderKey);
    folder.available += item.available;
    folders.set(folderKey, folder);
    // Custom libraries expose parent folders even when every video is nested.
    // Counts are accumulated only from the already-authorized catalog rows.
    if (src.kind === "videos" || src.kind === "commercials") {
      let parent = directory;
      while (parent) {
        const next = posix.dirname(parent);
        parent = next === "." ? "" : next;
        const key = src.id + ":" + parent;
        const ancestor = folders.get(key) ?? {
          sourceId: src.id,
          directory: parent,
          available: 0,
        };
        ancestor.available += item.available;
        folders.set(key, ancestor);
        searchItem.folders.push(key);
      }
    }
    if (src.kind === "shows") {
      const key = compact.showKey,
        mapKey = src.id + ":" + key,
        show = shows.get(mapKey) ?? {
          key,
          sourceId: src.id,
          title: displayData.seriesTitle ?? key.replace(/^folder:/, ""),
          artwork: ((data.images ?? []) as { coverType: string }[]).map(
            (image, index) => ({
              mediaId: item.id,
              index,
              coverType: image.coverType,
            }),
          ),
          seasons: new Map(),
        };
      searchItem.show = mapKey;
      const number = compact.season,
        season = show.seasons.get(number) ?? {
          number,
          available: 0,
          unavailable: 0,
        };
      if (item.available) season.available++;
      else season.unavailable++;
      show.seasons.set(number, season);
      shows.set(mapKey, show);
    } else if (src.kind === "movies") {
      searchItem.movieId = item.id;
      movies.push({
        id: item.id,
        title: display.title,
        sourceId: src.id,
        available: Boolean(item.available),
      });
    }
    const key = compact.collectionKey;
    if (key !== null) {
      const c = collections.get(src.id + ":" + key) ?? {
        sourceId: src.id,
        key,
        title: data.collection!.title,
        available: 0,
      };
      searchItem.collection = src.id + ":" + key;
      c.available += item.available;
      collections.set(src.id + ":" + key, c);
    }
    searchItems.push(searchItem);
  }
  const visibleSourceIds = new Set(items.map((item) => item.sourceId));
  return {
    sources:
      sourceId === undefined
        ? sources.filter((source) => visibleSourceIds.has(source.id))
        : (store.db
            .prepare(
              `SELECT s.id,s.name,s.kind FROM sources s WHERE EXISTS (
          SELECT 1 FROM media m WHERE m.source_id=s.id${account.role === "admin" ? "" : ` AND EXISTS (SELECT 1 FROM source_grants g WHERE g.profile_id=? AND g.source_id=m.source_id AND (g.subtree='' OR m.relative_path=g.subtree OR substr(m.relative_path,1,length(g.subtree)+1)=g.subtree||'/'))`})`,
            )
            .all(
              ...(account.role === "admin" ? [] : [profileId]),
            ) as unknown as typeof sources),
    shows: [...shows.values()].map((show) => ({
      ...show,
      seasons: [...show.seasons.values()].sort((a, b) => a.number - b.number),
    })),
    movies,
    folders: [...folders.values()],
    movieCollections: [...collections.values()],
    searchItems,
  };
}
export function saveCollection(
  store: Store,
  account: Account,
  profileId: string,
  name: string,
  mediaIds: string[],
  collectionId?: string,
) {
  requireProfile(store, account, profileId, true);
  const id = collectionId ?? randomUUID();
  if (collectionId) {
    const current = store.db
      .prepare(
        "SELECT owner_account_id FROM collections WHERE id=? AND deleted_ms IS NULL",
      )
      .get(id) as { owner_account_id: string } | undefined;
    invariant(
      current &&
        (account.role === "admin" || current.owner_account_id === account.id),
      404,
      "Collection not found",
    );
  }
  selectMedia(store, account, profileId, { type: "media", ids: mediaIds });
  store.transaction(() => {
    store.db
      .prepare(
        "INSERT INTO collections(id,name,owner_account_id) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name",
      )
      .run(id, name, account.id);
    store.db
      .prepare("DELETE FROM collection_items WHERE collection_id=?")
      .run(id);
    for (const mediaId of new Set(mediaIds))
      store.db
        .prepare(
          "INSERT INTO collection_items(collection_id,media_id) VALUES(?,?)",
        )
        .run(id, mediaId);
  });
  return { id, name };
}

export function collectionSummaries(
  store: Store,
  account: Account,
  profileId: string,
) {
  requireProfile(store, account, profileId);
  const access =
    account.role === "admin"
      ? ""
      : ` AND c.owner_account_id=? AND NOT EXISTS (
    SELECT 1 FROM collection_items hidden JOIN media h ON h.id=hidden.media_id
    WHERE hidden.collection_id=c.id AND NOT EXISTS (SELECT 1 FROM source_grants g WHERE g.profile_id=? AND g.source_id=h.source_id AND
      (g.subtree='' OR h.relative_path=g.subtree OR substr(h.relative_path,1,length(g.subtree)+1)=g.subtree||'/')))`;
  return store.db
    .prepare(
      `SELECT c.id,c.name,c.owner_account_id AS ownerAccountId,SUM(CASE WHEN m.available=1 THEN 1 ELSE 0 END) AS count
    FROM collections c LEFT JOIN collection_items ci ON ci.collection_id=c.id LEFT JOIN media m ON m.id=ci.media_id
    WHERE c.deleted_ms IS NULL${access} GROUP BY c.id ORDER BY c.name,c.id`,
    )
    .all(
      ...(account.role === "admin" ? [] : [account.id, profileId]),
    ) as unknown as {
    id: string;
    name: string;
    ownerAccountId: string;
    count: number;
  }[];
}

export function programmingOptions(
  store: Store,
  account: Account,
  profileId: string,
  input: {
    search: string;
    offset: number;
    limit: number;
    sourceId?: string | undefined;
    showKey?: string | undefined;
    kind?: string | undefined;
  },
) {
  const library = browseLibrarySummary(
    store,
    account,
    profileId,
    input.search,
    input.sourceId,
  );
  const options: {
    title: string;
    sourceId: string | null;
    kind: string;
    selection: Selection;
    available?: number;
    unavailable?: number;
  }[] = [];
  for (const show of library.shows) {
    if (input.sourceId && show.sourceId !== input.sourceId) continue;
    if (input.showKey && show.key !== input.showKey) continue;
    options.push({
      title: show.title,
      sourceId: show.sourceId,
      kind: "show",
      selection: {
        type: "show",
        sourceId: show.sourceId,
        key: show.key,
        includeSpecials: false,
      },
    });
    if (input.showKey)
      for (const season of show.seasons)
        options.push({
          title: `${show.title} · Season ${season.number}`,
          sourceId: show.sourceId,
          kind: "season",
          available: season.available,
          unavailable: season.unavailable,
          selection: {
            type: "show",
            sourceId: show.sourceId,
            key: show.key,
            season: season.number,
            includeSpecials: season.number === 0,
          },
        });
  }
  if (!input.showKey) {
    for (const movie of library.movies as {
      id: string;
      title: string;
      sourceId: string;
    }[])
      options.push({
        title: movie.title,
        sourceId: movie.sourceId,
        kind: "movie",
        selection: { type: "media", ids: [movie.id] },
      });
    for (const folder of library.folders)
      options.push({
        title: folder.directory || "All files",
        sourceId: folder.sourceId,
        kind: "folder",
        available: folder.available,
        selection: {
          type: "folder",
          sourceId: folder.sourceId,
          directory: folder.directory,
          recursive: true,
        },
      });
    for (const collection of library.movieCollections)
      options.push({
        title: collection.title,
        sourceId: collection.sourceId,
        kind: "movieCollection",
        available: collection.available,
        selection: {
          type: "movieCollection",
          sourceId: collection.sourceId,
          key: collection.key,
        },
      });
    for (const collection of collectionSummaries(store, account, profileId)) {
      if (
        input.search &&
        !collection.name
          .toLocaleLowerCase()
          .includes(input.search.toLocaleLowerCase())
      )
        continue;
      options.push({
        title: collection.name,
        sourceId: null,
        kind: "collection",
        available: collection.count,
        selection: { type: "collection", id: collection.id },
      });
    }
  }
  const filtered = options
    .filter(
      (option) =>
        (!input.sourceId || option.sourceId === input.sourceId) &&
        (!input.kind || option.kind === input.kind),
    )
    .sort(
      (a, b) =>
        (a.sourceId ?? "").localeCompare(b.sourceId ?? "") ||
        a.kind.localeCompare(b.kind) ||
        a.title.localeCompare(b.title, undefined, { numeric: true }) ||
        JSON.stringify(a.selection).localeCompare(JSON.stringify(b.selection)),
    );
  return {
    items: filtered.slice(input.offset, input.offset + input.limit),
    total: filtered.length,
    offset: input.offset,
    limit: input.limit,
    sources: library.sources,
  };
}
