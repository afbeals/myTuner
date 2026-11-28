import { collectionMembership } from "./collection-membership.js";
import { registerChannelLifecycle } from "./channel-lifecycle.js";
import { browseSelectionPage, browseCatalogTree } from "./catalog-selection.js";
import type { CatalogService } from "./catalog-service.js";
import { readCatalogRequest } from "./catalog-request.js";
import { browseLibraryPage } from "./library-page.js";
import { inspectSubtitles } from "./subtitle-catalog.js";
import { displayMedia, createMediaProjector } from "./display-metadata.js";
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
  createCollection,
  programmingOptions,
} from "./library.js";
import {
  requireProfile,
  requireChannelMedia,
  requireAdmin,
  visibleChannel,
  canReadMedia,
  createMediaAuthorizer,
  programmingActor,
  profileLibraryActor,
} from "./security.js";
import { ProgrammingService } from "./programming.js";
export function registerFoundationRoutes(
  app: FastifyInstance,
  store: Store,
  actor: (request: FastifyRequest) => Account,
  programming: ProgrammingService,
  collectionRetentionDays = 7,
  catalog?: Pick<
    CatalogService,
    | "libraryPage"
    | "optionsPage"
    | "selectionPage"
    | "treePage"
    | "assertCurrent"
  >,
) {
  const pagination = z.object({
    offset: z.coerce.number().int().min(0).max(1000000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  });
  registerChannelLifecycle(app, store, actor, programming);
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
  app.get("/api/profiles/:profileId/library", async (request, reply) => {
    const account = actor(request),
      { profileId } = z.object({ profileId: uuid }).parse(request.params);
    const input = z
      .object({
        search: z.string().trim().max(200).default(""),
        sourceId: uuid.optional(),
        titleOnly: z.enum(["true", "false"]).default("false"),
        topLevel: z.enum(["true", "false"]).default("false"),
        access: z.enum(["profile", "all"]).default("profile"),
        kind: z
          .enum(["all", "shows", "movies", "videos", "collections"])
          .default("all"),
        offset: z.coerce.number().int().min(0).max(1000000).default(0),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      })
      .parse(request.query);

    const page = {
      ...input,
      limit: input.limit ?? 24,
      titleOnly: input.titleOnly === "true",
      topLevel: input.topLevel === "true",
    };
    return catalog
      ? readCatalogRequest(
          store,
          request,
          reply,
          actor,
          profileId,
          (signal) => catalog.libraryPage(account, profileId, page, { signal }),
          (result, current) =>
            catalog.assertCurrent(result, current, profileId),
        )
      : browseLibraryPage(store, account, profileId, page);
  });
  app.get(
    "/api/profiles/:profileId/library/options",
    async (request, reply) => {
      const account = actor(request),
        { profileId } = z.object({ profileId: uuid }).parse(request.params);
      const input = z
        .object({
          search: z.string().trim().max(200).default(""),
          access: z.enum(["profile", "all"]).default("profile"),
          titleOnly: z
            .enum(["true", "false"])
            .default("false")
            .transform((value) => value === "true"),
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
      return catalog
        ? readCatalogRequest(
            store,
            request,
            reply,
            actor,
            profileId,
            (signal) =>
              catalog.optionsPage(account, profileId, input, { signal }),
            (result, current) =>
              catalog.assertCurrent(result, current, profileId),
          )
        : programmingOptions(store, account, profileId, input);
    },
  );
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
    const rows = selectMedia(store, account, profileId, selection);
    const project = createMediaProjector(store, rows);
    return {
      items: rows
        .map(project)
        .filter((m) =>
          `${m.title} ${m.relative_path}`
            .toLocaleLowerCase()
            .includes(search.toLocaleLowerCase()),
        )
        .slice(0, 100),
    };
  });
  app.post("/api/profiles/:profileId/selection", async (request, reply) => {
    const account = actor(request),
      { profileId } = z.object({ profileId: uuid }).parse(request.params),
      selection = selectionSchema.parse(request.body);
    const query = z
      .object({
        includeUnavailable: z.enum(["true", "false"]).default("false"),
        access: z.enum(["profile", "all"]).optional(),
        offset: z.coerce.number().int().min(0).max(1000000).default(0),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        search: z.string().trim().max(200).default(""),
      })
      .parse(request.query);
    const input = {
      ...query,
      selection,
      includeUnavailable: query.includeUnavailable === "true",
    };
    if (catalog)
      return readCatalogRequest(
        store,
        request,
        reply,
        actor,
        profileId,
        (signal) =>
          catalog.selectionPage(account, profileId, input, { signal }),
        (result, current) => catalog.assertCurrent(result, current, profileId),
      );
    await (
      await import("./catalog-projection.js")
    ).ensureCatalogProjection(store);
    return browseSelectionPage(store, account, profileId, input);
  });
  app.get("/api/profiles/:profileId/catalog/tree", async (request, reply) => {
    const account = actor(request),
      { profileId } = z.object({ profileId: uuid }).parse(request.params);
    const input = z
      .object({
        sourceId: z.union([uuid, z.literal("")]).default(""),
        parent: z.string().max(4096).default(""),
        offset: z.coerce.number().int().min(0).max(1000000).default(0),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        search: z.string().trim().max(200).default(""),
        recursive: z.enum(["true", "false"]).default("false"),
        mode: z.enum(["folders", "files"]).default("folders"),
        includeCommercials: z.enum(["true", "false"]).default("true"),
        access: z.enum(["profile", "all"]).default("profile"),
      })
      .parse(request.query);
    const query = {
      ...input,
      recursive: input.recursive === "true",
      includeCommercials: input.includeCommercials === "true",
    };
    if (catalog)
      return readCatalogRequest(
        store,
        request,
        reply,
        actor,
        profileId,
        (signal) => catalog.treePage(account, profileId, query, { signal }),
        (result, current) => catalog.assertCurrent(result, current, profileId),
      );
    await (
      await import("./catalog-projection.js")
    ).ensureCatalogProjection(store);
    return browseCatalogTree(store, account, profileId, query);
  });
  app.post("/api/profiles/:profileId/collections", async (request, reply) => {
    const account = actor(request),
      { profileId } = z.object({ profileId: uuid }).parse(request.params),
      body = z
        .object({
          creationId: uuid,
          name: z.string().trim().min(1).max(120),
          mediaIds: z.array(uuid).min(1).max(5000),
        })
        .strict()
        .parse(request.body);
    return reply
      .code(201)
      .send(
        createCollection(
          store,
          account,
          profileId,
          body.creationId,
          body.name,
          body.mediaIds,
        ),
      );
  });
  app.get(
    "/api/profiles/:profileId/collections/:collectionId/membership",
    async (request) => {
      const { profileId, collectionId } = z
        .object({ profileId: uuid, collectionId: uuid })
        .parse(request.params);
      const { access } = z
        .object({ access: z.enum(["profile", "all"]).optional() })
        .parse(request.query);
      const account = actor(request);
      return collectionMembership(
        store,
        access
          ? profileLibraryActor(store, account, profileId, access)
          : account,
        profileId,
        collectionId,
        Boolean(access),
      );
    },
  );
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
      const authorized = createMediaAuthorizer(store, account, profileId);
      invariant(items.every(authorized), 404, "Collection not found");
      const project = createMediaProjector(store, items);
      return {
        ...collection,
        items: items.map((item) => ({
          id: item.id,
          title: project(item).title,
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
            expectedRevision: z.string().length(64).optional(),
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
        body.expectedRevision,
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
              ...(() => {
                const items = selectMedia(
                  store,
                  account,
                  profileId,
                  { type: "collection", id: row.id },
                  true,
                );
                const count = items.filter((item) => item.available).length;
                return {
                  count,
                  totalCount: items.length,
                  unavailableCount: items.length - count,
                };
              })(),
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
      const scheduled = store.db
        .prepare(
          "SELECT e.media_id AS mediaId,e.kind,COUNT(DISTINCT CASE WHEN e.kind='program' THEN e.program_id ELSE e.id END) AS assignments,COUNT(DISTINCT CASE WHEN e.start_ms<=? THEN CASE WHEN e.kind='program' THEN e.program_id ELSE e.id END END) AS startedAssignments FROM schedule_entries e JOIN active_schedules a ON a.revision_id=e.revision_id WHERE e.channel_id=? GROUP BY e.media_id,e.kind",
        )
        .all(Date.now(), channelId);
      // Union intervals per session and entry before summing. Retries and
      // overlapping reports must not count the same delivered time twice.
      const delivered = store.db
        .prepare(
          `WITH intervals AS (
        SELECT media_id,kind,start_ms,end_ms,
          MAX(end_ms) OVER (PARTITION BY media_id,kind,session_id,entry_id ORDER BY start_ms,end_ms ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS previous_end
        FROM playback_events WHERE channel_id=? AND account_id=?
      ) SELECT media_id AS mediaId,kind,
        SUM(MAX(0,end_ms-MAX(start_ms,COALESCE(previous_end,start_ms)))) AS deliveredMs
        FROM intervals GROUP BY media_id,kind`,
        )
        .all(channelId, account.id);
      const ids = [
        ...new Set(
          [...scheduled, ...delivered].map((row) => String(row.mediaId)),
        ),
      ];
      const rows = store.db
        .prepare(
          "SELECT * FROM media WHERE id IN (SELECT value FROM json_each(?))",
        )
        .all(JSON.stringify(ids)) as unknown as import("./domain.js").Media[];
      const authorized = createMediaAuthorizer(store, account, profileId);
      const permitted = new Map(
        rows.filter(authorized).map((item) => [item.id, item]),
      );
      const project = createMediaProjector(store, [...permitted.values()]);
      const label = (mediaId: string) => project(permitted.get(mediaId)!).title;
      return {
        scheduled: scheduled
          .filter((row) => permitted.has(String(row.mediaId)))
          .map((row) => ({ ...row, title: label(String(row.mediaId)) })),
        deliveredForCurrentAccount: delivered
          .filter((row) => permitted.has(String(row.mediaId)))
          .map((row) => ({ ...row, title: label(String(row.mediaId)) })),
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
    const rows = store.db
      .prepare(
        "SELECT * FROM media WHERE id IN (SELECT value FROM json_each(?))",
      )
      .all(
        JSON.stringify([
          ...new Set(result.entries.map((entry) => entry.mediaId)),
        ]),
      ) as unknown as import("./domain.js").Media[];
    const authorized = createMediaAuthorizer(
      store,
      programmingActor(store, account, config.profileId),
      config.profileId,
    );
    const permitted = rows.filter(authorized);
    const items = new Map(permitted.map((item) => [item.id, item]));
    const project = createMediaProjector(store, permitted);
    return {
      ...result,
      entries: result.entries.map((entry) => {
        const item = items.get(entry.mediaId);
        return {
          ...entry,
          title: item ? project(item).title : "Unavailable video",
          ...(item
            ? { sourceId: item.source_id, relativePath: item.relative_path }
            : {}),
        };
      }),
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
          "SELECT id,name,description,details_revision,owner_account_id AS ownerAccountId,visibility,archived,short_name,EXISTS(SELECT 1 FROM active_schedules a JOIN schedule_revisions r ON r.id=a.revision_id WHERE a.channel_id=channels.id AND (r.config_json IS NULL OR json_array_length(r.config_json,'$.groups')>0)) AS has_programming FROM channels ORDER BY name,id",
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
        const entryRows = store.db
          .prepare(
            `SELECT e.id,e.program_id AS programId,e.media_id AS mediaId,m.title,e.start_ms AS startMs,e.end_ms AS endMs,e.offset_ms AS offsetMs,e.kind,
    CASE WHEN m.available=1 AND m.size=e.source_size AND m.mtime_ms=e.source_mtime_ms THEN 1 ELSE 0 END AS available FROM schedule_entries e JOIN active_schedules a ON a.revision_id=e.revision_id JOIN media m ON m.id=e.media_id WHERE e.channel_id=? AND e.end_ms>? AND e.start_ms<? ORDER BY e.start_ms`,
          )
          .all(channel.id, startMs, endMs);
        const mediaRows = store.db
          .prepare(
            "SELECT * FROM media WHERE id IN (SELECT value FROM json_each(?))",
          )
          .all(
            JSON.stringify([
              ...new Set(entryRows.map((row) => String(row.mediaId))),
            ]),
          ) as unknown as import("./domain.js").Media[];
        const authorized = createMediaAuthorizer(store, account, profileId);
        const items = new Map(
          mediaRows.filter(authorized).map((item) => [item.id, item]),
        );
        const entries = entryRows.filter((row) =>
          items.has(String(row.mediaId)),
        );
        const project = createMediaProjector(store, [...items.values()]);
        return [
          {
            id: channel.id,
            name: channel.name,
            visibility: channel.visibility,
            short_name: channel.short_name ?? null,
            description: channel.description ?? "",
            details_revision: channel.details_revision ?? 0,
            error,
            entries: entries.map((entry) => ({
              ...entry,
              title: project(items.get(String(entry.mediaId))!).title,
            })),
          },
        ];
      }),
    };
  });
}
