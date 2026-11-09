import { currentRoute } from "./pairing-link.js";
export interface ResourceTarget {
  kind: "channel" | "collection";
  profileId: string;
  id: string;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function readResourceRoute(
  hash = location.hash,
): ResourceTarget | "invalid" | null {
  const page = currentRoute(hash),
    query = new URLSearchParams(hash.split("?")[1] ?? "");
  if (
    !query.has("profile") &&
    !query.has("channel") &&
    !query.has("collection")
  )
    return null;
  const kind =
    page === "channels" ? "channel" : page === "library" ? "collection" : null;
  const profileId = query.get("profile") ?? "",
    id = kind ? (query.get(kind) ?? "") : "";
  if (
    !kind ||
    !uuid.test(profileId) ||
    !uuid.test(id) ||
    query.getAll("profile").length !== 1 ||
    query.getAll(kind).length !== 1 ||
    [...query.keys()].some((key) => key !== "profile" && key !== kind)
  )
    return "invalid";
  return { kind, profileId, id };
}
export function resourceLink(
  kind: ResourceTarget["kind"],
  profileId: string,
  id: string,
) {
  if (!uuid.test(profileId) || !uuid.test(id))
    throw new Error("Invalid resource reference");
  return `#${kind === "channel" ? "channels" : "library"}?profile=${profileId}&${kind}=${id}`;
}
