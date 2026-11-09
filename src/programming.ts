import { compareClips } from "./scheduler.js";
import type { Group } from "./scheduler.js";
import { randomUUID } from "node:crypto";
import type { Store } from "./database.js";
import type { Account, Media } from "./domain.js";
import { DomainError, invariant } from "./domain.js";
import { programmingSchema } from "./contracts.js";
import type { Programming } from "./contracts.js";
import { selectMedia, metadata, seasonNumber } from "./library.js";
import {
  visibleChannel,
  sourceById,
  programmingActor,
  canReadMedia,
} from "./security.js";
import { buildSchedule, initialState, resolveLive } from "./scheduler.js";
import type { Clip, RotationState } from "./scheduler.js";
interface Revision {
  id: string;
  channel_id: string;
  config_json: string | null;
  state_json: string | null;
  profile_id: string | null;
  author_account_id: string | null;
  effective_ms: number;
  boundary_state_json: string | null;
}
export class ProgrammingService {
  constructor(
    private readonly store: Store,
    private readonly defaultHorizonMs = 48 * 3600000,
  ) {}
  private chunk(
    material: ReturnType<ProgrammingService["material"]>,
    config: Programming,
  ): number {
    let shortest = Infinity;
    for (const group of material.groups)
      for (const clip of group.clips)
        shortest = Math.min(shortest, clip.durationMs);
    const segments =
      (config.rules.positions.length + (config.rules.random?.count ?? 0) + 1) *
      (config.rules.maxClips + 1);
    invariant(
      segments <= 10000,
      400,
      "Reduce break positions or commercial count per break",
    );
    return Math.min(
      24 * 3600000,
      Math.max(1, shortest * Math.max(1, Math.floor(10000 / segments))),
    );
  }
  private material(
    account: Account,
    config: Programming,
    retainedDisabled: readonly string[] = [],
  ) {
    account = programmingActor(this.store, account, config.profileId);
    const toClip = (item: Media): Clip => {
      const data = metadata(item);
      return {
        id: item.id,
        title: item.title,
        durationMs: item.duration_ms,
        ...(sourceById(this.store, item.source_id).kind === "shows"
          ? { seasonNumber: seasonNumber(data) }
          : data.seasonNumber == null
            ? {}
            : { seasonNumber: data.seasonNumber }),
        ...(data.episodeNumber === undefined
          ? {}
          : { episodeNumber: data.episodeNumber }),
      };
    };
    const groups = config.groups.map((g) => ({
      ...g,
      clips: selectMedia(
        this.store,
        account,
        config.profileId,
        g.selection,
      ).map(toClip),
    }));
    const commercialItems = config.commercialSelection
      ? selectMedia(
          this.store,
          account,
          config.profileId,
          config.commercialSelection,
        )
      : [];
    invariant(
      commercialItems.every(
        (m) => sourceById(this.store, m.source_id).kind === "commercials",
      ),
      400,
      "Commercial selection must use commercial sources",
    );
    const disabled = new Set(config.disabledCommercialIds ?? []);
    invariant(
      disabled.size === (config.disabledCommercialIds?.length ?? 0),
      400,
      "Disabled commercials contain duplicates",
    );
    for (const id of disabled) {
      // Previously validated exclusions are inert when their clip no longer belongs
      // to the usable pool. They must not turn retired media into a dependency.
      if (
        retainedDisabled.includes(id) &&
        !commercialItems.some((item) => item.id === id)
      )
        continue;
      const item = this.store.db
        .prepare("SELECT * FROM media WHERE id=?")
        .get(id) as Media | undefined;
      invariant(
        item &&
          canReadMedia(this.store, account, config.profileId, item) &&
          sourceById(this.store, item.source_id).kind === "commercials",
        404,
        "Commercial not found",
      );
    }
    invariant(
      groups.some((g) => g.clips.length),
      409,
      "No available programming; channel schedule cannot advance",
    );
    // An empty group contributes no programs until its files become available, rather than resetting other groups.
    return {
      groups,
      commercials: commercialItems
        .filter((item) => !disabled.has(item.id))
        .map(toClip),
    };
  }
  preview(
    account: Account,
    channelId: string,
    input: Programming,
    now = Date.now(),
    horizonMs = this.defaultHorizonMs,
  ) {
    const config = programmingSchema.parse(input),
      channel = visibleChannel(this.store, account, channelId);
    invariant(
      account.role === "admin" ||
        (account.role === "editor" && channel.owner_account_id === account.id),
      403,
      "Channel management not allowed",
    );
    const material = this.material(
      account,
      config,
      this.retainedDisabled(channelId),
    );
    this.checkExpectedRevision(channelId, config);
    const { old, boundary, state } = this.publicationStart(
      channelId,
      config.seed,
      now,
    );
    return {
      effectiveMs: boundary,
      ...buildSchedule({
        channelId,
        startMs: boundary,
        untilMs: Math.max(
          Math.min(now + horizonMs, boundary + this.chunk(material, config)),
          boundary + 1,
        ),
        ...material,
        rules: config.rules as import("./scheduler.js").BreakRules,
        state: this.publicationState(old, config, state, material.groups),
      }),
    };
  }
  private publicationState(
    old: Revision | undefined,
    config: Programming,
    input: RotationState,
    groups: Group[],
  ): RotationState {
    const state = structuredClone(input);
    if (!old?.config_json)
      return this.applyCheckpointActions(config, state, groups);
    const previous = programmingSchema.parse(JSON.parse(old.config_json));
    const identity = (
      selection: Programming["groups"][number]["selection"],
    ) => {
      if (selection.type === "show")
        return JSON.stringify([
          selection.type,
          selection.sourceId,
          selection.key,
        ]);
      if (selection.type === "media")
        return JSON.stringify([selection.type, [...selection.ids].sort()]);
      return JSON.stringify(selection);
    };
    for (const group of config.groups) {
      const before = previous.groups.find((g) => g.id === group.id);
      if (!before) continue;
      if (
        before.episodesPerTurn !== group.episodesPerTurn &&
        state.nextGroupId === group.id
      )
        state.remainingInTurn = undefined;
      if (identity(before.selection) === identity(group.selection)) continue;
      if (state.nextGroupId === group.id) state.remainingInTurn = undefined;
      delete state.positions[group.id];
      delete state.bags[group.id];
      if (state.cursors) delete state.cursors[group.id];
    }
    const next =
      state.nextGroupId ??
      previous.groups[state.groupIndex % previous.groups.length]?.id;
    if (next && config.groups.some((g) => g.id === next))
      state.nextGroupId = next;
    else {
      state.remainingInTurn = undefined;
      const index = previous.groups.findIndex((g) => g.id === next);
      const following = [
        ...previous.groups.slice(index + 1),
        ...previous.groups.slice(0, index + 1),
      ].find((g) => config.groups.some((current) => current.id === g.id));
      state.nextGroupId = following?.id ?? config.groups[0]!.id;
    }
    return this.applyCheckpointActions(config, state, groups);
  }
  private applyCheckpointActions(
    config: Programming,
    state: RotationState,
    groups: Group[],
  ) {
    Object.setPrototypeOf(state.positions, null);
    const used = new Set<string>();
    for (const action of config.checkpointActions ?? []) {
      invariant(
        !used.has(action.groupId),
        400,
        "Choose one checkpoint action per group",
      );
      used.add(action.groupId);
      const group = config.groups.find((g) => g.id === action.groupId);
      invariant(
        group?.mode === "ordered",
        400,
        "Checkpoint controls require an ordered group",
      );
      delete state.positions[group.id];
      delete state.bags[group.id];
      if (state.cursors) delete state.cursors[group.id];
      if (action.action === "startAt") {
        // Membership is checked against the same authorized material used for publication.
        const index =
          groups
            .find((g) => g.id === group.id)
            ?.clips.slice()
            .sort(compareClips)
            .findIndex((c) => c.id === action.mediaId) ?? -1;
        invariant(
          index >= 0,
          409,
          "Starting episode is unavailable in this group",
        );
        state.positions[group.id] = index;
      }
      if (state.nextGroupId === group.id) state.remainingInTurn = undefined;
    }
    return this.normalizeCursors(state);
  }
  private normalizeCursors(state: RotationState): RotationState {
    for (const cursor of Object.values(state.cursors ?? {})) {
      if (cursor.seasonNumber != null) continue;
      const item = this.store.db
        .prepare("SELECT * FROM media WHERE id=?")
        .get(cursor.id) as Media | undefined;
      if (item && sourceById(this.store, item.source_id).kind === "shows")
        cursor.seasonNumber = seasonNumber(metadata(item));
    }
    return state;
  }
  private publicationStart(channelId: string, seed: number, now: number) {
    const old = this.active(channelId),
      initial = initialState(seed),
      context = { old, boundary: now, state: initial, recovered: false };
    if (!old) return context;
    if (old.effective_ms > now) {
      if (old.boundary_state_json)
        return {
          ...context,
          boundary: old.effective_ms,
          state: JSON.parse(old.boundary_state_json) as RotationState,
        };
      // Older schemas did not retain pending initial state. Preserve their first
      // selected airing rather than silently replacing its one-time checkpoint.
      const first = this.store.db
        .prepare(
          "SELECT end_ms,state_json FROM schedule_checkpoints WHERE revision_id=? AND end_ms>? ORDER BY end_ms LIMIT 1",
        )
        .get(old.id, old.effective_ms);
      if (first)
        return {
          ...context,
          boundary: Number(first.end_ms),
          state: JSON.parse(String(first.state_json)) as RotationState,
        };
    }
    const live = resolveLive(this.store, channelId, now);
    if (live) {
      const end = this.store.db
        .prepare(
          "SELECT MAX(end_ms) AS end FROM schedule_entries WHERE revision_id=? AND program_id=?",
        )
        .get(old.id, live.entry.programId) as { end: number };
      const checkpoint = this.store.db
        .prepare(
          "SELECT state_json FROM schedule_checkpoints WHERE revision_id=? AND program_id=?",
        )
        .get(old.id, live.entry.programId) as
        { state_json: string } | undefined;
      return {
        ...context,
        boundary: end.end,
        state: checkpoint
          ? (JSON.parse(checkpoint.state_json) as RotationState)
          : initial,
      };
    }
    // Preview catches up in memory so inspecting an idle channel never writes a schedule.
    if (old.config_json) {
      const author = this.store.db
        .prepare(
          "SELECT id,username,role,disabled FROM accounts WHERE id=? AND disabled=0",
        )
        .get(old.author_account_id!) as Account | undefined;
      const previous = programmingSchema.parse(JSON.parse(old.config_json));
      let material: ReturnType<ProgrammingService["material"]>;
      try {
        invariant(author, 409, "Programming author is unavailable");
        material = this.material(
          author,
          previous,
          previous.disabledCommercialIds,
        );
      } catch (error) {
        // A valid deliberate replacement can repair an expired channel whose old authority/content is gone.
        if (!(
          error instanceof DomainError &&
          [403, 404, 409].includes(error.statusCode)
        ))
          throw error;
        return {
          ...context,
          state: old.state_json
            ? (JSON.parse(old.state_json) as RotationState)
            : initial,
          recovered: true,
        };
      }
      let end = Number(
          this.store.db
            .prepare(
              "SELECT MAX(end_ms) AS end FROM schedule_entries WHERE revision_id=?",
            )
            .get(old.id)?.end,
        ),
        state = JSON.parse(old.state_json!) as RotationState;
      for (let batch = 0; end <= now; batch++) {
        invariant(
          batch < 100,
          503,
          "Schedule catch-up limit reached; retry after maintenance advances it",
        );
        const result = buildSchedule({
          channelId,
          startMs: end,
          untilMs: Math.min(now + 1, end + this.chunk(material, previous)),
          ...material,
          rules: previous.rules as import("./scheduler.js").BreakRules,
          state: this.normalizeCursors(state),
        });
        const current = result.checkpoints.find((p) => p.endMs > now);
        if (current)
          return { ...context, boundary: current.endMs, state: current.state };
        end = result.entries.at(-1)!.endMs;
        state = result.state;
      }
    }
    return context;
  }

