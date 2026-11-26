import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  stat,
  symlink,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setImmediate as turn,
  setTimeout as delay,
} from "node:timers/promises";
import { Store } from "../src/database.js";
import { addSource, scanSource, probeMedia } from "../src/catalog.js";
import { BackgroundWork } from "../src/background-work.js";
import { OutputBudget } from "../src/storage.js";
import { ManagedCache } from "../src/managed-cache.js";
import { inspectLocalMetadata } from "../src/local-metadata.js";

const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};
async function temporary(t: { after: (fn: () => unknown) => void }) {
  const root = await mkdtemp(join(tmpdir(), "mytuner-hdd-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("unchanged inventory records check times without rewriting media or subtitle tracks; sidecar changes still apply", async (t) => {
  const root = await temporary(t),
    store = new Store(":memory:");
  t.after(() => store.close());
  for (let n = 0; n < 4; n++) {
    await writeFile(join(root, `Clip-${n}.mp4`), "synthetic original");
    await writeFile(
      join(root, `Clip-${n}.nfo`),
      `<movie><title>Title ${n}</title></movie>`,
    );
    await writeFile(
      join(root, `Clip-${n}.en.srt`),
      "1\n00:00:00,000 --> 00:00:01,000\nText\n",
    );
  }
  const source = await addSource(
    store,
    { name: "Clips", root, kind: "movies", recursive: true },
    [],
  );
  let probes = 0;
  const probe = async () => {
    probes++;
    return 1000;
  };
  await scanSource(store, source, probe);
  store.db.exec(`CREATE TEMP TABLE scan_writes(name TEXT);
    CREATE TEMP TRIGGER media_writes AFTER UPDATE ON media BEGIN INSERT INTO scan_writes VALUES('media'); END;
    CREATE TEMP TRIGGER track_writes AFTER UPDATE ON subtitle_tracks BEGIN INSERT INTO scan_writes VALUES('track'); END;
    CREATE TEMP TRIGGER track_inserts AFTER INSERT ON subtitle_tracks BEGIN INSERT INTO scan_writes VALUES('track'); END;`);
  const revisions = store.db
    .prepare("SELECT media_id,revision FROM subtitle_checks ORDER BY media_id")
    .all();
  const before = Number(
    store.db.prepare("SELECT total_changes() AS n").get()!.n,
  );
  const unchanged = await scanSource(store, source, probe);
  assert.equal(unchanged.updated, 0);
  assert.equal(probes, 4);
  assert.equal(
    Number(store.db.prepare("SELECT total_changes() AS n").get()!.n) - before,
    4,
  );
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM scan_writes").get()!.n,
    0,
  );
  assert.deepEqual(
    store.db
      .prepare(
        "SELECT media_id,revision FROM subtitle_checks ORDER BY media_id",
      )
      .all(),
    revisions,
  );
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM subtitle_tracks").get()!.n,
    16,
  );
  await writeFile(
    join(root, "Clip-0.nfo"),
    "<movie><title>Changed title</title></movie>",
  );
  await writeFile(
    join(root, "Clip-0.en.srt"),
    "1\n00:00:00,000 --> 00:00:01,000\nChanged subtitle text\n",
  );
  await scanSource(store, source, probe);
  assert.equal(probes, 4);
  assert.equal(
    store.db
      .prepare("SELECT title FROM media WHERE relative_path='Clip-0.mp4'")
      .get()!.title,
    "Changed title",
  );
  await rm(join(root, "Clip-0.nfo"));
  await rm(join(root, "Clip-0.en.srt"));
  await scanSource(store, source, probe);
  assert.equal(
    store.db
      .prepare("SELECT title FROM media WHERE relative_path='Clip-0.mp4'")
      .get()!.title,
    "Clip-0",
  );
  const removed = store.db
    .prepare(
      "SELECT state_json FROM subtitle_tracks WHERE relative_path='Clip-0.en.srt'",
    )
    .all();
  assert.equal(removed.length, 4);
  assert.ok(
    removed.every(
      (row) => JSON.parse(String(row.state_json)).status === "missing",
    ),
  );
  assert.equal(probes, 4);
  assert.equal(
    await readFile(join(root, "Clip-0.mp4"), "utf8"),
    "synthetic original",
  );
});

test("optional filesystem workloads serialize, pause at checkpoints and release cancelled queue entries", async () => {
  const work = new BackgroundWork(),
    held = gate(),
    began = gate(),
    events: string[] = [];
  const first = work.run("scan", undefined, async (checkpoint) => {
    events.push("scan");
    began.release();
    await held.promise;
    await checkpoint();
    events.push("scan done");
  });
  await began.promise;
  const controller = new AbortController();
  const cancelled = work.run("generation", controller.signal, async () => {
    events.push("cancelled");
  });
  const rejection = assert.rejects(cancelled, { name: "AbortError" });
  controller.abort();
  await rejection;
  const second = work.run("reconcile", undefined, async () => {
    events.push("reconcile");
  });
  work.setPaused(true);
  held.release();
  await turn();
  assert.deepEqual(events, ["scan"]);
  assert.deepEqual(work.snapshot(), {
    active: "scan",
    waiting: 1,
    paused: true,
    admitted: 1,
    completed: 0,
  });
  work.setPaused(false);
  await Promise.all([first, second]);
  assert.deepEqual(events, ["scan", "scan done", "reconcile"]);
  work.setPaused(true);
  const queued = work.run("scan", undefined, async () => {});
  const stopped = assert.rejects(queued, /stopping/);
  work.stop();
  await stopped;
});

