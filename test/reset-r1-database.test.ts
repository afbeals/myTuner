import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
  stat,
  realpath,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store, schemaVersion } from "../src/database.js";
import type { Account, Media } from "../src/domain.js";
import { hashSecret, verifySecret, login } from "../src/security.js";
import Fastify from "fastify";
import { registerIdentity } from "../src/identity-routes.js";
import { registerResetRoutes } from "../src/reset-routes.js";
import {
  inspectMetadata,
  displayMedia,
  saveMetadata,
} from "../src/display-metadata.js";
import { showKey } from "../src/catalog-identity.js";
import {
  planReset,
  applyResetTransaction,
  assertResetSchema,
  type ResetCategory,
  type ResetRequest,
} from "../src/reset-data.js";
import {
  previewOfflineReset,
  executeOfflineReset,
} from "../src/reset-offline.js";
import { openOfflineReset } from "../src/reset-backup.js";
import {
  verifyApplicationBackup,
  restoreApplication,
} from "../src/recovery.js";
import { seal, unseal } from "../src/refresh.js";
import { acquireDataLock } from "../src/runtime-lock.js";

// Independent review fixtures: no production data, existing reset helpers, or network access.
const password = "synthetic-r1-password";
const passwordHash = hashSecret(password);
const key = Buffer.alloc(32, 27);
type Cleanup = { after: (callback: () => unknown) => void };
async function fixture(t: Cleanup, disk = false) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "mytuner-reset-r1-db-")),
  );
  const data = join(root, "data");
  await mkdir(data, { mode: 0o700 });
  const store = new Store(disk ? join(data, "mytuner.db") : ":memory:");
  let closed = false;
  const close = () => {
    if (!closed) {
      store.close();
      closed = true;
    }
  };
  t.after(async () => {
    close();
    await rm(root, { recursive: true, force: true });
  });
  const ids = Object.fromEntries(
    [
      "admin",
      "otherAdmin",
      "viewer",
      "profile",
      "otherProfile",
      "source",
      "media",
      "staleMedia",
      "channel",
      "revision",
      "entry",
      "collection",
      "job",
      "generation",
      "asset",
      "run",
      "playback",
      "event",
      "report",
      "integration",
    ].map((name) => [name, randomUUID()]),
  );
  const add = (table: string, values: Record<string, unknown>) => {
    store.db
      .prepare(
        `INSERT INTO ${table}(${Object.keys(values).join(",")}) VALUES(${Object.keys(
          values,
        )
          .map(() => "?")
          .join(",")})`,
      )
      .run(...(Object.values(values) as never[]));
  };
  // Alphabetically first admin is deliberately a different identity.
  const credentials = await passwordHash;
  add("accounts", {
    id: ids.otherAdmin,
    username: "aaa-first",
    password_hash: credentials,
    role: "admin",
    created_at: 1,
  });
  add("accounts", {
    id: ids.admin,
    username: "zz-retain",
    password_hash: credentials,
    role: "admin",
    created_at: 2,
  });
  add("accounts", {
    id: ids.viewer,
    username: "viewer",
    password_hash: credentials,
    role: "viewer",
    created_at: 3,
  });
  const actor: Account = {
    id: ids.admin!,
    username: "zz-retain",
    role: "admin",
    disabled: 0,
  };
  add("profiles", {
    id: ids.profile,
    name: "Current profile",
    kind: "person",
    owner_account_id: ids.admin,
    pin_hash: "synthetic-pin",
  });
  add("profiles", {
    id: ids.otherProfile,
    name: "Other profile",
    kind: "person",
    owner_account_id: ids.viewer,
  });
  add("profile_accounts", {
    profile_id: ids.profile,
    account_id: ids.admin,
    can_manage: 1,
  });
  add("profile_accounts", {
    profile_id: ids.otherProfile,
    account_id: ids.viewer,
    can_manage: 0,
  });
  const paths = [
    "source-media",
    "source-metadata",
    "source-subtitles",
    "generated",
    "cache",
    "unrelated",
  ].map((name) => join(root, name));
  for (const path of paths) await mkdir(path, { mode: 0o700 });
  const sentinels = [
    join(paths[0]!, "video.mp4"),
    join(paths[0]!, "video.nfo"),
    join(paths[1]!, "tvshow.nfo"),
    join(paths[2]!, "video.srt"),
    join(paths[3]!, "owned.mp4"),
    join(paths[3]!, "operator-family-video.mp4"),
    join(paths[4]!, "operator-file.bin"),
    join(paths[5]!, "holiday.mp4"),
    join(data, "operator-video.mp4"),
  ];
  for (const [index, path] of sentinels.entries())
    await writeFile(path, `SYNTHETIC sentinel ${index}\n`);
  await writeFile(join(data, "integration.key"), key, { mode: 0o600 });
  add("sources", {
    id: ids.source,
    name: "Shows",
    root_path: paths[0],
    kind: "shows",
    metadata_root: paths[1],
    subtitle_root: paths[2],
  });
  add("source_grants", {
    profile_id: ids.profile,
    source_id: ids.source,
    subtree: "",
  });
  add("source_grants", {
    profile_id: ids.otherProfile,
    source_id: ids.source,
    subtree: "",
  });
  const raw = {
    seriesId: 42,
    seriesTitle: "Provider show",
    seasonNumber: 2,
    episodeNumber: 3,
    overview: "Provider description",
    technical: { codec: "h264" },
    localNfoValid: true,
    local: { title: "NFO title" },
    integrationReference: { provider: "sonarr", externalId: "episode-42" },
  };
  add("media", {
    id: ids.media,
    source_id: ids.source,
    relative_path: "Different.folder/Season 2/Filename.S02E03.mp4",
    title: "Provider episode",
    duration_ms: 10000,
    size: 31,
    mtime_ms: 47,
    metadata_json: JSON.stringify(raw),
  });
  add("media", {
    id: ids.staleMedia,
    source_id: ids.source,
    relative_path: "Different.folder/Season 2/Filename.S02E04.mp4",
    title: "Stale episode",
    duration_ms: 9000,
    size: 32,
    mtime_ms: 48,
    metadata_json: JSON.stringify({ ...raw, episodeNumber: 4 }),
  });
  add("integrations", {
    id: ids.integration,
    source_id: ids.source,
    provider: "sonarr",
    url: "http://synthetic.invalid",
    encrypted_key: seal(key, "synthetic-key"),
    mappings_json: "[]",
    last_success: 123,
  });
  add("integration_metadata", {
    source_id: ids.source,
    provider: "sonarr",
    external_id: "episode-42",
    media_id: ids.media,
    metadata_json: JSON.stringify({
      seriesTitle: "Provider show",
      seriesOverview: "Provider overview",
      title: "Provider episode",
    }),
  });
  add("refresh_sources", {
    source_id: ids.source,
    interval_ms: 60000,
    next_run_ms: 124,
    last_error: null,
  });
  add("refresh_attempts", {
    source_id: ids.source,
    last_attempt_ms: 123,
    last_success_ms: 123,
  });
  add("integration_runs", {
    id: ids.run,
    source_id: ids.source,
    provider: "sonarr",
    completed_ms: 123,
    scan_complete: 1,
    summary_json: "{}",
  });
  add("integration_run_items", {
    run_id: ids.run,
    external_id: "episode-42",
    previous_media_id: null,
    matched_media_id: ids.media,
    state: "matched",
  });
  add("provider_suggestions", {
    connection_key: "suggestion",
    provider: "sonarr",
    url: "http://synthetic.invalid",
    roots_json: "[]",
    last_attempt_ms: 123,
  });
  add("subtitle_checks", {
    media_id: ids.media,
    revision: 1,
    checked_ms: 1,
    success_ms: 1,
  });
  add("subtitle_tracks", {
    media_id: ids.media,
    root_kind: "subtitles",
    relative_path: "video.srt",
    state_json: "{}",
  });
  add("generation_jobs", {
    id: ids.job,
    source_id: ids.source,
    directory: "",
    recursive: 1,
    status: "done",
    regenerate: 0,
    created_at: 1,
  });
  add("generation_items", {
    id: ids.generation,
    job_id: ids.job,
    media_id: ids.media,
    kind: "conversion",
    status: "done",
  });
  add("generated_assets", {
    id: ids.asset,
    media_id: ids.media,
    kind: "conversion",
    fingerprint: "synthetic",
    relative_path: "owned.mp4",
  });
  add("collections", {
    id: ids.collection,
    name: "Retained collection",
    owner_account_id: ids.viewer,
    deleted_ms: 1,
    expires_ms: 9999999999999,
  });
  add("collection_items", {
    collection_id: ids.collection,
    media_id: ids.media,
  });
  add("channels", {
    id: ids.channel,
    name: "Private channel",
    owner_account_id: ids.viewer,
    visibility: "private",
  });
  add("channel_items", { channel_id: ids.channel, media_id: ids.media });
  add("subscriptions", {
    profile_id: ids.profile,
    channel_id: ids.channel,
    position: 1,
  });
  add("schedule_revisions", {
    id: ids.revision,
    channel_id: ids.channel,
    created_at: 1,
    config_json: JSON.stringify({ collectionId: ids.collection }),
    state_json: "{}",
    profile_id: ids.otherProfile,
    author_account_id: ids.viewer,
  });
  add("schedule_entries", {
    id: ids.entry,
    revision_id: ids.revision,
    channel_id: ids.channel,
    media_id: ids.media,
    program_id: "program",
    start_ms: 1,
    end_ms: 1001,
    offset_ms: 0,
    kind: "program",
  });
  add("active_schedules", {
    channel_id: ids.channel,
    revision_id: ids.revision,
  });
  add("schedule_checkpoints", {
    revision_id: ids.revision,
    program_id: "program",
    end_ms: 1001,
    state_json: "{}",
  });
  add("rotation_state", { channel_id: ids.channel, state_json: "{}" });
  add("sessions", {
    token_hash: "session",
    account_id: ids.admin,
    expires_at: 9999999999999,
  });
  add("profile_unlocks", {
    session_hash: "session",
    profile_id: ids.profile,
    expires_ms: 9999999999999,
  });
  add("device_pairings", {
    device_hash: "pairing",
    code_hash: "code",
    device_name: "Synthetic",
    expires_ms: 9999999999999,
    account_id: ids.viewer,
  });
  add("login_attempts", { key: "viewer", failures: 1, window_start: 1 });
  add("playback_sessions", {
    id: ids.playback,
    account_id: ids.viewer,
    profile_id: ids.otherProfile,
    channel_id: ids.channel,
    revision_id: ids.revision,
    position_ms: 1,
    anchor_ms: 1,
    paused: 0,
    last_seen: 1,
    auth_session_hash: "session",
  });
  add("playback_events", {
    id: ids.event,
    session_id: ids.playback,
    account_id: ids.viewer,
    channel_id: ids.channel,
    entry_id: ids.entry,
    start_ms: 1,
    end_ms: 2,
    created_ms: 2,
    media_id: ids.media,
  });
  add("problem_reports", {
    id: ids.report,
    account_id: ids.viewer,
    request_id: "report",
    profile_id: ids.otherProfile,
    channel_id: ids.channel,
    media_id: ids.media,
    created_ms: 1,
    summary_json: "{}",
  });
  add("catalog_projection_rows", {
    generation: 1,
    media_id: ids.media,
    source_id: ids.source,
    relative_path: "projection",
    sort_title: "projection",
    available: 1,
    show_key: "series:42",
    data_json: "{}",
    byte_length: 2,
  });
  add("catalog_projection_members", {
    generation: 1,
    media_id: ids.media,
    kind: "show",
    group_key: "series:42",
  });
  add("catalog_projection_dirty_shows", {
    source_id: ids.source,
    show_key: "series:42",
  });
  add("protected_source_roots", { path: join(root, "historical-read-only") });
  const choices = {
    title: { source: "manual" as const, manual: "Custom title" },
    description: { source: "manual" as const, manual: "Custom description" },
  };
  for (const target of [
    { kind: "media" as const, mediaId: ids.media! },
    { kind: "show" as const, sourceId: ids.source!, key: "series:42" },
  ]) {
    const before = inspectMetadata(store, target);
    await saveMetadata(
      store,
      actor,
      ids.profile!,
      target,
      before.revision,
      choices,
    );
  }
  add("display_metadata", {
    target_key: `media:${ids.staleMedia}`,
    source_id: ids.source,
    identity: "previous-file-identity",
    state_json: JSON.stringify(choices),
    local_json: JSON.stringify({
      values: { title: "Old local" },
      status: "available",
    }),
  });
  const fileState = async () =>
    Object.fromEntries(
      await Promise.all(
        sentinels.map(async (path) => [
          path,
          {
            bytes: (await readFile(path)).toString("hex"),
            ino: (await stat(path)).ino,
          },
        ]),
      ),
    );
  return {
    root,
    data,
    store,
    close,
    actor,
    ids,
    paths,
    sentinels,
    fileState,
    request: (categories: ResetCategory[]): ResetRequest => ({
      mode: "selective",
      categories,
      retainedAdminId: actor.id,
    }),
  };
}
function rows(store: Pick<Store, "db">, table: string) {
  return store.db
    .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
    .all()
    .map((row) => ({ ...row }));
}
function snapshot(store: Pick<Store, "db">) {
  return Object.fromEntries(
    store.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => [String(row.name), rows(store, String(row.name))]),
  );
}
const channelTables = [
  "subscriptions",
  "active_schedules",
  "schedule_checkpoints",
  "schedule_entries",
  "rotation_state",
  "channel_items",
  "schedule_revisions",
  "channels",
];
const activityTables = [
  "playback_events",
  "problem_reports",
  "playback_sessions",
];
const collectionTables = ["collection_items", "collections"];
const metadataTables = [
  "integration_run_items",
  "integration_runs",
  "integration_metadata",
  "provider_suggestions",
];
const catalogTables = [
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
];
const sourceTables = [
  "refresh_sources",
  "integrations",
  "provider_suggestions",
  "source_grants",
  "sources",
];
const accountTables = [
  "profile_accounts",
  "source_grants",
  "profiles",
  "login_attempts",
];
const alwaysChanged = [
  "profile_unlocks",
  "device_pairings",
  "sessions",
  "playback_sessions",
  "catalog_projection_rows",
  "catalog_projection_members",
  "catalog_projection_dirty_media",
  "catalog_projection_dirty_sources",
  "catalog_projection_dirty_shows",
  "catalog_projection_state",
  "catalog_revision",
  "storage_safety_state",
  "protected_source_roots",
];
const matrix: {
  category: ResetCategory;
  effective: ResetCategory[];
  remove: string[];
  mutate?: string[];
}[] = [
  {
    category: "metadata",
    effective: ["metadata", "channels", "activity"],
    remove: [...metadataTables, ...channelTables, ...activityTables],
    mutate: ["media", "display_metadata", "integrations"],
  },
  {
    category: "custom",
    effective: ["custom"],
    remove: [],
    mutate: ["display_metadata"],
  },
  {
    category: "catalog",
    effective: [
      "metadata",
      "custom",
      "catalog",
      "collections",
      "channels",
      "activity",
    ],
    remove: [
      ...catalogTables,
      ...metadataTables,
      ...collectionTables,
      ...channelTables,
      ...activityTables,
    ],
  },
  {
    category: "sources",
    effective: [
      "metadata",
      "custom",
      "catalog",
      "sources",
      "collections",
      "channels",
      "activity",
    ],
    remove: [
      ...catalogTables,
      ...metadataTables,
      ...sourceTables,
      ...collectionTables,
      ...channelTables,
      ...activityTables,
    ],
  },
  {
    category: "collections",
    effective: ["collections", "channels", "activity"],
    remove: [...collectionTables, ...channelTables, ...activityTables],
  },
  {
    category: "channels",
    effective: ["channels", "activity"],
    remove: [...channelTables, ...activityTables],
  },
  { category: "activity", effective: ["activity"], remove: activityTables },
  {
    category: "accounts",
    effective: ["collections", "channels", "activity", "accounts"],
    remove: [
      ...accountTables,
      ...collectionTables,
      ...channelTables,
      ...activityTables,
    ],
    mutate: ["accounts"],
  },
];
for (const entry of matrix)
  test(`independent R1 category ${entry.category}: dependencies, exact unselected rows, physical sentinels`, async (t) => {
    const f = await fixture(t);
    const before = snapshot(f.store),
      files = await f.fileState(),
      request = f.request([entry.category]);
    const plan = planReset(f.store, f.actor, request, true);
    assert.deepEqual(plan.effectiveCategories, entry.effective);
    for (const category of entry.effective.filter(
      (item) => item !== entry.category,
    ))
      assert(
        plan.dependencies.some(
          (dependency) => dependency.category === category,
        ),
        `visible dependency ${category}`,
      );
    applyResetTransaction(f.store, f.actor, request, plan.revision);
    const changed = new Set([
      ...alwaysChanged,
      ...entry.remove,
      ...(entry.mutate ?? []),
    ]);
    for (const [table, beforeRows] of Object.entries(before))
      if (!changed.has(table))
        assert.deepEqual(
          rows(f.store, table),
          beforeRows,
          `unselected ${table}`,
        );
    for (const table of entry.remove)
      assert.equal(rows(f.store, table).length, 0, `removed ${table}`);
    if (entry.category === "custom") {
      for (const row of rows(f.store, "display_metadata")) {
        const previous = before.display_metadata!.find(
          (saved) => saved.target_key === row.target_key,
        )!;
        assert.deepEqual(JSON.parse(String(row.state_json)), {
          title: { source: "automatic" },
          description: { source: "automatic" },
        });
        assert.equal(row.local_json, previous.local_json);
        assert.equal(row.identity, previous.identity);
        assert.equal(row.checked_ms, previous.checked_ms);
        assert.equal(row.revision, Number(previous.revision) + 1);
      }
    }
    for (const table of [
      "profile_unlocks",
      "device_pairings",
      "sessions",
      "playback_sessions",
      "catalog_projection_rows",
      "catalog_projection_members",
      "catalog_projection_dirty_media",
      "catalog_projection_dirty_sources",
      "catalog_projection_dirty_shows",
    ])
      assert.equal(rows(f.store, table).length, 0, `always cleared ${table}`);
    assert.deepEqual(
      rows(f.store, "accounts").find((row) => row.id === f.actor.id),
      before.accounts!.find((row) => row.id === f.actor.id),
    );
    assert(
      Number(
        f.store.db
          .prepare(
            "SELECT count(*) AS n FROM accounts WHERE role='admin' AND disabled=0",
          )
          .get()!.n,
      ) >= 1,
    );
    assert.equal(
      f.store.db.prepare("PRAGMA user_version").get()!.user_version,
      schemaVersion,
    );
    assert.equal(
      f.store.db.prepare("PRAGMA foreign_key_check").all().length,
      0,
    );
    assert.equal(
      f.store.db.prepare("PRAGMA integrity_check").get()!.integrity_check,
      "ok",
    );
    assert.equal(rows(f.store, "storage_safety_state")[0]!.cleanup_disabled, 1);
    for (const path of f.paths.slice(0, 3))
      assert(
        rows(f.store, "protected_source_roots").some(
          (row) => row.path === path,
        ),
      );
    assert.deepEqual(await f.fileState(), files);
  });

