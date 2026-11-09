import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/database.js";
import { ProgrammingService } from "../src/programming.js";
import { selectMedia, browseLibrary, saveCollection } from "../src/library.js";
import { noBreaks, resolveLive } from "../src/scheduler.js";
import { setPin } from "../src/identity.js";
import { PlaybackService } from "../src/playback.js";
import { account, profile, source, media, channel } from "./helpers.js";
import { breakRulesSchema, type Programming } from "../src/contracts.js";
function setup(t: { after: (fn: () => unknown) => void }) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const owner = account(store),
    p = profile(store, owner),
    src = source(store, "/example", "shows"),
    one = media(store, src.id, "Show/Season 1/1.mp4"),
    two = media(store, src.id, "Show/Season 1/2.mp4"),
    special = media(store, src.id, "Show/Season 0/special.mp4");
  for (const [item, season, episode] of [
    [one, 1, 1],
    [two, 1, 2],
    [special, 0, 1],
  ] as const)
    store.db.prepare("UPDATE media SET metadata_json=? WHERE id=?").run(
      JSON.stringify({
        seriesId: 7,
        seriesTitle: "Show",
        seasonNumber: season,
        episodeNumber: episode,
      }),
      item.id,
    );
  store.db
    .prepare(
      "INSERT INTO source_grants(profile_id,source_id,subtree) VALUES(?,?,'')",
    )
    .run(p, src.id);
  const ch = channel(store, owner),
    service = new ProgrammingService(store, 3000);
  const config: Programming = {
    profileId: p,
    groups: [
      {
        id: "show",
        mode: "ordered",
        selection: {
          type: "show",
          sourceId: src.id,
          key: "series:7",
          includeSpecials: false,
        },
      },
    ],
    rules: noBreaks,
    seed: 42,
  };
  return { store, owner, p, src, one, two, special, ch, service, config };
}
test("whole-show and season selection excludes specials unless requested", (t) => {
  const f = setup(t),
    selection = f.config.groups[0]!.selection;
  assert.equal(selectMedia(f.store, f.owner, f.p, selection).length, 2);
  assert.equal(
    selectMedia(f.store, f.owner, f.p, {
      type: "show",
      sourceId: f.src.id,
      key: "series:7",
      season: 0,
      includeSpecials: true,
    }).length,
    1,
  );
  const library = browseLibrary(f.store, f.owner, f.p);
  assert.equal(library.shows[0]!.title, "Show");
  assert.equal(library.shows[0]!.seasons.length, 2);
});
test("recursive/shallow selectors and collections store references and enforce owner access", (t) => {
  const f = setup(t);
  assert.equal(
    selectMedia(f.store, f.owner, f.p, {
      type: "folder",
      sourceId: f.src.id,
      directory: "Show",
      recursive: false,
    }).length,
    0,
  );
  assert.equal(
    selectMedia(f.store, f.owner, f.p, {
      type: "folder",
      sourceId: f.src.id,
      directory: "Show",
      recursive: true,
    }).length,
    3,
  );
  const collection = saveCollection(f.store, f.owner, f.p, "Favorites", [
    f.one.id,
    f.two.id,
  ]);
  assert.equal(
    selectMedia(f.store, f.owner, f.p, {
      type: "collection",
      id: collection.id,
    }).length,
    2,
  );
  const other = account(f.store),
    op = profile(f.store, other);
  assert.throws(
    () =>
      selectMedia(f.store, other, op, {
        type: "collection",
        id: collection.id,
      }),
    /not found/,
  );
});
test("recurring schedules append without resetting and include new episodes", (t) => {
  const f = setup(t),
    published = f.service.publish(f.owner, f.ch.id, f.config, 0, 2000);
  const before = resolveLive(f.store, f.ch.id, 1500);
  assert.equal(before?.entry.mediaId, f.two.id);
  const three = media(f.store, f.src.id, "Show/Season 1/3.mp4");
  f.store.db
    .prepare("UPDATE media SET metadata_json=? WHERE id=?")
    .run(
      JSON.stringify({ seriesId: 7, seasonNumber: 1, episodeNumber: 3 }),
      three.id,
    );
  f.service.ensure(f.ch.id, 4000);
  assert.equal(resolveLive(f.store, f.ch.id, 2500)?.entry.mediaId, three.id);
  assert.equal(resolveLive(f.store, f.ch.id, 3500)?.entry.mediaId, f.one.id);
  assert.equal(f.service.active(f.ch.id)?.id, published.revisionId);
  assert.equal(resolveLive(f.store, f.ch.id, 1500)?.entry.id, before?.entry.id);
});
test("edits preserve current program and paused revision, then activate at the boundary", (t) => {
  const f = setup(t),
    old = f.service.publish(f.owner, f.ch.id, f.config, 0, 4000),
    playback = new PlaybackService(f.store),
    session = playback.join(f.owner, f.p, f.ch.id, 200);
  playback.pause(f.owner, session.id, 250);
  const changed = {
    ...f.config,
    groups: [
      {
        id: "other",
        mode: "ordered" as const,
        selection: { type: "media" as const, ids: [f.one.id] },
      },
    ],
  };
  const next = f.service.publish(f.owner, f.ch.id, changed, 500, 3000);
  assert.equal(next.effectiveMs, 1000);
  assert.equal(resolveLive(f.store, f.ch.id, 750)?.entry.mediaId, f.one.id);
  assert.equal(resolveLive(f.store, f.ch.id, 1250)?.entry.mediaId, f.one.id);
  assert.equal(
    resolveLive(f.store, f.ch.id, 1250, old.revisionId)?.entry.mediaId,
    f.two.id,
  );
  assert.equal(
    playback.describe(f.owner, session.id, 2000).revisionId,
    old.revisionId,
  );
  assert.equal(playback.describe(f.owner, session.id, 2000).positionMs, 250);
});
test("preview is non-mutating and inaccessible selections cannot publish", (t) => {
  const f = setup(t);
  f.service.preview(f.owner, f.ch.id, f.config, 0, 3000);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM schedule_revisions").get()?.n,
    0,
  );
  f.store.db.prepare("DELETE FROM source_grants WHERE profile_id=?").run(f.p);
  assert.throws(
    () => f.service.publish(f.owner, f.ch.id, f.config, 0, 3000),
    /No available/,
  );
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM schedule_revisions").get()?.n,
    0,
  );
});

