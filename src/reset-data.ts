import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { Store, schemaVersion } from "./database.js";
import type { Account } from "./domain.js";
import { invariant } from "./domain.js";
import { inspectMetadata } from "./display-metadata.js";
import type { Media } from "./domain.js";

type Database = Pick<Store, "db">;
export const resetCategoryIds = [
  "metadata",
  "custom",
  "catalog",
  "sources",
  "collections",
  "channels",
  "activity",
  "accounts",
] as const;
export type ResetCategory = (typeof resetCategoryIds)[number];
const category = z.enum(resetCategoryIds);
export const resetRequestSchema = z
  .object({
    mode: z.enum(["selective", "fresh"]),
    categories: z.array(category).max(resetCategoryIds.length),
    retainedAdminId: z.string().uuid(),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.categories).size !== value.categories.length)
      context.addIssue({
        code: "custom",
        path: ["categories"],
        message: "Choose distinct categories",
      });
    if (value.mode === "selective" && !value.categories.length)
      context.addIssue({
        code: "custom",
        path: ["categories"],
        message: "Choose at least one category",
      });
    if (value.mode === "fresh" && value.categories.length)
      context.addIssue({
        code: "custom",
        path: ["categories"],
        message:
          "Fresh start selects every category; send an empty category list",
      });
  });
export type ResetRequest = z.infer<typeof resetRequestSchema>;
type Dependency = { category: ResetCategory; reason: string };
export const resetCategories: {
  id: ResetCategory;
  label: string;
  description: string;
  requires: Dependency[];
}[] = [
  {
    id: "metadata",
    label: "Imported and local metadata",
    description:
      "Clear cached provider/NFO descriptive candidates; retain catalog/group identities, ordering, technical inspection and custom information.",
    requires: [
      {
        category: "channels",
        reason:
          "Removing provider/local candidates requires reviewing dependent channel programming before reuse.",
      },
    ],
  },
  {
    id: "custom",
    label: "Custom information",
    description:
      "Clear manually entered title/description drafts and field-source preferences; retain provider, local and technical snapshots.",
    requires: [],
  },
  {
    id: "catalog",
    label: "Catalog and discovery",
    description:
      "Remove indexed media, subtitle associations, scan history and derivative ownership/job records. Physical files remain in place.",
    requires: [
      {
        category: "metadata",
        reason: "Imported metadata references indexed media.",
      },
      {
        category: "custom",
        reason: "Custom information belongs to the catalog being removed.",
      },
      {
        category: "collections",
        reason: "Collections reference indexed media.",
      },
      {
        category: "channels",
        reason: "Programming and retained schedules reference indexed media.",
      },
      {
        category: "activity",
        reason: "Playback activity and reports reference indexed media.",
      },
    ],
  },
  {
    id: "sources",
    label: "Sources and integrations",
    description:
      "Remove source definitions, provider settings, mappings and profile source grants.",
    requires: [
      {
        category: "catalog",
        reason:
          "Indexed media and discovery records belong to source definitions.",
      },
    ],
  },
  {
    id: "collections",
    label: "Collections",
    description:
      "Remove saved exact-reference collections, including retained deleted collections.",
    requires: [
      {
        category: "channels",
        reason:
          "Saved programming can reference collections in configuration JSON.",
      },
    ],
  },
  {
    id: "channels",
    label: "Channels and programming",
    description:
      "Remove channels, rotations, revisions, schedules and subscriptions.",
    requires: [
      {
        category: "activity",
        reason:
          "Playback sessions, reports and history reference channels and schedules.",
      },
    ],
  },
  {
    id: "activity",
    label: "Playback and activity",
    description: "Remove playback sessions/events and problem reports.",
    requires: [],
  },
  {
    id: "accounts",
    label: "Accounts and profiles",
    description:
      "Remove profiles and accounts except the explicitly retained active administrator and existing credentials.",
    requires: [
      {
        category: "collections",
        reason: "Collections are owned by accounts being removed.",
      },
      {
        category: "channels",
        reason:
          "Channels, programming authors and profiles reference accounts being removed.",
      },
      {
        category: "activity",
        reason:
          "Playback and reports reference accounts and profiles being removed.",
      },
    ],
  },
];

