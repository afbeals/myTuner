import { displayMedia } from "./display-metadata.js";
import { clearProfileUnlocks } from "./identity.js";
import type { ProgrammingService } from "./programming.js";
import { randomUUID } from "node:crypto";
import type { Store } from "./database.js";
import type { Account } from "./domain.js";
import { invariant } from "./domain.js";
import {
  visibleChannel,
  requireChannelMedia,
  requireProfile,
  canReadMedia,
} from "./security.js";
import { resolveLive } from "./scheduler.js";
interface Session {
  id: string;
  account_id: string;
  profile_id: string;
  channel_id: string;
  revision_id: string;
  position_ms: number;
  anchor_ms: number;
  paused: number;
  last_seen: number;
  auth_session_hash: string | null;
}
export class PlaybackService {
  constructor(
    private readonly store: Store,
    private readonly programming?: ProgrammingService,
  ) {}
  startup(account: Account, profileId?: string) {
    invariant(account.sessionHash, 401, "Authenticated session required");
    if (profileId) requireProfile(this.store, account, profileId, false, false);
    this.store.transaction(() => {
      clearProfileUnlocks(this.store, account.sessionHash!);
      this.store.db
        .prepare("DELETE FROM playback_sessions WHERE auth_session_hash=?")
        .run(account.sessionHash!);
    });
    return {
      profileSelectionRequired: profileId === undefined,
      profileId: profileId ?? null,
    };
  }
  join(
    account: Account,
    profileId: string,
    channelId: string,
    now = Date.now(),
  ) {
    const channel = visibleChannel(this.store, account, channelId);
    requireChannelMedia(this.store, account, profileId, channel, {
      positionMs: now,
    });
    this.programming?.ensure(channelId, now + 60000);
    const revision = this.store.db
      .prepare("SELECT revision_id FROM active_schedules WHERE channel_id=?")
      .get(channelId) as { revision_id: string } | undefined;
    invariant(
      revision && resolveLive(this.store, channelId, now, revision.revision_id),
      404,
      "No scheduled programming at this time",
    );
    const id = randomUUID();
    this.store.db
      .prepare(
        "INSERT INTO playback_sessions(id,account_id,profile_id,channel_id,revision_id,position_ms,anchor_ms,last_seen,auth_session_hash) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        account.id,
        profileId,
        channelId,
        revision.revision_id,
        now,
        now,
        now,
        account.sessionHash ?? null,
      );
    return this.describe(account, id, now);
  }
  private session(
    account: Account,
    id: string,
    now = Date.now(),
    checkMedia = true,
  ): Session {
    const row = this.store.db
      .prepare("SELECT * FROM playback_sessions WHERE id=? AND account_id=?")
      .get(id, account.id) as unknown as Session | undefined;
    invariant(
      row &&
        (!row.auth_session_hash ||
          row.auth_session_hash === account.sessionHash),
      404,
      "Playback session not found",
    );
    const channel = visibleChannel(this.store, account, row.channel_id);
    requireProfile(this.store, account, row.profile_id);
    if (checkMedia)
      requireChannelMedia(this.store, account, row.profile_id, channel, {
        revisionId: row.revision_id,
        positionMs:
          row.position_ms + (row.paused ? 0 : Math.max(0, now - row.anchor_ms)),
      });
    return row;
  }
  describe(account: Account, id: string, now = Date.now()) {
    const row = this.session(account, id, now, false),
      position =
        row.position_ms + (row.paused ? 0 : Math.max(0, now - row.anchor_ms));
    const active = this.programming?.active(row.channel_id);
    if (
      !row.paused &&
      row.position_ms === row.anchor_ms &&
      active &&
      active.effective_ms <= position &&
      active.id !== row.revision_id
    ) {
      requireChannelMedia(
        this.store,
        account,
        row.profile_id,
        visibleChannel(this.store, account, row.channel_id),
        { revisionId: active.id, positionMs: position },
      );
      row.revision_id = active.id;
      this.store.db
        .prepare("UPDATE playback_sessions SET revision_id=? WHERE id=?")
        .run(active.id, id);
    }
    this.programming?.ensure(row.channel_id, position + 60000, row.revision_id);
    requireChannelMedia(
      this.store,
      account,
      row.profile_id,
      visibleChannel(this.store, account, row.channel_id),
      { revisionId: row.revision_id, positionMs: position },
    );
    const live = resolveLive(
      this.store,
      row.channel_id,
      position,
      row.revision_id,
    );
    this.store.db
      .prepare("UPDATE playback_sessions SET last_seen=? WHERE id=?")
      .run(now, id);
    let available = false;
    if (live) {
      const item = this.store.db
        .prepare(
          `SELECT m.available FROM schedule_entries e JOIN media m ON m.id=e.media_id
    WHERE e.id=? AND e.source_size=m.size AND e.source_mtime_ms=m.mtime_ms`,
        )
        .get(live.entry.id) as { available: number } | undefined;
      available = item?.available === 1;
    }
    let context = null;
    if (live) {
      const item = this.store.db
        .prepare("SELECT * FROM media WHERE id=?")
        .get(live.entry.mediaId) as unknown as import("./domain.js").Media;
      const display = displayMedia(this.store, item);
      const data = JSON.parse(display.metadata_json);
      const airing = this.store.db
        .prepare(
          "SELECT MIN(start_ms) AS startMs,MAX(end_ms) AS endMs,SUM(CASE WHEN kind='program' THEN end_ms-start_ms ELSE 0 END) AS contentDurationMs,SUM(CASE WHEN kind='program' THEN MAX(0,MIN(end_ms,?)-start_ms) ELSE 0 END) AS contentElapsedMs FROM schedule_entries WHERE revision_id=? AND program_id=?",
        )
        .get(position, row.revision_id, live.entry.programId)!;
      const nextRevision =
        !row.paused &&
        row.position_ms === row.anchor_ms &&
        active &&
        active.effective_ms <= Number(airing.endMs)
          ? active.id
          : row.revision_id;
      const next = this.store.db
        .prepare(
          "SELECT e.start_ms AS startMs,e.end_ms AS endMs,m.* FROM schedule_entries e JOIN media m ON m.id=e.media_id WHERE e.revision_id=? AND e.start_ms>=? AND e.kind='program' AND e.program_id<>? ORDER BY e.start_ms LIMIT 1",
        )
        .get(nextRevision, airing.endMs!, live.entry.programId) as unknown as
        | (import("./domain.js").Media & { startMs: number; endMs: number })
        | undefined;
      const program = this.store.db
        .prepare(
          "SELECT m.* FROM schedule_entries e JOIN media m ON m.id=e.media_id WHERE e.revision_id=? AND e.program_id=? AND e.kind='program' ORDER BY e.start_ms LIMIT 1",
        )
        .get(row.revision_id, live.entry.programId) as unknown as
        import("./domain.js").Media | undefined;
      const programMetadata =
        program && canReadMedia(this.store, account, row.profile_id, program)
          ? JSON.parse(displayMedia(this.store, program).metadata_json)
          : null;
      context = {
        program: programMetadata
          ? {
              title: displayMedia(this.store, program!).title,
              seriesTitle: programMetadata.seriesTitle ?? null,
              seasonNumber: programMetadata.seasonNumber ?? null,
              episodeNumber: programMetadata.episodeNumber ?? null,
            }
          : null,
        title: display.title,
        description: data.overview ?? "",
        seriesTitle: data.seriesTitle ?? null,
        seasonNumber: data.seasonNumber ?? null,
        episodeNumber: data.episodeNumber ?? null,
        kind: live.entry.kind,
        entryDurationMs: live.entry.endMs - live.entry.startMs,
        remainingMs: Math.max(0, live.entry.endMs - position),
        airing,
        next:
          next && canReadMedia(this.store, account, row.profile_id, next)
            ? {
                title: displayMedia(this.store, next).title,
                startMs: next.startMs,
              }
            : null,
      };
    }
    return {
      id: row.id,
      profileId: row.profile_id,
      channelId: row.channel_id,
      revisionId: row.revision_id,
      paused: Boolean(row.paused),
      positionMs: position,
      behindLiveMs: Math.max(0, now - position),
      available,
      playback: live,
      context,
    };
  }
  pause(account: Account, id: string, now = Date.now()) {
    const row = this.session(account, id, now),
      position =
        row.position_ms + (row.paused ? 0 : Math.max(0, now - row.anchor_ms));
    this.store.db
      .prepare(
        "UPDATE playback_sessions SET position_ms=?,anchor_ms=?,paused=1 WHERE id=?",
      )
      .run(position, now, id);
    return this.describe(account, id, now);
  }
  resume(account: Account, id: string, now = Date.now()) {
    const row = this.session(account, id, now);
    if (row.paused)
      this.store.db
        .prepare("UPDATE playback_sessions SET anchor_ms=?,paused=0 WHERE id=?")
        .run(now, id);
    return this.describe(account, id, now);
  }
  goLive(account: Account, id: string, now = Date.now()) {
    const row = this.session(account, id, now, false);
    this.programming?.ensure(row.channel_id, now + 60000);
    const revision = this.store.db
      .prepare("SELECT revision_id FROM active_schedules WHERE channel_id=?")
      .get(row.channel_id) as { revision_id: string } | undefined;
    invariant(
      revision &&
        resolveLive(this.store, row.channel_id, now, revision.revision_id),
      404,
      "No scheduled programming at this time",
    );
    requireChannelMedia(
      this.store,
      account,
      row.profile_id,
      visibleChannel(this.store, account, row.channel_id),
      { revisionId: revision.revision_id, positionMs: now },
    );
    this.store.db
      .prepare(
        "UPDATE playback_sessions SET revision_id=?,position_ms=?,anchor_ms=?,paused=0 WHERE id=?",
      )
      .run(revision.revision_id, now, now, id);
    return this.describe(account, id, now);
  }
  record(
    account: Account,
    id: string,
    event: { id: string; entryId: string; startMs: number; endMs: number },
    now = Date.now(),
  ) {
    const session = this.session(account, id, now),
      description = this.describe(account, id, now);
    const entry = this.store.db
      .prepare(
        "SELECT start_ms,end_ms,media_id,kind,program_id FROM schedule_entries WHERE id=? AND revision_id=?",
      )
      .get(event.entryId, session.revision_id) as
      | {
          start_ms: number;
          end_ms: number;
          media_id: string;
          kind: string;
          program_id: string;
        }
      | undefined;
    invariant(
      entry &&
        event.startMs >= entry.start_ms &&
        event.endMs <= entry.end_ms &&
        event.endMs > event.startMs &&
        event.endMs <= description.positionMs + 2000 &&
        event.endMs - event.startMs <= 60000,
      400,
      "Invalid delivered interval",
    );
    const old = this.store.db
      .prepare("SELECT * FROM playback_events WHERE id=?")
      .get(event.id);
    invariant(
      !old ||
        (old.session_id === id &&
          old.entry_id === event.entryId &&
          old.start_ms === event.startMs &&
          old.end_ms === event.endMs),
      409,
      "Event identifier already used",
    );
    this.store.db
      .prepare(
        "INSERT OR IGNORE INTO playback_events(id,session_id,account_id,channel_id,entry_id,start_ms,end_ms,created_ms,media_id,kind,program_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        event.id,
        id,
        account.id,
        session.channel_id,
        event.entryId,
        event.startMs,
        event.endMs,
        now,
        entry.media_id,
        entry.kind,
        entry.program_id,
      );
  }
  history(account: Account, id: string) {
    const session = this.session(account, id);
    const rows = this.store.db
      .prepare(
        "SELECT entry_id,start_ms,end_ms,media_id FROM playback_events WHERE session_id=? ORDER BY entry_id,start_ms,end_ms",
      )
      .all(id) as {
      entry_id: string;
      start_ms: number;
      end_ms: number;
      media_id: string;
    }[];
    let deliveredMs = 0,
      lastEntry = "",
      end = 0;
    let eventCount = 0;
    for (const row of rows) {
      const item = this.store.db
        .prepare("SELECT * FROM media WHERE id=?")
        .get(row.media_id) as import("./domain.js").Media | undefined;
      if (!item || !canReadMedia(this.store, account, session.profile_id, item))
        continue;
      eventCount++;
      if (row.entry_id !== lastEntry) {
        lastEntry = row.entry_id;
        end = row.start_ms;
      }
      deliveredMs += Math.max(0, row.end_ms - Math.max(end, row.start_ms));
      end = Math.max(end, row.end_ms);
    }
    return { deliveredMs, eventCount };
  }
  collect(now = Date.now(), ttlMs = 24 * 3600000) {
    this.store.db
      .prepare(
        "DELETE FROM playback_sessions WHERE last_seen<? OR auth_session_hash IS NOT NULL AND NOT EXISTS(SELECT 1 FROM sessions s WHERE s.token_hash=auth_session_hash AND s.expires_at>? )",
      )
      .run(now - ttlMs, now);
    const unused = this.store.db
      .prepare(
        "SELECT id FROM schedule_revisions WHERE created_at<? AND NOT EXISTS(SELECT 1 FROM active_schedules a WHERE a.revision_id=schedule_revisions.id) AND NOT EXISTS(SELECT 1 FROM playback_sessions p WHERE p.revision_id=schedule_revisions.id)",
      )
      .all(now - 7 * 86400000);
    this.store.transaction(() => {
      for (const r of unused) {
        this.store.db
          .prepare("DELETE FROM schedule_entries WHERE revision_id=?")
          .run(r.id!);
        this.store.db
          .prepare("DELETE FROM schedule_revisions WHERE id=?")
          .run(r.id!);
      }
    });
    this.store.db
      .prepare("DELETE FROM profile_unlocks WHERE expires_ms<=?")
      .run(now);
    this.store.db
      .prepare("DELETE FROM device_pairings WHERE expires_ms<=?")
      .run(now);
    this.store.db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(now);
    this.store.db
      .prepare("DELETE FROM login_attempts WHERE window_start<?")
      .run(now - 86400000);
  }
  leave(account: Account, id: string): void {
    this.session(account, id, Date.now(), false);
    this.store.db.prepare("DELETE FROM playback_sessions WHERE id=?").run(id);
  }
}
