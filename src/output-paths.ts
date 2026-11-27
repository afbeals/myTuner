import {
  assertSafeOutputRoot,
  assertOutputWritesAllowed,
  outputCleanupDisabled,
  type SafetyStore,
} from "./storage-safety.js";
import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  linkSync,
  readSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import type { BigIntStats } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { invariant } from "./domain.js";

type Identity = { dev: bigint; ino: bigint };
export interface OutputPath {
  path: string;
  relative: string;
  parents: { relative: string; identity: Identity }[];
}
export interface OutputStage {
  path: string;
  name: string;
  fd: number;
  rootFd: number;
  identity: Identity;
}
const same = (a: Identity, b: Identity) => a.dev === b.dev && a.ino === b.ino;

/** App-owned paths are checked independently of cached quota accounting.
 * Linux mutations use pinned directory descriptors. Portable checks and mutations
 * are synchronous so another application request cannot swap a checked parent.
 * The encoder always receives an already-open regular output descriptor.
 */
export class OutputPaths {
  private root: { path: string; identity: Identity } | undefined;
  constructor(
    private readonly configured: string,
    private readonly store?: SafetyStore,
  ) {
    try {
      this.capture();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  capture() {
    assertSafeOutputRoot(this.store, this.configured);
    const info = lstatSync(this.configured, { bigint: true });
    invariant(
      info.isDirectory() && !info.isSymbolicLink(),
      409,
      "Generated root must be a regular directory",
    );
    const path = realpathSync(this.configured);
    invariant(
      !this.root || (this.root.path === path && same(this.root.identity, info)),
      409,
      "Generated root changed; restart after verifying storage",
    );
    this.root ??= { path, identity: info };
    return path;
  }
  create(originals: string[]) {
    assertOutputWritesAllowed(this.store);
    assertSafeOutputRoot(this.store, this.configured);
    let ancestor = this.configured;
    const missing: string[] = [];
    let path: string;
    for (;;) {
      try {
        path = join(realpathSync(ancestor), ...missing);
        break;
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "ENOENT" ||
          dirname(ancestor) === ancestor
        )
          throw error;
        missing.unshift(basename(ancestor));
        ancestor = dirname(ancestor);
      }
    }
    const contains = (a: string, b: string) => {
      const rel = relative(a, b);
      return (
        rel === "" ||
        (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel))
      );
    };
    for (const original of originals)
      invariant(
        !contains(original, path) && !contains(path, original),
        400,
        "Generated output and source must not overlap",
      );
    if (this.root) return this.capture();
    mkdirSync(path, { recursive: true, mode: 0o700 });
    invariant(
      this.capture() === path,
      409,
      "Generated root changed during creation",
    );
    return path;
  }
  private rootDescriptor() {
    const path = this.capture();
    const fd = openSync(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      invariant(
        same(fstatSync(fd, { bigint: true }), this.root!.identity),
        409,
        "Generated root changed",
      );
      return fd;
    } catch (error) {
      closeSync(fd);
      throw error;
    }
  }
  private directory(parts: string[], create: boolean) {
    const root = this.capture(),
      descriptors = [this.rootDescriptor()];
    const parents: OutputPath["parents"] = [];
    let rel = "";
    try {
      for (const part of parts) {
        invariant(
          part !== "" && part !== "." && part !== "..",
          409,
          "Invalid generated directory",
        );
        const parentFd = descriptors.at(-1)!;
        const path =
          process.platform === "linux"
            ? `/proc/self/fd/${parentFd}/${part}`
            : join(root, rel, part);
        let info: BigIntStats;
        try {
          info = lstatSync(path, { bigint: true });
        } catch (error) {
          if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT")
            throw error;
          this.capture();
          mkdirSync(path, { mode: 0o700 });
          info = lstatSync(path, { bigint: true });
        }
        invariant(
          info.isDirectory() && !info.isSymbolicLink(),
          409,
          "Generated output contains a linked or invalid directory",
        );
        const fd = openSync(
          path,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        );
        descriptors.push(fd);
        invariant(
          same(fstatSync(fd, { bigint: true }), info),
          409,
          "Generated directory changed",
        );
        rel = join(rel, part);
        parents.push({ relative: rel, identity: info });
      }
      this.capture();
      return { root, descriptors, parents, fd: descriptors.at(-1)! };
    } catch (error) {
      for (const fd of descriptors.reverse()) closeSync(fd);
      throw error;
    }
  }
  prepare(rel: string, create: boolean): OutputPath {
    if (create) assertOutputWritesAllowed(this.store);
    invariant(
      !rel.startsWith(sep) && !rel.split(sep).includes(".."),
      409,
      "Invalid generated path",
    );
    const directory = this.directory(
      dirname(rel) === "." ? [] : dirname(rel).split(sep),
      create,
    );
    try {
      return {
        path: join(directory.root, rel),
        relative: rel,
        parents: directory.parents,
      };
    } finally {
      for (const fd of directory.descriptors.reverse()) closeSync(fd);
    }
  }
  check(output: OutputPath) {
    const directory = this.directory(
      dirname(output.relative) === "."
        ? []
        : dirname(output.relative).split(sep),
      false,
    );
    try {
      invariant(
        directory.parents.length === output.parents.length &&
          directory.parents.every((parent, i) =>
            same(parent.identity, output.parents[i]!.identity),
          ),
        409,
        "Generated directory changed during generation",
      );
    } finally {
      for (const fd of directory.descriptors.reverse()) closeSync(fd);
    }
  }
  existing(output: OutputPath) {
    this.check(output);
    let info: BigIntStats | null;
    try {
      info = lstatSync(output.path, { bigint: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    invariant(
      info.isFile() && !info.isSymbolicLink(),
      409,
      "Generated output must be a regular file",
    );
    this.check(output);
    return info;
  }
  stage(name: string): OutputStage {
    assertOutputWritesAllowed(this.store);
    invariant(
      /^(?:\.partial-[a-f0-9-]{36}\.(?:jpg|gif|mp4|ts|vtt|json)|[a-f0-9]{64}\.(?:vtt|json)\.[a-f0-9-]{36}\.partial)$/.test(
        name,
      ),
      409,
      "Invalid generated stage",
    );
    const rootFd = this.rootDescriptor(),
      root = this.root!.path;
    let fd: number | undefined;
    try {
      const path =
        process.platform === "linux"
          ? `/proc/self/fd/${rootFd}/${name}`
          : join(root, name);
      fd = openSync(
        path,
        constants.O_RDWR |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      const identity = fstatSync(fd, { bigint: true });
      invariant(identity.isFile(), 409, "Invalid generated stage");
      this.capture();
      return { path: join(root, name), name, fd, rootFd, identity };
    } catch (error) {
      if (fd !== undefined) closeSync(fd);
      closeSync(rootFd);
      throw error;
    }
  }
  publish(stage: OutputStage, output: OutputPath) {
    assertOutputWritesAllowed(this.store);
    this.check(output);
    const directory = this.directory(
      dirname(output.relative) === "."
        ? []
        : dirname(output.relative).split(sep),
      false,
    );
    try {
      invariant(
        directory.parents.every((parent, i) =>
          same(parent.identity, output.parents[i]!.identity),
        ),
        409,
        "Generated directory changed during publication",
      );
      const from =
        process.platform === "linux"
          ? `/proc/self/fd/${stage.rootFd}/${stage.name}`
          : stage.path;
      const to =
        process.platform === "linux"
          ? `/proc/self/fd/${directory.fd}/${basename(output.path)}`
          : output.path;
      invariant(
        same(lstatSync(from, { bigint: true }), stage.identity),
        409,
        "Generated stage changed",
      );
      const existing = this.existing(output);
      if (outputCleanupDisabled(this.store)) {
        invariant(
          !existing,
          409,
          "Existing output is preserved after a data reset; use a new dedicated empty output root to replace it",
        );
        // link is an atomic no-replace publication. close() removes only this
        // operation's inode-verified stage, never a previous destination.
        linkSync(from, to);
      } else renameSync(from, to);
      this.check(output);
    } finally {
      for (const fd of directory.descriptors.reverse()) closeSync(fd);
    }
  }
  read(stage: OutputStage, maximum: number): Buffer {
    const info = fstatSync(stage.fd);
    invariant(
      info.size > 0 && info.size < maximum,
      502,
      "Invalid bounded output size",
    );
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(
        stage.fd,
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      invariant(count > 0, 502, "Incomplete output file");
      offset += count;
    }
    return bytes;
  }
  close(stage: OutputStage) {
    try {
      try {
        if (process.platform !== "linux") this.capture();
        const path =
          process.platform === "linux"
            ? `/proc/self/fd/${stage.rootFd}/${stage.name}`
            : stage.path;
        const info = lstatSync(path, { bigint: true });
        if (
          same(info, stage.identity) &&
          info.isFile() &&
          !info.isSymbolicLink()
        )
          unlinkSync(path);
      } catch {
        /* A renamed root/path is never followed for cleanup. */
      }
    } finally {
      closeSync(stage.fd);
      closeSync(stage.rootFd);
    }
  }
}
