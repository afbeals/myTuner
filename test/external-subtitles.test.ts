import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store, migrations, schemaVersion } from "../src/database.js";
import { addSource, scanSource } from "../src/catalog.js";
import {
  configureSubtitles,
  advertisedSubtitles,
  inspectSubtitles,
  previewManualSubtitle,
  storedSubtitles,
  subtitleConfig,
  subtitleRevision,
  SubtitleDiscovery,
} from "../src/subtitle-catalog.js";
import { SubtitleService } from "../src/subtitles.js";
import { createServer } from "../src/server.js";
import { createAccount, login, sourceById } from "../src/security.js";
import { backupApplication, restoreApplication } from "../src/recovery.js";
import { validateStorage } from "../src/storage.js";
import { profile } from "./helpers.js";
import type { Media } from "../src/domain.js";
const srt = "1\n00:00:00,500 --> 00:00:02,000\nExternal synthetic caption\n";
async function fixture(t: { after: (fn: () => unknown) => void }) {
  const root = await mkdtemp(join(tmpdir(), "mytuner-external-captions-"));
  const store = new Store(join(root, "data", "mytuner.db"));
  const directory = join(root, "media", "Show", "Season 1");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "Épisode.S01E01.mp4"),
    "synthetic-video-original",
  );
  await writeFile(
    join(directory, "Épisode.S01E02.mp4"),
    "second-synthetic-video",
  );
  const source = await addSource(
    store,
    {
      name: "Synthetic",
      root: join(root, "media"),
      kind: "shows",
      recursive: true,
    },
    [join(root, "data"), join(root, "cache"), join(root, "generated")],
  );
  await scanSource(store, source, async () => 3000);
  const items = () =>
    store.db
      .prepare("SELECT * FROM media ORDER BY relative_path")
      .all() as unknown as Media[];
  const item = items()[0]!;
  t.after(async () => {
    try {
      store.close();
    } catch {}
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    store,
    directory,
    source,
    item,
    items,
    check: () => new SubtitleDiscovery().check(store, item.id),
  };
}

test("external captions discover adjacent, nested and mirrored matches while generic names stay ambiguous", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.directory, "Subs", "English"), { recursive: true });
  await writeFile(join(f.directory, "Épisode.S01E01.en.forced.sdh.srt"), srt);
  await writeFile(
    join(f.directory, "Subs", "English", "Épisode.S01E01.fr.vtt"),
    "WEBVTT\n\n00:00.500 --> 00:02.000\nFrench fixture\n",
  );
  await writeFile(join(f.directory, "English.srt"), srt);
  await writeFile(
    join(f.directory, "Épisode.S01E01.sup"),
    "synthetic-image-caption",
  );
  const mirror = join(f.root, "subtitles");
  await mkdir(join(mirror, "Show", "Season 1"), { recursive: true });
  await writeFile(
    join(mirror, "Show", "Season 1", "Épisode.S01E01.es.srt"),
    srt,
  );
  await configureSubtitles(
    f.store,
    f.source.id,
    0,
    { ...subtitleConfig(f.source), root: mirror },
    [join(f.root, "data")],
    () => {},
  );
  await f.check();
  const tracks = advertisedSubtitles(f.store, f.item, "profile");
  assert.equal(tracks.length, 3);
  assert.deepEqual(tracks.map((t) => t.language).sort(), ["en", "es", "fr"]);
  assert.ok(tracks.find((t) => t.language === "en")?.sdh);
  assert.ok(tracks.find((t) => t.language === "en")?.forced);
  assert.ok(
    tracks.every(
      (t) => t.index >= 1_000_000_000 && t.timeBasis === "source-media",
    ),
  );
  const stored = storedSubtitles(f.store, f.item.id);
  assert.equal(
    stored.find((t) => t.relativePath.endsWith("English.srt"))?.status,
    "ambiguous",
  );
  assert.equal(stored.find((t) => t.format === "sup")?.status, "unsupported");
  const indices = tracks.map((t) => t.index);
  await f.check();
  assert.deepEqual(
    advertisedSubtitles(f.store, f.item, "profile").map((t) => t.index),
    indices,
  );
  await new SubtitleDiscovery().check(f.store, f.items()[1]!.id);
  assert.equal(
    advertisedSubtitles(f.store, f.items()[1]!, "profile").length,
    0,
  );
});

