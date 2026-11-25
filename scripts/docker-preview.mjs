import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { mount, cleanupOwned } from "./docker-support.mjs";

export async function preview(
  run,
  { root, candidate, signal, port = 8877, log = console.log },
) {
  port = Number(port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("MYTUNER_PREVIEW_PORT must be an integer from 1 to 65535");
  const prefix = `mytuner-preview-${randomBytes(8).toString("hex")}`;
  const containers = [];
  const volumes = [
    ["mytuner-preview-source", "/fixtures"],
    ["mytuner-preview-data", "/app/data"],
    ["mytuner-preview-generated", "/generated"],
    ["mytuner-preview-cache", "/cache"],
  ];
  for (const [name] of volumes) {
    let existing = await run(["volume", "inspect", name], {
      allowFailure: true,
      signal,
    });
    if (existing.code !== 0) {
      if (!/No such volume/i.test(existing.stderr))
        throw Error(
          `Cannot inspect preview volume ${name}: ${existing.stderr}`,
        );
      await run(["volume", "create", "--label", "tv.mytuner.preview=1", name], {
        signal,
      });
      existing = await run(["volume", "inspect", name], { signal });
    }
    if (JSON.parse(existing.stdout)[0]?.Labels?.["tv.mytuner.preview"] !== "1")
      throw Error(
        `Refusing to use ${name}: it is not a myTuner preview volume`,
      );
  }
  const mounts = (readonly) =>
    volumes.flatMap(([name, path]) => [
      "--mount",
      mount("volume", name, path, readonly && path === "/fixtures"),
    ]);
  const server = `${prefix}-server`;
  try {
    const prepare = `${prefix}-prepare`;
    containers.push(prepare);
    await run(
      [
        "run",
        "--rm",
        "--name",
        prepare,
        "--network",
        "none",
        "--user",
        "0:0",
        "-e",
        "MYTUNER_ACCEPTANCE_DISPOSABLE=1",
        ...mounts(false),
        "--mount",
        mount(
          "bind",
          resolve(root, "scripts/container-fixture.mjs"),
          "/acceptance.mjs",
          true,
        ),
        "--entrypoint",
        "node",
        candidate.imageId,
        "/acceptance.mjs",
        "preview-prepare",
      ],
      { signal, label: "Preview synthetic storage preparation" },
    );
    const bootstrap = `${prefix}-bootstrap`;
    containers.push(bootstrap);
    const account = await run(
      [
        "run",
        "--rm",
        "--name",
        bootstrap,
        "--network",
        "none",
        ...mounts(true),
        "-e",
        "MYTUNER_ADMIN_PASSWORD=synthetic-preview-password",
        "--entrypoint",
        "node",
        candidate.imageId,
        "dist/bootstrap.js",
        "preview",
      ],
      { signal, allowFailure: true, label: "Preview administrator setup" },
    );
    if (
      account.code !== 0 &&
      !/An administrator already exists/.test(account.stderr)
    )
      throw Error(`Preview administrator setup failed: ${account.stderr}`);
    log(`Preview: http://127.0.0.1:${port}/`);
    if (account.code === 0)
      log("First-run sign-in: preview / synthetic-preview-password");
    else log("Using existing preview accounts and data.");
    log(
      "Synthetic videos: /fixtures. Preview volumes persist after Ctrl+C; household media is not mounted.",
    );
    containers.push(server);
    try {
      await run(
        [
          "run",
          "--rm",
          "--init",
          "--name",
          server,
          "--label",
          "tv.mytuner.preview=1",
          "-p",
          `127.0.0.1:${port}:8777`,
          ...mounts(true),
          candidate.imageId,
        ],
        { signal, timeoutMs: 0, progress: true, label: "Interactive preview" },
      );
    } catch (error) {
      if (!signal?.aborted) throw error;
    }
  } finally {
    if (containers.includes(server))
      await run(["stop", "--time", "20", server], {
        allowFailure: true,
        timeoutMs: 30000,
      });
    await cleanupOwned(run, containers, []);
  }
}
