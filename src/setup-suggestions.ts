import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Store } from "./database.js";
import type { Source } from "./domain.js";
import { invariant } from "./domain.js";
import { containsPath } from "./catalog.js";
import {
  integrationUrl,
  mapIntegrationPath,
  observedRoots,
  readIntegration,
  readProviderInventory,
} from "./integrations.js";
import type {
  Fetcher,
  ImportedItem,
  ObservedRoot,
  PathMapping,
  Provider,
  ProviderInventory,
} from "./integrations.js";

const lifetime = 5 * 60_000;
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export interface ProviderConnection {
  provider: Provider;
  url: string;
  apiKey: string;
}
interface SavedRoots {
  roots_json: string;
  observed_ms: number | null;
  last_attempt_ms: number;
  last_error: string | null;
}
export interface RootSuggestions {
  roots: ObservedRoot[];
  observedAt: number | null;
  lastAttemptAt: number | null;
  error: string | null;
  stale: boolean;
  revision: string;
  inventoryAvailable: boolean;
}
// Shared by sources using the same provider, complete destination and credential.
// Persist only bounded root summaries; full inventories expire in memory.
export class ProviderSuggestions {
  private inventories = new Map<
    string,
    { at: number; value: ProviderInventory }
  >();
  private inventoryPending = new Map<string, Promise<ProviderInventory>>();
  private imports = new Map<string, { at: number; value: ImportedItem[] }>();
  private importPending = new Map<string, Promise<ImportedItem[]>>();
  constructor(
    private readonly store: Store,
    private readonly key: Buffer,
    private readonly fetcher: Fetcher = fetch,
    private readonly signal?: AbortSignal,
  ) {}
  private identity(connection: ProviderConnection) {
    return createHmac("sha256", this.key)
      .update(
        JSON.stringify([
          connection.provider,
          integrationUrl(connection.url).toString(),
          connection.apiKey,
        ]),
      )
      .digest("hex");
  }
  snapshot(connection: ProviderConnection): RootSuggestions {
    this.trim();
    const key = this.identity(connection);
    const row = this.store.db
      .prepare("SELECT * FROM provider_suggestions WHERE connection_key=?")
      .get(key) as unknown as SavedRoots | undefined;
    const roots = row ? (JSON.parse(row.roots_json) as ObservedRoot[]) : [];
    const inventory = this.inventories.get(key);
    return {
      roots,
      observedAt: row?.observed_ms ?? null,
      lastAttemptAt: row?.last_attempt_ms ?? null,
      error: row?.last_error ?? null,
      stale:
        !row?.observed_ms ||
        Date.now() - row.observed_ms >= lifetime ||
        Boolean(row.last_error),
      revision: hash([
        key,
        roots,
        row?.observed_ms ?? null,
        row?.last_attempt_ms ?? null,
        row?.last_error ?? null,
      ]),
      inventoryAvailable:
        Boolean(
          this.imports.get(key)?.at &&
          Date.now() - this.imports.get(key)!.at < lifetime,
        ) ||
        Boolean(
          inventory &&
          connection.provider === "radarr" &&
          Date.now() - inventory.at < lifetime,
        ),
    };
  }
  private remember(
    connection: ProviderConnection,
    inventory: ProviderInventory,
    error: string | null,
  ) {
    const key = this.identity(connection),
      now = Date.now();
    this.store.db
      .prepare(
        `INSERT INTO provider_suggestions(connection_key,provider,url,roots_json,observed_ms,last_attempt_ms,last_error)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(connection_key) DO UPDATE SET roots_json=excluded.roots_json,observed_ms=excluded.observed_ms,last_attempt_ms=excluded.last_attempt_ms,last_error=excluded.last_error`,
      )
      .run(
        key,
        connection.provider,
        integrationUrl(connection.url).toString(),
        JSON.stringify(observedRoots(inventory)),
        now,
        now,
        error,
      );
    this.store.db
      .prepare(
        "DELETE FROM provider_suggestions WHERE connection_key IN (SELECT connection_key FROM provider_suggestions ORDER BY last_attempt_ms DESC,connection_key LIMIT -1 OFFSET 128)",
      )
      .run();
  }
  private failed(connection: ProviderConnection) {
    this.store.db
      .prepare(
        `INSERT INTO provider_suggestions(connection_key,provider,url,last_attempt_ms,last_error)
      VALUES(?,?,?,?,?) ON CONFLICT(connection_key) DO UPDATE SET last_attempt_ms=excluded.last_attempt_ms,last_error=excluded.last_error`,
      )
      .run(
        this.identity(connection),
        connection.provider,
        integrationUrl(connection.url).toString(),
        Date.now(),
        "Provider could not be read. Check its address, API key and availability, then retry.",
      );
    this.store.db
      .prepare(
        "DELETE FROM provider_suggestions WHERE connection_key IN (SELECT connection_key FROM provider_suggestions ORDER BY last_attempt_ms DESC,connection_key LIMIT -1 OFFSET 128)",
      )
      .run();
  }
  private trim() {
    for (const cache of [this.inventories, this.imports]) {
      for (const [key, value] of cache)
        if (Date.now() - value.at >= lifetime) cache.delete(key);
      while (cache.size > 2) cache.delete(cache.keys().next().value!);
    }
  }
  private inventory(
    connection: ProviderConnection,
    force: boolean,
    bypassBackoff = false,
  ) {
    this.trim();
    const key = this.identity(connection);
    const pending = this.inventoryPending.get(key);
    if (pending) return pending;
    const saved = this.inventories.get(key);
    if (!force && saved && Date.now() - saved.at < lifetime)
      return Promise.resolve(saved.value);
    const failure = this.store.db
      .prepare(
        "SELECT last_attempt_ms,last_error FROM provider_suggestions WHERE connection_key=?",
      )
      .get(key);
    invariant(
      bypassBackoff ||
        !failure?.last_error ||
        Date.now() - Number(failure.last_attempt_ms) >= 15_000,
      429,
      "Provider recently failed; retry shortly",
    );
    invariant(
      this.inventoryPending.size < 4,
      429,
      "Provider request limit reached; retry shortly",
    );
    const job = readProviderInventory(
      connection.provider,
      connection.url,
      connection.apiKey,
      this.fetcher,
      this.signal,
    )
      .then((value) => {
        this.signal?.throwIfAborted();
        if (value.entries.length <= 50_000)
          this.inventories.set(key, { at: Date.now(), value });
        this.imports.delete(key);
        this.remember(connection, value, null);
        this.trim();
        return value;
      })
      .catch((error) => {
        if (!this.signal?.aborted) this.failed(connection);
        throw error;
      })
      .finally(() => this.inventoryPending.delete(key));
    this.inventoryPending.set(key, job);
    return job;
  }
  async refresh(connection: ProviderConnection) {
    // A second explicit click reuses an immediately preceding read; no polling.
    const recent = this.inventories.get(this.identity(connection));
    try {
      await this.inventory(
        connection,
        !recent || Date.now() - recent.at >= 15_000,
      );
    } catch {
      this.signal?.throwIfAborted();
      const snapshot = this.snapshot(connection);
      return {
        ...snapshot,
        stale: true,
        error:
          snapshot.error ??
          "Provider suggestions are busy or unavailable. Retry shortly.",
      };
    }
    return this.snapshot(connection);
  }
  items(
    connection: ProviderConnection,
    newerThan = 0,
    bypassBackoff = false,
  ): Promise<ImportedItem[]> {
    this.trim();
    const key = this.identity(connection),
      pending = this.importPending.get(key);
    if (pending) return pending;
    const cached = this.imports.get(key);
    if (cached && cached.at > newerThan && Date.now() - cached.at < lifetime)
      return Promise.resolve(cached.value);
    const inventory = this.inventories.get(key);
    const job = this.inventory(
      connection,
      newerThan > 0 && (!inventory || inventory.at <= newerThan),
      bypassBackoff,
    )
      .then((inventory) =>
        readIntegration(
          connection.provider,
          connection.url,
          connection.apiKey,
          this.fetcher,
          this.signal,
          inventory,
        ),
      )
      .then((value) => {
        this.signal?.throwIfAborted();
        if (value.length <= 50_000)
          this.imports.set(key, { at: Date.now(), value });
        this.trim();
        return value;
      })
      .finally(() => this.importPending.delete(key));
    this.importPending.set(key, job);
    return job;
  }
  async stop() {
    await Promise.allSettled([
      ...this.inventoryPending.values(),
      ...this.importPending.values(),
    ]);
    this.inventories.clear();
    this.imports.clear();
  }
  previewItems(connection: ProviderConnection): ImportedItem[] | null {
    const key = this.identity(connection),
      cached = this.imports.get(key);
    if (cached && Date.now() - cached.at < lifetime) return cached.value;
    const inventory = this.inventories.get(key);
    if (
      !inventory ||
      Date.now() - inventory.at >= lifetime ||
      inventory.value.provider !== "radarr"
    )
      return null;
    return inventory.value.entries.flatMap((entry) =>
      entry.hasFile !== false && entry.movieFile?.path
        ? [
            {
              provider: "radarr" as const,
              externalId: String(entry.id),
              path: entry.movieFile.path,
              title: entry.title,
              metadata: {},
            },
          ]
        : [],
    );
  }
}

