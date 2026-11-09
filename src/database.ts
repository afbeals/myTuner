import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Schema changes are append-only migrations. Refuse future schemas rather than guessing.
export const migrations = [
  `CREATE TABLE accounts (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')),
 disabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), expires_at INTEGER NOT NULL);
CREATE TABLE login_attempts (key TEXT PRIMARY KEY, failures INTEGER NOT NULL, window_start INTEGER NOT NULL);
CREATE TABLE profiles (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('person','room')),
 owner_account_id TEXT REFERENCES accounts(id), pin_hash TEXT
);
CREATE TABLE profile_accounts (
 profile_id TEXT NOT NULL REFERENCES profiles(id), account_id TEXT NOT NULL REFERENCES accounts(id),
 can_manage INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(profile_id,account_id)
);
CREATE TABLE sources (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN ('shows','movies','videos','commercials')), recursive INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE source_grants (
 profile_id TEXT NOT NULL REFERENCES profiles(id), source_id TEXT NOT NULL REFERENCES sources(id),
 subtree TEXT NOT NULL DEFAULT '', PRIMARY KEY(profile_id,source_id,subtree)
);
CREATE TABLE media (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), relative_path TEXT NOT NULL,
 title TEXT NOT NULL, duration_ms INTEGER NOT NULL CHECK(duration_ms > 0), size INTEGER NOT NULL,
 mtime_ms REAL NOT NULL, available INTEGER NOT NULL DEFAULT 1, metadata_json TEXT NOT NULL DEFAULT '{}',
 UNIQUE(source_id,relative_path)
);
CREATE TABLE channels (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_account_id TEXT REFERENCES accounts(id),
 visibility TEXT NOT NULL CHECK(visibility IN ('shared','private')),
 CHECK(visibility != 'private' OR owner_account_id IS NOT NULL)
);
CREATE TABLE channel_items (
 channel_id TEXT NOT NULL REFERENCES channels(id), media_id TEXT NOT NULL REFERENCES media(id),
 PRIMARY KEY(channel_id,media_id)
);
CREATE TABLE subscriptions (
 profile_id TEXT NOT NULL REFERENCES profiles(id), channel_id TEXT NOT NULL REFERENCES channels(id),
 PRIMARY KEY(profile_id,channel_id)
);
CREATE TABLE schedule_revisions (
 id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(id), created_at INTEGER NOT NULL
);
CREATE TABLE schedule_entries (
 id TEXT PRIMARY KEY, revision_id TEXT NOT NULL REFERENCES schedule_revisions(id),
 channel_id TEXT NOT NULL REFERENCES channels(id), media_id TEXT NOT NULL REFERENCES media(id),
 program_id TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, offset_ms INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('program','commercial')), CHECK(end_ms > start_ms), CHECK(offset_ms >= 0)
);
CREATE INDEX schedule_lookup ON schedule_entries(channel_id,start_ms,end_ms);
CREATE TABLE active_schedules (channel_id TEXT PRIMARY KEY REFERENCES channels(id), revision_id TEXT NOT NULL REFERENCES schedule_revisions(id));
CREATE TABLE rotation_state (channel_id TEXT PRIMARY KEY REFERENCES channels(id), state_json TEXT NOT NULL);
CREATE TABLE integration_metadata (
 provider TEXT NOT NULL, external_id TEXT NOT NULL, media_id TEXT NOT NULL REFERENCES media(id),
 metadata_json TEXT NOT NULL, PRIMARY KEY(provider,external_id)
);
`,
  `CREATE TABLE generation_jobs (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), directory TEXT NOT NULL,
 recursive INTEGER NOT NULL, status TEXT NOT NULL, regenerate INTEGER NOT NULL,
 created_at INTEGER NOT NULL, error TEXT
);
CREATE TABLE generation_items (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES generation_jobs(id), media_id TEXT NOT NULL REFERENCES media(id),
 kind TEXT NOT NULL CHECK(kind IN ('thumbnail','gif','conversion')), status TEXT NOT NULL, error TEXT
);
CREATE TABLE generated_assets (
 id TEXT PRIMARY KEY, media_id TEXT NOT NULL REFERENCES media(id), kind TEXT NOT NULL,
 fingerprint TEXT NOT NULL, relative_path TEXT NOT NULL, UNIQUE(media_id,kind,fingerprint)
);`,
  `ALTER TABLE schedule_entries ADD COLUMN source_size INTEGER;
ALTER TABLE schedule_entries ADD COLUMN source_mtime_ms REAL;
CREATE TABLE playback_sessions (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), profile_id TEXT NOT NULL REFERENCES profiles(id),
 channel_id TEXT NOT NULL REFERENCES channels(id), revision_id TEXT NOT NULL REFERENCES schedule_revisions(id),
 position_ms INTEGER NOT NULL, anchor_ms INTEGER NOT NULL, paused INTEGER NOT NULL DEFAULT 0,
 last_seen INTEGER NOT NULL
);`,
  `CREATE TABLE collections(id TEXT PRIMARY KEY,name TEXT NOT NULL,owner_account_id TEXT NOT NULL REFERENCES accounts(id));
CREATE TABLE collection_items(collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,media_id TEXT NOT NULL REFERENCES media(id),PRIMARY KEY(collection_id,media_id));
ALTER TABLE schedule_revisions ADD COLUMN config_json TEXT;
ALTER TABLE schedule_revisions ADD COLUMN state_json TEXT;
ALTER TABLE schedule_revisions ADD COLUMN profile_id TEXT REFERENCES profiles(id);
ALTER TABLE schedule_revisions ADD COLUMN author_account_id TEXT REFERENCES accounts(id);
ALTER TABLE schedule_revisions ADD COLUMN effective_ms INTEGER NOT NULL DEFAULT 0;
CREATE TABLE schedule_checkpoints(revision_id TEXT NOT NULL REFERENCES schedule_revisions(id) ON DELETE CASCADE,program_id TEXT NOT NULL,end_ms INTEGER NOT NULL,state_json TEXT NOT NULL,PRIMARY KEY(revision_id,program_id));
CREATE TABLE refresh_sources(source_id TEXT PRIMARY KEY REFERENCES sources(id),interval_ms INTEGER NOT NULL,next_run_ms INTEGER NOT NULL,last_error TEXT);
CREATE TABLE integrations(id TEXT PRIMARY KEY,source_id TEXT NOT NULL UNIQUE REFERENCES sources(id),provider TEXT NOT NULL,url TEXT NOT NULL,encrypted_key TEXT NOT NULL,mappings_json TEXT NOT NULL,last_success INTEGER);
CREATE TABLE playback_events(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,account_id TEXT NOT NULL,channel_id TEXT NOT NULL,entry_id TEXT NOT NULL,start_ms INTEGER NOT NULL,end_ms INTEGER NOT NULL,created_ms INTEGER NOT NULL);
CREATE INDEX playback_event_session ON playback_events(session_id,start_ms,end_ms);`,
  `ALTER TABLE sessions ADD COLUMN csrf_hash TEXT;
ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'bearer';
CREATE TABLE profile_unlocks(session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,profile_id TEXT NOT NULL REFERENCES profiles(id),expires_ms INTEGER NOT NULL,PRIMARY KEY(session_hash,profile_id));
CREATE TABLE device_pairings(device_hash TEXT PRIMARY KEY,code_hash TEXT NOT NULL UNIQUE,device_name TEXT NOT NULL,expires_ms INTEGER NOT NULL,account_id TEXT REFERENCES accounts(id),consumed INTEGER NOT NULL DEFAULT 0);`,
  `ALTER TABLE playback_sessions ADD auth_session_hash TEXT;`,
  `ALTER TABLE playback_events ADD media_id TEXT;
ALTER TABLE playback_events ADD kind TEXT;
ALTER TABLE playback_events ADD program_id TEXT;
UPDATE playback_events SET media_id=(SELECT media_id FROM schedule_entries WHERE id=entry_id),kind=(SELECT kind FROM schedule_entries WHERE id=entry_id),program_id=(SELECT program_id FROM schedule_entries WHERE id=entry_id);`,
  `ALTER TABLE integration_metadata RENAME TO integration_metadata_legacy;
CREATE TABLE integration_metadata(source_id TEXT NOT NULL REFERENCES sources(id),provider TEXT NOT NULL,external_id TEXT NOT NULL,media_id TEXT NOT NULL REFERENCES media(id),metadata_json TEXT NOT NULL,PRIMARY KEY(source_id,provider,external_id));
INSERT INTO integration_metadata(source_id,provider,external_id,media_id,metadata_json) SELECT m.source_id,i.provider,i.external_id,i.media_id,i.metadata_json FROM integration_metadata_legacy i JOIN media m ON m.id=i.media_id;
DROP TABLE integration_metadata_legacy;
CREATE INDEX schedule_by_revision ON schedule_entries(revision_id,start_ms,end_ms);
CREATE INDEX schedule_by_program ON schedule_entries(revision_id,program_id);
CREATE INDEX media_by_source ON media(source_id,available);
CREATE INDEX playback_by_auth_session ON playback_sessions(auth_session_hash);`,
  `ALTER TABLE channels ADD archived INTEGER NOT NULL DEFAULT 0;`,
  `ALTER TABLE channels ADD short_name TEXT CHECK(short_name IS NULL OR length(short_name) BETWEEN 1 AND 12);`,
  `ALTER TABLE subscriptions ADD position INTEGER NOT NULL DEFAULT 0;
WITH ranked AS (SELECT s.profile_id,s.channel_id,ROW_NUMBER() OVER(PARTITION BY s.profile_id ORDER BY c.name,c.id) AS position FROM subscriptions s JOIN channels c ON c.id=s.channel_id)
UPDATE subscriptions SET position=(SELECT r.position FROM ranked r WHERE r.profile_id=subscriptions.profile_id AND r.channel_id=subscriptions.channel_id);
CREATE TABLE integration_runs(id TEXT PRIMARY KEY,source_id TEXT NOT NULL REFERENCES sources(id),provider TEXT NOT NULL,completed_ms INTEGER NOT NULL,scan_complete INTEGER NOT NULL,summary_json TEXT NOT NULL);
CREATE TABLE integration_run_items(run_id TEXT NOT NULL REFERENCES integration_runs(id) ON DELETE CASCADE,external_id TEXT NOT NULL,previous_media_id TEXT,matched_media_id TEXT,state TEXT NOT NULL,PRIMARY KEY(run_id,external_id));
CREATE INDEX integration_runs_by_source ON integration_runs(source_id,completed_ms);`,
  `ALTER TABLE schedule_revisions ADD boundary_state_json TEXT;
ALTER TABLE generation_items ADD waiting_reason TEXT;`,
  `ALTER TABLE collections ADD deleted_ms INTEGER;
ALTER TABLE collections ADD expires_ms INTEGER;
CREATE INDEX collections_expiry ON collections(expires_ms) WHERE deleted_ms IS NOT NULL;
ALTER TABLE playback_sessions ADD delivery_mode TEXT;
ALTER TABLE playback_sessions ADD delivery_entry_id TEXT;
CREATE TABLE problem_reports (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), request_id TEXT NOT NULL,
 profile_id TEXT NOT NULL REFERENCES profiles(id), channel_id TEXT NOT NULL REFERENCES channels(id), media_id TEXT NOT NULL REFERENCES media(id),
 created_ms INTEGER NOT NULL, acknowledged_ms INTEGER, summary_json TEXT NOT NULL,
 UNIQUE(account_id,request_id)
);
CREATE INDEX reports_created ON problem_reports(created_ms);`,
  `ALTER TABLE channels ADD description TEXT NOT NULL DEFAULT '';
ALTER TABLE channels ADD details_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sources ADD metadata_root TEXT;
CREATE TABLE display_metadata (
 target_key TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id),
 revision INTEGER NOT NULL DEFAULT 0, identity TEXT NOT NULL,
 state_json TEXT NOT NULL DEFAULT '{}', local_json TEXT, checked_ms INTEGER
);
CREATE INDEX display_metadata_source ON display_metadata(source_id);`,
  `ALTER TABLE sources ADD subtitle_root TEXT;
ALTER TABLE sources ADD subtitle_config TEXT NOT NULL DEFAULT '{}';
ALTER TABLE sources ADD subtitle_revision INTEGER NOT NULL DEFAULT 0;
CREATE TABLE subtitle_checks(media_id TEXT PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,revision INTEGER NOT NULL DEFAULT 0,checked_ms INTEGER,success_ms INTEGER,error TEXT);
CREATE TABLE subtitle_tracks(id INTEGER PRIMARY KEY AUTOINCREMENT CHECK(id BETWEEN 1 AND 1000000000),media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,root_kind TEXT NOT NULL CHECK(root_kind IN ('media','subtitles')),relative_path TEXT NOT NULL,state_json TEXT NOT NULL,UNIQUE(media_id,root_kind,relative_path));
CREATE INDEX subtitle_tracks_media ON subtitle_tracks(media_id);`,
  `CREATE TABLE refresh_attempts(
source_id TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
last_attempt_ms INTEGER NOT NULL,last_completed_ms INTEGER,last_success_ms INTEGER,last_error TEXT
);
INSERT INTO refresh_attempts(source_id,last_attempt_ms,last_completed_ms,last_success_ms,last_error)
SELECT s.id,COALESCE(i.last_success,0),COALESCE(i.last_success,0),i.last_success,r.last_error
FROM sources s LEFT JOIN refresh_sources r ON r.source_id=s.id LEFT JOIN integrations i ON i.source_id=s.id
WHERE i.last_success IS NOT NULL OR r.last_error IS NOT NULL;`,
];