test("ordered cursors survive insertion before and removal of the last scheduled episode", () => {
  const store = new Store(":memory:");
  try {
    const owner = account(store),
      p = profile(store, owner),
      src = source(store),
      ch = channel(store, owner),
      second = media(store, src.id, "02.mp4"),
      third = media(store, src.id, "03.mp4");
    store.db.prepare("INSERT INTO source_grants VALUES(?,?,'')").run(p, src.id);
    const config = {
      profileId: p,
      groups: [
        {
          id: "show",
          mode: "ordered" as const,
          selection: {
            type: "folder" as const,
            sourceId: src.id,
            directory: "",
            recursive: true,
          },
        },
      ],
      rules: noBreaks,
      seed: 42,
    };
    const service = new ProgrammingService(store, 1000),
      first = service.publish(owner, ch.id, config, 0, 1000);
    assert.equal(first.entries[0]?.mediaId, second.id);
    media(store, src.id, "01.mp4");
    service.ensure(ch.id, 2000);
    assert.equal(resolveLive(store, ch.id, 1500)?.entry.mediaId, third.id);
    store.db.prepare("UPDATE media SET available=0 WHERE id=?").run(third.id);
    service.ensure(ch.id, 3000);
    assert.equal(
      resolveLive(store, ch.id, 2500)?.entry.mediaId,
      store.db
        .prepare("SELECT id FROM media WHERE relative_path='01.mp4'")
        .get()?.id,
    );
  } finally {
    store.close();
  }
});

test("profile PIN protection does not stop authorized published programming in the background", async (t) => {
  const f = setup(t);
  await setPin(f.store, f.owner, f.p, "1234");
  assert.throws(
    () => selectMedia(f.store, f.owner, f.p, f.config.groups[0]!.selection),
    /locked/,
  );
  f.service.publish(f.owner, f.ch.id, f.config, 0, 1000);
  f.service.ensure(f.ch.id, 3000);
  assert.equal(resolveLive(f.store, f.ch.id, 2500)?.entry.mediaId, f.one.id);
});

