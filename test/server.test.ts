import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import { Store } from "../src/database.js";
import { createServer } from "../src/server.js";
import { createAccount, login } from "../src/security.js";
import { addSource, scanSource } from "../src/catalog.js";
import { noBreaks } from "../src/scheduler.js";
import { profile, channel, media } from "./helpers.js";
import {
  mediaResponseSchema,
  accountResponseSchema,
  profileResponseSchema,
} from "../src/contracts.js";
import type { Media } from "../src/domain.js";

async function fixture(t: { after: (fn: () => unknown) => void }) {
  const root = await mkdtemp(join(tmpdir(), "mytuner-api-")),
    store = new Store(":memory:");
  const admin = await createAccount(store, "admin", "admin-password", "admin"),
    owner = await createAccount(store, "owner", "owner-password", "editor"),
    other = await createAccount(store, "other", "other-password", "editor"),
    viewer = await createAccount(store, "viewer", "viewer-password", "viewer");
  const p = profile(store, owner),
    op = profile(store, other),
    vp = profile(store, viewer),
    ap = profile(store, admin);
  await mkdir(join(root, "media"));
  await writeFile(join(root, "media", "source.mp4"), "0123456789");
  const src = await addSource(
    store,
    {
      name: "Source",
      root: join(root, "media"),
      kind: "videos",
      recursive: true,
    },
    [join(root, "data")],
  );
  await scanSource(store, src, async () => 1000);
  const item = store.db
    .prepare("SELECT * FROM media")
    .get() as unknown as Media;
  for (const pid of [p, op, vp])
    store.db
      .prepare(
        "INSERT INTO source_grants(profile_id,source_id,subtree) VALUES(?,?,'')",
      )
      .run(pid, src.id);
  const app = createServer(store, {
    writableRoots: [join(root, "data")],
    generatedRoot: join(root, "generated"),
    integrationKey: Buffer.alloc(32, 1),
    cacheRoot: join(root, "cache"),
  });
  t.after(async () => {
    await app.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const headers = async (username: string, password: string) => ({
    authorization: `Bearer ${(await login(store, username, password)).token}`,
  });
  return {
    root,
    store,
    admin,
    owner,
    other,
    viewer,
    p,
    op,
    vp,
    ap,
    src,
    item,
    app,
    ah: await headers("admin", "admin-password"),
    oh: await headers("owner", "owner-password"),
    xh: await headers("other", "other-password"),
    vh: await headers("viewer", "viewer-password"),
  };
}
test("health is public but catalog and source management require authentication/admin", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.app.inject({ url: "/api/health" })).statusCode, 200);
  assert.equal((await f.app.inject({ url: "/api/sources" })).statusCode, 401);
  assert.equal(
    (await f.app.inject({ url: "/api/sources", headers: f.oh })).statusCode,
    403,
  );
  const response = await f.app.inject({ url: "/api/sources", headers: f.ah });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().length, 1);
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/accounts",
        headers: f.oh,
        payload: { username: "new", password: "valid-password", role: "admin" },
      })
    ).statusCode,
    403,
  );
});
test("admin can create accounts without exposing password hashes and duplicate accounts conflict", async (t) => {
  const f = await fixture(t),
    payload = {
      username: "newuser",
      password: "valid-password",
      role: "viewer",
    };
  const result = await f.app.inject({
    method: "POST",
    url: "/api/accounts",
    headers: f.ah,
    payload,
  });
  assert.equal(result.statusCode, 201);
  assert.equal(result.json().password_hash, undefined);
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/accounts",
        headers: f.ah,
        payload,
      })
    ).statusCode,
    409,
  );
  const invalid = await f.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "newuser", password: "wrong" },
  });
  assert.equal(invalid.statusCode, 401);
  const valid = await f.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "newuser", password: "valid-password" },
  });
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.json().account.password_hash, undefined);
});
test("private channels are absent from other users' lists, subscriptions, and live routes", async (t) => {
  const f = await fixture(t),
    ch = channel(f.store, f.owner);
  f.store.db
    .prepare("INSERT INTO channel_items(channel_id,media_id) VALUES(?,?)")
    .run(ch.id, f.item.id);
  const list = await f.app.inject({
    url: `/api/profiles/${f.op}/channels`,
    headers: f.xh,
  });
  assert.deepEqual(list.json(), []);
  const own = await f.app.inject({
    url: `/api/profiles/${f.p}/channels`,
    headers: f.oh,
  });
  assert.equal(own.json()[0].id, ch.id);
  assert.equal(
    (
      await f.app.inject({
        method: "PUT",
        url: `/api/profiles/${f.op}/subscriptions/${ch.id}`,
        headers: f.xh,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await f.app.inject({
        url: `/api/profiles/${f.op}/channels/${ch.id}/live`,
        headers: f.xh,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "PUT",
        url: `/api/profiles/${f.ap}/subscriptions/${ch.id}`,
        headers: f.ah,
      })
    ).statusCode,
    204,
  );
});
test("source grant revocation removes a shared channel and denies direct file access", async (t) => {
  const f = await fixture(t),
    ch = channel(f.store, f.admin, "shared");
  f.store.db
    .prepare("INSERT INTO channel_items(channel_id,media_id) VALUES(?,?)")
    .run(ch.id, f.item.id);
  assert.equal(
    (
      await f.app.inject({
        url: `/api/profiles/${f.p}/channels`,
        headers: f.oh,
      })
    ).json().length,
    1,
  );
  f.store.db.prepare("DELETE FROM source_grants WHERE profile_id=?").run(f.p);
  assert.deepEqual(
    (
      await f.app.inject({
        url: `/api/profiles/${f.p}/channels`,
        headers: f.oh,
      })
    ).json(),
    [],
  );
  assert.equal(
    (
      await f.app.inject({
        url: `/api/profiles/${f.p}/media/${f.item.id}/file`,
        headers: f.oh,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (await f.app.inject({ url: `/api/profiles/${f.op}/media`, headers: f.oh }))
      .statusCode,
    404,
  );
});
test("viewers cannot create channels or elevate their own source access", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/channels",
        headers: f.vh,
        payload: { name: "No", profileId: f.vp, visibility: "private" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: `/api/profiles/${f.p}/grants`,
        headers: f.oh,
        payload: { sourceId: f.src.id, subtree: "" },
      })
    ).statusCode,
    403,
  );
  const invalid = await f.app.inject({
    method: "POST",
    url: `/api/profiles/${f.p}/grants`,
    headers: f.ah,
    payload: { sourceId: f.src.id, subtree: "../private" },
  });
  assert.equal(invalid.statusCode, 400);
});
test("catalog filtering excludes unauthorized subtrees before total counts", async (t) => {
  const f = await fixture(t);
  media(f.store, f.src.id, "private/secret.mp4");
  f.store.db.prepare("DELETE FROM source_grants WHERE profile_id=?").run(f.p);
  f.store.db
    .prepare(
      "INSERT INTO source_grants(profile_id,source_id,subtree) VALUES(?,?,'allowed')",
    )
    .run(f.p, f.src.id);
  const result = await f.app.inject({
    url: `/api/profiles/${f.p}/media`,
    headers: f.oh,
  });
  assert.equal(result.json().total, 0);
  assert.deepEqual(result.json().items, []);
});
test("read-only streaming supports ranges and HEAD and detects replaced files", async (t) => {
  const f = await fixture(t),
    url = `/api/profiles/${f.p}/media/${f.item.id}/file`,
    before = await readFile(join(f.root, "media", "source.mp4"));
  const response = await f.app.inject({
    url,
    headers: { ...f.oh, range: "bytes=2-5" },
  });
  assert.equal(response.statusCode, 206);
  assert.equal(response.body, "2345");
  assert.equal(response.headers["content-range"], "bytes 2-5/10");
  const head = await f.app.inject({ method: "HEAD", url, headers: f.oh });
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, "");
  assert.equal(head.headers["content-length"], "10");
  const bad = await f.app.inject({
    url,
    headers: { ...f.oh, range: "bytes=500-" },
  });
  assert.equal(bad.statusCode, 416);
  assert.equal(bad.headers["content-range"], "bytes */10");
  assert.deepEqual(await readFile(join(f.root, "media", "source.mp4")), before);
  await writeFile(join(f.root, "media", "source.mp4"), "changed-longer");
  assert.equal((await f.app.inject({ url, headers: f.oh })).statusCode, 409);
});
test("first schedule publishes atomically, resolves live offsets, and cannot silently reset", async (t) => {
  const f = await fixture(t),
    ch = channel(f.store, f.owner),
    url = `/api/channels/${ch.id}/schedule`;
  const payload = {
    profileId: f.p,
    startMs: 1000,
    untilMs: 5000,
    groups: [{ id: "group", mode: "ordered", mediaIds: [f.item.id] }],
    rules: noBreaks,
  };
  const publish = await f.app.inject({
    method: "POST",
    url,
    headers: f.oh,
    payload,
  });
  assert.equal(publish.statusCode, 201, publish.body);
  assert.equal(publish.json().entries.length, 4);
  const live = await f.app.inject({
    url: `/api/profiles/${f.p}/channels/${ch.id}/live?atMs=1250`,
    headers: f.oh,
  });
  assert.equal(live.json().offsetMs, 250);
  const reset = await f.app.inject({
    method: "POST",
    url,
    headers: f.oh,
    payload,
  });
  assert.equal(reset.statusCode, 409);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM schedule_revisions").get()?.n,
    1,
  );
});
test("malformed bodies do not disclose internal paths or crash the server", async (t) => {
  const f = await fixture(t);
  const invalid = await f.app.inject({
    method: "POST",
    url: "/api/channels",
    headers: f.oh,
    payload: { name: "Missing fields" },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error, "Invalid request");
  const logout = await f.app.inject({
    method: "POST",
    url: "/api/auth/logout",
    headers: f.oh,
  });
  assert.equal(logout.statusCode, 204);
  assert.equal(
    (await f.app.inject({ url: "/api/auth/me", headers: f.oh })).statusCode,
    401,
  );
});

test("admin creates room profiles and grants membership while ordinary users cannot", async (t) => {
  const f = await fixture(t);
  const create = await f.app.inject({
    method: "POST",
    url: "/api/profiles",
    headers: f.ah,
    payload: { name: "Living Room", kind: "room" },
  });
  assert.equal(create.statusCode, 201);
  const room = create.json().id;
  assert.equal(
    (
      await f.app.inject({
        method: "PUT",
        url: `/api/profiles/${room}/accounts/${f.owner.id}`,
        headers: f.ah,
        payload: { canManage: true },
      })
    ).statusCode,
    204,
  );
  const list = await f.app.inject({ url: "/api/profiles", headers: f.oh });
  assert.ok(list.json().some((p: { id: string }) => p.id === room));
  const forbidden = await f.app.inject({
    method: "POST",
    url: "/api/profiles",
    headers: f.oh,
    payload: { name: "New", kind: "room" },
  });
  assert.equal(forbidden.statusCode, 403);
  const missingOwner = await f.app.inject({
    method: "POST",
    url: "/api/profiles",
    headers: f.ah,
    payload: { name: "Person", kind: "person" },
  });
  assert.equal(missingOwner.statusCode, 400);
});

test("admin source registration and real scan expose only inspected files", async (t) => {
  try {
    await promisify(execFile)("ffmpeg", ["-version"]);
  } catch {
    t.skip("ffmpeg unavailable");
    return;
  }
  const f = await fixture(t),
    root = join(f.root, "shows");
  await mkdir(root);
  await promisify(execFile)("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=32x32:r=10:d=1",
    "-c:v",
    "mpeg4",
    join(root, "episode.mp4"),
  ]);
  const create = await f.app.inject({
    method: "POST",
    url: "/api/sources",
    headers: f.ah,
    payload: { name: "Shows", root, kind: "shows", recursive: true },
  });
  assert.equal(create.statusCode, 201, create.body);
  const sourceId = create.json().id;
  const scan = await f.app.inject({
    method: "POST",
    url: `/api/sources/${sourceId}/scan`,
    headers: f.ah,
  });
  assert.equal(scan.statusCode, 200);
  assert.equal(scan.json().complete, true);
  assert.equal(scan.json().updated, 1);
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: `/api/profiles/${f.p}/grants`,
        headers: f.ah,
        payload: { sourceId, subtree: "" },
      })
    ).statusCode,
    201,
  );
  const catalog = await f.app.inject({
    url: `/api/profiles/${f.p}/media?search=episode`,
    headers: f.oh,
  });
  assert.equal(catalog.json().total, 1);
  assert.ok(catalog.json().items[0].durationMs >= 900);
  mediaResponseSchema.parse(catalog.json().items[0]);
});

