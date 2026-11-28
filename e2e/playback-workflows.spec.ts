import { randomUUID } from "node:crypto";
import { test, expect, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { selectInitialProfile } from "./workspace";
import type { Account, Media, Playback } from "../web/src/types";

// The existing long-episode fixture supplies synthetic 120-second videos and
// real English SRT files, keeping geometry/recovery checks inside one airing.
test.use({ baseURL: "http://127.0.0.1:8792" });

async function login(
  page: Page,
  username = "designer",
  password = "synthetic-browser-password",
) {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await selectInitialProfile(page);
  await expect(page.getByLabel("Current profile", { exact: true })).toHaveValue(
    /.+/,
  );
  return page.getByLabel("Current profile", { exact: true }).inputValue();
}
async function api<T>(
  page: Page,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  return page.evaluate(
    async ({ path, method, body }) => {
      const headers: Record<string, string> = {};
      if (method !== "GET") {
        if (body !== undefined) headers["Content-Type"] = "application/json";
        headers["X-CSRF-Token"] = (
          await (await fetch("/api/auth/csrf")).json()
        ).csrfToken;
      }
      const response = await fetch(path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok)
        throw new Error(`${response.status}: ${await response.text()}`);
      return response.status === 204 ? null : response.json();
    },
    { path, method, body },
  );
}
async function playable(page: Page, profileId: string) {
  const items = (
    await api<{ items: Media[] }>(
      page,
      `/api/profiles/${profileId}/media?limit=50`,
    )
  ).items;
  const item = items.find(
    (item) => item.available && item.relativePath?.includes("S01E01"),
  );
  expect(
    item,
    "the existing synthetic English-caption episode is available",
  ).toBeTruthy();
  return item!;
}
async function channel(
  page: Page,
  profileId: string,
  item: Media,
  name: string,
  shared = false,
) {
  // API calls below are explicit synthetic test preconditions. Watching,
  // captions, pause, switching, retry and account changes use rendered UI.
  const created = await api<{ id: string; name: string }>(
    page,
    "/api/channels",
    "POST",
    { profileId, name, visibility: shared ? "shared" : "private" },
  );
  await api(
    page,
    `/api/channels/${created.id}/programming?horizonMs=3600000`,
    "PUT",
    {
      profileId,
      groups: [
        {
          id: "synthetic-caption-program",
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
    },
  );
  await api(
    page,
    `/api/profiles/${profileId}/subscriptions/${created.id}`,
    "PUT",
    {},
  );
  return created;
}
async function watch(page: Page, name: string) {
  await page.goto("/#watch");
  await page
    .getByRole("button", { name: `Preview ${name}`, exact: true })
    .click();
  const joined = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/playback/sessions" &&
      response.status() === 201,
  );
  await page
    .getByRole("region", { name: "Selected channel details", exact: true })
    .getByRole("button", { name: `Watch ${name} live`, exact: true })
    .click();
  const session: Playback = await (await joined).json();
  await advancing(page);
  return session;
}
async function advancing(page: Page) {
  await expect
    .poll(
      () =>
        page
          .locator("video")
          .evaluate(
            (video: HTMLVideoElement) => !video.paused && video.readyState >= 2,
          ),
      { timeout: 20000 },
    )
    .toBe(true);
  const before = await page
    .locator("video")
    .evaluate((video: HTMLVideoElement) => video.currentTime);
  await expect
    .poll(
      () =>
        page
          .locator("video")
          .evaluate((video: HTMLVideoElement) => video.currentTime),
      { timeout: 10000 },
    )
    .toBeGreaterThan(before + 0.2);
}
async function english(page: Page) {
  const subtitles = page.getByRole("combobox", {
    name: "Subtitles",
    exact: true,
  });
  const option = subtitles
    .locator("option")
    .filter({ hasText: /English/i })
    .first();
  await expect(option).toBeAttached();
  await subtitles.selectOption((await option.getAttribute("value"))!);
}
async function cueGeometry(stage: Locator) {
  return stage.evaluate((element) => {
    const cue = element.querySelector<HTMLElement>(".subtitle-cue")!;
    const picture = element.querySelector<HTMLElement>(".picture-surface")!;
    const video = element.querySelector<HTMLVideoElement>("video")!;
    const rectangle = ({
      left,
      top,
      right,
      bottom,
      width,
      height,
    }: DOMRect) => ({ left, top, right, bottom, width, height });
    const intersects = (a: DOMRect, b: DOMRect) =>
      a.left < b.right &&
      a.right > b.left &&
      a.top < b.bottom &&
      a.bottom > b.top;
    const cueBounds = cue.getBoundingClientRect();
    const obstructions = [
      ...element.querySelectorAll<HTMLElement>(
        ".player-overlay,.player-reveal,.paused-status",
      ),
    ].filter(
      (node) =>
        node.getClientRects().length &&
        getComputedStyle(node).visibility !== "hidden",
    );
    const range = document.createRange();
    range.selectNodeContents(cue);
    return {
      cue: rectangle(cue.getBoundingClientRect()),
      picture: rectangle(picture.getBoundingClientRect()),
      video: rectangle(video.getBoundingClientRect()),
      text: rectangle(range.getBoundingClientRect()),
      clipped:
        cue.scrollWidth > cue.clientWidth ||
        cue.scrollHeight > cue.clientHeight,
      overlaps: obstructions
        .filter((node) => intersects(cueBounds, node.getBoundingClientRect()))
        .map((node) => node.className),
      fontSize: parseFloat(getComputedStyle(cue).fontSize),
    };
  });
}

for (const revoked of ["source grant", "subscription"] as const) {
  test(`viewer lands on Watch and ${revoked} revocation clears actual playback with bounded denied polling`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(70000);
    const profileId = await login(page);
    await page
      .getByLabel("Current profile", { exact: true })
      .selectOption({ label: "Living Room" });
    const item = await playable(page, profileId);
    const username = `playback-${randomUUID().slice(0, 8)}`;
    const password = "synthetic-playback-password";
    const viewer = await api<Account>(page, "/api/accounts", "POST", {
      username,
      password,
      role: "viewer",
    });
    await api(page, `/api/profiles/${profileId}/accounts/${viewer.id}`, "PUT", {
      canManage: false,
    });
    const created = await channel(
      page,
      profileId,
      item,
      `Access recovery ${randomUUID().slice(0, 8)}`,
      true,
    );
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:8792",
    });
    const watching = await context.newPage();
    let grantRemoved = false;
    try {
      await login(watching, username, password);
      await expect(
        watching.getByRole("heading", { name: "Watch TV", exact: true }),
      ).toBeVisible();
      await expect(
        watching.getByRole("button", { name: /^Create (channel|collection)$/ }),
      ).toHaveCount(0);
      await expect(
        watching.getByRole("dialog", { name: "Create channel", exact: true }),
      ).toHaveCount(0);
      const session = await watch(watching, created.name);
      const video = await watching.locator("video").elementHandle();
      const denied: number[] = [];
      watching.on("response", (response) => {
        if (
          response.request().method() === "GET" &&
          new URL(response.url()).pathname ===
            `/api/playback/sessions/${session.id}` &&
          [403, 404].includes(response.status())
        )
          denied.push(response.status());
      });
      if (revoked === "source grant") {
        await api(page, `/api/profiles/${profileId}/grants`, "DELETE", {
          sourceId: item.sourceId,
          subtree: "",
        });
        grantRemoved = true;
      } else
        await api(
          page,
          `/api/profiles/${profileId}/subscriptions/${created.id}`,
          "DELETE",
        );
      const recovery = watching.getByRole("region", {
        name: "Playback recovery",
        exact: true,
      });
      await expect(recovery).toBeVisible();
      await expect(recovery.getByRole("alert")).toContainText(
        "no longer available",
      );
      await expect(
        recovery.getByRole("button", { name: "Choose profile", exact: true }),
      ).toBeVisible();
      await expect(
        recovery.getByRole("button", { name: "Channel guide", exact: true }),
      ).toBeVisible();
      await expect(watching.locator("video")).toHaveCount(0);
      expect(
        await video!.evaluate((video: HTMLVideoElement) => video.paused),
      ).toBe(true);
      await expect(watching.locator("main")).not.toContainText(item.title);
      await expect(watching.locator("main")).not.toContainText(
        /Profile not found|Channel not found|Playback session not found|● LIVE/,
      );
      await expect(
        watching.getByRole("button", { name: "Pause", exact: true }),
      ).toHaveCount(0);
      await expect(
        watching.getByRole("button", { name: "Retry playback", exact: true }),
      ).toHaveCount(0);
      // A measured interval exceeds two normal one-second polls. No automatic
      // unauthorized loop should continue behind the recovery screen.
      const stoppedAt = denied.length;
      await watching.waitForTimeout(2500);
      expect(denied.length).toBe(stoppedAt);
      expect(denied.length).toBeLessThanOrEqual(2);
      expect(
        (
          await new AxeBuilder({ page: watching })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      if (grantRemoved) {
        await api(page, `/api/profiles/${profileId}/grants`, "POST", {
          sourceId: item.sourceId,
          subtree: "",
        });
        grantRemoved = false;
      } else
        await api(
          page,
          `/api/profiles/${profileId}/subscriptions/${created.id}`,
          "PUT",
          {},
        );
      await recovery
        .getByRole("button", {
          name: "Retry after access is restored",
          exact: true,
        })
        .click();
      await advancing(watching);
      await expect(recovery).toHaveCount(0);
    } finally {
      await context.close();
      if (grantRemoved)
        await api(page, `/api/profiles/${profileId}/grants`, "POST", {
          sourceId: item.sourceId,
          subtree: "",
        });
      await api(page, `/api/channels/${created.id}`, "DELETE");
      await api(
        page,
        `/api/profiles/${profileId}/accounts/${viewer.id}`,
        "DELETE",
      );
      // Accounts are deliberately retained by the API; disable this unique
      // synthetic account and its sessions rather than bypassing that policy.
      await api(page, `/api/accounts/${viewer.id}`, "PATCH", {
        disabled: true,
      });
    }
  });
}

test("real largest English captions stay inside the picture and clear of visible, hidden and paused controls", async ({
  page,
}, testInfo) => {
  test.setTimeout(70000);
  const profileId = await login(page);
  await page
    .getByLabel("Current profile", { exact: true })
    .selectOption({ label: "Living Room" });
  const item = await playable(page, profileId);
  const created = await channel(
    page,
    profileId,
    item,
    `Caption geometry ${randomUUID().slice(0, 8)}`,
  );
  try {
    await watch(page, created.name);
    await english(page);
    const cue = page.locator(".subtitle-cue");
    await expect(cue).toContainText("External fixture episode 1");
    await page
      .getByText("Caption appearance and preferences", { exact: true })
      .click();
    await page
      .getByLabel("Caption size", { exact: true })
      .selectOption("largest");
    const measurements: unknown[] = [];
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const stage = page.locator(".video-stage");
      for (const controls of ["visible", "hidden"] as const) {
        if (controls === "visible") {
          const show = page.getByRole("button", {
            name: "Show controls",
            exact: true,
          });
          if (await show.isVisible()) await show.click();
        } else
          await page
            .getByRole("button", { name: "Hide controls", exact: true })
            .click();
        await expect(cue).toContainText("External fixture episode 1");
        const bounds = await cueGeometry(stage);
        measurements.push({ width, controls, ...bounds });
        for (const container of [bounds.picture, bounds.video]) {
          expect(bounds.cue.left).toBeGreaterThanOrEqual(container.left);
          expect(bounds.cue.right).toBeLessThanOrEqual(container.right);
          expect(bounds.cue.top).toBeGreaterThanOrEqual(container.top);
          expect(bounds.cue.bottom).toBeLessThanOrEqual(container.bottom);
        }
        expect(bounds.text.width).toBeGreaterThan(0);
        expect(bounds.text.left).toBeGreaterThanOrEqual(bounds.cue.left);
        expect(bounds.text.right).toBeLessThanOrEqual(bounds.cue.right);
        expect(bounds.text.top).toBeGreaterThanOrEqual(bounds.cue.top);
        expect(bounds.text.bottom).toBeLessThanOrEqual(bounds.cue.bottom);
        expect(bounds.clipped).toBe(false);
        expect(bounds.overlaps).toEqual([]);
        expect(bounds.fontSize).toBeGreaterThan(20);
        await stage.scrollIntoViewIfNeeded();
        await testInfo.attach(`captions-${width}-${controls}`, {
          body: await stage.screenshot(),
          contentType: "image/png",
        });
      }
      await page
        .getByRole("button", { name: "Show controls", exact: true })
        .click();
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      await expect(page.locator(".paused-status")).toBeVisible();
      await expect(cue).toContainText("External fixture episode 1");
      const paused = await cueGeometry(stage);
      expect(paused.overlaps).toEqual([]);
      expect(paused.cue.bottom).toBeLessThanOrEqual(paused.picture.bottom);
      measurements.push({ width, controls: "paused", ...paused });
      await page
        .getByRole("button", { name: "Full screen", exact: true })
        .click();
      await expect
        .poll(() => page.evaluate(() => !!document.fullscreenElement))
        .toBe(true);
      const fullscreen = await cueGeometry(stage);
      expect(fullscreen.overlaps).toEqual([]);
      for (const container of [fullscreen.picture, fullscreen.video]) {
        expect(fullscreen.cue.top).toBeGreaterThanOrEqual(container.top);
        expect(fullscreen.cue.bottom).toBeLessThanOrEqual(container.bottom);
      }
      expect(fullscreen.clipped).toBe(false);
      measurements.push({
        width,
        controls: "paused-fullscreen",
        ...fullscreen,
      });
      await testInfo.attach(`captions-${width}-paused-fullscreen`, {
        body: await stage.screenshot(),
        contentType: "image/png",
      });
      await page.evaluate(() => document.exitFullscreen());
      await page.getByRole("button", { name: "Resume", exact: true }).click();
      await advancing(page);
    }
    await testInfo.attach("caption-control-geometry", {
      body: Buffer.from(JSON.stringify(measurements, null, 2)),
      contentType: "application/json",
    });
  } finally {
    await api(page, `/api/channels/${created.id}`, "DELETE");
  }
});

