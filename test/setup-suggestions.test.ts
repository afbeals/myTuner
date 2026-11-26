import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../src/database.js";
import { RefreshService } from "../src/refresh.js";
import { createServer } from "../src/server.js";
import { digest } from "../src/security.js";
import { observedRoots, readProviderInventory } from "../src/integrations.js";
import {
  PathSuggestions,
  ProviderSuggestions,
  parseMounts,
  previewMappings,
  validateMappings,
} from "../src/setup-suggestions.js";
import { account, source, media } from "./helpers.js";

const mountinfo = [
  "20 1 0:20 / / rw,relatime - overlay overlay rw",
  "21 20 8:1 /data /media rw,nosuid shared:4 - xfs /dev/md1 rw",
  "22 20 8:1 /data /media/My\\040Shows ro,relatime - xfs /dev/md1 rw",
  "23 20 8:1 /data /app/data rw - xfs /dev/md1 rw",
  "24 20 0:20 /hosts /etc/hosts ro - tmpfs tmpfs rw",
  "25 20 0:21 / /sys rw - sysfs sysfs rw",
  "26 20 8:1 /data /generated rw - xfs /dev/md1 rw",
  "27 20 8:1 /other /captions ro - xfs /dev/md1 rw",
  "28 20 8:1 /other /library ro - xfs /dev/md1 rw",
].join("\n");
test("mount suggestions decode process targets, exclude system/storage/other sources, cache without inspecting missing media, and retain platform fallback", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  assert.deepEqual(
    parseMounts(mountinfo).map((entry) => [
      entry.path,
      entry.access,
      entry.type,
    ]),
    [
      ["/captions", "read-only", "not-checked"],
      ["/generated", "read-write", "not-checked"],
      ["/library", "read-only", "not-checked"],
      ["/media", "read-write", "not-checked"],
      ["/media/My Shows", "read-only", "not-checked"],
    ],
  );
  const src = source(store, "/library");
  let reads = 0;
  const choices = new PathSuggestions(
    store,
    ["/app/data", "/generated", "/cache"],
    "linux",
    async () => {
      reads++;
      return mountinfo;
    },
  );
  assert.deepEqual(
    (await choices.read("source")).items.map((entry) => entry.path),
    ["/captions", "/media", "/media/My Shows"],
  );
  assert.ok(
    (await choices.read("source", src.id)).items.some(
      (entry) => entry.path === "/library",
    ),
  );
  assert.equal(reads, 1);
  assert.equal(
    (
      await new PathSuggestions(store, [], "darwin", async () => {
        throw Error("must not read");
      }).read("source")
    ).supported,
    false,
  );
  const failed = await new PathSuggestions(store, [], "linux", async () => {
    throw Error("restricted");
  }).read("source");
  assert.equal(failed.items.length, 0);
  assert.match(failed.error!, /manually/);
  assert.throws(() => parseMounts("x".repeat(2 * 1024 * 1024 + 1)), /limit/);
});
test("lightweight provider suggestions preserve roots of undownloaded items and request only inventory under the full base path", async () => {
  const paths: string[] = [];
  const inventory = await readProviderInventory(
    "sonarr",
    "http://sonarr:8989/base/",
    "private-key",
    async (input, init) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      assert.equal(
        (init?.headers as Record<string, string>)["X-Api-Key"],
        "private-key",
      );
      assert.equal(init?.redirect, "error");
      return new Response(
        JSON.stringify([
          {
            id: 1,
            title: "Missing",
            path: "/tv/Empty Show",
            rootFolderPath: "/tv",
          },
          {
            id: 2,
            title: "Other",
            path: "/anime/Other",
            rootFolderPath: "/anime",
          },
          { id: 3, title: "No field", rootFolderPath: null },
          { id: 4, title: "Bad path", rootFolderPath: "/tv/../secret" },
        ]),
      );
    },
  );
  assert.deepEqual(paths, ["/base/api/v3/series"]);
  assert.deepEqual(
    observedRoots(inventory).map((root) => [
      root.path,
      root.itemCount,
      root.origin,
    ]),
    [
      ["/anime", 1, "provider-inventory"],
      ["/tv", 1, "provider-inventory"],
    ],
  );
});
test("provider inventories and metadata requests share one credential-scoped flight and keep source mappings independent", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const calls: string[] = [];
  const cache = new ProviderSuggestions(
    store,
    Buffer.alloc(32, 4),
    async (input, init) => {
      calls.push(
        new URL(String(input)).pathname +
          ":" +
          (init?.headers as Record<string, string>)["X-Api-Key"],
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response(
        JSON.stringify([
          {
            id: 1,
            title: "Film",
            path: "/movies/Film",
            rootFolderPath: "/movies",
            hasFile: true,
            movieFile: { path: "/movies/Film/file.mkv" },
          },
          {
            id: 2,
            title: "Undownloaded",
            path: "/missing/Film",
            rootFolderPath: "/missing",
            hasFile: false,
          },
        ]),
      );
    },
  );
  const connection = {
    provider: "radarr" as const,
    url: "http://radarr/base/",
    apiKey: "one",
  };
  const [a, b] = await Promise.all([
    cache.items(connection),
    cache.items({ ...connection, url: "http://radarr/base" }),
  ]);
  assert.equal(calls.length, 1);
  assert.equal(a, b);
  assert.equal(a.length, 1);
  assert.deepEqual(
    cache.snapshot(connection).roots.map((root) => root.path),
    ["/missing", "/movies"],
  );
  const src = source(store, "/nonexistent-a", "movies"),
    other = source(store, "/nonexistent-b", "movies");
  media(store, src.id, "Film/file.mkv");
  assert.equal(
    previewMappings(
      store,
      src,
      [{ from: "/movies", to: src.root_path }],
      [a[0]!.path],
    )[0]!.state,
    "matched",
  );
  assert.equal(
    previewMappings(
      store,
      other,
      [{ from: "/movies", to: other.root_path }],
      [a[0]!.path],
    )[0]!.state,
    "not-cataloged",
  );
  await cache.items({ ...connection, apiKey: "two" });
  await cache.items({ ...connection, url: "http://radarr/other" });
  assert.equal(calls.length, 3);
  const serialized = JSON.stringify(cache.snapshot(connection));
  assert.doesNotMatch(serialized, /connection_key|apiKey|X-Api-Key/);
});
test("persisted root suggestions retain last success across restart/failure and back off without leaking provider errors", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const key = Buffer.alloc(32, 7),
    connection = {
      provider: "sonarr" as const,
      url: "http://sonarr",
      apiKey: "private-secret",
    };
  const first = new ProviderSuggestions(
    store,
    key,
    async () =>
      new Response(
        JSON.stringify([{ id: 1, title: "Show", rootFolderPath: "/tv" }]),
      ),
  );
  const success = await first.refresh(connection);
  let calls = 0;
  const restarted = new ProviderSuggestions(store, key, async () => {
    calls++;
    throw Error("private-secret destination debug");
  });
  assert.equal(calls, 0);
  assert.equal(restarted.snapshot(connection).observedAt, success.observedAt);
  const failed = await restarted.refresh(connection);
  assert.deepEqual(failed.roots, success.roots);
  assert.equal(failed.stale, true);
  assert.ok(failed.error);
  assert.doesNotMatch(failed.error!, /private-secret|debug/);
  await restarted.refresh(connection);
  assert.equal(calls, 1);
});
test("provider refresh rejects changed destinations without keys and refuses late results after a saved configuration changes", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const src = source(store, "/not-mounted", "shows");
  let resolveRead!: () => void, started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    resolveRead = resolve;
  });
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  let calls = 0;
  const refresh = new RefreshService(store, Buffer.alloc(32, 1), async () => {
    calls++;
    started();
    await waiting;
    return new Response(
      JSON.stringify([{ id: 1, title: "Show", rootFolderPath: "/tv" }]),
    );
  });
  const config = {
    provider: "sonarr" as const,
    url: "http://sonarr",
    apiKey: "saved",
    mappings: [{ from: "/tv", to: src.root_path }],
  };
  refresh.configure(src.id, config);
  const before = refresh.suggestions(src.id);
  assert.equal(calls, 0);
  await assert.rejects(
    refresh.refreshSuggestions(
      src.id,
      { provider: "sonarr", url: "http://new" },
      before.configRevision,
      () => {},
    ),
    /API key/,
  );
  assert.equal(calls, 0);
  const pending = refresh.refreshSuggestions(
    src.id,
    { provider: "sonarr", url: "http://sonarr" },
    before.configRevision,
    () => {},
  );
  await reading;
  refresh.configure(src.id, { ...config, apiKey: "replacement" });
  resolveRead();
  await assert.rejects(pending, /changed/);
  assert.deepEqual(refresh.suggestions(src.id).roots, []);
  await refresh.stop();
});
test("mapping validation rejects traversal/duplicate prefixes and preview is bounded to catalog rows", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const src = source(store, "/never-open-this-source");
  media(store, src.id, "Show/a.mkv");
  for (const mappings of [
    [{ from: "/tv/../secret", to: "/media" }],
    [{ from: "/tv", to: "relative" }],
    [
      { from: "C:\\TV", to: "/media" },
      { from: "c:/tv/", to: "/other" },
    ],
  ])
    assert.throws(() => validateMappings(mappings));
  const result = previewMappings(
    store,
    src,
    [{ from: "/tv", to: src.root_path }],
    Array(30).fill("/tv/Show/a.mkv"),
  );
  assert.equal(result.length, 20);
  assert.ok(result.every((row) => row.state === "matched"));
});
test("setup HTTP reads enforce admin scope, retain cached-only behavior and never disclose keys", async (t) => {
  const store = new Store(":memory:"),
    admin = account(store, "admin"),
    src = source(store, "/synthetic-not-mounted", "shows");
  const app = createServer(store, { integrationKey: Buffer.alloc(32, 2) });
  t.after(async () => {
    await app.close();
    store.close();
  });
  const token = randomUUID();
  store.db
    .prepare(
      "INSERT INTO sessions(token_hash,account_id,expires_at) VALUES(?,?,?)",
    )
    .run(digest(token), admin.id, Date.now() + 60_000);
  const headers = { authorization: `Bearer ${token}` },
    url = `/api/sources/${src.id}/provider-suggestions`;
  assert.equal((await app.inject({ url })).statusCode, 401);
  const initial = await app.inject({ url, headers });
  assert.equal(initial.statusCode, 200, initial.body);
  assert.deepEqual(initial.json().roots, []);
  assert.equal(initial.json().sourceRevision.length, 64);
  const saved = await app.inject({
    method: "PUT",
    url: `/api/sources/${src.id}/integration`,
    headers,
    payload: {
      provider: "sonarr",
      url: "http://127.0.0.1:1",
      apiKey: "should-stay-private",
      mappings: [{ from: "/tv", to: src.root_path }],
    },
  });
  assert.equal(saved.statusCode, 204, saved.body);
  const cached = await app.inject({ url, headers });
  assert.equal(cached.statusCode, 200, cached.body);
  assert.doesNotMatch(cached.body, /should-stay-private|encrypted_key/);
  store.db
    .prepare("UPDATE accounts SET role='viewer' WHERE id=?")
    .run(admin.id);
  assert.equal((await app.inject({ url, headers })).statusCode, 403);
  assert.equal(
    (await app.inject({ url: "/api/admin/setup/path-suggestions", headers }))
      .statusCode,
    403,
  );
});

