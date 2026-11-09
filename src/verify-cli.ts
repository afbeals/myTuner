import { resolve } from "node:path";
import { verifyApplicationBackup } from "./recovery.js";
const args = process.argv.slice(2),
  json = args.includes("--json"),
  input = args.find((a) => a !== "--json");
const controller = new AbortController();
const interrupt = () => controller.abort();
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
try {
  if (!input)
    throw Error("Usage: npm run db:verify -- /snapshot-directory [--json]");
  const result = await verifyApplicationBackup(
    resolve(input),
    controller.signal,
  );
  console.log(
    json
      ? JSON.stringify(result)
      : `Backup valid. Schema ${result.sourceSchemaVersion} → ${result.checkedSchemaVersion}; validator ${result.validatorVersion}; checked ${result.checkedAt}. SHA-256 ${result.fingerprint}. This does not verify media mounts or physical devices.`,
  );
} catch (error) {
  const status = controller.signal.aborted
    ? "interrupted"
    : error instanceof Error &&
        /Unsupported backup (schema|format)/.test(error.message)
      ? "unsupported"
      : "invalid";
  console.error(
    json
      ? JSON.stringify({ status })
      : `Backup verification ${status}. Check bundle integrity, supported schema and matching integration key. No live data was changed.`,
  );
  process.exitCode = controller.signal.aborted ? 130 : 1;
} finally {
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
