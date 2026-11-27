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
test("mount choices stay explicit, filter locally and preserve manual paths without scanning", async ({
  page,
}) => {
  let choices = 0,
    scans = 0;
  await page.route("**/api/admin/setup/path-suggestions?*", async (route) => {
    choices++;
    await route.fulfill({
      json: {
        supported: true,
        error: null,
        items: [
          {
            path: "/synthetic/TV Shows",
            access: "read-only",
            type: "not-checked",
            origin: "process-mount",
          },
          {
            path: "/synthetic/Movies",
            access: "read-only",
            type: "not-checked",
            origin: "process-mount",
          },
        ],
      },
    });
  });
  page.on("request", (request) => {
    if (request.url().endsWith("/scan")) scans++;
  });
  await login(page);
  await page.goto("/#sources");
  await page.getByRole("button", { name: "Add source", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Add a source",
    exact: true,
  });
  const path = dialog.getByLabel("Media directory inside MyTuner", {
    exact: true,
  });
  await path.fill("/synthetic/manual");
  expect(choices).toBe(0);
  await dialog
    .getByRole("button", { name: "Choose media directory", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", {
      name: "Use directory /synthetic/TV Shows",
      exact: true,
    }),
  ).toBeVisible();
  await dialog.getByLabel("Filter source mounts", { exact: true }).fill("TV");
  await dialog
    .getByLabel("Filter source mounts", { exact: true })
    .press("Enter");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", {
      name: "Use directory /synthetic/Movies",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(choices).toBe(1);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1024 });
    await expect(dialog).toHaveScreenshot(`source-mount-choices-${width}.png`);
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
    .getByRole("button", {
      name: "Use directory /synthetic/TV Shows",
      exact: true,
    })
    .focus();
  await page.keyboard.press("Enter");
  await expect(path).toHaveValue("/synthetic/TV Shows");
  await expect(path).toBeFocused();
  await path.fill("/synthetic/still-manual");
  expect(choices).toBe(1);
  expect(scans).toBe(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1024 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
test("provider mapping choices refresh only on request, preview cached samples and discard late connection results", async ({
  page,
}) => {
  await login(page);
  const sources = (await page.evaluate(async () =>
    (await fetch("/api/sources")).json(),
  )) as { id: string; name: string; kind: string; rootPath: string }[];
  const source = sources.find((row) => row.kind === "shows")!;
  source.rootPath = "/synthetic/tv";
  await page.route("**/api/sources", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: sources })
      : route.continue(),
  );
  const state = {
    roots: [
      {
        path: "/provider/tv",
        itemCount: 4,
        origin: "provider-inventory",
        samples: ["/provider/tv/Show"],
      },
    ],
    observedAt: 1_700_000_000_000,
    lastAttemptAt: 1_700_000_000_000,
    error: null,
    stale: false,
    revision: "a".repeat(64),
    sourceRevision: "b".repeat(64),
    configRevision: "c".repeat(64),
    inventoryAvailable: true,
  };
  let refreshes = 0,
    previews = 0,
    scans = 0;
  let releaseLate: (() => void) | undefined;
  let delay = false;
  await page.route(
    `**/api/sources/${source.id}/configuration`,
    async (route) => {
      if (route.request().method() === "GET") {
        const response = await route.fetch();
        await route.fulfill({
          response,
          json: { ...(await response.json()), integration: null },
        });
      } else await route.fallback();
    },
  );
  await page.route(
    `**/api/sources/${source.id}/provider-suggestions`,
    (route) =>
      route.fulfill({ json: { ...state, roots: [], observedAt: null } }),
  );
  await page.route(
    `**/api/sources/${source.id}/provider-suggestions/refresh`,
    async (route) => {
      refreshes++;
      if (delay)
        await new Promise<void>((resolve) => {
          releaseLate = resolve;
        });
      await route.fulfill({ json: state }).catch(() => {});
    },
  );
  await page.route(
    `**/api/sources/${source.id}/provider-suggestions/mapping-preview`,
    async (route) => {
      previews++;
      const input = route.request().postDataJSON();
      expect(input.mappings).toEqual([
        { from: "/provider/tv", to: source.rootPath },
      ]);
      expect(input.inventoryRevision).toBe(state.revision);
      await route.fulfill({
        json: {
          sampled: 1,
          cachedFileCount: 4,
          complete: false,
          needsFileInventory: false,
          items: [
            {
              upstreamPath: "/provider/tv/Show/one.mkv",
              mappedPath: `${source.rootPath}/Show/one.mkv`,
              state: "matched",
            },
          ],
        },
      });
    },
  );
  page.on("request", (request) => {
    if (request.url().endsWith("/scan")) scans++;
  });
  await page.goto("/#sources");
  await page
    .getByRole("button", { name: `Configure ${source.name}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: `Configure ${source.name}`,
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Connect Sonarr", exact: true })
    .click();
  await dialog
    .getByLabel("Sonarr address", { exact: true })
    .fill("http://provider:8989/base");
  await dialog.getByLabel("API key", { exact: true }).fill("synthetic-key");
  expect(refreshes).toBe(0);
  await dialog
    .getByRole("button", { name: "Get application folders", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Use folder mapping", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Application path 1", { exact: true }),
  ).toHaveValue("/provider/tv");
  await expect(
    dialog.getByLabel("MyTuner path 1", { exact: true }),
  ).toHaveValue(source.rootPath);
  await dialog
    .getByRole("button", {
      name: "Check sample mappings",
      exact: true,
    })
    .click();
  await expect(dialog.locator(".bounded-checklist")).toContainText("matched");
  expect(previews).toBe(1);
  expect(refreshes).toBe(1);
  expect(scans).toBe(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1024 });
    await expect(dialog).toHaveScreenshot(
      `provider-mapping-preview-${width}.png`,
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
  delay = true;
  await dialog
    .getByRole("button", { name: "Get application folders", exact: true })
    .click();
  await expect.poll(() => refreshes).toBe(2);
  await dialog
    .getByLabel("Sonarr address", { exact: true })
    .fill("http://other-provider:8989");
  releaseLate!();
  await expect(
    dialog.getByRole("button", {
      name: "Check sample mappings",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(dialog.locator(".bounded-checklist")).toHaveCount(0);
  expect(scans).toBe(0);
});

test("copying a saved provider connection sends only an explicit server reference and retains the manual mapping workflow", async ({
  page,
}) => {
  await login(page);
  const sources = (await page.evaluate(async () =>
    (await fetch("/api/sources")).json(),
  )) as { id: string; name: string; kind: string; rootPath: string }[];
  const source = sources.find((row) => row.kind === "shows")!;
  const reference = "00000000-0000-4000-8000-000000000001";
  await page.route("**/api/admin/setup/provider-connections", (route) =>
    route.fulfill({
      json: [
        {
          sourceId: reference,
          name: "Other shows",
          provider: "sonarr",
          url: "http://provider:8989/base/",
        },
      ],
    }),
  );
  let saved: Record<string, unknown> | null = null;
  await page.route(
    `**/api/sources/${source.id}/configuration`,
    async (route) => {
      if (route.request().method() === "GET") {
        const response = await route.fetch();
        await route.fulfill({
          response,
          json: { ...(await response.json()), integration: null },
        });
      } else {
        saved = route.request().postDataJSON().integration;
        await route.fulfill({ status: 204 });
      }
    },
  );
  await page.goto("/#sources");
  await page
    .getByRole("button", { name: `Configure ${source.name}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: `Configure ${source.name}`,
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Connect Sonarr", exact: true })
    .click();
  await dialog
    .getByRole("combobox", {
      name: "Use a saved connection",
      exact: true,
    })
    .selectOption(reference);
  await expect(
    dialog.getByLabel("Sonarr address", { exact: true }),
  ).toHaveValue("http://provider:8989/base/");
  await expect(dialog.getByLabel("API key", { exact: true })).toHaveValue("");
  await dialog.getByLabel("Application path 1", { exact: true }).fill("/tv");
  await dialog
    .getByLabel("MyTuner path 1", { exact: true })
    .fill(source.rootPath);
  await dialog
    .getByRole("button", { name: "Save configuration", exact: true })
    .click();
  await expect.poll(() => saved).not.toBeNull();
  expect(saved).toMatchObject({
    reuseSourceId: reference,
    provider: "sonarr",
    url: "http://provider:8989/base/",
    mappings: [{ from: "/tv", to: source.rootPath }],
  });
  expect(saved).not.toHaveProperty("apiKey");
});
