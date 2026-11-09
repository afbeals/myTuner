import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Cross-platform packaging scripts intentionally run as plain Node modules.
import {
  createRunner,
  mount,
  requireAccepted,
  inspectCandidate,
  cleanupOwned,
  sanitize,
  sourceDigest,
  // @ts-expect-error The JavaScript CLI has no TypeScript declarations.
} from "../scripts/docker-support.mjs";
// @ts-expect-error The JavaScript CLI has no TypeScript declarations.
import { main } from "../scripts/docker.mjs";
const imageId = `sha256:${"a".repeat(64)}`;
const inspected = {
  Id: imageId,
  Os: "linux",
  Architecture: "amd64",
  Config: {
    User: "node",
    Labels: { "org.opencontainers.image.version": "0.2.0" },
  },
};
const candidate = { imageId, version: "0.2.0", platform: "linux/amd64" };
async function fixture(t: { after: (f: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "mytuner docker spaces "));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of ["src", "web", "scripts"]) await mkdir(join(root, dir));
  for (const name of [
    ".dockerignore",
    "Dockerfile",
    "package-lock.json",
    "tsconfig.json",
    "tsconfig.build.json",
    "src/server.ts",
    "web/main.ts",
    "scripts/docker.mjs",
    "scripts/docker-support.mjs",
    "scripts/docker-acceptance.mjs",
    "scripts/container-fixture.mjs",
  ])
    await writeFile(join(root, name), name);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ version: "0.2.0" }),
  );
  return root;
}
test("Docker invocation preserves argument boundaries, never invokes a shell, and bounds output", async () => {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: () => void;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  const args = [
    "run",
    "--mount",
    mount("bind", "C:\\My Projects\\myTuner", "/input", true),
    "a;echo $secret",
  ];
  const run = createRunner({
    cwd: "C:\\My Projects",
    env: { PATH: "synthetic" },
    spawnProcess(
      executable: string,
      actual: string[],
      options: { shell: boolean; cwd: string; env: object },
    ) {
      assert.equal(executable, "docker");
      assert.deepEqual(actual, args);
      assert.equal(options.shell, false);
      assert.equal(options.cwd, "C:\\My Projects");
      assert.deepEqual(options.env, { PATH: "synthetic" });
      queueMicrotask(() => {
        child.stdout.write("x".repeat(200000));
        child.emit("close", 0);
      });
      return child;
    },
  });
  assert.equal((await run(args)).stdout.length, 128000);
  assert.throws(() => mount("bind", "C:\\comma,folder", "/input"), /commas/);
});
test("Docker timeout and cancellation terminate processes and propagate failure", async () => {
  const signals: string[] = [];
  const run = createRunner({
    spawnProcess() {
      const child = new EventEmitter() as EventEmitter & {
        stdout: PassThrough;
        stderr: PassThrough;
        kill: (signal: string) => void;
      };
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = (signal) => {
        signals.push(signal);
        queueMicrotask(() => child.emit("close", null));
      };
      return child;
    },
  });
  await assert.rejects(run(["version"], { timeoutMs: 10 }), /timed out/);
  const controller = new AbortController();
  const pending = run(["run"], { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /interrupted/);
  assert.deepEqual(signals, ["SIGTERM", "SIGTERM"]);
  await assert.rejects(
    run(["run"], { signal: controller.signal }),
    /interrupted/,
  );
});
test("Docker artifacts require non-root amd64 images and exact accepted source/image identity", async () => {
  const run = async () => ({ code: 0, stdout: JSON.stringify([inspected]) });
  assert.deepEqual(
    await inspectCandidate(run, "candidate", "0.2.0"),
    candidate,
  );
  for (const delta of [
    { Architecture: "arm64" },
    { Config: { ...inspected.Config, User: "root" } },
    { Config: { ...inspected.Config, Labels: {} } },
  ])
    await assert.rejects(
      inspectCandidate(
        async () => ({ stdout: JSON.stringify([{ ...inspected, ...delta }]) }),
        "candidate",
        "0.2.0",
      ),
    );
  const accepted = { ...candidate, sourceDigest: "source", status: "passed" };
  assert.doesNotThrow(() => requireAccepted(accepted, candidate, "source"));
  for (const changed of [
    null,
    { ...accepted, status: "failed" },
    { ...accepted, imageId: "old" },
  ])
    assert.throws(
      () => requireAccepted(changed, candidate, "source"),
      /acceptance/,
    );
  assert.throws(
    () => requireAccepted(accepted, candidate, "changed"),
    /changed/,
  );
  assert.equal(
    sanitize("Bearer secret https://private/path key", ["key"]),
    "Bearer [redacted] [url] [redacted]",
  );
});
test("cleanup removes only invocation-owned resources, ignores absent containers, and reports failures", async () => {
  const calls: string[][] = [];
  await cleanupOwned(
    async (args: string[]) => {
      calls.push(args);
      return {
        code: args[1] === "rm" && args[0] === "container" ? 1 : 0,
        stderr: "No such container",
      };
    },
    ["owned-a", "owned-b"],
    ["owned-v"],
  );
  assert.deepEqual(calls, [
    ["container", "rm", "--force", "owned-b"],
    ["container", "rm", "--force", "owned-a"],
    ["volume", "rm", "owned-v"],
  ]);
  await assert.rejects(
    cleanupOwned(async () => ({ code: 1, stderr: "busy" }), [], ["owned-v"]),
    /owned-v/,
  );
});
test("image promotion refuses untested, changed-source and stale-latest images before any push", async (t) => {
  const root = await fixture(t);
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    return {
      code: 0,
      stdout: JSON.stringify([
        {
          ...inspected,
          Config: {
            ...inspected.Config,
            Labels: {
              ...inspected.Config.Labels,
              "tv.mytuner.source-digest": await sourceDigest(root),
            },
          },
          ...(args.at(-1)?.endsWith(":latest")
            ? { Id: `sha256:${"b".repeat(64)}` }
            : {}),
        },
      ]),
    };
  };
  await assert.rejects(main("push", { root, run }), /acceptance/);
  assert.equal(
    calls.some((c) => c[0] === "push"),
    false,
  );
  const digest = await sourceDigest(root);
  await writeFile(
    join(root, "artifacts/docker/accepted.json"),
    JSON.stringify({ ...candidate, sourceDigest: digest, status: "passed" }),
  );
  await assert.rejects(main("push", { root, run }), /latest differs/);
  assert.equal(
    calls.some((c) => c[0] === "push"),
    false,
  );
  await main("tag", { root, run });
  assert.deepEqual(calls.at(-1), ["tag", imageId, "afbeals/mytuner:latest"]);
  await writeFile(join(root, "src/server.ts"), "changed");
  await assert.rejects(main("tag", { root, run }), /changed/);
});
test("build uses amd64 and package version and invalidates prior acceptance even on failure", async (t) => {
  const root = await fixture(t);
  await mkdir(join(root, "artifacts/docker"), { recursive: true });
  const accepted = join(root, "artifacts/docker/accepted.json");
  await writeFile(accepted, "old");
  const calls: string[][] = [];
  await assert.rejects(
    main("build", {
      root,
      run: async (args: string[]) => {
        calls.push(args);
        if (args[0] === "buildx" && args[1] === "build")
          throw Error("build failed");
        return { stdout: "" };
      },
    }),
    /build failed/,
  );
  await assert.rejects(readFile(accepted));
  assert.deepEqual(calls.at(-1), [
    "buildx",
    "build",
    "--platform",
    "linux/amd64",
    "--load",
    "--label",
    `tv.mytuner.source-digest=${await sourceDigest(root)}`,
    "--build-arg",
    "APP_VERSION=0.2.0",
    "-t",
    "afbeals/mytuner:0.2.0",
    ".",
  ]);
});

