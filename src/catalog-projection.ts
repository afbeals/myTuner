import { setImmediate as yieldTurn } from "node:timers/promises";
import { posix } from "node:path";
import type { Store } from "./database.js";
import type { Media } from "./domain.js";
import { invariant } from "./domain.js";
import { showKey } from "./catalog-identity.js";
import {
  createCompactMediaProjector,
  type CompactMedia,
} from "./display-metadata.js";

// Bound transient input, including duplicated provider JSON and manual/NFO
// choices. Catalog size itself is not an admission limit on raw metadata.
export const projectionBatchRows = 64;
export const projectionBatchBytes = 4 * 1024 * 1024;
const compactBudget = 64 * 1024 * 1024;
const projectionRowBudget = 256 * 1024;
const format = 1;
export type ProjectionState = {
  format: number;
  generation: number;
  revision: number;
  backfill_cursor: string;
  backfill_complete: number;
  currentRevision: number;
  pending: number;
  ready: boolean;
};
export function projectionState(store: Pick<Store, "db">): ProjectionState {
  const row = store.db
    .prepare(
      `SELECT p.*,c.revision AS currentRevision,
    (SELECT COUNT(*) FROM catalog_projection_dirty_media)+(SELECT COUNT(*) FROM catalog_projection_dirty_sources)+(SELECT COUNT(*) FROM catalog_projection_dirty_shows) AS pending
    FROM catalog_projection_state p CROSS JOIN catalog_revision c WHERE p.id=1 AND c.id=1`,
    )
    .get()!;
  return {
    format: Number(row.format),
    generation: Number(row.generation),
    revision: Number(row.revision),
    backfill_cursor: String(row.backfill_cursor),
    backfill_complete: Number(row.backfill_complete),
    currentRevision: Number(row.currentRevision),
    pending: Number(row.pending),
    ready:
      Number(row.format) === format &&
      row.backfill_complete === 1 &&
      row.revision === row.currentRevision &&
      Number(row.pending) === 0,
  };
}
export function requireCatalogProjection(store: Pick<Store, "db">) {
  const state = projectionState(store);
  invariant(state.ready, 503, "Library index is updating; retry shortly");
  return state;
}
export function readCatalogProjection(
  store: Pick<Store, "db">,
  access: {
    profileId: string;
    admin: boolean;
    sourceId?: string;
    availableOnly?: boolean;
  },
  check?: () => void,
): CompactMedia[] {
  const state = requireCatalogProjection(store);
  const predicates = ["p.generation=?"],
    parameters: (string | number)[] = [state.generation];
  if (access.sourceId !== undefined) {
    predicates.push("p.source_id=?");
    parameters.push(access.sourceId);
  }
  if (access.availableOnly) predicates.push("p.available=1");
  if (!access.admin) {
    predicates.push(`EXISTS(SELECT 1 FROM source_grants g WHERE g.profile_id=? AND g.source_id=p.source_id AND
      (g.subtree='' OR p.relative_path=g.subtree OR substr(p.relative_path,1,length(g.subtree)+1)=g.subtree||'/'))`);
    parameters.push(access.profileId);
  }
  const where = predicates.join(" AND ");
  const bytes = Number(
    store.db
      .prepare(
        `SELECT COALESCE(SUM(byte_length),0) AS bytes FROM catalog_projection_rows p WHERE ${where}`,
      )
      .get(...parameters)!.bytes,
  );
  invariant(
    bytes <= compactBudget,
    503,
    "Library index budget exceeded; choose a smaller source",
  );
  const result: CompactMedia[] = [];
  for (const row of store.db
    .prepare(
      `SELECT data_json FROM catalog_projection_rows p WHERE ${where} ORDER BY p.sort_title,p.media_id`,
    )
    .iterate(...parameters)) {
    if (result.length % 128 === 0) check?.();
    result.push(JSON.parse(String(row.data_json)) as CompactMedia);
  }
  return result;
}

