import test from "node:test";
import { EncoderAdmission } from "../src/encoder-admission.js";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getEventListeners } from "node:events";
import { Store } from "../src/database.js";
import { addSource, scanSource } from "../src/catalog.js";
import {
  GenerationRunner,
  previewGeneration,
  runFFmpeg,
} from "../src/generation.js";
const execute = promisify(execFile);
async function fixture(
  t: { after: (fn: () => unknown) => void },
  real = false,
) {
  const root = await mkdtemp(join(tmpdir(), "mytuner-generation-")),
    store = new Store(":memory:");
  await mkdir(join(root, "source", "nested"), { recursive: true });
  const file = join(root, "source", "one.mp4");
  if (real)
    await execute("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=32x32:r=10:d=1",
      "-c:v",
      "mpeg4",
      file,
    ]);
  else await writeFile(file, "original");
  await writeFile(join(root, "source", "nested", "two.mp4"), "nested");
  const source = await addSource(
    store,
    {
      name: "Custom",
      root: join(root, "source"),
      kind: "videos",
      recursive: true,
    },
    [join(root, "generated")],
  );
  await scanSource(store, source, async () => 1000);
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const input = {
    sourceId: source.id,
    directory: "",
    recursive: false,
    kinds: ["thumbnail" as const],
    regenerate: false,
  };
  return { root, store, file, source, input };
}
test("generation preview independently controls shallow versus recursive scope", async (t) => {
  const f = await fixture(t);
  assert.equal((await previewGeneration(f.store, f.input)).items.length, 1);
  assert.equal(
    (await previewGeneration(f.store, { ...f.input, recursive: true })).items
      .length,
    2,
  );
  await assert.rejects(
    previewGeneration(f.store, { ...f.input, directory: "../outside" }),
    /escapes/,
  );
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM generation_jobs").get()?.n,
    0,
  );
});
test("jobs publish complete outputs separately, reuse them, and regenerate explicitly", async (t) => {
  const f = await fixture(t);
  let executions = 0;
  const runner = new GenerationRunner(
    f.store,
    join(f.root, "generated"),
    async (args) => {
      executions++;
      await writeFile(args.at(-1)!, "generated-output");
    },
  );
  const before = await readFile(f.file),
    first = await runner.enqueue(f.input);
  await runner.drain();
  assert.equal(runner.get(first.id).status, "completed");
  assert.equal(executions, 1);
  const second = await runner.enqueue(f.input);
  await runner.drain();
  assert.equal(runner.get(second.id).status, "completed");
  assert.equal(executions, 1);
  await runner.enqueue({ ...f.input, regenerate: true });
  await runner.drain();
  assert.equal(executions, 2);
  assert.deepEqual(await readFile(f.file), before);
  assert.deepEqual((await readdir(join(f.root, "source"))).sort(), [
    "nested",
    "one.mp4",
  ]);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM generated_assets").get()?.n,
    1,
  );
  await runner.stop();
});
test("failed or changed sources never publish partial output", async (t) => {
  const f = await fixture(t),
    runner = new GenerationRunner(
      f.store,
      join(f.root, "generated"),
      async (args) => {
        await writeFile(args.at(-1)!, "partial");
        await writeFile(f.file, "source-changed-longer");
      },
    );
  const job = await runner.enqueue(f.input);
  await runner.drain();
  assert.equal(runner.get(job.id).status, "failed");
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM generated_assets").get()?.n,
    0,
  );
  const outputs = await readdir(join(f.root, "generated"), { recursive: true });
  assert.ok(outputs.every((p) => !String(p).includes(".partial-")));
  await runner.stop();
});
test("cancelled queued jobs do not launch conversion", async (t) => {
  const f = await fixture(t);
  let executions = 0;
  const runner = new GenerationRunner(
    f.store,
    join(f.root, "generated"),
    async () => {
      executions++;
    },
  );
  const job = await runner.enqueue({ ...f.input, recursive: true });
  runner.cancel(job.id);
  await runner.drain();
  assert.equal(executions, 0);
  assert.equal(runner.get(job.id).status, "cancelled");
  assert.ok(runner.tasks(job.id).every((item) => item.status === "cancelled"));
  await runner.stop();
});
test("active cancellation aborts execution and preserves cancelled item status", async (t) => {
  const f = await fixture(t);
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const runner = new GenerationRunner(
    f.store,
    join(f.root, "generated"),
    async (_args, signal) => {
      started();
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        }),
      );
    },
  );
  const job = await runner.enqueue(f.input),
    work = runner.drain();
  await ready;
  runner.cancel(job.id);
  await work;
  assert.equal(runner.get(job.id).status, "cancelled");
  assert.equal(runner.tasks(job.id)[0]!.status, "cancelled");
  await runner.stop();
});
test("real FFmpeg produces thumbnail, GIF, and compatible conversion without editing originals", async (t) => {
  try {
    await execute("ffmpeg", ["-version"]);
  } catch {
    t.skip("ffmpeg unavailable");
    return;
  }
  const f = await fixture(t, true),
    before = await readFile(f.file),
    runner = new GenerationRunner(f.store, join(f.root, "generated"));
  const job = await runner.enqueue({
    ...f.input,
    kinds: ["thumbnail", "gif", "conversion"],
  });
  await runner.drain();
  assert.equal(
    runner.get(job.id).status,
    "completed",
    JSON.stringify(runner.tasks(job.id)),
  );
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM generated_assets").get()?.n,
    3,
  );
  assert.deepEqual(await readFile(f.file), before);
  await runner.stop();
});

