import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.use({ baseURL: "http://127.0.0.1:8786" });
async function get(page: Page, path: string) {
  return page.evaluate(async (path) => {
    const r = await fetch(path);
    if (!r.ok) throw Error(await r.text());
    return r.json();
  }, path);
}
async function mutate(
  page: Page,
  path: string,
  method: string,
  body: unknown = {},
) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const { csrfToken } = await (await fetch("/api/auth/csrf")).json();
      const r = await fetch(path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw Error(await r.text());
      return r.status === 204 ? null : r.json();
    },
    { path, method, body },
  );
}
async function setup(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("designer");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByLabel("Current profile")
    .selectOption({ label: "Living Room" });
  const profileId = await page.getByLabel("Current profile").inputValue();
  const sources = await get(page, "/api/sources");
  const source = sources.find((s: { kind: string }) => s.kind === "shows");
  const selected = await mutate(
    page,
    `/api/profiles/${profileId}/selection`,
    "POST",
    { type: "folder", sourceId: source.id, directory: "", recursive: true },
  );
  return { profileId, source, items: selected.items };
}
async function channel(page: Page, name: string) {
  const f = await setup(page);
  const ch = await mutate(page, "/api/channels", "POST", {
    name,
    profileId: f.profileId,
    visibility: "private",
  });
  const config = {
    profileId: f.profileId,
    seed: 42,
    groups: [
      {
        id: "phase-proof",
        mode: "ordered",
        selection: { type: "media", ids: [f.items[0].id] },
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
    `/api/channels/${ch.id}/programming?horizonMs=3600000`,
    "PUT",
    config,
  );
  await mutate(
    page,
    `/api/profiles/${f.profileId}/subscriptions/${ch.id}`,
    "PUT",
  );
  return { ...f, ch, config };
}
test("collection editing retains identity and unavailable selections across searches and failed saves", async ({
  page,
}) => {
  const f = await setup(page);
  const c = await mutate(
    page,
    `/api/profiles/${f.profileId}/collections`,
    "POST",
    {
      name: "Phase retained collection",
      mediaIds: f.items.map((m: { id: string }) => m.id),
    },
  );
  await page.route(`**/collections/${c.id}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const r = await route.fetch();
    const data = await r.json();
    data.items[0].available = false;
    await route.fulfill({ response: r, json: data });
  });
  await page.goto("/#library");
  await page.getByRole("button", { name: "Collections", exact: true }).click();
  await page
    .getByRole("article")
    .filter({ hasText: "Phase retained collection" })
    .getByRole("button", { name: "Open details" })
    .click();
  await page
    .getByRole("button", { name: "Edit collection", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Edit collection" });
  await expect(editor).toContainText("Unavailable · retained");
  await editor.getByLabel("Collection name").fill("Phase renamed collection");
  await editor.getByLabel("Find videos").fill("no-such-video");
  await expect(editor).toContainText("No matching videos");
  await expect(
    editor.getByRole("region", { name: "Selected videos" }),
  ).toContainText("2 selected");
  page.once("dialog", (d) => d.dismiss());
  await page.keyboard.press("Escape");
  await expect(editor).toBeVisible();
  await page.route(`**/collections/${c.id}`, (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 409,
          json: { error: "Synthetic failed collection save" },
        })
      : route.continue(),
  );
  await editor
    .getByRole("button", { name: "Save collection", exact: true })
    .click();
  await expect(editor.getByRole("alert")).toContainText("Synthetic failed");
  await expect(editor.getByLabel("Collection name")).toHaveValue(
    "Phase renamed collection",
  );
  await page.unroute(`**/collections/${c.id}`);
  await editor
    .getByRole("button", { name: "Save collection", exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  const saved = await get(
    page,
    `/api/profiles/${f.profileId}/collections/${c.id}`,
  );
  expect(saved.id).toBe(c.id);
  expect(saved.items.map((m: { id: string }) => m.id).sort()).toEqual(
    f.items.map((m: { id: string }) => m.id).sort(),
  );
});
test("bounded picker, turn counts and checkpoint commands share one draft with unapplied commercial inputs", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Create channel" }).click();
  await page
    .getByLabel("Channel name", { exact: true })
    .fill("Phase programming proof");
  await page.getByRole("button", { name: "Create & program" }).click();
  const editor = page.getByRole("dialog", {
    name: "Program Phase programming proof",
  });
  await editor.getByRole("button", { name: "Add content group" }).click();
  const picker = page.getByRole("dialog", {
    name: "Choose programming content",
  });
  await picker
    .getByRole("combobox", { name: "Programming type" })
    .selectOption("show");
  await picker.getByRole("button", { name: "View seasons" }).click();
  await picker
    .getByRole("button", {
      name: "Select Orbit Patrol · Season 1",
      exact: true,
    })
    .click();
  await editor
    .getByRole("combobox", { name: "Episodes per turn" })
    .selectOption("2");
  page.once("dialog", (d) => d.accept());
  await editor
    .getByRole("button", { name: "Restart group", exact: true })
    .click();
  await expect(editor).toContainText("Draft: restart");
  await editor
    .getByRole("combobox", { name: "Rotation", exact: true })
    .selectOption("shuffle");
  await editor
    .getByRole("combobox", { name: "Rotation", exact: true })
    .selectOption("ordered");
  await expect(editor).toContainText(
    "Continue this group from its saved position",
  );
  await editor
    .getByRole("button", { name: "Commercials", exact: true })
    .click();
  const minimum = editor.getByLabel(
    "Minimum remaining time to start a commercial (seconds)",
  );
  await minimum.fill("7");
  await editor.getByRole("button", { name: "Content", exact: true }).click();
  await editor
    .getByRole("button", { name: "Commercials", exact: true })
    .click();
  await expect(minimum).toHaveValue("7");
  await editor.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(
    editor.getByRole("button", { name: "Generate two-hour preview" }),
  ).toBeDisabled();
  await editor
    .getByRole("button", { name: "Commercials", exact: true })
    .click();
  await editor.getByRole("button", { name: "Apply commercial rules" }).click();
  await editor.getByRole("button", { name: "Preview", exact: true }).click();
  await editor
    .getByRole("button", { name: "Generate two-hour preview" })
    .click();
  await expect(editor.getByRole("table")).toBeVisible();
  await editor.getByRole("button", { name: "Publish programming" }).click();
  await expect(
    editor.getByRole("status").filter({ hasText: "Programming saved" }),
  ).toBeVisible();
  const rows = await get(page, "/api/admin/channels");
  const ch = rows.items.find(
    (c: { name: string }) => c.name === "Phase programming proof",
  );
  const saved = await get(page, `/api/channels/${ch.id}/programming`);
  expect(saved.config.groups[0].episodesPerTurn).toBe(2);
  expect(saved.config.groups[0].selection.season).toBe(1);
  expect(saved.config.checkpointActions).toBeUndefined();
  expect(saved.config.rules.minRemainingMs).toBe(7000);
});
test("copy creates an independent private unpublished channel and loads its programming draft", async ({
  page,
}) => {
  const f = await channel(page, "Phase copy origin");
  await page.goto(`/#channels?profile=${f.profileId}&channel=${f.ch.id}`);
  await page.getByRole("button", { name: "Create from this channel" }).click();
  const modal = page.getByRole("dialog", {
    name: "Copy channel into a new draft",
  });
  await expect(modal.getByRole("combobox", { name: "Visibility" })).toHaveCount(
    0,
  );
  await modal
    .getByLabel("Channel name", { exact: true })
    .fill("Phase private copy");
  await modal.getByRole("button", { name: "Create & program" }).click();
  const editor = page.getByRole("dialog", {
    name: "Program Phase private copy",
  });
  await expect(editor).toContainText("Content group 1");
  await expect(editor).toContainText("Unsaved draft");
  const rows = await get(page, "/api/admin/channels");
  const copy = rows.items.find(
    (c: { name: string }) => c.name === "Phase private copy",
  );
  expect(copy.id).not.toBe(f.ch.id);
  expect(copy.visibility).toBe("private");
  expect(
    (await get(page, `/api/channels/${copy.id}/programming`)).revisionId,
  ).toBeNull();
  page.once("dialog", (d) => d.accept());
  await editor.getByRole("button", { name: "Close dialog" }).click();
});
test("setup, health, effective access and backup recovery instructions are usable", async ({
  page,
}) => {
  await setup(page);
  // Stable visual data; exercise the real status/setup contracts in service tests.
  await page.route("**/api/admin/status", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.checkedMs = Date.UTC(2026, 0, 1, 12);
    data.generation = [];
    data.schedules = [
      {
        id: "visual",
        name: "After School",
        state: "ready",
        coverageEndMs: Date.UTC(2026, 0, 2, 12),
      },
    ];
    await route.fulfill({ response, json: data });
  });
  await page.route("**/api/admin/setup", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: {
        profiles: 1,
        sources: 1,
        availableMedia: 2,
        sourceGrants: 1,
        publishedChannels: 1,
        subscriptions: 1,
        pairedDevices: 0,
      },
    });
  });
  await page.goto("/#operations");
  await expect(
    page.getByRole("heading", { name: "Setup & server health", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Application backups" }),
  ).toBeVisible();
  await expect(
    page.getByText("Custom folders work on their own.", { exact: false }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page).toHaveScreenshot("operations-390.png", {
    fullPage: true,
    mask: [page.getByText(/^Checked /), page.getByText(/Free:/)],
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto("/#profiles");
  await page
    .getByRole("heading", { name: "Living Room", exact: true })
    .locator("..")
    .getByRole("button", { name: "Manage Living Room", exact: true })
    .click();
  const inspect = page.getByRole("combobox", { name: "Inspect account" });
  await inspect.selectOption({ label: "other · editor" });
  await expect(
    page.getByText("Profile viewing denied", { exact: false }),
  ).toBeVisible();
  await inspect.selectOption({ label: "designer · admin" });
  await expect(
    page.getByText(
      "This target account has the administrator access exception.",
    ),
  ).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.goto("/#setup");
  await expect(
    page.getByRole("heading", { name: "Back up and recover the application" }),
  ).toBeVisible();
});
test("caption failure keeps video and controls running; language preferences and browse preserve the session", async ({
  page,
}) => {
  const f = await channel(page, "Phase caption and browse proof");
  await page.route("**/api/playback/sessions/*/negotiate", async (route) => {
    const r = await route.fetch();
    const data = await r.json();
    data.tracks.push({
      index: 92,
      type: "subtitle",
      language: "eng",
      codec: "webvtt",
      title: "Phase captions",
      url: "/api/phase-caption.vtt",
    });
    await route.fulfill({ response: r, json: data });
  });
  await page.route("**/api/phase-caption.vtt", (route) =>
    route.fulfill({ status: 503, body: "Synthetic caption outage" }),
  );
  await page.goto("/#watch");
  await page
    .getByRole("article")
    .filter({ hasText: f.ch.name })
    .getByRole("button", { name: "Watch live" })
    .click();
  const video = page.locator("video");
  await expect
    .poll(() =>
      video.evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0),
    )
    .toBe(true);
  await page.getByRole("combobox", { name: /^Subtitles/ }).selectOption("92");
  await expect(page.getByRole("alert")).toContainText("Subtitles unavailable");
  await expect(page.locator(".player-error")).toHaveCount(0);
  const position = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(position);
  await page.getByRole("combobox", { name: /^Subtitles/ }).selectOption("-1");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Browse channels", exact: true })
    .click();
  const browse = page.getByRole("dialog", { name: "Browse channels" });
  await expect(browse).toContainText("Browse without changing");
  await browse.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Hide controls", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Show controls", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Show controls", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeEnabled();
});

test("library inspection retains missing episodes but prevents selecting them", async ({
  page,
}) => {
  const f = await setup(page);
  let unavailable = false;
  await page.route("**/selection?includeUnavailable=true", async (route) => {
    const response = await route.fetch();
    // Setup mutations rotate CSRF. Let the client perform its normal token retry.
    if (!response.ok()) return route.fulfill({ response });
    const data = await response.json();
    data.items = data.items.map(
      (item: { available: boolean }, index: number) => ({
        ...item,
        available: !unavailable && index > 0,
      }),
    );
    await route.fulfill({ response, json: data });
  });
  await page.goto("/#library");
  await page
    .getByRole("article")
    .filter({ hasText: "Orbit Patrol" })
    .getByRole("button", { name: "Open details" })
    .click();
  const inspector = page.getByRole("dialog", {
    name: "Orbit Patrol",
    exact: true,
  });
  await expect(inspector).toContainText("Unavailable · retained");
  const missing = inspector
    .getByRole("row")
    .filter({ hasText: "Unavailable · retained" })
    .first();
  await expect(missing.getByRole("checkbox")).toBeDisabled();
  await expect(
    inspector.getByRole("checkbox", {
      name: `Select ${f.items[1].title}`,
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    inspector.getByRole("button", {
      name: "Use whole selection in a channel",
      exact: true,
    }),
  ).toBeEnabled();
  unavailable = true;
  await inspector
    .getByRole("combobox", { name: "Season", exact: true })
    .selectOption("1");
  await expect(
    inspector.getByRole("checkbox", {
      name: `Select ${f.items[1].title}`,
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    inspector.getByRole("button", {
      name: "Use whole selection in a channel",
      exact: true,
    }),
  ).toBeDisabled();
});
