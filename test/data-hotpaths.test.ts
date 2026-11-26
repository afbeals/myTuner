import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import Fastify from "fastify";
import { Store } from "../src/database.js";
import {
  browseLibrarySummary,
  browseMediaPage,
  catalog,
  saveCollection,
} from "../src/library.js";
import { browseLibraryPage } from "../src/library-page.js";
import { requireChannelMedia } from "../src/security.js";
import { PlaybackService } from "../src/playback.js";
import { ProgrammingService } from "../src/programming.js";
import { noBreaks, persistSchedule, buildSchedule } from "../src/scheduler.js";
import { registerFoundationRoutes } from "../src/foundation-routes.js";
import { account, profile, source, media, channel } from "./helpers.js";
import type { Programming } from "../src/contracts.js";

function fixture(t: { after: (callback: () => unknown) => void }) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const owner = account(store),
    p = profile(store, owner),
    src = source(store);
  store.db
    .prepare(
      "INSERT INTO source_grants(profile_id,source_id,subtree) VALUES(?,?,'')",
    )
    .run(p, src.id);
  return { store, owner, p, src };
}
function countQueries(store: Store) {
  const original = store.db.prepare.bind(store.db),
    queries: string[] = [];
  store.db.prepare = ((sql: string, ...rest: unknown[]) => {
    queries.push(sql);
    return original(sql, ...(rest as []));
  }) as typeof store.db.prepare;
  return {
    queries,
    restore: () => {
      store.db.prepare = original;
    },
  };
}

test("50k movie pages reuse compact projections through telemetry and hydrate only the page", (t) => {
  const f = fixture(t);
  f.store.db
    .prepare("UPDATE sources SET kind='movies' WHERE id=?")
    .run(f.src.id);
  const insert = f.store.db.prepare(
    "INSERT INTO media(id,source_id,relative_path,title,duration_ms,size,mtime_ms,metadata_json) VALUES(?,?,?,?,1000,10,0,?)",
  );
  const metadata = JSON.stringify({
    localNfoValid: true,
    local: { overview: "Stored description ".repeat(60) },
  });
  f.store.transaction(() => {
    for (let i = 0; i < 50000; i++) {
      const title = `Movie ${String(i).padStart(6, "0")}`;
      insert.run(
        `movie-${i}`,
        f.src.id,
        `Movies/${title}.mp4`,
        title,
        metadata,
      );
    }
  });
  const read = (offset: number) =>
    browseLibraryPage(f.store, f.owner, f.p, {
      search: "",
      kind: "movies",
      offset,
      limit: 24,
    });
  const first = read(0);
  assert.equal(first.movies.length, 24);
  assert.equal(first.pagination.total, 50001); // Includes the selectable movie folder.
  assert.equal(
    first.movies[0]!.metadata.overview,
    "Stored description ".repeat(60),
  );
  const before = f.store.db
    .prepare("SELECT revision FROM catalog_revision")
    .get()!.revision;
  f.store.db
    .prepare(
      "INSERT INTO playback_events(id,session_id,account_id,channel_id,entry_id,start_ms,end_ms,created_ms) VALUES('event','session',?,'channel','entry',0,1,0)",
    )
    .run(f.owner.id);
  assert.equal(
    f.store.db.prepare("SELECT revision FROM catalog_revision").get()!.revision,
    before,
  );
  const counter = countQueries(f.store);
  const second = read(24);
  counter.restore();
  assert.equal(second.movies.length, 24);
  assert.notEqual(first.movies[0]!.id, second.movies[0]!.id);
  assert.ok(counter.queries.length < 20, `${counter.queries.length} queries`);
  assert.ok(
    !counter.queries.some((sql) => sql.includes("SELECT m.* FROM media m")),
    "A page must not rebuild the full catalog after telemetry",
  );
  const searchCounter = countQueries(f.store);
  const searched = browseLibraryPage(f.store, f.owner, f.p, {
    search: "Movie 000123",
    kind: "movies",
    offset: 0,
    limit: 24,
  });
  const anotherSearch = browseLibraryPage(f.store, f.owner, f.p, {
    search: "Movie 000124",
    kind: "movies",
    offset: 0,
    limit: 24,
  });
  searchCounter.restore();
  assert.equal(searched.movies[0]!.id, "movie-123");
  assert.equal(anotherSearch.movies[0]!.id, "movie-124");
  assert.ok(
    !searchCounter.queries.some((sql) =>
      sql.includes("SELECT m.* FROM media m"),
    ),
    "New search strings must reuse the base projection",
  );
  f.store.db
    .prepare("UPDATE media SET available=0 WHERE id=?")
    .run(second.movies[0]!.id);
  assert.equal(read(24).movies[0]!.available, false);
});

