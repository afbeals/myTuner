import { realpath, stat } from "node:fs/promises";
import type { Store } from "./database.js";
import type { Source } from "./domain.js";
import { invariant } from "./domain.js";
import { sourceById } from "./security.js";
import { resolve } from "node:path";
import { canonicalPath, containsPath } from "./catalog.js";
import { sourceDetails } from "./source-configuration.js";

function assertIdle(store: Store, id: string, busy: () => boolean) {
  invariant(
    !busy(),
    409,
    "Wait for the source scan to finish before editing or removing it",
  );
  invariant(
    !store.db
      .prepare(
        "SELECT 1 FROM generation_jobs WHERE source_id=? AND status IN ('queued','running')",
      )
      .get(id),
    409,
    "Cancel or finish generation jobs before editing or removing this source",
  );
}
function assertUnused(store: Store, id: string) {
  const channels = store.db
    .prepare(
      `SELECT 1 FROM schedule_revisions r WHERE instr(COALESCE(r.config_json,''),?)>0 OR EXISTS(SELECT 1 FROM media m WHERE m.source_id=? AND instr(COALESCE(r.config_json,''),m.id)>0) LIMIT 1`,
    )
    .get(id, id);
  const linked = store.db
    .prepare(
      `SELECT 1 FROM media m WHERE m.source_id=? AND (
    EXISTS(SELECT 1 FROM schedule_entries e WHERE e.media_id=m.id) OR
    EXISTS(SELECT 1 FROM channel_items c WHERE c.media_id=m.id) OR
    EXISTS(SELECT 1 FROM collection_items c WHERE c.media_id=m.id) OR
    EXISTS(SELECT 1 FROM problem_reports p WHERE p.media_id=m.id)) LIMIT 1`,
    )
    .get(id);
  invariant(
    !channels && !linked,
    409,
    "This source is referenced by channel programming, retained schedules, collections or playback reports. Keep it available until those references are removed; name and scan-scope edits remain available.",
  );
}
function clearCatalog(store: Store, id: string) {
  for (const table of [
    "generation_items",
    "generated_assets",
    "integration_metadata",
  ])
    store.db
      .prepare(
        `DELETE FROM ${table} WHERE media_id IN(SELECT id FROM media WHERE source_id=?)`,
      )
      .run(id);
  for (const table of [
    "generation_jobs",
    "display_metadata",
    "integration_runs",
    "integrations",
    "refresh_sources",
    "refresh_attempts",
    "source_grants",
  ])
    store.db.prepare(`DELETE FROM ${table} WHERE source_id=?`).run(id);
  store.db.prepare("DELETE FROM media WHERE source_id=?").run(id);
}
export function removeSource(store: Store, id: string, busy: () => boolean) {
  sourceById(store, id);
  assertIdle(store, id, busy);
  assertUnused(store, id);
  store.transaction(() => {
    clearCatalog(store, id);
    store.db.prepare("DELETE FROM sources WHERE id=?").run(id);
  });
  return { removed: true };
}
export async function editSource(
  store: Store,
  id: string,
  input: {
    revision: string;
    resetConfirmed?: boolean | undefined;
    name?: string | undefined;
    root?: string | undefined;
    kind?: Source["kind"] | undefined;
    recursive?: boolean | undefined;
  },
  writableRoots: string[],
  authorize: () => void,
  busy: () => boolean,
) {
  authorize();
  const before = sourceDetails(store, id);
  invariant(
    input.revision === before.revision,
    409,
    "Source changed elsewhere; load its saved details before saving",
  );
  assertIdle(store, id, busy);
  const changedRoot =
    input.root !== undefined && resolve(input.root) !== before.root_path;
  const root = changedRoot ? await realpath(input.root!) : before.root_path;
  if (changedRoot)
    invariant(
      (await stat(root)).isDirectory(),
      400,
      "Source must be a directory",
    );
  for (const writable of writableRoots) {
    const path = await canonicalPath(writable);
    invariant(
      !containsPath(root, path) && !containsPath(path, root),
      400,
      "Source and application storage must not overlap",
    );
  }
  const others = store.db
    .prepare(
      "SELECT root_path FROM sources WHERE id<>? UNION SELECT subtitle_root AS root_path FROM sources WHERE id<>? AND subtitle_root IS NOT NULL",
    )
    .all(id, id);
  invariant(
    !others.some(
      (row) =>
        containsPath(String(row.root_path), root) ||
        containsPath(root, String(row.root_path)),
    ),
    409,
    "Source overlaps an existing source",
  );
  authorize();
  assertIdle(store, id, busy);
  const reset =
    root !== before.root_path ||
    (input.kind !== undefined && input.kind !== before.kind);
  store.transaction(() => {
    invariant(
      sourceDetails(store, id).revision === input.revision,
      409,
      "Source changed elsewhere; load its saved details before saving",
    );
    assertIdle(store, id, busy);
    invariant(
      !reset || input.resetConfirmed === true,
      400,
      "Confirm the catalog and access reset before changing the source directory or type",
    );
    if (reset) assertUnused(store, id);
    if (reset) clearCatalog(store, id);
    store.db
      .prepare(
        "UPDATE sources SET name=?,root_path=?,kind=?,recursive=? WHERE id=?",
      )
      .run(
        input.name ?? before.name,
        root,
        input.kind ?? before.kind,
        Number(input.recursive ?? Boolean(before.recursive)),
        id,
      );
    if (reset)
      store.db
        .prepare(
          "UPDATE sources SET metadata_root=NULL,subtitle_root=NULL,subtitle_config='{}',subtitle_revision=subtitle_revision+1 WHERE id=?",
        )
        .run(id);
  });
  return { ...sourceDetails(store, id), catalogReset: reset };
}
