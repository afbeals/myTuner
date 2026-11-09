import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Store } from "../src/database.js";
import {
  seal,
  unseal,
  loadIntegrationKey,
  RefreshService,
} from "../src/refresh.js";
import { source, media } from "./helpers.js";
import { localMetadata } from "../src/local-metadata.js";
test("integration key persists privately and authenticated encryption detects tampering", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-key-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const key = await loadIntegrationKey(root),
    cipher = seal(key, "secret-api-key");
  assert.deepEqual(key, await loadIntegrationKey(root));
  assert.ok(!cipher.includes("secret-api-key"));
  assert.equal(unseal(key, cipher), "secret-api-key");
  assert.throws(() => unseal(randomBytes(32), cipher));
});
test("saved refresh retains metadata on outage, deduplicates scans, and never returns stored credentials", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-refresh-")),
    store = new Store(":memory:");
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, "media"));
  const src = source(store, join(root, "media"), "movies"),
    item = media(store, src.id);
  let calls = 0;
  const service = new RefreshService(store, randomBytes(32), async () => {
    calls++;
    throw Error("upstream offline secret-api-key");
  });
  service.configure(src.id, {
    provider: "radarr",
    url: "http://127.0.0.1:9",
    apiKey: "secret-api-key",
    mappings: [{ from: "/remote", to: src.root_path }],
  });
  service.schedule(src.id, 60000, 0);
  const first = service.scan(src.id),
    second = service.scan(src.id);
  assert.equal(first, second);
  await assert.rejects(first, /offline/);
  assert.equal(calls, 1);
  assert.equal(
    store.db.prepare("SELECT metadata_json FROM media WHERE id=?").get(item.id)
      ?.metadata_json,
    "{}",
  );
  assert.doesNotMatch(
    String(
      store.db.prepare("SELECT encrypted_key FROM integrations").get()
        ?.encrypted_key,
    ),
    /secret-api-key/,
  );
  assert.doesNotMatch(
    String(
      store.db.prepare("SELECT last_error FROM refresh_sources").get()
        ?.last_error,
    ),
    /secret-api-key/,
  );
  await service.stop();
});
test("local filename fallback and unsafe NFO declarations never require a remote match", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-nfo-")),
    store = new Store(":memory:");
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const src = source(store, root, "shows");
  await writeFile(
    join(root, "Show.S02E10.nfo"),
    '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><episodedetails><title>&x;</title></episodedetails>',
  );
  const metadata = await localMetadata(src, "Show.S02E10.mp4");
  assert.equal(metadata.seasonNumber, 2);
  assert.equal(metadata.episodeNumber, 10);
  assert.equal(metadata.seriesTitle, "Show");
  assert.doesNotMatch(JSON.stringify(metadata), /root:/);
});

test("automatic refresh succeeds, records success, and can be unscheduled/stopped", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-refresh-success-")),
    store = new Store(":memory:");
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const src = source(store, root, "movies"),
    service = new RefreshService(
      store,
      randomBytes(32),
      async () => new Response("[]"),
    );
  service.configure(src.id, {
    provider: "radarr",
    url: "http://localhost:7878",
    apiKey: "private-key",
    mappings: [{ from: "/remote", to: root }],
  });
  service.schedule(src.id, 60000, 0);
  await service.tick();
  assert.ok(
    Number(
      store.db.prepare("SELECT last_success FROM integrations").get()
        ?.last_success,
    ) > 0,
  );
  assert.equal(
    store.db.prepare("SELECT last_error FROM refresh_sources").get()
      ?.last_error,
    null,
  );
  service.schedule(src.id, null);
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM refresh_sources").get()?.n,
    0,
  );
  await service.stop();
  assert.throws(() => service.scan(src.id), /stopping/);
});

for (const outcome of ["success", "failure"]) {
  test(`superseded integration ${outcome} cannot alter new configuration and a new refresh uses the new settings`, async (t) => {
    const root = await realpath(
        await mkdtemp(join(tmpdir(), "mytuner-refresh-revision-")),
      ),
      store = new Store(":memory:");
    await promisify(execFile)("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=teal:s=160x90:r=10",
      "-t",
      "0.2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      join(root, "clip.mp4"),
    ]);
    const src = source(store, root, "movies");
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>((r) => (release = r)),
      began = new Promise<void>((r) => (entered = r)),
      calls: string[] = [];
    const service = new RefreshService(store, randomBytes(32), async (url) => {
      calls.push(String(url));
      if (String(url).includes("old.invalid")) {
        entered();
        await held;
        if (outcome === "failure") throw Error("old failure");
      }
      const old = String(url).includes("old.invalid");
      return new Response(
        JSON.stringify([
          {
            id: 7,
            title: old ? "OLD CONFIG TITLE" : "NEW CONFIG TITLE",
            hasFile: true,
            movieFile: { path: (old ? "/old" : "/new") + "/clip.mp4" },
          },
        ]),
      );
    });
    t.after(async () => {
      release();
      await service.stop();
      store.close();
      await rm(root, { recursive: true, force: true });
    });
    service.configure(src.id, {
      provider: "radarr",
      url: "http://old.invalid:7878",
      apiKey: "old-key",
      mappings: [{ from: "/old", to: root }],
    });
    service.schedule(src.id, 60000, 0);
    const old = service.scan(src.id);
    await began;
    service.configure(src.id, {
      provider: "radarr",
      url: "http://new.invalid:7878",
      apiKey: "new-key",
      mappings: [{ from: "/new", to: root }],
    });
    const next = service.scan(src.id);
    assert.notEqual(old, next);
    release();
    assert.equal(((await old) as { superseded?: boolean }).superseded, true);
    assert.equal(
      store.db.prepare("SELECT last_success FROM integrations").get()
        ?.last_success,
      null,
    );
    assert.notEqual(
      store.db.prepare("SELECT title FROM media").get()?.title,
      "OLD CONFIG TITLE",
    );
    await next;
    assert.equal(
      store.db.prepare("SELECT title FROM media").get()?.title,
      "NEW CONFIG TITLE",
    );
    assert.ok(
      Number(
        store.db.prepare("SELECT last_success FROM integrations").get()
          ?.last_success,
      ) > 0,
    );
    assert.equal(
      store.db.prepare("SELECT last_error FROM refresh_sources").get()
        ?.last_error,
      null,
    );
    assert.equal(calls.length, 2);
    assert.match(calls[1]!, /new.invalid/);
  });
}
