import type { Store } from "./database.js";
import type { Media } from "./domain.js";
import { displayMedia } from "./display-metadata.js";
import { channelShortName } from "./channel-label.js";
// Keep database column names and upstream image URLs out of the client contract.
export function publicJson(
  value: unknown,
  profileId?: string,
  mediaId?: string,
  store?: Store,
): unknown {
  if (Array.isArray(value))
    return value.map((v) => publicJson(v, profileId, mediaId, store));
  if (!value || typeof value !== "object") return value;
  let row = value as Record<string, unknown>;
  if (
    store &&
    typeof row.id === "string" &&
    typeof row.metadata_json === "string"
  ) {
    const raw = store.db
      .prepare("SELECT * FROM media WHERE id=?")
      .get(row.id) as unknown as Media | undefined;
    if (raw) {
      const display = displayMedia(store, raw);
      row = {
        ...row,
        title: display.title,
        metadata_json: display.metadata_json,
      };
    }
  }
  const id =
    typeof row.id === "string" &&
    (row.metadata_json !== undefined || row.metadata !== undefined)
      ? row.id
      : mediaId;
  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(row)) {
    if (["password_hash", "encrypted_key", "csrf_hash"].includes(key)) continue;
    const name =
      key === "metadata_json"
        ? "metadata"
        : key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
    let item =
      key === "metadata_json" && typeof raw === "string"
        ? JSON.parse(raw)
        : raw;
    if (key === "images" && Array.isArray(item))
      item = item.map((image, index) => ({
        coverType:
          typeof image?.coverType === "string" ? image.coverType : "poster",
        index,
        ...(profileId && id
          ? { url: `/api/profiles/${profileId}/media/${id}/artwork/${index}` }
          : {}),
      }));
    if (
      typeof item === "number" &&
      ([
        "archived",
        "disabled",
        "recursive",
        "canManage",
        "pinProtected",
        "regenerate",
      ].includes(name) ||
        (name === "available" && row.metadata_json !== undefined))
    )
      item = Boolean(item);
    result[name] = publicJson(item, profileId, id, store);
  }
  if (
    typeof row.name === "string" &&
    ["shared", "private"].includes(String(row.visibility))
  ) {
    const override =
      typeof row.short_name === "string"
        ? row.short_name
        : typeof row.shortNameOverride === "string"
          ? row.shortNameOverride
          : null;
    result.shortName = channelShortName(row.name, override);
    result.shortNameOverride = override;
  }
  return result;
}
