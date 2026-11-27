import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
  chmod,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/database.js";
import { hashSecret, verifySecret, login } from "../src/security.js";
import { seal } from "../src/refresh.js";
import {
  resetRequestSchema,
  planReset,
  applyResetTransaction,
  resetCategoryIds,
} from "../src/reset-data.js";
import type { ResetCategory, ResetRequest } from "../src/reset-data.js";
import type { Account, Media } from "../src/domain.js";
import {
  executeOfflineReset,
  previewOfflineReset,
} from "../src/reset-offline.js";
import { openOfflineReset } from "../src/reset-backup.js";
import { acquireDataLock } from "../src/runtime-lock.js";
import { inspectMetadata } from "../src/display-metadata.js";
import {
  backupApplication,
  restoreApplication,
  verifyApplicationBackup,
  recoverInterruptedRestore,
} from "../src/recovery.js";
import {
  captureStorageSafety,
  assertSafeOutputRoot,
  assertOutputCleanupAllowed,
} from "../src/storage-safety.js";

const password = "round-two-database-password";
const passwordHash = hashSecret(password);
const key = Buffer.alloc(32, 71);
function put(
  db: DatabaseSync,
  table: string,
  values: Record<string, string | number | null>,
) {
  const names = Object.keys(values);
  db.prepare(
    `INSERT INTO ${table}(${names.join(",")}) VALUES(${names.map(() => "?").join(",")})`,
  ).run(...Object.values(values));
}
function rows(db: DatabaseSync, table: string) {
  return JSON.stringify(
    db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all(),
  );
}
function count(db: DatabaseSync, table: string) {
  return Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n);
}
function tables(db: DatabaseSync) {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((x) => String(x.name));
}
async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "mytuner-r2-db-")));
  const data = join(base, "app"),
    source = join(base, "videos"),
    metadata = join(base, "metadata"),
    subtitles = join(base, "subtitles");
  for (const p of [
    data,
    source,
    metadata,
    subtitles,
    join(base, "generated"),
    join(base, "unrelated"),
  ])
    await mkdir(p, { mode: 0o700 });
  const sentinels = [
    join(source, "home-video.mp4"),
    join(source, "home-video.nfo"),
    join(source, "home-video.srt"),
    join(metadata, "tvshow.nfo"),
    join(subtitles, "external.srt"),
    join(base, "generated", "operator-and-output.mp4"),
    join(base, "unrelated", "movie.mkv"),
    join(data, "operator-notes.txt"),
  ];
  for (const [i, p] of sentinels.entries())
    await writeFile(p, `immutable sentinel ${i}: ${p}`);
  const baseline = await Promise.all(sentinels.map((p) => readFile(p)));
  const store = new Store(join(data, "mytuner.db")),
    db = store.db;
  const admin: Account = {
    id: randomUUID(),
    username: "z_current",
    role: "admin",
    disabled: 0,
  };
  const other = randomUUID(),
    viewer = randomUUID();
  for (const [id, username, role] of [
    [admin.id, admin.username, "admin"],
    [other, "a_earlier", "admin"],
    [viewer, "viewer", "viewer"],
  ] as const)
    put(db, "accounts", {
      id,
      username,
      password_hash: await passwordHash,
      role,
      created_at: 1,
    });
  put(db, "profiles", {
    id: "profile",
    name: "Person",
    kind: "person",
    owner_account_id: viewer,
  });
  put(db, "profile_accounts", { profile_id: "profile", account_id: viewer });
  put(db, "sources", {
    id: "source",
    name: "Home",
    root_path: source,
    kind: "shows",
    metadata_root: metadata,
    subtitle_root: subtitles,
  });
  put(db, "source_grants", { profile_id: "profile", source_id: "source" });
  const raw = {
    technical: { codec: "copy" },
    seriesId: "show-id",
    seriesTitle: "Series",
    seasonNumber: 1,
    episodeNumber: 1,
    lastEpisodeNumber: 1,
    collection: "Group",
    title: "Local title",
    description: "Local desc",
    plot: "Cached plot",
  };
  put(db, "media", {
    id: "media",
    source_id: "source",
    relative_path: "home-video.mp4",
    title: "Catalog title",
    duration_ms: 10000,
    size: 200,
    mtime_ms: 3,
    metadata_json: JSON.stringify(raw),
  });
  put(db, "integrations", {
    id: "integration",
    source_id: "source",
    provider: "sonarr",
    url: "http://127.0.0.1:1",
    encrypted_key: seal(key, "synthetic-secret"),
    mappings_json: "[]",
    last_success: 1,
  });
  put(db, "integration_metadata", {
    source_id: "source",
    provider: "sonarr",
    external_id: "provider-id",
    media_id: "media",
    metadata_json: JSON.stringify({
      seriesTitle: "Series",
      episodes: [{ title: "Provider title", overview: "Provider desc" }],
    }),
  });
  const identity = createHash("sha256")
    .update(
      JSON.stringify([
        "source",
        [{ provider: "sonarr", external_id: "provider-id" }],
      ]),
    )
    .digest("hex");
  for (const [target_key, id] of [
    ["media:media", identity],
    ["show:source:series:show-id", "show:source:series:show-id"],
  ] as const)
    put(db, "display_metadata", {
      target_key,
      source_id: "source",
      identity: id,
      state_json: JSON.stringify({
        title: { source: "manual", manual: "My title" },
        description: { source: "manual", manual: "My desc" },
      }),
      local_json: JSON.stringify({
        values: { title: "Local candidate" },
        status: "available",
      }),
      checked_ms: 5,
    });
  put(db, "channels", {
    id: "channel",
    name: "Private",
    owner_account_id: viewer,
    visibility: "private",
  });
  put(db, "channel_items", { channel_id: "channel", media_id: "media" });
  put(db, "subscriptions", { profile_id: "profile", channel_id: "channel" });
  put(db, "schedule_revisions", {
    id: "revision",
    channel_id: "channel",
    created_at: 1,
    config_json: '{"collectionId":"collection"}',
    profile_id: "profile",
    author_account_id: viewer,
  });
  put(db, "schedule_entries", {
    id: "entry",
    revision_id: "revision",
    channel_id: "channel",
    media_id: "media",
    program_id: "program",
    start_ms: 1,
    end_ms: 1000,
    offset_ms: 0,
    kind: "program",
  });
  put(db, "active_schedules", {
    channel_id: "channel",
    revision_id: "revision",
  });
  put(db, "rotation_state", { channel_id: "channel", state_json: "{}" });
  put(db, "schedule_checkpoints", {
    revision_id: "revision",
    program_id: "program",
    end_ms: 1000,
    state_json: "{}",
  });
  put(db, "collections", {
    id: "collection",
    name: "Deleted but retained",
    owner_account_id: viewer,
    deleted_ms: 2,
    expires_ms: 1000,
  });
  put(db, "collection_items", {
    collection_id: "collection",
    media_id: "media",
  });
  put(db, "generation_jobs", {
    id: "job",
    source_id: "source",
    directory: "../../unrelated",
    recursive: 1,
    status: "done",
    regenerate: 0,
    created_at: 1,
  });
  put(db, "generation_items", {
    id: "generation",
    job_id: "job",
    media_id: "media",
    kind: "thumbnail",
    status: "done",
  });
  put(db, "generated_assets", {
    id: "asset",
    media_id: "media",
    kind: "thumbnail",
    fingerprint: "old",
    relative_path: "../../unrelated/movie.mkv",
  });
  put(db, "subtitle_checks", { media_id: "media" });
  put(db, "subtitle_tracks", {
    media_id: "media",
    root_kind: "media",
    relative_path: "../../unrelated/movie.mkv",
    state_json: "{}",
  });
  put(db, "refresh_sources", {
    source_id: "source",
    interval_ms: 100,
    next_run_ms: 1,
  });
  put(db, "refresh_attempts", { source_id: "source", last_attempt_ms: 1 });
  put(db, "integration_runs", {
    id: "run",
    source_id: "source",
    provider: "sonarr",
    completed_ms: 1,
    scan_complete: 1,
    summary_json: "{}",
  });
  put(db, "integration_run_items", {
    run_id: "run",
    external_id: "provider-id",
    previous_media_id: "media",
    matched_media_id: "media",
    state: "matched",
  });
  put(db, "provider_suggestions", {
    connection_key: "suggestion",
    provider: "sonarr",
    url: "http://127.0.0.1:1",
    last_attempt_ms: 1,
  });
  put(db, "sessions", {
    token_hash: "session",
    account_id: admin.id,
    expires_at: 99999999999,
  });
  put(db, "profile_unlocks", {
    session_hash: "session",
    profile_id: "profile",
    expires_ms: 99999999999,
  });
  put(db, "device_pairings", {
    device_hash: "device",
    code_hash: "pair",
    device_name: "TV",
    expires_ms: 99999999999,
    account_id: viewer,
  });
  put(db, "playback_sessions", {
    id: "playback",
    account_id: viewer,
    profile_id: "profile",
    channel_id: "channel",
    revision_id: "revision",
    position_ms: 1,
    anchor_ms: 1,
    last_seen: 1,
  });
  put(db, "playback_events", {
    id: "event",
    session_id: "playback",
    account_id: viewer,
    channel_id: "channel",
    entry_id: "entry",
    start_ms: 1,
    end_ms: 2,
    created_ms: 1,
    media_id: "media",
  });
  put(db, "problem_reports", {
    id: "report",
    account_id: viewer,
    request_id: "request",
    profile_id: "profile",
    channel_id: "channel",
    media_id: "media",
    created_ms: 1,
    summary_json: "{}",
  });
  put(db, "login_attempts", { key: "attempt", failures: 2, window_start: 1 });
  put(db, "protected_source_roots", {
    path: join(base, "historically-removed-source"),
  });
  await writeFile(join(data, "integration.key"), key, { mode: 0o600 });
  let closed = false;
  const close = () => {
    if (!closed) {
      store.close();
      closed = true;
    }
  };
  return {
    base,
    data,
    source,
    metadata,
    subtitles,
    store,
    db,
    admin,
    other,
    viewer,
    close,
    request: (category: ResetCategory | "fresh"): ResetRequest => ({
      mode: category === "fresh" ? "fresh" : "selective",
      categories: category === "fresh" ? [] : [category],
      retainedAdminId: admin.id,
    }),
    async unchanged() {
      for (const [i, p] of sentinels.entries())
        assert.deepEqual(await readFile(p), baseline[i], p);
    },
    async cleanup() {
      close();
      await this.unchanged();
      await rm(base, { recursive: true, force: true });
    },
  };
}
const required: Record<ResetCategory, ResetCategory[]> = {
  metadata: ["metadata", "channels", "activity"],
  custom: ["custom"],
  catalog: [
    "metadata",
    "custom",
    "catalog",
    "collections",
    "channels",
    "activity",
  ],
  sources: [
    "metadata",
    "custom",
    "catalog",
    "sources",
    "collections",
    "channels",
    "activity",
  ],
  collections: ["collections", "channels", "activity"],
  channels: ["channels", "activity"],
  activity: ["activity"],
  accounts: ["collections", "channels", "activity", "accounts"],
};
const deleted: Record<ResetCategory, string[]> = {
  metadata: [
    "integration_run_items",
    "integration_runs",
    "integration_metadata",
    "provider_suggestions",
  ],
  custom: [],
  catalog: [
    "generation_items",
    "generation_jobs",
    "generated_assets",
    "subtitle_tracks",
    "subtitle_checks",
    "display_metadata",
    "integration_run_items",
    "integration_runs",
    "integration_metadata",
    "refresh_attempts",
    "media",
  ],
  sources: [
    "refresh_sources",
    "integrations",
    "provider_suggestions",
    "source_grants",
    "sources",
  ],
  collections: ["collection_items", "collections"],
  channels: [
    "subscriptions",
    "active_schedules",
    "schedule_checkpoints",
    "schedule_entries",
    "rotation_state",
    "channel_items",
    "schedule_revisions",
    "channels",
  ],
  activity: ["playback_events", "problem_reports", "playback_sessions"],
  accounts: [
    "profile_accounts",
    "source_grants",
    "profiles",
    "login_attempts",
    "accounts",
  ],
};
for (const category of [...resetCategoryIds, "fresh"] as const)
  test(`independent offline matrix: ${category}`, async () => {
    const f = await fixture();
    try {
      const request = f.request(category),
        selected =
          category === "fresh" ? [...resetCategoryIds] : required[category];
      const before = new Map(tables(f.db).map((t) => [t, rows(f.db, t)]));
      const credentials = String(
        f.db
          .prepare("SELECT password_hash FROM accounts WHERE id=?")
          .get(f.admin.id)!.password_hash,
      );
      const snapshotMetadata = JSON.parse(rows(f.db, "display_metadata"));
      const mediaBefore = JSON.parse(rows(f.db, "media"))[0];
      f.close();
      const plan = await previewOfflineReset(f.data, request, password);
      assert.deepEqual(
        [...plan.effectiveCategories].sort(),
        [...selected].sort(),
      );
      assert.equal(plan.retainedAdmin.id, f.admin.id);
      assert.equal(plan.retainedAdmin.username, "z_current");
      for (const category of plan.effectiveCategories.filter(
        (x) => !request.categories.includes(x),
      ))
        assert.ok(
          request.mode === "fresh" ||
            plan.dependencies.some((x) => x.category === category),
        );
      await executeOfflineReset({
        dataRoot: f.data,
        request,
        password,
        revision: plan.revision,
        confirmation: plan.confirmationText,
      });
      const after = new Store(join(f.data, "mytuner.db"));
      try {
        const wipe = new Set([
          "profile_unlocks",
          "device_pairings",
          "sessions",
          "playback_sessions",
          ...selected.flatMap((x) => deleted[x]),
        ]);
        const updated = new Set([
          "catalog_projection_state",
          "catalog_revision",
          "storage_safety_state",
          "protected_source_roots",
        ]);
        if (selected.includes("metadata"))
          for (const t of ["media", "display_metadata", "integrations"])
            updated.add(t);
        if (selected.includes("custom")) updated.add("display_metadata");
        for (const table of tables(after.db)) {
          if (
            table.startsWith("catalog_projection_") &&
            table !== "catalog_projection_state"
          ) {
            assert.equal(count(after.db, table), 0);
            continue;
          }
          if (table === "accounts" && selected.includes("accounts")) {
            assert.equal(count(after.db, table), 1);
            continue;
          }
          if (wipe.has(table)) {
            assert.equal(count(after.db, table), 0, table);
            continue;
          }
          if (!updated.has(table))
            assert.equal(
              rows(after.db, table),
              before.get(table),
              `${category} unexpectedly changes ${table}`,
            );
        }
        assert.equal(
          after.db
            .prepare("SELECT password_hash FROM accounts WHERE id=?")
            .get(f.admin.id)!.password_hash,
          credentials,
        );
        assert.ok(await verifySecret(password, credentials));
        assert.equal(
          after.db.prepare("PRAGMA foreign_key_check").all().length,
          0,
        );
        assert.equal(captureStorageSafety(after).cleanupDisabled, true);
        assert.throws(() => assertOutputCleanupAllowed(after));
        for (const root of [f.source, f.metadata, f.subtitles]) {
          assert.ok(captureStorageSafety(after).protectedRoots.includes(root));
          assert.throws(() =>
            assertSafeOutputRoot(after, join(root, "future-cache")),
          );
        }
        if (selected.includes("metadata") && !selected.includes("catalog")) {
          const m = after.db
            .prepare("SELECT * FROM media")
            .get() as unknown as Media;
          assert.equal(m.title, mediaBefore.title);
          assert.deepEqual(JSON.parse(m.metadata_json), {
            technical: { codec: "copy" },
            seriesId: "show-id",
            seriesTitle: "Series",
            seasonNumber: 1,
            episodeNumber: 1,
            lastEpisodeNumber: 1,
            collection: "Group",
          });
          assert.equal(
            inspectMetadata(after, { kind: "media", mediaId: "media" }, [m])
              .effective.title.value,
            "My title",
          );
          assert.equal(
            inspectMetadata(
              after,
              { kind: "show", sourceId: "source", key: "series:show-id" },
              [m],
            ).effective.title.value,
            "My title",
          );
          assert.equal(
            JSON.parse(rows(after.db, "display_metadata"))[0].state_json,
            snapshotMetadata[0].state_json,
          );
        }
        if (category === "custom") {
          const saved = JSON.parse(rows(after.db, "display_metadata"));
          assert.equal(saved[0].local_json, snapshotMetadata[0].local_json);
          assert.equal(saved[0].identity, snapshotMetadata[0].identity);
          assert.equal(
            JSON.parse(saved[0].state_json).title.source,
            "automatic",
          );
          assert.equal(rows(after.db, "media"), before.get("media"));
          assert.equal(
            rows(after.db, "integration_metadata"),
            before.get("integration_metadata"),
          );
        }
        const signedIn = await login(after, f.admin.username, password);
        assert.equal(signedIn.account.id, f.admin.id);
      } finally {
        after.close();
      }
      await f.unchanged();
    } finally {
      await f.cleanup();
    }
  });