let expectedSchema: { name: string; type: string; sql: string }[] | undefined;
function schema(database: Database) {
  return database.db
    .prepare(
      "SELECT name,type,sql FROM sqlite_master WHERE type IN ('table','trigger','view') AND name NOT LIKE 'sqlite_%' ORDER BY type,name",
    )
    .all()
    .map((row) => ({
      name: String(row.name),
      type: String(row.type),
      sql: String(row.sql).trim(),
    }));
}
/** A reset never guesses how an unknown schema, extension table or trigger behaves. */
export function assertResetSchema(database: Database) {
  invariant(
    Number(database.db.prepare("PRAGMA user_version").get()!.user_version) ===
      schemaVersion,
    409,
    "Reset requires the current myTuner schema. Start this server version normally to migrate, then stop it before offline reset.",
  );
  if (!expectedSchema) {
    const reference = new Store(":memory:");
    try {
      expectedSchema = schema(reference);
    } finally {
      reference.close();
    }
  }
  invariant(
    JSON.stringify(schema(database)) === JSON.stringify(expectedSchema),
    409,
    "Reset refused: database tables, views or trigger definitions do not match the recognized myTuner schema.",
  );
  invariant(
    database.db.prepare("PRAGMA foreign_keys").get()!.foreign_keys === 1,
    409,
    "Reset requires foreign-key enforcement",
  );
}
export function retainedResetAdministrator(
  database: Database,
  actor: Pick<Account, "id" | "role">,
  id = actor.id,
) {
  invariant(
    actor.role === "admin" && actor.id === id,
    403,
    "Retain the currently authenticated administrator explicitly",
  );
  const row = database.db
    .prepare("SELECT id,username,role,disabled FROM accounts WHERE id=?")
    .get(id);
  invariant(
    row && row.role === "admin" && row.disabled === 0,
    403,
    "The retained account must be the current active administrator",
  );
  return { id: String(row.id), username: String(row.username) };
}
export function resetOptions(database: Database, actor: Account) {
  assertResetSchema(database);
  return {
    execution: "offline-only",
    retainedAdmin: retainedResetAdministrator(database, actor),
    categories: resetCategories,
    instructions: resetInstructions,
  };
}
const resetInstructions = [
  "This browser page reviews database records only. It cannot execute or queue a reset.",
  "Stop the myTuner server/container completely before running the offline preview command in the same configured data directory.",
  "The offline tool asks for the named administrator’s password, recomputes exact counts and prints a full revision. Run its apply command with that offline revision, then type the displayed confirmation.",
  "Apply always creates and verifies a new recoverable backup before one foreign-key-checked database transaction. Failed or incomplete backup bundles are retained; no file cleanup is run.",
  "All account/device sessions and pairing codes are revoked. Restart myTuner and sign in with the retained administrator’s existing username/password.",
  "Original files, generated outputs, cache files and existing backups remain in place. Historical read-only roots remain protected and physical output cleanup is disabled after reset.",
];

