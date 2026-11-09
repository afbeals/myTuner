import { test, expect, type Page } from "@playwright/test";
import type { Programming, Source } from "../web/src/types";

test.use({ baseURL: "http://127.0.0.1:8786" });

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("designer");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("navigation")).toBeAttached();
  await page
    .getByLabel("Current profile")
    .selectOption({ label: "Living Room" });
  return page.getByLabel("Current profile").inputValue();
}
async function mutate(
  page: Page,
  path: string,
  method: string,
  body?: unknown,
) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const { csrfToken } = await (await fetch("/api/auth/csrf")).json();
      const response = await fetch(path, {
        method,
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          "X-CSRF-Token": csrfToken,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok)
        throw new Error(`${response.status}: ${await response.text()}`);
      return response.status === 204 ? null : response.json();
    },
    { path, method, body },
  );
}
async function fixture(page: Page) {
  const profileId = await login(page);
  const sources: Source[] = await page.evaluate(async () =>
    (await fetch("/api/sources")).json(),
  );
  const shows = sources.find((s) => s.kind === "shows")!;
  let ads = sources.find((s) => s.kind === "commercials");
  if (!ads) {
    ads = await mutate(page, "/api/sources", "POST", {
      name: "Synthetic commercials",
      kind: "commercials",
      recursive: true,
      root: shows.rootPath!.replace(/\/media$/, "/commercials"),
    });
    await mutate(page, `/api/sources/${ads!.id}/scan`, "POST", {});
    await mutate(page, `/api/profiles/${profileId}/grants`, "POST", {
      sourceId: ads!.id,
      subtree: "",
    });
  }
  const videos = await mutate(
    page,
    `/api/profiles/${profileId}/selection`,
    "POST",
    { type: "folder", sourceId: shows.id, directory: "", recursive: true },
  );
  return {
    profileId,
    shows,
    ads,
    videos: videos.items as { id: string; title: string }[],
  };
}

test("stored video details and routing inspection are read-only and fit desktop/narrow screens", async ({
  page,
}) => {
  await login(page);
  await page.route("**/media/*/subtitles", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: { ...data, checkedMs: 1794168000000 },
    });
  });
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await page
    .getByRole("article")
    .filter({
      has: page.getByRole("heading", { name: "Orbit Patrol", exact: true }),
    })
    .getByRole("button", { name: "Open details" })
    .click();
  await page
    .getByRole("button", { name: "Details for The Last Platform", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Video details",
    exact: true,
  });
  await expect(dialog).toContainText("Orbit.S01E01.mp4");
  await dialog.getByText("Stored technical metadata", { exact: true }).click();
  await expect(dialog.getByRole("table")).toContainText("aac");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1024 });
    await expect(dialog).toHaveScreenshot(`video-details-${width}.png`);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    }),
  );
  await dialog
    .getByRole("button", { name: "Copy relative filename", exact: true })
    .click();
  await expect(dialog).toContainText(
    "Select the relative filename above to copy it.",
  );
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    page.getByRole("button", {
      name: "Details for The Last Platform",
      exact: true,
    }),
  ).toBeFocused();
  let mutations = 0;
  page.on("request", (request) => {
    if (/\/api\/(generation|playback|admin\/scan)/.test(request.url()))
      mutations++;
  });
  await page.getByRole("button", { name: "Check playback readiness" }).click();
  const report = page.locator(".inspection-readiness");
  await expect(report).toContainText("2 direct · 0 conversion · 0 unknown");
  await expect(report).toContainText("does not certify");
  await expect(report).toHaveScreenshot("readiness-narrow.png");
  expect(mutations).toBe(0);
});

