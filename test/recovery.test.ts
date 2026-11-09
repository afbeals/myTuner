import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import {
  mkdtemp,
  mkdir,
  readdir,
  rm,
  writeFile,
  readFile,
  rename,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store, schemaVersion, migrations } from "../src/database.js";
import {
  backupApplication,
  restoreApplication,
  assertNoPendingRestore,
  recoverInterruptedRestore,
} from "../src/recovery.js";
import { acquireDataLock } from "../src/runtime-lock.js";
import { account, source } from "./helpers.js";
import { loadIntegrationKey, RefreshService } from "../src/refresh.js";
test("full backup/restore retains encrypted connections, revokes sessions and preserves pre-restore recovery snapshot", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-restore-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new Store(join(root, "mytuner.db")),
    owner = account(store),
    src = source(store, "/movies", "movies"),
    key = await loadIntegrationKey(root),
    service = new RefreshService(store, key);
  service.configure(src.id, {
    provider: "radarr",
    url: "http://127.0.0.1:9",
    apiKey: "private-key",
    mappings: [{ from: "/remote", to: "/movies" }],
  });
  store.db
    .prepare(
      "INSERT INTO sessions(token_hash,account_id,expires_at) VALUES('hash',?,9999999999999)",
    )
    .run(owner.id);
  const snapshot = await backupApplication(store.db, root);
  account(store);
  store.close();
  await restoreApplication(root, snapshot);
  const restored = new Store(join(root, "mytuner.db"));
  assert.equal(
    restored.db.prepare("SELECT COUNT(*) AS n FROM accounts").get()?.n,
    1,
  );
  assert.equal(
    restored.db.prepare("SELECT COUNT(*) AS n FROM sessions").get()?.n,
    0,
  );
  assert.equal(
    restored.db.prepare("SELECT COUNT(*) AS n FROM integrations").get()?.n,
    1,
  );
  assert.deepEqual(await readFile(join(root, "integration.key")), key);
  restored.close();
  assert.ok((await readdir(join(root, "backups"))).length >= 2);
});
test("restore refuses an active server and corrupted backup without replacing live data", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new Store(join(root, "mytuner.db"));
  account(store);
  const snapshot = await backupApplication(store.db, root);
  store.close();
  const release = await acquireDataLock(root);
  await assert.rejects(restoreApplication(root, snapshot), /in use/);
  await release();
  await writeFile(join(snapshot, "mytuner.db"), "invalid backup");
  await assert.rejects(restoreApplication(root, snapshot));
  const check = new Store(join(root, "mytuner.db"));
  assert.equal(
    check.db.prepare("SELECT COUNT(*) AS n FROM accounts").get()?.n,
    1,
  );
  check.close();
});
test("pending restore blocks startup and can roll back to its recovery snapshot", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-journal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new Store(join(root, "mytuner.db")),
    owner = account(store),
    previous = await backupApplication(store.db, root);
  account(store);
  store.close();
  await writeFile(
    join(root, "restore.pending.json"),
    JSON.stringify({ previous }),
  );
  await assert.rejects(assertNoPendingRestore(root), /Interrupted/);
  await recoverInterruptedRestore(root);
  await assertNoPendingRestore(root);
  const recovered = new Store(join(root, "mytuner.db"));
  assert.equal(
    recovered.db.prepare("SELECT id FROM accounts").get()?.id,
    owner.id,
  );
  assert.equal(
    recovered.db.prepare("SELECT COUNT(*) AS n FROM accounts").get()?.n,
    1,
  );
  recovered.close();
});
test("migration creates a readable safety snapshot before changing an existing schema", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-safety-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "mytuner.db"),
    old = new DatabaseSync(path);
  for (const sql of migrations.slice(0, -1)) old.exec(sql);
  old.exec(
    `PRAGMA user_version=${schemaVersion - 1}; INSERT INTO accounts(id,username,password_hash,role,created_at) VALUES('existing','existing','synthetic','admin',0);`,
  );
  old.close();
  const upgraded = new Store(path);
  assert.equal(
    upgraded.db.prepare("PRAGMA user_version").get()?.user_version,
    schemaVersion,
  );
  upgraded.close();
  const files = await readdir(join(root, "backups"));
  assert.equal(files.length, 1);
  assert.match(files[0]!, /pre-migration/);
});

