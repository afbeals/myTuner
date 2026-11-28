import { selectInitialProfile } from "./workspace";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Source, Programming, Playback } from "../web/src/types";
test.use({ baseURL: "http://127.0.0.1:8786" });

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
        throw Error(`${response.status}: ${await response.text()}`);
      return response.status === 204 ? null : response.json();
    },
    { path, method, body },
  );
}
async function get(page: Page, path: string) {
  return page.evaluate(async (path) => {
    const response = await fetch(path);
    if (!response.ok) throw Error(await response.text());
    return response.json();
  }, path);
}
async function fixture(
  page: Page,
  name: string,
  filename = "Orbit.S01E01.mp4",
) {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("designer");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await selectInitialProfile(page);
  await expect(
    page.getByRole("navigation", { name: "Main navigation", exact: true }),
  ).toBeAttached();
  await page
    .getByLabel("Current profile")
    .selectOption({ label: "Living Room" });
  const p = await page.getByLabel("Current profile").inputValue();
  const sources: Source[] = await get(page, "/api/sources");
  const selected = await mutate(page, `/api/profiles/${p}/selection`, "POST", {
    type: "folder",
    sourceId: sources.find((s) => s.kind === "shows")!.id,
    directory: "",
    recursive: true,
  });
  const item = selected.items.find((i: { path: string }) =>
    i.path.endsWith(filename),
  );
  const ch = await mutate(page, "/api/channels", "POST", {
    name,
    profileId: p,
    visibility: "private",
  });
  const config: Programming = {
    profileId: p,
    seed: 42,
    groups: [
      {
        id: "g",
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
  await mutate(
    page,
    `/api/channels/${ch.id}/programming?horizonMs=120000`,
    "PUT",
    config,
  );
  await mutate(page, `/api/profiles/${p}/subscriptions/${ch.id}`, "PUT");
  return { p, ch, config };
}
async function playing(page: Page) {
  await expect
    .poll(
      () =>
        page
          .locator("video")
          .evaluate(
            (v: HTMLVideoElement) =>
              !v.paused && v.readyState >= 2 && v.videoWidth > 0,
          ),
      { timeout: 20000 },
    )
    .toBe(true);
}
async function frozenPicture(page: Page) {
  const video = page.locator("video");
  await expect(video).toHaveAttribute("poster", /^data:image\/jpeg;base64,/);
  const frame = await video.getAttribute("poster");
  // Compare actual screenshot pixels with the decoded poster, not just its URL.
  const shot = await video.screenshot({
    style:
      ".player-overlay, .video-status, .paused-status { visibility: hidden; }",
  });
  const pixels = await video.evaluate(
    async (el: HTMLVideoElement, png: string) => {
      const poster = new Image(),
        actual = new Image();
      poster.src = el.poster;
      actual.src = png;
      await Promise.all([poster.decode(), actual.decode()]);
      const canvas = document.createElement("canvas");
      canvas.width = actual.width;
      canvas.height = actual.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(poster, 0, 0, canvas.width, canvas.height);
      const expected = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      context.drawImage(actual, 0, 0);
      const seen = context.getImageData(0, 0, canvas.width, canvas.height).data;
      // Fractional CSS sizes round outward in element screenshots (for example,
      // 841.33 CSS px becomes 842 bitmap px). A single color-boundary pixel is
      // not stable under the browser's and canvas's different interpolation.
      // Compare a uniform grid across the actual picture instead, retaining
      // the same per-channel tolerance and an explicit nonblack requirement.
      const error = [0, 0, 0],
        brightness = [0, 0, 0];
      let samples = 0;
      for (let row = 0; row < 14; row++) {
        for (let column = 0; column < 24; column++) {
          const x = Math.floor(((column + 0.5) / 24) * canvas.width);
          const y = Math.floor(((row + 0.5) / 14) * canvas.height);
          const offset = (y * canvas.width + x) * 4;
          for (let channel = 0; channel < 3; channel++) {
            error[channel]! += Math.abs(
              expected[offset + channel]! - seen[offset + channel]!,
            );
            brightness[channel]! += expected[offset + channel]!;
          }
          samples++;
        }
      }
      return {
        averageError: error.map((value) => value / samples),
        brightness: brightness.map((value) => value / samples),
        samples,
        width: canvas.width,
        height: canvas.height,
      };
    },
    `data:image/png;base64,${shot.toString("base64")}`,
  );
  await test.info().attach("paused-frame-pixels", {
    body: JSON.stringify(pixels),
    contentType: "application/json",
  });
  await test
    .info()
    .attach("paused-frame-rendered", { body: shot, contentType: "image/png" });
  expect(pixels.samples).toBe(336);
  for (const difference of pixels.averageError)
    expect(difference).toBeLessThan(25);
  expect(
    pixels.brightness.reduce((sum, value) => sum + value, 0),
  ).toBeGreaterThan(40);
  return frame;
}

for (const mode of ["direct", "hls"] as const)
  test(`R9-02 ${mode} pause retains visible pixels, stops fetching and survives lost-response recovery`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    const f = await fixture(page, `R9 ${mode} pause`);
    await page.goto("/#watch");
    await page
      .getByRole("article")
      .filter({ hasText: f.ch.name })
      .getByRole("button", { name: "Watch live" })
      .click();
    await playing(page);
    if (mode === "hls") {
      await page
        .getByRole("combobox", { name: "Audio", exact: true })
        .selectOption("2");
      await expect(page.getByRole("main")).toContainText(
        "Compatible HLS stream",
      );
      await playing(page);
    }
    await page
      .getByRole("button", { name: "Hide controls", exact: true })
      .click();
    await expect(page.locator(".player-overlay")).toBeHidden();
    let mediaRequests = 0,
      negotiations = 0;
    page.on("request", (r) => {
      if (/\/(file|hls\/.*)$/.test(new URL(r.url()).pathname)) mediaRequests++;
      if (r.url().endsWith("/negotiate")) negotiations++;
    });
    for (const lost of [false, true]) {
      if (lost)
        await page.route(
          "**/api/playback/sessions/*/pause",
          async (route) => {
            const response = await route.fetch();
            expect(response.ok()).toBe(true);
            await route.fulfill({
              status: 503,
              json: { error: "Synthetic lost pause response" },
            });
          },
          { times: 1 },
        );
      const before = negotiations;
      await page.evaluate(() =>
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "MediaPause", bubbles: true }),
        ),
      );
      const status = page.getByRole("status", {
        name: "Paused playback",
        exact: true,
      });
      await expect(status).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Resume",
          exact: true,
          includeHidden: true,
        }),
      ).toBeEnabled();
      await expect(status).toContainText("The Last Platform");
      if (!lost) await expect(page.locator(".player-overlay")).toBeHidden();
      const inside = await status.evaluate((el) => {
        const text = el.getBoundingClientRect(),
          picture = el.closest(".picture-surface")!.getBoundingClientRect();
        return (
          text.top >= picture.top &&
          text.bottom <= picture.bottom &&
          text.left >= picture.left &&
          text.right <= picture.right
        );
      });
      expect(inside).toBe(true);
      await expect(page.locator(".video-status")).toHaveCount(0);
      const frame = await frozenPicture(page),
        requests = mediaRequests;
      await page.waitForTimeout(1200);
      expect(mediaRequests).toBe(requests);
      expect(negotiations).toBe(before);
      await expect(page.locator("video")).toHaveAttribute("poster", frame!);
      await page.evaluate(() =>
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "MediaPlay", bubbles: true }),
        ),
      );
      await playing(page);
      await expect(
        page.getByRole("status", { name: "Paused playback", exact: true }),
      ).toHaveCount(0);
      await expect(page.locator("video")).not.toHaveAttribute("poster", /.+/);
    }
    await page.evaluate(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "MediaPause", bubbles: true }),
      ),
    );
    await expect(
      page.getByRole("status", { name: "Paused playback", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Show controls", exact: true })
      .click();
    await page.getByRole("button", { name: "Go Live", exact: true }).click();
    await playing(page);
    await expect(page.locator("video")).not.toHaveAttribute("poster", /.+/);
  });

test("hidden-controls pause is visible on the retained picture on desktop, narrow and fullscreen", async ({
  page,
}) => {
  const stable = (data: Playback) => {
    if (data.paused && data.context)
      data.context.airing = {
        ...data.context.airing,
        contentElapsedMs: 3000,
        contentDurationMs: 8000,
      };
    return data;
  };
  await page.route(
    /\/api\/playback\/sessions\/[^/]+(?:\/pause)?$/,
    async (route) => {
      if (!["GET", "POST"].includes(route.request().method()))
        return route.continue();
      const response = await route.fetch();
      if (!response.ok()) return route.fulfill({ response });
      return route.fulfill({ response, json: stable(await response.json()) });
    },
  );
  const f = await fixture(page, "Paused picture proof", "Orbit.S01E02.mp4");
  await page.goto("/#watch");
  await page
    .getByRole("article")
    .filter({ hasText: f.ch.name })
    .getByRole("button", { name: "Watch live", exact: true })
    .click();
  await playing(page);
  await page
    .getByRole("button", { name: "Hide controls", exact: true })
    .click();
  await page.evaluate(() =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "MediaPause", bubbles: true }),
    ),
  );
  const status = page.getByRole("status", {
    name: "Paused playback",
    exact: true,
  });
  await expect(status).toContainText("Maple Street");
  await expect(status).toContainText("0:03 / 0:08");
  await expect(page.locator(".player-overlay")).toBeHidden();
  await frozenPicture(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.locator(".picture-surface")).toHaveScreenshot(
      `hidden-pause-picture-${width}.png`,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Full screen", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  expect(
    await status.evaluate((el) => document.fullscreenElement?.contains(el)),
  ).toBe(true);
  await expect(status).toBeVisible();
  await expect(page.locator(".picture-surface")).toHaveScreenshot(
    "hidden-pause-picture-fullscreen.png",
  );
  await page.evaluate(() => document.exitFullscreen());
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test("I47 separate details saves immediately without loading programming or changing a paused session", async ({
  page,
}) => {
  const f = await fixture(page, "R9 details");
  const session = await mutate(page, "/api/playback/sessions", "POST", {
    profileId: f.p,
    channelId: f.ch.id,
  });
  await mutate(page, `/api/playback/sessions/${session.id}/pause`, "POST");
  const before = await get(page, `/api/playback/sessions/${session.id}`),
    program = await get(page, `/api/channels/${f.ch.id}/programming`);
  await page.goto(`/#channels?profile=${f.p}&channel=${f.ch.id}`);
  const panel = page.locator(".channel-preview");
  await expect(
    panel.getByRole("heading", { name: f.ch.name, exact: true }),
  ).toBeVisible();
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/programming") || r.url().includes("/playback/"))
      requests.push(`${r.method()} ${r.url()}`);
  });
  const opener = panel.getByRole("button", {
    name: "Edit details",
    exact: true,
  });
  await opener.click();
  const dialog = page.getByRole("dialog", {
    name: `Edit details · ${f.ch.name}`,
    exact: true,
  });
  await expect(dialog).toContainText("Details save immediately");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1024 });
    await page.evaluate(() => document.fonts.ready);
    await expect(dialog).toHaveScreenshot(`channel-details-${width}.png`);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(
    (
      await new AxeBuilder({ page })
        .include("dialog[open]")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await dialog
    .getByLabel("Channel name", { exact: true })
    .fill("R9 renamed details");
  await dialog.getByLabel("Short name (optional)").fill("RENAMED");
  await dialog
    .getByRole("button", { name: "Save channel details", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("saved");
  await expect(
    panel.getByRole("heading", { name: "R9 renamed details", exact: true }),
  ).toBeAttached();
  expect(requests).toEqual([]);
  expect(await get(page, `/api/channels/${f.ch.id}/programming`)).toEqual(
    program,
  );
  const after = await get(page, `/api/playback/sessions/${session.id}`);
  expect({
    id: after.id,
    paused: after.paused,
    position: after.positionMs,
    revision: after.revisionId,
  }).toEqual({
    id: before.id,
    paused: before.paused,
    position: before.positionMs,
    revision: before.revisionId,
  });
  await dialog.getByLabel("Channel name", { exact: true }).fill("Discard this");
  await page.keyboard.press("Escape");
  await page
    .locator("dialog.confirmation-dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .locator("dialog.confirmation-dialog")
    .locator(".dialog-footer button")
    .nth(1)
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click();
  await expect(
    page.getByRole("dialog").getByLabel("Channel name", { exact: true }),
  ).toHaveValue("R9 renamed details");
  await expect(
    page.getByRole("dialog").getByLabel("Short name (optional)"),
  ).toHaveValue("RENAMED");
});

test("I47 editing details from programming preserves its unpublished draft and supports failed-save retry", async ({
  page,
}) => {
  const f = await fixture(page, "R9 preserved draft");
  await page.goto(`/#channels?profile=${f.p}&channel=${f.ch.id}`);
  await page
    .locator(".channel-preview")
    .getByRole("button", { name: "Edit programming", exact: true })
    .click();
  const program = page.getByRole("dialog", {
    name: `Program ${f.ch.name}`,
    exact: true,
  });
  await program
    .getByRole("combobox", { name: "Play order", exact: true })
    .selectOption("shuffle");
  await program
    .getByRole("button", { name: "Edit details", exact: true })
    .click();
  const details = page.getByRole("dialog", {
    name: `Edit details · ${f.ch.name}`,
    exact: true,
  });
  await details
    .getByLabel("Channel name", { exact: true })
    .fill("R9 preserved renamed");
  await page.route(
    `**/api/channels/${f.ch.id}`,
    (route) =>
      route.fulfill({
        status: 503,
        json: { error: "Synthetic details failure" },
      }),
    { times: 1 },
  );
  await details
    .getByRole("button", { name: "Save channel details", exact: true })
    .click();
  await expect(details.getByRole("alert")).toContainText(
    "Synthetic details failure",
  );
  await expect(details.getByLabel("Channel name", { exact: true })).toHaveValue(
    "R9 preserved renamed",
  );
  await details
    .getByRole("button", { name: "Save channel details", exact: true })
    .click();
  await expect(details.getByRole("status")).toContainText("saved");
  await details.getByRole("button", { name: "Cancel", exact: true }).click();
  const preserved = page.getByRole("dialog", {
    name: "Program R9 preserved renamed",
    exact: true,
  });
  await expect(
    preserved.getByRole("combobox", { name: "Play order", exact: true }),
  ).toHaveValue("shuffle");
  await expect(
    preserved.getByRole("button", { name: "Edit details", exact: true }),
  ).toBeFocused();
  expect(
    (await get(page, `/api/channels/${f.ch.id}/programming`)).config.groups[0]
      .mode,
  ).toBe("ordered");
  await expect(
    preserved.getByLabel("Channel name", { exact: true }),
  ).toHaveCount(0);
});

test("I47 a late details save cannot replace a reopened editor or its draft", async ({
  page,
}) => {
  const f = await fixture(page, "R9 late A"),
    b = await mutate(page, "/api/channels", "POST", {
      name: "R9 late B",
      profileId: f.p,
      visibility: "private",
    });
  await page.goto(`/#channels?profile=${f.p}&channel=${f.ch.id}`);
  await page
    .locator(".channel-preview")
    .getByRole("button", { name: "Edit details", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Channel name", { exact: true })
    .fill("R9 late A saved");
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    entered = new Promise<void>((r) => (started = r));
  await page.route(`**/api/channels/${f.ch.id}`, async (route) => {
    const response = await route.fetch();
    started();
    await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  try {
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Save channel details", exact: true })
      .click();
    await entered;
    const pending = page.getByRole("dialog", {
      name: `Edit details · ${f.ch.name}`,
      exact: true,
    });
    await expect(
      pending.getByRole("button", { name: "Close dialog", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(pending).toBeVisible();
    // Closing is disabled while saving. Deliberate route navigation still
    // exercises unmount/abort and a delayed server response against a new draft.
    await page.evaluate(() => {
      location.hash = "profiles";
    });
    await page
      .locator("dialog.confirmation-dialog")
      .locator(".dialog-footer button")
      .nth(1)
      .click();
    await expect(
      page.getByRole("heading", { name: "Profiles", exact: true }),
    ).toBeVisible();
    await page.goto(`/#channels?profile=${f.p}&channel=${b.id}`);
    await page
      .locator(".channel-preview")
      .getByRole("button", { name: "Edit details", exact: true })
      .click();
    const next = page.getByRole("dialog", {
      name: `Edit details · ${b.name}`,
      exact: true,
    });
    await next.getByLabel("Channel name", { exact: true }).fill("R9 B draft");
    release();
    await page.waitForTimeout(200);
    await expect(next).toBeVisible();
    await expect(next.getByLabel("Channel name", { exact: true })).toHaveValue(
      "R9 B draft",
    );
    await expect(next.getByRole("status")).toHaveCount(0);
    const catalog = await get(page, "/api/admin/channels");
    expect(catalog.items.find((c: { id: string }) => c.id === b.id).name).toBe(
      b.name,
    );
  } finally {
    release();
  }
});

test("I47 an editor can rename an owned shared channel without changing or republishing its visibility", async ({
  page,
}) => {
  const f = await fixture(page, "R9 owner setup");
  const profiles = await get(page, "/api/profiles"),
    ownerId = profiles.find((p: { id: string }) => p.id === f.p).ownerAccountId;
  const shared = await mutate(page, "/api/channels", "POST", {
    name: "R9 owned shared",
    profileId: f.p,
    visibility: "shared",
    ownerAccountId: ownerId,
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Username", { exact: true }).fill("sam");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-viewer-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await selectInitialProfile(page);
  await expect(
    page.getByRole("navigation", { name: "Main navigation", exact: true }),
  ).toBeAttached();
  await page.goto(`/#channels?profile=${f.p}&channel=${shared.id}`);
  await page
    .locator(".channel-preview")
    .getByRole("button", { name: "Edit details", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("combobox", { name: "Visibility", exact: true }),
  ).toHaveValue("shared");
  await dialog
    .getByLabel("Channel name", { exact: true })
    .fill("R9 owner renamed");
  await dialog
    .getByRole("button", { name: "Save channel details", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("saved");
  const channels = await get(page, `/api/profiles/${f.p}/channels`),
    found = (Array.isArray(channels) ? channels : channels.items).find(
      (c: { id: string }) => c.id === shared.id,
    );
  expect(found.name).toBe("R9 owner renamed");
  expect(found.visibility).toBe("shared");
});
