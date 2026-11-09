import { readdir, lstat, statfs, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Store } from "./database.js";
import { canonicalPath, containsPath, safeMediaPath } from "./catalog.js";
import { invariant } from "./domain.js";
import type { Media } from "./domain.js";
import { assetFingerprint } from "./generation.js";
import type { AssetKind } from "./generation.js";
export async function directoryBytes(root: string): Promise<number> {
  let total = 0;
  async function walk(path: string) {
    for (const name of await readdir(path)) {
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
export async function validateStorage(
  store: Pick<Store, "db">,
  roots: string[],
  generated: string,
  cache: string,
) {
  const columns = store.db.prepare("PRAGMA table_info(sources)").all();
  const extra = ["metadata_root", "subtitle_root"].filter((name) =>
    columns.some((c) => c.name === name),
  );
  const sources = store.db
    .prepare(
      [
        "SELECT root_path FROM sources",
        ...extra.map(
          (name) =>
            `SELECT ${name} AS root_path FROM sources WHERE ${name} IS NOT NULL`,
        ),
      ].join(" UNION "),
    )
    .all();
  for (const root of roots) {
    const path = await canonicalPath(root);
    for (const source of sources) {
      const src = await canonicalPath(String(source.root_path));
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
      try {
        const path = await safeMediaPath(
          {
            ...{ id: "", name: "", kind: "videos" as const, recursive: 1 },
            root_path: await realpath(root),
          },
          row.asset_path,
        );
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
