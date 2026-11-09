import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Store } from "../src/database.js";
import { ArtworkService } from "../src/artwork.js";
import { RefreshService } from "../src/refresh.js";
import { publicJson } from "../src/public-json.js";
import { source, media } from "./helpers.js";
test("artwork forwards keys only to the configured integration host and caches bounded images", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mytuner-art-")),
    store = new Store(":memory:");
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const key = randomBytes(32),
    src = source(store, "/movies", "movies"),
    item = media(store, src.id);
  new RefreshService(store, key).configure(src.id, {
    provider: "radarr",
    url: "http://localhost:7878/radarr",
    apiKey: "private-key",
    mappings: [{ from: "/remote", to: "/movies" }],
  });
  let calls = 0;
  const service = new ArtworkService(store, root, key, async (url, options) => {
    calls++;
    assert.equal(
      String(url),
      "http://localhost:7878/radarr/MediaCover/1/poster.jpg",
    );
    assert.deepEqual(options?.headers, { "X-Api-Key": "private-key" });
    assert.equal(options?.redirect, "error");
    return new Response(new Uint8Array([255, 216, 255]), {
      headers: { "content-type": "image/jpeg" },
    });
  });
  item.metadata_json = JSON.stringify({
    images: [
      {
        coverType: "poster",
        url: "/radarr/MediaCover/1/poster.jpg?apikey=never-expose",
      },
    ],
  });
  await service.get(item, 0);
  await service.get(item, 0);
  assert.equal(calls, 1);
  item.metadata_json = JSON.stringify({
    images: [{ url: "http://evil.example/MediaCover/1.jpg" }],
  });
  await assert.rejects(service.get(item, 0), /unavailable/);
  assert.equal(calls, 1);
});
test("public JSON normalizes database casing and replaces upstream artwork URLs with authorized routes", () => {
  const result = publicJson(
    {
      id: "media-id",
      source_id: "source-id",
      metadata_json: JSON.stringify({
        images: [{ coverType: "poster", url: "http://host/?apikey=secret" }],
      }),
      password_hash: "private",
    },
    "profile-id",
  ) as { sourceId: string; metadata: { images: { url: string }[] } };
  assert.equal(result.sourceId, "source-id");
  assert.equal(
    result.metadata.images[0]?.url,
    "/api/profiles/profile-id/media/media-id/artwork/0",
  );
  assert.doesNotMatch(JSON.stringify(result), /secret|private|source_id/);
});
