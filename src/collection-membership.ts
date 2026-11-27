import { createHash } from "node:crypto";
import type { Store } from "./database.js";
import type { Account } from "./domain.js";
import { invariant } from "./domain.js";
import { requireProfile } from "./security.js";
/** Compact membership for editing. Resolved names are fetched only for the visible page. */
export function collectionMembership(
  store: Store,
  account: Account,
  profileId: string,
  id: string,
) {
  requireProfile(store, account, profileId, true);
  const row = store.db
    .prepare(
      "SELECT id,name,owner_account_id FROM collections WHERE id=? AND deleted_ms IS NULL",
    )
    .get(id);
  invariant(
    row && (account.role === "admin" || row.owner_account_id === account.id),
    404,
    "Collection not found",
  );
  if (account.role !== "admin")
    invariant(
      !store.db
        .prepare(
          "SELECT 1 FROM collection_items c JOIN media m ON m.id=c.media_id WHERE c.collection_id=? AND NOT EXISTS(SELECT 1 FROM source_grants g WHERE g.profile_id=? AND g.source_id=m.source_id AND(g.subtree='' OR m.relative_path=g.subtree OR substr(m.relative_path,1,length(g.subtree)+1)=g.subtree||'/')) LIMIT 1",
        )
        .get(id, profileId),
      404,
      "Collection not found",
    );
  const ids = store.db
    .prepare(
      "SELECT media_id FROM collection_items WHERE collection_id=? ORDER BY media_id LIMIT 5001",
    )
    .all(id)
    .map((item) => String(item.media_id));
  invariant(
    ids.length <= 5000,
    422,
    "This collection exceeds the 5,000-video editing limit",
  );
  return {
    id,
    name: String(row.name),
    ids,
    revision: createHash("sha256")
      .update(JSON.stringify([row, ids]))
      .digest("hex"),
  };
}
