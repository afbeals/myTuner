import { SubtitleDiscovery } from "./subtitle-catalog.js";
import { randomUUID } from "node:crypto";
import { readdir, realpath, stat } from "node:fs/promises";
import {
  isAbsolute,
  relative,
  resolve,
  sep,
  extname,
  basename,
  dirname,
} from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Store } from "./database.js";
import type { Media, Source, SourceKind } from "./domain.js";
import { invariant } from "./domain.js";
import { inspectLocalMetadata } from "./local-metadata.js";
import { normalizeSubtree } from "./security.js";

const execute = promisify(execFile);
export const mediaExtensions = new Set([
  ".mp4",
  ".mkv",
  ".m4v",
  ".mov",
  ".avi",
  ".webm",
  ".ts",
  ".mpeg",
  ".mpg",
]);
export function containsPath(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel))
  );
}
export async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    const absolute = resolve(path),
      parent = dirname(absolute);
    if (parent === absolute) throw error;
    return resolve(await canonicalPath(parent), basename(absolute));
  }
}
export async function addSource(
  store: Store,
  input: { name: string; root: string; kind: SourceKind; recursive: boolean },
  writableRoots: string[],
  authorize: () => void = () => {},
): Promise<Source> {
  const root = await realpath(input.root);
  invariant(
    (await stat(root)).isDirectory(),
    400,
    "Source must be a directory",
  );
  for (const writable of writableRoots) {
    const canonical = await canonicalPath(writable);
    invariant(
      !containsPath(root, canonical) && !containsPath(canonical, root),
      400,
      "Source and application storage must not overlap",
    );
  }
  const existing = store.db
    .prepare(
      "SELECT root_path FROM sources UNION SELECT subtitle_root AS root_path FROM sources WHERE subtitle_root IS NOT NULL",
    )
    .all() as {
    root_path: string;
  }[];
  invariant(
    !existing.some(
      (s) => containsPath(s.root_path, root) || containsPath(root, s.root_path),
    ),
    409,
    "Source overlaps an existing source",
  );
  authorize();
  const source: Source = {
    id: randomUUID(),
    name: input.name,
    root_path: root,
    kind: input.kind,
    recursive: Number(input.recursive),
  };
  store.db
    .prepare(
      "INSERT INTO sources(id,name,root_path,kind,recursive) VALUES(?,?,?,?,?)",
    )
    .run(source.id, source.name, root, source.kind, source.recursive);
  return source;
}
export async function safeMediaPath(
  source: Source,
  relativePath: string,
): Promise<string> {
  const normalized = normalizeSubtree(relativePath);
  invariant(normalized !== "", 400, "A file is required");
  const resolved = await realpath(resolve(source.root_path, normalized));
  invariant(
    containsPath(source.root_path, resolved),
    403,
    "File is outside source",
  );
  invariant((await stat(resolved)).isFile(), 404, "Media file not found");
  return resolved;
}
export interface Inspection {
  durationMs: number;
  streams: {
    index: number;
    type: string;
    codec: string;
    language?: string;
    title?: string;
    width?: number;
    height?: number;
    channels?: number;
    default: boolean;
    forced: boolean;
  }[];
  format: string;
}
export async function probeMedia(path: string): Promise<Inspection> {
  const { stdout } = await execute(
    "ffprobe",
    ["-v", "error", "-show_format", "-show_streams", "-of", "json", path],
    { timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
  );
  const value = JSON.parse(stdout) as {
    format?: { duration?: string; format_name?: string };
    streams?: {
      index: number;
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      channels?: number;
      tags?: { language?: string; title?: string };
      disposition?: { default?: number; forced?: number };
      duration?: string;
    }[];
  };
  const seconds = Number(
      value.format?.duration ??
        value.streams?.find((s) => s.duration)?.duration,
    ),
    durationMs = Math.round(seconds * 1000);
  invariant(
    Number.isFinite(seconds) && seconds > 0 && Number.isSafeInteger(durationMs),
    422,
    "Invalid media duration",
  );
  return {
    durationMs,
    format: value.format?.format_name ?? "unknown",
    streams: (value.streams ?? []).map((s) => ({
      index: s.index,
      type: s.codec_type ?? "unknown",
      codec: s.codec_name ?? "unknown",
      default: Boolean(s.disposition?.default),
      forced: Boolean(s.disposition?.forced),
      ...(s.width === undefined ? {} : { width: s.width }),
      ...(s.height === undefined ? {} : { height: s.height }),
      ...(s.channels === undefined ? {} : { channels: s.channels }),
      ...(s.tags?.language ? { language: s.tags.language } : {}),
      ...(s.tags?.title ? { title: s.tags.title } : {}),
    })),
  };
}
export async function probeDuration(path: string): Promise<number> {
  return (await probeMedia(path)).durationMs;
}
export interface ScanResult {
  seen: number;
  updated: number;
  missing: number;
  complete: boolean;
  errors: { path: string; message: string }[];
}
export async function scanSource(
  store: Store,
  source: Source,
  probe: (path: string) => Promise<number | Inspection> = probeMedia,
  signal?: AbortSignal,
): Promise<ScanResult> {
  const result: ScanResult = {
    seen: 0,
    updated: 0,
    missing: 0,
    complete: true,
    errors: [],
  };
  const seen = new Set<string>();
  const subtitles = new SubtitleDiscovery(signal);
  // Enumerate completely before marking any prior files missing. Offline/partial scans preserve availability.
  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      result.complete = false;
      result.errors.push({
        path: relative(source.root_path, directory),
        message: "Directory could not be read",
      });
      return;
    }
    entries.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
    const singleVideo =
      entries.filter(
        (e) => e.isFile() && mediaExtensions.has(extname(e.name).toLowerCase()),
      ).length === 1;
    for (const entry of entries) {
      if (signal?.aborted) {
        result.complete = false;
        return;
      }
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (source.recursive) await walk(path);
        continue;
      }
      if (
        !entry.isFile() ||
        !mediaExtensions.has(extname(entry.name).toLowerCase())
      )
        continue;
      const rel = relative(source.root_path, path).split(sep).join("/");
      seen.add(rel);
      result.seen++;
      try {
        const safe = await safeMediaPath(source, rel),
          info = await stat(safe);
        const current = store.db
          .prepare("SELECT * FROM media WHERE source_id=? AND relative_path=?")
          .get(source.id, rel) as Media | undefined;
        const localResult = await inspectLocalMetadata(
            source,
            rel,
            singleVideo,
          ),
          local = localResult.data;
        const previous = JSON.parse(current?.metadata_json ?? "{}") as Record<
          string,
          unknown
        >;
        const integrated = store.db
          .prepare("SELECT media_id FROM integration_metadata WHERE media_id=?")
          .get(current?.id ?? "");
        if (!integrated) {
          for (const field of [
            "title",
            "overview",
            "seriesTitle",
            "seasonNumber",
            "episodeNumber",
            "lastEpisodeNumber",
            "year",
            "collection",
          ])
            delete previous[field];
        }
        const data = {
          ...previous,
          ...(integrated ? {} : local),
          local,
          localNfoValid: localResult.validNfo,
        };
        if (
          current &&
          current.size === info.size &&
          current.mtime_ms === info.mtimeMs &&
          current.available
        ) {
          store.db
            .prepare("UPDATE media SET metadata_json=?,title=? WHERE id=?")
            .run(
              JSON.stringify(data),
              integrated ? current.title : String(local.title),
              current.id,
            );
          await subtitles.check(store, current.id);
          continue;
        }
        const inspected = await probe(safe);
        const duration =
          typeof inspected === "number" ? inspected : inspected.durationMs;
        if (typeof inspected !== "number")
          Object.assign(data, { technical: inspected });
        invariant(
          Number.isSafeInteger(duration) && duration > 0,
          422,
          "Invalid media duration",
        );
        // Do not catalog a file that changed while probing.
        const after = await stat(safe);
        invariant(
          after.size === info.size && after.mtimeMs === info.mtimeMs,
          409,
          "Media changed during inspection",
        );
        store.db
          .prepare(
            `INSERT INTO media(id,source_id,relative_path,title,duration_ms,size,mtime_ms,available,metadata_json) VALUES(?,?,?,?,?,?,?,1,?)
     ON CONFLICT(source_id,relative_path) DO UPDATE SET title=excluded.title,duration_ms=excluded.duration_ms,size=excluded.size,mtime_ms=excluded.mtime_ms,available=1,metadata_json=excluded.metadata_json`,
          )
          .run(
            current?.id ?? randomUUID(),
            source.id,
            rel,
            integrated && current ? current.title : String(local.title),
            duration,
            info.size,
            info.mtimeMs,
            JSON.stringify(data),
          );
        const cataloged = store.db
          .prepare("SELECT id FROM media WHERE source_id=? AND relative_path=?")
          .get(source.id, rel)!;
        await subtitles.check(store, String(cataloged.id));
        result.updated++;
      } catch {
        result.complete = false;
        result.errors.push({
          path: rel,
          message: "Media could not be inspected or changed during scan",
        });
      }
    }
  }
  await walk(source.root_path);
  if (result.complete)
    store.transaction(() => {
      const rows = store.db
        .prepare(
          "SELECT id,relative_path FROM media WHERE source_id=? AND available=1",
        )
        .all(source.id) as { id: string; relative_path: string }[];
      const mark = store.db.prepare("UPDATE media SET available=0 WHERE id=?");
      for (const row of rows)
        if (!seen.has(row.relative_path)) {
          mark.run(row.id);
          result.missing++;
        }
    });
  return result;
}