test("raw media search caches lowercase display/path fields while no-search reads page in SQL", (t) => {
  const f = fixture(t),
    item = media(f.store, f.src.id, "Original.Episode.mp4");
  const inspect = browseMediaPage(f.store, f.owner, f.p, {
    search: "original.episode",
    page: 1,
    limit: 1,
  });
  assert.equal(inspect.total, 1);
  const counter = countQueries(f.store);
  assert.equal(
    browseMediaPage(f.store, f.owner, f.p, {
      search: "EPISODE",
      page: 1,
      limit: 1,
    }).items[0]!.id,
    item.id,
  );
  assert.ok(
    !counter.queries.some((sql) => sql.includes("SELECT m.* FROM media m")),
  );
  counter.restore();
  const plan = f.store.db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT m.* FROM media m WHERE m.available=1 ORDER BY m.title,m.id LIMIT ? OFFSET ?",
    )
    .all(1, 0);
  assert.match(JSON.stringify(plan), /media_available_title/);
  assert.doesNotMatch(JSON.stringify(plan), /TEMP B-TREE/);
  const plain = countQueries(f.store);
  browseMediaPage(f.store, f.owner, f.p, { search: "", page: 1, limit: 1 });
  plain.restore();
  assert.ok(plain.queries.some((sql) => sql.includes("COUNT(*) AS total")));
  assert.ok(plain.queries.some((sql) => sql.includes("LIMIT ? OFFSET ?")));
  f.store.db.prepare("DELETE FROM source_grants WHERE profile_id=?").run(f.p);
  assert.equal(
    browseMediaPage(f.store, f.owner, f.p, {
      search: "episode",
      page: 1,
      limit: 1,
    }).total,
    0,
  );
});

test("raw writes invalidate content caches and transaction rollback cannot publish a reused revision", (t) => {
  const f = fixture(t),
    item = media(f.store, f.src.id);
  f.store.db
    .prepare("UPDATE sources SET kind='movies' WHERE id=?")
    .run(f.src.id);
  const title = () =>
    browseLibrarySummary(f.store, f.owner, f.p).movies[0]!.title;
  const original = title();
  assert.throws(
    () =>
      f.store.transaction(() => {
        f.store.db
          .prepare("UPDATE media SET title='Transient' WHERE id=?")
          .run(item.id);
        assert.equal(title(), "Transient");
        throw new Error("rollback");
      }),
    /rollback/,
  );
  assert.equal(title(), original);
  f.store.db
    .prepare("UPDATE media SET title='Committed' WHERE id=?")
    .run(item.id);
  assert.equal(title(), "Committed");
  f.store.db.prepare("DELETE FROM source_grants WHERE profile_id=?").run(f.p);
  assert.equal(browseLibrarySummary(f.store, f.owner, f.p).movies.length, 0);
});

test("a cached catalog never bypasses profile PIN expiry", (t) => {
  const f = fixture(t);
  media(f.store, f.src.id);
  Object.defineProperty(f.owner, "sessionHash", { value: "authenticated" });
  f.store.db
    .prepare(
      "INSERT INTO sessions(token_hash,account_id,expires_at) VALUES('authenticated',?,?)",
    )
    .run(f.owner.id, Date.now() + 60000);
  f.store.db
    .prepare("UPDATE profiles SET pin_hash='protected' WHERE id=?")
    .run(f.p);
  f.store.db
    .prepare(
      "INSERT INTO profile_unlocks(session_hash,profile_id,expires_ms) VALUES('authenticated',?,?)",
    )
    .run(f.p, Date.now() + 60000);
  assert.equal(browseLibrarySummary(f.store, f.owner, f.p).sources.length, 1);
  f.store.db.prepare("UPDATE profile_unlocks SET expires_ms=0").run();
  assert.throws(() => browseLibrarySummary(f.store, f.owner, f.p), /locked/);
});

