import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { backupApplication } from "./recovery.js";
const root = resolve(process.env.MYTUNER_DATA_DIR ?? ".data"),
  db = new DatabaseSync(resolve(root, "mytuner.db"), { readOnly: true });
try {
  console.log(await backupApplication(db, root));
} finally {
  db.close();
}
