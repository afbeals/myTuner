import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  constants,
  lstatSync,
  readSync,
  openSync,
  closeSync,
  fstatSync,
  fsyncSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { lstat, open, mkdir, realpath } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join, resolve, parse, isAbsolute } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { assertResetSchema } from "./reset-data.js";
import { schemaVersion } from "./database.js";
import { canonicalPath, containsPath } from "./catalog.js";
import { unseal } from "./refresh.js";
import { invariant } from "./domain.js";

// This module intentionally has no remove, rename, truncate or unlink operation.
// Every backup output is created exclusively; failures leave the owned partial bundle.
type Identity = { dev: number; ino: number; size: number; mtimeMs: number };
const identity = (value: Identity) => ({
  dev: value.dev,
  ino: value.ino,
  size: value.size,
  mtimeMs: value.mtimeMs,
});
const same = (a: Identity, b: Identity) => a.dev === b.dev && a.ino === b.ino;
async function optionalStat(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
}
export async function assertResetDirectory(path: string) {
  invariant(isAbsolute(path), 409, "Reset storage paths must be absolute");
  const root = parse(path).root;
  let current = root;
  for (const part of path.slice(root.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    const value = await lstat(current);
    invariant(
      value.isDirectory() && !value.isSymbolicLink(),
      409,
      "Reset refused a linked or non-directory storage path",
    );
  }
  const value = await lstat(path);
  invariant(
    (value.mode & 0o022) === 0,
    409,
    "Reset storage directories must not be writable by other accounts",
  );
  return identity(value);
}
async function assertFile(path: string, optional = false) {
  const value = await optionalStat(path);
  if (!value) {
    invariant(optional, 409, "Reset requires an existing myTuner database");
    return null;
  }
  invariant(
    value.isFile() && !value.isSymbolicLink() && value.nlink === 1,
    409,
    "Reset refused a linked, shared or non-regular control file",
  );
  return identity(value);
}
async function openVerified(path: string, flags: number, optional = false) {
  const before = await assertFile(path, optional);
  if (!before) return null;
  const handle = await open(path, flags | constants.O_NOFOLLOW);
  try {
    const after = await handle.stat();
    invariant(
      same(before, after) && after.nlink === 1,
      409,
      "Reset control file changed during validation",
    );
    return { handle, identity: identity(after) };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
export type OfflineResetContext = {
  dataRoot: string;
  filename: string;
  assertCurrent: () => Promise<void>;
  assertSqliteSafe: () => void;
  protectedRoots: string[];
  db: DatabaseSync;
  close: () => Promise<void>;
};
/** Open only the configured fixed mytuner.db, with the normal process-owner lock held. */
export async function openOfflineReset(
  dataDirectory: string,
): Promise<OfflineResetContext> {
  const dataRoot = resolve(dataDirectory),
    filename = join(dataRoot, "mytuner.db");
  const dataIdentity = await assertResetDirectory(dataRoot);
  invariant(
    (await realpath(dataRoot)) === dataRoot,
    409,
    "Reset requires the canonical configured data directory",
  );
  invariant(
    !(await optionalStat(join(dataRoot, "restore.pending.json"))),
    409,
    "Interrupted restore detected; finish recovery before reset",
  );
  const controls = [
    filename,
    filename + "-wal",
    filename + "-shm",
    filename + "-journal",
    join(dataRoot, "runtime-lock.db"),
    join(dataRoot, "runtime-lock.db-wal"),
    join(dataRoot, "runtime-lock.db-shm"),
    join(dataRoot, "runtime-lock.db-journal"),
    join(dataRoot, "integration.key"),
  ];
  const sidecars = controls.filter((path) => /-(wal|shm|journal)$/.test(path));
  const assertNoSidecars = (paths = sidecars) => {
    for (const path of paths) {
      let present = false;
      try {
        lstatSync(path);
        present = true;
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ))
          throw error;
      }
      invariant(
        !present,
        409,
        "Offline reset refuses existing SQLite WAL/SHM/journal sidecar files. Complete normal recovery and a clean server shutdown first.",
      );
    }
  };
  assertNoSidecars();
  for (const path of controls) await assertFile(path, path !== filename);
  const backupRoot = join(dataRoot, "backups");
  if (await optionalStat(backupRoot)) await assertResetDirectory(backupRoot);
  const keyPath = join(dataRoot, "integration.key");
  const initialKey = await openVerified(keyPath, constants.O_RDONLY, true);
  let keyFingerprint: string | null = null;
  if (initialKey)
    try {
      const bytes = await initialKey.handle.readFile();
      invariant(
        bytes.length === 32,
        409,
        "Reset requires a valid integration key",
      );
      keyFingerprint = createHash("sha256").update(bytes).digest("hex");
    } finally {
      await initialKey.handle.close();
    }
  const original = await openVerified(filename, constants.O_RDONLY);
  // Recognize the database and reject source/storage overlaps before any writable database open.
  let inspection: DatabaseSync | undefined;
  const protectedRoots: string[] = [];
  try {
    assertNoSidecars();
    inspection = new DatabaseSync(
      pathToFileURL(filename).href + "?immutable=1",
      { readOnly: true },
    );
    inspection.exec("PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;");
    assertResetSchema({ db: inspection });
    invariant(
      inspection
        .prepare("PRAGMA integrity_check")
        .all()
        .every((row) => row.integrity_check === "ok") &&
        inspection.prepare("PRAGMA foreign_key_check").all().length === 0,
      409,
      "Reset requires a healthy database with valid foreign keys",
    );
    for (const row of inspection
      .prepare(
        "SELECT root_path AS path FROM sources UNION SELECT metadata_root AS path FROM sources WHERE metadata_root IS NOT NULL UNION SELECT subtitle_root AS path FROM sources WHERE subtitle_root IS NOT NULL UNION SELECT path FROM protected_source_roots",
      )
      .all()) {
      const raw = String(row.path);
      invariant(
        isAbsolute(raw),
        409,
        "Reset refused a non-absolute source root",
      );
      const source = await canonicalPath(raw);
      invariant(
        !containsPath(source, dataRoot) && !containsPath(dataRoot, source),
        409,
        "Reset data or backup storage overlaps a read-only source root",
      );
      protectedRoots.push(source);
    }
  } catch (error) {
    await original!.handle.close();
    throw error;
  } finally {
    inspection?.close();
  }
  let lock: DatabaseSync | undefined,
    db: DatabaseSync | undefined,
    lockHandle: FileHandle | undefined;
  try {
    const lockPath = join(dataRoot, "runtime-lock.db");
    assertNoSidecars();
    if (await optionalStat(lockPath)) {
      const inspectionLock = new DatabaseSync(
        pathToFileURL(lockPath).href + "?immutable=1",
        { readOnly: true },
      );
      try {
        invariant(
          Number(
            inspectionLock
              .prepare(
                "SELECT COUNT(*) AS count FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
              )
              .get()!.count,
          ) === 0,
          409,
          "Reset refused an unrecognized owner-lock database",
        );
      } finally {
        inspectionLock.close();
      }
    }
    if (!(await optionalStat(lockPath))) {
      lockHandle = await open(
        lockPath,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_RDWR |
          constants.O_NOFOLLOW,
        0o600,
      );
    } else
      lockHandle = (await openVerified(lockPath, constants.O_RDONLY))!.handle;
    const lockIdentity = identity(await lockHandle.stat());
    invariant(
      same(lockIdentity, lstatSync(lockPath)),
      409,
      "Reset owner-lock identity changed before SQLite open",
    );
    lock = new DatabaseSync(lockPath);
    try {
      // Normalize only this recognized empty control DB synchronously. An initialized
      // rollback-mode lock holds no journal file across the first asynchronous wait.
      assertNoSidecars();
      lock.exec(
        "PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; PRAGMA temp_store=MEMORY; VACUUM; BEGIN EXCLUSIVE;",
      );
    } catch (error) {
      throw new Error(
        "Data directory is in use; stop myTuner before offline reset",
        { cause: error },
      );
    }
    // The exclusive lock may now own its newly created rollback journal.
    // The application database must still have no preexisting sidecar.
    assertNoSidecars(
      sidecars.filter((path) => path.startsWith(filename + "-")),
    );
    invariant(
      same(original!.identity, lstatSync(filename)),
      409,
      "Reset database identity changed before SQLite open",
    );
    db = new DatabaseSync(filename);
    // WAL handles must never survive an await: SQLite closes them by pathname,
    // which could otherwise unlink a later foreign replacement after rejection.
    assertNoSidecars();
    invariant(
      db.prepare("PRAGMA journal_mode=DELETE").get()!.journal_mode === "delete",
      409,
      "Reset requires rollback journal mode",
    );
    db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0; PRAGMA trusted_schema=OFF;",
    );
    assertResetSchema({ db });
    invariant(
      db
        .prepare("PRAGMA integrity_check")
        .all()
        .every((row) => row.integrity_check === "ok"),
      409,
      "Reset requires a healthy database",
    );
    invariant(
      db.prepare("PRAGMA foreign_key_check").all().length === 0,
      409,
      "Reset requires valid foreign keys",
    );
    const database = db;
    const assertSqliteSafe = () => {
      assertNoSidecars();
      for (const [path, expected, handle] of [
        [filename, original!.identity, original!.handle],
        [lockPath, lockIdentity, lockHandle!],
      ] as const) {
        const current = lstatSync(path);
        invariant(
          current.isFile() &&
            !current.isSymbolicLink() &&
            current.nlink === 1 &&
            same(expected, current),
          409,
          "Reset control file identity changed",
        );
        const versions = Buffer.alloc(2);
        invariant(
          readSync(handle.fd, versions, 0, 2, 18) === 2 &&
            versions[0] === 1 &&
            versions[1] === 1,
          409,
          "Reset control database journal mode changed",
        );
      }
    };
    const assertCurrent = async () => {
      invariant(
        same(dataIdentity, await assertResetDirectory(dataRoot)),
        409,
        "Reset data directory changed",
      );
      const now = await assertFile(filename);
      invariant(
        now && same(original!.identity, now),
        409,
        "Reset database identity changed",
      );
      invariant(
        same(lockIdentity, (await assertFile(lockPath))!),
        409,
        "Reset owner-lock identity changed",
      );
      for (const path of controls) await assertFile(path, path !== filename);
      invariant(
        !(await optionalStat(join(dataRoot, "restore.pending.json"))),
        409,
        "Restore started while reset was pending",
      );
      if (await optionalStat(backupRoot))
        await assertResetDirectory(backupRoot);
      const currentKey = await openVerified(keyPath, constants.O_RDONLY, true);
      let currentFingerprint: string | null = null;
      if (currentKey)
        try {
          currentFingerprint = createHash("sha256")
            .update(await currentKey.handle.readFile())
            .digest("hex");
        } finally {
          await currentKey.handle.close();
        }
      invariant(
        currentFingerprint === keyFingerprint,
        409,
        "Integration key changed during reset preparation",
      );
      assertSqliteSafe();
      assertResetSchema({ db: database });
    };
    await assertCurrent();
    let closed = false;
    return {
      dataRoot,
      filename,
      db: database,
      protectedRoots,
      assertCurrent,
      assertSqliteSafe,
      close: async () => {
        if (closed) return;
        closed = true;
        database.close();
        lock!.close();
        await lockHandle!.close();
        await original!.handle.close();
      },
    };
  } catch (error) {
    db?.close();
    lock?.close();
    await lockHandle?.close();
    await original?.handle.close();
    throw error;
  }
}

