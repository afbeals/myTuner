import { inspectSubtitles } from "./subtitle-catalog.js";
import { displayMedia } from "./display-metadata.js";
import { collectionDependencies } from "./collection-dependencies.js";
import { playbackReadiness } from "./readiness.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Store } from "./database.js";
import type { Account, Channel } from "./domain.js";
import { invariant } from "./domain.js";
import {
  uuid,
  capabilitiesSchema,
  programmingSchema,
  selectionSchema,
  contractSchemas,
} from "./contracts.js";
import {
  browseLibrary,
  selectMedia,
  saveCollection,
  programmingOptions,
} from "./library.js";
import {
  requireProfile,
  requireChannelMedia,
  requireAdmin,
  visibleChannel,
  canReadMedia,
} from "./security.js";
import { ProgrammingService } from "./programming.js";
export function registerFoundationRoutes(
  app: FastifyInstance,
  store: Store,
  actor: (request: FastifyRequest) => Account,
  programming: ProgrammingService,
  collectionRetentionDays = 7,
) {
  const pagination = z.object({
    offset: z.coerce.number().int().min(0).max(1000000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  });
  app.get(
    "/api/profiles/:profileId/collections/:collectionId/dependencies",
    async (request) => {
      const account = actor(request),
        { profileId, collectionId } = z
          .object({ profileId: uuid, collectionId: uuid })
          .parse(request.params);
      const { offset, limit } = pagination.parse(request.query);
      return collectionDependencies(
        store,
        account,
        profileId,
        collectionId,
        offset,
        limit,
      );
    },
  );
  app.post("/api/admin/playback-readiness", async (request) => {
    const account = actor(request);
    requireAdmin(account);
    const input = pagination
      .extend({
        profileId: uuid,
        selection: selectionSchema.optional(),
        channelId: uuid.optional(),
        capabilities: capabilitiesSchema,
      })
      .strict()
      .refine(
        (v) => Boolean(v.selection) !== Boolean(v.channelId),
        "Choose exactly one selection or channel",
      )
      .parse(request.body);
    return playbackReadiness(store, account, input);
  });
  app.get(
    "/api/profiles/:profileId/media/:mediaId/details",
    async (request) => {
      const account = actor(request),
        { profileId, mediaId } = z
          .object({ profileId: uuid, mediaId: uuid })
          .parse(request.params);
      requireProfile(store, account, profileId);
      const item = store.db
        .prepare("SELECT * FROM media WHERE id=?")
        .get(mediaId) as import("./domain.js").Media | undefined;
      invariant(
        item && canReadMedia(store, account, profileId, item),
        404,
        "Media not found",
      );
      const displayed = displayMedia(store, item);
      const metadata = JSON.parse(displayed.metadata_json);
      const source = store.db
        .prepare("SELECT name FROM sources WHERE id=?")
        .get(item.source_id)!;
      return {
        id: item.id,
        title: displayed.title,
        sourceId: item.source_id,
        sourceName: source.name,
        relativePath: item.relative_path,
        durationMs: item.duration_ms,
        available: Boolean(item.available),
        metadata: {
          seriesTitle: metadata.seriesTitle ?? null,
          seasonNumber: metadata.seasonNumber ?? null,
          episodeNumber: metadata.episodeNumber ?? null,
          year: metadata.year ?? null,
          overview: metadata.overview ?? null,
        },
        technical: metadata.technical ?? null,
        subtitles: inspectSubtitles(store, item, account.role === "admin"),
        basis: "stored-scan-metadata",
      };
    },
  );
  app.get("/api/contracts", async (request) => {
    actor(request);
    return { version: 1, schemas: contractSchemas() };
  });
  app.get("/api/profiles/:profileId/library", async (request) => {
    const account = actor(request),
      { profileId } = z.object({ profileId: uuid }).parse(request.params);
    const { search } = z
      .object({ search: z.string().trim().max(200).default("") })
      .parse(request.query);
    return browseLibrary(store, account, profileId, search);
  });
  app.get("/api/profiles/:profileId/library/options", async (request) => {
    const account = actor(request),
      { profileId } = z.object({ profileId: uuid }).parse(request.params);
    const input = z
      .object({
        search: z.string().trim().max(200).default(""),
        offset: z.coerce.number().int().min(0).max(1000000).default(0),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        sourceId: uuid.optional(),
        showKey: z.string().min(1).max(500).optional(),
        kind: z
          .enum([
            "show",
            "season",
            "movie",
            "folder",
            "collection",
            "movieCollection",
          ])
          .optional(),
      })
      .parse(request.query);
    return programmingOptions(store, account, profileId, input);
  });
  app.post("/api/profiles/:profileId/checkpoint-options", (request) => {
    const account = actor(request),
      { profileId } = z.object({ profileId: uuid }).parse(request.params);
    requireProfile(store, account, profileId, true);
    const { selection, search } = z
      .object({
        selection: selectionSchema,
        search: z.string().max(200).default(""),
      })
      .strict()
      .parse(request.body);
    return {
      items: selectMedia(store, account, profileId, selection)
        .map((m) => displayMedia(store, m))
        .filter((m) =>
          `${m.title} ${m.relative_path}`
            .toLocaleLowerCase()
            .includes(search.toLocaleLowerCase()),
        )
        .slice(0, 100),
    };
  });
  app.post("/api/profiles/:profileId/selection", async (request) => {
    const account = actor(request),
      { profileId } = z.object({ profileId: uuid }).parse(request.params),
      selection = selectionSchema.parse(request.body),
      query = z
        .object({
          includeUnavailable: z.enum(["true", "false"]).default("false"),
        })
        .parse(request.query);
    return {
      items: selectMedia(
        store,
        account,
        profileId,
        selection,
        query.includeUnavailable === "true",
      )
        .map((m) => displayMedia(store, m))
        .map((m) => ({
          id: m.id,
          title: m.title,
          sourceId: m.source_id,
          durationMs: m.duration_ms,
          available: Boolean(m.available),
          path: m.relative_path,
          metadata: JSON.parse(m.metadata_json),
        })),
    };
  });
  app.post("/api/profiles/:profileId/collections", async (request, reply) => {
    const account = actor(request),
      { profileId } = z.object({ profileId: uuid }).parse(request.params),
      body = z
        .object({
          name: z.string().trim().min(1).max(120),
          mediaIds: z.array(uuid).min(1).max(5000),
        })
        .strict()
        .parse(request.body);
    return reply
      .code(201)
      .send(
        saveCollection(store, account, profileId, body.name, body.mediaIds),
      );
  });
  app.get(
    "/api/profiles/:profileId/collections/:collectionId",
    async (request) => {
      const account = actor(request),
        { profileId, collectionId } = z
          .object({ profileId: uuid, collectionId: uuid })
          .parse(request.params);
      requireProfile(store, account, profileId, true);
      const collection = store.db
        .prepare(
          "SELECT id,name,owner_account_id AS ownerAccountId FROM collections WHERE id=? AND deleted_ms IS NULL",
        )
        .get(collectionId);
      invariant(
        collection &&
          (account.role === "admin" ||
            collection.ownerAccountId === account.id),
        404,
        "Collection not found",
      );
      const items = store.db
        .prepare(
          "SELECT m.* FROM collection_items ci JOIN media m ON m.id=ci.media_id WHERE ci.collection_id=? ORDER BY m.title,m.id",
        )
        .all(collectionId) as unknown as import("./domain.js").Media[];
      invariant(
        items.every((item) => canReadMedia(store, account, profileId, item)),
        404,
        "Collection not found",
      );
      return {
        ...collection,
        items: items.map((item) => ({
          id: item.id,
          title: displayMedia(store, item).title,
          sourceId: item.source_id,
          available: Boolean(item.available),
        })),
      };
    },
  );
  app.put(
    "/api/profiles/:profileId/collections/:collectionId",
    async (request) => {
      const account = actor(request),
        { profileId, collectionId } = z
          .object({ profileId: uuid, collectionId: uuid })
          .parse(request.params),
        body = z
          .object({
            name: z.string().trim().min(1).max(120),
            mediaIds: z.array(uuid).min(1).max(5000),
          })
          .strict()
          .parse(request.body);
      return saveCollection(
        store,
        account,
        profileId,
        body.name,
        body.mediaIds,
        collectionId,
      );
    },
  );
  app.get("/api/profiles/:profileId/collections", async (request) => {
    const account = actor(request),
      { profileId } = z.object({ profileId: uuid }).parse(request.params);
    requireProfile(store, account, profileId);
    const rows = store.db
      .prepare(
        "SELECT id,name,owner_account_id AS ownerAccountId FROM collections WHERE deleted_ms IS NULL AND (?='admin' OR owner_account_id=?) ORDER BY name",
      )
      .all(account.role, account.id) as {
      id: string;
      name: string;
      ownerAccountId: string;
    }[];
    return {
      items: rows.flatMap((row) => {
        try {
          return [
            {
              ...row,
              count: selectMedia(store, account, profileId, {
                type: "collection",
                id: row.id,
              }).length,
            },
          ];
        } catch {
          return [];
        }
      }),
    };
  });
  app.delete(
    "/api/profiles/:profileId/collections/:collectionId",
    async (request, reply) => {
      const account = actor(request),
        { profileId, collectionId } = z
          .object({ profileId: uuid, collectionId: uuid })
          .parse(request.params);
      requireProfile(store, account, profileId, true);
      selectMedia(store, account, profileId, {
        type: "collection",
        id: collectionId,
      });
      store.db
        .prepare(
          "UPDATE collections SET deleted_ms=?,expires_ms=? WHERE id=? AND deleted_ms IS NULL",
        )
        .run(
          Date.now(),
          Date.now() + collectionRetentionDays * 86400000,
          collectionId,
        );
      return reply.code(204).send();
    },
  );
  app.get(
    "/api/profiles/:profileId/channels/:channelId/statistics",
    async (request) => {
      const account = actor(request),
        { profileId, channelId } = z
          .object({ profileId: uuid, channelId: uuid })
          .parse(request.params),
        channel = visibleChannel(store, account, channelId);
      requireChannelMedia(store, account, profileId, channel);
      const authorized = (mediaId: string) => {
        const item = store.db
          .prepare("SELECT * FROM media WHERE id=?")
          .get(mediaId) as import("./domain.js").Media | undefined;
        return item && canReadMedia(store, account, profileId, item);
      };
      const scheduled = store.db
        .prepare(
          "SELECT e.media_id AS mediaId,e.kind,COUNT(DISTINCT CASE WHEN e.kind='program' THEN e.program_id ELSE e.id END) AS assignments,COUNT(DISTINCT CASE WHEN e.start_ms<=? THEN CASE WHEN e.kind='program' THEN e.program_id ELSE e.id END END) AS startedAssignments FROM schedule_entries e JOIN active_schedules a ON a.revision_id=e.revision_id WHERE e.channel_id=? GROUP BY e.media_id,e.kind",
        )
        .all(Date.now(), channelId)
        .filter((row) => authorized(String(row.mediaId)));
      const events = store.db
        .prepare(
          "SELECT media_id,kind,entry_id,session_id,start_ms,end_ms FROM playback_events WHERE channel_id=? AND account_id=? ORDER BY media_id,kind,session_id,entry_id,start_ms,end_ms",
        )
        .all(channelId, account.id);
      const totals = new Map<
        string,
        { mediaId: string; kind: string; deliveredMs: number }
      >();
      let last = "",
        end = 0;
      for (const event of events) {
        if (!authorized(String(event.media_id))) continue;
        const key = String(event.media_id) + ":" + String(event.kind),
          interval =
            key + ":" + String(event.session_id) + ":" + String(event.entry_id);
        if (interval !== last) {
          last = interval;
          end = Number(event.start_ms);
        }
        const total = totals.get(key) ?? {
          mediaId: String(event.media_id),
          kind: String(event.kind),
          deliveredMs: 0,
        };
        total.deliveredMs += Math.max(
          0,
          Number(event.end_ms) - Math.max(Number(event.start_ms), end),
        );
        end = Math.max(end, Number(event.end_ms));
        totals.set(key, total);
      }
      const label = (mediaId: string) =>
        displayMedia(
          store,
          store.db
            .prepare("SELECT * FROM media WHERE id=?")
            .get(mediaId) as unknown as import("./domain.js").Media,
        ).title;
      return {
        scheduled: scheduled.map((row) => ({
          ...row,
          title: label(String(row.mediaId)),
        })),
        deliveredForCurrentAccount: [...totals.values()].map((row) => ({
          ...row,
          title: label(row.mediaId),
        })),
        deliveryIsNotProofOfViewing: true,
      };
    },
  );
  const windowSchema = z.object({
    horizonMs: z.coerce
      .number()
      .int()
      .min(1000)
      .max(7 * 86400000)
      .default(48 * 3600000),
  });
  app.post("/api/channels/:channelId/programming/preview", async (request) => {
    const account = actor(request),
      { channelId } = z.object({ channelId: uuid }).parse(request.params),
      config = programmingSchema.parse(request.body),
      { horizonMs } = windowSchema.parse(request.query);
    const result = programming.preview(
      account,
      channelId,
      config,
      Date.now(),
      horizonMs,
    );
    return {
      ...result,
      entries: result.entries.map((entry) => ({
        ...entry,
        title: displayMedia(
          store,
          store.db
            .prepare("SELECT * FROM media WHERE id=?")
            .get(entry.mediaId) as unknown as import("./domain.js").Media,
        ).title,
      })),
    };
  });
  app.put("/api/channels/:channelId/programming", async (request) => {
    const account = actor(request),
      { channelId } = z.object({ channelId: uuid }).parse(request.params),
      config = programmingSchema.parse(request.body),
      { horizonMs } = windowSchema.parse(request.query);
    return programming.publish(
      account,
      channelId,
      config,
      Date.now(),
      horizonMs,
    );
  });
  app.get("/api/channels/:channelId/programming", async (request) => {
    const account = actor(request),
      { channelId } = z.object({ channelId: uuid }).parse(request.params),
      channel = visibleChannel(store, account, channelId);
    invariant(
      account.role === "admin" || channel.owner_account_id === account.id,
      404,
      "Programming not found",
    );
    const revision = programming.active(channelId);
    return {
      revisionId: revision?.id ?? null,
      effectiveMs: revision?.effective_ms ?? null,
      config: revision?.config_json ? JSON.parse(revision.config_json) : null,
    };
  });
  app.get("/api/admin/channels", async (request) => {
    requireAdmin(actor(request));
    return {
      items: store.db
        .prepare(
          "SELECT id,name,description,details_revision,owner_account_id AS ownerAccountId,visibility,archived,short_name FROM channels ORDER BY name,id",
        )
        .all(),
    };
  });
  app.put("/api/profiles/:profileId/lineup", async (request) => {
    const account = actor(request),
      { profileId } = z.object({ profileId: uuid }).parse(request.params);
    requireProfile(store, account, profileId, true);
    const { channelIds } = z
      .object({ channelIds: z.array(uuid).max(1000) })
      .strict()
      .parse(request.body);
    invariant(
      new Set(channelIds).size === channelIds.length,
      400,
      "Lineup contains duplicate channels",
    );
    // Viewing unlock must fail explicitly before filtering private membership.
    requireProfile(store, account, profileId);
    // Filter authorization before comparing counts or exposing membership.
    const permitted = (
      store.db
        .prepare(
          "SELECT c.* FROM channels c JOIN subscriptions s ON c.id=s.channel_id WHERE s.profile_id=? AND c.archived=0",
        )
        .all(profileId) as unknown as Channel[]
    ).filter((c) => {
      try {
        visibleChannel(store, account, c.id);
        requireChannelMedia(store, account, profileId, c);
        return true;
      } catch {
        return false;
      }
    });
    invariant(
      channelIds.length === permitted.length &&
        channelIds.every((id) => permitted.some((c) => c.id === id)),
      409,
      "Lineup changed; refresh before saving",
    );
    store.transaction(() =>
      channelIds.forEach((id, index) =>
        store.db
          .prepare(
            "UPDATE subscriptions SET position=? WHERE profile_id=? AND channel_id=?",
          )
          .run(index + 1, profileId, id),
      ),
    );
    return { channelIds };
  });
  app.get("/api/channels/:channelId/draft-copy", async (request) => {
    const account = actor(request),
      { channelId } = z.object({ channelId: uuid }).parse(request.params),
      { profileId } = z.object({ profileId: uuid }).parse(request.query);
    const channel = visibleChannel(store, account, channelId);
    invariant(
      account.role === "admin" || channel.owner_account_id === account.id,
      404,
      "Programming not found",
    );
    requireProfile(store, account, profileId, true);
    const revision = programming.active(channelId);
    invariant(
      revision?.config_json,
      409,
      "Channel has no recurring programming to copy",
    );
    const config = programmingSchema.parse({
      ...JSON.parse(revision.config_json),
      profileId,
      checkpointActions: undefined,
    });
    for (const g of config.groups)
      selectMedia(store, account, profileId, g.selection);
    if (config.commercialSelection)
      selectMedia(store, account, profileId, config.commercialSelection);
    return {
      suggestedName: `${channel.name} copy`.slice(0, 120),
      visibility: "private",
      config,
    };
  });
  app.get("/api/profiles/:profileId/guide", async (request) => {
    const account = actor(request),
      { profileId } = z.object({ profileId: uuid }).parse(request.params);
    requireProfile(store, account, profileId);
    const now = Date.now(),
      { startMs, endMs } = z
        .object({
          startMs: z.coerce.number().int().nonnegative().default(now),
          endMs: z.coerce
            .number()
            .int()
            .nonnegative()
            .default(now + 6 * 3600000),
        })
        .parse(request.query);
    invariant(
      endMs > startMs && endMs - startMs <= 7 * 86400000,
      400,
      "Guide window must be positive and at most seven days",
    );
    const rows = store.db
      .prepare(
        "SELECT c.* FROM channels c JOIN subscriptions s ON s.channel_id=c.id WHERE s.profile_id=? AND c.archived=0 ORDER BY s.position,c.name,c.id",
      )
      .all(profileId) as unknown as Channel[];
    return {
      channels: rows.flatMap((channel) => {
        try {
          visibleChannel(store, account, channel.id);
          requireChannelMedia(store, account, profileId, channel, {
            positionMs: Math.max(now, startMs),
          });
        } catch {
          return [];
        }
        let error: string | null = null;
        try {
          programming.ensure(channel.id, endMs);
        } catch {
          error = "Programming needs administrator attention";
        }
        const entries = store.db
          .prepare(
            `SELECT e.id,e.program_id AS programId,e.media_id AS mediaId,m.title,e.start_ms AS startMs,e.end_ms AS endMs,e.offset_ms AS offsetMs,e.kind,
    CASE WHEN m.available=1 AND m.size=e.source_size AND m.mtime_ms=e.source_mtime_ms THEN 1 ELSE 0 END AS available FROM schedule_entries e JOIN active_schedules a ON a.revision_id=e.revision_id JOIN media m ON m.id=e.media_id WHERE e.channel_id=? AND e.end_ms>? AND e.start_ms<? ORDER BY e.start_ms`,
          )
          .all(channel.id, startMs, endMs)
          .filter((row) => {
            const item = store.db
              .prepare("SELECT * FROM media WHERE id=?")
              .get(row.mediaId!) as unknown as import("./domain.js").Media;
            return canReadMedia(store, account, profileId, item);
          });
        return [
          {
            id: channel.id,
            name: channel.name,
            visibility: channel.visibility,
            short_name: channel.short_name ?? null,
            description: channel.description ?? "",
            details_revision: channel.details_revision ?? 0,
            error,
            entries: entries.map((entry) => {
              const item = store.db
                .prepare("SELECT * FROM media WHERE id=?")
                .get(entry.mediaId!) as unknown as import("./domain.js").Media;
              return { ...entry, title: displayMedia(store, item).title };
            }),
          },
        ];
      }),
    };
  });
}
