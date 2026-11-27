import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { createHook } from "node:async_hooks";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/database.js";
import { hashSecret } from "../src/security.js";
import {
  authenticateResetAdministrator,
  previewOfflineReset,
  executeOfflineReset,
} from "../src/reset-offline.js";
import {
  openOfflineReset,
  createVerifiedResetBackup,
} from "../src/reset-backup.js";
import { cleanupAssets, validateStorage } from "../src/storage.js";
import { reconcileAssets } from "../src/asset-reconciliation.js";
import { ManagedCache } from "../src/managed-cache.js";
import { OutputPaths } from "../src/output-paths.js";
import { StreamingService } from "../src/streaming.js";
import { PlaybackService } from "../src/playback.js";
import { acquireDataLock } from "../src/runtime-lock.js";
import { createServer } from "../src/server.js";

const password = "independent-reset-fixture-password";
const hash = await hashSecret(password);
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
type Entry = {
  type: string;
  inode: number;
  dev: number;
  nlink: number;
  hash?: string;
  target?: string;
};
function manifest(root: string): Record<string, Entry> {
  const result: Record<string, Entry> = {};
  function walk(path: string) {
    const s = lstatSync(path);
    const key = relative(root, path) || ".";
    result[key] = {
      type: s.isSymbolicLink()
        ? "link"
        : s.isDirectory()
          ? "directory"
          : s.isFile()
            ? "file"
            : "other",
      inode: s.ino,
      dev: s.dev,
      nlink: s.nlink,
    };
    if (s.isSymbolicLink()) result[key]!.target = readlinkSync(path);
    else if (s.isDirectory())
      for (const name of readdirSync(path).sort()) walk(join(path, name));
    else if (s.isFile()) result[key]!.hash = digest(readFileSync(path));
  }
  walk(root);
  return result;
}
function unchanged(
  before: Record<string, Entry>,
  after: Record<string, Entry>,
  exclude: (path: string) => boolean = () => false,
) {
  let checked = 0;
  for (const [path, entry] of Object.entries(before))
    if (!exclude(path)) {
      // Directory nlink legitimately changes when a new verified backup is appended.
      const current = after[path];
      assert.ok(
        current,
        `Missing original fixture path: ${JSON.stringify(path)}`,
      );
      const { nlink: oldLinks, ...old } = entry;
      const { nlink: currentLinks, ...now } = current;
      assert.deepEqual(
        now,
        old,
        `Changed original fixture path: ${JSON.stringify(path)}`,
      );
      if (entry.type !== "directory")
        assert.equal(currentLinks, oldLinks, path);
      checked++;
    }
  return checked;
}
async function fixture() {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "mytuner-r1-filesystem-")),
  );
  const data = join(root, "appdata #percent%?雪");
  const source = join(root, "source #percent%?雪\nnext line");
  const metadata = join(root, "metadata");
  const subtitles = join(root, "subtitles");
  const generated = join(root, "generated");
  const cache = join(root, "cache");
  for (const path of [
    data,
    source,
    metadata,
    subtitles,
    generated,
    cache,
    join(cache, "hls"),
    join(cache, "artwork"),
    join(cache, "subtitles"),
    join(data, "backups"),
    join(data, "unknown operator data"),
  ])
    mkdirSync(path, { recursive: true, mode: 0o700 });
  const video = join(source, "Episode [1] #100%雪.mp4");
  const ffmpeg = spawnSync(
    "ffmpeg",
    [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=16x16:d=0.12:r=25",
      "-c:v",
      "mpeg4",
      "-f",
      "mp4",
      video,
    ],
    { encoding: "utf8" },
  );
  assert.equal(ffmpeg.status, 0, ffmpeg.stderr);
  const videoBytes = readFileSync(video);
  writeFileSync(
    join(source, "Episode [1].srt"),
    "1\n00:00:00,000 --> 00:00:00,120\nSynthetic fixture\n",
  );
  writeFileSync(
    join(source, "Episode [1].nfo"),
    "<movie><title>Synthetic fixture</title></movie>",
  );
  writeFileSync(
    join(metadata, "foreign.nfo"),
    "<movie><title>External metadata</title></movie>",
  );
  writeFileSync(
    join(subtitles, "foreign.srt"),
    "1\n00:00:00,000 --> 00:00:00,120\nExternal subtitle\n",
  );
  writeFileSync(join(root, "neighbor #雪.mp4"), videoBytes);
  writeFileSync(
    join(data, "unknown operator data", "owner-video.mp4"),
    videoBytes,
  );
  writeFileSync(join(data, "backups", "old-owner-backup.mp4"), videoBytes);
  writeFileSync(
    join(data, "backups", "old-manifest.json"),
    "old backup must remain",
  );
  const foreign = new DatabaseSync(
    join(data, "unknown operator data", "owner.sqlite"),
  );
  foreign.exec(
    "CREATE TABLE owner_data(value TEXT); INSERT INTO owner_data VALUES('Synthetic non-myTuner database');",
  );
  foreign.close();
  symlinkSync(video, join(data, "backups", "old-backup-video-link"));
  linkSync(video, join(data, "backups", "old-backup-video-hardlink"));
  symlinkSync(video, join(data, "unknown operator data", "video-link"));
  linkSync(video, join(source, "hardlinked-video.mp4"));
  const managedRelative = join(randomUUID(), "a".repeat(64), "conversion.mp4");
  mkdirSync(join(generated, managedRelative, ".."), {
    recursive: true,
    mode: 0o700,
  });
  writeFileSync(join(generated, managedRelative), videoBytes);
  writeFileSync(join(generated, "operator-video.mp4"), videoBytes);
  writeFileSync(join(cache, "hls", "b".repeat(64) + ".ts"), videoBytes);
  for (const ext of ["json", "vtt"])
    writeFileSync(
      join(cache, "subtitles", "c".repeat(64) + "." + ext),
      videoBytes,
    );
  for (const path of [
    join(cache, "hls", "b".repeat(64) + ".ts"),
    join(cache, "subtitles", "c".repeat(64) + ".json"),
    join(cache, "subtitles", "c".repeat(64) + ".vtt"),
  ])
    utimesSync(path, 1, 1);
  writeFileSync(join(data, "integration.key"), Buffer.alloc(32, 7));
  const filename = join(data, "mytuner.db");
  const store = new Store(filename);
  const admin = {
    id: randomUUID(),
    username: "fixture_admin",
    role: "admin" as const,
    disabled: 0,
  };
  const sourceId = randomUUID();
  const mediaId = randomUUID();
  store.db
    .prepare(
      "INSERT INTO accounts(id,username,password_hash,role,created_at) VALUES(?,?,?,?,0)",
    )
    .run(admin.id, admin.username, hash, "admin");
  store.db
    .prepare(
      "INSERT INTO accounts(id,username,password_hash,role,created_at) VALUES(?,?,?,?,0)",
    )
    .run(randomUUID(), "fixture_viewer", hash, "viewer");
  store.db
    .prepare(
      "INSERT INTO sources(id,name,root_path,kind,recursive,metadata_root,subtitle_root) VALUES(?,'Fixture',?,'videos',1,?,?)",
    )
    .run(sourceId, source, metadata, subtitles);
  const info = lstatSync(video);
  store.db
    .prepare(
      "INSERT INTO media(id,source_id,relative_path,title,duration_ms,size,mtime_ms) VALUES(?,?,?,?,120,?,?)",
    )
    .run(
      mediaId,
      sourceId,
      relative(source, video),
      "Fixture",
      info.size,
      info.mtimeMs,
    );
  store.db
    .prepare(
      "INSERT INTO generated_assets(id,media_id,kind,fingerprint,relative_path) VALUES(?,?,'conversion',?,?)",
    )
    .run(randomUUID(), mediaId, "a".repeat(64), managedRelative);
  store.close();
  return {
    root,
    data,
    filename,
    source,
    metadata,
    subtitles,
    generated,
    cache,
    video,
    videoBytes,
    admin,
    sourceId,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}
