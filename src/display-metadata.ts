import { createHash } from "node:crypto";
import { extname, posix } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import type { Store } from "./database.js";
import type { Account, Media, Source } from "./domain.js";
import { invariant } from "./domain.js";
import {
  canReadMedia,
  requireProfile,
  requireAdmin,
  refreshAccount,
  sourceById,
} from "./security.js";
import { showKey } from "./catalog-identity.js";
import { safeMediaPath } from "./catalog.js";

export const metadataTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("media"), mediaId: z.string().uuid() }).strict(),
  z
    .object({
      kind: z.literal("show"),
      sourceId: z.string().uuid(),
      key: z.string().min(1).max(500),
    })
    .strict(),
]);
export type MetadataTarget = z.infer<typeof metadataTargetSchema>;
export const fieldChoiceSchema = z
  .object({
    source: z.enum(["automatic", "integration", "local", "manual"]),
    manual: z.string().max(20000).optional(),
  })
  .strict();
export const metadataChoicesSchema = z
  .object({
    title: fieldChoiceSchema.extend({ manual: z.string().max(500).optional() }),
    description: fieldChoiceSchema,
  })
  .strict();
type Choices = z.infer<typeof metadataChoicesSchema>;
type Values = { title?: string; description?: string };
type Candidate = {
  values: Values;
  status: string;
  reference?: string;
  fingerprint?: string;
  checkedMs?: number;
  location?: string;
};
type Saved = {
  revision: number;
  identity: string;
  state_json: string;
  local_json: string | null;
  checked_ms: number | null;
};
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const text = (v: unknown) =>
  typeof v === "string" ? v.slice(0, 20000) : undefined;
