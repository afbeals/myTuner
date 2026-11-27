import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store, schemaVersion } from "../src/database.js";
import { account, profile, source, media, channel } from "./helpers.js";
import {
  resetCategoryIds,
  resetCategories,
  planReset,
  applyResetTransaction,
  type ResetRequest,
} from "../src/reset-data.js";

/** SQL-only fixtures. Filesystem execution/backup safety has separate integration tests. */
function fixture() {
  const store = new Store(":memory:");
  const older = account(store, "admin");
  const retained = account(store, "admin");
  store.db
    .prepare("UPDATE accounts SET username='A older administrator' WHERE id=?")
    .run(older.id);
  store.db
    .prepare(
      "UPDATE accounts SET username='Z retained administrator' WHERE id=?",
    )
    .run(retained.id);
  const viewer = account(store, "viewer");
  const p = profile(store, viewer);
  const s = source(store, "/synthetic/read-only-videos");
  store.db
    .prepare(
      "UPDATE sources SET metadata_root='/synthetic/read-only-nfo',subtitle_root='/synthetic/read-only-captions' WHERE id=?",
    )
    .run(s.id);
  const m = media(store, s.id, "Season 1/Sample.S01E01.mp4");
  const c = channel(store, older);
  store.db
    .prepare(
      "INSERT INTO source_grants(profile_id,source_id,subtree) VALUES(?,?,'')",
    )
    .run(p, s.id);
  store.db
    .prepare(
      "INSERT INTO profile_accounts(profile_id,account_id,can_manage) VALUES(?,?,1)",
    )
    .run(p, older.id);
  store.db
    .prepare("INSERT INTO channel_items(channel_id,media_id) VALUES(?,?)")
    .run(c.id, m.id);
  store.db
    .prepare("INSERT INTO subscriptions(profile_id,channel_id) VALUES(?,?)")
    .run(p, c.id);
  const collection = randomUUID();
  store.db
    .prepare(
      "INSERT INTO collections(id,name,owner_account_id) VALUES(?,'Preserved selection',?)",
    )
    .run(collection, viewer.id);
  store.db
    .prepare("INSERT INTO collection_items(collection_id,media_id) VALUES(?,?)")
    .run(collection, m.id);
  const revision = randomUUID();
  store.db
    .prepare(
      "INSERT INTO schedule_revisions(id,channel_id,created_at,profile_id,author_account_id,config_json) VALUES(?,?,0,?,?,?)",
    )
    .run(
      revision,
      c.id,
      p,
      older.id,
      JSON.stringify({ collection, sourceId: s.id }),
    );
  const entry = randomUUID();
  store.db
    .prepare(
      "INSERT INTO schedule_entries(id,revision_id,channel_id,media_id,program_id,start_ms,end_ms,offset_ms,kind) VALUES(?,?,?,?,?,0,1000,0,'program')",
    )
    .run(entry, revision, c.id, m.id, randomUUID());
  store.db
    .prepare("INSERT INTO active_schedules(channel_id,revision_id) VALUES(?,?)")
    .run(c.id, revision);
  store.db
    .prepare("INSERT INTO rotation_state(channel_id,state_json) VALUES(?,'{}')")
    .run(c.id);
  store.db
    .prepare(
      "INSERT INTO schedule_checkpoints(revision_id,program_id,end_ms,state_json) VALUES(?,'program',1000,'{}')",
    )
    .run(revision);
  store.db
    .prepare(
      "INSERT INTO sessions(token_hash,account_id,expires_at) VALUES('synthetic-session',?,9999999999999)",
    )
    .run(viewer.id);
  store.db
    .prepare(
      "INSERT INTO profile_unlocks(session_hash,profile_id,expires_ms) VALUES('synthetic-session',?,9999999999999)",
    )
    .run(p);
  store.db
    .prepare(
      "INSERT INTO display_metadata(target_key,source_id,identity,state_json,local_json) VALUES(?,?,'synthetic-identity',?,?)",
    )
    .run(
      `media:${m.id}`,
      s.id,
      JSON.stringify({ title: { source: "custom", value: "Manual title" } }),
      JSON.stringify({ title: "Local title" }),
    );
  const job = randomUUID();
  store.db
    .prepare(
      "INSERT INTO generation_jobs(id,source_id,directory,recursive,status,regenerate,created_at) VALUES(?,?,'',1,'queued',0,0)",
    )
    .run(job, s.id);
  store.db
    .prepare(
      "INSERT INTO generation_items(id,job_id,media_id,kind,status) VALUES(?,?,?,'thumbnail','queued')",
    )
    .run(randomUUID(), job, m.id);
  store.db
    .prepare(
      "INSERT INTO protected_source_roots(path) VALUES('/historical/read-only-root')",
    )
    .run();
  return { store, retained, older, viewer, p, s, m, c, collection, revision };
}
function snapshot(store: Store) {
  return store.db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map(({ name }) => [
      name,
      store.db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
    ]);
}
function count(store: Store, table: string) {
  return Number(
    store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n,
  );
}

