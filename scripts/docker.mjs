import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  createRunner,
  inspectCandidate,
  requireAccepted,
  sourceDigest,
  repository,
  sanitize,
} from "./docker-support.mjs";
import { acceptance } from "./docker-acceptance.mjs";

export async function main(
  action,
  {
    root = fileURLToPath(new URL("../", import.meta.url)),
    run = createRunner({ cwd: root }),
    signal,
  } = {},
) {
  const { version } = JSON.parse(
    await readFile(resolve(root, "package.json"), "utf8"),
  );
  const tag = `${repository}:${version}`,
    artifacts = resolve(root, "artifacts/docker");
  const acceptedPath = resolve(artifacts, "accepted.json");
  await mkdir(artifacts, { recursive: true });
  if (action === "build") {
    await rm(acceptedPath, { force: true });
    const digest = await sourceDigest(root);
    await run(["buildx", "version"], { signal });
    await run(
      [
        "buildx",
        "build",
        "--platform",
        "linux/amd64",
        "--load",
        "--label",
        `tv.mytuner.source-digest=${digest}`,
        "--build-arg",
        `APP_VERSION=${version}`,
        "-t",
        tag,
        ".",
      ],
      { signal, timeoutMs: 1200000 },
    );
    const candidate = await inspectCandidate(
      run,
      tag,
      version,
      await sourceDigest(root),
    );
    console.log(
      `Built ${tag} (${candidate.imageId}). Run npm run docker:test next.`,
    );
    return;
  }
  if (action === "test") {
    await rm(acceptedPath, { force: true });
    const report = {
      status: "running",
      startedAt: new Date().toISOString(),
      gates: [],
    };
    const reportPath = resolve(artifacts, `acceptance-${Date.now()}.json`);
    try {
      const server = await run(["version", "--format", "{{json .Server}}"], {
        signal,
      });
      report.docker = JSON.parse(server.stdout).Version;
      report.compose = (
        await run(["compose", "version", "--short"], { signal })
      ).stdout;
      await run(["buildx", "version"], { signal });
      const digest = await sourceDigest(root);
      Object.assign(report, await inspectCandidate(run, tag, version, digest), {
        sourceDigest: digest,
      });
      await acceptance(run, { root, candidate: report, signal, report });
      const current = await inspectCandidate(run, tag, version);
      if (
        current.imageId !== report.imageId ||
        (await sourceDigest(root)) !== report.sourceDigest
      )
        throw Error("Candidate or source changed during acceptance");
      report.status = "passed";
      await writeFile(
        acceptedPath,
        JSON.stringify({ ...report, reportPath }, null, 2),
      );
    } catch (e) {
      report.status = "failed";
      report.error = sanitize(e.message);
      throw e;
    } finally {
      report.finishedAt = new Date().toISOString();
      await writeFile(reportPath, JSON.stringify(report, null, 2));
      console.log(`Docker acceptance ${report.status}: ${reportPath}`);
    }
    return;
  }
  if (action === "tag" || action === "push") {
    const candidate = await inspectCandidate(
      run,
      tag,
      version,
      await sourceDigest(root),
    );
    const accepted = await readFile(acceptedPath, "utf8")
      .then(JSON.parse)
      .catch(() => null);
    requireAccepted(accepted, candidate, await sourceDigest(root));
    if (action === "tag")
      await run(["tag", candidate.imageId, `${repository}:latest`], { signal });
    else {
      const latest = await inspectCandidate(
        run,
        `${repository}:latest`,
        version,
      );
      if (latest.imageId !== candidate.imageId)
        throw Error(
          "latest differs from the tested version. Run docker:tag first.",
        );
      await run(["push", tag], { signal, timeoutMs: 1200000 });
      await run(["push", `${repository}:latest`], {
        signal,
        timeoutMs: 1200000,
      });
    }
    return;
  }
  throw Error("Usage: node scripts/docker.mjs build|test|tag|push");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    await main(process.argv[2], { signal: controller.signal });
  } catch (e) {
    console.error(sanitize(e.message));
    process.exitCode = controller.signal.aborted ? 130 : 1;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}
