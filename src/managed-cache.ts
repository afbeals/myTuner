import { writeFile as writeDescriptor } from "node:fs";
import { OutputPaths } from "./output-paths.js";
import { outputCleanupDisabled, type SafetyStore } from "./storage-safety.js";
import { randomUUID } from "node:crypto";
import { lstat, opendir, readFile, rm, statfs, utimes } from "node:fs/promises";
import { join } from "node:path";
import { invariant } from "./domain.js";

// This cache owns only hash-named files in one configured writable directory.
// Serialize publication/reclamation; FFmpeg partials count toward the budget but are never evicted while fresh.
export class ManagedCache {
  private tail: Promise<unknown> = Promise.resolve();
  private touched = new Map<string, number>();
  private readonly outputs: OutputPaths;
  constructor(
    private readonly root: string,
    private readonly budget = 64 * 1024 ** 2,
    private readonly reserve = 32 * 1024 ** 2,
    private readonly ttl = 86400000,
    private readonly store?: SafetyStore,
  ) {
    this.outputs = new OutputPaths(root, store);
  }
  private async exclusive<T>(work: () => Promise<T>) {
    const next = this.tail.catch(() => {}).then(work);
    this.tail = next.catch(() => {});
    return next;
  }
  private path(name: string) {
    invariant(
      /^[a-f0-9]{64}\.(vtt|json)$/.test(name),
      400,
      "Invalid managed cache name",
    );
    return join(this.root, name);
  }
  get(name: string, check: () => void): Promise<Buffer | null> {
    return this.exclusive(async () => {
      check();
      this.outputs.create([]);
      const path = this.path(name),
        info = await lstat(path).catch((error) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
      if (!info) return null;
      invariant(
        info.isFile() && !info.isSymbolicLink() && info.size <= 15 * 1024 ** 2,
        502,
        "Invalid managed cache file",
      );
      if (info.mtimeMs < Date.now() - this.ttl) {
        if (!outputCleanupDisabled(this.store)) await rm(path);
        return null;
      }
      const bytes = await readFile(path);
      check();
      const now = Date.now();
      if (
        !outputCleanupDisabled(this.store) &&
        now - (this.touched.get(name) ?? 0) >= Math.min(60000, this.ttl / 4)
      ) {
        await utimes(path, new Date(now), new Date(now));
        if (this.touched.size >= 512)
          this.touched.delete(this.touched.keys().next().value!);
        this.touched.set(name, now);
      }
      check();
      return bytes;
    });
  }
  private async reclaim(
    required: number,
    check: () => void,
    replacement?: string,
  ) {
    check();
    this.outputs.create([]);
    let used = 0,
      count = 0,
      replaced = 0;
    const candidates: {
      path: string;
      size: number;
      time: number;
      expired: boolean;
    }[] = [];
    for await (const entry of await opendir(this.root)) {
      check();
      invariant(
        ++count <= 4096,
        507,
        "Cache exceeds bounded cleanup limit; operator review required",
      );
      const path = join(this.root, entry.name),
        info = await lstat(path);
      invariant(
        info.isFile() && !info.isSymbolicLink(),
        409,
        "Managed cache contains an unexpected entry",
      );
      used += info.size;
      if (entry.name === replacement) {
        replaced = info.size;
        continue;
      }
      const final = /^[a-f0-9]{64}\.(json|vtt)$/.test(entry.name);
      const oldPartial =
        /^[a-f0-9]{64}\.(?:(?:json|vtt)\.[a-f0-9-]+\.partial|[a-f0-9-]+\.partial\.vtt)$/.test(
          entry.name,
        ) && info.mtimeMs < Date.now() - 3600000;
      if (final || oldPartial)
        candidates.push({
          path,
          size: info.size,
          time: info.mtimeMs,
          expired: oldPartial || info.mtimeMs < Date.now() - this.ttl,
        });
    }
    const filesystem = await statfs(this.root);
    let free = filesystem.bavail * filesystem.bsize;
    for (const candidate of candidates.sort(
      (a, b) => Number(b.expired) - Number(a.expired) || a.time - b.time,
    )) {
      if (
        !candidate.expired &&
        used - replaced + required <= this.budget &&
        free - required >= this.reserve
      )
        break;
      check();
      if (outputCleanupDisabled(this.store)) break;
      this.outputs.capture();
      await rm(candidate.path);
      used -= candidate.size;
      free += candidate.size;
    }
    check();
    invariant(
      used - replaced + required <= this.budget &&
        free - required >= this.reserve,
      507,
      "Insufficient managed cache space",
    );
  }
  ensure(required: number, check: () => void) {
    return this.exclusive(() => this.reclaim(required, check));
  }
  publish(name: string, bytes: Buffer, check: () => void) {
    return this.exclusive(async () => {
      this.outputs.create([]);
      const path = this.path(name);
      // Existing/replacement files must also be regular managed files.
      const existing = await lstat(path).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      invariant(
        !existing || (existing.isFile() && !existing.isSymbolicLink()),
        409,
        "Invalid managed cache destination",
      );
      invariant(
        !existing || !outputCleanupDisabled(this.store),
        409,
        "Existing cache output is preserved after a data reset; configure a new dedicated empty cache root to replace it",
      );
      await this.reclaim(bytes.length, check, name);
      const stage = this.outputs.stage(name + "." + randomUUID() + ".partial");
      try {
        check();
        await new Promise<void>((resolve, reject) =>
          writeDescriptor(stage.fd, bytes, (error) =>
            error ? reject(error) : resolve(),
          ),
        );
        check();
        this.outputs.publish(stage, this.outputs.prepare(name, false));
        check();
      } finally {
        this.outputs.close(stage);
      }
    });
  }
}
