import { selectInitialProfile } from "./workspace";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("designer");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await selectInitialProfile(page);
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
  await page.getByRole("button", { name: "Add source", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Add a source", exact: true });
  await dialog.getByLabel("Source name", { exact: true }).fill("Source review");
  await dialog
    .getByLabel("Media directory inside MyTuner", { exact: true })
    .fill(root);
  await dialog.getByRole("button", { name: "Add source", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole("button", { name: "Edit Source review", exact: true })
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
    .getByLabel("Media directory inside MyTuner", { exact: true })
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
  await dialog
    .getByLabel("Media directory inside MyTuner", { exact: true })
    .fill(root);
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
  await dialog
    .getByRole("button", { name: "Connect Sonarr", exact: true })
    .click();
  await dialog
    .getByLabel("Sonarr address", { exact: true })
    .fill("http://127.0.0.1:1");
  await dialog
    .getByLabel("API key", { exact: true })
    .fill("synthetic-retained-key");
  await dialog.getByLabel("Application path 1", { exact: true }).fill("/tv");
  await dialog.getByLabel("MyTuner path 1", { exact: true }).fill(root);
  await dialog
    .getByRole("button", { name: "Save configuration", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole("button", { name: "Configure Reviewed source", exact: true })
    .click();
  const key = dialog.getByLabel("API key", { exact: true });
  await expect(key).toHaveValue("");
  await expect(key).toHaveAttribute("placeholder", "•••••••• · saved key");
  await dialog
    .getByLabel("Application path 1", { exact: true })
    .fill("/changed");
  const saved = page.waitForRequest(
    (request) =>
      request.method() === "PUT" && request.url().endsWith("/configuration"),
  );
  await dialog
    .getByRole("button", { name: "Save configuration", exact: true })
    .click();
  expect((await saved).postDataJSON().integration).not.toHaveProperty("apiKey");
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole("button", { name: "Configure Reviewed source", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Application path 1", { exact: true }),
  ).toHaveValue("/changed");
  await expect(
    dialog.getByRole("button", { name: "Save configuration", exact: true }),
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
    .getByRole("button", { name: "Scan and refresh", exact: true })
    .click();
  const scan = page.getByRole("dialog", {
    name: "Scan Reviewed source",
    exact: true,
  });
  await scan.getByRole("button", { name: "Start scan", exact: true }).click();
  const results = scan.getByRole("region", {
    name: "Scan results",
    exact: true,
  });
  await expect(results.getByRole("heading")).toHaveText("Scan completed");
  await expect(results).toContainText(
    "2 videos found · 2 updated · 0 missing · 0 errors",
  );
  await expect(results).toContainText("Metadata: 2 matched · 3 unmatched");
  mode = "partial";
  await scan.getByRole("button", { name: "Start scan", exact: true }).click();
  await expect(results.getByRole("heading")).toHaveText(
    "Scan completed with issues",
  );
  await results.getByText("File errors", { exact: true }).click();
  await expect(results).toContainText("Synthetic inspection failure");
  await expect(scan).toHaveScreenshot("source-scan-partial-390.png", {
    mask: [scan.locator("section.settings-section > p").first()],
  });
  mode = "error";
  await scan.getByRole("button", { name: "Start scan", exact: true }).click();
  await expect(scan.getByRole("alert")).toContainText(
    "Synthetic scan unavailable",
  );
  await expect(scan).toHaveScreenshot("source-scan-failure-390.png", {
    mask: [scan.locator("section.settings-section > p").first()],
  });
  await scan.getByRole("button", { name: "Close dialog", exact: true }).click();
  await card
    .getByRole("button", { name: "Remove source Reviewed source", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "Remove Reviewed source?",
    exact: true,
  });
  await expect(confirmation).toContainText(
    "Original videos and metadata files are kept",
  );
  await confirmation
    .getByRole("button", { name: "Remove source", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Reviewed source", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    "Source removed: Reviewed source.",
  );
});

test("profile library grants show compact source and subfolder rows with staged checkbox removal", async ({
  page,
}) => {
  await login(page);
  const profileId = await page
    .getByLabel("Current profile", { exact: true })
    .inputValue();
  const originalGrants = await page.evaluate(
    async (id) =>
      (await (await fetch(`/api/profiles/${id}/configuration`)).json()).grants,
    profileId,
  );
  try {
    await page.route("**/api/profiles/*/catalog/tree?*", (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: "focused",
              path: "Focused folder",
              label: "Focused folder",
              count: 1,
            },
          ],
          hasMore: false,
          offset: 0,
          limit: 50,
          revision: 1,
        },
      }),
    );
    await page.goto("/#profiles");
    await page
      .getByRole("button", { name: "Manage Living Room", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Manage Living Room",
      exact: true,
    });
    const sourceChoice = dialog.getByRole("combobox", {
      name: "Library source",
      exact: true,
    });
    await expect(
      sourceChoice.getByRole("option", { name: "TV shows", exact: true }),
    ).toHaveCount(1);
    await sourceChoice.selectOption({ label: "TV shows" });
    await dialog
      .getByRole("button", { name: "Choose folders", exact: true })
      .click();
    const tree = page.getByRole("dialog", {
      name: "Allowed library folders",
      exact: true,
    });
    await tree
      .getByRole("checkbox", { name: "TV shows · Entire source", exact: true })
      .uncheck();
    await tree
      .getByRole("checkbox", {
        name: "Select folder Focused folder",
        exact: true,
      })
      .check();
    await tree
      .getByRole("button", { name: "Apply selection", exact: true })
      .click();
    const row = dialog
      .locator(".grant-row")
      .filter({ hasText: "Focused folder" });
    await expect(row.getByRole("checkbox")).toBeChecked();
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
    await dialog
      .getByRole("button", { name: "Save profile", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await page
      .getByRole("button", { name: "Manage Living Room", exact: true })
      .click();
    await expect(row.getByRole("checkbox")).toBeChecked();
    await row.getByRole("checkbox").click();
    await expect(row).toHaveCount(0);
    // Restore the synthetic profile's original whole-source grant before saving.
    await sourceChoice.selectOption({ label: "TV shows" });
    await dialog
      .getByRole("button", { name: "Choose folders", exact: true })
      .click();
    await tree
      .getByRole("checkbox", { name: "TV shows · Entire source", exact: true })
      .check();
    await tree
      .getByRole("button", { name: "Apply selection", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Save profile", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
  } finally {
    // Saving a narrower grant is part of this scenario. Always restore it so a
    // later assertion failure cannot restrict other tests' synthetic library.
    await page.evaluate(
      async ({ profileId, grants }) => {
        const current = await (
          await fetch(`/api/profiles/${profileId}/configuration`)
        ).json();
        const { csrfToken } = await (await fetch("/api/auth/csrf")).json();
        const response = await fetch(
          `/api/profiles/${profileId}/configuration`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": csrfToken,
            },
            body: JSON.stringify({ revision: current.revision, grants }),
          },
        );
        if (!response.ok) throw Error(await response.text());
      },
      { profileId, grants: originalGrants },
    );
  }
});
test("library browsing requests bounded pages from the server", async ({
  page,
}) => {
  await login(page);
  // Both legacy hashes keep the Network mounted; leave it before observing a fresh page read.
  await page.goto("/#profiles");
  await expect(
    page.getByRole("heading", { name: "Profiles", exact: true }),
  ).toBeVisible();
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

test("scanned subfolder choices load bounded pages and children, cache while open, support keyboard selection and reset with the source", async ({
  page,
}) => {
  await login(page);
  const sources = (await page.evaluate(async () =>
    (await fetch("/api/sources")).json(),
  )) as { id: string; name: string; kind: string; rootPath: string }[];
  const first = sources.find((source) => source.kind === "shows")!;
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
    first.rootPath.replace(/\/media$/, "/spare"),
  );
  try {
    let requests = 0,
      unintendedSaves = 0;
    page.on("request", (request) => {
      if (
        ["PUT", "POST"].includes(request.method()) &&
        /\/(configuration|grants|generation\/preview)$/.test(
          new URL(request.url()).pathname,
        )
      )
        unintendedSaves++;
    });
    await page.route("**/api/profiles/*/catalog/tree?*", async (route) => {
      requests++;
      const params = new URL(route.request().url()).searchParams;
      expect(params.get("limit")).toBe("50");
      const offset = Number(params.get("offset")),
        parent = params.get("parent") ?? "";
      const names = parent
        ? [parent + "/Focused folder"]
        : offset
          ? ["Library/Last folder"]
          : Array.from({ length: 50 }, (_, index) => `Library/Folder ${index}`);
      await route.fulfill({
        json: {
          items: names.map((path) => ({
            id: path,
            path,
            label: path.split("/").at(-1),
            count: 1,
          })),
          hasMore: !parent && !offset,
          limit: 50,
          offset,
          revision: 1,
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
    const browse = form.getByRole("button", {
      name: "Browse subfolders",
      exact: true,
    });
    await browse.click();
    const tree = page.getByRole("dialog", {
      name: "Folder within source",
      exact: true,
    });
    await expect(
      tree.getByRole("button", {
        name: "Open folder Library/Folder 0",
        exact: true,
      }),
    ).toBeVisible();
    expect(await tree.locator(".tree-row").count()).toBeLessThanOrEqual(22);
    const viewport = tree.getByRole("region", {
      name: "Folder choices",
      exact: true,
    });
    await viewport.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event("scroll"));
    });
    await tree
      .getByRole("button", { name: "More folders", exact: true })
      .click();
    await expect(
      tree.getByRole("checkbox", {
        name: "Select folder Library/Last folder",
        exact: true,
      }),
    ).toBeVisible();
    const fetched = requests;
    await tree
      .getByRole("button", { name: "Earlier folders", exact: true })
      .click();
    await viewport.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll"));
    });
    await expect(
      tree.getByRole("button", {
        name: "Open folder Library/Folder 0",
        exact: true,
      }),
    ).toBeVisible();
    expect(requests).toBe(fetched);
    await tree
      .getByRole("button", {
        name: "Open folder Library/Folder 0",
        exact: true,
      })
      .click();
    const choice = tree.getByRole("checkbox", {
      name: "Select folder Library/Folder 0/Focused folder",
      exact: true,
    });
    await expect(choice).toBeVisible();
    await page.setViewportSize({ width: 390, height: 1024 });
    await expect(tree).toHaveScreenshot("source-subfolder-picker-390.png");
    await choice.focus();
    await page.keyboard.press("Space");
    await tree
      .getByRole("button", { name: "Apply selection", exact: true })
      .click();
    await expect(input).toHaveValue("Library/Folder 0/Focused folder");
    await expect(browse).toBeFocused();
    await form
      .getByRole("combobox", { name: "Source", exact: true })
      .selectOption(extra.id);
    await expect(input).toHaveValue("");
    await input.fill("Unscanned/manual");
    await expect(input).toHaveValue("Unscanned/manual");
    // This scenario deliberately remains at the narrow viewport after its visual.
    // Let click wait for the responsive menu instead of sampling visibility once.
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("link", { name: "Profiles", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .last()
      .getByRole("button", { name: "Discard changes", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Manage Living Room", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Manage Living Room",
      exact: true,
    });
    await dialog
      .getByRole("combobox", { name: "Library source", exact: true })
      .selectOption(first.id);
    await dialog
      .getByRole("button", { name: "Choose folders", exact: true })
      .click();
    const grants = page.getByRole("dialog", {
      name: "Allowed library folders",
      exact: true,
    });
    await expect(dialog.locator("[data-form-dirty]").first()).toHaveAttribute(
      "data-form-dirty",
      "false",
    );
    await grants
      .getByRole("checkbox", { name: "TV shows · Entire source", exact: true })
      .uncheck();
    await grants
      .getByRole("button", {
        name: "Open folder Library/Folder 0",
        exact: true,
      })
      .click();
    await grants
      .getByRole("checkbox", {
        name: "Select folder Library/Folder 0/Focused folder",
        exact: true,
      })
      .check();
    await grants
      .getByRole("button", { name: "Apply selection", exact: true })
      .click();
    await expect(
      dialog
        .locator(".grant-row")
        .filter({ hasText: "Library/Folder 0/Focused folder" }),
    ).toBeVisible();
    await expect(dialog.locator("[data-form-dirty]").first()).toHaveAttribute(
      "data-form-dirty",
      "true",
    );
    expect(unintendedSaves).toBe(0);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  } finally {
    await page.evaluate(async (id) => {
      const { csrfToken } = await (await fetch("/api/auth/csrf")).json();
      const response = await fetch(`/api/sources/${id}`, {
        method: "DELETE",
        headers: { "X-CSRF-Token": csrfToken },
      });
      if (!response.ok) throw Error(await response.text());
    }, extra.id);
  }
});
