import { ProgrammingDraft } from "../web/src/programming-draft.js";
import { pairingApprovalPath } from "../src/pairing-link.js";
import { pairingPrefill, currentRoute } from "../web/src/pairing-link.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/database.js";
import { createServer } from "../src/server.js";
import { createAccount, login } from "../src/security.js";
import { ProgrammingService } from "../src/programming.js";
import { buildSchedule, noBreaks, initialState } from "../src/scheduler.js";
import { PlaybackService } from "../src/playback.js";
import { source, profile, media, channel, account } from "./helpers.js";
import { programmingOptions, saveCollection } from "../src/library.js";
import { backupApplication } from "../src/recovery.js";
import { OperationsService, effectiveAccess } from "../src/operations.js";
import { recordIntegrationReport } from "../src/integration-report.js";
import { importMetadata } from "../src/integrations.js";
import {
  generationPreflight,
  assetFingerprint,
  assetRelativePath,
} from "../src/generation.js";
import { loadIntegrationKey, RefreshService } from "../src/refresh.js";
import type { Programming } from "../src/contracts.js";
async function fixture(t: { after: (fn: () => unknown) => void }) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "mytuner-improvements-")),
  );
  for (const name of ["data", "media", "generated", "cache"])
    await mkdir(join(root, name));
  const store = new Store(join(root, "data", "mytuner.db")),
    admin = await createAccount(store, "admin", "synthetic-password", "admin"),
    p = profile(store, admin),
    src = source(store, join(root, "media"), "shows"),
    ch = channel(store, admin);
  const one = media(store, src.id, "Show/S01E01.mp4"),
    two = media(store, src.id, "Show/S01E02.mp4");
  const config: Programming = {
    profileId: p,
    groups: [
      {
        id: "show",
        mode: "ordered",
        selection: { type: "media", ids: [one.id, two.id] },
      },
    ],
    rules: noBreaks,
    seed: 42,
  };
  const programming = new ProgrammingService(store, 5000);
  const app = createServer(store, {
    generatedRoot: join(root, "generated"),
    cacheRoot: join(root, "cache"),
    writableRoots: [
      join(root, "data"),
      join(root, "generated"),
      join(root, "cache"),
    ],
  });
  const headers = {
    authorization: `Bearer ${(await login(store, "admin", "synthetic-password")).token}`,
  };
  t.after(async () => {
    await app.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    store,
    admin,
    p,
    src,
    ch,
    one,
    two,
    config,
    programming,
    app,
    headers,
  };
}

test("explicit ordered restart/start-at actions preview exactly and execute once without changing unrelated cursors", async (t) => {
  const f = await fixture(t),
    b = media(f.store, f.src.id, "B1.mp4"),
    b2 = media(f.store, f.src.id, "B2.mp4");
  f.config.groups.push({
    id: "b",
    mode: "ordered",
    selection: { type: "media", ids: [b.id, b2.id] },
  });
  f.programming.publish(f.admin, f.ch.id, f.config, 0, 4000);
  const changed = {
    ...f.config,
    checkpointActions: [
      { groupId: "show", action: "startAt" as const, mediaId: f.two.id },
    ],
  };
  const preview = f.programming.preview(f.admin, f.ch.id, changed, 1500, 4000),
    published = f.programming.publish(f.admin, f.ch.id, changed, 1500, 4000);
  assert.equal(preview.entries[0]!.mediaId, f.two.id);
  assert.equal(preview.entries[1]!.mediaId, b2.id);
  assert.equal(preview.effectiveMs, 2000);
  assert.deepEqual(
    preview.entries.map((e) => e.mediaId),
    published.entries.map((e) => e.mediaId),
  );
  assert.equal(
    JSON.parse(f.programming.active(f.ch.id)!.config_json!).checkpointActions,
    undefined,
  );
  const restart = {
    ...f.config,
    checkpointActions: [{ groupId: "show", action: "restart" as const }],
  };
  assert.equal(
    f.programming.preview(f.admin, f.ch.id, restart, 3500, 4000).entries[0]!
      .mediaId,
    f.one.id,
  );
  assert.throws(
    () =>
      f.programming.preview(
        f.admin,
        f.ch.id,
        { ...changed, groups: [{ ...changed.groups[0]!, mode: "shuffle" }] },
        3500,
      ),
    /ordered/,
  );
  assert.throws(
    () =>
      f.programming.preview(
        f.admin,
        f.ch.id,
        {
          ...changed,
          checkpointActions: [
            { groupId: "show", action: "startAt", mediaId: b.id },
          ],
        },
        3500,
      ),
    /unavailable/,
  );
});