// Check selected-page input before materializing metadata or provider contexts.
// A small response count alone does not bound large individual JSON payloads.
export function assertHydrationBudget(
  store: Pick<Store, "db">,
  ids: readonly string[],
) {
  if (!ids.length) return;
  const values = JSON.stringify(ids),
    budget = 8 * 1024 * 1024;
  const raw = Number(
    store.db
      .prepare(
        "SELECT COALESCE(SUM(length(CAST(metadata_json AS BLOB))+length(CAST(title AS BLOB))+length(CAST(relative_path AS BLOB))+256),0) AS bytes FROM media WHERE id IN(SELECT value FROM json_each(?))",
      )
      .get(values)!.bytes,
  );
  const imported = Number(
    store.db
      .prepare(
        "SELECT COALESCE(SUM(length(CAST(metadata_json AS BLOB))),0) AS bytes FROM integration_metadata WHERE media_id IN(SELECT value FROM json_each(?))",
      )
      .get(values)!.bytes,
  );
  invariant(
    raw + imported <= budget,
    503,
    "Library page metadata budget exceeded; choose a smaller page",
  );
  const state = projectionState(store);
  const targets = ids.map((id) => `media:${id}`);
  if (state.ready) {
    for (const row of store.db
      .prepare(
        "SELECT source_id,show_key FROM catalog_projection_rows WHERE generation=? AND media_id IN(SELECT value FROM json_each(?))",
      )
      .all(state.generation, values))
      targets.push(`show:${row.source_id}:${row.show_key}`);
  } else {
    // Only synchronous in-memory compatibility callers reach this branch; raw
    // input has already passed the byte check above.
    for (const row of store.db
      .prepare(
        "SELECT * FROM media WHERE id IN(SELECT value FROM json_each(?))",
      )
      .all(values) as unknown as Media[])
      targets.push(`show:${row.source_id}:${showKey(row)}`);
  }
  const choices = Number(
    store.db
      .prepare(
        "SELECT COALESCE(SUM(length(CAST(state_json AS BLOB))+COALESCE(length(CAST(local_json AS BLOB)),0)),0) AS bytes FROM display_metadata WHERE target_key IN(SELECT value FROM json_each(?))",
      )
      .get(JSON.stringify([...new Set(targets)]))!.bytes,
  );
  invariant(
    raw + imported + choices <= budget,
    503,
    "Library page metadata budget exceeded; choose a smaller page",
  );
}
function aborted(signal?: AbortSignal) {
  signal?.throwIfAborted();
}
function inputBytes(store: Store, items: readonly Media[]) {
  if (!items.length) return 0;
  const ids = JSON.stringify(items.map((item) => item.id));
  const targets = JSON.stringify([
    ...new Set(
      items.flatMap((item) => [
        `media:${item.id}`,
        `show:${item.source_id}:${showKey(item)}`,
      ]),
    ),
  ]);
  const imported = store.db
    .prepare(
      "SELECT COALESCE(SUM(length(CAST(metadata_json AS BLOB))),0) AS bytes FROM integration_metadata WHERE media_id IN(SELECT value FROM json_each(?))",
    )
    .get(ids)!;
  const choices = store.db
    .prepare(
      "SELECT COALESCE(SUM(length(CAST(state_json AS BLOB))+COALESCE(length(CAST(local_json AS BLOB)),0)),0) AS bytes FROM display_metadata WHERE target_key IN(SELECT value FROM json_each(?))",
    )
    .get(targets)!;
  return (
    items.reduce(
      (n, item) =>
        n +
        Buffer.byteLength(item.metadata_json) +
        Buffer.byteLength(item.title) +
        Buffer.byteLength(item.relative_path) +
        256,
      0,
    ) +
    Number(imported.bytes) +
    Number(choices.bytes)
  );
}
function boundedItems(
  store: Store,
  candidates: readonly { id: string; bytes: number }[],
) {
  const ids: string[] = [];
  let bytes = 0;
  for (const candidate of candidates) {
    if (
      ids.length &&
      bytes + Number(candidate.bytes) > projectionBatchBytes / 2
    )
      break;
    invariant(
      Number(candidate.bytes) <= projectionBatchBytes,
      503,
      "A library metadata item exceeds the indexing budget",
    );
    ids.push(candidate.id);
    bytes += Number(candidate.bytes);
  }
  let items = store.db
    .prepare(
      "SELECT * FROM media WHERE id IN(SELECT value FROM json_each(?)) ORDER BY id",
    )
    .all(JSON.stringify(ids)) as unknown as Media[];
  while (inputBytes(store, items) > projectionBatchBytes) {
    invariant(
      items.length > 1,
      503,
      "A library metadata item and its provider information exceed the indexing budget",
    );
    items = items.slice(0, Math.max(1, Math.floor(items.length / 2)));
  }
  return items;
}
function memberships(item: CompactMedia) {
  const members: [string, string][] = [];
  const add = (kind: string, key: unknown[]) =>
    members.push([kind, JSON.stringify(key)]);
  const directory =
    posix.dirname(item.relativePath) === "."
      ? ""
      : posix.dirname(item.relativePath);
  add("folder", [item.sourceId, directory]);
  if (item.sourceKind === "videos" || item.sourceKind === "commercials") {
    let parent = directory;
    while (parent) {
      parent = posix.dirname(parent);
      if (parent === ".") parent = "";
      add("folder", [item.sourceId, parent]);
    }
  }
  if (item.sourceKind === "shows") {
    add("show", [item.sourceId, item.showKey]);
    add("season", [item.sourceId, item.showKey, item.season]);
  }
  if (item.sourceKind === "movies") add("movie", [item.id]);
  if (item.collectionKey !== null)
    add("movieCollection", [item.sourceId, item.collectionKey]);
  return members;
}
function applyItems(store: Store, generation: number, items: readonly Media[]) {
  const project = createCompactMediaProjector(store, items);
  const previous = store.db.prepare(
    "SELECT data_json FROM catalog_projection_rows WHERE generation=? AND media_id=?",
  );
  const save = store.db
    .prepare(`INSERT INTO catalog_projection_rows(generation,media_id,source_id,relative_path,sort_title,available,show_key,data_json,byte_length)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(generation,media_id) DO UPDATE SET source_id=excluded.source_id,relative_path=excluded.relative_path,sort_title=excluded.sort_title,available=excluded.available,show_key=excluded.show_key,data_json=excluded.data_json,byte_length=excluded.byte_length`);
  const removeMembers = store.db.prepare(
    "DELETE FROM catalog_projection_members WHERE generation=? AND media_id=?",
  );
  const addMember = store.db.prepare(
    "INSERT INTO catalog_projection_members VALUES(?,?,?,?)",
  );
  const clearDirty = store.db.prepare(
    "DELETE FROM catalog_projection_dirty_media WHERE media_id=?",
  );
  for (const item of items) {
    const compact = project(item),
      json = JSON.stringify(compact),
      bytes = Buffer.byteLength(json);
    invariant(
      bytes <= projectionRowBudget,
      503,
      "A library search item exceeds the indexing budget",
    );
    const oldJson = previous.get(generation, item.id)?.data_json;
    if (oldJson !== json) {
      save.run(
        generation,
        item.id,
        item.source_id,
        item.relative_path,
        item.title,
        item.available,
        compact.showKey,
        json,
        bytes,
      );
      const nextMembers = memberships(compact);
      if (
        oldJson === undefined ||
        JSON.stringify(
          memberships(JSON.parse(String(oldJson)) as CompactMedia),
        ) !== JSON.stringify(nextMembers)
      ) {
        removeMembers.run(generation, item.id);
        for (const [kind, key] of nextMembers)
          addMember.run(generation, item.id, kind, key);
      }
    }
    clearDirty.run(item.id);
  }
}
const pending = new WeakMap<Store, Promise<number>>();
// Only the server's Store writes. The worker uses a separate read-only snapshot;
// no transaction or metadata context survives a yield between bounded batches.
export function ensureCatalogProjection(
  store: Store,
  options: { signal?: AbortSignal } = {},
): Promise<number> {
  const existing = pending.get(store);
  if (existing) return existing;
  const task = build(store, options.signal).finally(() => {
    if (pending.get(store) === task) pending.delete(store);
  });
  pending.set(store, task);
  return task;
}
async function build(store: Store, signal?: AbortSignal): Promise<number> {
  invariant(
    !store.db.isTransaction,
    503,
    "Library indexing cannot run inside another transaction",
  );
  for (;;) {
    aborted(signal);
    const state = projectionState(store);
    invariant(
      state.format === format,
      503,
      "Library index format requires a rebuild",
    );
    if (state.ready) return state.revision;
    store.transaction(() => {
      if (!state.backfill_complete) {
        // Before the first row, every source change is already represented by
        // the upcoming scan. Later source changes retain their own queue entry.
        if (!state.backfill_cursor)
          store.db
            .prepare("DELETE FROM catalog_projection_dirty_sources")
            .run();
        const candidates = store.db
          .prepare(
            `SELECT id,length(CAST(metadata_json AS BLOB))+length(CAST(title AS BLOB))+length(CAST(relative_path AS BLOB))+256 AS bytes FROM media WHERE id>? ORDER BY id LIMIT ?`,
          )
          .all(state.backfill_cursor, projectionBatchRows) as unknown as {
          id: string;
          bytes: number;
        }[];
        if (!candidates.length)
          store.db
            .prepare(
              "UPDATE catalog_projection_state SET backfill_complete=1 WHERE id=1",
            )
            .run();
        else {
          const items = boundedItems(store, candidates);
          applyItems(store, state.generation, items);
          store.db
            .prepare(
              "UPDATE catalog_projection_state SET backfill_cursor=? WHERE id=1",
            )
            .run(items.at(-1)!.id);
        }
        return;
      }
      const source = store.db
        .prepare(
          "SELECT source_id,cursor FROM catalog_projection_dirty_sources ORDER BY source_id LIMIT 1",
        )
        .get();
      if (source) {
        const rows = store.db
          .prepare(
            "SELECT id FROM media WHERE source_id=? AND id>? ORDER BY id LIMIT ?",
          )
          .all(
            String(source.source_id),
            String(source.cursor),
            projectionBatchRows,
          );
        if (!rows.length)
          store.db
            .prepare(
              "DELETE FROM catalog_projection_dirty_sources WHERE source_id=?",
            )
            .run(String(source.source_id));
        else {
          const enqueue = store.db.prepare(
            "INSERT OR IGNORE INTO catalog_projection_dirty_media VALUES(?)",
          );
          for (const row of rows) enqueue.run(String(row.id));
          store.db
            .prepare(
              "UPDATE catalog_projection_dirty_sources SET cursor=? WHERE source_id=?",
            )
            .run(String(rows.at(-1)!.id), String(source.source_id));
        }
        return;
      }
      const show = store.db
        .prepare(
          "SELECT source_id,show_key,cursor FROM catalog_projection_dirty_shows ORDER BY source_id,show_key LIMIT 1",
        )
        .get();
      if (show) {
        const rows = store.db
          .prepare(
            "SELECT media_id FROM catalog_projection_rows WHERE generation=? AND source_id=? AND show_key=? AND media_id>? ORDER BY media_id LIMIT ?",
          )
          .all(
            state.generation,
            String(show.source_id),
            String(show.show_key),
            String(show.cursor),
            projectionBatchRows,
          );
        if (!rows.length)
          store.db
            .prepare(
              "DELETE FROM catalog_projection_dirty_shows WHERE source_id=? AND show_key=?",
            )
            .run(String(show.source_id), String(show.show_key));
        else {
          const enqueue = store.db.prepare(
            "INSERT OR IGNORE INTO catalog_projection_dirty_media VALUES(?)",
          );
          for (const row of rows) enqueue.run(String(row.media_id));
          store.db
            .prepare(
              "UPDATE catalog_projection_dirty_shows SET cursor=? WHERE source_id=? AND show_key=?",
            )
            .run(
              String(rows.at(-1)!.media_id),
              String(show.source_id),
              String(show.show_key),
            );
        }
        return;
      }
      const dirty = store.db
        .prepare(
          `SELECT d.media_id,m.id,length(CAST(m.metadata_json AS BLOB))+length(CAST(m.title AS BLOB))+length(CAST(m.relative_path AS BLOB))+256 AS bytes
        FROM catalog_projection_dirty_media d LEFT JOIN media m ON m.id=d.media_id ORDER BY d.media_id LIMIT ?`,
        )
        .all(projectionBatchRows);
      if (dirty.length) {
        for (const row of dirty)
          if (row.id === null) {
            store.db
              .prepare(
                "DELETE FROM catalog_projection_rows WHERE generation=? AND media_id=?",
              )
              .run(state.generation, String(row.media_id));
            store.db
              .prepare(
                "DELETE FROM catalog_projection_members WHERE generation=? AND media_id=?",
              )
              .run(state.generation, String(row.media_id));
            store.db
              .prepare(
                "DELETE FROM catalog_projection_dirty_media WHERE media_id=?",
              )
              .run(String(row.media_id));
          }
        const candidates = dirty
          .filter((row) => row.id !== null)
          .map((row) => ({ id: String(row.id), bytes: Number(row.bytes) }));
        if (candidates.length)
          applyItems(store, state.generation, boundedItems(store, candidates));
        return;
      }
      // Publication is atomic with the empty-queue check. Main-thread writes
      // cannot interleave here; readers additionally hold/check catalog revision.
      store.db
        .prepare(
          "UPDATE catalog_projection_state SET revision=(SELECT revision FROM catalog_revision WHERE id=1) WHERE id=1",
        )
        .run();
    });
    await yieldTurn(undefined, signal ? { signal } : undefined);
  }
}
