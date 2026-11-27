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
interface ProjectionContext {
  sources: Map<string, Source>;
  imports: Map<
    string,
    { provider: string; external_id: string; metadata_json: string }[]
  >;
  settings: Map<string, Record<string, unknown>>;
  refresh: Map<string, Record<string, unknown>>;
  saved: Map<string, Saved>;
}
function projectionContext(store: Store, items?: readonly Media[]) {
  const sourceIds = [...new Set(items?.map((item) => item.source_id))];
  const ids = [...new Set(items?.map((item) => item.id))];
  const targets = items
    ? [
        ...new Set(
          items.flatMap((item) => [
            `media:${item.id}`,
            `show:${item.source_id}:${showKey(item)}`,
          ]),
        ),
      ]
    : [];
  // JSON array parameters avoid variable-count limits for large selections. For
  // detail pages, provider/manual metadata belonging to other sources is unread.
  const scoped = (column: string, values: string[]) =>
    items ? ` WHERE ${column} IN (SELECT value FROM json_each(?))` : "";
  const read = (sql: string, values: string[]) =>
    store.db.prepare(sql).all(...(items ? [JSON.stringify(values)] : []));
  const context: ProjectionContext = {
    sources: new Map(
      (
        read(
          "SELECT * FROM sources" + scoped("id", sourceIds),
          sourceIds,
        ) as unknown as Source[]
      ).map((row) => [row.id, row]),
    ),
    imports: new Map(),
    settings: new Map(
      read(
        "SELECT source_id,provider,last_success FROM integrations" +
          scoped("source_id", sourceIds),
        sourceIds,
      ).map((row) => [String(row.source_id), row]),
    ),
    refresh: new Map(
      read(
        "SELECT source_id,last_error FROM refresh_sources" +
          scoped("source_id", sourceIds),
        sourceIds,
      ).map((row) => [String(row.source_id), row]),
    ),
    saved: new Map(
      (
        read(
          "SELECT * FROM display_metadata" + scoped("target_key", targets),
          targets,
        ) as unknown as (Saved & { target_key: string })[]
      ).map((row) => [row.target_key, row]),
    ),
  };
  for (const row of read(
    "SELECT media_id,provider,external_id,metadata_json FROM integration_metadata" +
      scoped("media_id", ids) +
      " ORDER BY provider,external_id",
    ids,
  )) {
    const id = String(row.media_id),
      rows = context.imports.get(id) ?? [];
    rows.push(
      row as unknown as {
        provider: string;
        external_id: string;
        metadata_json: string;
      },
    );
    context.imports.set(id, rows);
  }
  return context;
}
export function createMediaProjector(store: Store, items?: readonly Media[]) {
  const context = projectionContext(store, items);
  const projected = new Map<string, Media>();
  return (item: Media) => {
    let value = projected.get(item.id);
    if (!value) {
      value = displayMedia(store, item, context);
      // Repeated guide/program references benefit from memoization; a whole
      // catalog pass must not retain another full projected catalog in memory.
      if (projected.size >= 256)
        projected.delete(projected.keys().next().value!);
      projected.set(item.id, value);
    }
    return value;
  };
}
// The browse read model needs display/group fields, never another copy of the
// provider description/technical JSON. Keep the same resolver and identity rules.
export function createCompactMediaProjector(
  store: Store,
  items: readonly Media[],
) {
  const context = projectionContext(store, items);
  return (item: Media) => {
    const raw = JSON.parse(item.metadata_json);
    const key = showKey(item);
    const source = projectionSource(store, item.source_id, context);
    const info = inspectMetadata(
      store,
      { kind: "media", mediaId: item.id },
      [item],
      context,
    );
    const series =
      source.kind === "shows" ||
      raw.seriesTitle !== undefined ||
      raw.seriesId !== undefined
        ? (inspectMetadata(
            store,
            { kind: "show", sourceId: item.source_id, key },
            [item],
            context,
          ).effective.title.value ?? raw.seriesTitle)
        : raw.seriesTitle;
    const title = info.effective.title.value || item.title;
    const fields = [
      ...new Set(
        [
          title,
          item.title,
          item.relative_path,
          series ?? "",
          raw.seriesTitle ?? "",
          raw.collection?.title ?? "",
          source.name,
        ]
          .filter(Boolean)
          .map((value: string) => value.toLocaleLowerCase()),
      ),
    ];
    return {
      id: item.id,
      sourceId: item.source_id,
      relativePath: item.relative_path,
      storedTitle: item.title,
      title,
      available: item.available,
      sourceKind: source.kind,
      showKey: key,
      season: raw.seasonNumber ?? 1,
      seriesTitle: series,
      collectionKey: raw.collection
        ? String(raw.collection.tmdbId ?? raw.collection.title)
        : null,
      collectionTitle: raw.collection?.title,
      artworkTypes: ((raw.images ?? []) as { coverType: string }[]).map(
        (image) => image.coverType,
      ),
      fields,
      mediaFields: [
        title.toLowerCase(),
        item.relative_path.toLowerCase(),
        String(series ?? "").toLowerCase(),
      ],
    };
  };
}
export type CompactMedia = ReturnType<
  ReturnType<typeof createCompactMediaProjector>