  private retainedDisabled(channelId: string): string[] {
    const old = this.active(channelId);
    return old?.config_json
      ? (JSON.parse(old.config_json).disabledCommercialIds ?? [])
      : [];
  }
  private checkExpectedRevision(channelId: string, config: Programming) {
    invariant(
      config.expectedRevisionId === undefined ||
        config.expectedRevisionId === (this.active(channelId)?.id ?? null),
      409,
      "Channel changed elsewhere. Review the latest programming before publishing.",
    );
  }
  publish(
    account: Account,
    channelId: string,
    input: Programming,
    now = Date.now(),
    horizonMs = this.defaultHorizonMs,
  ) {
    return this.store.transaction(() =>
      this.publishCurrent(account, channelId, input, now, horizonMs),
    );
  }
  private publishCurrent(
    account: Account,
    channelId: string,
    input: Programming,
    now = Date.now(),
    horizonMs = this.defaultHorizonMs,
  ) {
    const config = programmingSchema.parse(input),
      channel = visibleChannel(this.store, account, channelId);
    invariant(
      account.role === "admin" ||
        (account.role === "editor" && channel.owner_account_id === account.id),
      403,
      "Channel management not allowed",
    );
    const material = this.material(
      account,
      config,
      this.retainedDisabled(channelId),
    );
    this.checkExpectedRevision(channelId, config);
    const { old, boundary, state, recovered } = this.publicationStart(
      channelId,
      config.seed,
      now,
    );
    if (!recovered) this.ensure(channelId, now + 1);
    const boundaryState = this.publicationState(
      old,
      config,
      state,
      material.groups,
    );
    const result = buildSchedule({
      channelId,
      startMs: boundary,
      untilMs: Math.max(
        Math.min(now + horizonMs, boundary + this.chunk(material, config)),
        boundary + 1,
      ),
      ...material,
      rules: config.rules as import("./scheduler.js").BreakRules,
      state: boundaryState,
    });
    const revisionId = randomUUID();
    this.store.transaction(() => {
      this.store.db
        .prepare(
          "INSERT INTO schedule_revisions(id,channel_id,created_at,config_json,state_json,profile_id,author_account_id,effective_ms,boundary_state_json) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          revisionId,
          channelId,
          now,
          JSON.stringify({
            ...config,
            checkpointActions: undefined,
            expectedRevisionId: undefined,
          }),
          JSON.stringify(result.state),
          config.profileId,
          account.id,
          boundary,
          JSON.stringify(boundaryState),
        );
      if (old) {
        const prefix = this.store.db
          .prepare(
            "SELECT * FROM schedule_entries WHERE revision_id=? AND end_ms<=? ORDER BY start_ms",
          )
          .all(old.id, boundary) as unknown as {
          media_id: string;
          program_id: string;
          start_ms: number;
          end_ms: number;
          offset_ms: number;
          kind: string;
          source_size: number;
          source_mtime_ms: number;
        }[];
        const insert = this.store.db.prepare(
          "INSERT INTO schedule_entries(id,revision_id,channel_id,media_id,program_id,start_ms,end_ms,offset_ms,kind,source_size,source_mtime_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        );
        for (const e of prefix)
          insert.run(
            randomUUID(),
            revisionId,
            channelId,
            e.media_id,
            e.program_id,
            e.start_ms,
            e.end_ms,
            e.offset_ms,
            e.kind,
            e.source_size,
            e.source_mtime_ms,
          );
        this.store.db
          .prepare(
            "INSERT INTO schedule_checkpoints(revision_id,program_id,end_ms,state_json) SELECT ?,program_id,end_ms,state_json FROM schedule_checkpoints WHERE revision_id=? AND end_ms<=?",
          )
          .run(revisionId, old.id, boundary);
      }
      this.appendEntries(revisionId, channelId, result);
      this.store.db
        .prepare(
          "INSERT INTO active_schedules(channel_id,revision_id) VALUES(?,?) ON CONFLICT(channel_id) DO UPDATE SET revision_id=excluded.revision_id",
        )
        .run(channelId, revisionId);
      this.store.db
        .prepare(
          "INSERT INTO rotation_state(channel_id,state_json) VALUES(?,?) ON CONFLICT(channel_id) DO UPDATE SET state_json=excluded.state_json",
        )
        .run(channelId, JSON.stringify(result.state));
    });
    return { revisionId, effectiveMs: boundary, entries: result.entries };
  }
  active(channelId: string): Revision | undefined {
    return this.store.db
      .prepare(
        "SELECT r.* FROM schedule_revisions r JOIN active_schedules a ON a.revision_id=r.id WHERE a.channel_id=?",
      )
      .get(channelId) as unknown as Revision | undefined;
  }
  ensure(
    channelId: string,
    untilMs = Date.now() + this.defaultHorizonMs,
    revisionId?: string,
  ): void {
    const revision = revisionId
      ? (this.store.db
          .prepare(
            "SELECT * FROM schedule_revisions WHERE id=? AND channel_id=?",
          )
          .get(revisionId, channelId) as unknown as Revision | undefined)
      : this.active(channelId);
    if (!revision?.config_json) return; // Legacy explicit-ID schedules have no recurring rule.
    let end = Number(
      this.store.db
        .prepare(
          "SELECT MAX(end_ms) AS end FROM schedule_entries WHERE revision_id=?",
        )
        .get(revision.id)?.end,
    );
    if (end >= untilMs) return;
    const account = this.store.db
      .prepare(
        "SELECT id,username,role,disabled FROM accounts WHERE id=? AND disabled=0",
      )
      .get(revision.author_account_id!) as Account | undefined;
    invariant(account, 409, "Programming author is unavailable");
    const config = programmingSchema.parse(JSON.parse(revision.config_json)),
      material = this.material(account, config, config.disabledCommercialIds);
    let state = JSON.parse(revision.state_json!) as RotationState;
    // Materialize bounded batches; this preserves exact random choices across idle periods and restarts.
    let batches = 0;
    while (end < untilMs) {
      invariant(
        ++batches <= 100,
        503,
        "Schedule catch-up limit reached; retry after maintenance advances it",
      );
      const chunk = this.chunk(material, config);
      const result = buildSchedule({
        channelId,
        startMs: end,
        untilMs: Math.min(untilMs, end + chunk),
        ...material,
        rules: config.rules as import("./scheduler.js").BreakRules,
        state: this.normalizeCursors(state),
      });
      this.store.transaction(() => {
        this.appendEntries(revision.id, channelId, result);
        this.store.db
          .prepare("UPDATE schedule_revisions SET state_json=? WHERE id=?")
          .run(JSON.stringify(result.state), revision.id);
        if (this.active(channelId)?.id === revision.id)
          this.store.db
            .prepare(
              "UPDATE rotation_state SET state_json=? WHERE channel_id=?",
            )
            .run(JSON.stringify(result.state), channelId);
      });
      state = result.state;
      end = result.entries.at(-1)!.endMs;
    }
  }
  private appendEntries(
    revisionId: string,
    channelId: string,
    result: ReturnType<typeof buildSchedule>,
  ) {
    const insert = this.store.db.prepare(
      "INSERT INTO schedule_entries(id,revision_id,channel_id,media_id,program_id,start_ms,end_ms,offset_ms,kind,source_size,source_mtime_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    );
    for (const e of result.entries) {
      const m = this.store.db
        .prepare("SELECT size,mtime_ms FROM media WHERE id=?")
        .get(e.mediaId) as { size: number; mtime_ms: number };
      insert.run(
        e.id,
        revisionId,
        channelId,
        e.mediaId,
        e.programId,
        e.startMs,
        e.endMs,
        e.offsetMs,
        e.kind,
        m.size,
        m.mtime_ms,
      );
      this.store.db
        .prepare(
          "INSERT OR IGNORE INTO channel_items(channel_id,media_id) VALUES(?,?)",
        )
        .run(channelId, e.mediaId);
    }
    const checkpoint = this.store.db.prepare(
      "INSERT INTO schedule_checkpoints(revision_id,program_id,end_ms,state_json) VALUES(?,?,?,?)",
    );
    for (const point of result.checkpoints)
      checkpoint.run(
        revisionId,
        point.programId,
        point.endMs,
        JSON.stringify(point.state),
      );
  }
}
