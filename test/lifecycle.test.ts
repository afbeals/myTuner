import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  open,
  rm,
  writeFile,
  readFile,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { get } from "node:http";
import { once } from "node:events";
import { Store } from "../src/database.js";
import { createServer } from "../src/server.js";
import { digest } from "../src/security.js";
import { addSource, scanSource } from "../src/catalog.js";
import { cleanupAssets } from "../src/storage.js";
import { GenerationRunner } from "../src/generation.js";
import { account, profile } from "./helpers.js";
import type { Media } from "../src/domain.js";
for (const action of ["revoke", "shutdown"] as const)
  test(
    action === "revoke"
      ? "revocation interrupts an already-open range stream over a real HTTP socket"
      : "shutdown closes a stalled media socket before worker cleanup without waiting for the viewer",
    { timeout: 10000 },
    async (t) => {
      const root = await mkdtemp(join(tmpdir(), "mytuner-revoke-")),
        store = new Store(":memory:"),
        owner = account(store),
        p = profile(store, owner);
      await mkdir(join(root, "media"));
      const handle = await open(join(root, "media", "video.mp4"), "w");
      await handle.truncate(64 * 1024 * 1024);
      await handle.close();
      const src = await addSource(
        store,
        {
          name: "Media",
          kind: "videos",
          root: join(root, "media"),
          recursive: true,
        },
        [join(root, "data")],
      );
      await scanSource(store, src, async () => 1000);
      const item = store.db
        .prepare("SELECT * FROM media")
        .get() as unknown as Media;
      store.db
        .prepare("INSERT INTO source_grants VALUES(?,?,'')")
        .run(p, src.id);
      const token = randomBytes(32).toString("base64url");
      store.db
        .prepare(
          "INSERT INTO sessions(token_hash,account_id,expires_at) VALUES(?,?,?)",
        )
        .run(digest(token), owner.id, Date.now() + 60000);
      const app = createServer(store, {
        generatedRoot: join(root, "generated"),
        cacheRoot: join(root, "cache"),
        writableRoots: [join(root, "data")],
      });
      t.after(async () => {
        // Ensure a failed shutdown assertion cannot strand the test's own cleanup.
        app.server.closeAllConnections();
        await app.close();
        store.close();
        await rm(root, { recursive: true, force: true });
      });
      const address = await app.listen({ host: "127.0.0.1", port: 0 });
      const request = get(
        `${address}/api/profiles/${p}/media/${item.id}/file`,
        {
          headers: { authorization: `Bearer ${token}` },
          agent: false,
        },
      );
      t.after(() => request.destroy());
      const [response] = await once(request, "response");
      response.pause();
      assert.equal(response.statusCode, 200);
      const closed = once(response, "aborted");
      response.on("error", () => {});
      if (action === "revoke") {
        store.db.prepare("DELETE FROM source_grants WHERE profile_id=?").run(p);
        setTimeout(() => response.resume(), 1500).unref();
      } else {
        const original = await stat(join(root, "media", "video.mp4"));
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            app.close(),
            new Promise<never>((_, reject) => {
              deadline = setTimeout(
                () =>
                  reject(Error("Shutdown waited for the stalled media client")),
                1500,
              );
            }),
          ]);
        } finally {
          clearTimeout(deadline);
        }
        // Consumption resumes only after app.close() has already completed.
        response.resume();
        const after = await stat(join(root, "media", "video.mp4"));
        assert.equal(after.size, original.size);
        assert.equal(after.mtimeMs, original.mtimeMs);
      }
      await closed;
      assert.equal(response.complete, false);
    },
  );
test("generation queue and disk quotas fail safely, and failed work can retry", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-quota-")),
    store = new Store(":memory:");
  await mkdir(join(root, "media"));
  await writeFile(join(root, "media", "video.mp4"), "unchanged");
  const src = await addSource(
    store,
    {
      name: "Media",
      kind: "videos",
      root: join(root, "media"),
      recursive: true,
    },
    [join(root, "generated")],
  );
  await scanSource(store, src, async () => 1000);
  let calls = 0;
  const runner = new GenerationRunner(
    store,
    join(root, "generated"),
    async () => {
      calls++;
    },
    { maxBytes: 1, reserveBytes: 0, maxPendingJobs: 1 },
  );
  t.after(async () => {
    await runner.stop();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const input = {
      sourceId: src.id,
      directory: "",
      recursive: true,
      kinds: ["thumbnail" as const],
      regenerate: false,
    },
    job = await runner.enqueue(input);
  await assert.rejects(runner.enqueue(input), /queue is full/);
  await runner.drain();
  assert.equal(runner.get(job.id).status, "failed");
  assert.equal(calls, 0);
  assert.equal(runner.retry(job.id).status, "queued");
  assert.equal(runner.list().length, 1);
  runner.cancel(job.id);
});

test("stale asset cleanup previews then removes managed derivatives while preserving originals", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-asset-cleanup-")),
    store = new Store(":memory:");
  await mkdir(join(root, "media"));
  const original = join(root, "media", "source.mp4");
  await writeFile(original, "original bytes");
  const src = await addSource(
    store,
    {
      name: "Media",
      root: join(root, "media"),
      kind: "videos",
      recursive: true,
    },
    [join(root, "generated")],
  );
  await scanSource(store, src, async () => 1000);
  const runner = new GenerationRunner(
    store,
    join(root, "generated"),
    async (args) => {
      await writeFile(args.at(-1)!, "synthetic derivative");
    },
  );
  t.after(async () => {
    await runner.stop();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  await runner.enqueue({
    sourceId: src.id,
    directory: "",
    recursive: true,
    kinds: ["thumbnail"],
    regenerate: false,
  });
  await runner.drain();
  const asset = store.db
    .prepare("SELECT relative_path FROM generated_assets")
    .get()!;
  store.db.exec("UPDATE media SET available=0");
  const path = join(root, "generated", String(asset.relative_path));
  assert.deepEqual(await cleanupAssets(store, runner.root, true), {
    staleAssets: 1,
    removed: 0,
    dryRun: true,
  });
  assert.ok(await stat(path));
  assert.deepEqual(await cleanupAssets(store, runner.root, false), {
    staleAssets: 1,
    removed: 1,
    dryRun: false,
  });
  await assert.rejects(stat(path));
  assert.equal(await readFile(original, "utf8"), "original bytes");
});