test("commercial diagnostics explain cutoff minimum, whole-fit and repeat limits without consuming randomness", () => {
  const base = {
    channelId: "c",
    startMs: 0,
    untilMs: 1,
    groups: [
      {
        id: "g",
        mode: "ordered" as const,
        clips: [{ id: "program", durationMs: 1000 }],
      },
    ],
    commercials: [{ id: "ad", durationMs: 12000 }],
    rules: {
      ...noBreaks,
      between: true,
      maxClips: 3,
      maxDurationMs: 10000,
      overflowPolicy: "truncate" as const,
    },
  };
  const cutoff = buildSchedule(base);
  assert.equal(cutoff.diagnostics[0]!.shortenedClips, 1);
  assert.equal(
    cutoff.diagnostics[0]!.endMs - cutoff.diagnostics[0]!.startMs,
    10000,
  );
  assert.equal(cutoff.diagnostics[0]!.reason, "filled");
  assert.equal(
    buildSchedule({ ...base, rules: { ...base.rules, maxDurationMs: 6000 } })
      .diagnostics[0]!.reason,
    "minimum-remaining",
  );
  assert.equal(
    buildSchedule({ ...base, rules: { ...base.rules, overflowPolicy: "skip" } })
      .diagnostics[0]!.reason,
    "duration-fit",
  );
  assert.equal(
    buildSchedule({ ...base, commercials: [{ id: "ad", durationMs: 2000 }] })
      .diagnostics[0]!.reason,
    "variation-limits",
  );
  assert.deepEqual(
    cutoff.state,
    buildSchedule({ ...base, state: initialState() }).state,
  );
});

test("profile lineup is private, complete, stable across rename, and used by the guide", async (t) => {
  const f = await fixture(t),
    other = channel(f.store, f.admin),
    now = Date.now();
  f.programming.publish(f.admin, f.ch.id, f.config, now, 5000);
  f.programming.publish(f.admin, other.id, f.config, now, 5000);
  for (const ch of [f.ch, other])
    assert.equal(
      (
        await f.app.inject({
          method: "PUT",
          url: `/api/profiles/${f.p}/subscriptions/${ch.id}`,
          headers: f.headers,
        })
      ).statusCode,
      204,
    );
  const set = await f.app.inject({
    method: "PUT",
    url: `/api/profiles/${f.p}/lineup`,
    headers: f.headers,
    payload: { channelIds: [other.id, f.ch.id] },
  });
  assert.equal(set.statusCode, 200);
  f.store.db.prepare("UPDATE channels SET name='AAA' WHERE id=?").run(f.ch.id);
  const guide = await f.app.inject({
    url: `/api/profiles/${f.p}/guide`,
    headers: f.headers,
  });
  assert.deepEqual(
    guide.json().channels.map((c: { id: string }) => c.id),
    [other.id, f.ch.id],
  );
  assert.equal(
    (
      await f.app.inject({
        method: "PUT",
        url: `/api/profiles/${f.p}/lineup`,
        headers: f.headers,
        payload: { channelIds: [other.id] },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "PUT",
        url: `/api/profiles/${f.p}/lineup`,
        headers: f.headers,
        payload: { channelIds: [other.id, other.id] },
      })
    ).statusCode,
    400,
  );
});

