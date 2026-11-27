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
  checkVersion,
  compareVersions,
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
  for (const dir of ["src", "web", "scripts", "docs"])
    await mkdir(join(root, dir));
  for (const name of [
    ".dockerignore",
    "Dockerfile",
    "tsconfig.json",
    "tsconfig.build.json",
    "src/server.ts",
    "web/main.ts",
    "scripts/docker.mjs",
    "scripts/docker-support.mjs",
    "scripts/docker-acceptance.mjs",
    "scripts/container-fixture.mjs",
    "scripts/docker-preview.mjs",
    "docs/UNRAID_DOCKER_TAB.md",
    "docs/TV_INSTALLATION.md",
    "docs/OPERATIONS.md",
    "docs/WINDOWS_DOCKER.md",
  ])
    await writeFile(join(root, name), name);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ version: "0.2.0" }),
  );
  await writeFile(
    join(root, "package-lock.json"),
    JSON.stringify({
      version: "0.2.0",
      packages: { "": { version: "0.2.0" } },
    }),
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
  await assert.rejects(
    run(["version"], { timeoutMs: 10, label: "Backup verification" }),
    /Backup verification timed out after 10ms/,
  );
  const controller = new AbortController();
  const pending = run(["run"], {
    signal: controller.signal,
    label: "Backup verification",
  });
  controller.abort();
  await assert.rejects(pending, /^Error: Backup verification interrupted$/);
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
test("bundled Help changes invalidate image publication while unrelated research stays outside acceptance", async (t) => {
  for (const guide of [
    "UNRAID_DOCKER_TAB.md",
    "TV_INSTALLATION.md",
    "OPERATIONS.md",
    "WINDOWS_DOCKER.md",
  ]) {
    await t.test(guide, async (t) => {
      const root = await fixture(t);
      const calls: string[][] = [];
      const acceptedDigest = await sourceDigest(root);
      let imageDigest = acceptedDigest;
      const run = async (args: string[]) => {
        calls.push(args);
        if (args[0] === "version")
          return { code: 0, stdout: JSON.stringify({ Version: "synthetic" }) };
        if (args[0] === "compose")
          return { code: 0, stdout: "synthetic-compose" };
        if (args[0] === "image")
          return {
            code: 0,
            stdout: JSON.stringify([
              {
                ...inspected,
                Config: {
                  ...inspected.Config,
                  Labels: {
                    ...inspected.Config.Labels,
                    "tv.mytuner.source-digest": imageDigest,
                  },
                },
              },
            ]),
          };
        return { code: 0, stdout: "", stderr: "" };
      };
      const options = { root, run, log: () => {}, accept: async () => {} };
      await main("test", options);
      const acceptedPath = join(root, "artifacts/docker/accepted.json");
      const accepted = JSON.parse(await readFile(acceptedPath, "utf8"));
      assert.equal(accepted.status, "passed");
      assert.equal(accepted.sourceDigest, acceptedDigest);

      await writeFile(join(root, "docs/research.md"), "Unbundled research");
      assert.equal(await sourceDigest(root), acceptedDigest);
      await main("tag", options);
      await main("push", options);
      assert.equal(calls.filter((args) => args[0] === "tag").length, 1);
      assert.equal(calls.filter((args) => args[0] === "push").length, 2);

      calls.length = 0;
      await writeFile(join(root, "docs", guide), "Updated bundled Help");
      const changedDigest = await sourceDigest(root);
      assert.notEqual(changedDigest, acceptedDigest);
      for (const command of ["tag", "push"])
        await assert.rejects(main(command, options), /different source/);

      imageDigest = changedDigest;
      for (const command of ["tag", "push"])
        await assert.rejects(main(command, options), /acceptance/);
      assert.equal(
        calls.some((args) => ["tag", "push"].includes(args[0]!)),
        false,
      );
      assert.deepEqual(
        JSON.parse(await readFile(acceptedPath, "utf8")),
        accepted,
      );
    });
  }
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

test("Docker help and invalid commands never invoke Docker or create artifacts", async (t) => {
  const root = await fixture(t),
    messages: string[] = [];
  const options = {
    root,
    log: (s: string) => messages.push(s),
    run: async () => {
      throw Error("Docker must not run for help");
    },
  };
  await main(undefined, options);
  await main("help", options);
  await assert.rejects(main("unknown", options), /docker:help/);
  assert.match(messages[0]!, /release.*Build, test, tag, then push/);
  assert.match(messages[0]!, /afbeals\/mytuner:0.2.0/);
  await assert.rejects(readFile(join(root, "artifacts/docker/accepted.json")), {
    code: "ENOENT",
  });
});

test("release versions require valid SemVer and consistent package and lockfile roots before Docker runs", async (t) => {
  const root = await fixture(t);
  assert.equal(await checkVersion(root), "0.2.0");
  for (const version of ["0.2", "01.2.3", "1.2.3-01", "1.2.3\n", "latest"]) {
    await writeFile(join(root, "package.json"), JSON.stringify({ version }));
    await assert.rejects(checkVersion(root), /SemVer/);
  }
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ version: "0.2.0" }),
  );
  await writeFile(
    join(root, "package-lock.json"),
    JSON.stringify({
      version: "0.2.0",
      packages: { "": { version: "0.2.1" } },
    }),
  );
  let calls = 0;
  await assert.rejects(
    main("release", {
      root,
      run: async () => {
        calls++;
      },
    }),
    /versions must match/,
  );
  assert.equal(calls, 0);
  await assert.rejects(readFile(join(root, "artifacts/docker/accepted.json")), {
    code: "ENOENT",
  });
});

