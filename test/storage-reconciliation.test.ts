import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { ManagedCache } from "../src/managed-cache.js";
import { reconcileAssets } from "../src/asset-reconciliation.js";
import { Store } from "../src/database.js";
import {
  GenerationRunner,
  assetFingerprint,
  assetRelativePath,
} from "../src/generation.js";
import { media, source } from "./helpers.js";

test("managed cache evicts expired then least recently used outputs, preserves fresh partials and stays bounded under concurrent publication", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-cache-policy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cache = new ManagedCache(root, 30, 0, 86400000);
  const a = "a".repeat(64) + ".vtt",
    b = "b".repeat(64) + ".vtt",
    c = "c".repeat(64) + ".json";
  await cache.publish(a, Buffer.alloc(10, 1), () => {});
  await cache.publish(b, Buffer.alloc(10, 2), () => {});
  await utimes(join(root, a), new Date(1000), new Date(1000));
  await cache.publish(c, Buffer.alloc(15, 3), () => {});
  assert.equal(await cache.get(a, () => {}), null);
  assert.ok(await cache.get(b, () => {}));
  const partial = "d".repeat(64) + "." + randomUUID() + ".partial.vtt";
  await writeFile(join(root, partial), Buffer.alloc(4));
  const d = "e".repeat(64) + ".vtt";
  await cache.publish(d, Buffer.alloc(10, 4), () => {});
  assert.equal((await readFile(join(root, partial))).length, 4);
  await Promise.all([
    cache.publish(a, Buffer.alloc(10), () => {}),
    cache.publish(b, Buffer.alloc(10), () => {}),
  ]);
  const files = await readdir(root);
  const bytes = await Promise.all(files.map((p) => readFile(join(root, p))));
  assert.ok(bytes.reduce((sum, b) => sum + b.length, 0) <= 30);
  await assert.rejects(
    cache.publish("../escape.vtt", Buffer.alloc(1), () => {}),
    /Invalid managed/,
  );
  await assert.rejects(
    cache.get(a, () => {
      throw Error("revoked");
    }),
    /revoked/,
  );
});

test("managed cache reclaims old interrupted outputs and rejects symlinks without touching targets", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-cache-links-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const name = "a".repeat(64) + ".json",
    partial = name + "." + randomUUID() + ".partial";
  await writeFile(join(root, partial), "old");
  await utimes(join(root, partial), new Date(1000), new Date(1000));
  const cache = new ManagedCache(root, 20, 0);
  await cache.publish(name, Buffer.from("{}"), () => {});
  assert.deepEqual(await readdir(root), [name]);
  await rm(join(root, name));
  const target = join(root, "preserved.txt");
  await writeFile(target, "original");
  await symlink(target, join(root, name));
  await assert.rejects(
    cache.get(name, () => {}),
    /Invalid managed/,
  );
  await assert.rejects(
    cache.publish(name, Buffer.from("{}"), () => {}),
    /Invalid managed/,
  );
  assert.equal(await readFile(target, "utf8"), "original");
});

test("output reconciliation reviews missing references/orphans/stale files, protects current outputs and rejects a stale review", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-reconcile-")),
    store = new Store(":memory:");
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const src = source(store),
    item = media(store, src.id),
    valid = assetRelativePath(item, "thumbnail");
  await mkdir(dirname(join(root, valid)), { recursive: true });
  await writeFile(join(root, valid), "valid");
  store.db
    .prepare("INSERT INTO generated_assets VALUES(?,?,?,?,?)")
    .run(
      randomUUID(),
      item.id,
      "thumbnail",
      assetFingerprint(item, "thumbnail"),
      valid,
    );
  const missing = assetRelativePath(item, "gif");
  store.db
    .prepare("INSERT INTO generated_assets VALUES(?,?,?,?,?)")
    .run(randomUUID(), item.id, "gif", assetFingerprint(item, "gif"), missing);
  const orphan = `${randomUUID()}/${"a".repeat(64)}/conversion.mp4`;
  await mkdir(dirname(join(root, orphan)), { recursive: true });
  await writeFile(join(root, orphan), "orphan");
  const interrupted = `${item.id}/${"b".repeat(64)}/.partial-${randomUUID()}.jpg`;
  await mkdir(dirname(join(root, interrupted)), { recursive: true });
  await writeFile(join(root, interrupted), "partial");
  await utimes(join(root, interrupted), new Date(1000), new Date(1000));
  await writeFile(join(root, "operator-note.txt"), "keep");
  const review = await reconcileAssets(store, root, true, undefined, () => {});
  assert.equal(review.missingReferences, 1);
  assert.equal(review.orphanFiles, 1);
  assert.equal(review.interruptedFiles, 1);
  assert.equal(review.removedFiles, 0);
  assert.equal(await readFile(join(root, orphan), "utf8"), "orphan");
  await writeFile(join(root, orphan), "changed orphan");
  await assert.rejects(
    reconcileAssets(store, root, false, review.review, () => {}),
    /review reconciliation again/,
  );
  const next = await reconcileAssets(store, root, true, undefined, () => {});
  const applied = await reconcileAssets(
    store,
    root,
    false,
    next.review,
    () => {},
  );
  assert.equal(applied.removedFiles, 2);
  assert.equal(applied.removedReferences, 1);
  assert.equal(await readFile(join(root, valid), "utf8"), "valid");
  assert.equal(await readFile(join(root, "operator-note.txt"), "utf8"), "keep");
  store.db.prepare("UPDATE media SET size=size+1 WHERE id=?").run(item.id);
  const stale = await reconcileAssets(store, root, true, undefined, () => {});
  assert.equal(stale.staleAssets, 1);
  await reconcileAssets(store, root, false, stale.review, () => {});
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM generated_assets").get()?.n,
    0,
  );
  assert.equal(
    (await reconcileAssets(store, root, true, undefined, () => {}))
      .reclaimableBytes,
    0,
  );
});

test("output reconciliation refuses links and revocation before mutation, and generation excludes maintenance until shutdown drains", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-reconcile-exclusion-")),
    store = new Store(":memory:");
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(join(root, "original"), "unchanged");
  await symlink(join(root, "original"), join(root, "link"));
  await assert.rejects(
    reconcileAssets(store, root, true, undefined, () => {}),
    /symbolic links/,
  );
  await assert.rejects(
    reconcileAssets(store, root, false, "a".repeat(64), () => {
      throw Error("revoked");
    }),
    /revoked/,
  );
  assert.equal(await readFile(join(root, "original"), "utf8"), "unchanged");
  const runner = new GenerationRunner(store, root);
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  const task = runner.withStorageMaintenance(async (check) => {
    await held;
    check();
  });
  await assert.rejects(
    runner.withStorageMaintenance(async () => {}),
    /Wait for generation/,
  );
  let stopped = false;
  const stopping = runner.stop().then(() => {
    stopped = true;
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(stopped, false);
  release();
  await assert.rejects(task, /stopping/);
  await stopping;
  assert.equal(stopped, true);
});
