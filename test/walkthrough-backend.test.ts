import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as turn } from "node:timers/promises";
import { Store } from "../src/database.js";
import { createServer } from "../src/server.js";
import { digest } from "../src/security.js";
import { account, profile, source, media, channel } from "./helpers.js";
import {
  sourceDetails,
  sourceConfiguration,
} from "../src/source-configuration.js";
import { editSource } from "../src/source-management.js";
import { collectionSummaries, saveCollection } from "../src/library.js";
import {
  inspectMetadata,
  inspectAuthorizedMetadata,
  saveMetadata,
} from "../src/display-metadata.js";
import { collectionDependencies } from "../src/collection-dependencies.js";
import { subtitleRevision } from "../src/subtitle-catalog.js";
import { BackgroundWork } from "../src/background-work.js";
import { RefreshService } from "../src/refresh.js";
import { GenerationRunner } from "../src/generation.js";
import { EncoderAdmission } from "../src/encoder-admission.js";

async function fixture(t: import("node:test").TestContext) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "mytuner-walkthrough-backend-")),
  );
  const store = new Store(":memory:");
  await mkdir(join(root, "media"));
  await mkdir(join(root, "other"));
  await writeFile(join(root, "media", "video.mp4"), "synthetic original bytes");
  const admin = account(store, "admin"),
    owner = account(store),
    other = account(store);
  const profileId = profile(store, owner),
    otherProfileId = profile(store, other);
  const src = source(store, join(root, "media")),
    item = media(store, src.id);
  store.db
    .prepare("INSERT INTO source_grants VALUES(?,?,'')")
    .run(profileId, src.id);
  const app = createServer(store, {
    writableRoots: [join(root, "data")],
    generatedRoot: join(root, "generated"),
    cacheRoot: join(root, "cache"),
    autoMaintenance: false,
    integrationKey: Buffer.alloc(32, 7),
  });
  const headers = (actor: typeof owner) => {
    const token = randomUUID();
    store.db
      .prepare(
        "INSERT INTO sessions(token_hash,account_id,expires_at,kind) VALUES(?,?,?,'bearer')",
      )
      .run(digest(token), actor.id, Date.now() + 60000);
    return { authorization: `Bearer ${token}` };
  };
  const ah = headers(admin),
    oh = headers(owner),
    xh = headers(other);
  t.after(async () => {
    await app.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    store,
    app,
    admin,
    owner,
    other,
    profileId,
    otherProfileId,
    src,
    item,
    ah,
    oh,
    xh,
  };
}

test("source HTTP edits reject stale roots and unconfirmed resets without losing newer configuration or grants", async (t) => {
  const f = await fixture(t),
    url = `/api/sources/${f.src.id}`;
  const initial = (await f.app.inject({ url, headers: f.ah })).json();
  assert.equal(
    initial.revision,
    sourceConfiguration(f.store, f.src.id).revision,
  );
  assert.equal(initial.rootPath, f.src.root_path);
  const patch = (payload: object) =>
    f.app.inject({ method: "PATCH", url, headers: f.ah, payload });
  assert.equal((await patch({ name: "Missing revision" })).statusCode, 400);
  assert.equal(
    (await patch({ revision: initial.revision, root: join(f.root, "other") }))
      .statusCode,
    400,
  );
  const reset = await patch({
    revision: initial.revision,
    root: join(f.root, "other"),
    resetConfirmed: true,
  });
  assert.equal(reset.statusCode, 200, reset.body);
  f.store.db
    .prepare("UPDATE sources SET subtitle_config=?,metadata_root=? WHERE id=?")
    .run('{"enabled":false}', join(f.root, "other"), f.src.id);
  f.store.db
    .prepare("INSERT INTO source_grants VALUES(?,?,'')")
    .run(f.profileId, f.src.id);
  const stale = await patch({
    revision: initial.revision,
    name: "A stale rename",
    root: f.src.root_path,
    kind: "videos",
    recursive: true,
    resetConfirmed: true,
  });
  assert.equal(stale.statusCode, 409, stale.body);
  const saved = sourceDetails(f.store, f.src.id);
  assert.equal(saved.root_path, join(f.root, "other"));
  assert.equal(saved.metadata_root, join(f.root, "other"));
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM source_grants").get()!.n,
    1,
  );
  assert.equal(
    await readFile(join(f.src.root_path, "video.mp4"), "utf8"),
    "synthetic original bytes",
  );
  assert.equal((await f.app.inject({ url, headers: f.oh })).statusCode, 403);
});