test("live viewers adopt edits while paused viewers retain their revision until session expiry", (t) => {
  const f = setup(t),
    old = f.service.publish(f.owner, f.ch.id, f.config, 0, 4000),
    playback = new PlaybackService(f.store, f.service),
    live = playback.join(f.owner, f.p, f.ch.id, 200),
    paused = playback.join(f.owner, f.p, f.ch.id, 200);
  playback.pause(f.owner, paused.id, 250);
  const next = f.service.publish(
    f.owner,
    f.ch.id,
    {
      ...f.config,
      groups: [
        {
          id: "only",
          mode: "ordered",
          selection: { type: "media", ids: [f.one.id] },
        },
      ],
    },
    500,
    3000,
  );
  assert.equal(
    playback.describe(f.owner, live.id, 1250).revisionId,
    next.revisionId,
  );
  assert.equal(
    playback.describe(f.owner, live.id, 1250).playback?.entry.mediaId,
    f.one.id,
  );
  assert.equal(
    playback.describe(f.owner, paused.id, 1250).revisionId,
    old.revisionId,
  );
  f.store.db
    .prepare("UPDATE schedule_revisions SET created_at=? WHERE id=?")
    .run(-10 * 86400000, old.revisionId);
  playback.collect(1251);
  assert.ok(
    f.store.db
      .prepare("SELECT id FROM schedule_revisions WHERE id=?")
      .get(old.revisionId),
  );
  playback.collect(2 * 86400000);
  assert.equal(
    f.store.db
      .prepare("SELECT id FROM schedule_revisions WHERE id=?")
      .get(old.revisionId),
    undefined,
  );
  assert.ok(
    f.store.db
      .prepare("SELECT id FROM schedule_revisions WHERE id=?")
      .get(next.revisionId),
  );
});

test("retired source permissions do not block new live programming, while old paused playback remains protected", (t) => {
  const f = setup(t),
    now = Date.now();
  f.service.publish(f.owner, f.ch.id, f.config, now - 500, 3000);
  const playback = new PlaybackService(f.store, f.service),
    live = playback.join(f.owner, f.p, f.ch.id, now),
    paused = playback.join(f.owner, f.p, f.ch.id, now);
  playback.pause(f.owner, paused.id, now);
  const nextSource = source(f.store, "/next"),
    nextItem = media(f.store, nextSource.id, "next.mp4");
  f.store.db
    .prepare("INSERT INTO source_grants VALUES(?,?,'')")
    .run(f.p, nextSource.id);
  const changed = f.service.publish(
    f.owner,
    f.ch.id,
    {
      ...f.config,
      groups: [
        {
          id: "next",
          mode: "ordered",
          selection: { type: "media", ids: [nextItem.id] },
        },
      ],
    },
    now,
    3000,
  );
  f.store.db
    .prepare("DELETE FROM source_grants WHERE profile_id=? AND source_id=?")
    .run(f.p, f.src.id);
  assert.equal(
    playback.describe(f.owner, live.id, changed.effectiveMs + 100).playback
      ?.entry.mediaId,
    nextItem.id,
  );
  assert.throws(
    () => playback.describe(f.owner, paused.id, changed.effectiveMs + 100),
    /not found/,
  );
  assert.equal(
    playback.goLive(f.owner, paused.id, changed.effectiveMs + 100).playback
      ?.entry.mediaId,
    nextItem.id,
  );
});

test("custom episodes in one directory group by local show metadata rather than merge into one show", (t) => {
  const f = setup(t);
  for (const [name, episode] of [
    ["Alpha", 1],
    ["Alpha", 2],
    ["Beta", 1],
  ] as const) {
    const item = media(f.store, f.src.id, `${name}.S01E0${episode}.mp4`);
    f.store.db.prepare("UPDATE media SET metadata_json=? WHERE id=?").run(
      JSON.stringify({
        seriesTitle: name,
        seasonNumber: 1,
        episodeNumber: episode,
      }),
      item.id,
    );
  }
  const shows = browseLibrary(f.store, f.owner, f.p).shows;
  const alpha = shows.find((s) => s.title === "Alpha")!,
    beta = shows.find((s) => s.title === "Beta")!;
  assert.notEqual(alpha.key, beta.key);
  assert.equal(
    selectMedia(f.store, f.owner, f.p, {
      type: "show",
      sourceId: f.src.id,
      key: alpha.key,
      includeSpecials: false,
    }).length,
    2,
  );
});