test("acceptance cleans all newly named volumes when preparation fails, without touching existing storage", async () => {
  // @ts-expect-error The portable harness is a JavaScript module.
  const { acceptance } = await import("../scripts/docker-acceptance.mjs");
  const calls: string[][] = [];
  await assert.rejects(
    acceptance(
      async (args: string[]) => {
        calls.push(args);
        if (args[0] === "run") throw Error("synthetic preparation failed");
        return { code: 0, stdout: "", stderr: "" };
      },
      { root: "/path with spaces", candidate, report: { gates: [] } },
    ),
    /preparation failed/,
  );
  const created = calls
    .filter((c) => c[0] === "volume" && c[1] === "create")
    .map((c) => c.at(-1));
  const removed = calls
    .filter((c) => c[0] === "volume" && c[1] === "rm")
    .map((c) => c.at(-1));
  assert.equal(created.length, 4);
  assert.deepEqual(removed, [...created].reverse());
  assert.ok(created.every((n) => /^mytuner-accept-[a-f\d]{16}-/.test(n!)));
  assert.ok(
    calls
      .filter((c) => c[0] === "container")
      .every((c) => /^mytuner-accept-/.test(c.at(-1)!)),
  );
  assert.equal(
    calls.some((c) => c.includes("docker-data") || c.includes("prune")),
    false,
  );
});

test("cleanup attempts the remaining resources after a Docker process rejection", async () => {
  const calls: string[][] = [];
  await assert.rejects(
    cleanupOwned(
      async (args: string[]) => {
        calls.push(args);
        if (args.at(-1) === "first") throw Error("daemon unavailable");
        return { code: 0, stderr: "" };
      },
      ["second", "first"],
      ["volume"],
    ),
    /first/,
  );
  assert.deepEqual(
    calls.map((c) => c.at(-1)),
    ["first", "second", "volume"],
  );
});
