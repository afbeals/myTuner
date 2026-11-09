import { relative, sep } from "node:path";
import { z } from "zod";
import type { Store } from "./database.js";
import type { Media, Source } from "./domain.js";
import { invariant } from "./domain.js";
import { containsPath } from "./catalog.js";

export interface PathMapping {
  from: string;
  to: string;
}
export function mapIntegrationPath(
  path: string,
  mappings: PathMapping[],
): string | null {
  const normalize = (v: string) => v.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalized = normalize(path);
  if (normalized.split("/").includes("..")) return null;
  const candidates = [...mappings].sort(
    (a, b) => b.from.length - a.from.length,
  );
  for (const mapping of candidates) {
    const from = normalize(mapping.from),
      windows = /^[a-z]:/i.test(from);
    const comparable = windows ? normalized.toLowerCase() : normalized,
      prefix = windows ? from.toLowerCase() : from;
    if (comparable === prefix || comparable.startsWith(prefix + "/"))
      return normalize(mapping.to) + normalized.slice(from.length);
  }
  return null;
}
const images = z
  .array(
    z.object({
      coverType: z.string(),
      remoteUrl: z.string().nullish(),
      url: z.string().nullish(),
    }),
  )
  .nullish()
  .transform((value) => value ?? []);
const seriesSchema = z.array(
  z.object({
    id: z.number().int(),
    title: z.string(),
    overview: z.string().nullish(),
    images,
    tvdbId: z.number().optional(),
  }),
);
const episodeSchema = z.array(
  z.object({
    id: z.number().int(),
    episodeFileId: z.number().int(),
    seasonNumber: z.number().int(),
    episodeNumber: z.number().int(),
    title: z.string(),
    overview: z.string().nullish(),
  }),
);
const fileSchema = z.array(
  z.object({ id: z.number().int(), path: z.string() }),
);
const movieSchema = z.array(
  z.object({
    id: z.number().int(),
    title: z.string(),
    year: z.number().optional(),
    overview: z.string().nullish(),
    images,
    hasFile: z.boolean().nullish(),
    movieFile: z.object({ path: z.string().nullish() }).nullish(),
    collection: z
      .object({ title: z.string(), tmdbId: z.number().optional() })
      .nullable()
      .optional(),
  }),
);
export interface ImportedItem {
  provider: "sonarr" | "radarr";
  externalId: string;
  path: string;
  title: string;
  metadata: Record<string, unknown>;
}
export type Fetcher = typeof fetch;
export async function readIntegration(
  provider: "sonarr" | "radarr",
  baseUrl: string,
  apiKey: string,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<ImportedItem[]> {
  const base = new URL(baseUrl);
  invariant(
    ["http:", "https:"].includes(base.protocol) &&
      !base.username &&
      !base.password &&
      !base.search &&
      !base.hash,
    400,
    "Invalid integration URL",
  );
  async function get(path: string): Promise<unknown> {
    const url = new URL(base.toString());
    const [pathname, query] = path.split("?");
    url.pathname = base.pathname.replace(/\/$/, "") + "/api/v3/" + pathname;
    url.search = query ?? "";
    const response = await fetcher(url, {
      headers: { "X-Api-Key": apiKey },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
      redirect: "error",
    });
    invariant(response.ok, 502, "Integration request failed");
    return response.json();
  }
  const out: ImportedItem[] = [];
  if (provider === "sonarr") {
    for (const series of seriesSchema.parse(await get("series"))) {
      const episodes = episodeSchema.parse(
        await get(`episode?seriesId=${series.id}`),
      );
      const files = fileSchema.parse(
        await get(`episodefile?seriesId=${series.id}`),
      );
      for (const file of files) {
        const members = episodes
          .filter((e) => e.episodeFileId === file.id)
          .sort(
            (a, b) =>
              a.seasonNumber - b.seasonNumber ||
              a.episodeNumber - b.episodeNumber,
          );
        if (!members.length) continue;
        out.push({
          provider,
          externalId: String(file.id),
          path: file.path,
          title:
            series.title +
            " - " +
            members
              .map(
                (e) =>
                  `S${String(e.seasonNumber).padStart(2, "0")}E${String(e.episodeNumber).padStart(2, "0")}`,
              )
              .join("-"),
          metadata: {
            seriesId: series.id,
            seriesTitle: series.title,
            overview: series.overview,
            seriesOverview: series.overview,
            displayCandidate: {
              title: members.map((e) => e.title).join(" / "),
              description:
                members
                  .map((e) => e.overview)
                  .filter((v) => v != null)
                  .join("\n\n") || undefined,
            },
            images: series.images,
            tvdbId: series.tvdbId,
            seasonNumber: members[0]!.seasonNumber,
            episodeNumber: members[0]!.episodeNumber,
            episodes: members,
          },
        });
      }
    }
  } else {
    for (const movie of movieSchema.parse(await get("movie")))
      if (movie.hasFile !== false && movie.movieFile?.path) {
        out.push({
          provider,
          externalId: String(movie.id),
          path: movie.movieFile.path,
          title: movie.title,
          metadata: {
            movieId: movie.id,
            displayCandidate: {
              title: movie.title,
              description: movie.overview ?? undefined,
            },
            year: movie.year,
            overview: movie.overview,
            images: movie.images,
            collection: movie.collection,
          },
        });
      }
  }
  return out;
}
export function importMetadata(
  store: Store,
  source: Source,
  items: ImportedItem[],
  mappings: PathMapping[],
): { matched: number; unmatched: number } {
  let matched = 0,
    unmatched = 0;
  store.transaction(() => {
    for (const item of items) {
      const mapped = mapIntegrationPath(item.path, mappings);
      if (!mapped || !containsPath(source.root_path, mapped)) {
        unmatched++;
        continue;
      }
      const rel = relative(source.root_path, mapped).split(sep).join("/");
      const media = store.db
        .prepare(
          "SELECT * FROM media WHERE source_id=? AND relative_path=? AND available=1",
        )
        .get(source.id, rel) as Media | undefined;
      if (!media) {
        unmatched++;
        continue;
      }
      const metadata = JSON.stringify({
        ...JSON.parse(media.metadata_json),
        ...item.metadata,
        integrationReference: {
          provider: item.provider,
          externalId: item.externalId,
        },
      });
      store.db
        .prepare("UPDATE media SET title=?,metadata_json=? WHERE id=?")
        .run(item.title, metadata, media.id);
      store.db
        .prepare(
          `INSERT INTO integration_metadata(source_id,provider,external_id,media_id,metadata_json) VALUES(?,?,?,?,?)
    ON CONFLICT(source_id,provider,external_id) DO UPDATE SET media_id=excluded.media_id,metadata_json=excluded.metadata_json`,
        )
        .run(source.id, item.provider, item.externalId, media.id, metadata);
      matched++;
    }
  });
  return { matched, unmatched };
}