const dbMutable = (path: string) =>
  /(?:^|\/)mytuner\.db(?:-(?:wal|shm|journal))?$/.test(path) &&
  !path.includes("backups/");
const controlsMutable = (path: string) =>
  dbMutable(path) ||
  /(?:^|\/)runtime-lock\.db(?:-(?:wal|shm|journal))?$/.test(path);

test("R1 independent filesystem matrix: refuse every preexisting SQLite auxiliary without touching any sentinel", async (t) => {
  for (const base of ["mytuner.db", "runtime-lock.db"])
    for (const suffix of ["-wal", "-shm", "-journal"])
      for (const kind of ["video", "symlink", "hardlink"])
        await t.test(`${base}${suffix}: ${kind}`, async () => {
          const f = await fixture();
          try {
            const path = join(f.data, base + suffix);
            if (kind === "video") writeFileSync(path, f.videoBytes);
            else if (kind === "symlink") symlinkSync(f.video, path);
            else linkSync(f.video, path);
            const before = manifest(f.root);
            await assert.rejects(openOfflineReset(f.data), /WAL\/SHM\/journal/);
            assert.deepEqual(manifest(f.root), before);
          } finally {
            f.dispose();
          }
        });
});

test("R1 independent linked database, owner control, key and backup roots are refused intact", async (t) => {
  for (const name of [
    "mytuner.db",
    "runtime-lock.db",
    "integration.key",
    "backups",
  ])
    for (const kind of name === "backups"
      ? ["symlink"]
      : ["symlink", "hardlink"])
      await t.test(`${name}: ${kind}`, async () => {
        const f = await fixture();
        try {
          const path = join(f.data, name);
          const outside = join(f.root, "foreign-" + name);
          if (existsSync(path)) renameSync(path, outside);
          else writeFileSync(outside, f.videoBytes);
          if (kind === "symlink") symlinkSync(outside, path);
          else linkSync(outside, path);
          const before = manifest(f.root);
          await assert.rejects(openOfflineReset(f.data), /linked|shared/);
          assert.deepEqual(manifest(f.root), before);
        } finally {
          f.dispose();
        }
      });
});