test("copy programming returns a private unpublished independent draft without copying channels, sessions or history", async (t) => {
  const f = await fixture(t);
  f.programming.publish(f.admin, f.ch.id, f.config, Date.now(), 5000);
  const before = f.store.db
    .prepare("SELECT COUNT(*) AS n FROM channels")
    .get()?.n;
  const copy = await f.app.inject({
    url: `/api/channels/${f.ch.id}/draft-copy?profileId=${f.p}`,
    headers: f.headers,
  });
  assert.equal(copy.statusCode, 200);
  assert.equal(copy.json().visibility, "private");
  assert.deepEqual(copy.json().config, f.config);
  assert.equal(copy.json().revisionId, undefined);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM channels").get()?.n,
    before,
  );
});

test("admin status and setup report completed application backups, ignore partial snapshots and deny viewers", async (t) => {
  const f = await fixture(t),
    operations = new OperationsService(
      f.store,
      join(f.root, "data"),
      join(f.root, "generated"),
      join(f.root, "cache"),
    );
  const empty = (await operations.status(f.admin)) as {
    backups: { state: string };
  };
  assert.equal(empty.backups.state, "none");
  const snapshot = await backupApplication(f.store.db, join(f.root, "data"));
  await mkdir(join(f.root, "data", "backups", "snapshot-partial"));
  const fresh = new OperationsService(
    f.store,
    join(f.root, "data"),
    join(f.root, "generated"),
    join(f.root, "cache"),
  );
  const status = (await fresh.status(f.admin)) as {
    backups: { state: string; latestCompletedMs: number };
    sources: { readable: boolean }[];
  };
  assert.equal(status.backups.state, "completed");
  assert.ok(status.backups.latestCompletedMs > 0);
  assert.equal(status.sources[0]!.readable, true);
  assert.equal(snapshot.includes("snapshot-"), true);
  const viewer = await createAccount(
      f.store,
      "viewer",
      "synthetic-password",
      "viewer",
    ),
    headers = {
      authorization: `Bearer ${(await login(f.store, "viewer", "synthetic-password")).token}`,
    };
  for (const url of [
    "/api/admin/status",
    "/api/admin/setup",
    `/api/admin/profiles/${f.p}/access/${viewer.id}`,
  ])
    assert.equal((await f.app.inject({ url, headers })).statusCode, 403);
  const text = JSON.stringify(status);
  assert.equal(text.includes("integration.key"), false);
  assert.equal(text.includes(f.root), false);
  assert.equal(
    (await f.app.inject({ url: "/api/admin/setup", headers: f.headers })).json()
      .publishedChannels,
    0,
  );
});

test("effective access evaluates target role, memberships, source subtrees and PIN rather than inspecting admin rights", async (t) => {
  const f = await fixture(t),
    viewer = account(f.store, "viewer");
  let result = effectiveAccess(f.store, f.admin, viewer.id, f.p);
  assert.equal(result.canWatch, false);
  assert.equal(result.grants.length, 0);
  f.store.db
    .prepare("INSERT INTO profile_accounts VALUES(?,?,1)")
    .run(f.p, viewer.id);
  f.store.db
    .prepare("INSERT INTO source_grants VALUES(?,?,'Show')")
    .run(f.p, f.src.id);
  f.store.db
    .prepare("UPDATE profiles SET pin_hash='synthetic-protected' WHERE id=?")
    .run(f.p);
  result = effectiveAccess(f.store, f.admin, viewer.id, f.p);
  assert.equal(result.canWatch, true);
  assert.equal(result.canManage, false);
  assert.equal(result.adminException, false);
  assert.equal(result.pinRequired, true);
  assert.equal(result.grants[0]?.subtree, "Show");
  f.store.db
    .prepare("UPDATE accounts SET disabled=1 WHERE id=?")
    .run(viewer.id);
  assert.equal(
    effectiveAccess(f.store, f.admin, viewer.id, f.p).canWatch,
    false,
  );
});

