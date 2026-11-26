import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  rename,
  symlink,
  utimes,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Store } from "../src/database.js";
import { addSource, scanSource } from "../src/catalog.js";
import {
  GenerationRunner,
  assetRelativePath,
  runFFmpeg,
} from "../src/generation.js";
import { reconcileAssets } from "../src/asset-reconciliation.js";
import { EncoderAdmission } from "../src/encoder-admission.js";
import { setImmediate } from "node:timers/promises";
import type { Media } from "../src/domain.js";

async function snapshot(root: string): Promise<unknown[]> {
  const result: unknown[] = [];
  async function walk(path: string, rel: string) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const name = rel ? rel + "/" + entry.name : entry.name;
      result.push([
        name,
        entry.isDirectory()
          ? "directory"
          : createHash("sha256")
              .update(await readFile(join(path, entry.name)))
              .digest("hex"),
      ]);
      if (entry.isDirectory()) await walk(join(path, entry.name), name);
    }
  }
  await walk(root, "");
  return result;
}
async function fixture(
  t: { after: (fn: () => unknown) => void },
  real = false,
) {
  const root = await mkdtemp(join(tmpdir(), "mytuner-output-safety-")),
    store = new Store(":memory:");
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const originals = join(root, "originals"),
    generated = join(root, "generated");
  await mkdir(join(originals, "B"), { recursive: true });
  await mkdir(generated);
  const aPath = join(originals, "A.mp4");
  if (real)
    await promisify(execFile)("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=32x32:r=10:d=0.2",
      "-c:v",
      "mpeg4",
      aPath,
    ]);
  else await writeFile(aPath, "synthetic A");
  await writeFile(join(originals, "B", "B.mp4"), "synthetic B");
  const source = await addSource(
    store,
    { name: "Originals", root: originals, kind: "videos", recursive: true },
    [generated],
  );
  await scanSource(store, source, async () => 1000);
  const items = store.db
    .prepare("SELECT * FROM media ORDER BY relative_path")
    .all() as unknown as Media[];
  const request = (directory: string) => ({
    sourceId: source.id,
    directory,
    recursive: false,
    kinds: ["thumbnail" as const],
    regenerate: false,
  });
  return {
    root,
    store,
    originals,
    generated,
    source,
    a: items[0]!,
    b: items[1]!,
    request,
  };
}

test("warm generation budgets reject linked output parents before any original write", async (t) => {
  const f = await fixture(t);
  let executions = 0;
  const runner = new GenerationRunner(f.store, f.generated, async (args) => {
    executions++;
    await writeFile(args.at(-1)!, "derived");
  });
  await runner.enqueue(f.request(""));
  await runner.drain();
  assert.equal(executions, 1);
  const before = await snapshot(f.originals);
  await symlink(join(f.originals, "B"), join(f.generated, f.b.id));
  const job = await runner.enqueue(f.request("B"));
  await runner.drain();
  assert.equal(runner.get(job.id).status, "failed");
  assert.equal(executions, 1);
  assert.deepEqual(await snapshot(f.originals), before);
});

test("output reuse refuses linked parent directories and linked final files", async (t) => {
  const f = await fixture(t);
  let executions = 0;
  const runner = new GenerationRunner(f.store, f.generated, async (args) => {
    executions++;
    await writeFile(args.at(-1)!, "derived");
  });
  await runner.enqueue(f.request(""));
  await runner.drain();
  const rel = assetRelativePath(f.a, "thumbnail"),
    output = join(f.generated, rel);
  await rm(output);
  await symlink(join(f.originals, "B", "B.mp4"), output);
  const before = await snapshot(f.originals);
  const linkedFile = await runner.enqueue(f.request(""));
  await runner.drain();
  assert.equal(runner.get(linkedFile.id).status, "failed");
  assert.equal(executions, 1);
  await rm(join(f.generated, f.a.id), { recursive: true });
  const foreign = join(f.originals, "B", rel.slice(f.a.id.length + 1));
  await mkdir(dirname(foreign), { recursive: true });
  await writeFile(foreign, "existing foreign file");
  const beforeParent = await snapshot(f.originals);
  await symlink(join(f.originals, "B"), join(f.generated, f.a.id));
  const linkedParent = await runner.enqueue(f.request(""));
  await runner.drain();
  assert.equal(runner.get(linkedParent.id).status, "failed");
  assert.equal(executions, 1);
  assert.deepEqual(await snapshot(f.originals), beforeParent);
  assert.ok(before.length > 0);
});

