import { randomUUID } from "node:crypto";
import { Store } from "../src/database.js";
import type { Account, Channel, Media, Source } from "../src/domain.js";
export function account(
  store: Store,
  role: Account["role"] = "editor",
): Account {
  const row = { id: randomUUID(), username: randomUUID(), role, disabled: 0 };
  store.db
    .prepare(
      "INSERT INTO accounts(id,username,password_hash,role,created_at) VALUES(?,?,'test',?,0)",
    )
    .run(row.id, row.username, role);
  return row;
}
export function profile(store: Store, owner: Account): string {
  const id = randomUUID();
  store.db
    .prepare(
      "INSERT INTO profiles(id,name,kind,owner_account_id) VALUES(?,'Profile','person',?)",
    )
    .run(id, owner.id);
  return id;
}
export function source(
  store: Store,
  root = "/example",
  kind: Source["kind"] = "videos",
): Source {
  const row = {
    id: randomUUID(),
    name: "Source",
    root_path: root,
    kind,
    recursive: 1,
  };
  store.db
    .prepare(
      "INSERT INTO sources(id,name,root_path,kind,recursive) VALUES(?,?,?,?,1)",
    )
    .run(row.id, row.name, root, kind);
  return row;
}
export function media(
  store: Store,
  sourceId: string,
  path = "video.mp4",
  durationMs = 1000,
): Media {
  const row = {
    id: randomUUID(),
    source_id: sourceId,
    relative_path: path,
    title: path,
    duration_ms: durationMs,
    size: 10,
    mtime_ms: 0,
    available: 1,
    metadata_json: "{}",
  };
  store.db
    .prepare(
      "INSERT INTO media(id,source_id,relative_path,title,duration_ms,size,mtime_ms) VALUES(?,?,?,?,?,?,?)",
    )
    .run(row.id, sourceId, path, path, durationMs, 10, 0);
  return row;
}
export function channel(
  store: Store,
  owner: Account,
  visibility: Channel["visibility"] = "private",
): Channel {
  const row = {
    id: randomUUID(),
    name: "Same name",
    owner_account_id: owner.id,
    visibility,
  };
  store.db
    .prepare(
      "INSERT INTO channels(id,name,owner_account_id,visibility) VALUES(?,?,?,?)",
    )
    .run(row.id, row.name, owner.id, visibility);
  return row;
}