test("commercial cutoff settings validate, persist and drive the preview and published timeline", (t) => {
  const f = setup(t),
    ads = source(f.store, "/ads", "commercials"),
    ad = media(f.store, ads.id, "ad.mp4", 12000);
  f.store.db
    .prepare("INSERT INTO source_grants VALUES(?,?,'')")
    .run(f.p, ads.id);
  const config: Programming = {
    ...f.config,
    commercialSelection: { type: "media", ids: [ad.id] },
    rules: {
      ...noBreaks,
      between: true,
      maxClips: 1,
      maxDurationMs: 10000,
      overflowPolicy: "truncate",
      minRemainingMs: 6000,
    },
  };
  const preview = f.service.preview(f.owner, f.ch.id, config, 0, 11000);
  const published = f.service.publish(f.owner, f.ch.id, config, 0, 11000);
  const reloaded = JSON.parse(
    new ProgrammingService(f.store).active(f.ch.id)!.config_json!,
  );
  assert.deepEqual(reloaded.rules, config.rules);
  assert.deepEqual(
    published.entries.map((e) => [e.kind, e.startMs, e.endMs]),
    preview.entries.map((e) => [e.kind, e.startMs, e.endMs]),
  );
  assert.equal(resolveLive(f.store, f.ch.id, 10999)?.entry.kind, "commercial");
  f.service.ensure(f.ch.id, 12000);
  assert.equal(resolveLive(f.store, f.ch.id, 11000)?.entry.mediaId, f.two.id);
  assert.equal(resolveLive(f.store, f.ch.id, 11000)?.offsetMs, 0);
  assert.equal(breakRulesSchema.safeParse(noBreaks).success, true);
  for (const extra of [
    { overflowPolicy: "invalid" },
    { minRemainingMs: -1 },
    { minRemainingMs: 0.5 },
    { minRemainingMs: 3600001 },
  ])
    assert.equal(
      breakRulesSchema.safeParse({ ...config.rules, ...extra }).success,
      false,
    );
});

for (const now of [500, 8500])
  test(`edit preview matches publication after current program and commercials at ${now}ms without writes`, (t) => {
    const f = setup(t),
      ads = source(f.store, "/ads", "commercials"),
      ad = media(f.store, ads.id, "ad.mp4", 12000);
    f.store.db
      .prepare("INSERT INTO source_grants VALUES(?,?,'')")
      .run(f.p, ads.id);
    const config: Programming = {
      ...f.config,
      commercialSelection: { type: "media", ids: [ad.id] },
      rules: {
        ...noBreaks,
        between: true,
        maxClips: 1,
        maxDurationMs: 7000,
        overflowPolicy: "truncate",
      },
    };
    f.service.publish(f.owner, f.ch.id, config, 0, 1000);
    const before = f.store.db
      .prepare("SELECT COUNT(*) AS n FROM schedule_entries")
      .get()!.n;
    const preview = f.service.preview(f.owner, f.ch.id, config, now, 30000);
    assert.equal(
      f.store.db.prepare("SELECT COUNT(*) AS n FROM schedule_entries").get()!.n,
      before,
    );
    const published = f.service.publish(f.owner, f.ch.id, config, now, 30000);
    assert.equal(preview.effectiveMs, published.effectiveMs);
    assert.deepEqual(
      preview.entries.map(({ id, programId, ...entry }) => entry),
      published.entries.map(({ id, programId, ...entry }) => entry),
    );
    assert.equal(
      preview.entries[0]?.mediaId,
      now === 500 ? f.two.id : f.one.id,
    );
  });