test("source final transaction rejects configuration changes made while filesystem validation yields", async (t) => {
  const f = await fixture(t),
    before = sourceDetails(f.store, f.src.id);
  let checks = 0;
  await assert.rejects(
    editSource(
      f.store,
      f.src.id,
      { revision: before.revision, name: "Stale" },
      [join(f.root, "data")],
      () => {
        if (++checks === 2)
          f.store.db
            .prepare(
              "INSERT INTO refresh_sources(source_id,interval_ms,next_run_ms) VALUES(?,60000,123)",
            )
            .run(f.src.id);
      },
      () => false,
    ),
    /changed elsewhere/,
  );
  assert.equal(sourceDetails(f.store, f.src.id).name, before.name);
  assert.equal(
    f.store.db
      .prepare("SELECT next_run_ms FROM refresh_sources WHERE source_id=?")
      .get(f.src.id)!.next_run_ms,
    123,
  );
});

test("collection HTTP creation retries preserve one identity and reject edits, deletion and lost authority", async (t) => {
  const f = await fixture(t),
    creationId = randomUUID(),
    url = `/api/profiles/${f.profileId}/collections`;
  const payload = { creationId, name: "Favorites", mediaIds: [f.item.id] };
  const post = (body: object = payload, headers = f.oh, path = url) =>
    f.app.inject({ method: "POST", url: path, headers, payload: body });
  const first = await post();
  assert.equal(first.statusCode, 201, first.body);
  assert.equal(first.json().id, creationId);
  const revision = f.store.db
    .prepare("SELECT revision FROM catalog_revision")
    .get()!.revision;
  const retry = await post({ ...payload, mediaIds: [f.item.id, f.item.id] });
  assert.equal(retry.statusCode, 201, retry.body);
  assert.deepEqual(retry.json(), first.json());
  assert.equal(
    f.store.db.prepare("SELECT revision FROM catalog_revision").get()!.revision,
    revision,
  );
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM collections").get()!.n,
    1,
  );
  assert.equal((await post({ ...payload, name: "Changed" })).statusCode, 409);
  assert.equal(
    (await post(payload, f.xh, `/api/profiles/${f.otherProfileId}/collections`))
      .statusCode,
    404,
  );
  f.store.db
    .prepare("DELETE FROM source_grants WHERE profile_id=?")
    .run(f.profileId);
  assert.equal((await post()).statusCode, 404);
  f.store.db
    .prepare("INSERT INTO source_grants VALUES(?,?,'')")
    .run(f.profileId, f.src.id);
  f.store.db
    .prepare("UPDATE collections SET deleted_ms=1,expires_ms=? WHERE id=?")
    .run(Date.now() + 60000, creationId);
  assert.equal((await post()).statusCode, 409);
  assert.equal(
    f.store.db
      .prepare("SELECT deleted_ms FROM collections WHERE id=?")
      .get(creationId)!.deleted_ms,
    1,
  );
  assert.equal(
    (await post({ name: "No request identity", mediaIds: [f.item.id] }))
      .statusCode,
    400,
  );
});