test("all 255 category combinations execute with independent dependencies, counts and unselected row preservation", async () => {
  const f = await fixture();
  try {
    const baseline = new Map(
      tables(f.db).map((table) => [table, rows(f.db, table)]),
    );
    for (let bits = 1; bits < 256; bits++) {
      const categories = resetCategoryIds.filter((_, i) => bits & (1 << i));
      const expected = [
        ...new Set(categories.flatMap((x) => required[x])),
      ].sort();
      const plan = planReset(
        f.store,
        f.admin,
        { mode: "selective", categories, retainedAdminId: f.admin.id },
        true,
      );
      assert.deepEqual([...plan.effectiveCategories].sort(), expected);
      for (const row of plan.tableCounts)
        assert.equal(
          row.count,
          row.table === "accounts"
            ? count(f.db, "accounts") - 1
            : count(f.db, row.table),
        );
      const rollback = new Error(
        "restore matrix fixture after verified execution",
      );
      assert.throws(
        () =>
          f.store.transaction(() => {
            applyResetTransaction(
              f.store,
              f.admin,
              {
                mode: "selective",
                categories,
                retainedAdminId: f.admin.id,
              },
              plan.revision,
            );
            const wipe = new Set([
              "profile_unlocks",
              "device_pairings",
              "sessions",
              "playback_sessions",
              ...expected.flatMap((category) => deleted[category]),
            ]);
            const update = new Set([
              "catalog_projection_state",
              "catalog_revision",
              "storage_safety_state",
              "protected_source_roots",
              ...(expected.includes("metadata")
                ? ["media", "display_metadata", "integrations"]
                : []),
              ...(expected.includes("custom") ? ["display_metadata"] : []),
            ]);
            for (const table of tables(f.db)) {
              if (table === "accounts" && expected.includes("accounts")) {
                assert.equal(count(f.db, table), 1);
                assert.equal(
                  f.db.prepare("SELECT id FROM accounts").get()!.id,
                  f.admin.id,
                );
              } else if (
                table.startsWith("catalog_projection_") &&
                table !== "catalog_projection_state"
              ) {
                assert.equal(count(f.db, table), 0);
              } else if (wipe.has(table)) {
                assert.equal(count(f.db, table), 0, table);
              } else if (!update.has(table)) {
                assert.equal(
                  rows(f.db, table),
                  baseline.get(table),
                  `${bits}: ${table}`,
                );
              }
            }
            assert.equal(
              f.db.prepare("PRAGMA foreign_key_check").all().length,
              0,
            );
            throw rollback;
          }),
        (error) => error === rollback,
      );
      for (const table of tables(f.db))
        assert.equal(rows(f.db, table), baseline.get(table));
    }
  } finally {
    await f.cleanup();
  }
});

