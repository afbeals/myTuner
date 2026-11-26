import { access, stat, statfs } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { applicationVersion } from "./version.js";

interface Check {
  name: string;
  status: "passed" | "warning" | "failed";
  message: string;
}
export async function diagnose(options: {
  dataRoot: string;
  generatedRoot: string;
  cacheRoot: string;
  port: number;
  fetcher?: typeof fetch;
}) {
  const checks: Check[] = [];
  const directories = [];
  for (const [name, path] of [
    ["data", options.dataRoot],
    ["generated", options.generatedRoot],
    ["cache", options.cacheRoot],
  ] as const) {
    try {
      const info = await stat(path);
      if (!info.isDirectory()) throw Error("not-directory");
      await access(path, constants.R_OK | constants.W_OK | constants.X_OK);
      const space = await statfs(path);
      const freeBytes = Number(space.bavail) * Number(space.bsize);
      directories.push({ name, path, freeBytes, uid: info.uid, gid: info.gid });
      checks.push({
        name: `${name}-storage`,
        status: freeBytes > 0 ? "passed" : "failed",
        message:
          freeBytes > 0
            ? "Directory is accessible with read/write permission; no write was attempted."
            : "Filesystem reports no allocatable free space.",
      });
    } catch {
      checks.push({
        name: `${name}-storage`,
        status: "failed",
        message:
          "Directory is missing, inaccessible, not a directory, or its free space could not be read.",
      });
    }
  }
  try {
    const response = await (options.fetcher ?? fetch)(
      `http://127.0.0.1:${options.port}/api/health`,
      { signal: AbortSignal.timeout(5000), redirect: "error" },
    );
    const body = (await response.json()) as {
      status?: string;
      version?: string;
    };
    checks.push({
      name: "internal-health",
      status: response.ok && body.status === "ok" ? "passed" : "failed",
      message:
        response.ok && body.status === "ok"
          ? `Application health responded${body.version ? ` (${body.version})` : ""}.`
          : "Application health did not report ready.",
    });
  } catch {
    checks.push({
      name: "internal-health",
      status: "failed",
      message:
        "Local application health could not be read within five seconds.",
    });
  }
  const database = await stat(resolve(options.dataRoot, "mytuner.db")).catch(
    () => null,
  );
  checks.push({
    name: "database-file",
    status: database?.isFile() ? "passed" : "warning",
    message: database?.isFile()
      ? `Database exists (${database.size} bytes); it was not opened or modified.`
      : "Expected database file was not found; confirm the configured data mount.",
  });
  return {
    mode: "read-only",
    version: applicationVersion,
    generatedAt: new Date().toISOString(),
    runtime: {
      uid: process.getuid?.() ?? null,
      gid: process.getgid?.() ?? null,
    },
    directories,
    checks,
    status: checks.some((c) => c.status === "failed")
      ? "failed"
      : checks.some((c) => c.status === "warning")
        ? "warning"
        : "passed",
    limitations: [
      "No source directory was traversed and no write probe or SQLite connection was opened.",
      "Access checks do not prove an actual write will succeed; Unraid share/pool allocation and minimum-free-space rules still apply.",
      "Internal health does not prove host port publication, LAN/TV reachability, mount read-only mode, Docker lifecycle, backup restore, or HDD performance.",
    ],
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const port = Number(process.env.PORT ?? 8777);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("Invalid PORT");
  const report = await diagnose({
    dataRoot: resolve(process.env.MYTUNER_DATA_DIR ?? ".data"),
    generatedRoot: resolve(
      process.env.MYTUNER_GENERATED_DIR ?? ".data/generated",
    ),
    cacheRoot: resolve(process.env.MYTUNER_CACHE_DIR ?? ".data/cache"),
    port,
  });
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (report.status === "failed") process.exitCode = 1;
}