test("every nonempty category subset closes dependencies, keeps the explicit administrator and passes SQLite integrity", () => {
  for (let mask = 1; mask < 1 << resetCategoryIds.length; mask++) {
    const f = fixture();
    try {
      const categories = resetCategoryIds.filter((_, index) =>
        Boolean(mask & (1 << index)),
      );
      const request: ResetRequest = {
        mode: "selective",
        categories,
        retainedAdminId: f.retained.id,
      };
      const preview = planReset(f.store, f.retained, request, true);
      const expected = new Set(categories);
      for (let changed = true; changed;) {
        changed = false;
        for (const descriptor of resetCategories)
          if (expected.has(descriptor.id))
            for (const dependency of descriptor.requires)
              if (!expected.has(dependency.category)) {
                expected.add(dependency.category);
                changed = true;
              }
      }
      assert.deepEqual(
        new Set(preview.effectiveCategories),
        expected,
        `selection mask ${mask}`,
      );
      const credentials = f.store.db
        .prepare("SELECT * FROM accounts WHERE id=?")
        .get(f.retained.id);
      const schema = f.store.db
        .prepare("SELECT type,name,sql FROM sqlite_master ORDER BY type,name")
        .all();
      applyResetTransaction(f.store, f.retained, request, preview.revision);
      assert.deepEqual(
        f.store.db
          .prepare("SELECT * FROM accounts WHERE id=?")
          .get(f.retained.id),
        credentials,
      );
      assert.deepEqual(
        f.store.db.prepare("PRAGMA foreign_key_check").all(),
        [],
      );
      assert.equal(
        f.store.db.prepare("PRAGMA integrity_check").get()!.integrity_check,
        "ok",
      );
      assert.equal(
        f.store.db.prepare("PRAGMA user_version").get()!.user_version,
        schemaVersion,
      );
      assert.deepEqual(
        f.store.db
          .prepare("SELECT type,name,sql FROM sqlite_master ORDER BY type,name")
          .all(),
        schema,
      );
      assert.equal(count(f.store, "sources"), expected.has("sources") ? 0 : 1);
      assert.equal(count(f.store, "media"), expected.has("catalog") ? 0 : 1);
      assert.equal(
        count(f.store, "collections"),
        expected.has("collections") ? 0 : 1,
      );
      assert.equal(
        count(f.store, "channels"),
        expected.has("channels") ? 0 : 1,
      );
      assert.equal(
        count(f.store, "accounts"),
        expected.has("accounts") ? 1 : 3,
      );
      assert.equal(
        count(f.store, "profiles"),
        expected.has("accounts") ? 0 : 1,
      );
      assert.equal(count(f.store, "sessions"), 0);
      assert.equal(count(f.store, "profile_unlocks"), 0);
      assert.equal(
        f.store.db
          .prepare(
            "SELECT cleanup_disabled FROM storage_safety_state WHERE id=1",
          )
          .get()!.cleanup_disabled,
        1,
      );
      const roots = f.store.db
        .prepare("SELECT path FROM protected_source_roots ORDER BY path")
        .all()
        .map((row) => row.path);
      assert.deepEqual(roots, [
        "/historical/read-only-root",
        "/synthetic/read-only-captions",
        "/synthetic/read-only-nfo",
        "/synthetic/read-only-videos",
      ]);
    } finally {
      f.store.close();
    }
  }
});