test("failed migration rolls back all preceding DDL and preserves the safety snapshot", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-failed-migration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "mytuner.db"),
    old = new DatabaseSync(path);
  for (const sql of migrations.slice(0, 7)) old.exec(sql);
  old.exec(
    "PRAGMA user_version=7; CREATE INDEX schedule_by_revision ON media(title);",
  );
  old.close();
  assert.throws(() => new Store(path));
  const check = new DatabaseSync(path, { readOnly: true });
  assert.equal(check.prepare("PRAGMA user_version").get()?.user_version, 7);
  assert.ok(
    !check
      .prepare("PRAGMA table_info(integration_metadata)")
      .all()
      .some((row) => row.name === "source_id"),
  );
  check.close();
  assert.equal((await readdir(join(root, "backups"))).length, 1);
});

test("failed restore with a mismatched encryption key rolls back to prior application data", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-restore-rollback-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new Store(join(root, "mytuner.db")),
    key = await loadIntegrationKey(root),
    src = source(store, "/movies", "movies");
  account(store);
  new RefreshService(store, key).configure(src.id, {
    provider: "radarr",
    url: "http://localhost:7878",
    apiKey: "private",
    mappings: [{ from: "/remote", to: "/movies" }],
  });
  const snapshot = await backupApplication(store.db, root);
  account(store);
  store.close();
  await writeFile(join(snapshot, "integration.key"), Buffer.alloc(32));
  await assert.rejects(restoreApplication(root, snapshot));
  const restored = new Store(join(root, "mytuner.db"));
  assert.equal(
    restored.db.prepare("SELECT COUNT(*) AS n FROM accounts").get()?.n,
    2,
  );
  restored.close();
  assert.deepEqual(await readFile(join(root, "integration.key")), key);
  await assertNoPendingRestore(root);
});

test("simultaneous ownership requests have exactly one winner and release never unlinks the lock", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-lock-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const requests = await Promise.allSettled(
      Array.from({ length: 8 }, () => acquireDataLock(root)),
    ),
    winners = requests.filter(
      (r): r is PromiseFulfilledResult<() => Promise<void>> =>
        r.status === "fulfilled",
    ),
    losers = requests.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
  try {
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 7);
    assert.ok(losers.every((r) => /in use/.test(String(r.reason))));
    await assert.rejects(acquireDataLock(root), /in use/);
  } finally {
    await Promise.all(winners.map((r) => r.value()));
  }
  assert.ok((await readdir(root)).includes("runtime-lock.db"));
  const release = await acquireDataLock(root);
  await release();
  await release();
});

test(
  "kernel ownership releases after SIGKILL and ignores stale/reused legacy PIDs",
  { timeout: 10000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "mytuner-lock-crash-"));
    // The previous PID-file format cannot make a dead owner appear alive after PID reuse.
    await writeFile(
      join(root, "server.lock"),
      JSON.stringify({ pid: process.pid, nonce: "obsolete" }),
    );
    const module = new URL("../src/runtime-lock.ts", import.meta.url).href,
      child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          `const { acquireDataLock } = await import(${JSON.stringify(module)}); const release = await acquireDataLock(${JSON.stringify(root)}); console.log("locked"); setInterval(() => { void release; }, 1000);`,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      ),
      stopped = once(child, "exit");
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await stopped;
      await rm(root, { recursive: true, force: true });
    });
    const [ready] = await Promise.race([
      once(child.stdout!, "data"),
      stopped.then(() => {
        throw Error("Lock-holder process exited before acquiring ownership");
      }),
    ]);
    assert.match(String(ready), /locked/);
    await assert.rejects(acquireDataLock(root), /in use/);
    child.kill("SIGKILL");
    await stopped;
    const release = await acquireDataLock(root);
    await release();
  },
);

test("validated backup repairs a corrupt live DB and preserves damaged bytes/key privately", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-corrupt-restore-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new Store(join(root, "mytuner.db")),
    owner = account(store);
  await loadIntegrationKey(root);
  const snapshot = await backupApplication(store.db, root);
  store.close();
  const damaged = Buffer.from("corrupt live SQLite header"),
    oldKey = Buffer.alloc(32, 9);
  await writeFile(join(root, "mytuner.db"), damaged);
  await writeFile(join(root, "integration.key"), oldKey);
  await restoreApplication(root, snapshot);
  const restored = new Store(join(root, "mytuner.db"));
  try {
    assert.equal(
      restored.db.prepare("SELECT id FROM accounts").get()?.id,
      owner.id,
    );
  } finally {
    restored.close();
  }
  const damagedDirectory = (await readdir(join(root, "backups"))).find((n) =>
    n.startsWith("damaged-"),
  )!;
  assert.ok(damagedDirectory);
  const quarantine = join(root, "backups", damagedDirectory);
  assert.deepEqual(await readFile(join(quarantine, "mytuner.db")), damaged);
  assert.deepEqual(await readFile(join(quarantine, "integration.key")), oldKey);
  assert.equal(
    JSON.parse(await readFile(join(quarantine, "damage.json"), "utf8"))
      .validatedRollback,
    false,
  );
  await assertNoPendingRestore(root);
});