test("caption delivery failure has a real retry while the video continues advancing", async ({
  page,
}) => {
  test.setTimeout(60000);
  const profileId = await login(page);
  await page
    .getByLabel("Current profile", { exact: true })
    .selectOption({ label: "Living Room" });
  const item = await playable(page, profileId);
  const created = await channel(
    page,
    profileId,
    item,
    `Caption retry ${randomUUID().slice(0, 8)}`,
  );
  let requests = 0;
  const captionUrl =
    /\/api\/profiles\/[^/]+\/media\/[^/]+\/subtitles\/\d+\.vtt$/;
  await page.route(captionUrl, async (route) => {
    requests++;
    if (requests === 1)
      await route.fulfill({
        status: 404,
        contentType: "text/plain",
        body: "Synthetic unavailable subtitle delivery",
      });
    else await route.continue();
  });
  try {
    await watch(page, created.name);
    await english(page);
    const error = page.locator(".caption-recovery");
    await expect(error.getByRole("alert")).toContainText(
      "Subtitles unavailable",
    );
    await expect(error).toContainText("Your video keeps playing");
    expect(requests).toBe(1);
    await advancing(page);
    const delivered = page.waitForResponse(
      (response) => captionUrl.test(response.url()) && response.ok(),
    );
    await error
      .getByRole("button", { name: "Retry captions", exact: true })
      .click();
    expect(await (await delivered).text()).toContain(
      "External fixture episode 1",
    );
    await expect(page.locator(".subtitle-cue")).toContainText(
      "External fixture episode 1",
    );
    await expect(error).toHaveCount(0);
    expect(requests).toBe(2);
    await advancing(page);
  } finally {
    await api(page, `/api/channels/${created.id}`, "DELETE");
  }
});

