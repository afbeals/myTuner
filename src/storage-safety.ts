import { realpathSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import type { Store } from "./database.js";
import { invariant } from "./domain.js";

export type SafetyStore = Pick<Store, "db">;
const introducedInSchema = 21;
function safetyTables(store: SafetyStore) {
  const names = store.db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('storage_safety_state','protected_source_roots')",
    )
    .all();
  const version = Number(
    store.db.prepare("PRAGMA user_version").get()?.user_version,
  );
  if (!names.length && version < introducedInSchema) return false;
  invariant(
    names.length === 2,
    409,
    "Storage safety records are unavailable; output changes are blocked",
  );
  return true;
}
export interface StorageSafetySnapshot {
  cleanupDisabled: boolean;
  outputWritesDisabled: boolean;
  resetMs: number | null;
  protectedRoots: string[];
}
function policy(store: SafetyStore) {
  if (!safetyTables(store))
    return { cleanup_disabled: 0, output_writes_disabled: 0, reset_ms: null };
  const rows = store.db
    .prepare(
      "SELECT id,cleanup_disabled,output_writes_disabled,reset_ms FROM storage_safety_state",
    )
    .all();
  invariant(
    rows.length === 1 &&
      rows[0]?.id === 1 &&
      [0, 1].includes(rows[0].cleanup_disabled as number) &&
      [0, 1].includes(rows[0].output_writes_disabled as number) &&
      (!rows[0].output_writes_disabled || rows[0].cleanup_disabled === 1),
    409,
    "Storage safety records are invalid; output changes are blocked",
  );
  return rows[0]!;
}
/** Standalone output helpers without database authority cannot reclaim old files. */
export function outputCleanupDisabled(store?: SafetyStore): boolean {
  return !store || policy(store).cleanup_disabled === 1;
}
export function assertOutputWritesAllowed(store?: SafetyStore) {
  invariant(
    !store || policy(store).output_writes_disabled !== 1,
    409,
    "Output writes are blocked because prior storage protections could not be recovered. Restore a known valid storage safety state before enabling generated, artwork, subtitle or playback-cache output.",
  );
}
export function assertOutputCleanupAllowed(store: SafetyStore) {
  invariant(
    !outputCleanupDisabled(store),
    409,
    "Output cleanup is permanently disabled after a data reset. Existing output files are preserved; configure a new dedicated empty output root when more space is needed.",
  );
}
export function readOnlySourceRoots(store: SafetyStore): string[] {
  const columns = store.db.prepare("PRAGMA table_info(sources)").all();
  const extra = ["metadata_root", "subtitle_root"].filter((name) =>
    columns.some((column) => column.name === name),
  );
  const rows = store.db
    .prepare(
      [
        "SELECT root_path AS path FROM sources",
        ...extra.map(
          (name) =>
            `SELECT ${name} AS path FROM sources WHERE ${name} IS NOT NULL`,
        ),
        ...(safetyTables(store)
          ? ["SELECT path FROM protected_source_roots"]
          : []),
      ].join(" UNION "),
    )
    .all();
  // Validate the singleton too; a corrupt/reset safety policy must never silently
  // downgrade to ordinary output behavior merely because the protected set is empty.
  outputCleanupDisabled(store);
  return rows.map((row) => {
    invariant(
      typeof row.path === "string" &&
        isAbsolute(row.path) &&
        !row.path.includes("\0"),
      409,
      "Invalid protected source root; output changes are blocked",
    );
    return row.path;
  });
}
function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const absolute = resolve(path),
      parent = dirname(absolute);
    if (parent === absolute) throw error;
    return resolve(canonical(parent), basename(absolute));
  }
}
function contains(parent: string, child: string) {
  const path = relative(parent, child);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path))
  );
}
/** Includes historical read-only roots retained across source/catalog resets. */
export function assertSafeOutputRoot(
  store: SafetyStore | undefined,
  root: string,
) {
  if (!store) return;
  const target = canonical(root);
  for (const path of readOnlySourceRoots(store)) {
    const source = canonical(path);
    invariant(
      !contains(source, target) && !contains(target, source),
      409,
      "Application storage overlaps a current or protected read-only source root",
    );
  }
}

/** Capture current roots as well as historical roots before replacing a DB. */
export function captureStorageSafety(
  store: SafetyStore,
): StorageSafetySnapshot {
  const state = policy(store);
  return {
    cleanupDisabled: state.cleanup_disabled === 1,
    outputWritesDisabled: state.output_writes_disabled === 1,
    resetMs: typeof state.reset_ms === "number" ? state.reset_ms : null,
    protectedRoots: [
      ...new Set(readOnlySourceRoots(store).map(canonical)),
    ].sort(),
  };
}
export function parseStorageSafety(value: unknown): StorageSafetySnapshot {
  invariant(
    value !== null && typeof value === "object",
    409,
    "Invalid restore storage safety record",
  );
  const record = value as Record<string, unknown>;
  invariant(
    typeof record.cleanupDisabled === "boolean" &&
      typeof record.outputWritesDisabled === "boolean" &&
      (!record.outputWritesDisabled || record.cleanupDisabled) &&
      (record.resetMs === null ||
        (typeof record.resetMs === "number" &&
          Number.isFinite(record.resetMs))) &&
      Array.isArray(record.protectedRoots) &&
      record.protectedRoots.every(
        (path) =>
          typeof path === "string" && isAbsolute(path) && !path.includes("\0"),
      ),
    409,
    "Invalid restore storage safety record",
  );
  return {
    cleanupDisabled: record.cleanupDisabled,
    outputWritesDisabled: record.outputWritesDisabled,
    resetMs: record.resetMs as number | null,
    protectedRoots: [...new Set(record.protectedRoots as string[])].sort(),
  };
}
/** Safety barriers are monotonic through normal restore, rollback and recovery. */
export function preserveStorageSafety(
  store: Pick<Store, "db" | "transaction">,
  preserved: StorageSafetySnapshot,
) {
  const previous = parseStorageSafety(preserved),
    current = captureStorageSafety(store);
  store.transaction(() => {
    for (const path of new Set([
      ...current.protectedRoots,
      ...previous.protectedRoots,
    ]))
      store.db
        .prepare(
          "INSERT INTO protected_source_roots(path) VALUES(?) ON CONFLICT(path) DO NOTHING",
        )
        .run(path);
    store.db
      .prepare(
        "UPDATE storage_safety_state SET cleanup_disabled=?,output_writes_disabled=?,reset_ms=? WHERE id=1",
      )
      .run(
        current.cleanupDisabled || previous.cleanupDisabled ? 1 : 0,
        current.outputWritesDisabled || previous.outputWritesDisabled ? 1 : 0,
        current.resetMs === null && previous.resetMs === null
          ? null
          : Math.max(current.resetMs ?? 0, previous.resetMs ?? 0),
      );
  });
}
export function combineStorageSafety(
  ...snapshots: StorageSafetySnapshot[]
): StorageSafetySnapshot {
  const values = snapshots.map(parseStorageSafety);
  const times = values.flatMap((value) =>
    value.resetMs === null ? [] : [value.resetMs],
  );
  return {
    cleanupDisabled: values.some((value) => value.cleanupDisabled),
    outputWritesDisabled: values.some((value) => value.outputWritesDisabled),
    resetMs: times.length ? Math.max(...times) : null,
    protectedRoots: [
      ...new Set(values.flatMap((value) => value.protectedRoots)),
    ].sort(),
  };
}
