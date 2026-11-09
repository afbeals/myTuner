import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { Store } from "../src/database.js";
import { scanSource } from "../src/catalog.js";
import { localMetadata } from "../src/local-metadata.js";
import { browseLibrary, selectMedia, showKey } from "../src/library.js";
import { ProgrammingService } from "../src/programming.js";
import { noBreaks } from "../src/scheduler.js";
import { ArtworkService } from "../src/artwork.js";
import { RefreshService } from "../src/refresh.js";
import { createServer } from "../src/server.js";
import { digest } from "../src/security.js";
import type { Media } from "../src/domain.js";
import type { Programming } from "../src/contracts.js";
import { account, profile, source, media, channel } from "./helpers.js";

test("R9-01 NFO numbers retain filename fallback while explicit zero and positive values stay selectable", async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "mytuner-r9-nfo-"))),
    store = new Store(":memory:");
  t.after(async () => {
    if (store.db.isOpen) store.close();
    await rm(root, { recursive: true, force: true });
  });
  const owner = account(store),
    p = profile(store, owner),
    src = source(store, root, "shows");
  store.db.prepare("INSERT INTO source_grants VALUES(?,?,'')").run(p, src.id);
  const video = join(root, "Show.S02E03.mp4"),
    nfo = join(root, "Show.S02E03.nfo");
  await writeFile(video, "synthetic media reference");
  const original = await readFile(video);
  const cases = [
    { label: "missing", fields: "", season: 2, episode: 3 },
    { label: "empty", fields: "<season/><episode/>", season: 2, episode: 3 },
    {
      label: "whitespace",
      fields: "<season>  </season><episode>\n </episode>",
      season: 2,
      episode: 3,
    },
    {
      label: "invalid",
      fields: "<season>bad</season><episode><nested>3</nested></episode>",
      season: 2,
      episode: 3,
    },
    {
      label: "nondecimal",
      fields: "<season>0x0</season><episode>3e1</episode>",
      season: 2,
      episode: 3,
    },
    {
      label: "special",
      fields: "<season>0</season><episode>0</episode>",
      season: 0,
      episode: 0,
    },
    {
      label: "positive",
      fields: "<season> 4 </season><episode> 7 </episode>",
      season: 4,
      episode: 7,
    },
  ];
  for (const c of cases)
    await t.test(c.label, async () => {
      await writeFile(
        nfo,
        `<episodedetails><title>Episode</title>${c.fields}</episodedetails>`,
      );
      const nfoBytes = await readFile(nfo);
      assert.equal(
        (await scanSource(store, src, async () => 1000)).complete,
        true,
      );
      const item = store.db
          .prepare("SELECT * FROM media")
          .get() as unknown as Media,
        data = JSON.parse(item.metadata_json);
      assert.equal(data.seasonNumber, c.season);
      assert.equal(data.episodeNumber, c.episode);
      assert.deepEqual(
        browseLibrary(store, owner, p).shows[0]!.seasons.map((s) => s.number),
        [c.season],
      );
      const selection = {
        type: "show" as const,
        sourceId: src.id,
        key: showKey(item),
        includeSpecials: false,
      };
      assert.equal(
        selectMedia(store, owner, p, selection).length,
        c.season === 0 ? 0 : 1,
      );
      selection.includeSpecials = c.season === 0;
      const config: Programming = {
        profileId: p,
        groups: [{ id: "show", mode: "ordered", selection }],
        rules: noBreaks,
        seed: 42,
      };
      const ch = channel(store, owner),
        service = new ProgrammingService(store, 1000);
      const before = store.db
        .prepare("SELECT COUNT(*) n FROM schedule_entries")
        .get()!.n;
      assert.ok(
        service.preview(owner, ch.id, config, 0, 1000).entries.length > 0,
      );
      assert.equal(
        store.db.prepare("SELECT COUNT(*) n FROM schedule_entries").get()!.n,
        before,
      );
      service.publish(owner, ch.id, config, 0, 1000);
      assert.equal(
        store.db
          .prepare("SELECT media_id FROM schedule_entries WHERE channel_id=?")
          .get(ch.id)!.media_id,
        item.id,
      );
      assert.deepEqual(await readFile(video), original);
      assert.deepEqual(await readFile(nfo), nfoBytes);
    });
});

test("R9-01 empty and malformed NFO years preserve filename year", async (t) => {
  const root = await realpath(
      await mkdtemp(join(tmpdir(), "mytuner-r9-year-")),
    ),
    store = new Store(":memory:");
  t.after(async () => {
    if (store.db.isOpen) store.close();
    await rm(root, { recursive: true, force: true });
  });
  const src = source(store, root, "movies");
  for (const year of ["", " ", "1.5", "-1", "2024e0", "9007199254740992"]) {
    await writeFile(
      join(root, "Film.2024.nfo"),
      `<movie><year>${year}</year></movie>`,
    );
    assert.equal((await localMetadata(src, "Film.2024.mp4")).year, 2024);
  }
  await writeFile(
    join(root, "Film.2024.nfo"),
    "<movie><year>2025</year></movie>",
  );
  assert.equal((await localMetadata(src, "Film.2024.mp4")).year, 2025);
});

