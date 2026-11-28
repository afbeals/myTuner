import {
  subscriptionConfiguration,
  saveSubscriptions,
} from "../src/subscription-configuration.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../src/database.js";
import { account, profile, source, channel } from "./helpers.js";
import {
  profileConfiguration,
  saveProfileConfiguration,
  profileDependencies,
  deleteProfile,
} from "../src/profile-configuration.js";
function fixture(t: { after: (fn: () => void) => void }) {
  const store = new Store(":memory:"),
    admin = account(store, "admin"),
    owner = account(store),
    profileId = profile(store, owner),
    src = source(store);
  t.after(() => store.close());
  return { store, admin, owner, profileId, src };
}
test("atomic profile save preserves untouched PIN and commits identity and grants together", async (t) => {
  const f = fixture(t);
  f.store.db
    .prepare("UPDATE profiles SET pin_hash='saved-hash' WHERE id=?")
    .run(f.profileId);
  const before = profileConfiguration(f.store, f.admin, f.profileId);
  await saveProfileConfiguration(f.store, f.admin, f.profileId, {
    revision: before.revision,
    name: "Shared room",
    kind: "room",
    ownerAccountId: null,
    accounts: [{ accountId: f.owner.id, canManage: true }],
    grants: [{ sourceId: f.src.id, subtree: "Allowed" }],
  });
  const result = profileConfiguration(f.store, f.admin, f.profileId);
  assert.equal(result.name, "Shared room");
  assert.equal(result.kind, "room");
  assert.equal(result.ownerAccountId, null);
  assert.equal(result.pinProtected, true);
  assert.deepEqual(result.grants, [{ sourceId: f.src.id, subtree: "Allowed" }]);
  assert.equal(
    f.store.db
      .prepare("SELECT pin_hash FROM profiles WHERE id=?")
      .get(f.profileId)!.pin_hash,
    "saved-hash",
  );
  await assert.rejects(
    saveProfileConfiguration(f.store, f.admin, f.profileId, {
      revision: before.revision,
      name: "Stale",
    }),
    /changed elsewhere/,
  );
});
test("invalid profile grant or owner rolls back all draft sections", async (t) => {
  const f = fixture(t),
    before = profileConfiguration(f.store, f.admin, f.profileId);
  await assert.rejects(
    saveProfileConfiguration(f.store, f.admin, f.profileId, {
      revision: before.revision,
      name: "Must not save",
      ownerAccountId: null,
    }),
    /needs an owner/,
  );
  await assert.rejects(
    saveProfileConfiguration(f.store, f.admin, f.profileId, {
      revision: before.revision,
      name: "Must not save",
      grants: [{ sourceId: randomUUID(), subtree: "" }],
    }),
    /Source not found/,
  );
  assert.equal(
    profileConfiguration(f.store, f.admin, f.profileId).revision,
    before.revision,
  );
  const viewer = account(f.store, "viewer");
  await assert.rejects(
    saveProfileConfiguration(f.store, f.admin, f.profileId, {
      revision: before.revision,
      accounts: [{ accountId: viewer.id, canManage: true }],
    }),
    /Viewers cannot manage/,
  );
});
test("profile managers may change PIN without gaining admin grant authority", async (t) => {
  const f = fixture(t),
    before = profileConfiguration(f.store, f.owner, f.profileId);
  const saved = await saveProfileConfiguration(f.store, f.owner, f.profileId, {
    revision: before.revision,
    pin: "123456",
  });
  assert.equal(saved.pinProtected, true);
  await assert.rejects(
    saveProfileConfiguration(f.store, f.owner, f.profileId, {
      revision: saved.revision,
      name: "No authority",
    }),
    /Administrator access/,
  );
  assert.deepEqual(
    profileConfiguration(f.store, f.owner, f.profileId).grants,
    [],
  );
});
test("profile deletion removes only unused profile settings and blocks retained schedule references", async (t) => {
  const f = fixture(t);
  f.store.db
    .prepare("INSERT INTO source_grants VALUES(?,?,'')")
    .run(f.profileId, f.src.id);
  const ch = channel(f.store, f.owner);
  f.store.db
    .prepare(
      "INSERT INTO schedule_revisions(id,channel_id,created_at,profile_id) VALUES(?,?,0,?)",
    )
    .run(randomUUID(), ch.id, f.profileId);
  assert.equal(
    profileDependencies(f.store, f.admin, f.profileId).canDelete,
    false,
  );
  assert.throws(
    () => deleteProfile(f.store, f.admin, f.profileId),
    /retained schedules/,
  );
  assert.equal(
    f.store.db
      .prepare("SELECT COUNT(*) AS n FROM source_grants WHERE profile_id=?")
      .get(f.profileId)!.n,
    1,
  );
  const unused = profile(f.store, f.owner);
  f.store.db
    .prepare("INSERT INTO source_grants VALUES(?,?,'')")
    .run(unused, f.src.id);
  deleteProfile(f.store, f.admin, unused);
  assert.equal(
    f.store.db.prepare("SELECT id FROM profiles WHERE id=?").get(unused),
    undefined,
  );
  assert.ok(
    f.store.db.prepare("SELECT id FROM sources WHERE id=?").get(f.src.id),
  );
  assert.ok(
    f.store.db.prepare("SELECT id FROM channels WHERE id=?").get(ch.id),
  );
});

