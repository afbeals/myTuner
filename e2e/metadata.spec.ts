import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.use({ baseURL: "http://127.0.0.1:8786" });
test("metadata modal preserves failed drafts, previews file availability and updates display without renaming source", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-08T12:00:00-08:00"));
  await page.route("**/metadata/check", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), checkedMs: 1794168000000 },
    });
  });
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("designer");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByLabel("Current profile")
    .selectOption({ label: "Living Room" });
  await page.goto("/#library");
  await page
    .getByRole("article")
    .filter({ hasText: "Orbit Patrol" })
    .getByRole("button", { name: "Open details" })
    .click();
  await page
    .getByRole("button", { name: "Edit information", exact: true })
    .click();
  const modal = page.getByRole("dialog", { name: "Edit show information" });
  await modal
    .getByRole("combobox", { name: "Title source", exact: true })
    .selectOption("manual");
  await modal
    .getByLabel("Manual title", { exact: true })
    .fill("Metadata proof show");
  await modal
    .getByRole("combobox", { name: "Description source", exact: true })
    .selectOption("manual");
  await modal
    .getByLabel("Manual description", { exact: true })
    .fill("A custom description with <b>plain text</b>.");
  page.once("dialog", (d) => d.dismiss());
  await page.keyboard.press("Escape");
  await expect(modal).toBeVisible();
  await page.route(
    "**/metadata/save",
    (route) =>
      route.fulfill({
        status: 409,
        json: {
          error:
            "Content changed elsewhere; review the latest information before saving",
        },
      }),
    { times: 1 },
  );
  await modal
    .getByRole("button", { name: "Save information", exact: true })
    .click();
  await expect(modal.getByRole("alert")).toContainText("changed elsewhere");
  await expect(modal.getByLabel("Manual title", { exact: true })).toHaveValue(
    "Metadata proof show",
  );
  await modal
    .getByRole("button", { name: "Check metadata files", exact: true })
    .click();
  await expect(modal).toContainText("no-file");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1024 });
    await modal.evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(modal).toHaveScreenshot(`metadata-editor-${width}.png`);
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
  await modal
    .getByRole("button", { name: "Save information", exact: true })
    .click();
  await expect(modal).toContainText("Information saved.");
  await modal
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Metadata proof show", exact: true }),
  ).toBeVisible();
  // Restore the shared synthetic fixture after proving the saved presentation.
  await page
    .getByRole("article")
    .filter({ hasText: "Metadata proof show" })
    .getByRole("button", { name: "Open details" })
    .click();
  await page
    .getByRole("button", { name: "Edit information", exact: true })
    .click();
  await modal
    .getByRole("combobox", { name: "Title source", exact: true })
    .selectOption("automatic");
  await modal
    .getByRole("combobox", { name: "Description source", exact: true })
    .selectOption("automatic");
  await modal
    .getByRole("button", { name: "Save information", exact: true })
    .click();
  await expect(modal).toContainText("Information saved.");
});
