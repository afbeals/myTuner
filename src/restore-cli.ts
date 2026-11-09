import { resolve } from "node:path";
import { restoreApplication, recoverInterruptedRestore } from "./recovery.js";
const root = resolve(process.env.MYTUNER_DATA_DIR ?? ".data"),
  input = process.argv[2];
if (!input)
  throw Error(
    "Usage: npm run db:restore -- /path/to/snapshot-directory (or --recover)",
  );
if (input === "--recover") await recoverInterruptedRestore(root);
else await restoreApplication(root, resolve(input));
console.log(
  "Restore complete. Sessions were revoked; sign in again. Source and generated files were not changed.",
);