test("read-only Sonarr import works through the HTTP API with mapped file metadata", async (t) => {
  const f = await fixture(t);
  f.store.db
    .prepare("UPDATE sources SET kind='shows' WHERE id=?")
    .run(f.src.id);
  const upstream = createHttpServer((request, response) => {
    assert.equal(request.method, "GET");
    assert.equal(request.headers["x-api-key"], "test-key");
    const path = new URL(request.url!, "http://localhost").pathname;
    const body = path.endsWith("/series")
      ? [{ id: 1, title: "Imported Show" }]
      : path.endsWith("/episodefile")
        ? [{ id: 7, path: "/tv/source.mp4" }]
        : [
            {
              id: 10,
              episodeFileId: 7,
              seasonNumber: 1,
              episodeNumber: 2,
              title: "Episode Two",
            },
          ];
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(body));
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        upstream.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const imported = await f.app.inject({
    method: "POST",
    url: `/api/sources/${f.src.id}/import`,
    headers: f.ah,
    payload: {
      provider: "sonarr",
      url: `http://127.0.0.1:${address.port}`,
      apiKey: "test-key",
      mappings: [{ from: "/tv", to: f.src.root_path }],
    },
  });
  assert.equal(imported.statusCode, 200, imported.body);
  assert.deepEqual(imported.json(), { matched: 1, unmatched: 0 });
  const list = await f.app.inject({
    url: `/api/profiles/${f.p}/media`,
    headers: f.oh,
  });
  assert.equal(list.json().items[0].title, "Episode Two");
  assert.equal(list.json().items[0].metadata.seriesTitle, "Imported Show");
  assert.equal(list.json().items[0].metadata.episodeNumber, 2);
});

test("admin generation API creates a scoped job and enforces permissions on generated assets", async (t) => {
  try {
    await promisify(execFile)("ffmpeg", ["-version"]);
  } catch {
    t.skip("ffmpeg unavailable");
    return;
  }
  const f = await fixture(t);
  await rm(join(f.root, "media", "source.mp4"));
  await promisify(execFile)("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=32x32:r=10:d=1",
    "-c:v",
    "mpeg4",
    join(f.root, "media", "source.mp4"),
  ]);
  await scanSource(f.store, f.src);
  const input = {
    sourceId: f.src.id,
    directory: "",
    recursive: false,
    kinds: ["thumbnail"],
    regenerate: false,
  };
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/generation/jobs",
        headers: f.oh,
        payload: input,
      })
    ).statusCode,
    403,
  );
  const preview = await f.app.inject({
    method: "POST",
    url: "/api/generation/preview",
    headers: f.ah,
    payload: input,
  });
  assert.equal(preview.json().count, 1);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM generation_jobs").get()?.n,
    0,
  );
  const job = await f.app.inject({
    method: "POST",
    url: "/api/generation/jobs",
    headers: f.ah,
    payload: input,
  });
  assert.equal(job.statusCode, 202);
  const jobId = job.json().id;
  let status = "queued";
  for (let i = 0; i < 200; i++) {
    const result = await f.app.inject({
      url: `/api/generation/jobs/${jobId}`,
      headers: f.ah,
    });
    status = result.json().status;
    if (["completed", "failed"].includes(status)) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(status, "completed");
  const url = `/api/profiles/${f.p}/media/${f.item.id}/assets/thumbnail`;
  const asset = await f.app.inject({ url, headers: f.oh });
  assert.equal(asset.statusCode, 200, asset.body);
  assert.equal(asset.headers["content-type"], "image/jpeg");
  assert.ok(asset.rawPayload.length > 0);
  const head = await f.app.inject({ method: "HEAD", url, headers: f.oh });
  assert.equal(head.statusCode, 200);
  assert.ok(Number(head.headers["content-length"]) > 0);
  assert.equal(head.body, "");
  f.store.db.prepare("DELETE FROM source_grants WHERE profile_id=?").run(f.p);
  assert.equal((await f.app.inject({ url, headers: f.oh })).statusCode, 404);
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: `/api/generation/jobs/${jobId}/cancel`,
        headers: f.ah,
      })
    ).statusCode,
    204,
  );
});

