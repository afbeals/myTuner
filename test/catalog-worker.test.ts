import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Store } from "../src/database.js";
import { CatalogService } from "../src/catalog-service.js";
import { ensureCatalogProjection } from "../src/catalog-projection.js";
import { refreshAccount } from "../src/security.js";
import { account, profile, source, media } from "./helpers.js";

async function fixture(t: { after: (fn: () => unknown) => void }) {
  const root = await mkdtemp(join(tmpdir(), "mytuner-worker-"));
  const store = new Store(join(root, "catalog.db"));
  const owner = account(store),
    profileId = profile(store, owner),
    src = source(store, "/synthetic", "movies");
  store.db
    .prepare("INSERT INTO source_grants VALUES(?,?,'')")
    .run(profileId, src.id);
  const item = media(store, src.id, "Visible/Movie.mp4");
  const services: CatalogService[] = [];
  const service = (
    options: ConstructorParameters<typeof CatalogService>[1] = {},
  ) => {
    const result = new CatalogService(store, options);
    services.push(result);
    return result;
  };
  t.after(async () => {
    await Promise.all(services.map((reader) => reader.stop()));
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, store, owner, profileId, src, item, service };
}
const input = { search: "", kind: "movies", offset: 0, limit: 24 };
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test("file-backed catalog reader runs source workers and returns bounded current pages", async (t) => {
  const f = await fixture(t),
    reader = f.service();
  const page = await reader.libraryPage(f.owner, f.profileId, input);
  assert.deepEqual(
    page.movies.map((row) => row.id),
    [f.item.id],
  );
  const searched = await reader.mediaPage(f.owner, f.profileId, {
    search: "Movie",
    page: 1,
    limit: 24,
  });
  assert.equal(searched.total, 1);
  assert.equal(searched.items[0]!.id, f.item.id);
  const options = await reader.optionsPage(f.owner, f.profileId, {
    search: "Movie",
    offset: 0,
    limit: 24,
    kind: "movie",
  });
  assert.equal(options.total, 1);
  f.store.db
    .prepare("DELETE FROM source_grants WHERE profile_id=?")
    .run(f.profileId);
  const revoked = await reader.libraryPage(f.owner, f.profileId, input);
  assert.equal(revoked.pagination.total, 0);
  assert.equal(revoked.sources.length, 0);
  await reader.stop();
  await reader.stop();
  await assert.rejects(
    reader.libraryPage(f.owner, f.profileId, input),
    /stopping/,
  );
});

test("catalog lane coalesces requests, bounds queued scopes and retains uncancelled waiters", async (t) => {
  const f = await fixture(t),
    hold = gate(),
    entered = gate();
  let builds = 0;
  const reader = f.service({
    maxQueued: 1,
    prepare: async (store, options) => {
      builds++;
      if (builds === 1) {
        entered.release();
        await hold.promise;
      }
      return ensureCatalogProjection(store, options);
    },
  });
  const abort = new AbortController();
  const first = reader.libraryPage(f.owner, f.profileId, input, {
    signal: abort.signal,
  });
  const firstRejected = assert.rejects(first, /cancelled/);
  await entered.promise;
  const shared = reader.libraryPage(f.owner, f.profileId, input);
  const queued = reader.libraryPage(f.owner, f.profileId, {
    ...input,
    offset: 24,
  });
  await assert.rejects(
    reader.libraryPage(f.owner, f.profileId, { ...input, offset: 48 }),
    /busy/,
  );
  abort.abort();
  hold.release();
  await firstRejected;
  assert.equal((await shared).movies.length, 1);
  assert.equal((await queued).movies.length, 0);
  assert.equal(builds, 2);
});

test("authority is reconstructed after asynchronous projection work, including device PIN expiry", async (t) => {
  const f = await fixture(t),
    hold = gate(),
    entered = gate();
  f.store.db
    .prepare("UPDATE profiles SET pin_hash='protected' WHERE id=?")
    .run(f.profileId);
  f.store.db
    .prepare(
      "INSERT INTO sessions(token_hash,account_id,expires_at,kind) VALUES('device-session',?,?,'device')",
    )
    .run(f.owner.id, Date.now() + 60000);
  f.store.db
    .prepare("INSERT INTO profile_unlocks VALUES('device-session',?,?)")
    .run(f.profileId, Date.now() + 60000);
  const actor = refreshAccount(f.store, {
    ...f.owner,
    sessionHash: "device-session",
  });
  const reader = f.service({
    prepare: async (store, options) => {
      entered.release();
      await hold.promise;
      return ensureCatalogProjection(store, options);
    },
  });
  const pending = reader.libraryPage(actor, f.profileId, input);
  const rejected = assert.rejects(pending, /locked/);
  await entered.promise;
  f.store.db.prepare("UPDATE profile_unlocks SET expires_ms=0").run();
  hold.release();
  await rejected;
});

test("stale worker DTOs are discarded after account disable while the worker is answering", async (t) => {
  const f = await fixture(t),
    workerPath = join(f.root, "delayed.mjs");
  await writeFile(
    workerPath,
    `import {parentPort} from 'node:worker_threads';parentPort.postMessage({type:'ready'});parentPort.on('message',m=>{if(m.type==='run'){const w=m.work;setTimeout(()=>parentPort.postMessage({type:'result',id:w.id,epoch:w.epoch,generation:w.generation,revision:w.revision,result:{sources:[],shows:[],movies:[],folders:[],movieCollections:[],savedCollections:[],pagination:{offset:0,limit:24,total:999}}}),150)}});`,
  );
  const reader = f.service({ workerUrl: pathToFileURL(workerPath) });
  await ensureCatalogProjection(f.store);
  const pending = reader.libraryPage(f.owner, f.profileId, input);
  const rejected = assert.rejects(pending, /Authentication/);
  await delay(75);
  f.store.db
    .prepare("UPDATE accounts SET disabled=1 WHERE id=?")
    .run(f.owner.id);
  await rejected;
});

test("shutdown aborts active preparation, rejects queued callers and waits for the lane", async (t) => {
  const f = await fixture(t),
    entered = gate();
  const reader = f.service({
    prepare: async (_store, { signal }) => {
      entered.release();
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
        if (signal.aborted) reject(signal.reason);
      });
      return 0;
    },
  });
  const pending = reader.libraryPage(f.owner, f.profileId, input);
  const rejected = assert.rejects(pending, /stopping/);
  await entered.promise;
  const queued = reader.libraryPage(f.owner, f.profileId, {
    ...input,
    offset: 24,
  });
  const queuedRejected = assert.rejects(queued, /stopping/);
  await reader.stop();
  await Promise.all([rejected, queuedRejected]);
});

