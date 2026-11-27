import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Store } from "./database.js";
import type { Account } from "./domain.js";
import { requireProfile } from "./security.js";

/** Catalog freshness is a database observation, never a browse-time filesystem probe. */
export function sourceInspections(
  store: Store,
  account: Account,
  profileId: string,
  ids: string[],
) {
  requireProfile(store, account, profileId);
  return {
    items: store.db
      .prepare(
        `SELECT s.id AS sourceId,a.last_attempt_ms AS lastAttemptMs,a.last_completed_ms AS lastCompletedMs,a.last_success_ms AS lastSuccessMs,a.last_error AS lastError
    FROM sources s LEFT JOIN refresh_attempts a ON a.source_id=s.id
    WHERE s.id IN(SELECT value FROM json_each(?)) AND (?='admin' OR EXISTS(SELECT 1 FROM source_grants g WHERE g.profile_id=? AND g.source_id=s.id)) ORDER BY s.id`,
      )
      .all(JSON.stringify(ids), account.role, profileId)
      .map((row) => ({
        sourceId: String(row.sourceId),
        lastAttemptMs: row.lastAttemptMs ?? null,
        lastCompletedMs: row.lastCompletedMs ?? null,
        lastSuccessMs: row.lastSuccessMs ?? null,
        status:
          row.lastAttemptMs === null
            ? "never"
            : row.lastCompletedMs === null
              ? "checking"
              : row.lastError
                ? "incomplete"
                : "current",
      })),
  };
}
export function registerSourceInspections(
  app: FastifyInstance,
  store: Store,
  actor: (request: FastifyRequest) => Account,
) {
  app.get("/api/profiles/:profileId/source-inspections", (request) => {
    const { profileId } = z
      .object({ profileId: z.string().uuid() })
      .parse(request.params);
    const { ids } = z
      .object({ ids: z.string().max(3800).default("") })
      .strict()
      .parse(request.query);
    const values = z
      .array(z.string().uuid())
      .max(100)
      .parse(ids ? ids.split(",") : []);
    return sourceInspections(store, actor(request), profileId, [
      ...new Set(values),
    ]);
  });
}