test("paused switching names the authorized destination, Cancel preserves position, and resumed copy agrees with lag", async ({
  page,
}) => {
  test.setTimeout(70000);
  const profileId = await login(page);
  await page
    .getByLabel("Current profile", { exact: true })
    .selectOption({ label: "Living Room" });
  const item = await playable(page, profileId);
  const origin = await channel(
    page,
    profileId,
    item,
    `Paused origin ${randomUUID().slice(0, 8)}`,
  );
  const destination = await channel(
    page,
    profileId,
    item,
    `Named destination ${randomUUID().slice(0, 8)}`,
  );
  try {
    const session = await watch(page, origin.name);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Resume", exact: true }),
    ).toBeVisible();
    const paused = await api<Playback>(
      page,
      `/api/playback/sessions/${session.id}`,
    );
    expect(paused.paused).toBe(true);
    await page
      .getByLabel("Watch channel", { exact: true })
      .selectOption(destination.id);
    const confirm = page.getByRole("dialog", {
      name: "Switch to live playback?",
      exact: true,
    });
    await expect(confirm).toContainText(`Watch ${destination.name} live`);
    await expect(confirm).toContainText("discard the current paused position");
    await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(confirm).toHaveCount(0);
    const afterCancel = await api<Playback>(
      page,
      `/api/playback/sessions/${session.id}`,
    );
    expect(afterCancel.channelId).toBe(origin.id);
    expect(afterCancel.paused).toBe(true);
    expect(afterCancel.positionMs).toBe(paused.positionMs);
    await expect(page.getByLabel("Watch channel", { exact: true })).toHaveValue(
      origin.id,
    );
    // Real elapsed wall time creates meaningful lag without modifying clocks or
    // schedule responses. It is longer than the UI's two-second live threshold.
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await advancing(page);
    await expect(page.locator(".player-details")).toContainText(
      "Watching behind live on this device",
    );
    await expect(page.locator(".player-overlay .badge")).toContainText(
      "behind live",
    );
    await expect(
      page.getByRole("button", { name: "Go Live", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Resume", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Watch channel", { exact: true })
      .selectOption(destination.id);
    await expect(confirm).toContainText(destination.name);
    const joined = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/playback/sessions" &&
        response.status() === 201,
    );
    await confirm
      .getByRole("button", { name: "Watch live", exact: true })
      .click();
    const next: Playback = await (await joined).json();
    expect(next.channelId).toBe(destination.id);
    expect(next.paused).toBe(false);
    expect(next.behindLiveMs).toBe(0);
    await advancing(page);
    await expect(page.locator(".player-details")).toContainText(
      "Watching this channel’s live timeline",
    );
  } finally {
    await api(page, `/api/channels/${origin.id}`, "DELETE");
    await api(page, `/api/channels/${destination.id}`, "DELETE");
  }
});

