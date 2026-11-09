import { constants } from "node:fs";
import { access, lstat, readdir, readFile, statfs } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { Store } from "./database.js";
import type { Account } from "./domain.js";
import { invariant } from "./domain.js";
import { containsPath } from "./catalog.js";
import { mapIntegrationPath } from "./integrations.js";
import type { PathMapping } from "./integrations.js";
import {
  requireAdmin,
  requireProfile,
  sourceById,
  withinSubtree,
} from "./security.js";

async function bounded<T>(work: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      work.catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
export class OperationsService {
  private cached: { expires: number; promise: Promise<unknown> } | undefined;
  constructor(
    private readonly store: Store,
    private readonly dataRoot: string,
    private readonly generatedRoot: string,
    private readonly cacheRoot: string,
  ) {}
  status(account: Account) {
    requireAdmin(account);
    if (this.cached && this.cached.expires > Date.now())
      return this.cached.promise;
    const promise = this.readStatus();
    this.cached = { expires: Date.now() + 15000, promise };
    return promise;
  }
  private async readStatus() {
    const now = Date.now();
    const sources = this.store.db
      .prepare(
        "SELECT s.id,s.name,s.root_path,r.next_run_ms,a.last_error,a.last_attempt_ms,a.last_completed_ms,a.last_success_ms,i.last_success FROM sources s LEFT JOIN refresh_sources r ON r.source_id=s.id LEFT JOIN refresh_attempts a ON a.source_id=s.id LEFT JOIN integrations i ON i.source_id=s.id ORDER BY s.name,s.id",
      )
      .all();
    const mounts = await Promise.all(
      sources.slice(0, 32).map(async (row) => ({
        id: row.id,
        name: row.name,
        nextRefreshMs: row.next_run_ms ?? null,
        refreshScheduled: row.next_run_ms != null,
        lastAttemptMs: row.last_attempt_ms ?? null,
        lastRefreshMs: row.last_success_ms ?? null,
        refreshError: row.last_error ?? null,
        lastImportMs: row.last_success ?? null,
        refreshState: row.last_error
          ? "failed"
          : row.last_attempt_ms != null && row.last_completed_ms == null
            ? "incomplete"
            : row.next_run_ms != null && Number(row.next_run_ms) < now - 300000
              ? "overdue"
              : row.last_success_ms != null
                ? "ok"
                : "never",
        readable: await bounded(
          access(String(row.root_path), constants.R_OK).then(() => true),
          false,
        ),
      })),
    );
    const storage = await Promise.all(
      [
        ["generated", this.generatedRoot],
        ["cache", this.cacheRoot],
      ].map(async ([kind, path]) => ({
        kind,
        ...(await bounded(
          statfs(path!).then((fs) => ({
            freeBytes: fs.bavail * fs.bsize,
            state: fs.bavail * fs.bsize < 256 * 1024 * 1024 ? "low" : "ok",
          })),
          { freeBytes: null as number | null, state: "unknown" },
        )),
      })),
    );
    const backups = await bounded(this.backups(), {
      state: "unknown",
      latestCompletedMs: null as number | null,
      checked: 0,
      truncated: false,
    });
    const jobs = this.store.db
      .prepare(
        "SELECT status,COUNT(*) AS count FROM generation_jobs GROUP BY status",
      )
      .all();
    const schedules = this.store.db
      .prepare(
        "SELECT c.id,c.name,MAX(e.end_ms) AS coverageEndMs FROM channels c LEFT JOIN active_schedules a ON a.channel_id=c.id LEFT JOIN schedule_entries e ON e.revision_id=a.revision_id WHERE c.archived=0 GROUP BY c.id ORDER BY c.name,c.id LIMIT 1000",
      )
      .all()
      .map((row) => ({
        ...row,
        state:
          row.coverageEndMs == null
            ? "unpublished"
            : Number(row.coverageEndMs) <= now
              ? "expired"
              : "ready",
      }));
    return {
      checkedMs: now,
      database: "ok",
      sources: mounts,
      sourcesTruncated: sources.length > 32,
      storage,
      backups,
      generation: jobs,
      schedules,
    };
  }
  private async backups() {
    const directory = join(this.dataRoot, "backups");
    let names: string[];
    try {
      names = (await readdir(directory))
        .filter((n) => n.startsWith("snapshot-"))
        .sort()
        .reverse();
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return {
          state: "none",
          latestCompletedMs: null,
          checked: 0,
          truncated: false,
        };
      throw error;
    }
    let latest: number | null = null,
      checked = 0;
    for (const name of names.slice(0, 200)) {
      checked++;
      try {
        const folder = join(directory, name),
          path = join(folder, "manifest.json"),
          info = await lstat(path);
        if (
          !(await lstat(folder)).isDirectory() ||
          !info.isFile() ||
          info.size > 4096
        )
          continue;
        const manifest = JSON.parse(await readFile(path, "utf8"));
        const database = await lstat(join(folder, "mytuner.db"));
        if (!database.isFile() || database.size === 0) continue;
        if (
          manifest.keyIncluded &&
          !(await lstat(join(folder, "integration.key"))).isFile()
        )
          continue;
        if (manifest.format === 1 && Number.isInteger(manifest.schemaVersion))
          latest = Math.max(latest ?? 0, info.mtimeMs);
      } catch {
        /* Incomplete snapshots are never reported as completed backups. */
      }
    }
    return {
      state: latest === null ? "none" : "completed",
      latestCompletedMs: latest,
      checked,
      truncated: names.length > 200,
    };
  }
  setup(account: Account) {
    requireAdmin(account);
    const count = (table: string) =>
      Number(
        this.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n,
      );
    return {
      profiles: count("profiles"),
      sources: count("sources"),
      availableMedia: Number(
        this.store.db
          .prepare("SELECT COUNT(*) AS n FROM media WHERE available=1")
          .get()?.n,
      ),
      sourceGrants: count("source_grants"),
      publishedChannels: count("active_schedules"),
      subscriptions: count("subscriptions"),
      pairedDevices: Number(
        this.store.db
          .prepare(
            "SELECT COUNT(*) AS n FROM sessions WHERE kind='device' AND expires_at>?",
          )
          .get(Date.now())?.n,
      ),
      integrationsOptional: true,
    };
  }
  mapping(account: Account, sourceId: string, paths: string[]) {
    requireAdmin(account);
    const source = sourceById(this.store, sourceId),
      config = this.store.db
        .prepare("SELECT mappings_json FROM integrations WHERE source_id=?")
        .get(sourceId);
    invariant(config, 409, "Configure an integration mapping first");
    const mappings = JSON.parse(String(config.mappings_json)) as PathMapping[];
    return {
      items: paths.map((upstreamPath) => {
        const mappedPath = mapIntegrationPath(upstreamPath, mappings);
        if (!mappedPath || !containsPath(source.root_path, mappedPath))
          return { upstreamPath, mappedPath: null, state: "outside-source" };
        const path = relative(source.root_path, mappedPath)
            .split(sep)
            .join("/"),
          media = this.store.db
            .prepare(
              "SELECT id,available FROM media WHERE source_id=? AND relative_path=?",
            )
            .get(sourceId, path);
        return {
          upstreamPath,
          mappedPath,
          mediaId: media?.id ?? null,
          state:
            media?.available === 1
              ? "matched"
              : media
                ? "unavailable"
                : "not-cataloged",
        };
      }),
    };
  }
}
export function effectiveAccess(
  store: Store,
  admin: Account,
  accountId: string,
  profileId: string,
) {
  requireAdmin(admin);
  const target = store.db
    .prepare("SELECT id,username,role,disabled FROM accounts WHERE id=?")
    .get(accountId) as Account | undefined;
  invariant(target, 404, "Account not found");
  const profile = store.db
    .prepare("SELECT owner_account_id,pin_hash FROM profiles WHERE id=?")
    .get(profileId);
  invariant(profile, 404, "Profile not found");
  const allowed = (manage: boolean) => {
    try {
      invariant(!target.disabled, 403, "Disabled");
      requireProfile(store, target, profileId, manage, false);
      return true;
    } catch {
      return false;
    }
  };
  const canWatch = allowed(false),
    canManage = allowed(true);
  const grants = canWatch
    ? target.role === "admin"
      ? store.db
          .prepare(
            "SELECT id AS sourceId,name,'' AS subtree FROM sources ORDER BY name,id",
          )
          .all()
      : store.db
          .prepare(
            "SELECT s.id AS sourceId,s.name,g.subtree FROM source_grants g JOIN sources s ON s.id=g.source_id WHERE g.profile_id=? ORDER BY s.name,g.subtree",
          )
          .all(profileId)
    : [];
  const visible = canWatch
    ? store.db
        .prepare(
          "SELECT c.id,c.name,c.visibility FROM subscriptions sub JOIN channels c ON c.id=sub.channel_id WHERE sub.profile_id=? AND c.archived=0 AND (?='admin' OR c.visibility='shared' OR c.owner_account_id=?) ORDER BY sub.position,c.name,c.id",
        )
        .all(profileId, target.role, target.id)
        .map((c) => {
          const revision = store.db
            .prepare(
              "SELECT revision_id FROM active_schedules WHERE channel_id=?",
            )
            .get(c.id!);
          const items = revision
            ? store.db
                .prepare(
                  "SELECT DISTINCT m.source_id,m.relative_path FROM schedule_entries e JOIN media m ON m.id=e.media_id WHERE e.revision_id=? AND e.end_ms>?",
                )
                .all(revision.revision_id!, Date.now())
            : store.db
                .prepare(
                  "SELECT DISTINCT m.source_id,m.relative_path FROM channel_items ci JOIN media m ON m.id=ci.media_id WHERE ci.channel_id=?",
                )
                .all(c.id!);
          const mediaAllowed =
            target.role === "admin" ||
            items.every((m) =>
              grants.some(
                (g) =>
                  g.sourceId === m.source_id &&
                  withinSubtree(String(m.relative_path), String(g.subtree)),
              ),
            );
          return { ...c, mediaAllowed };
        })
    : [];
  return {
    accountId,
    profileId,
    disabled: Boolean(target.disabled),
    canWatch,
    canManage,
    pinRequired: canWatch && Boolean(profile.pin_hash),
    pinRequiredOnTv: canWatch && Boolean(profile.pin_hash),
    pinRequiredInBrowser:
      canWatch && target.role !== "admin" && Boolean(profile.pin_hash),
    pinState: "session-dependent",
    adminException: target.role === "admin",
    grants,
    subscriptions: visible,
  };
}
