import type { Account, Profile } from "./types";

export function canManageProfile(account: Account, profile?: Profile): boolean {
  return (
    account.role === "admin" ||
    (account.role === "editor" &&
      Boolean(
        profile && (profile.canManage ?? profile.ownerAccountId === account.id),
      ))
  );
}
