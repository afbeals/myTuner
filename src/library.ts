import { displayMedia } from "./display-metadata.js";
import { showKey } from "./catalog-identity.js";
export { showKey } from "./catalog-identity.js";
import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import type { Store } from "./database.js";
import type { Account, Media } from "./domain.js";
import { invariant } from "./domain.js";
import {
  canReadMedia,
  normalizeSubtree,
  requireProfile,
  withinSubtree,
} from "./security.js";
import type { Selection } from "./contracts.js";
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
): Media[] {
  requireProfile(store, account, profileId);
  return store.db
    .prepare(
      `SELECT m.* FROM media m WHERE (?=0 OR m.available=1) AND
    (?='admin' OR EXISTS (SELECT 1 FROM source_grants g WHERE g.profile_id=? AND g.source_id=m.source_id AND
      (g.subtree='' OR m.relative_path=g.subtree OR substr(m.relative_path,1,length(g.subtree)+1)=g.subtree||'/')))
    ORDER BY m.title,m.id`,
    )
    .all(Number(availableOnly), account.role, profileId) as unknown as Media[];
}
export function selectMedia(
  store: Store,
  account: Account,
  profileId: string,
  selection: Selection,
  includeUnavailable = false,
): Media[] {
  requireProfile(store, account, profileId);
  let rows: Media[];
  if (selection.type === "media") {
    rows = selection.ids.map((id) => {
      const item = store.db
        .prepare("SELECT * FROM media WHERE id=?")
        .get(id) as Media | undefined;
      invariant(
        item && canReadMedia(store, account, profileId, item),
        404,
        "Media not found",
      );
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
    invariant(
      rows.every((m) => canReadMedia(store, account, profileId, m)),
      404,
      "Collection not found",
    );
  } else {
    rows = catalog(store, account, profileId, !includeUnavailable).filter(
      (m) => m.source_id === selection.sourceId,
    );
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
export function browseLibrary(
  store: Store,
  account: Account,
  profileId: string,
  search = "",
) {
  const items = catalog(store, account, profileId, false);
  const query = search.trim().toLocaleLowerCase();
  const matchingShows = new Set<string>(),
    matchingFolders = new Set<string>(),
    matchingCollections = new Set<string>();
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
  const movies: object[] = [],
    folders = new Map<
      string,
      { sourceId: string; directory: string; available: number }
    >(),
    collections = new Map<
      string,
      { sourceId: string; key: string; title: string; available: number }
    >();
  for (const item of items) {
    const src = sources.find((s) => s.id === item.source_id)!,
      display = displayMedia(store, item),
      data = metadata(item),
      displayData = metadata(display),
      directory =
        posix.dirname(item.relative_path) === "."
          ? ""
          : posix.dirname(item.relative_path);
    const matches =
      !query ||
      [
        display.title,
        item.title,
        item.relative_path,
        displayData.seriesTitle ?? "",
        data.seriesTitle ?? "",
        data.collection?.title ?? "",
        src.name,
      ].some((value) => value.toLocaleLowerCase().includes(query));
    const folderKey = item.source_id + ":" + directory,
      folder = folders.get(folderKey) ?? {
        sourceId: item.source_id,
        directory,
        available: 0,
      };
    if (matches) matchingFolders.add(folderKey);
    folder.available += item.available;
    folders.set(folderKey, folder);
    if (src.kind === "shows") {
      const key = showKey(item),
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
      if (matches) matchingShows.add(mapKey);
      const number = seasonNumber(data),
        season = show.seasons.get(number) ?? {
          number,
          available: 0,
          unavailable: 0,
        };
      if (item.available) season.available++;
      else season.unavailable++;
      show.seasons.set(number, season);
      shows.set(mapKey, show);
    } else if (src.kind === "movies" && matches)
      movies.push({
        id: item.id,
        title: display.title,
        sourceId: src.id,
        available: Boolean(item.available),
        metadata: displayData,
      });
    const key = movieCollectionKey(item);
    if (key !== null) {
      const c = collections.get(src.id + ":" + key) ?? {
        sourceId: src.id,
        key,
        title: data.collection!.title,
        available: 0,
      };
      if (matches) matchingCollections.add(src.id + ":" + key);
      c.available += item.available;
      collections.set(src.id + ":" + key, c);
    }
  }
  return {
    sources: sources.filter((s) => items.some((i) => i.source_id === s.id)),
    shows: [...shows.values()]
      .filter((show) => matchingShows.has(show.sourceId + ":" + show.key))
      .map((show) => ({
        ...show,
        seasons: [...show.seasons.values()].sort((a, b) => a.number - b.number),
      })),
    movies,
    folders: [...folders.values()].filter((folder) =>
      matchingFolders.has(folder.sourceId + ":" + folder.directory),
    ),
    movieCollections: [...collections.values()].filter((collection) =>
      matchingCollections.has(collection.sourceId + ":" + collection.key),
    ),
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
  const library = browseLibrary(store, account, profileId, input.search);
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
    const collections = store.db
      .prepare(
        "SELECT id,name FROM collections WHERE deleted_ms IS NULL AND (?='admin' OR owner_account_id=?) ORDER BY name,id",
      )
      .all(account.role, account.id);
    for (const collection of collections) {
      if (
        input.search &&
        !String(collection.name)
          .toLocaleLowerCase()
          .includes(input.search.toLocaleLowerCase())
      )
        continue;
      try {
        const selected = selectMedia(store, account, profileId, {
          type: "collection",
          id: String(collection.id),
        });
        options.push({
          title: String(collection.name),
          sourceId: null,
          kind: "collection",
          available: selected.length,
          selection: { type: "collection", id: String(collection.id) },
        });
      } catch {
        /* Hidden collections do not contribute titles/counts. */
      }
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
