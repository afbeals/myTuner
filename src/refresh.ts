import { recordIntegrationReport } from "./integration-report.js";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  createHash,
} from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Store } from "./database.js";
import { invariant } from "./domain.js";
import { scanSource } from "./catalog.js";
import { sourceById } from "./security.js";
import { importMetadata, integrationUrl } from "./integrations.js";
import { BackgroundWork } from "./background-work.js";
import {
  ProviderSuggestions,
  mappingSourceRevision,
  previewMappings,
  validateMappings,
} from "./setup-suggestions.js";
import type { ProviderConnection } from "./setup-suggestions.js";
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
  apiKey?: string | undefined;
  reuseSourceId?: string | undefined;
  mappings: PathMapping[];
}
export class RefreshService {
  private running = new Map<
    string,
    { signature: string; promise: Promise<unknown> }
  >();
  private controller = new AbortController();
  private readonly providers: ProviderSuggestions | undefined;
  constructor(
    private readonly store: Store,
    private readonly key?: Buffer,
    private readonly fetcher: Fetcher = fetch,
    private readonly background?: BackgroundWork,
  ) {
    if (key)
      this.providers = new ProviderSuggestions(
        store,
        key,
        fetcher,
        this.controller.signal,
      );
  }
  configure(sourceId: string, input: IntegrationConfig) {
    invariant(this.key, 503, "Integration key storage is unavailable");
    validateMappings(input.mappings);
    const src = sourceById(this.store, sourceId),
      url = integrationUrl(input.url);
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
    const existing = this.store.db
      .prepare(
        "SELECT provider,url,encrypted_key,mappings_json FROM integrations WHERE source_id=?",
      )
      .get(sourceId);
    const reusable =
      !input.apiKey && input.reuseSourceId
        ? this.configuration(input.reuseSourceId)
        : undefined;
    invariant(
      !input.reuseSourceId ||
        input.apiKey ||
        (reusable &&
          reusable.provider === input.provider &&
          integrationUrl(reusable.url).toString() === url.toString()),
      400,
      "Saved connection does not match this provider and application URL",
    );
    invariant(
      input.apiKey ||
        reusable ||
        (existing &&
          existing.provider === input.provider &&
          integrationUrl(String(existing.url)).toString() === url.toString()),
      400,
      "Enter an API key for a new integration or when changing its application URL",
    );
    const encryptedKey = input.apiKey
      ? seal(this.key, input.apiKey)
      : String(reusable?.encrypted_key ?? existing!.encrypted_key);
    if (
      existing &&
      existing.provider === input.provider &&
      String(existing.url) === url.toString() &&
      String(existing.encrypted_key) === encryptedKey &&
      String(existing.mappings_json) === JSON.stringify(input.mappings)
    )
      return;
    this.store.db
      .prepare(
        "INSERT INTO integrations(id,source_id,provider,url,encrypted_key,mappings_json) VALUES(?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET provider=excluded.provider,url=excluded.url,encrypted_key=excluded.encrypted_key,mappings_json=excluded.mappings_json,last_success=NULL",
      )
      .run(
        randomUUID(),
        sourceId,
        input.provider,
        url.toString(),
        encryptedKey,
        JSON.stringify(input.mappings),
      );
    this.store.db
      .prepare("DELETE FROM refresh_attempts WHERE source_id=?")
      .run(sourceId);
  }
  isScanning(sourceId: string) {
    return this.running.has(sourceId);
  }
  admission(sourceId: string) {
    if (!this.isScanning(sourceId))
      return { admission: null, waitingReason: null };
    const state = this.background?.status(`scan:${sourceId}`);
    return state?.admission
      ? state
      : { admission: "active", waitingReason: null };
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
    const saved = this.store.db
      .prepare("SELECT interval_ms FROM refresh_sources WHERE source_id=?")
      .get(sourceId);
    if (saved?.interval_ms === intervalMs) return;
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
  private configRevision(sourceId: string) {
    return createHash("sha256")
      .update(JSON.stringify(this.configuration(sourceId)) ?? "none")
      .digest("hex");
  }
  private connection(
    sourceId: string,
    draft?: {
      provider: "sonarr" | "radarr";
      url: string;
      apiKey?: string | undefined;
      reuseSourceId?: string | undefined;
    },
  ): ProviderConnection {
    invariant(
      this.key && this.providers,
      503,
      "Integration key storage is unavailable",
    );
    const source = sourceById(this.store, sourceId),
      saved = this.configuration(sourceId);
    const provider = draft?.provider ?? saved?.provider;
    const url = integrationUrl(
      draft?.url ?? saved?.url ?? "http://invalid",
    ).toString();
    invariant(
      provider && source.kind === (provider === "sonarr" ? "shows" : "movies"),
      400,
      "Integration type does not match source",
    );
    const reusable =
      !draft?.apiKey && draft?.reuseSourceId
        ? this.configuration(draft.reuseSourceId)
        : undefined;
    invariant(
      !draft?.reuseSourceId ||
        draft?.apiKey ||
        (reusable &&
          reusable.provider === provider &&
          integrationUrl(reusable.url).toString() === url),
      400,
      "Saved connection does not match this provider and application URL",
    );
    const unchanged =
      saved &&
      saved.provider === provider &&
      integrationUrl(saved.url).toString() === url;
    invariant(
      draft?.apiKey || reusable || unchanged,
      400,
      "Enter an API key for a new integration or when changing its application URL",
    );
    return {
      provider,
      url,
      apiKey:
        draft?.apiKey ||
        unseal(this.key, reusable?.encrypted_key ?? saved!.encrypted_key),
    };
  }
  suggestions(sourceId: string) {
    const source = sourceById(this.store, sourceId),
      configured = this.configuration(sourceId);
    const empty = {
      roots: [],
      observedAt: null,
      lastAttemptAt: null,
      error: null,
      stale: true,
      revision: "",
      inventoryAvailable: false,
    };
    return {
      ...(configured && this.providers
        ? this.providers.snapshot(this.connection(sourceId))
        : empty),
      sourceRevision: mappingSourceRevision(source),
      configRevision: this.configRevision(sourceId),
    };
  }
  async refreshSuggestions(
    sourceId: string,
    draft: {
      provider: "sonarr" | "radarr";
      url: string;
      apiKey?: string | undefined;
      reuseSourceId?: string | undefined;
    },
    configRevision: string,
    authorize: () => void,
  ) {
    authorize();
    invariant(
      this.configRevision(sourceId) === configRevision,
      409,
      "Integration changed; reload before checking suggestions",
    );
    const sourceRevision = mappingSourceRevision(
      sourceById(this.store, sourceId),
    );
    const reuseRevision =
      !draft.apiKey && draft.reuseSourceId
        ? this.configRevision(draft.reuseSourceId)
        : null;
    const connection = this.connection(sourceId, draft);
    const snapshot = await this.providers!.refresh(connection);
    authorize();
    invariant(
      this.configRevision(sourceId) === configRevision &&
        (!draft.reuseSourceId ||
          draft.apiKey ||
          this.configRevision(draft.reuseSourceId) === reuseRevision) &&
        mappingSourceRevision(sourceById(this.store, sourceId)) ===
          sourceRevision,
      409,
      "Source or integration changed; reload suggestions",
    );
    return { ...snapshot, sourceRevision, configRevision };
  }
  previewMapping(
    sourceId: string,
    input: {
      provider: "sonarr" | "radarr";
      url: string;
      apiKey?: string | undefined;
      reuseSourceId?: string | undefined;
      mappings: PathMapping[];
      sourceRevision: string;
      configRevision: string;
      inventoryRevision: string;
      paths?: string[] | undefined;
    },
  ) {
    const source = sourceById(this.store, sourceId);
    invariant(
      mappingSourceRevision(source) === input.sourceRevision &&
        this.configRevision(sourceId) === input.configRevision,
      409,
      "Source or integration changed; reload before checking mappings",
    );
    validateMappings(input.mappings);
    const connection = this.connection(sourceId, input),
      snapshot = this.providers!.snapshot(connection);
    invariant(
      snapshot.revision === input.inventoryRevision,
      409,
      "Provider suggestions changed; refresh the preview",
    );
    const inventory = this.providers!.previewItems(connection);
    const paths =
      input.paths ?? inventory?.slice(0, 20).map((item) => item.path) ?? [];
    return {
      sourceRevision: input.sourceRevision,
      configRevision: input.configRevision,
      inventoryRevision: snapshot.revision,
      items: previewMappings(this.store, source, input.mappings, paths),
      sampled: paths.length,
      cachedFileCount: inventory?.length ?? null,
      complete: inventory !== null && inventory.length <= 20,
      needsFileInventory: !inventory && !input.paths,
    };
  }
  scan(
    sourceId: string,
    options: { automatic?: boolean; metadata?: boolean } = {},
  ): Promise<unknown> {
    invariant(!this.controller.signal.aborted, 503, "Server is stopping");
    const config = this.configuration(sourceId),
      signature = JSON.stringify([config, options.metadata ?? true]);
    const existing = this.running.get(sourceId);
    if (existing) {
      if (existing.signature === signature) return existing.promise;
      return existing.promise
        .catch(() => {})
        .then(() => this.scan(sourceId, options));
    }
    invariant(this.running.size < 2, 429, "Source refresh limit reached");
    const job = this.refresh(
      sourceId,
      config,
      options.automatic ?? false,
      options.metadata ?? true,
    ).finally(() => this.running.delete(sourceId));
    this.running.set(sourceId, { signature, promise: job });
    return job;
  }
  private async refresh(
    sourceId: string,
    config: ReturnType<RefreshService["configuration"]>,
    automatic: boolean,
    includeMetadata = true,
  ) {
    const current = () =>
      JSON.stringify(this.configuration(sourceId)) === JSON.stringify(config);
    const startedMs = Date.now();
    sourceById(this.store, sourceId);
    this.recordAttempt(sourceId, startedMs);
    try {
      const src = sourceById(this.store, sourceId),
        scan = this.background
          ? await this.background.run(
              "scan",
              this.controller.signal,
              (checkpoint) =>
                scanSource(
                  this.store,
                  src,
                  undefined,
                  this.controller.signal,
                  checkpoint,
                ),
              `scan:${sourceId}`,
            )
          : await scanSource(
              this.store,
              src,
              undefined,
              this.controller.signal,
            );
      let imported: unknown;
      if (config && includeMetadata) {
        invariant(this.key, 503, "Integration key storage is unavailable");
        const previousImport = Number(
          this.store.db
            .prepare("SELECT last_success FROM integrations WHERE source_id=?")
            .get(sourceId)?.last_success ?? 0,
        );
        const items = await this.providers!.items(
          {
            provider: config.provider,
            url: config.url,
            apiKey: unseal(this.key, config.encrypted_key),
          },
          previousImport,
          !automatic,
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
        await this.scan(job.source_id, { automatic: true });
      } catch {
        /* Detailed sanitized status is persisted per source. */
      }
    }
  }
  async stop() {
    this.controller.abort();
    await Promise.allSettled(
      [...this.running.values()]
        .map((job) => job.promise)
        .concat(this.providers ? [this.providers.stop()] : []),
    );
  }
}