test("subscription batch preserves hidden private memberships and rejects stale or hidden selections", async (t) => {
  const f = fixture(t),
    other = account(f.store),
    visible = channel(f.store, f.owner, "shared"),
    mine = channel(f.store, f.owner),
    hidden = channel(f.store, other);
  const insert = f.store.db.prepare(
    "INSERT INTO subscriptions(profile_id,channel_id,position) VALUES(?,?,?)",
  );
  insert.run(f.profileId, visible.id, 1);
  insert.run(f.profileId, hidden.id, 2);
  const query = { search: "", offset: 0, limit: 1 },
    current = subscriptionConfiguration(f.store, f.owner, f.profileId, query);
  assert.equal(current.total, 2);
  assert.equal(current.items.length, 1);
  assert.equal(JSON.stringify(current).includes(hidden.id), false);
  saveSubscriptions(f.store, f.owner, f.profileId, {
    revision: current.revision,
    channelIds: [mine.id],
  });
  assert.ok(
    f.store.db
      .prepare(
        "SELECT channel_id FROM subscriptions WHERE profile_id=? AND channel_id=?",
      )
      .get(f.profileId, hidden.id),
  );
  assert.equal(
    f.store.db
      .prepare(
        "SELECT position FROM subscriptions WHERE profile_id=? AND channel_id=?",
      )
      .get(f.profileId, hidden.id)!.position,
    2,
  );
  assert.equal(
    f.store.db
      .prepare(
        "SELECT channel_id FROM subscriptions WHERE profile_id=? AND channel_id=?",
      )
      .get(f.profileId, visible.id),
    undefined,
  );
  assert.throws(
    () =>
      saveSubscriptions(f.store, f.owner, f.profileId, {
        revision: current.revision,
        channelIds: [visible.id],
      }),
    /changed elsewhere/,
  );
  const fresh = subscriptionConfiguration(f.store, f.owner, f.profileId, query);
  assert.throws(
    () =>
      saveSubscriptions(f.store, f.owner, f.profileId, {
        revision: fresh.revision,
        channelIds: [hidden.id],
      }),
    /unavailable/,
  );
  assert.equal(
    subscriptionConfiguration(f.store, f.admin, f.profileId, {
      ...query,
      limit: 50,
    }).total,
    3,
  );
});
test("unchanged profile grants do not rewrite the catalog or invalidate its revision", async (t) => {
  const f = fixture(t);
  f.store.db
    .prepare("INSERT INTO source_grants VALUES(?,?,'')")
    .run(f.profileId, f.src.id);
  const current = profileConfiguration(f.store, f.admin, f.profileId),
    revision = f.store.db
      .prepare("SELECT revision FROM catalog_revision")
      .get()!.revision;
  await saveProfileConfiguration(f.store, f.admin, f.profileId, {
    revision: current.revision,
    name: current.name,
    kind: "person",
    ownerAccountId: current.ownerAccountId,
    accounts: current.accounts,
    grants: current.grants,
  });
  assert.equal(
    f.store.db.prepare("SELECT revision FROM catalog_revision").get()!.revision,
    revision,
  );
});