test("subscription HTTP serialization preserves explicit and derived channel short names", async (t) => {
  const f = await fixture(t),
    custom = channel(f.store, f.owner, "shared"),
    derived = channel(f.store, f.owner, "shared");
  f.store.db
    .prepare(
      "UPDATE channels SET name='Family Night TV',short_name='FN' WHERE id=?",
    )
    .run(custom.id);
  f.store.db
    .prepare("UPDATE channels SET name='Another Family Network' WHERE id=?")
    .run(derived.id);
  f.store.db
    .prepare(
      "INSERT INTO subscriptions(profile_id,channel_id,position) VALUES(?,?,1)",
    )
    .run(f.profileId, custom.id);
  const response = await f.app.inject({
    url: `/api/profiles/${f.profileId}/subscription-configuration`,
    headers: f.oh,
  });
  assert.equal(response.statusCode, 200, response.body);
  const result = response.json(),
    explicit = result.items.find((i: { id: string }) => i.id === custom.id),
    automatic = result.items.find((i: { id: string }) => i.id === derived.id);
  assert.equal(explicit.shortName, "FN");
  assert.equal(explicit.shortNameOverride, "FN");
  assert.equal(result.order[0].shortName, "FN");
  assert.equal(automatic.shortName, "AFN");
  assert.equal(automatic.shortNameOverride, null);
});

test("collection counts retain unavailable references and edit usage excludes other owners' channels", async (t) => {
  const f = await fixture(t),
    missing = media(f.store, f.src.id, "missing.mp4");
  f.store.db.prepare("UPDATE media SET available=0 WHERE id=?").run(missing.id);
  const saved = saveCollection(
    f.store,
    f.owner,
    f.profileId,
    "Exact favorites",
    [f.item.id, missing.id],
  );
  const summary = collectionSummaries(f.store, f.owner, f.profileId)[0]!;
  assert.equal(summary.count, 1);
  assert.equal(summary.totalCount, 2);
  assert.equal(summary.unavailableCount, 1);
  const response = await f.app.inject({
    url: `/api/profiles/${f.profileId}/collections`,
    headers: f.oh,
  });
  assert.equal(response.json().items[0].totalCount, 2);
  assert.equal(response.json().items[0].unavailableCount, 1);
  for (const actor of [f.owner, f.other]) {
    const c = channel(f.store, actor),
      revision = randomUUID();
    f.store.db
      .prepare(
        "INSERT INTO schedule_revisions(id,channel_id,created_at,config_json) VALUES(?,?,0,?)",
      )
      .run(
        revision,
        c.id,
        JSON.stringify({
          groups: [{ selection: { type: "collection", id: saved.id } }],
        }),
      );
    f.store.db
      .prepare(
        "INSERT INTO active_schedules(channel_id,revision_id) VALUES(?,?)",
      )
      .run(c.id, revision);
  }
  const impact = collectionDependencies(
    f.store,
    f.owner,
    f.profileId,
    saved.id,
  );
  assert.equal(impact.total, 1);
  assert.equal(impact.items[0]!.recurring, true);
  assert.match(impact.editExplanation, /future generated programming/);
  assert.match(impact.editExplanation, /paused/);
});

test("replacement metadata exposes retained choices only through authorized inspection and reapplies explicitly", async (t) => {
  const f = await fixture(t),
    target = { kind: "media" as const, mediaId: f.item.id };
  const choices = {
    title: { source: "manual" as const, manual: "Keeper title" },
    description: { source: "local" as const },
  };
  await saveMetadata(
    f.store,
    f.admin,
    f.profileId,
    target,
    inspectMetadata(f.store, target).revision,
    choices,
  );
  f.store.db
    .prepare("UPDATE media SET size=size+100 WHERE id=?")
    .run(f.item.id);
  const current = inspectMetadata(f.store, target);
  assert.equal(current.requiresReview, true);
  assert.equal("retained" in current, false);
  const url = `/api/profiles/${f.profileId}/metadata/inspect`;
  const inspected = await f.app.inject({
    method: "POST",
    url,
    headers: f.ah,
    payload: { target },
  });
  assert.equal(inspected.statusCode, 200, inspected.body);
  assert.deepEqual(inspected.json().retained.choices, choices);
  assert.equal(inspected.json().choices.title.source, "automatic");
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url,
        headers: f.oh,
        payload: { target },
      })
    ).statusCode,
    403,
  );
  const restored = await saveMetadata(
    f.store,
    f.admin,
    f.profileId,
    target,
    current.revision,
    { ...current.choices, title: inspected.json().retained.choices.title },
  );
  assert.equal(restored.effective.title.value, "Keeper title");
  assert.equal(
    inspectAuthorizedMetadata(f.store, f.admin, f.profileId, target).retained,
    null,
  );
  await assert.rejects(
    saveMetadata(
      f.store,
      f.admin,
      f.profileId,
      target,
      current.revision,
      choices,
    ),
    /changed elsewhere/,
  );
});

