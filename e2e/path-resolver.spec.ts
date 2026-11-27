import { selectInitialProfile } from "./workspace";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function openSource(page: Page) {
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
  await page.goto("/#sources");
  await page.getByRole("button", { name: "Add source", exact: true }).click();
  return page.getByRole("dialog", { name: "Add a source", exact: true });
}
const found = {
  status: "found",
  exists: true,
  readableDirectory: true,
  canonicalPath: "/synthetic/manual",
  samples: ["Shows/Example.S01E01.mkv", "Movies/Example.mp4"],
  extensions: { ".mkv": 1, ".mp4": 1 },
  examinedEntries: 256,
  examinedDirectories: 4,
  complete: false,
  reason: "entry-limit",
  maxDepth: 2,
  limit: 256,
  message:
    "Supported file names were found in the checked area. Playback has not been inspected.",
};

test("manual directory checks are explicit, explain partial samples and keep the source draft", async ({
  page,
}) => {
  let checks = 0,
    scans = 0,
    release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  page.on("request", (request) => {
    if (request.url().endsWith("/scan")) scans++;
  });
  await page.route("**/api/admin/setup/check-directory", async (route) => {
    checks++;
    expect(route.request().postDataJSON()).toMatchObject({
      path: "/synthetic/manual",
      purpose: "source",
      recursive: true,
    });
    await held;
    await route.fulfill({ json: found });
  });
  const dialog = await openSource(page),
    path = dialog.getByLabel("Media directory inside MyTuner", { exact: true });
  await path.fill("/synthetic/manual");
  await dialog
    .getByLabel("Source name", { exact: true })
    .fill("My directory draft");
  expect(checks).toBe(0);
  await dialog
    .getByRole("button", { name: "Check directory", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("Checking directory…");
  await expect(
    dialog.getByRole("button", { name: "Cancel check", exact: true }),
  ).toBeVisible();
  release();
  const result = dialog.getByRole("region", {
    name: "Media directory inside MyTuner directory check",
    exact: true,
  });
  await expect(result).toContainText("Directory exists and is readable");
  await expect(result).toContainText("Partial sample; more files may exist");
  await expect(result).toContainText("Playback has not been inspected");
  await result
    .getByText("2 supported file names found", { exact: true })
    .click();
  await expect(result).toContainText("Example.S01E01.mkv");
  await expect(path).toHaveValue("/synthetic/manual");
  await expect(dialog.getByLabel("Source name", { exact: true })).toHaveValue(
    "My directory draft",
  );
  expect(checks).toBe(1);
  expect(scans).toBe(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1024 });
    await expect(dialog).toHaveScreenshot(
      `directory-check-partial-${width}.png`,
    );
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
});

test("late directory replies cannot replace a changed path; missing and checked-empty results stay distinct", async ({
  page,
}) => {
  let checks = 0,
    release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/admin/setup/check-directory", async (route) => {
    checks++;
    const input = route.request().postDataJSON();
    if (input.path === "/synthetic/old") {
      await held;
      await route.fulfill({ json: found }).catch(() => {});
    } else if (input.path === "/synthetic/missing")
      await route.fulfill({
        json: {
          ...found,
          status: "missing",
          exists: false,
          readableDirectory: false,
          canonicalPath: null,
          samples: [],
          extensions: {},
          examinedEntries: 0,
          examinedDirectories: 0,
          message:
            "Directory not found. Check the server-visible path and whether its storage is mounted.",
        },
      });
    else
      await route.fulfill({
        json: {
          ...found,
          status: "empty",
          canonicalPath: input.path,
          samples: [],
          extensions: {},
          complete: true,
          reason: null,
          examinedEntries: 2,
          examinedDirectories: 1,
          maxDepth: 0,
          message: "No supported files were found in the checked area.",
        },
      });
  });
  const dialog = await openSource(page),
    path = dialog.getByLabel("Media directory inside MyTuner", { exact: true });
  await path.fill("/synthetic/old");
  await dialog
    .getByRole("button", { name: "Check directory", exact: true })
    .click();
  await expect.poll(() => checks).toBe(1);
  await path.fill("/synthetic/missing");
  release();
  await expect(
    dialog.getByRole("region", {
      name: "Media directory inside MyTuner directory check",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(path).toHaveValue("/synthetic/missing");
  await dialog
    .getByRole("button", { name: "Check directory", exact: true })
    .click();
  await expect(
    dialog.getByRole("region", {
      name: "Media directory inside MyTuner directory check",
      exact: true,
    }),
  ).toContainText("Directory not found");
  await path.fill("/synthetic/empty");
  await dialog.getByText("Directory check options", { exact: true }).click();
  await dialog
    .getByRole("combobox", { name: "Directory check scope", exact: true })
    .selectOption("shallow");
  await dialog
    .getByRole("button", { name: "Check directory", exact: true })
    .click();
  const result = dialog.getByRole("region", {
    name: "Media directory inside MyTuner directory check",
    exact: true,
  });
  await expect(result).toContainText(
    "No supported files were found in the checked area",
  );
  await expect(result).toContainText("Sample check complete");
  await expect(
    dialog.getByRole("combobox", {
      name: "Directory check scope",
      exact: true,
    }),
  ).toHaveValue("shallow");
  await expect(result).not.toContainText("Directory not found");
  await expect(path).toHaveValue("/synthetic/empty");
});

test("configured source recursion changes invalidate both successful and pending directory checks", async ({
  page,
}) => {
  let checks = 0,
    hold = false,
    release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/admin/setup/check-directory", async (route) => {
    checks++;
    const input = route.request().postDataJSON();
    if (checks === 2) expect(input.recursive).toBe(false);
    if (hold) await held;
    await route
      .fulfill({ json: { ...found, maxDepth: input.recursive ? 2 : 0 } })
      .catch(() => {});
  });
  const dialog = await openSource(page),
    path = dialog.getByLabel("Media directory inside MyTuner", { exact: true });
  await path.fill("/synthetic/manual");
  await dialog
    .getByRole("button", { name: "Check directory", exact: true })
    .click();
  const result = dialog.getByRole("region", {
    name: "Media directory inside MyTuner directory check",
    exact: true,
  });
  await expect(result).toBeVisible();
  await dialog.getByLabel("Include subfolders", { exact: true }).uncheck();
  await expect(result).toHaveCount(0);
  hold = true;
  await dialog
    .getByRole("button", { name: "Check directory", exact: true })
    .click();
  await expect.poll(() => checks).toBe(2);
  await dialog.getByLabel("Include subfolders", { exact: true }).check();
  release();
  await expect(result).toHaveCount(0);
  await expect(path).toHaveValue("/synthetic/manual");
});