test("playback HTTP controls address one session and return live on a new join", async (t) => {
  const f = await fixture(t),
    ch = channel(f.store, f.owner),
    now = Date.now();
  const publish = await f.app.inject({
    method: "POST",
    url: `/api/channels/${ch.id}/schedule`,
    headers: f.oh,
    payload: {
      profileId: f.p,
      startMs: now - 1000,
      untilMs: now + 10000,
      groups: [{ id: "g", mode: "ordered", mediaIds: [f.item.id] }],
      rules: noBreaks,
    },
  });
  assert.equal(publish.statusCode, 201);
  const join = () =>
    f.app.inject({
      method: "POST",
      url: "/api/playback/sessions",
      headers: f.oh,
      payload: { profileId: f.p, channelId: ch.id },
    });
  const first = await join(),
    second = await join();
  assert.equal(first.statusCode, 201);
  const a = first.json().id,
    b = second.json().id;
  const pause = await f.app.inject({
    method: "POST",
    url: `/api/playback/sessions/${a}/pause`,
    headers: f.oh,
  });
  assert.equal(pause.json().paused, true);
  assert.equal(
    (
      await f.app.inject({ url: `/api/playback/sessions/${b}`, headers: f.oh })
    ).json().paused,
    false,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: `/api/playback/sessions/${a}/resume`,
        headers: f.oh,
      })
    ).json().paused,
    false,
  );
  const live = await f.app.inject({
    method: "POST",
    url: `/api/playback/sessions/${a}/goLive`,
    headers: f.oh,
  });
  assert.equal(live.json().behindLiveMs, 0);
  assert.equal(
    (
      await f.app.inject({
        method: "DELETE",
        url: `/api/playback/sessions/${a}`,
        headers: f.oh,
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (await f.app.inject({ url: `/api/playback/sessions/${a}`, headers: f.oh }))
      .statusCode,
    404,
  );
});

test("public account/profile contracts and programming schemas match live API responses", async (t) => {
  const f = await fixture(t);
  accountResponseSchema.parse(
    (await f.app.inject({ url: "/api/auth/me", headers: f.oh })).json(),
  );
  const profiles = (
    await f.app.inject({ url: "/api/profiles", headers: f.oh })
  ).json();
  profiles.forEach((p: unknown) => profileResponseSchema.parse(p));
  const contract = (
    await f.app.inject({ url: "/api/contracts", headers: f.oh })
  ).json();
  assert.equal(contract.version, 1);
  assert.ok(contract.schemas.programming);
  assert.ok(contract.schemas.playback);
  assert.ok(contract.schemas.media);
});

test("HTTP journey selects library content, manages collections, publishes programming, subscribes, and records playback", async (t) => {
  const f = await fixture(t),
    headers = f.oh;
  const library = await f.app.inject({
    url: `/api/profiles/${f.p}/library`,
    headers,
  });
  assert.equal(library.statusCode, 200);
  assert.equal(library.json().sources[0].id, f.src.id);
  const selection = {
    type: "folder",
    sourceId: f.src.id,
    directory: "",
    recursive: true,
  };
  const selected = await f.app.inject({
    method: "POST",
    url: `/api/profiles/${f.p}/selection`,
    headers,
    payload: selection,
  });
  assert.equal(selected.json().items[0].id, f.item.id);
  const saved = await f.app.inject({
    method: "POST",
    url: `/api/profiles/${f.p}/collections`,
    headers,
    payload: { name: "Favorites", mediaIds: [f.item.id] },
  });
  assert.equal(saved.statusCode, 201);
  const collectionId = saved.json().id;
  assert.equal(
    (
      await f.app.inject({
        method: "PUT",
        url: `/api/profiles/${f.p}/collections/${collectionId}`,
        headers,
        payload: { name: "Updated", mediaIds: [f.item.id] },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await f.app.inject({ url: `/api/profiles/${f.p}/collections`, headers })
    ).json().items[0].count,
    1,
  );
  const create = await f.app.inject({
    method: "POST",
    url: "/api/channels",
    headers,
    payload: {
      profileId: f.p,
      name: "Private rotation",
      visibility: "private",
    },
  });
  assert.equal(create.statusCode, 201);
  const channelId = create.json().id,
    config = {
      profileId: f.p,
      groups: [{ id: "folder", mode: "ordered", selection }],
      rules: noBreaks,
      seed: 42,
    };
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: `/api/channels/${channelId}/programming/preview?horizonMs=3000`,
        headers,
        payload: config,
      })
    ).statusCode,
    200,
  );
  const published = await f.app.inject({
    method: "PUT",
    url: `/api/channels/${channelId}/programming?horizonMs=3000`,
    headers,
    payload: config,
  });
  assert.equal(published.statusCode, 200);
  assert.equal(
    (
      await f.app.inject({
        url: `/api/channels/${channelId}/programming`,
        headers,
      })
    ).json().config.groups.length,
    1,
  );
  assert.equal(
    (
      await f.app.inject({
        url: `/api/channels/${channelId}/programming`,
        headers: f.xh,
      })
    ).statusCode,
    404,
  );
  assert.ok(
    (await f.app.inject({ url: "/api/admin/channels", headers: f.ah }))
      .json()
      .items.some((c: { id: string }) => c.id === channelId),
  );
  assert.equal(
    (
      await f.app.inject({
        method: "PUT",
        url: `/api/profiles/${f.p}/subscriptions/${channelId}`,
        headers,
      })
    ).statusCode,
    204,
  );
  const now = Date.now(),
    guide = await f.app.inject({
      url: `/api/profiles/${f.p}/guide?startMs=${now}&endMs=${now + 3000}`,
      headers,
    });
  assert.equal(guide.statusCode, 200);
  assert.equal(guide.json().channels[0].id, channelId);
  assert.ok(guide.json().channels[0].entries.length > 0);
  const joined = await f.app.inject({
    method: "POST",
    url: "/api/playback/sessions",
    headers,
    payload: { profileId: f.p, channelId },
  });
  assert.equal(joined.statusCode, 201);
  const session = joined.json(),
    entry = session.playback.entry;
  assert.equal(
    (
      await f.app.inject({
        url: `/api/playback/sessions/${session.id}/hls/index.m3u8`,
        headers,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await f.app.inject({
        url: `/api/playback/sessions/${session.id}/hls/index.m3u8`,
        headers: f.xh,
      })
    ).statusCode,
    404,
  );
  const event = {
    id: crypto.randomUUID(),
    entryId: entry.id,
    startMs: entry.startMs,
    endMs: entry.startMs + 1,
  };
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: `/api/playback/sessions/${session.id}/events`,
        headers,
        payload: event,
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (
      await f.app.inject({
        url: `/api/playback/sessions/${session.id}/history`,
        headers,
      })
    ).json().deliveredMs,
    1,
  );
  const statistics = (
    await f.app.inject({
      url: `/api/profiles/${f.p}/channels/${channelId}/statistics`,
      headers,
    })
  ).json();
  assert.ok(statistics.scheduled.length > 0);
  assert.equal(statistics.deliveredForCurrentAccount[0].deliveredMs, 1);
  assert.equal(
    (
      await f.app.inject({
        method: "DELETE",
        url: `/api/profiles/${f.p}/subscriptions/${channelId}`,
        headers,
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (
      await f.app.inject({
        url: `/api/playback/sessions/${session.id}`,
        headers,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "DELETE",
        url: `/api/profiles/${f.p}/collections/${collectionId}`,
        headers,
      })
    ).statusCode,
    204,
  );
});

test("HTTP admin lifecycle manages profiles, grants, account roles/passwords, and session revocation", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.app.inject({ url: "/api/accounts", headers: f.ah })).statusCode,
    200,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "PATCH",
        url: `/api/profiles/${f.p}`,
        headers: f.ah,
        payload: { name: "Renamed" },
      })
    ).statusCode,
    204,
  );
  assert.ok(
    (
      await f.app.inject({
        url: `/api/profiles/${f.p}/settings`,
        headers: f.ah,
      })
    ).json().grants.length,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "DELETE",
        url: `/api/profiles/${f.p}/accounts/${f.other.id}`,
        headers: f.ah,
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "DELETE",
        url: `/api/profiles/${f.p}/grants`,
        headers: f.ah,
        payload: { sourceId: f.src.id, subtree: "" },
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (
      await f.app.inject({ url: `/api/profiles/${f.p}/media`, headers: f.oh })
    ).json().total,
    0,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "PATCH",
        url: `/api/accounts/${f.other.id}`,
        headers: f.ah,
        payload: { role: "viewer" },
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (await f.app.inject({ url: "/api/auth/me", headers: f.xh })).statusCode,
    401,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "PUT",
        url: `/api/accounts/${f.other.id}/password`,
        headers: f.ah,
        payload: { password: "changed-password" },
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "DELETE",
        url: `/api/accounts/${f.other.id}/sessions`,
        headers: f.ah,
      })
    ).statusCode,
    204,
  );
  const sessions = await f.app.inject({
    url: "/api/auth/sessions",
    headers: f.oh,
  });
  assert.ok(sessions.json().length > 0);
  assert.equal(
    (
      await f.app.inject({
        method: "DELETE",
        url: `/api/auth/sessions/${sessions.json()[0].id}`,
        headers: f.oh,
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (await f.app.inject({ url: "/api/auth/me", headers: f.oh })).statusCode,
    401,
  );
});

test("channel rename/privacy/archive lifecycle keeps IDs stable, hides archived channels, and is owner/admin only", async (t) => {
  const f = await fixture(t),
    ch = channel(f.store, f.owner);
  assert.equal(
    (
      await f.app.inject({
        method: "PATCH",
        url: `/api/channels/${ch.id}`,
        headers: f.xh,
        payload: { name: "Other" },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "PATCH",
        url: `/api/channels/${ch.id}`,
        headers: f.oh,
        payload: { name: "Renamed", visibility: "shared" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "PATCH",
        url: `/api/channels/${ch.id}`,
        headers: f.oh,
        payload: { name: "Renamed" },
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (
      await f.app.inject({
        url: `/api/profiles/${f.p}/channels`,
        headers: f.oh,
      })
    )
      .json()
      .find((c: { id: string }) => c.id === ch.id).name,
    "Renamed",
  );
  assert.equal(
    (
      await f.app.inject({
        method: "DELETE",
        url: `/api/channels/${ch.id}`,
        headers: f.oh,
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (
      await f.app.inject({
        url: `/api/profiles/${f.p}/channels`,
        headers: f.oh,
      })
    )
      .json()
      .some((c: { id: string }) => c.id === ch.id),
    false,
  );
  assert.equal(
    (await f.app.inject({ url: "/api/admin/channels", headers: f.ah }))
      .json()
      .items.find((c: { id: string }) => c.id === ch.id).archived,
    true,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "PATCH",
        url: `/api/channels/${ch.id}`,
        headers: f.oh,
        payload: { archived: false },
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (
      await f.app.inject({
        url: `/api/profiles/${f.p}/channels`,
        headers: f.oh,
      })
    ).json()[0].id,
    ch.id,
  );
});

test("saved integration refresh and artwork work over HTTP without returning upstream keys or image URLs", async (t) => {
  const f = await fixture(t);
  f.store.db
    .prepare("UPDATE sources SET kind='shows' WHERE id=?")
    .run(f.src.id);
  const upstream = createHttpServer((request, response) => {
    assert.equal(request.headers["x-api-key"], "fixture-key");
    if (request.url?.startsWith("/MediaCover/")) {
      response.setHeader("content-type", "image/jpeg");
      response.end(Buffer.from([255, 216, 255]));
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify(
        request.url?.startsWith("/api/v3/series")
          ? [
              {
                id: 1,
                title: "Saved show",
                images: [
                  { coverType: "poster", url: "/MediaCover/1/poster.jpg" },
                ],
              },
            ]
          : request.url?.startsWith("/api/v3/episodefile")
            ? [{ id: 7, path: "/tv/source.mp4" }]
            : [
                {
                  id: 1,
                  episodeFileId: 7,
                  seasonNumber: 1,
                  episodeNumber: 1,
                  title: "One",
                },
              ],
      ),
    );
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  t.after(
    () => new Promise<void>((resolve) => upstream.close(() => resolve())),
  );
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const body = {
    provider: "sonarr",
    url: `http://127.0.0.1:${address.port}`,
    apiKey: "fixture-key",
    mappings: [{ from: "/tv", to: f.src.root_path }],
  };
  assert.equal(
    (
      await f.app.inject({
        method: "PUT",
        url: `/api/sources/${f.src.id}/integration`,
        headers: f.ah,
        payload: body,
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "PUT",
        url: `/api/sources/${f.src.id}/refresh`,
        headers: f.ah,
        payload: { intervalMs: 60000 },
      })
    ).statusCode,
    204,
  );
  const refreshed = await f.app.inject({
    method: "POST",
    url: `/api/sources/${f.src.id}/scan`,
    headers: f.ah,
  });
  assert.equal(refreshed.statusCode, 200);
  assert.equal(refreshed.json().imported.matched, 1);
  const catalog = await f.app.inject({
    url: `/api/profiles/${f.p}/media`,
    headers: f.oh,
  });
  assert.doesNotMatch(catalog.body, /fixture-key|127\.0\.0\.1/);
  assert.match(catalog.json().items[0].metadata.images[0].url, /\/artwork\/0$/);
  const image = await f.app.inject({
    url: `/api/profiles/${f.p}/media/${f.item.id}/artwork/0`,
    headers: f.oh,
  });
  assert.equal(image.statusCode, 200);
  assert.deepEqual(image.rawPayload, Buffer.from([255, 216, 255]));
  const status = await f.app.inject({
    url: "/api/admin/refresh",
    headers: f.ah,
  });
  assert.equal(status.statusCode, 200);
  assert.doesNotMatch(status.body, /fixture-key|encryptedKey/);
  assert.equal(
    (
      await f.app.inject({
        method: "DELETE",
        url: `/api/sources/${f.src.id}/integration`,
        headers: f.ah,
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "PUT",
        url: `/api/sources/${f.src.id}/refresh`,
        headers: f.ah,
        payload: { intervalMs: null },
      })
    ).statusCode,
    204,
  );
});

test("single-media details honor profile grants and omit filesystem fingerprints", async (t) => {
  const f = await fixture(t);
  const own = await f.app.inject({
    url: `/api/profiles/${f.p}/media/${f.item.id}`,
    headers: f.oh,
  });
  assert.equal(own.statusCode, 200);
  assert.equal(own.json().id, f.item.id);
  assert.ok(own.json().metadata);
  assert.equal(own.json().size, undefined);
  assert.equal(own.json().mtimeMs, undefined);
  assert.equal(
    (
      await f.app.inject({
        url: `/api/profiles/${f.p}/media/${f.item.id}`,
        headers: f.xh,
      })
    ).statusCode,
    404,
  );
  f.store.db.prepare("DELETE FROM source_grants WHERE profile_id=?").run(f.p);
  assert.equal(
    (
      await f.app.inject({
        url: `/api/profiles/${f.p}/media/${f.item.id}`,
        headers: f.oh,
      })
    ).statusCode,
    404,
  );
});

test("channel short names derive on setup/rename and preserve explicit owner overrides", async (t) => {
  const f = await fixture(t);
  const response = await f.app.inject({
    method: "POST",
    url: "/api/channels",
    headers: f.oh,
    payload: { profileId: f.p, name: "After School", visibility: "private" },
  });
  assert.equal(response.statusCode, 201);
  const c = response.json();
  assert.equal(c.shortName, "AS");
  assert.equal(c.shortNameOverride, null);
  const patch = async (payload: Record<string, unknown>, headers = f.oh) =>
    f.app.inject({
      method: "PATCH",
      url: `/api/channels/${c.id}`,
      headers,
      payload,
    });
  await patch({ name: "Weekend Movies" });
  let rows = (
    await f.app.inject({ url: `/api/profiles/${f.p}/channels`, headers: f.oh })
  ).json();
  assert.equal(rows.find((r: { id: string }) => r.id === c.id).shortName, "WM");
  await patch({ shortName: "Retro" });
  await patch({ name: "New Channel Name" });
  rows = (
    await f.app.inject({ url: `/api/profiles/${f.p}/channels`, headers: f.oh })
  ).json();
  assert.equal(
    rows.find((r: { id: string }) => r.id === c.id).shortName,
    "Retro",
  );
  assert.equal((await patch({ shortName: "Not yours" }, f.xh)).statusCode, 404);
  assert.equal(
    (await patch({ shortName: "way too long a label" })).statusCode,
    400,
  );
  await patch({ shortName: null });
  rows = (
    await f.app.inject({ url: `/api/profiles/${f.p}/channels`, headers: f.oh })
  ).json();
  assert.equal(
    rows.find((r: { id: string }) => r.id === c.id).shortName,
    "NCN",
  );
});

test("saved integration settings return editable mappings only to admins without exposing keys", async (t) => {
  const f = await fixture(t);
  f.store.db
    .prepare("UPDATE sources SET kind='shows' WHERE id=?")
    .run(f.src.id);
  const url = `/api/sources/${f.src.id}/integration`,
    payload = {
      provider: "sonarr",
      url: "http://127.0.0.1:8989",
      apiKey: "synthetic-private-key",
      mappings: [{ from: "/tv", to: f.src.root_path }],
    };
  assert.equal(
    (await f.app.inject({ method: "PUT", url, headers: f.ah, payload }))
      .statusCode,
    204,
  );
  const settings = await f.app.inject({ url, headers: f.ah });
  assert.equal(settings.statusCode, 200);
  assert.deepEqual(settings.json().mappings, payload.mappings);
  assert.doesNotMatch(settings.body, /synthetic-private-key|encrypted|apiKey/);
  assert.equal((await f.app.inject({ url, headers: f.oh })).statusCode, 403);
});

test("metadata HTTP contracts enforce roles, revisions, independent display fields and protected roots", async (t) => {
  const f = await fixture(t),
    url = `/api/profiles/${f.p}/metadata`,
    target = { kind: "media", mediaId: f.item.id };
  const inspect = () =>
    f.app.inject({
      method: "POST",
      url: `${url}/inspect`,
      headers: f.ah,
      payload: { target },
    });
  for (const headers of [f.oh, f.vh])
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `${url}/inspect`,
          headers,
          payload: { target },
        })
      ).statusCode,
      403,
    );
  const info = (await inspect()).json();
  const payload = {
    target,
    revision: info.revision,
    choices: {
      title: { source: "manual", manual: "Custom display" },
      description: { source: "manual", manual: "" },
    },
  };
  const save = await f.app.inject({
    method: "POST",
    url: `${url}/save`,
    headers: f.ah,
    payload,
  });
  assert.equal(save.statusCode, 200, save.body);
  assert.equal(save.json().effective.title.value, "Custom display");
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: `${url}/save`,
        headers: f.ah,
        payload,
      })
    ).statusCode,
    409,
  );
  const media = await f.app.inject({
    url: `/api/profiles/${f.p}/media`,
    headers: f.oh,
  });
  assert.equal(media.json().items[0].title, "Custom display");
  assert.equal(media.json().items[0].metadata.overview, "");
  assert.equal(
    f.store.db.prepare("SELECT title FROM media WHERE id=?").get(f.item.id)!
      .title,
    f.item.title,
  );
  const root = join(f.root, "data");
  await mkdir(root, { recursive: true });
  assert.equal(
    (
      await f.app.inject({
        method: "PUT",
        url: `/api/sources/${f.src.id}/metadata-location`,
        headers: f.ah,
        payload: { root },
      })
    ).statusCode,
    409,
  );
});

test("channel description conflicts keep identity, subscriptions and schedule unchanged", async (t) => {
  const f = await fixture(t),
    ch = channel(f.store, f.owner);
  f.store.db
    .prepare("INSERT INTO subscriptions(profile_id,channel_id) VALUES(?,?)")
    .run(f.p, ch.id);
  const patch = (description: string) =>
    f.app.inject({
      method: "PATCH",
      url: `/api/channels/${ch.id}`,
      headers: f.oh,
      payload: { description, expectedDetailsRevision: 0 },
    });
  const changed = await patch("A channel description");
  assert.equal(changed.statusCode, 204, changed.body);
  assert.equal((await patch("Stale draft")).statusCode, 409);
  assert.equal(
    f.store.db
      .prepare("SELECT description FROM channels WHERE id=?")
      .get(ch.id)!.description,
    "A channel description",
  );
  assert.equal(
    f.store.db
      .prepare("SELECT count(*) n FROM subscriptions WHERE channel_id=?")
      .get(ch.id)!.n,
    1,
  );
  assert.equal(
    (
      await f.app.inject({
        url: `/api/profiles/${f.op}/channels`,
        headers: f.xh,
      })
    )
      .json()
      .some((c: { id: string }) => c.id === ch.id),
    false,
  );
});

test("source-grant removal normalizes the same subtree spellings as creation", async (t) => {
  const f = await fixture(t);
  f.store.db.prepare("DELETE FROM source_grants WHERE profile_id=?").run(f.p);
  f.store.db
    .prepare(
      "INSERT INTO source_grants(profile_id,source_id,subtree) VALUES(?,?,?)",
    )
    .run(f.p, f.src.id, "kids");
  const response = await f.app.inject({
    method: "DELETE",
    url: `/api/profiles/${f.p}/grants`,
    headers: f.ah,
    payload: { sourceId: f.src.id, subtree: "kids/./" },
  });
  assert.equal(response.statusCode, 204);
  assert.equal(
    f.store.db
      .prepare("SELECT COUNT(*) AS n FROM source_grants WHERE profile_id=?")
      .get(f.p)?.n,
    0,
  );
  const invalid = await f.app.inject({
    method: "DELETE",
    url: `/api/profiles/${f.p}/grants`,
    headers: f.ah,
    payload: { sourceId: f.src.id, subtree: "../escape" },
  });
  assert.equal(invalid.statusCode, 400);
});

for (const kind of ["original", "generated"] as const)
  for (const method of ["GET", "HEAD"] as const)
    test(`${kind} ${method} reauthorizes after asynchronous file inspection before sending headers`, async (t) => {
      const f = await fixture(t);
      const { open } = await import("node:fs/promises");
      const { assetFingerprint } = await import("../src/generation.js");
      await mkdir(join(f.root, "generated"), { recursive: true });
      await writeFile(
        join(f.root, "generated", "sample.jpg"),
        "generated-synthetic-bytes",
      );
      f.store.db
        .prepare(
          "INSERT INTO generated_assets(id,media_id,kind,fingerprint,relative_path) VALUES(?,?,?,?,?)",
        )
        .run(
          crypto.randomUUID(),
          f.item.id,
          "thumbnail",
          assetFingerprint(f.item, "thumbnail"),
          "sample.jpg",
        );
      const sample = await open(join(f.root, "media", "source.mp4"), "r");
      const prototype = Object.getPrototypeOf(sample),
        original = prototype.stat;
      await sample.close();
      let inspected = false;
      t.mock.method(
        prototype,
        "stat",
        async function (this: unknown, ...args: unknown[]) {
          const info = await original.apply(this, args);
          inspected = true;
          f.store.db
            .prepare("DELETE FROM source_grants WHERE profile_id=?")
            .run(f.p);
          return info;
        },
      );
      const response = await f.app.inject({
        method,
        url: `/api/profiles/${f.p}/media/${f.item.id}/${kind === "original" ? "file" : "assets/thumbnail"}`,
        headers: f.oh,
      });
      assert.ok(inspected);
      assert.equal(response.statusCode, 404);
      assert.equal(response.headers["accept-ranges"], undefined);
      assert.ok(!response.body.includes("0123456789"));
      assert.ok(!response.body.includes("generated-synthetic-bytes"));
    });

test("library inspection includes retained unavailable files only when explicitly requested, without changing playable selection", async (t) => {
  const f = await fixture(t);
  f.store.db.prepare("UPDATE media SET available=0 WHERE id=?").run(f.item.id);
  const input = {
    type: "folder",
    sourceId: f.src.id,
    directory: "",
    recursive: true,
  };
  const inspect = await f.app.inject({
    method: "POST",
    url: `/api/profiles/${f.p}/selection?includeUnavailable=true`,
    headers: f.oh,
    payload: input,
  });
  assert.equal(inspect.statusCode, 200);
  assert.equal(inspect.json().items[0].id, f.item.id);
  assert.equal(inspect.json().items[0].available, false);
  const playable = await f.app.inject({
    method: "POST",
    url: `/api/profiles/${f.p}/selection`,
    headers: f.oh,
    payload: input,
  });
  assert.deepEqual(playable.json().items, []);
  f.store.db.prepare("DELETE FROM source_grants WHERE profile_id=?").run(f.p);
  const denied = await f.app.inject({
    method: "POST",
    url: `/api/profiles/${f.p}/selection?includeUnavailable=true`,
    headers: f.oh,
    payload: input,
  });
  assert.deepEqual(denied.json().items, []);
});