test("collection dependencies link to read-only channel details and survive reload/Back/Forward", async ({
  page,
}) => {
  const f = await fixture(page);
  const collection = await mutate(
    page,
    `/api/profiles/${f.profileId}/collections`,
    "POST",
    { name: "R6 dependency collection", mediaIds: [f.videos[0]!.id] },
  );
  const channel = await mutate(page, "/api/channels", "POST", {
    profileId: f.profileId,
    name: "R6 dependency channel",
    visibility: "private",
  });
  const config: Programming = {
    profileId: f.profileId,
    groups: [
      {
        id: "g",
        mode: "ordered",
        selection: { type: "collection", id: collection.id },
      },
    ],
    seed: 42,
    rules: {
      between: false,
      positions: [],
      maxClips: 0,
      maxDurationMs: 0,
      repeatAllowance: 1,
      maxPerBreak: 1,
      cooldownMs: 0,
    },
  };
  await mutate(page, `/api/channels/${channel.id}/programming`, "PUT", config);
  const collectionHash = `#library?profile=${f.profileId}&collection=${collection.id}`;
  await page.goto(`/${collectionHash}`);
  await expect(
    page.getByRole("dialog", { name: collection.name, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Delete collection", exact: true })
    .click();
  const impact = page.getByRole("dialog", {
    name: "Delete collection",
    exact: true,
  });
  await expect(impact).toContainText("Future programming");
  await impact.getByRole("link", { name: channel.name, exact: true }).click();
  await expect(
    page
      .locator(".channel-preview")
      .getByRole("heading", { name: channel.name, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".channel-preview")).toContainText(channel.name);
  await page.goBack();
  await expect(
    page.getByRole("dialog", { name: collection.name, exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(page.locator(".channel-preview")).toContainText(channel.name);
  const safeLink = await page
    .getByRole("link", { name: "Link to this channel" })
    .getAttribute("href");
  expect(safeLink).toBe(
    `#channels?profile=${f.profileId}&channel=${channel.id}`,
  );
  await mutate(page, `/api/channels/${channel.id}`, "PATCH", {
    archived: true,
  });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("unavailable");
  await page.goto(`/${collectionHash}`);
  await page
    .getByRole("button", { name: "Delete collection", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete saved collection", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("unavailable");
});

test("retiring every commercial is a draft change until preview/publication and can be re-enabled", async ({
  page,
}) => {
  const f = await fixture(page);
  const pool = {
    type: "folder" as const,
    sourceId: f.ads!.id,
    directory: "",
    recursive: true,
  };
  const channel = await mutate(page, "/api/channels", "POST", {
    profileId: f.profileId,
    name: "R6 commercial retirement",
    visibility: "private",
  });
  const config = {
    profileId: f.profileId,
    groups: [
      {
        id: "g",
        mode: "ordered",
        selection: { type: "media", ids: [f.videos[0]!.id] },
      },
    ],
    seed: 42,
    commercialSelection: pool,
    rules: {
      between: true,
      positions: [],
      maxClips: 1,
      maxDurationMs: 10000,
      repeatAllowance: 3,
      maxPerBreak: 1,
      cooldownMs: 0,
      overflowPolicy: "truncate",
      minRemainingMs: 6000,
    },
  };
  await mutate(page, `/api/channels/${channel.id}/programming`, "PUT", config);
  await page.goto(`/#channels?profile=${f.profileId}&channel=${channel.id}`);
  await page
    .locator(".channel-preview")
    .getByRole("button", { name: "Edit programming" })
    .click();
  await page.getByRole("button", { name: "Commercials", exact: true }).click();
  const eligibility = page.locator(".commercial-eligibility");
  await expect(eligibility.getByRole("checkbox")).toHaveCount(1);
  await eligibility.getByRole("checkbox").uncheck();
  await expect(page.getByRole("dialog")).toContainText("0 eligible of 1");
  let saved = await page.evaluate(
    async (id) =>
      (await (await fetch(`/api/channels/${id}/programming`)).json()).config,
    channel.id,
  );
  expect(saved.disabledCommercialIds ?? []).toEqual([]);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Generate two-hour preview" }).click();
  await expect(page.getByRole("dialog").getByRole("table")).toBeVisible();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("cell", { name: "commercial", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Publish programming", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Programming saved");
  saved = await page.evaluate(
    async (id) =>
      (await (await fetch(`/api/channels/${id}/programming`)).json()).config,
    channel.id,
  );
  expect(saved.disabledCommercialIds).toHaveLength(1);
  await page.getByRole("button", { name: "Commercials", exact: true }).click();
  await eligibility.getByRole("checkbox").check();
  await expect(page.getByRole("dialog")).toContainText("1 eligible of 1");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.evaluate(() => {
    location.hash = "library";
  });
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(eligibility.getByRole("checkbox")).toBeChecked();
});

test("a delayed direct-boundary descriptor cannot override a successful Pause", async ({
  page,
}) => {
  const now = Date.now(),
    id = "r6-session",
    mediaId = "r6-media";
  const stale = {
    id,
    profileId: "r6-profile",
    channelId: "r6-channel",
    revisionId: "r6-revision",
    positionMs: now + 950,
    paused: false,
    behindLiveMs: 0,
    available: true,
    playback: {
      entry: {
        id: "r6-entry",
        channelId: "r6-channel",
        mediaId,
        programId: "r6-program",
        startMs: now,
        endMs: now + 1000,
        offsetMs: 0,
        kind: "program",
      },
      offsetMs: 950,
    },
  };
  let release!: () => void,
    held = 0,
    hold = true,
    negotiations = 0;
  const gate = new Promise<void>((r) => (release = r));
  await page.addInitScript(() => {
    const state = new WeakMap<HTMLMediaElement, boolean>();
    Object.defineProperties(HTMLMediaElement.prototype, {
      paused: {
        get() {
          return state.get(this) !== false;
        },
        configurable: true,
      },
      readyState: {
        get() {
          return 4;
        },
        configurable: true,
      },
      src: {
        set() {
          queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
        },
        configurable: true,
      },
    });
    HTMLMediaElement.prototype.play = function () {
      state.set(this, false);
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      state.set(this, true);
    };
    HTMLMediaElement.prototype.load = function () {};
  });
  await page.route("**/api/playback/sessions", (r) =>
    r.fulfill({ json: stale }),
  );
  await page.route(`**/api/playback/sessions/${id}`, async (r) => {
    if (r.request().method() === "DELETE") return r.fulfill({ status: 204 });
    if (hold) {
      held++;
      await gate;
      return r.fulfill({ json: stale }).catch(() => {});
    }
    return r.fulfill({ json: { ...stale, paused: true } });
  });
  await page.route(`**/api/playback/sessions/${id}/pause`, (r) =>
    r.fulfill({ json: { ...stale, paused: true } }),
  );
  await page.route(`**/api/playback/sessions/${id}/negotiate`, (r) => {
    negotiations++;
    return r.fulfill({
      json: {
        mode: "direct",
        url: "/r6-synthetic.mp4",
        sourceOffsetMs: 950,
        intervalEndMs: now + 1000,
        tracks: [],
      },
    });
  });
  await page.route(`**/api/playback/sessions/${id}/events`, (r) =>
    r.fulfill({ json: { ok: true } }),
  );
  await page.route(`**/media/${mediaId}`, (r) =>
    r.fulfill({
      json: {
        id: mediaId,
        title: "R6 synthetic episode",
        durationMs: 1000,
        available: true,
        metadata: {},
      },
    }),
  );
  try {
    await login(page);
    await page.getByRole("link", { name: "Watch TV", exact: true }).click();
    await page
      .getByRole("button", { name: "Watch live", exact: true })
      .first()
      .click();
    await expect.poll(() => held).toBeGreaterThanOrEqual(2);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Resume", exact: true }),
    ).toBeVisible();
    const before = negotiations;
    hold = false;
    release();
    await page.waitForTimeout(1200);
    await expect(
      page.getByRole("button", { name: "Resume", exact: true }),
    ).toBeVisible();
    expect(negotiations).toBe(before);
    expect(
      await page
        .locator("video")
        .evaluate((video: HTMLVideoElement) => video.paused),
    ).toBe(true);
  } finally {
    hold = false;
    release();
  }
});

test("resource links continue through sign-in and profile PIN without tuning, and hide foreign-private details", async ({
  page,
}) => {
  const f = await fixture(page),
    name = "R6 shared linked detail",
    hiddenName = "R6 hidden linked detail";
  const channel = await mutate(page, "/api/channels", "POST", {
    profileId: f.profileId,
    name,
    visibility: "shared",
  });
  const hidden = await mutate(page, "/api/channels", "POST", {
    profileId: f.profileId,
    name: hiddenName,
    visibility: "private",
  });
  await mutate(page, `/api/profiles/${f.profileId}/pin`, "PUT", {
    pin: "1234",
  });
  await mutate(page, "/api/auth/logout", "POST");
  await page.goto(`/#channels?profile=${f.profileId}&channel=${channel.id}`);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  let joins = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/playback/sessions" &&
      request.method() === "POST"
    )
      joins++;
  });
  await page.getByLabel("Username", { exact: true }).fill("sam");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-viewer-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Unlock Living Room", exact: true }),
  ).toBeVisible();
  await page.getByLabel("TV PIN", { exact: true }).fill("1234");
  await page
    .getByRole("button", { name: "Unlock profile", exact: true })
    .click();
  await expect(page.locator(".channel-preview")).toContainText(name);
  expect(joins).toBe(0);
  await mutate(page, `/api/profiles/${f.profileId}/pin`, "PUT", { pin: null });
  await mutate(page, "/api/auth/logout", "POST");
  await page.goto(`/#channels?profile=${f.profileId}&channel=${hidden.id}`);
  await page.reload();
  await page.getByLabel("Username", { exact: true }).fill("sam");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-viewer-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("unavailable");
  await expect(page.getByRole("main")).not.toContainText(hiddenName);
  expect(joins).toBe(0);
});