test("future channel authorization has constant query count and includes unavailable media/subtree boundaries", (t) => {
  const f = fixture(t),
    ch = channel(f.store, f.owner),
    revision = "revision";
  f.store.db
    .prepare(
      "INSERT INTO schedule_revisions(id,channel_id,created_at) VALUES(?,?,0)",
    )
    .run(revision, ch.id);
  const insert = f.store.db.prepare(
    "INSERT INTO media(id,source_id,relative_path,title,duration_ms,size,mtime_ms,available) VALUES(?,?,?,?,1000,10,0,?)",
  );
  const entry = f.store.db.prepare(
    "INSERT INTO schedule_entries(id,revision_id,channel_id,media_id,program_id,start_ms,end_ms,offset_ms,kind) VALUES(?,?,?,?,?,?,?,0,'program')",
  );
  f.store.transaction(() => {
    for (let i = 0; i < 5000; i++) {
      insert.run(
        `m-${i}`,
        f.src.id,
        i === 4999 ? "Safely/private.mp4" : `Safe/${i}.mp4`,
        "Synthetic",
        i === 4999 ? 0 : 1,
      );
      entry.run(
        `e-${i}`,
        revision,
        ch.id,
        `m-${i}`,
        `p-${i}`,
        i * 1000,
        (i + 1) * 1000,
      );
    }
  });
  const counter = countQueries(f.store);
  requireChannelMedia(f.store, f.owner, f.p, ch, {
    revisionId: revision,
    positionMs: 0,
  });
  counter.restore();
  assert.ok(counter.queries.length <= 5, `${counter.queries.length} queries`);
  f.store.db
    .prepare("UPDATE source_grants SET subtree='Safe' WHERE profile_id=?")
    .run(f.p);
  assert.throws(
    () =>
      requireChannelMedia(f.store, f.owner, f.p, ch, {
        revisionId: revision,
        positionMs: 0,
      }),
    /not found/,
  );
  assert.doesNotThrow(() =>
    requireChannelMedia(f.store, account(f.store, "admin"), f.p, ch, {
      revisionId: revision,
      positionMs: 0,
    }),
  );
});

test("playback polls persist liveness at most every thirty seconds while revocation remains immediate", (t) => {
  const f = fixture(t),
    ch = channel(f.store, f.owner),
    item = media(f.store, f.src.id, "video.mp4", 100000);
  const built = buildSchedule({
    channelId: ch.id,
    startMs: 0,
    untilMs: 100000,
    groups: [
      {
        id: "g",
        mode: "ordered",
        clips: [{ id: item.id, durationMs: 100000 }],
      },
    ],
    rules: noBreaks,
    commercials: [],
  });
  persistSchedule(f.store, ch.id, built.entries, built.state);
  const service = new PlaybackService(f.store),
    session = service.join(f.owner, f.p, ch.id, 1000);
  for (let now = 2000; now < 31000; now += 1000)
    service.describe(f.owner, session.id, now);
  assert.equal(
    f.store.db
      .prepare("SELECT last_seen FROM playback_sessions WHERE id=?")
      .get(session.id)!.last_seen,
    1000,
  );
  service.describe(f.owner, session.id, 31000);
  assert.equal(
    f.store.db
      .prepare("SELECT last_seen FROM playback_sessions WHERE id=?")
      .get(session.id)!.last_seen,
    31000,
  );
  f.store.db.prepare("DELETE FROM source_grants WHERE profile_id=?").run(f.p);
  assert.throws(
    () => service.describe(f.owner, session.id, 32000),
    /not found/,
  );
});