test("manual candidate preview is read-only; save requires current fingerprints and persists across rescan", async (t) => {
  const f = await fixture(t),
    filename = join(f.directory, "English.srt");
  await writeFile(filename, srt);
  await f.check();
  const manual = {
    rootKind: "media" as const,
    relativePath: "Show/Season 1/English.srt",
  };
  let revision = subtitleRevision(f.store, f.item);
  const preview = await previewManualSubtitle(
    f.store,
    f.item,
    revision,
    manual,
    () => {},
  );
  assert.equal(advertisedSubtitles(f.store, f.item, "p").length, 0);
  assert.equal(subtitleRevision(f.store, f.item), revision);
  await writeFile(filename, srt + "\n");
  await assert.rejects(
    new SubtitleDiscovery().check(
      f.store,
      f.item.id,
      () => {},
      revision,
      manual,
      preview.fingerprint,
    ),
    /candidate changed/,
  );
  assert.equal(advertisedSubtitles(f.store, f.item, "p").length, 0);
  revision = subtitleRevision(f.store, f.item);
  const fresh = await previewManualSubtitle(
    f.store,
    f.item,
    revision,
    manual,
    () => {},
  );
  await new SubtitleDiscovery().check(
    f.store,
    f.item.id,
    () => {},
    revision,
    manual,
    fresh.fingerprint,
  );
  assert.equal(advertisedSubtitles(f.store, f.item, "p").length, 1);
  await scanSource(f.store, sourceById(f.store, f.source.id), async () => 3000);
  assert.equal(
    storedSubtitles(f.store, f.item.id).find((t) => t.manual)?.status,
    "found",
  );
  assert.equal(await readFile(filename, "utf8"), srt + "\n");
  assert.equal(
    await readFile(join(f.directory, "Épisode.S01E01.mp4"), "utf8"),
    "synthetic-video-original",
  );
});

test("failed/offline checks retain last success; successful checks mark removed tracks missing", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.directory, "Épisode.S01E01.en.srt"), srt);
  await f.check();
  const before = inspectSubtitles(f.store, f.item, true);
  await rename(join(f.root, "media"), join(f.root, "offline"));
  const failed = await f.check();
  assert.ok(failed.error);
  assert.equal(failed.lastSuccessMs, before.lastSuccessMs);
  assert.equal(failed.tracks[0]?.status, "found");
  await rename(join(f.root, "offline"), join(f.root, "media"));
  await rm(join(f.directory, "Épisode.S01E01.en.srt"));
  const recovered = await f.check();
  assert.equal(recovered.error, null);
  assert.equal(recovered.tracks[0]?.status, "missing");
  assert.equal(advertisedSubtitles(f.store, f.item, "p").length, 0);
});

test("subtitle roots and manual files enforce containment, storage separation and stale configuration guards", async (t) => {
  const f = await fixture(t);
  const config = subtitleConfig(f.source);
  await assert.rejects(
    configureSubtitles(
      f.store,
      f.source.id,
      0,
      { ...config, root: join(f.root, "data") },
      [join(f.root, "data")],
      () => {},
    ),
    /overlap/,
  );
  await assert.rejects(
    configureSubtitles(
      f.store,
      f.source.id,
      0,
      { ...config, subdirectories: ["../secret"] },
      [],
      () => {},
    ),
  );
  await writeFile(join(f.root, "outside.srt"), srt);
  await symlink(join(f.root, "outside.srt"), join(f.directory, "escape.srt"));
  for (const path of [
    "../outside.srt",
    "Show/Season 1/escape.srt",
    "/etc/passwd",
  ]) {
    await assert.rejects(
      previewManualSubtitle(
        f.store,
        f.item,
        subtitleRevision(f.store, f.item),
        { rootKind: "media", relativePath: path },
        () => {},
      ),
    );
  }
  const old = subtitleRevision(f.store, f.item);
  await configureSubtitles(
    f.store,
    f.source.id,
    0,
    { ...config, enabled: false },
    [],
    () => {},
  );
  await assert.rejects(
    configureSubtitles(f.store, f.source.id, 0, config, [], () => {}),
    /changed/,
  );
  await assert.rejects(
    new SubtitleDiscovery().check(f.store, f.item.id, () => {}, old),
    /changed/,
  );
  await assert.rejects(
    new SubtitleDiscovery().check(f.store, f.item.id, () => {
      throw Error("revoked");
    }),
    /revoked/,
  );
});