import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { RefreshService } from "../src/refresh.js";
import {
  sourceConfiguration,
  saveSourceConfiguration,
} from "../src/source-configuration.js";
import { PathSuggestions } from "../src/setup-suggestions.js";
import { SetupDirectories } from "../src/setup-directories.js";
async function sourceFixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "mytuner-ui-source-")),
    store = new Store(":memory:");
  await mkdir(join(root, "media"));
  await mkdir(join(root, "data"));
  await mkdir(join(root, "metadata"));
  const src = source(store, join(root, "media"), "shows"),
    refresh = new RefreshService(store, randomBytes(32));
  t.after(async () => {
    await refresh.stop();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, store, src, refresh };
}
function sourceDraft(store: Store, id: string) {
  const draft = sourceConfiguration(store, id);
  const integration = draft.integration
    ? {
        provider: draft.integration.provider,
        url: draft.integration.url,
        mappings: draft.integration.mappings,
      }
    : null;
  return { ...draft, integration };
}
test("source batch rolls back subtitles and metadata when a later connection validation fails", async (t) => {
  const f = await sourceFixture(t),
    before = sourceDraft(f.store, f.src.id);
  await assert.rejects(
    saveSourceConfiguration(
      f.store,
      f.refresh,
      f.src.id,
      {
        ...before,
        metadataRoot: join(f.root, "metadata"),
        subtitles: { ...before.subtitles, enabled: false },
        integration: {
          provider: "radarr",
          url: "http://127.0.0.1:9",
          apiKey: "synthetic-key",
          mappings: [{ from: "/remote", to: f.src.root_path }],
        },
      },
      [join(f.root, "data")],
      () => {},
    ),
    /type does not match/,
  );
  assert.equal(
    sourceConfiguration(f.store, f.src.id).revision,
    before.revision,
  );
  assert.equal(
    f.store.db
      .prepare("SELECT subtitle_revision FROM sources WHERE id=?")
      .get(f.src.id)!.subtitle_revision,
    0,
  );
});
test("source batch preserves saved credentials, schedule timing and success on a no-op, including an offline saved location", async (t) => {
  const f = await sourceFixture(t),
    input = {
      ...sourceDraft(f.store, f.src.id),
      metadataRoot: join(f.root, "metadata"),
      integration: {
        provider: "sonarr" as const,
        url: "http://127.0.0.1:9",
        apiKey: "synthetic-key",
        mappings: [{ from: "/remote", to: f.src.root_path }],
      },
      intervalMs: 60_000,
    };
  await saveSourceConfiguration(
    f.store,
    f.refresh,
    f.src.id,
    input,
    [join(f.root, "data")],
    () => {},
  );
  f.store.db.prepare("UPDATE integrations SET last_success=123").run();
  f.store.db.prepare("UPDATE refresh_sources SET next_run_ms=456").run();
  const saved = sourceDraft(f.store, f.src.id),
    key = f.store.db.prepare("SELECT encrypted_key FROM integrations").get()!
      .encrypted_key,
    subtitle = f.store.db
      .prepare("SELECT subtitle_revision FROM sources WHERE id=?")
      .get(f.src.id)!.subtitle_revision;
  await rename(join(f.root, "metadata"), join(f.root, "offline-metadata"));
  await saveSourceConfiguration(
    f.store,
    f.refresh,
    f.src.id,
    saved,
    [join(f.root, "data")],
    () => {},
  );
  assert.equal(sourceConfiguration(f.store, f.src.id).revision, saved.revision);
  assert.equal(
    f.store.db.prepare("SELECT encrypted_key FROM integrations").get()!
      .encrypted_key,
    key,
  );
  assert.equal(
    f.store.db.prepare("SELECT last_success FROM integrations").get()!
      .last_success,
    123,
  );
  assert.equal(
    f.store.db.prepare("SELECT next_run_ms FROM refresh_sources").get()!
      .next_run_ms,
    456,
  );
  assert.equal(
    f.store.db
      .prepare("SELECT subtitle_revision FROM sources WHERE id=?")
      .get(f.src.id)!.subtitle_revision,
    subtitle,
  );
  assert.equal(
    JSON.stringify(sourceConfiguration(f.store, f.src.id)).includes(
      "synthetic-key",
    ),
    false,
  );
});
test("source batch rejects newly missing mappings and stale drafts without changing other settings", async (t) => {
  const f = await sourceFixture(t),
    before = sourceDraft(f.store, f.src.id);
  await assert.rejects(
    saveSourceConfiguration(
      f.store,
      f.refresh,
      f.src.id,
      {
        ...before,
        subtitles: { ...before.subtitles, enabled: false },
        integration: {
          provider: "sonarr",
          url: "http://127.0.0.1:9",
          apiKey: "synthetic-key",
          mappings: [{ from: "/remote", to: join(f.root, "missing") }],
        },
      },
      [],
      () => {},
    ),
    /Mapping destination is unavailable/,
  );
  assert.equal(
    sourceConfiguration(f.store, f.src.id).revision,
    before.revision,
  );
  f.refresh.schedule(f.src.id, 60_000);
  await assert.rejects(
    saveSourceConfiguration(
      f.store,
      f.refresh,
      f.src.id,
      { ...before, metadataRoot: join(f.root, "metadata") },
      [],
      () => {},
    ),
    /changed elsewhere/,
  );
  assert.equal(sourceConfiguration(f.store, f.src.id).metadataRoot, null);
});
test("setup browser pages direct folders, reuses prior pages and excludes symlink escapes and application storage", async (t) => {
  const f = await sourceFixture(t);
  for (let n = 0; n < 61; n++)
    await mkdir(join(f.src.root_path, `Folder ${n}`));
  await writeFile(join(f.src.root_path, "ignored.mp4"), "synthetic");
  await symlink(join(f.root, "data"), join(f.src.root_path, "escape"));
  const browser = new SetupDirectories(
    f.store,
    new PathSuggestions(f.store, [join(f.root, "data")], "darwin"),
    [join(f.root, "data")],
  );
  t.after(() => browser.stop());
  const input = {
      root: f.src.root_path,
      parent: "",
      offset: 0,
      purpose: "source" as const,
    },
    first = await browser.read(input, () => {}),
    second = await browser.read({ ...input, offset: 50 }, () => {});
  assert.equal(first.items.length, 50);
  assert.equal(first.hasMore, true);
  assert.equal(second.items.length, 11);
  assert.equal(second.hasMore, false);
  assert.deepEqual(await browser.read(input, () => {}), first);
  assert.equal(
    [...first.items, ...second.items].some((item) => item.label === "escape"),
    false,
  );
  await assert.rejects(
    browser.read({ ...input, parent: "escape" }, () => {}),
    /outside the selected/,
  );
  await assert.rejects(
    browser.read({ ...input, root: join(f.root, "data") }, () => {}),
    /cannot be browsed/,
  );
  await assert.rejects(browser.read({ ...input, parent: "../data" }, () => {}));
});
test("setup browser stops each page after bounded entries even in a directory containing only files", async (t) => {
  const f = await sourceFixture(t);
  await Promise.all(
    Array.from({ length: 270 }, (_, n) =>
      writeFile(join(f.src.root_path, `file-${n}.txt`), "synthetic"),
    ),
  );
  const browser = new SetupDirectories(
    f.store,
    new PathSuggestions(f.store, [], "darwin"),
    [],
  );
  t.after(() => browser.stop());
  const input = {
      root: f.src.root_path,
      parent: "",
      offset: 0,
      purpose: "source" as const,
    },
    first = await browser.read(input, () => {}),
    next = await browser.read({ ...input, offset: 50 }, () => {});
  assert.equal(first.items.length, 0);
  assert.equal(first.hasMore, true);
  assert.equal(next.items.length, 0);
  assert.equal(next.hasMore, false);
});