test("invalid variants, permissions, active current retained admin and typed confirmation refuse unchanged", async () => {
  const f = await fixture();
  try {
    const valid = f.request("custom");
    const invalid = [
      {},
      null,
      { ...valid, mode: "../fresh" },
      { ...valid, categories: [] },
      { ...valid, categories: ["custom", "custom"] },
      { ...valid, categories: ["sources;DELETE FROM accounts"] },
      { ...valid, retainedAdminId: f.viewer },
      { ...valid, retainedAdminId: "../videos" },
      { ...valid, mode: "fresh" },
      { ...valid, unknown: true },
      { ...valid, categories: Array(9).fill("custom") },
    ];
    for (const value of invalid) {
      if ((value as any)?.retainedAdminId === f.viewer) continue;
      assert.equal(
        resetRequestSchema.safeParse(value).success,
        false,
        JSON.stringify(value),
      );
    }
    assert.throws(() =>
      planReset(f.store, { ...f.admin, role: "viewer" }, valid, true),
    );
    assert.throws(() =>
      planReset(f.store, f.admin, { ...valid, retainedAdminId: f.other }, true),
    );
    const before = rows(f.db, "accounts");
    f.close();
    for (const wrong of ["", "wrong-password", "x".repeat(1025)])
      await assert.rejects(previewOfflineReset(f.data, valid, wrong));
    await assert.rejects(
      previewOfflineReset(
        f.data,
        { ...valid, retainedAdminId: f.viewer },
        password,
      ),
    );
    const plan = await previewOfflineReset(f.data, valid, password);
    await assert.rejects(
      executeOfflineReset({
        dataRoot: f.data,
        request: valid,
        password,
        revision: plan.revision,
        confirmation: "RESET a_earlier",
      }),
    );
    const db = new DatabaseSync(join(f.data, "mytuner.db"));
    try {
      assert.equal(rows(db, "accounts"), before);
    } finally {
      db.close();
    }
    assert.ok(!(await readdir(f.data)).includes("backups"));
  } finally {
    await f.cleanup();
  }
});

