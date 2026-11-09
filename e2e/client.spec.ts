import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Playback, Source } from "../web/src/types";
async function login(
  page: Page,
  username = "designer",
  password = "synthetic-browser-password",
) {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("navigation", { includeHidden: true }),
  ).toBeAttached();
}
async function navigate(page: Page, hash: string) {
  await page.goto(`/#${hash}`);
  await expect(
    page.getByRole("navigation", { includeHidden: true }),
  ).toBeAttached();
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
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: response.status,
        data: response.status === 204 ? null : await response.json(),
      };
    },
    { path, method, body },
  );
}
async function proofChannel(page: Page, name: string) {
  await login(page);
  await page
    .getByLabel("Current profile")
    .selectOption({ label: "Living Room" });
  const profileId = await page.getByLabel("Current profile").inputValue();
  const sources: Source[] = await page.evaluate(async () =>
    (await fetch("/api/sources")).json(),
  );
  const selected = await mutate(
    page,
    `/api/profiles/${profileId}/selection`,
    "POST",
    {
      type: "folder",
      sourceId: sources.find((s) => s.kind === "shows")!.id,
      directory: "",
      recursive: true,
    },
  );
  const item = selected.data.items.find((i: { path: string }) =>
    i.path.endsWith("Orbit.S01E01.mp4"),
  );
  const created = await mutate(page, "/api/channels", "POST", {
    name,
    profileId,
    visibility: "private",
  });
  expect(created.status).toBe(201);
  const channelId = created.data.id;
  const config = {
    profileId,
    seed: 42,
    groups: [
      {
        id: "proof",
        mode: "ordered",
        selection: { type: "media", ids: [item.id] },
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
  };
  expect(
    (
      await mutate(
        page,
        `/api/channels/${channelId}/programming?horizonMs=60000`,
        "PUT",
        config,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await mutate(
        page,
        `/api/profiles/${profileId}/subscriptions/${channelId}`,
        "PUT",
        {},
      )
    ).status,
  ).toBe(204);
  return { channelId, profileId, config };
}
test("approved browser foundation: sign-in, desktop/compact/narrow layouts, keyboard and accessibility", async ({
  page,
}) => {
  const visualTime = new Date("2026-11-07T20:00:00-08:00");
  await page.clock.setFixedTime(visualTime);
  await page.route("**/api/profiles/*/guide*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    for (const channel of data.channels ?? []) {
      let start = visualTime.getTime();
      channel.entries = channel.entries
        .slice(0, 4)
        .map((entry: Record<string, number | string>, index: number) => {
          const next = {
            ...entry,
            title: index === 0 ? "The Last Platform" : "Maple Street",
            startMs: start,
            endMs: start + 1200000,
          };
          start += 1200000;
          return next;
        });
    }
    await route.fulfill({ response, json: data });
  });
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot("sign-in.png", { fullPage: true });
  await login(page);
  await page
    .getByLabel("Current profile")
    .selectOption({ label: "Living Room" });
  await expect(
    page.getByRole("button", { name: "After School", exact: true }),
  ).toBeVisible();
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1024 });
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`channels-${width}.png`, {
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1024 });
  await navigate(page, "library");
  await expect(
    page.getByRole("heading", { name: "Orbit Patrol", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("library-1440.png", { fullPage: true });
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.getByRole("link", { name: "Skip to content" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#library$/);
  await expect(page.getByRole("main")).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "Orbit Patrol", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe(
    "BODY",
  );
});
test("library whole-show selection → channel programming → preview/publish → subscription", async ({
  page,
}) => {
  await login(page);
  await page
    .getByLabel("Current profile")
    .selectOption({ label: "Living Room" });
  await navigate(page, "library");
  await page
    .getByRole("article")
    .filter({
      has: page.getByRole("heading", { name: "Orbit Patrol", exact: true }),
    })
    .getByRole("button", { name: "Open details" })
    .click();
  await expect(page.getByRole("dialog")).toContainText("The Last Platform");
  await page
    .getByRole("button", { name: "Use whole selection in a channel" })
    .click();
  await page.getByLabel("Channel name", { exact: true }).fill("POC rotation");
  await page.getByRole("button", { name: "Create & program" }).click();
  await expect(page.getByRole("dialog")).toContainText("Content group 1");
  await page.getByRole("button", { name: "Commercials", exact: true }).click();
  const overflow = page.getByLabel(
      "When a commercial exceeds the remaining break",
    ),
    minimum = page.getByLabel(
      "Minimum remaining time to start a commercial (seconds)",
    );
  await expect(overflow).toHaveValue("truncate");
  await expect(minimum).toHaveValue("6");
  await page.setViewportSize({ width: 1440, height: 1024 });
  await expect(page).toHaveScreenshot("commercial-rules-1440.png", {
    fullPage: true,
  });
  await overflow.selectOption("skip");
  await overflow.selectOption("truncate");
  await minimum.fill("6.007");
  await page.getByRole("button", { name: "Apply commercial rules" }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Generate two-hour preview" }).click();
  await expect(page.getByRole("dialog").getByRole("table")).toBeVisible();
  await page.getByRole("button", { name: "Publish programming" }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("status")
      .filter({ hasText: "Programming saved" }),
  ).toBeVisible();
  const saved = await page.evaluate(async () => {
    const channels = await (await fetch("/api/admin/channels")).json();
    const channel = channels.items.find(
      (c: { name: string }) => c.name === "POC rotation",
    );
    return (
      await (await fetch(`/api/channels/${channel.id}/programming`)).json()
    ).config;
  });
  expect(saved.rules.overflowPolicy).toBe("truncate");
  expect(saved.rules.minRemainingMs).toBe(6007);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Add to profile guide" }).click();
  await navigate(page, "watch");
  await expect(
    page.getByRole("article").filter({ hasText: "POC rotation" }),
  ).toContainText("Watch live");
});
test("real media playback, direct offsets, pause/resume/Go Live and session cleanup", async ({
  page,
}) => {
  await login(page);
  await page
    .getByLabel("Current profile")
    .selectOption({ label: "Living Room" });
  await navigate(page, "watch");
  await page
    .getByRole("article")
    .filter({ hasText: "After School" })
    .getByRole("button", { name: "Watch live" })
    .click();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeGreaterThan(0);
  await expect(
    page.getByRole("heading", { name: "Orbit Patrol", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  const position = await page
    .locator("video")
    .evaluate((v: HTMLVideoElement) => v.currentTime);
  await page.waitForTimeout(1200);
  expect(
    await page
      .locator("video")
      .evaluate((v: HTMLVideoElement) => v.currentTime),
  ).toBe(position);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => !v.paused),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Go Live", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Channel guide", exact: true })
    .first()
    .click();
  await expect(page.locator("video")).toHaveCount(0);
});
test("account/profile permissions, source scanning, pairing approval and generation preview", async ({
  page,
  request,
}) => {
  await login(page);
  await navigate(page, "accounts");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Username", { exact: true }).fill("new-person");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-account-password");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "new-person", exact: true }),
  ).toBeVisible();
  await navigate(page, "profiles");
  await page.getByRole("button", { name: "Create profile" }).click();
  await page.getByLabel("Profile name").fill("Den");
  await page.getByLabel("Profile type").selectOption("room");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create profile", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Den", exact: true }),
  ).toBeVisible();
  await navigate(page, "sources");
  await page.getByRole("button", { name: "Scan & refresh metadata" }).click();
  await expect(
    page.getByRole("heading", { name: "Last scan result" }),
  ).toBeVisible();
  await navigate(page, "connect-tv");
  const pair = await (
    await request.post("/api/auth/pairings", {
      data: { deviceName: "Synthetic TV" },
    })
  ).json();
  await page.getByLabel("TV connection code").fill(pair.userCode);
  await page.getByRole("button", { name: "Review TV", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Review TV approval" }),
  ).toContainText("Synthetic TV");
  await page.getByRole("button", { name: "Approve TV", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("TV approved");
  const approved = await (
    await request.post("/api/auth/pairings/poll", {
      data: { deviceCode: pair.deviceCode },
    })
  ).json();
  expect(approved.status).toBe("approved");
  const unauthorized = await request.get("/api/accounts", {
    headers: { Authorization: `Bearer ${approved.token}` },
  });
  expect(unauthorized.status()).toBe(403);
  await navigate(page, "generated");
  await page.getByRole("button", { name: "Preview scope" }).click();
  await expect(page.getByRole("dialog")).toContainText("2 files");
  await page.getByRole("button", { name: "Start generation" }).click();
  await expect(page.getByRole("dialog")).toContainText("Generation progress");
});
test("another account cannot enumerate private channels or edit an unassigned profile", async ({
  page,
}) => {
  await login(page, "sam", "synthetic-viewer-password");
  await expect(page.getByLabel("Current profile")).toContainText("Living Room");
  await expect(page.getByLabel("Current profile")).not.toContainText(
    "Other Profile",
  );
  await expect(page.getByRole("main")).not.toContainText(
    "Other private network",
  );
  const profiles = await page.evaluate(
    async () => await (await fetch("/api/profiles")).json(),
  );
  const result = await mutate(
    page,
    `/api/profiles/${profiles[0].id}/grants`,
    "POST",
    {},
  );
  expect(result.status).toBe(403);
  await navigate(page, "subscriptions");
  await expect(page.getByRole("main")).not.toContainText(
    "Other private network",
  );
});

test("collections select catalog references and channel labels allow optional overrides", async ({
  page,
}) => {
  await login(page);
  await page
    .getByLabel("Current profile")
    .selectOption({ label: "Living Room" });
  await navigate(page, "library");
  await page
    .getByRole("button", { name: "Create collection", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Collection name").fill("Weekend mix");
  await modal.getByRole("checkbox").nth(0).check();
  await modal.getByRole("checkbox").nth(1).check();
  await modal.getByRole("button", { name: "Save collection" }).click();
  await page.getByRole("button", { name: "Collections", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Weekend mix" }),
  ).toBeVisible();
  await navigate(page, "channels");
  await page.getByRole("button", { name: "Create channel" }).click();
  await page.getByLabel("Channel name", { exact: true }).fill("Movie Hour");
  await page.getByLabel("Short name (optional)").fill("Cinema");
  await page.getByRole("button", { name: "Create & program" }).click();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page
    .locator(".channel-preview")
    .getByRole("button", { name: "Edit details", exact: true })
    .click();
  await expect(page.getByLabel("Short name (optional)")).toHaveValue("Cinema");
  await page.getByLabel("Channel name", { exact: true }).fill("Film Night");
  await page.getByRole("button", { name: "Save channel details" }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    page.getByRole("button", { name: "Film Night", exact: true }),
  ).toBeVisible();
  const labels = await page.evaluate(
    async () => await (await fetch("/api/admin/channels")).json(),
  );
  expect(
    labels.items.find((c: { name: string }) => c.name === "Film Night")
      .shortName,
  ).toBe("Cinema");
});
test("alternate audio uses real authenticated HLS segments", async ({
  page,
}) => {
  await login(page);
  await page
    .getByLabel("Current profile")
    .selectOption({ label: "Living Room" });
  await navigate(page, "watch");
  await page
    .getByRole("article")
    .filter({ hasText: "After School" })
    .getByRole("button", { name: "Watch live" })
    .click();
  await expect(
    page
      .getByRole("combobox", { name: "Audio", exact: true })
      .locator("option[value='2']"),
  ).toBeAttached();
  const segment = page.waitForResponse(
    (r) =>
      r.url().includes("/hls/") &&
      r.url().includes(".ts?audioTrack=2") &&
      r.status() === 200,
    { timeout: 20000 },
  );
  await page
    .getByRole("combobox", { name: "Audio", exact: true })
    .selectOption("2");
  await segment;
  await expect(page.getByRole("main")).toContainText("Compatible HLS stream");
  await expect
    .poll(
      () =>
        page
          .locator("video")
          .evaluate((v: HTMLVideoElement) => !v.paused && v.readyState >= 2),
      { timeout: 20000 },
    )
    .toBe(true);
});

test("oversized commercial plays as bounded HLS and returns to the program source offset", async ({
  page,
}) => {
  test.setTimeout(60000);
  await login(page);
  await page
    .getByLabel("Current profile")
    .selectOption({ label: "Living Room" });
  const profileId = await page.getByLabel("Current profile").inputValue();
  const sources: Source[] = await page.evaluate(async () =>
    (await fetch("/api/sources")).json(),
  );
  const shows = sources.find((s) => s.kind === "shows")!;
  const added = await mutate(page, "/api/sources", "POST", {
    name: "Synthetic commercials",
    kind: "commercials",
    recursive: true,
    root: shows.rootPath!.replace(/\/media$/, "/commercials"),
  });
  expect(added.status).toBe(201);
  const adSource = added.data.id;
  expect(
    (await mutate(page, `/api/sources/${adSource}/scan`, "POST", {})).status,
  ).toBe(200);
  expect(
    (
      await mutate(page, `/api/profiles/${profileId}/grants`, "POST", {
        sourceId: adSource,
        subtree: "",
      })
    ).status,
  ).toBe(201);
  const selected = await mutate(
    page,
    `/api/profiles/${profileId}/selection`,
    "POST",
    { type: "folder", sourceId: shows.id, directory: "", recursive: true },
  );
  const show = selected.data.items.find((i: { path: string }) =>
    i.path.endsWith("Orbit.S01E01.mp4"),
  );
  const created = await mutate(page, "/api/channels", "POST", {
    name: "Cutoff proof",
    profileId,
    visibility: "private",
  });
  expect(created.status).toBe(201);
  const channelId = created.data.id;
  const published = await mutate(
    page,
    `/api/channels/${channelId}/programming?horizonMs=60000`,
    "PUT",
    {
      profileId,
      groups: [
        {
          id: "show",
          mode: "ordered",
          selection: { type: "media", ids: [show.id] },
        },
      ],
      commercialSelection: {
        type: "folder",
        sourceId: adSource,
        directory: "",
        recursive: true,
      },
      seed: 42,
      rules: {
        between: false,
        positions: [{ kind: "timestamp", value: 4000 }],
        maxClips: 1,
        maxDurationMs: 7000,
        overflowPolicy: "truncate",
        minRemainingMs: 6000,
        repeatAllowance: 1,
        maxPerBreak: 1,
        cooldownMs: 0,
      },
    },
  );
  expect(published.status).toBe(200);
  const ad = published.data.entries.find(
    (e: { kind: string }) => e.kind === "commercial",
  );
  expect(ad.endMs - ad.startMs).toBe(7000);
  expect(
    (
      await mutate(
        page,
        `/api/profiles/${profileId}/subscriptions/${channelId}`,
        "PUT",
        {},
      )
    ).status,
  ).toBe(204);
  await navigate(page, "watch");
  const joined = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/playback/sessions") &&
      r.request().method() === "POST" &&
      r.status() === 201,
  );
  await page
    .getByRole("article")
    .filter({ hasText: "Cutoff proof" })
    .getByRole("button", { name: "Watch live" })
    .click();
  const session: Playback = await (await joined).json();
  await expect(
    page.getByRole("heading", { name: "Synthetic-ad", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("main")).toContainText("Compatible HLS stream");
  await expect
    .poll(
      () =>
        page
          .locator("video")
          .evaluate((v: HTMLVideoElement) => !v.paused && v.readyState >= 2),
      { timeout: 5000 },
    )
    .toBe(true);
  await expect
    .poll(
      () =>
        page.locator("video").evaluate((v: HTMLVideoElement) => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const context = canvas.getContext("2d")!;
          context.drawImage(
            v,
            v.videoWidth / 2,
            v.videoHeight / 2,
            1,
            1,
            0,
            0,
            1,
            1,
          );
          const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
          return r! > 220 && g! > 110 && g! < 200 && b! < 35;
        }),
      { timeout: 5000 },
    )
    .toBe(true);
  const resumed = page.waitForResponse(
    async (r) => {
      if (
        !r.url().endsWith(`/api/playback/sessions/${session.id}`) ||
        r.request().method() !== "GET" ||
        !r.ok()
      )
        return false;
      const s: Playback = await r.json();
      return (
        s.playback?.entry.kind === "program" && s.playback.offsetMs >= 4000
      );
    },
    { timeout: 15000 },
  );
  const current: Playback = await (await resumed).json();
  expect(current.playback!.entry.offsetMs).toBe(4000);
  expect(current.playback!.entry.startMs).toBe(ad.endMs);
  await expect(
    page.getByRole("heading", {
      name: show.metadata.seriesTitle ?? show.title,
      exact: true,
    }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate(
          (v: HTMLVideoElement) =>
            !v.paused && v.currentTime >= 4 && v.readyState >= 2,
        ),
    )
    .toBe(true);
});

test("playback recovers a failed poll, retains delivery errors until retry, and preserves saved zero commercial limits", async ({
  page,
}) => {
  test.setTimeout(60000);
  await login(page);
  await page
    .getByLabel("Current profile")
    .selectOption({ label: "Living Room" });
  const profileId = await page.getByLabel("Current profile").inputValue();
  const sources: Source[] = await page.evaluate(async () =>
    (await fetch("/api/sources")).json(),
  );
  const selected = await mutate(
    page,
    `/api/profiles/${profileId}/selection`,
    "POST",
    {
      type: "folder",
      sourceId: sources.find((s) => s.kind === "shows")!.id,
      directory: "",
      recursive: true,
    },
  );
  const item = selected.data.items.find((i: { path: string }) =>
    i.path.endsWith("Orbit.S01E01.mp4"),
  );
  const channel = await mutate(page, "/api/channels", "POST", {
    name: "Recovery proof",
    profileId,
    visibility: "private",
  });
  const channelId = channel.data.id;
  const config = {
    profileId,
    groups: [
      {
        id: "show",
        mode: "ordered",
        selection: { type: "media", ids: [item.id] },
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
  expect(
    (
      await mutate(
        page,
        `/api/channels/${channelId}/programming?horizonMs=60000`,
        "PUT",
        config,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await mutate(
        page,
        `/api/profiles/${profileId}/subscriptions/${channelId}`,
        "PUT",
        {},
      )
    ).status,
  ).toBe(204);
  let failJoin = true;
  await page.route("**/api/playback/sessions", async (route) => {
    if (failJoin && route.request().method() === "POST") {
      failJoin = false;
      await route.fulfill({
        status: 503,
        json: { error: "Synthetic join outage" },
      });
    } else await route.continue();
  });
  await navigate(page, "watch");
  await page
    .getByRole("article")
    .filter({ hasText: "Recovery proof" })
    .getByRole("button", { name: "Watch live" })
    .click();
  await expect(page.getByRole("status")).toContainText("Synthetic join outage");
  const retriedJoin = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/playback/sessions") &&
      r.request().method() === "POST" &&
      r.status() === 201,
  );
  await page.getByRole("button", { name: "Retry playback" }).click();
  await retriedJoin;
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((v: HTMLVideoElement) => !v.paused && v.readyState >= 2),
    )
    .toBe(true);
  let failPoll = true;
  await page.route(/\/api\/playback\/sessions\/[^/]+$/, async (route) => {
    if (failPoll && route.request().method() === "GET") {
      failPoll = false;
      await route.fulfill({
        status: 503,
        json: { error: "Synthetic poll outage" },
      });
    } else await route.continue();
  });
  await expect(page.getByRole("status")).toContainText("Synthetic poll outage");
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((v: HTMLVideoElement) => !v.paused && v.readyState >= 2),
    )
    .toBe(true);
  await expect(
    page.getByRole("button", { name: "Retry playback" }),
  ).toHaveCount(0);
  let failDelivery = true;
  await page.route("**/negotiate", async (route) => {
    if (failDelivery) {
      failDelivery = false;
      await route.fulfill({
        status: 503,
        json: { error: "Synthetic delivery outage" },
      });
    } else await route.continue();
  });
  await page.locator("video").dispatchEvent("error");
  await expect(page.getByRole("status")).toContainText(
    "Synthetic delivery outage",
  );
  await page.waitForTimeout(2200);
  await expect(page.getByRole("status")).toContainText(
    "Synthetic delivery outage",
  );
  await page.getByRole("button", { name: "Retry playback" }).click();
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((v: HTMLVideoElement) => !v.paused && v.readyState >= 2),
    )
    .toBe(true);
  await expect(
    page.getByRole("button", { name: "Retry playback" }),
  ).toHaveCount(0);
  await navigate(page, "channels");
  const row = page.getByRole("row").filter({
    has: page.getByRole("button", { name: "Recovery proof", exact: true }),
  });
  await row
    .getByRole("button", { name: "Edit programming", exact: true })
    .click();
  await page.getByRole("button", { name: "Commercials", exact: true }).click();
  await expect(page.getByLabel("Maximum clips per break")).toHaveValue("0");
  await expect(page.getByLabel("Maximum break duration (seconds)")).toHaveValue(
    "0",
  );
  await page
    .getByLabel("When a commercial exceeds the remaining break")
    .selectOption("truncate");
  await page
    .getByLabel("Minimum remaining time to start a commercial (seconds)")
    .fill("5");
  await page.getByRole("button", { name: "Apply commercial rules" }).click();
  let releasePreview!: () => void, previewStarted!: () => void;
  const held = new Promise<void>((resolve) => {
    releasePreview = resolve;
  });
  const started = new Promise<void>((resolve) => {
    previewStarted = resolve;
  });
  await page.route(
    "**/programming/preview*",
    async (route) => {
      const response = await route.fetch();
      previewStarted();
      await held;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Generate two-hour preview" }).click();
  await started;
  await page.getByRole("button", { name: "Content", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Rotation", exact: true })
    .selectOption("shuffle");
  const stale = page.waitForResponse(
    (r) => r.url().includes("/programming/preview") && r.ok(),
  );
  releasePreview();
  await stale;
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("table")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Publish programming" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Generate two-hour preview" }).click();
  await expect(page.getByRole("dialog").getByRole("table")).toBeVisible();
  await page.getByRole("button", { name: "Publish programming" }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("status")
      .filter({ hasText: "Programming saved" }),
  ).toBeVisible();
  const saved = await page.evaluate(
    async (id) =>
      (await (await fetch(`/api/channels/${id}/programming`)).json()).config,
    channelId,
  );
  expect(saved.rules.maxClips).toBe(0);
  expect(saved.rules.maxDurationMs).toBe(0);
  expect(saved.rules.minRemainingMs).toBe(5000);
  expect(saved.groups[0].mode).toBe("shuffle");
});

test("failed controls reconcile the authoritative pause state, including a lost successful response", async ({
  page,
}) => {
  test.setTimeout(60000);
  await proofChannel(page, "Control proof");
  await navigate(page, "watch");
  const joined = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/playback/sessions") &&
      r.request().method() === "POST" &&
      r.status() === 201,
  );
  await page
    .getByRole("article")
    .filter({ hasText: "Control proof" })
    .getByRole("button", { name: "Watch live" })
    .click();
  const session: Playback = await (await joined).json();
  const playing = () =>
    page
      .locator("video")
      .evaluate((v: HTMLVideoElement) => !v.paused && v.readyState >= 2);
  const descriptor = () =>
    page.evaluate(
      async (id) => (await fetch(`/api/playback/sessions/${id}`)).json(),
      session.id,
    );
  await expect.poll(playing).toBe(true);
  let pauseMode: "reject" | "applyAndLose" | "pass" = "reject",
    negotiations = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/negotiate") && r.method() === "POST") negotiations++;
  });
  await page.route("**/api/playback/sessions/*/pause", async (route) => {
    if (pauseMode === "reject") {
      pauseMode = "pass";
      await route.fulfill({
        status: 503,
        json: { error: "Synthetic control outage" },
      });
    } else {
      const response = await route.fetch();
      if (pauseMode === "applyAndLose" && response.ok()) {
        pauseMode = "pass";
        await route.fulfill({
          status: 503,
          json: { error: "Synthetic lost control response" },
        });
      } else await route.fulfill({ response });
    }
  });
  const rejectedPause = page.waitForResponse(
    (r) => r.url().endsWith("/pause") && r.status() === 503,
  );
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await rejectedPause;
  await expect.poll(playing).toBe(true);
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeEnabled();
  const recovered = await descriptor();
  expect(recovered.paused).toBe(false);
  expect(recovered.playback.entry.id).toBe(session.playback!.entry.id);
  expect(recovered.id).toBe(session.id);
  pauseMode = "applyAndLose";
  const beforePaused = negotiations;
  const lostPause = page.waitForResponse(
    (r) => r.url().endsWith("/pause") && r.status() === 503,
  );
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await lostPause;
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeEnabled();
  expect((await descriptor()).paused).toBe(true);
  await page.waitForTimeout(1200);
  expect(
    await page.locator("video").evaluate((v: HTMLVideoElement) => v.paused),
  ).toBe(true);
  expect(negotiations).toBe(beforePaused);
  await page.route(
    "**/api/playback/sessions/*/resume",
    (route) =>
      route.fulfill({
        status: 503,
        json: { error: "Synthetic resume outage" },
      }),
    { times: 1 },
  );
  const rejectedResume = page.waitForResponse(
    (r) => r.url().endsWith("/resume") && r.status() === 503,
  );
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await rejectedResume;
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeEnabled();
  expect((await descriptor()).paused).toBe(true);
  expect(negotiations).toBe(beforePaused);
  let loseGoLive = true;
  await page.route("**/api/playback/sessions/*/goLive", async (route) => {
    const response = await route.fetch();
    if (loseGoLive && response.ok()) {
      loseGoLive = false;
      await route.fulfill({
        status: 503,
        json: { error: "Synthetic lost Go Live response" },
      });
    } else await route.fulfill({ response });
  });
  const lostGoLive = page.waitForResponse(
    (r) => r.url().endsWith("/goLive") && r.status() === 503,
  );
  await page.getByRole("button", { name: "Go Live", exact: true }).click();
  await lostGoLive;
  await expect.poll(playing).toBe(true);
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeEnabled();
  expect((await descriptor()).paused).toBe(false);
  expect((await descriptor()).id).toBe(session.id);
});

test("late publication success cannot mark a newer draft saved", async ({
  page,
}) => {
  test.setTimeout(60000);
  const { channelId } = await proofChannel(page, "Publication proof");
  // API fixture writes bypass the manager's refresh signal; remount its catalog.
  await navigate(page, "watch");
  await navigate(page, "channels");
  await page
    .getByRole("row")
    .filter({
      has: page.getByRole("button", { name: "Publication proof", exact: true }),
    })
    .getByRole("button", { name: "Edit programming", exact: true })
    .click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Generate two-hour preview" }).click();
  await expect(page.getByRole("dialog").getByRole("table")).toBeVisible();
  let release!: () => void,
    started!: () => void,
    hold = true;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route(
    `**/api/channels/${channelId}/programming`,
    async (route) => {
      const response = await route.fetch();
      if (hold && route.request().method() === "PUT" && response.ok()) {
        hold = false;
        started();
        await held;
      }
      await route.fulfill({ response });
    },
  );
  try {
    await page.getByRole("button", { name: "Publish programming" }).click();
    await pending;
    await page.getByRole("button", { name: "Content", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Rotation", exact: true })
      .selectOption("shuffle");
    const finished = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/channels/${channelId}/programming`) &&
        r.request().method() === "PUT" &&
        r.ok(),
    );
    release();
    await finished;
    await expect(
      page.getByRole("button", { name: "Publish programming" }),
    ).toBeDisabled();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("status")
        .filter({ hasText: "Programming saved" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("combobox", { name: "Rotation", exact: true }),
    ).toHaveValue("shuffle");
    expect(
      await page.evaluate(
        async (id) =>
          (await (await fetch(`/api/channels/${id}/programming`)).json()).config
            .groups[0].mode,
        channelId,
      ),
    ).toBe("ordered");
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await page
      .getByRole("button", { name: "Generate two-hour preview" })
      .click();
    await expect(page.getByRole("dialog").getByRole("table")).toBeVisible();
    await page.getByRole("button", { name: "Publish programming" }).click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("status")
        .filter({ hasText: "Programming saved" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        async (id) =>
          (await (await fetch(`/api/channels/${id}/programming`)).json()).config
            .groups[0].mode,
        channelId,
      ),
    ).toBe("shuffle");
  } finally {
    release();
  }
});

test("library filename search finds the containing show and retains whole-show selection", async ({
  page,
}) => {
  await login(page);
  await page
    .getByLabel("Current profile")
    .selectOption({ label: "Living Room" });
  await navigate(page, "library");
  await page
    .getByRole("textbox", { name: "Search", exact: true })
    .fill("Orbit.S01E01.mp4");
  const show = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: /^Orbit(?: Patrol)?$/ }),
  });
  await expect(show).toBeVisible();
  await show.getByRole("button", { name: "Open details" }).click();
  await expect(
    page.getByRole("dialog").getByRole("checkbox", { name: /^Select / }),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("textbox", { name: "Search", exact: true })
    .fill("nonexistent-file-unique.mp4");
  await expect(
    page.getByRole("heading", { name: "No titles found" }),
  ).toBeVisible();
});

test("browser fullscreen retains active captions, playback controls and exit behavior", async ({
  page,
}) => {
  await page.route("**/api/playback/sessions/*/negotiate", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.tracks.push({
      index: 92,
      type: "subtitle",
      codec: "webvtt",
      title: "Synthetic fullscreen captions",
      url: "/api/review-caption.vtt",
    });
    await route.fulfill({ response, json: data });
  });
  await page.route("**/api/review-caption.vtt", (route) =>
    route.fulfill({
      contentType: "text/vtt",
      body: "WEBVTT\n\n00:00:00.000 --> 01:00:00.000\nSynthetic fullscreen caption\n",
    }),
  );
  await proofChannel(page, "Fullscreen caption proof");
  await navigate(page, "watch");
  await page
    .getByRole("article")
    .filter({ hasText: "Fullscreen caption proof" })
    .getByRole("button", { name: "Watch live" })
    .click();
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0),
    )
    .toBe(true);
  await page.getByRole("combobox", { name: /^Subtitles/ }).selectOption("92");
  await expect(page.locator(".subtitle-cue")).toHaveText(
    "Synthetic fullscreen caption",
  );
  await page.getByRole("button", { name: "Full screen", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.fullscreenElement?.classList.contains("video-stage"),
      ),
    )
    .toBe(true);
  expect(
    await page
      .locator(".subtitle-cue")
      .evaluate((el) => document.fullscreenElement?.contains(el)),
  ).toBe(true);
  await expect(page.locator(".subtitle-cue")).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => document.exitFullscreen());
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => !v.paused),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "Channel guide", exact: true })
    .first()
    .click();
});

test("delayed account choices cannot silently clear a room profile owner on save", async ({
  page,
}) => {
  await login(page);
  const profiles = await page.evaluate(
    async () => await (await fetch("/api/profiles")).json(),
  );
  const original = profiles.find(
    (p: { name: string }) => p.name === "Living Room",
  );
  expect(original.ownerAccountId).toBeTruthy();
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/accounts", async (route) => {
    await held;
    await route.continue();
  });
  try {
    await navigate(page, "profiles");
    await page
      .getByRole("button", { name: "Manage Living Room", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Save profile", exact: true }),
    ).toHaveCount(0);
    release();
    await expect(page.getByRole("combobox", { name: /^Owner/ })).toHaveValue(
      original.ownerAccountId,
    );
    await page
      .getByRole("textbox", { name: "Profile name", exact: true })
      .fill("Living Room renamed");
    await page
      .getByRole("button", { name: "Save profile", exact: true })
      .click();
    await expect
      .poll(async () =>
        page.evaluate(async (id) => {
          const rows = await (await fetch("/api/profiles")).json();
          return rows.find((p: { id: string }) => p.id === id);
        }, original.id),
      )
      .toMatchObject({
        name: "Living Room renamed",
        ownerAccountId: original.ownerAccountId,
      });
  } finally {
    release();
    await mutate(page, `/api/profiles/${original.id}`, "PATCH", {
      name: original.name,
      ownerAccountId: original.ownerAccountId,
    });
  }
});

test("reopening a renamed channel editor retains saved name visibility and short name", async ({
  page,
}) => {
  const { channelId } = await proofChannel(page, "Saved identity proof");
  await navigate(page, "library");
  await navigate(page, "channels");
  await page
    .getByRole("row")
    .filter({
      has: page.getByRole("button", {
        name: "Saved identity proof",
        exact: true,
      }),
    })
    .getByRole("button", { name: "Edit details", exact: true })
    .click();
  await page
    .getByLabel("Channel name", { exact: true })
    .fill("Saved identity renamed");
  await page.getByLabel("Short name (optional)").fill("SAVED");
  await page
    .getByRole("combobox", { name: "Visibility", exact: true })
    .selectOption("shared");
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/channels/${channelId}`) &&
      r.request().method() === "PATCH" &&
      r.ok(),
  );
  await page.getByRole("button", { name: "Save channel details" }).click();
  await saved;
  await expect(page.locator(".channel-preview h2")).toHaveText(
    "Saved identity renamed",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page
    .locator(".channel-preview")
    .getByRole("button", { name: "Edit details", exact: true })
    .click();
  await expect(page.getByLabel("Channel name", { exact: true })).toHaveValue(
    "Saved identity renamed",
  );
  await expect(page.getByLabel("Short name (optional)")).toHaveValue("SAVED");
  await expect(
    page.getByRole("combobox", { name: "Visibility", exact: true }),
  ).toHaveValue("shared");
  await page.getByLabel("Short name (optional)").fill("LATEST");
  const next = page.waitForRequest(
    (r) =>
      r.url().endsWith(`/api/channels/${channelId}`) && r.method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save channel details" }).click();
  expect((await next).postDataJSON()).toEqual({
    name: "Saved identity renamed",
    description: "",
    expectedDetailsRevision: 1,
    shortName: "LATEST",
    visibility: "shared",
  });
});

test("management now-next advances while idle and refreshes coverage without losing draft or focus", async ({
  page,
}) => {
  const { channelId } = await proofChannel(page, "Idle guide proof");
  await page.clock.install();
  const now = await page.evaluate(() => Date.now());
  let reads = 0;
  await page.route("**/guide*", async (route) => {
    const response = await route.fetch(),
      data = await response.json();
    const ch = data.channels.find((c: { id: string }) => c.id === channelId);
    if (ch) {
      reads++;
      const prototype = ch.entries[0];
      ch.entries = [
        {
          ...prototype,
          id: "idle-one",
          title: "Idle episode one",
          startMs: now - 1000,
          endMs: now + 5000,
        },
        {
          ...prototype,
          id: "idle-two",
          title: "Idle episode two",
          startMs: now + 5000,
          endMs: now + 10000,
        },
        ...(reads > 1
          ? [
              {
                ...prototype,
                id: "idle-three",
                title: "Idle episode three",
                startMs: now + 10000,
                endMs: now + 600000,
              },
            ]
          : []),
      ];
    }
    await route.fulfill({ response, json: data });
  });
  await navigate(page, "library");
  await navigate(page, "channels");
  const row = page.getByRole("row").filter({
    has: page.getByRole("button", { name: "Idle guide proof", exact: true }),
  });
  await expect(row).toContainText("Idle episode one");
  await page.clock.runFor(6000);
  await expect(row).not.toContainText("Idle episode one");
  await expect(row).toContainText("Idle episode two");
  await row.getByRole("button", { name: "Edit details", exact: true }).click();
  const field = page.getByLabel("Channel name", { exact: true });
  await field.fill("Unsaved identity");
  await field.focus();
  const refresh = page.waitForResponse(
    (r) => r.url().includes("/guide") && r.ok(),
  );
  await page.clock.runFor(30000);
  await refresh;
  await expect(row).toContainText("Idle episode three");
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("Unsaved identity");
});
