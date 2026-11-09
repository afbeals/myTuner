import type { Inspection } from "./catalog.js";
import type { Media } from "./domain.js";
export const textSubtitleCodecs = new Set([
  "subrip",
  "ass",
  "ssa",
  "webvtt",
  "mov_text",
  "text",
]);
export interface Capabilities {
  containers: string[];
  videoCodecs: string[];
  audioCodecs: string[];
}
export function playbackDecision(
  item: Media,
  capabilities: Capabilities,
  interval?: { kind: string; startMs: number; endMs: number; offsetMs: number },
) {
  const technical = (
    JSON.parse(item.metadata_json) as { technical?: Inspection }
  ).technical;
  const container = item.relative_path.split(".").at(-1)!.toLowerCase();
  const video = technical?.streams.find((s) => s.type === "video");
  const audio =
    technical?.streams.find((s) => s.type === "audio" && s.default) ??
    technical?.streams.find((s) => s.type === "audio");
  const cutCommercial =
    interval?.kind === "commercial" &&
    interval.offsetMs + interval.endMs - interval.startMs < item.duration_ms;
  const reasons = [
    ...(!technical
      ? ["Technical metadata has not been scanned"]
      : !video
        ? ["No usable video track in stored metadata"]
        : []),
    ...(cutCommercial
      ? ["Commercial is shortened to its scheduled interval"]
      : []),
    ...(!capabilities.containers.includes(container)
      ? ["Container requires conversion for these declared capabilities"]
      : []),
    ...(video && !capabilities.videoCodecs.includes(video.codec)
      ? ["Video codec requires conversion"]
      : []),
    ...(audio && !capabilities.audioCodecs.includes(audio.codec)
      ? ["Default audio codec requires conversion"]
      : []),
  ];
  const mode = reasons.length ? ("hls" as const) : ("direct" as const);
  return {
    mode,
    status: !technical || !video ? ("unknown" as const) : mode,
    reasons,
    subtitles:
      technical?.streams
        .filter((s) => s.type === "subtitle")
        .map((s) => ({
          index: s.index,
          codec: s.codec,
          language: s.language ?? null,
          supported: textSubtitleCodecs.has(s.codec),
        })) ?? [],
  };
}
