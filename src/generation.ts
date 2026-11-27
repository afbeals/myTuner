import { EncoderAdmission } from "./encoder-admission.js";
import { availableOutputBytes, OutputBudget } from "./storage.js";
import { BackgroundWork } from "./background-work.js";
import { OutputPaths } from "./output-paths.js";
import type { OutputStage } from "./output-paths.js";
import { fstatSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import type { Store } from "./database.js";
import type { Media, Source } from "./domain.js";
import { DomainError, invariant } from "./domain.js";
import { containsPath, safeMediaPath } from "./catalog.js";
import { normalizeSubtree, sourceById, withinSubtree } from "./security.js";

export type AssetKind = "thumbnail" | "gif" | "conversion";
export interface GenerationRequest {
  sourceId: string;
  directory: string;
  recursive: boolean;
  kinds: AssetKind[];
  regenerate: boolean;
}
interface Job {
  id: string;
  source_id: string;
  directory: string;
  recursive: number;
  status: string;
  regenerate: number;
  created_at: number;
  error: string | null;
}
interface Task {
  id: string;
  job_id: string;
  media_id: string;
  kind: AssetKind;
  status: string;
}
export function assetFingerprint(media: Media, kind: AssetKind): string {
  return createHash("sha256")
    .update(
      JSON.stringify([media.id, media.size, media.mtime_ms, kind, "preset-v1"]),
    )
    .digest("hex");
}
const extensions: Record<AssetKind, string> = {
  thumbnail: "jpg",
  gif: "gif",
  conversion: "mp4",
};
export function assetRelativePath(media: Media, kind: AssetKind): string {
  return join(
    media.id,
    assetFingerprint(media, kind),
    `${kind}.${extensions[kind]}`,
  );
}
export async function previewGeneration(
  store: Store,
  input: GenerationRequest,
): Promise<{ source: Source; directory: string; items: Media[] }> {
  const source = sourceById(store, input.sourceId),
    directory = normalizeSubtree(input.directory);
  const path = await realpath(join(source.root_path, directory));
  invariant(
    containsPath(source.root_path, path) && (await stat(path)).isDirectory(),
    400,
    "Directory is outside source or unavailable",
  );
  invariant(
    input.kinds.length > 0 && new Set(input.kinds).size === input.kinds.length,
    400,
    "Choose distinct output types",
  );
  const items = (
    store.db
      .prepare(
        "SELECT * FROM media WHERE source_id=? AND available=1 ORDER BY relative_path",
      )
      .all(source.id) as unknown as Media[]
  ).filter((item) =>
    input.recursive
      ? withinSubtree(item.relative_path, directory)
      : dirname(item.relative_path) === (directory || "."),
  );
  invariant(
    items.length <= 5000,
    400,
    "Select a smaller directory (maximum 5000 files per job)",
  );
  return { source, directory, items };
}
export async function generationPreflight(
  store: Store,
  input: GenerationRequest,
  root: string,
) {
  const preview = await previewGeneration(store, input);
  const canonicalRoot = await realpath(root).catch(() => root);
  let reusable = 0;
  for (const item of preview.items)
    for (const kind of input.kinds) {
      if (input.regenerate) continue;
      const asset = store.db
        .prepare(
          "SELECT relative_path FROM generated_assets WHERE media_id=? AND kind=? AND fingerprint=?",
        )
        .get(item.id, kind, assetFingerprint(item, kind));
      if (!asset) continue;
      try {
        const path = await safeMediaPath(
          {
            id: "generated",
            name: "Generated",
            root_path: canonicalRoot,
            kind: "videos",
            recursive: 1,
          },
          assetRelativePath(item, kind),
        );
        if ((await stat(path)).isFile()) reusable++;
      } catch {
        /* Missing or escaped derivatives will be regenerated. */
      }
    }
  const outputs = preview.items.length * input.kinds.length;
  const availableBytes = await availableOutputBytes(
    root,
    50 * 1024 ** 3,
    512 * 1024 ** 2,
  ).catch(() => null);
  return {
    ...preview,
    reusableOutputs: reusable,
    newOutputs: outputs - reusable,
    totalOutputs: outputs,
    totalDurationMs: preview.items.reduce(
      (sum, item) => sum + item.duration_ms,
      0,
    ),
    availableBytes,
    fingerprintBasis: "catalog",
    estimatedBytes: null,
    estimatedDurationMs: null,
  };
}
export function runFFmpeg(
  args: string[],
  signal: AbortSignal,
  output?: { fd: number; format: string },
): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const actual = [...args];
    if (output) {
      actual.pop();
      actual.push(
        "-y",
        "-f",
        output.format,
        ...(process.platform === "linux"
          ? ["/proc/self/fd/3"]
          : ["-fd", "3", "fd:"]),
      );
    }
    const child = spawn(
      "ffmpeg",
      ["-nostdin", "-hide_banner", "-loglevel", "error", ...actual],
      {
        stdio: output
          ? ["ignore", "ignore", "pipe", output.fd]
          : ["ignore", "ignore", "pipe"],
        signal,
      },
    );
    // Drain diagnostics without exposing source paths or buffering unbounded output.
    child.stderr?.on("data", () => {});
    const timer = setTimeout(
      () => {
        child.kill("SIGKILL");
      },
      60 * 60 * 1000,
    );
    timer.unref();
    let failure: Error | undefined;
    child.on("error", (error) => {
      failure = error;
    });
    const abort = () => {
      const kill = setTimeout(() => child.kill("SIGKILL"), 2000);
      kill.unref();
      child.once("close", () => clearTimeout(kill));
    };
    child.on("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else if (code === 0) resolve();
      else reject(new Error("FFmpeg failed"));
    });
    signal.addEventListener("abort", abort, { once: true });
  });
}
export class GenerationRunner {
  private running: Promise<void> | null = null;
  private active: { jobId: string; controller: AbortController } | null = null;
  private stopping = false;
  private storageTask: Promise<unknown> | null = null;
  private storageController: AbortController | null = null;
  private readonly budget: OutputBudget;
  private readonly outputs: OutputPaths;
  constructor(
    private readonly store: Store,
    public readonly root: string,
    private readonly execute = runFFmpeg,
    private readonly limits = {
      maxBytes: 50 * 1024 ** 3,
      reserveBytes: 512 * 1024 ** 2,
      maxPendingJobs: 25,
    },
    private readonly encoders = new EncoderAdmission(),
    private readonly background = new BackgroundWork(),
  ) {
    this.budget = new OutputBudget(root);
    this.outputs = new OutputPaths(root, store);
    // Interrupted work is replayable: incomplete outputs were never published.
    store.db.exec(
      "UPDATE generation_jobs SET status='queued' WHERE status='running'; UPDATE generation_items SET status='queued',waiting_reason=NULL WHERE status='running';",
    );
  }
  private assertCapacity(): void {
    invariant(!this.stopping, 503, "Server is stopping");
    invariant(
      !this.storageTask,
      409,
      "Output reconciliation is in progress; retry shortly",
    );
    invariant(
      Number(
        this.store.db
          .prepare(
            "SELECT COUNT(*) AS n FROM generation_jobs WHERE status IN ('queued','running')",
          )
          .get()?.n,
      ) < this.limits.maxPendingJobs,
      429,
      "Generation queue is full",
    );
  }
  async enqueue(input: GenerationRequest): Promise<Job> {
    this.assertCapacity();
    const preview = await previewGeneration(this.store, input);
    invariant(
      preview.items.length > 0,
      400,
      "No available catalog files in this scope",
    );
    const root = this.outputs.create(
      this.store.db
        .prepare(
          "SELECT root_path FROM sources UNION SELECT subtitle_root AS root_path FROM sources WHERE subtitle_root IS NOT NULL UNION SELECT metadata_root AS root_path FROM sources WHERE metadata_root IS NOT NULL",
        )
        .all()
        .map((row) => String(row.root_path)),
    );
    invariant(
      !containsPath(preview.source.root_path, root) &&
        !containsPath(root, preview.source.root_path),
      400,
      "Generated output and source must not overlap",
    );
    const id = randomUUID();
    this.store.transaction(() => {
      // Filesystem validation yielded; capacity and shutdown state may have changed.
      this.assertCapacity();
      this.store.db
        .prepare(
          "INSERT INTO generation_jobs(id,source_id,directory,recursive,status,regenerate,created_at) VALUES(?,?,?,?,'queued',?,?)",
        )
        .run(
          id,
          input.sourceId,
          preview.directory,
          Number(input.recursive),
          Number(input.regenerate),
          Date.now(),
        );
      const insert = this.store.db.prepare(
        "INSERT INTO generation_items(id,job_id,media_id,kind,status) VALUES(?,?,?,?,'queued')",
      );
      for (const item of preview.items)
        for (const kind of input.kinds)
          insert.run(randomUUID(), id, item.id, kind);
    });
    return this.get(id);
  }
  get(id: string): Job {
    const job = this.store.db
      .prepare("SELECT * FROM generation_jobs WHERE id=?")
      .get(id) as unknown as Job | undefined;
    invariant(job, 404, "Generation job not found");
    return job;
  }
  tasks(id: string): Task[] {
    this.get(id);
    return this.store.db
      .prepare(
        "SELECT i.*,m.title,m.relative_path FROM generation_items i JOIN media m ON m.id=i.media_id WHERE job_id=? ORDER BY i.rowid",
      )
      .all(id) as unknown as Task[];
  }
  taskPage(id: string, offset: number, limit: number) {
    this.get(id);
    const items = this.store.db
      .prepare(
        "SELECT i.*,m.title,m.relative_path FROM generation_items i JOIN media m ON m.id=i.media_id WHERE job_id=? ORDER BY i.rowid LIMIT ? OFFSET ?",
      )
      .all(id, limit + 1, offset);
    const current =
      this.store.db
        .prepare(
          "SELECT m.relative_path FROM generation_items i JOIN media m ON m.id=i.media_id WHERE job_id=? AND i.status='running' ORDER BY i.rowid LIMIT 1",
        )
        .get(id) ?? null;
    return {
      items: items.slice(0, limit),
      hasMore: items.length > limit,
      offset,
      limit,
      current,
    };
  }
  private admission(id: string, status: string, encoderWaiting = false) {
    if (!["queued", "running"].includes(status))
      return { admission: null, waitingReason: null };
    if (encoderWaiting)
      return { admission: "waiting", waitingReason: "playback-capacity" };
    const state = this.background.status(`generation:${id}`);
    return state.admission
      ? state
      : { admission: "waiting", waitingReason: "queue" };
  }
  summary(id: string): Record<string, unknown> {
    this.get(id);
    const { encoderWaiting, ...row } = this.store.db
      .prepare(
        "SELECT j.*,COUNT(i.id) AS total,COALESCE(SUM(i.status='completed'),0) AS completed,COALESCE(SUM(i.status='failed'),0) AS failed,COALESCE(SUM(i.status='cancelled'),0) AS cancelled,MAX(i.status='running' AND i.waiting_reason='playback-capacity') AS encoderWaiting FROM generation_jobs j LEFT JOIN generation_items i ON i.job_id=j.id WHERE j.id=? GROUP BY j.id",
      )
      .get(id)!;
    return {
      ...row,
      ...this.admission(id, String(row.status), Boolean(encoderWaiting)),
    };
  }
  list(): Record<string, unknown>[] {
    return this.store.db
      .prepare(
        "SELECT j.*,COUNT(i.id) AS total,SUM(i.status='completed') AS completed,SUM(i.status='failed') AS failed,MAX(i.status='running' AND i.waiting_reason='playback-capacity') AS encoderWaiting FROM generation_jobs j LEFT JOIN generation_items i ON i.job_id=j.id GROUP BY j.id ORDER BY j.created_at DESC LIMIT 200",
      )
      .all()
      .map(({ encoderWaiting, ...row }) => ({
        ...row,
        ...this.admission(
          String(row.id),
          String(row.status),
          Boolean(encoderWaiting),
        ),
      }));
  }
  retry(id: string) {
    const job = this.get(id);
    invariant(
      ["failed", "cancelled"].includes(job.status),
      409,
      "Only failed or cancelled jobs can retry",
    );
    invariant(
      this.active?.jobId !== id,
      409,
      "Cancellation is still finishing; retry shortly",
    );
    this.assertCapacity();
    this.store.transaction(() => {
      this.store.db
        .prepare(
          "UPDATE generation_jobs SET status='queued',error=NULL WHERE id=?",
        )
        .run(id);
      this.store.db
        .prepare(
          "UPDATE generation_items SET status='queued',error=NULL WHERE job_id=? AND status IN ('failed','cancelled')",
        )
        .run(id);
    });
    return this.get(id);
  }
  cancel(id: string): void {
    const job = this.get(id);
    if (!["queued", "running"].includes(job.status)) return;
    this.store.transaction(() => {
      this.store.db
        .prepare("UPDATE generation_jobs SET status='cancelled' WHERE id=?")
        .run(id);
      this.store.db
        .prepare(
          "UPDATE generation_items SET status='cancelled' WHERE job_id=? AND status IN ('queued','running')",
        )
        .run(id);
    });
    if (this.active?.jobId === id) this.active.controller.abort();
  }
  async withStorageMaintenance<T>(
    work: (check: () => void) => Promise<T>,
  ): Promise<T> {
    invariant(
      !this.stopping && !this.storageTask && !this.running && !this.active,
      409,
      "Wait for generation to finish before reconciling outputs",
    );
    this.storageController = new AbortController();
    const task = this.background.run(
      "reconcile",
      this.storageController.signal,
      async () => {
        this.budget.invalidate();
        return work(() => invariant(!this.stopping, 503, "Server is stopping"));
      },
    );
    this.storageTask = task;
    try {
      return await task;
    } finally {
      this.storageTask = null;
      this.storageController = null;
      this.budget.invalidate();
      if (!this.stopping) void this.drain().catch(() => {});
    }
  }
  drain(): Promise<void> {
    if (this.storageTask || this.stopping) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.work().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  async stop(): Promise<void> {
    this.stopping = true;
    this.active?.controller.abort();
    this.storageController?.abort();
    await Promise.allSettled([this.running, this.storageTask]);
  }
  private async work(): Promise<void> {
    while (!this.stopping) {
      const job = this.store.db
        .prepare(
          "SELECT * FROM generation_jobs WHERE status='queued' ORDER BY created_at,rowid LIMIT 1",
        )
        .get() as unknown as Job | undefined;
      if (!job) return;
      this.store.db
        .prepare("UPDATE generation_jobs SET status='running' WHERE id=?")
        .run(job.id);
      const controller = new AbortController();
      this.active = { jobId: job.id, controller };
      for (const task of this.tasks(job.id)) {
        if (this.stopping || this.get(job.id).status === "cancelled") break;
        if (!["queued", "running"].includes(task.status)) continue;
        this.store.db
          .prepare(
            "UPDATE generation_items SET status='running',error=NULL WHERE id=?",
          )
          .run(task.id);
        try {
          await this.background.run(
            "generation",
            controller.signal,
            () => this.generate(task, job, controller.signal),
            `generation:${job.id}`,
          );
          this.store.db
            .prepare(
              "UPDATE generation_items SET status='completed' WHERE id=? AND status='running'",
            )
            .run(task.id);
        } catch (error) {
          if (this.stopping) {
            this.store.db
              .prepare(
                "UPDATE generation_items SET status='queued' WHERE id=? AND status='running'",
              )
              .run(task.id);
            break;
          }
          this.store.db
            .prepare(
              "UPDATE generation_items SET status='failed',error=? WHERE id=? AND status='running'",
            )
            .run(
              error instanceof DomainError
                ? error.message
                : "Generation failed or source changed",
              task.id,
            );
        }
      }
      if (this.stopping)
        this.store.db
          .prepare(
            "UPDATE generation_jobs SET status='queued' WHERE id=? AND status='running'",
          )
          .run(job.id);
      else if (this.get(job.id).status !== "cancelled") {
        const failed = this.tasks(job.id).some(
          (task) => task.status !== "completed",
        );
        this.store.db
          .prepare("UPDATE generation_jobs SET status=? WHERE id=?")
          .run(failed ? "failed" : "completed", job.id);
      }
      this.active = null;
    }
  }
  private async generate(
    task: Task,
    job: Job,
    signal: AbortSignal,
  ): Promise<void> {
    const media = this.store.db
      .prepare("SELECT * FROM media WHERE id=? AND available=1")
      .get(task.media_id) as Media | undefined;
    invariant(media, 404, "Media unavailable");
    const source = sourceById(this.store, media.source_id),
      input = await safeMediaPath(source, media.relative_path);
    const before = await stat(input);
    invariant(
      before.size === media.size && before.mtimeMs === media.mtime_ms,
      409,
      "Media changed",
    );
    // Version the fixed presets so changed output settings cannot accidentally reuse old files.
    const fingerprint = assetFingerprint(media, task.kind);
    const rel = assetRelativePath(media, task.kind);
    const output = this.outputs.prepare(rel, true);
    const existing = this.store.db
      .prepare(
        "SELECT id FROM generated_assets WHERE media_id=? AND kind=? AND fingerprint=?",
      )
      .get(media.id, task.kind, fingerprint);
    const previousOutput = this.outputs.existing(output);
    if (!job.regenerate && existing && previousOutput) return;
    const reservation = await this.budget.reserve(
      this.limits.maxBytes,
      this.limits.reserveBytes,
      () => signal.throwIfAborted(),
    );
    let stage: OutputStage;
    try {
      this.outputs.check(output);
      stage = this.outputs.stage(
        `.partial-${randomUUID()}.${extensions[task.kind]}`,
      );
    } catch (error) {
      reservation.finish();
      throw error;
    }
    const temp = stage.path;
    const maxOutput = reservation.bytes;
    const seek = Math.min(10000, Math.floor(media.duration_ms / 2)) / 1000;
    const args =
      task.kind === "thumbnail"
        ? [
            "-ss",
            String(seek),
            "-i",
            input,
            "-frames:v",
            "1",
            "-vf",
            "scale=320:-2",
            temp,
          ]
        : task.kind === "gif"
          ? [
              "-i",
              input,
              "-t",
              String(Math.min(media.duration_ms / 1000, 3)),
              "-vf",
              "fps=8,scale=320:-2",
              temp,
            ]
          : [
              "-i",
              input,
              "-map",
              "0:v:0",
              "-map",
              "0:a:0?",
              "-vf",
              "scale=w='min(1280,iw)':h=-2",
              "-c:v",
              "libx264",
              "-preset",
              "veryfast",
              "-crf",
              "23",
              "-c:a",
              "aac",
              "-ac",
              "2",
              "-movflags",
              "+faststart",
              temp,
            ];
    args.unshift("-threads", "2", "-filter_threads", "1");
    args.splice(args.length - 1, 0, "-threads", "2", "-fs", String(maxOutput));
    try {
      signal.throwIfAborted();
      await this.encoders.run(
        "background",
        signal,
        () => {
          invariant(
            !this.stopping && this.get(job.id).status === "running",
            409,
            "Generation is no longer running",
          );
        },
        () => {
          this.outputs.check(output);
          return this.execute(args, signal, {
            fd: stage.fd,
            format:
              task.kind === "thumbnail"
                ? "image2pipe"
                : task.kind === "gif"
                  ? "gif"
                  : "mp4",
          });
        },
        (waiting) => {
          this.store.db
            .prepare("UPDATE generation_items SET waiting_reason=? WHERE id=?")
            .run(waiting ? "playback-capacity" : null, task.id);
        },
      );
      signal.throwIfAborted();
      const after = await stat(input);
      invariant(
        after.size === before.size && after.mtimeMs === before.mtimeMs,
        409,
        "Media changed",
      );
      const outputSize = fstatSync(stage.fd).size;
      invariant(
        outputSize > 0 && outputSize < maxOutput,
        422,
        "Generated output is empty or exceeds quota",
      );
      this.outputs.publish(stage, output);
      reservation.finish(outputSize - Number(previousOutput?.size ?? 0));
      this.store.db
        .prepare(
          "INSERT INTO generated_assets(id,media_id,kind,fingerprint,relative_path) VALUES(?,?,?,?,?) ON CONFLICT(media_id,kind,fingerprint) DO UPDATE SET relative_path=excluded.relative_path",
        )
        .run(
          randomUUID(),
          media.id,
          task.kind,
          fingerprint,
          rel.split(sep).join("/"),
        );
    } finally {
      try {
        this.outputs.close(stage);
      } finally {
        reservation.finish();
      }
    }
  }
}