test("external subtitle conversion uses real FFmpeg, detects changes, reauthorizes cache hits and drains shutdown", async (t) => {
  const f = await fixture(t),
    filename = join(f.directory, "Épisode.S01E01.en.srt");
  await writeFile(filename, srt);
  await f.check();
  const track = advertisedSubtitles(f.store, f.item, "p")[0]!;
  const service = new SubtitleService(
    join(f.root, "cache"),
    undefined,
    undefined,
    f.store,
  );
  t.after(() => service.stop());
  const result = await service.get(
    sourceById(f.store, f.source.id),
    f.item,
    track.index,
    () => {},
  );
  assert.match(result.toString(), /^WEBVTT/);
  assert.match(result.toString(), /00:00\.500 --> 00:02\.000/);
  assert.match(result.toString(), /External synthetic caption/);
  await assert.rejects(
    service.get(sourceById(f.store, f.source.id), f.item, track.index, () => {
      throw Error("revoked");
    }),
    /revoked/,
  );
  await writeFile(
    filename,
    srt.replace("External synthetic caption", "Changed synthetic caption"),
  );
  await assert.rejects(
    service.get(
      sourceById(f.store, f.source.id),
      f.item,
      track.index,
      () => {},
    ),
    /changed/,
  );
  await f.check();
  const changed = await service.get(
    sourceById(f.store, f.source.id),
    f.item,
    track.index,
    () => {},
  );
  assert.match(changed.toString(), /Changed synthetic caption/);
  await service.stop();
  await assert.rejects(
    service.get(
      sourceById(f.store, f.source.id),
      f.item,
      track.index,
      () => {},
    ),
    /stopping/,
  );
  assert.equal(
    await readFile(join(f.directory, "Épisode.S01E01.mp4"), "utf8"),
    "synthetic-video-original",
  );
});

test("external caption HTTP routes protect admin changes, viewer paths and revoked delivery", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.directory, "Épisode.S01E01.en.srt"), srt);
  await f.check();
  const admin = await createAccount(
    f.store,
    "admin",
    "synthetic-admin-password",
    "admin",
  );
  const viewer = await createAccount(
    f.store,
    "viewer",
    "synthetic-viewer-password",
    "viewer",
  );
  const p = profile(f.store, viewer);
  f.store.db
    .prepare("INSERT INTO source_grants VALUES(?,?,'')")
    .run(p, f.source.id);
  const app = createServer(f.store, {
    writableRoots: [join(f.root, "data")],
    generatedRoot: join(f.root, "generated"),
    cacheRoot: join(f.root, "cache"),
  });
  t.after(() => app.close());
  const ah = {
    authorization: `Bearer ${(await login(f.store, admin.username, "synthetic-admin-password")).token}`,
  };
  const vh = {
    authorization: `Bearer ${(await login(f.store, viewer.username, "synthetic-viewer-password")).token}`,
  };
  const url = `/api/profiles/${p}/media/${f.item.id}/subtitles`;
  const view = await app.inject({ url, headers: vh });
  assert.equal(view.statusCode, 200);
  assert.equal(view.json().tracks[0].relativePath, undefined);
  assert.equal(view.json().revision, undefined);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: url + "/check",
        headers: vh,
        payload: { revision: subtitleRevision(f.store, f.item) },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        url: `/api/sources/${f.source.id}/subtitles`,
        headers: vh,
      })
    ).statusCode,
    403,
  );
  const inspection = await app.inject({ url, headers: ah });
  assert.match(inspection.json().tracks[0].relativePath, /Épisode/);
  const track = advertisedSubtitles(f.store, f.item, p)[0]!;
  assert.equal(
    (await app.inject({ url: track.url, headers: vh })).statusCode,
    200,
  );
  f.store.db.prepare("DELETE FROM source_grants WHERE profile_id=?").run(p);
  assert.equal(
    (await app.inject({ url: track.url, headers: vh })).statusCode,
    404,
  );
  assert.equal((await app.inject({ url, headers: vh })).statusCode, 404);
});

