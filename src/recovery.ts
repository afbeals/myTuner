import { backup, DatabaseSync } from "node:sqlite";
import {
  mkdir,
  readFile,
  writeFile,
  rm,
  rename,
  chmod,
  stat,
  copyFile,
  mkdtemp,
} from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { Store, schemaVersion } from "./database.js";
import { canonicalPath, containsPath } from "./catalog.js";
import { acquireDataLock } from "./runtime-lock.js";
import { unseal } from "./refresh.js";
class DatabaseIntegrityError extends Error {}
class ApplicationKeyError extends Error {}
function databaseIsDamaged(error: unknown): boolean {
  return (
    error instanceof DatabaseIntegrityError ||
    (error instanceof Error &&
      "errcode" in error &&
      [11, 26].includes(Number(error.errcode) & 255))
  );
}
export function verifyDatabase(db: DatabaseSync) {
  const integrity = db.prepare("PRAGMA integrity_check").all();
  if (integrity.some((r) => r.integrity_check !== "ok"))
    throw new DatabaseIntegrityError("Database integrity check failed");
  if (db.prepare("PRAGMA foreign_key_check").all().length)
    throw new DatabaseIntegrityError("Database foreign key check failed");
  const version = Number(db.prepare("PRAGMA user_version").get()?.user_version);
  if (version < 1 || version > schemaVersion)
    throw Error("Unsupported backup schema");
}
export async function backupApplication(
  db: DatabaseSync,
  dataRoot: string,
  backupRoot = join(dataRoot, "backups"),
) {
  const directory = join(
    backupRoot,
    `snapshot-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`,
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const path = join(directory, "mytuner.db");
    await backup(db, path);
    await chmod(path, 0o600);
    let version: number;
    const key = await readFile(join(dataRoot, "integration.key")).catch((e) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
    if (key && key.length !== 32)
      throw new ApplicationKeyError(
        "Invalid integration encryption key in backup",
      );
    const verified = new DatabaseSync(path, { readOnly: true });
    try {
      verifyDatabase(verified);
      version = Number(
        verified.prepare("PRAGMA user_version").get()?.user_version,
      );
      const configurations = verified
        .prepare("SELECT encrypted_key FROM integrations")
        .all();
      if (configurations.length && (!key || key.length !== 32))
        throw new ApplicationKeyError(
          "Backup is missing a valid integration encryption key; retry after restore finishes",
        );
      for (const configuration of configurations) {
        try {
          unseal(key!, String(configuration.encrypted_key));
        } catch {
          throw new ApplicationKeyError(
            "Backup database and integration key changed; retry after restore finishes",
          );
        }
      }
    } finally {
      verified.close();
    }
    if (key)
      await writeFile(join(directory, "integration.key"), key, { mode: 0o600 });
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify({
        format: 1,
        schemaVersion: version,
        keyIncluded: Boolean(key),
      }),
      { mode: 0o600 },
    );
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return directory;
}
export async function assertNoPendingRestore(root: string) {
  try {
    await stat(join(root, "restore.pending.json"));
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "ENOENT") return;
    throw e;
  }
  throw Error(
    "Interrupted restore detected; run db:restore -- --recover before starting the server",
  );
}
// Bundles are standalone SQLite files. A live WAL changes the effective database
// without changing the main-file fingerprint and must never be silently ignored.
async function assertStandaloneBundle(directory: string) {
  try {
    if ((await stat(join(directory, "mytuner.db-wal"))).size > 0)
      throw Error(
        "Backup contains a nonempty WAL; create a complete application snapshot first",
      );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
}
async function assertRestoreStorage(root: string, directory: string) {
  await assertStandaloneBundle(directory);
  const target = await canonicalPath(root);
  for (const [path, optional] of [
    [join(directory, "mytuner.db"), false],
    [join(root, "mytuner.db"), true],
  ] as const) {
    if (optional) {
      try {
        await stat(path);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          continue;
        throw error;
      }
    }
    let input: DatabaseSync | undefined;
    try {
      input = new DatabaseSync(path, { readOnly: true });
      const columns = input.prepare("PRAGMA table_info(sources)").all();
      if (!columns.length) continue;
      const roots = input
        .prepare(
          [
            "SELECT root_path FROM sources",
            ...["metadata_root", "subtitle_root"]
              .filter((name) => columns.some((c) => c.name === name))
              .map(
                (name) =>
                  `SELECT ${name} AS root_path FROM sources WHERE ${name} IS NOT NULL`,
              ),
          ].join(" UNION "),
        )
        .all();
      for (const row of roots) {
        const source = await canonicalPath(String(row.root_path));
        if (containsPath(source, target) || containsPath(target, source))
          throw Error(
            "Restore target overlaps a read-only media or metadata root",
          );
      }
    } catch (error) {
      // A damaged live DB may be quarantined; an unreadable input cannot be restored.
      if (!optional || !databaseIsDamaged(error)) throw error;
    } finally {
      input?.close();
    }
  }
}
async function installBundle(
  root: string,
  directory: string,
  validateOnly = false,
) {
  await assertStandaloneBundle(directory);
  const stage = join(root, `restore-${randomUUID()}.db`),
    target = join(root, "mytuner.db");
  let staged: Store | undefined;
  try {
    const manifest = JSON.parse(
      await readFile(join(directory, "manifest.json"), "utf8"),
    );
    if (manifest.format !== 1) throw Error("Unsupported backup format");
    const input = new DatabaseSync(join(directory, "mytuner.db"), {
      readOnly: true,
    });
    try {
      verifyDatabase(input);
      if (
        manifest.schemaVersion !==
          Number(input.prepare("PRAGMA user_version").get()?.user_version) ||
        typeof manifest.keyIncluded !== "boolean"
      )
        throw Error("Backup manifest does not match database");
      await backup(input, stage);
    } finally {
      input.close();
    }
    await chmod(stage, 0o600);
    staged = new Store(stage);
    verifyDatabase(staged.db);
    const configs = staged.db
      .prepare("SELECT encrypted_key FROM integrations")
      .all();
    const key = await readFile(join(directory, "integration.key")).catch(
      (e) => {
        if (e.code === "ENOENT") return null;
        throw e;
      },
    );
    if (key && key.length !== 32)
      throw new ApplicationKeyError(
        "Invalid integration encryption key in backup",
      );
    if (manifest.keyIncluded !== Boolean(key))
      throw Error("Backup manifest does not match integration key presence");
    if (configs.length && !key)
      throw new ApplicationKeyError(
        "Backup is missing its integration encryption key",
      );
    for (const config of configs) {
      try {
        unseal(key!, String(config.encrypted_key));
      } catch {
        throw new ApplicationKeyError(
          "Backup database and integration key do not match",
        );
      }
    }
    staged.db.exec(
      "DELETE FROM profile_unlocks; DELETE FROM sessions; DELETE FROM device_pairings; DELETE FROM playback_sessions; UPDATE generation_jobs SET status='queued' WHERE status='running'; UPDATE generation_items SET status='queued' WHERE status='running'; PRAGMA wal_checkpoint(TRUNCATE);",
    );
    staged.close();
    staged = undefined;
    if (validateOnly) return;
    if (key) {
      const temporary = join(root, "integration.key.restore");
      await writeFile(temporary, key, { mode: 0o600 });
      await rename(temporary, join(root, "integration.key"));
    } else await rm(join(root, "integration.key"), { force: true });
    await rm(target + "-wal", { force: true });
    await rm(target + "-shm", { force: true });
    await rename(stage, target);
  } finally {
    staged?.close();
    await rm(stage, { force: true });
    await rm(stage + "-wal", { force: true });
    await rm(stage + "-shm", { force: true });
  }
}
export async function restoreApplication(root: string, directory: string) {
  root = resolve(root);
  directory = resolve(directory);
  // This guard precedes mkdir, the runtime lock, staging and recovery snapshots.
  await assertRestoreStorage(root, directory);
  const release = await acquireDataLock(root);
  try {
    await assertNoPendingRestore(root);
    const manifest = JSON.parse(
      await readFile(join(directory, "manifest.json"), "utf8"),
    );
    if (manifest.format !== 1) throw Error("Unsupported backup format");
    // Validate the input before taking a recovery snapshot or changing live files.
    const input = new DatabaseSync(join(directory, "mytuner.db"), {
      readOnly: true,
    });
    try {
      verifyDatabase(input);
    } finally {
      input.close();
    }
    // Validate migrations and encryption keys before any live-data snapshot/journal, including fresh targets.
    await installBundle(root, directory, true);
    const target = join(root, "mytuner.db");
    let previous: string | null = null,
      quarantine: string | null = null;
    let targetExists = true;
    try {
      await stat(target);
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
      targetExists = false;
    }
    if (targetExists) {
      let current: DatabaseSync | undefined,
        damaged = false,
        damageReason = "Live database failed integrity validation";
      try {
        try {
          current = new DatabaseSync(target, { readOnly: true });
          verifyDatabase(current);
        } catch (error) {
          if (!databaseIsDamaged(error)) throw error;
          damaged = true;
        }
        if (!damaged) {
          try {
            previous = await backupApplication(current!, root);
          } catch (error) {
            if (!(error instanceof ApplicationKeyError)) throw error;
            damaged = true;
            damageReason =
              "Live integration encryption key is missing, malformed or does not match the database";
          }
        }
      } finally {
        current?.close();
      }
      if (damaged) {
        quarantine = join(
          root,
          "backups",
          `damaged-${Date.now()}-${randomUUID()}`,
        );
        await mkdir(quarantine, { recursive: true, mode: 0o700 });
        for (const name of [
          "mytuner.db",
          "mytuner.db-wal",
          "mytuner.db-shm",
          "integration.key",
        ]) {
          try {
            await copyFile(join(root, name), join(quarantine, name));
            await chmod(join(quarantine, name), 0o600);
          } catch (error) {
            if (!(
              error instanceof Error &&
              "code" in error &&
              error.code === "ENOENT"
            ))
              throw error;
            if (name === "mytuner.db") throw error;
          }
        }
        await writeFile(
          join(quarantine, "damage.json"),
          JSON.stringify({
            format: 1,
            reason: damageReason,
            validatedRollback: false,
            note: "Forensic copy only; this directory is not a restorable application snapshot.",
          }),
          { mode: 0o600 },
        );
      }
    }
    const journal = join(root, "restore.pending.json");
    await writeFile(
      journal,
      JSON.stringify({ previous, quarantine, source: directory }),
      { mode: 0o600 },
    );
    try {
      await installBundle(root, directory);
      await rm(journal);
    } catch (error) {
      if (previous) {
        await installBundle(root, previous);
        await rm(journal);
      }
      throw error;
    }
  } finally {
    await release();
  }
}
export async function recoverInterruptedRestore(root: string) {
  root = resolve(root);
  const journal = join(root, "restore.pending.json"),
    original = await stat(journal, { bigint: true }),
    contents = await readFile(journal),
    data = JSON.parse(contents.toString("utf8"));
  const candidate =
    typeof data.previous === "string" ? data.previous : data.source;
  if (typeof candidate !== "string")
    throw Error("Invalid restore recovery journal");
  await assertRestoreStorage(root, resolve(candidate));
  const release = await acquireDataLock(root);
  try {
    // Validation yielded before ownership. Another recovery may have resolved
    // this journal, or a later restore may have replaced it in the meantime.
    const changed = () =>
      Error(
        "Restore recovery journal changed; review the current restore state before retrying",
      );
    try {
      const current = await stat(journal, { bigint: true });
      if (
        current.dev !== original.dev ||
        current.ino !== original.ino ||
        current.size !== original.size ||
        current.mtimeNs !== original.mtimeNs ||
        current.ctimeNs !== original.ctimeNs ||
        !(await readFile(journal)).equals(contents)
      )
        throw changed();
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        throw changed();
      throw error;
    }
    if (
      typeof data.previous === "string" &&
      containsPath(join(root, "backups"), resolve(data.previous)) &&
      basename(data.previous).startsWith("snapshot-")
    ) {
      await installBundle(root, data.previous);
    } else if (
      data.previous === null &&
      (data.quarantine === null ||
        (typeof data.quarantine === "string" &&
          containsPath(join(root, "backups"), resolve(data.quarantine)) &&
          basename(data.quarantine).startsWith("damaged-"))) &&
      typeof data.source === "string"
    ) {
      // Fresh targets and damaged targets have no valid rollback. Retry the validated input.
      const manifest = JSON.parse(
        await readFile(join(data.source, "manifest.json"), "utf8"),
      );
      if (manifest.format !== 1) throw Error("Unsupported backup format");
      await installBundle(root, data.source);
    } else {
      throw Error(
        "No automatic rollback snapshot available; restore a known backup manually after inspecting the journal",
      );
    }
    await rm(journal);
  } finally {
    await release();
  }
}

// Verification shares restore's staged validation, but never opens the live data directory.
export async function verifyApplicationBackup(
  directory: string,
  signal?: AbortSignal,
) {
  const scratch = await mkdtemp(join(tmpdir(), "mytuner-verify-"));
  try {
    signal?.throwIfAborted();
    const manifest = JSON.parse(
      await readFile(join(directory, "manifest.json"), "utf8"),
    );
    if (manifest.format !== 1) throw Error("Unsupported backup format");
    const fingerprint = async () => {
      await assertStandaloneBundle(directory);
      const hash = createHash("sha256");
      for (const name of ["manifest.json", "mytuner.db", "integration.key"]) {
        signal?.throwIfAborted();
        hash.update(name);
        try {
          for await (const bytes of createReadStream(join(directory, name), {
            signal,
          })) {
            signal?.throwIfAborted();
            hash.update(bytes);
          }
        } catch (e) {
          if (
            name !== "integration.key" ||
            !(e instanceof Error && "code" in e && e.code === "ENOENT")
          )
            throw e;
          hash.update("absent");
        }
      }
      return hash.digest("hex");
    };
    const before = await fingerprint();
    await installBundle(scratch, resolve(directory), true);
    signal?.throwIfAborted();
    if (before !== (await fingerprint()))
      throw Error("Backup changed during verification; retry");
    return {
      status: "valid" as const,
      format: 1,
      sourceSchemaVersion: manifest.schemaVersion,
      checkedSchemaVersion: schemaVersion,
      validatorVersion: "0.2.0",
      checkedAt: new Date().toISOString(),
      fingerprint: before,
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
