import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Store } from "./database.js";
import type { Account } from "./domain.js";
import { invariant } from "./domain.js";
import {
  hashSecret,
  normalizeSubtree,
  refreshAccount,
  requireAdmin,
  requireProfile,
  sourceById,
} from "./security.js";
const uuid = z.string().uuid();
export const profileConfigurationSchema = z
  .object({
    revision: z.string().length(64),
    name: z.string().trim().min(1).max(120).optional(),
    kind: z.enum(["person", "room"]).optional(),
    ownerAccountId: uuid.nullable().optional(),
    accounts: z
      .array(z.object({ accountId: uuid, canManage: z.boolean() }).strict())
      .max(1000)
      .optional(),
    grants: z
      .array(
        z.object({ sourceId: uuid, subtree: z.string().max(4096) }).strict(),
      )
      .max(5000)
      .optional(),
    pin: z
      .string()
      .regex(/^[0-9]{4,8}$/)
      .nullable()
      .optional(),
  })
  .strict();
export function profileConfiguration(
  store: Store,
  account: Account,
  id: string,
) {
  requireProfile(store, account, id, true);
  return readProfileConfiguration(store, account, id);
}
function readProfileConfiguration(store: Store, account: Account, id: string) {
  const row = store.db.prepare("SELECT * FROM profiles WHERE id=?").get(id);
  invariant(row, 404, "Profile not found");
  const accounts = store.db
    .prepare(
      "SELECT p.account_id AS accountId,p.can_manage AS canManage,a.role,a.disabled FROM profile_accounts p JOIN accounts a ON a.id=p.account_id WHERE p.profile_id=? ORDER BY p.account_id",
    )
    .all(id);
  const grants = store.db
    .prepare(
      "SELECT source_id AS sourceId,subtree FROM source_grants WHERE profile_id=? ORDER BY source_id,subtree",
    )
    .all(id);
  const revision = createHash("sha256")
    .update(JSON.stringify([row, accounts, grants]))
    .digest("hex");
  return {
    id,
    name: String(row.name),
    kind: String(row.kind),
    ownerAccountId: row.owner_account_id as string | null,
    pinProtected: row.pin_hash !== null,
    revision,
    accounts:
      account.role === "admin"
        ? accounts.map((item) => ({
            accountId: String(item.accountId),
            canManage: Boolean(item.canManage),
          }))
        : [],
    grants:
      account.role === "admin"
        ? grants.map((item) => ({
            sourceId: String(item.sourceId),
            subtree: String(item.subtree),
          }))
        : [],
  };
}
export async function saveProfileConfiguration(
  store: Store,
  actor: Account,
  id: string,
  input: z.infer<typeof profileConfigurationSchema>,
) {
  input = profileConfigurationSchema.parse(input);
  requireProfile(store, actor, id, true);
  if (
    input.name !== undefined ||
    input.kind !== undefined ||
    input.ownerAccountId !== undefined ||
    input.accounts !== undefined ||
    input.grants !== undefined
  )
    requireAdmin(actor);
  const previous = profileConfiguration(store, actor, id);
  invariant(
    input.revision === previous.revision,
    409,
    "Profile changed elsewhere; reload and review your draft",
  );
  const pinHash =
    input.pin === undefined
      ? undefined
      : input.pin === null
        ? null
        : await hashSecret(input.pin);
  const current = refreshAccount(store, actor);
  requireProfile(store, current, id, true);
  if (
    input.name !== undefined ||
    input.kind !== undefined ||
    input.ownerAccountId !== undefined ||
    input.accounts !== undefined ||
    input.grants !== undefined
  )
    requireAdmin(current);
  return store.transaction(() => {
    invariant(
      profileConfiguration(store, current, id).revision === input.revision,
      409,
      "Profile changed elsewhere; reload and review your draft",
    );
    const owner =
        input.ownerAccountId === undefined
          ? previous.ownerAccountId
          : input.ownerAccountId,
      kind = input.kind ?? previous.kind;
    invariant(
      kind !== "person" || owner,
      400,
      "A personal profile needs an owner",
    );
    if (owner)
      invariant(
        store.db.prepare("SELECT id FROM accounts WHERE id=?").get(owner),
        400,
        "Profile owner is unavailable",
      );
    if (input.accounts) {
      invariant(
        new Set(input.accounts.map((item) => item.accountId)).size ===
          input.accounts.length,
        400,
        "Duplicate account access",
      );
      for (const item of input.accounts) {
        const target = store.db
          .prepare("SELECT role FROM accounts WHERE id=?")
          .get(item.accountId);
        invariant(target, 400, "An account is unavailable");
        invariant(
          !item.canManage ||
            target.role === "editor" ||
            target.role === "admin" ||
            previous.accounts.some(
              (saved) => saved.accountId === item.accountId && saved.canManage,
            ),
          400,
          "Viewers cannot manage profiles",
        );
      }
    }
    const grants = input.grants?.map((item) => {
      sourceById(store, item.sourceId);
      return {
        sourceId: item.sourceId,
        subtree: normalizeSubtree(item.subtree),
      };
    });
    if (grants)
      invariant(
        new Set(grants.map((item) => JSON.stringify(item))).size ===
          grants.length,
        400,
        "Duplicate library grant",
      );
    if (
      (input.name ?? previous.name) !== previous.name ||
      kind !== previous.kind ||
      owner !== previous.ownerAccountId
    )
      store.db
        .prepare(
          "UPDATE profiles SET name=?,kind=?,owner_account_id=? WHERE id=?",
        )
        .run(input.name ?? previous.name, kind, owner, id);
    if (input.accounts) {
      const wanted = new Set(input.accounts.map((item) => item.accountId));
      for (const item of previous.accounts)
        if (!wanted.has(item.accountId))
          store.db
            .prepare(
              "DELETE FROM profile_accounts WHERE profile_id=? AND account_id=?",
            )
            .run(id, item.accountId);
      const insert = store.db.prepare(
        "INSERT INTO profile_accounts(profile_id,account_id,can_manage) VALUES(?,?,?) ON CONFLICT(profile_id,account_id) DO UPDATE SET can_manage=excluded.can_manage WHERE profile_accounts.can_manage<>excluded.can_manage",
      );
      for (const item of input.accounts)
        insert.run(id, item.accountId, Number(item.canManage));
    }
    if (grants) {
      const key = (item: { sourceId: string; subtree: string }) =>
          JSON.stringify([item.sourceId, item.subtree]),
        wanted = new Set(grants.map(key)),
        previousKeys = new Set(previous.grants.map(key));
      for (const item of previous.grants)
        if (!wanted.has(key(item)))
          store.db
            .prepare(
              "DELETE FROM source_grants WHERE profile_id=? AND source_id=? AND subtree=?",
            )
            .run(id, item.sourceId, item.subtree);
      const insert = store.db.prepare(
        "INSERT INTO source_grants(profile_id,source_id,subtree) VALUES(?,?,?)",
      );
      for (const item of grants)
        if (!previousKeys.has(key(item)))
          insert.run(id, item.sourceId, item.subtree);
    }
    if (pinHash !== undefined)
      store.db
        .prepare("UPDATE profiles SET pin_hash=? WHERE id=?")
        .run(pinHash, id);
    const accessChanged =
      input.accounts !== undefined &&
      JSON.stringify(
        input.accounts
          .slice()
          .sort((a, b) => a.accountId.localeCompare(b.accountId)),
      ) !==
        JSON.stringify(
          previous.accounts
            .slice()
            .sort((a, b) => a.accountId.localeCompare(b.accountId)),
        );
    if (
      pinHash !== undefined ||
      accessChanged ||
      owner !== previous.ownerAccountId
    )
      store.db
        .prepare("DELETE FROM profile_unlocks WHERE profile_id=?")
        .run(id);
    return readProfileConfiguration(store, current, id);
  });
}
export function profileDependencies(store: Store, actor: Account, id: string) {
  requireAdmin(actor);
  const row = store.db
    .prepare("SELECT id,name FROM profiles WHERE id=?")
    .get(id);
  invariant(row, 404, "Profile not found");
  const count = (table: string) =>
    Number(
      store.db
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE profile_id=?`)
        .get(id)!.n,
    );
  const retained = {
    schedules: count("schedule_revisions"),
    playbackSessions: count("playback_sessions"),
    reports: count("problem_reports"),
  };
  return {
    id,
    name: String(row.name),
    revision: readProfileConfiguration(store, actor, id).revision,
    retained,
    settings: {
      subscriptions: count("subscriptions"),
      accounts: count("profile_accounts"),
      libraryGrants: count("source_grants"),
    },
    canDelete: Object.values(retained).every((value) => value === 0),
  };
}
export function deleteProfile(
  store: Store,
  actor: Account,
  id: string,
  revision?: string,
) {
  requireAdmin(actor);
  return store.transaction(() => {
    const dependencies = profileDependencies(store, actor, id);
    invariant(
      revision === undefined || revision === dependencies.revision,
      409,
      "Profile changed elsewhere; review it before deleting",
    );
    invariant(
      dependencies.canDelete,
      409,
      "This profile is required by retained schedules, playback sessions or reports. Reassign or expire those references before deleting it.",
    );
    for (const table of [
      "profile_unlocks",
      "subscriptions",
      "source_grants",
      "profile_accounts",
    ])
      store.db.prepare(`DELETE FROM ${table} WHERE profile_id=?`).run(id);
    store.db.prepare("DELETE FROM profiles WHERE id=?").run(id);
  });
}
export function registerProfileConfiguration(
  app: FastifyInstance,
  store: Store,
  actor: (request: FastifyRequest) => Account,
) {
  app.get("/api/profiles/:profileId/configuration", (request) => {
    const { profileId } = z.object({ profileId: uuid }).parse(request.params);
    return profileConfiguration(store, actor(request), profileId);
  });
  app.put("/api/profiles/:profileId/configuration", (request) => {
    const { profileId } = z.object({ profileId: uuid }).parse(request.params);
    return saveProfileConfiguration(
      store,
      actor(request),
      profileId,
      profileConfigurationSchema.parse(request.body),
    );
  });
  app.get("/api/profiles/:profileId/dependencies", (request) => {
    const { profileId } = z.object({ profileId: uuid }).parse(request.params);
    return profileDependencies(store, actor(request), profileId);
  });
  app.delete("/api/profiles/:profileId", (request, reply) => {
    const { profileId } = z.object({ profileId: uuid }).parse(request.params);
    const { revision } = z
      .object({ revision: z.string().length(64) })
      .strict()
      .parse(request.body);
    deleteProfile(store, actor(request), profileId, revision);
    return reply.code(204).send();
  });
}