test("independent R1 metadata reset keeps custom media and show information reachable through real resolution", async (t) => {
  const f = await fixture(t),
    target = {
      kind: "show" as const,
      sourceId: f.ids.source!,
      key: "series:42",
    };
  const before = inspectMetadata(f.store, target);
  const orderBefore = f.store.db
    .prepare(
      "SELECT id,title,source_id,relative_path,size,mtime_ms,duration_ms,available FROM media ORDER BY title,id",
    )
    .all();
  assert.equal(before.effective.title.value, "Custom title");
  const request = f.request(["metadata"]),
    plan = planReset(f.store, f.actor, request, true);
  applyResetTransaction(f.store, f.actor, request, plan.revision);
  const item = f.store.db
    .prepare("SELECT * FROM media WHERE id=?")
    .get(f.ids.media!) as unknown as Media;
  assert.deepEqual(
    f.store.db
      .prepare(
        "SELECT id,title,source_id,relative_path,size,mtime_ms,duration_ms,available FROM media ORDER BY title,id",
      )
      .all(),
    orderBefore,
    "catalog identities, raw titles and ordering remain unchanged",
  );
  assert.equal(showKey(item), target.key);
  assert.equal(
    inspectMetadata(f.store, target).effective.title.value,
    "Custom title",
  );
  assert.equal(
    inspectMetadata(f.store, target).effective.description.value,
    "Custom description",
  );
  const mediaInfo = inspectMetadata(f.store, {
    kind: "media",
    mediaId: item.id,
  });
  assert.equal(mediaInfo.requiresReview, false);
  assert.equal(mediaInfo.effective.title.value, "Custom title");
  assert.equal(mediaInfo.effective.description.value, "Custom description");
  const displayed = displayMedia(f.store, item);
  assert.equal(JSON.parse(displayed.metadata_json).seriesTitle, "Custom title");
  assert.equal(JSON.parse(displayed.metadata_json).technical.codec, "h264");
  const raw = JSON.parse(item.metadata_json);
  for (const field of [
    "title",
    "overview",
    "local",
    "localNfoValid",
    "integrationReference",
    "images",
  ])
    assert.equal(
      raw[field],
      undefined,
      `cleared descriptive candidate ${field}`,
    );
  for (const saved of rows(f.store, "display_metadata")) {
    assert.equal(saved.local_json, null);
    assert.equal(saved.checked_ms, null);
  }
  assert.equal(rows(f.store, "integrations")[0]!.last_success, null);
  assert.equal(
    inspectMetadata(f.store, { kind: "media", mediaId: f.ids.staleMedia! })
      .requiresReview,
    true,
  );
});

