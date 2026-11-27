import {
  browseSelectionPage,
  browseCatalogTree,
  type SelectionPageInput,
  type TreePageInput,
} from "./catalog-selection.js";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type { Store } from "./database.js";
import { DomainError, invariant, type Account } from "./domain.js";
import { refreshAccount, requireProfile } from "./security.js";
import { ensureCatalogProjection } from "./catalog-projection.js";
import { browseLibraryPage } from "./library-page.js";
import { browseMediaPage, programmingOptions } from "./library.js";
import {
  type CatalogOperation,
  type CatalogOperations,
  type CatalogOptionsInput,
  type CatalogWork,
  type CatalogWorkerMessage,
  type CatalogWorkerReply,
  type LibraryPageInput,
  type MediaPageInput,
} from "./catalog-protocol.js";

type Result = CatalogOperations[CatalogOperation]["result"];
type Input = CatalogOperations[CatalogOperation]["input"];
interface Waiter {
  resolve: (value: Result) => void;
  reject: (reason: unknown) => void;
  cleanup: () => void;
}
interface Job {
  key: string;
  operation: CatalogOperation;
  account: Account;
  profileId: string;
  input: Input;
  abort: AbortController;
  waiters: Set<Waiter>;
}
interface PendingReply {
  id: number;
  resolve: (value: CatalogWorkerReply & { type: "result" }) => void;
  reject: (reason: unknown) => void;
}
export interface CatalogServiceOptions {
  maxQueued?: number;
  maxWaiters?: number;
  timeoutMs?: number;
  workerUrl?: URL;
  prepare?: (store: Store, options: { signal: AbortSignal }) => Promise<number>;
}
const unavailable = () =>
  new DomainError(503, "Library reader unavailable; retry");
const cancelled = () => new DomainError(503, "Library request cancelled");

/** One bounded reader lane. The main connection remains the only database writer. */
export class CatalogService {
  private readonly epoch = randomUUID();
  private generation = 0;
  private nextId = 0;
  private worker: Worker | undefined;
  private workerReady: Promise<Worker> | undefined;
  private pending: PendingReply | undefined;
  private retryAt = 0;
  private readonly jobs = new Map<string, Job>();
  private readonly queue: Job[] = [];
  private active: Job | undefined;
  private closed = false;
  private stopping: Promise<void> | undefined;
  private readonly completed = new WeakMap<
    object,
    {
      revision: number;
      role: Account["role"];
      accountId: string;
      profileId: string;
    }
  >();
  private readonly maxQueued: number;
  private readonly maxWaiters: number;
  private readonly timeoutMs: number;
  private readonly prepare: NonNullable<CatalogServiceOptions["prepare"]>;

  constructor(
    private readonly store: Store,
    private readonly options: CatalogServiceOptions = {},
  ) {
    this.maxQueued = options.maxQueued ?? 8;
    this.maxWaiters = options.maxWaiters ?? 64;
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.prepare = options.prepare ?? ensureCatalogProjection;
    invariant(
      this.maxQueued >= 1 && this.maxWaiters >= 1 && this.timeoutMs > 0,
      500,
      "Invalid catalog reader limits",
    );
  }

