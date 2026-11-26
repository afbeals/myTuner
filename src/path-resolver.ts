import { constants, type Dir, type Stats } from "node:fs";
import { access, lstat, opendir, realpath } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Store } from "./database.js";
import { DomainError, invariant } from "./domain.js";
import { canonicalPath, containsPath, mediaExtensions } from "./catalog.js";
import { sourceById } from "./security.js";

export interface DirectoryCheckInput {
  path: string;
  purpose: "source" | "metadata" | "subtitles";
  sourceId?: string | undefined;
  recursive: boolean;
}
export interface DirectoryCheck {
  status:
    | "found"
    | "empty"
    | "missing"
    | "not-directory"
    | "inaccessible"
    | "invalid"
    | "incomplete";
  exists: boolean | null;
  readableDirectory: boolean | null;
  canonicalPath: string | null;
  samples: string[];
  extensions: Record<string, number>;
  examinedEntries: number;
  examinedDirectories: number;
  complete: boolean;
  reason: string | null;
  message: string;
  maxDepth: number;
  limit: number;
}
const captionExtensions = new Set([
  ".srt",
  ".vtt",
  ".ass",
  ".ssa",
  ".sub",
  ".idx",
  ".sup",
]);
const systemRoots = [
  "/etc",
  "/private/etc",
  "/proc",
  "/sys",
  "/dev",
  "/run",
  "/var/run",
  "/private/var/run",
  "/root",
  "/boot",
  "/bin",
  "/sbin",
  "/usr",
  "/opt",
];
const safeInput = (path: string) =>
  isAbsolute(path) &&
  !/[\0\r\n]/.test(path) &&
  !path
    .split(/[\\/]/)
    .some(
      (part) =>
        part === ".." || part === "." || (part.startsWith(".") && part !== ""),
    );
const allowedLocation = (path: string) =>
  path !== resolve(sep) &&
  !systemRoots.some((root) => containsPath(root, path)) &&
  !/^[a-z]:[\\/](?:windows|program files(?: \(x86\))?|programdata)(?:[\\/]|$)/i.test(
    path,
  );
const interrupted = Symbol("directory-check-timeout");
const initial = (recursive: boolean, limit: number): DirectoryCheck => ({
  status: "incomplete",
  exists: null,
  readableDirectory: null,
  canonicalPath: null,
  samples: [],
  extensions: {},
  examinedEntries: 0,
  examinedDirectories: 0,
  complete: false,
  reason: null,
  message: "Directory check did not complete.",
  maxDepth: recursive ? 2 : 0,
  limit,
});
interface IO {
  access: (path: string, mode: number) => Promise<void>;
  lstat: (path: string) => Promise<Stats>;
  opendir: (path: string) => Promise<Dir>;
  realpath: (path: string) => Promise<string>;
}

/** Explicit read-only sampling, with one underlying operation and no waiting queue.
 * A deadline returns partial feedback but retains admission until blocked I/O drains.
 */
