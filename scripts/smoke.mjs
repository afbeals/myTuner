import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
const root = await mkdtemp(join(tmpdir(), "mytuner-compiled-smoke-"));
const probe = createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const password = "synthetic-smoke-password",
  env = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    MYTUNER_DATA_DIR: join(root, "data"),
    MYTUNER_GENERATED_DIR: join(root, "generated"),
    MYTUNER_CACHE_DIR: join(root, "cache"),
    MYTUNER_ADMIN_PASSWORD: password,
  },
  base = `http://127.0.0.1:${port}`;
let server;
function processTask(file, args = []) {
  const child = spawn(process.execPath, [file, ...args], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (data) => {
    stdout = (stdout + data).slice(-8000);
  });
  child.stderr.on("data", (data) => {
    stderr = (stderr + data).slice(-8000);
  });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) =>
      resolve({ code, signal, stdout, stderr }),
    );
  });
  return { child, done };
}
async function run(file, args = []) {
  const task = processTask(file, args);
  const timer = setTimeout(() => task.child.kill("SIGKILL"), 10000);
  try {
    const result = await task.done;
    assert.equal(result.code, 0, `${file} failed: ${result.stderr}`);
    return result.stdout.trim();
  } finally {
    clearTimeout(timer);
  }
}
async function start() {
  server = processTask("dist/main.js");
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if (
        (
          await fetch(base + "/api/health", {
            signal: AbortSignal.timeout(500),
          })
        ).status === 200
      )
        return;
    } catch {}
    if (server.child.exitCode !== null) {
      const result = await server.done;
      throw Error(`Server exited during smoke: ${result.stderr}`);
    }
    await delay(50);
  }
  throw Error("Server startup timed out");
}
async function stop() {
  if (!server) return;
  const active = server;
  server = undefined;
  active.child.kill("SIGTERM");
  const timer = setTimeout(() => active.child.kill("SIGKILL"), 5000);
  try {
    const result = await active.done;
    assert.equal(result.code, 0, "Graceful shutdown failed");
  } finally {
    clearTimeout(timer);
  }
}
try {
  await run("dist/bootstrap.js", ["smoke_admin"]);
  await start();
  assert.equal((await fetch(base + "/api/sources")).status, 401);
  const response = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "smoke_admin", password }),
  });
  assert.equal(response.status, 200);
  const { token } = await response.json();
  const headers = { Authorization: `Bearer ${token}` };
  assert.equal((await fetch(base + "/api/accounts", { headers })).status, 200);
  const second = processTask("dist/main.js"),
    locked = await second.done;
  assert.notEqual(locked.code, 0);
  assert.match(locked.stderr, /in use/);
  const snapshot = await run("dist/backup-cli.js");
  assert.equal(
    JSON.parse(await readFile(join(snapshot, "manifest.json"), "utf8")).format,
    1,
  );
  await stop();
  await run("dist/restore-cli.js", [snapshot]);
  await start();
  assert.equal((await fetch(base + "/api/auth/me", { headers })).status, 401);
  await stop();
  console.log(
    "Compiled smoke passed: bootstrap, health/auth, single-owner lock, online backup, restore/session revocation, restart and graceful shutdown.",
  );
} finally {
  if (server) {
    server.child.kill("SIGKILL");
    await server.done;
  }
  await rm(root, { recursive: true, force: true });
}
