import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/database.js";
import { scanSource } from "../src/catalog.js";
import { inspectLocalMetadata } from "../src/local-metadata.js";
import {
  inspectMetadata,
  saveMetadata,
  displayMedia,
} from "../src/display-metadata.js";
import { importMetadata } from "../src/integrations.js";
import { browseLibrary, selectMedia, showKey } from "../src/library.js";
import { ProgrammingService } from "../src/programming.js";
import { noBreaks } from "../src/scheduler.js";
import { programmingSchema } from "../src/contracts.js";
import { account, profile, source, media, channel } from "./helpers.js";
import type { Media, Source } from "../src/domain.js";

async function fixture(
  t: import("node:test").TestContext,
  kind: Source["kind"],
) {
  const root = await realpath(
      await mkdtemp(join(tmpdir(), "mytuner-r10-selected-")),
    ),
    store = new Store(":memory:");
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const owner = account(store, "admin"),
    p = profile(store, owner),
    src = source(store, root, kind);
  const rows = () =>
    store.db
      .prepare("SELECT * FROM media WHERE source_id=? ORDER BY relative_path")
      .all(src.id) as unknown as Media[];
  const scan = async () => {
    assert.equal(
      (await scanSource(store, src, async () => 60000)).complete,
      true,
    );
    return rows();
  };
  return { root, store, owner, p, src, rows, scan };
}

for (const kind of ["shows", "movies"] as const) {
  test(`R10-04 generic ${kind} sidecar applies only to a single video and rescans remove obsolete fallback`, async (t) => {
    const f = await fixture(t, kind),
      name = kind === "shows" ? "episode.nfo" : "movie.nfo";
    const xml =
      kind === "shows"
        ? "<episodedetails><title>Generic pilot</title><showtitle>Wrong show</showtitle><season>9</season><episode>9</episode><plot>Generic plot</plot></episodedetails>"
        : "<movie><title>Generic movie</title><plot>Generic plot</plot></movie>";
    await writeFile(join(f.root, name), xml);
    await writeFile(join(f.root, "Orbit.S01E01.mp4"), "synthetic first");
    assert.equal(
      (await f.scan())[0]!.title,
      kind === "shows" ? "Generic pilot" : "Generic movie",
    );
    await writeFile(join(f.root, "Orbit.S01E02.MKV"), "synthetic second");
    const rows = await f.scan();
    assert.deepEqual(
      rows.map((i) => i.title),
      ["Orbit S01E01", "Orbit S01E02"],
    );
    for (const item of rows) {
      const raw = JSON.parse(item.metadata_json);
      assert.equal(raw.localNfoValid, false);
      assert.equal(raw.overview, undefined);
      assert.equal(raw.seriesTitle, "Orbit");
      assert.equal(raw.seasonNumber, 1);
      assert.equal(
        (await inspectLocalMetadata(f.src, item.relative_path)).validNfo,
        false,
      );
    }
    assert.deepEqual(
      rows.map((i) => JSON.parse(i.metadata_json).episodeNumber),
      [1, 2],
    );
    await writeFile(
      join(f.root, "Orbit.S01E02.nfo"),
      "<episodedetails><title>Specific second</title><episode>2</episode></episodedetails>",
    );
    assert.equal((await f.scan())[1]!.title, "Specific second");
    assert.equal(await readFile(join(f.root, name), "utf8"), xml);
    assert.equal(
      await readFile(join(f.root, "Orbit.S01E01.mp4"), "utf8"),
      "synthetic first",
    );
  });
}

for (const provider of ["sonarr", "radarr"] as const) {
  test(`R10-05 ${provider} replacement uses current metadata and retains historical associations`, async (t) => {
    const f = await fixture(t, provider === "sonarr" ? "shows" : "movies");
    await writeFile(join(f.root, "clip.mp4"), "synthetic clip");
    const item = (await f.scan())[0]!;
    const imported = (externalId: string, title: string) =>
      importMetadata(
        f.store,
        f.src,
        [
          {
            provider,
            externalId,
            path: "/remote/clip.mp4",
            title,
            metadata: {
              ...(provider === "sonarr"
                ? {
                    seriesId: Number(externalId),
                    seriesTitle: title,
                    episodes: [{ id: Number(externalId), title }],
                  }
                : { movieId: Number(externalId) }),
              displayCandidate: { title, description: title + " plot" },
            },
          },
        ],
        [{ from: "/remote", to: f.root }],
      );
    imported("1", "Original");
    const target = { kind: "media" as const, mediaId: item.id };
    const first = inspectMetadata(f.store, target);
    await saveMetadata(f.store, f.owner, f.p, target, first.revision, {
      title: { source: "manual", manual: "Old identity override" },
      description: { source: "automatic" },
    });
    imported("2", "Replacement");
    assert.equal(
      f.store.db
        .prepare(
          "SELECT count(*) AS n FROM integration_metadata WHERE media_id=?",
        )
        .get(item.id)!.n,
      2,
    );
    const current = inspectMetadata(f.store, target);
    assert.equal(current.effective.title.value, "Replacement");
    assert.equal(current.requiresReview, true);
    assert.equal(displayMedia(f.store, f.rows()[0]!).title, "Replacement");
    // Old schema15 catalogs have no active pointer: their current upstream fields
    // still identify the replacement, even when the older external ID sorts first.
    const raw = JSON.parse(f.rows()[0]!.metadata_json);
    delete raw.integrationReference;
    f.store.db
      .prepare("UPDATE media SET metadata_json=? WHERE id=?")
      .run(JSON.stringify(raw), item.id);
    assert.equal(
      inspectMetadata(f.store, target).effective.title.value,
      "Replacement",
    );
    imported("2", "Refreshed replacement");
    const refreshed = inspectMetadata(f.store, target);
    await saveMetadata(f.store, f.owner, f.p, target, refreshed.revision, {
      title: { source: "manual", manual: "Current override" },
      description: { source: "automatic" },
    });
    imported("2", "Another refresh");
    assert.equal(
      inspectMetadata(f.store, target).effective.title.value,
      "Current override",
    );
    assert.equal(inspectMetadata(f.store, target).requiresReview, false);
  });
}