test("independent R1 fresh retains named current admin credentials, never alphabetical first", async (t) => {
  const f = await fixture(t),
    before = rows(f.store, "accounts").find((row) => row.id === f.actor.id),
    files = await f.fileState();
  const request: ResetRequest = {
    mode: "fresh",
    categories: [],
    retainedAdminId: f.actor.id,
  };
  const plan = planReset(f.store, f.actor, request, true);
  assert.equal(plan.retainedAdmin.username, "zz-retain");
  applyResetTransaction(f.store, f.actor, request, plan.revision);
  assert.deepEqual(rows(f.store, "accounts"), [before]);
  assert(
    await verifySecret(
      password,
      String(rows(f.store, "accounts")[0]!.password_hash),
    ),
  );
  for (const table of [
    ...catalogTables,
    ...sourceTables,
    ...collectionTables,
    ...channelTables,
    ...activityTables,
    ...accountTables,
  ])
    assert.equal(rows(f.store, table).length, 0);
  assert.deepEqual(await f.fileState(), files);
});

test("independent R1 stale preview rejects same-count edits and preserves all rows", async (t) => {
  const f = await fixture(t),
    request = f.request(["activity"]),
    plan = planReset(f.store, f.actor, request, true);
  f.store.db.prepare("UPDATE playback_events SET end_ms=end_ms+1").run();
  const edited = snapshot(f.store);
  assert.throws(
    () => applyResetTransaction(f.store, f.actor, request, plan.revision),
    /changed after review/,
  );
  assert.deepEqual(snapshot(f.store), edited);
});