async function artworkFixture(
  t: { after: (fn: () => unknown) => void },
  url = "http://synthetic.invalid/radarr",
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "mytuner-r9-art-"))),
    store = new Store(":memory:");
  t.after(async () => {
    if (store.db.isOpen) store.close();
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, "media"));
  const owner = account(store, "admin"),
    p = profile(store, owner),
    src = source(store, join(root, "media"), "movies"),
    item = media(store, src.id),
    key = randomBytes(32);
  new RefreshService(store, key).configure(src.id, {
    provider: "radarr",
    url,
    apiKey: "synthetic",
    mappings: [{ from: "/remote", to: src.root_path }],
  });
  item.metadata_json = JSON.stringify({
    images: [
      {
        url:
          new URL(url).pathname.replace(/\/$/, "") + "/MediaCover/1/poster.jpg",
      },
    ],
  });
  store.db
    .prepare("UPDATE media SET metadata_json=? WHERE id=?")
    .run(item.metadata_json, item.id);
  return {
    root,
    store,
    owner,
    p,
    item,
    key,
    cache: join(root, "cache", "artwork"),
  };
}

test("R9-04 stop aborts and drains a late artwork fetch without publishing cache or consulting a closed store", async (t) => {
  const f = await artworkFixture(t);
  let release!: () => void,
    started!: () => void,
    signal: AbortSignal | undefined;
  const gate = new Promise<void>((r) => (release = r)),
    entered = new Promise<void>((r) => (started = r));
  const service = new ArtworkService(
    f.store,
    f.cache,
    f.key,
    async (_url, options) => {
      signal = options!.signal!;
      started();
      await gate;
      return new Response(new Uint8Array([255, 216, 255]), {
        headers: { "content-type": "image/jpeg" },
      });
    },
  );
  t.after(async () => {
    release();
    await service.stop();
  });
  const result = service.get(f.item, 0),
    rejected = assert.rejects(result, /stopping/);
  await entered;
  let stopped = false;
  const stopping = service.stop().then(() => {
    stopped = true;
  });
  assert.equal(signal!.aborted, true);
  await new Promise<void>((r) => setImmediate(r));
  assert.equal(stopped, false);
  release();
  await rejected;
  await stopping;
  await service.stop();
  assert.deepEqual(await readdir(f.cache), []);
  f.store.close();
  await assert.rejects(service.get(f.item, 0), /stopping/);
});

test("R9-04 stop cancels a stalled artwork response body and drains it", async (t) => {
  const f = await artworkFixture(t);
  let reading!: () => void,
    cancelled = false;
  const entered = new Promise<void>((r) => (reading = r));
  const service = new ArtworkService(
    f.store,
    f.cache,
    f.key,
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([255, 216, 255]));
          },
          pull() {
            reading();
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "image/jpeg" } },
      ),
  );
  t.after(() => service.stop());
  const pending = service.get(f.item, 0),
    rejected = assert.rejects(pending);
  await entered;
  await service.stop();
  await rejected;
  assert.equal(cancelled, true);
  assert.deepEqual(await readdir(f.cache), []);
});

test("R9-04 app.close aborts actual HTTP artwork before resolving and leaves no late cache files", async (t) => {
  let started!: () => void, disconnected!: () => void;
  const entered = new Promise<void>((r) => (started = r)),
    closed = new Promise<void>((r) => (disconnected = r));
  const upstream = createHttpServer((_request, response) => {
    response.on("close", disconnected);
    started();
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  t.after(async () => {
    upstream.closeAllConnections();
    await new Promise<void>((r) => upstream.close(() => r()));
  });
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const f = await artworkFixture(t, `http://127.0.0.1:${address.port}/radarr`);
  f.store.db
    .prepare(
      "INSERT INTO sessions(token_hash,account_id,expires_at) VALUES(?,?,?)",
    )
    .run(digest("synthetic"), f.owner.id, Date.now() + 60000);
  const app = createServer(f.store, {
    integrationKey: f.key,
    writableRoots: [join(f.root, "data")],
    generatedRoot: join(f.root, "generated"),
    cacheRoot: join(f.root, "cache"),
  });
  t.after(() => app.close());
  await app.ready();
  const pending = app.inject({
    url: `/api/profiles/${f.p}/media/${f.item.id}/artwork/0`,
    headers: { authorization: "Bearer synthetic" },
  });
  await entered;
  await app.close();
  await closed;
  assert.ok((await pending).statusCode >= 500);
  assert.deepEqual(await readdir(f.cache), []);
});
