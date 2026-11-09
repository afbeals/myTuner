import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/database.js";
import {
  createAccount,
  login,
  authenticate,
  requireProfile,
  hashSecret,
  refreshAccount,
} from "../src/security.js";
import {
  PairingService,
  updateAccount,
  changePassword,
  setPin,
  unlockProfile,
  clearProfileUnlocks,
} from "../src/identity.js";
import { PlaybackService } from "../src/playback.js";
import { createServer } from "../src/server.js";
import { AccessRegistry } from "../src/access.js";
import { profile } from "./helpers.js";
async function fixture(t: { after: (fn: () => unknown) => void }) {
  const store = new Store(":memory:"),
    admin = await createAccount(store, "admin", "test-password", "admin"),
    owner = await createAccount(store, "owner", "test-password", "editor"),
    p = profile(store, owner),
    app = createServer(store);
  t.after(async () => {
    await app.close();
    store.close();
  });
  const headers = {
    authorization: `Bearer ${(await login(store, "admin", "test-password")).token}`,
  };
  return { store, admin, owner, p, app, headers };
}
test("account changes protect last admin and immediately invalidate all tokens", async (t) => {
  const f = await fixture(t),
    token = (await login(f.store, "owner", "test-password")).token;
  assert.throws(
    () => updateAccount(f.store, f.admin, f.admin.id, { disabled: true }),
    /last enabled/,
  );
  updateAccount(f.store, f.admin, f.owner.id, { disabled: true });
  assert.throws(() => authenticate(f.store, token), /Authentication/);
  updateAccount(f.store, f.admin, f.owner.id, {
    disabled: false,
    role: "viewer",
  });
  const next = (await login(f.store, "owner", "test-password")).token;
  await changePassword(f.store, f.admin, f.owner.id, "different-password");
  assert.throws(() => authenticate(f.store, next), /Authentication/);
  await assert.rejects(login(f.store, "owner", "test-password"), /credentials/);
});
test("browser cookie is HttpOnly and all cookie writes require same-origin CSRF", async (t) => {
  const f = await fixture(t),
    response = await f.app.inject({
      method: "POST",
      url: "/api/auth/browser",
      payload: { username: "admin", password: "test-password" },
    });
  assert.equal(response.statusCode, 200);
  const cookie = String(response.headers["set-cookie"]).split(";")[0]!,
    csrf = response.json().csrfToken;
  assert.match(
    String(response.headers["set-cookie"]),
    /HttpOnly; SameSite=Strict/,
  );
  assert.equal(response.json().token, undefined);
  assert.equal(
    (await f.app.inject({ url: "/api/auth/me", headers: { cookie } }))
      .statusCode,
    200,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: { cookie },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: {
          cookie,
          "x-csrf-token": csrf,
          origin: "http://evil.example",
        },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: {
          cookie,
          "x-csrf-token": csrf,
          origin: "http://localhost:80",
        },
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (await f.app.inject({ url: "/api/auth/me", headers: { cookie } }))
      .statusCode,
    401,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/auth/browser",
        headers: { origin: "http://evil.example" },
        payload: { username: "admin", password: "test-password" },
      })
    ).statusCode,
    403,
  );
});
test("pairing is pending until approved, expires, is single-use, and grants viewing scope even to admin", async (t) => {
  const f = await fixture(t),
    service = new PairingService(f.store),
    start = service.start("Living room", "client", 100);
  assert.deepEqual(service.poll(start.deviceCode, 101), { status: "pending" });
  service.approve(f.admin, start.userCode, 102);
  const result = service.poll(start.deviceCode, 103);
  assert.equal(result.status, "approved");
  assert.throws(() => service.poll(start.deviceCode, 104), /unavailable/);
  const expired = service.start("Other TV", "client", 100);
  assert.throws(() => service.poll(expired.deviceCode, 400000), /unavailable/);
  const live = service.start("TV", "other"),
    res = service.poll(live.deviceCode);
  assert.equal(res.status, "pending");
  service.approve(f.admin, live.userCode);
  const approved = service.poll(live.deviceCode);
  assert.equal(approved.status, "approved");
  if (approved.status !== "approved") return;
  const headers = { authorization: `Bearer ${approved.token}` };
  assert.equal(
    (await f.app.inject({ url: "/api/profiles", headers })).statusCode,
    200,
  );
  for (const url of ["/api/accounts", "/api/sources", "/api/auth/sessions"]) {
    assert.equal((await f.app.inject({ url, headers })).statusCode, 403);
  }
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/accounts",
        headers,
        payload: {},
      })
    ).statusCode,
    403,
  );
});
test("PIN unlock is restricted to profile members and one authenticated session, with attempt limits", async (t) => {
  const f = await fixture(t);
  await setPin(f.store, f.admin, f.p, "1234");
  const a = authenticate(
      f.store,
      (await login(f.store, "owner", "test-password")).token,
    ),
    b = authenticate(
      f.store,
      (await login(f.store, "owner", "test-password")).token,
    );
  assert.throws(() => requireProfile(f.store, a, f.p), /locked/);
  await unlockProfile(f.store, a, f.p, "1234");
  requireProfile(f.store, a, f.p);
  assert.throws(() => requireProfile(f.store, b, f.p), /locked/);
  const other = await createAccount(
      f.store,
      "other",
      "test-password",
      "viewer",
    ),
    otherActor = authenticate(
      f.store,
      (await login(f.store, "other", "test-password")).token,
    );
  await assert.rejects(
    unlockProfile(f.store, otherActor, f.p, "1234"),
    /not found/,
  );
  for (let i = 0; i < 6; i++)
    await assert.rejects(unlockProfile(f.store, b, f.p, "9999"), /Incorrect/);
  await assert.rejects(unlockProfile(f.store, b, f.p, "1234"), /Too many/);
  await setPin(f.store, f.admin, f.p, null);
  requireProfile(f.store, b, f.p);
  assert.equal(other.role, "viewer");
});
test("access registry closes revoked streams, tolerates failed checks and unregisters finished streams", () => {
  const registry = new AccessRegistry();
  let valid = true,
    closed = 0;
  const unregister = registry.track(
    () => valid,
    () => closed++,
  );
  registry.recheck();
  assert.equal(closed, 0);
  valid = false;
  registry.recheck();
  assert.equal(closed, 1);
  unregister();
  registry.track(
    () => {
      throw Error("revoked");
    },
    () => closed++,
  );
  registry.recheck();
  assert.equal(closed, 2);
  registry.track(
    () => true,
    () => closed++,
  );
  registry.close();
  assert.equal(closed, 3);
});

