import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Source, Programming } from "../web/src/types";
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
async function fixture(page: Page, name: string) {
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
  const p = await page.getByLabel("Current profile").inputValue();
  const sources: Source[] = await get(page, "/api/sources");
  const selected = await mutate(page, `/api/profiles/${p}/selection`, "POST", {
    type: "folder",
    sourceId: sources.find((s) => s.kind === "shows")!.id,
    directory: "",
    recursive: true,
  });
  const item = selected.items.find((i: { path: string }) =>
    i.path.endsWith("Orbit.S01E01.mp4"),
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
    style: ".player-overlay, .video-status { visibility: hidden; }",
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
        Math.floor(canvas.width / 2),
        Math.floor(canvas.height / 4),
        1,
        1,
      ).data;
      context.drawImage(actual, 0, 0);
      const seen = context.getImageData(
        Math.floor(canvas.width / 2),
        Math.floor(canvas.height / 4),
        1,
        1,
      ).data;
      return { expected: [...expected], seen: [...seen] };
    },
    `data:image/png;base64,${shot.toString("base64")}`,
  );
  for (let i = 0; i < 3; i++)
    expect(Math.abs(pixels.expected[i]! - pixels.seen[i]!)).toBeLessThan(25);
  expect(
    pixels.expected.slice(0, 3).reduce((sum, n) => sum + n, 0),
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
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Resume", exact: true }),
      ).toBeEnabled();
      await expect(page.locator(".video-status")).toHaveCount(0);
      const frame = await frozenPicture(page),
        requests = mediaRequests;
      await page.waitForTimeout(1200);
      expect(mediaRequests).toBe(requests);
      expect(negotiations).toBe(before);
      await expect(page.locator("video")).toHaveAttribute("poster", frame!);
      await page.getByRole("button", { name: "Resume", exact: true }).click();
      await playing(page);
      await expect(page.locator("video")).not.toHaveAttribute("poster", /.+/);
    }
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Resume", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Go Live", exact: true }).click();
    await playing(page);
    await expect(page.locator("video")).not.toHaveAttribute("poster", /.+/);
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
  page.once("dialog", (d) => d.dismiss());
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.keyboard.press("Escape");
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
    .getByRole("combobox", { name: "Rotation", exact: true })
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
    preserved.getByRole("combobox", { name: "Rotation", exact: true }),
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
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page
      .getByRole("row")
      .filter({ has: page.getByRole("button", { name: b.name, exact: true }) })
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
  await expect(page.getByRole("navigation")).toBeAttached();
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
