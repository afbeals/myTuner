import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSchedule,
  initialState,
  noBreaks,
  orderedClips,
  persistSchedule,
  resolveLive,
} from "../src/scheduler.js";
import { Store } from "../src/database.js";
import { account, channel, media, source } from "./helpers.js";
import type { BreakRules, Clip, Group } from "../src/scheduler.js";
const group = (clips: Clip[], mode: Group["mode"] = "ordered"): Group => ({
  id: "shows",
  mode,
  clips,
});
const build = (
  groups: Group[],
  untilMs = 10_000,
  rules: BreakRules = noBreaks,
  commercials: Clip[] = [],
) =>
  buildSchedule({
    channelId: "channel",
    startMs: 0,
    untilMs,
    groups,
    commercials,
    rules,
  });
const rules = (extra: Partial<BreakRules> = {}): BreakRules => ({
  ...noBreaks,
  between: true,
  maxClips: 1,
  maxDurationMs: 1000,
  ...extra,
});
const sequence = (entries: ReturnType<typeof build>["entries"]) =>
  entries.map(({ id, programId, ...entry }) => entry);

test("ordered groups alternate and advance their own episode sequence", () => {
  const result = build(
    [
      {
        id: "a",
        mode: "ordered",
        clips: [
          { id: "a2", durationMs: 1000, episodeNumber: 2 },
          { id: "a1", durationMs: 1000, episodeNumber: 1 },
        ],
      },
      {
        id: "b",
        mode: "ordered",
        clips: [
          { id: "b1", durationMs: 1000 },
          { id: "b2", durationMs: 1000 },
        ],
      },
    ],
    4000,
  );
  assert.deepEqual(
    result.entries.map((e) => e.mediaId),
    ["a1", "b1", "a2", "b2"],
  );
});
test("natural filename order places episode 2 before 10", () =>
  assert.deepEqual(
    orderedClips([
      { id: "10", title: "Episode 10", durationMs: 1 },
      { id: "2", title: "Episode 2", durationMs: 1 },
    ]).map((c) => c.id),
    ["2", "10"],
  ));
test("mid-roll preserves all source content and resumes at original offset", () => {
  const result = build(
    [group([{ id: "show", durationMs: 1000 }])],
    1,
    rules({
      between: false,
      positions: [
        { kind: "percent", value: 25 },
        { kind: "timestamp", value: 750 },
      ],
    }),
    [{ id: "ad", durationMs: 100 }],
  );
  assert.deepEqual(
    result.entries.map((e) => [e.kind, e.startMs, e.endMs, e.offsetMs]),
    [
      ["program", 0, 250, 0],
      ["commercial", 250, 350, 0],
      ["program", 350, 850, 250],
      ["commercial", 850, 950, 0],
      ["program", 950, 1200, 750],
    ],
  );
});
test("duplicate or out-of-program split points never produce zero/negative segments", () => {
  const result = build(
    [group([{ id: "s", durationMs: 1000 }])],
    1,
    rules({
      between: false,
      positions: [
        { kind: "percent", value: 50 },
        { kind: "timestamp", value: 500 },
        { kind: "timestamp", value: 5000 },
      ],
    }),
    [],
  );
  assert.deepEqual(
    result.entries.map((e) => e.endMs - e.startMs),
    [500, 500],
  );
});
test("seeded shuffle is deterministic and visits every item before repetition", () => {
  const clips = ["a", "b", "c", "d"].map((id) => ({ id, durationMs: 1000 }));
  const first = build([group(clips, "shuffle")], 8000),
    second = build([group(clips, "shuffle")], 8000);
  assert.deepEqual(sequence(first.entries), sequence(second.entries));
  assert.equal(
    new Set(first.entries.slice(0, 4).map((e) => e.mediaId)).size,
    4,
  );
  assert.equal(
    new Set(first.entries.slice(4, 8).map((e) => e.mediaId)).size,
    4,
  );
});
test("continued random rotation equals uninterrupted generation without mutating input state", () => {
  const groups = [
    group(
      ["a", "b", "c"].map((id) => ({ id, durationMs: 1000 })),
      "random",
    ),
  ];
  const original = initialState(42),
    snapshot = structuredClone(original);
  const first = buildSchedule({
    channelId: "channel",
    startMs: 0,
    untilMs: 4000,
    groups,
    commercials: [],
    rules: noBreaks,
    state: original,
  });
  const second = buildSchedule({
    channelId: "channel",
    startMs: 4000,
    untilMs: 8000,
    groups,
    commercials: [],
    rules: noBreaks,
    state: first.state,
  });
  const full = buildSchedule({
    channelId: "channel",
    startMs: 0,
    untilMs: 8000,
    groups,
    commercials: [],
    rules: noBreaks,
    state: initialState(42),
  });
  assert.deepEqual(
    sequence([...first.entries, ...second.entries]),
    sequence(full.entries),
  );
  assert.deepEqual(original, snapshot);
});
for (const allowance of [1, 2, 3])
  test(`commercial pool supports ${allowance} appearances per clip per rotation`, () => {
    const result = build(
      [group([{ id: "s", durationMs: 1000 }])],
      2 * allowance * 1100,
      rules({ repeatAllowance: allowance }),
      [
        { id: "a", durationMs: 100 },
        { id: "b", durationMs: 100 },
      ],
    );
    const ads = result.entries.filter((e) => e.kind === "commercial");
    assert.equal(ads.length, 2 * allowance);
    assert.equal(ads.filter((e) => e.mediaId === "a").length, allowance);
    assert.equal(ads.filter((e) => e.mediaId === "b").length, allowance);
  });
