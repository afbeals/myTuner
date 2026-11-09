import { pairingApprovalPath } from "./pairing-link.js";
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Store } from "./database.js";
import { invariant } from "./domain.js";
import {
  authenticate,
  digest,
  login,
  logout,
  requireAdmin,
  normalizeSubtree,
  requireProfile,
} from "./security.js";
import {
  clearProfileUnlocks,
  changePassword,
  PairingService,
  setPin,
  unlockProfile,
  updateAccount,
  revokeAccountSessions,
} from "./identity.js";

const id = z.string().uuid();
const credentials = z
  .object({
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(1024),
  })
  .strict();
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
export function registerIdentity(
  app: FastifyInstance,
  store: Store,
  secureCookie = false,
  publicOrigin?: string,
) {
  const expectedOrigin = publicOrigin ? new URL(publicOrigin) : undefined;
  invariant(
    !expectedOrigin ||
      (["http:", "https:"].includes(expectedOrigin.protocol) &&
        !expectedOrigin.username &&
        !expectedOrigin.password &&
        expectedOrigin.pathname === "/" &&
        !expectedOrigin.search &&
        !expectedOrigin.hash),
    500,
    "Invalid public origin",
  );
  const pairing = new PairingService(store);
  const cookie = (value: string, maxAge: number) =>
    `mytuner_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookie ? "; Secure" : ""}`;
  const sameOrigin = (request: FastifyRequest) => {
    const origin = request.headers.origin;
    invariant(
      !origin ||
        origin ===
          (expectedOrigin?.origin ??
            `${request.protocol}://${request.headers.host}`),
      403,
      "Cross-origin request denied",
    );
    invariant(
      request.headers["sec-fetch-site"] !== "cross-site",
      403,
      "Cross-site request denied",
    );
  };
  const token = (request: FastifyRequest) => {
    const header = request.headers.authorization;
    if (header !== undefined) {
      invariant(
        header.startsWith("Bearer ") && header.length < 512,
        401,
        "Authentication required",
      );
      return { value: header.slice(7), cookie: false };
    }
    const value = request.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("mytuner_session="))
      ?.slice(16);
    invariant(
      value && /^[\w-]{43}$/.test(value),
      401,
      "Authentication required",
    );
    return { value, cookie: true };
  };
  const actor = (request: FastifyRequest) => {
    const credential = token(request),
      account = authenticate(store, credential.value);
    const session = store.db
      .prepare("SELECT kind,csrf_hash FROM sessions WHERE token_hash=?")
      .get(account.sessionHash!) as { kind: string; csrf_hash: string | null };
    if (credential.cookie) {
      invariant(session.kind === "browser", 401, "Browser session required");
      if (!safeMethods.has(request.method)) {
        sameOrigin(request);
        const csrf = request.headers["x-csrf-token"];
        invariant(
          typeof csrf === "string" && session.csrf_hash === digest(csrf),
          403,
          "CSRF token required",
        );
      }
    }
    if (session.kind === "device") {
      const path = request.routeOptions.url ?? "";
      const allowed = safeMethods.has(request.method)
        ? path === "/api/auth/me" ||
          path === "/api/profiles" ||
          /^\/api\/profiles\/:profileId\/(media(?:\/.*)?|library|collections|channels(?:\/:channelId\/(?:live|statistics|recent))?|guide)$/.test(
            path,
          ) ||
          path.startsWith("/api/playback/")
        : path === "/api/auth/logout" ||
          (request.method === "POST" && path === "/api/problem-reports") ||
          path.startsWith("/api/playback/") ||
          /^\/api\/profiles\/:profileId\/(unlock|lock)$/.test(path);
      invariant(allowed, 403, "Device session is limited to viewing");
    }
    return account;
  };
  app.post("/api/auth/browser", async (request, reply) => {
    sameOrigin(request);
    const body = credentials.parse(request.body),
      result = await login(store, body.username, body.password),
      csrfToken = randomBytes(32).toString("base64url");
    store.db
      .prepare(
        "UPDATE sessions SET kind='browser',csrf_hash=? WHERE token_hash=?",
      )
      .run(digest(csrfToken), digest(result.token));
    reply.header("Set-Cookie", cookie(result.token, 12 * 3600));
    return { account: result.account, csrfToken };
  });
  app.post("/api/auth/logout", async (request, reply) => {
    actor(request);
    logout(store, token(request).value);
    return reply.header("Set-Cookie", cookie("", 0)).code(204).send();
  });
  app.get("/api/auth/csrf", async (request) => {
    const a = actor(request),
      csrfToken = randomBytes(32).toString("base64url");
    const row = store.db
      .prepare("SELECT kind FROM sessions WHERE token_hash=?")
      .get(a.sessionHash!);
    invariant(row?.kind === "browser", 403, "Browser session required");
    store.db
      .prepare("UPDATE sessions SET csrf_hash=? WHERE token_hash=?")
      .run(digest(csrfToken), a.sessionHash!);
    return { csrfToken };
  });
  app.post("/api/auth/pairings", async (request, reply) => {
    const b = z
      .object({ deviceName: z.string().trim().min(1).max(120) })
      .strict()
      .parse(request.body);
    const started = pairing.start(b.deviceName, request.ip);
    return reply.code(201).send({
      ...started,
      approvalPath: pairingApprovalPath(started.userCode),
    });
  });
  app.post("/api/auth/pairings/poll", async (request) =>
    pairing.poll(
      z
        .object({ deviceCode: z.string().min(32).max(100) })
        .strict()
        .parse(request.body).deviceCode,
    ),
  );
  app.post("/api/auth/pairings/review", async (request) => {
    const a = actor(request),
      b = z
        .object({ userCode: z.string().regex(/^[A-Fa-f0-9]{10}$/) })
        .strict()
        .parse(request.body);
    return pairing.inspect(a, b.userCode);
  });
  app.post("/api/auth/pairings/approve", async (request, reply) => {
    const a = actor(request),
      b = z
        .object({ userCode: z.string().regex(/^[A-Fa-f0-9]{10}$/) })
        .strict()
        .parse(request.body);
    pairing.approve(a, b.userCode);
    return reply.code(204).send();
  });
  app.get("/api/auth/sessions", async (request) => {
    const a = actor(request);
    return store.db
      .prepare(
        "SELECT token_hash,expires_at,kind FROM sessions WHERE account_id=?",
      )
      .all(a.id)
      .map((r) => ({
        id: r.token_hash,
        expiresAt: r.expires_at,
        kind: r.kind,
        current: r.token_hash === a.sessionHash,
      }));
  });
  app.delete("/api/auth/sessions/:sessionId", async (request, reply) => {
    const a = actor(request),
      p = z
        .object({ sessionId: z.string().regex(/^[a-f0-9]{64}$/) })
        .parse(request.params);
    store.db
      .prepare("DELETE FROM sessions WHERE token_hash=? AND account_id=?")
      .run(p.sessionId, a.id);
    return reply.code(204).send();
  });
  app.get("/api/accounts", async (request) => {
    requireAdmin(actor(request));
    return store.db
      .prepare(
        "SELECT id,username,role,disabled FROM accounts ORDER BY username",
      )
      .all();
  });
  app.patch("/api/accounts/:accountId", async (request, reply) => {
    const a = actor(request),
      p = z.object({ accountId: id }).parse(request.params),
      b = z
        .object({
          role: z.enum(["admin", "editor", "viewer"]).optional(),
          disabled: z.boolean().optional(),
        })
        .strict()
        .parse(request.body);
    updateAccount(store, a, p.accountId, b);
    return reply.code(204).send();
  });
  app.put("/api/accounts/:accountId/password", async (request, reply) => {
    const a = actor(request),
      p = z.object({ accountId: id }).parse(request.params),
      b = z
        .object({ password: z.string().min(12).max(1024) })
        .strict()
        .parse(request.body);
    await changePassword(store, a, p.accountId, b.password);
    return reply.code(204).send();
  });
  app.delete("/api/accounts/:accountId/sessions", async (request, reply) => {
    requireAdmin(actor(request));
    const p = z.object({ accountId: id }).parse(request.params);
    revokeAccountSessions(store, p.accountId);
    return reply.code(204).send();
  });
  app.put("/api/profiles/:profileId/pin", async (request, reply) => {
    const a = actor(request),
      p = z.object({ profileId: id }).parse(request.params),
      b = z
        .object({
          pin: z
            .string()
            .regex(/^\d{4,8}$/)
            .nullable(),
        })
        .strict()
        .parse(request.body);
    await setPin(store, a, p.profileId, b.pin);
    return reply.code(204).send();
  });
  app.post("/api/profiles/:profileId/unlock", async (request, reply) => {
    const a = actor(request),
      p = z.object({ profileId: id }).parse(request.params),
      b = z
        .object({ pin: z.string().min(1).max(20) })
        .strict()
        .parse(request.body);
    await unlockProfile(store, a, p.profileId, b.pin);
    return reply.code(204).send();
  });
  app.post("/api/profiles/:profileId/lock", async (request, reply) => {
    const a = actor(request),
      p = z.object({ profileId: id }).parse(request.params);
    requireProfile(store, a, p.profileId, false, false);
    clearProfileUnlocks(store, a.sessionHash!, p.profileId);
    return reply.code(204).send();
  });
  app.delete(
    "/api/profiles/:profileId/accounts/:accountId",
    async (request, reply) => {
      requireAdmin(actor(request));
      const p = z
        .object({ profileId: id, accountId: id })
        .parse(request.params);
      store.db
        .prepare(
          "DELETE FROM profile_accounts WHERE profile_id=? AND account_id=?",
        )
        .run(p.profileId, p.accountId);
      return reply.code(204).send();
    },
  );
  app.delete("/api/profiles/:profileId/grants", async (request, reply) => {
    requireAdmin(actor(request));
    const p = z.object({ profileId: id }).parse(request.params),
      b = z
        .object({ sourceId: id, subtree: z.string().default("") })
        .strict()
        .parse(request.body);
    store.db
      .prepare(
        "DELETE FROM source_grants WHERE profile_id=? AND source_id=? AND subtree=?",
      )
      .run(p.profileId, b.sourceId, normalizeSubtree(b.subtree));
    return reply.code(204).send();
  });
  return actor;
}
