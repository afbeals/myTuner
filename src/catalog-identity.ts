import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { Media } from "./domain.js";
export function showKey(item: Media): string {
  const data = JSON.parse(item.metadata_json);
  if (data.seriesId !== undefined) return `series:${data.seriesId}`;
  if (data.seriesTitle?.trim())
    return `local:${createHash("sha256").update(data.seriesTitle.normalize("NFKC").trim().toLocaleLowerCase()).digest("hex").slice(0, 24)}`;
  return `folder:${posix.dirname(item.relative_path).replace(/(?:^|\/)Season[ ._-]*\d+$/i, "")}`;
}
