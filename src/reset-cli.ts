import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { z } from "zod";
import { resetRequestSchema } from "./reset-data.js";
import { previewOfflineReset, executeOfflineReset } from "./reset-offline.js";

const values = new Map<string, string>();
let apply = false,
  help = false;
try {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--apply") {
      if (apply) throw Error("Duplicate --apply");
      apply = true;
    } else if (arg === "--help") help = true;
    else {
      if (
        !["--admin-id", "--mode", "--categories", "--revision"].includes(arg) ||
        values.has(arg) ||
        !args[index + 1] ||
        args[index + 1]!.startsWith("--")
      )
        throw Error("Unknown, duplicate or incomplete reset argument");
      values.set(arg, args[++index]!);
    }
  }
  if (help)
    console.log(
      "Stop myTuner first. node dist/reset-cli.js --admin-id UUID --mode selective --categories metadata,custom [--apply --revision OFFLINE_SHA256]\nFresh start: --mode fresh (omit categories). The configured MYTUNER_DATA_DIR supplies the fixed mytuner.db path. Password and final confirmation are read privately from stdin, never arguments. Every apply requires a new verified backup. No files are deleted.",
    );
  else {
    const request = resetRequestSchema.parse({
      mode: values.get("--mode"),
      categories: values.has("--categories")
        ? values.get("--categories")!.split(",")
        : [],
      retainedAdminId: values.get("--admin-id"),
    });
    if (apply)
      z.string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(values.get("--revision"));
    else if (values.has("--revision"))
      throw Error("A preview does not accept --revision");
    const dataRoot = resolve(process.env.MYTUNER_DATA_DIR ?? ".data");
    let secret = false;
    const output = new Writable({
      write(chunk, _encoding, done) {
        if (!secret) process.stderr.write(chunk);
        done();
      },
    });
    const input = createInterface({
      input: process.stdin,
      output,
      terminal: Boolean(process.stdin.isTTY),
    });
    const lines = input[Symbol.asyncIterator]();
    const read = async (prompt: string, hidden = false) => {
      process.stderr.write(prompt);
      secret = hidden;
      const result = await lines.next();
      secret = false;
      if (hidden) process.stderr.write("\n");
      if (result.done) throw Error("Reset input ended before confirmation");
      return result.value;
    };
    try {
      const password = await read(
        `Password for retained administrator ${request.retainedAdminId}: `,
        true,
      );
      const plan = await previewOfflineReset(dataRoot, request, password);
      console.log(JSON.stringify(plan, null, 2));
      if (apply) {
        if (plan.revision !== values.get("--revision"))
          throw Error(
            "Database changed since the offline preview. Review the printed plan and run its apply command with the new revision.",
          );
        const confirmation = await read(
          `Type exactly ${plan.confirmationText}: `,
        );
        const result = await executeOfflineReset(
          {
            dataRoot,
            request,
            password,
            revision: plan.revision,
            confirmation,
          },
          {
            backupCreated: (backup) => {
              process.stderr.write(
                `Verified recoverable backup retained at ${backup.directory}\n`,
              );
            },
          },
        );
        console.log(JSON.stringify(result, null, 2));
      }
    } finally {
      input.close();
    }
  }
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Reset failed; no success is claimed. Preserve any incomplete backup and review before retrying.",
  );
  process.exitCode = 1;
}