test("release version comparison orders numeric and prerelease versions correctly", () => {
  for (const [a, b, result] of [
    ["0.2.1", "0.2.0", 1],
    ["1.0.10", "1.0.9", 1],
    ["1.0.0", "1.0.0-rc.1", 1],
    ["1.0.0-rc.2", "1.0.0-rc.10", -1],
    ["1.0.0-alpha", "1.0.0-alpha.1", -1],
    ["1.0.0+build.2", "1.0.0+build.1", 0],
  ] as const)
    assert.equal(compareVersions(a, b), result);
});

for (const fails of [false, true])
  test(`release ${fails ? "stops without promotion after failed acceptance" : "publishes the one tested build without rebuilding"}`, async (t) => {
    const root = await fixture(t),
      calls: string[][] = [],
      logs: string[] = [];
    let tested = false,
      latest = `sha256:${"b".repeat(64)}`;
    const run = async (args: string[]) => {
      calls.push(args);
      if (args[0] === "version")
        return { code: 0, stdout: JSON.stringify({ Version: "synthetic" }) };
      if (args[0] === "compose")
        return { code: 0, stdout: "synthetic-compose" };
      if (args[0] === "image")
        return {
          code: 0,
          stdout: JSON.stringify([
            {
              ...inspected,
              Id: args.at(-1)?.endsWith(":latest") ? latest : imageId,
              Config: {
                ...inspected.Config,
                Labels: {
                  ...inspected.Config.Labels,
                  "tv.mytuner.source-digest": await sourceDigest(root),
                },
              },
            },
          ]),
        };
      if (args[0] === "tag") latest = args[1]!;
      if (args[0] === "push") {
        assert.equal(tested, true);
        assert.equal(latest, imageId);
        const report = JSON.parse(
          await readFile(join(root, "artifacts/docker/accepted.json"), "utf8"),
        );
        assert.equal(report.imageId, imageId);
        assert.equal(report.sourceDigest, await sourceDigest(root));
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    const options = {
      root,
      run,
      log: (s: string) => logs.push(s),
      accept: async () => {
        if (fails) throw Error("synthetic acceptance rejected");
        tested = true;
      },
    };
    if (fails) {
      await assert.rejects(main("release", options), /acceptance rejected/);
      assert.equal(
        calls.some((args) => ["tag", "push"].includes(args[0]!)),
        false,
      );
      await assert.rejects(
        readFile(join(root, "artifacts/docker/accepted.json")),
        { code: "ENOENT" },
      );
    } else {
      await main("release", options);
      assert.deepEqual(
        calls.filter((args) => args[0] === "push"),
        [
          ["push", "afbeals/mytuner:0.2.0"],
          ["push", "afbeals/mytuner:latest"],
        ],
      );
      assert.match(logs.at(-1)!, /Release 0.2.0 complete/);
    }
    assert.equal(
      calls.filter((args) => args[0] === "buildx" && args[1] === "build")
        .length,
      1,
    );
  });

test("live Docker progress redacts secrets split across chunks while retaining parseable captured output", async () => {
  const lines: string[] = [];
  const run = createRunner({
    secrets: ["synthetic-password"],
    onProgress: (s: string) => lines.push(s),
    spawnProcess() {
      const child = new EventEmitter() as EventEmitter & {
        stdout: PassThrough;
        stderr: PassThrough;
        kill: () => void;
      };
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => {};
      queueMicrotask(() => {
        child.stdout.write("Build stage 1\nBearer pri");
        child.stdout.write("vate-token\n");
        child.stderr.write("synthetic-pass");
        child.stderr.write("word https://private.example/path\n");
        child.emit("close", 0);
      });
      return child;
    },
  });
  const result = await run(["buildx", "build"], { progress: true });
  assert.match(lines.join(""), /Build stage 1/);
  assert.match(lines.join(""), /Bearer \[redacted\]/);
  for (const value of [
    "private-token",
    "synthetic-password",
    "private.example",
  ])
    assert.equal(lines.join("").includes(value), false);
  assert.match(result.stdout, /Build stage 1/);
});

test("interactive preview reuses only labeled synthetic volumes, binds loopback and preserves data on cancellation", async () => {
  // @ts-expect-error Portable packaging module is exercised directly.
  const { preview } = await import("../scripts/docker-preview.mjs");
  const calls: string[][] = [],
    messages: string[] = [],
    controller = new AbortController();
  const run = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "volume" && args[1] === "inspect")
      return {
        code: 0,
        stdout: JSON.stringify([{ Labels: { "tv.mytuner.preview": "1" } }]),
        stderr: "",
      };
    if (args[0] === "run" && args.includes("--init")) {
      controller.abort();
      throw Error("Interactive preview interrupted");
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  await preview(run, {
    root: "/synthetic/project",
    candidate,
    signal: controller.signal,
    port: 8877,
    log: (s: string) => messages.push(s),
  });
  const server = calls.find(
    (args) => args[0] === "run" && args.includes("--init"),
  )!;
  assert.ok(server.includes("127.0.0.1:8877:8777"));
  assert.equal(server.at(-1), imageId);
  assert.ok(
    server.includes(
      "type=volume,source=mytuner-preview-source,target=/fixtures,readonly",
    ),
  );
  assert.ok(calls.some((args) => args[0] === "stop"));
  assert.ok(calls.some((args) => args[0] === "container" && args[1] === "rm"));
  assert.equal(
    calls.some((args) => args[0] === "volume" && args[1] === "rm"),
    false,
  );
  assert.match(messages.join("\n"), /127.0.0.1:8877/);
});

test("preview rejects unrelated volumes and invalid ports before creating or mounting containers", async () => {
  // @ts-expect-error Portable packaging module is exercised directly.
  const { preview } = await import("../scripts/docker-preview.mjs");
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    return { code: 0, stdout: JSON.stringify([{ Labels: {} }]), stderr: "" };
  };
  await assert.rejects(
    preview(run, { root: "/synthetic", candidate, port: 0 }),
    /PREVIEW_PORT/,
  );
  assert.equal(calls.length, 0);
  await assert.rejects(
    preview(run, { root: "/synthetic", candidate }),
    /not a myTuner preview volume/,
  );
  assert.equal(
    calls.some((args) => args[0] === "run"),
    false,
  );
});

test("optional Buildx cache settings preserve literal argument boundaries and never bypass candidate verification", async (t) => {
  const root = await fixture(t),
    calls: string[][] = [];
  const cacheFrom = "type=local,src=/synthetic/cache with spaces",
    cacheTo = "type=local,dest=/synthetic/next with spaces,mode=max";
  await assert.rejects(
    main("build", {
      root,
      cacheFrom,
      cacheTo,
      log: () => {},
      run: async (args: string[]) => {
        calls.push(args);
        if (args[0] === "image" && args[1] === "inspect")
          throw Error("candidate verification reached");
        return { stdout: "" };
      },
    }),
    /candidate verification reached/,
  );
  const build = calls.find(
    (args) => args[0] === "buildx" && args[1] === "build",
  )!;
  assert.equal(build[build.indexOf("--cache-from") + 1], cacheFrom);
  assert.equal(build[build.indexOf("--cache-to") + 1], cacheTo);
  assert.equal(build[build.indexOf("--platform") + 1], "linux/amd64");
  assert.equal(
    calls.some((args) => args[0] === "push"),
    false,
  );
});
