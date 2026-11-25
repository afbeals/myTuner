import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";

export const repository = "afbeals/mytuner";
export function mount(type, source, target, readonly = false) {
  // Docker's --mount has its own CSV grammar, independent of shell quoting.
  if ([source, target].some((v) => /[,\r\n\0]/.test(v)))
    throw Error("Docker mount paths cannot contain commas or line breaks.");
  return `type=${type},source=${source},target=${target}${readonly ? ",readonly" : ""}`;
}
export function sanitize(value, secrets = []) {
  let text = String(value);
  for (const secret of secrets)
    if (secret) text = text.split(secret).join("[redacted]");
  return text
    .replace(/(Bearer\s+)[\w.+/=-]+/gi, "$1[redacted]")
    .replace(/https?:\/\/[^\s"<>]+/gi, "[url]");
}
export function createRunner({
  cwd,
  executable = "docker",
  env = process.env,
  secrets = [],
  spawnProcess = spawn,
  onProgress = (line) => process.stderr.write(line),
} = {}) {
  return (
    args,
    {
      timeoutMs = 60000,
      signal,
      allowFailure = false,
      label = `Docker ${args[0]}`,
      progress = false,
    } = {},
  ) =>
    new Promise((resolveTask, reject) => {
      if (signal?.aborted) return reject(Error(`${label} interrupted`));
      const child = spawnProcess(executable, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "",
        stderr = "",
        interrupted,
        force;
      const stop = (reason) => {
        if (interrupted) return;
        interrupted = reason;
        child.kill("SIGTERM");
        force ??= setTimeout(() => child.kill("SIGKILL"), 1500);
      };
      const pendingLines = { stdout: "", stderr: "" };
      const show = (kind, chunk) => {
        if (!progress) return;
        const lines = (pendingLines[kind] + String(chunk)).split(/\r\n|[\r\n]/);
        pendingLines[kind] = lines.pop().slice(-128000);
        for (const line of lines) onProgress(sanitize(line, secrets) + "\n");
      };
      child.stdout.on("data", (chunk) => {
        stdout = (stdout + chunk).slice(-128000);
        show("stdout", chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-128000);
        show("stderr", chunk);
      });
      const abort = () => stop("interrupted");
      const timer =
        timeoutMs > 0
          ? setTimeout(() => stop("timed out"), timeoutMs)
          : undefined;
      signal?.addEventListener("abort", abort, { once: true });
      const clear = () => {
        clearTimeout(timer);
        clearTimeout(force);
        signal?.removeEventListener("abort", abort);
      };
      child.once("error", (error) => {
        clear();
        reject(
          Error(
            `Docker could not start (${error.code ?? "unknown"}); check the daemon and executable.`,
          ),
        );
      });
      child.once("close", (code) => {
        clear();
        if (progress)
          for (const line of Object.values(pendingLines))
            if (line) onProgress(sanitize(line, secrets) + "\n");
        const result = {
          code,
          stdout: sanitize(stdout, secrets).trim(),
          stderr: sanitize(stderr, secrets).trim(),
        };
        if (interrupted)
          reject(
            Error(
              `${label} ${interrupted}${interrupted === "timed out" ? ` after ${timeoutMs}ms` : ""}`,
            ),
          );
        else if (code !== 0 && !allowFailure)
          reject(
            Error(`${label} failed (${code}): ${result.stderr.slice(-3000)}`),
          );
        else resolveTask(result);
      });
    });
}
export async function sourceDigest(root) {
  const hash = createHash("sha256");
  async function add(relative) {
    const path = resolve(root, relative);
    const content = await readFile(path);
    hash
      .update(relative.replaceAll("\\", "/") + "\0")
      .update(content)
      .update("\0");
  }
  async function visit(relative) {
    for (const e of (
      await readdir(resolve(root, relative), { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const path = join(relative, e.name);
      if (e.isDirectory()) await visit(path);
      else if (e.isFile()) await add(path);
      else throw Error("Build context must not contain symbolic links");
    }
  }
  for (const path of [
    ".dockerignore",
    "Dockerfile",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "tsconfig.build.json",
    "scripts/docker.mjs",
    "scripts/docker-support.mjs",
    "scripts/docker-acceptance.mjs",
    "scripts/container-fixture.mjs",
    "scripts/docker-preview.mjs",
  ])
    await add(path);
  await visit("src");
  await visit("web");
  return hash.digest("hex");
}
export async function inspectCandidate(run, tag, version, expectedDigest) {
  const result = await run(["image", "inspect", tag]);
  const image = JSON.parse(result.stdout)[0];
  if (image.Os !== "linux" || image.Architecture !== "amd64")
    throw Error("Candidate must be linux/amd64");
  if (image.Config?.Labels?.["org.opencontainers.image.version"] !== version)
    throw Error("Image version differs from package.json");
  if (!["node", "1000", "1000:1000"].includes(image.Config?.User))
    throw Error("Candidate must run as the non-root node user");
  if (
    expectedDigest &&
    image.Config?.Labels?.["tv.mytuner.source-digest"] !== expectedDigest
  )
    throw Error(
      "Image was built from different source. Run docker:build again.",
    );
  if (!/^sha256:[a-f\d]{64}$/.test(image.Id))
    throw Error("Invalid Docker image identity");
  return { imageId: image.Id, version, platform: "linux/amd64" };
}
export function requireAccepted(accepted, candidate, digest) {
  if (
    accepted?.status !== "passed" ||
    accepted.imageId !== candidate.imageId ||
    accepted.sourceDigest !== digest ||
    accepted.version !== candidate.version
  )
    throw Error(
      "Image or source changed, or acceptance is missing. Run docker:test successfully for this exact candidate first.",
    );
}
export async function cleanupOwned(run, containers, volumes) {
  const failures = [];
  for (const [names, kind] of [
    [containers, "container"],
    [volumes, "volume"],
  ]) {
    for (const name of [...names].reverse()) {
      try {
        const result = await run(
          [kind, "rm", ...(kind === "container" ? ["--force"] : []), name],
          { allowFailure: true, timeoutMs: 10000 },
        );
        if (
          result.code !== 0 &&
          !new RegExp(`No such ${kind}`, "i").test(result.stderr)
        )
          failures.push(name);
      } catch {
        failures.push(name);
      }
    }
  }
  if (failures.length)
    throw Error(
      `Could not clean up owned test resources: ${failures.join(", ")}`,
    );
}

function parsedVersion(value) {
  const match =
    typeof value === "string" &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      value,
    );
  if (
    !match ||
    match[0] !== value ||
    match[4]?.split(".").some((part) => /^0\d+$/.test(part))
  )
    throw Error("package.json must contain a valid SemVer version");
  return {
    core: match.slice(1, 4).map(BigInt),
    prerelease: match[4]?.split(".") ?? [],
  };
}
export function compareVersions(left, right) {
  const a = parsedVersion(left),
    b = parsedVersion(right);
  for (let i = 0; i < 3; i++)
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  if (!a.prerelease.length || !b.prerelease.length)
    return Number(!a.prerelease.length) - Number(!b.prerelease.length);
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i],
      y = b.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x),
      ny = /^\d+$/.test(y);
    if (nx && ny) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (nx !== ny) return nx ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}
export async function checkVersion(root, baseRef) {
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  parsedVersion(pkg.version);
  const lock = JSON.parse(
    await readFile(resolve(root, "package-lock.json"), "utf8"),
  );
  if (
    lock.version !== pkg.version ||
    lock.packages?.[""]?.version !== pkg.version
  )
    throw Error(
      "package.json and both root package-lock.json versions must match",
    );
  if (baseRef !== undefined) {
    if (!baseRef || baseRef.startsWith("-"))
      throw Error("Choose a valid Git base ref");
    const result = await promisify(execFile)(
      "git",
      ["show", `${baseRef}:package.json`],
      { cwd: root, timeout: 10000 },
    );
    const base = JSON.parse(result.stdout);
    if (compareVersions(pkg.version, base.version) <= 0)
      throw Error(
        `Bump package.json.version above ${base.version} before releasing this change`,
      );
  }
  return pkg.version;
}