test("scan checkpoints preserve prior availability when cancellation interrupts enumeration", async (t) => {
  const root = await temporary(t),
    store = new Store(":memory:");
  t.after(() => store.close());
  await writeFile(join(root, "clip.mp4"), "original");
  const source = await addSource(
    store,
    { name: "Clip", root, kind: "videos", recursive: true },
    [],
  );
  await scanSource(store, source, async () => 1000);
  await rm(join(root, "clip.mp4"));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    scanSource(store, source, async () => 1000, controller.signal),
    { name: "AbortError" },
  );
  assert.equal(
    store.db.prepare("SELECT available FROM media").get()!.available,
    1,
  );
});

test("large missing-file reconciliation yields between bounded commits after a complete inventory", async (t) => {
  const root = await temporary(t),
    store = new Store(":memory:");
  t.after(() => store.close());
  const source = await addSource(
    store,
    { name: "Removed", root, kind: "videos", recursive: true },
    [],
  );
  store.transaction(() => {
    const insert = store.db.prepare(
      "INSERT INTO media(id,source_id,relative_path,title,duration_ms,size,mtime_ms,available,metadata_json) VALUES(?,?,?,?,1000,1,1,1,'{}')",
    );
    for (let n = 0; n < 150; n++)
      insert.run(`id-${n}`, source.id, `removed-${n}.mp4`, `Removed ${n}`);
  });
  const counts: number[] = [];
  const result = await scanSource(
    store,
    source,
    async () => 1000,
    undefined,
    async () => {
      counts.push(
        Number(
          store.db
            .prepare("SELECT COUNT(*) AS n FROM media WHERE available=0")
            .get()!.n,
        ),
      );
    },
  );
  assert.equal(result.missing, 150);
  assert.equal(result.complete, true);
  assert.deepEqual(counts, [0, 0, 64, 128]);
});

test("output reservations count existing partials, account publications and rebuild after outside changes or abort", async (t) => {
  const root = await temporary(t),
    mib = 1024 * 1024;
  await writeFile(join(root, "old.partial"), Buffer.alloc(mib));
  const budget = new OutputBudget(root);
  const first = await budget.reserve(8 * mib, 0, () => {});
  assert.equal(first.bytes, 7 * mib);
  await assert.rejects(
    budget.reserve(8 * mib, 0, () => {}),
    /quota/,
  );
  await writeFile(join(root, "new.mp4"), Buffer.alloc(mib));
  first.finish(mib);
  const second = await budget.reserve(8 * mib, 0, () => {});
  assert.equal(second.bytes, 6 * mib);
  second.finish();
  await writeFile(join(root, "external.mp4"), Buffer.alloc(mib));
  const refreshed = await budget.reserve(8 * mib, 0, () => {});
  assert.equal(refreshed.bytes, 5 * mib);
  refreshed.finish(0);
  budget.invalidate();
  await symlink(join(root, "new.mp4"), join(root, "link"));
  await assert.rejects(
    budget.reserve(8 * mib, 0, () => {}),
    /symbolic link/,
  );
});

test("managed cache hits coalesce access-time writes without losing expiration or authorization", async (t) => {
  const root = await temporary(t),
    cache = new ManagedCache(root),
    name = "a".repeat(64) + ".json";
  await cache.publish(name, Buffer.from("cached"), () => {});
  await cache.get(name, () => {});
  const before = await stat(join(root, name));
  await turn();
  assert.equal((await cache.get(name, () => {}))!.toString(), "cached");
  const after = await stat(join(root, name));
  assert.equal(after.mtimeMs, before.mtimeMs);
  await assert.rejects(
    cache.get(name, () => {
      throw Error("revoked");
    }),
    /revoked/,
  );
});

test(
  "ffprobe cancellation waits for a SIGTERM-ignoring child to close before releasing work",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = await temporary(t),
      ready = join(root, "ready"),
      controller = new AbortController();
    // A synthetic script driven by the existing Node binary, not an installed tool.
    await writeFile(
      join(root, "ffprobe"),
      `#!${process.execPath}\nprocess.on('SIGTERM', () => {});\nrequire('node:fs').writeFileSync(${JSON.stringify(ready)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`,
      { mode: 0o700 },
    );
    const oldPath = process.env.PATH;
    process.env.PATH = root + ":" + (oldPath ?? "");
    const probing = probeMedia("synthetic-input", controller.signal);
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    let pid: number | undefined;
    const rejected = assert.rejects(probing, { name: "AbortError" });
    try {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const value = await readFile(ready, "utf8").catch(() => null);
        if (value) {
          pid = Number(value);
          break;
        }
        await delay(10);
      }
      assert.ok(pid, "synthetic probe must start");
      controller.abort();
      await rejected;
      assert.throws(() => process.kill(pid!, 0), { code: "ESRCH" });
    } finally {
      controller.abort();
      await rejected;
      if (pid)
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* Already reaped. */
        }
    }
  },
);

test("cached generic NFO fields remain explicit when a different filename has a different fallback", async (t) => {
  const root = await temporary(t),
    store = new Store(":memory:");
  t.after(() => store.close());
  await writeFile(join(root, "one.mp4"), "synthetic");
  await writeFile(
    join(root, "movie.nfo"),
    "<movie><title>one</title><year>2020</year></movie>",
  );
  const source = await addSource(
    store,
    { name: "Film", root, kind: "movies", recursive: true },
    [],
  );
  const first = await inspectLocalMetadata(source, "one.mp4", true);
  assert.equal(first.data.title, "one");
  await rename(join(root, "one.mp4"), join(root, "two.2021.mp4"));
  const renamed = await inspectLocalMetadata(source, "two.2021.mp4", true);
  assert.equal(renamed.validNfo, true);
  assert.equal(renamed.data.title, "one");
  assert.equal(renamed.data.year, 2020);
});
