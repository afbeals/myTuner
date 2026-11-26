import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Store } from "./database.js";
import type { Account } from "./domain.js";
import { requireAdmin, sourceById } from "./security.js";
import type { RefreshService } from "./refresh.js";
import { PathSuggestions } from "./setup-suggestions.js";
import { PathResolver } from "./path-resolver.js";
import { invariant } from "./domain.js";

const connection = z.object({
  provider: z.enum(["sonarr", "radarr"]),
  url: z.url().max(4096),
  apiKey: z.string().min(1).max(512).optional(),
  reuseSourceId: z.string().uuid().optional(),
});
export function registerSetupRoutes(
  app: FastifyInstance,
  store: Store,
  actor: (request: FastifyRequest) => Account,
  refresh: RefreshService,
  writableRoots: string[],
) {
  const paths = new PathSuggestions(store, writableRoots);
  const resolver = new PathResolver(store, writableRoots);
  app.addHook("preClose", async () => resolver.stop());
  app.post("/api/admin/setup/check-directory", async (request, reply) => {
    requireAdmin(actor(request));
    const input = z
      .object({
        path: z.string().max(4096),
        purpose: z.enum(["source", "metadata", "subtitles"]),
        sourceId: z.string().uuid().optional(),
        recursive: z.boolean(),
      })
      .strict()
      .parse(request.body);
    const before = input.sourceId
      ? JSON.stringify(sourceById(store, input.sourceId))
      : undefined;
    const authorize = () => {
      requireAdmin(actor(request));
      if (input.sourceId)
        invariant(
          JSON.stringify(sourceById(store, input.sourceId)) === before,
          409,
          "Source settings changed during the check. Review the directory and retry.",
        );
    };
    const controller = new AbortController();
    const abort = () => controller.abort();
    const closed = () => {
      if (!reply.raw.writableEnded) abort();
    };
    request.raw.once("aborted", abort);
    reply.raw.once("close", closed);
    try {
      return await resolver.check(input, authorize, controller.signal);
    } finally {
      request.raw.off("aborted", abort);
      reply.raw.off("close", closed);
    }
  });
  app.get("/api/admin/setup/provider-connections", async (request) => {
    requireAdmin(actor(request));
    return store.db
      .prepare(
        "SELECT s.id AS source_id,s.name,i.provider,i.url FROM integrations i JOIN sources s ON s.id=i.source_id ORDER BY s.name,s.id LIMIT 100",
      )
      .all();
  });
  app.get("/api/admin/setup/path-suggestions", async (request) => {
    requireAdmin(actor(request));
    const input = z
      .object({
        purpose: z.enum(["source", "metadata", "subtitles"]).default("source"),
        sourceId: z.string().uuid().optional(),
      })
      .strict()
      .parse(request.query);
    if (input.sourceId) sourceById(store, input.sourceId);
    const result = await paths.read(input.purpose, input.sourceId);
    requireAdmin(actor(request));
    return result;
  });
  const route = "/api/sources/:sourceId/provider-suggestions";
  const sourceId = (request: FastifyRequest) =>
    z.object({ sourceId: z.string().uuid() }).parse(request.params).sourceId;
  app.get(route, async (request) => {
    requireAdmin(actor(request));
    return refresh.suggestions(sourceId(request));
  });
  app.post(route + "/refresh", async (request) => {
    const authorize = () => requireAdmin(actor(request));
    authorize();
    const { configRevision, ...draft } = connection
      .extend({ configRevision: z.string().length(64) })
      .strict()
      .parse(request.body);
    return refresh.refreshSuggestions(
      sourceId(request),
      draft,
      configRevision,
      authorize,
    );
  });
  app.post(route + "/mapping-preview", async (request) => {
    requireAdmin(actor(request));
    const input = connection
      .extend({
        mappings: z
          .array(
            z
              .object({
                from: z.string().min(1).max(4096),
                to: z.string().min(1).max(4096),
              })
              .strict(),
          )
          .min(1)
          .max(100),
        sourceRevision: z.string().length(64),
        configRevision: z.string().length(64),
        inventoryRevision: z.string().length(64),
        paths: z.array(z.string().min(1).max(4096)).max(20).optional(),
      })
      .strict()
      .parse(request.body);
    return refresh.previewMapping(sourceId(request), input);
  });
}
