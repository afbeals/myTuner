import type { Track } from "./types.js";
export type ViewingPreferences = {
  audio: string | null;
  subtitle: string | null;
  subtitleOff: boolean;
  size: "normal" | "large" | "largest";
  background: "dark" | "shadow";
};
const defaults: ViewingPreferences = {
  audio: null,
  subtitle: null,
  subtitleOff: true,
  size: "normal",
  background: "dark",
};
export function language(value: string | undefined | null) {
  const tag = value?.trim().toLowerCase().replaceAll("_", "-").split("-")[0];
  if (!tag || tag === "und") return null;
  try {
    return new Intl.Locale(tag).language;
  } catch {
    return tag;
  }
}
export function matchLanguage(preferred: string | null, tracks: Track[]) {
  const wanted = language(preferred);
  return wanted
    ? (tracks.find((t) => language(t.language) === wanted)?.index ?? -1)
    : -1;
}

export function readPreferences(profileId: string): ViewingPreferences {
  try {
    const v = JSON.parse(
      localStorage.getItem(`mytuner:viewing:${location.origin}:${profileId}`) ??
        "null",
    );
    return {
      audio: typeof v?.audio === "string" ? v.audio : null,
      subtitle: typeof v?.subtitle === "string" ? v.subtitle : null,
      subtitleOff: v?.subtitleOff !== false,
      size: ["normal", "large", "largest"].includes(v?.size)
        ? v.size
        : "normal",
      background: v?.background === "shadow" ? "shadow" : "dark",
    };
  } catch {
    return { ...defaults };
  }
}
export function storePreferences(profileId: string, value: ViewingPreferences) {
  try {
    localStorage.setItem(
      `mytuner:viewing:${location.origin}:${profileId}`,
      JSON.stringify(value),
    );
  } catch {
    /* Playback remains usable when local storage is unavailable. */
  }
}