  libraryPage(
    account: Account,
    profileId: string,
    input: LibraryPageInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<CatalogOperations["library"]["result"]> {
    return this.execute("library", account, profileId, input, options.signal);
  }
  mediaPage(
    account: Account,
    profileId: string,
    input: MediaPageInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<CatalogOperations["media"]["result"]> {
    return this.execute("media", account, profileId, input, options.signal);
  }
  optionsPage(
    account: Account,
    profileId: string,
    input: CatalogOptionsInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<CatalogOperations["options"]["result"]> {
    return this.execute("options", account, profileId, input, options.signal);
  }

  selectionPage(
    account: Account,
    profileId: string,
    input: SelectionPageInput,
    options: { signal?: AbortSignal } = {},
  ) {
    return this.execute("selection", account, profileId, input, options.signal);
  }
  treePage(
    account: Account,
    profileId: string,
    input: TreePageInput,
    options: { signal?: AbortSignal } = {},
  ) {
    return this.execute("tree", account, profileId, input, options.signal);
  }
  assertCurrent(result: object, account: Account, profileId: string): void {
    const current = this.authority(account, profileId);
    const completed = this.completed.get(result);
    invariant(
      completed &&
        completed.revision === this.revision() &&
        completed.accountId === current.id &&
        completed.role === current.role &&
        completed.profileId === profileId,
      503,
      "Library changed; retry",
    );
  }

  private revision() {
    return Number(
      this.store.db
        .prepare("SELECT revision FROM catalog_revision WHERE id=1")
        .get()?.revision,
    );
  }
  private authority(account: Account, profileId: string): Account {
    const current = refreshAccount(this.store, account);
    requireProfile(this.store, current, profileId);
    // sessionHash is deliberately non-enumerable on authenticated Account values.
    // Explicitly include it so the worker can reconstruct device/PIN scope.
    return {
      id: current.id,
      username: current.username,
      role: current.role,
      disabled: current.disabled,
      ...(current.sessionHash ? { sessionHash: current.sessionHash } : {}),
    };
  }
  private async execute<K extends CatalogOperation>(
    operation: K,
    account: Account,
    profileId: string,
    input: CatalogOperations[K]["input"],
    signal?: AbortSignal,
  ): Promise<CatalogOperations[K]["result"]> {
    invariant(!this.closed, 503, "Library reader is stopping");
    invariant(
      !this.store.db.isTransaction,
      503,
      "Library reads cannot await an open transaction",
    );
    if (signal?.aborted) throw cancelled();
    const current = this.authority(account, profileId);
    const key = JSON.stringify([
      operation,
      current.id,
      current.role,
      current.sessionHash,
      profileId,
      input,
      this.revision(),
    ]);
    let job = this.jobs.get(key);
    // A new mount may request the same page while an abandoned worker call
    // drains. Queue one fresh job instead of inheriting its cancelled state.
    if (job?.abort.signal.aborted && !job.waiters.size) job = undefined;
    const waiterCount = [...this.jobs.values()].reduce(
      (sum, entry) => sum + entry.waiters.size,
      0,
    );
    invariant(
      waiterCount < this.maxWaiters,
      503,
      "Library reader is busy; retry",
    );
    if (!job) {
      invariant(
        this.queue.length < this.maxQueued,
        503,
        "Library reader is busy; retry",
      );
      job = {
        key,
        operation,
        account: current,
        profileId,
        input,
        abort: new AbortController(),
        waiters: new Set(),
      };
      this.jobs.set(key, job);
      this.queue.push(job);
    }
    invariant(
      !job.abort.signal.aborted,
      503,
      "Library reader is cancelling; retry",
    );
    const entry = job;
    return new Promise<Result>((resolve, reject) => {
      const onAbort = () => {
        entry.waiters.delete(waiter);
        waiter.cleanup();
        reject(cancelled());
        if (!entry.waiters.size) {
          entry.abort.abort();
          const queued = this.queue.indexOf(entry);
          if (queued >= 0) {
            this.queue.splice(queued, 1);
            this.jobs.delete(entry.key);
          }
        }
      };
      const waiter: Waiter = {
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener("abort", onAbort),
      };
      entry.waiters.add(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
      void this.pump();
    }) as Promise<CatalogOperations[K]["result"]>;
  }

  private async pump() {
    if (this.active || this.closed) return;
    const job = this.queue.shift();
    if (!job) return;
    this.active = job;
    const deadline = setTimeout(() => job.abort.abort(), this.timeoutMs);
    try {
      const result = await this.run(job);
      for (const waiter of job.waiters) waiter.resolve(result);
    } catch (error) {
      for (const waiter of job.waiters)
        waiter.reject(job.abort.signal.aborted ? cancelled() : error);
    } finally {
      clearTimeout(deadline);
      for (const waiter of job.waiters) waiter.cleanup();
      if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
      this.active = undefined;
      void this.pump();
    }
  }

  private async run(job: Job): Promise<Result> {
    // A result can race a grant or metadata commit while the reader runs. Retry
    // once at the newest committed revision; continuous writes return a clear 503.
    for (let attempt = 0; attempt < 2; attempt++) {
      job.abort.signal.throwIfAborted();
      let account = this.authority(job.account, job.profileId);
      if (this.store.filename === ":memory:") {
        const volume = this.store.db
          .prepare(
            `SELECT (SELECT COUNT(*) FROM media) AS items,
            (SELECT COALESCE(SUM(length(CAST(metadata_json AS BLOB))),0) FROM media)+
            (SELECT COALESCE(SUM(length(CAST(metadata_json AS BLOB))),0) FROM integration_metadata)+
            (SELECT COALESCE(SUM(length(CAST(state_json AS BLOB)))+SUM(COALESCE(length(CAST(local_json AS BLOB)),0)),0) FROM display_metadata) AS bytes`,
          )
          .get()!;
        invariant(
          Number(volume.items) <= 2000 &&
            Number(volume.bytes) <= 8 * 1024 * 1024,
          503,
          "Large library verification requires a file-backed database",
        );
      }
      const revision = await this.prepare(this.store, {
        signal: job.abort.signal,
      });
      job.abort.signal.throwIfAborted();
      account = this.authority(job.account, job.profileId);
      if (revision !== this.revision()) continue;
      let result: Result;
      if (this.store.filename === ":memory:") {
        result =
          job.operation === "selection"
            ? browseSelectionPage(
                this.store,
                account,
                job.profileId,
                job.input as SelectionPageInput,
              )
            : job.operation === "tree"
              ? browseCatalogTree(
                  this.store,
                  account,
                  job.profileId,
                  job.input as TreePageInput,
                )
              : job.operation === "library"
                ? browseLibraryPage(
                    this.store,
                    account,
                    job.profileId,
                    job.input as LibraryPageInput,
                  )
                : job.operation === "media"
                  ? browseMediaPage(
                      this.store,
                      account,
                      job.profileId,
                      job.input as MediaPageInput,
                    )
                  : programmingOptions(
                      this.store,
                      account,
                      job.profileId,
                      job.input as CatalogOptionsInput,
                    );
      } else {
        const reply = await this.readWorker(job, account, revision);
        if (reply.revision !== revision) continue;
        if (reply.error) {
          if (reply.error.message === "Library changed; retry") continue;
          throw new DomainError(reply.error.statusCode, reply.error.message);
        }
        invariant(reply.result, 503, "Library reader returned no result");
        result = reply.result;
      }
      job.abort.signal.throwIfAborted();
      const fresh = this.authority(job.account, job.profileId);
      if (fresh.role !== account.role || revision !== this.revision()) continue;
      this.completed.set(result, {
        revision,
        role: fresh.role,
        accountId: fresh.id,
        profileId: job.profileId,
      });
      return result;
    }
    throw new DomainError(503, "Library changed; retry");
  }

  private createWorker(): Worker {
    const workerOptions = {
      workerData: { filename: this.store.filename },
      resourceLimits: {
        maxOldGenerationSizeMb: 256,
        maxYoungGenerationSizeMb: 16,
      },
    };
    if (this.options.workerUrl)
      return new Worker(this.options.workerUrl, workerOptions);
    if (import.meta.url.endsWith(".ts")) {
      // Source development uses the existing dev dependency explicitly. The
      // compiled runtime takes the .js branch and needs no tsx installation.
      const bootstrap = `const {tsImport}=await import(${JSON.stringify(import.meta.resolve("tsx/esm/api"))});await tsImport(${JSON.stringify(new URL("./catalog-worker.ts", import.meta.url).href)},${JSON.stringify(import.meta.url)});`;
      return new Worker(
        new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`),
        workerOptions,
      );
    }
    return new Worker(
      new URL("./catalog-worker.js", import.meta.url),
      workerOptions,
    );
  }
  private async readyWorker(): Promise<Worker> {
    if (this.workerReady) return this.workerReady;
    invariant(
      Date.now() >= this.retryAt,
      503,
      "Library reader is restarting; retry",
    );
    const worker = this.createWorker();
    this.worker = worker;
    this.generation++;
    this.workerReady = new Promise<Worker>((resolve, reject) => {
      let ready = false;
      const startup = setTimeout(() => {
        reject(unavailable());
        void worker.terminate();
      }, 5000);
      const fail = () => {
        clearTimeout(startup);
        if (!ready) reject(unavailable());
        if (this.worker === worker) {
          this.worker = undefined;
          this.workerReady = undefined;
          this.retryAt = Date.now() + 250;
          this.pending?.reject(unavailable());
          this.pending = undefined;
        }
      };
      worker.on("message", (message: CatalogWorkerReply) => {
        if (message.type === "ready") {
          ready = true;
          clearTimeout(startup);
          worker.unref();
          resolve(worker);
        } else if (
          message.epoch === this.epoch &&
          message.generation === this.generation &&
          this.pending?.id === message.id
        ) {
          this.pending.resolve(message);
        }
      });
      worker.on("error", fail);
      worker.on("exit", fail);
    });
    return this.workerReady;
  }
  private async readWorker(job: Job, account: Account, revision: number) {
    const worker = await this.readyWorker();
    job.abort.signal.throwIfAborted();
    const cancellation = new SharedArrayBuffer(4);
    const id = ++this.nextId;
    worker.ref();
    let termination: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      Atomics.store(new Int32Array(cancellation), 0, 1);
      termination = setTimeout(() => {
        void worker.terminate();
      }, 250);
    };
    job.abort.signal.addEventListener("abort", onAbort, { once: true });
    try {
      return await new Promise<CatalogWorkerReply & { type: "result" }>(
        (resolve, reject) => {
          this.pending = { id, resolve, reject };
          const message: CatalogWorkerMessage = {
            type: "run",
            work: {
              id,
              epoch: this.epoch,
              generation: this.generation,
              revision,
              operation: job.operation,
              account,
              profileId: job.profileId,
              input: job.input,
              cancellation,
            } satisfies CatalogWork,
          };
          worker.postMessage(message);
          if (job.abort.signal.aborted) onAbort();
        },
      );
    } finally {
      clearTimeout(termination);
      job.abort.signal.removeEventListener("abort", onAbort);
      this.pending = undefined;
      worker.unref();
    }
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.closed = true;
    for (const job of this.jobs.values()) {
      job.abort.abort();
      for (const waiter of job.waiters) {
        waiter.cleanup();
        waiter.reject(new DomainError(503, "Library reader is stopping"));
      }
      job.waiters.clear();
    }
    this.queue.length = 0;
    this.stopping = (async () => {
      // Await an in-progress startup too: it must not create a reader after the
      // owner has closed Store and released the data-directory lock.
      const worker = this.worker;
      if (worker && worker.threadId !== -1) {
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(deadline);
            resolve();
          };
          const deadline = setTimeout(() => {
            void worker.terminate().then(finish, finish);
          }, 250);
          worker.once("exit", finish);
          try {
            worker.postMessage({ type: "stop" } satisfies CatalogWorkerMessage);
          } catch {
            void worker.terminate().then(finish, finish);
          }
        });
      }
      this.pending?.reject(unavailable());
      this.pending = undefined;
      while (this.active)
        await new Promise<void>((resolve) => setImmediate(resolve));
      this.jobs.clear();
    })();
    return this.stopping;
  }
}
