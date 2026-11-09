// Runs only in disposable acceptance containers. Never point these paths at real storage.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  stat,
  chown,
  unlink,
} from "node:fs/promises";
import { createHash } from "node:crypto";
assert.equal(process.env.MYTUNER_ACCEPTANCE_DISPOSABLE, "1");
const roots = ["/fixtures", "/app/data", "/generated", "/cache"];
const files = ["Pilot.S01E01.mp4", "Pilot.S01E01.nfo"];
async function hashes() {
  return Object.fromEntries(
    await Promise.all(
      files.map(async (name) => [
        name,
        createHash("sha256")
          .update(await readFile(`/fixtures/${name}`))
          .digest("hex"),
      ]),
    ),
  );
}
switch (process.argv[2]) {
  case "prepare": {
    assert.equal(
      process.getuid(),
      0,
      "Only synthetic volume initialization uses root",
    );
    for (const root of roots) await mkdir(root, { recursive: true });
    await writeFile(
      "/fixtures/captions.srt",
      "1\n00:00:00,000 --> 00:00:15,000\nSynthetic acceptance caption\n",
    );
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=160x90:rate=24",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000",
        "-i",
        "/fixtures/captions.srt",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-map",
        "2:s:0",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-c:s",
        "mov_text",
        "-t",
        "15",
        "/fixtures/Pilot.S01E01.mp4",
      ],
      { timeout: 30000 },
    );
    await unlink("/fixtures/captions.srt");
    await writeFile(
      "/fixtures/Pilot.S01E01.nfo",
      "<episodedetails><title>Synthetic pilot</title><showtitle>Acceptance</showtitle><season>1</season><episode>1</episode><plot>Read-only fixture</plot></episodedetails>",
    );
    for (const root of roots) await chown(root, 1000, 1000);
    for (const name of files) await chown(`/fixtures/${name}`, 1000, 1000);
    console.log(JSON.stringify(await hashes()));
    break;
  }
  case "audit": {
    assert.notEqual(process.getuid(), 0);
    await assert.rejects(
      writeFile("/fixtures/must-not-exist", "denied"),
      (e) => e.code === "EROFS",
    );
    console.log(JSON.stringify(await hashes()));
    break;
  }
  case "runtime": {
    assert.notEqual(process.getuid(), 0);
    const [major, minor] = process.versions.node.split(".").map(Number);
    assert.equal(major, 24);
    assert.ok(minor >= 13, "Node must satisfy >=24.13.0 <25");
    for (const name of [
      "main",
      "bootstrap",
      "backup-cli",
      "verify-cli",
      "restore-cli",
    ])
      await stat(`/app/dist/${name}.js`);
    await stat("/app/web-dist/index.html");
    assert.ok(
      (await readdir("/app/web-dist/assets")).some((n) => /\.woff2$/.test(n)),
      "Bundled local fonts",
    );
    const pkg = JSON.parse(await readFile("/app/package.json", "utf8"));
    for (const [flag, expression] of [
      ["-encoders", /libx264/],
      ["-encoders", /\baac\b/],
      ["-filters", /\bscale\b/],
      ["-demuxers", /\bmov,/],
    ]) {
      const listing = execFileSync("ffmpeg", ["-hide_banner", flag], {
        encoding: "utf8",
        timeout: 10000,
      });
      assert.match(listing, expression);
    }
    const node = execFileSync("node", ["--version"], {
      encoding: "utf8",
    }).trim();
    const ffmpeg = execFileSync("ffmpeg", ["-version"], {
      encoding: "utf8",
    }).split("\n")[0];
    console.log(
      JSON.stringify({
        version: pkg.version,
        node,
        ffmpeg,
        uid: process.getuid(),
      }),
    );
    break;
  }
  default:
    throw Error("Unknown fixture action");
}