import { media } from "./helpers.js";
import { ProgrammingService } from "../src/programming.js";
import {
  previewNewChannel,
  createNewChannel,
  channelDependencies,
  permanentlyDeleteChannel,
} from "../src/channel-lifecycle.js";
import { ensureCatalogProjection } from "../src/catalog-projection.js";
import { browseCatalogTree } from "../src/catalog-selection.js";
function draftFixture(t: { after: (fn: () => void) => void }) {
  const f = fixture(t),
    item = media(f.store, f.src.id, "Allowed/episode.mp4", 60_000);
  f.store.db
    .prepare("INSERT INTO source_grants VALUES(?,?,'Allowed')")
    .run(f.profileId, f.src.id);
  const draft = {
    draftId: randomUUID(),
    details: {
      name: "New channel",
      description: "Synthetic channel",
      shortName: null,
      visibility: "private" as const,
    },
    config: {
      profileId: f.profileId,
      groups: [
        {
          id: "group-1",
          mode: "ordered" as const,
          selection: { type: "media" as const, ids: [item.id] },
        },
      ],
      rules: {
        between: false,
        positions: [],
        maxClips: 0,
        maxDurationMs: 0,
        repeatAllowance: 1,
        maxPerBreak: 1,
        cooldownMs: 0,
      },
      seed: 42,
    },
  };
  return { ...f, item, draft, programming: new ProgrammingService(f.store) };
}
test("channel wizard preview is read-only; final publication is atomic and safe to retry", (t) => {
  const f = draftFixture(t),
    before = Number(
      f.store.db.prepare("SELECT COUNT(*) AS n FROM channels").get()!.n,
    ),
    preview = previewNewChannel(
      f.store,
      f.owner,
      f.programming,
      f.draft,
      10_000,
    );
  assert.equal(
    Number(f.store.db.prepare("SELECT COUNT(*) AS n FROM channels").get()!.n),
    before,
  );
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM schedule_revisions").get()!.n,
    0,
  );
  assert.ok(preview.entries.length > 0);
  assert.ok(preview.entries.length <= 100);
  const created = createNewChannel(
    f.store,
    f.owner,
    f.programming,
    f.draft,
    preview.revision,
    10_000,
  );
  assert.equal(created.created, true);
  const retry = createNewChannel(
    f.store,
    f.owner,
    f.programming,
    f.draft,
    preview.revision,
    10_100,
  );
  assert.equal(retry.created, false);
  assert.equal(retry.id, created.id);
  assert.equal(
    f.store.db
      .prepare(
        "SELECT COUNT(*) AS n FROM schedule_revisions WHERE channel_id=?",
      )
      .get(created.id)!.n,
    1,
  );
  assert.throws(
    () =>
      createNewChannel(
        f.store,
        f.owner,
        f.programming,
        { ...f.draft, details: { ...f.draft.details, name: "Changed" } },
        preview.revision,
      ),
    /identifier is already in use/,
  );
});
test("new channel rejects stale previews and rolls back a failed final publication without leaving a channel", (t) => {
  const f = draftFixture(t),
    preview = previewNewChannel(
      f.store,
      f.owner,
      f.programming,
      f.draft,
      10_000,
    );
  f.store.db
    .prepare("UPDATE media SET title='Updated' WHERE id=?")
    .run(f.item.id);
  assert.throws(
    () =>
      createNewChannel(
        f.store,
        f.owner,
        f.programming,
        f.draft,
        preview.revision,
      ),
    /Generate a new preview/,
  );
  assert.equal(
    f.store.db
      .prepare("SELECT id FROM channels WHERE id=?")
      .get(f.draft.draftId),
    undefined,
  );
  const fresh = previewNewChannel(
    f.store,
    f.owner,
    f.programming,
    f.draft,
    10_000,
  );
  class FailingPublication extends ProgrammingService {
    override publish(): never {
      throw new Error("Synthetic publication failure");
    }
  }
  assert.throws(
    () =>
      createNewChannel(
        f.store,
        f.owner,
        new FailingPublication(f.store),
        f.draft,
        fresh.revision,
      ),
    /Synthetic publication failure/,
  );
  assert.equal(
    f.store.db
      .prepare("SELECT id FROM channels WHERE id=?")
      .get(f.draft.draftId),
    undefined,
  );
});
test("new channel and permanent deletion enforce ownership, visibility and retained dependencies", (t) => {
  const f = draftFixture(t),
    other = account(f.store),
    shared = {
      ...f.draft,
      details: { ...f.draft.details, visibility: "shared" as const },
    };
  assert.throws(
    () => previewNewChannel(f.store, f.owner, f.programming, shared),
    /Administrator access/,
  );
  assert.throws(() =>
    previewNewChannel(f.store, other, f.programming, f.draft),
  );
  const ch = channel(f.store, f.owner),
    active = channelDependencies(f.store, f.owner, ch.id);
  assert.equal(active.canDelete, false);
  assert.throws(
    () => permanentlyDeleteChannel(f.store, f.owner, ch.id, active.revision),
    /Archive this channel/,
  );
  assert.throws(() => channelDependencies(f.store, other, ch.id), /not found/);
  f.store.db.prepare("UPDATE channels SET archived=1 WHERE id=?").run(ch.id);
  const archived = channelDependencies(f.store, f.owner, ch.id);
  assert.equal(archived.canDelete, true);
  permanentlyDeleteChannel(f.store, f.owner, ch.id, archived.revision);
  assert.equal(
    f.store.db.prepare("SELECT id FROM channels WHERE id=?").get(ch.id),
    undefined,
  );
  const preview = previewNewChannel(f.store, f.owner, f.programming, f.draft);
  createNewChannel(f.store, f.owner, f.programming, f.draft, preview.revision);
  f.store.db
    .prepare("UPDATE channels SET archived=1 WHERE id=?")
    .run(f.draft.draftId);
  const retained = channelDependencies(f.store, f.owner, f.draft.draftId);
  assert.equal(retained.canDelete, true);
  assert.equal(retained.counts.schedules, 1);
});
test("indexed folder and file search keep literal matching, direct-child scope and source identities", async (t) => {
  const f = fixture(t),
    second = source(f.store, "/second"),
    first = media(f.store, f.src.id, "Shows/Test Show/Episode.mp4"),
    misleading = media(f.store, f.src.id, "_waiting_ignore/_SORT/test.mp4"),
    other = media(f.store, second.id, "Shows/Test Show/Second.mp4");
  f.store.db
    .prepare("UPDATE media SET title='Test title' WHERE id=?")
    .run(first.id);
  f.store.db
    .prepare("INSERT INTO source_grants VALUES(?,?,'')")
    .run(f.profileId, f.src.id);
  f.store.db
    .prepare("INSERT INTO source_grants VALUES(?,?,'')")
    .run(f.profileId, second.id);
  await ensureCatalogProjection(f.store);
  const input = {
    sourceId: "",
    parent: "",
    search: "test",
    mode: "folders" as const,
    recursive: false,
    offset: 0,
    limit: 50,
  };
  assert.equal(
    browseCatalogTree(f.store, f.owner, f.profileId, input).total,
    0,
  );
  const recursive = browseCatalogTree(f.store, f.owner, f.profileId, {
    ...input,
    recursive: true,
  });
  assert.equal(recursive.total, 2);
  assert.equal(new Set(recursive.items.map((item) => item.id)).size, 2);
  assert.ok(recursive.items.every((item) => item.path === "Shows/Test Show"));
  const files = browseCatalogTree(f.store, f.owner, f.profileId, {
    ...input,
    mode: "files",
    recursive: true,
  });
  assert.deepEqual(
    files.items.map((item) => item.id),
    [misleading.id],
  );
  assert.equal(files.items[0]!.sourceId, f.src.id);
  f.store.db
    .prepare("DELETE FROM source_grants WHERE profile_id=? AND source_id=?")
    .run(f.profileId, second.id);
  await ensureCatalogProjection(f.store);
  assert.equal(
    browseCatalogTree(f.store, f.owner, f.profileId, {
      ...input,
      recursive: true,
    }).total,
    1,
  );
  assert.ok(other);
});

