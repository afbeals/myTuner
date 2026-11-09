import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  opendir,
  readFile,
  rename,
  rm,
  statfs,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { invariant } from "./domain.js";

// This cache owns only hash-named files in one configured writable directory.
// Serialize publication/reclamation; FFmpeg partials count toward the budget but are never evicted while fresh.
export class ManagedCache {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly root: string,
    private readonly budget = 64 * 1024 ** 2,
    private readonly reserve = 32 * 1024 ** 2,
    private readonly ttl = 86400000,
  ) {}
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
      await mkdir(this.root, { recursive: true });
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
        await rm(path);
        return null;
      }
      const bytes = await readFile(path);
      check();
      await utimes(path, new Date(), new Date());
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
    await mkdir(this.root, { recursive: true });
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
      await this.reclaim(bytes.length, check, name);
      const temporary = path + "." + randomUUID() + ".partial";
      try {
        check();
        await writeFile(temporary, bytes, { flag: "wx" });
        check();
        await rename(temporary, path);
        check();
      } finally {
        await rm(temporary, { force: true });
      }
    });
  }
}
