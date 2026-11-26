import type { Store } from "./database.js";
import type { Account } from "./domain.js";
import { requireAdmin, sourceById } from "./security.js";

// Read only indexed catalog paths. Opening a picker never walks a media share,
// probes videos, or loads their metadata. Ancestors include folders whose videos
// all live deeper in the tree; unavailable files do not suggest stale folders.
export function sourceDirectories(
  store: Store,
  account: Account,
  sourceId: string,
  input: { search: string; offset: number; limit: number },
) {
  requireAdmin(account);
  sourceById(store, sourceId);
  const rows = store.db
    .prepare(
      `WITH RECURSIVE folders(directory,remaining) AS (
    SELECT '',relative_path FROM media WHERE source_id=? AND available=1
    UNION ALL
    SELECT directory || CASE WHEN directory='' THEN '' ELSE '/' END ||
      substr(remaining,1,instr(remaining,'/')-1),
      substr(remaining,instr(remaining,'/')+1)
    FROM folders WHERE instr(remaining,'/')>0
  ) SELECT DISTINCT directory FROM folders
    WHERE directory<>'' AND instr(lower(directory),lower(?))>0
    ORDER BY directory COLLATE NOCASE,directory LIMIT ? OFFSET ?`,
    )
    .all(sourceId, input.search, input.limit + 1, input.offset);
  return {
    items: rows.slice(0, input.limit).map((row) => String(row.directory)),
    hasMore: rows.length > input.limit,
    offset: input.offset,
    limit: input.limit,
  };
}
