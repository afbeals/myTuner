import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/database.js";
import { hashSecret } from "../src/security.js";
import {
  previewOfflineReset,
  executeOfflineReset,
} from "../src/reset-offline.js";
import {
  openOfflineReset,
  createVerifiedResetBackup,
} from "../src/reset-backup.js";
import { resetCategoryIds, type ResetRequest } from "../src/reset-data.js";
import {
  assertSafeOutputRoot,
  captureStorageSafety,
} from "../src/storage-safety.js";
import { cleanupAssets } from "../src/storage.js";
import { reconcileAssets } from "../src/asset-reconciliation.js";
import { ManagedCache } from "../src/managed-cache.js";
import { OutputPaths } from "../src/output-paths.js";

// Independent round-two fixtures: no original media and no first-round fixtures.
const password = "Synthetic-reset-review-R2!";
const adminId = "24feab36-a71b-4e2e-8212-f240f971ce52";
const sourceId = "9088dc21-4853-4a5b-ac0d-df4635026119";
const mediaId = "bff78c1f-516c-4a91-9659-981fa22a8861";
const hashName = "e".repeat(64) + ".json";
const temporary = await fs.realpath(
  await fs.mkdtemp(join(tmpdir(), "mytuner-reset-r2-filesystem-")),
);
const movie = join(temporary, "synthetic-seed.mp4");
const encoder = spawnSync(
  "ffmpeg",
  [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=32x32:r=4",
    "-t",
    "0.5",
    "-c:v",
    "mpeg4",
    "-y",
    movie,
  ],
  { encoding: "utf8" },
);
assert.equal(encoder.status, 0, encoder.stderr);
const video = await fs.readFile(movie);
const secret = await hashSecret(password);
let fixtureNumber = 0;

