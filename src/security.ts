import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { posix } from "node:path";
import type { Account, Channel, Media, Source } from "./domain.js";
import { invariant } from "./domain.js";
import type { Store } from "./database.js";

const scrypt = promisify(scryptCallback);
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(secret, salt, 64)) as Buffer;
  return `scrypt:${salt}:${key.toString("hex")}`;
}
export async function verifySecret(
  secret: string,
  stored: string,
): Promise<boolean> {
  const [scheme, salt, encoded] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !encoded) return false;
  const expected = Buffer.from(encoded, "hex");
  const actual = (await scrypt(secret, salt, 64)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
// Used for nonexistent users as well, so password verification work is comparable.
const dummyHash = hashSecret(randomBytes(32).toString("hex"));
export async function createAccount(
  store: Store,
  username: string,
  password: string,
  role: Account["role"],
  actor?: Account,
): Promise<Account> {
  if (actor) requireAdmin(actor);
  invariant(
    /^[a-zA-Z0-9_.-]{3,64}$/.test(username),
    400,
    "Username must be 3-64 letters, digits, dots, underscores or hyphens",
  );
  invariant(
    password.length >= 12 && password.length <= 1024,
    400,
    "Password must contain 12-1024 characters",
  );
  invariant(
    !store.db.prepare("SELECT id FROM accounts WHERE username=?").get(username),
    409,
    "Username already exists",
  );
  const id = randomUUID(),
    hash = await hashSecret(password);
  // Bootstrap/test fixtures have no actor; HTTP creation must retain current admin authority.
  if (actor) requireAdmin(refreshAccount(store, actor));
  invariant(
    !store.db.prepare("SELECT id FROM accounts WHERE username=?").get(username),
    409,
    "Username already exists",
  );
  store.db
    .prepare(
      "INSERT INTO accounts(id,username,password_hash,role,created_at) VALUES(?,?,?,?,?)",
    )
    .run(id, username, hash, role, Date.now());
  return { id, username, role, disabled: 0 };
}
const pendingLogins = new WeakMap<Store, Map<string, number>>();
export async function login(
  store: Store,
  username: string,
  password: string,
  now = Date.now(),
): Promise<{ token: string; account: Account }> {
  const key = username.toLowerCase();
  const attempts = store.db
    .prepare("SELECT failures,window_start FROM login_attempts WHERE key=?")
    .get(key) as { failures: number; window_start: number } | undefined;
  invariant(
    !attempts ||
      now - attempts.window_start >= 900_000 ||
      attempts.failures < 8,
    429,
    "Too many login attempts; try again later",
  );
  // Reserve synchronously before password hashing yields to concurrent requests.
  const windowStart =
    attempts && now - attempts.window_start < 900_000
      ? attempts.window_start
      : now;
  store.db
    .prepare(
      `INSERT INTO login_attempts(key,failures,window_start) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN window_start=? THEN failures+1 ELSE 1 END,
    window_start=excluded.window_start`,
    )
    .run(key, windowStart, windowStart);
  let pending = pendingLogins.get(store);
  if (!pending) {
    pending = new Map();
    pendingLogins.set(store, pending);
  }
  const reservation = `${key}:${windowStart}`;
  pending.set(reservation, (pending.get(reservation) ?? 0) + 1);
  const row = store.db
    .prepare("SELECT * FROM accounts WHERE username=?")
    .get(username) as (Account & { password_hash: string }) | undefined;
  let valid: boolean;
  try {
    valid = await verifySecret(
      password,
      row?.password_hash ?? (await dummyHash),
    );
  } finally {
    const left = (pending.get(reservation) ?? 1) - 1;
    if (left) pending.set(reservation, left);
    else pending.delete(reservation);
  }
  // Password verification yields to other requests, including password reset and account changes.
  const current = row
    ? (store.db.prepare("SELECT * FROM accounts WHERE id=?").get(row.id) as
        (Account & { password_hash: string }) | undefined)
    : undefined;
  if (
    !row ||
    !current ||
    current.disabled ||
    current.password_hash !== row.password_hash ||
    !valid
  ) {
    invariant(false, 401, "Invalid credentials");
  }
  // Successful authentication clears completed failures, retaining other reservations.
  const outstanding = pending.get(reservation) ?? 0;
  if (outstanding)
    store.db
      .prepare(
        "UPDATE login_attempts SET failures=? WHERE key=? AND window_start=?",
      )
      .run(outstanding, key, windowStart);
  else
    store.db
      .prepare("DELETE FROM login_attempts WHERE key=? AND window_start=?")
      .run(key, windowStart);
  const token = randomBytes(32).toString("base64url");
  store.db
    .prepare(
      "INSERT INTO sessions(token_hash,account_id,expires_at) VALUES(?,?,?)",
    )
    .run(digest(token), current.id, now + 12 * 60 * 60 * 1000);
  const { password_hash: _, ...account } = current;
  return { token, account };
}
const sessionKinds = new WeakMap<Account, string>();
export function authenticate(
  store: Store,
  token: string,
  now = Date.now(),
): Account {
  return authenticateHash(store, digest(token), now);
}
function authenticateHash(
  store: Store,
  tokenHash: string,
  now: number,
): Account {
  const row = store.db
    .prepare(
      `SELECT a.id,a.username,a.role,a.disabled,s.kind AS session_kind FROM sessions s JOIN accounts a ON a.id=s.account_id
  WHERE s.token_hash=? AND s.expires_at>? AND a.disabled=0`,
    )
    .get(tokenHash, now) as (Account & { session_kind: string }) | undefined;
  invariant(row, 401, "Authentication required");
  sessionKinds.set(row, row.session_kind);
  delete (row as Partial<typeof row>).session_kind;
  Object.defineProperty(row, "sessionHash", {
    value: tokenHash,
    enumerable: false,
  });
  return row;
}
// Async credential operations must recheck current authority before writing their result.
// Reconstruct authenticated actors through the same path so device PIN scope is retained.
export function refreshAccount(
  store: Store,
  account: Account,
  now = Date.now(),
): Account {
  if (account.sessionHash)
    return authenticateHash(store, account.sessionHash, now);
  const current = store.db
    .prepare(
      "SELECT id,username,role,disabled FROM accounts WHERE id=? AND disabled=0",
    )
    .get(account.id) as Account | undefined;
  invariant(current, 401, "Authentication required");
  return current;
}
export function logout(store: Store, token: string): void {
  store.db
    .prepare("DELETE FROM sessions WHERE token_hash=?")
    .run(digest(token));
}
export function requireAdmin(account: Account): void {
  invariant(account.role === "admin", 403, "Administrator access required");
}
const programmingProfiles = new WeakMap<Account, string>();
// The schedule worker evaluates its author's current management/source grants. A viewing PIN is session-local and must not expire a published broadcast.
export function programmingActor(
  store: Store,
  account: Account,
  profileId: string,
): Account {
  requireProfile(store, account, profileId, true);
  const actor = { ...account };
  programmingProfiles.set(actor, profileId);
  return actor;
}
export function requireProfile(
  store: Store,
  account: Account,
  profileId: string,
  manage = false,
  checkPin = true,
): void {
  const profile = store.db
    .prepare("SELECT owner_account_id,pin_hash FROM profiles WHERE id=?")
    .get(profileId) as
    { owner_account_id: string | null; pin_hash: string | null } | undefined;
  invariant(profile, 404, "Profile not found");
  if (
    account.role === "admin" &&
    (manage || sessionKinds.get(account) !== "device")
  )
    return;
  const grant = store.db
    .prepare(
      "SELECT can_manage FROM profile_accounts WHERE profile_id=? AND account_id=?",
    )
    .get(profileId, account.id) as { can_manage: number } | undefined;
  invariant(
    account.role === "admin" ||
      profile.owner_account_id === account.id ||
      grant,
    404,
    "Profile not found",
  );
  if (
    !manage &&
    checkPin &&
    profile.pin_hash &&
    programmingProfiles.get(account) !== profileId
  ) {
    invariant(
      account.sessionHash &&
        store.db
          .prepare(
            "SELECT profile_id FROM profile_unlocks WHERE session_hash=? AND profile_id=? AND expires_ms>?",
          )
          .get(account.sessionHash, profileId, Date.now()),
      403,
      "Profile is locked",
    );
  }
  if (manage)
    invariant(
      account.role === "editor" &&
        (profile.owner_account_id === account.id || grant?.can_manage === 1),
      403,
      "Profile management not allowed",
    );
}
export function normalizeSubtree(value: string): string {
  invariant(
    !value.includes("\\") && !value.includes("\0") && !posix.isAbsolute(value),
    400,
    "Invalid relative directory",
  );
  const normalized = posix.normalize(value);
  invariant(
    normalized !== ".." && !normalized.startsWith("../"),
    400,
    "Directory escapes source",
  );
  return normalized === "." ? "" : normalized.replace(/\/$/, "");
}
export function withinSubtree(relativePath: string, subtree: string): boolean {
  return (
    subtree === "" ||
    relativePath === subtree ||
    relativePath.startsWith(subtree + "/")
  );
}
export function canReadMedia(
  store: Store,
  account: Account,
  profileId: string,
  media: Media,
): boolean {
  requireProfile(store, account, profileId);
  if (account.role === "admin") return true;
  const grants = store.db
    .prepare(
      "SELECT subtree FROM source_grants WHERE profile_id=? AND source_id=?",
    )
    .all(profileId, media.source_id) as { subtree: string }[];
  return grants.some((g) => withinSubtree(media.relative_path, g.subtree));
}
export function visibleChannel(
  store: Store,
  account: Account,
  id: string,
): Channel {
  const channel = store.db
    .prepare("SELECT * FROM channels WHERE id=? AND archived=0")
    .get(id) as Channel | undefined;
  invariant(
    channel &&
      (account.role === "admin" ||
        channel.visibility === "shared" ||
        channel.owner_account_id === account.id),
    404,
    "Channel not found",
  );
  return channel;
}
export function requireChannelMedia(
  store: Store,
  account: Account,
  profileId: string,
  channel: Channel,
  context: { revisionId?: string; positionMs?: number } = {},
): void {
  requireProfile(store, account, profileId);
  const revisionId =
    context.revisionId ??
    String(
      store.db
        .prepare("SELECT revision_id FROM active_schedules WHERE channel_id=?")
        .get(channel.id)?.revision_id ?? "",
    );
  const items = revisionId
    ? store.db
        .prepare(
          "SELECT DISTINCT m.* FROM media m JOIN schedule_entries e ON e.media_id=m.id WHERE e.revision_id=? AND e.end_ms>?",
        )
        .all(revisionId, context.positionMs ?? Date.now())
    : store.db
        .prepare(
          "SELECT m.* FROM channel_items ci JOIN media m ON m.id=ci.media_id WHERE ci.channel_id=?",
        )
        .all(channel.id);
  invariant(
    (items as unknown as Media[]).every((m) =>
      canReadMedia(store, account, profileId, m),
    ),
    404,
    "Channel not found",
  );
}
export function sourceById(store: Store, id: string): Source {
  const source = store.db
    .prepare("SELECT * FROM sources WHERE id=?")
    .get(id) as Source | undefined;
  invariant(source, 404, "Source not found");
  return source;
}