test("R10-06 folder show title/description overrides appear in library/search without changing selection identity", async (t) => {
  const f = await fixture(t, "shows");
  await mkdir(join(f.root, "Orbit", "Season 01"), { recursive: true });
  await writeFile(
    join(f.root, "Orbit", "Season 01", "01.Pilot.mp4"),
    "synthetic folder episode",
  );
  const item = (await f.scan())[0]!,
    key = showKey(item),
    target = { kind: "show" as const, sourceId: f.src.id, key };
  const before = inspectMetadata(f.store, target);
  await saveMetadata(f.store, f.owner, f.p, target, before.revision, {
    title: { source: "manual", manual: "Custom Orbit" },
    description: { source: "manual", manual: "Custom plot" },
  });
  const shown = displayMedia(f.store, item);
  assert.equal(JSON.parse(shown.metadata_json).seriesTitle, "Custom Orbit");
  assert.equal(JSON.parse(shown.metadata_json).seriesOverview, "Custom plot");
  const found = browseLibrary(f.store, f.owner, f.p, "Custom Orbit").shows;
  assert.equal(found.length, 1);
  assert.equal(found[0]!.title, "Custom Orbit");
  assert.equal(found[0]!.key, key);
  assert.deepEqual(
    selectMedia(f.store, f.owner, f.p, {
      type: "show",
      sourceId: f.src.id,
      key,
      includeSpecials: false,
    }).map((i) => i.id),
    [item.id],
  );
  assert.equal(showKey(f.rows()[0]!), key);
});

for (const tag of ["<title/>", "<title>   </title>"]) {
  test(`R10-07 ${tag} preserves filename fallback on scan and in old saved catalogs`, async (t) => {
    const f = await fixture(t, "movies");
    await writeFile(join(f.root, "Normal.Movie.2024.mp4"), "synthetic film");
    const xml = `<movie>${tag}<plot>Valid plot</plot></movie>`;
    await writeFile(join(f.root, "Normal.Movie.2024.nfo"), xml);
    const item = (await f.scan())[0]!;
    assert.equal(item.title, "Normal Movie 2024");
    assert.equal(
      inspectMetadata(f.store, { kind: "media", mediaId: item.id }).effective
        .title.value,
      "Normal Movie 2024",
    );
    assert.equal(browseLibrary(f.store, f.owner, f.p).movies.length, 1);
    const raw = JSON.parse(item.metadata_json);
    raw.local.title = tag.includes("   ") ? "   " : "";
    f.store.db
      .prepare("UPDATE media SET title=?,metadata_json=? WHERE id=?")
      .run(raw.local.title, JSON.stringify(raw), item.id);
    assert.equal(f.rows()[0]!.title, raw.local.title);
    assert.equal(
      displayMedia(f.store, f.rows()[0]!).title,
      "Normal Movie 2024",
    );
    assert.equal(
      await readFile(join(f.root, "Normal.Movie.2024.nfo"), "utf8"),
      xml,
    );
  });
}

test("R10-08 preview/publication accept 150,000 resolved clips in a small dynamic configuration", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const owner = account(store, "admin"),
    p = profile(store, owner),
    src = source(store, "/synthetic/videos", "videos"),
    ch = channel(store, owner);
  store.transaction(() => {
    for (let n = 0; n < 1500; n++)
      media(store, src.id, `folder/${n}.mp4`, 60000);
  });
  const config = programmingSchema.parse({
    profileId: p,
    seed: 42,
    rules: noBreaks,
    groups: Array.from({ length: 100 }, (_, n) => ({
      id: `group-${n}`,
      mode: "ordered",
      selection: {
        type: "folder",
        sourceId: src.id,
        directory: "folder",
        recursive: true,
      },
    })),
  });
  assert.ok(JSON.stringify(config).length < 20000);
  const service = new ProgrammingService(store, 1000);
  assert.equal(
    service.preview(owner, ch.id, config, 1000, 1000).entries.length,
    1,
  );
  assert.equal(
    store.db.prepare("SELECT count(*) AS n FROM schedule_revisions").get()!.n,
    0,
  );
  const result = service.publish(owner, ch.id, config, 1000);
  assert.ok(result.revisionId);
  assert.equal(
    store.db.prepare("SELECT count(*) AS n FROM schedule_revisions").get()!.n,
    1,
  );
});
