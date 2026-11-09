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
  await expect(
    page.getByRole("navigation", { includeHidden: true }),
  ).toBeAttached();
  await expect(page.getByLabel("Current profile")).not.toHaveValue("");
}
async function accessible(page: Page) {
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}
async function fits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}
const surfaces = [
  {
    hash: "channels",
    path: /\/api\/admin\/channels$/,
    empty: { items: [] },
    message: "Your network starts here",
  },
  {
    hash: "library",
    path: /\/api\/profiles\/[^/]+\/library(?:\?.*)?$/,
    empty: {
      sources: [],
      shows: [],
      movies: [],
      folders: [],
      movieCollections: [],
      page: 1,
      total: 0,
    },
    message: "No titles found",
  },
  {
    hash: "accounts",
    path: /\/api\/accounts$/,
    empty: [],
    message: "No accounts to display",
  },
  {
    hash: "sources",
    path: /\/api\/sources$/,
    empty: [],
    message: "Add your first source",
  },
  {
    hash: "subscriptions",
    path: /\/api\/profiles\/[^/]+\/channels$/,
    empty: [],
    message: "No channels available",
  },
  {
    hash: "generated",
    path: /\/api\/admin\/generation$/,
    empty: [],
    message: "No jobs yet",
  },
  {
    hash: "sessions",
    path: /\/api\/auth\/sessions$/,
    empty: [],
    message: "No active sessions",
  },
  {
    hash: "reports",
    path: /\/api\/admin\/problem-reports(?:\?.*)?$/,
    empty: { total: 0, retentionDays: 30, items: [] },
    message: "No reports",
  },
  {
    hash: "watch",
    path: /\/api\/profiles\/[^/]+\/guide(?:\?.*)?$/,
    empty: { channels: [] },
    message: "Your guide is empty",
  },
  {
    hash: "operations",
    path: /\/api\/admin\/status$/,
    empty: null,
    message: "",
  },
] as const;
for (const surface of surfaces) {
  test(`state audit: ${surface.hash} loading, unavailable, forbidden, recovery and empty`, async ({
    page,
  }) => {
    await login(page);
    await page.clock.setFixedTime(new Date("2026-11-08T20:00:00Z"));
    let phase = "held",
      release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await page.route(surface.path, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      if (phase === "held") await gate;
      if (phase === "unavailable")
        return route.fulfill({
          status: 503,
          json: { error: "Server temporarily unavailable. Try again." },
        });
      if (phase === "forbidden")
        return route.fulfill({
          status: 403,
          json: { error: "Access changed. Ask your administrator." },
        });
      if (phase === "empty") return route.fulfill({ json: surface.empty });
      return route.continue();
    });
    try {
      await page.goto("about:blank");
      await page.goto(`/#${surface.hash}`);
      await expect(
        page.getByRole("status").filter({ hasText: "Loading" }).first(),
      ).toBeVisible();
      phase = "unavailable";
      release();
      await expect(page.getByRole("alert").first()).toContainText(
        "temporarily unavailable",
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await fits(page);
      await accessible(page);
      await expect(page.locator("#main")).toHaveScreenshot(
        `${surface.hash}-unavailable-390.png`,
      );
      phase = "forbidden";
      await page
        .getByRole("button", { name: "Try again", exact: true })
        .first()
        .click();
      await expect(page.getByRole("alert").first()).toContainText(
        "Access changed",
      );
      phase = "normal";
      await page
        .getByRole("button", { name: "Try again", exact: true })
        .first()
        .click();
      await expect(page.getByRole("alert")).toHaveCount(0);
      if (surface.empty !== null) {
        phase = "empty";
        await page.reload();
        await expect(
          page.getByText(surface.message, {
            exact: surface.hash !== "generated",
          }),
        ).toBeVisible();
        await fits(page);
        await accessible(page);
        await expect(page.locator("#main")).toHaveScreenshot(
          `${surface.hash}-empty-390.png`,
        );
      }
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
  });
}

test("profile loading and failed lookup never imply an empty account; retry and expiry recover", async ({
  page,
}) => {
  let release!: () => void,
    phase = "held";
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/profiles", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    if (phase === "held") await gate;
    if (phase === "failed")
      return route.fulfill({
        status: 503,
        json: { error: "Profile lookup unavailable" },
      });
    return route.continue();
  });
  try {
    await page.goto("/");
    await page.getByLabel("Username", { exact: true }).fill("designer");
    await page
      .getByLabel("Password", { exact: true })
      .fill("synthetic-browser-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Loading permitted profiles…")).toBeVisible();
    await expect(page.getByText("Create your first profile")).toHaveCount(0);
    phase = "failed";
    release();
    await expect(page.getByRole("alert")).toContainText(
      "Profile lookup unavailable",
    );
    await expect(page.getByText("Create your first profile")).toHaveCount(0);
    phase = "normal";
    await page
      .getByRole("button", { name: "Retry profile loading", exact: true })
      .click();
    await expect(page.getByLabel("Current profile")).not.toHaveValue("");
    await page.route("**/api/admin/channels", (route) =>
      route.fulfill({ status: 401, json: { error: "Session expired" } }),
    );
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
  } finally {
    release();
  }
});