test("integration reports distinguish absent and reassociated items, retain metadata and survive incomplete scans", async (t) => {
  const f = await fixture(t),
    mappings = [{ from: "/remote", to: join(f.root, "media") }],
    item = {
      provider: "sonarr" as const,
      externalId: "1",
      path: "/remote/Show/S01E01.mp4",
      title: "Imported",
      metadata: { seriesId: 1 },
    };
  importMetadata(f.store, f.src, [item], mappings);
  const absent = recordIntegrationReport(
    f.store,
    f.src,
    "sonarr",
    [],
    mappings,
    false,
  );
  assert.equal(absent.counts.absent, 1);
  assert.equal(absent.removalsApplied, false);
  assert.equal(absent.scanComplete, false);
  assert.equal(
    f.store.db.prepare("SELECT title FROM media WHERE id=?").get(f.one.id)
      ?.title,
    "Imported",
  );
  const changed = recordIntegrationReport(
    f.store,
    f.src,
    "sonarr",
    [{ ...item, path: "/remote/Show/S01E02.mp4" }],
    mappings,
    true,
  );
  assert.equal(changed.counts.reassociated, 1);
  assert.equal(changed.providerAcceptanceRequired, true);
  assert.equal(
    (
      await f.app.inject({
        url: `/api/admin/imports/${changed.id}?limit=1`,
        headers: f.headers,
      })
    ).json().items.length,
    1,
  );
});

test("mapping preflight is bounded and read-only with matched and outside-source cases", async (t) => {
  const f = await fixture(t),
    key = await loadIntegrationKey(join(f.root, "data"));
  new RefreshService(f.store, key).configure(f.src.id, {
    provider: "sonarr",
    url: "http://localhost:8989",
    apiKey: "synthetic",
    mappings: [{ from: "/remote", to: join(f.root, "media") }],
  });
  const result = await f.app.inject({
    method: "POST",
    url: `/api/admin/sources/${f.src.id}/mapping-check`,
    headers: f.headers,
    payload: { paths: ["/remote/Show/S01E01.mp4", "/outside/S01E01.mp4"] },
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(
    result.json().items.map((i: { state: string }) => i.state),
    ["matched", "outside-source"],
  );
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: `/api/admin/sources/${f.src.id}/mapping-check`,
        headers: f.headers,
        payload: { paths: Array(21).fill("/remote/test") },
      })
    ).statusCode,
    400,
  );
});

test("bounded programming picker preserves show/season references and hides inaccessible catalog and collection counts", async (t) => {
  const f = await fixture(t),
    user = account(f.store),
    p = profile(f.store, user),
    hidden = source(f.store, "/hidden", "shows");
  media(f.store, hidden.id, "Secret/S01E01.mp4");
  f.store.db
    .prepare("INSERT INTO source_grants VALUES(?,?,'')")
    .run(p, f.src.id);
  f.store.db.prepare("UPDATE media SET metadata_json=? WHERE source_id=?").run(
    JSON.stringify({
      seriesId: 4,
      seriesTitle: "Public show",
      seasonNumber: 1,
    }),
    f.src.id,
  );
  const page = programmingOptions(f.store, user, p, {
    search: "",
    offset: 0,
    limit: 1,
  });
  assert.equal(page.items.length, 1);
  assert.equal(JSON.stringify(page).includes("Secret"), false);
  assert.equal(page.sources.length, 1);
  const detail = programmingOptions(f.store, user, p, {
    search: "",
    offset: 0,
    limit: 100,
    sourceId: f.src.id,
    showKey: "series:4",
  });
  assert.deepEqual(
    detail.items.map((i) => i.kind),
    ["season", "show"],
  );
  assert.equal(detail.items[0]!.available, 2);
  const collection = saveCollection(
    f.store,
    f.admin,
    f.p,
    "Private reference",
    [f.one.id],
  );
  assert.equal(
    JSON.stringify(
      programmingOptions(f.store, user, p, {
        search: "Private",
        offset: 0,
        limit: 10,
      }),
    ).includes(collection.id),
    false,
  );
});