for (const reason of [
  "missing media",
  "revoked source",
  "disabled author",
  "revoked profile",
] as const)
  test(`expired channel can be deliberately replaced after ${reason} without altering old history`, (t) => {
    const f = setup(t),
      old = f.service.publish(f.owner, f.ch.id, f.config, 0, 2000);
    const history = f.store.db
      .prepare(
        "SELECT * FROM schedule_entries WHERE revision_id=? ORDER BY start_ms",
      )
      .all(old.revisionId);
    const playback = new PlaybackService(f.store),
      paused = playback.join(f.owner, f.p, f.ch.id, 200);
    playback.pause(f.owner, paused.id, 250);
    const admin = account(f.store, "admin"),
      nextProfile = profile(f.store, admin),
      nextSource = source(f.store, "/replacement"),
      nextMedia = media(f.store, nextSource.id);
    f.store.db
      .prepare("INSERT INTO source_grants VALUES(?,?,'')")
      .run(nextProfile, nextSource.id);
    if (reason === "missing media")
      f.store.db
        .prepare("UPDATE media SET available=0 WHERE source_id=?")
        .run(f.src.id);
    if (reason === "revoked source")
      f.store.db
        .prepare("DELETE FROM source_grants WHERE profile_id=?")
        .run(f.p);
    if (reason === "disabled author")
      f.store.db
        .prepare("UPDATE accounts SET disabled=1 WHERE id=?")
        .run(f.owner.id);
    if (reason === "revoked profile")
      f.store.db
        .prepare("UPDATE profiles SET owner_account_id=? WHERE id=?")
        .run(admin.id, f.p);
    const config: Programming = {
      ...f.config,
      profileId: nextProfile,
      groups: [
        {
          id: "replacement",
          mode: "ordered",
          selection: { type: "media", ids: [nextMedia.id] },
        },
      ],
    };
    const before = f.store.db
      .prepare("SELECT COUNT(*) AS n FROM schedule_entries")
      .get()!.n;
    const preview = f.service.preview(admin, f.ch.id, config, 10000, 3000);
    assert.equal(preview.effectiveMs, 10000);
    assert.equal(
      f.store.db.prepare("SELECT COUNT(*) AS n FROM schedule_entries").get()!.n,
      before,
    );
    const invalid: Programming = {
      ...config,
      groups: [
        {
          id: "invalid",
          mode: "ordered",
          selection: { type: "media", ids: ["unavailable"] },
        },
      ],
    };
    assert.throws(() =>
      f.service.publish(admin, f.ch.id, invalid, 10000, 3000),
    );
    assert.equal(f.service.active(f.ch.id)?.id, old.revisionId);
    const published = f.service.publish(admin, f.ch.id, config, 10000, 3000);
    assert.equal(published.effectiveMs, preview.effectiveMs);
    assert.deepEqual(
      published.entries.map(({ id, programId, ...e }) => e),
      preview.entries.map(({ id, programId, ...e }) => e),
    );
    assert.equal(
      resolveLive(f.store, f.ch.id, 10000)?.entry.mediaId,
      nextMedia.id,
    );
    assert.deepEqual(
      f.store.db
        .prepare(
          "SELECT * FROM schedule_entries WHERE revision_id=? ORDER BY start_ms",
        )
        .all(old.revisionId),
      history,
    );
    assert.equal(
      f.store.db
        .prepare("SELECT revision_id FROM playback_sessions WHERE id=?")
        .get(paused.id)?.revision_id,
      old.revisionId,
    );
  });

for (const missingSeason of [undefined, null])
  test(`fallback season selects and schedules custom episodes with ${missingSeason} season metadata`, (t) => {
    const f = setup(t),
      item = media(f.store, f.src.id, "Show/clip.mp4"),
      unavailable = media(f.store, f.src.id, "Show/missing.mp4");
    const info = JSON.stringify({
      seriesId: 7,
      seriesTitle: "Show",
      seasonNumber: missingSeason,
    });
    f.store.db
      .prepare("UPDATE media SET metadata_json=? WHERE id IN (?,?)")
      .run(info, item.id, unavailable.id);
    f.store.db
      .prepare("UPDATE media SET available=0 WHERE id=?")
      .run(unavailable.id);
    const shown = browseLibrary(f.store, f.owner, f.p).shows.find(
        (s) => s.key === "series:7",
      )!,
      season = shown.seasons.find((s) => s.number === 1)!;
    const selection = {
      type: "show" as const,
      sourceId: f.src.id,
      key: shown.key,
      season: season.number,
      includeSpecials: false,
    };
    const selected = selectMedia(f.store, f.owner, f.p, selection);
    assert.equal(selected.length, season.available);
    assert.equal(season.unavailable, 1);
    assert.deepEqual(
      new Set(selected.map((m) => m.id)),
      new Set([f.one.id, f.two.id, item.id]),
    );
    assert.ok(
      !selected.some((m) => m.id === f.special.id || m.id === unavailable.id),
    );
    const published = f.service.publish(
      f.owner,
      f.ch.id,
      { ...f.config, groups: [{ id: "fallback", mode: "ordered", selection }] },
      0,
      3000,
    );
    assert.ok(published.entries.some((e) => e.mediaId === item.id));
    assert.equal(
      f.store.db
        .prepare("SELECT metadata_json FROM media WHERE id=?")
        .get(item.id)?.metadata_json,
      info,
    );
  });

