import { posix } from "node:path";
import type { Store } from "./database.js";
import type { Account } from "./domain.js";
import { invariant } from "./domain.js";
import type { Selection } from "./contracts.js";
import { requireProfile, normalizeSubtree } from "./security.js";
import { requireCatalogProjection } from "./catalog-projection.js";
import type { CompactMedia } from "./display-metadata.js";
export type SelectionPageInput = {
  selection: Selection;
  includeUnavailable: boolean;
  offset: number;
  limit: number;
  search: string;
};
export type TreePageInput = {
  sourceId: string;
  parent: string;
  offset: number;
  limit: number;
  search: string;
  recursive: boolean;
  mode: "folders" | "files";
  includeCommercials?: boolean;
};
const functions = new WeakSet<object>();
function registerFunctions(store: Store) {
  if (functions.has(store.db)) return;
  store.db.function("mytuner_basename", { deterministic: true }, (path) =>
    posix.basename(String(path)),
  );
  store.db.function(
    "mytuner_child",
    { deterministic: true },
    (path, parent) => {
      const prefix = parent ? `${String(parent)}/` : "",
        rest = String(path).slice(prefix.length),
        slash = rest.indexOf("/");
      return slash < 0 ? null : prefix + rest.slice(0, slash);
    },
  );
  store.db.function(
    "mytuner_directories",
    { deterministic: true },
    (path, parent) => {
      const prefix = parent ? `${String(parent)}/` : "",
        pieces = String(path).slice(prefix.length).split("/");
      pieces.pop();
      const result: string[] = [];
      let current = String(parent);
      for (const piece of pieces) {
        current = current ? `${current}/${piece}` : piece;
        result.push(current);
      }
      return JSON.stringify(result);
    },
  );
  functions.add(store.db);
}
function access(store: Store, account: Account, profileId: string) {
  requireProfile(store, account, profileId);
  registerFunctions(store);
  const state = requireCatalogProjection(store);
  return {
    where:
      account.role === "admin"
        ? "1=1"
        : "EXISTS(SELECT 1 FROM source_grants g WHERE g.profile_id=? AND g.source_id=p.source_id AND (g.subtree='' OR p.relative_path=g.subtree OR substr(p.relative_path,1,length(g.subtree)+1)=g.subtree||'/'))",
    parameters: account.role === "admin" ? [] : [profileId],
    generation: state.generation,
    revision: state.revision,
  };
}
function selectionConditions(
  store: Store,
  account: Account,
  profileId: string,
  selection: Selection,
) {
  const scope = access(store, account, profileId),
    where = ["p.generation=?", scope.where],
    parameters: (string | number)[] = [scope.generation, ...scope.parameters];
  if (selection.type === "media") {
    const ids = [...new Set(selection.ids)];
    where.push("p.media_id IN(SELECT value FROM json_each(?))");
    parameters.push(JSON.stringify(ids));
    const count = Number(
      store.db
        .prepare(
          `SELECT COUNT(*) AS n FROM catalog_projection_rows p WHERE ${where.join(" AND ")}`,
        )
        .get(...parameters)!.n,
    );
    invariant(count === ids.length, 404, "Media not found");
  } else if (selection.type === "collection") {
    const collection = store.db
      .prepare(
        "SELECT owner_account_id FROM collections WHERE id=? AND deleted_ms IS NULL",
      )
      .get(selection.id);
    invariant(
      collection &&
        (account.role === "admin" ||
          collection.owner_account_id === account.id),
      404,
      "Collection not found",
    );
    if (account.role !== "admin") {
      const hidden = store.db
        .prepare(
          "SELECT 1 FROM collection_items c JOIN media m ON m.id=c.media_id WHERE c.collection_id=? AND NOT EXISTS(SELECT 1 FROM source_grants g WHERE g.profile_id=? AND g.source_id=m.source_id AND(g.subtree='' OR m.relative_path=g.subtree OR substr(m.relative_path,1,length(g.subtree)+1)=g.subtree||'/')) LIMIT 1",
        )
        .get(selection.id, profileId);
      invariant(!hidden, 404, "Collection not found");
    }
    where.push(
      "p.media_id IN(SELECT media_id FROM collection_items WHERE collection_id=?)",
    );
    parameters.push(selection.id);
  } else {
    where.push("p.source_id=?");
    parameters.push(selection.sourceId);
    if (selection.type === "folder") {
      const directory = normalizeSubtree(selection.directory);
      if (selection.recursive) {
        if (directory) {
          where.push("substr(p.relative_path,1,?)=?");
          parameters.push(directory.length + 1, `${directory}/`);
        }
      } else {
        where.push("mytuner_child(p.relative_path,?) IS NULL");
        parameters.push(directory);
        if (directory) {
          where.push("substr(p.relative_path,1,?)=?");
          parameters.push(directory.length + 1, `${directory}/`);
        }
      }
    } else if (selection.type === "show") {
      where.push("p.show_key=?");
      parameters.push(selection.key);
      if (selection.season !== undefined) {
        where.push("json_extract(p.data_json,'$.season')=?");
        parameters.push(selection.season);
      }
      if (!selection.includeSpecials)
        where.push("json_extract(p.data_json,'$.season')<>0");
    } else {
      where.push(
        "EXISTS(SELECT 1 FROM catalog_projection_members g WHERE g.generation=p.generation AND g.media_id=p.media_id AND g.kind='movieCollection' AND g.group_key=?)",
      );
      parameters.push(JSON.stringify([selection.sourceId, selection.key]));
    }
  }
  return { where, parameters, revision: scope.revision };
}
export function browseSelectionPage(
  store: Store,
  account: Account,
  profileId: string,
  input: SelectionPageInput,
) {
  const filter = selectionConditions(
    store,
    account,
    profileId,
    input.selection,
  );
  if (!input.includeUnavailable) filter.where.push("p.available=1");
  if (input.search) {
    filter.where.push(
      "instr(lower(mytuner_basename(p.relative_path)),lower(?))>0",
    );
    filter.parameters.push(input.search);
  }
  const predicate = filter.where.join(" AND ");
  const total = Number(
    store.db
      .prepare(
        `SELECT COUNT(*) AS n FROM catalog_projection_rows p WHERE ${predicate}`,
      )
      .get(...filter.parameters)!.n,
  );
  const rows = store.db
    .prepare(
      `SELECT p.data_json,m.duration_ms,json_extract(m.metadata_json,'$.episodeNumber') AS episode_number,json_extract(m.metadata_json,'$.year') AS year FROM catalog_projection_rows p JOIN media m ON m.id=p.media_id WHERE ${predicate} ORDER BY p.sort_title,p.media_id LIMIT ? OFFSET ?`,
    )
    .all(...filter.parameters, input.limit, input.offset);
  return {
    items: rows.map((row) => {
      const item = JSON.parse(String(row.data_json)) as CompactMedia;
      return {
        id: item.id,
        sourceId: item.sourceId,
        title: item.title,
        path: item.relativePath,
        relativePath: item.relativePath,
        durationMs: Number(row.duration_ms),
        available: Boolean(item.available),
        metadata: {
          seriesTitle: item.seriesTitle,
          seasonNumber: item.sourceKind === "shows" ? item.season : undefined,
          episodeNumber: row.episode_number ?? undefined,
          year: row.year ?? undefined,
        },
      };
    }),
    total,
    offset: input.offset,
    limit: input.limit,
    hasMore: input.offset + rows.length < total,
    revision: filter.revision,
  };
}
export function browseCatalogTree(
  store: Store,
  account: Account,
  profileId: string,
  input: TreePageInput,
) {
  const scope = access(store, account, profileId),
    parent = normalizeSubtree(input.parent),
    prefix = parent ? `${parent}/` : "";
  invariant(
    !parent || input.sourceId,
    400,
    "Choose a source before restricting the folder",
  );
  const where = [
      "p.generation=?",
      scope.where,
      "p.available=1",
      "substr(p.relative_path,1,?)=?",
    ],
    parameters: (string | number)[] = [
      scope.generation,
      ...scope.parameters,
      prefix.length,
      prefix,
    ];
  if (input.sourceId) {
    where.push("p.source_id=?");
    parameters.push(input.sourceId);
  }
  if (input.includeCommercials === false)
    where.push(
      "p.source_id IN(SELECT id FROM sources WHERE kind<>'commercials')",
    );
  if (input.mode === "files") {
    if (!input.recursive) {
      where.push("mytuner_child(p.relative_path,?) IS NULL");
      parameters.push(parent);
    }
    if (input.search) {
      where.push("instr(lower(mytuner_basename(p.relative_path)),lower(?))>0");
      parameters.push(input.search);
    }
    const predicate = where.join(" AND "),
      total = Number(
        store.db
          .prepare(
            `SELECT COUNT(*) AS n FROM catalog_projection_rows p WHERE ${predicate}`,
          )
          .get(...parameters)!.n,
      );
    const rows = store.db
      .prepare(
        `SELECT p.media_id,p.source_id,p.relative_path,json_extract(p.data_json,'$.title') AS title FROM catalog_projection_rows p WHERE ${predicate} ORDER BY p.relative_path,p.media_id LIMIT ? OFFSET ?`,
      )
      .all(...parameters, input.limit, input.offset);
    return {
      items: rows.map((row) => ({
        id: String(row.media_id),
        sourceId: String(row.source_id),
        path: String(row.relative_path),
        label: String(row.title),
        kind: "file" as const,
        count: 1,
      })),
      total,
      hasMore: input.offset + rows.length < total,
      offset: input.offset,
      limit: input.limit,
      revision: scope.revision,
    };
  }
  const key = input.recursive ? "d.value" : "mytuner_child(p.relative_path,?)",
    join = input.recursive
      ? " JOIN json_each(mytuner_directories(p.relative_path,?)) d"
      : "";
  const base = `SELECT p.source_id,${key} AS directory FROM catalog_projection_rows p${join} WHERE ${where.join(" AND ")}`;
  const sql = `WITH directories AS (${base}) SELECT source_id,directory,COUNT(*) AS n FROM directories WHERE directory IS NOT NULL AND instr(lower(mytuner_basename(directory)),lower(?))>0 GROUP BY source_id,directory`;
  const args = [parent, ...parameters, input.search],
    total = Number(
      store.db.prepare(`SELECT COUNT(*) AS n FROM(${sql})`).get(...args)!.n,
    );
  const rows = store.db
    .prepare(
      `${sql} ORDER BY directory COLLATE NOCASE,directory,source_id LIMIT ? OFFSET ?`,
    )
    .all(...args, input.limit, input.offset);
  return {
    items: rows.map((row) => ({
      id: input.sourceId
        ? String(row.directory)
        : `${row.source_id}:${row.directory}`,
      sourceId: String(row.source_id),
      path: String(row.directory),
      label: posix.basename(String(row.directory)),
      kind: "folder" as const,
      count: Number(row.n),
    })),
    total,
    hasMore: input.offset + rows.length < total,
    offset: input.offset,
    limit: input.limit,
    revision: scope.revision,
  };
}