test("playback context follows the actual scheduled shortened commercial and retained paused clock", async (t) => {
  const f = await fixture(t),
    ads = source(f.store, "/ads", "commercials"),
    ad = media(f.store, ads.id, "ad.mp4", 12000);
  const config = {
    ...f.config,
    commercialSelection: { type: "media" as const, ids: [ad.id] },
    rules: {
      ...noBreaks,
      between: true,
      maxClips: 1,
      maxDurationMs: 10000,
      overflowPolicy: "truncate" as const,
    },
  };
  f.programming.publish(f.admin, f.ch.id, config, 0, 30000);
  const service = new PlaybackService(f.store, f.programming),
    session = service.join(f.admin, f.p, f.ch.id, 4000);
  assert.equal(session.context?.kind, "commercial");
  assert.equal(session.context?.program?.title, f.one.title);
  assert.equal(session.context?.entryDurationMs, 10000);
  assert.equal(session.context?.remainingMs, 7000);
  const paused = service.pause(f.admin, session.id, 5000),
    later = service.describe(f.admin, session.id, 9000);
  assert.equal(paused.context?.remainingMs, later.context?.remainingMs);
  assert.equal(later.behindLiveMs, 4000);
  assert.equal(later.context?.next?.title, f.two.title);
});

test("generation preflight distinguishes new work and missing reusable assets without starting generation", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.root, "media", "Show"));
  const request = {
    sourceId: f.src.id,
    directory: "Show",
    recursive: true,
    kinds: ["thumbnail" as const],
    regenerate: false,
  };
  const result = await generationPreflight(
    f.store,
    request,
    join(f.root, "generated"),
  );
  assert.equal(result.newOutputs, 2);
  assert.equal(result.reusableOutputs, 0);
  const path = assetRelativePath(f.one, "thumbnail"),
    output = join(f.root, "generated", path);
  await mkdir(
    join(f.root, "generated", f.one.id, assetFingerprint(f.one, "thumbnail")),
    { recursive: true },
  );
  await writeFile(output, "synthetic derivative");
  f.store.db
    .prepare("INSERT INTO generated_assets VALUES(?,?,?,?,?)")
    .run(
      "synthetic-asset",
      f.one.id,
      "thumbnail",
      assetFingerprint(f.one, "thumbnail"),
      path,
    );
  assert.equal(
    (await generationPreflight(f.store, request, join(f.root, "generated")))
      .reusableOutputs,
    1,
  );
  assert.equal(
    (
      await generationPreflight(
        f.store,
        { ...request, regenerate: true },
        join(f.root, "generated"),
      )
    ).reusableOutputs,
    0,
  );
  await rm(output);
  assert.equal(
    (await generationPreflight(f.store, request, join(f.root, "generated")))
      .reusableOutputs,
    0,
  );
  assert.equal(result.totalDurationMs, 2000);
  assert.equal(result.estimatedDurationMs, null);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM generation_jobs").get()?.n,
    0,
  );
});

test("collection detail retains unavailable references and editing preserves the same id", async (t) => {
  const f = await fixture(t),
    saved = saveCollection(f.store, f.admin, f.p, "Original", [
      f.one.id,
      f.two.id,
    ]);
  f.store.db.prepare("UPDATE media SET available=0 WHERE id=?").run(f.two.id);
  const detail = await f.app.inject({
    url: `/api/profiles/${f.p}/collections/${saved.id}`,
    headers: f.headers,
  });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().items.length, 2);
  assert.equal(
    detail.json().items.find((i: { id: string }) => i.id === f.two.id)
      .available,
    false,
  );
  const updated = await f.app.inject({
    method: "PUT",
    url: `/api/profiles/${f.p}/collections/${saved.id}`,
    headers: f.headers,
    payload: { name: "Renamed", mediaIds: [f.one.id, f.two.id] },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().id, saved.id);
  assert.equal(
    f.store.db
      .prepare(
        "SELECT COUNT(*) AS n FROM collection_items WHERE collection_id=?",
      )
      .get(saved.id)?.n,
    2,
  );
});

