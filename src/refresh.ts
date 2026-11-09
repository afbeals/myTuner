import { recordIntegrationReport } from "./integration-report.js";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Store } from "./database.js";
import { invariant } from "./domain.js";
import { scanSource } from "./catalog.js";
import { sourceById } from "./security.js";
import { importMetadata, readIntegration } from "./integrations.js";
import type { PathMapping, Fetcher } from "./integrations.js";
export async function loadIntegrationKey(
  root: string,
  create = true,
): Promise<Buffer> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, "integration.key");
  if (create) {
    try {
      const file = await open(path, "wx", 0o600);
      try {
        await file.writeFile(randomBytes(32));
        await file.sync();
      } finally {
        await file.close();
      }
    } catch (e) {
      if (!(e instanceof Error && "code" in e && e.code === "EEXIST")) throw e;
    }
  }
  const key = await readFile(path).catch(() => {
    throw new Error(
      "Integration key unavailable; restore the original key from an application backup",
    );
  });
  invariant(key.length === 32, 500, "Invalid integration encryption key");
  return key;
}
export function seal(key: Buffer, value: string): string {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv),
    encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}
export function unseal(key: Buffer, value: string): string {
  const [version, iv, tag, data] = value.split(".");
  invariant(
    version === "v1" && iv && tag && data,
    500,
    "Invalid encrypted integration key",
  );
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64url"),
  );
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    cipher.update(Buffer.from(data, "base64url")),
    cipher.final(),
  ]).toString("utf8");
}
export interface IntegrationConfig {
  provider: "sonarr" | "radarr";
  url: string;
  apiKey: string;
  mappings: PathMapping[];
}
export class RefreshService {
  private running = new Map<
    string,
    { signature: string; promise: Promise<unknown> }
  >();
  private controller = new AbortController();
  constructor(
    private readonly store: Store,
    private readonly key?: Buffer,
    private readonly fetcher: Fetcher = fetch,
  ) {}
  configure(sourceId: string, input: IntegrationConfig) {
    invariant(this.key, 503, "Integration key storage is unavailable");
    const src = sourceById(this.store, sourceId),
      url = new URL(input.url);
    invariant(
      ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash,
      400,
      "Invalid integration URL",
    );
    invariant(
      src.kind === (input.provider === "sonarr" ? "shows" : "movies"),
      400,
      "Integration type does not match source",
    );
    this.store.db
      .prepare(
        "INSERT INTO integrations(id,source_id,provider,url,encrypted_key,mappings_json) VALUES(?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET provider=excluded.provider,url=excluded.url,encrypted_key=excluded.encrypted_key,mappings_json=excluded.mappings_json,last_success=NULL",
      )
      .run(
        randomUUID(),
        sourceId,
        input.provider,
        input.url,
        seal(this.key, input.apiKey),
        JSON.stringify(input.mappings),
      );
    this.store.db
      .prepare("DELETE FROM refresh_attempts WHERE source_id=?")
      .run(sourceId);
  }
  private recordAttempt(
    sourceId: string,
    startedMs: number,
    error?: string | null,
  ) {
    const completed = error === undefined ? null : Date.now();
    this.store.db
      .prepare(
        "INSERT INTO refresh_attempts(source_id,last_attempt_ms,last_completed_ms,last_success_ms,last_error) VALUES(?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET last_attempt_ms=excluded.last_attempt_ms,last_completed_ms=excluded.last_completed_ms,last_success_ms=COALESCE(excluded.last_success_ms,refresh_attempts.last_success_ms),last_error=excluded.last_error",
      )
      .run(
        sourceId,
        startedMs,
        completed,
        completed !== null && error === null ? completed : null,
        error ?? null,
      );
  }
  schedule(sourceId: string, intervalMs: number | null, now = Date.now()) {
    sourceById(this.store, sourceId);
    if (intervalMs === null) {
      this.store.db
        .prepare("DELETE FROM refresh_sources WHERE source_id=?")
        .run(sourceId);
      return;
    }
    invariant(
      Number.isSafeInteger(intervalMs) &&
        intervalMs >= 60000 &&
        intervalMs <= 7 * 86400000,
      400,
      "Refresh interval must be 1 minute to 7 days",
    );
    this.store.db
      .prepare(
        "INSERT INTO refresh_sources(source_id,interval_ms,next_run_ms) VALUES(?,?,?) ON CONFLICT(source_id) DO UPDATE SET interval_ms=excluded.interval_ms,next_run_ms=excluded.next_run_ms",
      )
      .run(sourceId, intervalMs, now);
  }
  private configuration(sourceId: string) {
    return this.store.db
      .prepare(
        "SELECT provider,url,encrypted_key,mappings_json FROM integrations WHERE source_id=?",
      )
      .get(sourceId) as
      | {
          provider: "sonarr" | "radarr";
          url: string;
          encrypted_key: string;
          mappings_json: string;
        }
      | undefined;
  }
  scan(sourceId: string): Promise<unknown> {
    invariant(!this.controller.signal.aborted, 503, "Server is stopping");
    const config = this.configuration(sourceId),
      signature = JSON.stringify(config) ?? "none";
    const existing = this.running.get(sourceId);
    if (existing) {
      if (existing.signature === signature) return existing.promise;
      return existing.promise.catch(() => {}).then(() => this.scan(sourceId));
    }
    invariant(this.running.size < 2, 429, "Source refresh limit reached");
    const job = this.refresh(sourceId, config).finally(() =>
      this.running.delete(sourceId),
    );
    this.running.set(sourceId, { signature, promise: job });
    return job;
  }
  private async refresh(
    sourceId: string,
    config: ReturnType<RefreshService["configuration"]>,
  ) {
    const current = () =>
      JSON.stringify(this.configuration(sourceId)) === JSON.stringify(config);
    const startedMs = Date.now();
    sourceById(this.store, sourceId);
    this.recordAttempt(sourceId, startedMs);
    try {
      const src = sourceById(this.store, sourceId),
        scan = await scanSource(
          this.store,
          src,
          undefined,
          this.controller.signal,
        );
      let imported: unknown;
      if (config) {
        invariant(this.key, 503, "Integration key storage is unavailable");
        const items = await readIntegration(
          config.provider,
          config.url,
          unseal(this.key, config.encrypted_key),
          this.fetcher,
          this.controller.signal,
        );
        if (!current()) return { ...scan, superseded: true };
        const report = recordIntegrationReport(
          this.store,
          src,
          config.provider,
          items,
          JSON.parse(config.mappings_json) as PathMapping[],
          scan.complete,
        );
        imported = {
          ...importMetadata(
            this.store,
            src,
            items,
            JSON.parse(config.mappings_json) as PathMapping[],
          ),
          reconciliation: report,
        };
        this.store.db
          .prepare("UPDATE integrations SET last_success=? WHERE source_id=?")
          .run(Date.now(), sourceId);
      }
      if (!current()) return { ...scan, superseded: true };
      this.recordAttempt(
        sourceId,
        startedMs,
        scan.complete
          ? null
          : "Source scan incomplete; previous availability retained",
      );
      this.store.db
        .prepare(
          "UPDATE refresh_sources SET next_run_ms=?+interval_ms,last_error=? WHERE source_id=?",
        )
        .run(
          Date.now(),
          scan.complete
            ? null
            : "Source scan incomplete; previous availability retained",
          sourceId,
        );
      return { ...scan, imported };
    } catch (error) {
      if (!current()) return { superseded: true };
      this.recordAttempt(
        sourceId,
        startedMs,
        "Refresh failed; previous metadata retained",
      );
      this.store.db
        .prepare(
          "UPDATE refresh_sources SET next_run_ms=?+MIN(interval_ms,300000),last_error='Refresh failed; previous metadata retained' WHERE source_id=?",
        )
        .run(Date.now(), sourceId);
      throw error;
    }
  }
  async tick(now = Date.now()): Promise<void> {
    const jobs = this.store.db
      .prepare(
        "SELECT source_id FROM refresh_sources WHERE next_run_ms<=? ORDER BY next_run_ms LIMIT 2",
      )
      .all(now) as { source_id: string }[];
    for (const job of jobs) {
      if (this.controller.signal.aborted) return;
      try {
        await this.scan(job.source_id);
      } catch {
        /* Detailed sanitized status is persisted per source. */
      }
    }
  }
  async stop() {
    this.controller.abort();
    await Promise.allSettled(
      [...this.running.values()].map((job) => job.promise),
    );
  }
}
