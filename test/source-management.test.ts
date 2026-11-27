import { sourceDetails } from "../src/source-configuration.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/database.js";
import { addSource, scanSource } from "../src/catalog.js";
import { editSource, removeSource } from "../src/source-management.js";
import { RefreshService, unseal } from "../src/refresh.js";
import { createServer } from "../src/server.js";

import { account, profile, media, channel } from "./helpers.js";

async function fixture(t: { after: (f: () => unknown) => void }) {
  const root = await mkdtemp(join(tmpdir(), "mytuner-source-fixes-")),
    store = new Store(":memory:");
  await mkdir(join(root, "videos"));
  await mkdir(join(root, "other"));
  await writeFile(join(root, "videos", "file.mp4"), "synthetic original");
  const src = await addSource(
    store,
    {
      name: "Original",
      root: join(root, "videos"),
      kind: "videos",
      recursive: true,
    },
    [join(root, "data")],
  );
  await scanSource(store, src, async () => 1000);
  const owner = account(store, "admin"),
    p = profile(store, owner),
    item = store.db.prepare("SELECT * FROM media").get()!;
  store.db
    .prepare(
      "INSERT INTO source_grants(profile_id,source_id,subtree) VALUES(?,?,'')",
    )
    .run(p, src.id);
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, store, src, owner, p, item };
}
test("source name and scope edits retain media identity, grants and untouched originals", async (t) => {
  const f = await fixture(t);
  const updated = await editSource(
    f.store,
    f.src.id,
    {
      revision: sourceDetails(f.store, f.src.id).revision,
      name: "Corrected",
      recursive: false,
    },
    [join(f.root, "data")],
    () => {},
    () => false,
  );
  assert.equal(updated.name, "Corrected");
  assert.equal(updated.recursive, 0);
  assert.equal(updated.catalogReset, false);
  assert.equal(f.store.db.prepare("SELECT id FROM media").get()!.id, f.item.id);
  assert.equal(
    f.store.db.prepare("SELECT count(*) AS n FROM source_grants").get()!.n,
    1,
  );
  assert.equal(
    await readFile(join(f.root, "videos", "file.mp4"), "utf8"),
    "synthetic original",
  );
});
test("source root changes reset only an unused catalog and its authority, then retain original files", async (t) => {
  const f = await fixture(t);
  const updated = await editSource(
    f.store,
    f.src.id,
    {
      revision: sourceDetails(f.store, f.src.id).revision,
      resetConfirmed: true,
      root: join(f.root, "other"),
      kind: "movies",
    },
    [],
    () => {},
    () => false,
  );
  assert.equal(updated.catalogReset, true);
  assert.equal(updated.kind, "movies");
  assert.equal(
    f.store.db.prepare("SELECT count(*) AS n FROM media").get()!.n,
    0,
  );
  assert.equal(
    f.store.db.prepare("SELECT count(*) AS n FROM source_grants").get()!.n,
    0,
  );
  assert.equal(
    await readFile(join(f.root, "videos", "file.mp4"), "utf8"),
    "synthetic original",
  );
});
test("source removal cleans scoped metadata and jobs without deleting videos or another source", async (t) => {
  const f = await fixture(t),
    other = await addSource(
      f.store,
      {
        name: "Other",
        root: join(f.root, "other"),
        kind: "videos",
        recursive: true,
      },
      [],
    );
  const job = randomUUID(),
    item = randomUUID();
  f.store.db
    .prepare(
      "INSERT INTO generation_jobs(id,source_id,directory,recursive,status,regenerate,created_at) VALUES(?,?,'',1,'completed',0,0)",
    )
    .run(job, f.src.id);
  f.store.db
    .prepare(
      "INSERT INTO generation_items(id,job_id,media_id,kind,status) VALUES(?,?,?,'thumbnail','completed')",
    )
    .run(item, job, String(f.item.id));
  f.store.db
    .prepare(
      "INSERT INTO generated_assets(id,media_id,kind,fingerprint,relative_path) VALUES(?,?,'thumbnail','x','synthetic.jpg')",
    )
    .run(randomUUID(), String(f.item.id));
  removeSource(f.store, f.src.id, () => false);
  assert.equal(
    f.store.db.prepare("SELECT count(*) AS n FROM sources").get()!.n,
    1,
  );
  assert.equal(
    f.store.db.prepare("SELECT id FROM sources").get()!.id,
    other.id,
  );
  assert.equal(f.store.db.prepare("PRAGMA foreign_key_check").all().length, 0);
  assert.equal(
    await readFile(join(f.root, "videos", "file.mp4"), "utf8"),
    "synthetic original",
  );
});
test("channel references block destructive edits and removal while retaining ordinary source edits", async (t) => {
  const f = await fixture(t),
    c = channel(f.store, f.owner);
  f.store.db
    .prepare(
      "INSERT INTO schedule_revisions(id,channel_id,created_at,config_json) VALUES(?,?,0,?)",
    )
    .run(
      randomUUID(),
      c.id,
      JSON.stringify({
        groups: [
          { selection: { type: "folder", sourceId: f.src.id, directory: "" } },
        ],
      }),
    );
  assert.throws(
    () => removeSource(f.store, f.src.id, () => false),
    /referenced/,
  );
  await assert.rejects(
    editSource(
      f.store,
      f.src.id,
      {
        revision: sourceDetails(f.store, f.src.id).revision,
        resetConfirmed: true,
        root: join(f.root, "other"),
      },
      [],
      () => {},
      () => false,
    ),
    /referenced/,
  );
  assert.equal(
    (
      await editSource(
        f.store,
        f.src.id,
        {
          revision: sourceDetails(f.store, f.src.id).revision,
          name: "Still editable",
        },
        [],
        () => {},
        () => false,
      )
    ).name,
    "Still editable",
  );
});
test("active scans, queued generation, overlap and revoked authority prevent source mutation", async (t) => {
  const f = await fixture(t);
  assert.throws(() => removeSource(f.store, f.src.id, () => true), /scan/);
  await assert.rejects(
    editSource(
      f.store,
      f.src.id,
      { revision: sourceDetails(f.store, f.src.id).revision, name: "Denied" },
      [],
      () => {},
      () => true,
    ),
    /scan/,
  );
  await assert.rejects(
    editSource(
      f.store,
      f.src.id,
      {
        revision: sourceDetails(f.store, f.src.id).revision,
        resetConfirmed: true,
        root: join(f.root, "other"),
      },
      [join(f.root, "other")],
      () => {},
      () => false,
    ),
    /overlap/,
  );
  await assert.rejects(
    editSource(
      f.store,
      f.src.id,
      { revision: sourceDetails(f.store, f.src.id).revision, name: "Denied" },
      [],
      () => {
        throw Error("revoked");
      },
      () => false,
    ),
    /revoked/,
  );
  f.store.db
    .prepare(
      "INSERT INTO generation_jobs(id,source_id,directory,recursive,status,regenerate,created_at) VALUES(?,?,'',1,'queued',0,0)",
    )
    .run(randomUUID(), f.src.id);
  assert.throws(
    () => removeSource(f.store, f.src.id, () => false),
    /generation/,
  );
  assert.equal(
    f.store.db.prepare("SELECT name FROM sources WHERE id=?").get(f.src.id)!
      .name,
    "Original",
  );
});
test("integration mapping edits retain the encrypted key and require explicit keys for changed destinations", async (t) => {
  const f = await fixture(t),
    key = Buffer.alloc(32, 2),
    refresh = new RefreshService(f.store, key);
  f.store.db
    .prepare("UPDATE sources SET kind='shows' WHERE id=?")
    .run(f.src.id);
  const input = {
    provider: "sonarr" as const,
    url: "http://sonarr.local:8989",
    mappings: [{ from: "/tv", to: f.src.root_path }],
  };
  assert.throws(() => refresh.configure(f.src.id, input), /Enter an API key/);
  refresh.configure(f.src.id, { ...input, apiKey: "private-original-key" });
  const before = f.store.db
    .prepare("SELECT encrypted_key FROM integrations")
    .get()!.encrypted_key;
  refresh.configure(f.src.id, {
    ...input,
    mappings: [{ from: "/changed", to: f.src.root_path }],
  });
  assert.equal(
    f.store.db.prepare("SELECT encrypted_key FROM integrations").get()!
      .encrypted_key,
    before,
  );
  assert.equal(unseal(key, String(before)), "private-original-key");
  assert.throws(
    () =>
      refresh.configure(f.src.id, { ...input, url: "http://other.local:8989" }),
    /Enter an API key/,
  );
  refresh.configure(f.src.id, { ...input, apiKey: "replacement" });
  assert.equal(
    unseal(
      key,
      String(
        f.store.db.prepare("SELECT encrypted_key FROM integrations").get()!
          .encrypted_key,
      ),
    ),
    "replacement",
  );
  await refresh.stop();
});
test("HTTP source changes enforce admin access and saved credentials remain undisclosed", async (t) => {
  const f = await fixture(t),
    key = Buffer.alloc(32, 3),
    app = createServer(f.store, {
      writableRoots: [join(f.root, "data")],
      generatedRoot: join(f.root, "generated"),
      cacheRoot: join(f.root, "cache"),
      integrationKey: key,
    });
  t.after(() => app.close());
  // Direct session creation avoids unrelated password hashing; actor still resolves its current account.
  const { digest } = await import("../src/security.js");
  const token = randomUUID();
  f.store.db
    .prepare(
      "INSERT INTO sessions(token_hash,account_id,expires_at,kind) VALUES(?,?,?,'bearer')",
    )
    .run(digest(token), f.owner.id, Date.now() + 60000);
  const headers = { authorization: `Bearer ${token}` };
  const edited = await app.inject({
    method: "PATCH",
    url: `/api/sources/${f.src.id}`,
    headers,
    payload: {
      revision: sourceDetails(f.store, f.src.id).revision,
      name: "HTTP edited",
    },
  });
  assert.equal(edited.statusCode, 200, edited.body);
  f.store.db
    .prepare("UPDATE sources SET kind='shows' WHERE id=?")
    .run(f.src.id);
  const url = `/api/sources/${f.src.id}/integration`,
    input = {
      provider: "sonarr",
      url: "http://sonarr.local:8989",
      apiKey: "synthetic-private-key",
      mappings: [{ from: "/tv", to: f.src.root_path }],
    };
  assert.equal(
    (await app.inject({ method: "PUT", url, headers, payload: input }))
      .statusCode,
    204,
  );
  const response = await app.inject({ url, headers });
  assert.equal(response.json().hasApiKey, true);
  assert.doesNotMatch(response.body, /synthetic-private-key|encrypted_key/);
  const { apiKey: _, ...withoutKey } = input;
  assert.equal(
    (await app.inject({ method: "PUT", url, headers, payload: withoutKey }))
      .statusCode,
    204,
  );
  f.store.db
    .prepare("UPDATE accounts SET role='viewer' WHERE id=?")
    .run(f.owner.id);
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: `/api/sources/${f.src.id}`,
        headers,
        payload: { name: "Forbidden" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: `/api/sources/${f.src.id}`,
        headers,
      })
    ).statusCode,
    403,
  );
});