// The final guard, exclusive creation and writes run without an async pathname gap.
// A held descriptor pins the created inode; failures retain every partial file.
function appendFile(
  path: string,
  bytes: Buffer | string,
  assertParentSafe: () => void,
) {
  assertParentSafe();
  const fd = openSync(
    path,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const created = fstatSync(fd);
    const assertCreated = () => {
      assertParentSafe();
      const current = lstatSync(path);
      invariant(
        created.isFile() &&
          created.nlink === 1 &&
          current.isFile() &&
          !current.isSymbolicLink() &&
          current.nlink === 1 &&
          same(created, current) &&
          same(created, fstatSync(fd)),
        409,
        "Reset backup output changed during creation",
      );
    };
    assertCreated();
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    assertCreated();
    return identity(fstatSync(fd));
  } finally {
    closeSync(fd);
  }
}
const verifiedBackups = new WeakMap<object, () => void>();
/** Recheck the privately pinned physical bundle immediately before reset writes. */
export function assertVerifiedResetBackupCurrent(backup: object) {
  const check = verifiedBackups.get(backup);
  invariant(check, 409, "Reset requires its original verified backup");
  check();
}
function withBackupFile<T>(
  path: string,
  expected: Identity,
  read: (fd: number) => T,
): T {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    invariant(
      before.isFile() && before.nlink === 1 && same(expected, before),
      409,
      "Reset backup file changed after verification",
    );
    const result = read(fd);
    const after = fstatSync(fd),
      current = lstatSync(path);
    invariant(
      after.nlink === 1 &&
        same(before, after) &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs &&
        current.isFile() &&
        !current.isSymbolicLink() &&
        current.nlink === 1 &&
        same(expected, current),
      409,
      "Reset backup file changed during verification",
    );
    return result;
  } finally {
    closeSync(fd);
  }
}
export async function createVerifiedResetBackup(context: OfflineResetContext) {
  await context.assertCurrent();
  const backupRoot = join(context.dataRoot, "backups");
  if (!(await optionalStat(backupRoot)))
    await mkdir(backupRoot, { mode: 0o700 });
  const parent = await assertResetDirectory(backupRoot);
  const directory = join(
    backupRoot,
    `reset-snapshot-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`,
  );
  await mkdir(directory, { mode: 0o700 });
  const bundle = await assertResetDirectory(directory);
  const destination = join(directory, "mytuner.db");
  const assertDirectoriesSafe = () => {
    const root = parse(directory).root;
    let current = root;
    for (const part of directory
      .slice(root.length)
      .split(/[\\/]/)
      .filter(Boolean)) {
      current = join(current, part);
      const value = lstatSync(current);
      invariant(
        value.isDirectory() && !value.isSymbolicLink(),
        409,
        "Reset backup directory changed",
      );
    }
    for (const [path, expected] of [
      [backupRoot, parent],
      [directory, bundle],
    ] as const) {
      const value = lstatSync(path);
      invariant(
        value.isDirectory() &&
          !value.isSymbolicLink() &&
          (value.mode & 0o022) === 0 &&
          same(expected, value),
        409,
        "Reset backup directory changed",
      );
    }
  };
  assertDirectoriesSafe();
  const target = openSync(
    destination,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_RDWR |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const targetIdentity = identity(fstatSync(target));
    const assertTargetSafe = () => {
      // SQLite may remove target-side journals even when VACUUM INTO fails.
      // Keep pathname validation synchronous with each SQLite open/write.
      assertDirectoriesSafe();
      const currentTarget = lstatSync(destination);
      invariant(
        currentTarget.isFile() &&
          !currentTarget.isSymbolicLink() &&
          currentTarget.nlink === 1 &&
          same(targetIdentity, currentTarget),
        409,
        "Reset backup target changed",
      );
      for (const suffix of ["-wal", "-shm", "-journal"]) {
        let present = false;
        try {
          lstatSync(destination + suffix);
          present = true;
        } catch (error) {
          if (!(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          ))
            throw error;
        }
        invariant(
          !present,
          409,
          "Reset backup refuses existing SQLite WAL/SHM/journal sidecar files",
        );
      }
    };
    await context.assertCurrent();
    invariant(
      same(parent, await assertResetDirectory(backupRoot)) &&
        same(bundle, await assertResetDirectory(directory)),
      409,
      "Reset backup directory changed",
    );
    invariant(
      same(targetIdentity, (await assertFile(destination))!),
      409,
      "Reset backup target changed",
    );
    // VACUUM INTO accepts this new, exclusively allocated empty file and emits a standalone snapshot.
    context.assertSqliteSafe();
    assertTargetSafe();
    context.db.prepare("VACUUM INTO ?").run(destination);
    assertTargetSafe();
    fsyncSync(target);
    assertTargetSafe();
    invariant(
      same(targetIdentity, (await assertFile(destination))!),
      409,
      "Reset backup target changed",
    );
    const keyInput = await openVerified(
      join(context.dataRoot, "integration.key"),
      constants.O_RDONLY,
      true,
    );
    let key: Buffer | null = null;
    if (keyInput)
      try {
        key = await keyInput.handle.readFile();
        invariant(
          key.length === 32,
          409,
          "Reset backup has an invalid integration key",
        );
      } finally {
        await keyInput.handle.close();
      }
    assertTargetSafe();
    const verified = new DatabaseSync(
      pathToFileURL(destination).href + "?immutable=1",
      { readOnly: true },
    );
    try {
      verified.exec("PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;");
      assertResetSchema({ db: verified });
      invariant(
        verified
          .prepare("PRAGMA integrity_check")
          .all()
          .every((row) => row.integrity_check === "ok") &&
          verified.prepare("PRAGMA foreign_key_check").all().length === 0,
        409,
        "Reset backup verification failed",
      );
      const integrations = verified
        .prepare("SELECT encrypted_key FROM integrations")
        .all();
      invariant(
        !integrations.length || key !== null,
        409,
        "Reset backup is missing its integration key",
      );
      for (const row of integrations) unseal(key!, String(row.encrypted_key));
    } finally {
      verified.close();
    }
    const keyIdentity = key
      ? appendFile(join(directory, "integration.key"), key, assertTargetSafe)
      : null;
    // Pin the content fingerprint in the same synchronous turn as SQLite verification.
    assertTargetSafe();
    const bytes = readFileSync(target);
    const fingerprint = createHash("sha256")
      .update(bytes)
      .update(key ?? Buffer.alloc(0))
      .digest("hex");
    await context.assertCurrent();
    invariant(
      same(parent, await assertResetDirectory(backupRoot)) &&
        same(bundle, await assertResetDirectory(directory)),
      409,
      "Reset backup directory changed",
    );
    const manifest = JSON.stringify({
      format: 1,
      schemaVersion,
      keyIncluded: key !== null,
      resetBackup: true,
      fingerprint,
    });
    const manifestIdentity = appendFile(
      join(directory, "manifest.json"),
      manifest,
      assertTargetSafe,
    );
    const backup = {
      directory,
      verified: true as const,
      schemaVersion,
      fingerprint,
    };
    // Capture expected values privately: the observer receives the public DTO and
    // cannot authorize a replacement bundle by editing that DTO or its manifest.
    const assertBackupCurrent = () => {
      assertTargetSafe();
      const hash = createHash("sha256"),
        chunk = Buffer.alloc(64 * 1024);
      for (const [path, expected] of [
        [destination, targetIdentity],
        ...(keyIdentity
          ? [[join(directory, "integration.key"), keyIdentity] as const]
          : []),
      ] as const) {
        withBackupFile(path, expected, (fd) => {
          let count: number;
          while ((count = readSync(fd, chunk, 0, chunk.length, null)) > 0)
            hash.update(chunk.subarray(0, count));
        });
      }
      if (!keyIdentity) {
        let present = false;
        try {
          lstatSync(join(directory, "integration.key"));
          present = true;
        } catch (error) {
          if (!(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          ))
            throw error;
        }
        invariant(
          !present,
          409,
          "Reset backup integration key changed after verification",
        );
      }
      invariant(
        hash.digest("hex") === fingerprint,
        409,
        "Reset backup fingerprint changed after verification",
      );
      const recorded = withBackupFile(
        join(directory, "manifest.json"),
        manifestIdentity,
        (fd) => {
          invariant(
            fstatSync(fd).size === Buffer.byteLength(manifest),
            409,
            "Reset backup manifest changed after verification",
          );
          return readFileSync(fd, "utf8");
        },
      );
      invariant(
        recorded === manifest,
        409,
        "Reset backup manifest changed after verification",
      );
      assertTargetSafe();
    };
    assertBackupCurrent();
    verifiedBackups.set(backup, assertBackupCurrent);
    return backup;
  } finally {
    closeSync(target);
  }
}