export class PathResolver {
  private active: Promise<DirectoryCheck> | undefined;
  private stopping = new AbortController();
  constructor(
    private readonly store: Store,
    private readonly writableRoots: string[],
    private readonly limits = {
      entries: 256,
      directories: 32,
      samples: 5,
      milliseconds: 2000,
    },
    private readonly io: IO = { access, lstat, opendir, realpath },
  ) {}
  async check(
    input: DirectoryCheckInput,
    authorize: () => void,
    signal?: AbortSignal,
  ): Promise<DirectoryCheck> {
    authorize();
    invariant(
      !this.stopping.signal.aborted,
      503,
      "Directory checks are stopping",
    );
    invariant(
      !this.active,
      429,
      "A directory check is still finishing. Wait briefly, then retry.",
    );
    signal?.throwIfAborted();
    const controller = new AbortController();
    const combined = AbortSignal.any([
      controller.signal,
      this.stopping.signal,
      ...(signal ? [signal] : []),
    ]);
    const result = initial(input.recursive, this.limits.entries);
    const job = this.inspect(input, result, authorize, combined);
    const active = job.finally(() => {
      if (this.active === active) this.active = undefined;
    });
    this.active = active;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        active,
        new Promise<DirectoryCheck>((done) => {
          timer = setTimeout(() => {
            controller.abort(interrupted);
            done({
              ...result,
              samples: [...result.samples],
              extensions: { ...result.extensions },
              status: "incomplete",
              complete: false,
              reason: "time-limit",
              message:
                "The check reached its time limit. Only the reported area was checked; storage may be slow or unavailable.",
            });
          }, this.limits.milliseconds);
          timer.unref();
        }),
      ]);
      authorize();
      signal?.throwIfAborted();
      this.stopping.signal.throwIfAborted();
      return response;
    } finally {
      clearTimeout(timer);
    }
  }
  private async inspect(
    input: DirectoryCheckInput,
    result: DirectoryCheck,
    authorize: () => void,
    signal: AbortSignal,
  ): Promise<DirectoryCheck> {
    const check = () => {
      signal.throwIfAborted();
      authorize();
    };
    const source = input.sourceId
      ? sourceById(this.store, input.sourceId)
      : undefined;
    invariant(
      input.purpose === "source" || source,
      400,
      "Select a source before checking its metadata or subtitle directory",
    );
    const path =
      input.path || (input.purpose === "source" ? "" : source!.root_path);
    if (!safeInput(path) || !allowedLocation(resolve(path)))
      return {
        ...result,
        status: "invalid",
        reason: "location",
        message:
          "Enter an absolute media directory outside system, hidden and application-storage locations.",
      };
    try {
      check();
      const entry = await this.io.lstat(path);
      check();
      result.exists = true;
      if (!entry.isDirectory() || entry.isSymbolicLink())
        return {
          ...result,
          status: entry.isSymbolicLink() ? "invalid" : "not-directory",
          readableDirectory: false,
          reason: entry.isSymbolicLink() ? "link" : "not-directory",
          message: entry.isSymbolicLink()
            ? "Symbolic links are not checked. Enter the real directory path."
            : "This path exists but is not a directory.",
        };
      const canonical = await this.io.realpath(path);
      check();
      if (!allowedLocation(canonical))
        return {
          ...result,
          status: "invalid",
          reason: "location",
          message: "System locations cannot be checked as media directories.",
        };
      for (const writable of new Set(this.writableRoots)) {
        const root = await canonicalPath(writable);
        check();
        if (containsPath(root, canonical) || containsPath(canonical, root))
          return {
            ...result,
            status: "invalid",
            reason: "application-storage",
            message:
              "Media directories and application storage must not overlap.",
          };
      }
      const others = this.store.db
        .prepare("SELECT id,root_path,subtitle_root FROM sources WHERE id<>?")
        .all(input.sourceId ?? "");
      for (const other of others) {
        const roots =
          input.purpose === "metadata"
            ? []
            : [
                String(other.root_path),
                ...(input.purpose === "source" && other.subtitle_root
                  ? [String(other.subtitle_root)]
                  : []),
              ];
        for (const root of roots)
          if (containsPath(root, canonical) || containsPath(canonical, root))
            return {
              ...result,
              status: "invalid",
              reason: "source-overlap",
              message:
                "This directory overlaps another configured source or subtitle location.",
            };
      }
      await this.io.access(canonical, constants.R_OK | constants.X_OK);
      check();
      result.canonicalPath = canonical;
      result.readableDirectory = true;
      const extensions =
        input.purpose === "source"
          ? mediaExtensions
          : input.purpose === "metadata"
            ? new Set([".nfo"])
            : captionExtensions;
      let stop = false;
      const limit = (reason: string) => {
        result.reason ??= reason;
        result.complete = false;
        stop = true;
      };
      const walk = async (directory: string, depth: number): Promise<void> => {
        check();
        if (result.examinedDirectories >= this.limits.directories) {
          limit("directory-limit");
          return;
        }
        const before = await this.io.lstat(directory);
        check();
        if (before.isSymbolicLink() || !before.isDirectory()) {
          result.reason ??= "directory-changed";
          return;
        }
        const safe = await this.io.realpath(directory);
        check();
        if (!containsPath(canonical, safe)) {
          result.reason ??= "directory-changed";
          return;
        }
        let handle;
        try {
          handle = await this.io.opendir(safe);
        } catch (error) {
          if (signal.aborted || error instanceof DomainError) throw error;
          result.reason ??= "unreadable-subdirectory";
          if (depth === 0) throw error;
          return;
        }
        try {
          check();
          const after = await this.io.lstat(directory);
          check();
          if (
            after.isSymbolicLink() ||
            before.dev !== after.dev ||
            before.ino !== after.ino
          ) {
            result.reason ??= "directory-changed";
            return;
          }
          result.examinedDirectories++;
          for (;;) {
            check();
            if (result.examinedEntries >= this.limits.entries) {
              limit("entry-limit");
              return;
            }
            const entry = await handle.read();
            check();
            if (!entry) return;
            result.examinedEntries++;
            if (entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
            if (
              entry.isFile() &&
              extensions.has(extname(entry.name).toLowerCase())
            ) {
              const extension = extname(entry.name).toLowerCase();
              result.extensions[extension] =
                (result.extensions[extension] ?? 0) + 1;
              result.samples.push(
                relative(canonical, join(safe, entry.name))
                  .split(sep)
                  .join("/"),
              );
              if (result.samples.length >= this.limits.samples) {
                limit("sample-limit");
                return;
              }
            } else if (entry.isDirectory() && input.recursive) {
              if (depth < result.maxDepth)
                await walk(join(safe, entry.name), depth + 1);
              else result.reason ??= "depth-limit";
            }
            if (stop) return;
          }
        } finally {
          await handle.close();
        }
      };
      result.complete = true;
      await walk(canonical, 0);
      check();
      result.complete = result.complete && result.reason === null;
      result.status = result.samples.length
        ? "found"
        : result.complete
          ? "empty"
          : "incomplete";
      result.message = result.samples.length
        ? "Supported file names were found in the checked area. Playback has not been inspected."
        : result.complete
          ? "No supported files were found in the checked area."
          : "No supported files were found before the check stopped. Other areas may contain supported files.";
      return result;
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof DomainError) throw error;
      check();
      const code = (error as NodeJS.ErrnoException).code;
      result.complete = false;
      if (result.examinedDirectories > 0) {
        result.status = "incomplete";
        result.reason = "unavailable-subdirectory";
        result.message =
          "Only part of the directory could be checked. A subdirectory or its storage was unavailable.";
      } else if (code === "ENOENT" && result.exists !== true) {
        result.exists = false;
        result.readableDirectory = false;
        result.status = "missing";
        result.reason = "missing";
        result.message =
          "Directory not found. Check the server-visible path and whether its storage is mounted.";
      } else {
        result.status = "inaccessible";
        result.readableDirectory = false;
        result.reason =
          code === "EACCES" || code === "EPERM" ? "permission" : "unavailable";
        result.message =
          result.reason === "permission"
            ? "The server cannot read this directory. Check its directory permissions."
            : "The directory could not be read. Its storage may be unavailable or may have changed.";
      }
      return result;
    }
  }
  async stop() {
    this.stopping.abort();
    await this.active?.catch(() => {});
  }
}
