import { createHash } from "node:crypto";
import type { Media } from "./domain.js";
import { invariant } from "./domain.js";
import type { Store } from "./database.js";
import { unseal } from "./refresh.js";
import { ManagedCache } from "./managed-cache.js";
export class ArtworkService {
  private controller = new AbortController();
  private readonly cache: ManagedCache;
  private pending = new Set<Promise<{ type: string; bytes: Buffer }>>();
  constructor(
    private readonly store: Store,
    private readonly root: string,
    private readonly key?: Buffer,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.cache = new ManagedCache(root);
  }
  get(item: Media, index: number): Promise<{ type: string; bytes: Buffer }> {
    const pending = this.read(item, index).finally(() =>
      this.pending.delete(pending),
    );
    this.pending.add(pending);
    return pending;
  }
  async stop() {
    this.controller.abort();
    await Promise.allSettled([...this.pending]);
  }
  private check() {
    invariant(
      !this.controller.signal.aborted,
      503,
      "Artwork service is stopping",
    );
  }
  private async read(
    item: Media,
    index: number,
  ): Promise<{ type: string; bytes: Buffer }> {
    this.check();
    const config = this.store.db
      .prepare(
        "SELECT id,url,encrypted_key FROM integrations WHERE source_id=?",
      )
      .get(item.source_id) as
      { id: string; url: string; encrypted_key: string } | undefined;
    const image = (
      JSON.parse(item.metadata_json) as { images?: { url?: string }[] }
    ).images?.[index];
    invariant(config && image?.url && this.key, 404, "Artwork unavailable");
    const base = new URL(config.url),
      url = new URL(
        image.url,
        base.origin + base.pathname.replace(/\/?$/, "/"),
      );
    const prefix = base.pathname.replace(/\/$/, "");
    invariant(
      url.origin === base.origin &&
        !url.username &&
        !url.password &&
        [prefix + "/MediaCover/", prefix + "/api/v3/MediaCover/"].some((p) =>
          url.pathname.startsWith(p),
        ),
      404,
      "Artwork unavailable",
    );
    url.search = "";
    url.hash = "";
    const fingerprint = createHash("sha256")
      .update(config.id + url.toString())
      .digest("hex");
    const cached = await this.cache.get(fingerprint + ".json", () =>
      this.check(),
    );
    if (cached) {
      const value = JSON.parse(cached.toString("utf8"));
      this.check();
      return { type: value.type, bytes: Buffer.from(value.data, "base64") };
    }
    this.check();
    const signal = AbortSignal.any([
      this.controller.signal,
      AbortSignal.timeout(15000),
    ]);
    const response = await this.fetcher(url, {
        headers: { "X-Api-Key": unseal(this.key, config.encrypted_key) },
        signal,
        redirect: "error",
      }),
      type = response.headers.get("content-type")?.split(";")[0] ?? "";
    this.check();
    signal.throwIfAborted();
    invariant(
      response.ok &&
        ["image/jpeg", "image/png", "image/webp"].includes(type) &&
        response.body,
      502,
      "Artwork request failed",
    );
    const chunks: Buffer[] = [];
    let length = 0;
    const reader = response.body.getReader();
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        length += value.length;
        invariant(length <= 2 * 1024 * 1024, 502, "Artwork exceeds size limit");
        chunks.push(Buffer.from(value));
      }
    } finally {
      signal.removeEventListener("abort", cancel);
      await reader.cancel().catch(() => {});
    }
    this.check();
    const bytes = Buffer.concat(chunks);
    invariant(bytes.length > 0, 502, "Empty artwork");
    await this.cache.publish(
      fingerprint + ".json",
      Buffer.from(JSON.stringify({ type, data: bytes.toString("base64") })),
      () => {
        this.check();
        signal.throwIfAborted();
      },
    );
    this.check();
    signal.throwIfAborted();
    return { type, bytes };
  }
}