test("R1 independent foreign regular video at main/control/backup names survives refusal", async (t) => {
  for (const name of [
    "mytuner.db",
    "runtime-lock.db",
    "integration.key",
    "backups",
  ])
    await t.test(name, async () => {
      const f = await fixture();
      try {
        const path = join(f.data, name);
        if (existsSync(path))
          renameSync(path, join(f.root, "detached-original-" + name));
        writeFileSync(path, f.videoBytes);
        const before = manifest(f.root);
        await assert.rejects(openOfflineReset(f.data));
        assert.deepEqual(manifest(f.root), before);
      } finally {
        f.dispose();
      }
    });
});

test("R1 independent foreign SQLite application or owner-lock database is refused byte-for-byte", async (t) => {
  for (const name of ["mytuner.db", "runtime-lock.db"])
    await t.test(name, async () => {
      const f = await fixture();
      try {
        const path = join(f.data, name);
        if (existsSync(path)) unlinkSync(path);
        const foreign = new DatabaseSync(path);
        foreign.exec(
          "CREATE TABLE treasured_videos(path TEXT); INSERT INTO treasured_videos VALUES('owner home movies'); PRAGMA user_version=21;",
        );
        foreign.close();
        const before = manifest(f.root);
        await assert.rejects(openOfflineReset(f.data), /recognized|schema/);
        assert.deepEqual(manifest(f.root), before);
      } finally {
        f.dispose();
      }
    });
});

test("R1 independent source/data ancestry overlap fails before any writable SQLite open", async (t) => {
  for (const target of ["data", "ancestor", "inside-data"])
    await t.test(target, async () => {
      const f = await fixture();
      try {
        const store = new Store(f.filename);
        store.db
          .prepare("UPDATE sources SET root_path=?")
          .run(
            target === "data"
              ? f.data
              : target === "ancestor"
                ? f.root
                : join(f.data, "unknown operator data"),
          );
        store.close();
        const before = manifest(f.root);
        await assert.rejects(openOfflineReset(f.data), /overlaps/);
        assert.deepEqual(manifest(f.root), before);
      } finally {
        f.dispose();
      }
    });
});