test("one-clip pool repeats only up to configured within-break limit", () => {
  const result = build(
    [group([{ id: "s", durationMs: 1000 }])],
    1,
    rules({ maxClips: 10, repeatAllowance: 3, maxPerBreak: 3 }),
    [{ id: "ad", durationMs: 100 }],
  );
  assert.equal(result.entries.filter((e) => e.kind === "commercial").length, 3);
});
test("duration cap and cooldown shorten impossible breaks without a loop", () => {
  const result = build(
    [group([{ id: "s", durationMs: 1000 }])],
    3000,
    rules({
      maxClips: 100,
      maxDurationMs: 150,
      cooldownMs: 10000,
      maxPerBreak: 3,
    }),
    [
      { id: "ad", durationMs: 100 },
      { id: "too-long", durationMs: 1000 },
    ],
  );
  assert.equal(result.entries.filter((e) => e.kind === "commercial").length, 1);
});
test("random break positions remain internal and total source duration is preserved", () => {
  const result = build(
    [group([{ id: "s", durationMs: 123456 }])],
    1,
    rules({
      between: false,
      random: { count: 5, minPercent: 10, maxPercent: 90 },
    }),
    [{ id: "ad", durationMs: 100 }],
  );
  const programs = result.entries.filter((e) => e.kind === "program");
  assert.equal(
    programs.reduce((sum, e) => sum + e.endMs - e.startMs, 0),
    123456,
  );
  assert.equal(programs.length, 6);
  assert.ok(
    result.entries.every(
      (e, i) => i === 0 || result.entries[i - 1]!.endMs === e.startMs,
    ),
  );
});
test("invalid empty programming and limits fail explicitly", () => {
  assert.throws(() => build([]), /available media/);
  assert.throws(() => build([group([{ id: "s", durationMs: 0 }])]), /duration/);
  assert.throws(
    () =>
      build(
        [group([{ id: "s", durationMs: 1 }])],
        1,
        rules({ repeatAllowance: 0 }),
      ),
    /repeat/,
  );
});
test("schedule commits atomically and resolves interval boundaries after database reopen", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-db-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let store = new Store(join(root, "data.db"));
  const owner = account(store),
    src = source(store),
    show = media(store, src.id),
    ad = media(store, src.id, "ad.mp4", 200),
    ch = channel(store, owner);
  const result = buildSchedule({
    channelId: ch.id,
    startMs: 1000,
    untilMs: 2000,
    groups: [group([{ id: show.id, durationMs: 1000 }])],
    commercials: [{ id: ad.id, durationMs: 200 }],
    rules: rules({
      between: false,
      positions: [{ kind: "percent", value: 50 }],
      maxDurationMs: 100,
      overflowPolicy: "truncate",
      minRemainingMs: 0,
    }),
  });
  persistSchedule(store, ch.id, result.entries, result.state);
  store.close();
  store = new Store(join(root, "data.db"));
  t.after(() => store.close());
  assert.equal(resolveLive(store, ch.id, 999), null);
  assert.equal(resolveLive(store, ch.id, 1499)?.offsetMs, 499);
  assert.equal(resolveLive(store, ch.id, 1500)?.entry.kind, "commercial");
  assert.equal(resolveLive(store, ch.id, 1599)?.offsetMs, 99);
  assert.equal(resolveLive(store, ch.id, 1600)?.offsetMs, 500);
  assert.equal(resolveLive(store, ch.id, 2100), null);
  const invalid = result.entries.map((e) => ({
    ...e,
    id: randomUUID(),
    mediaId: randomUUID(),
  }));
  assert.throws(() => persistSchedule(store, ch.id, invalid, result.state));
  assert.equal(resolveLive(store, ch.id, 1600)?.offsetMs, 500);
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM schedule_revisions").get()?.n,
    1,
  );
});

