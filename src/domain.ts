export type Role = "admin" | "editor" | "viewer";
export type SourceKind = "shows" | "movies" | "videos" | "commercials";
export interface Account {
  id: string;
  username: string;
  role: Role;
  disabled: number;
  sessionHash?: string;
}
export interface Source {
  id: string;
  name: string;
  root_path: string;
  metadata_root?: string | null;
  subtitle_root?: string | null;
  subtitle_config?: string;
  subtitle_revision?: number;
  kind: SourceKind;
  recursive: number;
}
export interface Media {
  id: string;
  source_id: string;
  relative_path: string;
  title: string;
  duration_ms: number;
  size: number;
  mtime_ms: number;
  available: number;
  metadata_json: string;
}
export interface Channel {
  id: string;
  name: string;
  owner_account_id: string | null;
  visibility: "shared" | "private";
  short_name?: string | null;
  description?: string;
  details_revision?: number;
}
export interface ScheduleEntry {
  id: string;
  channelId: string;
  mediaId: string;
  programId: string;
  startMs: number;
  endMs: number;
  offsetMs: number;
  kind: "program" | "commercial";
}
export class DomainError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export function invariant(
  condition: unknown,
  status: number,
  message: string,
): asserts condition {
  if (!condition) throw new DomainError(status, message);
}