test("saved connections reuse credentials only for an explicit matching destination and provider; typed keys win", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const first = source(store, "/synthetic-a", "shows"),
    second = source(store, "/synthetic-b", "shows"),
    movies = source(store, "/synthetic-c", "movies");
  const refresh = new RefreshService(store, Buffer.alloc(32, 8));
  const mapping = [{ from: "/tv", to: second.root_path }];
  refresh.configure(first.id, {
    provider: "sonarr",
    url: "http://provider/base/",
    apiKey: "retained-server-key",
    mappings: [{ from: "/tv", to: first.root_path }],
  });
  refresh.configure(movies.id, {
    provider: "radarr",
    url: "http://radarr",
    apiKey: "other-key",
    mappings: [{ from: "/movies", to: movies.root_path }],
  });
  refresh.configure(second.id, {
    provider: "sonarr",
    url: "http://provider/base",
    reuseSourceId: first.id,
    mappings: mapping,
  });
  const encrypted = (id: string) =>
    store.db
      .prepare("SELECT encrypted_key FROM integrations WHERE source_id=?")
      .get(id)!.encrypted_key;
  assert.equal(encrypted(first.id), encrypted(second.id));
  for (const draft of [
    {
      provider: "sonarr" as const,
      url: "http://other/base",
      reuseSourceId: first.id,
    },
    {
      provider: "sonarr" as const,
      url: "http://provider/base",
      reuseSourceId: movies.id,
    },
    {
      provider: "sonarr" as const,
      url: "http://provider/base",
      reuseSourceId: randomUUID(),
    },
  ])
    assert.throws(
      () => refresh.configure(second.id, { ...draft, mappings: mapping }),
      /Saved connection/,
    );
  store.db.prepare("DELETE FROM integrations WHERE source_id=?").run(first.id);
  assert.throws(
    () =>
      refresh.configure(second.id, {
        provider: "sonarr",
        url: "http://provider/base",
        reuseSourceId: first.id,
        mappings: mapping,
      }),
    /Saved connection/,
  );
  refresh.configure(second.id, {
    provider: "sonarr",
    url: "http://other/base",
    apiKey: "explicit-new-key",
    reuseSourceId: first.id,
    mappings: mapping,
  });
  assert.ok(encrypted(second.id));
  await refresh.stop();
});