test("source inspection batch describes retained freshness without exposing ungranted source identities or filesystem paths", async (t) => {
  const f = await fixture(t),
    hidden = source(f.store, join(f.root, "hidden"));
  const url = `/api/profiles/${f.profileId}/source-inspections?ids=${f.src.id},${hidden.id}`;
  const get = () => f.app.inject({ url, headers: f.oh });
  assert.deepEqual((await get()).json().items, [
    {
      sourceId: f.src.id,
      lastAttemptMs: null,
      lastCompletedMs: null,
      lastSuccessMs: null,
      status: "never",
    },
  ]);
  f.store.db
    .prepare(
      "INSERT INTO refresh_attempts VALUES(?,20,30,10,'Source scan incomplete; previous availability retained')",
    )
    .run(f.src.id);
  const incomplete = await get();
  assert.equal(incomplete.json().items[0].status, "incomplete");
  assert.equal(incomplete.json().items[0].lastSuccessMs, 10);
  assert.doesNotMatch(
    incomplete.body,
    /rootPath|lastError|hidden|Source scan incomplete/,
  );
  f.store.db
    .prepare(
      "UPDATE refresh_attempts SET last_attempt_ms=40,last_completed_ms=NULL,last_error=NULL WHERE source_id=?",
    )
    .run(f.src.id);
  assert.equal((await get()).json().items[0].status, "checking");
  f.store.db
    .prepare(
      "UPDATE refresh_attempts SET last_completed_ms=50,last_success_ms=50 WHERE source_id=?",
    )
    .run(f.src.id);
  assert.equal((await get()).json().items[0].status, "current");
  assert.equal(
    (
      await f.app.inject({
        url: `/api/profiles/${f.otherProfileId}/source-inspections?ids=${f.src.id}`,
        headers: f.oh,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await f.app.inject({
        url: `/api/profiles/${f.profileId}/source-inspections?ids=${Array(101).fill(f.src.id).join(",")}`,
        headers: f.oh,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.app.inject({
        url: `/api/profiles/${f.profileId}/source-inspections?ids=invalid`,
        headers: f.oh,
      })
    ).statusCode,
    400,
  );
});

test("manual subtitle HTTP preview gives useful missing-file errors while retaining traversal and authorization guards", async (t) => {
  const f = await fixture(t),
    url = `/api/profiles/${f.profileId}/media/${f.item.id}/subtitles/preview`;
  const revision = subtitleRevision(f.store, f.item);
  const preview = (relativePath: string, headers = f.ah) =>
    f.app.inject({
      method: "POST",
      url,
      headers,
      payload: { revision, manual: { rootKind: "media", relativePath } },
    });
  const missing = await preview("Subs/DoesNotExist.srt");
  assert.equal(missing.statusCode, 404, missing.body);
  assert.match(missing.body, /Subtitle file not found/);
  assert.equal((await preview("../outside.srt")).statusCode, 400);
  await writeFile(
    join(f.root, "outside.srt"),
    "1\n00:00:00,000 --> 00:00:01,000\nSynthetic caption\n",
  );
  await symlink(
    join(f.root, "outside.srt"),
    join(f.src.root_path, "escape.srt"),
  );
  assert.equal((await preview("escape.srt")).statusCode, 403);
  assert.equal((await preview("Subs/DoesNotExist.srt", f.oh)).statusCode, 403);
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

test("background admission distinguishes queued playback pauses from active work and checkpoint pauses", async () => {
  const background = new BackgroundWork(),
    controller = new AbortController(),
    begin = deferred(),
    checkpoint = deferred(),
    finish = deferred();
  background.setPaused(true);
  const first = background.run(
    "scan",
    controller.signal,
    async (check) => {
      begin.resolve();
      await checkpoint.promise;
      await check();
      await finish.promise;
    },
    "scan:first",
  );
  const second = background.run(
    "scan",
    controller.signal,
    async () => {},
    "scan:second",
  );
  assert.deepEqual(background.status("scan:first"), {
    admission: "waiting",
    waitingReason: "playback",
  });
  assert.deepEqual(background.status("scan:second"), {
    admission: "waiting",
    waitingReason: "playback",
  });
  background.setPaused(false);
  await begin.promise;
  assert.deepEqual(background.status("scan:first"), {
    admission: "active",
    waitingReason: null,
  });
  assert.deepEqual(background.status("scan:second"), {
    admission: "waiting",
    waitingReason: "queue",
  });
  background.setPaused(true);
  assert.equal(background.status("scan:first").admission, "active");
  checkpoint.resolve();
  await turn();
  assert.deepEqual(background.status("scan:first"), {
    admission: "waiting",
    waitingReason: "playback",
  });
  background.setPaused(false);
  finish.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(background.status("scan:first"), {
    admission: null,
    waitingReason: null,
  });
  background.stop();
});

test("generation and scan report their own waiting tasks rather than another workload's global admission", async (t) => {
  const f = await fixture(t),
    background = new BackgroundWork();
  background.setPaused(true);
  const runner = new GenerationRunner(
    f.store,
    join(f.root, "standalone-generated"),
    async (args) => {
      await writeFile(args.at(-1)!, "generated output");
    },
    { maxBytes: 50 * 1024 ** 3, reserveBytes: 0, maxPendingJobs: 25 },
    new EncoderAdmission(),
    background,
  );
  const refresh = new RefreshService(f.store, undefined, fetch, background);
  const job = await runner.enqueue({
    sourceId: f.src.id,
    directory: "",
    recursive: true,
    kinds: ["thumbnail"],
    regenerate: false,
  });
  const draining = runner.drain(),
    scanning = refresh.scan(f.src.id);
  assert.equal(runner.summary(job.id).admission, "waiting");
  assert.equal(runner.summary(job.id).waitingReason, "playback");
  assert.equal(runner.list()[0]!.waitingReason, "playback");
  assert.deepEqual(refresh.admission(f.src.id), {
    admission: "waiting",
    waitingReason: "playback",
  });
  assert.deepEqual(refresh.admission(randomUUID()), {
    admission: null,
    waitingReason: null,
  });
  assert.equal(background.snapshot().admitted, 0);
  background.setPaused(false);
  await Promise.all([draining, scanning]);
  assert.equal(runner.summary(job.id).admission, null);
  assert.deepEqual(refresh.admission(f.src.id), {
    admission: null,
    waitingReason: null,
  });
  await runner.stop();
  await refresh.stop();
  background.stop();
});

import { ProgrammingService } from "../src/programming.js";
import { noBreaks } from "../src/scheduler.js";
import Fastify from "fastify";
import { registerFoundationRoutes } from "../src/foundation-routes.js";

test("both HTTP channel previews distinguish identical titles with authorized source/path context and retain role guards", async (t) => {
  const f = await fixture(t),
    otherSource = source(f.store, join(f.root, "other")),
    duplicate = media(f.store, otherSource.id, "Travel/Highlight.mp4");
  f.store.db
    .prepare("UPDATE media SET title='Highlight' WHERE id IN (?,?)")
    .run(f.item.id, duplicate.id);
  f.store.db
    .prepare("INSERT INTO source_grants VALUES(?,?,'')")
    .run(f.profileId, otherSource.id);
  f.store.db
    .prepare(
      "UPDATE profiles SET pin_hash='protected-viewing-fixture' WHERE id=?",
    )
    .run(f.profileId);
  const ch = channel(f.store, f.owner);
  const config = {
    profileId: f.profileId,
    groups: [
      {
        id: "exact",
        mode: "ordered",
        selection: { type: "media", ids: [f.item.id, duplicate.id] },
      },
    ],
    rules: noBreaks,
    seed: 42,
  };
  const draft = {
    draftId: randomUUID(),
    details: {
      name: "Exact source review",
      description: "",
      shortName: null,
      visibility: "private",
    },
    config,
  };
  const requests = [
    {
      url: `/api/channels/${ch.id}/programming/preview?horizonMs=3000`,
      payload: config,
    },
    { url: "/api/channels/drafts/preview", payload: draft },
  ];
  for (const request of requests) {
    const result = await f.app.inject({
      method: "POST",
      headers: f.oh,
      ...request,
    });
    assert.equal(result.statusCode, 200, result.body);
    const entries = result.json().entries as {
      mediaId: string;
      title: string;
      sourceId: string;
      relativePath: string;
    }[];
    assert.deepEqual(
      new Set(entries.map((entry) => entry.title)),
      new Set(["Highlight"]),
    );
    const byId = new Map(entries.map((entry) => [entry.mediaId, entry]));
    assert.equal(byId.get(f.item.id)!.sourceId, f.src.id);
    assert.equal(byId.get(f.item.id)!.relativePath, f.item.relative_path);
    assert.equal(byId.get(duplicate.id)!.sourceId, otherSource.id);
    assert.equal(byId.get(duplicate.id)!.relativePath, "Travel/Highlight.mp4");
    assert.equal(result.body.includes(f.root), false);
    assert.equal(
      (await f.app.inject({ method: "POST", headers: f.xh, ...request }))
        .statusCode,
      404,
    );
  }
  f.store.db
    .prepare("UPDATE accounts SET role='viewer' WHERE id=?")
    .run(f.owner.id);
  for (const request of requests)
    assert.equal(
      (await f.app.inject({ method: "POST", headers: f.oh, ...request }))
        .statusCode,
      403,
    );
  f.store.db
    .prepare("UPDATE accounts SET role='editor' WHERE id=?")
    .run(f.owner.id);
  f.store.db
    .prepare("DELETE FROM source_grants WHERE profile_id=? AND source_id=?")
    .run(f.profileId, otherSource.id);
  for (const request of requests) {
    const result = await f.app.inject({
      method: "POST",
      headers: f.oh,
      ...request,
    });
    assert.equal(result.statusCode, 404, result.body);
    assert.doesNotMatch(result.body, /Travel\/Highlight/);
  }
});

test("preview serialization omits identity context for a scheduling result outside current grants", async (t) => {
  const f = await fixture(t),
    hiddenSource = source(f.store, join(f.root, "hidden")),
    hidden = media(f.store, hiddenSource.id, "Private/Secret-name.mp4");
  const programming = new ProgrammingService(f.store, 3000),
    ch = channel(f.store, f.owner);
  const config = {
    profileId: f.profileId,
    groups: [
      {
        id: "exact",
        mode: "ordered" as const,
        selection: { type: "media" as const, ids: [f.item.id] },
      },
    ],
    rules: noBreaks,
    seed: 42,
  };
  const original = programming.previewNew(f.owner, ch.id, config, 1000, 3000);
  // Exercise defensive DTO redaction with an ungranted retained/leading interval.
  const result = {
    ...original,
    entries: [
      { ...original.entries[0]!, mediaId: hidden.id },
      ...original.entries,
    ],
  };
  programming.previewNew = () => result;
  programming.preview = () => ({ ...result, effectiveMs: 1000 });
  const app = Fastify();
  registerFoundationRoutes(app, f.store, () => f.owner, programming);
  t.after(() => app.close());
  const draft = {
    draftId: randomUUID(),
    details: {
      name: "Safe preview",
      shortName: null,
      description: "",
      visibility: "private",
    },
    config,
  };
  for (const request of [
    {
      url: `/api/channels/${ch.id}/programming/preview?horizonMs=3000`,
      payload: config,
    },
    { url: "/api/channels/drafts/preview", payload: draft },
  ]) {
    const response = await app.inject({ method: "POST", ...request });
    assert.equal(response.statusCode, 200, response.body);
    const entry = response.json().entries[0];
    assert.equal(entry.title, "Unavailable video");
    assert.equal("sourceId" in entry, false);
    assert.equal("relativePath" in entry, false);
    assert.equal(response.body.includes(hiddenSource.id), false);
    assert.equal(response.body.includes(hidden.relative_path), false);
  }
});

test("readiness sourceIds describe only the returned authorized report page without new role access", async (t) => {
  const f = await fixture(t),
    otherSource = source(f.store, join(f.root, "other")),
    second = media(f.store, otherSource.id, "two.mp4"),
    third = media(f.store, f.src.id, "three.mp4");
  const payload = {
    profileId: f.profileId,
    selection: { type: "media", ids: [f.item.id, second.id, third.id] },
    capabilities: {
      containers: ["mp4"],
      videoCodecs: ["h264"],
      audioCodecs: ["aac"],
    },
    offset: 1,
    limit: 1,
  };
  const read = (body = payload, headers = f.ah) =>
    f.app.inject({
      method: "POST",
      url: "/api/admin/playback-readiness",
      headers,
      payload: body,
    });
  const page = await read();
  assert.equal(page.statusCode, 200, page.body);
  assert.deepEqual(page.json().sourceIds, [otherSource.id]);
  assert.equal(page.json().items[0].id, second.id);
  assert.deepEqual(
    (await read({ ...payload, offset: 0, limit: 100 })).json().sourceIds,
    [f.src.id, otherSource.id],
  );
  assert.deepEqual(
    (await read({ ...payload, offset: 100 })).json().sourceIds,
    [],
  );
  const denied = await read(payload, f.oh);
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.includes(otherSource.id), false);
});

test("channel summaries expose publication state without full programming reads or foreign private identities", async (t) => {
  const f = await fixture(t);
  const published = channel(f.store, f.owner);
  const unpublished = channel(f.store, f.owner);
  const hidden = channel(f.store, f.other);
  const revision = randomUUID();
  f.store.db
    .prepare(
      "INSERT INTO schedule_revisions(id,channel_id,created_at) VALUES(?,?,0)",
    )
    .run(revision, published.id);
  f.store.db
    .prepare("INSERT INTO active_schedules(channel_id,revision_id) VALUES(?,?)")
    .run(published.id, revision);
  const admin = await f.app.inject({
    url: "/api/admin/channels",
    headers: f.ah,
  });
  assert.equal(admin.statusCode, 200);
  assert.equal(
    admin.json().items.find((row: { id: string }) => row.id === published.id)
      .hasProgramming,
    true,
  );
  assert.equal(
    admin.json().items.find((row: { id: string }) => row.id === unpublished.id)
      .hasProgramming,
    false,
  );
  const owned = await f.app.inject({
    url: `/api/profiles/${f.profileId}/channels`,
    headers: f.oh,
  });
  assert.equal(owned.statusCode, 200);
  assert.equal(
    owned.json().find((row: { id: string }) => row.id === published.id)
      .hasProgramming,
    true,
  );
  assert.equal(
    owned.json().find((row: { id: string }) => row.id === unpublished.id)
      .hasProgramming,
    false,
  );
  assert.ok(!JSON.stringify(owned.json()).includes(hidden.id));
  assert.ok(!JSON.stringify(owned.json()).includes("config_json"));
});