test("R1 independent successful fresh/selective reset, normal restart and all cleanup paths preserve videos and unknown outputs", async (t) => {
  for (const mode of ["fresh", "selective"] as const)
    await t.test(mode, async () => {
      const f = await fixture();
      try {
        const before = manifest(f.root);
        const request = {
          mode,
          categories: mode === "selective" ? ["metadata" as const] : [],
          retainedAdminId: f.admin.id,
        };
        const preview = await previewOfflineReset(f.data, request, password);
        unchanged(before, manifest(f.root), controlsMutable);
        const result = await executeOfflineReset({
          dataRoot: f.data,
          request,
          password,
          revision: preview.revision,
          confirmation: preview.confirmationText,
        });
        assert.equal(result.reset, true);
        assert.equal(result.backup.verified, true);
        assert.ok(existsSync(join(result.backup.directory, "mytuner.db")));
        const after = manifest(f.root);
        const checked = unchanged(before, after, controlsMutable);
        assert.ok(checked > 20);
        const backupBefore = manifest(result.backup.directory);
        const releaseLock = await acquireDataLock(f.data);
        const restarted = new Store(f.filename);
        const playback = new PlaybackService(restarted);
        const streaming = new StreamingService(
          restarted,
          playback,
          join(f.cache, "hls"),
          1,
        );
        try {
          assert.equal(
            restarted.db
              .prepare("SELECT cleanup_disabled FROM storage_safety_state")
              .get()!.cleanup_disabled,
            1,
          );
          const roots = restarted.db
            .prepare("SELECT path FROM protected_source_roots")
            .all()
            .map((r) => r.path);
          for (const root of [f.source, f.metadata, f.subtitles])
            assert.ok(roots.includes(root));
          await validateStorage(
            restarted,
            [f.data, f.generated, f.cache],
            f.generated,
            f.cache,
          );
          await assert.rejects(
            cleanupAssets(restarted, f.generated, false),
            /permanently disabled/,
          );
          const plan = await reconcileAssets(
            restarted,
            f.generated,
            true,
            undefined,
            () => {},
          );
          await assert.rejects(
            reconcileAssets(
              restarted,
              f.generated,
              false,
              plan.review,
              () => {},
            ),
            /permanently disabled/,
          );
          await streaming.cleanup(Date.now() + 86400000);
          const cache = new ManagedCache(
            join(f.cache, "subtitles"),
            1,
            0,
            1,
            restarted,
          );
          assert.equal(
            await cache.get("c".repeat(64) + ".vtt", () => {}),
            null,
          );
          await assert.rejects(
            cache.ensure(10, () => {}),
            /Insufficient/,
          );
          await assert.rejects(
            cache.publish(
              "c".repeat(64) + ".json",
              Buffer.from("replacement"),
              () => {},
            ),
            /preserved/,
          );
          assert.throws(() => new OutputPaths(f.source, restarted), /overlaps/);
          assert.throws(
            () => new OutputPaths(join(f.metadata, "new-output"), restarted),
            /overlaps/,
          );
          assert.throws(
            () => new OutputPaths(join(f.subtitles, "new-output"), restarted),
            /overlaps/,
          );
          const output = new OutputPaths(f.generated, restarted);
          const stage = output.stage(".partial-" + randomUUID() + ".mp4");
          try {
            const original = readdirSync(f.generated).find(
              (name) =>
                name !== "operator-video.mp4" && !name.startsWith(".partial-"),
            )!;
            await assert.rejects(
              async () =>
                output.publish(
                  stage,
                  output.prepare(
                    join(original, "a".repeat(64), "conversion.mp4"),
                    false,
                  ),
                ),
              /preserved/,
            );
          } finally {
            output.close(stage);
          }
          const app = createServer(restarted, {
            generatedRoot: f.generated,
            cacheRoot: f.cache,
            writableRoots: [f.data, f.generated, f.cache],
            autoMaintenance: false,
          });
          try {
            await app.ready();
          } finally {
            await app.close();
          }
        } finally {
          await streaming.stop();
          restarted.close();
          await releaseLock();
        }
        unchanged(before, manifest(f.root), controlsMutable);
        assert.deepEqual(manifest(result.backup.directory), backupBefore);
        t.diagnostic(
          `${mode}: ${checked} original manifest entries retained; verified backup retained across normal server lifecycle`,
        );
      } finally {
        f.dispose();
      }
    });
});

test("R1 independent postreset stage cleanup refuses to unlink a replaced foreign video", async () => {
  const f = await fixture();
  try {
    const request = {
      mode: "fresh" as const,
      categories: [],
      retainedAdminId: f.admin.id,
    };
    const preview = await previewOfflineReset(f.data, request, password);
    await executeOfflineReset({
      dataRoot: f.data,
      request,
      password,
      revision: preview.revision,
      confirmation: preview.confirmationText,
    });
    const store = new Store(f.filename);
    try {
      const output = new OutputPaths(f.generated, store);
      const stage = output.stage(".partial-" + randomUUID() + ".mp4");
      renameSync(stage.path, join(f.root, "detached-owned-stage"));
      writeFileSync(stage.path, f.videoBytes);
      const before = manifest(f.root);
      output.close(stage);
      assert.deepEqual(manifest(f.root), before);
    } finally {
      store.close();
    }
  } finally {
    f.dispose();
  }
});