test("independent R1 explicit current active admin required; mismatched/disabled/demoted identities cannot leave zero admin", async (t) => {
  const f = await fixture(t),
    initial = snapshot(f.store);
  assert.throws(
    () =>
      planReset(
        f.store,
        f.actor,
        { ...f.request(["accounts"]), retainedAdminId: f.ids.otherAdmin! },
        true,
      ),
    /currently authenticated/,
  );
  assert.throws(
    () =>
      planReset(
        f.store,
        { ...f.actor, id: f.ids.viewer! },
        { ...f.request(["accounts"]), retainedAdminId: f.ids.viewer! },
        true,
      ),
    /current active administrator/,
  );
  f.store.db
    .prepare("UPDATE accounts SET disabled=1 WHERE id=?")
    .run(f.actor.id);
  assert.throws(
    () => planReset(f.store, f.actor, f.request(["accounts"]), true),
    /current active administrator/,
  );
  f.store.db
    .prepare("UPDATE accounts SET disabled=0,role='viewer' WHERE id=?")
    .run(f.actor.id);
  assert.throws(
    () => planReset(f.store, f.actor, f.request(["accounts"]), true),
    /current active administrator/,
  );
  f.store.db
    .prepare("UPDATE accounts SET role='admin' WHERE id=?")
    .run(f.actor.id);
  assert.deepEqual(snapshot(f.store), initial);
});