>;
function projectionSource(
  store: Store,
  id: string,
  context?: ProjectionContext,
) {
  return context?.sources.get(id) ?? sourceById(store, id);
}
function currentIntegration(
  store: Store,
  item: Media,
  context?: ProjectionContext,
) {
  const rows = (
    context
      ? (context.imports.get(item.id) ?? [])
      : store.db
          .prepare(
            "SELECT provider,external_id,metadata_json FROM integration_metadata WHERE media_id=? ORDER BY provider,external_id",
          )
          .all(item.id)
  ) as { provider: string; external_id: string; metadata_json: string }[];
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
function identity(
  store: Store,
  target: MetadataTarget,
  items: Media[],
  context?: ProjectionContext,
) {
  if (target.kind === "show") return metadataTargetKey(target);
  const item = items[0]!;
  const imported = currentIntegration(store, item, context);
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
  context?: ProjectionContext,
) {
  const item = items[0]!,
    raw = JSON.parse(item.metadata_json);
  const imported = currentIntegration(store, item, context);
  const config = context
    ? context.settings.get(item.source_id)
    : store.db
        .prepare(
          "SELECT provider,last_success FROM integrations WHERE source_id=?",
        )
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
  const refresh = context
    ? context.refresh.get(item.source_id)
    : store.db
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
    projectionSource(store, item.source_id, context).metadata_root ??
    projectionSource(store, item.source_id, context).root_path;
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
  context?: ProjectionContext,
) {
  const items = knownItems ?? targetItems(store, target);
  invariant(items.length, 404, "Content not found");
  const key = metadataTargetKey(target),
    currentIdentity = identity(store, target, items, context);
  const row = (context
    ? context.saved.get(key)
    : store.db
        .prepare("SELECT * FROM display_metadata WHERE target_key=?")
        .get(key)) as unknown as Saved | undefined;
  const same = !row || row.identity === currentIdentity;
  const saved = same ? row : undefined;
  const choices: Choices = saved ? JSON.parse(saved.state_json) : defaults();
  const c = candidates(store, target, items, saved, context);
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
    revision: context
      ? ""
      : hash([
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
export function displayMedia(
  store: Store,
  item: Media,
  context?: ProjectionContext,
): Media {
  const info = inspectMetadata(
    store,
    { kind: "media", mediaId: item.id },
    [item],
    context,
  );
  const raw = JSON.parse(item.metadata_json);
  if (
    projectionSource(store, item.source_id, context).kind === "shows" ||
    raw.seriesTitle !== undefined ||
    raw.seriesId !== undefined
  ) {
    const show = inspectMetadata(
      store,
      { kind: "show", sourceId: item.source_id, key: showKey(item) },
      [item],
      context,
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
  const info = inspectMetadata(store, target);
  const previous = info.requiresReview
    ? store.db
        .prepare(
          "SELECT identity,state_json,checked_ms FROM display_metadata WHERE target_key=?",
        )
        .get(metadataTargetKey(target))
    : undefined;
  return {
    ...info,
    retained: previous
      ? {
          choices: metadataChoicesSchema.parse(
            JSON.parse(String(previous.state_json)),
          ),
          identity: String(previous.identity),
          checkedMs: previous.checked_ms ?? null,
        }
      : null,
  };
}
