import { randomUUID } from "node:crypto";
import type { Store } from "./database.js";
import type { Account, Media } from "./domain.js";
import { invariant } from "./domain.js";
import {
  requireProfile,
  requireChannelMedia,
  visibleChannel,
  canReadMedia,
  requireAdmin,
} from "./security.js";

export function retentionDays(value: number | undefined, fallback: number) {
  const days = value ?? fallback;
  invariant(
    Number.isInteger(days) && days >= 1 && days <= 365,
    400,
    "Retention must be between 1 and 365 days",
  );
  return days;
}
export class CollectionRecovery {
  constructor(private store: Store) {}
  private permitted(
    account: Account,
    profileId: string,
    id: string,
    now: number,
  ) {
    requireProfile(this.store, account, profileId, true);
    const row = this.store.db
      .prepare(
        "SELECT id,name,owner_account_id AS ownerAccountId,deleted_ms AS deletedMs,expires_ms AS expiresMs FROM collections WHERE id=? AND deleted_ms IS NOT NULL AND expires_ms>?",
      )
      .get(id, now);
    invariant(
      row && (account.role === "admin" || row.ownerAccountId === account.id),
      404,
      "Collection not found",
    );
    const items = this.store.db
      .prepare(
        "SELECT m.* FROM collection_items ci JOIN media m ON m.id=ci.media_id WHERE ci.collection_id=?",
      )
      .all(id) as unknown as Media[];
    invariant(
      items.every((m) => canReadMedia(this.store, account, profileId, m)),
      404,
      "Collection not found",
    );
    return {
      ...row,
      id: String(row.id),
      name: String(row.name),
      count: items.length,
    };
  }
  list(account: Account, profileId: string, now = Date.now()) {
    requireProfile(this.store, account, profileId, true);
    const rows = this.store.db
      .prepare(
        "SELECT id FROM collections WHERE deleted_ms IS NOT NULL AND expires_ms>? AND (?='admin' OR owner_account_id=?) ORDER BY deleted_ms DESC,id",
      )
      .all(now, account.role, account.id);
    return {
      items: rows.flatMap((row) => {
        try {
          return [this.permitted(account, profileId, String(row.id), now)];
        } catch {
          return [];
        }
      }),
    };
  }
  restore(account: Account, profileId: string, id: string, now = Date.now()) {
    return this.store.transaction(() => {
      const row = this.permitted(account, profileId, id, now);
      this.store.db
        .prepare(
          "UPDATE collections SET deleted_ms=NULL,expires_ms=NULL WHERE id=?",
        )
        .run(id);
      return { id: row.id, name: row.name };
    });
  }
  purge(now = Date.now()) {
    this.store.db
      .prepare(
        "DELETE FROM collections WHERE id IN (SELECT id FROM collections WHERE deleted_ms IS NOT NULL AND expires_ms<=? ORDER BY expires_ms LIMIT 200)",
      )
      .run(now);
  }
}

// Only the active revision's retained prefix is authoritative. Never extend schedules here.
export function recentlyAired(
  store: Store,
  account: Account,
  profileId: string,
  channelId: string,
  now = Date.now(),
) {
  requireProfile(store, account, profileId);
  const channel = visibleChannel(store, account, channelId);
  invariant(
    store.db
      .prepare(
        "SELECT 1 FROM subscriptions WHERE profile_id=? AND channel_id=?",
      )
      .get(profileId, channelId),
    404,
    "Channel not found",
  );
  requireChannelMedia(store, account, profileId, channel, { positionMs: now });
  const rows = store.db
    .prepare(
      `SELECT e.program_id AS programId,MIN(e.start_ms) AS startMs,MAX(e.end_ms) AS endMs,
    MAX(CASE WHEN e.kind='program' THEN e.media_id END) AS mediaId
    FROM schedule_entries e JOIN active_schedules a ON a.revision_id=e.revision_id
    WHERE e.channel_id=? GROUP BY e.program_id HAVING endMs<=? AND endMs>? AND mediaId IS NOT NULL ORDER BY startMs DESC`,
    )
    .all(channelId, now, now - 7200000);
  const permitted = rows.flatMap((row) => {
    const item = store.db
      .prepare("SELECT * FROM media WHERE id=?")
      .get(row.mediaId!) as Media | undefined;
    if (!item || !canReadMedia(store, account, profileId, item)) return [];
    const data = JSON.parse(item.metadata_json);
    return [
      {
        programId: String(row.programId),
        title: item.title,
        startMs: Number(row.startMs),
        endMs: Number(row.endMs),
        seriesTitle:
          typeof data.seriesTitle === "string" ? data.seriesTitle : null,
        seasonNumber: Number.isInteger(data.seasonNumber)
          ? data.seasonNumber
          : null,
        episodeNumber: Number.isInteger(data.episodeNumber)
          ? data.episodeNumber
          : null,
      },
    ];
  });
  return {
    checkedMs: now,
    startMs: now - 7200000,
    endMs: now,
    retention:
      "Retained scheduled airings only; this may be a partial window. These are not viewing records or replay links.",
    truncated: permitted.length > 200,
    items: permitted.slice(0, 200),
  };
}

