import { advertisedSubtitles } from "./subtitle-catalog.js";
import { textSubtitleCodecs, playbackDecision } from "./playback-policy.js";
import { EncoderAdmission } from "./encoder-admission.js";
import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  statfs,
} from "node:fs/promises";
import { join } from "node:path";
import type { Account, Media } from "./domain.js";
import { DomainError, invariant } from "./domain.js";
import type { Store } from "./database.js";
import { safeMediaPath, probeMedia } from "./catalog.js";
import type { Inspection } from "./catalog.js";
import { sourceById, canReadMedia } from "./security.js";
import { runFFmpeg } from "./generation.js";
import type { PlaybackService } from "./playback.js";
const segmentMs = 4000;
interface Entry {
  id: string;
  media_id: string;
  start_ms: number;
  end_ms: number;
  offset_ms: number;
  source_size: number;
  source_mtime_ms: number;
}
export class StreamingService {
  private active = new Map<
    string,
    {
      promise: Promise<Buffer>;
      controller: AbortController;
      checks: Set<() => void>;
    }
  >();
  private stopping = false;
  private cleanupJob: Promise<void> | undefined;
  constructor(
    private readonly store: Store,
    private readonly playback: PlaybackService,
    private readonly root: string,
    private readonly maxBytes = 512 * 1024 * 1024,
    private readonly execute = runFFmpeg,
    private readonly encoders = new EncoderAdmission(),
  ) {}
  manifest(
    account: Account,
    sessionId: string,
    now = Date.now(),
    audioTrack?: number,
  ) {
    const session = this.playback.describe(account, sessionId, now),
      position = session.positionMs;
    const entries = this.store.db
      .prepare(
        "SELECT * FROM schedule_entries WHERE revision_id=? AND end_ms>? AND start_ms<? ORDER BY start_ms LIMIT 200",
      )
      .all(
        session.revisionId,
        Math.max(0, position - 8000),
        position + 20000,
      ) as unknown as Entry[];
    invariant(entries.length, 404, "No scheduled intervals available");
    const first = entries[0]!,
      index = Math.max(
        0,
        Math.floor((position - 8000 - first.start_ms) / segmentMs),
      );
    const previous = Number(
      this.store.db
        .prepare(
          "SELECT COALESCE(SUM(CAST((end_ms-start_ms+?-1)/? AS INTEGER)),0) AS n FROM schedule_entries WHERE revision_id=? AND end_ms<=?",
        )
        .get(segmentMs, segmentMs, session.revisionId, first.start_ms)?.n ?? 0,
    );
    const sequence = previous + index;
    const lines = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "#EXT-X-TARGETDURATION:4",
      `#EXT-X-MEDIA-SEQUENCE:${sequence}`,
      `#EXT-X-DISCONTINUITY-SEQUENCE:${sequence}`,
      "#EXT-X-INDEPENDENT-SEGMENTS",
      `#EXT-X-START:TIME-OFFSET=${Math.max(0, (position - (first.start_ms + index * segmentMs)) / 1000).toFixed(3)},PRECISE=YES`,
    ];
    for (const entry of entries) {
      const item = this.store.db
        .prepare("SELECT metadata_json FROM media WHERE id=?")
        .get(entry.media_id);
      const streams = item
        ? (JSON.parse(String(item.metadata_json)) as { technical?: Inspection })
            .technical?.streams
        : undefined;
      const selected =
        audioTrack !== undefined &&
        streams?.some((s) => s.type === "audio" && s.index === audioTrack);
      const query = selected ? `?audioTrack=${audioTrack}` : "";
      for (
        let start =
          entry.start_ms + (entry.id === first.id ? index * segmentMs : 0);
        start < entry.end_ms && start < position + 20000;
        start += segmentMs
      ) {
        const duration = Math.min(segmentMs, entry.end_ms - start);
        lines.push(
          "#EXT-X-DISCONTINUITY",
          `#EXT-X-PROGRAM-DATE-TIME:${new Date(start).toISOString()}`,
          `#EXTINF:${(duration / 1000).toFixed(3)},`,
          `${entry.id}/${start}.ts${query}`,
        );
      }
    }
    return lines.join("\n") + "\n";
  }
  async negotiate(
    account: Account,
    sessionId: string,
    capabilities: {
      containers: string[];
      videoCodecs: string[];
      audioCodecs: string[];
    },
    now = Date.now(),
  ) {
    const session = this.playback.describe(account, sessionId, now);
    invariant(
      session.available && session.playback,
      409,
      "Scheduled media unavailable",
    );
    const item = this.store.db
      .prepare("SELECT * FROM media WHERE id=?")
      .get(session.playback.entry.mediaId) as unknown as Media;
    const technical = (
      JSON.parse(item.metadata_json) as { technical?: Inspection }
    ).technical;
    const direct =
      playbackDecision(item, capabilities, session.playback.entry).mode ===
      "direct";
    this.store.db
      .prepare(
        "UPDATE playback_sessions SET delivery_mode=?,delivery_entry_id=? WHERE id=?",
      )
      .run(direct ? "direct" : "hls", session.playback.entry.id, sessionId);
    return {
      mode: direct ? "direct" : "hls",
      url: direct
        ? `/api/profiles/${session.profileId}/media/${item.id}/file`
        : `/api/playback/sessions/${sessionId}/hls/index.m3u8`,
      sourceOffsetMs: session.playback.offsetMs,
      intervalEndMs: session.playback.entry.endMs,
      tracks: [
        ...(technical?.streams
          .filter((s) => s.type === "audio" || s.type === "subtitle")
          .map((track) => ({
            ...track,
            ...(track.type === "subtitle" && textSubtitleCodecs.has(track.codec)
              ? {
                  url: `/api/profiles/${session.profileId}/media/${item.id}/subtitles/${track.index}.vtt`,
                  timeBasis: "source-media",
                }
              : {}),
          })) ?? []),
        ...advertisedSubtitles(this.store, item, session.profileId),
      ],
      subtitleSupport:
        "Text tracks use source-media timestamps; clients map them across commercial breaks. Image subtitles require burn-in support.",
    };
  }
  private pending = new Set<Promise<Buffer>>();
  segment(
    actor: () => Account,
    sessionId: string,
    entryId: string,
    start: number,
    audioTrack?: number,
    now = Date.now(),
  ): Promise<Buffer> {
    if (this.stopping)
      return Promise.reject(new DomainError(503, "Streaming is stopping"));
    const task = this.readSegment(
      actor,
      sessionId,
      entryId,
      start,
      audioTrack,
      now,
    );
    this.pending.add(task);
    return task.finally(() => this.pending.delete(task));
  }
  private async readSegment(
    actor: () => Account,
    sessionId: string,
    entryId: string,
    start: number,
    audioTrack?: number,
    now = Date.now(),
  ): Promise<Buffer> {
    invariant(!this.stopping, 503, "Streaming is stopping");
    const session = this.playback.describe(actor(), sessionId, now),
      entry = this.store.db
        .prepare("SELECT * FROM schedule_entries WHERE id=? AND revision_id=?")
        .get(entryId, session.revisionId) as unknown as Entry | undefined;
    invariant(
      entry &&
        start >= entry.start_ms &&
        start < entry.end_ms &&
        (start - entry.start_ms) % segmentMs === 0 &&
        start >= session.positionMs - 12000 &&
        start <= session.positionMs + 24000,
      404,
      "Playback segment unavailable",
    );
    const item = this.store.db
      .prepare("SELECT * FROM media WHERE id=?")
      .get(entry.media_id) as unknown as Media;
    const authorize = () => {
      invariant(!this.stopping, 503, "Streaming is stopping");
      const a = actor(),
        current = this.playback.describe(a, sessionId),
        fresh = this.store.db
          .prepare("SELECT * FROM media WHERE id=?")
          .get(item.id) as unknown as Media;
      invariant(
        current.revisionId === session.revisionId &&
          fresh.available &&
          fresh.size === entry.source_size &&
          fresh.mtime_ms === entry.source_mtime_ms &&
          canReadMedia(this.store, a, session.profileId, fresh),
        404,
        "Playback segment unavailable",
      );
    };
    authorize();
    const input = await safeMediaPath(
        sourceById(this.store, item.source_id),
        item.relative_path,
      ),
      info = await stat(input);
    invariant(
      info.size === entry.source_size && info.mtimeMs === entry.source_mtime_ms,
      409,
      "Scheduled media changed; rejoin after rescan",
    );
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          item.id,
          item.size,
          item.mtime_ms,
          entry.offset_ms + start - entry.start_ms,
          Math.min(segmentMs, entry.end_ms - start),
          audioTrack ?? null,
          "hls-v1",
        ]),
      )
      .digest("hex");
    await mkdir(this.root, { recursive: true });
    const output = join(this.root, key + ".ts");
    try {
      invariant(
        (await stat(output)).size < 8388608,
        502,
        "Invalid cached playback output",
      );
      const cached = await readFile(output);
      authorize();
      return cached;
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    authorize();
    let job = this.active.get(key);
    if (!job) {
      invariant(
        this.active.size < 2,
        429,
        "Playback conversion limit reached; retry shortly",
      );
      const controller = new AbortController(),
        checks = new Set<() => void>();
      job = { controller, checks, promise: Promise.resolve(Buffer.alloc(0)) };
      this.active.set(key, job);
      job.promise = this.convert(
        input,
        output,
        item,
        entry,
        start,
        controller.signal,
        audioTrack,
        () => {
          for (const check of checks) {
            try {
              check();
              return;
            } catch {
              /* Another authorized viewer can keep shared work. */
            }
          }
          throw new DomainError(404, "Playback segment unavailable");
        },
      )
        .catch((error) => {
          if (error instanceof DomainError) throw error;
          throw new DomainError(
            502,
            "Playback conversion failed or was cancelled",
          );
        })
        .finally(() => this.active.delete(key));
    }
    job.checks.add(authorize);
    const timer = setInterval(() => {
      for (const check of job!.checks) {
        try {
          check();
        } catch {
          job!.checks.delete(check);
        }
      }
      if (!job!.checks.size) job!.controller.abort();
    }, 1000);
    timer.unref();
    try {
      const bytes = await job.promise;
      authorize();
      return bytes;
    } finally {
      clearInterval(timer);
      job.checks.delete(authorize);
    }
  }
  private async convert(
    input: string,
    output: string,
    item: Media,
    entry: Entry,
    start: number,
    signal: AbortSignal,
    audioTrack?: number,
    authorize: () => void = () => {},
  ) {
    await this.cleanup();
    const fs = await statfs(this.root);
    invariant(
      fs.bavail * fs.bsize > 32 * 1024 * 1024,
      507,
      "Insufficient playback cache space",
    );
    const technical =
      (JSON.parse(item.metadata_json) as { technical?: Inspection })
        .technical ?? (await probeMedia(input));
    const audio =
      audioTrack === undefined
        ? (technical.streams.find((s) => s.type === "audio" && s.default) ??
          technical.streams.find((s) => s.type === "audio"))
        : technical.streams.find(
            (s) => s.type === "audio" && s.index === audioTrack,
          );
    invariant(audioTrack === undefined || audio, 400, "Invalid audio track");
    const duration = (Math.min(segmentMs, entry.end_ms - start) / 1000).toFixed(
        3,
      ),
      offset = ((entry.offset_ms + start - entry.start_ms) / 1000).toFixed(3),
      temporary = output + ".partial.ts";
    const args = [
      "-ss",
      offset,
      "-i",
      input,
      ...(audio
        ? []
        : [
            "-f",
            "lavfi",
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=48000",
          ]),
      "-t",
      duration,
      "-map",
      "0:v:0",
      "-map",
      audio ? `0:${audio.index}` : "1:a:0",
      "-vf",
      "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1",
      "-r",
      "30",
      "-c:v",
      "libx264",
      "-threads",
      "2",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-b:v",
      "1500k",
      "-maxrate",
      "2000k",
      "-bufsize",
      "4000k",
      "-g",
      "120",
      "-sc_threshold",
      "0",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-b:a",
      "128k",
      "-avoid_negative_ts",
      "make_zero",
      "-mpegts_flags",
      "+resend_headers",
      "-fs",
      "8388608",
      "-f",
      "mpegts",
      temporary,
    ];
    try {
      signal.throwIfAborted();
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(60000)]);
      await this.encoders.run("interactive", deadline, authorize, () =>
        this.execute(args, deadline),
      );
      signal.throwIfAborted();
      const after = await stat(input);
      invariant(
        after.size === item.size && after.mtimeMs === item.mtime_ms,
        409,
        "Source changed while streaming",
      );
      const bytes = await readFile(temporary);
      invariant(
        bytes.length > 0 && bytes.length < 8388608,
        502,
        "Invalid playback output",
      );
      await rename(temporary, output);
      return bytes;
    } finally {
      await rm(temporary, { force: true });
    }
  }
  cleanup(now = Date.now()): Promise<void> {
    this.cleanupJob ??= this.evictCache(now).finally(() => {
      this.cleanupJob = undefined;
    });
    return this.cleanupJob;
  }
  private async evictCache(now: number) {
    await mkdir(this.root, { recursive: true });
    const files: { path: string; size: number; mtime: number }[] = [];
    for (const name of await readdir(this.root)) {
      if (!/^[a-f0-9]{64}\.ts$/.test(name)) continue;
      const path = join(this.root, name);
      try {
        const info = await stat(path);
        files.push({ path, size: info.size, mtime: info.mtimeMs });
      } catch (error) {
        // A concurrent conversion/maintenance cleanup may have removed this cache entry.
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ))
          throw error;
      }
    }
    files.sort((a, b) => a.mtime - b.mtime);
    let bytes = files.reduce((n, f) => n + f.size, 0);
    for (const file of files)
      if (
        file.mtime < now - 10 * 60000 ||
        bytes > this.maxBytes - 16 * 1024 * 1024
      ) {
        await rm(file.path, { force: true });
        bytes -= file.size;
      }
  }
  async stop() {
    this.stopping = true;
    for (const job of this.active.values()) job.controller.abort();
    await Promise.allSettled([
      ...this.pending,
      ...[...this.active.values()].map((j) => j.promise),
    ]);
  }
}
