import type { Playback } from "./types.js";
// Controls and staged handovers advance a durable session version. Position
// orders polls within that version, including a held pre-boundary response.
export function olderPlayback(
  next: Playback,
  current: Playback | null,
): boolean {
  if (
    !current ||
    current.id !== next.id ||
    next.stateVersion === undefined ||
    current.stateVersion === undefined
  )
    return false;
  return (
    next.stateVersion < current.stateVersion ||
    (next.stateVersion === current.stateVersion &&
      next.positionMs < current.positionMs)
  );
}