export type ReportCategory = "picture" | "sound" | "captions" | "other";
interface ReportSummary {
  category: ReportCategory;
  client: "browser" | "tv";
  appVersion: string;
  serverTime: number;
  channelId: string;
  entryId: string;
  state: "live" | "paused" | "behind-live";
  route: string;
}
interface Context {
  profileId: string;
  channelId: string;
  mediaId: string;
  summary: ReportSummary;
}
interface Draft {
  accountId: string;
  auth: string | undefined;
  sessionId: string;
  expires: number;
  context: Context;
}
export class ProblemReports {
  private drafts = new Map<string, Draft>();
  constructor(
    private store: Store,
    readonly days = 30,
  ) {}
  private context(
    account: Account,
    sessionId: string,
    category: ReportCategory,
    client: "browser" | "tv",
    now: number,
  ): Context {
    const row = this.store.db
      .prepare("SELECT * FROM playback_sessions WHERE id=? AND account_id=?")
      .get(sessionId, account.id);
    invariant(
      row &&
        (!row.auth_session_hash ||
          row.auth_session_hash === account.sessionHash),
      404,
      "Playback session not found",
    );
    const profileId = String(row.profile_id),
      channelId = String(row.channel_id),
      position =
        Number(row.position_ms) +
        (row.paused ? 0 : Math.max(0, now - Number(row.anchor_ms)));
    const channel = visibleChannel(this.store, account, channelId);
    requireProfile(this.store, account, profileId);
    requireChannelMedia(this.store, account, profileId, channel, {
      revisionId: String(row.revision_id),
      positionMs: position,
    });
    invariant(
      this.store.db
        .prepare(
          "SELECT 1 FROM subscriptions WHERE profile_id=? AND channel_id=?",
        )
        .get(profileId, channelId),
      404,
      "Channel not found",
    );
    const entry = this.store.db
      .prepare(
        "SELECT m.* FROM schedule_entries e JOIN media m ON m.id=e.media_id WHERE e.revision_id=? AND e.start_ms<=? AND e.end_ms>? LIMIT 1",
      )
      .get(String(row.revision_id), position, position) as
      (Media & { id: string }) | undefined;
    // Select the entry separately: both tables have an id column.
    const ref = this.store.db
      .prepare(
        "SELECT id,media_id FROM schedule_entries WHERE revision_id=? AND start_ms<=? AND end_ms>? LIMIT 1",
      )
      .get(String(row.revision_id), position, position);
    invariant(
      entry && ref && canReadMedia(this.store, account, profileId, entry),
      404,
      "Scheduled media unavailable",
    );
    return {
      profileId,
      channelId,
      mediaId: String(ref.media_id),
      summary: {
        category,
        client,
        appVersion: "0.2.0",
        serverTime: now,
        channelId,
        entryId: String(ref.id),
        state: row.paused
          ? "paused"
          : Math.abs(position - now) > 2000
            ? "behind-live"
            : "live",
        route:
          row.delivery_entry_id === ref.id &&
          ["direct", "hls"].includes(String(row.delivery_mode))
            ? String(row.delivery_mode)
            : "unknown",
      },
    };
  }
  preview(
    account: Account,
    sessionId: string,
    category: ReportCategory,
    client: "browser" | "tv",
    now = Date.now(),
  ) {
    this.expireDrafts(now);
    const context = this.context(account, sessionId, category, client, now);
    const own = [...this.drafts].filter(([, d]) => d.accountId === account.id);
    if (own.length >= 5) this.drafts.delete(own[0]![0]);
    invariant(
      this.drafts.size < 2000,
      503,
      "Report preparation busy; retry shortly",
    );
    const draftId = randomUUID();
    this.drafts.set(draftId, {
      accountId: account.id,
      auth: account.sessionHash,
      sessionId,
      expires: now + 300000,
      context,
    });
    return { draftId, expiresMs: now + 300000, summary: context.summary };
  }
  private authorized(account: Account, row: Record<string, unknown>) {
    if (account.role === "admin") return;
    invariant(row.account_id === account.id, 404, "Report not found");
    const p = String(row.profile_id),
      c = visibleChannel(this.store, account, String(row.channel_id));
    requireProfile(this.store, account, p);
    requireChannelMedia(this.store, account, p, c);
    invariant(
      this.store.db
        .prepare(
          "SELECT 1 FROM subscriptions WHERE profile_id=? AND channel_id=?",
        )
        .get(p, c.id),
      404,
      "Report not found",
    );
    const m = this.store.db
      .prepare("SELECT * FROM media WHERE id=?")
      .get(String(row.media_id)) as Media | undefined;
    invariant(
      m && canReadMedia(this.store, account, p, m),
      404,
      "Report not found",
    );
  }
  private output(row: Record<string, unknown>) {
    return {
      id: row.id,
      createdMs: row.created_ms,
      acknowledgedMs: row.acknowledged_ms,
      summary: JSON.parse(String(row.summary_json)) as ReportSummary,
    };
  }
  send(account: Account, draftId: string, requestId: string, now = Date.now()) {
    return this.store.transaction(() => {
      this.purge(now);
      const existing = this.store.db
        .prepare(
          "SELECT * FROM problem_reports WHERE account_id=? AND request_id=?",
        )
        .get(account.id, requestId);
      if (existing) {
        this.authorized(account, existing);
        return this.output(existing);
      }
      const draft = this.drafts.get(draftId);
      invariant(
        draft &&
          draft.expires > now &&
          draft.accountId === account.id &&
          draft.auth === account.sessionHash,
        409,
        "Report expired; review a new summary before sending",
      );
      const c = this.context(
        account,
        draft.sessionId,
        draft.context.summary.category,
        draft.context.summary.client,
        now,
      );
      invariant(
        c.channelId === draft.context.channelId &&
          c.mediaId === draft.context.mediaId &&
          c.summary.entryId === draft.context.summary.entryId &&
          c.summary.state === draft.context.summary.state &&
          c.summary.route === draft.context.summary.route,
        409,
        "Playback changed; review a new summary before sending",
      );
      const n = Number(
        this.store.db
          .prepare(
            "SELECT COUNT(*) AS n FROM problem_reports WHERE account_id=? AND created_ms>?",
          )
          .get(account.id, now - 600000)?.n,
      );
      invariant(n < 10, 429, "Report limit reached; try again later");
      const id = randomUUID();
      this.store.db
        .prepare(
          "INSERT INTO problem_reports(id,account_id,request_id,profile_id,channel_id,media_id,created_ms,summary_json) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          account.id,
          requestId,
          c.profileId,
          c.channelId,
          c.mediaId,
          now,
          JSON.stringify(draft.context.summary),
        );
      this.drafts.delete(draftId);
      this.store.db.exec(
        "DELETE FROM problem_reports WHERE id IN (SELECT id FROM problem_reports ORDER BY created_ms DESC,rowid DESC LIMIT -1 OFFSET 1000)",
      );
      return this.output(
        this.store.db
          .prepare("SELECT * FROM problem_reports WHERE id=?")
          .get(id)!,
      );
    });
  }
  list(account: Account, offset = 0, limit = 25, now = Date.now()) {
    const rows = this.store.db
      .prepare(
        "SELECT * FROM problem_reports WHERE created_ms>? AND (?='admin' OR account_id=?) ORDER BY created_ms DESC,rowid DESC",
      )
      .all(now - this.days * 86400000, account.role, account.id);
    const allowed = rows.filter((row) => {
      try {
        this.authorized(account, row);
        return true;
      } catch {
        return false;
      }
    });
    return {
      total: allowed.length,
      offset,
      limit,
      retentionDays: this.days,
      items: allowed
        .slice(offset, offset + limit)
        .map((row) => this.output(row)),
    };
  }
  remove(account: Account, id: string) {
    requireAdmin(account);
    this.store.db.prepare("DELETE FROM problem_reports WHERE id=?").run(id);
  }
  acknowledge(account: Account, id: string, now = Date.now()) {
    requireAdmin(account);
    this.store.db
      .prepare("UPDATE problem_reports SET acknowledged_ms=? WHERE id=?")
      .run(now, id);
  }
  private expireDrafts(now: number) {
    for (const [id, draft] of this.drafts)
      if (draft.expires <= now) this.drafts.delete(id);
  }
  purge(now = Date.now()) {
    this.expireDrafts(now);
    this.store.db
      .prepare("DELETE FROM problem_reports WHERE created_ms<=?")
      .run(now - this.days * 86400000);
  }
}