export const schemaVersion = migrations.length;
export class Store {
  readonly db: DatabaseSync;
  private depth = 0;
  constructor(public readonly filename: string) {
    if (filename !== ":memory:")
      mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    try {
      if (filename !== ":memory:") chmodSync(filename, 0o600);
      this.db.exec(
        "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;",
      );
      const version = Number(
        (
          this.db.prepare("PRAGMA user_version").get() as {
            user_version: number;
          }
        ).user_version,
      );
      if (version > migrations.length) {
        throw new Error("Database schema is newer than this server");
      }
      if (
        version > 0 &&
        version < migrations.length &&
        filename !== ":memory:"
      ) {
        const directory = join(dirname(filename), "backups");
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const snapshot = join(
          directory,
          `pre-migration-v${version}-${Date.now()}-${randomUUID()}.db`,
        );
        this.db.prepare("VACUUM INTO ?").run(snapshot);
        chmodSync(snapshot, 0o600);
      }
      for (let i = version; i < migrations.length; i++)
        this.transaction(() => {
          this.db.exec(migrations[i]!);
          this.db.exec(`PRAGMA user_version=${i + 1}`);
        });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  transaction<T>(fn: () => T): T {
    const depth = this.depth++,
      savepoint = `nested_${depth}`;
    try {
      this.db.exec(depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
      const result = fn();
      if (result instanceof Promise)
        throw new Error("Database transactions must be synchronous");
      this.db.exec(depth === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      this.db.exec(
        depth === 0
          ? "ROLLBACK"
          : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`,
      );
      throw error;
    } finally {
      this.depth--;
    }
  }

  close(): void {
    this.db.close();
  }
}