export function mappingSourceRevision(source: Source) {
  return hash([source.id, source.root_path, source.kind]);
}
export function validateMappings(mappings: PathMapping[]) {
  const prefixes = new Set<string>();
  for (const mapping of mappings) {
    const from = mapping.from.replace(/\\/g, "/");
    invariant(
      from.length <= 4096 &&
        /^(?:\/|[a-z]:\/)/i.test(from) &&
        !from.split("/").some((part) => part === ".." || part === ".") &&
        !/[\0\r\n]/.test(from),
      400,
      "Provider mapping paths must be absolute and cannot contain traversal",
    );
    invariant(
      mapping.to.length <= 4096 &&
        isAbsolute(mapping.to) &&
        !mapping.to
          .split(/[\\/]/)
          .some((part) => part === ".." || part === ".") &&
        !/[\0\r\n]/.test(mapping.to),
      400,
      "Container mapping paths must be absolute and cannot contain traversal",
    );
    const prefix =
      /^[a-z]:/i.test(from) || from.startsWith("//")
        ? from.toLowerCase().replace(/\/+$/, "")
        : from.replace(/\/+$/, "");
    invariant(
      !prefixes.has(prefix),
      400,
      "Each provider path can have only one mapping",
    );
    prefixes.add(prefix);
  }
}
export function previewMappings(
  store: Store,
  source: Source,
  mappings: PathMapping[],
  paths: string[],
) {
  validateMappings(mappings);
  return paths.slice(0, 20).map((upstreamPath) => {
    const mappedPath = mapIntegrationPath(upstreamPath, mappings);
    if (!mappedPath || !containsPath(source.root_path, mappedPath))
      return { upstreamPath, mappedPath, state: "outside-source" };
    const path = relative(source.root_path, mappedPath).split(sep).join("/");
    const item = store.db
      .prepare(
        "SELECT id,available FROM media WHERE source_id=? AND relative_path=?",
      )
      .get(source.id, path);
    return {
      upstreamPath,
      mappedPath,
      state:
        item?.available === 1
          ? "matched"
          : item
            ? "unavailable"
            : "not-cataloged",
      mediaId: item?.id ?? null,
    };
  });
}

