import {
  assertOutputCleanupAllowed,
  assertSafeOutputRoot,
  readOnlySourceRoots,
} from "./storage-safety.js";
import { readdir, lstat, statfs, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Store } from "./database.js";
import { canonicalPath, containsPath, safeMediaPath } from "./catalog.js";
import { invariant } from "./domain.js";
import type { Media } from "./domain.js";
import { assetFingerprint } from "./generation.js";
import type { AssetKind } from "./generation.js";
export async function directoryBytes(
  root: string,
  check: () => void = () => {},
): Promise<number> {
  let total = 0,
    entries = 0;
  async function walk(path: string) {
    check();
    for (const name of await readdir(path)) {
      check();
      invariant(
        ++entries <= 100000,
        507,
        "Application output exceeds 100,000 entries; reconcile a narrower output root",
      );
      const child = join(path, name),
        info = await lstat(child);
      invariant(
        !info.isSymbolicLink(),
        409,
        "Application output contains a symbolic link",
      );
      if (info.isDirectory()) await walk(child);
      else if (info.isFile()) total += info.size;
    }
  }
  await walk(root);
  return total;
}
export async function availableOutputBytes(
  root: string,
  maxBytes: number,
  reserveBytes: number,
): Promise<number> {
  const [fs, used] = await Promise.all([statfs(root), directoryBytes(root)]);
  return Math.floor(
    Math.min(maxBytes - used, fs.bavail * fs.bsize - reserveBytes),
  );
}
/** Short-lived accounting for the sole generator; statfs remains fresh per output.
 * Rebuild after restart, maintenance, failures, 64 outputs or 30 seconds. External
 * writers can race any quota check; dedicated roots and filesystem free space
 * remain necessary, just as with a full traversal before every encode.
 */
export class OutputBudget {
  private used: number | null = null;
  private checkedAt = 0;
  private publications = 0;
  private reserved = 0;
  constructor(private readonly root: string) {}
  invalidate() {
    this.used = null;
  }
  async reserve(maxBytes: number, reserveBytes: number, check: () => void) {
    check();
    if (
      this.used === null ||
      this.publications >= 64 ||
      Date.now() - this.checkedAt >= 30000
    ) {
      this.used = await directoryBytes(this.root, check);
      this.checkedAt = Date.now();
      this.publications = 0;
    }
    const fs = await statfs(this.root);
    check();
    const bytes = Math.floor(
      Math.min(
        maxBytes - this.used - this.reserved,
        fs.bavail * fs.bsize - reserveBytes - this.reserved,
        5 * 1024 ** 3,
      ),
    );
    invariant(
      bytes > 1024 * 1024,
      507,
      "Insufficient generated output space or quota",
    );
    this.reserved += bytes;
    let finished = false;
    return {
      bytes,
      finish: (delta?: number) => {
        if (finished) return;
        finished = true;
        this.reserved -= bytes;
        if (delta === undefined) this.invalidate();
        else if (this.used !== null) {
          this.used = Math.max(0, this.used + delta);
          this.publications++;
        }
      },
    };
  }
}
export async function validateStorage(
  store: Pick<Store, "db">,
  roots: string[],
  generated: string,
  cache: string,
) {
  const sources = readOnlySourceRoots(store);
  for (const root of roots) {
    const path = await canonicalPath(root);
    for (const source of sources) {
      const src = await canonicalPath(source);
      invariant(
        !containsPath(src, path) && !containsPath(path, src),
        409,
        "Application storage overlaps a media source",
      );
    }
  }
  const [a, b] = await Promise.all([
    canonicalPath(generated),
    canonicalPath(cache),
  ]);
  invariant(
    !containsPath(a, b) && !containsPath(b, a),
    409,
    "Generated output and playback cache must not overlap",
  );
}
export async function cleanupAssets(store: Store, root: string, dryRun = true) {
  assertSafeOutputRoot(store, root);
  if (!dryRun) assertOutputCleanupAllowed(store);
  const rows = store.db
    .prepare(
      "SELECT a.id AS asset_id,a.kind,a.fingerprint,a.relative_path AS asset_path,m.* FROM generated_assets a JOIN media m ON m.id=a.media_id",
    )
    .all() as unknown as (Media & {
    asset_id: string;
    kind: AssetKind;
    fingerprint: string;
    asset_path: string;
  })[];
  const candidates = rows.filter(
    (r) => !r.available || r.fingerprint !== assetFingerprint(r, r.kind),
  );
  let removed = 0;
  for (const row of candidates) {
    if (!dryRun) {
      assertOutputCleanupAllowed(store);
      try {
        const path = await safeMediaPath(
          {
            ...{ id: "", name: "", kind: "videos" as const, recursive: 1 },
            root_path: await realpath(root),
          },
          row.asset_path,
        );
        assertSafeOutputRoot(store, root);
        assertOutputCleanupAllowed(store);
        await rm(path);
      } catch (e) {
        if (!(e instanceof Error && "code" in e && e.code === "ENOENT"))
          throw e;
      }
      store.db
        .prepare("DELETE FROM generated_assets WHERE id=?")
        .run(row.asset_id);
      removed++;
    }
  }
  return { staleAssets: candidates.length, removed, dryRun };
}
