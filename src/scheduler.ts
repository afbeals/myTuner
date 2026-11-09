import { randomUUID } from "node:crypto";
import { invariant } from "./domain.js";
import type { ScheduleEntry } from "./domain.js";
import type { Store } from "./database.js";

export interface Clip {
  id: string;
  durationMs: number;
  title?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}
export interface Group {
  id: string;
  mode: "ordered" | "shuffle" | "random";
  clips: Clip[];
  episodesPerTurn?: number | undefined;
}
export interface BreakRules {
  between: boolean;
  positions: { kind: "percent" | "timestamp"; value: number }[];
  random?: { count: number; minPercent: number; maxPercent: number };
  maxClips: number;
  maxDurationMs: number;
  overflowPolicy?: "skip" | "truncate";
  minRemainingMs?: number;
  repeatAllowance: number;
  maxPerBreak: number;
  cooldownMs: number;
}
export interface BreakDiagnostic {
  startMs: number;
  endMs: number;
  requestedDurationMs: number;
  poolSize: number;
  clips: number;
  shortenedClips: number;
  reason:
    | "filled"
    | "minimum-remaining"
    | "clip-limit"
    | "no-commercials"
    | "duration-fit"
    | "variation-limits";
}
export interface RotationState {
  cursors?: Record<string, Clip>;
  seed: number;
  groupIndex: number;
  nextGroupId?: string;
  remainingInTurn?: number | undefined;
  positions: Record<string, number>;
  bags: Record<string, string[]>;
  commercialCounts: Record<string, number>;
  lastPlayed: Record<string, number>;
  lastCommercial: string | null;
}
export function initialState(seed = 0x12345678): RotationState {
  return {
    seed: seed >>> 0,
    groupIndex: 0,
    positions: {},
    bags: {},
    commercialCounts: {},
    lastPlayed: {},
    lastCommercial: null,
  };
}
function random(state: RotationState): number {
  state.seed = (Math.imul(1664525, state.seed) + 1013904223) >>> 0;
  return state.seed / 4294967296;
}
function validateClip(clip: Clip): void {
  invariant(
    Number.isSafeInteger(clip.durationMs) && clip.durationMs > 0,
    400,
    "Media duration must be positive integer milliseconds",
  );
}
export function compareClips(a: Clip, b: Clip): number {
  return (
    (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0) ||
    (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0) ||
    (a.title ?? a.id).localeCompare(b.title ?? b.id, undefined, {
      numeric: true,
    }) ||
    a.id.localeCompare(b.id)
  );
}
export function orderedClips(clips: Clip[]): Clip[] {
  return [...clips].sort(compareClips);
}
function nextProgram(group: Group, state: RotationState): Clip {
  const clips = orderedClips(group.clips);
  if (group.mode === "random")
    return clips[Math.floor(random(state) * clips.length)]!;
  if (group.mode === "ordered") {
    const previous = state.cursors?.[group.id];
    const found = previous ? clips.findIndex((c) => c.id === previous.id) : -1;
    const next = previous
      ? found >= 0
        ? clips[(found + 1) % clips.length]
        : (clips.find((c) => compareClips(c, previous) > 0) ?? clips[0])
      : clips[(state.positions[group.id] ?? 0) % clips.length];
    state.cursors ??= {};
    state.cursors[group.id] = { ...next! };
    state.positions[group.id] = (state.positions[group.id] ?? 0) + 1;
    return next!;
  }
  let bag = (state.bags[group.id] ?? []).filter((id) =>
    clips.some((c) => c.id === id),
  );
  if (!bag.length) {
    bag = clips.map((c) => c.id);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(random(state) * (i + 1));
      [bag[i], bag[j]] = [bag[j]!, bag[i]!];
    }
  }
  const id = bag.shift()!;
  state.bags[group.id] = bag;
  return clips.find((c) => c.id === id)!;
}
export const noBreaks: BreakRules = {
  between: false,
  positions: [],
  maxClips: 0,
  maxDurationMs: 0,
  repeatAllowance: 1,
  maxPerBreak: 1,
  cooldownMs: 0,
};
export function buildSchedule(input: {
  channelId: string;
  startMs: number;
  untilMs: number;
  groups: Group[];
  commercials: Clip[];
  rules: BreakRules;
  state?: RotationState;
}): {
  entries: ScheduleEntry[];
  state: RotationState;
  checkpoints: { programId: string; endMs: number; state: RotationState }[];
  diagnostics: BreakDiagnostic[];
} {
  const { channelId, startMs, untilMs, groups, commercials, rules } = input;
  invariant(
    Number.isSafeInteger(startMs) &&
      Number.isSafeInteger(untilMs) &&
      untilMs > startMs,
    400,
    "Invalid schedule window",
  );
  invariant(
    groups.length > 0 && groups.some((g) => g.clips.length > 0),
    400,
    "Programming needs available media",
  );
  invariant(
    new Set(groups.map((g) => g.id)).size === groups.length,
    400,
    "Programming group IDs must be unique",
  );
  for (const group of groups) {
    invariant(
      ["ordered", "shuffle", "random"].includes(group.mode),
      400,
      "Invalid rotation mode",
    );
    invariant(
      Number.isInteger(group.episodesPerTurn ?? 1) &&
        (group.episodesPerTurn ?? 1) >= 1 &&
        (group.episodesPerTurn ?? 1) <= 3,
      400,
      "Episodes per turn must be 1, 2 or 3",
    );
    group.clips.forEach(validateClip);
  }
  commercials.forEach(validateClip);
  invariant(
    new Set(commercials.map((c) => c.id)).size === commercials.length,
    400,
    "Commercial IDs must be unique",
  );
  for (const value of [rules.maxClips, rules.maxDurationMs, rules.cooldownMs])
    invariant(
      Number.isSafeInteger(value) && value >= 0,
      400,
      "Invalid commercial limit",
    );
  invariant(
    rules.overflowPolicy === undefined ||
      ["skip", "truncate"].includes(rules.overflowPolicy),
    400,
    "Invalid commercial overflow policy",
  );
  const minimumRemaining = rules.minRemainingMs ?? 6000;
  invariant(
    Number.isSafeInteger(minimumRemaining) &&
      minimumRemaining >= 0 &&
      minimumRemaining <= 3600000,
    400,
    "Invalid minimum remaining break time",
  );
  for (const value of [rules.repeatAllowance, rules.maxPerBreak])
    invariant(
      Number.isSafeInteger(value) && value >= 1,
      400,
      "Invalid repeat limit",
    );
  for (const position of rules.positions)
    invariant(
      Number.isFinite(position.value) &&
        position.value > 0 &&
        (position.kind === "timestamp" ||
          (position.kind === "percent" && position.value < 100)),
      400,
      "Invalid break position",
    );
  if (rules.random)
    invariant(
      Number.isSafeInteger(rules.random.count) &&
        rules.random.count >= 0 &&
        rules.random.count <= 100 &&
        rules.random.minPercent > 0 &&
        rules.random.maxPercent < 100 &&
        rules.random.minPercent < rules.random.maxPercent,
      400,
      "Invalid random break range",
    );
  const checkpoints: {
    programId: string;
    endMs: number;
    state: RotationState;
  }[] = [];
  const state = structuredClone(input.state ?? initialState()),
    entries: ScheduleEntry[] = [];
  // JSON/structuredClone restores ordinary prototypes; group IDs may be any valid string.
  for (const dictionary of [
    state.positions,
    state.bags,
    state.commercialCounts,
    state.lastPlayed,
  ])
    Object.setPrototypeOf(dictionary, null);
  state.cursors ??= {};
  Object.setPrototypeOf(state.cursors, null);
  let cursor = startMs;
  const add = (
    clip: Clip,
    offsetMs: number,
    durationMs: number,
    kind: ScheduleEntry["kind"],
    programId: string,
  ) => {
    invariant(
      entries.length < 20_000,
      422,
      "Schedule exceeds segment limit; use a shorter window",
    );
    invariant(
      Number.isSafeInteger(cursor + durationMs),
      400,
      "Schedule timestamp overflow",
    );
    entries.push({
      id: randomUUID(),
      channelId,
      mediaId: clip.id,
      programId,
      startMs: cursor,
      endMs: cursor + durationMs,
      offsetMs,
      kind,
    });
    cursor += durationMs;
  };
  const diagnostics: BreakDiagnostic[] = [];
  const commercialBreak = (programId: string) => {
    const detail: BreakDiagnostic = {
      startMs: cursor,
      endMs: cursor,
      requestedDurationMs: rules.maxDurationMs,
      poolSize: commercials.length,
      clips: 0,
      shortenedClips: 0,
      reason: "clip-limit",
    };
    const inBreak: Record<string, number> = {};
    let duration = 0;
    for (let i = 0; i < rules.maxClips; i++) {
      const remaining = rules.maxDurationMs - duration;
      if (
        remaining <= 0 ||
        (rules.overflowPolicy === "truncate" && remaining <= minimumRemaining)
      ) {
        detail.reason = remaining <= 0 ? "filled" : "minimum-remaining";
        break;
      }
      if (
        commercials.length &&
        commercials.every(
          (c) => (state.commercialCounts[c.id] ?? 0) >= rules.repeatAllowance,
        )
      )
        state.commercialCounts = {};
      let eligible = commercials.filter(
        (c) =>
          (state.commercialCounts[c.id] ?? 0) < rules.repeatAllowance &&
          (inBreak[c.id] ?? 0) < rules.maxPerBreak &&
          (rules.overflowPolicy === "truncate" || c.durationMs <= remaining) &&
          (state.lastPlayed[c.id] === undefined ||
            cursor - state.lastPlayed[c.id]! >= rules.cooldownMs),
      );
      if (!eligible.length) {
        detail.reason = !commercials.length
          ? "no-commercials"
          : rules.overflowPolicy !== "truncate" &&
              commercials.every((c) => c.durationMs > remaining)
            ? "duration-fit"
            : "variation-limits";
        break;
      }
      const alternatives = eligible.filter(
        (c) => c.id !== state.lastCommercial,
      );
      if (alternatives.length) eligible = alternatives;
      const least = Math.min(
        ...eligible.map((c) => state.commercialCounts[c.id] ?? 0),
      );
      eligible = eligible.filter(
        (c) => (state.commercialCounts[c.id] ?? 0) === least,
      );
      const clip = eligible[Math.floor(random(state) * eligible.length)]!;
      state.lastPlayed[clip.id] = cursor;
      state.lastCommercial = clip.id;
      state.commercialCounts[clip.id] =
        (state.commercialCounts[clip.id] ?? 0) + 1;
      inBreak[clip.id] = (inBreak[clip.id] ?? 0) + 1;
      const playedDuration = Math.min(clip.durationMs, remaining);
      detail.clips++;
      if (playedDuration < clip.durationMs) detail.shortenedClips++;
      add(clip, 0, playedDuration, "commercial", programId);
      duration += playedDuration;
    }
    detail.endMs = cursor;
    if (duration >= rules.maxDurationMs) detail.reason = "filled";
    diagnostics.push(detail);
  };
  while (cursor < untilMs) {
    const savedIndex = groups.findIndex((g) => g.id === state.nextGroupId);
    let index = savedIndex >= 0 ? savedIndex : state.groupIndex % groups.length;
    while (!groups[index]!.clips.length) {
      index = (index + 1) % groups.length;
      state.remainingInTurn = undefined;
    }
    const group = groups[index]!,
      perTurn = group.episodesPerTurn ?? 1;
    const remaining = Math.min(state.remainingInTurn ?? perTurn, perTurn) - 1;
    state.remainingInTurn = remaining > 0 ? remaining : undefined;
    state.groupIndex = remaining > 0 ? index : (index + 1) % groups.length;
    state.nextGroupId = groups[state.groupIndex]!.id;
    const clip = nextProgram(group, state),
      programId = randomUUID();
    const points = rules.positions.map((p) =>
      p.kind === "percent"
        ? Math.round((clip.durationMs * p.value) / 100)
        : Math.round(p.value),
    );
    if (rules.random)
      for (let i = 0; i < rules.random.count; i++) {
        const width =
          (rules.random.maxPercent - rules.random.minPercent) /
          rules.random.count;
        points.push(
          Math.round(
            (clip.durationMs *
              (rules.random.minPercent + (i + random(state)) * width)) /
              100,
          ),
        );
      }
    const unique = [...new Set(points)]
      .filter((p) => p > 0 && p < clip.durationMs)
      .sort((a, b) => a - b);
    let offset = 0;
    for (const point of unique) {
      add(clip, offset, point - offset, "program", programId);
      commercialBreak(programId);
      offset = point;
    }
    add(clip, offset, clip.durationMs - offset, "program", programId);
    if (rules.between) commercialBreak(programId);
    checkpoints.push({
      programId,
      endMs: cursor,
      state: structuredClone(state),
    });
  }
  return { entries, state, checkpoints, diagnostics };
}
export function persistSchedule(
  store: Store,
  channelId: string,
  entries: ScheduleEntry[],
  state: RotationState,
  now = Date.now(),
  selectedMediaIds?: string[],
): string {
  invariant(
    entries.length > 0 &&
      entries.every(
        (e, i) =>
          e.channelId === channelId &&
          e.endMs > e.startMs &&
          (i === 0 || entries[i - 1]!.endMs === e.startMs),
      ),
    400,
    "Schedule must be contiguous and belong to one channel",
  );
  return store.transaction(() => {
    const mediaIds = selectedMediaIds ?? [
      ...new Set(entries.map((e) => e.mediaId)),
    ];
    store.db
      .prepare("DELETE FROM channel_items WHERE channel_id=?")
      .run(channelId);
    const addItem = store.db.prepare(
      "INSERT INTO channel_items(channel_id,media_id) VALUES(?,?)",
    );
    for (const mediaId of new Set(mediaIds)) addItem.run(channelId, mediaId);
    const revisionId = randomUUID();
    store.db
      .prepare(
        "INSERT INTO schedule_revisions(id,channel_id,created_at) VALUES(?,?,?)",
      )
      .run(revisionId, channelId, now);
    const insert = store.db.prepare(
      "INSERT INTO schedule_entries(id,revision_id,channel_id,media_id,program_id,start_ms,end_ms,offset_ms,kind,source_size,source_mtime_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    );
    for (const e of entries) {
      const media = store.db
        .prepare("SELECT size,mtime_ms FROM media WHERE id=?")
        .get(e.mediaId) as { size: number; mtime_ms: number } | undefined;
      invariant(media, 404, "Media not found");
      insert.run(
        e.id,
        revisionId,
        e.channelId,
        e.mediaId,
        e.programId,
        e.startMs,
        e.endMs,
        e.offsetMs,
        e.kind,
        media.size,
        media.mtime_ms,
      );
    }
    store.db
      .prepare(
        "INSERT INTO active_schedules(channel_id,revision_id) VALUES(?,?) ON CONFLICT(channel_id) DO UPDATE SET revision_id=excluded.revision_id",
      )
      .run(channelId, revisionId);
    store.db
      .prepare(
        "INSERT INTO rotation_state(channel_id,state_json) VALUES(?,?) ON CONFLICT(channel_id) DO UPDATE SET state_json=excluded.state_json",
      )
      .run(channelId, JSON.stringify(state));
    return revisionId;
  });
}
export function resolveLive(
  store: Store,
  channelId: string,
  atMs: number,
  revisionId?: string,
): { entry: ScheduleEntry; offsetMs: number } | null {
  const row = store.db
    .prepare(
      `SELECT e.* FROM schedule_entries e WHERE e.channel_id=? AND e.revision_id=COALESCE(?,(SELECT revision_id FROM active_schedules WHERE channel_id=?)) AND e.start_ms<=? AND e.end_ms>? LIMIT 1`,
    )
    .get(channelId, revisionId ?? null, channelId, atMs, atMs) as
    | {
        id: string;
        channel_id: string;
        media_id: string;
        program_id: string;
        start_ms: number;
        end_ms: number;
        offset_ms: number;
        kind: ScheduleEntry["kind"];
      }
    | undefined;
  if (!row) return null;
  const entry: ScheduleEntry = {
    id: row.id,
    channelId: row.channel_id,
    mediaId: row.media_id,
    programId: row.program_id,
    startMs: row.start_ms,
    endMs: row.end_ms,
    offsetMs: row.offset_ms,
    kind: row.kind,
  };
  return { entry, offsetMs: entry.offsetMs + atMs - entry.startMs };
}
