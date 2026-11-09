import { spawn } from "node:child_process";
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
} = {}) {
  return (args, { timeoutMs = 60000, signal, allowFailure = false } = {}) =>
    new Promise((resolveTask, reject) => {
      if (signal?.aborted) return reject(Error("Docker operation interrupted"));
      const child = spawnProcess(executable, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "",
        stderr = "",
        interrupted = false,
        force;
      const stop = () => {
        interrupted = true;
        child.kill("SIGTERM");
        force ??= setTimeout(() => child.kill("SIGKILL"), 1500);
      };
      child.stdout.on("data", (chunk) => {
        stdout = (stdout + chunk).slice(-128000);
      });
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-128000);
      });
      const timer = setTimeout(stop, timeoutMs);
      signal?.addEventListener("abort", stop, { once: true });
      const clear = () => {
        clearTimeout(timer);
        clearTimeout(force);
        signal?.removeEventListener("abort", stop);
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
        const result = {
          code,
          stdout: sanitize(stdout, secrets).trim(),
          stderr: sanitize(stderr, secrets).trim(),
        };
        if (interrupted)
          reject(Error("Docker operation timed out or was interrupted"));
        else if (code !== 0 && !allowFailure)
          reject(
            Error(
              `Docker ${args[0]} failed (${code}): ${result.stderr.slice(-3000)}`,
            ),
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
