// getRandomValues works on LAN HTTP, where randomUUID is not exposed by browsers.
export function eventId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const s = [...bytes].map((v) => v.toString(16).padStart(2, "0")).join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
export interface Cue {
  start: number;
  end: number;
  text: string;
}
function timestamp(value: string) {
  const parts = value.split(":").map(Number);
  return parts.reduce((n, v) => n * 60 + v, 0) * 1000;
}
export function parseVtt(text: string): Cue[] {
  return text
    .replace(/\r/g, "")
    .split(/\n\n+/)
    .flatMap((block) => {
      const lines = block.split("\n"),
        index = lines.findIndex((l) => l.includes(" --> "));
      if (index < 0 || block.startsWith("NOTE")) return [];
      const match = lines[index]!.match(/^([\d:.]+) --> ([\d:.]+)/);
      if (!match) return [];
      const start = timestamp(match[1]!),
        end = timestamp(match[2]!);
      if (!Number.isFinite(start) || end <= start) return [];
      return [
        {
          start,
          end,
          text: lines
            .slice(index + 1)
            .join("\n")
            .replace(/<[^>]*>/g, ""),
        },
      ];
    });
}
