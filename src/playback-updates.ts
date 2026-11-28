import type { Store } from "./database.js";

export interface PlaybackClock {
  id: string;
  channel_id: string;
  revision_id: string;
  position_ms: number;
  anchor_ms: number;
  paused: number;
  state_version: number;
  pending_revision_id: string | null;
  pending_at_ms: number | null;
}
export function playbackPosition(row: PlaybackClock, now: number): number {
  return row.position_ms + (row.paused ? 0 : Math.max(0, now - row.anchor_ms));
}
export function effectivePlaybackRevision(
  row: PlaybackClock,
  now: number,
): string {
  return !row.paused &&
    row.pending_revision_id &&
    row.pending_at_ms !== null &&
    playbackPosition(row, now) >= row.pending_at_ms
    ? row.pending_revision_id
    : row.revision_id;
}
// Publication and controls run synchronously under the sole database owner. Only
// the revision pointer changes here; the device clock and pause state do not.
export function settlePlaybackUpdate(
  store: Store,
  row: PlaybackClock,
  now: number,
): void {
  const revision = effectivePlaybackRevision(row, now);
  if (revision === row.revision_id) return;
  store.db
    .prepare(
      `UPDATE playback_sessions SET revision_id=?,pending_revision_id=NULL,pending_at_ms=NULL,
    delivery_mode=NULL,delivery_entry_id=NULL,state_version=state_version+1 WHERE id=?`,
    )
    .run(revision, row.id);
  row.revision_id = revision;
  row.state_version++;
  row.pending_revision_id = null;
  row.pending_at_ms = null;
}
export function stagePlaybackUpdate(
  store: Store,
  row: PlaybackClock,
  target: string,
  now: number,
  cache = new Map<string, number | null>(),
): boolean {
  if (row.revision_id === target || row.pending_revision_id === target)
    return true;
  const position = playbackPosition(row, now);
  const current = store.db
    .prepare(
      `SELECT program_id FROM schedule_entries
    WHERE revision_id=? AND start_ms<=? AND end_ms>? LIMIT 1`,
    )
    .get(row.revision_id, position, position);
  if (!current) return false;
  const cacheKey = `${row.revision_id}:${target}:${current.program_id}`;
  if (cache.has(cacheKey)) {
    const boundary = cache.get(cacheKey);
    if (boundary == null) return false;
    return stageBoundary(boundary);
  }
  // Compare the complete airing, including mid-rolls and its trailing break.
  // Copied entries have different UUIDs but retain program identity and timing.
  const rows = store.db
    .prepare(`SELECT program_id,media_id,start_ms,end_ms,offset_ms,kind,source_size,source_mtime_ms
    FROM schedule_entries WHERE revision_id=? AND program_id=? ORDER BY start_ms`);
  const original = rows.all(row.revision_id, String(current.program_id));
  const copied = rows.all(target, String(current.program_id));
  if (
    !original.length ||
    JSON.stringify(original) !== JSON.stringify(copied) ||
    !original.some((e) => e.kind === "program") ||
    original.some((e, i) => i > 0 && original[i - 1]!.end_ms !== e.start_ms) ||
    !store.db
      .prepare("SELECT 1 FROM schedule_revisions WHERE id=? AND channel_id=?")
      .get(target, row.channel_id)
  ) {
    cache.set(cacheKey, null);
    return false;
  }
  const boundary = Number(original[original.length - 1]!.end_ms);
  const following = store.db
    .prepare(
      "SELECT start_ms,kind,offset_ms FROM schedule_entries WHERE revision_id=? AND start_ms>=? ORDER BY start_ms LIMIT 1",
    )
    .get(target, boundary);
  const empty = store.db
    .prepare(
      "SELECT 1 FROM schedule_revisions WHERE id=? AND config_json IS NOT NULL AND json_array_length(config_json,'$.groups')=0 AND effective_ms<=?",
    )
    .get(target, boundary);
  if (
    following
      ? following.start_ms !== boundary ||
        following.kind !== "program" ||
        following.offset_ms !== 0
      : !empty
  ) {
    cache.set(cacheKey, null);
    return false;
  }
  cache.set(cacheKey, boundary);
  return stageBoundary(boundary);
  function stageBoundary(boundary: number): boolean {
    // Keep an earlier staged boundary across repeated edits; a new publication
    // must not push a delayed viewer's handover further into the future.
    if (row.pending_at_ms !== null && row.pending_at_ms !== boundary)
      return false;
    if (row.pending_revision_id !== target || row.pending_at_ms !== boundary) {
      store.db
        .prepare(
          "UPDATE playback_sessions SET pending_revision_id=?,pending_at_ms=?,state_version=state_version+1 WHERE id=?",
        )
        .run(target, boundary, row.id);
      row.state_version++;
      row.pending_revision_id = target;
      row.pending_at_ms = boundary;
    }
    return true;
  }
}
export function stageChannelPlaybackUpdates(
  store: Store,
  channelId: string,
  target: string,
  now: number,
): void {
  const sessions = store.db
    .prepare("SELECT * FROM playback_sessions WHERE channel_id=?")
    .all(channelId) as unknown as PlaybackClock[];
  const cache = new Map<string, number | null>();
  for (const row of sessions) {
    settlePlaybackUpdate(store, row, now);
    stagePlaybackUpdate(store, row, target, now, cache);
  }
}
