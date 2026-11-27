import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, createHash } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { Store } from "../src/database.js";
import { PathResolver } from "../src/path-resolver.js";
import { DomainError } from "../src/domain.js";
import { createServer } from "../src/server.js";
import { account, source } from "./helpers.js";
import { digest } from "../src/security.js";

async function fixture(t: { after: (fn: () => unknown) => void }) {
  const root = await fs.realpath(
      await fs.mkdtemp(join(tmpdir(), "mytuner-directory-check-")),
    ),
    store = new Store(":memory:");
  t.after(async () => {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const media = join(root, "media"),
    data = join(root, "data");
  await fs.mkdir(media);
  await fs.mkdir(data);
  return {
    root,
    store,
    media,
    data,
    resolver: new PathResolver(store, [data]),
  };
}
const request = (path: string, recursive = true) => ({
  path,
  purpose: "source" as const,
  recursive,
});
async function tree(root: string): Promise<unknown[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }),
    result: unknown[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) {
      result.push([
        entry.name,
        "link",
        await fs.readlink(join(root, entry.name)),
      ]);
      continue;
    }
    result.push([
      entry.name,
      entry.isDirectory()
        ? await tree(join(root, entry.name))
        : createHash("sha256")
            .update(await fs.readFile(join(root, entry.name)))
            .digest("hex"),
    ]);
  }
  return result;
}

test("directory checks sample only supported names, skip links/hidden entries and never modify files or SQLite", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(join(f.media, "nested"));
  await fs.mkdir(join(f.media, ".hidden"));
  await fs.writeFile(
    join(f.media, "Video.MP4"),
    "synthetic video bytes, no probe",
  );
  await fs.writeFile(join(f.media, "private-password.txt"), "never returned");
  await fs.writeFile(join(f.media, "nested", "Episode.mkv"), "synthetic");
  await fs.writeFile(join(f.media, ".hidden", "hidden.mp4"), "hidden");
  await fs.mkdir(join(f.root, "outside"));
  await fs.writeFile(join(f.root, "outside", "escape.mp4"), "outside");
  await fs.symlink(join(f.root, "outside"), join(f.media, "linked"));
  const before = await tree(f.root),
    changes = f.store.db.prepare("SELECT total_changes() AS n").get()!.n;
  const result = await f.resolver.check(request(f.media), () => {});
  assert.equal(result.status, "found");
  assert.equal(result.readableDirectory, true);
  assert.equal(result.complete, true);
  assert.deepEqual(result.samples.sort(), ["Video.MP4", "nested/Episode.mkv"]);
  assert.deepEqual(result.extensions, { ".mp4": 1, ".mkv": 1 });
  assert.equal(result.canonicalPath, await fs.realpath(f.media));
  assert.doesNotMatch(
    JSON.stringify(result),
    /private-password|escape.mp4|hidden.mp4|never returned/,
  );
  assert.match(result.message, /Playback has not been inspected/);
  assert.deepEqual(await tree(f.root), before);
  assert.equal(
    f.store.db.prepare("SELECT total_changes() AS n").get()!.n,
    changes,
  );
});

test("shallow, depth-limited, entry-limited and useful-sample checks report their actual checked area", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(join(f.media, "one", "two", "three"), { recursive: true });
  await fs.writeFile(join(f.media, "one", "two", "three", "deep.mp4"), "deep");
  const shallow = await f.resolver.check(request(f.media, false), () => {});
  assert.equal(shallow.status, "empty");
  assert.equal(shallow.complete, true);
  assert.match(shallow.message, /checked area/);
  const deep = await f.resolver.check(request(f.media, true), () => {});
  assert.equal(deep.status, "incomplete");
  assert.equal(deep.reason, "depth-limit");
  assert.equal(deep.samples.length, 0);
  for (let n = 0; n < 6; n++)
    await fs.writeFile(join(f.media, `clip-${n}.mp4`), "small");
  const found = await f.resolver.check(request(f.media, false), () => {});
  assert.equal(found.samples.length, 5);
  assert.equal(found.reason, "sample-limit");
  assert.equal(found.complete, false);
  const bounded = new PathResolver(f.store, [f.data], {
    entries: 2,
    directories: 32,
    samples: 5,
    milliseconds: 2000,
  });
  const limited = await bounded.check(request(f.media, false), () => {});
  assert.equal(limited.examinedEntries, 2);
  assert.equal(limited.complete, false);
  assert.equal(limited.reason, "entry-limit");
});