test("subtitle schema migrates from v14 and discovery/settings survive full backup and restore without copying sources", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.directory, "Épisode.S01E01.en.srt"), srt);
  await f.check();
  const mirror = join(f.root, "captions");
  await mkdir(mirror);
  await configureSubtitles(
    f.store,
    f.source.id,
    0,
    { ...subtitleConfig(f.source), root: mirror },
    [join(f.root, "data")],
    () => {},
  );
  await f.check();
  await assert.rejects(
    validateStorage(
      f.store,
      [join(mirror, "data")],
      join(f.root, "generated"),
      join(f.root, "cache"),
    ),
    /overlaps/,
  );
  const snapshot = await backupApplication(f.store.db, join(f.root, "data"));
  await assert.rejects(restoreApplication(mirror, snapshot), /overlap/);
  const target = join(f.root, "restored");
  await restoreApplication(target, snapshot);
  const restored = new Store(join(target, "mytuner.db"));
  assert.equal(advertisedSubtitles(restored, f.item, "p").length, 1);
  assert.equal(
    sourceById(restored, f.source.id).subtitle_root,
    await realpath(mirror),
  );
  restored.close();
  const oldPath = join(f.root, "v14.db"),
    db = new DatabaseSync(oldPath);
  db.exec("PRAGMA foreign_keys=ON");
  for (const migration of migrations.slice(0, 14)) db.exec(migration);
  db.exec("PRAGMA user_version=14");
  db.close();
  const migrated = new Store(oldPath);
  assert.equal(
    migrated.db.prepare("PRAGMA user_version").get()?.user_version,
    schemaVersion,
  );
  assert.ok(
    migrated.db
      .prepare("SELECT name FROM sqlite_master WHERE name='subtitle_tracks'")
      .get(),
  );
  migrated.close();
});

test("subtitle discovery bounds candidate publication and retains previous associations on overflow", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.directory, "Épisode.S01E01.en.srt"), srt);
  await f.check();
  const before = advertisedSubtitles(f.store, f.item, "p");
  await Promise.all(
    Array.from({ length: 513 }, (_, index) =>
      writeFile(join(f.directory, `candidate-${index}.srt`), srt),
    ),
  );
  const result = await f.check();
  assert.ok(result.error);
  assert.deepEqual(advertisedSubtitles(f.store, f.item, "p"), before);
  assert.equal(storedSubtitles(f.store, f.item.id).length, 1);
});

test("external text conversion supports ASS and rejects malformed or oversized originals without changing them", async (t) => {
  const f = await fixture(t);
  const filename = join(f.directory, "Épisode.S01E01.en.ass");
  const ass =
    "[Script Info]\nScriptType: v4.00+\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.50,0:00:02.00,Default,,0,0,0,,ASS synthetic caption\n";
  await writeFile(filename, ass);
  await f.check();
  const service = new SubtitleService(
    join(f.root, "cache"),
    undefined,
    undefined,
    f.store,
  );
  t.after(() => service.stop());
  const track = advertisedSubtitles(f.store, f.item, "p")[0]!;
  assert.match(
    (
      await service.get(
        sourceById(f.store, f.source.id),
        f.item,
        track.index,
        () => {},
      )
    ).toString(),
    /ASS synthetic caption/,
  );
  const malformed = join(f.directory, "Épisode.S01E01.fr.srt");
  await writeFile(
    malformed,
    "synthetic malformed subtitle without cue timestamps",
  );
  await f.check();
  const bad = advertisedSubtitles(f.store, f.item, "p").find(
    (t) => t.language === "fr",
  )!;
  await assert.rejects(
    service.get(sourceById(f.store, f.source.id), f.item, bad.index, () => {}),
  );
  assert.equal(
    await readFile(malformed, "utf8"),
    "synthetic malformed subtitle without cue timestamps",
  );
  const huge = join(f.directory, "oversized.srt");
  await writeFile(huge, Buffer.alloc(10 * 1024 * 1024 + 1, 32));
  await assert.rejects(
    previewManualSubtitle(
      f.store,
      f.item,
      subtitleRevision(f.store, f.item),
      { rootKind: "media", relativePath: "Show/Season 1/oversized.srt" },
      () => {},
    ),
    /10 MiB/,
  );
  assert.equal(await readFile(filename, "utf8"), ass);
});

test("external conversion shutdown cancels active work and prevents late cache publication", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.directory, "Épisode.S01E01.en.srt"), srt);
  await f.check();
  let entered!: () => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const service = new SubtitleService(
    join(f.root, "cache"),
    async (_args, signal) => {
      entered();
      await new Promise<void>((resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
      });
    },
    undefined,
    f.store,
  );
  const track = advertisedSubtitles(f.store, f.item, "p")[0]!;
  const work = service.get(
    sourceById(f.store, f.source.id),
    f.item,
    track.index,
    () => {},
  );
  const rejected = assert.rejects(work);
  await started;
  await service.stop();
  await rejected;
  await assert.rejects(
    service.get(
      sourceById(f.store, f.source.id),
      f.item,
      track.index,
      () => {},
    ),
    /stopping/,
  );
});
