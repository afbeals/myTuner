import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Store } from "../src/database.js";
import { createServer } from "../src/server.js";
import { createAccount } from "../src/security.js";
import { addSource, scanSource } from "../src/catalog.js";
import { ProgrammingService } from "../src/programming.js";
import { profile, channel } from "../test/helpers.js";
import { noBreaks } from "../src/scheduler.js";
const demo = process.argv.includes("--demo");
const port = Number(process.env.MYTUNER_E2E_PORT ?? (demo ? 8788 : 8787));
const longEpisodes = process.env.MYTUNER_E2E_LONG_EPISODES === "1";
const root = await mkdtemp(join(tmpdir(), "mytuner-ui-"));
await mkdir(join(root, "media"));
await mkdir(join(root, "data"));
await mkdir(join(root, "commercials"));
const execute = promisify(execFile);
await execute("ffmpeg", [
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=320x180:rate=24",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:sample_rate=48000",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=880:sample_rate=48000",
  "-map",
  "0:v:0",
  "-map",
  "1:a:0",
  "-map",
  "2:a:0",
  "-metadata:s:a:0",
  "language=eng",
  "-metadata:s:a:1",
  "language=fra",
  "-t",
  longEpisodes ? "120" : "12",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  join(root, "media", "Orbit.S01E01.mp4"),
]);
await execute("ffmpeg", [
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "color=c=teal:s=320x180:r=24",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=550:sample_rate=48000",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=990:sample_rate=48000",
  "-map",
  "0:v:0",
  "-map",
  "1:a:0",
  "-map",
  "2:a:0",
  "-metadata:s:a:0",
  "language=eng",
  "-metadata:s:a:1",
  "language=fra",
  "-t",
  longEpisodes ? "120" : "8",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  join(
    root,
    "media",
    process.env.MYTUNER_E2E_MIXED_FORMATS === "1"
      ? "Orbit.S01E02.mkv"
      : "Orbit.S01E02.mp4",
  ),
]);
// Unregistered until the commercial playback test adds it through the ordinary admin API.
await execute("ffmpeg", [
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "color=c=orange:s=320x180:r=24",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=660:sample_rate=48000",
  "-t",
  "12",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  join(root, "commercials", "Synthetic-ad.mp4"),
]);
const store = new Store(join(root, "data", "mytuner.db"));
const admin = await createAccount(
    store,
    "designer",
    "synthetic-browser-password",
    "admin",
  ),
  owner = await createAccount(
    store,
    "sam",
    "synthetic-viewer-password",
    "editor",
  ),
  other = await createAccount(
    store,
    "other",
    "synthetic-other-password",
    "editor",
  );
const p = profile(store, owner);
store.db
  .prepare("UPDATE profiles SET name='Living Room',kind='room' WHERE id=?")
  .run(p);
const op = profile(store, other);
store.db.prepare("UPDATE profiles SET name='Other Profile' WHERE id=?").run(op);
const source = await addSource(
  store,
  {
    name: "TV shows",
    root: join(root, "media"),
    kind: "shows",
    recursive: true,
  },
  [join(root, "data"), join(root, "generated"), join(root, "cache")],
);
for (const [episode, title] of [
  [1, "The Last Platform"],
  [2, "Maple Street"],
] as const) {
  await writeFile(
    join(root, "media", `Orbit.S01E0${episode}.nfo`),
    `<episodedetails><title>${title}</title><showtitle>Orbit Patrol</showtitle><season>1</season><episode>${episode}</episode><plot>A synthetic story for client verification.</plot></episodedetails>`,
  );
}
await mkdir(join(root, "media", "Subs"));
await mkdir(join(root, "media", "CustomCaptions"));
for (const episode of [1, 2])
  await writeFile(
    join(root, "media", "Subs", `Orbit.S01E0${episode}.en.srt`),
    `1\n00:00:00,050 --> 00:02:00,000\nExternal fixture episode ${episode}\n`,
  );
