import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  rename,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { Store } from "../src/database.js";
import {
  addSource,
  scanSource,
  safeMediaPath,
  probeDuration,
} from "../src/catalog.js";
import { account, profile } from "./helpers.js";
import { browseLibrary, selectMedia } from "../src/library.js";
import type { Media } from "../src/domain.js";
const execute = promisify(execFile);
async function setup(t: { after: (fn: () => unknown) => void }) {
  const root = await mkdtemp(join(tmpdir(), "mytuner-scan-"));
  const store = new Store(":memory:");
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, "media"));
  return { root, store, mediaRoot: join(root, "media") };
}
test("recursive scan catalogs nested files without modifying originals and is idempotent", async (t) => {
  const { root, store, mediaRoot } = await setup(t);
  await mkdir(join(mediaRoot, "nested"));
  await writeFile(join(mediaRoot, "one.mp4"), "source-one");
  await writeFile(join(mediaRoot, "nested", "two.mkv"), "source-two");
  await writeFile(join(mediaRoot, "ignore.txt"), "text");
  const before = await readFile(join(mediaRoot, "one.mp4"));
  let probes = 0;
  const src = await addSource(
    store,
    { name: "Videos", root: mediaRoot, kind: "videos", recursive: true },
    [join(root, "data")],
  );
  const first = await scanSource(store, src, async () => {
    probes++;
    return 1000;
  });
  const second = await scanSource(store, src, async () => {
    throw new Error("must reuse");
  });
  assert.equal(first.seen, 2);
  assert.equal(first.updated, 2);
  assert.equal(second.updated, 0);
  assert.equal(probes, 2);
  assert.deepEqual(await readFile(join(mediaRoot, "one.mp4")), before);
  assert.deepEqual((await readdir(mediaRoot)).sort(), [
    "ignore.txt",
    "nested",
    "one.mp4",
  ]);
});
test("shallow sources skip nested files and ignore symlinked files/directories", async (t) => {
  const { root, store, mediaRoot } = await setup(t);
  await mkdir(join(mediaRoot, "nested"));
  await writeFile(join(mediaRoot, "nested", "x.mp4"), "x");
  await writeFile(join(root, "outside.mp4"), "outside");
  await symlink(join(root, "outside.mp4"), join(mediaRoot, "escape.mp4"));
  const src = await addSource(
    store,
    { name: "Shallow", root: mediaRoot, kind: "videos", recursive: false },
    [],
  );
  const result = await scanSource(store, src, async () => 1000);
  assert.equal(result.seen, 0);
  await assert.rejects(safeMediaPath(src, "escape.mp4"), /outside source/);
  await assert.rejects(safeMediaPath(src, "../outside.mp4"), /escapes/);
});
test("offline root and probe failure preserve prior availability; complete removal marks missing", async (t) => {
  const { root, store, mediaRoot } = await setup(t);
  const file = join(mediaRoot, "one.mp4");
  await writeFile(file, "original");
  const src = await addSource(
    store,
    { name: "Source", root: mediaRoot, kind: "videos", recursive: true },
    [],
  );
  await scanSource(store, src, async () => 1000);
  await rename(mediaRoot, join(root, "offline"));
  const offline = await scanSource(store, src, async () => 1000);
  assert.equal(offline.complete, false);
  assert.equal(
    store.db.prepare("SELECT available FROM media").get()?.available,
    1,
  );
  await rename(join(root, "offline"), mediaRoot);
  await writeFile(file, "changed-longer");
  const failed = await scanSource(store, src, async () => {
    throw new Error("bad file");
  });
  assert.equal(failed.complete, false);
  assert.equal(
    store.db.prepare("SELECT available FROM media").get()?.available,
    1,
  );
  await rm(file);
  const removed = await scanSource(store, src, async () => 1000);
  assert.equal(removed.missing, 1);
});
test("sources reject overlap with writable storage and other source roots", async (t) => {
  const { store, mediaRoot } = await setup(t);
  await mkdir(join(mediaRoot, "nested"));
  await assert.rejects(
    addSource(
      store,
      { name: "Bad", root: mediaRoot, kind: "videos", recursive: true },
      [join(mediaRoot, "database")],
    ),
    /overlap/,
  );
  await addSource(
    store,
    { name: "Good", root: mediaRoot, kind: "videos", recursive: true },
    [],
  );
  await assert.rejects(
    addSource(
      store,
      {
        name: "Duplicate",
        root: join(mediaRoot, "nested"),
        kind: "videos",
        recursive: true,
      },
      [],
    ),
    /overlap/,
  );
});
test("real ffprobe reads a runtime-generated video without changing its hash", async (t) => {
  try {
    await execute("ffmpeg", ["-version"]);
    await execute("ffprobe", ["-version"]);
  } catch {
    t.skip("ffmpeg/ffprobe unavailable");
    return;
  }
  const { mediaRoot } = await setup(t),
    file = join(mediaRoot, "synthetic.mp4");
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
  const hash = async () =>
      createHash("sha256")
        .update(await readFile(file))
        .digest("hex"),
    before = await hash();
  const duration = await probeDuration(file);
  assert.ok(duration >= 900 && duration <= 1100);
  assert.equal(await hash(), before);
});

test("valid local NFO replacement removes obsolete collection on an unchanged media fingerprint", async (t) => {
  const { store, mediaRoot } = await setup(t),
    file = join(mediaRoot, "Film.mp4"),
    nfo = join(mediaRoot, "Film.nfo");
  await writeFile(file, "synthetic original");
  await writeFile(
    nfo,
    "<movie><title>Film</title><set><name>Old set</name></set></movie>",
  );
  const src = await addSource(
      store,
      { name: "Films", root: mediaRoot, kind: "movies", recursive: true },
      [],
    ),
    owner = account(store),
    p = profile(store, owner);
  store.db.prepare("INSERT INTO source_grants VALUES(?,?,'')").run(p, src.id);
  await scanSource(store, src, async () => ({
    durationMs: 1000,
    format: "mp4",
    streams: [],
  }));
  const first = store.db
    .prepare("SELECT * FROM media")
    .get() as unknown as Media;
  const collection = browseLibrary(store, owner, p).movieCollections[0]!;
  assert.equal(
    selectMedia(store, owner, p, {
      type: "movieCollection",
      sourceId: src.id,
      key: collection.key,
    }).length,
    1,
  );
  await writeFile(nfo, "<movie><title>Renamed film</title></movie>");
  await scanSource(store, src, async () => {
    throw Error("unchanged source must not probe");
  });
  const current = store.db
    .prepare("SELECT * FROM media")
    .get() as unknown as Media;
  assert.equal(current.id, first.id);
  assert.equal(current.size, first.size);
  assert.equal(current.mtime_ms, first.mtime_ms);
  assert.equal(current.title, "Renamed film");
  assert.equal(JSON.parse(current.metadata_json).collection, undefined);
  assert.deepEqual(
    JSON.parse(current.metadata_json).technical,
    JSON.parse(first.metadata_json).technical,
  );
  assert.equal(browseLibrary(store, owner, p).movieCollections.length, 0);
  assert.equal(
    selectMedia(store, owner, p, {
      type: "movieCollection",
      sourceId: src.id,
      key: collection.key,
    }).length,
    0,
  );
  assert.equal((await readFile(file)).toString(), "synthetic original");
});