test("independent R1 rollback after actual row deletes and root insertion restores complete row state", async (t) => {
  const f = await fixture(t),
    request = f.request(["sources"]),
    plan = planReset(f.store, f.actor, request, true),
    before = snapshot(f.store),
    files = await f.fileState();
  let deletes = 0;
  const db = new Proxy(f.store.db, {
    get(target, prop) {
      if (prop === "prepare")
        return (sql: string) => {
          if (sql.startsWith("DELETE FROM")) {
            deletes++;
            if (deletes === 6)
              throw Error("independent synthetic failure after five deletes");
          }
          return target.prepare(sql);
        };
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  assert.throws(
    () =>
      applyResetTransaction(
        { db, transaction: f.store.transaction.bind(f.store) },
        f.actor,
        request,
        plan.revision,
      ),
    /after five deletes/,
  );
  assert.equal(deletes, 6);
  assert.deepEqual(snapshot(f.store), before);
  assert.deepEqual(await f.fileState(), files);
});

test("independent R1 unknown table, view, trigger, altered schema, future version and disabled FK are refused", async (t) => {
  for (const change of [
    "CREATE TABLE operator_notes(note TEXT)",
    "CREATE VIEW operator_view AS SELECT * FROM accounts",
    "CREATE TRIGGER operator_trigger AFTER DELETE ON media BEGIN DELETE FROM accounts; END;",
    "ALTER TABLE accounts ADD COLUMN operator_note TEXT",
    `PRAGMA user_version=${schemaVersion + 1}`,
    "PRAGMA foreign_keys=OFF",
  ]) {
    const f = await fixture(t);
    f.store.db.exec(change);
    const before = snapshot(f.store),
      files = await f.fileState();
    assert.throws(
      () => assertResetSchema(f.store),
      /schema|foreign-key|definitions/,
    );
    assert.throws(
      () => planReset(f.store, f.actor, f.request(["sources"]), true),
      /schema|foreign-key|definitions/,
    );
    assert.deepEqual(snapshot(f.store), before);
    assert.deepEqual(await f.fileState(), files);
  }
});

test("independent R1 offline authentication, stale revision and confirmation failures preserve rows and never create backup", async (t) => {
  const f = await fixture(t, true),
    request = f.request(["activity"]),
    before = snapshot(f.store),
    files = await f.fileState();
  f.close();
  for (const secret of ["", "incorrect-password", "x".repeat(1025)])
    await assert.rejects(
      previewOfflineReset(f.data, request, secret),
      /password|confirmation/,
    );
  for (const retainedAdminId of [f.ids.viewer!, randomUUID()])
    await assert.rejects(
      previewOfflineReset(f.data, { ...request, retainedAdminId }, password),
      /identity or password/,
    );
  const plan = await previewOfflineReset(f.data, request, password);
  assert.equal(plan.revisionScope, "offline-full");
  for (const [revision, confirmation, pattern] of [
    [plan.revision, "RESET aaa-first", /confirmation/],
    ["0".repeat(64), plan.confirmationText, /changed since/],
  ] as const)
    await assert.rejects(
      executeOfflineReset({
        dataRoot: f.data,
        request,
        password,
        revision,
        confirmation,
      }),
      pattern,
    );
  const db = new DatabaseSync(join(f.data, "mytuner.db"), { readOnly: true });
  try {
    assert.deepEqual(snapshot({ db }), before);
  } finally {
    db.close();
  }
  assert(!(await readdir(f.data)).includes("backups"));
  assert.deepEqual(await f.fileState(), files);
});

test("independent R1 offline refuses live owner lock and releases its own lock after failed auth", async (t) => {
  const f = await fixture(t, true),
    request = f.request(["custom"]);
  f.close();
  // Pre-initialize the otherwise empty lock DB so this exercises the actual owner lock, rather than the earlier hot-journal refusal.
  const initialLock = new DatabaseSync(join(f.data, "runtime-lock.db"));
  initialLock.exec("VACUUM");
  initialLock.close();
  const release = await acquireDataLock(f.data);
  try {
    await assert.rejects(
      previewOfflineReset(f.data, request, password),
      /in use/,
    );
  } finally {
    await release();
  }
  await assert.rejects(
    previewOfflineReset(f.data, request, "incorrect-password"),
    /identity or password/,
  );
  assert.equal(
    (await previewOfflineReset(f.data, request, password)).retainedAdmin.id,
    f.actor.id,
  );
});

test("independent R1 apply makes verified recoverable backup, retains old backups and physical sentinels", async (t) => {
  const f = await fixture(t, true),
    request = f.request(["sources"]),
    before = snapshot(f.store),
    files = await f.fileState();
  await mkdir(join(f.data, "backups"), { mode: 0o700 });
  await writeFile(
    join(f.data, "backups", "operator-archive.mp4"),
    "synthetic prior archive",
  );
  f.close();
  const plan = await previewOfflineReset(f.data, request, password);
  const result = await executeOfflineReset({
    dataRoot: f.data,
    request,
    password,
    revision: plan.revision,
    confirmation: plan.confirmationText,
  });
  assert.equal(result.reset, true);
  assert.equal(
    (await verifyApplicationBackup(result.backup.directory)).status,
    "valid",
  );
  const backup = new DatabaseSync(join(result.backup.directory, "mytuner.db"), {
    readOnly: true,
  });
  try {
    assert.deepEqual(snapshot({ db: backup }), before);
  } finally {
    backup.close();
  }
  const backedKey = await readFile(
    join(result.backup.directory, "integration.key"),
  );
  assert.deepEqual(backedKey, key);
  const manifest = JSON.parse(
    await readFile(join(result.backup.directory, "manifest.json"), "utf8"),
  );
  assert.equal(
    manifest.fingerprint,
    createHash("sha256")
      .update(await readFile(join(result.backup.directory, "mytuner.db")))
      .update(key)
      .digest("hex"),
  );
  const restored = join(f.root, "restore-target");
  await restoreApplication(restored, result.backup.directory);
  const db = new DatabaseSync(join(restored, "mytuner.db"), { readOnly: true });
  try {
    assert.deepEqual(rows({ db }, "media"), before.media);
    assert.deepEqual(rows({ db }, "accounts"), before.accounts);
    assert.equal(
      unseal(
        await readFile(join(restored, "integration.key")),
        String(rows({ db }, "integrations")[0]!.encrypted_key),
      ),
      "synthetic-key",
    );
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally {
    db.close();
  }
  assert.equal(
    await readFile(join(f.data, "backups", "operator-archive.mp4"), "utf8"),
    "synthetic prior archive",
  );
  assert.deepEqual(await f.fileState(), files);
});

test("independent R1 backup verification failure preserves live DB and retains incomplete evidence", async (t) => {
  const f = await fixture(t, true),
    request = f.request(["sources"]);
  f.store.db
    .prepare("UPDATE integrations SET encrypted_key='invalid ciphertext'")
    .run();
  const before = snapshot(f.store),
    files = await f.fileState();
  f.close();
  const plan = await previewOfflineReset(f.data, request, password);
  await assert.rejects(
    executeOfflineReset({
      dataRoot: f.data,
      request,
      password,
      revision: plan.revision,
      confirmation: plan.confirmationText,
    }),
  );
  const db = new DatabaseSync(join(f.data, "mytuner.db"), { readOnly: true });
  try {
    assert.deepEqual(snapshot({ db }), before);
  } finally {
    db.close();
  }
  const bundles = await readdir(join(f.data, "backups"));
  assert.equal(bundles.length, 1);
  assert(
    (await readdir(join(f.data, "backups", bundles[0]!))).includes(
      "mytuner.db",
    ),
  );
  assert(
    !(await readdir(join(f.data, "backups", bundles[0]!))).includes(
      "manifest.json",
    ),
  );
  assert.deepEqual(await f.fileState(), files);
});

test("independent R1 post-backup failure leaves verified backup and unchanged live rows", async (t) => {
  const f = await fixture(t, true),
    request = f.request(["activity"]),
    before = snapshot(f.store),
    files = await f.fileState();
  f.close();
  const plan = await previewOfflineReset(f.data, request, password);
  let directory = "";
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
        backupCreated(backup) {
          directory = backup.directory;
          throw Error("synthetic interruption after verified backup");
        },
      },
    ),
    /synthetic interruption/,
  );
  assert.equal((await verifyApplicationBackup(directory)).status, "valid");
  // Check lock reacquisition before read-only SQLite inspection, which may itself leave WAL bookkeeping sidecars.
  const context = await openOfflineReset(f.data);
  await context.close();
  const db = new DatabaseSync(join(f.data, "mytuner.db"), { readOnly: true });
  try {
    assert.deepEqual(snapshot({ db }), before);
  } finally {
    db.close();
  }
  assert.deepEqual(await f.fileState(), files);
});

test("independent R1 a same-count edit after backup aborts transaction and retains reviewed backup", async (t) => {
  const f = await fixture(t, true),
    request = f.request(["activity"]),
    before = snapshot(f.store),
    files = await f.fileState();
  f.close();
  const plan = await previewOfflineReset(f.data, request, password);
  let directory = "";
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
        backupCreated(backup) {
          directory = backup.directory;
          const db = new DatabaseSync(join(f.data, "mytuner.db"));
          try {
            db.prepare("UPDATE playback_events SET end_ms=end_ms+1").run();
          } finally {
            db.close();
          }
        },
      },
    ),
    /changed after review/,
  );
  const backup = new DatabaseSync(join(directory, "mytuner.db"), {
    readOnly: true,
  });
  try {
    assert.deepEqual(snapshot({ db: backup }), before);
  } finally {
    backup.close();
  }
  const db = new DatabaseSync(join(f.data, "mytuner.db"), { readOnly: true });
  try {
    const current = snapshot({ db });
    assert.deepEqual(
      current.playback_events,
      before.playback_events!.map((row) => ({
        ...row,
        end_ms: Number(row.end_ms) + 1,
      })),
    );
    delete current.playback_events;
    delete before.playback_events;
    assert.deepEqual(current, before);
  } finally {
    db.close();
  }
  assert.equal((await verifyApplicationBackup(directory)).status, "valid");
  assert.deepEqual(await f.fileState(), files);
});

