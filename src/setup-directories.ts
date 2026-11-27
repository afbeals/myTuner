import { opendir, realpath, stat } from "node:fs/promises";
import type { Dir } from "node:fs";
import { basename, join } from "node:path";
import type { Store } from "./database.js";
import { DomainError, invariant } from "./domain.js";
import { canonicalPath, containsPath } from "./catalog.js";
import { normalizeSubtree } from "./security.js";
import type { PathSuggestions } from "./setup-suggestions.js";
type Purpose = "source" | "metadata" | "subtitles";
type Input = {
  root: string;
  parent: string;
  offset: number;
  purpose: Purpose;
  sourceId?: string | undefined;
};
type Page = {
  items: { id: string; path: string; label: string }[];
  offset: number;
  limit: number;
  hasMore: boolean;
  partial: boolean;
};
type Listing = {
  directory: Dir | null;
  pages: Map<number, Page>;
  nextOffset: number;
  examined: number;
  touched: number;
  pending: Promise<Page> | null;
};
/** Explicit setup browsing only. Bounded open handles and pages; never inspect videos. */
export class SetupDirectories {
  private listings = new Map<string, Listing>();
  private pending = new Set<Promise<unknown>>();
  private stopped = false;
  private stopping = new AbortController();
  private lane: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setInterval>;
  constructor(
    private store: Store,
    private suggestions: Pick<PathSuggestions, "read">,
    private writableRoots: string[],
    private limits = { requests: 8, milliseconds: 10_000, shutdownMs: 2000 },
  ) {
    this.timer = setInterval(() => {
      void this.trim();
    }, 15_000);
    this.timer.unref();
  }
  private async close(listing: Listing) {
    await listing.directory?.close().catch(() => {});
    listing.directory = null;
  }
  private async trim() {
    for (const [key, listing] of this.listings) {
      if (!listing.pending && Date.now() - listing.touched > 60_000) {
        this.listings.delete(key);
        await this.close(listing);
      }
    }
  }
  async stop() {
    this.stopped = true;
    this.stopping.abort(new DomainError(503, "Server is stopping"));
    clearInterval(this.timer);
    // Kernel filesystem calls cannot be cancelled. Late work keeps its admission
    // and closes its own handles, but cannot touch the database after shutdown.
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled([...this.pending]),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, this.limits.shutdownMs);
      }),
    ]);
    clearTimeout(timer);
    for (const [key, listing] of this.listings) {
      if (!listing.pending) {
        this.listings.delete(key);
        await this.close(listing);
      }
    }
  }
  async read(input: Input, authorize: () => void, signal?: AbortSignal) {
    invariant(!this.stopped, 503, "Server is stopping");
    invariant(
      this.pending.size < this.limits.requests,
      429,
      "Folder browser is busy. Retry shortly.",
    );
    signal?.throwIfAborted();
    const deadline = new AbortController();
    const timer = setTimeout(
      () =>
        deadline.abort(
          new DomainError(
            408,
            "Folder choices took too long. Retry when storage is available.",
          ),
        ),
      this.limits.milliseconds,
    );
    const combined = AbortSignal.any([
      this.stopping.signal,
      deadline.signal,
      ...(signal ? [signal] : []),
    ]);
    const check = () => {
      combined.throwIfAborted();
      invariant(!this.stopped, 503, "Server is stopping");
      authorize();
    };
    const task = this.lane.then(() => {
      check();
      return this.browse(input, check);
    });
    this.lane = task.catch(() => {});
    this.pending.add(task);
    // Admission follows underlying work, even after a disconnected caller returns.
    void task.finally(() => this.pending.delete(task)).catch(() => {});
    let abort: (() => void) | undefined;
    try {
      return await Promise.race([
        task,
        new Promise<never>((_, reject) => {
          abort = () => reject(combined.reason);
          combined.addEventListener("abort", abort, { once: true });
          if (combined.aborted) abort();
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (abort) combined.removeEventListener("abort", abort);
    }
  }
  private async browse(input: Input, check: () => void): Promise<Page> {
    check();
    const parent = normalizeSubtree(input.parent),
      suggestions = await this.suggestions.read(
        input.purpose,
        input.sourceId,
        check,
      );
    check();
    const configured = this.store.db
      .prepare("SELECT root_path,subtitle_root,metadata_root FROM sources")
      .all()
      .flatMap((row) =>
        [row.root_path, row.subtitle_root, row.metadata_root].filter(
          (root): root is string => typeof root === "string",
        ),
      );
    const permitted = [
      ...suggestions.items.map((item) => item.path),
      ...configured,
    ];
    const root = await realpath(input.root);
    check();
    let allowed = false;
    for (const candidate of permitted.filter(
      (candidate) =>
        containsPath(candidate, root) || containsPath(candidate, input.root),
    )) {
      try {
        const canonical = await realpath(candidate);
        check();
        if (containsPath(canonical, root)) {
          allowed = true;
          break;
        }
      } catch {
        check();
      }
    }
    invariant(
      allowed,
      403,
      "Choose a mounted media directory or a configured source. Other server folders cannot be browsed.",
    );
    const path = await realpath(join(root, parent));
    check();
    invariant(
      containsPath(root, path),
      403,
      "Folder is outside the selected directory",
    );
    for (const candidate of this.writableRoots) {
      const writable = await canonicalPath(candidate);
      check();
      invariant(
        !containsPath(path, writable) && !containsPath(writable, path),
        403,
        "Application storage cannot be browsed as media",
      );
    }
    const info = await stat(path);
    check();
    invariant(info.isDirectory(), 400, "Choose a directory");
    check();
    const key = JSON.stringify([
      root,
      parent,
      info.dev,
      info.ino,
      info.mtimeMs,
    ]);
    let listing = this.listings.get(key);
    if (!listing) {
      await this.trim();
      check();
      while (this.listings.size >= 8) {
        const victim = [...this.listings.entries()].find(
          ([, value]) => !value.pending,
        );
        invariant(victim, 429, "Folder browser is busy. Retry shortly.");
        this.listings.delete(victim[0]);
        await this.close(victim[1]);
        check();
      }
      // Recheck after awaited closes; synchronous reservation keeps the handle limit firm.
      invariant(
        this.listings.size < 8,
        429,
        "Folder browser is busy. Retry shortly.",
      );
      listing = {
        directory: null,
        pages: new Map(),
        nextOffset: 0,
        examined: 0,
        touched: Date.now(),
        pending: null,
      };
      this.listings.set(key, listing);
      try {
        listing.directory = await opendir(path);
        check();
      } catch (error) {
        this.listings.delete(key);
        await this.close(listing);
        throw error;
      }
    }
    listing.touched = Date.now();
    if (listing.pending) {
      await listing.pending;
      check();
    }
    const cached = listing.pages.get(input.offset);
    if (cached) return cached;
    invariant(
      input.offset === listing.nextOffset && listing.directory,
      409,
      "Folder choices expired or changed. Refresh folder choices and start again.",
    );
    const current = listing;
    const work = (async () => {
      const items: Page["items"] = [];
      let finished = false,
        read = 0;
      while (items.length < 50 && read < 256 && current.examined < 8192) {
        check();
        const entry = await current.directory!.read();
        check();
        if (!entry) {
          finished = true;
          break;
        }
        read++;
        current.examined++;
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const relative = parent ? `${parent}/${entry.name}` : entry.name;
        // Do not surface application storage mounted beneath an otherwise permitted media root.
        const child = join(path, entry.name);
        if (
          this.writableRoots.some(
            (writable) =>
              containsPath(child, writable) || containsPath(writable, child),
          )
        )
          continue;
        items.push({ id: relative, path: relative, label: basename(relative) });
      }
      check();
      const capped = current.examined >= 8192,
        page: Page = {
          items,
          offset: input.offset,
          limit: 50,
          hasMore: !finished && !capped,
          partial: capped,
        };
      current.pages.set(input.offset, page);
      current.nextOffset = input.offset + 50;
      current.touched = Date.now();
      while (current.pages.size > 16)
        current.pages.delete(current.pages.keys().next().value!);
      if (!page.hasMore) await this.close(current);
      return page;
    })();
    current.pending = work;
    try {
      return await work;
    } catch (error) {
      this.listings.delete(key);
      await this.close(current);
      throw error;
    } finally {
      current.pending = null;
    }
  }
}
