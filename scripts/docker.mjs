import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  createRunner,
  inspectCandidate,
  requireAccepted,
  sourceDigest,
  repository,
  sanitize,
  checkVersion,
} from "./docker-support.mjs";
import { acceptance } from "./docker-acceptance.mjs";
import { preview } from "./docker-preview.mjs";

export async function main(action, options = {}) {
  const {
    root = fileURLToPath(new URL("../", import.meta.url)),
    run = createRunner({ cwd: root }),
    signal,
    baseRef,
    cacheFrom = process.env.MYTUNER_BUILD_CACHE_FROM,
    cacheTo = process.env.MYTUNER_BUILD_CACHE_TO,
    accept = acceptance,
    showPreview = preview,
    log = console.log,
    previewPort = process.env.MYTUNER_PREVIEW_PORT ?? 8877,
  } = options;
  const { version: displayVersion } = JSON.parse(
    await readFile(resolve(root, "package.json"), "utf8"),
  );
  if (!action || ["help", "--help", "-h"].includes(action)) {
    log(`myTuner Docker commands (${displayVersion})

Usage: npm run docker -- <command>

  build    Build/load the versioned linux/amd64 image
  test     Run automated acceptance with disposable volumes
  tag      Tag the exact accepted image as latest
  push     Publish accepted version and latest to Docker Hub
  release  Build, test, tag, then push; stop on any failure
  preview  Run locally at 127.0.0.1:8877 with persistent synthetic data
  check    Validate version/lockfile; --base REF also requires an increase

Image: ${repository}:${displayVersion}
Requirements: Node >=24.13.0 <25; Docker Linux engine; Buildx; Compose for test/release.
Docker authentication is required for push/release. Preview port: MYTUNER_PREVIEW_PORT.
Optional Buildx caches: MYTUNER_BUILD_CACHE_FROM and MYTUNER_BUILD_CACHE_TO.
Example: npm run docker:release
Help: npm run docker:help`);
    return;
  }
  if (
    !["build", "test", "tag", "push", "release", "preview", "check"].includes(
      action,
    )
  )
    throw Error("Unknown Docker command. Run npm run docker:help");
  if (baseRef !== undefined && action !== "check")
    throw Error("--base is supported only with check");
  const version = await checkVersion(root, baseRef);
  if (action === "check") {
    log(
      `Version ${version}: package and lockfile match${baseRef ? `; newer than ${baseRef}` : ""}.`,
    );
    return;
  }
  const tag = `${repository}:${version}`,
    artifacts = resolve(root, "artifacts/docker"),
    acceptedPath = resolve(artifacts, "accepted.json");
  const nextOptions = {
    root,
    run,
    signal,
    accept,
    showPreview,
    log,
    previewPort,
    cacheFrom,
    cacheTo,
  };
  if (action === "release") {
    for (const step of ["build", "test", "tag", "push"]) {
      signal?.throwIfAborted();
      log(`Release ${version}: ${step}`);
      await main(step, nextOptions);
    }
    log(`Release ${version} complete.`);
    return;
  }
  if (action === "preview") {
    const candidate = await inspectCandidate(
      run,
      tag,
      version,
      await sourceDigest(root),
    );
    await showPreview(run, { root, candidate, signal, port: previewPort, log });
    return;
  }
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
        ...(cacheFrom ? ["--cache-from", cacheFrom] : []),
        ...(cacheTo ? ["--cache-to", cacheTo] : []),
        "-t",
        tag,
        ".",
      ],
      {
        signal,
        timeoutMs: 1200000,
        progress: true,
        label: "Docker image build",
      },
    );
    const candidate = await inspectCandidate(
      run,
      tag,
      version,
      await sourceDigest(root),
    );
    log(`Built ${tag} (${candidate.imageId}). Run npm run docker:test next.`);
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
      await accept(run, {
        root,
        candidate: report,
        signal,
        report,
        onProgress: log,
      });
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
      log(`Docker acceptance ${report.status}: ${reportPath}`);
    }
    return;
  }
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
  if (action === "tag") {
    await run(["tag", candidate.imageId, `${repository}:latest`], { signal });
    log(`Tagged ${candidate.imageId} as ${repository}:latest.`);
  } else {
    const latest = await inspectCandidate(run, `${repository}:latest`, version);
    if (latest.imageId !== candidate.imageId)
      throw Error(
        "latest differs from the tested version. Run docker:tag first.",
      );
    await run(["push", tag], {
      signal,
      timeoutMs: 1200000,
      progress: true,
      label: `Publish ${tag}`,
    });
    await run(["push", `${repository}:latest`], {
      signal,
      timeoutMs: 1200000,
      progress: true,
      label: "Publish latest",
    });
    log(`Published ${tag} and ${repository}:latest.
Image: ${candidate.imageId}
Pull this version on Unraid and recreate the container using its existing mounts.`);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const controller = new AbortController(),
    interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    const { values, positionals } = parseArgs({
      options: {
        help: { type: "boolean", short: "h" },
        base: { type: "string" },
      },
      allowPositionals: true,
    });
    if (positionals.length > 1)
      throw Error("Choose one Docker command; run npm run docker:help");
    await main(values.help ? "help" : positionals[0], {
      signal: controller.signal,
      baseRef: values.base,
    });
  } catch (e) {
    console.error(sanitize(e.message));
    process.exitCode = controller.signal.aborted ? 130 : 1;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}
