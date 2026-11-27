import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { Store } from "../src/database.js";
import {
  backupApplication,
  restoreApplication,
  recoverInterruptedRestore,
} from "../src/recovery.js";
import {
  captureStorageSafety,
  assertOutputWritesAllowed,
} from "../src/storage-safety.js";
import { account, source } from "./helpers.js";

async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(join(tmpdir(), "mytuner-reset-restore-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const origin = join(root, "origin"),
    live = join(root, "live"),
    historical = join(root, "historical-readonly");
  await fs.mkdir(origin);
  await fs.mkdir(live);
  await fs.mkdir(historical);
  const backup = new Store(join(origin, "mytuner.db")),
    restoredOwner = account(backup, "admin");
  const snapshot = await backupApplication(backup.db, origin);
  backup.close();
  return {
    root,
    live,
    historical: await fs.realpath(historical),
    snapshot,
    restoredOwner,
  };
}
function flag(store: Store, historical: string) {
  store.db
    .prepare(
      "UPDATE storage_safety_state SET cleanup_disabled=1,reset_ms=123 WHERE id=1",
    )
    .run();
  store.db
    .prepare("INSERT INTO protected_source_roots(path) VALUES(?)")
    .run(historical);
}

test("restoring an older backup preserves reset protection and historical/current roots without changing backup bytes", async (t) => {
  const f = await fixture(t),
    live = new Store(join(f.live, "mytuner.db"));
  const currentRoot = join(f.root, "current-media");
  await fs.mkdir(currentRoot);
  source(live, await fs.realpath(currentRoot));
  flag(live, f.historical);
  live.close();
  const before = await fs.readFile(join(f.snapshot, "mytuner.db"));
  await restoreApplication(f.live, f.snapshot);
  const restored = new Store(join(f.live, "mytuner.db"));
  try {
    const safety = captureStorageSafety(restored);
    assert.equal(safety.cleanupDisabled, true);
    assert.equal(safety.outputWritesDisabled, false);
    assert.ok(safety.protectedRoots.includes(f.historical));
    assert.ok(safety.protectedRoots.includes(await fs.realpath(currentRoot)));
    assert.equal(
      restored.db.prepare("SELECT id FROM accounts").get()?.id,
      f.restoredOwner.id,
    );
  } finally {
    restored.close();
  }
  assert.deepEqual(await fs.readFile(join(f.snapshot, "mytuner.db")), before);
});

test("failed installation rolls back application records while retaining safety barriers", async (t) => {
  const f = await fixture(t),
    live = new Store(join(f.live, "mytuner.db")),
    originalOwner = account(live, "admin");
  flag(live, f.historical);
  live.close();
  const rename = fs.rename;
  let failed = false;
  const mocked = t.mock.method(
    fs,
    "rename",
    async (...args: Parameters<typeof fs.rename>) => {
      if (
        !failed &&
        String(args[1]) === join(f.live, "mytuner.db") &&
        basename(String(args[0])).startsWith("restore-")
      ) {
        failed = true;
        throw Error("Synthetic failed DB install");
      }
      return rename(...args);
    },
  );
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      restoreApplication(f.live, f.snapshot),
      /Synthetic failed DB install/,
    );
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
  const restored = new Store(join(f.live, "mytuner.db"));
  try {
    assert.equal(
      restored.db.prepare("SELECT id FROM accounts").get()?.id,
      originalOwner.id,
    );
    assert.equal(captureStorageSafety(restored).cleanupDisabled, true);
    assert.ok(
      captureStorageSafety(restored).protectedRoots.includes(f.historical),
    );
  } finally {
    restored.close();
  }
  await assert.rejects(fs.stat(join(f.live, "restore.pending.json")), {
    code: "ENOENT",
  });
});

test("interrupted recovery inherits journal safety even when installed DB and rollback snapshot lack it", async (t) => {
  const f = await fixture(t),
    live = new Store(join(f.live, "mytuner.db")),
    owner = account(live, "admin");
  const previous = await backupApplication(live.db, f.live);
  account(live, "admin");
  live.close();
  await fs.writeFile(
    join(f.live, "restore.pending.json"),
    JSON.stringify({
      previous,
      quarantine: null,
      source: f.snapshot,
      storageSafety: {
        cleanupDisabled: true,
        outputWritesDisabled: true,
        resetMs: 456,
        protectedRoots: [f.historical],
      },
    }),
  );
  await recoverInterruptedRestore(f.live);
  const restored = new Store(join(f.live, "mytuner.db"));
  try {
    assert.equal(
      restored.db.prepare("SELECT COUNT(*) AS n FROM accounts").get()?.n,
      1,
    );
    assert.equal(
      restored.db.prepare("SELECT id FROM accounts").get()?.id,
      owner.id,
    );
    const safety = captureStorageSafety(restored);
    assert.equal(safety.cleanupDisabled, true);
    assert.equal(safety.outputWritesDisabled, true);
    assert.ok(safety.protectedRoots.includes(f.historical));
  } finally {
    restored.close();
  }
});

test("corrupt live protection state restores DB conservatively with cleanup and output writes blocked", async (t) => {
  const f = await fixture(t),
    live = new Store(join(f.live, "mytuner.db"));
  flag(live, f.historical);
  live.close();
  await fs.writeFile(
    join(f.live, "mytuner.db"),
    "damaged database with unknowable historical roots",
  );
  await restoreApplication(f.live, f.snapshot);
  const restored = new Store(join(f.live, "mytuner.db"));
  try {
    assert.equal(
      restored.db.prepare("SELECT id FROM accounts").get()?.id,
      f.restoredOwner.id,
    );
    assert.equal(captureStorageSafety(restored).cleanupDisabled, true);
    assert.equal(captureStorageSafety(restored).outputWritesDisabled, true);
    assert.throws(
      () => assertOutputWritesAllowed(restored),
      /prior storage protections could not be recovered/,
    );
  } finally {
    restored.close();
  }
});
