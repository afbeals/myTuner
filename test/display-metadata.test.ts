import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  realpath,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/database.js";
import { account, profile, source, media } from "./helpers.js";
import {
  inspectMetadata,
  inspectAuthorizedMetadata,
  saveMetadata,
  checkMetadataFiles,
  displayMedia,
} from "../src/display-metadata.js";
import type { MetadataTarget } from "../src/display-metadata.js";
import { showKey, browseLibrary, selectMedia } from "../src/library.js";
import { importMetadata } from "../src/integrations.js";
import { scanSource } from "../src/catalog.js";
import { validateStorage } from "../src/storage.js";
import { backupDatabase } from "../src/backup.js";
import { DatabaseSync } from "node:sqlite";

async function fixture(
  t: import("node:test").TestContext,
  kind: "shows" | "movies" | "videos" = "videos",
) {
  const root = await realpath(
      await mkdtemp(join(tmpdir(), "mytuner-display-")),
    ),
    store = new Store(":memory:"),
    owner = account(store, "admin"),
    p = profile(store, owner),
    src = source(store, join(root, "media"), kind);
  await mkdir(src.root_path);
  const item = media(
    store,
    src.id,
    kind === "shows" ? "Show/Season 01/Show.S01E01.mp4" : "video.mp4",
  );
  await mkdir(join(src.root_path, kind === "shows" ? "Show/Season 01" : "."), {
    recursive: true,
  });
  await writeFile(
    join(src.root_path, item.relative_path),
    "synthetic video bytes",
  );
  const target: MetadataTarget = { kind: "media", mediaId: item.id };
  t.after(async () => {
    if (store.db.isOpen) store.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, store, owner, p, src, item, target };
}
const manual = (title: string, description = "") => ({
  title: { source: "manual" as const, manual: title },
  description: { source: "manual" as const, manual: description },
});

test("display overrides are independent from identity/order and persist in a database snapshot", async (t) => {
  const f = await fixture(t, "shows");
  f.store.db.prepare("UPDATE media SET metadata_json=? WHERE id=?").run(
    JSON.stringify({
      seriesTitle: "Show",
      seasonNumber: 1,
      episodeNumber: 1,
    }),
    f.item.id,
  );
  const raw = f.store.db
    .prepare("SELECT * FROM media WHERE id=?")
    .get(f.item.id) as unknown as typeof f.item;
  const key = showKey(raw),
    before = inspectMetadata(f.store, f.target);
  await saveMetadata(
    f.store,
    f.owner,
    f.p,
    f.target,
    before.revision,
    manual("Custom episode", ""),
  );
  assert.equal(displayMedia(f.store, raw).title, "Custom episode");
  assert.equal(
    JSON.parse(displayMedia(f.store, raw).metadata_json).overview,
    "",
  );
  assert.equal(showKey(raw), key);
  assert.deepEqual(
    selectMedia(f.store, f.owner, f.p, {
      type: "show",
      sourceId: f.src.id,
      key,
      includeSpecials: false,
    }).map((i) => i.id),
    [f.item.id],
  );
  assert.equal(
    f.store.db.prepare("SELECT title FROM media WHERE id=?").get(f.item.id)!
      .title,
    f.item.title,
  );
  const path = await backupDatabase(f.store, join(f.root, "backups"));
  const db = new DatabaseSync(path, { readOnly: true });
  assert.match(
    String(
      db.prepare("SELECT state_json FROM display_metadata").get()!.state_json,
    ),
    /Custom episode/,
  );
  db.close();
  assert.equal(
    await readFile(join(f.src.root_path, f.item.relative_path), "utf8"),
    "synthetic video bytes",
  );
});

test("manual text survives integration refresh and resetting Automatic retains the manual draft", async (t) => {
  const f = await fixture(t, "movies");
  const imported = (title: string) =>
    importMetadata(
      f.store,
      f.src,
      [
        {
          provider: "radarr",
          externalId: "1",
          path: join(f.src.root_path, f.item.relative_path),
          title,
          metadata: {
            movieId: 1,
            overview: "Provider plot",
            displayCandidate: { title, description: "Provider plot" },
          },
        },
      ],
      [{ from: f.src.root_path, to: f.src.root_path }],
    );
  imported("Provider one");
  let view = inspectMetadata(f.store, f.target);
  assert.equal(view.effective.title.value, "Provider one");
  await saveMetadata(
    f.store,
    f.owner,
    f.p,
    f.target,
    view.revision,
    manual("Custom", ""),
  );
  imported("Provider two");
  view = inspectMetadata(f.store, f.target);
  assert.equal(view.effective.title.value, "Custom");
  assert.equal(view.effective.description.value, "");
  await saveMetadata(f.store, f.owner, f.p, f.target, view.revision, {
    ...view.choices,
    title: { source: "automatic", manual: "Custom" },
  });
  view = inspectMetadata(f.store, f.target);
  assert.equal(view.effective.title.value, "Provider two");
  assert.equal(view.choices.title.manual, "Custom");
  assert.equal(view.candidates.integration.status, "stale");
});

test("a second editor and a provider refresh conflict rather than replacing a manual draft", async (t) => {
  const f = await fixture(t),
    old = inspectMetadata(f.store, f.target);
  await saveMetadata(
    f.store,
    f.owner,
    f.p,
    f.target,
    old.revision,
    manual("First"),
  );
  await assert.rejects(
    saveMetadata(
      f.store,
      f.owner,
      f.p,
      f.target,
      old.revision,
      manual("Second"),
    ),
    /changed elsewhere/,
  );
  assert.equal(
    inspectMetadata(f.store, f.target).effective.title.value,
    "First",
  );
  const current = inspectMetadata(f.store, f.target);
  f.store.db
    .prepare("UPDATE media SET metadata_json=? WHERE id=?")
    .run(
      JSON.stringify({ local: { title: "Local" }, localNfoValid: true }),
      f.item.id,
    );
  await assert.rejects(
    saveMetadata(
      f.store,
      f.owner,
      f.p,
      f.target,
      current.revision,
      manual("Third"),
    ),
    /changed elsewhere/,
  );
});

test("explicit NFO check previews only, validates its fingerprint on Save and preserves read-only bytes", async (t) => {
  const f = await fixture(t),
    path = join(f.src.root_path, "video.nfo"),
    xml = "<movie><title>Local title</title><plot>Local plot</plot></movie>";
  await writeFile(path, xml);
  const view = inspectMetadata(f.store, f.target),
    check = await checkMetadataFiles(f.store, f.owner, f.p, f.target);
  assert.equal(check.values.title, "Local title");
  assert.equal(inspectMetadata(f.store, f.target).revision, view.revision);
  const choices = {
    title: { source: "local" as const },
    description: { source: "local" as const },
  };
  const saved = await saveMetadata(
    f.store,
    f.owner,
    f.p,
    f.target,
    view.revision,
    choices,
    check.fingerprint,
  );
  assert.equal(saved.effective.description.value, "Local plot");
  assert.equal(await readFile(path, "utf8"), xml);
  await writeFile(path, xml.replace("Local title", "Changed"));
  await assert.rejects(
    saveMetadata(
      f.store,
      f.owner,
      f.p,
      f.target,
      saved.revision,
      choices,
      check.fingerprint,
    ),
    /file changed/,
  );
  assert.equal(
    inspectMetadata(f.store, f.target).effective.title.value,
    "Local title",
  );
});

test("show NFO and mirrored roots change presentation without renaming the selected show", async (t) => {
  const f = await fixture(t, "shows"),
    meta = join(f.root, "metadata");
  await mkdir(join(meta, "Show"), { recursive: true });
  await writeFile(
    join(meta, "Show/tvshow.nfo"),
    "<tvshow><title>My show</title><plot>Show description</plot></tvshow>",
  );
  f.store.db.prepare("UPDATE media SET metadata_json=? WHERE id=?").run(
    JSON.stringify({
      seriesTitle: "Show",
      seasonNumber: 1,
      episodeNumber: 1,
    }),
    f.item.id,
  );
  f.store.db
    .prepare("UPDATE sources SET metadata_root=? WHERE id=?")
    .run(meta, f.src.id);
  const item = f.store.db
      .prepare("SELECT * FROM media WHERE id=?")
      .get(f.item.id) as unknown as typeof f.item,
    key = showKey(item),
    target: MetadataTarget = { kind: "show", sourceId: f.src.id, key };
  const view = inspectMetadata(f.store, target),
    checked = await checkMetadataFiles(f.store, f.owner, f.p, target);
  await saveMetadata(
    f.store,
    f.owner,
    f.p,
    target,
    view.revision,
    { title: { source: "local" }, description: { source: "local" } },
    checked.fingerprint,
  );
  const library = browseLibrary(f.store, f.owner, f.p, "My show");
  assert.equal(library.shows[0]!.title, "My show");
  assert.equal(library.shows[0]!.key, key);
  assert.equal(displayMedia(f.store, item).title, item.title);
  assert.equal(
    JSON.parse(displayMedia(f.store, item).metadata_json).seriesTitle,
    "My show",
  );
  await assert.rejects(
    validateStorage(
      f.store,
      [join(meta, "output")],
      join(f.root, "generated"),
      join(f.root, "cache"),
    ),
    /overlaps/,
  );
});

test("metadata permissions deny non-admin inspection, checks and saves", async (t) => {
  const f = await fixture(t),
    viewer = account(f.store, "editor"),
    p = profile(f.store, viewer);
  assert.throws(
    () => inspectAuthorizedMetadata(f.store, viewer, p, f.target),
    /Administrator/,
  );
  await assert.rejects(
    checkMetadataFiles(f.store, viewer, p, f.target),
    /Administrator/,
  );
  const view = inspectMetadata(f.store, f.target);
  await assert.rejects(
    saveMetadata(f.store, viewer, p, f.target, view.revision, manual("No")),
    /Administrator/,
  );
});

test("metadata XML rejects entities, oversized files and symlinks outside the read-only root", async (t) => {
  const f = await fixture(t),
    path = join(f.src.root_path, "video.nfo");
  await writeFile(
    path,
    '<!DOCTYPE movie [<!ENTITY test SYSTEM "file:///etc/passwd">]><movie><title>&test;</title></movie>',
  );
  assert.equal(
    (await checkMetadataFiles(f.store, f.owner, f.p, f.target)).status,
    "read-failed",
  );
  await writeFile(path, "x".repeat(256 * 1024 + 1));
  assert.equal(
    (await checkMetadataFiles(f.store, f.owner, f.p, f.target)).status,
    "read-failed",
  );
  await rm(path);
  const outside = join(f.root, "outside.nfo");
  await writeFile(outside, "<movie><title>Hidden</title></movie>");
  await symlink(outside, path);
  const check = await checkMetadataFiles(f.store, f.owner, f.p, f.target);
  assert.equal(check.status, "read-failed");
  assert.equal(check.values.title, undefined);
});

test("ambiguous local replacements do not inherit custom information silently", async (t) => {
  const f = await fixture(t),
    before = inspectMetadata(f.store, f.target);
  await saveMetadata(
    f.store,
    f.owner,
    f.p,
    f.target,
    before.revision,
    manual("Old movie"),
  );
  f.store.db.prepare("UPDATE media SET size=size+1 WHERE id=?").run(f.item.id);
  const next = inspectMetadata(f.store, f.target);
  assert.equal(next.requiresReview, true);
  assert.notEqual(next.effective.title.value, "Old movie");
});

test("ordinary source rescan preserves display overrides and NFO bytes", async (t) => {
  const f = await fixture(t),
    path = join(f.src.root_path, "video.nfo"),
    xml = "<movie><title>Scanned</title></movie>";
  await writeFile(path, xml);
  await scanSource(f.store, f.src, async () => 1000);
  let view = inspectMetadata(f.store, f.target);
  await saveMetadata(
    f.store,
    f.owner,
    f.p,
    f.target,
    view.revision,
    manual("Manual"),
  );
  await scanSource(f.store, f.src, async () => 1000);
  view = inspectMetadata(f.store, f.target);
  assert.equal(view.effective.title.value, "Manual");
  assert.equal(await readFile(path, "utf8"), xml);
});

test("failed metadata checks retain the last valid fields and mark them stale", async (t) => {
  const f = await fixture(t),
    path = join(f.src.root_path, "video.nfo");
  await writeFile(
    path,
    "<movie><title>Retained local</title><plot>Retained plot</plot></movie>",
  );
  let view = inspectMetadata(f.store, f.target);
  const checked = await checkMetadataFiles(f.store, f.owner, f.p, f.target);
  view = await saveMetadata(
    f.store,
    f.owner,
    f.p,
    f.target,
    view.revision,
    { title: { source: "local" }, description: { source: "local" } },
    checked.fingerprint,
  );
  await rm(path);
  view = await saveMetadata(
    f.store,
    f.owner,
    f.p,
    f.target,
    view.revision,
    view.choices,
    null,
  );
  assert.equal(view.effective.title.value, "Retained local");
  assert.equal(view.effective.title.status, "no-file");
  assert.equal(view.effective.description.value, "Retained plot");
  const location = join(f.root, "new-metadata");
  await mkdir(location);
  f.store.db
    .prepare("UPDATE sources SET metadata_root=? WHERE id=?")
    .run(location, f.src.id);
  assert.equal(
    inspectMetadata(f.store, f.target).effective.title.status,
    "stale-location",
  );
});

test("admin revocation during a pending file read prevents preview and save", async (t) => {
  const f = await fixture(t);
  await writeFile(
    join(f.src.root_path, "video.nfo"),
    "<movie><title>Private</title></movie>",
  );
  const view = inspectMetadata(f.store, f.target);
  const pending = checkMetadataFiles(f.store, f.owner, f.p, f.target);
  f.store.db
    .prepare("UPDATE accounts SET role='viewer' WHERE id=?")
    .run(f.owner.id);
  await assert.rejects(pending, /Administrator/);
  await assert.rejects(
    saveMetadata(
      f.store,
      f.owner,
      f.p,
      f.target,
      view.revision,
      manual("Denied"),
    ),
    /Administrator/,
  );
  assert.equal(
    f.store.db.prepare("SELECT count(*) n FROM display_metadata").get()!.n,
    0,
  );
});

test("accepting a replaced file cannot resurrect its previous local snapshot", async (t) => {
  const f = await fixture(t);
  await writeFile(
    join(f.src.root_path, "video.nfo"),
    "<movie><title>Old local</title></movie>",
  );
  let view = inspectMetadata(f.store, f.target);
  const check = await checkMetadataFiles(f.store, f.owner, f.p, f.target);
  await saveMetadata(
    f.store,
    f.owner,
    f.p,
    f.target,
    view.revision,
    { title: { source: "local" }, description: { source: "automatic" } },
    check.fingerprint,
  );
  f.store.db.prepare("UPDATE media SET size=size+1 WHERE id=?").run(f.item.id);
  view = inspectMetadata(f.store, f.target);
  view = await saveMetadata(
    f.store,
    f.owner,
    f.p,
    f.target,
    view.revision,
    view.choices,
  );
  assert.notEqual(view.effective.title.value, "Old local");
  assert.equal(
    f.store.db.prepare("SELECT local_json FROM display_metadata").get()!
      .local_json,
    null,
  );
});
