export interface Account {
  id: string;
  username: string;
  role: "admin" | "editor" | "viewer";
  disabled: boolean;
}
export interface Profile {
  id: string;
  name: string;
  kind: "person" | "room";
  ownerAccountId: string | null;
  pinProtected: boolean;
  locked: boolean;
}
export interface Source {
  id: string;
  name: string;
  rootPath?: string;
  metadataRoot?: string | null;
  kind: "shows" | "movies" | "videos" | "commercials";
  recursive?: boolean;
}
export interface Channel {
  id: string;
  name: string;
  visibility: "private" | "shared";
  ownerAccountId?: string;
  archived?: boolean;
  shortName: string;
  shortNameOverride: string | null;
  description?: string;
  detailsRevision?: number;
}
export interface Metadata {
  seriesTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  year?: number;
  overview?: string;
  images?: { url?: string; index: number; coverType: string }[];
}
export interface Media {
  id: string;
  sourceId: string;
  title: string;
  relativePath?: string;
  durationMs: number;
  available: boolean;
  metadata: Metadata;
}
export interface Entry {
  id: string;
  channelId?: string;
  mediaId: string;
  programId: string;
  title?: string;
  startMs: number;
  endMs: number;
  offsetMs: number;
  kind: "program" | "commercial";
  available?: boolean | number;
}
export interface GuideChannel extends Channel {
  error: string | null;
  entries: Entry[];
}
export interface Playback {
  id: string;
  profileId: string;
  channelId: string;
  revisionId: string;
  positionMs: number;
  paused: boolean;
  behindLiveMs: number;
  available: boolean;
  playback: { entry: Entry; offsetMs: number } | null;
  context?: {
    title: string;
    description: string;
    seriesTitle: string | null;
    seasonNumber: number | null;
    episodeNumber: number | null;
    kind: "program" | "commercial";
    entryDurationMs: number;
    remainingMs: number;
    airing: { startMs: number; endMs: number };
    next: { title: string; startMs: number } | null;
    program: {
      title: string;
      seriesTitle: string | null;
      seasonNumber: number | null;
      episodeNumber: number | null;
    } | null;
  } | null;
}
export interface Track {
  index: number;
  type: string;
  codec: string;
  language?: string;
  title?: string;
  url?: string;
}
export interface Delivery {
  mode: "direct" | "hls";
  url: string;
  sourceOffsetMs: number;
  intervalEndMs: number;
  tracks: Track[];
}
export type Selection =
  | {
      type: "show";
      sourceId: string;
      key: string;
      season?: number;
      includeSpecials: boolean;
    }
  | { type: "folder"; sourceId: string; directory: string; recursive: boolean }
  | { type: "movieCollection"; sourceId: string; key: string }
  | { type: "collection"; id: string }
  | { type: "media"; ids: string[] };
export interface Rules {
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
export interface Programming {
  profileId: string;
  groups: {
    id: string;
    mode: "ordered" | "shuffle" | "random";
    episodesPerTurn?: number;
    selection: Selection;
  }[];
  checkpointActions?: (
    | { groupId: string; action: "restart" }
    | { groupId: string; action: "startAt"; mediaId: string }
  )[];
  commercialSelection?: Selection;
  disabledCommercialIds?: string[];
  rules: Rules;
  seed: number;
}
export interface Library {
  sources: Source[];
  shows: {
    key: string;
    sourceId: string;
    title: string;
    artwork: { mediaId: string; index: number; coverType: string }[];
    seasons: { number: number; available: number; unavailable: number }[];
  }[];
  movies: Media[];
  folders: { sourceId: string; directory: string; available: number }[];
  movieCollections: {
    sourceId: string;
    key: string;
    title: string;
    available: number;
  }[];
}
export interface Collection {
  id: string;
  name: string;
  count: number;
  ownerAccountId: string;
}
export const noBreaks: Rules = {
  between: false,
  positions: [],
  maxClips: 0,
  maxDurationMs: 0,
  repeatAllowance: 1,
  maxPerBreak: 1,
  cooldownMs: 0,
};