test("route boundary validation rejects catalog changes after the service promise settles", async (t) => {
  const f = await fixture(t),
    reader = f.service();
  const page = await reader.libraryPage(f.owner, f.profileId, input);
  reader.assertCurrent(page, f.owner, f.profileId);
  f.store.db
    .prepare("DELETE FROM source_grants WHERE profile_id=?")
    .run(f.profileId);
  assert.throws(
    () => reader.assertCurrent(page, f.owner, f.profileId),
    /changed/,
  );
  const fresh = await reader.libraryPage(f.owner, f.profileId, input);
  reader.assertCurrent(fresh, f.owner, f.profileId);
  assert.equal(fresh.pagination.total, 0);
});

test("worker failure rejects pending work and bounded backoff permits a fresh reader", async (t) => {
  const f = await fixture(t),
    workerPath = join(f.root, "failure.mjs");
  await writeFile(
    workerPath,
    `import {parentPort} from 'node:worker_threads';parentPort.postMessage({type:'ready'});parentPort.on('message',()=>process.exit(1));`,
  );
  const reader = f.service({ workerUrl: pathToFileURL(workerPath) });
  await assert.rejects(
    reader.libraryPage(f.owner, f.profileId, input),
    /unavailable/,
  );
  await assert.rejects(
    reader.libraryPage(f.owner, f.profileId, input),
    /restarting/,
  );
  await delay(275);
  // The next attempt starts a new worker rather than retaining a rejected startup
  // promise or silently running the full catalog on the main thread.
  await assert.rejects(
    reader.libraryPage(f.owner, f.profileId, input),
    /unavailable/,
  );
});