test("R1 independent failed backup verification leaves database and every original file intact", async () => {
  const f = await fixture();
  try {
    const store = new Store(f.filename);
    store.db
      .prepare(
        "INSERT INTO integrations(id,source_id,provider,url,encrypted_key,mappings_json) VALUES(?,?,'sonarr','http://127.0.0.1:1','invalid-ciphertext','[]')",
      )
      .run(randomUUID(), f.sourceId);
    store.close();
    const request = {
      mode: "fresh" as const,
      categories: [],
      retainedAdminId: f.admin.id,
    };
    const preview = await previewOfflineReset(f.data, request, password);
    const before = manifest(f.root);
    await assert.rejects(
      executeOfflineReset({
        dataRoot: f.data,
        request,
        password,
        revision: preview.revision,
        confirmation: preview.confirmationText,
      }),
    );
    unchanged(before, manifest(f.root), controlsMutable);
    const check = new Store(f.filename);
    try {
      assert.equal(
        check.db.prepare("SELECT COUNT(*) AS n FROM sources").get()!.n,
        1,
      );
      assert.equal(
        check.db.prepare("SELECT COUNT(*) AS n FROM accounts").get()!.n,
        2,
      );
      assert.equal(
        check.db
          .prepare("SELECT cleanup_disabled FROM storage_safety_state")
          .get()!.cleanup_disabled,
        0,
      );
    } finally {
      check.close();
    }
  } finally {
    f.dispose();
  }
});

test("R1 independent late SQLite sidecar replacement must survive rejected reset and SQLite close", async (t) => {
  for (const suffix of ["-shm", "-wal", "-journal"])
    await t.test(suffix, async () => {
      const f = await fixture();
      try {
        const request = {
          mode: "fresh" as const,
          categories: [],
          retainedAdminId: f.admin.id,
        };
        const preview = await previewOfflineReset(f.data, request, password);
        const path = f.filename + suffix;
        let expected: Entry | undefined;
        await assert.rejects(
          executeOfflineReset(
            {
              dataRoot: f.data,
              request,
              password,
              revision: preview.revision,
              confirmation: preview.confirmationText,
            },
            {
              backupCreated: () => {
                // Model a same-owner external process atomically replacing the directory entry.
                if (existsSync(path))
                  renameSync(path, join(f.root, "detached-owned" + suffix));
                const staged = join(f.root, "owner-video" + suffix);
                writeFileSync(staged, f.videoBytes);
                renameSync(staged, path);
                expected = manifest(f.root)[relative(f.root, path)];
              },
            },
          ),
          /sidecar|control/,
        );
        assert.deepEqual(
          manifest(f.root)[relative(f.root, path)],
          expected,
          "Rejected reset must not unlink a foreign video through SQLite implicit close cleanup",
        );
      } finally {
        f.dispose();
      }
    });
});

function injectSixForeignAuxiliaries(
  f: Awaited<ReturnType<typeof fixture>>,
  kind: "video" | "symlink" | "hardlink",
) {
  for (const base of ["mytuner.db", "runtime-lock.db"])
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      const path = join(f.data, base + suffix);
      assert.equal(
        existsSync(path),
        false,
        "No SQLite-owned auxiliary may span the injection boundary",
      );
      if (kind === "video") writeFileSync(path, f.videoBytes);
      else if (kind === "symlink") symlinkSync(f.video, path);
      else linkSync(f.video, path);
    }
  return manifest(f.root);
}

test("R1 independent corrected shutdown preserves all six late auxiliaries across direct close and both password outcomes", async (t) => {
  for (const outcome of [
    "direct-close",
    "valid-password",
    "wrong-password",
  ] as const)
    for (const kind of ["video", "symlink", "hardlink"] as const)
      await t.test(`${outcome}: ${kind}`, async () => {
        const f = await fixture();
        try {
          const context = await openOfflineReset(f.data);
          let expected: Record<string, Entry>;
          try {
            // Authentication reaches its real asynchronous scrypt boundary before injection.
            const pending =
              outcome === "direct-close"
                ? undefined
                : authenticateResetAdministrator(
                    context,
                    f.admin.id,
                    outcome === "valid-password"
                      ? password
                      : "incorrect-password",
                  );
            expected = injectSixForeignAuxiliaries(f, kind);
            if (pending) await assert.rejects(pending, /sidecar|control/);
          } finally {
            await context.close();
          }
          unchanged(expected!, manifest(f.root));
        } finally {
          f.dispose();
        }
      });
});

