import { createHash } from "node:crypto";
import { opendir, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { z } from "zod";
import type { Store } from "./database.js";
import type { Media, Source } from "./domain.js";
import { invariant } from "./domain.js";
import { canonicalPath, containsPath, safeMediaPath } from "./catalog.js";
import { normalizeSubtree, sourceById } from "./security.js";

export const externalTrackBase = 1_000_000_000;
const formats: Record<string, string> = {
  ".srt": "srt",
  ".vtt": "webvtt",
  ".ass": "ass",
  ".ssa": "ass",
};
const extensions = new Set([...Object.keys(formats), ".sup", ".idx", ".sub"]);
export const subtitleConfigSchema = z
  .object({
    enabled: z.boolean(),
    root: z.string().trim().min(1).max(4096).nullable(),
    subdirectories: z.array(z.string().trim().min(1).max(256)).max(8),
    maxDepth: z.number().int().min(0).max(4),
  })
  .strict();
export type SubtitleConfig = z.infer<typeof subtitleConfigSchema>;
export const manualSubtitleSchema = z
  .object({
    rootKind: z.enum(["media", "subtitles"]),
    relativePath: z.string().min(1).max(4096),
  })
  .strict();
export type ManualSubtitle = z.infer<typeof manualSubtitleSchema>;
export interface ExternalSubtitle extends ManualSubtitle {
  id: number;
  index: number;
  origin: string;
  format: string;
  language: string | null;
  forced: boolean;
  sdh: boolean;
  manual: boolean;
  status: "found" | "ambiguous" | "unsupported" | "missing";
  size: number;
  mtimeMs: number;
  videoSize: number;
  videoMtimeMs: number;
  signature: string;
}
interface CheckState {
  revision: number;
  checked_ms: number | null;
  success_ms: number | null;
  error: string | null;
}
function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function subtitleConfig(source: Source): SubtitleConfig {
  return {
    enabled: true,
    subdirectories: ["Subs", "Subtitles"],
    maxDepth: 2,
    ...JSON.parse(source.subtitle_config ?? "{}"),
    // The root is deliberately kept in its own column for pre-migration/restore containment checks.
    ...{ root: source.subtitle_root ?? null },
  };
}
function signature(source: Source) {
  return hash([
    source.root_path,
    subtitleConfig(source),
    source.subtitle_revision ?? 0,
  ]);
}
function media(store: Store, mediaId: string) {
  const item = store.db
    .prepare("SELECT * FROM media WHERE id=?")
    .get(mediaId) as Media | undefined;
  invariant(item, 404, "Media not found");
  return item;
}
function checkState(store: Store, mediaId: string): CheckState {
  return (
    (store.db
      .prepare("SELECT * FROM subtitle_checks WHERE media_id=?")
      .get(mediaId) as unknown as CheckState | undefined) ?? {
      revision: 0,
      checked_ms: null,
      success_ms: null,
      error: null,
    }
  );
}
export function subtitleRevision(store: Store, item: Media) {
  return hash([
    item.id,
    item.relative_path,
    item.size,
    item.mtime_ms,
    item.available,
    signature(sourceById(store, item.source_id)),
    checkState(store, item.id).revision,
  ]);
}
export function storedSubtitles(
  store: Store,
  mediaId: string,
): ExternalSubtitle[] {
  const rows = store.db
    .prepare(
      "SELECT id,state_json FROM subtitle_tracks WHERE media_id=? ORDER BY id LIMIT 2049",
    )
    .all(mediaId);
  invariant(
    rows.length <= 2048,
    422,
    "Subtitle history exceeds 2,048 tracks; narrow the source and review associations",
  );
  return rows.map((row) => ({
    ...JSON.parse(String(row.state_json)),
    id: Number(row.id),
    index: externalTrackBase + Number(row.id),
  }));
}
export function inspectSubtitles(store: Store, item: Media, admin: boolean) {
  const source = sourceById(store, item.source_id);
  const state = checkState(store, item.id);
  const current = signature(source);
  return {
    ...(admin
      ? { revision: subtitleRevision(store, item), sourceId: source.id }
      : {}),
    checkedMs: state.checked_ms,
    lastSuccessMs: state.success_ms,
    error: state.error,
    automatic: subtitleConfig(source).enabled,
    tracks: storedSubtitles(store, item.id).map((track) => {
      const status =
        track.signature === current &&
        track.videoSize === item.size &&
        track.videoMtimeMs === item.mtime_ms
          ? track.status
          : "needs-check";
      return {
        index: track.index,
        origin: track.origin,
        format: track.format,
        language: track.language,
        forced: track.forced,
        sdh: track.sdh,
        manual: track.manual,
        status,
        ...(admin
          ? { rootKind: track.rootKind, relativePath: track.relativePath }
          : {}),
      };
    }),
  };
}
export function advertisedSubtitles(
  store: Store,
  item: Media,
  profileId: string,
) {
  const source = sourceById(store, item.source_id);
  const current = signature(source);
  const config = subtitleConfig(source);
  return storedSubtitles(store, item.id)
    .filter(
      (t) =>
        t.status === "found" &&
        t.signature === current &&
        t.videoSize === item.size &&
        t.videoMtimeMs === item.mtime_ms &&
        (config.enabled || t.manual),
    )
    .map((t) => ({
      index: t.index,
      type: "subtitle",
      codec: t.format,
      language: t.language ?? "und",
      title: `${t.language ?? "Unknown language"}${t.forced ? " · Forced" : ""}${t.sdh ? " · SDH" : ""} · ${t.manual ? "Manual" : t.origin} (${t.format})`,
      default: false,
      forced: t.forced,
      sdh: t.sdh,
      origin: t.origin,
      url: `/api/profiles/${profileId}/media/${item.id}/subtitles/${t.index}.vtt`,
      timeBasis: "source-media",
    }));
}
export async function configureSubtitles(
  store: Store,
  sourceId: string,
  revision: number,
  config: SubtitleConfig,
  writableRoots: string[],
  authorize: () => void,
) {
  authorize();
  const source = sourceById(store, sourceId);
  invariant(
    (source.subtitle_revision ?? 0) === revision,
    409,
    "Subtitle settings changed; reload before saving",
  );
  const folders = [...new Set(config.subdirectories.map(normalizeSubtree))];
  invariant(
    folders.every(Boolean),
    400,
    "Subtitle folders must be relative subdirectories",
  );
  const root = config.root === null ? null : await realpath(config.root);
  if (root !== null) {
    invariant(
      (await stat(root)).isDirectory(),
      400,
      "Subtitle root must be a directory",
    );
    for (const writable of writableRoots) {
      const path = await canonicalPath(writable);
      invariant(
        !containsPath(root, path) && !containsPath(path, root),
        409,
        "Subtitles and application storage must not overlap",
      );
    }
    // Separate roots cannot reach another media source through the caption browser.
    for (const other of store.db
      .prepare("SELECT id,root_path FROM sources WHERE id<>?")
      .all(sourceId)) {
      const path = await canonicalPath(String(other.root_path));
      invariant(
        !containsPath(root, path) && !containsPath(path, root),
        409,
        "Subtitle root overlaps another media source",
      );
    }
  }
  authorize();
  const changed = store.db
    .prepare(
      "UPDATE sources SET subtitle_root=?,subtitle_config=?,subtitle_revision=subtitle_revision+1 WHERE id=? AND subtitle_revision=?",
    )
    .run(
      root,
      JSON.stringify({
        enabled: config.enabled,
        subdirectories: folders,
        maxDepth: config.maxDepth,
      }),
      sourceId,
      revision,
    ).changes;
  invariant(
    changed === 1,
    409,
    "Subtitle settings changed; reload before saving",
  );
  return {
    ...subtitleConfig(sourceById(store, sourceId)),
    revision: revision + 1,
  };
}
export async function resolveSubtitle(
  source: Source,
  candidate: ManualSubtitle,
) {
  const root =
    candidate.rootKind === "media" ? source.root_path : source.subtitle_root;
  invariant(root, 400, "Configure a subtitle root first");
  const path = await safeMediaPath(
    { ...source, root_path: root },
    candidate.relativePath,
  );
  const info = await stat(path);
  invariant(
    extensions.has(extname(path).toLowerCase()),
    422,
    "Unsupported subtitle filename",
  );
  invariant(
    info.size > 0 && info.size <= 10 * 1024 * 1024,
    422,
    "Subtitle input must be between 1 byte and 10 MiB",
  );
  return { path, info };
}

export async function previewManualSubtitle(
  store: Store,
  item: Media,
  revision: string,
  manual: ManualSubtitle,
  authorize: () => void,
) {
  authorize();
  invariant(
    subtitleRevision(store, item) === revision,
    409,
    "Subtitle information changed; reload before checking",
  );
  const source = sourceById(store, item.source_id),
    resolved = await resolveSubtitle(source, manual);
  authorize();
  invariant(
    subtitleRevision(store, media(store, item.id)) === revision,
    409,
    "Video or settings changed; check again",
  );
  const format = formats[extname(resolved.path).toLowerCase()];
  return {
    fingerprint: hash([
      manual,
      resolved.info.size,
      resolved.info.mtimeMs,
      revision,
    ]),
    format: format ?? extname(resolved.path).slice(1),
    size: resolved.info.size,
    supported: Boolean(format),
  };
}

// One discovery object per source scan reuses bounded directory listings across episodes.
export class SubtitleDiscovery {
  private directories = new Map<
    string,
    Promise<{ name: string; directory: boolean }[]>
  >();
  constructor(private readonly signal?: AbortSignal) {}
  private list(path: string) {
    let pending = this.directories.get(path);
    if (!pending) {
      pending = (async () => {
        this.signal?.throwIfAborted();
        const result: { name: string; directory: boolean }[] = [];
        const directory = await opendir(path);
        let count = 0;
        for await (const entry of directory) {
          this.signal?.throwIfAborted();
          invariant(
            ++count <= 2000,
            422,
            "Subtitle directory exceeds 2,000 entries; use a narrower search location",
          );
          if (entry.isSymbolicLink()) continue;
          if (entry.isFile() || entry.isDirectory())
            result.push({ name: entry.name, directory: entry.isDirectory() });
        }
        return result.sort((a, b) => a.name.localeCompare(b.name));
      })();
      // Bound cached listings even on a long source scan.
      if (this.directories.size >= 256) this.directories.clear();
      this.directories.set(path, pending);
    }
    return pending;
  }
  async check(
    store: Store,
    mediaId: string,
    authorize: () => void = () => {},
    expectedRevision?: string,
    manual?: ManualSubtitle,
    fingerprint?: string,
  ) {
    const item = media(store, mediaId);
    const source = sourceById(store, item.source_id);
    const config = subtitleConfig(source);
    const revision = subtitleRevision(store, item);
    const previous = storedSubtitles(store, mediaId);
    const check = () => {
      this.signal?.throwIfAborted();
      authorize();
      invariant(
        subtitleRevision(store, media(store, mediaId)) === revision,
        409,
        "Video or subtitle settings changed; check again",
      );
    };
    check();
    invariant(
      expectedRevision === undefined || expectedRevision === revision,
      409,
      "Subtitle information changed; reload before checking",
    );
    const candidates = new Map<
      string,
      Omit<ExternalSubtitle, "id" | "index">
    >();
    const key = (t: ManualSubtitle) => `${t.rootKind}:${t.relativePath}`;
    try {
      const input = await safeMediaPath(source, item.relative_path);
      const video = await stat(input);
      invariant(
        video.size === item.size && video.mtimeMs === item.mtime_ms,
        409,
        "Video changed; rescan the source first",
      );
      const stem = basename(item.relative_path, extname(item.relative_path))
        .normalize("NFC")
        .toLowerCase();
      const directory = dirname(item.relative_path);
      let visited = 0;
      const inspect = async (
        candidate: ManualSubtitle,
        origin: string,
        explicit: boolean,
        allowMissing = false,
      ) => {
        check();
        const relativePath = normalizeSubtree(candidate.relativePath);
        const extension = extname(relativePath).toLowerCase();
        if (!extensions.has(extension)) return;
        const fileStem = basename(relativePath, extension)
          .normalize("NFC")
          .toLowerCase();
        const matched = fileStem === stem || fileStem.startsWith(`${stem}.`);
        const suffix = matched
          ? fileStem.slice(stem.length).replace(/^\./, "")
          : fileStem;
        const tags = suffix.split(/[. _-]+/).filter(Boolean);
        const language =
          tags.find(
            (t) => /^[a-z]{2,3}$/.test(t) && !["sdh", "sub", "cc"].includes(t),
          ) ?? null;
        let resolved;
        try {
          resolved = await resolveSubtitle(source, {
            ...candidate,
            relativePath,
          });
        } catch (error) {
          if (
            allowMissing &&
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
            return;
          throw error;
        }
        const old = previous.find(
          (t) => key(t) === key({ ...candidate, relativePath }),
        );
        const preserved =
          old?.manual &&
          old.videoSize === item.size &&
          old.videoMtimeMs === item.mtime_ms &&
          old.signature === signature(source);
        const selected = explicit || Boolean(preserved);
        invariant(
          candidates.size < 512 ||
            candidates.has(key({ ...candidate, relativePath })),
          422,
          "Subtitle candidates exceed 512 files; narrow the search location",
        );
        candidates.set(key({ ...candidate, relativePath }), {
          rootKind: candidate.rootKind,
          relativePath,
          origin: selected ? "manual" : origin,
          format: formats[extension] ?? extension.slice(1),
          language,
          forced: tags.includes("forced"),
          sdh: tags.includes("sdh") || tags.includes("cc"),
          manual: selected,
          status: !formats[extension]
            ? "unsupported"
            : matched || selected
              ? "found"
              : "ambiguous",
          size: resolved.info.size,
          mtimeMs: resolved.info.mtimeMs,
          videoSize: item.size,
          videoMtimeMs: item.mtime_ms,
          signature: signature(source),
        });
      };
      const walk = async (
        rootKind: ManualSubtitle["rootKind"],
        relativeDirectory: string,
        depth: number,
        origin: string,
        optional: boolean,
      ) => {
        check();
        invariant(
          ++visited <= 100,
          422,
          "Subtitle search exceeds 100 directories; narrow the search location",
        );
        const root =
          rootKind === "media" ? source.root_path : source.subtitle_root!;
        const location = join(root, relativeDirectory);
        const canonical = await realpath(location).catch((error) => {
          if (optional && error?.code === "ENOENT") return null;
          throw error;
        });
        if (canonical === null) return;
        invariant(
          containsPath(root, canonical),
          403,
          "Subtitle folder is outside its root",
        );
        for (const entry of await this.list(canonical)) {
          const path = join(relativeDirectory, entry.name)
            .split("\\")
            .join("/");
          if (entry.directory) {
            if (depth > 0) await walk(rootKind, path, depth - 1, origin, false);
          } else if (extensions.has(extname(entry.name).toLowerCase()))
            await inspect({ rootKind, relativePath: path }, origin, false);
        }
      };
      if (config.enabled) {
        await walk("media", directory, 0, "adjacent", false);
        for (const folder of config.subdirectories)
          await walk(
            "media",
            join(directory, folder),
            config.maxDepth,
            "subfolder",
            true,
          );
        if (source.subtitle_root) {
          // An offline configured root is a failed check, never a successful mass removal.
          await stat(source.subtitle_root);
          await walk("subtitles", directory, 0, "configured root", true);
          for (const folder of config.subdirectories)
            await walk(
              "subtitles",
              join(directory, folder),
              config.maxDepth,
              "configured root",
              true,
            );
        }
      }
      for (const old of previous.filter(
        (t) =>
          t.manual &&
          t.signature === signature(source) &&
          t.videoSize === item.size &&
          t.videoMtimeMs === item.mtime_ms,
      ))
        if (!candidates.has(key(old))) await inspect(old, "manual", true, true);
      if (manual) {
        const preview = await previewManualSubtitle(
          store,
          item,
          revision,
          manual,
          check,
        );
        invariant(
          preview.supported && preview.fingerprint === fingerprint,
          409,
          "Subtitle candidate changed; check it before saving",
        );
        await inspect(manual, "manual", true);
        const finalPreview = await previewManualSubtitle(
          store,
          item,
          revision,
          manual,
          check,
        );
        invariant(
          finalPreview.fingerprint === fingerprint,
          409,
          "Subtitle candidate changed; check it before saving",
        );
      }
      check();
      invariant(
        new Set([...previous.map(key), ...candidates.keys()]).size <= 2048,
        422,
        "Subtitle history exceeds 2,048 tracks; narrow the source and review associations",
      );
      store.transaction(() => {
        const upsert = store.db.prepare(
          "INSERT INTO subtitle_tracks(media_id,root_kind,relative_path,state_json) VALUES(?,?,?,?) ON CONFLICT(media_id,root_kind,relative_path) DO UPDATE SET state_json=excluded.state_json",
        );
        for (const candidate of candidates.values())
          upsert.run(
            mediaId,
            candidate.rootKind,
            candidate.relativePath,
            JSON.stringify(candidate),
          );
        for (const old of previous)
          if (!candidates.has(key(old)))
            store.db
              .prepare("UPDATE subtitle_tracks SET state_json=? WHERE id=?")
              .run(
                JSON.stringify({
                  ...old,
                  status: "missing",
                  signature: signature(source),
                }),
                old.id,
              );
        store.db
          .prepare(
            "INSERT INTO subtitle_checks(media_id,revision,checked_ms,success_ms,error) VALUES(?,1,?,?,NULL) ON CONFLICT(media_id) DO UPDATE SET revision=revision+1,checked_ms=excluded.checked_ms,success_ms=excluded.success_ms,error=NULL",
          )
          .run(mediaId, Date.now(), Date.now());
      });
    } catch (error) {
      // Do not let stale, cancelled or deauthorized work overwrite a newer check.
      check();
      store.db
        .prepare(
          "INSERT INTO subtitle_checks(media_id,revision,checked_ms,error) VALUES(?,1,?,'Subtitle check failed; previous results retained. Verify locations, permissions and search limits.') ON CONFLICT(media_id) DO UPDATE SET revision=revision+1,checked_ms=excluded.checked_ms,error=excluded.error",
        )
        .run(mediaId, Date.now());
      if (manual) throw error;
    }
    authorize();
    return inspectSubtitles(store, media(store, mediaId), true);
  }
}