test("an output parent swapped during encoding cannot redirect stages or publication", async (t) => {
  const f = await fixture(t),
    before = await snapshot(f.originals);
  const runner = new GenerationRunner(f.store, f.generated, async (args) => {
    await rename(
      join(f.generated, f.a.id),
      join(f.root, "old-media-directory"),
    );
    await symlink(join(f.originals, "B"), join(f.generated, f.a.id));
    await writeFile(args.at(-1)!, "derived in root stage");
  });
  const job = await runner.enqueue(f.request(""));
  await runner.drain();
  assert.equal(runner.get(job.id).status, "failed");
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM generated_assets").get()!.n,
    0,
  );
  assert.deepEqual(await snapshot(f.originals), before);
  assert.ok(
    !(await readdir(f.generated)).some((name) => name.startsWith(".partial-")),
  );
});

test("a parent replaced while waiting for encoder admission is rejected before execution", async (t) => {
  const f = await fixture(t),
    before = await snapshot(f.originals),
    encoders = new EncoderAdmission(2);
  let release!: () => void,
    began!: () => void,
    executions = 0;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    began = resolve;
  });
  const occupying = encoders.run(
    "background",
    new AbortController().signal,
    () => {},
    async () => {
      began();
      await held;
    },
  );
  await entered;
  const runner = new GenerationRunner(
    f.store,
    f.generated,
    async (args) => {
      executions++;
      await writeFile(args.at(-1)!, "derived");
    },
    undefined,
    encoders,
  );
  const job = await runner.enqueue(f.request("")),
    task = runner.drain();
  try {
    for (let n = 0; n < 100 && !encoders.snapshot().waitingBackground; n++)
      await setImmediate();
    assert.equal(encoders.snapshot().waitingBackground, 1);
    await rename(join(f.generated, f.a.id), join(f.root, "before-admission"));
    await symlink(join(f.originals, "B"), join(f.generated, f.a.id));
  } finally {
    release();
    await occupying;
    await task;
  }
  assert.equal(executions, 0);
  assert.equal(runner.get(job.id).status, "failed");
  assert.deepEqual(await snapshot(f.originals), before);
});

test(
  "real FFmpeg writes only its inherited stage descriptor when the generated root is swapped",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await fixture(t, true),
      before = await snapshot(f.originals);
    const runner = new GenerationRunner(
      f.store,
      f.generated,
      async (args, signal, output) => {
        assert.ok(output?.fd);
        await rename(f.generated, join(f.root, "old-generated-root"));
        await symlink(join(f.originals, "B"), f.generated);
        await runFFmpeg(args, signal, output);
      },
    );
    const job = await runner.enqueue(f.request(""));
    await runner.drain();
    assert.equal(runner.get(job.id).status, "failed");
    assert.equal(
      f.store.db.prepare("SELECT COUNT(*) AS n FROM generated_assets").get()!.n,
      0,
    );
    assert.deepEqual(await snapshot(f.originals), before);
  },
);

test("restart reconciliation recognizes only stale owned root stages and preserves fresh stages", async (t) => {
  const f = await fixture(t),
    old = join(f.generated, `.partial-${randomUUID()}.jpg`),
    fresh = join(f.generated, `.partial-${randomUUID()}.mp4`);
  await writeFile(old, "interrupted");
  await writeFile(fresh, "active");
  await writeFile(join(f.generated, "unknown.partial"), "preserve");
  await utimes(old, new Date(1000), new Date(1000));
  const report = await reconcileAssets(
    f.store,
    f.generated,
    true,
    undefined,
    () => {},
  );
  assert.equal(report.interruptedFiles, 1);
  assert.equal(report.preservedUnknownFiles, 1);
  const applied = await reconcileAssets(
    f.store,
    f.generated,
    false,
    report.review,
    () => {},
  );
  assert.equal(applied.removedFiles, 1);
  assert.equal(await readFile(fresh, "utf8"), "active");
  assert.equal(
    await readFile(join(f.generated, "unknown.partial"), "utf8"),
    "preserve",
  );
});