for (const missingSeason of [undefined, null]) {
  test(`mixed ${missingSeason} season metadata orders and continues as Season 1`, (t) => {
    const f = setup(t),
      third = media(f.store, f.src.id, "Show/third.mp4");
    const original = JSON.stringify({
      seriesId: 7,
      seriesTitle: "Show",
      seasonNumber: missingSeason,
      episodeNumber: 3,
    });
    f.store.db
      .prepare("UPDATE media SET metadata_json=? WHERE id=?")
      .run(original, third.id);
    const config = {
      ...f.config,
      groups: [
        {
          ...f.config.groups[0]!,
          selection: {
            type: "show" as const,
            sourceId: f.src.id,
            key: "series:7",
            season: 1,
            includeSpecials: false,
          },
        },
      ],
    };
    const expected = [f.one.id, f.two.id, third.id];
    assert.deepEqual(
      f.service
        .preview(f.owner, f.ch.id, config, 0, 3000)
        .entries.map((e) => e.mediaId),
      expected,
    );
    const published = f.service.publish(f.owner, f.ch.id, config, 0, 3000);
    assert.deepEqual(
      published.entries.map((e) => e.mediaId),
      expected,
    );
    const state = JSON.parse(f.service.active(f.ch.id)!.state_json!);
    delete state.cursors.show.seasonNumber; // Simulate a cursor serialized by the previous build.
    f.store.db
      .prepare("UPDATE schedule_revisions SET state_json=? WHERE id=?")
      .run(JSON.stringify(state), published.revisionId);
    f.store.db.prepare("UPDATE media SET available=0 WHERE id=?").run(third.id);
    const fourth = media(f.store, f.src.id, "Show/fourth.mp4");
    f.store.db.prepare("UPDATE media SET metadata_json=? WHERE id=?").run(
      JSON.stringify({
        seriesId: 7,
        seriesTitle: "Show",
        seasonNumber: 1,
        episodeNumber: 4,
      }),
      fourth.id,
    );
    f.service.ensure(f.ch.id, 4000);
    assert.equal(
      f.store.db
        .prepare(
          "SELECT media_id FROM schedule_entries WHERE revision_id=? AND start_ms=3000",
        )
        .get(published.revisionId)?.media_id,
      fourth.id,
    );
    assert.equal(
      f.store.db
        .prepare("SELECT metadata_json FROM media WHERE id=?")
        .get(third.id)?.metadata_json,
      original,
    );
  });
}
test("filename library search matches authorized episode groups without changing membership or exposing hidden files", (t) => {
  const f = setup(t),
    hiddenSource = source(f.store, "/hidden", "shows"),
    hidden = media(f.store, hiddenSource.id, "secret-episode.mp4");
  f.store.db
    .prepare("UPDATE media SET metadata_json=? WHERE id=?")
    .run(
      JSON.stringify({ seriesTitle: "Hidden show", episodeNumber: 1 }),
      hidden.id,
    );
  const found = browseLibrary(f.store, f.owner, f.p, "Season 1/1.mp4");
  assert.equal(found.shows.length, 1);
  assert.equal(
    found.shows[0]!.seasons[1]?.number ?? found.shows[0]!.seasons[0]!.number,
    1,
  );
  assert.equal(
    found.shows[0]!.seasons.find((s) => s.number === 1)!.available,
    2,
  );
  assert.equal(found.folders.length, 1);
  assert.equal(
    browseLibrary(f.store, f.owner, f.p, "SECRET-EPISODE").shows.length,
    0,
  );
  assert.equal(
    browseLibrary(f.store, f.owner, f.p, "does-not-exist").folders.length,
    0,
  );
});