test("phone pairing prefill accepts only the public code and never approves through a GET", async (t) => {
  const f = await fixture(t);
  const started = await f.app.inject({
      method: "POST",
      url: "/api/auth/pairings",
      payload: { deviceName: "Synthetic TV" },
    }),
    data = started.json();
  assert.equal(data.approvalPath, pairingApprovalPath(data.userCode));
  assert.equal(data.approvalPath.includes(data.deviceCode), false);
  assert.equal(currentRoute("#connect-tv?code=ABCDEF1234"), "connect-tv");
  assert.equal(pairingPrefill("#connect-tv?code=ABCDEF1234"), "ABCDEF1234");
  assert.equal(pairingPrefill("#channels?code=ABCDEF1234"), "");
  assert.equal(pairingPrefill("#connect-tv?code=<script>"), "");
  assert.throws(() => pairingApprovalPath("malicious"), /Invalid/);
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/auth/pairings/poll",
        payload: { deviceCode: data.deviceCode },
      })
    ).json().status,
    "pending",
  );
});

test("draft state rejects late preview and publication results while retaining dirty edits", async (t) => {
  const f = await fixture(t),
    draft = new ProgrammingDraft(f.config),
    first = draft.capture();
  draft.previewed(first);
  assert.equal(draft.canPublish, true);
  draft.change({ ...f.config, seed: 99 });
  draft.published(first);
  draft.previewed(first);
  assert.equal(draft.dirty, true);
  assert.equal(draft.state, "unsaved-draft");
  assert.equal(draft.canPublish, false);
  const current = draft.capture();
  draft.previewed(current);
  assert.equal(draft.state, "preview-current");
  draft.published(current);
  assert.equal(draft.state, "published");
  assert.equal(draft.dirty, false);
});

test("start-at commands handle prototype-like group ids and do not persist as recurring resets", async (t) => {
  const f = await fixture(t);
  const config = {
    ...f.config,
    groups: [{ ...f.config.groups[0]!, id: "__proto__" }],
    checkpointActions: [
      { groupId: "__proto__", action: "startAt" as const, mediaId: f.two.id },
    ],
  };
  const result = f.programming.publish(f.admin, f.ch.id, config, 0, 1000);
  assert.equal(result.entries[0]!.mediaId, f.two.id);
  f.programming.ensure(f.ch.id, 2000);
  assert.equal(
    f.store.db
      .prepare("SELECT media_id FROM schedule_entries WHERE start_ms=1000")
      .get()?.media_id,
    f.one.id,
  );
});

test("browsing the authorized guide preserves an existing paused session and clock", async (t) => {
  const f = await fixture(t),
    now = Date.now();
  f.programming.publish(f.admin, f.ch.id, f.config, now, 5000);
  const service = new PlaybackService(f.store, f.programming),
    session = service.join(f.admin, f.p, f.ch.id, now + 100);
  service.pause(f.admin, session.id, now + 200);
  f.store.db
    .prepare("INSERT INTO subscriptions(profile_id,channel_id) VALUES(?,?)")
    .run(f.p, f.ch.id);
  for (let i = 0; i < 10; i++)
    assert.equal(
      (
        await f.app.inject({
          url: `/api/profiles/${f.p}/guide`,
          headers: f.headers,
        })
      ).statusCode,
      200,
    );
  const retained = service.describe(f.admin, session.id, now + 3000);
  assert.equal(retained.id, session.id);
  assert.equal(retained.paused, true);
  assert.equal(retained.positionMs, now + 200);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM playback_sessions").get()?.n,
    1,
  );
});

