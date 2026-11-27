import { selectInitialProfile } from "./workspace";
import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
test.use({
  launchOptions: {
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--host-resolver-rules=MAP mytuner-review.test 127.0.0.1",
    ],
  },
});
async function login(page: Page, origin = "/") {
  await page.goto(origin);
  await page.getByLabel("Username", { exact: true }).fill("designer");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const picker = page.getByRole("dialog", {
    name: "Who’s watching?",
    exact: true,
  });
  await expect(picker).toBeVisible();
  await picker
    .getByRole("button")
    .filter({ hasText: "Living Room" })
    .first()
    .click();
  await expect(
    page.getByRole("combobox", { name: "Current profile", exact: true }),
  ).toHaveValue(/.+/);
}
async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const headers: Record<string, string> = {};
      if (method !== "GET") {
        headers["Content-Type"] = "application/json";
        headers["X-CSRF-Token"] = (
          await (await fetch("/api/auth/csrf")).json()
        ).csrfToken;
      }
      const response = await fetch(path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: response.status,
        data: response.status === 204 ? null : await response.json(),
      };
    },
    { path, method, body },
  );
}
test("new programming groups work over ordinary HTTP LAN", async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL!);
  origin.hostname = "mytuner-review.test";
  await login(page, origin.origin);
  expect(await page.evaluate(() => isSecureContext)).toBe(false);
  await page.getByRole("button", { name: "After School", exact: true }).click();
  await page
    .locator(".channel-preview")
    .getByRole("button", { name: "Edit programming", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Program After School",
    exact: true,
  });
  await editor
    .getByRole("button", { name: "+ Add content group", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "Choose programming content",
    exact: true,
  });
  await picker
    .getByRole("button", { name: /^Select / })
    .first()
    .click();
  await picker
    .getByRole("button", { name: "Use selection", exact: true })
    .click();
  await expect(picker).not.toBeVisible();
  await expect(
    editor.getByRole("heading", { name: /Content group/ }),
  ).toHaveCount(2);
});
test("archived selection and active switching keep the sidebar bounded", async ({
  page,
}) => {
  await login(page);
  const profileId = await page
    .getByLabel("Current profile", { exact: true })
    .inputValue();
  const name = `Archive regression ${randomUUID()}`;
  const created = await api(page, "/api/channels", "POST", {
    name,
    profileId,
    visibility: "private",
  });
  expect(created.status).toBe(201);
  expect(
    (
      await api(page, `/api/channels/${created.data.id}`, "PATCH", {
        archived: true,
      })
    ).status,
  ).toBe(204);
  await page.goto("/#channels");
  await page.reload();
  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
  const sidebar = page.locator(".channel-preview");
  await expect(sidebar).toContainText("Restore this channel");
  const count = await sidebar.locator("*").count();
  await page.waitForTimeout(3200);
  expect(await sidebar.locator("*").count()).toBe(count);
  await expect(
    sidebar.getByRole("button", { name: "Add to profile guide", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "All channels", exact: true }).click();
  await page.getByRole("button", { name: "After School", exact: true }).click();
  await expect(
    sidebar
      .locator("summary")
      .filter({ hasText: "Scheduled and delivered exposure" }),
  ).toHaveCount(1);
});
test("account confirmation is in-app and cancellation preserves the complete draft", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#accounts");
  await page.getByRole("button", { name: "Manage sam", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Manage sam", exact: true });
  await editor.getByLabel("Role", { exact: true }).selectOption("viewer");
  await editor.getByLabel("Change password", { exact: true }).check();
  await editor
    .getByLabel("New password", { exact: true })
    .fill("synthetic-new-password");
  await editor
    .getByLabel("Confirm new password", { exact: true })
    .fill("different-password");
  let saves = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().includes("/configuration"))
      saves++;
  });
  await editor
    .getByRole("button", { name: "Save account", exact: true })
    .click();
  expect(saves).toBe(0);
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  const confirmation = page.locator(".confirmation-dialog");
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(editor.getByLabel("Role", { exact: true })).toHaveValue(
    "viewer",
  );
  await expect(editor.getByLabel("New password", { exact: true })).toHaveValue(
    "synthetic-new-password",
  );
  await page.setViewportSize({ width: 390, height: 640 });
  const head = await editor.locator(".dialog-head").boundingBox(),
    foot = await editor.locator(".dialog-footer").boundingBox();
  expect(head!.y).toBeGreaterThanOrEqual(0);
  expect(foot!.y + foot!.height).toBeLessThanOrEqual(640);
});
test("slow generation polling eventually displays a terminal result", async ({
  page,
}) => {
  await login(page);
  const sources = await api(page, "/api/sources");
  const source = sources.data.find(
    (item: { name: string; kind: string }) =>
      item.name === "TV shows" && item.kind === "shows",
  );
  expect(source).toBeTruthy();
  const job = await api(page, "/api/generation/jobs", "POST", {
    sourceId: source.id,
    directory: "",
    recursive: false,
    kinds: ["thumbnail"],
    regenerate: false,
  });
  expect(job.status).toBe(202);
  let requests = 0;
  await page.route(`**/api/generation/jobs/${job.data.id}?*`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    requests++;
    if (requests === 1) body.status = "running";
    else await new Promise((resolve) => setTimeout(resolve, 4500));
    await route.fulfill({ response, json: body });
  });
  await page.goto("/#generated");
  await page
    .getByRole("button", { name: /^View .* generation job$/ })
    .first()
    .click();
  const modal = page.getByRole("dialog", {
    name: "Generation progress",
    exact: true,
  });
  await expect(modal).toContainText("Work finished", { timeout: 18000 });
  expect(requests).toBe(2);
  await expect(modal.locator("progress")).toHaveAttribute("value", "2");
  const finishedRequests = requests;
  await page.waitForTimeout(3500);
  expect(requests).toBe(finishedRequests);
});

