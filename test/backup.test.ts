import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/database.js";
import { backupDatabase } from "../src/backup.js";
import { account } from "./helpers.js";

test("SQLite backup preserves committed WAL data and can reopen independently", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-backup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new Store(join(root, "original.db"));
  t.after(() => store.close());
  const owner = account(store);
  const path = await backupDatabase(store, join(root, "backups")),
    restored = new Store(path);
  t.after(() => restored.close());
  assert.equal(
    restored.db.prepare("PRAGMA integrity_check").get()?.integrity_check,
    "ok",
  );
  assert.equal(
    restored.db.prepare("SELECT id FROM accounts").get()?.id,
    owner.id,
  );
  account(store);
  assert.equal(
    restored.db.prepare("SELECT COUNT(*) AS n FROM accounts").get()?.n,
    1,
  );
});
test("failed transactions do not commit partial writes and future schemas are refused", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-migration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "db.sqlite"),
    store = new Store(file);
  assert.throws(() =>
    store.transaction(() => {
      account(store);
      throw new Error("rollback");
    }),
  );
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM accounts").get()?.n,
    0,
  );
  store.db.exec("PRAGMA user_version=999");
  store.close();
  assert.throws(() => new Store(file), /newer/);
});
