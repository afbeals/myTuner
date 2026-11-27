import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { selectInitialProfile } from "./workspace";
import type { Library, Media } from "../web/src/types";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("designer");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await selectInitialProfile(page);
  await page
    .getByLabel("Current profile", { exact: true })
    .selectOption({ label: "Living Room" });
  return page.getByLabel("Current profile", { exact: true }).inputValue();
}
async function api<T>(
  page: Page,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  return page.evaluate(
    async ({ path, method, body }) => {
      const headers: Record<string, string> = {};
      if (method !== "GET") {
        if (body !== undefined) headers["Content-Type"] = "application/json";
        headers["X-CSRF-Token"] = (
          await (await fetch("/api/auth/csrf")).json()
        ).csrfToken;
      }
      const response = await fetch(path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok)
        throw new Error(`${response.status}: ${await response.text()}`);
      return response.status === 204 ? null : response.json();
    },
    { path, method, body },
  );
}
async function media(page: Page, profileId: string) {
  return (
    await api<{ items: Media[] }>(
      page,
      `/api/profiles/${profileId}/media?limit=50`,
    )
  ).items.filter((item) => item.available);
}

test("a lost successful collection response retries one draft and the same saved link opens repeatedly", async ({
  page,
}) => {
  const profileId = await login(page);
  const name = `Retry collection ${randomUUID()}`;
  const creationIds: string[] = [];
  let dropped = false;
  await page.route(
    `**/api/profiles/${profileId}/collections`,
    async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      creationIds.push(route.request().postDataJSON().creationId);
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      if (!dropped) {
        dropped = true;
        await route.abort("connectionfailed");
      } else await route.fulfill({ response });
    },
  );
  await page
    .getByRole("button", { name: "Create collection", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Create collection",
    exact: true,
  });
  await editor.getByLabel("Collection name", { exact: true }).fill(name);
  await editor
    .getByRole("checkbox", { name: /^Include / })
    .first()
    .check();
  await editor
    .getByRole("button", { name: "Save collection", exact: true })
    .click();
  await expect(editor.getByRole("alert")).toContainText("Unable to reach");
  await expect(
    editor.getByLabel("Collection name", { exact: true }),
  ).toHaveValue(name);
  await expect(
    editor.getByRole("heading", { name: "1 selected video", exact: true }),
  ).toBeVisible();
  await editor
    .getByRole("button", { name: "Save collection", exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  expect(creationIds).toHaveLength(2);
  expect(creationIds[0]).toMatch(/^[a-f0-9-]{36}$/i);
  expect(creationIds[1]).toBe(creationIds[0]);
  const saved = (
    await api<{ items: { id: string; name: string }[] }>(
      page,
      `/api/profiles/${profileId}/collections`,
    )
  ).items.filter((item) => item.name === name);
  expect(saved).toHaveLength(1);
  const savedLink = page.getByRole("link", {
    name: `Open saved collection · ${name}`,
    exact: true,
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    await savedLink.click();
    const details = page.getByRole("dialog", { name, exact: true });
    await expect(details).toBeVisible();
    await expect(
      details.getByRole("checkbox", { name: /^Select / }),
    ).toHaveCount(1);
    await details
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(details).not.toBeVisible();
  }
  await api(
    page,
    `/api/profiles/${profileId}/collections/${saved[0]!.id}`,
    "DELETE",
  );
});

test("deep duplicate filenames keep review identity and narrow actions fit inside their own result list", async ({
  page,
}, testInfo) => {
  const profileId = await login(page);
  const original = (await media(page, profileId)).slice(0, 2);
  expect(original).toHaveLength(2);
  const paths = [
    "Nature/2026/Set 08/River/Night/Camera A/Highlight.mp4",
    "Travel/2025/Set 03/Coast/Dawn/Camera A/Highlight.mp4",
  ];
  const references = original.map((item, index) => ({
    ...item,
    title: "Highlight",
    relativePath: paths[index]!,
  }));
  await page.route("**/api/profiles/*/catalog/tree?*", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    await route.fulfill({
      json: {
        items:
          query.get("mode") === "files"
            ? references.map((item) => ({
                id: item.id,
                sourceId: item.sourceId,
                path: item.relativePath,
                label: item.title,
                kind: "file",
                count: 1,
              }))
            : [],
        total: query.get("mode") === "files" ? 2 : 0,
        hasMore: false,
        revision: 100,
      },
    });
  });
  await page.route("**/api/profiles/*/selection?*", async (route) => {
    const selection = route.request().postDataJSON();
    if (selection.type !== "media") return route.continue();
    const items = references.filter((item) => selection.ids.includes(item.id));
    await route.fulfill({ json: { items, total: items.length } });
  });
  await page.goto("/#library");
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Folders and file names", exact: true })
    .click();
  const search = page.getByRole("region", {
    name: "Folder and filename search",
    exact: true,
  });
  await search.getByLabel("Match", { exact: true }).selectOption("files");
  await search
    .getByLabel("Find folders or files", { exact: true })
    .fill("Highlight");
  await search.getByLabel("Search subfolders", { exact: true }).check();
  await search.getByRole("button", { name: "Search", exact: true }).click();
  const rows = search.locator(".catalog-result");
  await expect(rows).toHaveCount(2);
  const geometry = await rows.evaluateAll((elements) =>
    elements.map((row) => {
      const list = row.closest(".catalog-results")!;
      const bounds = list.getBoundingClientRect();
      const action = row.querySelector("button")!.getBoundingClientRect();
      return {
        left: action.left,
        right: action.right,
        listLeft: bounds.left,
        listRight: bounds.left + list.clientWidth,
        rowWidth: row.clientWidth,
        rowScrollWidth: row.scrollWidth,
      };
    }),
  );
  for (const bounds of geometry) {
    expect(bounds.left).toBeGreaterThanOrEqual(bounds.listLeft);
    expect(bounds.right).toBeLessThanOrEqual(bounds.listRight + 1);
    expect(bounds.rowScrollWidth).toBeLessThanOrEqual(bounds.rowWidth + 1);
  }
  await rows
    .nth(0)
    .getByRole("button", { name: /^Add file / })
    .focus();
  await page.keyboard.press("Enter");
  await rows
    .nth(1)
    .getByRole("button", { name: /^Add file / })
    .click();
  const tray = page.getByRole("region", {
    name: "Selection tray",
    exact: true,
  });
  await tray.getByText("Review selected videos", { exact: true }).click();
  await expect(tray).toContainText(paths[0]!);
  await expect(tray).toContainText(paths[1]!);
  const removes = tray.getByRole("button", {
    name: /^Remove Highlight .* from tray$/,
  });
  await expect(removes).toHaveCount(2);
  const names = await removes.evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute("aria-label")),
  );
  expect(new Set(names).size).toBe(2);
  await tray
    .getByRole("button", {
      name: /Remove Highlight .*Travel\/2025.* from tray$/,
    })
    .click();
  await expect(tray).toContainText("Selection tray · 1 video");
  await expect(tray).not.toContainText(paths[1]!);
  await expect(tray).toContainText(paths[0]!);
  await testInfo.attach("deep-result-and-selection-390", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test("collection totals retain missing members, edit impact is named, and the open header reconciles after save", async ({
  page,
}) => {
  const profileId = await login(page);
  const items = (await media(page, profileId)).slice(0, 2);
  const name = `Count recovery ${randomUUID()}`;
  const saved = await api<{ id: string }>(
    page,
    `/api/profiles/${profileId}/collections`,
    "POST",
    { creationId: randomUUID(), name, mediaIds: items.map((item) => item.id) },
  );
  const missingId = items[1]!.id;
  await page.route("**/api/profiles/*/library?*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.savedCollections = body.savedCollections.map(
      (item: {
        id: string;
        totalCount: number;
        count: number;
        unavailableCount: number;
      }) =>
        item.id === saved.id && item.totalCount === 2
          ? { ...item, count: 1, unavailableCount: 1 }
          : item,
    );
    await route.fulfill({ response, json: body });
  });
  await page.route("**/api/profiles/*/selection?*", async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const body = await response.json();
    body.items = body.items.map((item: Media) =>
      item.id === missingId ? { ...item, available: false } : item,
    );
    await route.fulfill({ response, json: body });
  });
  const channelId = randomUUID();
  const timing =
    "Future schedule generation uses the updated collection. Already scheduled videos and paused playback retain their saved assignments.";
  await page.route(`**/collections/${saved.id}/dependencies?*`, (route) =>
    route.fulfill({
      json: {
        total: 1,
        offset: 0,
        limit: 25,
        editExplanation: timing,
        items: [
          {
            id: channelId,
            name: "Family afternoons",
            recurring: true,
            materialized: true,
            retained: false,
          },
        ],
      },
    }),
  );
  await page.goto("/#library");
  await page.getByRole("button", { name: "Refresh view", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.goto(`/#library?profile=${profileId}&collection=${saved.id}`);
  const details = page.getByRole("dialog", { name, exact: true });
  await expect(details).toContainText(
    "2 referenced videos · 1 available · 1 unavailable",
  );
  await expect(details.getByRole("checkbox", { name: /^Select / })).toHaveCount(
    2,
  );
  await expect(
    details.getByRole("checkbox", {
      name: new RegExp(`^Select ${items[1]!.title}`),
    }),
  ).toBeDisabled();
  await details
    .getByRole("button", { name: "Edit collection", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Edit collection",
    exact: true,
  });
  const impact = editor.getByRole("region", {
    name: "Collection programming impact",
  });
  await expect(
    impact.getByRole("link", { name: "Family afternoons", exact: true }),
  ).toHaveAttribute(
    "href",
    `#channels?profile=${profileId}&channel=${channelId}`,
  );
  await expect(impact).toContainText(timing);
  await expect(
    editor.getByRole("heading", { name: "2 selected videos", exact: true }),
  ).toBeVisible();
  await editor
    .getByRole("button", { name: new RegExp(`^Remove ${items[1]!.title}`) })
    .click();
  await editor
    .getByRole("button", { name: "Save collection", exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  await expect(details).toContainText(
    "1 referenced video · 1 available · 0 unavailable",
  );
  await expect(details.getByRole("checkbox", { name: /^Select / })).toHaveCount(
    1,
  );
  await expect(
    page.getByRole("status").filter({ hasText: `Saved collection “${name}”.` }),
  ).toContainText(timing);
  await details
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await api(
    page,
    `/api/profiles/${profileId}/collections/${saved.id}`,
    "DELETE",
  );
});

test("retained manual information is reviewable and staged per field against the replacement's current revision", async ({
  page,
}) => {
  const profileId = await login(page);
  const library = await api<Library>(
    page,
    `/api/profiles/${profileId}/library?limit=24`,
  );
  let inspected: Record<string, any>;
  let writes: Record<string, any>[] = [];
  await page.route("**/metadata/inspect", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    inspected = {
      ...body,
      choices: {
        title: { source: "automatic" },
        description: { source: "automatic" },
      },
      requiresReview: true,
      retained: {
        choices: {
          title: {
            source: "manual",
            manual: "Keeper title from previous video",
          },
          description: { source: "local" },
        },
        identity: "previous-synthetic-video-identity",
        checkedMs: 1794168000000,
      },
    };
    await route.fulfill({ response, json: inspected });
  });
  await page.route("**/metadata/save", async (route) => {
    const request = route.request().postDataJSON();
    writes.push(request);
    if (writes.length === 1)
      await route.fulfill({
        status: 409,
        json: { error: "Content changed elsewhere; review latest information" },
      });
    else
      await route.fulfill({
        json: {
          ...inspected,
          choices: request.choices,
          requiresReview: false,
          retained: null,
        },
      });
  });
  await page.goto("/#library");
  await page
    .getByRole("article")
    .filter({
      has: page.getByRole("heading", {
        name: library.shows[0]!.title,
        exact: true,
      }),
    })
    .getByRole("button", { name: /^Open details / })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Edit information for / })
    .first()
    .click();
  const editor = page.getByRole("dialog", {
    name: "Edit video information",
    exact: true,
  });
  await expect(editor).toContainText("Keeper title from previous video");
  await expect(editor.getByLabel("Title source", { exact: true })).toHaveValue(
    "automatic",
  );
  expect(writes).toHaveLength(0);
  await editor
    .getByRole("button", { name: "Stage retained title choice", exact: true })
    .click();
  await expect(editor.getByLabel("Manual title", { exact: true })).toHaveValue(
    "Keeper title from previous video",
  );
  await expect(
    editor.getByLabel("Description source", { exact: true }),
  ).toHaveValue("automatic");
  expect(writes).toHaveLength(0);
  await editor
    .getByRole("button", { name: "Save information", exact: true })
    .click();
  await expect(editor.getByRole("alert")).toContainText("changed elsewhere");
  await expect(editor.getByLabel("Manual title", { exact: true })).toHaveValue(
    "Keeper title from previous video",
  );
  expect(writes[0]!.revision).toBe(inspected!.revision);
  expect(writes[0]!.choices).toEqual({
    title: { source: "manual", manual: "Keeper title from previous video" },
    description: { source: "automatic" },
  });
  expect(writes[0]).not.toHaveProperty("identity");
  await editor
    .getByRole("button", { name: "Save information", exact: true })
    .click();
  await expect(editor).toContainText("Information saved.");
  await expect(
    editor.getByRole("button", {
      name: "Stage retained title choice",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("incomplete source history is batched and retained availability is qualified in the library", async ({
  page,
}) => {
  const batches: string[][] = [];
  let incomplete = true;
  await page.route("**/source-inspections?*", async (route) => {
    const ids = new URL(route.request().url()).searchParams
      .get("ids")!
      .split(",");
    batches.push(ids);
    await route.fulfill({
      json: {
        items: ids.map((sourceId) => ({
          sourceId,
          lastAttemptMs: 1794168120000,
          lastCompletedMs: 1794168120000,
          lastSuccessMs: 1794168000000,
          status: incomplete ? "incomplete" : "current",
        })),
      },
    });
  });
  const profileId = await login(page);
  const library = await api<Library>(
    page,
    `/api/profiles/${profileId}/library?limit=24`,
  );
  await page.goto("/#library");
  await expect(
    page.getByRole("complementary", { name: "Source check history" }).first(),
  ).toContainText("Availability is retained");
  await page
    .getByRole("article")
    .filter({
      has: page.getByRole("heading", {
        name: library.shows[0]!.title,
        exact: true,
      }),
    })
    .getByRole("button", { name: /^Open details / })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("cell", {
        name: "Last known available — source could not be checked",
        exact: true,
      })
      .first(),
  ).toBeVisible();
  expect(batches.length).toBeGreaterThan(0);
  for (const batch of batches) {
    expect(batch.length).toBeLessThanOrEqual(100);
    expect(new Set(batch).size).toBe(batch.length);
  }
  const initialRequests = batches.length;
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page
    .getByRole("article")
    .filter({
      has: page.getByRole("heading", {
        name: library.shows[0]!.title,
        exact: true,
      }),
    })
    .getByRole("button", { name: /^Open details / })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("cell", {
        name: "Last known available — source could not be checked",
        exact: true,
      })
      .first(),
  ).toBeVisible();
  expect(batches).toHaveLength(initialRequests);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  incomplete = false;
  await page.getByRole("button", { name: "Refresh view", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "Source check history" }),
  ).toHaveCount(0);
  await page
    .getByRole("article")
    .filter({
      has: page.getByRole("heading", {
        name: library.shows[0]!.title,
        exact: true,
      }),
    })
    .getByRole("button", { name: /^Open details / })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("cell", { name: "Available in last scan", exact: true })
      .first(),
  ).toBeVisible();
  expect(batches.length).toBeGreaterThan(initialRequests);
});

test("mobile library jump focuses the heading and an empty selection tray stays compact", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page
    .getByRole("navigation", { name: "My Network sections" })
    .getByRole("link", { name: "Your library", exact: true })
    .click();
  const heading = page.locator("#network-library");
  await expect(heading).toBeFocused();
  const tray = page.getByRole("region", {
    name: "Selection tray",
    exact: true,
  });
  await expect(tray).toContainText("Selection tray · 0 videos");
  await expect(tray.getByRole("button")).toHaveCount(0);
  expect((await tray.boundingBox())!.height).toBeLessThan(180);
  await expect(page.getByLabel("Source", { exact: true })).not.toBeVisible();
  await page.getByText("Source and display options", { exact: true }).click();
  await expect(page.getByLabel("Source", { exact: true })).toBeVisible();
  await testInfo.attach("compact-library-390", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("unreadable source history preserves the library and offers a bounded successful retry", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let malformed = true;
  const requests = new Map<string, number>();
  await page.route("**/api/profiles/*/source-inspections?*", (route) => {
    const profile = new URL(route.request().url()).pathname.split("/")[3]!;
    requests.set(profile, (requests.get(profile) ?? 0) + 1);
    return route.fulfill({
      json: malformed ? { unexpected: true } : { items: [] },
    });
  });
  const profileId = await login(page);
  const retry = page.getByRole("button", {
    name: "Retry source history",
    exact: true,
  });
  await expect(retry).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your library", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Open details for / }).first(),
  ).toBeVisible();
  // Earlier suites can create a different first-listed profile. Loading that
  // scope before the explicit chooser is separate from this profile's cache.
  expect(requests.get(profileId)).toBe(1);
  malformed = false;
  await retry.click();
  await expect(retry).toHaveCount(0);
  expect(requests.get(profileId)).toBe(2);
  expect(errors).toEqual([]);
});
