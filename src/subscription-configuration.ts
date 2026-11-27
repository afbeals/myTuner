import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Store } from "./database.js";
import type { Account } from "./domain.js";
import { invariant } from "./domain.js";
import { requireProfile } from "./security.js";
function snapshot(store: Store, account: Account, profileId: string) {
  requireProfile(store, account, profileId, true);
  requireProfile(store, account, profileId);
  const parameters: (string | number)[] = [account.role, account.id];
  let media = "";
  if (account.role !== "admin") {
    media = `AND NOT EXISTS(SELECT 1 FROM media m JOIN schedule_entries e ON e.media_id=m.id JOIN active_schedules a ON a.revision_id=e.revision_id WHERE a.channel_id=c.id AND e.end_ms>? AND NOT EXISTS(SELECT 1 FROM source_grants g WHERE g.profile_id=? AND g.source_id=m.source_id AND(g.subtree='' OR m.relative_path=g.subtree OR substr(m.relative_path,1,length(g.subtree)+1)=g.subtree||'/'))) AND(EXISTS(SELECT 1 FROM active_schedules a WHERE a.channel_id=c.id) OR NOT EXISTS(SELECT 1 FROM media m JOIN channel_items i ON i.media_id=m.id WHERE i.channel_id=c.id AND NOT EXISTS(SELECT 1 FROM source_grants g WHERE g.profile_id=? AND g.source_id=m.source_id AND(g.subtree='' OR m.relative_path=g.subtree OR substr(m.relative_path,1,length(g.subtree)+1)=g.subtree||'/'))))`;
    parameters.push(Date.now(), profileId, profileId);
  }
  const eligible = store.db
    .prepare(
      `SELECT c.id,c.name,c.short_name,c.visibility,c.details_revision FROM channels c WHERE c.archived=0 AND(?='admin' OR c.visibility='shared' OR c.owner_account_id=?) ${media} ORDER BY c.name COLLATE NOCASE,c.id`,
    )
    .all(...parameters)
    .map((row) => ({
      id: String(row.id),
      name: String(row.name),
      shortName: row.short_name as string | null,
      shortNameOverride: row.short_name as string | null,
      visibility: String(row.visibility),
      revision: Number(row.details_revision),
    }));
  const subscriptions = store.db
    .prepare(
      "SELECT channel_id AS id,position FROM subscriptions WHERE profile_id=? ORDER BY position,channel_id",
    )
    .all(profileId)
    .map((row) => ({ id: String(row.id), position: Number(row.position) }));
  const grants = store.db
    .prepare(
      "SELECT source_id,subtree FROM source_grants WHERE profile_id=? ORDER BY source_id,subtree",
    )
    .all(profileId);
  const revision = createHash("sha256")
    .update(JSON.stringify([eligible, subscriptions, grants]))
    .digest("hex");
  return { eligible, subscriptions, revision };
}
export function subscriptionConfiguration(
  store: Store,
  account: Account,
  profileId: string,
  input: { search: string; offset: number; limit: number },
) {
  const current = snapshot(store, account, profileId),
    byId = new Map(current.eligible.map((item) => [item.id, item]));
  const visible = current.eligible.filter(
    (item) =>
      !input.search ||
      `${item.name} ${item.shortName ?? ""}`
        .toLowerCase()
        .includes(input.search.toLowerCase()),
  );
  const order = current.subscriptions.flatMap((item) => {
    const channel = byId.get(item.id);
    return channel ? [channel] : [];
  });
  return {
    revision: current.revision,
    items: visible.slice(input.offset, input.offset + input.limit),
    total: visible.length,
    offset: input.offset,
    limit: input.limit,
    hasMore: input.offset + input.limit < visible.length,
    order,
  };
}
export function saveSubscriptions(
  store: Store,
  account: Account,
  profileId: string,
  input: { revision: string; channelIds: string[] },
) {
  requireProfile(store, account, profileId, true);
  invariant(
    input.channelIds.length <= 1000 &&
      new Set(input.channelIds).size === input.channelIds.length,
    400,
    "Choose distinct channels (up to 1000)",
  );
  return store.transaction(() => {
    const current = snapshot(store, account, profileId);
    invariant(
      current.revision === input.revision,
      409,
      "Subscriptions changed elsewhere; reload and review your lineup",
    );
    const eligible = new Set(current.eligible.map((item) => item.id)),
      selected = new Set(input.channelIds);
    invariant(
      input.channelIds.every((id) => eligible.has(id)),
      404,
      "Channel unavailable",
    );
    const removed = current.subscriptions.filter(
      (item) => eligible.has(item.id) && !selected.has(item.id),
    );
    for (const item of removed) {
      store.db
        .prepare(
          "DELETE FROM subscriptions WHERE profile_id=? AND channel_id=?",
        )
        .run(profileId, item.id);
      store.db
        .prepare(
          "DELETE FROM playback_sessions WHERE profile_id=? AND channel_id=?",
        )
        .run(profileId, item.id);
    }
    const slots = current.subscriptions
      .filter((item) => eligible.has(item.id))
      .map((item) => item.position)
      .sort((a, b) => a - b);
    let end = Math.max(
      0,
      ...current.subscriptions.map((item) => item.position),
    );
    const save = store.db.prepare(
      "INSERT INTO subscriptions(profile_id,channel_id,position) VALUES(?,?,?) ON CONFLICT(profile_id,channel_id) DO UPDATE SET position=excluded.position WHERE subscriptions.position<>excluded.position",
    );
    input.channelIds.forEach((id, index) =>
      save.run(profileId, id, slots[index] ?? ++end),
    );
    return { channelIds: input.channelIds, removed: removed.length };
  });
}
export function registerSubscriptionConfiguration(
  app: FastifyInstance,
  store: Store,
  actor: (request: FastifyRequest) => Account,
) {
  app.get("/api/profiles/:profileId/subscription-configuration", (request) => {
    const { profileId } = z
        .object({ profileId: z.string().uuid() })
        .parse(request.params),
      input = z
        .object({
          search: z.string().trim().max(200).default(""),
          offset: z.coerce.number().int().min(0).max(1000000).default(0),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        })
        .parse(request.query);
    return subscriptionConfiguration(store, actor(request), profileId, input);
  });
  app.put("/api/profiles/:profileId/subscription-configuration", (request) => {
    const { profileId } = z
        .object({ profileId: z.string().uuid() })
        .parse(request.params),
      input = z
        .object({
          revision: z.string().length(64),
          channelIds: z.array(z.string().uuid()).max(1000),
        })
        .strict()
        .parse(request.body);
    return saveSubscriptions(store, actor(request), profileId, input);
  });
}
