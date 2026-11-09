import { randomBytes } from "node:crypto";
import type { Store } from "./database.js";
import type { Account } from "./domain.js";
import { invariant } from "./domain.js";
import {
  digest,
  hashSecret,
  verifySecret,
  requireAdmin,
  requireProfile,
  refreshAccount,
} from "./security.js";
interface UnlockAttempt {
  sessionHash: string;
  profileId: string;
}
const pendingUnlocks = new WeakMap<Store, Set<UnlockAttempt>>();
export function clearProfileUnlocks(
  store: Store,
  sessionHash: string,
  profileId?: string,
): void {
  for (const attempt of pendingUnlocks.get(store) ?? [])
    if (
      attempt.sessionHash === sessionHash &&
      (!profileId || attempt.profileId === profileId)
    )
      pendingUnlocks.get(store)!.delete(attempt);
  if (profileId)
    store.db
      .prepare(
        "DELETE FROM profile_unlocks WHERE session_hash=? AND profile_id=?",
      )
      .run(sessionHash, profileId);
  else
    store.db
      .prepare("DELETE FROM profile_unlocks WHERE session_hash=?")
      .run(sessionHash);
}
export function throttle(
  store: Store,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): void {
  const row = store.db
    .prepare("SELECT failures,window_start FROM login_attempts WHERE key=?")
    .get(key) as { failures: number; window_start: number } | undefined;
  invariant(
    !row || now - row.window_start >= windowMs || row.failures < limit,
    429,
    "Too many attempts; try again later",
  );
  store.db
    .prepare(
      `INSERT INTO login_attempts(key,failures,window_start) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN ?-window_start>=? THEN 1 ELSE failures+1 END,window_start=CASE WHEN ?-window_start>=? THEN ? ELSE window_start END`,
    )
    .run(key, now, now, windowMs, now, windowMs, now);
}
// Approved pairings can issue fresh credentials, so revoke them with existing sessions.
export function revokeAccountSessions(store: Store, accountId: string): void {
  store.transaction(() => {
    store.db.prepare("DELETE FROM sessions WHERE account_id=?").run(accountId);
    store.db
      .prepare("DELETE FROM device_pairings WHERE account_id=?")
      .run(accountId);
  });
}
export function updateAccount(
  store: Store,
  actor: Account,
  id: string,
  input: { role?: Account["role"] | undefined; disabled?: boolean | undefined },
): void {
  requireAdmin(actor);
  const current = store.db
    .prepare("SELECT * FROM accounts WHERE id=?")
    .get(id) as Account | undefined;
  invariant(current, 404, "Account not found");
  const role = input.role ?? current.role,
    disabled =
      input.disabled === undefined ? current.disabled : Number(input.disabled);
  store.transaction(() => {
    if (
      current.role === "admin" &&
      !current.disabled &&
      (role !== "admin" || disabled)
    )
      invariant(
        Number(
          store.db
            .prepare(
              "SELECT COUNT(*) AS n FROM accounts WHERE role='admin' AND disabled=0",
            )
            .get()?.n,
        ) > 1,
        409,
        "Cannot remove the last enabled administrator",
      );
    store.db
      .prepare("UPDATE accounts SET role=?,disabled=? WHERE id=?")
      .run(role, disabled, id);
    revokeAccountSessions(store, id);
  });
}
export async function changePassword(
  store: Store,
  actor: Account,
  id: string,
  password: string,
): Promise<void> {
  requireAdmin(actor);
  invariant(
    password.length >= 12 && password.length <= 1024,
    400,
    "Password must contain 12-1024 characters",
  );
  const hash = await hashSecret(password);
  requireAdmin(refreshAccount(store, actor));
  store.transaction(() => {
    invariant(
      store.db
        .prepare("UPDATE accounts SET password_hash=? WHERE id=?")
        .run(hash, id).changes,
      404,
      "Account not found",
    );
    revokeAccountSessions(store, id);
  });
}
export async function setPin(
  store: Store,
  actor: Account,
  profileId: string,
  pin: string | null,
): Promise<void> {
  requireProfile(store, actor, profileId, true);
  invariant(
    pin === null || /^\d{4,8}$/.test(pin),
    400,
    "PIN must have 4-8 digits",
  );
  const hash = pin === null ? null : await hashSecret(pin);
  requireProfile(store, refreshAccount(store, actor), profileId, true);
  store.transaction(() => {
    store.db
      .prepare("UPDATE profiles SET pin_hash=? WHERE id=?")
      .run(hash, profileId);
    store.db
      .prepare("DELETE FROM profile_unlocks WHERE profile_id=?")
      .run(profileId);
  });
}
export async function unlockProfile(
  store: Store,
  actor: Account,
  profileId: string,
  pin: string,
  now = Date.now(),
): Promise<void> {
  requireProfile(store, actor, profileId, false, false);
  invariant(actor.sessionHash, 401, "Authenticated session required");
  throttle(store, `pin:${actor.id}:${profileId}`, 6, 15 * 60000, now);
  const profile = store.db
    .prepare("SELECT pin_hash FROM profiles WHERE id=?")
    .get(profileId) as { pin_hash: string | null };
  const pending = pendingUnlocks.get(store) ?? new Set<UnlockAttempt>();
  pendingUnlocks.set(store, pending);
  const attempt = { sessionHash: actor.sessionHash, profileId };
  pending.add(attempt);
  try {
    invariant(
      profile.pin_hash && (await verifySecret(pin, profile.pin_hash)),
      403,
      "Incorrect PIN",
    );
    invariant(
      pending.has(attempt),
      409,
      "Profile lock changed; enter PIN again",
    );
    const current = refreshAccount(store, actor);
    requireProfile(store, current, profileId, false, false);
    invariant(
      store.db
        .prepare("SELECT pin_hash FROM profiles WHERE id=?")
        .get(profileId)?.pin_hash === profile.pin_hash,
      403,
      "Incorrect PIN",
    );
    store.db
      .prepare(
        "INSERT INTO profile_unlocks(session_hash,profile_id,expires_ms) VALUES(?,?,?) ON CONFLICT(session_hash,profile_id) DO UPDATE SET expires_ms=excluded.expires_ms",
      )
      .run(actor.sessionHash, profileId, now + 12 * 3600000);
    store.db
      .prepare("DELETE FROM login_attempts WHERE key=?")
      .run(`pin:${actor.id}:${profileId}`);
  } finally {
    pending.delete(attempt);
  }
}
export class PairingService {
  constructor(private readonly store: Store) {}
  start(deviceName: string, clientKey: string, now = Date.now()) {
    throttle(this.store, `pair-start:${clientKey}`, 10, 60000, now);
    const deviceCode = randomBytes(32).toString("base64url"),
      userCode = randomBytes(5).toString("hex").toUpperCase();
    this.store.db
      .prepare(
        "INSERT INTO device_pairings(device_hash,code_hash,device_name,expires_ms) VALUES(?,?,?,?)",
      )
      .run(digest(deviceCode), digest(userCode), deviceName, now + 5 * 60000);
    return {
      deviceCode,
      userCode,
      expiresInSeconds: 300,
      pollIntervalSeconds: 3,
    };
  }
  inspect(actor: Account, userCode: string, now = Date.now()) {
    throttle(this.store, `pair-review:${actor.id}`, 10, 60000, now);
    const row = this.store.db
      .prepare(
        "SELECT device_name,expires_ms FROM device_pairings WHERE code_hash=? AND expires_ms>? AND consumed=0 AND account_id IS NULL",
      )
      .get(digest(userCode.trim().toUpperCase()), now);
    invariant(row, 404, "Pairing code is unavailable");
    return {
      deviceName: String(row.device_name),
      expiresMs: Number(row.expires_ms),
    };
  }
  approve(actor: Account, userCode: string, now = Date.now()): void {
    throttle(this.store, `pair-approve:${actor.id}`, 10, 60000, now);
    invariant(
      this.store.db
        .prepare(
          "UPDATE device_pairings SET account_id=? WHERE code_hash=? AND expires_ms>? AND consumed=0 AND account_id IS NULL",
        )
        .run(actor.id, digest(userCode.trim().toUpperCase()), now).changes,
      404,
      "Pairing code is unavailable",
    );
  }
  poll(
    deviceCode: string,
    now = Date.now(),
  ): { status: "pending" } | { status: "approved"; token: string } {
    const hash = digest(deviceCode);
    throttle(this.store, `pair-poll:${hash}`, 30, 60000, now);
    return this.store.transaction(() => {
      const pairing = this.store.db
        .prepare(
          "SELECT * FROM device_pairings WHERE device_hash=? AND expires_ms>? AND consumed=0",
        )
        .get(hash, now) as { account_id: string | null } | undefined;
      invariant(pairing, 404, "Pairing request unavailable");
      if (!pairing.account_id) return { status: "pending" };
      invariant(
        this.store.db
          .prepare("SELECT id FROM accounts WHERE id=? AND disabled=0")
          .get(pairing.account_id),
        404,
        "Pairing request unavailable",
      );
      const token = randomBytes(32).toString("base64url");
      this.store.db
        .prepare(
          "INSERT INTO sessions(token_hash,account_id,expires_at,kind) VALUES(?,?,?,'device')",
        )
        .run(digest(token), pairing.account_id, now + 30 * 86400000);
      this.store.db
        .prepare("UPDATE device_pairings SET consumed=1 WHERE device_hash=?")
        .run(hash);
      return { status: "approved", token };
    });
  }
}