test("missing, file, linked, storage and overlapping-source paths stay distinct; own metadata/caption roots work", async (t) => {
  const f = await fixture(t),
    own = source(f.store, f.media),
    otherRoot = join(f.root, "other");
  await fs.mkdir(otherRoot);
  source(f.store, otherRoot);
  assert.equal(
    (await f.resolver.check(request(join(f.root, "missing")), () => {})).status,
    "missing",
  );
  await fs.writeFile(join(f.root, "file.mp4"), "file");
  assert.equal(
    (await f.resolver.check(request(join(f.root, "file.mp4")), () => {}))
      .status,
    "not-directory",
  );
  await fs.symlink(f.media, join(f.root, "link"));
  assert.equal(
    (await f.resolver.check(request(join(f.root, "link")), () => {})).reason,
    "link",
  );
  assert.equal(
    (await f.resolver.check(request(f.data), () => {})).reason,
    "application-storage",
  );
  assert.equal(
    (await f.resolver.check(request(otherRoot), () => {})).reason,
    "source-overlap",
  );
  assert.equal(
    (await f.resolver.check(request("/etc"), () => {})).status,
    "invalid",
  );
  await fs.writeFile(join(f.media, "movie.nfo"), "not parsed");
  await fs.writeFile(join(f.media, "caption.srt"), "not parsed");
  const metadata = await f.resolver.check(
    { path: "", purpose: "metadata", sourceId: own.id, recursive: false },
    () => {},
  );
  assert.deepEqual(metadata.samples, ["movie.nfo"]);
  const captions = await f.resolver.check(
    { path: f.media, purpose: "subtitles", sourceId: own.id, recursive: false },
    () => {},
  );
  assert.deepEqual(captions.samples, ["caption.srt"]);
  assert.equal(
    (
      await f.resolver.check(
        {
          path: otherRoot,
          purpose: "subtitles",
          sourceId: own.id,
          recursive: false,
        },
        () => {},
      )
    ).reason,
    "source-overlap",
  );
  assert.equal(
    (
      await f.resolver.check(
        {
          path: otherRoot,
          purpose: "metadata",
          sourceId: own.id,
          recursive: false,
        },
        () => {},
      )
    ).status,
    "empty",
  );
});

test("permission failures are reported without leaking unsupported names or transport errors", async (t) => {
  const f = await fixture(t),
    resolver = new PathResolver(f.store, [], undefined, {
      ...fs,
      access: (async () => {
        throw Object.assign(Error("secret-system-detail"), { code: "EACCES" });
      }) as typeof fs.access,
    });
  const result = await resolver.check(request(f.media), () => {});
  assert.equal(result.status, "inaccessible");
  assert.equal(result.exists, true);
  assert.equal(result.readableDirectory, false);
  assert.equal(result.reason, "permission");
  assert.deepEqual(result.samples, []);
  assert.doesNotMatch(JSON.stringify(result), /secret-system-detail/);
});

test("timed out checks retain admission until the underlying filesystem operation settles", async (t) => {
  const f = await fixture(t);
  let release!: (path: string) => void, entered!: () => void;
  const blocked = new Promise<string>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  let once = true;
  const resolver = new PathResolver(
    f.store,
    [],
    { entries: 256, directories: 32, samples: 5, milliseconds: 20 },
    {
      ...fs,
      realpath: async (path) => {
        if (once) {
          once = false;
          entered();
          return blocked;
        }
        return fs.realpath(path);
      },
    },
  );
  const checking = resolver.check(request(f.media), () => {});
  await started;
  const timeout = await checking;
  assert.equal(timeout.reason, "time-limit");
  assert.equal(timeout.complete, false);
  await assert.rejects(
    resolver.check(request(f.media), () => {}),
    /still finishing/,
  );
  release(await fs.realpath(f.media));
  await setImmediate();
  assert.equal(
    (await resolver.check(request(f.media), () => {})).status,
    "empty",
  );
  await resolver.stop();
});

test("client cancellation and late authority revocation stop before listing another directory", async (t) => {
  const f = await fixture(t);
  let release!: (path: string) => void,
    entered!: () => void,
    listings = 0;
  const blocked = new Promise<string>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  const resolver = new PathResolver(f.store, [], undefined, {
    ...fs,
    realpath: async () => {
      entered();
      return blocked;
    },
    opendir: (async (...args: Parameters<typeof fs.opendir>) => {
      listings++;
      return fs.opendir(...args);
    }) as typeof fs.opendir,
  });
  let allowed = true;
  const checking = resolver.check(request(f.media), () => {
    if (!allowed) throw new DomainError(403, "Administrator access required");
  });
  await started;
  allowed = false;
  release(await fs.realpath(f.media));
  await assert.rejects(checking, /Administrator/);
  assert.equal(listings, 0);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    f.resolver.check(request(f.media), () => {}, controller.signal),
    { name: "AbortError" },
  );
});