test("a stopped native-free worker cannot retain a timed out request indefinitely", async (t) => {
  const f = await fixture(t),
    workerPath = join(f.root, "blocked.mjs");
  await writeFile(
    workerPath,
    `import {parentPort} from 'node:worker_threads';parentPort.postMessage({type:'ready'});parentPort.on('message',()=>{for(;;){}});`,
  );
  const reader = f.service({
    workerUrl: pathToFileURL(workerPath),
    timeoutMs: 100,
  });
  await assert.rejects(
    reader.libraryPage(f.owner, f.profileId, input),
    /cancelled/,
  );
  await reader.stop();
});

test("file-backed workers preserve non-enumerable authenticated device session scope", async (t) => {
  const f = await fixture(t);
  // An admin device still requires a selected profile's PIN, whereas a browser
  // admin does not. Losing the device WeakMap/sessionHash changes that behavior.
  f.store.db
    .prepare("UPDATE accounts SET role='admin' WHERE id=?")
    .run(f.owner.id);
  f.store.db
    .prepare("UPDATE profiles SET pin_hash='protected' WHERE id=?")
    .run(f.profileId);
  f.store.db
    .prepare(
      "INSERT INTO sessions(token_hash,account_id,expires_at,kind) VALUES('admin-device',?,?,'device')",
    )
    .run(f.owner.id, Date.now() + 60000);
  f.store.db
    .prepare("INSERT INTO profile_unlocks VALUES('admin-device',?,?)")
    .run(f.profileId, Date.now() + 60000);
  const actor = refreshAccount(f.store, {
    ...f.owner,
    sessionHash: "admin-device",
  });
  assert.equal(Object.keys(actor).includes("sessionHash"), false);
  const reader = f.service();
  const page = await reader.libraryPage(actor, f.profileId, input);
  assert.equal(page.movies.length, 1);
  f.store.db.prepare("UPDATE profile_unlocks SET expires_ms=0").run();
  await assert.rejects(reader.libraryPage(actor, f.profileId, input), /locked/);
});

test("shutdown also drains a worker that has not completed its startup handshake", async (t) => {
  const f = await fixture(t),
    workerPath = join(f.root, "starting.mjs");
  await writeFile(
    workerPath,
    `import {parentPort} from 'node:worker_threads';setTimeout(()=>parentPort.postMessage({type:'ready'}),5000);`,
  );
  await ensureCatalogProjection(f.store);
  const reader = f.service({ workerUrl: pathToFileURL(workerPath) });
  const pending = reader.libraryPage(f.owner, f.profileId, input);
  const rejected = assert.rejects(pending, /stopping/);
  await delay(30);
  await reader.stop();
  await rejected;
});

test("a commit before reader dispatch retries at the new revision and records that result", async (t) => {
  const f = await fixture(t);
  let builds = 0;
  const reader = f.service({
    prepare: async (store, options) => {
      const revision = await ensureCatalogProjection(store, options);
      if (builds++ === 0)
        store.db
          .prepare("UPDATE media SET title='Current title' WHERE id=?")
          .run(f.item.id);
      return revision;
    },
  });
  const page = await reader.libraryPage(f.owner, f.profileId, input);
  assert.equal(builds, 2);
  assert.equal(page.movies[0]!.title, "Current title");
  reader.assertCurrent(page, f.owner, f.profileId);
});