test("FFmpeg worker removes cancellation listeners between directory items", async (t) => {
  try {
    await execute("ffmpeg", ["-version"]);
  } catch {
    t.skip("ffmpeg unavailable");
    return;
  }
  const controller = new AbortController();
  for (let i = 0; i < 12; i++) {
    await runFFmpeg(["-version"], controller.signal);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  }
});
test("real running FFmpeg exits on cancellation and cleans its signal listeners", async (t) => {
  try {
    await execute("ffmpeg", ["-version"]);
  } catch {
    t.skip("ffmpeg unavailable");
    return;
  }
  const controller = new AbortController(),
    work = runFFmpeg(
      [
        "-re",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=32x32:r=10",
        "-t",
        "600",
        "-f",
        "null",
        "-",
      ],
      controller.signal,
    );
  const rejection = assert.rejects(work);
  setTimeout(() => controller.abort(), 50).unref();
  await rejection;
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("concurrent generation enqueues enforce capacity atomically and cancelled jobs release their slot", async (t) => {
  const f = await fixture(t);
  let executions = 0;
  const runner = new GenerationRunner(
    f.store,
    join(f.root, "generated"),
    async () => {
      executions++;
    },
    { maxBytes: 1000000, reserveBytes: 0, maxPendingJobs: 1 },
  );
  t.after(() => runner.stop());
  const original = await readFile(f.file);
  const results = await Promise.allSettled([
    runner.enqueue(f.input),
    runner.enqueue(f.input),
  ]);
  const accepted = results.filter(
    (
      r,
    ): r is PromiseFulfilledResult<
      Awaited<ReturnType<typeof runner.enqueue>>
    > => r.status === "fulfilled",
  );
  const rejected = results.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );
  assert.equal(accepted.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0]!.reason.statusCode, 429);
  assert.equal(runner.list().length, 1);
  assert.equal(runner.tasks(accepted[0]!.value.id).length, 1);
  runner.cancel(accepted[0]!.value.id);
  const next = await runner.enqueue(f.input);
  assert.equal(next.status, "queued");
  assert.equal(executions, 0);
  assert.deepEqual(await readFile(f.file), original);
});

