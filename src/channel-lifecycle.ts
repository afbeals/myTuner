import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Store } from "./database.js";
import type { Account } from "./domain.js";
import { invariant } from "./domain.js";
import { programmingSchema } from "./contracts.js";
import {
  requireAdmin,
  requireProfile,
  createMediaAuthorizer,
  programmingActor,
} from "./security.js";
import { ProgrammingService } from "./programming.js";
import { createMediaProjector } from "./display-metadata.js";
const details = z
  .object({
    name: z.string().trim().min(1).max(120),
    shortName: z.string().trim().min(1).max(12).nullable(),
    description: z.string().max(20000),
    visibility: z.enum(["shared", "private"]),
  })
  .strict();
export const newChannelSchema = z
  .object({ draftId: z.string().uuid(), details, config: programmingSchema })
  .strict();
type Draft = z.infer<typeof newChannelSchema>;
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function authorize(store: Store, account: Account, draft: Draft) {
  requireProfile(store, account, draft.config.profileId, true);
  if (draft.details.visibility === "shared") requireAdmin(account);
  invariant(account.role !== "viewer", 403, "Channel management not allowed");
}
function revision(store: Store, account: Account, input: Draft) {
  return hash([
    account.id,
    input,
    store.db.prepare("SELECT revision FROM catalog_revision WHERE id=1").get()!
      .revision,
  ]);
}
export function previewNewChannel(
  store: Store,
  account: Account,
  programming: ProgrammingService,
  input: Draft,
  now = Date.now(),
) {
  input = newChannelSchema.parse(input);
  authorize(store, account, input);
  invariant(
    !store.db.prepare("SELECT id FROM channels WHERE id=?").get(input.draftId),
    409,
    "This draft was already submitted. Return to your network to view it.",
  );
  const result = programming.previewNew(
    account,
    input.draftId,
    input.config,
    now,
    30 * 60_000,
  );
  const media = store.db
      .prepare(
        "SELECT * FROM media WHERE id IN(SELECT value FROM json_each(?))",
      )
      .all(
        JSON.stringify([
          ...new Set(result.entries.map((entry) => entry.mediaId)),
        ]),
      ) as unknown as import("./domain.js").Media[],
    authorized = createMediaAuthorizer(
      store,
      programmingActor(store, account, input.config.profileId),
      input.config.profileId,
    ),
    permitted = media.filter(authorized),
    items = new Map(permitted.map((item) => [item.id, item])),
    project = createMediaProjector(store, permitted);
  return {
    revision: revision(store, account, input),
    effectiveMs: now,
    entries: result.entries.slice(0, 100).map((entry) => {
      const item = items.get(entry.mediaId);
      return {
        ...entry,
        title: item ? project(item).title : "Unavailable video",
        ...(item
          ? { sourceId: item.source_id, relativePath: item.relative_path }
          : {}),
      };
    }),
    total: result.entries.length,
    diagnostics: result.diagnostics.slice(0, 100),
  };
}
export function createNewChannel(
  store: Store,
  account: Account,
  programming: ProgrammingService,
  input: Draft,
  previewRevision: string,
  now = Date.now(),
) {
  input = newChannelSchema.parse(input);
  authorize(store, account, input);
  const requestHash = hash([account.id, input, previewRevision]);
  return store.transaction(() => {
    const existing = store.db
      .prepare("SELECT * FROM channels WHERE id=?")
      .get(input.draftId);
    if (existing) {
      invariant(
        existing.owner_account_id === account.id &&
          existing.creation_hash === requestHash,
        409,
        "This draft identifier is already in use. Start a new channel draft.",
      );
      return { id: input.draftId, created: false };
    }
    invariant(
      revision(store, account, input) === previewRevision,
      409,
      "Your library or channel draft changed. Generate a new preview before creating the channel.",
    );
    store.db
      .prepare(
        "INSERT INTO channels(id,name,owner_account_id,visibility,short_name,description,creation_hash) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        input.draftId,
        input.details.name,
        account.id,
        input.details.visibility,
        input.details.shortName,
        input.details.description,
        requestHash,
      );
    programming.publish(
      account,
      input.draftId,
      { ...input.config, expectedRevisionId: null },
      now,
    );
    return { id: input.draftId, created: true };
  });
}
export function channelDependencies(
  store: Store,
  account: Account,
  id: string,
) {
  const channel = store.db.prepare("SELECT * FROM channels WHERE id=?").get(id);
  invariant(
    channel &&
      (account.role === "admin" ||
        (account.role === "editor" && channel.owner_account_id === account.id)),
    404,
    "Channel not found",
  );
  const counts: Record<string, number> = {};
  for (const [name, sql] of Object.entries({
    schedules:
      "SELECT COUNT(*) AS n FROM schedule_revisions WHERE channel_id=?",
    entries: "SELECT COUNT(*) AS n FROM schedule_entries WHERE channel_id=?",
    playback: "SELECT COUNT(*) AS n FROM playback_sessions WHERE channel_id=?",
    reports: "SELECT COUNT(*) AS n FROM problem_reports WHERE channel_id=?",
    history: "SELECT COUNT(*) AS n FROM playback_events WHERE channel_id=?",
    subscriptions: "SELECT COUNT(*) AS n FROM subscriptions WHERE channel_id=?",
  }))
    counts[name] = Number(store.db.prepare(sql).get(id)!.n);
  return {
    revision: hash([
      channel,
      counts,
      store.db
        .prepare(
          "SELECT id,config_json FROM schedule_revisions WHERE channel_id=? ORDER BY id",
        )
        .all(id),
    ]),
    name: String(channel.name),
    archived: Boolean(channel.archived),
    canDelete: Boolean(channel.archived),
    counts,
  };
}
export function permanentlyDeleteChannel(
  store: Store,
  account: Account,
  id: string,
  expected: string,
) {
  return store.transaction(() => {
    const current = channelDependencies(store, account, id);
    invariant(
      current.revision === expected,
      409,
      "Channel changed. Check its dependencies again.",
    );
    invariant(
      current.canDelete,
      409,
      "Archive this channel before permanently deleting it.",
    );
    // No filesystem operations: originals, sidecars, assets, collections and backups stay intact.
    // schedule_checkpoints cascade with their owning revision.
    for (const table of [
      "playback_events",
      "problem_reports",
      "playback_sessions",
      "subscriptions",
      "active_schedules",
      "schedule_entries",
      "schedule_revisions",
      "channel_items",
      "rotation_state",
    ])
      store.db.prepare(`DELETE FROM ${table} WHERE channel_id=?`).run(id);
    store.db.prepare("DELETE FROM channels WHERE id=?").run(id);
    return { deleted: true };
  });
}
export function registerChannelLifecycle(
  app: FastifyInstance,
  store: Store,
  actor: (request: FastifyRequest) => Account,
  programming: ProgrammingService,
) {
  app.post("/api/channels/drafts/preview", async (request) =>
    previewNewChannel(
      store,
      actor(request),
      programming,
      newChannelSchema.parse(request.body),
    ),
  );
  app.post("/api/channels/drafts/publish", async (request, reply) => {
    const { previewRevision, ...draft } = newChannelSchema
      .extend({ previewRevision: z.string().length(64) })
      .parse(request.body);
    const result = createNewChannel(
      store,
      actor(request),
      programming,
      draft,
      previewRevision,
    );
    return reply.code(result.created ? 201 : 200).send(result);
  });
  app.get("/api/channels/:channelId/dependencies", async (request) => {
    const { channelId } = z
      .object({ channelId: z.string().uuid() })
      .parse(request.params);
    return channelDependencies(store, actor(request), channelId);
  });
  app.delete("/api/channels/:channelId/permanent", async (request) => {
    const { channelId } = z
        .object({ channelId: z.string().uuid() })
        .parse(request.params),
      { revision } = z
        .object({ revision: z.string().length(64) })
        .strict()
        .parse(request.body);
    return permanentlyDeleteChannel(store, actor(request), channelId, revision);
  });
}