test("restore does not classify filesystem or future-schema errors as corruption", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-restore-io-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "mytuner.db"),
    store = new Store(target);
  account(store);
  const snapshot = await backupApplication(store.db, root);
  store.close();
  await rm(target);
  await mkdir(target);
  await assert.rejects(restoreApplication(root, snapshot));
  assert.ok(
    !(await readdir(join(root, "backups"))).some((n) =>
      n.startsWith("damaged-"),
    ),
  );
  await assertNoPendingRestore(root);
  await rm(target, { recursive: true });
  const future = new DatabaseSync(target);
  future.exec(`PRAGMA user_version=${schemaVersion + 1}`);
  future.close();
  await assert.rejects(
    restoreApplication(root, snapshot),
    /Unsupported backup schema/,
  );
  assert.ok(
    !(await readdir(join(root, "backups"))).some((n) =>
      n.startsWith("damaged-"),
    ),
  );
  await assertNoPendingRestore(root);
});

test("interrupted corrupt-DB restore retries the validated source and never installs damaged bytes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-damaged-retry-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new Store(join(root, "mytuner.db")),
    owner = account(store),
    snapshot = await backupApplication(store.db, root);
  store.close();
  const quarantine = join(root, "backups", "damaged-interrupted");
  await mkdir(quarantine);
  await writeFile(join(quarantine, "mytuner.db"), "preserved damaged bytes");
  await writeFile(join(root, "mytuner.db"), "interrupted live database");
  await writeFile(
    join(root, "restore.pending.json"),
    JSON.stringify({ previous: null, quarantine, source: snapshot }),
  );
  await recoverInterruptedRestore(root);
  const restored = new Store(join(root, "mytuner.db"));
  try {
    assert.equal(
      restored.db.prepare("SELECT id FROM accounts").get()?.id,
      owner.id,
    );
  } finally {
    restored.close();
  }
  assert.equal(
    await readFile(join(quarantine, "mytuner.db"), "utf8"),
    "preserved damaged bytes",
  );
  await assertNoPendingRestore(root);
});

test("fresh-target restore validates encryption before writing a journal or live database", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-fresh-validation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const origin = join(root, "origin"),
    target = join(root, "target");
  await mkdir(origin);
  await mkdir(target);
  const store = new Store(join(origin, "mytuner.db")),
    key = await loadIntegrationKey(origin),
    src = source(store, "/example", "movies");
  new RefreshService(store, key).configure(src.id, {
    provider: "radarr",
    url: "http://localhost:7878",
    apiKey: "synthetic",
    mappings: [{ from: "/remote", to: "/example" }],
  });
  const snapshot = await backupApplication(store.db, origin);
  store.close();
  await writeFile(join(snapshot, "integration.key"), Buffer.alloc(32));
  await assert.rejects(restoreApplication(target, snapshot));
  await assertNoPendingRestore(target);
  assert.ok(!(await readdir(target)).includes("mytuner.db"));
  assert.ok(
    !(await readdir(target)).some((name) => name.startsWith("restore-")),
  );
  await writeFile(join(snapshot, "integration.key"), key);
  await restoreApplication(target, snapshot);
  const restored = new Store(join(target, "mytuner.db"));
  try {
    assert.equal(
      restored.db.prepare("SELECT COUNT(*) AS n FROM integrations").get()?.n,
      1,
    );
  } finally {
    restored.close();
  }
});