export interface MountCandidate {
  path: string;
  access: "read-only" | "read-write" | "unknown";
  type: "not-checked";
  origin: "process-mount";
}
const decodeMount = (value: string) =>
  value.replace(/\\(040|011|012|134)/g, (_, octal: string) =>
    String.fromCharCode(parseInt(octal, 8)),
  );
export function parseMounts(input: string): MountCandidate[] {
  invariant(
    input.length <= 2 * 1024 * 1024,
    422,
    "Mount information exceeds the suggestion limit",
  );
  const candidates = new Map<string, MountCandidate>();
  for (const line of input.split("\n")) {
    const parts = line.split(" - ");
    if (parts.length !== 2) continue;
    const fields = parts[0]!.split(" ");
    if (fields.length < 6) continue;
    const path = decodeMount(fields[4]!);
    if (
      !path.startsWith("/") ||
      path === "/" ||
      /[\0\r\n\t]/.test(path) ||
      /^(?:\/proc|\/sys|\/dev|\/etc|\/app|\/run|\/boot|\/usr|\/bin|\/sbin|\/lib|\/lib64)(?:\/|$)/.test(
        path,
      )
    )
      continue;
    const fs = parts[1]!.split(" ")[0];
    if (
      [
        "proc",
        "sysfs",
        "devtmpfs",
        "devpts",
        "cgroup",
        "cgroup2",
        "mqueue",
        "securityfs",
        "debugfs",
        "tracefs",
      ].includes(fs ?? "")
    )
      continue;
    const options = fields[5]!.split(",");
    candidates.set(path, {
      path,
      access: options.includes("ro")
        ? "read-only"
        : options.includes("rw")
          ? "read-write"
          : "unknown",
      type: "not-checked",
      origin: "process-mount",
    });
    if (candidates.size >= 256) break;
  }
  return [...candidates.values()].sort((a, b) => a.path.localeCompare(b.path));
}
export class PathSuggestions {
  private pending:
    | Promise<{
        items: MountCandidate[];
        supported: boolean;
        error: string | null;
      }>
    | undefined;
  constructor(
    private readonly store: Store,
    private readonly writableRoots: string[],
    private readonly platform = process.platform,
    private readonly readMounts: () => Promise<string> = () =>
      readFile("/proc/self/mountinfo", "utf8"),
  ) {}
  async read(purpose: "source" | "metadata" | "subtitles", sourceId?: string) {
    if (!this.pending)
      this.pending = (async () => {
        if (this.platform !== "linux")
          return { items: [], supported: false, error: null };
        try {
          return {
            items: parseMounts(await this.readMounts()),
            supported: true,
            error: null,
          };
        } catch {
          return {
            items: [],
            supported: true,
            error:
              "Mount suggestions are unavailable. Enter the server-visible directory manually.",
          };
        }
      })();
    const snapshot = await this.pending;
    const others = this.store.db
      .prepare("SELECT id,root_path,subtitle_root FROM sources")
      .all();
    const items = snapshot.items.filter((candidate) => {
      if (
        this.writableRoots.some(
          (root) =>
            containsPath(resolve(root), candidate.path) ||
            containsPath(candidate.path, resolve(root)),
        )
      )
        return false;
      return !others.some((row) => {
        if (row.id === sourceId) return false;
        const roots =
          purpose === "metadata"
            ? []
            : [
                String(row.root_path),
                ...(row.subtitle_root ? [String(row.subtitle_root)] : []),
              ];
        return roots.some(
          (root) =>
            containsPath(root, candidate.path) ||
            containsPath(candidate.path, root),
        );
      });
    });
    return {
      ...snapshot,
      items,
      observedAt: null,
      origin: "process-mounts",
      directoryStatus: "not-checked",
    };
  }
}
