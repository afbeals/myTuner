export function currentRoute(hash = location.hash) {
  return hash.slice(1).split("?")[0] || "channels";
}
export function pairingPrefill(hash = location.hash): string {
  if (currentRoute(hash) !== "connect-tv") return "";
  const query = new URLSearchParams(hash.split("?")[1] ?? ""),
    code = query.get("code") ?? "";
  return /^[A-Fa-f0-9]{10}$/.test(code) ? code.toUpperCase() : "";
}