import { collectionMembership } from "../src/collection-membership.js";
import { saveCollection } from "../src/library.js";
test("compact collection membership rejects stale writes and avoids rewriting unchanged references", (t) => {
  const f = draftFixture(t),
    created = saveCollection(f.store, f.owner, f.profileId, "Exact videos", [
      f.item.id,
    ]),
    before = collectionMembership(f.store, f.owner, f.profileId, created.id),
    revision = f.store.db
      .prepare("SELECT revision FROM catalog_revision")
      .get()!.revision;
  saveCollection(
    f.store,
    f.owner,
    f.profileId,
    "Exact videos",
    [f.item.id],
    created.id,
    before.revision,
  );
  assert.equal(
    f.store.db.prepare("SELECT revision FROM catalog_revision").get()!.revision,
    revision,
  );
  saveCollection(
    f.store,
    f.owner,
    f.profileId,
    "Renamed",
    [f.item.id],
    created.id,
    before.revision,
  );
  assert.throws(
    () =>
      saveCollection(
        f.store,
        f.owner,
        f.profileId,
        "Stale name",
        [f.item.id],
        created.id,
        before.revision,
      ),
    /changed elsewhere/,
  );
  assert.throws(() =>
    collectionMembership(f.store, account(f.store), f.profileId, created.id),
  );
  assert.deepEqual(
    collectionMembership(f.store, f.owner, f.profileId, created.id).ids,
    [f.item.id],
  );
});

