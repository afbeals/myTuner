import { DatabaseSync } from "node:sqlite";
import { mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";

export async function acquireDataLock(
  root: string,
): Promise<() => Promise<void>> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  // Keep this inode stable. Removing a lock file can split owners between old/new inodes.
  // This separate database holds no application state and is never used for backups.
  const path = join(root, "runtime-lock.db");
  let lock: DatabaseSync | undefined;
  try {
    lock = new DatabaseSync(path);
    lock.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;");
    await chmod(path, 0o600);
  } catch (error) {
    lock?.close();
    if (
      error instanceof Error &&
      "errcode" in error &&
      [5, 6].includes(Number(error.errcode) & 255)
    )
      throw new Error(
        "Data directory is in use; stop the server before this operation",
        { cause: error },
      );
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    // Closing (or process termination) releases the kernel-held SQLite transaction lock.
    lock!.close();
  };
}