test("lineup migration preserves existing alphabetical order as stable positions", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-lineup-migration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { DatabaseSync } = await import("node:sqlite"),
    { migrations } = await import("../src/database.js");
  const path = join(root, "mytuner.db"),
    prior = new DatabaseSync(path);
  for (const migration of migrations.slice(0, 10)) prior.exec(migration);
  prior.exec(
    `PRAGMA user_version=10; INSERT INTO accounts(id,username,password_hash,role,created_at) VALUES('owner','owner','synthetic','editor',0); INSERT INTO profiles(id,name,kind,owner_account_id) VALUES('profile','Profile','person','owner'); INSERT INTO channels(id,name,owner_account_id,visibility) VALUES('a','Zulu','owner','private'),('b','Alpha','owner','private'); INSERT INTO subscriptions(profile_id,channel_id) VALUES('profile','a'),('profile','b');`,
  );
  prior.close();
  const upgraded = new Store(path);
  t.after(() => upgraded.close());
  assert.deepEqual(
    upgraded.db
      .prepare(
        "SELECT channel_id,position FROM subscriptions ORDER BY position",
      )
      .all()
      .map((row) => [row.channel_id, row.position]),
    [
      ["b", 1],
      ["a", 2],
    ],
  );
  upgraded.db.prepare("UPDATE channels SET name='Aardvark' WHERE id='a'").run();
  assert.equal(
    upgraded.db
      .prepare(
        "SELECT c.id FROM channels c JOIN subscriptions s ON s.channel_id=c.id ORDER BY s.position,c.name,c.id LIMIT 1",
      )
      .get()?.id,
    "b",
  );
});

test("pending replacement and one-time start commands survive another preview/publication before activation", async (t) => {
  const f = await fixture(t);
  const episodes = Array.from({ length: 5 }, (_, i) =>
    media(f.store, f.src.id, `New/E0${i + 1}.mp4`),
  );
  f.programming.publish(f.admin, f.ch.id, f.config, 0, 8000);
  const next: Programming = {
    ...f.config,
    groups: [
      {
        ...f.config.groups[0]!,
        selection: { type: "media", ids: episodes.map((e) => e.id) },
        episodesPerTurn: 2,
      },
    ],
  };
  const first = f.programming.publish(f.admin, f.ch.id, next, 100, 8000);
  const preview = f.programming.preview(f.admin, f.ch.id, next, 200, 8000);
  const second = f.programming.publish(f.admin, f.ch.id, next, 200, 8000);
  assert.equal(second.effectiveMs, first.effectiveMs);
  assert.equal(second.entries[0]!.mediaId, episodes[0]!.id);
  assert.deepEqual(
    preview.entries.map((e) => e.mediaId),
    second.entries.map((e) => e.mediaId),
  );
  const command: Programming = {
    ...next,
    checkpointActions: [
      { groupId: "show", action: "startAt", mediaId: episodes[4]!.id },
    ],
  };
  const commanded = f.programming.publish(f.admin, f.ch.id, command, 300, 8000);
  assert.equal(commanded.entries[0]!.mediaId, episodes[4]!.id);
  const ordinary = f.programming.publish(f.admin, f.ch.id, next, 400, 8000);
  assert.equal(ordinary.entries[0]!.mediaId, episodes[4]!.id);
  assert.equal(
    JSON.parse(f.programming.active(f.ch.id)!.config_json!).checkpointActions,
    undefined,
  );
  const restarted = f.programming.publish(
    f.admin,
    f.ch.id,
    { ...next, checkpointActions: [{ groupId: "show", action: "restart" }] },
    500,
    8000,
  );
  assert.equal(restarted.entries[0]!.mediaId, episodes[0]!.id);
  assert.equal(
    f.programming.publish(f.admin, f.ch.id, next, 600, 8000).entries[0]!
      .mediaId,
    episodes[0]!.id,
  );
  const after = f.programming.publish(f.admin, f.ch.id, next, 1100, 8000);
  assert.equal(after.entries[0]!.mediaId, episodes[1]!.id);
});

