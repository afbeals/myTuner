import { test, expect, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({ baseURL: "http://127.0.0.1:8791" });

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
  return page.getByLabel("Current profile").inputValue();
}
async function mutate(page: Page, path: string, body: unknown) {
  return page.evaluate(
    async ({ path, body }) => {
      const { csrfToken } = await (await fetch("/api/auth/csrf")).json();
      const response = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw Error(await response.text());
      return response.json();
    },
    { path, body },
  );
}
async function textLines(locator: Locator) {
  return locator.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return new Set(
      Array.from(range.getClientRects(), (rect) => Math.round(rect.top)),
    ).size;
  });
}
async function accessible(page: Page) {
  const close = page.getByRole("button", { name: "Close dialog", exact: true });
  for (const button of await close.all()) {
    if (await button.isVisible()) expect(await textLines(button)).toBe(1);
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}
async function focusWrap(page: Page, modal: Locator) {
  const close = modal.getByRole("button", {
    name: "Close dialog",
    exact: true,
  });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(close).not.toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
}
async function programming(page: Page, name: string) {
  await login(page);
  await page
    .getByRole("button", { name: "+ Create channel", exact: true })
    .click();
  await page.getByLabel("Channel name", { exact: true }).fill(name);
  await page
    .getByRole("button", { name: "Create & program", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: `Program ${name}`,
    exact: true,
  });
  await expect(
    editor.getByRole("button", { name: "Add content group" }),
  ).toBeVisible();
  return editor;
}

for (const action of ["escape", "close", "cancel", "navigate"] as const) {
  test(`collection draft ${action} asks once, preserves a rejected discard and returns focus`, async ({
    page,
  }) => {
    await login(page);
    await page.goto("/#library");
    const opener = page.getByRole("button", {
      name: "Create collection",
      exact: true,
    });
    await opener.click();
    const modal = page.getByRole("dialog", {
      name: "Create collection",
      exact: true,
    });
    await modal
      .getByLabel("Collection name", { exact: true })
      .fill("Retained collection draft");
    let accept = false,
      confirmations = 0,
      writes = 0;
    page.on("request", (r) => {
      if (
        r.method() === "POST" &&
        /\/collections$/.test(new URL(r.url()).pathname)
      )
        writes++;
    });
    const confirmationMessages: string[] = [];
    page.on("dialog", async (d) => {
      confirmations++;
      confirmationMessages.push(d.message());
      if (accept) await d.accept();
      else await d.dismiss();
    });
    const dismiss = async () => {
      if (action === "escape") await page.keyboard.press("Escape");
      else if (action === "navigate")
        await page.evaluate(() => {
          location.hash = "sources";
        });
      else
        await modal
          .getByRole("button", {
            name: action === "close" ? "Close dialog" : "Cancel",
            exact: true,
          })
          .click();
    };
    await dismiss();
    await expect(modal).toBeVisible();
    await expect(
      modal.getByLabel("Collection name", { exact: true }),
    ).toHaveValue("Retained collection draft");
    await expect(page).toHaveURL(/#library$/);
    expect(confirmations).toBe(1);
    accept = true;
    await dismiss();
    await expect(modal).toHaveCount(0);
    expect(confirmations).toBe(2);
    expect(
      confirmationMessages.every((message) => message.includes("collection")),
    ).toBe(true);
    expect(writes).toBe(0);
    if (action === "navigate")
      await expect(
        page.getByRole("heading", { name: "Sources", exact: true }),
      ).toBeVisible();
    else await expect(opener).toBeFocused();
  });
}

test("cancelled subtitle settings restore the baseline and close without a phantom discard prompt", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#sources");
  const opener = page.getByRole("button", {
    name: "Configure TV shows",
    exact: true,
  });
  await opener.click();
  const modal = page.getByRole("dialog", {
    name: "Configure TV shows",
    exact: true,
  });
  const settings = modal.getByRole("region", {
    name: "Subtitle search settings",
    exact: true,
  });
  const folders = settings.getByLabel("Subtitle subdirectories", {
    exact: true,
  });
  await expect(folders).toBeEnabled();
  const baseline = await folders.inputValue();
  await folders.fill("Draft/Captions, Draft/English");
  let confirmations = 0,
    writes = 0;
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().endsWith("/subtitles")) writes++;
  });
  page.on("dialog", async (d) => {
    confirmations++;
    await d.dismiss();
  });
  await page.keyboard.press("Escape");
  await expect(modal).toBeVisible();
  expect(confirmations).toBe(1);
  await settings.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(folders).toHaveValue(baseline);
  await modal
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  expect(confirmations).toBe(1);
  expect(writes).toBe(0);
  await expect(opener).toBeFocused();
});

