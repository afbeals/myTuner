import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Store } from "./database.js";
import type { Account } from "./domain.js";
import { invariant } from "./domain.js";
import { canonicalPath, containsPath } from "./catalog.js";
import { requireAdmin, sourceById } from "./security.js";
import { realpath, stat } from "node:fs/promises";
import {
  metadataTargetSchema,
  metadataChoicesSchema,
  inspectAuthorizedMetadata,
  checkMetadataFiles,
  saveMetadata,
} from "./display-metadata.js";
export function registerMetadataRoutes(
  app: FastifyInstance,
  store: Store,
  actor: (request: FastifyRequest) => Account,
  writableRoots: string[],
) {
  const route = "/api/profiles/:profileId/metadata";
  for (const action of ["inspect", "check", "save"] as const)
    app.post(`${route}/${action}`, async (request) => {
      const account = actor(request);
      requireAdmin(account);
      const { profileId } = z
        .object({ profileId: z.string().uuid() })
        .parse(request.params);
      if (action === "save") {
        const body = z
          .object({
            target: metadataTargetSchema,
            revision: z.string().length(64),
            choices: metadataChoicesSchema,
            localFingerprint: z.string().length(64).nullable().optional(),
          })
          .strict()
          .parse(request.body);
        return saveMetadata(
          store,
          account,
          profileId,
          body.target,
          body.revision,
          body.choices,
          body.localFingerprint,
        );
      }
      const { target } = z
        .object({ target: metadataTargetSchema })
        .strict()
        .parse(request.body);
      return action === "inspect"
        ? inspectAuthorizedMetadata(store, account, profileId, target)
        : checkMetadataFiles(store, account, profileId, target);
    });
  app.put("/api/sources/:sourceId/metadata-location", async (request) => {
    const account = actor(request);
    requireAdmin(account);
    const { sourceId } = z
      .object({ sourceId: z.string().uuid() })
      .parse(request.params);
    sourceById(store, sourceId);
    const { root } = z
      .object({ root: z.string().min(1).max(4096).nullable() })
      .strict()
      .parse(request.body);
    let canonical: string | null = null;
    if (root !== null) {
      canonical = await realpath(root);
      invariant(
        (await stat(canonical)).isDirectory(),
        400,
        "Metadata root must be a directory",
      );
      for (const writable of writableRoots) {
        const path = await canonicalPath(writable);
        invariant(
          !containsPath(canonical, path) && !containsPath(path, canonical),
          409,
          "Metadata and application storage must not overlap",
        );
      }
    }
    requireAdmin(actor(request));
    store.db
      .prepare("UPDATE sources SET metadata_root=? WHERE id=?")
      .run(canonical, sourceId);
    return { root: canonical };
  });
}