import {
  prepareSubtitleConfiguration,
  subtitleConfig,
} from "../src/subtitle-catalog.js";
import { addSource } from "../src/catalog.js";
test("prepared subtitle roots cannot commit after another source claims their directory", async (t) => {
  const f = await sourceFixture(t),
    captions = join(f.root, "shared-captions");
  await mkdir(captions);
  const before = sourceConfiguration(f.store, f.src.id),
    commit = await prepareSubtitleConfiguration(
      f.store,
      f.src.id,
      0,
      { ...subtitleConfig(f.src), root: captions },
      [join(f.root, "data")],
      () => {},
    );
  await addSource(
    f.store,
    {
      name: "New media source",
      root: captions,
      kind: "videos",
      recursive: true,
    },
    [join(f.root, "data")],
  );
  assert.throws(commit, /directories changed/);
  assert.equal(
    sourceConfiguration(f.store, f.src.id).revision,
    before.revision,
  );
});

test("folder request admission stays bounded after disconnects until held storage drains", async () => {
  const store = new Store(":memory:");
  let release!: (value: string) => void, started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const paths = new PathSuggestions(store, [], "linux", () => {
    started();
    return new Promise<string>((resolve) => {
      release = resolve;
    });
  });
  const browser = new SetupDirectories(store, paths, [], {
    requests: 3,
    milliseconds: 1000,
    shutdownMs: 20,
  });
  const input = {
    root: "/synthetic",
    parent: "",
    offset: 0,
    purpose: "source" as const,
  };
  const controllers = Array.from({ length: 3 }, () => new AbortController());
  const tasks = controllers.map((controller) =>
    browser.read(input, () => {}, controller.signal),
  );
  const outcomes = Promise.all(
    tasks.map((task) => assert.rejects(task, /cancelled/)),
  );
  await began;
  controllers.forEach((controller) => controller.abort(new Error("cancelled")));
  await outcomes;
  await assert.rejects(
    browser.read(input, () => {}),
    /busy/,
  );
  // Bounded shutdown returns even while the simulated mount syscall is held.
  await browser.stop();
  store.close();
  let lateDatabaseReads = 0;
  const prepare = store.db.prepare.bind(store.db);
  store.db.prepare = (sql: string) => {
    lateDatabaseReads++;
    return prepare(sql);
  };
  // The checkpoint in PathSuggestions must prevent any late database access.
  release("");
  await (browser as unknown as { lane: Promise<unknown> }).lane;
  assert.equal(lateDatabaseReads, 0);
  assert.equal(
    (browser as unknown as { pending: Set<unknown> }).pending.size,
    0,
  );
  await assert.rejects(
    browser.read(input, () => {}),
    /stopping/,
  );
});
test("folder request deadlines return promptly while retaining admission for uncancellable storage", async () => {
  const store = new Store(":memory:");
  let release!: (value: string) => void;
  const paths = new PathSuggestions(
    store,
    [],
    "linux",
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  );
  const browser = new SetupDirectories(store, paths, [], {
    requests: 1,
    milliseconds: 25,
    shutdownMs: 20,
  });
  const input = {
    root: "/synthetic",
    parent: "",
    offset: 0,
    purpose: "source" as const,
  };
  try {
    await assert.rejects(
      browser.read(input, () => {}),
      /too long/,
    );
    await assert.rejects(
      browser.read(input, () => {}),
      /busy/,
    );
    release("");
    await (browser as unknown as { lane: Promise<unknown> }).lane;
  } finally {
    await browser.stop();
    store.close();
  }
});