test("TV startup and profile switching clear only that device's unlocks, including paired administrator viewing", async (t) => {
  const f = await fixture(t);
  await setPin(f.store, f.admin, f.p, "1234");
  const a = authenticate(
      f.store,
      (await login(f.store, "owner", "test-password")).token,
    ),
    b = authenticate(
      f.store,
      (await login(f.store, "owner", "test-password")).token,
    );
  await unlockProfile(f.store, a, f.p, "1234");
  await unlockProfile(f.store, b, f.p, "1234");
  const playback = new PlaybackService(f.store);
  playback.startup(a);
  assert.throws(() => requireProfile(f.store, a, f.p), /locked/);
  requireProfile(f.store, b, f.p);
  await unlockProfile(f.store, a, f.p, "1234");
  playback.startup(a, f.p);
  assert.throws(() => requireProfile(f.store, a, f.p), /locked/);
  const pair = new PairingService(f.store),
    pending = pair.start("Admin TV", "test");
  pair.approve(f.admin, pending.userCode);
  const approved = pair.poll(pending.deviceCode);
  assert.equal(approved.status, "approved");
  if (approved.status !== "approved") return;
  const device = authenticate(f.store, approved.token);
  assert.throws(() => requireProfile(f.store, device, f.p), /locked/);
  assert.throws(
    () => requireProfile(f.store, refreshAccount(f.store, device), f.p),
    /locked/,
  );
  await unlockProfile(f.store, device, f.p, "1234");
  requireProfile(f.store, device, f.p);
  const headers = { authorization: `Bearer ${approved.token}` };
  assert.equal(
    (await f.app.inject({ url: `/api/profiles/${f.p}/settings`, headers }))
      .statusCode,
    403,
  );
});

test("TV API startup requires PIN again and exposes the correct profile lock state", async (t) => {
  const f = await fixture(t);
  await setPin(f.store, f.admin, f.p, "1234");
  const begun = await f.app.inject({
    method: "POST",
    url: "/api/auth/pairings",
    payload: { deviceName: "TV" },
  });
  assert.equal(begun.statusCode, 201);
  const pending = begun.json();
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/auth/pairings/poll",
        payload: { deviceCode: pending.deviceCode },
      })
    ).json().status,
    "pending",
  );
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/auth/pairings/approve",
        headers: f.headers,
        payload: { userCode: pending.userCode },
      })
    ).statusCode,
    204,
  );
  const approved = (
    await f.app.inject({
      method: "POST",
      url: "/api/auth/pairings/poll",
      payload: { deviceCode: pending.deviceCode },
    })
  ).json();
  assert.equal(approved.status, "approved");
  const headers = { authorization: `Bearer ${approved.token}` };
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/playback/startup",
        headers,
      })
    ).statusCode,
    200,
  );
  const profiles = () => f.app.inject({ url: "/api/profiles", headers });
  assert.equal(
    (await profiles()).json().find((p: { id: string }) => p.id === f.p).locked,
    true,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: `/api/profiles/${f.p}/unlock`,
        headers,
        payload: { pin: "1234" },
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (await profiles()).json().find((p: { id: string }) => p.id === f.p).locked,
    false,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: `/api/playback/profiles/${f.p}/select`,
        headers,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await profiles()).json().find((p: { id: string }) => p.id === f.p).locked,
    true,
  );
});

