import { invariant } from "./domain.js";
export function pairingApprovalPath(userCode: string) {
  invariant(
    /^[A-Fa-f0-9]{10}$/.test(userCode),
    400,
    "Invalid TV connection code",
  );
  return `/#connect-tv?code=${userCode.toUpperCase()}`;
}