test("full revision catches same-count unselected edit during verified-backup await; reset rolls back", async () => {
  const f = await fixture();
  try {
    const request = f.request("catalog");
    const before = rows(f.db, "media");
    f.close();
    const plan = await previewOfflineReset(f.data, request, password);
    let backup = "";
    await assert.rejects(
      executeOfflineReset(
        {
          dataRoot: f.data,
          request,
          password,
          revision: plan.revision,
          confirmation: plan.confirmationText,
        },
        {
          backupCreated: async (b) => {
            backup = b.directory;
            const db = new DatabaseSync(join(f.data, "mytuner.db"));
            try {
              db.prepare("UPDATE profiles SET name=? WHERE id=?").run(
                "same-count concurrent edit",
                "profile",
              );
            } finally {
              db.close();
            }
          },
        },
      ),
      /changed after review or backup/,
    );
    const db = new DatabaseSync(join(f.data, "mytuner.db"));
    try {
      assert.equal(rows(db, "media"), before);
      assert.equal(count(db, "sessions"), 1);
      assert.equal(
        db.prepare("SELECT cleanup_disabled FROM storage_safety_state").get()!
          .cleanup_disabled,
        0,
      );
    } finally {
      db.close();
    }
    assert.ok((await readdir(backup)).includes("manifest.json"));
  } finally {
    await f.cleanup();
  }
});

