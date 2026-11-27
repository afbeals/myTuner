import { selectInitialProfile } from "./workspace";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.use({ baseURL: "http://127.0.0.1:8791" });
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("designer");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await selectInitialProfile(page);
  await expect(page.getByLabel("Current profile")).not.toHaveValue("");
}

test("R10-09 profile picker clears a locked resource link and opens the chosen permitted profile", async ({
  page,
}) => {
  await login(page);
  const profiles = (await page.evaluate(async () =>
    (await fetch("/api/profiles")).json(),
  )) as { id: string; name: string; locked: boolean; pinProtected: boolean }[];
  const a = profiles[0]!,
    b = profiles[1]!;
  await page.route("**/api/profiles", (route) =>
    route.fulfill({
      json: profiles.map((p) => ({
        ...p,
        locked: p.id === a.id,
        pinProtected: p.id === a.id,
      })),
    }),
  );
  await page.goto(
    `/#channels?profile=${a.id}&channel=11111111-1111-4111-8111-111111111111`,
  );
  await expect(
    page.getByRole("heading", { name: `Unlock ${a.name}`, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Switch profile", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Who’s watching?",
    exact: true,
  });
  await dialog
    .getByRole("button")
    .filter({ has: page.getByText(b.name, { exact: true }) })
    .click();
  await expect(page.getByLabel("Current profile")).toHaveValue(b.id);
  await expect(page).toHaveURL(/\/#channels$/);
  await expect(
    page.getByRole("heading", { name: "My Network", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Opening permitted profile…", { exact: true }),
  ).toHaveCount(0);
  await expect(dialog).toHaveCount(0);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test("R10-10 atomic source saves preserve sibling drafts through a failed save and stage disconnection until Save", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#sources");
  type Configuration = {
    revision: string;
    subtitles: {
      enabled: boolean;
      root: string | null;
      subdirectories: string[];
      maxDepth: number;
    };
    metadataRoot: string | null;
    intervalMs: number | null;
    integration: {
      provider: string;
      url: string;
      hasApiKey?: boolean;
      apiKey?: string;
      mappings: { from: string; to: string }[];
    } | null;
  };
  let writes = 0,
    failNext = true;
  let saved: Configuration | null = null;
  let submitted: Configuration | null = null;
  await page.route("**/api/sources/*/configuration", async (route) => {
    if (route.request().method() === "GET") {
      if (!saved) {
        const response = await route.fetch();
        saved = {
          ...(await response.json()),
          metadataRoot: null,
          intervalMs: null,
          integration: {
            provider: "sonarr",
            url: "http://saved.local:8989",
            hasApiKey: true,
            mappings: [{ from: "/tv", to: "/synthetic/shows" }],
          },
        };
      }
      return route.fulfill({ json: saved });
    }
    writes++;
    submitted = route.request().postDataJSON();
    if (failNext) {
      failNext = false;
      return route.fulfill({
        status: 503,
        json: { error: "Atomic configuration temporarily unavailable" },
      });
    }
    const input = submitted!;
    const integration = input.integration
      ? { ...input.integration, hasApiKey: true }
      : null;
    if (integration) delete integration.apiKey;
    saved = { ...input, revision: `synthetic-revision-${writes}`, integration };
    return route.fulfill({ json: saved });
  });
  const opener = page.getByRole("button", {
    name: "Configure TV shows",
    exact: true,
  });
  await opener.click();
  const modal = page.getByRole("dialog", {
    name: "Configure TV shows",
    exact: true,
  });
  const url = modal.getByLabel("Sonarr address", { exact: true });
  const key = modal.getByLabel("API key", { exact: true });
  const applicationPath = modal.getByLabel("Application path 1", {
    exact: true,
  });
  const myTunerPath = modal.getByLabel("MyTuner path 1", { exact: true });
  const metadata = modal.getByLabel("Separate metadata directory (optional)", {
    exact: true,
  });
  const folders = modal.getByLabel("Subtitle folder names", { exact: true });
  await expect(url).toHaveValue("http://saved.local:8989");
  await url.fill("http://unsaved.local:8989");
  await key.fill("synthetic-unsaved-key");
  await applicationPath.fill("/changed");
  await myTunerPath.fill("/synthetic/draft");
  await metadata.fill("/synthetic/metadata");
  await folders.fill("Subs, CustomCaptions");
  await modal
    .getByRole("combobox", { name: "Scan schedule", exact: true })
    .selectOption("automatic");
  const minutes = modal.getByLabel("Interval in minutes", { exact: true });
  await minutes.fill("23");
  expect(writes).toBe(0);
  await page.keyboard.press("Escape");
  await page
    .locator("dialog.confirmation-dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(modal).toBeVisible();
  await expect(key).toHaveValue("synthetic-unsaved-key");
  await modal
    .getByRole("button", { name: "Save configuration", exact: true })
    .click();
  await expect(modal.getByRole("alert")).toContainText(
    "Atomic configuration temporarily unavailable",
  );
  for (const [field, value] of [
    [url, "http://unsaved.local:8989"],
    [key, "synthetic-unsaved-key"],
    [applicationPath, "/changed"],
    [myTunerPath, "/synthetic/draft"],
    [metadata, "/synthetic/metadata"],
    [folders, "Subs, CustomCaptions"],
    [minutes, "23"],
  ] as const)
    await expect(field).toHaveValue(value);
  await expect(modal.locator("[data-form-dirty]").first()).toHaveAttribute(
    "data-form-dirty",
    "true",
  );
  expect(writes).toBe(1);
  await modal
    .getByRole("button", { name: "Save configuration", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  expect(writes).toBe(2);
  expect(submitted).toMatchObject({
    metadataRoot: "/synthetic/metadata",
    intervalMs: 23 * 60_000,
    subtitles: { subdirectories: ["Subs", "CustomCaptions"] },
    integration: {
      provider: "sonarr",
      url: "http://unsaved.local:8989",
      apiKey: "synthetic-unsaved-key",
      mappings: [{ from: "/changed", to: "/synthetic/draft" }],
    },
  });
  await opener.click();
  await expect(url).toHaveValue("http://unsaved.local:8989");
  await expect(key).toHaveValue("");
  await expect(key).toHaveAttribute("placeholder", "•••••••• · saved key");
  await expect(metadata).toHaveValue("/synthetic/metadata");
  await expect(minutes).toHaveValue("23");
  await modal
    .getByRole("button", { name: "Disconnect on save", exact: true })
    .click();
  await expect(url).toHaveCount(0);
  await expect(modal).toContainText(
    "Disconnection is staged. Cancel keeps the saved connection.",
  );
  await expect(minutes).toHaveValue("23");
  expect(writes).toBe(2);
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .locator("dialog.confirmation-dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(modal).toBeVisible();
  await expect(
    modal.getByRole("button", { name: "Connect Sonarr", exact: true }),
  ).toBeVisible();
  expect(writes).toBe(2);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await modal
    .getByRole("button", { name: "Save configuration", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  expect(writes).toBe(3);
  expect(submitted).toMatchObject({
    integration: null,
    metadataRoot: "/synthetic/metadata",
    intervalMs: 23 * 60_000,
    subtitles: { subdirectories: ["Subs", "CustomCaptions"] },
  });
  await opener.click();
  await expect(
    modal.getByRole("button", { name: "Connect Sonarr", exact: true }),
  ).toBeVisible();
  await expect(metadata).toHaveValue("/synthetic/metadata");
  await expect(minutes).toHaveValue("23");
  await modal
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  await expect(page.locator("dialog.confirmation-dialog")).toHaveCount(0);
});