test("replacing a show resets only that group's cursor and agrees in preview/publication at the current break boundary", (t) => {
  const f = setup(t),
    ads = source(f.store, "/ads", "commercials"),
    ad = media(f.store, ads.id, "ad.mp4", 100);
  f.store.db
    .prepare("INSERT INTO source_grants VALUES(?,?,'')")
    .run(f.p, ads.id);
  const newItems = [1, 2, 3].map((n) => {
    const item = media(f.store, f.src.id, `New/S01E0${n}.mp4`);
    f.store.db.prepare("UPDATE media SET metadata_json=? WHERE id=?").run(
      JSON.stringify({
        seriesId: 8,
        seriesTitle: "New",
        seasonNumber: 1,
        episodeNumber: n,
      }),
      item.id,
    );
    return item;
  });
  const initial = {
    ...f.config,
    commercialSelection: { type: "media" as const, ids: [ad.id] },
    rules: { ...noBreaks, between: true, maxClips: 1, maxDurationMs: 100 },
  };
  f.service.publish(f.owner, f.ch.id, initial, 0, 6000);
  const draft = structuredClone(initial);
  draft.groups[0]!.selection = {
    type: "show",
    sourceId: f.src.id,
    key: "series:8",
    includeSpecials: false,
  };
  const preview = f.service.preview(f.owner, f.ch.id, draft, 500, 4000);
  assert.equal(preview.effectiveMs, 1100);
  assert.equal(preview.entries[0]!.mediaId, newItems[0]!.id);
  const publish = f.service.publish(f.owner, f.ch.id, draft, 500, 4000);
  assert.equal(publish.effectiveMs, 1100);
  assert.deepEqual(
    publish.entries.map((e) => [e.mediaId, e.startMs, e.endMs, e.offsetMs]),
    preview.entries.map((e) => [e.mediaId, e.startMs, e.endMs, e.offsetMs]),
  );
  assert.equal(resolveLive(f.store, f.ch.id, 1000)?.entry.mediaId, ad.id);
  assert.equal(
    resolveLive(f.store, f.ch.id, 1100)?.entry.mediaId,
    newItems[0]!.id,
  );
});

test("unavailable groups retain configured rotation through extension, return, reorder and removal", (t) => {
  const f = setup(t),
    b = media(f.store, f.src.id, "B.mp4"),
    c = media(f.store, f.src.id, "C.mp4");
  const groups = [f.one, b, c].map((item, i) => ({
    id: ["a", "b", "c"][i]!,
    mode: "ordered" as const,
    selection: { type: "media" as const, ids: [item.id] },
  }));
  const config = { ...f.config, groups };
  f.service.publish(f.owner, f.ch.id, config, 0, 2000);
  f.store.db.prepare("UPDATE media SET available=0 WHERE id=?").run(f.one.id);
  f.service.ensure(f.ch.id, 5000);
  assert.deepEqual(
    [0, 1000, 2000, 3000, 4000].map(
      (ms) => resolveLive(f.store, f.ch.id, ms)?.entry.mediaId,
    ),
    [f.one.id, b.id, c.id, b.id, c.id],
  );
  f.store.db.prepare("UPDATE media SET available=1 WHERE id=?").run(f.one.id);
  f.service.ensure(f.ch.id, 6000);
  assert.equal(resolveLive(f.store, f.ch.id, 5000)?.entry.mediaId, f.one.id);
  const reordered = { ...config, groups: [groups[2]!, groups[1]!, groups[0]!] };
  const preview = f.service.preview(f.owner, f.ch.id, reordered, 5500, 4000);
  assert.equal(preview.entries[0]!.mediaId, b.id);
  const removed = { ...config, groups: [groups[0]!, groups[2]!] };
  assert.equal(
    f.service.preview(f.owner, f.ch.id, removed, 5500, 4000).entries[0]!
      .mediaId,
    c.id,
  );
});

test("episodes per turn is optional and survives schedule chunks and publication checkpoints", (t) => {
  const f = setup(t),
    b = media(f.store, f.src.id, "B1.mp4"),
    b2 = media(f.store, f.src.id, "B2.mp4");
  const config = {
    ...f.config,
    groups: [
      { ...f.config.groups[0]!, episodesPerTurn: 2 },
      {
        id: "b",
        mode: "ordered" as const,
        selection: { type: "media" as const, ids: [b.id, b2.id] },
      },
    ],
  };
  f.service.publish(f.owner, f.ch.id, config, 0, 1000);
  for (let end = 2000; end <= 6000; end += 1000) f.service.ensure(f.ch.id, end);
  assert.deepEqual(
    [0, 1000, 2000, 3000, 4000, 5000].map(
      (ms) => resolveLive(f.store, f.ch.id, ms)?.entry.mediaId,
    ),
    [f.one.id, f.two.id, b.id, f.one.id, f.two.id, b2.id],
  );
  const preview = f.service.preview(f.owner, f.ch.id, config, 500, 4000),
    published = f.service.publish(f.owner, f.ch.id, config, 500, 4000);
  assert.equal(preview.entries[0]!.mediaId, f.two.id);
  assert.deepEqual(
    preview.entries.map((e) => e.mediaId),
    published.entries.map((e) => e.mediaId),
  );
});