test("new channel remains local through preview and creates one published channel on final submit", async ({
  page,
}) => {
  await login(page);
  await page.route("**/api/channels/drafts/preview", async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const preview = await response.json();
    const first = preview.entries[0] as { startMs: number } | undefined;
    if (!first) return route.fulfill({ response, json: preview });
    // Normalize display clocks only. Real revision, interval durations and
    // configuration still drive the final server-side publication check.
    const shift = Date.UTC(2026, 10, 8, 20) - first.startMs;
    await route.fulfill({
      response,
      json: {
        ...preview,
        entries: preview.entries.map(
          (entry: { startMs: number; endMs: number }) => ({
            ...entry,
            startMs: entry.startMs + shift,
            endMs: entry.endMs + shift,
          }),
        ),
      },
    });
  });
  const before = await api(page, "/api/admin/channels"),
    count = Array.isArray(before.data)
      ? before.data.length
      : before.data.items.length;
  const beforeIds = new Set(
    (Array.isArray(before.data) ? before.data : before.data.items).map(
      (row: { id: string }) => row.id,
    ),
  );
  await page
    .getByRole("button", { name: "Create channel", exact: true })
    .click();
  const wizard = page.getByRole("dialog", {
      name: "Create channel",
      exact: true,
    }),
    name = "Wizard creation acceptance";
  await wizard.getByLabel("Channel name", { exact: true }).fill(name);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1024 });
    await expect(wizard).toHaveScreenshot(
      `channel-wizard-details-${width}.png`,
    );
  }
  await wizard.getByRole("button", { name: "Next", exact: true }).click();
  await wizard
    .getByRole("button", { name: "Add content group", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "Choose programming content",
    exact: true,
  });
  await picker
    .getByRole("button", { name: "Select Orbit Patrol", exact: true })
    .click();
  await picker
    .getByRole("button", { name: "Use selection", exact: true })
    .click();
  await expect(
    wizard.getByRole("heading", { name: "Content group 1", exact: true }),
  ).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1024 });
    await expect(wizard).toHaveScreenshot(
      `channel-wizard-content-${width}.png`,
    );
  }
  await wizard.getByRole("button", { name: "Back", exact: true }).click();
  await expect(wizard.getByLabel("Channel name", { exact: true })).toHaveValue(
    name,
  );
  await wizard.getByRole("button", { name: "Next", exact: true }).click();
  await wizard.getByRole("button", { name: "Next", exact: true }).click();
  await wizard.getByRole("button", { name: "Next", exact: true }).click();
  await wizard
    .getByRole("button", { name: "Generate preview", exact: true })
    .click();
  await expect(wizard).toContainText("Preview ready");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1024 });
    await wizard.locator(".dialog-body").evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(wizard).toHaveScreenshot(`channel-wizard-review-${width}.png`);
  }
  const afterPreview = await api(page, "/api/admin/channels");
  expect(
    (Array.isArray(afterPreview.data)
      ? afterPreview.data
      : afterPreview.data.items
    ).length,
  ).toBe(count);
  await wizard
    .getByRole("button", { name: "Create channel", exact: true })
    .click();
  await expect(wizard).not.toBeVisible();
  const after = await api(page, "/api/admin/channels"),
    rows = Array.isArray(after.data) ? after.data : after.data.items;
  expect(rows.length).toBe(count + 1);
  const created = rows.find(
    (row: { id: string; name: string }) =>
      row.name === name && !beforeIds.has(row.id),
  );
  expect(
    (await api(page, `/api/channels/${created.id}/programming`)).data
      .revisionId,
  ).toBeTruthy();
});
test("library applies exact selected videos to the tray and saves only those collection members", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: /^Open details for / })
    .first()
    .click();
  const details = page.getByRole("dialog").filter({
    has: page.getByRole("button", {
      name: "Select all on this page",
      exact: true,
    }),
  });
  await details
    .getByRole("checkbox", { name: /^Select / })
    .first()
    .check();
  await details
    .getByRole("button", { name: "Add 1 video to tray", exact: true })
    .click();
  const tray = page.getByRole("region", {
    name: "Selection tray",
    exact: true,
  });
  await expect(tray).toContainText("Selection tray · 1 video");
  await tray
    .getByRole("button", { name: "Create collection from tray", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
      name: "Create collection",
      exact: true,
    }),
    name = `Exact ${randomUUID()}`;
  await editor.getByLabel("Collection name", { exact: true }).fill(name);
  await editor
    .getByRole("button", { name: "Save collection", exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  const profileId = await page
      .getByLabel("Current profile", { exact: true })
      .inputValue(),
    collections = await api(page, `/api/profiles/${profileId}/collections`),
    created = collections.data.items.find(
      (item: { name: string }) => item.name === name,
    );
  expect(created).toBeTruthy();
  expect(
    (await api(page, `/api/profiles/${profileId}/collections/${created.id}`))
      .data.items,
  ).toHaveLength(1);
  await expect(
    page.getByRole("status").filter({ hasText: `Saved collection “${name}”.` }),
  ).toBeVisible();
  const savedLink = page.getByRole("link", {
    name: `Open saved collection · ${name}`,
    exact: true,
  });
  await expect(savedLink).toHaveAttribute(
    "href",
    `#library?profile=${profileId}&collection=${created.id}`,
  );
  await savedLink.click();
  const savedDetails = page.getByRole("dialog", { name, exact: true });
  await expect(savedDetails).toBeVisible();
  await expect(
    savedDetails.getByRole("checkbox", { name: /^Select / }),
  ).toHaveCount(1);
});
test("source configuration has one atomic save and directory choices do not open until requested", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#sources");
  await page
    .getByRole("button", { name: "Configure TV shows", exact: true })
    .click();
  const config = page.getByRole("dialog", {
    name: "Configure TV shows",
    exact: true,
  });
  await expect(
    config.getByRole("button", { name: "Save configuration", exact: true }),
  ).toHaveCount(1);
  await expect(config.getByRole("region", { name: /choices$/ })).toHaveCount(0);
  await config
    .getByLabel("Find subtitles during scans", { exact: true })
    .uncheck();
  await config
    .getByRole("button", { name: "Save configuration", exact: true })
    .click();
  await expect(config).not.toBeVisible();
  await page
    .getByRole("button", { name: "Configure TV shows", exact: true })
    .click();
  await expect(
    config.getByLabel("Find subtitles during scans", { exact: true }),
  ).not.toBeChecked();
});