test("stale same-count changes and invalid protection paths leave all reset records untouched", () => {
  const f = fixture();
  try {
    const request: ResetRequest = {
      mode: "fresh",
      categories: [],
      retainedAdminId: f.retained.id,
    };
    const preview = planReset(f.store, f.retained, request, true);
    f.store.db
      .prepare(
        "UPDATE channels SET name='Changed while backup awaited' WHERE id=?",
      )
      .run(f.c.id);
    const changed = snapshot(f.store);
    assert.throws(
      () =>
        applyResetTransaction(f.store, f.retained, request, preview.revision),
      /changed after review/i,
    );
    assert.deepEqual(snapshot(f.store), changed);
    const current = planReset(f.store, f.retained, request, true);
    assert.throws(
      () =>
        applyResetTransaction(f.store, f.retained, request, current.revision, [
          "relative/escape",
        ]),
      /non-absolute/i,
    );
    assert.deepEqual(snapshot(f.store), changed);
  } finally {
    f.store.close();
  }
});

test("an exception after earlier deletes rolls the complete reset transaction back", () => {
  const f = fixture();
  const original = f.store.db.prepare.bind(f.store.db);
  try {
    const request: ResetRequest = {
      mode: "fresh",
      categories: [],
      retainedAdminId: f.retained.id,
    };
    const preview = planReset(f.store, f.retained, request, true);
    const before = snapshot(f.store);
    let earlierDelete = false;
    f.store.db.prepare = (sql: string) => {
      if (sql === 'DELETE FROM "subscriptions"') earlierDelete = true;
      if (sql === 'DELETE FROM "channels"')
        throw new Error("Injected mid-transaction I/O fault");
      return original(sql);
    };
    assert.throws(
      () =>
        applyResetTransaction(f.store, f.retained, request, preview.revision),
      /Injected mid-transaction/,
    );
    f.store.db.prepare = original;
    assert.equal(earlierDelete, true);
    assert.deepEqual(snapshot(f.store), before);
  } finally {
    f.store.db.prepare = original;
    f.store.close();
  }
});

test("unknown schema extensions, changed triggers and incorrect retained identities refuse before mutation", () => {
  for (const mutation of [
    "CREATE TABLE household_notes(secret TEXT)",
    "CREATE TRIGGER unexpected_delete AFTER DELETE ON accounts BEGIN DELETE FROM media; END",
    "DROP TRIGGER catalog_media_delete",
  ]) {
    const f = fixture();
    try {
      f.store.db.exec(mutation);
      const before = snapshot(f.store);
      assert.throws(
        () =>
          planReset(
            f.store,
            f.retained,
            { mode: "fresh", categories: [], retainedAdminId: f.retained.id },
            true,
          ),
        /recognized myTuner schema/i,
      );
      assert.deepEqual(snapshot(f.store), before);
    } finally {
      f.store.close();
    }
  }
  const f = fixture();
  try {
    const before = snapshot(f.store);
    assert.throws(
      () =>
        planReset(
          f.store,
          f.retained,
          { mode: "fresh", categories: [], retainedAdminId: f.older.id },
          true,
        ),
      /currently authenticated/i,
    );
    assert.throws(
      () =>
        planReset(
          f.store,
          f.viewer,
          { mode: "fresh", categories: [], retainedAdminId: f.viewer.id },
          true,
        ),
      /currently authenticated/i,
    );
    f.store.db
      .prepare("UPDATE accounts SET disabled=1 WHERE id=?")
      .run(f.retained.id);
    const disabled = snapshot(f.store);
    assert.throws(
      () =>
        planReset(
          f.store,
          f.retained,
          { mode: "fresh", categories: [], retainedAdminId: f.retained.id },
          true,
        ),
      /active administrator/i,
    );
    assert.deepEqual(snapshot(f.store), disabled);
    f.store.db
      .prepare("UPDATE accounts SET disabled=0 WHERE id=?")
      .run(f.retained.id);
    assert.deepEqual(snapshot(f.store), before);
  } finally {
    f.store.close();
  }
});
