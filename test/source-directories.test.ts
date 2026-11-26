import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../src/database.js";
import { sourceDirectories } from "../src/source-directories.js";
import { createServer } from "../src/server.js";
import { digest } from "../src/security.js";
import { account, source, media } from "./helpers.js";

test("catalog directory suggestions include ancestors, deduplicate files, page stably, and never inspect a nonexistent source root", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const admin = account(store, "admin"),
    src = source(store, "/does-not-exist"),
    hidden = source(store, "/private-other");
  store.transaction(() => {
    for (let i = 0; i < 120; i++) {
      const folder = `Category/Folder ${String(i).padStart(3, "0")}`;
      media(store, src.id, `${folder}/one.mp4`);
      media(store, src.id, `${folder}/two.mp4`);
    }
  });
  media(store, src.id, "root.mp4");
  media(store, hidden.id, "Secret/video.mp4");
  const missing = media(store, src.id, "Gone/video.mp4");
  store.db.prepare("UPDATE media SET available=0 WHERE id=?").run(missing.id);
  const read = (offset: number, search = "") =>
    sourceDirectories(store, admin, src.id, { offset, search, limit: 50 });
  const a = read(0),
    b = read(50),
    c = read(100);
  assert.equal(a.items.length, 50);
  assert.equal(b.items.length, 50);
  assert.equal(c.items.length, 21);
  assert.equal(a.hasMore, true);
  assert.equal(c.hasMore, false);
  assert.equal(new Set([...a.items, ...b.items, ...c.items]).size, 121);
  assert.equal(a.items[0], "Category");
  assert.doesNotMatch(
    JSON.stringify([a, b, c]),
    /Secret|Gone|one.mp4|root.mp4/,
  );
  assert.deepEqual(read(0, "folder 119").items, ["Category/Folder 119"]);
  assert.deepEqual(read(0, "%_").items, []);
  media(store, src.id, "New/child/file.mp4");
  assert.deepEqual(read(0, "New").items, ["New", "New/child"]);
  assert.throws(
    () =>
      sourceDirectories(store, account(store), src.id, {
        offset: 0,
        search: "",
        limit: 50,
      }),
    /Administrator/,
  );
});
test("directory HTTP responses enforce admin scope, source existence and bounded validated paging", async (t) => {
  const store = new Store(":memory:"),
    admin = account(store, "admin"),
    src = source(store);
  const app = createServer(store);
  t.after(async () => {
    await app.close();
    store.close();
  });
  media(store, src.id, "Show/Season 1/episode.mp4");
  const token = randomUUID();
  store.db
    .prepare(
      "INSERT INTO sessions(token_hash,account_id,expires_at) VALUES(?,?,?)",
    )
    .run(digest(token), admin.id, Date.now() + 60000);
  const headers = { authorization: `Bearer ${token}` },
    url = `/api/sources/${src.id}/directories`;
  assert.equal((await app.inject({ url })).statusCode, 401);
  const response = await app.inject({ url: url + "?limit=1", headers });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().items, ["Show"]);
  assert.equal(response.json().hasMore, true);
  assert.equal(
    (await app.inject({ url: url + "?limit=101", headers })).statusCode,
    400,
  );
  assert.equal(
    (await app.inject({ url: url + "?offset=-1", headers })).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        url: `/api/sources/${randomUUID()}/directories`,
        headers,
      })
    ).statusCode,
    404,
  );
  store.db
    .prepare("UPDATE accounts SET role='viewer' WHERE id=?")
    .run(admin.id);
  assert.equal((await app.inject({ url, headers })).statusCode, 403);
});
