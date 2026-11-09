import { acquireDataLock } from "./runtime-lock.js";
import { assertNoPendingRestore } from "./recovery.js";
import { resolve } from "node:path";
import { Store } from "./database.js";
import { createAccount } from "./security.js";

const username = process.argv[2],
  password = process.env.MYTUNER_ADMIN_PASSWORD;
if (!username || !password)
  throw new Error(
    "Usage: set MYTUNER_ADMIN_PASSWORD, then npm run admin:create -- <username>",
  );
const root = resolve(process.env.MYTUNER_DATA_DIR ?? ".data");
const release = await acquireDataLock(root);
await assertNoPendingRestore(root);
const store = new Store(
  resolve(process.env.MYTUNER_DATA_DIR ?? ".data", "mytuner.db"),
);
try {
  if (store.db.prepare("SELECT id FROM accounts WHERE role='admin'").get())
    throw new Error(
      "An administrator already exists; use the authenticated account API",
    );
  const account = await createAccount(store, username, password, "admin");
  console.log(`Created administrator ${account.username}`);
} finally {
  store.close();
  await release();
}
