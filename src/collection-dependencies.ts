import type { Store } from "./database.js";
import type { Account } from "./domain.js";
import { invariant } from "./domain.js";
import { requireProfile } from "./security.js";
import { selectMedia } from "./library.js";

interface DependencyReport {
  checkedMs: number;
  offset: number;
  limit: number;
  total: number;
  items: {
    id: string;
    name: string;
    recurring: boolean;
    materialized: boolean;
    retained: boolean;
  }[];
  advisory: boolean;
  explanation: string;
}
export function collectionDependencies(
  store: Store,
  account: Account,
  profileId: string,
  collectionId: string,
  offset = 0,
  limit = 25,
): DependencyReport {
  requireProfile(store, account, profileId, true);
  selectMedia(store, account, profileId, {
    type: "collection",
    id: collectionId,
  });
  // Restrict channel ownership before inspecting configs or exposing counts.
  const rows = store.db
    .prepare(
      `WITH usage AS (
    SELECT c.id,c.name,
      EXISTS(SELECT 1 FROM active_schedules a JOIN schedule_revisions r ON r.id=a.revision_id
        WHERE a.channel_id=c.id AND (
          EXISTS(SELECT 1 FROM json_each(json_extract(r.config_json,'$.groups')) g WHERE json_extract(g.value,'$.selection.type')='collection' AND json_extract(g.value,'$.selection.id')=?)
          OR (json_extract(r.config_json,'$.commercialSelection.type')='collection' AND json_extract(r.config_json,'$.commercialSelection.id')=?))) AS recurring,
      EXISTS(SELECT 1 FROM schedule_entries e JOIN active_schedules a ON a.revision_id=e.revision_id JOIN collection_items ci ON ci.media_id=e.media_id
        WHERE e.channel_id=c.id AND ci.collection_id=? AND e.end_ms>?) AS materialized,
      EXISTS(SELECT 1 FROM schedule_entries e JOIN playback_sessions p ON p.revision_id=e.revision_id JOIN collection_items ci ON ci.media_id=e.media_id
        WHERE e.channel_id=c.id AND ci.collection_id=? AND e.end_ms>=p.position_ms) AS retained
    FROM channels c WHERE c.archived=0 AND (?='admin' OR (?='editor' AND c.owner_account_id=?))
  ) SELECT *,COUNT(*) OVER() AS total FROM usage WHERE recurring OR materialized OR retained ORDER BY name,id LIMIT ? OFFSET ?`,
    )
    .all(
      collectionId,
      collectionId,
      collectionId,
      Date.now(),
      collectionId,
      account.role,
      account.role,
      account.id,
      limit,
      offset,
    );
  // An out-of-range page still has an accurate authorized total.
  const total = rows.length
    ? Number(rows[0]!.total)
    : offset
      ? collectionDependencies(store, account, profileId, collectionId, 0, 1)
          .total
      : 0;
  return {
    checkedMs: Date.now(),
    offset,
    limit,
    total,
    items: rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      recurring: Boolean(row.recurring),
      materialized: Boolean(row.materialized),
      retained: Boolean(row.retained),
    })),
    advisory: true,
    explanation:
      "Deleting leaves materialized airings and paused revisions in place. Recurring selectors may prevent future generation if no other group can play. Materialized matches indicate overlapping collection videos, not their original selector.",
  };
}
