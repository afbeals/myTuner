import { selectInitialProfile } from "./workspace";
import { test, expect } from "@playwright/test";

test("library refresh returns to a valid page when the catalog shrinks", async ({
  page,
}) => {
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
  // The legacy Library and Channels hashes now share one Network mount.
  await page.goto("/#profiles");
  await expect(
    page.getByRole("heading", { name: "Profiles", exact: true }),
  ).toBeVisible();
  let shrunk = false;
  const sourceId = "11111111-1111-4111-8111-111111111111";
  await page.route("**/api/profiles/*/library?*", async (route) => {
    const offset = Number(
      new URL(route.request().url()).searchParams.get("offset"),
    );
    await route.fulfill({
      json: {
        sources: [{ id: sourceId, name: "Synthetic custom", kind: "videos" }],
        shows: [],
        movies: [],
        movieCollections: [],
        savedCollections: [],
        folders:
          shrunk && offset
            ? []
            : [
                {
                  sourceId,
                  directory: offset ? "Last folder" : "First folder",
                  available: 1,
                },
              ],
        pagination: { offset, limit: 24, total: shrunk ? 1 : 25 },
      },
    });
  });
  await page.goto("/#library");
  await expect(
    page.getByRole("heading", { name: "First folder", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next page →", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Last folder", exact: true }),
  ).toBeVisible();
  shrunk = true;
  await page.getByRole("button", { name: "Refresh view", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "First folder", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("1–1 of 1 permitted items · Page 1", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Next page →", exact: true }),
  ).toBeDisabled();
});

test("main library requests parent cards and keeps the existing show modal and season selection", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname.match(/\/api\/profiles\/[^/]+\/library$/)
    )
      requests.push(request.url());
  });
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("designer");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await selectInitialProfile(page);
  await page.goto("/#library");
  await expect(
    page.getByRole("heading", { name: "Orbit Patrol", exact: true }),
  ).toBeVisible();
  expect(requests.length).toBeGreaterThan(0);
  expect(
    requests.every(
      (url) => new URL(url).searchParams.get("topLevel") === "true",
    ),
  ).toBe(true);
  const library = page.locator(".library-grid");
  await expect(
    library.getByRole("heading", { name: "TV shows", exact: true }),
  ).toHaveCount(0);
  await expect(
    library.getByRole("heading", { name: /Season|Featurettes/ }),
  ).toHaveCount(0);
  await library
    .getByRole("button", { name: "Open details for Orbit Patrol", exact: true })
    .click();
  const modal = page.getByRole("dialog", { name: "Orbit Patrol", exact: true });
  await expect(
    modal.getByRole("combobox", { name: "Season", exact: true }),
  ).toBeVisible();
  await expect(
    modal.getByRole("checkbox", { name: "Include specials", exact: true }),
  ).toBeVisible();
  await expect(modal).toContainText("The Last Platform");
  await expect(modal).toContainText("Maple Street");
  const selectionReply = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/selection") &&
      response.request().postDataJSON().season === 1,
  );
  await modal
    .getByRole("combobox", { name: "Season", exact: true })
    .selectOption("1");
  expect((await selectionReply).status()).toBe(200);
  await expect(modal).toContainText("The Last Platform");
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("admin all-source inspection is explicit, marked, readonly for the profile and resets on profile switch", async ({
  page,
}) => {
  const call = async (path: string, method = "GET", body?: unknown) =>
    page.evaluate(
      async ({ path, method, body }) => {
        const headers: Record<string, string> = {};
        if (method !== "GET") {
          headers["X-CSRF-Token"] = (
            await (await fetch("/api/auth/csrf")).json()
          ).csrfToken;
          if (body !== undefined) headers["Content-Type"] = "application/json";
        }
        const response = await fetch(path, {
          method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (!response.ok)
          throw Error(`${response.status}: ${await response.text()}`);
        return response.status === 204 ? null : response.json();
      },
      { path, method, body },
    );
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("designer");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await selectInitialProfile(page);
  const profiles = await call("/api/profiles"),
    other = profiles.find(
      (profile: { name: string }) => profile.name === "Other Profile",
    );
  const saved = await call(`/api/profiles/${other.id}/configuration`);
  await call(`/api/profiles/${other.id}/configuration`, "PUT", {
    revision: saved.revision,
    grants: [],
  });
  try {
    await page
      .getByLabel("Current profile", { exact: true })
      .selectOption(other.id);
    await page.goto("/#library");
    const toggle = page.getByRole("checkbox", {
      name: "Show all sources",
      exact: true,
    });
    await expect(toggle).not.toBeChecked();
    await expect(
      page.getByRole("heading", { name: "No titles found", exact: true }),
    ).toBeVisible();
    const mutations: string[] = [];
    const track = (request: import("@playwright/test").Request) => {
      if (
        !["GET", "HEAD"].includes(request.method()) &&
        /\/grants|\/configuration/.test(request.url())
      )
        mutations.push(request.url());
    };
    page.on("request", track);
    await toggle.check();
    const grid = page.locator(".library-grid");
    await expect(
      grid.getByRole("heading", { name: "Orbit Patrol", exact: true }),
    ).toBeVisible();
    await expect(grid).toContainText(
      "Includes videos outside Other Profile’s allowed library",
    );
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(
        grid.getByRole("article").filter({
          has: page.getByRole("heading", { name: "Orbit Patrol", exact: true }),
        }),
      ).toHaveScreenshot(`library-restricted-cards-${width}.png`);
    }
    await grid
      .getByRole("button", {
        name: "Open details for Orbit Patrol",
        exact: true,
      })
      .click();
    const modal = page.getByRole("dialog", {
      name: "Orbit Patrol",
      exact: true,
    });
    await expect(modal).toContainText("Inspection only");
    await expect(
      modal.getByRole("checkbox", { name: /^Select / }).first(),
    ).toBeDisabled();
    await expect(
      modal.getByRole("button", { name: /^Program this whole/ }),
    ).toBeDisabled();
    await expect(
      modal.getByRole("button", {
        name: "Select all on this page",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      modal.getByRole("button", { name: /^Add selected videos to tray$/ }),
    ).toBeDisabled();
    await modal.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("button", { name: "Folders and file names", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Folder and filename search" }),
    ).toContainText("Admin inspection of all sources");
    const rows = page.locator(".catalog-results");
    // Root-level episodes live directly in the source; file matching is explicit.
    await page.getByLabel("Match", { exact: true }).selectOption("files");
    await page
      .getByRole("region", { name: "Folder and filename search" })
      .getByRole("button", { name: "Search", exact: true })
      .click();
    await expect(
      rows.getByRole("button", { name: /^Add file / }).first(),
    ).toBeDisabled();
    await page
      .getByLabel("Current profile", { exact: true })
      .selectOption({ label: "Living Room" });
    await expect(toggle).not.toBeChecked();
    await page
      .getByLabel("Current profile", { exact: true })
      .selectOption(other.id);
    await expect(toggle).not.toBeChecked();
    await page
      .getByRole("button", {
        name: "Shows, movies and collections",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: "No titles found", exact: true }),
    ).toBeVisible();
    expect(mutations).toEqual([]);
    page.off("request", track);
    const after = await call(`/api/profiles/${other.id}/configuration`);
    expect(after.grants).toEqual([]);
  } finally {
    const latest = await call(`/api/profiles/${other.id}/configuration`);
    await call(`/api/profiles/${other.id}/configuration`, "PUT", {
      revision: latest.revision,
      grants: saved.grants,
    });
  }
});
