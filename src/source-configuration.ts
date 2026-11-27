import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Store } from "./database.js";
import type { Account } from "./domain.js";
import { DomainError, invariant } from "./domain.js";
import { canonicalPath, containsPath } from "./catalog.js";
import { requireAdmin, sourceById } from "./security.js";
import {
  prepareSubtitleConfiguration,
  subtitleConfig,
  subtitleConfigSchema,
} from "./subtitle-catalog.js";
import type { RefreshService } from "./refresh.js";
import { validateMappings } from "./setup-suggestions.js";
const integrationSchema = z
  .object({
    provider: z.enum(["sonarr", "radarr"]),
    url: z.url().max(4096),
    apiKey: z.string().min(1).max(512).optional(),
    reuseSourceId: z.string().uuid().optional(),
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
  })
  .strict();
export const sourceConfigurationSchema = z
  .object({
    revision: z.string().length(64),
    subtitles: subtitleConfigSchema,
    metadataRoot: z.string().min(1).max(4096).nullable(),
    integration: integrationSchema.nullable(),
    intervalMs: z
      .number()
      .int()
      .min(60_000)
      .max(7 * 86_400_000)
      .nullable(),
  })
  .strict();
function snapshot(store: Store, id: string) {
  const source = sourceById(store, id),
    integration = store.db
      .prepare(
        "SELECT provider,url,encrypted_key,mappings_json FROM integrations WHERE source_id=?",
      )
      .get(id),
    schedule = store.db
      .prepare("SELECT interval_ms FROM refresh_sources WHERE source_id=?")
      .get(id);
  return { source, integration, schedule };
}
function revision(current: ReturnType<typeof snapshot>) {
  return createHash("sha256").update(JSON.stringify(current)).digest("hex");
}
export function sourceDetails(store: Store, id: string) {
  const current = snapshot(store, id);
  return { ...current.source, revision: revision(current) };
}
export function sourceConfiguration(store: Store, id: string) {
  const current = snapshot(store, id),
    { source, integration, schedule } = current;
  return {
    revision: revision(current),
    subtitles: subtitleConfig(source),
    metadataRoot: source.metadata_root ?? null,
    integration: integration
      ? {
          provider: String(integration.provider) as "sonarr" | "radarr",
          url: String(integration.url),
          hasApiKey: true,
          mappings: JSON.parse(String(integration.mappings_json)) as {
            from: string;
            to: string;
          }[],
        }
      : null,
    intervalMs: schedule ? Number(schedule.interval_ms) : null,
  };
}
export async function saveSourceConfiguration(
  store: Store,
  refresh: RefreshService,
  id: string,
  input: z.infer<typeof sourceConfigurationSchema>,
  writableRoots: string[],
  authorize: () => void,
) {
  input = sourceConfigurationSchema.parse(input);
  authorize();
  const before = sourceConfiguration(store, id);
  invariant(
    input.revision === before.revision,
    409,
    "Source settings changed elsewhere; reopen and review your draft",
  );
  invariant(
    !refresh.isScanning(id),
    409,
    "Wait for this source scan to finish before saving its configuration",
  );
  const subtitleChanged =
    JSON.stringify(input.subtitles) !==
    JSON.stringify(subtitleConfigSchema.parse(before.subtitles));
  const commitSubtitles = subtitleChanged
    ? await prepareSubtitleConfiguration(
        store,
        id,
        sourceById(store, id).subtitle_revision ?? 0,
        input.subtitles,
        writableRoots,
        authorize,
      )
    : null;
  let metadataRoot = input.metadataRoot;
  if (metadataRoot !== null && metadataRoot !== before.metadataRoot) {
    metadataRoot = await realpath(metadataRoot);
    invariant(
      (await stat(metadataRoot)).isDirectory(),
      400,
      "Metadata directory must exist",
    );
    for (const root of writableRoots) {
      const writable = await canonicalPath(root);
      invariant(
        !containsPath(metadataRoot, writable) &&
          !containsPath(writable, metadataRoot),
        409,
        "Metadata and application storage must not overlap",
      );
    }
  }
  if (input.integration) {
    validateMappings(input.integration.mappings);
    const savedDestinations = new Set(
      before.integration?.mappings.map((row) => row.to) ?? [],
    );
    for (const destination of new Set(
      input.integration.mappings.map((row) => row.to),
    )) {
      // Unchanged saved locations may be temporarily offline. New locations must exist.
      if (savedDestinations.has(destination)) continue;
      let path: string;
      try {
        path = await realpath(destination);
        invariant(
          (await stat(path)).isDirectory(),
          400,
          "Mapping destination must be a directory",
        );
      } catch {
        throw new DomainError(
          400,
          `Mapping destination is unavailable: ${destination}. Enter a directory visible inside the MyTuner container.`,
        );
      }
      const source = sourceById(store, id),
        sourceRoot = await realpath(source.root_path);
      invariant(
        containsPath(sourceRoot, path) || containsPath(path, sourceRoot),
        400,
        "Mapping destination must lead into this source’s media directory",
      );
      for (const root of writableRoots) {
        const writable = await canonicalPath(root);
        invariant(
          !containsPath(path, writable) && !containsPath(writable, path),
          409,
          "Mapping destination overlaps application storage",
        );
      }
    }
  }
  authorize();
  return store.transaction(() => {
    invariant(
      sourceConfiguration(store, id).revision === input.revision,
      409,
      "Source settings changed elsewhere; reopen and review your draft",
    );
    invariant(
      !refresh.isScanning(id),
      409,
      "Wait for this source scan to finish before saving its configuration",
    );
    if (input.integration) refresh.configure(id, input.integration);
    else if (before.integration)
      store.db.prepare("DELETE FROM integrations WHERE source_id=?").run(id);
    if (metadataRoot !== before.metadataRoot)
      store.db
        .prepare("UPDATE sources SET metadata_root=? WHERE id=?")
        .run(metadataRoot, id);
    commitSubtitles?.();
    if (input.intervalMs !== before.intervalMs)
      refresh.schedule(id, input.intervalMs);
    return sourceConfiguration(store, id);
  });
}
export function registerSourceConfiguration(
  app: FastifyInstance,
  store: Store,
  actor: (request: FastifyRequest) => Account,
  refresh: RefreshService,
  writableRoots: string[],
) {
  const pending = new Set<Promise<unknown>>(),
    controller = new AbortController();
  app.addHook("preClose", async () => {
    controller.abort();
    await Promise.allSettled([...pending]);
  });
  const route = "/api/sources/:sourceId/configuration";
  app.get(route, async (request) => {
    requireAdmin(actor(request));
    const { sourceId } = z
      .object({ sourceId: z.string().uuid() })
      .parse(request.params);
    return sourceConfiguration(store, sourceId);
  });
  app.put(route, async (request) => {
    const authorize = () => {
      controller.signal.throwIfAborted();
      requireAdmin(actor(request));
    };
    authorize();
    const { sourceId } = z
      .object({ sourceId: z.string().uuid() })
      .parse(request.params);
    const input = sourceConfigurationSchema.parse(request.body),
      task = saveSourceConfiguration(
        store,
        refresh,
        sourceId,
        input,
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
}