test("independent R1 offline disabled/demoted admin refuses even with matching password and preserves sole remaining admin", async (t) => {
  for (const change of ["disabled=1", "role='viewer'"]) {
    const f = await fixture(t, true),
      request = f.request(["accounts"]);
    f.store.db
      .prepare(`UPDATE accounts SET ${change} WHERE id=?`)
      .run(f.actor.id);
    const before = snapshot(f.store);
    f.close();
    await assert.rejects(
      previewOfflineReset(f.data, request, password),
      /identity or password/,
    );
    const db = new DatabaseSync(join(f.data, "mytuner.db"), { readOnly: true });
    try {
      assert.deepEqual(snapshot({ db }), before);
      assert.equal(
        db
          .prepare(
            "SELECT count(*) AS n FROM accounts WHERE role='admin' AND disabled=0",
          )
          .get()!.n,
        1,
      );
    } finally {
      db.close();
    }
    assert(!(await readdir(f.data)).includes("backups"));
  }
});

test("independent R1 real HTTP identity gates preview, uses explicit current admin and exposes no execution route", async (t) => {
  const f = await fixture(t),
    app = Fastify();
  const actor = registerIdentity(app, f.store);
  registerResetRoutes(app, f.store, actor);
  t.after(() => app.close());
  const adminToken = (await login(f.store, "zz-retain", password)).token;
  const viewerToken = (await login(f.store, "viewer", password)).token;
  const headers = { authorization: `Bearer ${adminToken}` };
  const before = snapshot(f.store),
    files = await f.fileState();
  for (const [method, url] of [
    ["GET", "/api/admin/reset/options"],
    ["POST", "/api/admin/reset/preview"],
  ] as const) {
    assert.equal(
      (
        await app.inject({
          method,
          url,
          ...(method === "POST" ? { payload: f.request(["sources"]) } : {}),
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method,
          url,
          headers: { authorization: `Bearer ${viewerToken}` },
          ...(method === "POST"
            ? {
                payload: {
                  ...f.request(["sources"]),
                  retainedAdminId: f.ids.viewer,
                },
              }
            : {}),
        })
      ).statusCode,
      403,
    );
  }
  const options = await app.inject({
    url: "/api/admin/reset/options",
    headers,
  });
  assert.equal(options.statusCode, 200);
  assert.deepEqual(options.json().retainedAdmin, {
    id: f.actor.id,
    username: "zz-retain",
  });
  const preview = await app.inject({
    method: "POST",
    url: "/api/admin/reset/preview",
    headers,
    payload: f.request(["sources"]),
  });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.json().execution, "offline-only");
  assert.equal(preview.json().revisionScope, "live-summary");
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/admin/reset/preview",
        headers,
        payload: {
          ...f.request(["accounts"]),
          retainedAdminId: f.ids.otherAdmin,
        },
      })
    ).statusCode,
    403,
  );
  for (const url of [
    "/api/admin/reset",
    "/api/admin/reset/apply",
    "/api/admin/reset/execute",
  ])
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url,
          headers,
          payload: f.request(["sources"]),
        })
      ).statusCode,
      404,
    );
  assert.deepEqual(
    snapshot(f.store),
    before,
    "preview/auth rejection cannot persist a reset or mutate selected data",
  );
  assert.deepEqual(await f.fileState(), files);
  f.store.db
    .prepare("UPDATE accounts SET disabled=1 WHERE id=?")
    .run(f.actor.id);
  assert.equal(
    (await app.inject({ url: "/api/admin/reset/options", headers })).statusCode,
    401,
  );
});
