import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/database.js";
import { PlaybackService } from "../src/playback.js";
import { buildSchedule, noBreaks, persistSchedule } from "../src/scheduler.js";
import { account, profile, source, media, channel } from "./helpers.js";
function fixture(t: { after: (fn: () => unknown) => void }) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const owner = account(store),
    other = account(store),
    p = profile(store, owner),
    src = source(store),
    item = media(store, src.id),
    ch = channel(store, owner);
  store.db
    .prepare(
      "INSERT INTO source_grants(profile_id,source_id,subtree) VALUES(?,?,'')",
    )
    .run(p, src.id);
  const result = buildSchedule({
    channelId: ch.id,
    startMs: 0,
    untilMs: 10000,
    groups: [
      { id: "g", mode: "ordered", clips: [{ id: item.id, durationMs: 1000 }] },
    ],
    rules: noBreaks,
    commercials: [],
  });
  persistSchedule(store, ch.id, result.entries, result.state);
  return {
    store,
    owner,
    other,
    p,
    item,
    ch,
    service: new PlaybackService(store),
  };
}
test("pause affects one device session even when both share account and profile", (t) => {
  const f = fixture(t),
    first = f.service.join(f.owner, f.p, f.ch.id, 100),
    second = f.service.join(f.owner, f.p, f.ch.id, 100);
  f.service.pause(f.owner, first.id, 200);
  assert.equal(f.service.describe(f.owner, first.id, 700).positionMs, 200);
  assert.equal(f.service.describe(f.owner, second.id, 700).positionMs, 700);
  f.service.resume(f.owner, first.id, 700);
  assert.equal(f.service.describe(f.owner, first.id, 900).positionMs, 400);
  const live = f.service.goLive(f.owner, first.id, 900);
  assert.equal(live.positionMs, 900);
  assert.equal(live.behindLiveMs, 0);
});
test("leaving deletes pause state and reopening joins live", (t) => {
  const f = fixture(t),
    first = f.service.join(f.owner, f.p, f.ch.id, 100);
  f.service.pause(f.owner, first.id, 200);
  f.service.leave(f.owner, first.id);
  assert.throws(() => f.service.describe(f.owner, first.id, 700), /not found/);
  assert.equal(f.service.join(f.owner, f.p, f.ch.id, 700).positionMs, 700);
});
test("other accounts cannot inspect or mutate playback sessions", (t) => {
  const f = fixture(t),
    session = f.service.join(f.owner, f.p, f.ch.id, 100);
  assert.throws(() => f.service.pause(f.other, session.id, 200), /not found/);
  assert.equal(f.service.describe(f.owner, session.id, 200).paused, false);
});
test("source revocation denies existing session and replacement marks old program unavailable", (t) => {
  const f = fixture(t),
    session = f.service.join(f.owner, f.p, f.ch.id, 100);
  assert.equal(session.available, true);
  f.store.db.prepare("UPDATE media SET size=size+1 WHERE id=?").run(f.item.id);
  assert.equal(f.service.describe(f.owner, session.id, 200).available, false);
  f.store.db.prepare("DELETE FROM source_grants WHERE profile_id=?").run(f.p);
  assert.throws(
    () => f.service.describe(f.owner, session.id, 200),
    /not found/,
  );
});