test("configured HTTPS public origin supports Secure cookies behind an HTTP reverse proxy without trusting forwarded headers", async (t) => {
  const f = await fixture(t),
    secure = createServer(f.store, {
      secureCookie: true,
      publicOrigin: "https://tv.home",
    });
  t.after(() => secure.close());
  const response = await secure.inject({
    method: "POST",
    url: "/api/auth/browser",
    headers: { host: "backend:8777", origin: "https://tv.home" },
    payload: { username: "admin", password: "test-password" },
  });
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers["set-cookie"]), /; Secure/);
  const cookie = String(response.headers["set-cookie"]).split(";")[0]!,
    csrf = response.json().csrfToken;
  assert.equal(
    (
      await secure.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: {
          host: "backend:8777",
          origin: "https://tv.home",
          cookie,
          "x-csrf-token": csrf,
        },
      })
    ).statusCode,
    204,
  );
});

test("an in-flight PIN unlock rejects a replaced PIN without recreating cleared unlocks", async (t) => {
  const f = await fixture(t);
  await setPin(f.store, f.admin, f.p, "1234");
  const actor = authenticate(
      f.store,
      (await login(f.store, "owner", "test-password")).token,
    ),
    replacement = await hashSecret("5678");
  const pending = unlockProfile(f.store, actor, f.p, "1234");
  f.store.db
    .prepare("UPDATE profiles SET pin_hash=? WHERE id=?")
    .run(replacement, f.p);
  f.store.db.prepare("DELETE FROM profile_unlocks WHERE profile_id=?").run(f.p);
  await assert.rejects(pending, /Incorrect PIN/);
  assert.throws(() => requireProfile(f.store, actor, f.p), /locked/);
  assert.equal(
    f.store.db
      .prepare("SELECT COUNT(*) AS n FROM profile_unlocks WHERE profile_id=?")
      .get(f.p)?.n,
    0,
  );
  await unlockProfile(f.store, actor, f.p, "5678");
  requireProfile(f.store, actor, f.p);
});

for (const revoked of ["session", "membership"] as const)
  test(`an in-flight PIN unlock rechecks revoked ${revoked} authority`, async (t) => {
    const f = await fixture(t);
    await setPin(f.store, f.admin, f.p, "1234");
    const actor = authenticate(
      f.store,
      (await login(f.store, "owner", "test-password")).token,
    );
    const pending = unlockProfile(f.store, actor, f.p, "1234");
    if (revoked === "session")
      f.store.db
        .prepare("DELETE FROM sessions WHERE token_hash=?")
        .run(actor.sessionHash!);
    else
      f.store.db
        .prepare("UPDATE profiles SET owner_account_id=? WHERE id=?")
        .run(f.admin.id, f.p);
    await assert.rejects(
      pending,
      revoked === "session" ? /Authentication/ : /Profile not found/,
    );
    assert.equal(
      f.store.db
        .prepare("SELECT COUNT(*) AS n FROM profile_unlocks WHERE profile_id=?")
        .get(f.p)?.n,
      0,
    );
  });

test("async password and PIN changes recheck the administrator's session before committing", async (t) => {
  const f = await fixture(t);
  const before = f.store.db
    .prepare("SELECT password_hash FROM accounts WHERE id=?")
    .get(f.owner.id)?.password_hash;
  for (const operation of ["password", "pin"] as const) {
    const actor = authenticate(
        f.store,
        (await login(f.store, "admin", "test-password")).token,
      ),
      pending =
        operation === "password"
          ? changePassword(f.store, actor, f.owner.id, "different-password")
          : setPin(f.store, actor, f.p, "1234");
    f.store.db
      .prepare("DELETE FROM sessions WHERE token_hash=?")
      .run(actor.sessionHash!);
    await assert.rejects(pending, /Authentication/);
  }
  assert.equal(
    f.store.db
      .prepare("SELECT password_hash FROM accounts WHERE id=?")
      .get(f.owner.id)?.password_hash,
    before,
  );
  assert.equal(
    f.store.db.prepare("SELECT pin_hash FROM profiles WHERE id=?").get(f.p)
      ?.pin_hash,
    null,
  );
});