type Operation = {
  table: string;
  action: "delete" | "update";
  where?: string;
  parameters?: string[];
  reason: string;
};
const deleteOrder = [
  "playback_events",
  "problem_reports",
  "playback_sessions",
  "subscriptions",
  "active_schedules",
  "schedule_checkpoints",
  "schedule_entries",
  "rotation_state",
  "channel_items",
  "schedule_revisions",
  "channels",
  "collection_items",
  "collections",
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
  "refresh_sources",
  "integrations",
  "provider_suggestions",
  "source_grants",
  "media",
  "sources",
  "profile_accounts",
  "profile_unlocks",
  "device_pairings",
  "sessions",
  "profiles",
  "accounts",
  "login_attempts",
];
function resetOperations(database: Database, request: ResetRequest) {
  const effective = new Set<ResetCategory>(
    request.mode === "fresh" ? resetCategoryIds : request.categories,
  );
  const dependencies: {
    category: ResetCategory;
    requiredBy: ResetCategory;
    reason: string;
  }[] = [];
  for (let changed = true; changed;) {
    changed = false;
    for (const descriptor of resetCategories)
      if (effective.has(descriptor.id))
        for (const required of descriptor.requires) {
          if (!effective.has(required.category)) {
            effective.add(required.category);
            changed = true;
          }
          if (
            !dependencies.some(
              (row) =>
                row.category === required.category &&
                row.requiredBy === descriptor.id,
            )
          )
            dependencies.push({ ...required, requiredBy: descriptor.id });
        }
  }
  const operations = new Map<string, Operation>();
  const remove = (tables: string[], reason: string) => {
    for (const table of tables)
      operations.set(table, { table, action: "delete", reason });
  };
  const update = (table: string, reason: string) => {
    if (!operations.has(table))
      operations.set(table, { table, action: "update", reason });
  };
  remove(
    ["profile_unlocks", "device_pairings", "sessions"],
    "Every reset revokes account/device sessions, profile unlocks and pending pairing codes.",
  );
  if (effective.has("activity"))
    remove(
      ["playback_events", "problem_reports", "playback_sessions"],
      "Playback/activity records selected or required by another category.",
    );
  // Auth-session revocation also ends retained playback, even when other activity is kept.
  remove(
    ["playback_sessions"],
    "Session revocation ends device playback; delivered events and reports remain unless activity is selected.",
  );
  if (effective.has("channels"))
    remove(
      [
        "subscriptions",
        "active_schedules",
        "schedule_checkpoints",
        "schedule_entries",
        "rotation_state",
        "channel_items",
        "schedule_revisions",
        "channels",
      ],
      "Channels and all dependent programming/schedule references.",
    );
  if (effective.has("collections"))
    remove(
      ["collection_items", "collections"],
      "Saved and retained-deleted collection references.",
    );
  if (effective.has("metadata")) {
    remove(
      [
        "integration_run_items",
        "integration_runs",
        "integration_metadata",
        "provider_suggestions",
      ],
      "Cached provider/NFO metadata and import diagnostics.",
    );
    update(
      "media",
      "Clear descriptive candidates while preserving indexed titles, catalog/group identities, ordering and technical metadata.",
    );
    update(
      "display_metadata",
      "Clear cached local candidates while retaining custom choices/manual text.",
    );
    update(
      "integrations",
      "Clear last-import success without removing provider settings or keys.",
    );
  }
  if (effective.has("custom"))
    update(
      "display_metadata",
      "Reset custom text and field-source preferences; retain unrelated local/provider snapshots.",
    );
  if (effective.has("catalog"))
    remove(
      [
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
      "Catalog/discovery records and database-only derivative/job references; output files are retained.",
    );
  if (effective.has("sources"))
    remove(
      [
        "refresh_sources",
        "integrations",
        "provider_suggestions",
        "source_grants",
        "sources",
      ],
      "Source/integration configuration and source grants.",
    );
  if (effective.has("accounts")) {
    remove(
      [
        "profile_accounts",
        "source_grants",
        "profiles",
        "login_attempts",
        "accounts",
      ],
      "Accounts/profiles and grants except the explicitly retained administrator.",
    );
    operations.set("accounts", {
      table: "accounts",
      action: "delete",
      where: "id<>?",
      parameters: [request.retainedAdminId],
      reason:
        "Retain the named current administrator with unchanged credentials; remove all other accounts.",
    });
  }
  // Rebuild derived catalog state without changing schema/format bookkeeping.
  remove(
    [
      "catalog_projection_rows",
      "catalog_projection_members",
      "catalog_projection_dirty_media",
      "catalog_projection_dirty_sources",
      "catalog_projection_dirty_shows",
    ],
    "Invalidate derived search state; rebuild it from surviving authorized database records after restart.",
  );
  update(
    "catalog_projection_state",
    "Advance the index generation and reset only rebuild progress.",
  );
  update(
    "catalog_revision",
    "Advance the catalog revision; never rewind migration or revision bookkeeping.",
  );
  update(
    "storage_safety_state",
    "Disable physical output cleanup; retain historical read-only roots.",
  );
  const ordered = [...operations.values()].sort(
    (a, b) => deleteOrder.indexOf(a.table) - deleteOrder.indexOf(b.table),
  );
  return {
    effectiveCategories: resetCategoryIds.filter((id) => effective.has(id)),
    dependencies,
    operations: ordered,
  };
}
function databaseRevision(
  database: Database,
  request: ResetRequest,
  full: boolean,
) {
  const hash = createHash("sha256").update(JSON.stringify(request));
  for (const definition of expectedSchema!.filter(
    (row) => row.type === "table",
  )) {
    hash.update(definition.name);
    if (full) {
      for (const row of database.db
        .prepare(`SELECT * FROM "${definition.name}" ORDER BY rowid`)
        .iterate())
        hash.update(JSON.stringify(row));
    } else
      hash.update(
        JSON.stringify(
          database.db
            .prepare(`SELECT COUNT(*) AS count FROM "${definition.name}"`)
            .get(),
        ),
      );
  }
  hash.update(
    JSON.stringify(
      database.db
        .prepare("SELECT revision FROM catalog_revision WHERE id=1")
        .get(),
    ),
  );
  hash.update(
    JSON.stringify(
      database.db
        .prepare(
          "SELECT id,username,role,disabled,password_hash FROM accounts WHERE id=?",
        )
        .get(request.retainedAdminId),
    ),
  );
  return hash.digest("hex");
}
export function planReset(
  database: Database,
  actor: Account,
  input: ResetRequest,
  fullRevision = false,
) {
  const request = resetRequestSchema.parse(input);
  assertResetSchema(database);
  const retainedAdmin = retainedResetAdministrator(
    database,
    actor,
    request.retainedAdminId,
  );
  const plan = resetOperations(database, request);
  const tableCounts: {
    table: string;
    action: "delete" | "update" | "preserve";
    count: number;
    reason: string;
  }[] = plan.operations.map((operation) => ({
    table: operation.table,
    action: operation.action,
    count: Number(
      database.db
        .prepare(
          `SELECT COUNT(*) AS count FROM "${operation.table}"${operation.where ? ` WHERE ${operation.where}` : ""}`,
        )
        .get(...(operation.parameters ?? []))!.count,
    ),
    reason: operation.reason,
  }));
  tableCounts.push({
    table: "protected_source_roots",
    action: "preserve",
    count: Number(
      database.db
        .prepare("SELECT COUNT(*) AS count FROM protected_source_roots")
        .get()!.count,
    ),
    reason:
      "Historical read-only roots are never cleared; current media/subtitle/metadata roots will also be retained.",
  });
  const revision = databaseRevision(database, request, fullRevision);
  const flags = `--admin-id ${retainedAdmin.id} --mode ${request.mode}${request.mode === "selective" ? ` --categories ${request.categories.join(",")}` : ""}`;
  return {
    execution: "offline-only",
    mode: request.mode,
    requestedCategories: request.categories,
    effectiveCategories: plan.effectiveCategories,
    dependencies: plan.dependencies,
    tableCounts,
    totalRecords: tableCounts
      .filter((row) => row.action !== "preserve")
      .reduce((sum, row) => sum + row.count, 0),
    retainedAdmin,
    revision,
    revisionScope: fullRevision ? "offline-full" : "live-summary",
    confirmationText: `RESET ${retainedAdmin.username} ${retainedAdmin.id}`,
    cli: {
      previewCommand: `node dist/reset-cli.js ${flags}`,
      applyCommand: `node dist/reset-cli.js ${flags} --apply --revision ${revision}`,
    },
    instructions: resetInstructions,
    filesystemCleanupDisabled: true,
  };
}

function retainedCatalogMetadata(previous: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const field of [
    "technical",
    "seriesId",
    "seriesTitle",
    "seasonNumber",
    "episodeNumber",
    "lastEpisodeNumber",
    "collection",
  ]) {
    if (previous[field] !== undefined) data[field] = previous[field];
  }
  return data;
}
/** SQL-only primitive. The offline executor authenticates, verifies a backup and owns the data lock before calling this; no HTTP mutation exposes it. */
export function applyResetTransaction(
  store: Pick<Store, "db" | "transaction">,
  actor: Account,
  input: ResetRequest,
  expectedRevision: string,
  canonicalRoots: readonly string[] = [],
  now = Date.now(),
) {
  const request = resetRequestSchema.parse(input);
  return store.transaction(() => {
    const plan = planReset(store, actor, request, true);
    invariant(
      plan.revision === expectedRevision,
      409,
      "Database changed after review or backup. Run a new offline preview; no reset was applied.",
    );
    const roots = new Set([
      ...canonicalRoots,
      ...store.db
        .prepare(
          "SELECT root_path AS path FROM sources UNION SELECT metadata_root AS path FROM sources WHERE metadata_root IS NOT NULL UNION SELECT subtitle_root AS path FROM sources WHERE subtitle_root IS NOT NULL",
        )
        .all()
        .map((row) => String(row.path)),
    ]);
    for (const path of roots) {
      invariant(
        isAbsolute(path),
        409,
        "Reset refused a non-absolute source protection path",
      );
      store.db
        .prepare(
          "INSERT INTO protected_source_roots(path) VALUES(?) ON CONFLICT(path) DO NOTHING",
        )
        .run(path);
    }
    const { operations, effectiveCategories } = resetOperations(store, request);
    const selected = new Set(effectiveCategories);
    const rebind = new Set<string>();
    if (selected.has("metadata") && !selected.has("catalog"))
      for (const item of store.db
        .prepare("SELECT * FROM media")
        .all() as unknown as Media[]) {
        if (
          !inspectMetadata(
            store as Store,
            { kind: "media", mediaId: item.id },
            [item],
          ).requiresReview
        )
          rebind.add(item.id);
      }
    for (const operation of operations.filter(
      (row) =>
        row.action === "delete" && !row.table.startsWith("catalog_projection_"),
    ))
      store.db
        .prepare(
          `DELETE FROM "${operation.table}"${operation.where ? ` WHERE ${operation.where}` : ""}`,
        )
        .run(...(operation.parameters ?? []));
    if (selected.has("metadata") && !selected.has("catalog")) {
      for (const row of store.db
        .prepare(
          "SELECT id,source_id,relative_path,size,mtime_ms,metadata_json FROM media",
        )
        .all()) {
        const data = retainedCatalogMetadata(
          JSON.parse(String(row.metadata_json)),
        );
        store.db
          .prepare("UPDATE media SET metadata_json=? WHERE id=?")
          .run(JSON.stringify(data), String(row.id));
        const identity = createHash("sha256")
          .update(
            JSON.stringify([
              row.source_id,
              row.relative_path,
              row.size,
              row.mtime_ms,
            ]),
          )
          .digest("hex");
        if (rebind.has(String(row.id)))
          store.db
            .prepare(
              "UPDATE display_metadata SET identity=? WHERE target_key=?",
            )
            .run(identity, `media:${row.id}`);
      }
      store.db
        .prepare(
          "UPDATE display_metadata SET local_json=NULL,checked_ms=NULL,revision=revision+1",
        )
        .run();
      store.db.prepare("UPDATE integrations SET last_success=NULL").run();
    }
    if (selected.has("custom") && !selected.has("catalog"))
      store.db
        .prepare("UPDATE display_metadata SET state_json=?,revision=revision+1")
        .run(
          JSON.stringify({
            title: { source: "automatic" },
            description: { source: "automatic" },
          }),
        );
    // Delete queues after trigger-producing changes, not before them.
    for (const table of [
      "catalog_projection_rows",
      "catalog_projection_members",
      "catalog_projection_dirty_media",
      "catalog_projection_dirty_sources",
      "catalog_projection_dirty_shows",
    ])
      store.db.prepare(`DELETE FROM ${table}`).run();
    store.db
      .prepare("UPDATE catalog_revision SET revision=revision+1 WHERE id=1")
      .run();
    store.db
      .prepare(
        "UPDATE catalog_projection_state SET generation=generation+1,revision=-1,backfill_cursor='',backfill_complete=0 WHERE id=1",
      )
      .run();
    store.db
      .prepare(
        "UPDATE storage_safety_state SET cleanup_disabled=1,reset_ms=? WHERE id=1",
      )
      .run(now);
    retainedResetAdministrator(store, actor, request.retainedAdminId);
    invariant(
      store.db.prepare("PRAGMA foreign_key_check").all().length === 0,
      409,
      "Reset failed foreign-key validation",
    );
    invariant(
      store.db
        .prepare("PRAGMA integrity_check")
        .all()
        .every((row) => row.integrity_check === "ok"),
      409,
      "Reset failed integrity validation",
    );
    return {
      retainedAdmin: plan.retainedAdmin,
      effectiveCategories,
      filesystemCleanupDisabled: true,
      sessionsEnded: true,
    };
  });
}