test("R1 independent corrected setup-failure catch preserves every late auxiliary", async () => {
  const f = await fixture();
  let expected: Record<string, Entry> | undefined;
  // async_hooks locates the first actual asynchronous callback after both headers
  // become rollback-mode. It changes no product API and mocks no SQLite behavior.
  const hook = createHook({
    before() {
      if (expected || !existsSync(join(f.data, "runtime-lock.db"))) return;
      const main = readFileSync(f.filename),
        lock = readFileSync(join(f.data, "runtime-lock.db"));
      if (
        main[18] === 1 &&
        main[19] === 1 &&
        lock[18] === 1 &&
        lock[19] === 1
      ) {
        hook.disable();
        expected = injectSixForeignAuxiliaries(f, "video");
      }
    },
  });
  try {
    hook.enable();
    await assert.rejects(openOfflineReset(f.data), /sidecar|control/);
    assert.ok(
      expected,
      "Injected after normalization and before the context returned",
    );
    unchanged(expected, manifest(f.root));
  } finally {
    hook.disable();
    f.dispose();
  }
});

test("R1 independent corrected backup verification failure preserves six late foreign auxiliaries", async (t) => {
  for (const kind of ["video", "symlink", "hardlink"] as const)
    await t.test(kind, async () => {
      const f = await fixture();
      try {
        const store = new Store(f.filename);
        store.db
          .prepare(
            "INSERT INTO integrations(id,source_id,provider,url,encrypted_key,mappings_json) VALUES(?,?,'sonarr','http://127.0.0.1:1','invalid-ciphertext','[]')",
          )
          .run(randomUUID(), f.sourceId);
        store.close();
        const context = await openOfflineReset(f.data);
        let expected: Record<string, Entry> | undefined;
        const originalGuard = context.assertSqliteSafe;
        context.assertSqliteSafe = () => {
          originalGuard();
          // The guard and VACUUM run synchronously; this injection runs only when
          // the real target fsync yields, before actual immutable verification.
          queueMicrotask(() => {
            expected = injectSixForeignAuxiliaries(f, kind);
          });
        };
        try {
          await assert.rejects(
            createVerifiedResetBackup(context),
            /Invalid encrypted integration key/,
          );
        } finally {
          await context.close();
        }
        assert.ok(expected);
        unchanged(expected, manifest(f.root));
      } finally {
        f.dispose();
      }
    });
});

test("R1 independent foreign auxiliaries beside a new backup target survive rejected VACUUM", async (t) => {
  for (const suffix of ["-wal", "-shm", "-journal"])
    for (const kind of ["video", "symlink", "hardlink"] as const)
      await t.test(`${suffix}: ${kind}`, async () => {
        const f = await fixture();
        try {
          const context = await openOfflineReset(f.data);
          const originalCurrent = context.assertCurrent;
          let calls = 0,
            path = "";
          let expected: Record<string, Entry> | undefined;
          context.assertCurrent = async () => {
            await originalCurrent();
            if (++calls === 2) {
              const directory = readdirSync(join(f.data, "backups")).find(
                (name) => name.startsWith("reset-snapshot-"),
              );
              assert.ok(directory);
              path = join(f.data, "backups", directory, "mytuner.db" + suffix);
              if (kind === "video") writeFileSync(path, f.videoBytes);
              else if (kind === "symlink") symlinkSync(f.video, path);
              else linkSync(f.video, path);
              expected = manifest(f.root);
            }
          };
          let failure: unknown;
          try {
            await createVerifiedResetBackup(context);
          } catch (error) {
            failure = error;
          } finally {
            await context.close();
          }
          assert.ok(expected);
          // Inspect physical preservation before checking the intended refusal.
          unchanged(expected, manifest(f.root), (name) =>
            name.endsWith("/mytuner.db"),
          );
          assert.ok(
            failure instanceof Error,
            "Unsafe backup auxiliary must be refused before SQLite can process it",
          );
          assert.match(failure.message, /sidecar|auxiliary|backup/i);
        } finally {
          f.dispose();
        }
      });
});
