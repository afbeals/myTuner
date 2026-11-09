import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/database.js";
import { createServer } from "../src/server.js";
test("browser assets are same-origin, cannot replace API routes and carry a restrictive CSP", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-static-")),
    store = new Store(":memory:");
  await writeFile(
    join(root, "index.html"),
    "<!doctype html><title>myTuner fixture</title>",
  );
  const app = createServer(store, { webRoot: root });
  t.after(async () => {
    await app.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const index = await app.inject({ url: "/" });
  assert.equal(index.statusCode, 200);
  assert.match(index.body, /myTuner fixture/);
  assert.match(
    String(index.headers["content-security-policy"]),
    /script-src 'self'/,
  );
  assert.match(
    String(index.headers["content-security-policy"]),
    /frame-ancestors 'none'/,
  );
  const unknown = await app.inject({ url: "/api/missing" });
  assert.equal(unknown.statusCode, 404);
  assert.doesNotMatch(unknown.body, /doctype/);
  assert.equal((await app.inject({ url: "/api/sources" })).statusCode, 401);
  assert.equal((await app.inject({ url: "/../package.json" })).statusCode, 404);
});