test("expired authentication during playback startup returns to usable sign-in", async ({
  page,
}) => {
  await page.route("**/api/playback/startup", (route) =>
    route.fulfill({ status: 401, json: { error: "Authentication required" } }),
  );
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("designer");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-browser-password");
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/playback/startup") &&
        response.status() === 401,
    ),
    page.getByRole("button", { name: "Sign in", exact: true }).click(),
  ]);
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: "Signed in as designer", exact: true }),
  ).toHaveCount(0);
  await page.unroute("**/api/playback/startup");
  await page.getByLabel("Username", { exact: true }).fill("designer");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Who’s watching?", exact: true }),
  ).toBeVisible();
});
test("superseded-only source scan shows retry guidance without inventing counts", async ({
  page,
}) => {
  await login(page);
  await page.route("**/api/sources/*/scan", (route) =>
    route.fulfill({ json: { superseded: true } }),
  );
  await page.goto("/#sources");
  await page
    .getByRole("button", { name: "Scan and refresh", exact: true })
    .first()
    .click();
  const modal = page.getByRole("dialog", { name: /^Scan / });
  await modal.getByRole("button", { name: "Start scan", exact: true }).click();
  await expect(
    modal.getByRole("heading", {
      name: "Settings changed during scan",
      exact: true,
    }),
  ).toBeVisible();
  await expect(modal).toContainText("start another scan");
  await expect(modal).not.toContainText("undefined");
  await expect(
    modal.getByRole("button", { name: "Start scan", exact: true }),
  ).toBeEnabled();
  await modal.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sources", exact: true }),
  ).toBeVisible();
});
test("unknown help object-property topics safely fall back to TV installation", async ({
  page,
}) => {
  await login(page);
  for (const topic of ["constructor", "__proto__", "toString"]) {
    await page.goto("/#setup?topic=" + topic);
    await expect(
      page.getByRole("heading", { name: "Setup & TV help", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".help-document")).toContainText("TV");
  }
});

test("sign-in and TV PIN show/hide preserve entered values and unlocking uses one PIN field", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("designer");
  const password = page.getByLabel("Password", { exact: true });
  await password.fill("synthetic-browser-password");
  await page
    .getByRole("button", { name: "Show password", exact: true })
    .click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("synthetic-browser-password");
  await page
    .getByRole("button", { name: "Hide password", exact: true })
    .click();
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveValue("synthetic-browser-password");
  await expect(page.getByLabel(/Confirm.*password/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await selectInitialProfile(page);
  const profileId = await page
    .getByLabel("Current profile", { exact: true })
    .inputValue();
  expect(
    (await api(page, `/api/profiles/${profileId}/pin`, "PUT", { pin: "1234" }))
      .status,
  ).toBe(204);
  try {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByLabel("Username", { exact: true }).fill("sam");
    await page
      .getByLabel("Password", { exact: true })
      .fill("synthetic-viewer-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await selectInitialProfile(page);
    await expect(
      page.getByRole("heading", { name: "Unlock Living Room", exact: true }),
    ).toBeVisible();
    const pin = page.getByLabel("TV PIN", { exact: true });
    await pin.fill("1234");
    await page.getByRole("button", { name: "Show PIN", exact: true }).click();
    await expect(pin).toHaveAttribute("type", "text");
    await expect(pin).toHaveValue("1234");
    await page.getByRole("button", { name: "Hide PIN", exact: true }).click();
    await expect(pin).toHaveAttribute("type", "password");
    await expect(pin).toHaveValue("1234");
    await expect(page.getByLabel(/Confirm.*PIN/i)).toHaveCount(0);
    const unlock = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().endsWith(`/profiles/${profileId}/unlock`),
    );
    await page
      .getByRole("button", { name: "Unlock profile", exact: true })
      .click();
    expect((await unlock).postDataJSON()).toEqual({ pin: "1234" });
    await expect(
      page.getByRole("heading", { name: "My Network", exact: true }),
    ).toBeVisible();
    await expect(page.locator("dialog.confirmation-dialog")).toHaveCount(0);
  } finally {
    expect(
      (await api(page, `/api/profiles/${profileId}/pin`, "PUT", { pin: null }))
        .status,
    ).toBe(204);
  }
});

test("generation start, cancel and retry stay in the modal footer on a narrow screen", async ({
  page,
}) => {
  await login(page);
  const sources = await api(page, "/api/sources"),
    sourceId = sources.data[0].id;
  const jobId = randomUUID();
  let state = "running",
    starts = 0,
    cancels = 0,
    retries = 0;
  const items = Array.from({ length: 30 }, (_, index) => ({
    id: `output-${index}`,
    mediaId: randomUUID(),
    relativePath: `Folder/Video ${index + 1}.mp4`,
    kind: "thumbnail",
    status: "queued",
    error: null,
  }));
  const job = () => ({
    id: jobId,
    sourceId,
    directory: "",
    status: state,
    admission: state === "running" ? "active" : null,
    total: items.length,
    completed: 0,
    failed: 0,
    error: null,
    current:
      state === "running" ? { relativePath: items[0]!.relativePath } : null,
    items,
    hasMore: false,
  });
  await page.route("**/api/admin/generation", (route) =>
    route.fulfill({ json: starts ? [job()] : [] }),
  );
  await page.route("**/api/generation/preview", (route) =>
    route.fulfill({
      json: {
        count: items.length,
        items: items.map((item) => ({
          id: item.mediaId,
          title: item.relativePath,
        })),
        totalOutputs: items.length,
        reusableOutputs: 0,
        newOutputs: items.length,
        totalDurationMs: 1_800_000,
        availableBytes: 1_000_000_000,
      },
    }),
  );
  await page.route("**/api/generation/jobs", (route) => {
    starts++;
    return route.fulfill({ status: 202, json: job() });
  });
  await page.route(`**/api/generation/jobs/${jobId}?*`, (route) =>
    route.fulfill({ json: job() }),
  );
  await page.route(`**/api/generation/jobs/${jobId}/cancel`, (route) => {
    cancels++;
    state = "cancelled";
    return route.fulfill({ json: job() });
  });
  await page.route(`**/api/admin/generation/${jobId}/retry`, (route) => {
    retries++;
    state = "running";
    return route.fulfill({ json: job() });
  });
  await page.goto("/#generated");
  await page.setViewportSize({ width: 390, height: 640 });
  await page
    .getByRole("button", { name: "Preview scope", exact: true })
    .click();
  const scope = page.getByRole("dialog", {
    name: "Confirm generation scope",
    exact: true,
  });
  await scope.locator(".dialog-body").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const start = scope
    .locator(".dialog-footer")
    .getByRole("button", { name: "Start generation", exact: true });
  await expect(start).toBeInViewport({ ratio: 1 });
  await expect(
    scope
      .locator(".dialog-body")
      .getByRole("button", { name: "Start generation", exact: true }),
  ).toHaveCount(0);
  await start.click();
  const progress = page.getByRole("dialog", {
    name: "Generation progress",
    exact: true,
  });
  const footer = progress.locator(".dialog-footer");
  await expect(
    progress.getByRole("heading", {
      name: `${sources.data[0].name} / Folder`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    progress.getByRole("status").filter({ hasText: /^Processing:/ }),
  ).toHaveText("Processing: Video 1.mp4");
  await progress
    .getByText(`File results · ${items.length} outputs`, { exact: true })
    .click();
  await progress.locator(".dialog-body").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    footer.getByRole("button", { name: "Cancel job", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await footer.getByRole("button", { name: "Cancel job", exact: true }).click();
  await page
    .locator("dialog.confirmation-dialog")
    .locator(".dialog-footer button")
    .nth(1)
    .click();
  await expect(
    footer.getByRole("button", {
      name: "Retry unfinished outputs",
      exact: true,
    }),
  ).toBeInViewport({ ratio: 1 });
  await expect(
    footer.getByRole("button", { name: "Cancel job", exact: true }),
  ).toHaveCount(0);
  await footer
    .getByRole("button", { name: "Retry unfinished outputs", exact: true })
    .click();
  await expect(
    footer.getByRole("button", { name: "Cancel job", exact: true }),
  ).toBeVisible();
  expect({ starts, cancels, retries }).toEqual({
    starts: 1,
    cancels: 1,
    retries: 1,
  });
  await footer.getByRole("button", { name: "Done", exact: true }).click();
  await expect(progress).toHaveCount(0);
});

test("selected-video lookup retry preserves the collection draft and exact membership", async ({
  page,
}) => {
  await login(page);
  const profileId = await page
    .getByLabel("Current profile", { exact: true })
    .inputValue();
  const media = await api(page, `/api/profiles/${profileId}/media?limit=1`),
    item = media.data.items[0];
  const created = await api(
    page,
    `/api/profiles/${profileId}/collections`,
    "POST",
    {
      creationId: randomUUID(),
      name: `Lookup ${randomUUID()}`,
      mediaIds: [item.id],
    },
  );
  expect(created.status).toBe(201);
  let release!: () => void,
    entered!: () => void,
    lookups = 0,
    saves = 0;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve;
    });
  await page.route(
    "**/api/profiles/*/selection?includeUnavailable=true&limit=50",
    async (route) => {
      lookups++;
      if (lookups === 1) {
        entered();
        await gate;
        return route
          .fulfill({
            status: 503,
            json: { error: "Selected video names temporarily unavailable" },
          })
          .catch(() => {});
      }
      return route.continue();
    },
  );
  page.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      request.url().endsWith(`/collections/${created.data.id}`)
    )
      saves++;
  });
  try {
    await page.goto(
      `/#library?profile=${profileId}&collection=${created.data.id}`,
    );
    await page
      .getByRole("button", { name: "Edit collection", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Edit collection",
      exact: true,
    });
    await started;
    await editor
      .getByLabel("Collection name", { exact: true })
      .fill("Preserved lookup draft");
    release();
    const selected = editor.getByRole("region", {
      name: "Selected videos",
      exact: true,
    });
    await expect(selected.getByRole("alert")).toContainText(
      "Selected video names temporarily unavailable",
    );
    await expect(
      editor.getByRole("button", { name: "Save collection", exact: true }),
    ).toBeDisabled();
    await expect(selected.getByRole("heading")).toHaveText("1 selected video");
    await selected
      .getByRole("button", { name: "Try again", exact: true })
      .click();
    await expect(
      selected.getByRole("button", {
        name: `Remove ${item.title} · TV shows · ${item.relativePath}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      editor.getByLabel("Collection name", { exact: true }),
    ).toHaveValue("Preserved lookup draft");
    await expect(selected.getByRole("heading")).toHaveText("1 selected video");
    await expect(
      editor.getByRole("button", { name: "Save collection", exact: true }),
    ).toBeEnabled();
    expect(lookups).toBe(2);
    expect(saves).toBe(0);
    expect(
      (
        await api(
          page,
          `/api/profiles/${profileId}/collections/${created.data.id}`,
        )
      ).data.items.map((video: { id: string }) => video.id),
    ).toEqual([item.id]);
  } finally {
    release();
  }
});

for (const kind of ["collection", "media"] as const) {
  test(`copying a channel preserves the saved ${kind} commercial pool in its wizard`, async ({
    page,
  }) => {
    await login(page);
    const profileId = await page
      .getByLabel("Current profile", { exact: true })
      .inputValue();
    const channels = await api(page, "/api/admin/channels");
    const rows = Array.isArray(channels.data)
      ? channels.data
      : channels.data.items;
    const channel = rows.find(
      (item: { name: string }) => item.name === "After School",
    );
    const current = await api(page, `/api/channels/${channel.id}/programming`);
    const mediaId = randomUUID(),
      pool =
        kind === "collection"
          ? { type: "collection", id: randomUUID() }
          : { type: "media", ids: [mediaId] };
    await page.route(`**/api/channels/${channel.id}/draft-copy?*`, (route) =>
      route.fulfill({
        json: { config: { ...current.data.config, commercialSelection: pool } },
      }),
    );
    await page.route("**/api/profiles/*/selection?*", (route) => {
      const body = route.request().postDataJSON();
      if (JSON.stringify(body) !== JSON.stringify(pool))
        return route.fallback();
      return route.fulfill({
        json: {
          items: [{ id: mediaId, title: "Saved pool commercial" }],
          total: 1,
          hasMore: false,
        },
      });
    });
    await page
      .getByRole("button", { name: "After School", exact: true })
      .click();
    await page
      .locator(".channel-preview")
      .getByRole("button", { name: "Create from this channel", exact: true })
      .click();
    const wizard = page.getByRole("dialog", {
      name: "Create channel from existing programming",
      exact: true,
    });
    await wizard.getByRole("button", { name: "Next", exact: true }).click();
    await expect(
      wizard.getByRole("heading", { name: "Content group 1", exact: true }),
    ).toBeVisible();
    await wizard.getByRole("button", { name: "Next", exact: true }).click();
    const selector = wizard.getByRole("combobox", {
      name: "Commercial pool",
      exact: true,
    });
    await expect(selector).toHaveValue(JSON.stringify(pool));
    await expect(selector.getByRole("option", { selected: true })).toHaveText(
      kind === "collection"
        ? "Saved commercial selection"
        : "1 selected commercial file",
    );
    await expect(
      wizard.getByRole("checkbox", {
        name: "Saved pool commercial",
        exact: true,
      }),
    ).toBeChecked();
    await wizard.getByRole("button", { name: "Back", exact: true }).click();
    await wizard.getByRole("button", { name: "Next", exact: true }).click();
    await expect(selector).toHaveValue(JSON.stringify(pool));
    await wizard.getByRole("button", { name: "Next", exact: true }).click();
    await expect(wizard).toContainText(
      "Commercial pool selected · no break placements enabled",
    );
    await expect(wizard).not.toContainText("No commercials");
  });
}

test("loading latest programming locks edits until the new descriptor has replaced the discarded draft", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "After School", exact: true }).click();
  await page
    .locator(".channel-preview")
    .getByRole("button", { name: "Edit programming", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Program After School",
    exact: true,
  });
  await editor
    .getByRole("combobox", { name: "Play order", exact: true })
    .selectOption("shuffle");
  await page.route("**/api/channels/*/programming/preview?*", (route) =>
    route.fulfill({
      status: 409,
      json: { error: "Channel changed elsewhere; reload before previewing" },
    }),
  );
  await editor.getByRole("button", { name: "3. Preview", exact: true }).click();
  await editor
    .getByRole("button", { name: "Generate two-hour preview", exact: true })
    .click();
  await expect(
    editor.getByRole("heading", {
      name: "Channel changed elsewhere",
      exact: true,
    }),
  ).toBeVisible();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve;
    });
  await page.route("**/api/channels/*/programming", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    entered();
    await gate;
    return route.fulfill({ response }).catch(() => {});
  });
  try {
    await editor
      .getByRole("button", { name: "Load latest programming", exact: true })
      .click();
    await page
      .locator("dialog.confirmation-dialog")
      .locator(".dialog-footer button")
      .nth(1)
      .click();
    await started;
    await expect(
      editor.getByRole("button", { name: "1. Content", exact: true }),
    ).toBeDisabled();
    await expect(
      editor.getByRole("button", { name: "2. Commercials", exact: true }),
    ).toBeDisabled();
    await expect(
      editor.getByRole("button", {
        name: "Generate two-hour preview",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      editor
        .locator(".dialog-footer")
        .getByRole("button", { name: "Back", exact: true }),
    ).toBeDisabled();
    release();
    await expect(
      editor.getByRole("button", { name: "1. Content", exact: true }),
    ).toBeEnabled();
    await editor
      .getByRole("button", { name: "1. Content", exact: true })
      .click();
    await expect(
      editor.getByRole("combobox", { name: "Play order", exact: true }),
    ).toHaveValue("ordered");
    await expect(editor).toContainText("Published programming");
  } finally {
    release();
  }
});

test("the selection tray renders at most fifty videos per page and clamps pagination after removals", async ({
  page,
}) => {
  await login(page);
  const videos = Array.from({ length: 55 }, (_, index) => ({
    id: randomUUID(),
    title: `Tray video ${String(index + 1).padStart(2, "0")}`,
    durationMs: 60_000,
    available: true,
    metadata: {},
  }));
  let requests = 0;
  await page.route("**/api/profiles/*/selection?*", (route) => {
    requests++;
    const body = route.request().postDataJSON();
    const params = new URL(route.request().url()).searchParams;
    const selected =
      body.type === "media"
        ? videos.filter((item) => body.ids.includes(item.id))
        : videos;
    const offset = Number(params.get("offset") ?? 0),
      limit = Number(params.get("limit") ?? 50);
    return route.fulfill({
      json: {
        items: selected.slice(offset, offset + limit),
        total: selected.length,
        hasMore: offset + limit < selected.length,
      },
    });
  });
  await page
    .getByRole("button", { name: "Open details for Orbit Patrol", exact: true })
    .click();
  const details = page.getByRole("dialog", {
    name: "Orbit Patrol",
    exact: true,
  });
  await details
    .getByRole("button", { name: "Select all on this page", exact: true })
    .click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1024 });
    await details.locator(".dialog-body").evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(details).toHaveScreenshot(
      `library-exact-selection-${width}.png`,
    );
  }
  await details
    .getByRole("button", { name: "Next videos", exact: true })
    .click();
  await expect(
    details.getByRole("checkbox", {
      name: "Select Tray video 55",
      exact: true,
    }),
  ).toBeVisible();
  await details
    .getByRole("button", { name: "Select all on this page", exact: true })
    .click();
  await details
    .getByRole("button", { name: "Add 55 videos to tray", exact: true })
    .click();
  const tray = page.getByRole("region", {
    name: "Selection tray",
    exact: true,
  });
  await expect(tray).toContainText("Selection tray · 55 videos");
  await tray.getByText("Review selected videos", { exact: true }).click();
  await expect(tray.locator(".bounded-checklist > .compact-row")).toHaveCount(
    50,
  );
  await expect(
    tray.getByRole("button", {
      name: "Remove Tray video 55 from tray",
      exact: true,
    }),
  ).toHaveCount(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1024 });
    await expect(tray).toHaveScreenshot(`library-selection-tray-${width}.png`);
  }
  await expect.poll(() => requests).toBeGreaterThanOrEqual(3);
  const beforePaging = requests;
  await tray
    .getByRole("button", { name: "Next tray videos", exact: true })
    .click();
  await expect(tray.locator(".bounded-checklist > .compact-row")).toHaveCount(
    5,
  );
  await expect(tray).toContainText("51–55 of 55");
  await expect(
    tray.getByRole("button", {
      name: "Remove Tray video 55 from tray",
      exact: true,
    }),
  ).toBeVisible();
  await tray
    .getByRole("button", { name: "Previous tray videos", exact: true })
    .click();
  await expect(tray.locator(".bounded-checklist > .compact-row")).toHaveCount(
    50,
  );
  expect(requests).toBe(beforePaging);
  await tray
    .getByRole("button", { name: "Next tray videos", exact: true })
    .click();
  for (let index = 51; index <= 55; index++)
    await tray
      .getByRole("button", {
        name: `Remove Tray video ${index} from tray`,
        exact: true,
      })
      .click();
  await expect(tray).toContainText("Selection tray · 50 videos");
  await expect(tray.locator(".bounded-checklist > .compact-row")).toHaveCount(
    50,
  );
  await expect(
    tray.getByRole("button", { name: "Next tray videos", exact: true }),
  ).toHaveCount(0);
});

test("mapping folder checks ignore stale replies and associate each explicit result with its own row", async ({
  page,
}) => {
  await login(page);
  let checks = 0,
    saves = 0;
  const held = new Map<
    string,
    {
      wait: Promise<void>;
      release: () => void;
      finished: Promise<void>;
      finish: () => void;
    }
  >();
  for (const path of ["/synthetic/old-success", "/synthetic/old-error"]) {
    let release!: () => void, finish!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    held.set(path, { wait, release, finished, finish });
  }
  await page.route("**/api/sources/*/configuration", async (route) => {
    if (route.request().method() !== "GET") {
      saves++;
      return route.fallback();
    }
    const response = await route.fetch();
    return route.fulfill({
      response,
      json: { ...(await response.json()), integration: null },
    });
  });
  await page.route("**/api/admin/setup/check-directory", async (route) => {
    checks++;
    const input = route.request().postDataJSON();
    expect(input).toMatchObject({ purpose: "source", recursive: false });
    const pending = held.get(input.path);
    if (pending) await pending.wait;
    const exists =
      input.path.endsWith("success") || input.path === "/synthetic/second";
    await route
      .fulfill({
        json: {
          exists,
          readableDirectory: exists,
          message: exists
            ? "Synthetic directory readable"
            : "Synthetic mapping directory not found",
        },
      })
      .catch(() => {});
    pending?.finish();
  });
  try {
    await page.goto("/#sources");
    await page
      .getByRole("button", { name: "Configure TV shows", exact: true })
      .click();
    const config = page.getByRole("dialog", {
      name: "Configure TV shows",
      exact: true,
    });
    await config
      .getByRole("button", { name: "Connect Sonarr", exact: true })
      .click();
    await config
      .getByLabel("Sonarr address", { exact: true })
      .fill("http://synthetic-provider:8989");
    await config
      .getByLabel("API key", { exact: true })
      .fill("synthetic-mapping-key");
    await config
      .getByLabel("Application path 1", { exact: true })
      .fill("/provider/one");
    await config
      .getByRole("button", { name: "Add mapping", exact: true })
      .click();
    await config
      .getByLabel("Application path 2", { exact: true })
      .fill("/provider/two");
    await config
      .getByLabel("MyTuner path 2", { exact: true })
      .fill("/synthetic/second");
    const first = config.getByRole("region", {
      name: "Path mapping 1",
      exact: true,
    });
    const second = config.getByRole("region", {
      name: "Path mapping 2",
      exact: true,
    });
    expect(checks).toBe(0);
    for (const path of held.keys()) {
      await first.getByLabel("MyTuner path 1", { exact: true }).fill(path);
      const before = checks;
      await first
        .getByRole("button", {
          name: "Check directory for mapping 1",
          exact: true,
        })
        .click();
      await expect.poll(() => checks).toBe(before + 1);
      await first
        .getByLabel("MyTuner path 1", { exact: true })
        .fill("/synthetic/new");
      await expect(
        first.getByRole("button", {
          name: "Check directory for mapping 1",
          exact: true,
        }),
      ).toBeEnabled();
      held.get(path)!.release();
      await held.get(path)!.finished;
      await expect(first.getByRole("status")).toHaveCount(0);
      await expect(first.getByRole("alert")).toHaveCount(0);
      await expect(
        first.getByLabel("MyTuner path 1", { exact: true }),
      ).toHaveValue("/synthetic/new");
    }
    await second
      .getByRole("button", {
        name: "Check directory for mapping 2",
        exact: true,
      })
      .click();
    const success = second.getByRole("status");
    await expect(success).toContainText("MyTuner can read this directory");
    await expect(
      second.getByLabel("MyTuner path 2", { exact: true }),
    ).toHaveAttribute("aria-describedby", (await success.getAttribute("id"))!);
    await expect(first.getByRole("status")).toHaveCount(0);
    await first
      .getByRole("button", {
        name: "Check directory for mapping 1",
        exact: true,
      })
      .click();
    const error = first.getByRole("alert");
    await expect(error).toHaveText("Synthetic mapping directory not found");
    await expect(
      first.getByLabel("MyTuner path 1", { exact: true }),
    ).toHaveAttribute("aria-invalid", "true");
    await expect(
      first.getByLabel("MyTuner path 1", { exact: true }),
    ).toHaveAttribute("aria-describedby", (await error.getAttribute("id"))!);
    await expect(success).toContainText("MyTuner can read this directory");
    expect(checks).toBe(4);
    expect(saves).toBe(0);
  } finally {
    held.forEach((pending) => pending.release());
  }
});
