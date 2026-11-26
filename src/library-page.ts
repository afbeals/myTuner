import type { Store } from "./database.js";
import type { Account } from "./domain.js";
import {
  browseLibrarySummary,
  hydrateLibraryMovies,
  collectionSummaries,
} from "./library.js";

export function browseLibraryPage(
  store: Store,
  account: Account,
  profileId: string,
  input: {
    search: string;
    sourceId?: string | undefined;
    kind: string;
    offset: number;
    limit: number;
  },
) {
  const library = browseLibrarySummary(
    store,
    account,
    profileId,
    input.search,
    input.sourceId,
  );
  const sourceKinds = new Map(library.sources.map((s) => [s.id, s.kind]));
  const refs: {
    type:
      "shows" | "movies" | "folders" | "movieCollections" | "savedCollections";
    index: number;
    kind: string;
    sourceId?: string;
  }[] = [];
  library.shows.forEach((s, index) =>
    refs.push({ type: "shows", index, kind: "shows", sourceId: s.sourceId }),
  );
  library.movies.forEach((m, index) =>
    refs.push({
      type: "movies",
      index,
      kind: "movies",
      sourceId: (m as { sourceId: string }).sourceId,
    }),
  );
  library.folders.forEach((f, index) =>
    refs.push({
      type: "folders",
      index,
      kind: sourceKinds.get(f.sourceId) ?? "videos",
      sourceId: f.sourceId,
    }),
  );
  library.movieCollections.forEach((c, index) =>
    refs.push({
      type: "movieCollections",
      index,
      kind: "collections",
      sourceId: c.sourceId,
    }),
  );
  const savedCollections: {
    id: string;
    name: string;
    count: number;
    ownerAccountId: string;
  }[] = [];
  if (!input.sourceId && (input.kind === "all" || input.kind === "collections"))
    for (const row of collectionSummaries(store, account, profileId)) {
      if (
        input.search &&
        !row.name.toLocaleLowerCase().includes(input.search.toLocaleLowerCase())
      )
        continue;
      savedCollections.push(row);
    }
  savedCollections.forEach((_, index) =>
    refs.push({ type: "savedCollections", index, kind: "collections" }),
  );
  const permitted = refs.filter(
    (r) =>
      r.kind !== "commercials" &&
      (!input.sourceId || r.sourceId === input.sourceId) &&
      (input.kind === "all" || r.kind === input.kind),
  );
  const page = permitted.slice(input.offset, input.offset + input.limit);
  const selected = new Map<string, Set<number>>();
  for (const ref of page) {
    if (!selected.has(ref.type)) selected.set(ref.type, new Set());
    selected.get(ref.type)!.add(ref.index);
  }
  const includes = (type: string, index: number) =>
    selected.get(type)?.has(index) ?? false;
  return {
    sources: library.sources,
    shows: library.shows.filter((_, i) => includes("shows", i)),
    movies: hydrateLibraryMovies(
      store,
      library.movies.filter((_, i) => includes("movies", i)),
    ),
    folders: library.folders.filter((_, i) => includes("folders", i)),
    movieCollections: library.movieCollections.filter((_, i) =>
      includes("movieCollections", i),
    ),
    savedCollections: savedCollections.filter((_, i) =>
      includes("savedCollections", i),
    ),
    pagination: {
      offset: input.offset,
      limit: input.limit,
      total: permitted.length,
    },
  };
}