async function inventory(path: string): Promise<Record<string, unknown>> {
  const rows: Record<string, unknown> = {};
  async function walk(current: string, rel: string) {
    const s = await fs.lstat(current);
    rows[rel] = {
      type: s.isSymbolicLink()
        ? "symlink"
        : s.isFile()
          ? "file"
          : s.isDirectory()
            ? "directory"
            : "other",
      dev: s.dev,
      ino: s.ino,
      nlink: s.nlink,
      mode: s.mode,
      ...(s.isFile()
        ? {
            sha256: createHash("sha256")
              .update(await fs.readFile(current))
              .digest("hex"),
          }
        : {}),
      ...(s.isSymbolicLink() ? { target: await fs.readlink(current) } : {}),
    };
    if (s.isDirectory())
      for (const name of (await fs.readdir(current)).sort())
        await walk(join(current, name), rel ? `${rel}/${name}` : name);
  }
  await walk(path, "");
  return rows;
}
async function fixture(label = "normal") {
  const base = join(temporary, `${++fixtureNumber}-${label}`);
  const data = join(base, "appdata");
  const protectedTree = join(base, "operator-owned");
  const sources = join(protectedTree, "Video #1 ' quote ?query %25 雪\nline");
  const metadata = join(protectedTree, "metadata"),
    subtitles = join(protectedTree, "subtitles");
  const generated = join(protectedTree, "generated"),
    cache = join(protectedTree, "cache");
  for (const path of [
    data,
    sources,
    metadata,
    subtitles,
    generated,
    cache,
    join(data, "backups", "prior"),
  ])
    await fs.mkdir(path, { recursive: true, mode: 0o700 });
  await fs.writeFile(join(sources, "Episode 01.mp4"), video);
  await fs.writeFile(
    join(sources, "Episode 01.nfo"),
    "<movie><title>Independent synthetic title</title></movie>",
  );
  await fs.writeFile(
    join(sources, "Episode 01.en.srt"),
    "1\n00:00:00,000 --> 00:00:00,400\nSynthetic video\n",
  );
  await fs.writeFile(
    join(sources, "notes.txt"),
    "Unknown operator notes; never application owned\n",
  );
  await fs.symlink("Episode 01.mp4", join(sources, "video-alias.mp4"));
  await fs.writeFile(
    join(metadata, "Episode 01.nfo"),
    "<movie><plot>External metadata</plot></movie>",
  );
  await fs.writeFile(
    join(subtitles, "Episode 01.srt"),
    "Synthetic external subtitles",
  );
  await fs.writeFile(
    join(cache, hashName),
    "old application-shaped but operator-retained JSON",
  );
  await fs.utimes(join(cache, hashName), new Date(0), new Date(0));
  await fs.writeFile(join(generated, "notes.mp4"), video);
  await fs.mkdir(join(generated, mediaId, "a".repeat(64)), { recursive: true });
  await fs.writeFile(
    join(generated, mediaId, "a".repeat(64), "conversion.mp4"),
    video,
  );
  await fs.writeFile(join(data, "family-video.mp4"), video);
  await fs.writeFile(join(data, "family-video.nfo"), "Never remove me");
  await fs.writeFile(
    join(data, "backups", "prior", "mytuner.db"),
    "Old operator snapshot, retained exactly",
  );
  await fs.writeFile(
    join(data, "backups", "prior", "manifest.json"),
    '{"operator":true}',
  );
  await fs.symlink(
    join(sources, "Episode 01.mp4"),
    join(data, "unknown-video-link.mp4"),
  );
  const unrelated = new DatabaseSync(join(data, "household.db"));
  unrelated.exec(
    "CREATE TABLE precious(value TEXT); INSERT INTO precious VALUES('unrelated user database');",
  );
  unrelated.close();
  const store = new Store(join(data, "mytuner.db"));
  store.db
    .prepare(
      "INSERT INTO accounts(id,username,password_hash,role,created_at) VALUES(?,?,?,?,?)",
    )
    .run(adminId, "synthetic-admin", secret, "admin", 1);
  store.db
    .prepare(
      "INSERT INTO sources(id,name,root_path,kind,metadata_root,subtitle_root) VALUES(?,?,?,?,?,?)",
    )
    .run(sourceId, "Synthetic", sources, "videos", metadata, subtitles);
  store.db
    .prepare(
      "INSERT INTO media(id,source_id,relative_path,title,duration_ms,size,mtime_ms) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      mediaId,
      sourceId,
      "Episode 01.mp4",
      "Synthetic",
      500,
      video.length,
      (await fs.stat(join(sources, "Episode 01.mp4"))).mtimeMs,
    );
  store.close();
  const request: ResetRequest = {
    mode: "fresh",
    categories: [],
    retainedAdminId: adminId,
  };
  const sentinelPaths = [
    protectedTree,
    join(data, "family-video.mp4"),
    join(data, "family-video.nfo"),
    join(data, "backups", "prior"),
    join(data, "unknown-video-link.mp4"),
    join(data, "household.db"),
  ];
  const before = await Promise.all(sentinelPaths.map(inventory));
  return {
    base,
    data,
    sources,
    metadata,
    subtitles,
    generated,
    cache,
    protectedTree,
    request,
    sentinelPaths,
    before,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function unchanged(f: Fixture) {
  for (let i = 0; i < f.sentinelPaths.length; i++)
    assert.deepEqual(
      await inventory(f.sentinelPaths[i]!),
      f.before[i],
      f.sentinelPaths[i],
    );
}
async function reviewed(f: Fixture) {
  const p = await previewOfflineReset(f.data, f.request, password);
  return {
    dataRoot: f.data,
    request: f.request,
    password,
    revision: p.revision,
    confirmation: p.confirmationText,
  };
}
const auxiliaryNames = [
  "mytuner.db-wal",
  "mytuner.db-shm",
  "mytuner.db-journal",
  "runtime-lock.db-wal",
  "runtime-lock.db-shm",
  "runtime-lock.db-journal",
];

for (const category of ["fresh", ...resetCategoryIds] as const)
  test(`successful ${category} reset preserves independent videos, sidecars, neighbors, outputs and prior backups`, async () => {
    const f = await fixture(category);
    if (category !== "fresh")
      f.request = { ...f.request, mode: "selective", categories: [category] };
    const outcome = await executeOfflineReset(await reviewed(f));
    assert.equal(outcome.reset, true);
    await unchanged(f);
    const db = new DatabaseSync(join(outcome.backup.directory, "mytuner.db"), {
      readOnly: true,
    });
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM media").get()!.n, 1);
      assert.equal(
        db.prepare("PRAGMA integrity_check").get()!.integrity_check,
        "ok",
      );
    } finally {
      db.close();
    }
    const reopened = new Store(join(f.data, "mytuner.db"));
    try {
      const safety = captureStorageSafety(reopened);
      assert.equal(safety.cleanupDisabled, true);
      for (const root of [f.sources, f.metadata, f.subtitles]) {
        assert.ok(safety.protectedRoots.includes(root));
        assert.throws(
          () => assertSafeOutputRoot(reopened, join(root, "new-output")),
          /overlaps/,
        );
        assert.throws(
          () => new OutputPaths(root, reopened).create([]),
          /overlaps/,
        );
      }
      await assert.rejects(
        cleanupAssets(reopened, f.generated, false),
        /disabled/,
      );
      await assert.rejects(
        reconcileAssets(reopened, f.generated, false, undefined, () => {}),
        /disabled/,
      );
      const cache = new ManagedCache(f.cache, 1, 0, 1, reopened);
      assert.equal(await cache.get(hashName, () => {}), null);
      await assert.rejects(
        cache.ensure(1, () => {}),
        /Insufficient/,
      );
      await assert.rejects(
        cache.publish(hashName, Buffer.from("replacement"), () => {}),
        /preserved/,
      );
    } finally {
      reopened.close();
    }
    await unchanged(f);
  });

for (const name of auxiliaryNames)
  test(`preexisting unrelated ${name} survives offline refusal byte/type/inode-identical`, async () => {
    const f = await fixture();
    const path = join(f.data, name);
    await fs.writeFile(path, video);
    const before = await inventory(path);
    await assert.rejects(
      previewOfflineReset(f.data, f.request, password),
      /sidecar/,
    );
    assert.deepEqual(await inventory(path), before);
    await unchanged(f);
  });

for (const control of ["mytuner.db", "runtime-lock.db", "integration.key"])
  for (const kind of ["symlink", "hardlink"] as const)
    test(`${control} ${kind} to synthetic video is refused without modifying either path`, async () => {
      const f = await fixture();
      const path = join(f.data, control);
      if (control === "mytuner.db")
        await fs.rename(path, path + ".harness-saved");
      if (kind === "symlink")
        await fs.symlink(join(f.sources, "Episode 01.mp4"), path);
      else await fs.link(join(f.sources, "Episode 01.mp4"), path);
      const before = await inventory(path);
      const sourcesBefore = await inventory(f.protectedTree);
      await assert.rejects(
        previewOfflineReset(f.data, f.request, password),
        /linked|shared/,
      );
      assert.deepEqual(await inventory(path), before);
      assert.deepEqual(await inventory(f.protectedTree), sourcesBefore);
    });

for (const name of auxiliaryNames)
  test(`late foreign ${name} survives rejected execution and SQLite close`, async () => {
    const f = await fixture();
    const options = await reviewed(f);
    const path = join(f.data, name);
    let before: Record<string, unknown> | undefined;
    await assert.rejects(
      executeOfflineReset(options, {
        backupCreated: async () => {
          await fs.writeFile(path, video);
          before = await inventory(path);
        },
      }),
      /sidecar/,
    );
    assert.deepEqual(await inventory(path), before);
    await unchanged(f);
  });

for (const name of ["mytuner.db", "runtime-lock.db"])
  for (const kind of ["regular", "symlink", "hardlink"] as const)
    test(`late ${name} ${kind} replacement survives reset refusal and handle close`, async () => {
      const f = await fixture();
      const options = await reviewed(f);
      const path = join(f.data, name);
      let before: Record<string, unknown> | undefined,
        treeBefore: Record<string, unknown> | undefined;
      await assert.rejects(
        executeOfflineReset(options, {
          backupCreated: async () => {
            await fs.rename(path, path + ".harness-saved");
            if (kind === "regular")
              await fs.copyFile(join(f.data, "household.db"), path);
            if (kind === "symlink")
              await fs.symlink(join(f.sources, "Episode 01.mp4"), path);
            if (kind === "hardlink")
              await fs.link(join(f.sources, "Episode 01.mp4"), path);
            before = await inventory(path);
            treeBefore = await inventory(f.protectedTree);
          },
        }),
        /identity|linked|shared/,
      );
      assert.deepEqual(await inventory(path), before);
      assert.deepEqual(await inventory(f.protectedTree), treeBefore);
    });

for (const suffix of ["-wal", "-shm", "-journal"])
  test(`foreign newly allocated backup${suffix} is not deleted by a failed VACUUM or immutable inspection`, async () => {
    const f = await fixture();
    const context = await openOfflineReset(f.data);
    let calls = 0,
      path = "",
      before: Record<string, unknown> | undefined;
    try {
      await assert.rejects(
        createVerifiedResetBackup({
          ...context,
          assertCurrent: async () => {
            await context.assertCurrent();
            if (++calls === 2) {
              const names = (await fs.readdir(join(f.data, "backups"))).filter(
                (x) => x.startsWith("reset-snapshot-"),
              );
              path = join(f.data, "backups", names[0]!, "mytuner.db" + suffix);
              await fs.writeFile(path, video);
              before = await inventory(path);
            }
          },
        }),
        /sidecar/,
      );
    } finally {
      await context.close();
    }
    assert.deepEqual(await inventory(path), before);
    await unchanged(f);
  });

for (const kind of ["symlink", "hardlink", "regular"] as const)
  test(`allocated backup target ${kind} replacement cannot redirect VACUUM`, async () => {
    const f = await fixture();
    const context = await openOfflineReset(f.data);
    let calls = 0,
      path = "",
      before: Record<string, unknown> | undefined,
      treeBefore: Record<string, unknown> | undefined;
    try {
      await assert.rejects(
        createVerifiedResetBackup({
          ...context,
          assertCurrent: async () => {
            await context.assertCurrent();
            if (++calls === 2) {
              const names = (await fs.readdir(join(f.data, "backups"))).filter(
                (x) => x.startsWith("reset-snapshot-"),
              );
              path = join(f.data, "backups", names[0]!, "mytuner.db");
              await fs.rename(path, path + ".harness-saved");
              if (kind === "symlink")
                await fs.symlink(join(f.sources, "Episode 01.mp4"), path);
              if (kind === "hardlink")
                await fs.link(join(f.sources, "Episode 01.mp4"), path);
              if (kind === "regular") await fs.writeFile(path, video);
              before = await inventory(path);
              treeBefore = await inventory(f.protectedTree);
            }
          },
        }),
        /target changed|linked|shared/,
      );
    } finally {
      await context.close();
    }
    assert.deepEqual(await inventory(path), before);
    assert.deepEqual(await inventory(f.protectedTree), treeBefore);
  });

test("final manifest open cannot follow a backup-bundle directory swapped to a read-only source", async () => {
  const f = await fixture();
  const options = await reviewed(f);
  const originalOpen = fs.open;
  const originalLstat = fs.lstat;
  let injected = false;
  let advertised = "";
  let directoryChecks = 0;
  // Publication is now synchronous. Keep the real swap at the final awaited
  // directory inspection, returning its just-observed (now stale) identity.
  fs.open = (async (path: any, ...args: any[]) => {
    assert.ok(
      !(
        String(path).endsWith("/manifest.json") &&
        String(path).includes("reset-snapshot-")
      ),
      "manifest publication must not use an asynchronous pathname open",
    );
    return (originalOpen as any)(path, ...args);
  }) as typeof fs.open;
  fs.lstat = (async (path: any, ...args: any[]) => {
    const value = await (originalLstat as any)(path, ...args);
    if (
      /\/reset-snapshot-[^/]+$/.test(String(path)) &&
      ++directoryChecks === 6
    ) {
      injected = true;
      advertised = String(path);
      await fs.rename(advertised, advertised + ".harness-saved");
      await fs.symlink(f.sources, advertised);
    }
    return value;
  }) as typeof fs.lstat;
  syncBuiltinESMExports();
  let outcome: unknown, error: unknown;
  try {
    outcome = await executeOfflineReset(options);
  } catch (e) {
    error = e;
  } finally {
    fs.open = originalOpen;
    fs.lstat = originalLstat;
    syncBuiltinESMExports();
  }
  assert.equal(injected, true, "manifest injection point was reached");
  const sourceManifest = join(f.sources, "manifest.json");
  const wrote = await fs.lstat(sourceManifest).then(
    () => true,
    () => false,
  );
  const originalProtected = f.before[0] as Record<string, unknown>;
  const protectedAfter = await inventory(f.protectedTree);
  for (const [path, entry] of Object.entries(originalProtected))
    if ((entry as { type: string }).type !== "directory")
      assert.deepEqual(protectedAfter[path], entry, path);
  const resultDb = new DatabaseSync(join(f.data, "mytuner.db"), {
    readOnly: true,
  });
  let mediaRowsAfter: unknown;
  try {
    mediaRowsAfter = resultDb.prepare("SELECT COUNT(*) AS n FROM media").get()!
      .n;
  } finally {
    resultDb.close();
  }
  const advertisedDatabaseExists = await fs
    .lstat(join(advertised, "mytuner.db"))
    .then(
      () => true,
      () => false,
    );
  console.log(
    JSON.stringify({
      round2ManifestRace: {
        injected,
        wroteToReadOnlySource: wrote,
        resetSucceeded: Boolean(outcome),
        mediaRowsAfter,
        advertisedDatabaseExists,
        error: error instanceof Error ? error.message : null,
        advertised,
        base: f.base,
      },
    }),
  );
  assert.equal(
    wrote,
    false,
    "reset created manifest.json in protected source after asynchronous bundle swap",
  );
  assert.ok(
    error,
    "reset must reject a backup bundle swapped to a read-only source",
  );
});

test("quoted, query-like, percent, Unicode and newline data directory remains URL-safe", async () => {
  const f = await fixture("odd # % ? ' 雪\nline");
  assert.equal((await executeOfflineReset(await reviewed(f))).reset, true);
  await unchanged(f);
});

for (const kind of ["symlink", "shared-mode"] as const)
  test(`backup root ${kind} is rejected without touching source videos`, async () => {
    const f = await fixture();
    const root = join(f.data, "backups");
    if (kind === "symlink") {
      await fs.rename(root, root + ".harness-saved");
      await fs.symlink(f.sources, root);
    } else await fs.chmod(root, 0o770);
    const before = await inventory(root);
    const videoBefore = await inventory(f.protectedTree);
    await assert.rejects(
      previewOfflineReset(f.data, f.request, password),
      /linked|writable/,
    );
    assert.deepEqual(await inventory(root), before);
    assert.deepEqual(await inventory(f.protectedTree), videoBefore);
  });

test("data directory symlink is rejected before a SQLite handle mutates neighboring files", async () => {
  const f = await fixture();
  const alias = join(f.base, "data-alias");
  await fs.symlink(f.data, alias);
  const before = await inventory(f.data);
  await assert.rejects(
    previewOfflineReset(alias, f.request, password),
    /linked/,
  );
  assert.deepEqual(await inventory(f.data), before);
  await unchanged(f);
});

for (const name of ["mytuner.db", "runtime-lock.db"])
  test(`late WAL header edit on ${name} does not let close remove foreign video sidecars`, async () => {
    const f = await fixture();
    const options = await reviewed(f);
    let before: Record<string, unknown> | undefined;
    const path = join(f.data, name + "-wal");
    await assert.rejects(
      executeOfflineReset(options, {
        backupCreated: async () => {
          const h = await fs.open(join(f.data, name), "r+");
          try {
            await h.write(Buffer.from([2, 2]), 0, 2, 18);
          } finally {
            await h.close();
          }
          await fs.writeFile(path, video);
          before = await inventory(path);
        },
      }),
      /sidecar|journal mode/,
    );
    assert.deepEqual(await inventory(path), before);
    await unchanged(f);
  });

test("source symlink authority retains both historical canonical and configured roots across restart", async () => {
  const f = await fixture();
  const alias = join(f.base, "configured-source-alias");
  await fs.symlink(f.sources, alias);
  const beforeStore = new Store(join(f.data, "mytuner.db"));
  beforeStore.db
    .prepare("UPDATE sources SET root_path=? WHERE id=?")
    .run(alias, sourceId);
  beforeStore.close();
  await executeOfflineReset(await reviewed(f));
  const movedAlias = alias + ".harness-saved";
  await fs.rename(alias, movedAlias);
  const newTarget = join(f.base, "new-synthetic-source");
  await fs.mkdir(newTarget, { mode: 0o700 });
  await fs.writeFile(join(newTarget, "new-video.mp4"), video);
  await fs.symlink(newTarget, alias);
  const reopened = new Store(join(f.data, "mytuner.db"));
  try {
    for (const root of [f.sources, newTarget])
      assert.throws(
        () => new OutputPaths(join(root, "artwork"), reopened).create([]),
        /overlaps/,
      );
  } finally {
    reopened.close();
  }
  await unchanged(f);
});

test("backup integration-key append cannot follow bundle swap into read-only source", async () => {
  const f = await fixture();
  await fs.writeFile(join(f.data, "integration.key"), Buffer.alloc(32, 0x52));
  const options = await reviewed(f);
  const originalOpen = fs.open;
  let injected = false;
  fs.open = (async (path: any, ...args: any[]) => {
    assert.ok(
      !(
        String(path).endsWith("/integration.key") &&
        String(path).includes("reset-snapshot-")
      ),
      "key publication must not use an asynchronous pathname open",
    );
    const handle = await (originalOpen as any)(path, ...args);
    if (!injected && String(path) === join(f.data, "integration.key")) {
      const bundles = (await fs.readdir(join(f.data, "backups"))).filter(
        (name) => name.startsWith("reset-snapshot-"),
      );
      const directory = bundles[0] ? join(f.data, "backups", bundles[0]) : "";
      const copied =
        directory &&
        (await fs.lstat(join(directory, "mytuner.db")).catch(() => null));
      if (copied && copied.size > 0) {
        const originalRead = handle.readFile.bind(handle);
        handle.readFile = async (...readArgs: any[]) => {
          const bytes = await originalRead(...readArgs);
          injected = true;
          await fs.rename(directory, directory + ".harness-saved");
          await fs.symlink(f.sources, directory);
          return bytes;
        };
      }
    }
    return handle;
  }) as typeof fs.open;
  syncBuiltinESMExports();
  let outcome: unknown, error: unknown;
  try {
    outcome = await executeOfflineReset(options);
  } catch (e) {
    error = e;
  } finally {
    fs.open = originalOpen;
    syncBuiltinESMExports();
  }
  assert.equal(injected, true);
  const wrote = await fs.lstat(join(f.sources, "integration.key")).then(
    () => true,
    () => false,
  );
  const originalProtected = f.before[0] as Record<string, unknown>;
  const protectedAfter = await inventory(f.protectedTree);
  for (const [path, entry] of Object.entries(originalProtected))
    if ((entry as { type: string }).type !== "directory")
      assert.deepEqual(protectedAfter[path], entry, path);
  console.log(
    JSON.stringify({
      round2KeyRace: {
        injected,
        wroteToReadOnlySource: wrote,
        resetSucceeded: Boolean(outcome),
        error: error instanceof Error ? error.message : null,
        base: f.base,
      },
    }),
  );
  assert.equal(
    wrote,
    false,
    "reset created integration.key in protected source before refusing changed bundle",
  );
  assert.ok(error);
});

test.after(async () => {
  console.log(`ROUND2_SYNTHETIC_FIXTURES=${temporary}`);
  if (process.env.RESET_R2_KEEP_FIXTURES !== "1")
    await fs.rm(temporary, { recursive: true, force: true });
});
