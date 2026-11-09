import { createHash } from "node:crypto";
import { lstat, opendir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Store } from "./database.js";
import type { Media } from "./domain.js";
import { invariant } from "./domain.js";
import { safeMediaPath } from "./catalog.js";
import { assetFingerprint } from "./generation.js";
import type { AssetKind } from "./generation.js";

type Row = Media & {
  asset_id: string;
  asset_path: string;
  asset_fingerprint: string;
  kind: AssetKind;
};
interface File {
  size: number;
  mtimeMs: number;
}
interface Action {
  path: string;
  reason: "stale" | "missing" | "orphan" | "interrupted";
  assetId: string | null;
  file: File | null;
  identity: string | null;
}
const owned =
  /^[a-f0-9-]{36}\/[a-f0-9]{64}\/(thumbnail\.jpg|gif\.gif|conversion\.mp4)$/;
const partial =
  /^[a-f0-9-]{36}\/[a-f0-9]{64}\/\.partial-[a-f0-9-]{36}\.(jpg|gif|mp4)$/;
function identity(row: Row) {
  return JSON.stringify([
    row.asset_id,
    row.asset_path,
    row.asset_fingerprint,
    row.available,
    row.size,
    row.mtime_ms,
  ]);
}

// The caller excludes generation for the whole review/apply operation. No source path is walked or changed.
export async function reconcileAssets(
  store: Store,
  root: string,
  dryRun: boolean,
  review: string | undefined,
  check: () => void,
) {
  check();
  const files = new Map<string, File>();
  let count = 0;
  async function walk(relative: string, depth: number) {
    let directory;
    try {
      directory = await opendir(join(root, relative));
    } catch (error) {
      if (
        !relative &&
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return;
      throw error;
    }
    for await (const entry of directory) {
      check();
      invariant(
        ++count <= 10000,
        422,
        "Output reconciliation exceeds 10,000 entries; operator review required",
      );
      const rel = relative ? `${relative}/${entry.name}` : entry.name,
        info = await lstat(join(root, rel));
      invariant(
        !info.isSymbolicLink(),
        409,
        "Output reconciliation refuses symbolic links",
      );
      if (info.isDirectory()) {
        invariant(depth < 3, 409, "Unexpected nested output directory");
        await walk(rel, depth + 1);
      } else if (info.isFile())
        files.set(rel, { size: info.size, mtimeMs: info.mtimeMs });
      else invariant(false, 409, "Unexpected output entry");
    }
  }
  await walk("", 0);
  check();
  const rows = store.db
    .prepare(
      "SELECT m.*,a.id AS asset_id,a.kind,a.relative_path AS asset_path,a.fingerprint AS asset_fingerprint FROM generated_assets a JOIN media m ON m.id=a.media_id ORDER BY a.id LIMIT 10001",
    )
    .all() as unknown as Row[];
  invariant(
    rows.length <= 10000,
    422,
    "Output reference reconciliation exceeds 10,000 rows",
  );
  const actions: Action[] = [],
    referenced = new Set(rows.map((row) => row.asset_path));
  for (const row of rows) {
    invariant(
      owned.test(row.asset_path),
      409,
      "Output reference is outside managed layout",
    );
    const file = files.get(row.asset_path) ?? null;
    if (
      !row.available ||
      assetFingerprint(row, row.kind) !== row.asset_fingerprint
    )
      actions.push({
        path: row.asset_path,
        reason: "stale",
        assetId: row.asset_id,
        file,
        identity: identity(row),
      });
    else if (!file)
      actions.push({
        path: row.asset_path,
        reason: "missing",
        assetId: row.asset_id,
        file: null,
        identity: identity(row),
      });
  }
  for (const [path, file] of files) {
    if (!referenced.has(path) && owned.test(path))
      actions.push({
        path,
        reason: "orphan",
        file,
        assetId: null,
        identity: null,
      });
    else if (partial.test(path) && file.mtimeMs < Date.now() - 3600000)
      actions.push({
        path,
        reason: "interrupted",
        file,
        assetId: null,
        identity: null,
      });
  }
  actions.sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      String(a.assetId).localeCompare(String(b.assetId)),
  );
  const token = createHash("sha256")
    .update(JSON.stringify(actions))
    .digest("hex");
  const report = {
    dryRun,
    review: token,
    scannedEntries: count,
    staleAssets: actions.filter((a) => a.reason === "stale").length,
    missingReferences: actions.filter((a) => a.reason === "missing").length,
    orphanFiles: actions.filter((a) => a.reason === "orphan").length,
    interruptedFiles: actions.filter((a) => a.reason === "interrupted").length,
    preservedUnknownFiles: [...files.keys()].filter(
      (path) => !owned.test(path) && !partial.test(path),
    ).length,
    reclaimableBytes: actions.reduce((sum, a) => sum + (a.file?.size ?? 0), 0),
    removedFiles: 0,
    removedReferences: 0,
  };
  if (dryRun) return report;
  invariant(
    review === token,
    409,
    "Output storage changed; review reconciliation again before applying",
  );
  for (const action of actions) {
    check();
    const current = await lstat(join(root, action.path)).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    invariant(
      action.file
        ? current?.isFile() &&
            !current.isSymbolicLink() &&
            current.size === action.file.size &&
            current.mtimeMs === action.file.mtimeMs
        : current === null,
      409,
      "Output changed during reconciliation; review again",
    );
    if (action.assetId) {
      const row = store.db
        .prepare(
          "SELECT m.*,a.id AS asset_id,a.kind,a.relative_path AS asset_path,a.fingerprint AS asset_fingerprint FROM generated_assets a JOIN media m ON m.id=a.media_id WHERE a.id=?",
        )
        .get(action.assetId) as Row | undefined;
      invariant(
        row && identity(row) === action.identity,
        409,
        "Output reference changed; review again",
      );
    } else
      invariant(
        !store.db
          .prepare("SELECT id FROM generated_assets WHERE relative_path=?")
          .get(action.path),
        409,
        "Output became referenced; review again",
      );
    if (current) {
      const path = await safeMediaPath(
        {
          id: "",
          name: "",
          kind: "videos",
          recursive: 1,
          root_path: await realpath(root),
        },
        action.path,
      );
      check();
      await rm(path);
      report.removedFiles++;
    }
    check();
    if (action.assetId) {
      store.db
        .prepare("DELETE FROM generated_assets WHERE id=?")
        .run(action.assetId);
      report.removedReferences++;
    }
  }
  return report;
}
