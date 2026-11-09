import { performance } from "node:perf_hooks";
import { Store } from "../src/database.ts";
import { browseLibrary, programmingOptions } from "../src/library.ts";
const sizes = process.argv.slice(2).map(Number);
for (const size of sizes.length ? sizes : [10000, 50000]) {
  if (!Number.isSafeInteger(size) || size < 1 || size > 200000)
    throw Error("Use 1–200000 synthetic catalog rows");
  const store = new Store(":memory:"),
    owner = { id: "owner", username: "synthetic", role: "editor", disabled: 0 };
  store.db.exec(
    "INSERT INTO accounts VALUES('owner','synthetic','unused','editor',0,0); INSERT INTO profiles(id,name,kind,owner_account_id) VALUES('profile','Synthetic','person','owner'); INSERT INTO sources VALUES('source','Synthetic shows','/synthetic','shows',1); INSERT INTO source_grants VALUES('profile','source','');",
  );
  store.transaction(() => {
    const insert = store.db.prepare(
      "INSERT INTO media(id,source_id,relative_path,title,duration_ms,size,mtime_ms,metadata_json) VALUES(?,'source',?,?,1000,1,0,?)",
    );
    for (let i = 0; i < size; i++) {
      const show = Math.floor(i / 20);
      insert.run(
        `media-${i}`,
        `Show ${show}/S01E${i % 20}.mp4`,
        `Episode ${i}`,
        JSON.stringify({
          seriesId: show,
          seriesTitle: `Show ${show}`,
          seasonNumber: 1,
          episodeNumber: i % 20,
        }),
      );
    }
  });
  const samples = [];
  let result;
  for (let i = 0; i < 6; i++) {
    const started = performance.now();
    result = programmingOptions(store, owner, "profile", {
      search: "Show 12",
      offset: 0,
      limit: 50,
    });
    if (i) samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      rows: size,
      p50Ms: Math.round(samples[2]),
      p95Ms: Math.round(samples[4]),
      responseBytes: Buffer.byteLength(JSON.stringify(result)),
      returned: result.items.length,
      total: result.total,
      rssMiB: Math.round(process.memoryUsage().rss / 1024 ** 2),
      fullResponseBytes: Buffer.byteLength(
        JSON.stringify(browseLibrary(store, owner, "profile")),
      ),
    }),
  );
  store.close();
}