test("statistics union overlapping intervals per entry/session and batch permission/title lookups", async (t) => {
  const f = fixture(t),
    ch = channel(f.store, f.owner),
    item = media(f.store, f.src.id),
    hiddenSource = source(f.store, "/hidden"),
    hidden = media(f.store, hiddenSource.id, "Hidden.mp4");
  const app = Fastify();
  t.after(() => app.close());
  registerFoundationRoutes(
    app,
    f.store,
    () => f.owner,
    new ProgrammingService(f.store),
  );
  const event = f.store.db.prepare(
    "INSERT INTO playback_events(id,session_id,account_id,channel_id,entry_id,start_ms,end_ms,created_ms,media_id,kind) VALUES(?,?,?,?,?,?,?,0,?,'program')",
  );
  f.store.transaction(() => {
    const ranges = [
      [0, 100],
      [50, 150],
      [150, 200],
      [180, 190],
      [300, 400],
    ];
    for (let i = 0; i < 1000; i++) {
      const range = ranges[i % ranges.length]!;
      event.run(
        `event-${i}`,
        "session",
        f.owner.id,
        ch.id,
        "entry",
        range[0]!,
        range[1]!,
        item.id,
      );
    }
    event.run(
      "other-session",
      "other-session",
      f.owner.id,
      ch.id,
      "entry",
      50,
      75,
      item.id,
    );
    event.run(
      "other-entry",
      "session",
      f.owner.id,
      ch.id,
      "other-entry",
      0,
      10,
      item.id,
    );
    event.run(
      "hidden",
      "session",
      f.owner.id,
      ch.id,
      "hidden-entry",
      0,
      100,
      hidden.id,
    );
    event.run(
      "other-account",
      "session",
      account(f.store).id,
      ch.id,
      "entry",
      0,
      1000,
      item.id,
    );
  });
  const counter = countQueries(f.store);
  const response = await app.inject(
    `/api/profiles/${f.p}/channels/${ch.id}/statistics`,
  );
  counter.restore();
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().deliveredForCurrentAccount, [
    { mediaId: item.id, kind: "program", deliveredMs: 335, title: item.title },
  ]);
  assert.ok(counter.queries.length < 25, `${counter.queries.length} queries`);
  assert.doesNotMatch(response.body, /Hidden/);
});

function programming(t: { after: (callback: () => unknown) => void }) {
  const f = fixture(t),
    ch = channel(f.store, f.owner);
  media(f.store, f.src.id);
  const service = new ProgrammingService(f.store, 1000);
  const config: Programming = {
    profileId: f.p,
    seed: 42,
    groups: [
      {
        id: "g",
        mode: "ordered",
        selection: {
          type: "folder",
          sourceId: f.src.id,
          directory: "",
          recursive: true,
        },
      },
    ],
    rules: noBreaks,
  };
  service.publish(f.owner, ch.id, config, 0, 1000);
  return { ...f, ch, service };
}
test("background extension yields committed batches and respects an interleaved request extension", async (t) => {
  const f = programming(t),
    until = 3000000;
  const task = f.service.ensureBackground(f.ch.id, until);
  await setImmediate();
  const end = Number(
    f.store.db.prepare("SELECT MAX(end_ms) AS end FROM schedule_entries").get()!
      .end,
  );
  assert.ok(
    end > 1000 && end < until,
    `Expected one bounded committed batch, found ${end}`,
  );
  f.service.ensure(f.ch.id, until);
  await task;
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS count FROM schedule_entries").get()!
      .count,
    3000,
  );
  assert.equal(
    f.store.db
      .prepare(
        "SELECT COUNT(*) AS count FROM (SELECT start_ms,LAG(end_ms) OVER (ORDER BY start_ms) AS previous FROM schedule_entries) WHERE previous IS NOT NULL AND previous<>start_ms",
      )
      .get()!.count,
    0,
  );
});
test("background extension rechecks disabled authors between committed batches", async (t) => {
  const f = programming(t);
  const task = f.service.ensureBackground(f.ch.id, 3000000);
  await setImmediate();
  const count = f.store.db
    .prepare("SELECT COUNT(*) AS count FROM schedule_entries")
    .get()!.count;
  f.store.db
    .prepare("UPDATE accounts SET disabled=1 WHERE id=?")
    .run(f.owner.id);
  await assert.rejects(task, /Authentication required/);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS count FROM schedule_entries").get()!
      .count,
    count,
  );
});