await writeFile(
  join(root, "media", "Subs", "English.srt"),
  "1\n00:00:00,050 --> 00:02:00,000\nManually matched fixture captions\n",
);
await writeFile(
  join(root, "media", "Orbit.S01E01.fr.vtt"),
  "WEBVTT\n\n00:00.050 --> 02:00.000\nFrench external fixture\n",
);
await writeFile(
  join(root, "media", "CustomCaptions", "Orbit.S01E01.es.srt"),
  "1\n00:00:00,050 --> 00:02:00,000\nConfigured folder fixture\n",
);
await scanSource(store, source);
store.db.prepare("INSERT INTO source_grants VALUES(?,?,'')").run(p, source.id);
store.db.prepare("INSERT INTO source_grants VALUES(?,?,'')").run(op, source.id);
for (const item of store.db
  .prepare("SELECT id,metadata_json,relative_path FROM media")
  .all()) {
  const metadata = JSON.parse(String(item.metadata_json));
  Object.assign(metadata, {
    seriesTitle: "Orbit Patrol",
    seasonNumber: 1,
    episodeNumber: String(item.relative_path).includes("E01") ? 1 : 2,
    overview: "A synthetic story for client verification.",
  });
  store.db
    .prepare("UPDATE media SET metadata_json=?,title=? WHERE id=?")
    .run(
      JSON.stringify(metadata),
      String(item.relative_path).includes("E01")
        ? "The Last Platform"
        : "Maple Street",
      item.id!,
    );
}
const ch = channel(store, admin, "shared");
store.db
  .prepare("UPDATE channels SET name='After School' WHERE id=?")
  .run(ch.id);
const service = new ProgrammingService(store);
service.publish(
  admin,
  ch.id,
  {
    profileId: p,
    groups: [
      {
        id: "orbit",
        mode: "ordered",
        selection: {
          type: "show",
          sourceId: source.id,
          key: (await import("../src/library.js")).showKey(
            store.db.prepare("SELECT * FROM media LIMIT 1").get() as never,
          ),
          includeSpecials: false,
        },
      },
    ],
    rules: noBreaks,
    seed: 42,
  },
  Date.now(),
  3600000,
);
store.db
  .prepare("INSERT INTO subscriptions(profile_id,channel_id) VALUES(?,?)")
  .run(p, ch.id);
const secret = channel(store, other);
store.db
  .prepare("UPDATE channels SET name='Other private network' WHERE id=?")
  .run(secret.id);
if (demo) {
  const ads = await addSource(
    store,
    {
      name: "Synthetic commercials",
      root: join(root, "commercials"),
      kind: "commercials",
      recursive: true,
    },
    [join(root, "data"), join(root, "generated"), join(root, "cache")],
  );
  await scanSource(store, ads);
  store.db.prepare("INSERT INTO source_grants VALUES(?,?,'')").run(p, ads.id);
}
const app = createServer(store, {
  webRoot: resolve("web-dist"),
  writableRoots: [
    join(root, "data"),
    join(root, "generated"),
    join(root, "cache"),
  ],
  generatedRoot: join(root, "generated"),
  cacheRoot: join(root, "cache"),
  integrationKey: Buffer.alloc(32, 7),
});
await app.listen({
  host: "127.0.0.1",
  port,
});
if (demo) {
  console.log(`myTuner local demo: http://127.0.0.1:${port}/`);
  console.log("Admin: designer / synthetic-browser-password");
  console.log("Editor: sam / synthetic-viewer-password");
  console.log("Choose Living Room, then Watch TV → After School → Watch live.");
  console.log(
    "A synthetic commercial pool is available in channel programming; commercials start off.",
  );
  console.log(
    "Temporary synthetic data resets on restart; Ctrl-C stops and removes it.",
  );
}
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  store.close();
  await rm(root, { recursive: true, force: true });
}
process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());