test("metadata parse failure rolls back transaction changes and protections", async () => {
  const f = await fixture();
  try {
    f.db.prepare("UPDATE media SET metadata_json='not-json'").run();
    const before = new Map(tables(f.db).map((t) => [t, rows(f.db, t)]));
    const request = f.request("metadata"),
      plan = planReset(f.store, f.admin, request, true);
    assert.throws(() =>
      applyResetTransaction(f.store, f.admin, request, plan.revision, [
        join(f.base, "new-root"),
      ]),
    );
    for (const t of tables(f.db)) assert.equal(rows(f.db, t), before.get(t), t);
  } finally {
    await f.cleanup();
  }
});

test("unknown table, view or trigger and legacy/future schema refuse before backup", async () => {
  for (const ddl of [
    "CREATE TABLE operator_table(content TEXT)",
    "CREATE VIEW foreign_view AS SELECT * FROM accounts",
    "CREATE TRIGGER foreign_delete AFTER DELETE ON media BEGIN DELETE FROM accounts; END",
    "PRAGMA user_version=20",
    "PRAGMA user_version=999",
  ]) {
    const f = await fixture();
    try {
      f.db.exec(ddl);
      f.close();
      await assert.rejects(
        previewOfflineReset(f.data, f.request("fresh"), password),
      );
      assert.ok(!(await readdir(f.data)).includes("backups"));
    } finally {
      await f.cleanup();
    }
  }
});

