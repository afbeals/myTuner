import { randomUUID } from "node:crypto";
import { relative, sep } from "node:path";
import type { Store } from "./database.js";
import type { Source } from "./domain.js";
import { containsPath } from "./catalog.js";
import { mapIntegrationPath } from "./integrations.js";
import type { ImportedItem, PathMapping } from "./integrations.js";
export function recordIntegrationReport(
  store: Store,
  source: Source,
  provider: string,
  items: ImportedItem[],
  mappings: PathMapping[],
  scanComplete: boolean,
) {
  const id = randomUUID(),
    previous = store.db
      .prepare(
        "SELECT external_id,media_id FROM integration_metadata WHERE source_id=? AND provider=?",
      )
      .all(source.id, provider);
  const previousById = new Map(
    previous.map((row) => [String(row.external_id), row]),
  );
  const incoming = new Set(items.map((item) => item.externalId));
  const details = items.map((item) => {
    const mapped = mapIntegrationPath(item.path, mappings),
      path =
        mapped && containsPath(source.root_path, mapped)
          ? relative(source.root_path, mapped).split(sep).join("/")
          : null;
    const match =
      path === null
        ? undefined
        : store.db
            .prepare(
              "SELECT id FROM media WHERE source_id=? AND relative_path=? AND available=1",
            )
            .get(source.id, path);
    const before = previousById.get(item.externalId);
    return {
      externalId: item.externalId,
      previousMediaId: before?.media_id ?? null,
      matchedMediaId: match?.id ?? null,
      state: !match
        ? "unmatched"
        : !before
          ? "new"
          : before.media_id === match.id
            ? "unchanged"
            : "reassociated",
    };
  });
  details.push(
    ...previous
      .filter((row) => !incoming.has(String(row.external_id)))
      .map((row) => ({
        externalId: String(row.external_id),
        previousMediaId: row.media_id ?? null,
        matchedMediaId: null,
        state: "absent",
      })),
  );
  const counts = Object.fromEntries(
    ["new", "unchanged", "unmatched", "reassociated", "absent"].map((state) => [
      state,
      details.filter((item) => item.state === state).length,
    ]),
  );
  store.transaction(() => {
    store.db
      .prepare(
        "INSERT INTO integration_runs(id,source_id,provider,completed_ms,scan_complete,summary_json) VALUES(?,?,?,?,?,?)",
      )
      .run(
        id,
        source.id,
        provider,
        Date.now(),
        Number(scanComplete),
        JSON.stringify(counts),
      );
    const insert = store.db.prepare(
      "INSERT INTO integration_run_items(run_id,external_id,previous_media_id,matched_media_id,state) VALUES(?,?,?,?,?)",
    );
    for (const item of details)
      insert.run(
        id,
        item.externalId,
        item.previousMediaId,
        item.matchedMediaId,
        item.state,
      );
    store.db
      .prepare(
        "DELETE FROM integration_runs WHERE source_id=? AND id NOT IN (SELECT id FROM integration_runs WHERE source_id=? ORDER BY completed_ms DESC,rowid DESC LIMIT 20)",
      )
      .run(source.id, source.id);
  });
  return {
    id,
    counts,
    providerReadComplete: true,
    scanComplete,
    removalsApplied: false,
    providerAcceptanceRequired: true,
  };
}