test("cutoff fills ten seconds from a twelve-second commercial and resumes the whole show contiguously", () => {
  const result = build(
    [group([{ id: "show", durationMs: 20000 }])],
    1,
    rules({
      between: false,
      positions: [{ kind: "percent", value: 50 }],
      maxDurationMs: 10000,
      overflowPolicy: "truncate",
    }),
    [{ id: "ad", durationMs: 12000 }],
  );
  assert.deepEqual(
    result.entries.map((e) => [e.kind, e.startMs, e.endMs, e.offsetMs]),
    [
      ["program", 0, 10000, 0],
      ["commercial", 10000, 20000, 0],
      ["program", 20000, 30000, 10000],
    ],
  );
  assert.equal(result.state.commercialCounts.ad, 1);
});

for (const [budget, expected] of [
  [0, 0],
  [5999, 0],
  [6000, 0],
  [6001, 6001],
  [10000, 10000],
] as const)
  test(`cutoff default minimum is strict: ${budget}ms remaining plays ${expected}ms`, () => {
    const result = build(
      [group([{ id: "s", durationMs: 20000 }])],
      1,
      rules({ overflowPolicy: "truncate", maxDurationMs: budget }),
      [{ id: "ad", durationMs: 12000 }],
    );
    assert.equal(
      result.entries
        .filter((e) => e.kind === "commercial")
        .reduce((sum, e) => sum + e.endMs - e.startMs, 0),
      expected,
    );
    assert.ok(result.entries.every((e) => e.endMs > e.startMs));
  });

test("cutoff checks the configurable minimum after each full commercial, including exact equality", () => {
  const make = (minimum: number) =>
    build(
      [group([{ id: "s", durationMs: 20000 }])],
      1,
      rules({
        overflowPolicy: "truncate",
        maxDurationMs: 22000,
        minRemainingMs: minimum,
        maxClips: 3,
        maxPerBreak: 3,
        repeatAllowance: 3,
      }),
      [{ id: "ad", durationMs: 12000 }],
    );
  const partial = make(9999),
    early = make(10000);
  assert.deepEqual(
    partial.entries
      .filter((e) => e.kind === "commercial")
      .map((e) => e.endMs - e.startMs),
    [12000, 10000],
  );
  assert.equal(partial.state.commercialCounts.ad, 2);
  assert.deepEqual(
    early.entries
      .filter((e) => e.kind === "commercial")
      .map((e) => e.endMs - e.startMs),
    [12000],
  );
  assert.equal(make(0).entries.at(-1)?.endMs, 42000);
});

test("cutoff still respects clip count, per-break repeats and cooldown without padding", () => {
  for (const limit of [
    { maxClips: 1 },
    { maxPerBreak: 1 },
    { cooldownMs: 13000 },
  ]) {
    const result = build(
      [group([{ id: "s", durationMs: 20000 }])],
      1,
      rules({
        overflowPolicy: "truncate",
        maxDurationMs: 22000,
        maxClips: 3,
        maxPerBreak: 3,
        repeatAllowance: 3,
        ...limit,
      }),
      [{ id: "ad", durationMs: 12000 }],
    );
    assert.equal(result.entries.length, 2);
    assert.equal(result.entries.at(-1)?.endMs, 32000);
  }
});

test("legacy and explicit whole-commercial rules skip oversized clips", () => {
  for (const policy of [{}, { overflowPolicy: "skip" as const }]) {
    const result = build(
      [group([{ id: "s", durationMs: 20000 }])],
      1,
      rules({ maxDurationMs: 10000, ...policy }),
      [{ id: "ad", durationMs: 12000 }],
    );
    assert.deepEqual(
      result.entries.map((e) => e.kind),
      ["program"],
    );
  }
});