const defaults = (): Choices => ({
  title: { source: "automatic" },
  description: { source: "automatic" },
});
export function metadataTargetKey(target: MetadataTarget) {
  return target.kind === "media"
    ? `media:${target.mediaId}`
    : `show:${target.sourceId}:${target.key}`;
}
function targetItems(store: Store, target: MetadataTarget): Media[] {
  if (target.kind === "media") {
    const row = store.db
      .prepare("SELECT * FROM media WHERE id=?")
      .get(target.mediaId) as unknown as Media | undefined;
    return row ? [row] : [];
  }
  return (
    store.db
      .prepare(
        "SELECT * FROM media WHERE source_id=? ORDER BY relative_path,id",
      )
      .all(target.sourceId) as unknown as Media[]
  ).filter((i) => showKey(i) === target.key);
}
function currentIntegration(store: Store, item: Media) {
  const rows = store.db
    .prepare(
      "SELECT provider,external_id,metadata_json FROM integration_metadata WHERE media_id=? ORDER BY provider,external_id",
    )
    .all(item.id) as {
    provider: string;
    external_id: string;
    metadata_json: string;
  }[];
  const raw = JSON.parse(item.metadata_json),
    ref = raw.integrationReference;
  if (ref)
    return rows.find(
      (r) => r.provider === ref.provider && r.external_id === ref.externalId,
    );
  // Pre-reference catalogs retain the latest imported projection on media. Match
  // its upstream fields while ignoring local/technical data changed by rescans.
  const localKeys = new Set([
    "local",
    "localNfoValid",
    "technical",
    "integrationReference",
  ]);
  return (
    rows.find((r) =>
      Object.entries(JSON.parse(r.metadata_json))
        .filter(([key]) => !localKeys.has(key))
        .every(
          ([key, value]) => JSON.stringify(raw[key]) === JSON.stringify(value),
        ),
    ) ?? rows[0]
  );
}
function identity(store: Store, target: MetadataTarget, items: Media[]) {
  if (target.kind === "show") return metadataTargetKey(target);
  const item = items[0]!;
  const imported = currentIntegration(store, item);
  return hash(
    imported
      ? [
          item.source_id,
          [{ provider: imported.provider, external_id: imported.external_id }],
        ]
      : [item.source_id, item.relative_path, item.size, item.mtime_ms],
  );
}
function authorized(
  store: Store,
  actor: Account,
  profileId: string,
  target: MetadataTarget,
) {
  const current = refreshAccount(store, actor);
  requireAdmin(current);
  requireProfile(store, current, profileId);
  const items = targetItems(store, target);
  invariant(
    items.length &&
      items.every((i) => canReadMedia(store, current, profileId, i)),
    404,
    "Content not found",
  );
  return items;
}
function candidates(
  store: Store,
  target: MetadataTarget,
  items: Media[],
  saved?: Saved,
) {
  const item = items[0]!,
    raw = JSON.parse(item.metadata_json);
  const imported = currentIntegration(store, item);
  const config = store.db
    .prepare("SELECT provider,last_success FROM integrations WHERE source_id=?")
    .get(item.source_id);
  const data = imported ? JSON.parse(String(imported.metadata_json)) : null;
  const episode = data?.episodes as
    { title?: string; overview?: string }[] | undefined;
  const values: Values = data
    ? target.kind === "show"
      ? {
          title: text(data.seriesTitle),
          description: text(data.seriesOverview ?? data.overview),
        }
      : (data.displayCandidate ??
        (episode?.length
          ? {
              title: episode
                .map((e) => e.title)
                .filter(Boolean)
                .join(" / "),
              description:
                episode
                  .map((e) => e.overview)
                  .filter(Boolean)
                  .join("\n\n") || undefined,
            }
          : {
              title: text(data.title ?? item.title),
              description: text(data.overview),
            }))
    : {};
  const refresh = store.db
    .prepare("SELECT last_error FROM refresh_sources WHERE source_id=?")
    .get(item.source_id);
  const integration: Candidate = {
    values,
    status: data
      ? refresh?.last_error || !config
        ? "stale"
        : "available"
      : config
        ? "not-imported"
        : "not-linked",
    ...(config ? { reference: String(config.provider) } : {}),
  };
  const local: Candidate = saved?.local_json
    ? JSON.parse(saved.local_json)
    : target.kind === "media" && raw.localNfoValid
      ? {
          values: {
            title: text(raw.local?.title),
            description: text(raw.local?.overview),
          },
          status: "available",
          reference: item.relative_path.replace(/\.[^.]+$/, ".nfo"),
        }
      : { values: {}, status: "not-checked" };
  const location =
    sourceById(store, item.source_id).metadata_root ??
    sourceById(store, item.source_id).root_path;
  if (local.location && local.location !== location)
    local.status = "stale-location";
  const fallback: Values = {
    title:
      target.kind === "show"
        ? (text(raw.seriesTitle) ??
          posix.basename(
            posix
              .dirname(item.relative_path)
              .replace(/\/Season[ ._-]*\d+$/i, ""),
          ))
        : text(raw.local?.title)?.trim() ||
          item.title.trim() ||
          posix
            .basename(item.relative_path, extname(item.relative_path))
            .replace(/[._]/g, " ")
            .trim(),
    description: "",
  };
  return { integration, local, fallback };
}
export function inspectMetadata(
  store: Store,
  target: MetadataTarget,
  knownItems?: Media[],
) {
  const items = knownItems ?? targetItems(store, target);
  invariant(items.length, 404, "Content not found");
  const key = metadataTargetKey(target),
    currentIdentity = identity(store, target, items);
  const row = store.db
    .prepare("SELECT * FROM display_metadata WHERE target_key=?")
    .get(key) as unknown as Saved | undefined;
  const same = !row || row.identity === currentIdentity;
  const saved = same ? row : undefined;
  const choices: Choices = saved ? JSON.parse(saved.state_json) : defaults();
  const c = candidates(store, target, items, saved);
  const resolve = (field: "title" | "description") => {
    const choice = choices[field];
    if (choice.source === "manual")
      return {
        value: choice.manual ?? "",
        source: "manual",
        status: "available",
      };
    if (choice.source !== "automatic")
      return {
        value: c[choice.source].values[field] ?? null,
        source: choice.source,
        status:
          c[choice.source].values[field] === undefined
            ? "unavailable"
            : c[choice.source].status,
      };
    for (const source of ["integration", "local"] as const) {
      const value = c[source].values[field];
      if (value !== undefined && (field === "description" || value.trim()))
        return { value, source, status: c[source].status };
    }
    return {
      value: c.fallback[field] ?? "",
      source: "filename",
      status: "available",
    };
  };
  return {
    target,
    revision: hash([
      row?.revision ?? 0,
      choices,
      currentIdentity,
      sourceById(store, items[0]!.source_id).metadata_root ?? null,
      c,
    ]),
    choices,
    candidates: c,
    effective: { title: resolve("title"), description: resolve("description") },
    requiresReview: !same,
  };
}
export function displayMedia(store: Store, item: Media): Media {
  const info = inspectMetadata(store, { kind: "media", mediaId: item.id }, [
    item,
  ]);
  const raw = JSON.parse(item.metadata_json);
  if (
    sourceById(store, item.source_id).kind === "shows" ||
    raw.seriesTitle !== undefined ||
    raw.seriesId !== undefined
  ) {
    const show = inspectMetadata(
      store,
      { kind: "show", sourceId: item.source_id, key: showKey(item) },
      [item],
    );
    raw.seriesTitle = show.effective.title.value ?? raw.seriesTitle;
    raw.seriesOverview = show.effective.description.value;
  }
  raw.overview = info.effective.description.value ?? "";
  return {
    ...item,
    title: info.effective.title.value || item.title,
    metadata_json: JSON.stringify(raw),
  };
}

