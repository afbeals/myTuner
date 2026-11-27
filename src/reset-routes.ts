import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Store } from "./database.js";
import type { Account } from "./domain.js";
import { planReset, resetOptions, resetRequestSchema } from "./reset-data.js";

/** Review only. Destructive execution deliberately has no HTTP route or queue. */
export function registerResetRoutes(
  app: FastifyInstance,
  store: Store,
  actor: (request: FastifyRequest) => Account,
) {
  app.get("/api/admin/reset/options", (request) =>
    resetOptions(store, actor(request)),
  );
  app.post("/api/admin/reset/preview", (request) =>
    planReset(store, actor(request), resetRequestSchema.parse(request.body)),
  );
}
