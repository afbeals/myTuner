import type { Account } from "./domain.js";
import { invariant } from "./domain.js";
import { verifySecret } from "./security.js";
import {
  resetRequestSchema,
  planReset,
  applyResetTransaction,
} from "./reset-data.js";
import type { ResetRequest } from "./reset-data.js";
import {
  openOfflineReset,
  createVerifiedResetBackup,
  assertVerifiedResetBackupCurrent,
} from "./reset-backup.js";
import type { OfflineResetContext } from "./reset-backup.js";

export async function authenticateResetAdministrator(
  context: OfflineResetContext,
  id: string,
  password: string,
): Promise<Account> {
  invariant(
    password.length > 0 && password.length <= 1024,
    401,
    "Administrator password confirmation is required",
  );
  context.assertSqliteSafe();
  const before = context.db
    .prepare("SELECT * FROM accounts WHERE id=?")
    .get(id);
  const valid = await verifySecret(
    password,
    String(
      before?.password_hash ?? `scrypt:${"0".repeat(32)}:${"0".repeat(128)}`,
    ),
  );
  context.assertSqliteSafe();
  const current = context.db
    .prepare("SELECT * FROM accounts WHERE id=?")
    .get(id);
  invariant(
    before &&
      current &&
      valid &&
      current.role === "admin" &&
      current.disabled === 0 &&
      current.password_hash === before.password_hash,
    401,
    "Administrator identity or password was not confirmed",
  );
  await context.assertCurrent();
  return {
    id: String(current.id),
    username: String(current.username),
    role: "admin",
    disabled: 0,
  };
}
export async function previewOfflineReset(
  dataRoot: string,
  input: ResetRequest,
  password: string,
) {
  const request = resetRequestSchema.parse(input),
    context = await openOfflineReset(dataRoot);
  try {
    const actor = await authenticateResetAdministrator(
      context,
      request.retainedAdminId,
      password,
    );
    context.assertSqliteSafe();
    return planReset({ db: context.db }, actor, request, true);
  } finally {
    await context.close();
  }
}
export async function executeOfflineReset(
  options: {
    dataRoot: string;
    request: ResetRequest;
    password: string;
    revision: string;
    confirmation: string;
  },
  observed?: {
    backupCreated?: (
      backup: Awaited<ReturnType<typeof createVerifiedResetBackup>>,
    ) => Promise<void> | void;
  },
) {
  const request = resetRequestSchema.parse(options.request);
  invariant(
    /^[a-f0-9]{64}$/.test(options.revision),
    400,
    "Supply the full revision printed by a fresh offline preview",
  );
  const context = await openOfflineReset(options.dataRoot);
  try {
    const actor = await authenticateResetAdministrator(
      context,
      request.retainedAdminId,
      options.password,
    );
    context.assertSqliteSafe();
    const plan = planReset({ db: context.db }, actor, request, true);
    invariant(
      plan.revision === options.revision,
      409,
      "Database changed since the offline preview. Review a new preview; no reset was applied.",
    );
    invariant(
      options.confirmation === plan.confirmationText,
      400,
      "Typed reset confirmation did not match the retained administrator",
    );
    const backup = await createVerifiedResetBackup(context);
    await observed?.backupCreated?.(backup);
    await context.assertCurrent();
    const transaction = <T>(work: () => T): T => {
      context.assertSqliteSafe();
      assertVerifiedResetBackupCurrent(backup);
      context.db.exec("BEGIN IMMEDIATE");
      try {
        const result = work();
        context.db.exec("COMMIT");
        return result;
      } catch (error) {
        context.db.exec("ROLLBACK");
        throw error;
      }
    };
    const result = applyResetTransaction(
      { db: context.db, transaction },
      actor,
      request,
      options.revision,
      context.protectedRoots,
    );
    return { reset: true, ...result, backup, instructions: plan.instructions };
  } finally {
    await context.close();
  }
}