test("TV approval identifies its approving account and account switch leaves the pending device unapproved", async ({
  page,
}) => {
  await login(page);
  const pending = await api<{ userCode: string; deviceCode: string }>(
    page,
    "/api/auth/pairings",
    "POST",
    { deviceName: `Account review TV ${randomUUID().slice(0, 8)}` },
  );
  await page.goto("/#connect-tv");
  await page
    .getByLabel("TV connection code", { exact: true })
    .fill(pending.userCode);
  await page.getByRole("button", { name: "Review TV", exact: true }).click();
  const review = page.getByRole("region", {
    name: "Review TV approval",
    exact: true,
  });
  await expect(review).toContainText("Approve as designer");
  await expect(review).toContainText("profiles allowed for this account");
  await expect(review).toContainText(
    "approval is not limited to the profile previously selected",
  );
  await expect(
    review.getByRole("button", { name: "Approve TV", exact: true }),
  ).toHaveAttribute("aria-describedby", "approving-account");
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await review
    .getByRole("button", { name: "Use another account", exact: true })
    .click();
  await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve TV", exact: true }),
  ).toHaveCount(0);
  const state = await page.request.post("/api/auth/pairings/poll", {
    data: { deviceCode: pending.deviceCode },
  });
  expect(state.ok()).toBe(true);
  expect(await state.json()).toEqual({ status: "pending" });
  // No device session is issued: the temporary fixture owns the pending code,
  // which expires automatically. There is intentionally no approval cleanup.
});
