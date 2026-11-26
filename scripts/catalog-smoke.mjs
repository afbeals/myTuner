// Run after build:server. Uses compiled production workers and Node built-ins only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { Store } from "../dist/database.js";
import { CatalogService } from "../dist/catalog-service.js";

const root = await mkdtemp(join(tmpdir(), "mytuner-compiled-catalog-"));
const store = new Store(join(root, "catalog.db"));
const reader = new CatalogService(store, { timeoutMs: 30000 });
const large = process.argv.includes("--large");
const count = large ? 8000 : 120;
let tick;
try {
  const account = {
    id: randomUUID(),
    username: "synthetic",
    role: "admin",
    disabled: 0,
  };
  const profileId = randomUUID();
  store.db
    .prepare(
      "INSERT INTO accounts(id,username,password_hash,role,created_at) VALUES(?,?,'unused','admin',0)",
    )
    .run(account.id, account.username);
  store.db
    .prepare(
      "INSERT INTO profiles(id,name,kind,owner_account_id) VALUES(?,'Synthetic','person',?)",
    )
    .run(profileId, account.id);
  const sources = ["shows", "movies", "videos"].map((kind) => ({
    id: randomUUID(),
    kind,
  }));
  for (const source of sources)
    store.db
      .prepare("INSERT INTO sources(id,name,root_path,kind) VALUES(?,?,?,?)")
      .run(source.id, source.kind, `/synthetic/${source.kind}`, source.kind);
  const insert = store.db.prepare(
    "INSERT INTO media(id,source_id,relative_path,title,duration_ms,size,mtime_ms,metadata_json) VALUES(?,?,?,?,1000,1,0,?)",
  );
  const imported = store.db.prepare(
    "INSERT INTO integration_metadata VALUES(?,?,?,?,?)",
  );
  store.transaction(() => {
    for (let i = 0; i < count; i++) {
      const source = sources[i % sources.length];
      const id = randomUUID(),
        group = Math.floor(i / 30),
        title = `Synthetic ${String(i).padStart(6, "0")}`;
      const provider = source.kind === "shows" ? "sonarr" : "radarr";
      const data = {
        title,
        seriesId: source.kind === "shows" ? group : undefined,
        seriesTitle: source.kind === "shows" ? `Series ${group}` : undefined,
        seasonNumber: source.kind === "shows" ? 1 : undefined,
        episodeNumber: source.kind === "shows" ? (i % 30) + 1 : undefined,
        collection:
          source.kind === "movies"
            ? { title: `Collection ${group}`, tmdbId: group }
            : undefined,
        overview: "Synthetic plot and cast metadata. ".repeat(
          Math.ceil(((2 + (i % 3) * 4) * 1024) / 33),
        ),
        images: [
          { coverType: "poster", remoteUrl: `https://metadata.invalid/${id}` },
        ],
        ...(source.kind !== "videos"
          ? { integrationReference: { provider, externalId: String(i) } }
          : {}),
      };
      const json = JSON.stringify(data);
      insert.run(id, source.id, `Group ${group}/${title}.mkv`, title, json);
      if (source.kind !== "videos")
        imported.run(source.id, provider, String(i), id, json);
    }
  });
  global.gc?.();
  const baseline = process.memoryUsage().rss;
  let maxRss = baseline,
    maxLag = 0,
    last = performance.now();
  tick = setInterval(() => {
    const now = performance.now();
    maxLag = Math.max(maxLag, now - last - 10);
    last = now;
    maxRss = Math.max(maxRss, process.memoryUsage().rss);
  }, 10);
  const start = performance.now();
  const input = { search: "Synthetic", kind: "all", offset: 0, limit: 24 };
  const page = await reader.libraryPage(account, profileId, input);
  reader.assertCurrent(page, account, profileId);
  const coldMs = performance.now() - start;
  const warmStart = performance.now();
  const next = await reader.libraryPage(account, profileId, {
    ...input,
    offset: 24,
  });
  reader.assertCurrent(next, account, profileId);
  assert.equal(page.pagination.total, next.pagination.total);
  assert.equal(page.pagination.limit, 24);
  const warmMs = performance.now() - warmStart;
  const media = await reader.mediaPage(account, profileId, {
    search: "Synthetic",
    page: 1,
    limit: 24,
  });
  assert.equal(media.total, count);
  assert.equal(media.items.length, 24);
  await new Promise((resolve) => setTimeout(resolve, 15));
  console.log(
    JSON.stringify({
      compiledWorker: true,
      count,
      coldMs,
      warmMs,
      maxEventLoopDelayMs: maxLag,
      baselineRssMiB: baseline / 1048576,
      sampledPeakRssMiB: maxRss / 1048576,
      processPeakRssMiB: process.resourceUsage().maxRSS / 1024,
      note: "Local synthetic file-backed fixture; creation warms page cache. RSS includes all worker threads.",
    }),
  );
} finally {
  clearInterval(tick);
  await reader.stop();
  store.close();
  await rm(root, { recursive: true, force: true });
}