const parser = new XMLParser({
  ignoreAttributes: true,
  processEntities: false,
  parseTagValue: false,
});
export async function checkMetadataFiles(
  store: Store,
  actor: Account,
  profileId: string,
  target: MetadataTarget,
): Promise<Candidate> {
  const items = authorized(store, actor, profileId, target),
    item = items[0]!,
    source = sourceById(store, item.source_id);
  const root: Source = {
    ...source,
    root_path: source.metadata_root ?? source.root_path,
  };
  const directory = posix.dirname(item.relative_path);
  let paths: string[];
  if (target.kind === "show") {
    const dirs = new Set(
      items.map(
        (i) =>
          posix
            .dirname(i.relative_path)
            .replace(/(?:^|\/)Season[ ._-]*\d+$/i, "") || ".",
      ),
    );
    invariant(
      dirs.size === 1,
      409,
      "Show metadata directory is ambiguous; use manual information",
    );
    paths = [posix.join([...dirs][0]!, "tvshow.nfo")];
  } else {
    paths = [
      item.relative_path.slice(0, -extname(item.relative_path).length) + ".nfo",
    ];
    const count = (
      store.db
        .prepare("SELECT relative_path FROM media WHERE source_id=?")
        .all(item.source_id) as { relative_path: string }[]
    ).filter((i) => posix.dirname(i.relative_path) === directory).length;
    if (source.kind === "movies" && count === 1)
      paths.push(posix.join(directory, "movie.nfo"));
    if (source.kind !== "movies" && count === 1)
      paths.push(posix.join(directory, "episode.nfo"));
  }
  let failure = "no-file";
  for (const path of new Set(paths)) {
    try {
      const safe = await safeMediaPath(root, path),
        before = await stat(safe);
      invariant(before.size <= 256 * 1024, 422, "Metadata file is too large");
      const bytes = await readFile(safe);
      const after = await stat(safe);
      invariant(
        before.size === after.size &&
          before.mtimeMs === after.mtimeMs &&
          bytes.length <= 256 * 1024,
        409,
        "Metadata changed during check",
      );
      const xml = bytes.toString("utf8");
      invariant(
        !/<!DOCTYPE|<!ENTITY/i.test(xml) && XMLValidator.validate(xml) === true,
        422,
        "Invalid metadata XML",
      );
      const parsed = parser.parse(xml);
      const data =
        target.kind === "show"
          ? parsed.tvshow
          : (parsed.movie ?? parsed.episodedetails);
      invariant(
        data && typeof data === "object",
        422,
        "Unsupported metadata scope",
      );
      const values: Values = {
        ...(typeof data.title === "string"
          ? { title: data.title.slice(0, 20000) }
          : {}),
        ...(typeof data.plot === "string"
          ? { description: data.plot.slice(0, 20000) }
          : {}),
      };
      authorized(store, actor, profileId, target);
      return {
        values,
        status: "available",
        reference: path,
        fingerprint: hash([
          source.metadata_root ?? source.root_path,
          path,
          bytes.toString("base64"),
        ]),
        checkedMs: Date.now(),
        location: root.root_path,
      };
    } catch (e) {
      if (!(e instanceof Error && "code" in e && e.code === "ENOENT"))
        failure = "read-failed";
    }
  }
  authorized(store, actor, profileId, target);
  return {
    values: {},
    status: failure,
    reference: paths[0]!,
    checkedMs: Date.now(),
    location: root.root_path,
  };
}
export async function saveMetadata(
  store: Store,
  actor: Account,
  profileId: string,
  target: MetadataTarget,
  revision: string,
  choices: Choices,
  localFingerprint?: string | null,
) {
  const items = authorized(store, actor, profileId, target);
  const before = inspectMetadata(store, target);
  invariant(
    before.revision === revision,
    409,
    "Content changed elsewhere; review the latest information before saving",
  );
  invariant(
    choices.title.source !== "manual" || Boolean(choices.title.manual?.trim()),
    400,
    "Manual title must not be empty",
  );
  let local: Candidate | undefined;
  if (localFingerprint !== undefined) {
    local = await checkMetadataFiles(store, actor, profileId, target);
    invariant(
      (local.fingerprint ?? null) === localFingerprint,
      409,
      "Metadata file changed; check it again before saving",
    );
    if (local.status !== "available")
      local.values = before.candidates.local.values;
  }
  authorized(store, actor, profileId, target);
  store.transaction(() => {
    invariant(
      inspectMetadata(store, target).revision === revision,
      409,
      "Content changed elsewhere; review the latest information before saving",
    );
    store.db
      .prepare(
        `INSERT INTO display_metadata(target_key,source_id,identity,state_json,local_json,checked_ms,revision) VALUES(?,?,?,?,?,?,1)
      ON CONFLICT(target_key) DO UPDATE SET revision=revision+1,identity=excluded.identity,state_json=excluded.state_json,local_json=CASE WHEN display_metadata.identity=excluded.identity THEN COALESCE(excluded.local_json,local_json) ELSE excluded.local_json END,checked_ms=CASE WHEN display_metadata.identity=excluded.identity THEN COALESCE(excluded.checked_ms,checked_ms) ELSE excluded.checked_ms END`,
      )
      .run(
        metadataTargetKey(target),
        items[0]!.source_id,
        identity(store, target, items),
        JSON.stringify(choices),
        local ? JSON.stringify(local) : null,
        local?.checkedMs ?? null,
      );
  });
  return inspectMetadata(store, target);
}
export function inspectAuthorizedMetadata(
  store: Store,
  actor: Account,
  profileId: string,
  target: MetadataTarget,
) {
  authorized(store, actor, profileId, target);
  return inspectMetadata(store, target);
}
