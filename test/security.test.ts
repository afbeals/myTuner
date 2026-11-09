import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/database.js";
import {
  authenticate,
  createAccount,
  login,
  logout,
  normalizeSubtree,
  verifySecret,
  hashSecret,
  requireProfile,
  canReadMedia,
  visibleChannel,
} from "../src/security.js";
import { account, profile, source, media, channel } from "./helpers.js";

test("password hashes are salted and verified without storing plaintext", async () => {
  const first = await hashSecret("long-password"),
    second = await hashSecret("long-password");
  assert.notEqual(first, second);
  assert.ok(await verifySecret("long-password", first));
  assert.equal(await verifySecret("wrong", first), false);
});
test("sessions expire, revoke and reject disabled users", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const owner = await createAccount(store, "owner", "long-password", "editor");
  const session = await login(store, "OWNER", "long-password", 1000);
  assert.equal(authenticate(store, session.token, 1001).id, owner.id);
  assert.throws(
    () => authenticate(store, session.token, 1000 + 12 * 60 * 60 * 1000),
    /Authentication/,
  );
  store.db.prepare("UPDATE accounts SET disabled=1 WHERE id=?").run(owner.id);
  assert.throws(
    () => authenticate(store, session.token, 1001),
    /Authentication/,
  );
  store.db.prepare("UPDATE accounts SET disabled=0 WHERE id=?").run(owner.id);
  logout(store, session.token);
  assert.throws(
    () => authenticate(store, session.token, 1001),
    /Authentication/,
  );
  assert.equal(
    store.db
      .prepare("SELECT COUNT(*) AS n FROM sessions WHERE token_hash=?")
      .get(session.token)?.n,
    0,
  );
});
test("login throttles repeated failures and recovers after the time window", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  await createAccount(store, "owner", "long-password", "editor");
  for (let i = 0; i < 8; i++)
    await assert.rejects(
      login(store, "owner", "wrong", 1000),
      /Invalid credentials/,
    );
  await assert.rejects(
    login(store, "owner", "long-password", 1000),
    /Too many/,
  );
  assert.ok((await login(store, "owner", "long-password", 901001)).token);
});
test("private channel is invisible to another account even with shared room access", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const owner = account(store),
    other = account(store),
    admin = account(store, "admin"),
    room = profile(store, owner),
    ch = channel(store, owner);
  store.db
    .prepare(
      "INSERT INTO profile_accounts(profile_id,account_id,can_manage) VALUES(?,?,1)",
    )
    .run(room, other.id);
  requireProfile(store, other, room);
  assert.throws(() => visibleChannel(store, other, ch.id), /not found/);
  assert.equal(visibleChannel(store, owner, ch.id).id, ch.id);
  assert.equal(visibleChannel(store, admin, ch.id).id, ch.id);
});
test("source grants use directory boundaries and cannot cross another profile", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const owner = account(store),
    other = account(store),
    p = profile(store, owner),
    src = source(store);
  const allowed = media(store, src.id, "kids/a.mp4"),
    denied = media(store, src.id, "kids-private/b.mp4");
  store.db
    .prepare(
      "INSERT INTO source_grants(profile_id,source_id,subtree) VALUES(?,?,'kids')",
    )
    .run(p, src.id);
  assert.equal(canReadMedia(store, owner, p, allowed), true);
  assert.equal(canReadMedia(store, owner, p, denied), false);
  assert.throws(
    () => canReadMedia(store, other, p, allowed),
    /Profile not found/,
  );
});
for (const value of [
  "../secret",
  "/absolute",
  "one/../../secret",
  "one\\two",
  "bad\0path",
])
  test(`unsafe subtree rejected: ${JSON.stringify(value)}`, () =>
    assert.throws(() => normalizeSubtree(value), /Invalid|escapes/));

test("an in-flight old-password login cannot issue credentials after a password reset", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const owner = await createAccount(store, "owner", "old-password", "editor"),
    replacement = await hashSecret("new-password");
  const pending = login(store, "owner", "old-password");
  // These synchronous writes are the committed reset while scrypt verification is pending.
  store.db
    .prepare("UPDATE accounts SET password_hash=? WHERE id=?")
    .run(replacement, owner.id);
  store.db.prepare("DELETE FROM sessions WHERE account_id=?").run(owner.id);
  await assert.rejects(pending, /Invalid credentials/);
  assert.equal(
    store.db
      .prepare("SELECT COUNT(*) AS n FROM sessions WHERE account_id=?")
      .get(owner.id)?.n,
    0,
  );
  assert.equal(
    (await login(store, "owner", "new-password")).account.id,
    owner.id,
  );
});

test("in-flight login rejects disabled accounts and returns current roles rather than stale authority", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const owner = await createAccount(store, "owner", "long-password", "editor");
  const disabled = login(store, "owner", "long-password");
  store.db.prepare("UPDATE accounts SET disabled=1 WHERE id=?").run(owner.id);
  await assert.rejects(disabled, /Invalid credentials/);
  store.db.prepare("UPDATE accounts SET disabled=0 WHERE id=?").run(owner.id);
  const demoted = login(store, "owner", "long-password");
  store.db
    .prepare("UPDATE accounts SET role='viewer' WHERE id=?")
    .run(owner.id);
  const issued = await demoted;
  assert.equal(issued.account.role, "viewer");
  assert.equal(authenticate(store, issued.token).role, "viewer");
});

test("login reserves the throttle budget before concurrent password work", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  await createAccount(store, "parallel", "long-password", "viewer");
  const requests = Array.from({ length: 12 }, () =>
    login(store, "PARALLEL", "wrong", 1000),
  );
  const results = await Promise.allSettled(requests);
  assert.equal(
    results.filter(
      (r) =>
        r.status === "rejected" && /Invalid credentials/.test(String(r.reason)),
    ).length,
    8,
  );
  assert.equal(
    results.filter(
      (r) => r.status === "rejected" && /Too many/.test(String(r.reason)),
    ).length,
    4,
  );
  await assert.rejects(
    login(store, "parallel", "long-password", 1001),
    /Too many/,
  );
  assert.ok((await login(store, "parallel", "long-password", 901001)).token);
});