test("interrupted fresh-target restore retains its journal on failure and recovers once source is available", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-fresh-retry-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const origin = join(root, "origin"),
    target = join(root, "target");
  await mkdir(origin);
  await mkdir(target);
  const store = new Store(join(origin, "mytuner.db")),
    owner = account(store),
    snapshot = await backupApplication(store.db, origin);
  store.close();
  const database = await readFile(join(snapshot, "mytuner.db")),
    journal = JSON.stringify({
      previous: null,
      quarantine: null,
      source: snapshot,
    });
  await writeFile(join(target, "restore.pending.json"), journal);
  await writeFile(join(target, "mytuner.db"), "interrupted fresh installation");
  await writeFile(join(snapshot, "mytuner.db"), "unavailable input");
  await assert.rejects(recoverInterruptedRestore(target));
  assert.equal(
    await readFile(join(target, "restore.pending.json"), "utf8"),
    journal,
  );
  assert.equal(
    await readFile(join(target, "mytuner.db"), "utf8"),
    "interrupted fresh installation",
  );
  await writeFile(join(snapshot, "mytuner.db"), database);
  await recoverInterruptedRestore(target);
  await assertNoPendingRestore(target);
  const restored = new Store(join(target, "mytuner.db"));
  try {
    assert.equal(
      restored.db.prepare("SELECT id FROM accounts").get()?.id,
      owner.id,
    );
  } finally {
    restored.close();
  }
});

test("backup rejects an old database connection after differently keyed restore without publishing a broken snapshot", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-overlap-")),
    other = join(root, "other"),
    live = join(root, "live");
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(other);
  await mkdir(live);
  const configure = async (dir: string, label: string) => {
    const db = new Store(join(dir, "mytuner.db")),
      key = await loadIntegrationKey(dir),
      src = source(db, "/movies", "movies");
    account(db);
    new RefreshService(db, key).configure(src.id, {
      provider: "radarr",
      url: "http://localhost:7878",
      apiKey: label,
      mappings: [{ from: "/remote", to: "/movies" }],
    });
    return db;
  };
  const a = await configure(live, "A"),
    b = await configure(other, "B");
  const bundle = await backupApplication(b.db, other);
  b.close();
  a.close();
  const old = new DatabaseSync(join(live, "mytuner.db"), { readOnly: true });
  t.after(() => old.close());
  // The CLI opens before its first await; restore can replace paths before backup copies that open inode.
  await restoreApplication(live, bundle);
  const before = await readdir(join(live, "backups"));
  await assert.rejects(
    backupApplication(old, live),
    /database and integration key changed/,
  );
  assert.deepEqual(await readdir(join(live, "backups")), before);
  const current = new Store(join(live, "mytuner.db"));
  const valid = await backupApplication(current.db, live);
  current.close();
  assert.equal(
    JSON.parse(await readFile(join(valid, "manifest.json"), "utf8"))
      .keyIncluded,
    true,
  );
  await restoreApplication(live, valid);
});

test("backup and restore reject every malformed present key even with no integrations", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-unused-key-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new Store(join(root, "mytuner.db"));
  account(store);
  const snapshot = await backupApplication(store.db, root);
  for (const length of [0, 1, 31, 33]) {
    await writeFile(join(root, "integration.key"), Buffer.alloc(length));
    await assert.rejects(
      backupApplication(store.db, root),
      /Invalid integration encryption key/,
    );
  }
  await rm(join(root, "integration.key"));
  store.close();
  for (const length of [0, 1, 31, 33]) {
    await writeFile(join(snapshot, "integration.key"), Buffer.alloc(length));
    await assert.rejects(
      restoreApplication(root, snapshot),
      /Invalid integration encryption key/,
    );
    await assertNoPendingRestore(root);
    const check = new Store(join(root, "mytuner.db"));
    assert.equal(
      check.db.prepare("SELECT COUNT(*) AS n FROM accounts").get()?.n,
      1,
    );
    check.close();
  }
  await rm(join(snapshot, "integration.key"));
  await writeFile(join(root, "integration.key"), Buffer.alloc(32));
  await restoreApplication(root, snapshot);
  await assert.rejects(readFile(join(root, "integration.key")), {
    code: "ENOENT",
  });
});

test("verify, restore and interrupted recovery refuse a nonempty bundle WAL", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-wal-input-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const origin = join(root, "origin"),
    target = join(root, "target");
  await mkdir(origin);
  await mkdir(target);
  const store = new Store(join(origin, "mytuner.db"));
  account(store);
  const snapshot = await backupApplication(store.db, origin);
  store.close();
  await writeFile(join(snapshot, "mytuner.db-wal"), "nonempty-wal");
  const { verifyApplicationBackup } = await import("../src/recovery.js");
  await assert.rejects(verifyApplicationBackup(snapshot), /nonempty WAL/);
  await assert.rejects(restoreApplication(target, snapshot), /nonempty WAL/);
  assert.deepEqual(await readdir(target), []);
  await writeFile(
    join(target, "restore.pending.json"),
    JSON.stringify({ previous: null, quarantine: null, source: snapshot }),
  );
  await assert.rejects(recoverInterruptedRestore(target), /nonempty WAL/);
  assert.deepEqual(await readdir(target), ["restore.pending.json"]);
  await writeFile(join(snapshot, "mytuner.db-wal"), "");
  assert.equal((await verifyApplicationBackup(snapshot)).status, "valid");
});

