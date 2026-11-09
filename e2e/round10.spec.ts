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
    page.getByRole("heading", { name: "Channels", exact: true }),
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

test("R10-10 scoped integration reloads preserve sibling drafts and the dismissal guard", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#sources");
  let integrationWrites = 0;
  let savedIntegration: {
    provider: string;
    url: string;
    mappings: { from: string; to: string }[];
  } | null = {
    provider: "sonarr",
    url: "http://saved.local:8989",
    mappings: [{ from: "/tv", to: "/synthetic/shows" }],
  };
  await page.route("**/api/sources/*/integration", (route) => {
    const request = route.request();
    if (request.method() !== "GET") {
      integrationWrites++;
      if (request.method() === "DELETE") savedIntegration = null;
      else {
        const { provider, url, mappings } = request.postDataJSON();
        savedIntegration = { provider, url, mappings };
      }
    }
    return route.fulfill({ json: savedIntegration });
  });
  // Exercise real React save/reload transitions with isolated responses; no
  // synthetic path or credentials are sent to the fixture's integration service.
  await page.route("**/api/sources/*/metadata-location", (route) =>
    route.fulfill({ json: {} }),
  );
  await page.route("**/api/sources/*/refresh", (route) =>
    route.fulfill({ json: {} }),
  );
  await page
    .getByRole("button", { name: "Configure TV shows", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  const url = modal.getByLabel("Application URL", { exact: true }),
    key = modal.getByLabel("API key", { exact: true });
  await expect(url).toHaveValue("http://saved.local:8989");
  await url.fill("http://unsaved.local:8989");
  await key.fill("synthetic-unsaved-key");
  const mappings = modal.locator("textarea[name=mappings]");
  await mappings.fill("/changed => /synthetic/draft");
  const form = modal.locator("form").filter({
    has: page.getByRole("button", {
      name: "Save metadata integration",
      exact: true,
    }),
  });
  await modal.locator("input[name=root]").fill("/synthetic/metadata");
  await modal
    .getByRole("button", { name: "Save metadata location", exact: true })
    .click();
  await expect(
    modal.getByText("Metadata location saved.", { exact: true }),
  ).toBeVisible();
  await modal
    .getByRole("button", { name: "Save automatic refresh", exact: true })
    .click();
  await expect(
    modal.getByRole("button", { name: "Save automatic refresh", exact: true }),
  ).toBeEnabled();
  await expect(url).toHaveValue("http://unsaved.local:8989");
  await expect(key).toHaveValue("synthetic-unsaved-key");
  await expect(mappings).toHaveValue("/changed => /synthetic/draft");
  await expect(form).toHaveAttribute("data-form-dirty", "true");
  expect(integrationWrites).toBe(0);
  page.once("dialog", (d) => d.dismiss());
  await page.keyboard.press("Escape");
  await expect(modal).toBeVisible();
  await expect(key).toHaveValue("synthetic-unsaved-key");
  const minutes = modal.getByLabel("Refresh interval (minutes)", {
    exact: true,
  });
  await minutes.fill("23");
  const refreshForm = modal.locator("form").filter({
    has: page.getByRole("button", {
      name: "Save automatic refresh",
      exact: true,
    }),
  });
  await modal
    .getByRole("button", { name: "Save metadata integration", exact: true })
    .click();
  await expect(url).toHaveValue("http://unsaved.local:8989");
  await expect(key).toHaveValue("");
  await expect(mappings).toHaveValue("/changed => /synthetic/draft");
  await expect(minutes).toHaveValue("23");
  await expect(refreshForm).toHaveAttribute("data-form-dirty", "true");
  expect(integrationWrites).toBe(1);
  page.once("dialog", (d) => d.accept());
  await modal
    .getByRole("button", { name: "Disconnect integration", exact: true })
    .click();
  await expect(url).toHaveValue("");
  await expect(key).toHaveValue("");
  await expect(mappings).toHaveValue("");
  await expect(minutes).toHaveValue("23");
  await expect(refreshForm).toHaveAttribute("data-form-dirty", "true");
  expect(integrationWrites).toBe(2);
  // The existing reviewed source form baselines remain unchanged. Accessibility
  // and value assertions cover this additional state without capturing secrets.
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  page.once("dialog", (d) => d.accept());
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
});