for (const change of ["removed", "changed"] as const)
  test(
    `a delayed ad-hoc integration import cannot apply after its source is ${change}`,
    { timeout: 5000 },
    async (t) => {
      const f = await fixture(t);
      f.store.db
        .prepare("UPDATE sources SET kind='shows' WHERE id=?")
        .run(f.src.id);
      const { createServer: upstreamServer } = await import("node:http"),
        { digest } = await import("../src/security.js");
      let release!: () => void, entered!: () => void;
      const held = new Promise<void>((resolve) => {
          release = resolve;
        }),
        received = new Promise<void>((resolve) => {
          entered = resolve;
        });
      const upstream = upstreamServer(async (_req, res) => {
        entered();
        await held;
        res.setHeader("Content-Type", "application/json");
        res.end("[]");
      });
      t.after(async () => {
        release();
        upstream.closeAllConnections();
        await new Promise<void>((resolve) => upstream.close(() => resolve()));
      });
      await new Promise<void>((resolve) =>
        upstream.listen(0, "127.0.0.1", resolve),
      );
      const address = upstream.address();
      assert.ok(address && typeof address !== "string");
      const app = createServer(f.store, {
        writableRoots: [join(f.root, "data")],
        generatedRoot: join(f.root, "generated"),
        cacheRoot: join(f.root, "cache"),
      });
      t.after(() => app.close());
      const token = randomUUID();
      f.store.db
        .prepare(
          "INSERT INTO sessions(token_hash,account_id,expires_at) VALUES(?,?,?)",
        )
        .run(digest(token), f.owner.id, Date.now() + 60000);
      const headers = { authorization: `Bearer ${token}` };
      const pending = app.inject({
        method: "POST",
        url: `/api/sources/${f.src.id}/import`,
        headers,
        payload: {
          provider: "sonarr",
          url: `http://127.0.0.1:${address.port}`,
          apiKey: "synthetic-key",
          mappings: [{ from: "/tv", to: f.src.root_path }],
        },
      });
      await received;
      const response = await app.inject(
        change === "removed"
          ? { method: "DELETE", url: `/api/sources/${f.src.id}`, headers }
          : {
              method: "PATCH",
              url: `/api/sources/${f.src.id}`,
              headers,
              payload: {
                revision: sourceDetails(f.store, f.src.id).revision,
                resetConfirmed: true,
                root: join(f.root, "other"),
              },
            },
      );
      assert.equal(
        response.statusCode,
        change === "removed" ? 204 : 200,
        response.body,
      );
      release();
      const imported = await pending;
      assert.equal(
        imported.statusCode,
        change === "removed" ? 404 : 409,
        imported.body,
      );
      assert.equal(
        f.store.db
          .prepare("SELECT count(*) AS n FROM integration_metadata")
          .get()!.n,
        0,
      );
      assert.equal(
        await readFile(join(f.root, "videos", "file.mp4"), "utf8"),
        "synthetic original",
      );
    },
  );