test("restore rejects media and metadata overlap before creating target files, including symlink aliases and recovery", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-restore-readonly-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const origin = join(root, "origin"),
    mediaRoot = join(root, "media"),
    metadataRoot = join(root, "metadata");
  await mkdir(origin);
  await mkdir(mediaRoot);
  await mkdir(metadataRoot);
  const store = new Store(join(origin, "mytuner.db"));
  const src = source(store, mediaRoot, "shows");
  store.db
    .prepare("UPDATE sources SET metadata_root=? WHERE id=?")
    .run(metadataRoot, src.id);
  const snapshot = await backupApplication(store.db, origin);
  store.close();
  for (const target of [
    mediaRoot,
    join(mediaRoot, "new-data"),
    metadataRoot,
    join(metadataRoot, "new-data"),
  ])
    await assert.rejects(restoreApplication(target, snapshot), /overlaps/);
  assert.deepEqual(await readdir(mediaRoot), []);
  assert.deepEqual(await readdir(metadataRoot), []);
  const { symlink } = await import("node:fs/promises");
  const alias = join(root, "alias");
  await symlink(metadataRoot, alias);
  await assert.rejects(
    restoreApplication(join(alias, "new-data"), snapshot),
    /overlaps/,
  );
  await writeFile(
    join(mediaRoot, "restore.pending.json"),
    JSON.stringify({ previous: null, quarantine: null, source: snapshot }),
  );
  await assert.rejects(recoverInterruptedRestore(mediaRoot), /overlaps/);
  assert.deepEqual(await readdir(mediaRoot), ["restore.pending.json"]);
});

for (const change of ["resolved", "changed", "replaced"] as const)
  test(
    `delayed recovery refuses a ${change} journal before replacing live data`,
    { timeout: 10000 },
    async (t) => {
      const root = await mkdtemp(join(tmpdir(), "mytuner-journal-race-"));
      t.after(() => rm(root, { recursive: true, force: true }));
      const database = join(root, "mytuner.db"),
        journal = join(root, "restore.pending.json"),
        store = new Store(database);
      account(store);
      const previous = await backupApplication(store.db, root);
      account(store);
      const newer = await backupApplication(store.db, root);
      store.close();
      const originalJournal = JSON.stringify({
        previous,
        quarantine: null,
        source: newer,
      });
      await writeFile(journal, originalJournal);
      let release!: () => void,
        entered!: () => void,
        intercepted = false;
      const held = new Promise<void>((resolve) => {
          release = resolve;
        }),
        ready = new Promise<void>((resolve) => {
          entered = resolve;
        }),
        originalStat = fs.stat,
        gate = t.mock.method(
          fs,
          "stat",
          async (...args: Parameters<typeof fs.stat>) => {
            if (
              !intercepted &&
              String(args[0]) === join(previous, "mytuner.db-wal")
            ) {
              intercepted = true;
              entered();
              await held;
            }
            return originalStat(...args);
          },
        );
      syncBuiltinESMExports();
      const rejected = assert.rejects(
        recoverInterruptedRestore(root),
        /recovery journal changed/,
      );
      try {
        await ready;
        let expectedJournal: string | null;
        if (change === "resolved") {
          // A second recovery completes, then an explicit new restore succeeds.
          await recoverInterruptedRestore(root);
          await restoreApplication(root, newer);
          expectedJournal = null;
        } else if (change === "changed") {
          expectedJournal = JSON.stringify({
            previous: null,
            quarantine: null,
            source: newer,
          });
          await writeFile(journal, expectedJournal);
        } else {
          // Identical bytes can belong to a different restore operation.
          await rename(journal, join(root, "old-journal.json"));
          await writeFile(journal, originalJournal);
          expectedJournal = originalJournal;
        }
        const before = await readFile(database);
        release();
        await rejected;
        assert.deepEqual(await readFile(database), before);
        if (expectedJournal === null) await assertNoPendingRestore(root);
        else assert.equal(await readFile(journal, "utf8"), expectedJournal);
        // The failed stale recovery must also release runtime ownership.
        const unlock = await acquireDataLock(root);
        await unlock();
      } finally {
        release();
        await rejected.catch(() => {});
        gate.mock.restore();
        syncBuiltinESMExports();
      }
    },
  );
