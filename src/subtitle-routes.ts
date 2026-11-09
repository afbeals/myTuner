import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Store } from "./database.js";
import type { Account, Media } from "./domain.js";
import { invariant } from "./domain.js";
import {
  canReadMedia,
  requireAdmin,
  requireProfile,
  sourceById,
} from "./security.js";
import {
  configureSubtitles,
  previewManualSubtitle,
  inspectSubtitles,
  manualSubtitleSchema,
  subtitleConfig,
  subtitleConfigSchema,
  SubtitleDiscovery,
} from "./subtitle-catalog.js";

export function registerSubtitleRoutes(
  app: FastifyInstance,
  store: Store,
  actor: (request: FastifyRequest) => Account,
  writableRoots: string[],
) {
  const controller = new AbortController();
  const pending = new Set<Promise<unknown>>();
  app.addHook("preClose", async () => {
    controller.abort();
    await Promise.allSettled([...pending]);
  });
  const sourceRoute = "/api/sources/:sourceId/subtitles";
  app.get(sourceRoute, async (request) => {
    requireAdmin(actor(request));
    const { sourceId } = z
      .object({ sourceId: z.string().uuid() })
      .parse(request.params);
    const source = sourceById(store, sourceId);
    return {
      ...subtitleConfig(source),
      revision: source.subtitle_revision ?? 0,
    };
  });
  app.put(sourceRoute, async (request) => {
    const authorize = () => {
      controller.signal.throwIfAborted();
      requireAdmin(actor(request));
    };
    authorize();
    const { sourceId } = z
      .object({ sourceId: z.string().uuid() })
      .parse(request.params);
    const { revision, ...config } = subtitleConfigSchema
      .extend({ revision: z.number().int().nonnegative() })
      .parse(request.body);
    const task = configureSubtitles(
      store,
      sourceId,
      revision,
      config,
      writableRoots,
      authorize,
    );
    pending.add(task);
    try {
      return await task;
    } finally {
      pending.delete(task);
    }
  });
  const videoRoute = "/api/profiles/:profileId/media/:mediaId/subtitles";
  const authorized = (request: FastifyRequest) => {
    const account = actor(request);
    const { profileId, mediaId } = z
      .object({ profileId: z.string().uuid(), mediaId: z.string().uuid() })
      .parse(request.params);
    requireProfile(store, account, profileId);
    const item = store.db
      .prepare("SELECT * FROM media WHERE id=?")
      .get(mediaId) as Media | undefined;
    invariant(
      item && canReadMedia(store, account, profileId, item),
      404,
      "Media not found",
    );
    return { account, item };
  };
  app.get(videoRoute, async (request) => {
    const { account, item } = authorized(request);
    return inspectSubtitles(store, item, account.role === "admin");
  });
  app.post(videoRoute + "/preview", async (request) => {
    const authorize = () => {
      controller.signal.throwIfAborted();
      requireAdmin(authorized(request).account);
    };
    authorize();
    const { item } = authorized(request);
    const { revision, manual } = z
      .object({ revision: z.string().length(64), manual: manualSubtitleSchema })
      .strict()
      .parse(request.body);
    const task = previewManualSubtitle(
      store,
      item,
      revision,
      manual,
      authorize,
    );
    pending.add(task);
    try {
      return await task;
    } finally {
      pending.delete(task);
    }
  });
  app.post(videoRoute + "/check", async (request) => {
    const authorize = () => {
      controller.signal.throwIfAborted();
      requireAdmin(authorized(request).account);
    };
    authorize();
    const { item } = authorized(request);
    const { revision, manual, fingerprint } = z
      .object({
        revision: z.string().length(64),
        manual: manualSubtitleSchema.optional(),
        fingerprint: z.string().length(64).optional(),
      })
      .strict()
      .parse(request.body);
    const task = new SubtitleDiscovery(controller.signal).check(
      store,
      item.id,
      authorize,
      revision,
      manual,
      fingerprint,
    );
    pending.add(task);
    try {
      return await task;
    } finally {
      pending.delete(task);
    }
  });
}