test("owned runtime lock refuses offline open and second offline owner refuses", async () => {
  const f = await fixture();
  try {
    f.close();
    let release = await acquireDataLock(f.data);
    try {
      await assert.rejects(
        previewOfflineReset(f.data, f.request("fresh"), password),
      );
    } finally {
      await release();
    }
    const first = await openOfflineReset(f.data);
    try {
      await assert.rejects(openOfflineReset(f.data));
      await assert.rejects(acquireDataLock(f.data));
    } finally {
      await first.close();
    }
  } finally {
    await f.cleanup();
  }
});

test("backup failure before deletion and post-backup injected failure preserve database and unknown files", async () => {
  for (const fault of ["key", "post-backup"] as const) {
    const f = await fixture();
    try {
      const request = f.request("fresh");
      const before = rows(f.db, "media");
      if (fault === "key")
        f.db.prepare("UPDATE integrations SET encrypted_key='invalid'").run();
      f.close();
      const plan = await previewOfflineReset(f.data, request, password);
      await assert.rejects(
        executeOfflineReset(
          {
            dataRoot: f.data,
            request,
            password,
            revision: plan.revision,
            confirmation: plan.confirmationText,
          },
          {
            backupCreated: () => {
              throw Error("synthetic post-backup fault");
            },
          },
        ),
      );
      const db = new DatabaseSync(join(f.data, "mytuner.db"));
      try {
        assert.equal(rows(db, "media"), before);
        assert.equal(count(db, "accounts"), 3);
      } finally {
        db.close();
      }
      assert.ok((await readdir(join(f.data, "backups"))).length > 0);
    } finally {
      await f.cleanup();
    }
  }
});

test("restoring older verified bundle retains post-reset source protections and cleanup disablement", async () => {
  const f = await fixture();
  try {
    const old = await backupApplication(f.db, f.data);
    const request = f.request("fresh");
    f.close();
    const plan = await previewOfflineReset(f.data, request, password);
    await executeOfflineReset({
      dataRoot: f.data,
      request,
      password,
      revision: plan.revision,
      confirmation: plan.confirmationText,
    });
    await verifyApplicationBackup(old);
    await restoreApplication(f.data, old);
    const restored = new Store(join(f.data, "mytuner.db"));
    try {
      const safety = captureStorageSafety(restored);
      assert.ok(safety.cleanupDisabled);
      assert.ok(safety.protectedRoots.includes(f.source));
      assert.equal(count(restored.db, "media"), 1);
      assert.equal(count(restored.db, "sessions"), 0);
      assert.throws(() => assertSafeOutputRoot(restored, f.source));
    } finally {
      restored.close();
    }
  } finally {
    await f.cleanup();
  }
});