test("collection lookup and media errors recover without blank editing or lost selected references", async ({
  page,
}) => {
  const profileId = await login(page);
  const media = await page.evaluate(
    async (id) =>
      (await (await fetch(`/api/profiles/${id}/media?limit=50`)).json()).items,
    profileId,
  );
  const collection = await mutate(
    page,
    `/api/profiles/${profileId}/collections`,
    { name: "Editor recovery collection", mediaIds: [media[0].id] },
  );
  await page.goto(`/#library?profile=${profileId}&collection=${collection.id}`);
  let collectionWrites = 0;
  page.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      request.url().endsWith(`/collections/${collection.id}`)
    )
      collectionWrites++;
  });
  let phase = "held",
    release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route(`**/collections/${collection.id}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    if (phase === "held") await gate;
    if (phase === "unavailable" || phase === "forbidden")
      return route.fulfill({
        status: phase === "forbidden" ? 403 : 503,
        json: {
          error:
            phase === "forbidden"
              ? "Collection access changed."
              : "Collection lookup unavailable.",
        },
      });
    return route.continue();
  });
  try {
    await page
      .getByRole("button", { name: "Edit collection", exact: true })
      .click();
    const modal = page.getByRole("dialog", {
      name: "Edit collection",
      exact: true,
    });
    await expect(modal.getByRole("status")).toContainText("Loading");
    await expect(
      modal.getByRole("button", { name: "Save collection", exact: true }),
    ).toHaveCount(0);
    phase = "unavailable";
    release();
    await expect(modal.getByRole("alert")).toContainText("lookup unavailable");
    await page.setViewportSize({ width: 390, height: 844 });
    await accessible(page);
    await expect(modal).toHaveScreenshot("collection-lookup-error-390.png");
    phase = "forbidden";
    await modal.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(modal.getByRole("alert")).toContainText("access changed");
    await expect(
      modal.getByRole("button", { name: "Save collection", exact: true }),
    ).toHaveCount(0);
    phase = "normal";
    await modal.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(
      modal.getByLabel("Collection name", { exact: true }),
    ).toHaveValue("Editor recovery collection");
    await modal
      .getByLabel("Collection name", { exact: true })
      .fill("Retained recovery name");
    let mediaPhase = "unavailable";
    await page.route("**/api/profiles/*/media?*", (route) =>
      mediaPhase === "unavailable"
        ? route.fulfill({
            status: 503,
            json: { error: "Video lookup unavailable." },
          })
        : route.fulfill({ json: { items: [], total: 0 } }),
    );
    await modal
      .getByLabel("Find videos", { exact: true })
      .fill("missing-video");
    await expect(modal.getByRole("alert")).toContainText(
      "Video lookup unavailable",
    );
    await expect(
      modal.getByRole("region", { name: "Selected videos" }),
    ).toContainText("1 selected videos");
    mediaPhase = "empty";
    await modal.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(modal).toContainText(
      "No matching videos. Your selected references are preserved.",
    );
    await expect(
      modal.getByLabel("Collection name", { exact: true }),
    ).toHaveValue("Retained recovery name");
    expect(collectionWrites).toBe(0);
    await focusWrap(page, modal);
    await accessible(page);
    page.once("dialog", (d) => d.accept());
    await modal
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(modal).toHaveCount(0);
  } finally {
    release();
  }
});

test("programming picker loading, unavailable, forbidden and empty states preserve the parent draft and focus", async ({
  page,
}) => {
  const editor = await programming(page, "Picker state acceptance");
  await editor.getByRole("button", { name: "Add content group" }).click();
  await page
    .getByRole("dialog", { name: "Choose programming content", exact: true })
    .getByRole("button", { name: "Select Orbit Patrol", exact: true })
    .click();
  await expect(editor).toContainText("Unsaved draft");
  let phase = "held",
    release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/profiles/*/library/options?*", async (route) => {
    if (phase === "held") await gate;
    if (phase === "unavailable" || phase === "forbidden")
      return route.fulfill({
        status: phase === "forbidden" ? 403 : 503,
        json: {
          error:
            phase === "forbidden"
              ? "Programming access changed."
              : "Programming options unavailable.",
        },
      });
    if (phase === "empty")
      return route.fulfill({
        json: { items: [], sources: [], total: 0, offset: 0, limit: 50 },
      });
    return route.continue();
  });
  try {
    const opener = editor.getByRole("button", {
      name: "Change content selection",
      exact: true,
    });
    await opener.click();
    const modal = page.getByRole("dialog", {
      name: "Choose programming content",
      exact: true,
    });
    await expect(modal.getByRole("status")).toContainText("Loading");
    phase = "unavailable";
    release();
    await expect(modal.getByRole("alert")).toContainText("options unavailable");
    await page.setViewportSize({ width: 390, height: 844 });
    await accessible(page);
    await expect(modal).toHaveScreenshot("programming-picker-error-390.png");
    await modal.getByRole("button", { name: "Try again", exact: true }).focus();
    await page.keyboard.press("End");
    await expect(
      modal.getByRole("button", { name: "Next results", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    phase = "forbidden";
    await modal.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(modal.getByRole("alert")).toContainText("access changed");
    await expect(modal.getByRole("button", { name: /^Select / })).toHaveCount(
      0,
    );
    phase = "empty";
    await modal.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(modal).toContainText(
      "No matching content. Your draft selection is unchanged.",
    );
    await focusWrap(page, modal);
    await accessible(page);
    await expect(modal).toHaveScreenshot("programming-picker-empty-390.png");
    await page.keyboard.press("Escape");
    await expect(opener).toBeFocused();
    await expect(editor).toContainText("Unsaved draft");
    phase = "normal";
    await opener.click();
    await modal
      .getByRole("combobox", { name: "Programming type" })
      .selectOption("show");
    await modal
      .getByRole("button", { name: "Select Orbit Patrol", exact: true })
      .click();
    await expect(modal).toHaveCount(0);
    await expect(editor).toContainText("Content group 1");
    page.once("dialog", (d) => d.accept());
    await editor
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
  } finally {
    release();
  }
});

test("next-episode lookup recovers from loading, offline, forbidden and empty without changing its checkpoint", async ({
  page,
}) => {
  const editor = await programming(page, "Checkpoint state acceptance");
  await editor.getByRole("button", { name: "Add content group" }).click();
  await page
    .getByRole("dialog", { name: "Choose programming content", exact: true })
    .getByRole("button", { name: "Select Orbit Patrol", exact: true })
    .click();
  page.once("dialog", (d) => d.accept());
  await editor
    .getByRole("button", { name: "Restart group", exact: true })
    .click();
  let phase = "held",
    release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/profiles/*/checkpoint-options", async (route) => {
    if (phase === "held") await gate;
    if (phase === "offline") return route.abort("failed");
    if (phase === "forbidden")
      return route.fulfill({
        status: 403,
        json: { error: "Episode access changed." },
      });
    if (phase === "empty") return route.fulfill({ json: { items: [] } });
    return route.continue();
  });
  try {
    const opener = editor.getByRole("button", {
      name: "Choose next episode",
      exact: true,
    });
    await opener.click();
    const modal = page.getByRole("dialog", {
      name: "Choose the next episode",
      exact: true,
    });
    await expect(modal.getByRole("status")).toContainText("Loading");
    phase = "offline";
    release();
    await expect(modal.getByRole("alert")).toContainText(
      "Unable to reach the server",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await accessible(page);
    await expect(modal).toHaveScreenshot("checkpoint-offline-390.png");
    phase = "forbidden";
    await modal.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(modal.getByRole("alert")).toContainText("access changed");
    phase = "empty";
    await modal.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(modal).toContainText(
      "No available matches. The saved position is unchanged.",
    );
    await focusWrap(page, modal);
    await accessible(page);
    await expect(modal).toHaveScreenshot("checkpoint-empty-390.png");
    await page.keyboard.press("Escape");
    await expect(opener).toBeFocused();
    await expect(editor).toContainText("Draft: restart this group");
    phase = "normal";
    await opener.click();
    await expect(
      modal.getByRole("button", { name: /S1 E[12]/ }).first(),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(editor).toContainText("Draft: restart this group");
    page.once("dialog", (d) => d.accept());
    await editor
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
  } finally {
    release();
  }
});

test("channel exposure explains empty history and recovers from unavailable and forbidden lookups", async ({
  page,
}) => {
  const profileId = await login(page);
  const channel = await mutate(page, "/api/channels", {
    name: "Exposure state acceptance",
    profileId,
    visibility: "private",
  });
  // Keep the surrounding list independent of channels created by earlier tests.
  await page.route("**/api/admin/channels", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const items = (Array.isArray(data) ? data : data.items).filter(
      (item: { id: string }) => item.id === channel.id,
    );
    return route.fulfill({
      response,
      json: Array.isArray(data) ? items : { ...data, items },
    });
  });
  await page.goto(`/#channels?profile=${profileId}&channel=${channel.id}`);
  let phase = "held",
    release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/profiles/*/channels/*/statistics", async (route) => {
    if (phase === "held") await gate;
    if (phase === "unavailable" || phase === "forbidden")
      return route.fulfill({
        status: phase === "forbidden" ? 403 : 503,
        json: {
          error:
            phase === "forbidden"
              ? "Exposure access changed."
              : "Exposure lookup unavailable.",
        },
      });
    if (phase === "populated")
      return route.fulfill({
        json: {
          scheduled: [
            {
              mediaId: "11111111-1111-4111-8111-111111111111",
              title: "Synthetic episode exposure",
              kind: "program",
              assignments: 5,
              startedAssignments: 3,
            },
          ],
          deliveredForCurrentAccount: [
            {
              mediaId: "11111111-1111-4111-8111-111111111111",
              title: "Synthetic episode exposure",
              kind: "program",
              deliveredMs: 2400,
            },
          ],
        },
      });
    return route.fulfill({
      json: { scheduled: [], deliveredForCurrentAccount: [] },
    });
  });
  try {
    const panel = page.locator("details").filter({
      has: page.getByText("Scheduled and delivered exposure", {
        exact: true,
      }),
    });
    await panel.locator("summary").click();
    await expect(panel.getByRole("status")).toContainText("Loading");
    phase = "unavailable";
    release();
    await expect(panel.getByRole("alert")).toContainText("lookup unavailable");
    phase = "forbidden";
    await panel.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("access changed");
    phase = "empty";
    await panel.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(panel).toContainText(
      "No scheduled exposure recorded for this channel yet.",
    );
    await expect(panel).toContainText("not proof someone watched");
    await page.setViewportSize({ width: 390, height: 844 });
    await accessible(page);
    await expect(panel).toHaveScreenshot("exposure-empty-390.png");
    phase = "populated";
    await panel.locator("summary").click();
    await expect(panel).not.toHaveAttribute("open", "");
    await panel.locator("summary").click();
    await expect(
      panel.getByRole("row").filter({ hasText: "Synthetic episode exposure" }),
    ).toContainText("2.4");
    const history = panel.getByRole("region", {
      name: "Exposure history",
      exact: true,
    });
    expect(
      await textLines(
        history.getByRole("cell", {
          name: "Synthetic episode exposure",
          exact: true,
        }),
      ),
    ).toBeLessThanOrEqual(2);
    expect(
      await textLines(
        history.getByRole("cell", { name: "program", exact: true }),
      ),
    ).toBe(1);
    await history.focus();
    await accessible(page);
    await expect(panel).toHaveScreenshot("exposure-history-390.png");
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => history.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowRight");
    await expect(
      history.getByRole("cell", { name: "2.4", exact: true }),
    ).toBeInViewport({ ratio: 1 });
  } finally {
    release();
  }
});
