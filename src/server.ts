import { reconcileAssets } from "./asset-reconciliation.js";
import { registerSubtitleRoutes } from "./subtitle-routes.js";
import { registerMetadataRoutes } from "./metadata-routes.js";
import { displayMedia } from "./display-metadata.js";
import {
  CollectionRecovery,
  ProblemReports,
  retentionDays,
} from "./retained.js";
import { registerRetainedRoutes } from "./retained-routes.js";
import { OperationsService, effectiveAccess } from "./operations.js";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { open, stat, realpath } from "node:fs/promises";
import { extname, dirname, resolve } from "node:path";
import type { Store } from "./database.js";
import type { Account, Channel, Media } from "./domain.js";
import { DomainError, invariant } from "./domain.js";
import { addSource, safeMediaPath } from "./catalog.js";
import {
  createAccount,
  login,
  requireAdmin,
  requireProfile,
  canReadMedia,
  visibleChannel,
  requireChannelMedia,
  sourceById,
  normalizeSubtree,
} from "./security.js";
import { importMetadata, readIntegration } from "./integrations.js";
import {
  buildSchedule,
  initialState,
  persistSchedule,
  resolveLive,
} from "./scheduler.js";
import type { Clip } from "./scheduler.js";
import { parseRange } from "./ranges.js";
import { EncoderAdmission } from "./encoder-admission.js";
import { SubtitleService } from "./subtitles.js";
import { publicJson } from "./public-json.js";
import { ArtworkService } from "./artwork.js";
import { validateStorage, cleanupAssets } from "./storage.js";
import { StreamingService } from "./streaming.js";
import { RefreshService } from "./refresh.js";
import { registerIdentity } from "./identity-routes.js";
import { AccessRegistry } from "./access.js";
import { ProgrammingService } from "./programming.js";
import { registerFoundationRoutes } from "./foundation-routes.js";
import { PlaybackService } from "./playback.js";
import {
  GenerationRunner,
  generationPreflight,
  assetFingerprint,
} from "./generation.js";

const id = z.string().uuid(),
  name = z.string().trim().min(1).max(120);
const groupsSchema = z
  .array(
    z
      .object({
        id: name,
        mode: z.enum(["ordered", "shuffle", "random"]),
        mediaIds: z.array(id).min(1).max(5000),
      })
      .strict(),
  )
  .min(1)
  .max(100);
const rulesSchema = z
  .object({
    between: z.boolean(),
    positions: z
      .array(
        z
          .object({
            kind: z.enum(["percent", "timestamp"]),
            value: z.number().positive(),
          })
          .strict(),
      )
      .max(100),
    random: z
      .object({
        count: z.number().int().min(0).max(100),
        minPercent: z.number().positive(),
        maxPercent: z.number().lt(100),
      })
      .strict()
      .optional(),
    maxClips: z.number().int().min(0).max(100),
    maxDurationMs: z.number().int().min(0).max(3600000),
    repeatAllowance: z.number().int().min(1).max(100),
    maxPerBreak: z.number().int().min(1).max(100),
    cooldownMs: z.number().int().min(0).max(604800000),
  })
  .strict();
const mime: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".ts": "video/mp2t",
  ".avi": "video/x-msvideo",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
};