test("background extension reloads raw collection membership changes between batches", async (t) => {
  const f = fixture(t),
    ch = channel(f.store, f.owner);
  const a = media(f.store, f.src.id, "A.mp4"),
    b = media(f.store, f.src.id, "B.mp4");
  const collection = saveCollection(f.store, f.owner, f.p, "Selection", [a.id]);
  const service = new ProgrammingService(f.store, 1000);
  const config: Programming = {
    profileId: f.p,
    seed: 42,
    groups: [
      {
        id: "g",
        mode: "ordered",
        selection: { type: "collection", id: collection.id },
      },
    ],
    rules: noBreaks,
  };
  service.publish(f.owner, ch.id, config, 0, 1000);
  const task = service.ensureBackground(ch.id, 3000000);
  await setImmediate();
  const boundary = Number(
    f.store.db.prepare("SELECT MAX(end_ms) AS end FROM schedule_entries").get()!
      .end,
  );
  saveCollection(f.store, f.owner, f.p, "Selection", [b.id], collection.id);
  await task;
  assert.equal(
    f.store.db
      .prepare(
        "SELECT COUNT(*) AS n FROM schedule_entries WHERE start_ms>=? AND media_id<>?",
      )
      .get(boundary, b.id)!.n,
    0,
  );
  assert.ok(
    Number(
      f.store.db
        .prepare("SELECT COUNT(*) AS n FROM schedule_entries WHERE media_id=?")
        .get(b.id)!.n,
    ) > 0,
  );
});

test("delivery heartbeat requires new forward reports, expires, and ignores polling and retries", (t) => {
  const f = fixture(t),
    ch = channel(f.store, f.owner),
    item = media(f.store, f.src.id, "video.mp4", 100000);
  const built = buildSchedule({
    channelId: ch.id,
    startMs: 0,
    untilMs: 100000,
    groups: [
      {
        id: "g",
        mode: "ordered",
        clips: [{ id: item.id, durationMs: 100000 }],
      },
    ],
    rules: noBreaks,
    commercials: [],
  });
  persistSchedule(f.store, ch.id, built.entries, built.state);
  const service = new PlaybackService(f.store),
    session = service.join(f.owner, f.p, ch.id, 1000),
    entryId = built.entries[0]!.id;
  service.describe(f.owner, session.id, 2000);
  assert.equal(service.isDelivering(session.id, 2000), false);
  const event = { id: "first", entryId, startMs: 1000, endMs: 2000 };
  service.record(f.owner, session.id, event, 2000);
  assert.equal(service.isDelivering(session.id, 2000), true);
  service.record(f.owner, session.id, event, 16000); // Idempotent retry cannot refresh it.
  service.record(f.owner, session.id, { ...event, id: "overlap" }, 16000);
  service.describe(f.owner, session.id, 18000);
  assert.equal(service.isDelivering(session.id, 18000), false);
  service.record(
    f.owner,
    session.id,
    { ...event, id: "forward", startMs: 18000, endMs: 19000 },
    19000,
  );
  assert.equal(service.isDelivering(session.id, 19000), true);
  assert.equal(service.isDelivering(session.id, 80000), false);
  service.record(
    f.owner,
    session.id,
    { ...event, id: "later", startMs: 80000, endMs: 81000 },
    81000,
  );
  service.leave(f.owner, session.id);
  assert.equal(service.isDelivering(session.id, 81000), false);
});

test("oversized index input is refused before metadata materialization and the failure is cached", (t) => {
  const f = fixture(t),
    item = media(f.store, f.src.id);
  // A synthetic blob avoids allocating a large string in the test process. It
  // must be rejected by byte admission before any JSON projection is attempted.
  f.store.db
    .prepare("UPDATE media SET metadata_json=zeroblob(?) WHERE id=?")
    .run(64 * 1024 * 1024, item.id);
  assert.throws(
    () => browseLibrarySummary(f.store, f.owner, f.p),
    /browsing budget exceeded/,
  );
  const counter = countQueries(f.store);
  assert.throws(
    () => browseLibrarySummary(f.store, f.owner, f.p, "another search"),
    /browsing budget exceeded/,
  );
  counter.restore();
  assert.ok(
    !counter.queries.some(
      (sql) => sql.includes("SUM(") || sql.includes("SELECT m.* FROM media m"),
    ),
    "Do not retry an oversized index on each new query",
  );
  f.store.db
    .prepare("UPDATE media SET metadata_json='{}' WHERE id=?")
    .run(item.id);
  assert.equal(browseLibrarySummary(f.store, f.owner, f.p).sources.length, 1);
});