test("late provider suggestions cannot return after the selected saved connection changes or admin authority is revoked", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const first = source(store, "/synthetic-reference", "shows"),
    target = source(store, "/synthetic-target", "shows");
  let resolveRead!: () => void, started!: () => void;
  let waiting = new Promise<void>((resolve) => {
    resolveRead = resolve;
  });
  let reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  const refresh = new RefreshService(store, Buffer.alloc(32, 3), async () => {
    started();
    await waiting;
    return new Response(
      JSON.stringify([{ id: 1, title: "Show", rootFolderPath: "/tv" }]),
    );
  });
  const config = {
    provider: "sonarr" as const,
    url: "http://provider/base",
    apiKey: "server-only",
    mappings: [{ from: "/tv", to: first.root_path }],
  };
  refresh.configure(first.id, config);
  const before = refresh.suggestions(target.id);
  const draft = {
    provider: "sonarr" as const,
    url: config.url,
    reuseSourceId: first.id,
  };
  const pending = refresh.refreshSuggestions(
    target.id,
    draft,
    before.configRevision,
    () => {},
  );
  await reading;
  refresh.configure(first.id, { ...config, apiKey: "replaced-server-key" });
  resolveRead();
  await assert.rejects(pending, /changed/);
  waiting = new Promise<void>((resolve) => {
    resolveRead = resolve;
  });
  reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  let allowed = true;
  const denied = refresh.refreshSuggestions(
    target.id,
    draft,
    before.configRevision,
    () => {
      assert.ok(allowed, "Administrator permission required");
    },
  );
  await reading;
  allowed = false;
  resolveRead();
  await assert.rejects(denied, /Administrator/);
  await refresh.stop();
});

