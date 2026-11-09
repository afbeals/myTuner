import type { Store } from "./database.js";
import type { Account, Media } from "./domain.js";
import { invariant } from "./domain.js";
import type { Selection } from "./contracts.js";
import type { Capabilities } from "./playback-policy.js";
import { playbackDecision } from "./playback-policy.js";
import { selectMedia } from "./library.js";
import { requireAdmin, requireProfile, visibleChannel } from "./security.js";

export function playbackReadiness(
  store: Store,
  account: Account,
  input: {
    profileId: string;
    selection?: Selection | undefined;
    channelId?: string | undefined;
    capabilities: Capabilities;
    offset: number;
    limit: number;
  },
  now = Date.now(),
) {
  requireAdmin(account);
  requireProfile(store, account, input.profileId);
  let truncated = false;
  let items: {
    item: Media;
    interval?: {
      kind: string;
      startMs: number;
      endMs: number;
      offsetMs: number;
    };
  }[];
  if (input.channelId) {
    visibleChannel(store, account, input.channelId);
    const rows = store.db
      .prepare(
        `SELECT m.*,e.kind,e.start_ms,e.end_ms,e.offset_ms,e.source_size,e.source_mtime_ms FROM schedule_entries e JOIN active_schedules a ON a.revision_id=e.revision_id JOIN media m ON m.id=e.media_id WHERE e.channel_id=? AND e.end_ms>? ORDER BY e.start_ms LIMIT 5001`,
      )
      .all(input.channelId, now);
    truncated = rows.length > 5000;
    items = rows.slice(0, 5000).map((row) => ({
      item: {
        ...row,
        available:
          row.available === 1 &&
          row.size === row.source_size &&
          row.mtime_ms === row.source_mtime_ms
            ? 1
            : 0,
      } as unknown as Media,
      interval: {
        kind: String(row.kind),
        startMs: Number(row.start_ms),
        endMs: Number(row.end_ms),
        offsetMs: Number(row.offset_ms),
      },
    }));
  } else {
    invariant(input.selection, 400, "Choose a selection or channel");
    const selected = selectMedia(
      store,
      account,
      input.profileId,
      input.selection,
    );
    truncated = selected.length > 5000;
    items = selected.slice(0, 5000).map((item) => ({ item }));
  }
  const analyzed = items.map(({ item, interval }) => ({
    id: item.id,
    title: item.title,
    available: Boolean(item.available),
    ...playbackDecision(item, input.capabilities, interval),
  }));
  return {
    checkedMs: now,
    basis: "stored-scan-metadata",
    scope: input.channelId
      ? "upcoming-materialized-intervals"
      : "selected-files",
    analyzed: analyzed.length,
    truncated,
    counts: {
      direct: analyzed.filter((i) => i.status === "direct").length,
      hls: analyzed.filter((i) => i.status === "hls").length,
      unknown: analyzed.filter((i) => i.status === "unknown").length,
      unavailable: analyzed.filter((i) => !i.available).length,
      unsupportedCaptionTracks: analyzed.reduce(
        (n, i) => n + i.subtitles.filter((s) => !s.supported).length,
        0,
      ),
    },
    offset: input.offset,
    limit: input.limit,
    items: analyzed.slice(input.offset, input.offset + input.limit),
    note: "Predicted routing from stored metadata and declared capabilities. This does not certify codec profiles, bitrate, HDR, firmware or a physical TV. No scan, session, conversion or generation was started.",
  };
}
