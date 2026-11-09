import { test, expect, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.use({ baseURL: "http://127.0.0.1:8791" });
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("designer");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByLabel("Current profile")
    .selectOption({ label: "Living Room" });
}
async function show(page: Page) {
  await page.goto("/#library");
  await page
    .getByRole("article")
    .filter({ hasText: "Orbit Patrol" })
    .getByRole("button", { name: "Open details" })
    .click();
}
async function video(page: Page) {
  await show(page);
  await page
    .getByRole("button", { name: "Details for The Last Platform", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Video details", exact: true });
}
async function audit(page: Page, target: Locator, image: string) {
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1024 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  await expect(target).toHaveScreenshot(`${image}-narrow.png`);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  if (
    (await target.getAttribute("role")) === "dialog" ||
    (await target.evaluate((e) => e.tagName === "DIALOG"))
  ) {
    const close = target.getByRole("button", {
      name: "Close dialog",
      exact: true,
    });
    if (await close.count()) {
      await close.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(close).toBeFocused();
    }
  }
}
async function fault(page: Page, path: string | RegExp) {
  let mode: number | "hold" | "live" | "offline" = "hold",
    calls = 0,
    release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(path, async (route) => {
    calls++;
    if (mode === "hold") await gate;
    if (mode === "live") return route.continue();
    if (mode === "offline") return route.abort("connectionfailed");
    await route.fulfill({
      status: typeof mode === "number" ? mode : 503,
      json: { error: `Synthetic nested ${mode} failure` },
    });
  });
  return {
    calls: () => calls,
    set: (next: typeof mode) => {
      mode = next;
      release();
    },
  };
}
for (const kind of [
  "metadata",
  "video",
  "subtitles",
  "recent",
  "deleted",
  "access",
  "imports",
] as const) {
  test(`nested ${kind}: pending, unavailable, forbidden, retry, keyboard and responsive visual`, async ({
    page,
  }) => {
    await login(page);
    let panel: Locator, modal: Locator, retry: Locator;
    const patterns = {
      metadata: "**/metadata/inspect",
      video: "**/media/*/details",
      subtitles: "**/media/*/subtitles",
      recent: "**/channels/*/recent",
      deleted: "**/deleted-collections",
      access: "**/api/admin/profiles/*/access/*",
      imports: "**/api/admin/sources/*/imports",
    };
    const f = await fault(page, patterns[kind]);
    if (kind === "metadata") {
      await show(page);
      await page
        .getByRole("button", { name: "Edit information", exact: true })
        .click();
      modal = panel = page.getByRole("dialog", {
        name: "Edit show information",
        exact: true,
      });
    } else if (kind === "video" || kind === "subtitles") {
      modal = await video(page);
      panel =
        kind === "subtitles"
          ? modal.getByRole("region", { name: "Discovered subtitles" })
          : modal;
    } else if (kind === "recent") {
      await page.goto("/#watch");
      await page
        .getByRole("button", { name: /^Recently aired on / })
        .first()
        .click();
      modal = panel = page.getByRole("dialog", {
        name: "Recently aired",
        exact: true,
      });
    } else if (kind === "deleted") {
      await page.goto("/#library");
      await page
        .getByRole("button", { name: "Recently deleted", exact: true })
        .click();
      modal = panel = page.getByRole("dialog", {
        name: "Recently deleted collections",
        exact: true,
      });
    } else if (kind === "access") {
      await page.goto("/#profiles");
      await page
        .getByRole("button", { name: "Manage Living Room", exact: true })
        .click();
      modal = page.getByRole("dialog", {
        name: "Manage Living Room",
        exact: true,
      });
      panel = modal.locator("section").filter({
        has: page.getByRole("heading", {
          name: "Explain account access",
          exact: true,
        }),
      });
    } else {
      await page.goto("/#sources");
      await page
        .getByRole("button", { name: "Configure TV shows", exact: true })
        .click();
      modal = page.getByRole("dialog", {
        name: "Configure TV shows",
        exact: true,
      });
      panel = modal.locator("section").filter({
        has: page.getByRole("heading", {
          name: "Mapping and import review",
          exact: true,
        }),
      });
    }
    await expect.poll(f.calls).toBeGreaterThan(0);
    await expect(
      panel.getByRole("status").filter({ hasText: "Loading" }),
    ).toBeVisible();
    if (kind === "metadata")
      await expect(
        panel.getByRole("button", { name: "Save information" }),
      ).toHaveCount(0);
    f.set(503);
    await expect(panel.getByRole("alert")).toContainText("503 failure");
    retry = panel.getByRole("button", { name: "Try again", exact: true });
    f.set(403);
    await retry.click();
    await expect(panel.getByRole("alert")).toContainText("403 failure");
    await audit(page, modal, kind);
    f.set("offline");
    await retry.click();
    await expect(panel.getByRole("alert")).toContainText("Unable to reach");
    f.set("live");
    await retry.click();
    await expect(panel.getByRole("alert")).toHaveCount(0);
    await expect(
      panel.getByRole("status").filter({ hasText: "Loading" }),
    ).toHaveCount(0);
    if (kind === "metadata")
      await expect(
        panel.getByRole("combobox", { name: "Title source", exact: true }),
      ).toBeVisible();
    if (kind === "video")
      await expect(panel).toContainText("Measured duration");
    if (kind === "subtitles")
      await expect(
        panel.getByRole("button", {
          name: "Check / Rescan subtitles",
          exact: true,
        }),
      ).toBeVisible();
    if (kind === "imports")
      await expect(panel).toContainText("No completed import reports");
    if (kind === "access")
      await expect(panel).toContainText("Profile viewing allowed");
    await page.keyboard.press("Escape");
    await expect(modal).not.toBeVisible();
  });
}
test("TV approval reviews exact identity, guards double submission and recovers expired and offline approval", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#connect-tv");
  await page.getByLabel("TV connection code").fill("ABCDE12345");
  const f = await fault(page, "**/api/auth/pairings/review");
  await page.getByRole("button", { name: "Review TV", exact: true }).click();
  await expect.poll(f.calls).toBe(1);
  await expect(
    page.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  f.set(410);
  await expect(page.getByRole("alert")).toContainText("410 failure");
  await page.unroute("**/api/auth/pairings/review");
  await page.route("**/api/auth/pairings/review", (route) =>
    route.fulfill({
      json: {
        deviceName: "Recognized synthetic family television",
        expiresMs: 1893456000000,
      },
    }),
  );
  await page.getByRole("button", { name: "Review TV", exact: true }).click();
  const review = page.getByRole("region", { name: "Review TV approval" });
  await expect(review).toContainText("Recognized synthetic family television");
  await expect(review).toContainText("ABCDE 12345");
  await audit(page, page.locator("main"), "pairing-review");
  await page.getByLabel("TV connection code").fill("FFFFF00000");
  await expect(review).toHaveCount(0);
  await page.getByRole("button", { name: "Review TV", exact: true }).click();
  await page.route("**/api/auth/pairings/approve", (route) =>
    route.fulfill({
      status: 410,
      json: { error: "Connection code expired; request a new code on the TV" },
    }),
  );
  await page.getByRole("button", { name: "Approve TV", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("expired");
  await expect(
    page.getByRole("status").filter({ hasText: "TV approved" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Cancel approval", exact: true })
    .click();
  await expect(review).toHaveCount(0);
});
test("operations distinguishes unscheduled failed, interrupted and never-checked sources", async ({
  page,
}) => {
  await login(page);
  await page.route("**/api/admin/status", async (route) => {
    const response = await route.fetch(),
      data = await response.json();
    await route.fulfill({
      response,
      json: {
        ...data,
        checkedMs: 1794168000000,
        sources: [
          {
            id: "failed",
            name: "Manual-only failed source",
            readable: true,
            refreshScheduled: false,
            refreshState: "failed",
            lastImportMs: null,
            nextRefreshMs: null,
            lastAttemptMs: 1794168000000,
            lastRefreshMs: null,
            refreshError:
              "Provider unavailable; last successful catalog retained",
          },
          {
            id: "interrupted",
            name: "Interrupted source",
            readable: false,
            refreshState: "incomplete",
            lastImportMs: null,
            nextRefreshMs: null,
          },
          {
            id: "never",
            name: "New source",
            readable: true,
            refreshState: "never",
            lastImportMs: null,
            nextRefreshMs: null,
          },
        ],
        schedules: [],
      },
    });
  });
  await page.goto("/#operations");
  await expect(page.locator("main")).toContainText("Refresh: Failed");
  await expect(page.locator("main")).toContainText(
    "In progress or interrupted",
  );
  await expect(page.locator("main")).toContainText("Not yet checked");
  await expect(page.locator("main")).toContainText("manual checks only");
  await audit(page, page.locator("main"), "operations-refresh-diagnostics");
});
