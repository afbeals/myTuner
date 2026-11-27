import {
  browseSelectionPage,
  browseCatalogTree,
  type SelectionPageInput,
  type TreePageInput,
} from "./catalog-selection.js";
import { DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";
import type { Store } from "./database.js";
import { DomainError, invariant } from "./domain.js";
import { refreshAccount, requireProfile } from "./security.js";
import { requireCatalogProjection } from "./catalog-projection.js";
import { browseLibraryPage } from "./library-page.js";
import {
  browseMediaPage,
  programmingOptions,
  withCatalogCancellation,
} from "./library.js";
import {
  catalogPageByteLimit,
  type CatalogWork,
  type CatalogWorkerMessage,
  type CatalogWorkerReply,
  type LibraryPageInput,
  type MediaPageInput,
  type CatalogOptionsInput,
} from "./catalog-protocol.js";

if (!parentPort) throw new Error("Catalog worker requires a parent");
const port = parentPort;
const filename = (workerData as { filename: string }).filename;
// This connection belongs to the running server. Constructing Store here would
// run migrations, chmod files and change journal settings from a second owner.
const db = new DatabaseSync(filename, {
  readOnly: true,
  allowExtension: false,
});
db.enableDefensive(true);
db.exec(
  "PRAGMA query_only=ON; PRAGMA busy_timeout=200; PRAGMA cache_size=-4096; PRAGMA mmap_size=0;",
);
const reader = { db, filename } as Store;
const send = (message: CatalogWorkerReply) => port.postMessage(message);
function checkCancellation(work: CatalogWork) {
  invariant(
    Atomics.load(new Int32Array(work.cancellation), 0) === 0,
    503,
    "Library request cancelled",
  );
}
function execute(work: CatalogWork) {
  const identity = {
    id: work.id,
    epoch: work.epoch,
    generation: work.generation,
    revision: work.revision,
  };
  try {
    checkCancellation(work);
    db.exec("BEGIN");
    try {
      const revision = Number(
        db.prepare("SELECT revision FROM catalog_revision WHERE id=1").get()
          ?.revision,
      );
      invariant(revision === work.revision, 503, "Library changed; retry");
      requireCatalogProjection(reader);
      const account = refreshAccount(reader, work.account);
      requireProfile(reader, account, work.profileId);
      invariant(
        account.role === work.account.role,
        503,
        "Library access changed; retry",
      );
      const result = withCatalogCancellation(
        () => checkCancellation(work),
        () =>
          work.operation === "selection"
            ? browseSelectionPage(
                reader,
                account,
                work.profileId,
                work.input as SelectionPageInput,
              )
            : work.operation === "tree"
              ? browseCatalogTree(
                  reader,
                  account,
                  work.profileId,
                  work.input as TreePageInput,
                )
              : work.operation === "library"
                ? browseLibraryPage(
                    reader,
                    account,
                    work.profileId,
                    work.input as LibraryPageInput,
                  )
                : work.operation === "media"
                  ? browseMediaPage(
                      reader,
                      account,
                      work.profileId,
                      work.input as MediaPageInput,
                    )
                  : programmingOptions(
                      reader,
                      account,
                      work.profileId,
                      work.input as CatalogOptionsInput,
                    ),
      );
      checkCancellation(work);
      invariant(
        Buffer.byteLength(JSON.stringify(result)) <= catalogPageByteLimit,
        503,
        "Library page budget exceeded; choose a smaller page",
      );
      db.exec("COMMIT");
      send({ type: "result", ...identity, result });
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  } catch (error) {
    send({
      type: "result",
      ...identity,
      error: {
        statusCode: error instanceof DomainError ? error.statusCode : 503,
        message:
          error instanceof DomainError
            ? error.message
            : "Library reader unavailable; retry",
      },
    });
  }
}
port.on("message", (message: CatalogWorkerMessage) => {
  if (message.type === "stop") {
    db.close();
    port.close();
  } else execute(message.work);
});
send({ type: "ready" });