test("legacy pending revision without an initial checkpoint preserves its first intended program", async (t) => {
  const f = await fixture(t),
    nextItem = media(f.store, f.src.id, "New.mp4");
  f.programming.publish(f.admin, f.ch.id, f.config, 0, 4000);
  const next: Programming = {
    ...f.config,
    groups: [
      {
        ...f.config.groups[0]!,
        selection: { type: "media", ids: [nextItem.id] },
      },
    ],
  };
  const pending = f.programming.publish(f.admin, f.ch.id, next, 100, 4000);
  f.store.db
    .prepare(
      "UPDATE schedule_revisions SET boundary_state_json=NULL WHERE id=?",
    )
    .run(pending.revisionId);
  const republished = f.programming.publish(f.admin, f.ch.id, next, 200, 4000);
  assert.equal(republished.effectiveMs, 2000);
  assert.equal(
    f.store.db
      .prepare(
        "SELECT media_id FROM schedule_entries WHERE revision_id=? AND start_ms=1000",
      )
      .get(republished.revisionId)?.media_id,
    nextItem.id,
  );
});

test("live next context follows pending publication while paused and behind-live context retain their timeline", async (t) => {
  const f = await fixture(t),
    player = new PlaybackService(f.store, f.programming);
  f.programming.publish(f.admin, f.ch.id, f.config, 0, 6000);
  const live = player.join(f.admin, f.p, f.ch.id, 100),
    paused = player.join(f.admin, f.p, f.ch.id, 100);
  player.pause(f.admin, paused.id, 200);
  const replacement = media(f.store, f.src.id, "Replacement.mp4");
  f.programming.publish(
    f.admin,
    f.ch.id,
    {
      ...f.config,
      groups: [
        {
          ...f.config.groups[0]!,
          selection: { type: "media", ids: [replacement.id] },
        },
      ],
    },
    500,
    6000,
  );
  assert.equal(
    player.describe(f.admin, live.id, 900).context?.next?.title,
    replacement.title,
  );
  assert.equal(
    player.describe(f.admin, paused.id, 900).context?.next?.title,
    f.two.title,
  );
  player.resume(f.admin, paused.id, 900);
  assert.equal(
    player.describe(f.admin, paused.id, 950).context?.next?.title,
    f.two.title,
  );
  assert.equal(
    player.describe(f.admin, live.id, 1000).context?.program?.title,
    replacement.title,
  );
});

test("pending next-context agrees with activation across midroll and between-program breaks", async (t) => {
  const f = await fixture(t),
    adSource = source(f.store, join(f.root, "ads"), "commercials"),
    ad = media(f.store, adSource.id, "ad.mp4", 200),
    replacement = media(f.store, f.src.id, "Replacement.mp4");
  const config: Programming = {
    ...f.config,
    commercialSelection: { type: "media", ids: [ad.id] },
    rules: {
      ...noBreaks,
      between: true,
      positions: [{ kind: "timestamp", value: 500 }],
      maxClips: 1,
      maxDurationMs: 200,
      repeatAllowance: 100,
    },
  };
  f.programming.publish(f.admin, f.ch.id, config, 0, 10000);
  const player = new PlaybackService(f.store, f.programming),
    live = player.join(f.admin, f.p, f.ch.id, 100),
    paused = player.join(f.admin, f.p, f.ch.id, 100);
  player.pause(f.admin, paused.id, 600);
  const draft: Programming = {
    ...config,
    groups: [
      {
        ...config.groups[0]!,
        selection: { type: "media", ids: [replacement.id] },
      },
    ],
  };
  const first = f.programming.publish(f.admin, f.ch.id, draft, 600, 10000);
  assert.equal(first.effectiveMs, 1400);
  for (const time of [650, 800, 1250, 1399]) {
    assert.equal(
      player.describe(f.admin, live.id, time).context?.next?.title,
      replacement.title,
    );
    assert.equal(
      player.describe(f.admin, paused.id, time).context?.next?.title,
      f.two.title,
    );
  }
  assert.equal(
    player.describe(f.admin, live.id, first.effectiveMs).context?.program
      ?.title,
    replacement.title,
  );
  assert.equal(
    player.describe(f.admin, paused.id, first.effectiveMs).context?.next?.title,
    f.two.title,
  );
});
