import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Store } from "./database.js";
import type { Account } from "./domain.js";
import { requireAdmin } from "./security.js";
import {
  CollectionRecovery,
  ProblemReports,
  recentlyAired,
} from "./retained.js";
const uuid = z.string().uuid();
export function registerRetainedRoutes(
  app: FastifyInstance,
  store: Store,
  actor: (r: FastifyRequest) => Account,
  reports: ProblemReports,
  collections: CollectionRecovery,
) {
  app.get("/api/profiles/:profileId/deleted-collections", (request) => {
    const account = actor(request),
      { profileId } = z.object({ profileId: uuid }).parse(request.params);
    return collections.list(account, profileId);
  });
  app.post(
    "/api/profiles/:profileId/deleted-collections/:collectionId/restore",
    (request) => {
      const account = actor(request),
        { profileId, collectionId } = z
          .object({ profileId: uuid, collectionId: uuid })
          .parse(request.params);
      return collections.restore(account, profileId, collectionId);
    },
  );
  app.get("/api/profiles/:profileId/channels/:channelId/recent", (request) => {
    const account = actor(request),
      { profileId, channelId } = z
        .object({ profileId: uuid, channelId: uuid })
        .parse(request.params);
    return recentlyAired(store, account, profileId, channelId);
  });
  app.post("/api/playback/sessions/:sessionId/report-preview", (request) => {
    const account = actor(request),
      { sessionId } = z.object({ sessionId: uuid }).parse(request.params),
      body = z
        .object({
          category: z.enum(["picture", "sound", "captions", "other"]),
          client: z.enum(["browser", "tv"]),
        })
        .strict()
        .parse(request.body);
    return reports.preview(account, sessionId, body.category, body.client);
  });
  app.post("/api/problem-reports", (request) => {
    const account = actor(request),
      body = z
        .object({ draftId: uuid, requestId: uuid })
        .strict()
        .parse(request.body);
    return reports.send(account, body.draftId, body.requestId);
  });
  app.get("/api/problem-reports", (request) => {
    const account = actor(request),
      { offset, limit } = z
        .object({
          offset: z.coerce.number().int().min(0).max(1000000).default(0),
          limit: z.coerce.number().int().min(1).max(100).default(25),
        })
        .parse(request.query);
    return reports.list(account, offset, limit);
  });
  app.get("/api/admin/problem-reports", (request) => {
    const account = actor(request);
    requireAdmin(account);
    const { offset, limit } = z
      .object({
        offset: z.coerce.number().int().min(0).max(1000000).default(0),
        limit: z.coerce.number().int().min(1).max(100).default(25),
      })
      .parse(request.query);
    return reports.list(account, offset, limit);
  });
  app.patch("/api/admin/problem-reports/:reportId", (request, reply) => {
    const account = actor(request),
      { reportId } = z.object({ reportId: uuid }).parse(request.params);
    z.object({ acknowledged: z.literal(true) })
      .strict()
      .parse(request.body);
    reports.acknowledge(account, reportId);
    return reply.code(204).send();
  });
  app.delete("/api/admin/problem-reports/:reportId", (request, reply) => {
    const account = actor(request),
      { reportId } = z.object({ reportId: uuid }).parse(request.params);
    reports.remove(account, reportId);
    return reply.code(204).send();
  });
}
