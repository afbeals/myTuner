import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  rm,
  realpath,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { Store, migrations, schemaVersion } from "../src/database.js";
import { createServer } from "../src/server.js";
import { addSource } from "../src/catalog.js";
import {
  authenticate,
  createAccount,
  login,
  refreshAccount,
  requireAdmin,
} from "../src/security.js";
import { setPin } from "../src/identity.js";
import { RefreshService } from "../src/refresh.js";
import { OperationsService } from "../src/operations.js";
import { source, profile, channel, media } from "./helpers.js";
import { language, matchLanguage } from "../web/src/viewing-preferences.js";

async function fixture(t: { after: (f: () => unknown) => void }) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "mytuner-deferred-")),
  );
  for (const name of ["data", "media", "generated", "cache"])
    await mkdir(join(root, name));
  const store = new Store(join(root, "data", "mytuner.db"));
  const admin = await createAccount(
    store,
    "admin",
    "synthetic-password",
    "admin",
  );
  const token = (await login(store, "admin", "synthetic-password")).token;
  const src = source(store, join(root, "media"), "movies");
  const app = createServer(store, {
    generatedRoot: join(root, "generated"),
    cacheRoot: join(root, "cache"),
    writableRoots: [
      join(root, "data"),
      join(root, "generated"),
      join(root, "cache"),
    ],
  });
  t.after(async () => {
    await app.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const status = async () =>
    (await new OperationsService(
      store,
      join(root, "data"),
      join(root, "generated"),
      join(root, "cache"),
    ).status(admin)) as {
      sources: {
        refreshState: string;
        refreshScheduled: boolean;
        lastAttemptMs: number | null;
        lastRefreshMs: number | null;
        refreshError: string | null;
      }[];
    };
  return {
    root,
    store,
    admin,
    token,
    src,
    app,
    status,
    headers: { authorization: `Bearer ${token}` },
  };
}
function revoke(f: Awaited<ReturnType<typeof fixture>>, kind: string) {
  if (kind === "role")
    f.store.db
      .prepare("UPDATE accounts SET role='editor' WHERE id=?")
      .run(f.admin.id);
  else if (kind === "disabled")
    f.store.db
      .prepare("UPDATE accounts SET disabled=1 WHERE id=?")
      .run(f.admin.id);
  else
    f.store.db
      .prepare("DELETE FROM sessions WHERE account_id=?")
      .run(f.admin.id);
}
for (const kind of ["role", "disabled", "session"]) {
  test(`source registration rejects ${kind} revocation at the post-filesystem write boundary`, async (t) => {
    const f = await fixture(t),
      actor = authenticate(f.store, f.token);
    const directory = join(f.root, "additional-media");
    await mkdir(directory);
    await writeFile(
      join(directory, "original.mp4"),
      "synthetic unchanged source",
    );
    requireAdmin(actor);
    let checked = false;
    const pending = addSource(
      f.store,
      {
        name: "Revoked registration",
        root: directory,
        kind: "videos",
        recursive: true,
      },
      [join(f.root, "data")],
      () => {
        checked = true;
        requireAdmin(refreshAccount(f.store, actor));
      },
    );
    revoke(f, kind);
    await assert.rejects(
      pending,
      kind === "role" ? /Administrator/ : /Authentication/,
    );
    assert.equal(checked, true);
    assert.equal(
      f.store.db
        .prepare(
          "SELECT COUNT(*) AS n FROM sources WHERE name='Revoked registration'",
        )
        .get()?.n,
      0,
    );
    assert.equal(
      await readFile(join(directory, "original.mp4"), "utf8"),
      "synthetic unchanged source",
    );
  });
  test(`held upstream import rejects ${kind} revocation without replacing retained metadata`, async (t) => {
    const f = await fixture(t),
      item = media(f.store, f.src.id, "clip.mp4");
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>((r) => (release = r)),
      began = new Promise<void>((r) => (entered = r));
    const upstream = createHttpServer(async (_request, reply) => {
      entered();
      await held;
      reply.setHeader("content-type", "application/json");
      reply.end(
        JSON.stringify([
          {
            id: 1,
            title: "Unauthorized replacement",
            hasFile: true,
            movieFile: { path: "/remote/clip.mp4" },
          },
        ]),
      );
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    t.after(() => {
      release();
      upstream.closeAllConnections();
      upstream.close();
    });
    const address = upstream.address();
    assert.ok(address && typeof address !== "string");
    const pending = f.app.inject({
      method: "POST",
      url: `/api/sources/${f.src.id}/import`,
      headers: f.headers,
      payload: {
        provider: "radarr",
        url: `http://127.0.0.1:${address.port}`,
        apiKey: "synthetic-key",
        mappings: [{ from: "/remote", to: f.src.root_path }],
      },
    });
    const request = pending.then((r) => r);
    await began;
    revoke(f, kind);
    release();
    const response = await request;
    assert.equal(
      response.statusCode,
      kind === "role" ? 403 : 401,
      response.body,
    );
    assert.equal(
      f.store.db.prepare("SELECT title FROM media WHERE id=?").get(item.id)
        ?.title,
      "clip.mp4",
    );
    assert.equal(
      f.store.db.prepare("SELECT COUNT(*) AS n FROM integration_metadata").get()
        ?.n,
      0,
    );
  });
}

test("source HTTP registration rechecks the actor after asynchronous path validation", async (t) => {
  const f = await fixture(t),
    directory = join(f.root, "new-source");
  await mkdir(directory);
  f.app.addHook("preHandler", (request, _reply, done) => {
    done();
    if (request.url === "/api/sources" && request.method === "POST")
      revoke(f, "role");
  });
  const response = await f.app.inject({
    method: "POST",
    url: "/api/sources",
    headers: f.headers,
    payload: { name: "Denied source", root: directory, kind: "videos" },
  });
  assert.equal(response.statusCode, 403, response.body);
  assert.equal(
    f.store.db
      .prepare("SELECT COUNT(*) AS n FROM sources WHERE name='Denied source'")
      .get()?.n,
    0,
  );
});

test("manual refresh diagnostics survive unscheduling and restart, sanitize failures, and clear after successful retry", async (t) => {
  const f = await fixture(t);
  let fail = true;
  const service = new RefreshService(f.store, Buffer.alloc(32, 3), async () => {
    if (fail) throw Error("private-key secret upstream URL");
    return new Response("[]");
  });
  t.after(() => service.stop());
  assert.equal((await f.status()).sources[0]?.refreshState, "never");
  service.configure(f.src.id, {
    provider: "radarr",
    url: "http://synthetic.invalid",
    apiKey: "private-key",
    mappings: [{ from: "/remote", to: f.src.root_path }],
  });
  await assert.rejects(service.scan(f.src.id), /private-key/);
  let row = (await f.status()).sources[0]!;
  assert.equal(row.refreshState, "failed");
  assert.equal(row.refreshScheduled, false);
  assert.ok(row.lastAttemptMs);
  assert.equal(row.lastRefreshMs, null);
  assert.doesNotMatch(
    JSON.stringify(row),
    /private-key|secret|synthetic.invalid/,
  );
  service.schedule(f.src.id, 60000);
  service.schedule(f.src.id, null);
  assert.equal((await f.status()).sources[0]?.refreshState, "failed");
  const reopened = new Store(f.store.filename);
  assert.match(
    String(
      reopened.db.prepare("SELECT last_error FROM refresh_attempts").get()
        ?.last_error,
    ),
    /Refresh failed/,
  );
  reopened.close();
  fail = false;
  await service.scan(f.src.id);
  row = (await f.status()).sources[0]!;
  assert.equal(row.refreshState, "ok");
  assert.equal(row.refreshScheduled, false);
  assert.ok(row.lastRefreshMs);
  assert.equal(row.refreshError, null);
  service.schedule(f.src.id, 60000);
  service.schedule(f.src.id, null);
  assert.equal((await f.status()).sources[0]?.lastRefreshMs, row.lastRefreshMs);
});

test("superseded manual refresh failures cannot replace diagnostics for a newly configured integration", async (t) => {
  const f = await fixture(t);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    began = new Promise<void>((r) => (entered = r));
  const service = new RefreshService(
    f.store,
    Buffer.alloc(32, 4),
    async (url) => {
      if (String(url).includes("old.invalid")) {
        entered();
        await gate;
        throw Error("old secret");
      }
      return new Response("[]");
    },
  );
  t.after(async () => {
    release();
    await service.stop();
  });
  const configure = (host: string) =>
    service.configure(f.src.id, {
      provider: "radarr",
      url: `http://${host}`,
      apiKey: "synthetic-key",
      mappings: [{ from: "/remote", to: f.src.root_path }],
    });
  configure("old.invalid");
  const pending = service.scan(f.src.id);
  await began;
  configure("new.invalid");
  release();
  assert.equal(((await pending) as { superseded?: boolean }).superseded, true);
  assert.equal((await f.status()).sources[0]?.refreshState, "never");
  await service.scan(f.src.id);
  assert.equal((await f.status()).sources[0]?.refreshState, "ok");
});

test("schema 15 upgrade retains failure/success diagnostics without inventing refresh schedules", async (t) => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "mytuner-refresh-migration-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const filename = join(root, "mytuner.db"),
    old = new DatabaseSync(filename);
  for (const migration of migrations.slice(0, 15)) old.exec(migration);
  old.exec(
    "PRAGMA user_version=15; INSERT INTO sources(id,name,root_path,kind,recursive) VALUES('failed','Failed','/synthetic/failed','movies',1),('success','Success','/synthetic/success','movies',1); INSERT INTO refresh_sources(source_id,interval_ms,next_run_ms,last_error) VALUES('failed',60000,1000,'Previous sanitized failure'); INSERT INTO integrations(id,source_id,provider,url,encrypted_key,mappings_json,last_success) VALUES('i','success','radarr','http://synthetic.invalid','unused','[]',1234);",
  );
  old.close();
  const upgraded = new Store(filename);
  t.after(() => upgraded.close());
  assert.equal(
    upgraded.db.prepare("PRAGMA user_version").get()?.user_version,
    schemaVersion,
  );
  assert.equal(
    upgraded.db
      .prepare(
        "SELECT last_error FROM refresh_attempts WHERE source_id='failed'",
      )
      .get()?.last_error,
    "Previous sanitized failure",
  );
  assert.equal(
    upgraded.db
      .prepare(
        "SELECT last_success_ms FROM refresh_attempts WHERE source_id='success'",
      )
      .get()?.last_success_ms,
    1234,
  );
  assert.equal(
    upgraded.db.prepare("SELECT COUNT(*) AS n FROM refresh_sources").get()?.n,
    1,
  );
});

test("PIN-locked lineup saves return actionable forbidden errors before private membership checks", async (t) => {
  const f = await fixture(t),
    editor = await createAccount(
      f.store,
      "editor",
      "synthetic-password",
      "editor",
    ),
    p = profile(f.store, editor),
    own = channel(f.store, editor),
    foreign = channel(f.store, f.admin);
  f.store.db
    .prepare("INSERT INTO subscriptions(profile_id,channel_id) VALUES(?,?)")
    .run(p, own.id);
  await setPin(f.store, f.admin, p, "1234");
  const headers = {
    authorization: `Bearer ${(await login(f.store, "editor", "synthetic-password")).token}`,
  };
  const save = (ids: string[]) =>
    f.app.inject({
      method: "PUT",
      url: `/api/profiles/${p}/lineup`,
      headers,
      payload: { channelIds: ids },
    });
  const locked = await save([own.id]);
  assert.equal(locked.statusCode, 403, locked.body);
  assert.match(locked.body, /locked/);
  assert.doesNotMatch(locked.body, new RegExp(foreign.id));
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: `/api/profiles/${p}/unlock`,
        headers,
        payload: { pin: "1234" },
      })
    ).statusCode,
    204,
  );
  assert.equal((await save([own.id])).statusCode, 200);
  assert.equal((await save([])).statusCode, 409);
  const forged = await save([own.id, foreign.id]);
  assert.equal(forged.statusCode, 409);
  assert.doesNotMatch(forged.body, new RegExp(foreign.id));
});

test("language preferences canonicalize ISO terminology/bibliographic tags without selecting undefined language", () => {
  for (const [aliases, canonical] of [
    [["jpn", "JA_jp"], "ja"],
    [["ita", "it-IT"], "it"],
    [["chi", "zho", "zh-Hans"], "zh"],
    [["fre", "fra", "fr-CA"], "fr"],
    [["alb", "sqi"], "sq"],
    [["heb", "iw"], "he"],
  ] as const) {
    for (const alias of aliases) assert.equal(language(alias), canonical);
  }
  assert.equal(language("xxx"), "xxx");
  assert.equal(language("und"), null);
  assert.equal(language(null), null);
  const tracks = [
    { index: 17, language: "jpn", type: "audio" as const, codec: "aac" },
    { index: 8, language: "und", type: "audio" as const, codec: "aac" },
  ];
  assert.equal(matchLanguage("ja", tracks), 17);
  assert.equal(matchLanguage("und", tracks), -1);
  assert.equal(matchLanguage(null, tracks), -1);
  assert.equal(matchLanguage("it", tracks), -1);
});