test("empty channel wizard creation remains read-only until submission and retains an editable empty config", (t) => {
  const f = draftFixture(t),
    draft = { ...f.draft, config: { ...f.draft.config, groups: [] } };
  const preview = previewNewChannel(
    f.store,
    f.owner,
    f.programming,
    draft,
    1000,
  );
  assert.deepEqual(preview.entries, []);
  assert.equal(preview.total, 0);
  assert.equal(
    f.store.db.prepare("SELECT id FROM channels WHERE id=?").get(draft.draftId),
    undefined,
  );
  createNewChannel(
    f.store,
    f.owner,
    f.programming,
    draft,
    preview.revision,
    1000,
  );
  assert.deepEqual(
    JSON.parse(f.programming.active(draft.draftId)!.config_json!).groups,
    [],
  );
  assert.equal(
    createNewChannel(f.store, f.owner, f.programming, draft, preview.revision)
      .created,
    false,
  );
});

test("archived deletion purges only the named channel records and leaves media, collections and all files intact", async (t) => {
  const { mkdtemp, mkdir, writeFile, readFile, stat, rm } =
    await import("node:fs/promises");
  const { join } = await import("node:path"),
    { tmpdir } = await import("node:os");
  const root = await mkdtemp(join(tmpdir(), "mytuner-channel-delete-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const f = draftFixture(t),
    ch = channel(f.store, f.owner),
    sibling = channel(f.store, f.owner);
  const files = [
    "media/video.mp4",
    "media/video.nfo",
    "media/subtitles/video.srt",
    "generated/preview.jpg",
    "cache/segment.ts",
    "data/backups/snapshot.db",
    "data/unknown.txt",
  ];
  for (const file of files) {
    await mkdir(join(root, file, ".."), { recursive: true });
    await writeFile(join(root, file), `synthetic:${file}`);
  }
  f.store.db
    .prepare("UPDATE sources SET root_path=? WHERE id=?")
    .run(join(root, "media"), f.src.id);
  f.store.db
    .prepare("UPDATE media SET relative_path='video.mp4' WHERE id=?")
    .run(f.item.id);
  f.store.db
    .prepare("UPDATE source_grants SET subtree='' WHERE profile_id=?")
    .run(f.profileId);
  const snapshots = await Promise.all(
    files.map(async (file) => ({
      body: await readFile(join(root, file)),
      info: await stat(join(root, file)),
    })),
  );
  const config = {
    ...f.draft.config,
    groups: [
      {
        ...f.draft.config.groups[0]!,
        selection: { type: "media" as const, ids: [f.item.id] },
      },
    ],
  };
  const published = f.programming.publish(f.owner, ch.id, config, 1000, 120000);
  f.programming.publish(f.owner, sibling.id, config, 1000, 120000);
  const { PlaybackService } = await import("../src/playback.js"),
    playback = new PlaybackService(f.store, f.programming);
  for (const target of [ch, sibling]) {
    const session = playback.join(f.owner, f.profileId, target.id, 1001);
    f.store.db
      .prepare("INSERT INTO subscriptions(profile_id,channel_id) VALUES(?,?)")
      .run(f.profileId, target.id);
    f.store.db
      .prepare(
        "INSERT INTO playback_events(id,session_id,account_id,channel_id,entry_id,start_ms,end_ms,created_ms) VALUES(?,?,?,?,?,1000,1100,1200)",
      )
      .run(
        randomUUID(),
        session.id,
        f.owner.id,
        target.id,
        session.playback!.entry.id,
      );
    f.store.db
      .prepare(
        "INSERT INTO problem_reports(id,account_id,request_id,profile_id,channel_id,media_id,created_ms,summary_json) VALUES(?,?,?,?,?,?,1200,'{}')",
      )
      .run(
        randomUUID(),
        f.owner.id,
        randomUUID(),
        f.profileId,
        target.id,
        f.item.id,
      );
  }
  const collection = saveCollection(
    f.store,
    f.owner,
    f.profileId,
    "Keep collection",
    [f.item.id],
  );
  f.store.db
    .prepare(
      "INSERT INTO generated_assets(id,media_id,kind,fingerprint,relative_path) VALUES(?,?,'thumbnail','keep','preview.jpg')",
    )
    .run(randomUUID(), f.item.id);
  const tables = [
    "channels",
    "channel_items",
    "subscriptions",
    "schedule_revisions",
    "schedule_entries",
    "active_schedules",
    "rotation_state",
    "schedule_checkpoints",
    "playback_sessions",
    "playback_events",
    "problem_reports",
    "media",
    "sources",
    "collections",
    "collection_items",
    "generated_assets",
  ];
  const before = new Map(
    tables.map((table) => [
      table,
      f.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ]),
  );
  f.store.db.prepare("UPDATE channels SET archived=1 WHERE id=?").run(ch.id);
  const impact = channelDependencies(f.store, f.owner, ch.id);
  assert.equal(impact.canDelete, true);
  assert.equal(impact.counts.playback, 1);
  assert.equal(impact.counts.history, 1);
  assert.equal(impact.counts.reports, 1);
  assert.equal(impact.counts.schedules, 1);
  assert.ok(impact.counts.entries! > 0);
  assert.throws(
    () =>
      permanentlyDeleteChannel(
        f.store,
        account(f.store),
        ch.id,
        impact.revision,
      ),
    /not found/,
  );
  // A database refusal must roll back children deleted earlier in the transaction.
  f.store.db.exec(
    "CREATE TEMP TRIGGER refuse_channel_delete BEFORE DELETE ON channels BEGIN SELECT RAISE(ABORT,'synthetic delete refusal'); END",
  );
  assert.throws(
    () => permanentlyDeleteChannel(f.store, f.owner, ch.id, impact.revision),
    /synthetic delete refusal/,
  );
  for (const table of tables.filter((table) => table !== "channels"))
    assert.deepEqual(
      f.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      before.get(table),
      table,
    );
  f.store.db.exec("DROP TRIGGER refuse_channel_delete");
  // Even a same-count schedule edit invalidates the reviewed deletion.
  f.store.db
    .prepare(
      "UPDATE schedule_revisions SET config_json=json_set(config_json,'$.seed',43) WHERE id=?",
    )
    .run(published.revisionId);
  assert.throws(
    () => permanentlyDeleteChannel(f.store, f.owner, ch.id, impact.revision),
    /changed/,
  );
  const fresh = channelDependencies(f.store, f.admin, ch.id);
  permanentlyDeleteChannel(f.store, f.admin, ch.id, fresh.revision);
  for (const table of [
    "channels",
    "channel_items",
    "subscriptions",
    "schedule_revisions",
    "schedule_entries",
    "active_schedules",
    "rotation_state",
    "playback_sessions",
    "playback_events",
    "problem_reports",
  ]) {
    const key = table === "channels" ? "id" : "channel_id";
    assert.equal(
      f.store.db
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${key}=?`)
        .get(ch.id)!.n,
      0,
      table,
    );
    const rows = before.get(table)! as Record<string, unknown>[];
    assert.deepEqual(
      f.store.db
        .prepare(`SELECT * FROM ${table} WHERE ${key}=? ORDER BY rowid`)
        .all(sibling.id),
      rows.filter((row) => row[key] === sibling.id),
      `${table} sibling`,
    );
  }
  assert.equal(
    f.store.db
      .prepare(
        "SELECT COUNT(*) AS n FROM schedule_checkpoints WHERE revision_id=?",
      )
      .get(published.revisionId)!.n,
    0,
  );
  for (const table of [
    "media",
    "sources",
    "collections",
    "collection_items",
    "generated_assets",
  ])
    assert.deepEqual(
      f.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      before.get(table),
      table,
    );
  assert.ok(
    f.store.db
      .prepare("SELECT id FROM collections WHERE id=?")
      .get(collection.id),
  );
  assert.deepEqual(f.store.db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(
    f.store.db.prepare("PRAGMA integrity_check").get()!.integrity_check,
    "ok",
  );
  await Promise.all(
    files.map(async (file, index) => {
      assert.deepEqual(
        await readFile(join(root, file)),
        snapshots[index]!.body,
        file,
      );
      const actual = await stat(join(root, file));
      assert.equal(actual.ino, snapshots[index]!.info.ino, file);
      assert.equal(actual.mtimeMs, snapshots[index]!.info.mtimeMs, file);
    }),
  );
});
