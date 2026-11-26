import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test(
  "Unraid inspection script never mutates Docker or starts a stopped container",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "mytuner-unraid-check-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const log = join(root, "commands.jsonl"),
      fake = join(root, "docker");
    await writeFile(
      fake,
      `#!${process.execPath}
import fs from "node:fs";
const args=process.argv.slice(2);fs.appendFileSync(process.env.MYTUNER_TEST_DOCKER_LOG,JSON.stringify(args)+"\\n");
if(args[0]==="inspect" && args.at(-1)==="{{.State.Running}}")console.log(process.env.MYTUNER_TEST_RUNNING??"false");
else if(args[0]==="inspect")console.log("Synthetic container inspection");
else if(args[0]==="ps")console.log("Synthetic uptimes");
else if(args[0]==="exec")console.log("Synthetic read-only probe");
else if(args[0]!=="port")process.exitCode=1;
`,
    );
    // The fixture is a local script invoking the already-installed Node binary.
    // No executable is downloaded or installed.
    await chmod(fake, 0o755);
    const script = resolve("scripts/unraid-check.sh");
    for (const running of ["false", "true"]) {
      await writeFile(log, "");
      const { stdout } = await promisify(execFile)(
        "bash",
        [script, "MyTuner"],
        {
          env: {
            ...process.env,
            PATH: root + ":" + process.env.PATH,
            MYTUNER_TEST_DOCKER_LOG: log,
            MYTUNER_TEST_RUNNING: running,
          },
        },
      );
      const calls = (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]);
      assert.ok(
        calls.every((args) =>
          ["inspect", "port", "ps", "exec"].includes(args[0]!),
        ),
      );
      if (running === "false") {
        assert.doesNotMatch(JSON.stringify(calls), /"exec"/);
        assert.match(stdout, /Nothing was started/);
      } else
        assert.ok(
          calls.some(
            (args) =>
              args[0] === "exec" && args.includes("/app/dist/diagnose.js"),
          ),
        );
      assert.match(stdout, /No published ports/);
    }
  },
);
