import { resolve } from "node:path";
import { mkdir, stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { acquireDataLock } from "./runtime-lock.js";
import { assertNoPendingRestore } from "./recovery.js";
import { loadIntegrationKey } from "./refresh.js";
import { validateStorage } from "./storage.js";
import { Store } from "./database.js";
import { createServer } from "./server.js";
const dataRoot = resolve(process.env.MYTUNER_DATA_DIR ?? ".data"),
  generatedRoot = resolve(
    process.env.MYTUNER_GENERATED_DIR ?? ".data/generated",
  ),
  cacheRoot = resolve(process.env.MYTUNER_CACHE_DIR ?? ".data/cache"),
  filename = resolve(dataRoot, "mytuner.db"),
  roots = [dataRoot, generatedRoot, cacheRoot];
const port = Number(process.env.PORT ?? 8777);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw Error("Invalid PORT");
// Inspect existing source roots before creating output directories or running migrations.
if (await stat(filename).catch(() => null)) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    await validateStorage({ db }, roots, generatedRoot, cacheRoot);
  } finally {
    db.close();
  }
}
const releaseLock = await acquireDataLock(dataRoot);
let initializedStore: Store | undefined;
const { store, app } = await (async () => {
  try {
    await assertNoPendingRestore(dataRoot);
    const store = new Store(filename);
    initializedStore = store;
    await validateStorage(store, roots, generatedRoot, cacheRoot);
    await Promise.all(
      [generatedRoot, cacheRoot].map((root) =>
        mkdir(root, { recursive: true }),
      ),
    );
    const integrationKey = await loadIntegrationKey(
      dataRoot,
      Number(
        store.db.prepare("SELECT COUNT(*) AS n FROM integrations").get()?.n,
      ) === 0,
    );
    const app = createServer(store, {
      writableRoots: roots,
      generatedRoot,
      cacheRoot,
      logger: true,
      autoMaintenance: true,
      webRoot: resolve("web-dist"),
      integrationKey,
      collectionRetentionDays: Number(
        process.env.MYTUNER_COLLECTION_RETENTION_DAYS ?? 7,
      ),
      reportRetentionDays: Number(
        process.env.MYTUNER_REPORT_RETENTION_DAYS ?? 30,
      ),
      encoderConcurrency: Number(process.env.MYTUNER_ENCODER_CONCURRENCY ?? 3),
      secureCookie: process.env.MYTUNER_SECURE_COOKIE === "true",
      ...(process.env.MYTUNER_PUBLIC_ORIGIN
        ? { publicOrigin: process.env.MYTUNER_PUBLIC_ORIGIN }
        : {}),
    });
    return { store, app };
  } catch (error) {
    initializedStore?.close();
    await releaseLock();
    throw error;
  }
})();
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  try {
    await app.close();
  } finally {
    store.close();
    await releaseLock();
  }
}
process.once("SIGTERM", () => {
  void close();
});
process.once("SIGINT", () => {
  void close();
});
try {
  await app.listen({ host: process.env.HOST ?? "127.0.0.1", port });
} catch (error) {
  await close();
  throw error;
}