test("cutoff choices and partial durations survive scheduler continuation", () => {
  const input = {
    channelId: "ch",
    groups: [group([{ id: "s", durationMs: 20000 }])],
    commercials: [
      { id: "a", durationMs: 12000 },
      { id: "b", durationMs: 15000 },
    ],
    rules: rules({
      maxDurationMs: 10000,
      overflowPolicy: "truncate",
      repeatAllowance: 2,
    }),
  };
  const first = buildSchedule({ ...input, startMs: 0, untilMs: 30000 });
  const continued = buildSchedule({
    ...input,
    startMs: 30000,
    untilMs: 120000,
    state: first.state,
  });
  const uninterrupted = buildSchedule({
    ...input,
    startMs: 0,
    untilMs: 120000,
  });
  assert.deepEqual(
    sequence([...first.entries, ...continued.entries]),
    sequence(uninterrupted.entries),
  );
  assert.deepEqual(continued.state, uninterrupted.state);
});

test("cutoff rejects invalid policy and minimum values", () => {
  for (const minimum of [-1, 0.5, NaN, Infinity, 3600001])
    assert.throws(
      () =>
        build(
          [group([{ id: "s", durationMs: 20000 }])],
          1,
          rules({ minRemainingMs: minimum }),
        ),
      /minimum remaining/,
    );
  assert.throws(
    () =>
      build(
        [group([{ id: "s", durationMs: 20000 }])],
        1,
        rules({ overflowPolicy: "invalid" as "truncate" }),
      ),
    /overflow policy/,
  );
});

for (const id of ["constructor", "__proto__", "toString"])
  for (const mode of ["ordered", "shuffle"] as const)
    test(`${mode} accepts group ID ${id} across serialized continuation`, () => {
      const input = {
        channelId: "ch",
        groups: [
          {
            id,
            mode,
            clips: [
              { id: "a", durationMs: 1000 },
              { id: "b", durationMs: 1000 },
            ],
          },
        ],
        commercials: [],
        rules: noBreaks,
      };
      const first = buildSchedule({ ...input, startMs: 0, untilMs: 2000 });
      const next = buildSchedule({
        ...input,
        startMs: 2000,
        untilMs: 4000,
        state: JSON.parse(JSON.stringify(first.state)),
      });
      const full = buildSchedule({ ...input, startMs: 0, untilMs: 4000 });
      assert.equal(new Set(first.entries.map((e) => e.mediaId)).size, 2);
      assert.deepEqual(
        sequence([...first.entries, ...next.entries]),
        sequence(full.entries),
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(full.state.cursors, id),
        mode === "ordered",
      );
    });

for (const mode of ["ordered", "shuffle", "random"] as const)
  test(`episodes per turn preserves ${mode} choices across serialized chunks`, () => {
    const groups: Group[] = [
      {
        id: "a",
        mode,
        episodesPerTurn: 3,
        clips: [1, 2, 3, 4].map((n) => ({ id: `a${n}`, durationMs: 1000 })),
      },
      {
        id: "b",
        mode,
        clips: [
          { id: "b1", durationMs: 1000 },
          { id: "b2", durationMs: 1000 },
        ],
      },
    ];
    const input = { channelId: "c", groups, commercials: [], rules: noBreaks };
    const full = buildSchedule({ ...input, startMs: 0, untilMs: 12000 });
    let state = initialState(),
      ids: string[] = [];
    for (let startMs = 0; startMs < 12000; startMs += 1000) {
      const chunk = buildSchedule({
        ...input,
        startMs,
        untilMs: startMs + 1000,
        state: JSON.parse(JSON.stringify(state)),
      });
      state = chunk.state;
      ids.push(...chunk.entries.map((e) => e.mediaId));
    }
    assert.deepEqual(
      ids,
      full.entries.map((e) => e.mediaId),
    );
    assert.deepEqual(
      ids.map((id) => id[0]),
      ["a", "a", "a", "b", "a", "a", "a", "b", "a", "a", "a", "b"],
    );
    const legacy = buildSchedule({
      ...input,
      groups: groups.map(({ episodesPerTurn, ...g }) => g),
      startMs: 0,
      untilMs: 12000,
    });
    const explicit = buildSchedule({
      ...input,
      groups: groups.map((g) => ({ ...g, episodesPerTurn: 1 })),
      startMs: 0,
      untilMs: 12000,
    });
    assert.deepEqual(sequence(legacy.entries), sequence(explicit.entries));
  });