test("async PIN changes recheck an editor's management rights", async (t) => {
  const f = await fixture(t),
    pending = setPin(f.store, f.owner, f.p, "1234");
  f.store.db
    .prepare("UPDATE accounts SET role='viewer' WHERE id=?")
    .run(f.owner.id);
  await assert.rejects(pending, /Profile management not allowed/);
  assert.equal(
    f.store.db.prepare("SELECT pin_hash FROM profiles WHERE id=?").get(f.p)
      ?.pin_hash,
    null,
  );
});

for (const operation of ["password", "account", "revoke-all"] as const)
  test(`${operation} revocation also invalidates approved pairings while unrelated accounts remain valid`, async (t) => {
    const f = await fixture(t),
      service = new PairingService(f.store),
      affected = service.start("Owner TV", "owner"),
      unrelated = service.start("Admin TV", "admin"),
      issued = await login(f.store, "owner", "test-password");
    service.approve(f.owner, affected.userCode);
    service.approve(f.admin, unrelated.userCode);
    if (operation === "password")
      await changePassword(f.store, f.admin, f.owner.id, "different-password");
    else if (operation === "account")
      updateAccount(f.store, f.admin, f.owner.id, { role: "viewer" });
    else
      assert.equal(
        (
          await f.app.inject({
            method: "DELETE",
            url: `/api/accounts/${f.owner.id}/sessions`,
            headers: f.headers,
          })
        ).statusCode,
        204,
      );
    assert.throws(() => service.poll(affected.deviceCode), /unavailable/);
    assert.throws(() => authenticate(f.store, issued.token), /Authentication/);
    const result = service.poll(unrelated.deviceCode);
    assert.equal(result.status, "approved");
    if (result.status === "approved")
      assert.equal(authenticate(f.store, result.token).id, f.admin.id);
  });

for (const change of ["session", "role", "disabled"] as const)
  test(`in-flight account creation cannot outlive administrator ${change} revocation`, async (t) => {
    const f = await fixture(t),
      actor = authenticate(
        f.store,
        (await login(f.store, "admin", "test-password")).token,
      );
    await createAccount(f.store, "second-admin", "synthetic-password", "admin");
    const pending = createAccount(
      f.store,
      "pending-admin",
      "synthetic-password",
      "admin",
      actor,
    );
    if (change === "session")
      f.store.db
        .prepare("DELETE FROM sessions WHERE token_hash=?")
        .run(actor.sessionHash!);
    else if (change === "role")
      f.store.db
        .prepare("UPDATE accounts SET role='viewer' WHERE id=?")
        .run(actor.id);
    else
      f.store.db
        .prepare("UPDATE accounts SET disabled=1 WHERE id=?")
        .run(actor.id);
    await assert.rejects(
      pending,
      change === "role" ? /Administrator access/ : /Authentication/,
    );
    assert.equal(
      f.store.db
        .prepare("SELECT id FROM accounts WHERE username='pending-admin'")
        .get(),
      undefined,
    );
  });

for (const action of ["lock", "startup", "select"] as const) {
  test(`pending PIN verification cannot undo a newer ${action}`, async (t) => {
    const f = await fixture(t);
    await setPin(f.store, f.admin, f.p, "1234");
    const actor = authenticate(
      f.store,
      (await login(f.store, "owner", "test-password")).token,
    );
    const other = authenticate(
      f.store,
      (await login(f.store, "owner", "test-password")).token,
    );
    await unlockProfile(f.store, other, f.p, "1234");
    const pending = unlockProfile(f.store, actor, f.p, "1234");
    const rejected = assert.rejects(pending, /lock changed/);
    if (action === "lock")
      clearProfileUnlocks(f.store, actor.sessionHash!, f.p);
    else
      new PlaybackService(f.store).startup(
        actor,
        action === "select" ? f.p : undefined,
      );
    assert.throws(() => requireProfile(f.store, actor, f.p), /locked/);
    await rejected;
    assert.throws(() => requireProfile(f.store, actor, f.p), /locked/);
    requireProfile(f.store, other, f.p);
    await unlockProfile(f.store, actor, f.p, "1234");
    requireProfile(f.store, actor, f.p);
  });
}

test("concurrent case-equivalent account creation returns one 201 and one 409", async (t) => {
  const f = await fixture(t);
  const responses = await Promise.all(
    ["NewAccount", "newaccount"].map((username) =>
      f.app.inject({
        method: "POST",
        url: "/api/accounts",
        headers: f.headers,
        payload: { username, password: "synthetic-password", role: "viewer" },
      }),
    ),
  );
  assert.deepEqual(responses.map((r) => r.statusCode).sort(), [201, 409]);
  assert.equal(
    f.store.db
      .prepare("SELECT COUNT(*) AS n FROM accounts WHERE username='newaccount'")
      .get()?.n,
    1,
  );
});
