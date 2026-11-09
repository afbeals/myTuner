import type { Store } from "./database.js";
import {
  advertisedSubtitles,
  externalTrackBase,
  resolveSubtitle,
  storedSubtitles,
} from "./subtitle-catalog.js";
import { EncoderAdmission } from "./encoder-admission.js";
import { textSubtitleCodecs } from "./playback-policy.js";
export { textSubtitleCodecs } from "./playback-policy.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Media, Source } from "./domain.js";
import { invariant } from "./domain.js";
import { safeMediaPath, probeMedia } from "./catalog.js";
import type { Inspection } from "./catalog.js";
import { runFFmpeg } from "./generation.js";
import { ManagedCache } from "./managed-cache.js";
export class SubtitleService {
  private active = new Set<{
    controller: AbortController;
    promise: Promise<Buffer>;
  }>();
  private stopping = false;
  private readonly cache: ManagedCache;
  constructor(
    private readonly root: string,
    private readonly encode = runFFmpeg,
    private readonly encoders = new EncoderAdmission(),
    private readonly store?: Store,
  ) {
    this.cache = new ManagedCache(root);
  }
  private pending = new Set<Promise<Buffer>>();
  get(
    source: Source,
    item: Media,
    index: number,
    authorize: () => void,
  ): Promise<Buffer> {
    const pending = this.read(source, item, index, authorize);
    this.pending.add(pending);
    return pending.finally(() => this.pending.delete(pending));
  }
  private async read(
    source: Source,
    item: Media,
    index: number,
    authorize: () => void,
  ): Promise<Buffer> {
    const external =
      index >= externalTrackBase && this.store
        ? storedSubtitles(this.store, item.id).find(
            (track) => track.index === index,
          )
        : undefined;
    const check = () => {
      invariant(!this.stopping, 503, "Subtitle service is stopping");
      authorize();
      if (index >= externalTrackBase) {
        invariant(
          this.store &&
            external &&
            advertisedSubtitles(this.store, item, "").some(
              (track) => track.index === index,
            ),
          404,
          "Subtitle unavailable; check files again",
        );
        const fresh = storedSubtitles(this.store, item.id).find(
          (track) => track.index === index,
        );
        invariant(
          fresh &&
            fresh.size === external.size &&
            fresh.mtimeMs === external.mtimeMs &&
            fresh.signature === external.signature,
          409,
          "Subtitle changed; check files again",
        );
      }
    };
    check();
    const video = await safeMediaPath(source, item.relative_path),
      info = await stat(video);
    invariant(
      info.size === item.size && info.mtimeMs === item.mtime_ms,
      409,
      "Media changed; rescan before playback",
    );
    const resolved = external ? await resolveSubtitle(source, external) : null;
    const input = resolved?.path ?? video;
    if (external)
      invariant(
        resolved?.info.size === external.size &&
          resolved.info.mtimeMs === external.mtimeMs,
        409,
        "Subtitle changed; check files again",
      );
    else {
      const technical =
        (JSON.parse(item.metadata_json) as { technical?: Inspection })
          .technical ?? (await probeMedia(video));
      const track = technical.streams.find(
        (s) => s.type === "subtitle" && s.index === index,
      );
      invariant(
        track && textSubtitleCodecs.has(track.codec),
        422,
        "Subtitle track requires an unsupported image/burn-in path",
      );
    }
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          item.id,
          item.size,
          item.mtime_ms,
          index,
          external
            ? [external.signature, external.size, external.mtimeMs]
            : null,
          "vtt-v3",
        ]),
      )
      .digest("hex");
    await mkdir(this.root, { recursive: true });
    const cached = await this.cache.get(key + ".vtt", check);
    if (cached) return cached;
    check();
    invariant(
      this.active.size < 1,
      429,
      "Subtitle extraction is busy; retry shortly",
    );
    const controller = new AbortController(),
      temporary = join(this.root, key + "." + randomUUID() + ".partial.vtt");
    const task = { controller, promise: Promise.resolve(Buffer.alloc(0)) };
    this.active.add(task);
    const timer = setInterval(() => {
      try {
        check();
      } catch {
        controller.abort();
      }
    }, 1000);
    timer.unref();
    task.promise = (async () => {
      await this.cache.ensure(10 * 1024 * 1024, check);
      check();
      controller.signal.throwIfAborted();
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(60000),
      ]);
      await this.encoders.run("interactive", signal, check, () =>
        this.encode(
          [
            ...(external
              ? ["-protocol_whitelist", "file,pipe", "-f", external.format]
              : []),
            "-i",
            input,
            "-map",
            external ? "0:0" : `0:${index}`,
            "-c:s",
            "webvtt",
            "-fs",
            String(10 * 1024 * 1024),
            temporary,
          ],
          signal,
        ),
      );
      const size = (await stat(temporary)).size;
      invariant(
        size > 0 && size < 10 * 1024 * 1024,
        502,
        "Subtitle output exceeds limit",
      );
      const after = await stat(video);
      if (external) {
        const current = await resolveSubtitle(source, external);
        invariant(
          current.path === input &&
            current.info.size === external.size &&
            current.info.mtimeMs === external.mtimeMs,
          409,
          "Subtitle changed during conversion",
        );
      }
      invariant(
        after.size === item.size && after.mtimeMs === item.mtime_ms,
        409,
        "Source changed during subtitle extraction",
      );
      check();
      const bytes = await readFile(temporary);
      if (external)
        invariant(
          /\d{2}:\d{2}(?::\d{2})?\.\d{3}\s+-->\s+\d/.test(
            bytes.toString("utf8"),
          ),
          422,
          "Subtitle contains no usable timed text",
        );
      check();
      await this.cache.publish(key + ".vtt", bytes, check);
      return bytes;
    })().finally(async () => {
      clearInterval(timer);
      this.active.delete(task);
      await rm(temporary, { force: true });
    });
    return task.promise;
  }
  async stop() {
    this.stopping = true;
    for (const task of this.active) task.controller.abort();
    await Promise.allSettled([
      ...this.pending,
      ...[...this.active].map((t) => t.promise),
    ]);
  }
}