test("offline and unreadable server responses have recoverable plain-language errors", async ({
  page,
}) => {
  await login(page);
  let mode = "offline";
  await page.route("**/api/auth/sessions", (route) =>
    mode === "offline"
      ? route.abort("internetdisconnected")
      : mode === "html"
        ? route.fulfill({
            status: 502,
            contentType: "text/html",
            body: "<h1>upstream error</h1>",
          })
        : route.continue(),
  );
  await page.goto("/#sessions");
  await expect(page.getByRole("alert")).toContainText(
    "Unable to reach the server",
  );
  mode = "html";
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("unreadable response");
  mode = "normal";
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByText("Browser · This session")).toBeVisible();
});

test("account modal preserves failed drafts, guards close/navigation and restores keyboard focus", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#accounts");
  const opener = page.getByRole("button", {
    name: "+ Create account",
    exact: true,
  });
  await opener.click();
  const dialog = page.getByRole("dialog", {
    name: "Create account",
    exact: true,
  });
  await dialog.getByLabel("Username", { exact: true }).fill("unsaved-account");
  await dialog
    .getByLabel("Password", { exact: true })
    .fill("synthetic-draft-password");
  page.once("dialog", (d) => d.dismiss());
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Username", { exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Close dialog", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await page.route("**/api/accounts", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 409,
          json: { error: "Username already exists" },
        })
      : route.continue(),
  );
  await dialog
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("already exists");
  await expect(dialog.getByLabel("Username", { exact: true })).toHaveValue(
    "unsaved-account",
  );
  await accessible(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await fits(page);
    await expect(dialog).toHaveScreenshot(`account-error-${width}.png`);
  }
  page.once("dialog", (d) => d.accept());
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("integration lookup failure prevents blank overwrites; retry restores saved settings and failed draft", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#sources");
  let phase = "failed";
  await page.route("**/api/sources/*/integration", async (route) => {
    if (phase === "failed")
      return route.fulfill({
        status: 503,
        json: { error: "Integration lookup unavailable" },
      });
    if (route.request().method() === "GET")
      return route.fulfill({
        json: {
          provider: "sonarr",
          url: "http://sonarr.local:8989",
          mappings: [{ from: "/tv", to: "/media/shows" }],
        },
      });
    return route.fulfill({
      status: 409,
      json: { error: "Integration changed. Review configuration." },
    });
  });
  await page
    .getByRole("button", { name: "Configure TV shows", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText(
    "Integration lookup unavailable",
  );
  await expect(
    dialog.getByRole("button", {
      name: "Save metadata integration",
      exact: true,
    }),
  ).toHaveCount(0);
  phase = "normal";
  await dialog.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    dialog.getByLabel("Application URL", { exact: true }),
  ).toHaveValue("http://sonarr.local:8989");
  await dialog
    .getByLabel("Application URL", { exact: true })
    .fill("http://replacement.local:8989");
  await dialog
    .getByLabel("API key", { exact: true })
    .fill("synthetic-never-persisted");
  await dialog
    .getByRole("button", { name: "Save metadata integration", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("Integration changed");
  await expect(
    dialog.getByLabel("Application URL", { exact: true }),
  ).toHaveValue("http://replacement.local:8989");
  page.once("dialog", (d) => d.dismiss());
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
});

test("long profile/account/source text and 200-percent browser text remain usable without page overflow", async ({
  page,
}) => {
  await login(page);
  const long = "An exceptionally long household name ".repeat(3).slice(0, 100);
  await page.route("**/api/profiles", async (route) => {
    const r = await route.fetch();
    const rows = await r.json();
    await route.fulfill({
      response: r,
      json: rows.map((p: object) => ({ ...p, name: long })),
    });
  });
  await page.route("**/api/accounts", async (route) => {
    const r = await route.fetch();
    const rows = await r.json();
    await route.fulfill({
      response: r,
      json: rows.map((a: object) => ({
        ...a,
        username: "unbrokensyntheticaccount".repeat(3).slice(0, 64),
      })),
    });
  });
  await page.route("**/api/sources", async (route) => {
    const r = await route.fetch();
    const rows = await r.json();
    await route.fulfill({
      response: r,
      json: rows.slice(0, 1).map((source: object) => ({
        ...source,
        name: long,
        rootPath: "/media/" + "AnUnbrokenSyntheticDirectory".repeat(6),
      })),
    });
  });
  for (const hash of ["profiles", "accounts", "sources"]) {
    await page.goto("about:blank");
    await page.goto(`/#${hash}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: "Loading" }),
    ).toHaveCount(0);
    await expect(
      hash !== "accounts"
        ? page.getByRole("heading", { name: long, exact: true }).first()
        : page
            .getByRole("cell", {
              name: "unbrokensyntheticaccount".repeat(3).slice(0, 64),
            })
            .first(),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await fits(page);
    await accessible(page);
    await expect(page.locator("#main")).toHaveScreenshot(
      `${hash}-long-390.png`,
    );
    await page.evaluate(() => {
      const sized = [
        ...document.querySelectorAll<HTMLElement>("#main, #main *"),
      ].map((el) => ({ el, size: parseFloat(getComputedStyle(el).fontSize) }));
      sized.forEach(({ el, size }) => {
        el.style.fontSize = `${size * 2}px`;
      });
    });
    await fits(page);
    await accessible(page);
    const buttons = page.getByRole("button");
    expect(await buttons.count()).toBeGreaterThan(0);
    expect(
      await buttons.evaluateAll((nodes) =>
        nodes.every((el) => el.scrollHeight <= el.clientHeight + 2),
      ),
    ).toBe(true);
    await expect(page.locator("#main")).toHaveScreenshot(
      `${hash}-text-200-390.png`,
    );
  }
});

test("library clear filters restores results and refresh retains the last catalog during an outage", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#library");
  const search = page.getByRole("textbox", { name: "Search", exact: true });
  await search.fill("absent-synthetic-title");
  await expect(
    page.getByRole("heading", { name: "No titles found" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(search).toHaveValue("");
  await expect(
    page.getByRole("article").filter({ hasText: "Orbit Patrol" }),
  ).toBeVisible();
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  let forbidden = false;
  await page.route(
    /\/api\/profiles\/[^/]+\/library(?:\?.*)?$/,
    async (route) => {
      await held;
      await route.fulfill({
        status: forbidden ? 403 : 503,
        json: {
          error: forbidden
            ? "Catalog access changed"
            : "Catalog temporarily offline",
        },
      });
    },
  );
  try {
    await page
      .getByRole("button", { name: "Refresh view", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Loading" }),
    ).toBeVisible();
    await expect(
      page.getByRole("article").filter({ hasText: "Orbit Patrol" }),
    ).toBeVisible();
    release();
    await expect(page.getByRole("alert")).toContainText(
      "Catalog temporarily offline",
    );
    await expect(
      page.getByRole("article").filter({ hasText: "Orbit Patrol" }),
    ).toBeVisible();
    forbidden = true;
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Catalog access changed",
    );
    await expect(
      page.getByRole("article").filter({ hasText: "Orbit Patrol" }),
    ).toHaveCount(0);
  } finally {
    release();
  }
});

test("generation progress, deliberate cancellation and failed retry retain completed outputs", async ({
  page,
}) => {
  await login(page);
  let status = "running",
    cancelRequests = 0,
    retryRequests = 0;
  const details = () => ({
    id: "synthetic-job",
    sourceId: "fixture",
    directory: "",
    status,
    total: 3,
    completed: 1,
    failed: status === "failed" ? 1 : 0,
    error: null,
    items: [
      {
        id: "done",
        mediaId: "one",
        title: "Completed synthetic preview",
        kind: "thumbnail",
        status: "completed",
        error: null,
      },
      {
        id: "remaining",
        mediaId: "two",
        title: "Another synthetic video",
        kind: "gif",
        status:
          status === "failed"
            ? "failed"
            : status === "cancelled"
              ? "cancelled"
              : "running",
        error:
          status === "failed"
            ? "Output unavailable; retry the unfinished work."
            : null,
      },
    ],
  });
  await page.route("**/api/admin/generation", (route) =>
    route.fulfill({ json: [details()] }),
  );
  await page.route("**/api/generation/jobs/synthetic-job", (route) =>
    route.fulfill({ json: details() }),
  );
  await page.route("**/api/generation/jobs/synthetic-job/cancel", (route) => {
    cancelRequests++;
    status = "cancelled";
    return route.fulfill({ json: details() });
  });
  await page.route("**/api/admin/generation/synthetic-job/retry", (route) => {
    retryRequests++;
    return route.fulfill({
      status: 503,
      json: { error: "Worker unavailable. Try again." },
    });
  });
  await page.goto("/#generated");
  await page.getByRole("button", { name: "View job", exact: true }).click();
  const modal = page.getByRole("dialog", {
    name: "Generation progress",
    exact: true,
  });
  await expect(modal.getByRole("progressbar")).toHaveAttribute("value", "1");
  await expect(modal).toContainText("1/3 outputs completed");
  await modal.getByRole("button", { name: "Cancel job", exact: true }).focus();
  await page.waitForTimeout(3500);
  await expect(
    modal.getByRole("button", { name: "Cancel job", exact: true }),
  ).toBeFocused();
  page.once("dialog", (d) => d.dismiss());
  await modal.getByRole("button", { name: "Cancel job", exact: true }).click();
  expect(cancelRequests).toBe(0);
  await expect(modal).toContainText("running");
  page.once("dialog", (d) => d.accept());
  await modal.getByRole("button", { name: "Cancel job", exact: true }).click();
  await expect(modal.getByRole("status")).toContainText("cancelled");
  expect(cancelRequests).toBe(1);
  await modal
    .getByRole("button", { name: "Retry unfinished outputs", exact: true })
    .click();
  await expect(modal.getByRole("alert")).toContainText("Worker unavailable");
  expect(retryRequests).toBe(1);
  await expect(modal).toContainText("Completed synthetic preview");
  await page.setViewportSize({ width: 390, height: 844 });
  await accessible(page);
  await expect(modal).toHaveScreenshot("generation-cancelled-retry-390.png");
});

for (const boundary of ["logout", "expiry"] as const) {
  test(`private library drafts are cleared across ${boundary} and another account sign-in`, async ({
    page,
  }) => {
    const aliceProfile = "11111111-1111-4111-8111-111111111111";
    const bobProfile = "22222222-2222-4222-8222-222222222222";
    const sourceId = "33333333-3333-4333-8333-333333333333";
    const channelId = "44444444-4444-4444-8444-444444444444";
    const privateDirectory = "Alice private anniversary footage";
    let user: string | null = "Alice";
    let expire = false;
    let created: Record<string, unknown> | null = null;
    let bobPrivateResponses = 0;
    const account = (name: string) => ({
      id: name,
      username: name,
      role: "editor",
      disabled: false,
    });
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const reply = (json: unknown, status = 200) => {
        if (user === "Bob" && JSON.stringify(json).includes(privateDirectory))
          bobPrivateResponses++;
        return route.fulfill({ status, json });
      };
      if (path === "/api/auth/me") return reply(account("Alice"));
      if (path === "/api/auth/csrf") return reply({ csrfToken: "synthetic" });
      if (path === "/api/auth/browser") {
        user = request.postDataJSON().username;
        return reply({ account: account(user!), csrfToken: "synthetic" });
      }
      if (path === "/api/auth/logout") {
        user = null;
        return route.fulfill({ status: 204 });
      }
      if (path === "/api/playback/startup")
        return route.fulfill({ status: 204 });
      if (path === "/api/profiles")
        return reply([
          {
            id: user === "Alice" ? aliceProfile : bobProfile,
            name: `${user} room`,
            kind: "room",
            ownerAccountId: null,
            pinProtected: false,
            locked: false,
          },
        ]);
      if (path.endsWith("/library/options"))
        return reply({
          items: [],
          sources: [],
          total: 0,
          offset: 0,
          limit: 50,
        });
      if (path.endsWith("/library"))
        return reply({
          sources:
            user === "Alice"
              ? [{ id: sourceId, name: "Private source", kind: "videos" }]
              : [],
          folders:
            user === "Alice"
              ? [{ sourceId, directory: privateDirectory, available: 1 }]
              : [],
          shows: [],
          movies: [],
          movieCollections: [],
        });
      if (path.endsWith("/collections")) return reply({ items: [] });
      if (path.endsWith("/selection"))
        return user === "Alice"
          ? reply({
              items: [
                {
                  id: "synthetic-private-clip",
                  sourceId,
                  title: "Private clip",
                  available: true,
                  durationMs: 60000,
                  metadata: {},
                },
              ],
            })
          : reply({ error: "Not found" }, 404);
      if (path.endsWith("/guide")) return reply({ channels: [] });
      if (path === "/api/channels" && request.method() === "POST") {
        created = {
          ...request.postDataJSON(),
          id: channelId,
          ownerAccountId: "Bob",
          archived: false,
          shortName: "BOB",
          shortNameOverride: null,
        };
        return reply(created, 201);
      }
      if (path.endsWith("/channels")) {
        if (expire) {
          expire = false;
          user = null;
          return reply({ error: "Session expired" }, 401);
        }
        return reply(created ? [created] : []);
      }
      if (path.endsWith("/programming"))
        return reply({ revisionId: null, config: null, effectiveMs: null });
      return reply({});
    });
    await page.goto("/#library");
    await page
      .getByRole("button", { name: "Open details", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Use whole selection in a channel" })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Create channel", exact: true }),
    ).toBeVisible();
    await page.goBack();
    await expect(
      page.getByRole("heading", { name: "Your library", exact: true }),
    ).toBeVisible();
    if (boundary === "logout")
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
    else {
      expire = true;
      await page
        .getByRole("link", { name: "Subscriptions", exact: true })
        .click();
    }
    await page.getByLabel("Username", { exact: true }).fill("Bob");
    await page
      .getByLabel("Password", { exact: true })
      .fill("synthetic-second-account-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByLabel("Current profile")).toHaveValue(bobProfile);
    await page.getByRole("link", { name: "Channels", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Channels", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .getByRole("button", { name: "+ Create channel", exact: true })
      .click();
    await page.getByLabel("Channel name", { exact: true }).fill("Bob channel");
    await page.getByRole("button", { name: "Create & program" }).click();
    const editor = page.getByRole("dialog", { name: "Program Bob channel" });
    await expect(editor).toBeVisible();
    await expect(editor).not.toContainText(privateDirectory);
    await expect(
      editor.getByText("Content group 1", { exact: true }),
    ).toHaveCount(0);
    expect(bobPrivateResponses).toBe(0);
  });
}