test("fault after SQL deletes rolls back the entire database transaction", async () => {
  const f = await fixture();
  try {
    const request = f.request("fresh"),
      plan = planReset(f.store, f.admin, request, true);
    const before = new Map(tables(f.db).map((t) => [t, rows(f.db, t)]));
    let observedDeleted = false;
    const wrapped = new Proxy(f.db, {
      get(target, property) {
        if (property === "prepare")
          return (sql: string) => {
            if (
              sql.startsWith(
                "UPDATE storage_safety_state SET cleanup_disabled=1",
              )
            ) {
              observedDeleted =
                count(target, "media") === 0 && count(target, "accounts") === 1;
              throw Error("fault after deletes");
            }
            return target.prepare(sql);
          };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    assert.throws(
      () =>
        applyResetTransaction(
          { db: wrapped, transaction: f.store.transaction.bind(f.store) },
          f.admin,
          request,
          plan.revision,
          [join(f.base, "new-root")],
        ),
      /fault after deletes/,
    );
    assert.ok(observedDeleted);
    for (const t of tables(f.db)) assert.equal(rows(f.db, t), before.get(t), t);
  } finally {
    await f.cleanup();
  }
});

test("fingerprinted reset backup cannot be silently changed after verification", async () => {
  const f = await fixture();
  try {
    const request = f.request("fresh");
    f.close();
    const plan = await previewOfflineReset(f.data, request, password);
    await assert.rejects(
      executeOfflineReset(
        {
          dataRoot: f.data,
          request,
          password,
          revision: plan.revision,
          confirmation: plan.confirmationText,
        },
        {
          backupCreated: async (bundle) => {
            const backup = new DatabaseSync(
              join(bundle.directory, "mytuner.db"),
            );
            try {
              backup
                .prepare(
                  "UPDATE accounts SET username='modified_backup' WHERE id=?",
                )
                .run(f.admin.id);
            } finally {
              backup.close();
            }
          },
        },
      ),
      /backup|fingerprint|changed/i,
    );
  } finally {
    await f.cleanup();
  }
});

for (const operation of ["verify", "restore"] as const)
  test(`recorded reset fingerprint rejects healthy same-count backup mutation on ${operation}`, async () => {
    const f = await fixture();
    try {
      const request = f.request("fresh");
      f.close();
      const plan = await previewOfflineReset(f.data, request, password);
      const result = await executeOfflineReset({
        dataRoot: f.data,
        request,
        password,
        revision: plan.revision,
        confirmation: plan.confirmationText,
      });
      const backup = new DatabaseSync(
        join(result.backup.directory, "mytuner.db"),
      );
      try {
        backup
          .prepare("UPDATE accounts SET username='modified_backup' WHERE id=?")
          .run(f.admin.id);
      } finally {
        backup.close();
      }
      await assert.rejects(
        operation === "verify"
          ? verifyApplicationBackup(result.backup.directory)
          : restoreApplication(f.data, result.backup.directory),
        /fingerprint|changed|integrity|match/i,
      );
    } finally {
      await f.cleanup();
    }
  });

test("retained administrator disabled during backup preparation prevents deletion", async () => {
  const f = await fixture();
  try {
    const request = f.request("fresh"),
      before = rows(f.db, "media");
    f.close();
    const plan = await previewOfflineReset(f.data, request, password);
    await assert.rejects(
      executeOfflineReset(
        {
          dataRoot: f.data,
          request,
          password,
          revision: plan.revision,
          confirmation: plan.confirmationText,
        },
        {
          backupCreated: () => {
            const db = new DatabaseSync(join(f.data, "mytuner.db"));
            try {
              db.prepare("UPDATE accounts SET disabled=1 WHERE id=?").run(
                f.admin.id,
              );
            } finally {
              db.close();
            }
          },
        },
      ),
      /active administrator|changed|retained account/i,
    );
    const db = new DatabaseSync(join(f.data, "mytuner.db"));
    try {
      assert.equal(rows(db, "media"), before);
      assert.equal(count(db, "accounts"), 3);
    } finally {
      db.close();
    }
  } finally {
    await f.cleanup();
  }
});

test("interrupted recovery of an older bundle unions journal protections with current reset protections", async () => {
  const f = await fixture();
  try {
    const old = await backupApplication(f.db, f.data),
      request = f.request("fresh");
    f.close();
    const plan = await previewOfflineReset(f.data, request, password);
    await executeOfflineReset({
      dataRoot: f.data,
      request,
      password,
      revision: plan.revision,
      confirmation: plan.confirmationText,
    });
    const historical = join(f.base, "journal-only-source");
    await writeFile(
      join(f.data, "restore.pending.json"),
      JSON.stringify({
        previous: old,
        quarantine: null,
        source: old,
        storageSafety: {
          cleanupDisabled: true,
          outputWritesDisabled: true,
          resetMs: 123,
          protectedRoots: [historical],
        },
      }),
    );
    await recoverInterruptedRestore(f.data);
    const restored = new Store(join(f.data, "mytuner.db"));
    try {
      const safety = captureStorageSafety(restored);
      assert.equal(safety.cleanupDisabled, true);
      assert.equal(safety.outputWritesDisabled, true);
      assert.ok(safety.protectedRoots.includes(historical));
      assert.ok(safety.protectedRoots.includes(f.source));
      assert.ok(safety.protectedRoots.includes(f.metadata));
      assert.ok(safety.protectedRoots.includes(f.subtitles));
      assert.equal(count(restored.db, "media"), 1);
    } finally {
      restored.close();
    }
    assert.ok(!(await readdir(f.data)).includes("restore.pending.json"));
  } finally {
    await f.cleanup();
  }
});

test("nonabsolute and overlapping source paths refuse without mutating physical sentinels", async () => {
  for (const path of ["../../videos", "DATA_OVERLAP", "METADATA_OVERLAP"]) {
    const f = await fixture();
    try {
      if (path === "METADATA_OVERLAP")
        f.db.prepare("UPDATE sources SET metadata_root=?").run(f.data);
      else
        f.db
          .prepare("UPDATE sources SET root_path=?")
          .run(path === "DATA_OVERLAP" ? f.data : path);
      f.close();
      await assert.rejects(
        previewOfflineReset(f.data, f.request("fresh"), password),
      );
      assert.ok(!(await readdir(f.data)).includes("backups"));
    } finally {
      await f.cleanup();
    }
  }
});

test("malformed reset manifest variants and wrong encryption-key bytes fail verify and restore before live mutation", async () => {
  const f = await fixture();
  try {
    const request = f.request("fresh");
    f.close();
    const plan = await previewOfflineReset(f.data, request, password);
    const result = await executeOfflineReset({
      dataRoot: f.data,
      request,
      password,
      revision: plan.revision,
      confirmation: plan.confirmationText,
    });
    const path = join(result.backup.directory, "manifest.json"),
      original = JSON.parse(await readFile(path, "utf8"));
    const live = await readFile(join(f.data, "mytuner.db")),
      liveKey = await readFile(join(f.data, "integration.key"));
    const variants = [
      { ...original, fingerprint: "0".repeat(64) },
      { ...original, fingerprint: "A".repeat(64) },
      { ...original, fingerprint: 1 },
      { ...original, fingerprint: "" },
      { ...original, fingerprint: "f".repeat(65) },
      { ...original, resetBackup: false },
      { ...original, extra: true },
      Object.fromEntries(
        Object.entries(original).filter(([key]) => key !== "fingerprint"),
      ),
      Object.fromEntries(
        Object.entries(original).filter(([key]) => key !== "resetBackup"),
      ),
    ];
    for (const manifest of variants) {
      await writeFile(path, JSON.stringify(manifest));
      await assert.rejects(verifyApplicationBackup(result.backup.directory));
      await assert.rejects(restoreApplication(f.data, result.backup.directory));
      assert.deepEqual(await readFile(join(f.data, "mytuner.db")), live);
      assert.deepEqual(
        await readFile(join(f.data, "integration.key")),
        liveKey,
      );
    }
    await writeFile(path, JSON.stringify(original));
    await writeFile(
      join(result.backup.directory, "integration.key"),
      Buffer.alloc(32, 8),
    );
    await assert.rejects(verifyApplicationBackup(result.backup.directory));
    await assert.rejects(restoreApplication(f.data, result.backup.directory));
    assert.deepEqual(await readFile(join(f.data, "mytuner.db")), live);
    assert.deepEqual(await readFile(join(f.data, "integration.key")), liveKey);
    assert.ok((await readdir(result.backup.directory)).includes("mytuner.db"));
  } finally {
    await f.cleanup();
  }
});
