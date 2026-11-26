import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diagnose } from "../src/diagnose.js";

test("read-only diagnostics inspect only application directories and health without modifying database bytes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-diagnose-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataRoot = join(root, "data"),
    generatedRoot = join(root, "generated"),
    cacheRoot = join(root, "cache");
  await Promise.all([dataRoot, generatedRoot, cacheRoot].map((p) => mkdir(p)));
  await writeFile(
    join(dataRoot, "mytuner.db"),
    "synthetic database bytes; must never open SQLite",
  );
  const before = await readdir(dataRoot);
  const report = await diagnose({
    dataRoot,
    generatedRoot,
    cacheRoot,
    port: 8777,
    fetcher: (async (url, init) => {
      assert.equal(String(url), "http://127.0.0.1:8777/api/health");
      assert.equal(init?.redirect, "error");
      return Response.json({ status: "ok", version: "synthetic" });
    }) as typeof fetch,
  });
  assert.equal(report.status, "passed");
  assert.equal(report.mode, "read-only");
  assert.deepEqual(await readdir(dataRoot), before);
  assert.equal(
    await readFile(join(dataRoot, "mytuner.db"), "utf8"),
    "synthetic database bytes; must never open SQLite",
  );
  assert.equal(report.checks.length, 5);
});
test("diagnostics report inaccessible storage and health failure without exposing transport details", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-diagnose-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const report = await diagnose({
    dataRoot: join(root, "absent"),
    generatedRoot: root,
    cacheRoot: root,
    port: 8777,
    fetcher: (async () => {
      throw Error("secret-url-detail");
    }) as typeof fetch,
  });
  assert.equal(report.status, "failed");
  assert.doesNotMatch(JSON.stringify(report), /secret-url-detail/);
  assert.equal(
    report.checks.find((c) => c.name === "database-file")?.status,
    "warning",
  );
});