test("a repeat source refresh reads fresh provider metadata while a not-yet-imported source reuses the shared inventory", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  let calls = 0;
  const cache = new ProviderSuggestions(
    store,
    Buffer.alloc(32, 9),
    async () =>
      new Response(
        JSON.stringify([
          {
            id: 1,
            title: `Revision ${++calls}`,
            rootFolderPath: "/movies",
            hasFile: true,
            movieFile: { path: "/movies/one.mkv" },
          },
        ]),
      ),
  );
  const connection = {
    provider: "radarr" as const,
    url: "http://provider",
    apiKey: "server-key",
  };
  const initial = await cache.items(connection);
  const appliedAt = Date.now();
  const anotherSource = await cache.items(connection, 0);
  assert.equal(anotherSource, initial);
  assert.equal(calls, 1);
  const explicitRepeat = await cache.items(connection, appliedAt);
  assert.equal(calls, 2);
  assert.equal(explicitRepeat[0]!.title, "Revision 2");
});

test("automatic provider retries back off while a deliberate manual scan can immediately recover", async (t) => {
  const { mkdtemp, rm, realpath } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "mytuner-provider-backoff-")),
  );
  const store = new Store(":memory:");
  let calls = 0,
    failed = true;
  const refresh = new RefreshService(store, Buffer.alloc(32, 6), async () => {
    calls++;
    if (failed) throw Error("synthetic outage");
    return Response.json([]);
  });
  t.after(async () => {
    await refresh.stop();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const src = source(store, root, "movies");
  refresh.configure(src.id, {
    provider: "radarr",
    url: "http://provider",
    apiKey: "server-key",
    mappings: [{ from: "/movies", to: root }],
  });
  refresh.schedule(src.id, 60_000, 0);
  await refresh.tick();
  assert.equal(calls, 1);
  failed = false;
  store.db
    .prepare("UPDATE refresh_sources SET next_run_ms=0 WHERE source_id=?")
    .run(src.id);
  await refresh.tick();
  assert.equal(
    calls,
    1,
    "automatic retry should respect the connection backoff",
  );
  await refresh.scan(src.id);
  assert.equal(
    calls,
    2,
    "explicit retry should contact the recovered provider immediately",
  );
  assert.equal(
    store.db
      .prepare("SELECT last_error FROM refresh_attempts WHERE source_id=?")
      .get(src.id)!.last_error,
    null,
  );
});