export function createServer(
  store: Store,
  options: {
    writableRoots?: string[];
    logger?: boolean;
    generatedRoot?: string;
    secureCookie?: boolean;
    publicOrigin?: string;
    integrationKey?: Buffer;
    cacheRoot?: string;
    autoMaintenance?: boolean;
    webRoot?: string;
    encoderConcurrency?: number;
    collectionRetentionDays?: number;
    reportRetentionDays?: number;
  } = {},
) {
  const app = Fastify({
    logger: options.logger
      ? { redact: ["req.headers.authorization", "req.headers.cookie"] }
      : false,
    bodyLimit: 1024 * 1024,
    // Broadcast streams cannot drain naturally during shutdown.
    forceCloseConnections: true,
  });
  const roots = options.writableRoots ?? [
    resolve(dirname(store.filename)),
    resolve(".data/generated"),
    resolve(".data/cache"),
  ];
  const generatedRoot = resolve(options.generatedRoot ?? ".data/generated");
  const cacheRoot = resolve(options.cacheRoot ?? ".data/cache");
  app.addHook("onReady", async () =>
    validateStorage(
      store,
      [
        ...roots,
        generatedRoot,
        cacheRoot,
        resolve(cacheRoot, "hls"),
        resolve(cacheRoot, "artwork"),
        resolve(cacheRoot, "subtitles"),
      ],
      generatedRoot,
      cacheRoot,
    ),
  );
  const encoders = new EncoderAdmission(options.encoderConcurrency ?? 3);
  const generation = new GenerationRunner(
    store,
    generatedRoot,
    undefined,
    undefined,
    encoders,
  );
  app.addHook("preClose", async () => {
    const stopping = generation.stop();
    encoders.stop();
    await stopping;
  });
  app.addHook("onClose", async () => {
    await generation.stop();
  });
  app.addHook("onReady", async () => {
    void generation
      .drain()
      .catch((error) =>
        app.log.error({ err: error }, "Generation worker failed"),
      );
  });
  const refresh = new RefreshService(store, options.integrationKey);
  app.addHook("onClose", async () => refresh.stop());
  const actor = registerIdentity(
    app,
    store,
    options.secureCookie,
    options.publicOrigin,
  );
  const access = new AccessRegistry();
  const accessTimer = setInterval(() => access.recheck(), 1000);
  accessTimer.unref();
  app.addHook("preClose", async () => {
    clearInterval(accessTimer);
    access.close();
  });
  app.addHook("onResponse", async (request) => {
    if (!["GET", "HEAD"].includes(request.method)) access.recheck();
  });
  const channelOwner = (account: Account, channel: Channel) =>
    invariant(
      account.role === "admin" ||
        (account.role === "editor" && channel.owner_account_id === account.id),
      403,
      "Channel management not allowed",
    );
  const getMedia = (mediaId: string): Media => {
    const media = store.db
      .prepare("SELECT * FROM media WHERE id=?")
      .get(mediaId) as Media | undefined;
    invariant(media, 404, "Media not found");
    return media;
  };
  app.addHook("onSend", async (_request, reply, payload) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      )
      .header("Referrer-Policy", "no-referrer");
    if (
      typeof payload === "string" &&
      String(reply.getHeader("content-type")).includes("application/json")
    ) {
      const params = _request.params as { profileId?: string } | undefined;
      return JSON.stringify(
        publicJson(JSON.parse(payload), params?.profileId, undefined, store),
      );
    }
    return payload;
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: "Invalid request",
        issues: error.issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      });
    if (error instanceof DomainError)
      return reply.code(error.statusCode).send({ error: error.message });
    if (
      error instanceof Error &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    )
      return reply.code(error.statusCode).send({ error: "Invalid request" });
    app.log.error({ err: error }, "Request failed");
    return reply.code(500).send({ error: "Internal server error" });
  });
  if (options.webRoot) {
    void app.register(fastifyStatic, {
      root: resolve(options.webRoot),
      index: ["index.html"],
      wildcard: false,
      dotfiles: "deny",
    });
  }
  app.get("/api/health", async () => {
    store.db.prepare("SELECT 1").get();
    return {
      status: "ok",
      service: "mytuner",
      apiVersion: 1,
      version: "0.2.0",
      phase: options.webRoot ? "standalone-clients" : "non-ui-foundation",
    };
  });
  app.post("/api/auth/login", async (request) => {
    const body = z
      .object({
        username: z.string().min(1).max(64),
        password: z.string().min(1).max(1024),
      })
      .strict()
      .parse(request.body);
    return login(store, body.username, body.password);
  });
  app.get("/api/auth/me", async (request) => actor(request));
  app.post("/api/accounts", async (request, reply) => {
    const account = actor(request);
    requireAdmin(account);
    const body = z
      .object({
        username: z.string(),
        password: z.string(),
        role: z.enum(["admin", "editor", "viewer"]),
      })
      .strict()
      .parse(request.body);
    return reply
      .code(201)
      .send(
        await createAccount(
          store,
          body.username,
          body.password,
          body.role,
          account,
        ),
      );
  });
  app.get("/api/profiles", async (request) => {
    const account = actor(request);
    return store.db
      .prepare(
        `SELECT p.id,p.name,p.kind,p.owner_account_id, (p.pin_hash IS NOT NULL) AS pinProtected FROM profiles p WHERE ?='admin' OR p.owner_account_id=?
   OR EXISTS(SELECT 1 FROM profile_accounts a WHERE a.profile_id=p.id AND a.account_id=?) ORDER BY p.name`,
      )
      .all(account.role, account.id, account.id)
      .map((p) => {
        let locked = false;
        try {
          requireProfile(store, account, String(p.id));
        } catch (error) {
          if (error instanceof DomainError && error.statusCode === 403)
            locked = true;
          else throw error;
        }
        return { ...p, pinProtected: Boolean(p.pinProtected), locked };
      });
  });
  app.post("/api/profiles", async (request, reply) => {
    requireAdmin(actor(request));
    const body = z
      .object({
        name,
        kind: z.enum(["person", "room"]),
        ownerAccountId: id.optional(),
      })
      .strict()
      .parse(request.body);
    invariant(
      body.kind !== "person" || body.ownerAccountId,
      400,
      "Personal profile needs an owner",
    );
    if (body.ownerAccountId)
      invariant(
        store.db
          .prepare("SELECT id FROM accounts WHERE id=?")
          .get(body.ownerAccountId),
        400,
        "Unknown profile owner",
      );
    const profileId = randomUUID();
    store.db
      .prepare(
        "INSERT INTO profiles(id,name,kind,owner_account_id) VALUES(?,?,?,?)",
      )
      .run(profileId, body.name, body.kind, body.ownerAccountId ?? null);
    return reply.code(201).send({ id: profileId, ...body });
  });
  app.get("/api/profiles/:profileId/settings", async (request) => {
    const a = actor(request);
    requireAdmin(a);
    const { profileId } = z.object({ profileId: id }).parse(request.params);
    requireProfile(store, a, profileId);
    return {
      accounts: store.db
        .prepare(
          "SELECT p.account_id,a.username,p.can_manage FROM profile_accounts p JOIN accounts a ON a.id=p.account_id WHERE p.profile_id=?",
        )
        .all(profileId),
      grants: store.db
        .prepare(
          "SELECT source_id,subtree FROM source_grants WHERE profile_id=?",
        )
        .all(profileId),
    };
  });
  app.patch("/api/profiles/:profileId", async (request, reply) => {
    requireAdmin(actor(request));
    const { profileId } = z.object({ profileId: id }).parse(request.params),
      body = z
        .object({
          name: name.optional(),
          ownerAccountId: id.nullable().optional(),
        })
        .strict()
        .parse(request.body),
      current = store.db
        .prepare("SELECT name,kind,owner_account_id FROM profiles WHERE id=?")
        .get(profileId) as
        | { name: string; kind: string; owner_account_id: string | null }
        | undefined;
    invariant(current, 404, "Profile not found");
    const owner =
      body.ownerAccountId === undefined
        ? current.owner_account_id
        : body.ownerAccountId;
    invariant(
      current.kind !== "person" || owner,
      400,
      "Personal profile needs an owner",
    );
    if (owner)
      invariant(
        store.db.prepare("SELECT id FROM accounts WHERE id=?").get(owner),
        400,
        "Unknown profile owner",
      );
    store.db
      .prepare("UPDATE profiles SET name=?,owner_account_id=? WHERE id=?")
      .run(body.name ?? current.name, owner ?? null, profileId);
    return reply.code(204).send();
  });
  app.put(
    "/api/profiles/:profileId/accounts/:accountId",
    async (request, reply) => {
      const account = actor(request);
      requireAdmin(account);
      const params = z
        .object({ profileId: id, accountId: id })
        .parse(request.params);
      requireProfile(store, account, params.profileId);
      invariant(
        store.db
          .prepare("SELECT id FROM accounts WHERE id=?")
          .get(params.accountId),
        404,
        "Account not found",
      );
      const body = z
        .object({ canManage: z.boolean() })
        .strict()
        .parse(request.body);
      store.db
        .prepare(
          "INSERT INTO profile_accounts(profile_id,account_id,can_manage) VALUES(?,?,?) ON CONFLICT(profile_id,account_id) DO UPDATE SET can_manage=excluded.can_manage",
        )
        .run(params.profileId, params.accountId, Number(body.canManage));
      return reply.code(204).send();
    },
  );
  app.post("/api/sources", async (request, reply) => {
    requireAdmin(actor(request));
    const body = z
      .object({
        name,
        root: z.string().min(1),
        kind: z.enum(["shows", "movies", "videos", "commercials"]),
        recursive: z.boolean().default(true),
      })
      .strict()
      .parse(request.body);
    return reply
      .code(201)
      .send(
        await addSource(store, body, [...roots, generatedRoot], () =>
          requireAdmin(actor(request)),
        ),
      );
  });
  app.get("/api/sources", async (request) => {
    requireAdmin(actor(request));
    return store.db.prepare("SELECT * FROM sources ORDER BY name").all();
  });
  app.post("/api/sources/:sourceId/scan", async (request) => {
    requireAdmin(actor(request));
    const { sourceId } = z.object({ sourceId: id }).parse(request.params);
    return refresh.scan(sourceId);
  });
  app.post("/api/sources/:sourceId/import", async (request) => {
    requireAdmin(actor(request));
    const { sourceId } = z.object({ sourceId: id }).parse(request.params),
      source = sourceById(store, sourceId);
    const body = z
      .object({
        provider: z.enum(["sonarr", "radarr"]),
        url: z.url(),
        apiKey: z.string().min(1).max(512),
        mappings: z
          .array(
            z
              .object({ from: z.string().min(1), to: z.string().min(1) })
              .strict(),
          )
          .min(1)
          .max(100),
      })
      .strict()
      .parse(request.body);
    invariant(
      source.kind === (body.provider === "sonarr" ? "shows" : "movies"),
      400,
      "Integration type does not match source",
    );
    const items = await readIntegration(body.provider, body.url, body.apiKey);
    requireAdmin(actor(request));
    return importMetadata(store, source, items, body.mappings);
  });
  app.get("/api/sources/:sourceId/integration", async (request) => {
    requireAdmin(actor(request));
    const { sourceId } = z.object({ sourceId: id }).parse(request.params);
    sourceById(store, sourceId);
    const row = store.db
      .prepare(
        "SELECT provider,url,mappings_json FROM integrations WHERE source_id=?",
      )
      .get(sourceId);
    return row
      ? {
          provider: row.provider,
          url: row.url,
          mappings: JSON.parse(String(row.mappings_json)),
        }
      : null;
  });
  app.put("/api/sources/:sourceId/integration", async (request, reply) => {
    requireAdmin(actor(request));
    const { sourceId } = z.object({ sourceId: id }).parse(request.params);
    const body = z
      .object({
        provider: z.enum(["sonarr", "radarr"]),
        url: z.url(),
        apiKey: z.string().min(1).max(512),
        mappings: z
          .array(
            z
              .object({ from: z.string().min(1), to: z.string().min(1) })
              .strict(),
          )
          .min(1)
          .max(100),
      })
      .strict()
      .parse(request.body);
    refresh.configure(sourceId, body);
    return reply.code(204).send();
  });
  app.delete("/api/sources/:sourceId/integration", async (request, reply) => {
    requireAdmin(actor(request));
    const { sourceId } = z.object({ sourceId: id }).parse(request.params);
    store.db
      .prepare("DELETE FROM integrations WHERE source_id=?")
      .run(sourceId);
    return reply.code(204).send();
  });
  app.put("/api/sources/:sourceId/refresh", async (request, reply) => {
    requireAdmin(actor(request));
    const { sourceId } = z.object({ sourceId: id }).parse(request.params),
      body = z
        .object({ intervalMs: z.number().int().nullable() })
        .strict()
        .parse(request.body);
    refresh.schedule(sourceId, body.intervalMs);
    return reply.code(204).send();
  });
  app.get("/api/admin/refresh", async (request) => {
    requireAdmin(actor(request));
    return store.db
      .prepare(
        "SELECT r.*,i.provider,i.url,i.last_success FROM refresh_sources r LEFT JOIN integrations i ON i.source_id=r.source_id",
      )
      .all();
  });
  app.post("/api/profiles/:profileId/grants", async (request, reply) => {
    const account = actor(request);
    requireAdmin(account);
    const { profileId } = z.object({ profileId: id }).parse(request.params);
    requireProfile(store, account, profileId);
    const body = z
      .object({ sourceId: id, subtree: z.string().default("") })
      .strict()
      .parse(request.body);
    sourceById(store, body.sourceId);
    const subtree = normalizeSubtree(body.subtree);
    store.db
      .prepare(
        "INSERT OR IGNORE INTO source_grants(profile_id,source_id,subtree) VALUES(?,?,?)",
      )
      .run(profileId, body.sourceId, subtree);
    return reply
      .code(201)
      .send({ profileId, sourceId: body.sourceId, subtree });
  });
  app.get("/api/profiles/:profileId/media", async (request) => {
    const account = actor(request),
      { profileId } = z.object({ profileId: id }).parse(request.params);
    requireProfile(store, account, profileId);
    const query = z
      .object({
        search: z.string().max(200).default(""),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(request.query);
    const media = (
      store.db
        .prepare("SELECT * FROM media WHERE available=1 ORDER BY title,id")
        .all() as unknown as Media[]
    )
      .filter((m) => canReadMedia(store, account, profileId, m))
      .map((m) => displayMedia(store, m))
      .filter((m) =>
        [
          m.title,
          m.relative_path,
          JSON.parse(m.metadata_json).seriesTitle ?? "",
        ].some((v) => v.toLowerCase().includes(query.search.toLowerCase())),
      );
    return {
      total: media.length,
      items: media
        .slice((query.page - 1) * query.limit, query.page * query.limit)
        .map(({ mtime_ms, size, ...item }) => item),
    };
  });
  app.get("/api/profiles/:profileId/media/:mediaId", async (request) => {
    const account = actor(request),
      { profileId, mediaId } = z
        .object({ profileId: id, mediaId: id })
        .parse(request.params);
    requireProfile(store, account, profileId);
    const item = getMedia(mediaId);
    invariant(
      canReadMedia(store, account, profileId, item),
      404,
      "Media not found",
    );
    const { size, mtime_ms, ...response } = displayMedia(store, item);
    return response;
  });
  const programming = new ProgrammingService(store);
  const collectionRetention = retentionDays(options.collectionRetentionDays, 7);
  const collections = new CollectionRecovery(store),
    reports = new ProblemReports(
      store,
      retentionDays(options.reportRetentionDays, 30),
    );
  registerFoundationRoutes(app, store, actor, programming, collectionRetention);
  registerRetainedRoutes(app, store, actor, reports, collections);
  registerMetadataRoutes(app, store, actor, [
    ...roots,
    generatedRoot,
    cacheRoot,
  ]);
  registerSubtitleRoutes(app, store, actor, [
    ...roots,
    generatedRoot,
    cacheRoot,
  ]);
  const operations = new OperationsService(
    store,
    dirname(store.filename),
    generatedRoot,
    cacheRoot,
  );
  app.get("/api/admin/sources/:sourceId/imports", async (request) => {
    const account = actor(request);
    requireAdmin(account);
    const { sourceId } = z.object({ sourceId: id }).parse(request.params);
    sourceById(store, sourceId);
    return {
      items: store.db
        .prepare(
          "SELECT id,provider,completed_ms,scan_complete,summary_json FROM integration_runs WHERE source_id=? ORDER BY completed_ms DESC,rowid DESC LIMIT 20",
        )
        .all(sourceId)
        .map((row) => ({
          ...row,
          summary: JSON.parse(String(row.summary_json)),
          summary_json: undefined,
          removalsApplied: false,
          providerAcceptanceRequired: true,
        })),
    };
  });
  app.get("/api/admin/imports/:runId", async (request) => {
    const account = actor(request);
    requireAdmin(account);
    const { runId } = z.object({ runId: id }).parse(request.params),
      { offset, limit } = z
        .object({
          offset: z.coerce.number().int().min(0).max(1000000).default(0),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        })
        .parse(request.query);
    const run = store.db
      .prepare(
        "SELECT id,source_id,provider,completed_ms,scan_complete,summary_json FROM integration_runs WHERE id=?",
      )
      .get(runId);
    invariant(run, 404, "Import report not found");
    return {
      ...run,
      summary: JSON.parse(String(run.summary_json)),
      summary_json: undefined,
      removalsApplied: false,
      providerAcceptanceRequired: true,
      items: store.db
        .prepare(
          "SELECT external_id,previous_media_id,matched_media_id,state FROM integration_run_items WHERE run_id=? ORDER BY external_id LIMIT ? OFFSET ?",
        )
        .all(runId, limit, offset)
        .map((row) => {
          const mediaId = row.matched_media_id ?? row.previous_media_id;
          const media = mediaId
            ? (store.db
                .prepare("SELECT * FROM media WHERE id=?")
                .get(mediaId) as unknown as Media | undefined)
            : undefined;
          return {
            ...row,
            ...(media
              ? {
                  title: displayMedia(store, media).title,
                  relativePath: media.relative_path,
                }
              : {}),
          };
        }),
      offset,
      limit,
    };
  });
  app.get("/api/admin/status", (request) => operations.status(actor(request)));
  app.get("/api/admin/setup", async (request) =>
    operations.setup(actor(request)),
  );
  app.get(
    "/api/admin/profiles/:profileId/access/:accountId",
    async (request) => {
      const account = actor(request);
      requireAdmin(account);
      const { profileId, accountId } = z
        .object({ profileId: id, accountId: id })
        .parse(request.params);
      return effectiveAccess(store, account, accountId, profileId);
    },
  );
  app.post("/api/admin/sources/:sourceId/mapping-check", async (request) => {
    const account = actor(request);
    requireAdmin(account);
    const { sourceId } = z.object({ sourceId: id }).parse(request.params),
      { paths } = z
        .object({ paths: z.array(z.string().min(1).max(4096)).max(20) })
        .strict()
        .parse(request.body);
    return operations.mapping(account, sourceId, paths);
  });
  const playback = new PlaybackService(store, programming);
  const streaming = new StreamingService(
    store,
    playback,
    resolve(cacheRoot, "hls"),
    undefined,
    undefined,
    encoders,
  );
  app.addHook("onClose", async () => streaming.stop());
  app.post("/api/playback/sessions/:sessionId/negotiate", async (request) => {
    const account = actor(request),
      { sessionId } = z.object({ sessionId: id }).parse(request.params),
      body = z
        .object({
          containers: z.array(z.string().max(40)).max(50),
          videoCodecs: z.array(z.string().max(40)).max(50),
          audioCodecs: z.array(z.string().max(40)).max(50),
        })
        .strict()
        .parse(request.body);
    return streaming.negotiate(account, sessionId, body);
  });
  app.get(
    "/api/playback/sessions/:sessionId/hls/index.m3u8",
    async (request, reply) => {
      const account = actor(request),
        { sessionId } = z.object({ sessionId: id }).parse(request.params);
      return reply.type("application/vnd.apple.mpegurl").send(
        streaming.manifest(
          account,
          sessionId,
          Date.now(),
          z
            .object({
              audioTrack: z.coerce.number().int().nonnegative().optional(),
            })
            .parse(request.query).audioTrack,
        ),
      );
    },
  );
  app.get(
    "/api/playback/sessions/:sessionId/hls/:entryId/:start.ts",
    async (request, reply) => {
      const { sessionId, entryId, start } = z
          .object({
            sessionId: id,
            entryId: id,
            start: z.coerce.number().int().nonnegative(),
          })
          .parse(request.params),
        { audioTrack } = z
          .object({
            audioTrack: z.coerce.number().int().nonnegative().optional(),
          })
          .parse(request.query);
      const bytes = await streaming.segment(
        () => {
          invariant(!reply.raw.destroyed, 499, "Playback request disconnected");
          return actor(request);
        },
        sessionId,
        entryId,
        start,
        audioTrack,
      );
      return reply.type("video/mp2t").send(bytes);
    },
  );
  if (options.autoMaintenance) {
    let task: Promise<void> | undefined,
      stopping = false;
    const maintain = () => {
      if (stopping) return Promise.resolve();
      if (task) return task;
      task = (async () => {
        playback.collect();
        collections.purge();
        reports.purge();
        await streaming.cleanup();
        await refresh.tick();
        if (stopping) return;
        for (const row of store.db
          .prepare(
            "SELECT a.channel_id FROM active_schedules a JOIN channels c ON c.id=a.channel_id WHERE c.archived=0",
          )
          .all())
          try {
            programming.ensure(String(row.channel_id));
          } catch {
            app.log.warn(
              "Schedule extension deferred; programming unavailable",
            );
          }
      })().finally(() => {
        task = undefined;
      });
      return task;
    };
    const timer = setInterval(
      () => void maintain().catch(() => app.log.error("Maintenance failed")),
      30000,
    );
    timer.unref();
    app.addHook("onReady", async () => {
      void maintain().catch(() => app.log.error("Maintenance failed"));
    });
    app.addHook("onClose", async () => {
      stopping = true;
      clearInterval(timer);
      await refresh.stop();
      await task;
    });
  }

  app.post("/api/playback/startup", async (request) =>
    playback.startup(actor(request)),
  );
  app.post("/api/playback/profiles/:profileId/select", async (request) => {
    const account = actor(request),
      { profileId } = z.object({ profileId: id }).parse(request.params);
    return playback.startup(account, profileId);
  });
  app.post("/api/playback/sessions", async (request, reply) => {
    const account = actor(request),
      body = z
        .object({ profileId: id, channelId: id })
        .strict()
        .parse(request.body);
    return reply
      .code(201)
      .send(playback.join(account, body.profileId, body.channelId));
  });
  app.get("/api/playback/sessions/:sessionId", async (request) => {
    const account = actor(request),
      { sessionId } = z.object({ sessionId: id }).parse(request.params);
    return playback.describe(account, sessionId);
  });
  app.post(
    "/api/playback/sessions/:sessionId/events",
    async (request, reply) => {
      const account = actor(request),
        { sessionId } = z.object({ sessionId: id }).parse(request.params),
        event = z
          .object({
            id,
            entryId: id,
            startMs: z.number().int().nonnegative(),
            endMs: z.number().int().positive(),
          })
          .strict()
          .parse(request.body);
      playback.record(account, sessionId, event);
      return reply.code(204).send();
    },
  );
  app.get("/api/playback/sessions/:sessionId/history", async (request) => {
    const account = actor(request),
      { sessionId } = z.object({ sessionId: id }).parse(request.params);
    return playback.history(account, sessionId);
  });
  for (const action of ["pause", "resume", "goLive"] as const)
    app.post(`/api/playback/sessions/:sessionId/${action}`, async (request) => {
      const account = actor(request),
        { sessionId } = z.object({ sessionId: id }).parse(request.params);
      return playback[action](account, sessionId);
    });
  app.delete("/api/playback/sessions/:sessionId", async (request, reply) => {
    const account = actor(request),
      { sessionId } = z.object({ sessionId: id }).parse(request.params);
    playback.leave(account, sessionId);
    return reply.code(204).send();
  });
  const generationSchema = z
    .object({
      sourceId: id,
      directory: z.string().default(""),
      recursive: z.boolean().default(false),
      kinds: z
        .array(z.enum(["thumbnail", "gif", "conversion"]))
        .min(1)
        .max(3),
      regenerate: z.boolean().default(false),
    })
    .strict();
  app.post("/api/generation/preview", async (request) => {
    requireAdmin(actor(request));
    const preview = await generationPreflight(
      store,
      generationSchema.parse(request.body),
      generatedRoot,
    );
    return {
      sourceId: preview.source.id,
      directory: preview.directory,
      count: preview.items.length,
      reusableOutputs: preview.reusableOutputs,
      newOutputs: preview.newOutputs,
      totalOutputs: preview.totalOutputs,
      totalDurationMs: preview.totalDurationMs,
      availableBytes: preview.availableBytes,
      fingerprintBasis: preview.fingerprintBasis,
      estimatedBytes: null,
      estimatedDurationMs: null,
      items: preview.items.map((item) => ({
        id: item.id,
        title: item.title,
        durationMs: item.duration_ms,
      })),
    };
  });
  app.post("/api/generation/jobs", async (request, reply) => {
    requireAdmin(actor(request));
    const job = await generation.enqueue(generationSchema.parse(request.body));
    void generation
      .drain()
      .catch((error) =>
        app.log.error({ err: error }, "Generation worker failed"),
      );
    return reply.code(202).send(job);
  });
  app.get("/api/generation/jobs/:jobId", async (request) => {
    requireAdmin(actor(request));
    const { jobId } = z.object({ jobId: id }).parse(request.params);
    return { ...generation.get(jobId), items: generation.tasks(jobId) };
  });
  app.post("/api/generation/jobs/:jobId/cancel", async (request, reply) => {
    requireAdmin(actor(request));
    const { jobId } = z.object({ jobId: id }).parse(request.params);
    generation.cancel(jobId);
    return reply.code(204).send();
  });
  app.get("/api/admin/generation", async (request) => {
    requireAdmin(actor(request));
    return generation.list();
  });
  app.post("/api/admin/generation/:jobId/retry", async (request) => {
    requireAdmin(actor(request));
    const { jobId } = z.object({ jobId: id }).parse(request.params);
    const result = generation.retry(jobId);
    void generation
      .drain()
      .catch(() => app.log.error("Generation worker failed"));
    return result;
  });
  app.post("/api/admin/assets/cleanup", async (request) => {
    requireAdmin(actor(request));
    const body = z
      .object({
        dryRun: z.boolean().default(true),
        reconcile: z.boolean().default(false),
        review: z.string().length(64).optional(),
      })
      .strict()
      .parse(request.body);
    if (body.reconcile)
      return generation.withStorageMaintenance((check) =>
        reconcileAssets(store, generatedRoot, body.dryRun, body.review, () => {
          check();
          requireAdmin(actor(request));
        }),
      );
    return generation.withStorageMaintenance((check) => {
      check();
      requireAdmin(actor(request));
      return cleanupAssets(store, generatedRoot, body.dryRun);
    });
  });
  app.route({
    method: ["GET", "HEAD"],
    url: "/api/profiles/:profileId/media/:mediaId/assets/:kind",
    handler: async (request, reply) => {
      const account = actor(request),
        { profileId, mediaId, kind } = z
          .object({
            profileId: id,
            mediaId: id,
            kind: z.enum(["thumbnail", "gif", "conversion"]),
          })
          .parse(request.params);
      const item = getMedia(mediaId);
      invariant(
        item.available && canReadMedia(store, account, profileId, item),
        404,
        "Media not found",
      );
      const source = sourceById(store, item.source_id);
      let original;
      try {
        original = await stat(await safeMediaPath(source, item.relative_path));
      } catch {
        throw new DomainError(404, "Media unavailable");
      }
      invariant(
        original.size === item.size && original.mtimeMs === item.mtime_ms,
        409,
        "Source changed; rescan and regenerate",
      );
      const asset = store.db
        .prepare(
          "SELECT relative_path FROM generated_assets WHERE media_id=? AND kind=? AND fingerprint=?",
        )
        .get(item.id, kind, assetFingerprint(item, kind)) as
        { relative_path: string } | undefined;
      invariant(asset, 404, "Generated asset not found");
      let handle;
      try {
        const root = await realpath(generatedRoot);
        handle = await open(
          await safeMediaPath(
            { ...source, root_path: root },
            asset.relative_path,
          ),
          "r",
        );
      } catch {
        throw new DomainError(404, "Generated asset unavailable");
      }
      let transferred = false;
      try {
        const info = await handle.stat();
        const fresh = getMedia(mediaId),
          current = actor(request);
        invariant(
          fresh.available && canReadMedia(store, current, profileId, fresh),
          404,
          "Media not found",
        );
        invariant(
          fresh.source_id === item.source_id &&
            fresh.relative_path === item.relative_path &&
            fresh.size === item.size &&
            fresh.mtime_ms === item.mtime_ms &&
            sourceById(store, fresh.source_id).root_path === source.root_path,
          409,
          "Media changed; retry delivery",
        );
        invariant(
          store.db
            .prepare(
              "SELECT relative_path FROM generated_assets WHERE media_id=? AND kind=? AND fingerprint=?",
            )
            .get(fresh.id, kind, assetFingerprint(fresh, kind))
            ?.relative_path === asset.relative_path,
          404,
          "Generated asset not found",
        );
        const range = parseRange(request.headers.range, info.size);
        reply.header("Accept-Ranges", "bytes");
        if (range === "invalid")
          return reply
            .code(416)
            .header("Content-Range", `bytes */${info.size}`)
            .send();
        const start = range?.start ?? 0,
          end = range?.end ?? info.size - 1;
        if (range)
          reply
            .code(206)
            .header("Content-Range", `bytes ${start}-${end}/${info.size}`);
        reply
          .header(
            "Content-Type",
            kind === "thumbnail"
              ? "image/jpeg"
              : kind === "gif"
                ? "image/gif"
                : "video/mp4",
          )
          .header("Content-Length", end - start + 1);
        if (request.method === "HEAD") return reply.send();
        const stream = handle.createReadStream({ start, end, autoClose: true });
        transferred = true;
        const untrack = access.track(
          () => {
            const current = actor(request);
            const fresh = getMedia(mediaId);
            return Boolean(
              fresh.available && canReadMedia(store, current, profileId, fresh),
            );
          },
          () => {
            stream.destroy();
            reply.raw.destroy();
          },
        );
        stream.once("close", untrack);
        reply.raw.once("close", () => {
          untrack();
          stream.destroy();
        });
        return reply.send(stream);
      } finally {
        if (!transferred) await handle.close();
      }
    },
  });
  const subtitles = new SubtitleService(
    resolve(cacheRoot, "subtitles"),
    undefined,
    encoders,
    store,
  );
  app.addHook("preClose", async () => subtitles.stop());
  app.get(
    "/api/profiles/:profileId/media/:mediaId/subtitles/:index.vtt",
    async (request, reply) => {
      const { profileId, mediaId, index } = z
          .object({
            profileId: id,
            mediaId: id,
            index: z.coerce.number().int().nonnegative(),
          })
          .parse(request.params),
        item = getMedia(mediaId);
      const authorize = () => {
        invariant(!reply.raw.destroyed, 499, "Playback request disconnected");
        const fresh = getMedia(mediaId);
        invariant(
          fresh.available &&
            fresh.size === item.size &&
            fresh.mtime_ms === item.mtime_ms &&
            canReadMedia(store, actor(request), profileId, fresh),
          404,
          "Subtitle unavailable",
        );
      };
      authorize();
      return reply
        .type("text/vtt; charset=utf-8")
        .send(
          await subtitles.get(
            sourceById(store, item.source_id),
            item,
            index,
            authorize,
          ),
        );
    },
  );
  const artwork = new ArtworkService(
    store,
    resolve(cacheRoot, "artwork"),
    options.integrationKey,
  );
  app.addHook("preClose", async () => artwork.stop());
  app.get(
    "/api/profiles/:profileId/media/:mediaId/artwork/:index",
    async (request, reply) => {
      const { profileId, mediaId, index } = z
          .object({
            profileId: id,
            mediaId: id,
            index: z.coerce.number().int().min(0).max(20),
          })
          .parse(request.params),
        item = getMedia(mediaId);
      invariant(
        item.available && canReadMedia(store, actor(request), profileId, item),
        404,
        "Artwork unavailable",
      );
      const result = await artwork.get(item, index);
      invariant(
        canReadMedia(store, actor(request), profileId, getMedia(mediaId)),
        404,
        "Artwork unavailable",
      );
      return reply.type(result.type).send(result.bytes);
    },
  );
  app.post("/api/channels", async (request, reply) => {
    const account = actor(request);
    const body = z
      .object({
        name,
        shortName: z.string().trim().min(1).max(12).nullable().optional(),
        profileId: id,
        visibility: z.enum(["shared", "private"]),
        ownerAccountId: id.optional(),
      })
      .strict()
      .parse(request.body);
    requireProfile(store, account, body.profileId, true);
    if (body.visibility === "shared") requireAdmin(account);
    if (body.ownerAccountId) requireAdmin(account);
    const ownerId = body.ownerAccountId ?? account.id;
    invariant(
      store.db.prepare("SELECT id FROM accounts WHERE id=?").get(ownerId),
      400,
      "Unknown channel owner",
    );
    const channelId = randomUUID();
    store.db
      .prepare(
        "INSERT INTO channels(id,name,owner_account_id,visibility,short_name) VALUES(?,?,?,?,?)",
      )
      .run(
        channelId,
        body.name,
        ownerId,
        body.visibility,
        body.shortName ?? null,
      );
    return reply.code(201).send({
      id: channelId,
      name: body.name,
      visibility: body.visibility,
      owner_account_id: ownerId,
      short_name: body.shortName ?? null,
    });
  });
  app.patch("/api/channels/:channelId", async (request, reply) => {
    const account = actor(request),
      { channelId } = z.object({ channelId: id }).parse(request.params),
      channel = store.db
        .prepare("SELECT * FROM channels WHERE id=?")
        .get(channelId) as Channel | undefined;
    invariant(
      channel &&
        (account.role === "admin" ||
          channel.visibility === "shared" ||
          channel.owner_account_id === account.id),
      404,
      "Channel not found",
    );
    channelOwner(account, channel);
    const body = z
      .object({
        name: name.optional(),
        description: z.string().max(20000).optional(),
        expectedDetailsRevision: z.number().int().nonnegative().optional(),
        shortName: z.string().trim().min(1).max(12).nullable().optional(),
        visibility: z.enum(["shared", "private"]).optional(),
        archived: z.boolean().optional(),
      })
      .strict()
      .parse(request.body);
    if (body.visibility === "shared") requireAdmin(account);
    store.transaction(() => {
      if (body.expectedDetailsRevision !== undefined)
        invariant(
          Number(
            store.db
              .prepare("SELECT details_revision FROM channels WHERE id=?")
              .get(channelId)?.details_revision,
          ) === body.expectedDetailsRevision,
          409,
          "Channel details changed elsewhere; review the latest details before saving",
        );
      store.db
        .prepare(
          "UPDATE channels SET description=COALESCE(?,description),details_revision=details_revision+1 WHERE id=?",
        )
        .run(body.description ?? null, channelId);
      store.db
        .prepare(
          "UPDATE channels SET name=COALESCE(?,name),visibility=COALESCE(?,visibility),archived=COALESCE(?,archived) WHERE id=?",
        )
        .run(
          body.name ?? null,
          body.visibility ?? null,
          body.archived === undefined ? null : Number(body.archived),
          channelId,
        );
      if (body.shortName !== undefined)
        store.db
          .prepare("UPDATE channels SET short_name=? WHERE id=?")
          .run(body.shortName, channelId);
      if (body.archived) {
        store.db
          .prepare("DELETE FROM playback_sessions WHERE channel_id=?")
          .run(channelId);
        store.db
          .prepare("DELETE FROM subscriptions WHERE channel_id=?")
          .run(channelId);
      }
    });
    return reply.code(204).send();
  });
  app.delete("/api/channels/:channelId", async (request, reply) => {
    const account = actor(request),
      { channelId } = z.object({ channelId: id }).parse(request.params),
      channel = visibleChannel(store, account, channelId);
    channelOwner(account, channel);
    store.transaction(() => {
      store.db
        .prepare("UPDATE channels SET archived=1 WHERE id=?")
        .run(channelId);
      store.db
        .prepare("DELETE FROM playback_sessions WHERE channel_id=?")
        .run(channelId);
      store.db
        .prepare("DELETE FROM subscriptions WHERE channel_id=?")
        .run(channelId);
    });
    return reply.code(204).send();
  });
  app.get("/api/profiles/:profileId/channels", async (request) => {
    const account = actor(request),
      { profileId } = z.object({ profileId: id }).parse(request.params);
    requireProfile(store, account, profileId);
    return (
      store.db
        .prepare(
          "SELECT * FROM channels WHERE archived=0 AND (?='admin' OR visibility='shared' OR owner_account_id=?) ORDER BY name,id",
        )
        .all(account.role, account.id) as unknown as Channel[]
    ).filter((channel) => {
      try {
        requireChannelMedia(store, account, profileId, channel);
        return true;
      } catch {
        return false;
      }
    });
  });
  app.put(
    "/api/profiles/:profileId/subscriptions/:channelId",
    async (request, reply) => {
      const account = actor(request),
        { profileId, channelId } = z
          .object({ profileId: id, channelId: id })
          .parse(request.params);
      requireProfile(store, account, profileId, true);
      const channel = visibleChannel(store, account, channelId);
      requireChannelMedia(store, account, profileId, channel);
      store.db
        .prepare(
          "INSERT OR IGNORE INTO subscriptions(profile_id,channel_id,position) VALUES(?,?,(SELECT COALESCE(MAX(position),0)+1 FROM subscriptions WHERE profile_id=?))",
        )
        .run(profileId, channelId, profileId);
      return reply.code(204).send();
    },
  );
  app.delete(
    "/api/profiles/:profileId/subscriptions/:channelId",
    async (request, reply) => {
      const account = actor(request),
        { profileId, channelId } = z
          .object({ profileId: id, channelId: id })
          .parse(request.params);
      requireProfile(store, account, profileId, true);
      visibleChannel(store, account, channelId);
      store.db
        .prepare(
          "DELETE FROM subscriptions WHERE profile_id=? AND channel_id=?",
        )
        .run(profileId, channelId);
      store.db
        .prepare(
          "DELETE FROM playback_sessions WHERE profile_id=? AND channel_id=?",
        )
        .run(profileId, channelId);
      return reply.code(204).send();
    },
  );
  app.post("/api/channels/:channelId/schedule", async (request, reply) => {
    const account = actor(request),
      { channelId } = z.object({ channelId: id }).parse(request.params);
    const channel = visibleChannel(store, account, channelId);
    channelOwner(account, channel);
    const body = z
      .object({
        profileId: id,
        startMs: z.number().int().nonnegative(),
        untilMs: z.number().int().nonnegative(),
        groups: groupsSchema,
        commercialIds: z.array(id).max(5000).default([]),
        rules: rulesSchema,
        seed: z.number().int().min(0).max(0xffffffff).optional(),
      })
      .strict()
      .parse(request.body);
    requireProfile(store, account, body.profileId, true);
    invariant(
      body.untilMs > body.startMs &&
        body.untilMs - body.startMs <= 7 * 86400000,
      400,
      "Schedule window must be positive and at most seven days",
    );
    // Initial publish only until revision-boundary edits and paused-session retention are implemented.
    invariant(
      !store.db
        .prepare("SELECT channel_id FROM active_schedules WHERE channel_id=?")
        .get(channelId),
      409,
      "Use the recurring programming endpoint to edit an existing schedule",
    );
    const media = new Map(
      [...body.groups.flatMap((g) => g.mediaIds), ...body.commercialIds].map(
        (mediaId) => {
          const item = getMedia(mediaId);
          invariant(
            item.available &&
              canReadMedia(store, account, body.profileId, item),
            404,
            "Media not found",
          );
          return [mediaId, item] as const;
        },
      ),
    );
    const clip = (mediaId: string): Clip => {
      const item = media.get(mediaId)!;
      const metadata = JSON.parse(item.metadata_json) as {
        seasonNumber?: number;
        episodeNumber?: number;
      };
      return {
        id: item.id,
        durationMs: item.duration_ms,
        title: item.title,
        ...(metadata.seasonNumber === undefined
          ? {}
          : { seasonNumber: metadata.seasonNumber }),
        ...(metadata.episodeNumber === undefined
          ? {}
          : { episodeNumber: metadata.episodeNumber }),
      };
    };
    for (const mediaId of body.commercialIds)
      invariant(
        sourceById(store, media.get(mediaId)!.source_id).kind === "commercials",
        400,
        "Commercial pool must use commercial sources",
      );
    const { random: randomRule, ...baseRules } = body.rules;
    const rules = {
      ...baseRules,
      ...(randomRule === undefined ? {} : { random: randomRule }),
    };
    const result = buildSchedule({
      channelId,
      startMs: body.startMs,
      untilMs: body.untilMs,
      groups: body.groups.map((g) => ({
        id: g.id,
        mode: g.mode,
        clips: [...new Set(g.mediaIds)].map(clip),
      })),
      commercials: body.commercialIds.map(clip),
      rules,
      state: initialState(body.seed),
    });
    const revision = persistSchedule(
      store,
      channelId,
      result.entries,
      result.state,
      Date.now(),
      [...media.keys()],
    );
    return reply
      .code(201)
      .send({ revisionId: revision, entries: result.entries });
  });
  app.get(
    "/api/profiles/:profileId/channels/:channelId/live",
    async (request) => {
      const account = actor(request),
        { profileId, channelId } = z
          .object({ profileId: id, channelId: id })
          .parse(request.params);
      const channel = visibleChannel(store, account, channelId);
      const query = z
        .object({ atMs: z.coerce.number().int().nonnegative().optional() })
        .parse(request.query);
      requireChannelMedia(store, account, profileId, channel, {
        positionMs: query.atMs ?? Date.now(),
      });
      const live = resolveLive(store, channelId, query.atMs ?? Date.now());
      invariant(live, 404, "No scheduled programming at this time");
      return live;
    },
  );
  app.route({
    method: ["GET", "HEAD"],
    url: "/api/profiles/:profileId/media/:mediaId/file",
    handler: async (request, reply) => {
      const account = actor(request),
        { profileId, mediaId } = z
          .object({ profileId: id, mediaId: id })
          .parse(request.params),
        media = getMedia(mediaId);
      invariant(
        media.available && canReadMedia(store, account, profileId, media),
        404,
        "Media not found",
      );
      const source = sourceById(store, media.source_id);
      let handle;
      try {
        handle = await open(
          await safeMediaPath(source, media.relative_path),
          "r",
        );
      } catch {
        throw new DomainError(404, "Media unavailable");
      }
      let transferred = false;
      try {
        const info = await handle.stat();
        const fresh = getMedia(mediaId),
          current = actor(request);
        invariant(
          fresh.available && canReadMedia(store, current, profileId, fresh),
          404,
          "Media not found",
        );
        invariant(
          fresh.source_id === media.source_id &&
            fresh.relative_path === media.relative_path &&
            fresh.size === media.size &&
            fresh.mtime_ms === media.mtime_ms &&
            sourceById(store, fresh.source_id).root_path === source.root_path,
          409,
          "Media changed; retry delivery",
        );
        invariant(
          info.size === media.size && info.mtimeMs === media.mtime_ms,
          409,
          "Media changed; rescan source before playback",
        );
        const range = parseRange(request.headers.range, info.size);
        reply.header("Accept-Ranges", "bytes");
        if (range === "invalid")
          return reply
            .code(416)
            .header("Content-Range", `bytes */${info.size}`)
            .send();
        const start = range?.start ?? 0,
          end = range?.end ?? info.size - 1;
        if (range)
          reply
            .code(206)
            .header("Content-Range", `bytes ${start}-${end}/${info.size}`);
        reply
          .header(
            "Content-Type",
            mime[extname(media.relative_path).toLowerCase()] ??
              "application/octet-stream",
          )
          .header("Content-Length", end - start + 1);
        if (request.method === "HEAD") return reply.send();
        const stream = handle.createReadStream({ start, end, autoClose: true });
        transferred = true;
        const untrack = access.track(
          () => {
            const current = actor(request);
            const fresh = getMedia(mediaId);
            return Boolean(
              fresh.available && canReadMedia(store, current, profileId, fresh),
            );
          },
          () => {
            stream.destroy();
            reply.raw.destroy();
          },
        );
        stream.once("close", untrack);
        reply.raw.once("close", () => {
          untrack();
          stream.destroy();
        });
        return reply.send(stream);
      } finally {
        if (!transferred) await handle.close();
      }
    },
  });
  return app;
}
