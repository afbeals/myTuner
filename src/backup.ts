import { backup } from "node:sqlite";
import { mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Store } from "./database.js";
export async function backupDatabase(
  store: Store,
  directory: string,
): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(
    directory,
    `mytuner-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.db`,
  );
  await backup(store.db, path);
  await chmod(path, 0o600);
  return path;
}