test("shutdown during enqueue validation prevents a late job from being inserted", async (t) => {
  const f = await fixture(t),
    runner = new GenerationRunner(f.store, join(f.root, "generated"));
  const pending = runner.enqueue(f.input),
    rejected = assert.rejects(
      pending,
      (error: unknown) =>
        error instanceof Error &&
        "statusCode" in error &&
        error.statusCode === 503,
    );
  await runner.stop();
  await rejected;
  assert.equal(runner.list().length, 0);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM generation_items").get()?.n,
    0,
  );
});

test(
  "active cancellation rejects immediate retry until the prior attempt settles, then produces all outputs",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t);
    let release!: () => void,
      started!: () => void,
      executions = 0;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const runner = new GenerationRunner(
      f.store,
      join(f.root, "generated"),
      async (args) => {
        if (++executions === 1) {
          started();
          await new Promise<void>((_, reject) => {
            release = () => reject(new Error("abort settled"));
          });
        } else await writeFile(args.at(-1)!, "retried-output");
      },
    );
    const job = await runner.enqueue(f.input),
      working = runner.drain();
    await began;
    t.after(() => release());
    runner.cancel(job.id);
    assert.throws(() => runner.retry(job.id), /still finishing/);
    assert.equal(runner.get(job.id).status, "cancelled");
    release();
    await working;
    assert.equal(runner.get(job.id).status, "cancelled");
    runner.retry(job.id);
    await runner.drain();
    assert.equal(runner.get(job.id).status, "completed");
    assert.ok(
      runner.tasks(job.id).every((task) => task.status === "completed"),
    );
    assert.equal(
      f.store.db.prepare("SELECT COUNT(*) AS n FROM generated_assets").get()?.n,
      1,
    );
    assert.equal(await readFile(f.file, "utf8"), "original");
    await runner.stop();
  },
);

test(
  "generation reports shared-capacity waiting and cancellation/shutdown remain replayable without source writes",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t),
      admission = new EncoderAdmission(2),
      before = await readFile(f.file);
    let release!: () => void,
      executions = 0;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const interactive = [0, 1].map(() =>
      admission.run(
        "interactive",
        new AbortController().signal,
        () => {},
        () => held,
      ),
    );
    const runner = new GenerationRunner(
      f.store,
      join(f.root, "generated"),
      async (args) => {
        executions++;
        await writeFile(args.at(-1)!, "synthetic-generated-output");
      },
      undefined,
      admission,
    );
    const waiting = async (jobId: string) => {
      for (let n = 0; n < 400; n++) {
        if (
          f.store.db
            .prepare(
              "SELECT waiting_reason FROM generation_items WHERE job_id=?",
            )
            .get(jobId)?.waiting_reason === "playback-capacity"
        )
          return;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.fail(
        "generation never reported waiting for shared playback capacity",
      );
    };
    try {
      const cancelled = await runner.enqueue(f.input),
        draining = runner.drain();
      await waiting(cancelled.id);
      assert.equal(executions, 0);
      runner.cancel(cancelled.id);
      await draining;
      assert.equal(runner.get(cancelled.id).status, "cancelled");
      assert.equal(
        f.store.db
          .prepare("SELECT waiting_reason FROM generation_items WHERE job_id=?")
          .get(cancelled.id)?.waiting_reason,
        null,
      );
      const restart = await runner.enqueue(f.input),
        stopping = runner.drain();
      await waiting(restart.id);
      await runner.stop();
      await stopping;
      assert.equal(runner.get(restart.id).status, "queued");
      release();
      await Promise.all(interactive);
      const resumed = new GenerationRunner(
        f.store,
        join(f.root, "generated"),
        async (args) => {
          executions++;
          await writeFile(args.at(-1)!, "synthetic-generated-output");
        },
        undefined,
        admission,
      );
      await resumed.drain();
      await resumed.stop();
      assert.equal(resumed.get(restart.id).status, "completed");
      assert.equal(executions, 1);
      assert.deepEqual(await readFile(f.file), before);
    } finally {
      release();
      await Promise.all(interactive);
      await runner.stop();
      admission.stop();
    }
  },
);
