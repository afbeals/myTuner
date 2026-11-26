import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
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
test("source editor, saved credentials, scan messages and removal remain usable on narrow screens", async ({
  page,
}) => {
  await login(page);
  const sources = (await page.evaluate(async () =>
    (await fetch("/api/sources")).json(),
  )) as { rootPath: string; kind: string }[];
  const root = sources
    .find((s) => s.kind === "shows")!
    .rootPath.replace(/\/media$/, "/spare");
  await page.goto("/#sources");
  await page.getByRole("button", { name: "+ Add source", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Add a source", exact: true });
  await dialog.getByLabel("Source name", { exact: true }).fill("Source review");
  await dialog.getByLabel("Container media path", { exact: true }).fill(root);
  await dialog.getByRole("button", { name: "Add source", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole("button", { name: "Edit source Source review", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Edit source Source review",
    exact: true,
  });
  await dialog
    .getByLabel("Source name", { exact: true })
    .fill("Reviewed source");
  await dialog.getByLabel("Include subfolders", { exact: true }).uncheck();
  await dialog
    .getByLabel("Container media path", { exact: true })
    .fill("/synthetic/unused-library");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1024 });
    await expect(dialog).toHaveScreenshot(`source-editor-${width}.png`);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await dialog.getByLabel("Container media path", { exact: true }).fill(root);
  await dialog
    .getByRole("button", { name: "Save source", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole("button", { name: "Configure Reviewed source", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Configure Reviewed source",
    exact: true,
  });
  const url = dialog.getByLabel("Application URL", { exact: true }),
    key = dialog.getByLabel("API key", { exact: true }),
    mapping = dialog.locator("textarea[name=mappings]");
  await url.fill("http://127.0.0.1:1");
  await key.fill("synthetic-retained-key");
  await mapping.fill(`/tv => ${root}`);
  await dialog
    .getByRole("button", { name: "Save metadata integration", exact: true })
    .click();
  await expect(key).toHaveValue("");
  await expect(key).toHaveAttribute("placeholder", "******** (saved)");
  await mapping.fill(`/changed => ${root}`);
  const saved = page.waitForRequest(
    (r) => r.method() === "PUT" && r.url().endsWith("/integration"),
  );
  await dialog
    .getByRole("button", { name: "Save metadata integration", exact: true })
    .click();
  expect((await saved).postDataJSON()).not.toHaveProperty("apiKey");
  await expect(mapping).toHaveValue(`/changed => ${root}`);
  await expect(
    dialog.getByRole("button", {
      name: "Save metadata integration",
      exact: true,
    }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  const card = page.locator("section.panel").filter({
    has: page.getByRole("heading", { name: "Reviewed source", exact: true }),
  });
  let mode = "success";
  await page.route("**/api/sources/*/scan", (route) =>
    mode === "error"
      ? route.fulfill({
          status: 503,
          json: { error: "Synthetic scan unavailable" },
        })
      : route.fulfill({
          json: {
            seen: 2,
            updated: 2,
            missing: 0,
            complete: mode === "success",
            errors:
              mode === "success"
                ? []
                : [
                    {
                      path: "synthetic.mp4",
                      message: "Synthetic inspection failure",
                    },
                  ],
            imported: { matched: 2, unmatched: 3 },
          },
        }),
  );
  await card
    .getByRole("button", { name: "Scan & refresh metadata", exact: true })
    .click();
  await expect(card.getByRole("status")).toContainText(
    "Scan completed. 2 videos found; 0 scan errors. Metadata matched: 2; unmatched: 3.",
  );
  mode = "partial";
  await card
    .getByRole("button", { name: "Scan & refresh metadata", exact: true })
    .click();
  await expect(card.getByRole("status")).toContainText(
    "Scan completed with issues",
  );
  await expect(card).toHaveScreenshot("source-scan-partial-390.png", {
    mask: [card.locator(":scope > p").first()],
  });
  mode = "error";
  await card
    .getByRole("button", { name: "Scan & refresh metadata", exact: true })
    .click();
  await expect(card.getByRole("alert")).toContainText(
    "Synthetic scan unavailable",
  );
  await expect(card).toHaveScreenshot("source-scan-failure-390.png", {
    mask: [card.locator(":scope > p").first()],
  });
  page.once("dialog", (d) => d.accept());
  await card
    .getByRole("button", { name: "Remove source Reviewed source", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Reviewed source", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    "Original files were not changed",
  );
});
test("profile library grants show compact source and subfolder rows with a named remove action", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#profiles");
  await page
    .getByRole("button", { name: "Manage Living Room", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Manage Living Room",
    exact: true,
  });
  await dialog
    .getByLabel("Source", { exact: true })
    .selectOption({ label: "TV shows" });
  await dialog.getByLabel("Subfolder", { exact: true }).fill("Focused folder");
  await dialog
    .getByRole("button", { name: "Add library grant", exact: true })
    .click();
  const row = dialog
    .locator(".grant-row")
    .filter({ hasText: "Focused folder" });
  await expect(
    row.getByRole("button", {
      name: "Remove grant for TV shows, Focused folder",
      exact: true,
    }),
  ).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1024 });
    await row.scrollIntoViewIfNeeded();
    await expect(row).toHaveScreenshot(`profile-grant-${width}.png`);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  page.once("dialog", (d) => d.accept());
  await row
    .getByRole("button", {
      name: "Remove grant for TV shows, Focused folder",
      exact: true,
    })
    .click();
  await expect(row).toHaveCount(0);
});
test("library browsing requests bounded pages from the server", async ({
  page,
}) => {
  await login(page);
  const response = page.waitForResponse(
    (r) =>
      r.url().includes("/library?") &&
      new URL(r.url()).searchParams.get("limit") === "24",
  );
  await page.goto("/#library");
  const data = await (await response).json();
  expect(data.pagination.limit).toBe(24);
  expect(
    data.shows.length +
      data.movies.length +
      data.folders.length +
      data.movieCollections.length +
      data.savedCollections.length,
  ).toBeLessThanOrEqual(24);
  await expect(
    page.getByRole("heading", { name: "Your library", exact: true }),
  ).toBeVisible();
});

test("scanned subfolder choices are paged, searchable, keyboard usable and reset when the source changes", async ({
  page,
}) => {
  await login(page);
  const sources = (await page.evaluate(async () =>
    (await fetch("/api/sources")).json(),
  )) as { id: string; name: string; kind: string; rootPath: string }[];
  const extra = await page.evaluate(
    async (root) => {
      const { csrfToken } = await (await fetch("/api/auth/csrf")).json();
      const response = await fetch("/api/sources", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({
          name: "Directory choices",
          root,
          kind: "videos",
          recursive: true,
        }),
      });
      if (!response.ok) throw Error(await response.text());
      return response.json();
    },
    sources
      .find((s) => s.kind === "shows")!
      .rootPath.replace(/\/media$/, "/spare"),
  );
  sources.push(extra);
  const first = sources.find((s) => s.kind === "shows")!;
  let requests = 0,
    unintendedSaves = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/(grants|generation\/preview)$/.test(new URL(request.url()).pathname)
    )
      unintendedSaves++;
  });
  await page.route("**/api/sources/*/directories?*", async (route) => {
    requests++;
    const params = new URL(route.request().url()).searchParams;
    expect(params.get("limit")).toBe("50");
    const offset = Number(params.get("offset"));
    const items = params.get("search")
      ? ["Library/Focused folder"]
      : offset
        ? ["Library/Last folder"]
        : Array.from({ length: 50 }, (_, i) => `Library/Folder ${i}`);
    await route.fulfill({
      json: {
        items,
        hasMore: !offset && !params.get("search"),
        limit: 50,
        offset,
      },
    });
  });
  await page.goto("/#generated");
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Preview scope", exact: true }),
  });
  const input = form.getByLabel("Folder within source", { exact: true });
  await form
    .getByRole("combobox", { name: "Source", exact: true })
    .selectOption(first.id);
  await expect(form).toHaveAttribute("data-form-dirty", "true");
  expect(requests).toBe(0);
  await form
    .getByRole("button", { name: "Browse subfolders", exact: true })
    .click();
  await expect(
    form.getByRole("button", { name: "Library/Folder 0", exact: true }),
  ).toBeVisible();
  expect(await form.locator(".directory-options li").count()).toBe(50);
  await form.getByRole("button", { name: "More folders", exact: true }).click();
  await expect(
    form.getByRole("button", { name: "Library/Last folder", exact: true }),
  ).toBeVisible();
  await form.getByLabel("Find subfolder", { exact: true }).fill("Focused");
  await form.getByLabel("Find subfolder", { exact: true }).press("Enter");
  const choice = form.getByRole("button", {
    name: "Library/Focused folder",
    exact: true,
  });
  await expect(choice).toBeVisible();
  await page.setViewportSize({ width: 390, height: 1024 });
  await expect(form.locator(".directory-field")).toHaveScreenshot(
    "source-subfolder-picker-390.png",
  );
  await choice.focus();
  await page.keyboard.press("Enter");
  await expect(input).toHaveValue("Library/Focused folder");
  await expect(input).toBeFocused();
  const other = extra;
  await form
    .getByRole("combobox", { name: "Source", exact: true })
    .selectOption(other.id);
  await expect(input).toHaveValue("");
  await input.fill("Unscanned/manual");
  await expect(input).toHaveValue("Unscanned/manual");
  page.once("dialog", (d) => d.accept());
  await page.goto("/#profiles");
  await page
    .getByRole("button", { name: "Manage Living Room", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Manage Living Room",
    exact: true,
  });
  const grant = dialog.locator("form").filter({
    has: page.getByRole("button", { name: "Add library grant", exact: true }),
  });
  await grant
    .getByRole("button", { name: "Browse subfolders", exact: true })
    .click();
  await grant.getByLabel("Find subfolder", { exact: true }).fill("Focused");
  await grant.getByLabel("Find subfolder", { exact: true }).press("Enter");
  await expect(grant).toHaveAttribute("data-form-dirty", "false");
  await grant
    .getByRole("button", { name: "Library/Focused folder", exact: true })
    .click();
  await expect(grant.getByLabel("Subfolder", { exact: true })).toHaveValue(
    "Library/Focused folder",
  );
  await expect(grant).toHaveAttribute("data-form-dirty", "true");
  expect(unintendedSaves).toBe(0);
  await page.evaluate(async (id) => {
    const { csrfToken } = await (await fetch("/api/auth/csrf")).json();
    const response = await fetch(`/api/sources/${id}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    });
    if (!response.ok) throw Error(await response.text());
  }, extra.id);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});