test("directory-check HTTP route enforces admin and browser CSRF and preserves drafts as read-only input", async (t) => {
  const f = await fixture(t),
    admin = account(f.store, "admin"),
    viewer = account(f.store, "viewer"),
    token = randomBytes(32).toString("base64url"),
    viewerToken = randomBytes(32).toString("base64url");
  f.store.db
    .prepare(
      "INSERT INTO sessions(token_hash,account_id,expires_at,kind,csrf_hash) VALUES(?,?,?,'browser',?)",
    )
    .run(digest(token), admin.id, Date.now() + 60000, digest("csrf"));
  f.store.db
    .prepare(
      "INSERT INTO sessions(token_hash,account_id,expires_at) VALUES(?,?,?)",
    )
    .run(digest(viewerToken), viewer.id, Date.now() + 60000);
  const app = createServer(f.store, {
    writableRoots: [f.data],
    generatedRoot: join(f.root, "generated"),
    cacheRoot: join(f.root, "cache"),
  });
  t.after(() => app.close());
  const url = "/api/admin/setup/check-directory",
    payload = request(f.media, false);
  assert.equal(
    (await app.inject({ method: "POST", url, payload })).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url,
        payload,
        headers: { authorization: `Bearer ${viewerToken}` },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url,
        payload,
        headers: { cookie: `mytuner_session=${token}` },
      })
    ).statusCode,
    403,
  );
  const result = await app.inject({
    method: "POST",
    url,
    payload,
    headers: { cookie: `mytuner_session=${token}`, "x-csrf-token": "csrf" },
  });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().status, "empty");
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM sources").get()!.n,
    0,
  );
  await app.close();
});

test("a timed-out directory open is closed before admission is released", async (t) => {
  const f = await fixture(t);
  let release!: () => void, opened!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    opened = resolve;
  });
  let handle: Awaited<ReturnType<typeof fs.opendir>> | undefined;
  const resolver = new PathResolver(
    f.store,
    [],
    { entries: 256, directories: 32, samples: 5, milliseconds: 20 },
    {
      ...fs,
      opendir: async (path) => {
        handle = await fs.opendir(path);
        opened();
        await held;
        return handle;
      },
    },
  );
  const pending = resolver.check(request(f.media), () => {});
  await entered;
  assert.equal((await pending).reason, "time-limit");
  await assert.rejects(
    resolver.check(request(f.media), () => {}),
    /still finishing/,
  );
  release();
  await resolver.stop();
  await assert.rejects(handle!.read(), { code: "ERR_DIR_CLOSED" });
});

test("client abort during entry sampling closes the directory and prevents another read", async (t) => {
  const f = await fixture(t),
    controller = new AbortController();
  await fs.writeFile(join(f.media, "one.mp4"), "one");
  await fs.writeFile(join(f.media, "two.mp4"), "two");
  let reads = 0,
    handle: Awaited<ReturnType<typeof fs.opendir>> | undefined;
  const resolver = new PathResolver(f.store, [], undefined, {
    ...fs,
    opendir: async (path) => {
      handle = await fs.opendir(path);
      const read = handle.read.bind(handle);
      Object.defineProperty(handle, "read", {
        value: async () => {
          reads++;
          const entry = await read();
          controller.abort();
          return entry;
        },
      });
      return handle;
    },
  });
  await assert.rejects(
    resolver.check(request(f.media), () => {}, controller.signal),
    { name: "AbortError" },
  );
  assert.equal(reads, 1);
  await assert.rejects(handle!.close(), { code: "ERR_DIR_CLOSED" });
});

test(
  "real directory read permissions are checked before sampling",
  { skip: process.getuid?.() === 0 || process.platform === "win32" },
  async (t) => {
    const f = await fixture(t);
    await fs.writeFile(join(f.media, "private.mp4"), "synthetic");
    await fs.chmod(f.media, 0o000);
    try {
      const result = await f.resolver.check(request(f.media), () => {});
      assert.equal(result.status, "inaccessible");
      assert.equal(result.reason, "permission");
      assert.deepEqual(result.samples, []);
      assert.equal(result.examinedDirectories, 0);
    } finally {
      await fs.chmod(f.media, 0o700);
    }
  },
);

test("directory-check shutdown is bounded and late held I/O cannot reauthorize against closed storage", async (t) => {
  const f = await fixture(t);
  let release!: (path: string) => void,
    entered!: () => void,
    stopped = false,
    lateAuthorizations = 0;
  const blocked = new Promise<string>((resolve) => {
      release = resolve;
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve;
    });
  const resolver = new PathResolver(
    f.store,
    [],
    { entries: 256, directories: 32, samples: 5, milliseconds: 100 },
    {
      ...fs,
      realpath: async () => {
        entered();
        return blocked;
      },
    },
  );
  const check = resolver.check(request(f.media), () => {
    if (stopped) {
      lateAuthorizations++;
      throw new Error("Storage already closed");
    }
  });
  const rejected = assert.rejects(check, { name: "AbortError" });
  try {
    await started;
    await resolver.stop(20);
    stopped = true;
    // Reject further callers even though the uncancellable syscall is held.
    await assert.rejects(
      resolver.check(request(f.media), () => {}),
      /stopping/,
    );
    release(f.media);
    await rejected;
    await setImmediate();
    assert.equal(lateAuthorizations, 0);
  } finally {
    release(f.media);
    await resolver.stop();
  }
});
