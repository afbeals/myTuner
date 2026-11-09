import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Programming, Source } from "../web/src/types";
test.use({ baseURL: "http://127.0.0.1:8786" });
async function mutate(
  page: Page,
  path: string,
  method: string,
  body?: unknown,
) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const { csrfToken } = await (await fetch("/api/auth/csrf")).json();
      const r = await fetch(path, {
        method,
        headers: {
          "X-CSRF-Token": csrfToken,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!r.ok) throw Error(`${r.status}: ${await r.text()}`);
      return r.status === 204 ? null : r.json();
    },
    { path, method, body },
  );
}
async function fixture(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("designer");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("navigation")).toBeAttached();
  await page
    .getByLabel("Current profile")
    .selectOption({ label: "Living Room" });
  const profileId = await page.getByLabel("Current profile").inputValue();
  const sources: Source[] = await page.evaluate(async () =>
      (await fetch("/api/sources")).json(),
    ),
    shows = sources.find((s) => s.kind === "shows")!;
  const videos = await mutate(
    page,
    `/api/profiles/${profileId}/selection`,
    "POST",
    { type: "folder", sourceId: shows.id, directory: "", recursive: true },
  );
  const config: Programming = {
    profileId,
    groups: [
      {
        id: "g",
        mode: "ordered",
        selection: { type: "media", ids: [videos.items[0].id] },
      },
    ],
    seed: 42,
    rules: {
      between: false,
      positions: [],
      maxClips: 0,
      maxDurationMs: 0,
      repeatAllowance: 1,
      maxPerBreak: 1,
      cooldownMs: 0,
    },
  };
  return {
    profileId,
    shows,
    videos: videos.items as { id: string; title: string }[],
    config,
  };
}
async function openEditor(page: Page, p: string, id: string) {
  await page.goto(`/#channels?profile=${p}&channel=${id}`);
  await page
    .locator(".channel-preview")
    .getByRole("button", { name: "Edit programming" })
    .click();
  return page.getByRole("dialog");
}

test("R7-01 history clears inspector and delete intent; I42 Undo and Recently deleted restore the original collection", async ({
  page,
}) => {
  const f = await fixture(page),
    a = await mutate(page, `/api/profiles/${f.profileId}/collections`, "POST", {
      name: "R7 Collection A",
      mediaIds: [f.videos[0]!.id],
    }),
    b = await mutate(page, `/api/profiles/${f.profileId}/collections`, "POST", {
      name: "R7 Collection B",
      mediaIds: [f.videos[1]!.id],
    });
  let release!: () => void,
    held = 0;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(
    `**/api/profiles/${f.profileId}/media/${f.videos[0]!.id}/details`,
    async (route) => {
      const response = await route.fetch();
      held++;
      await gate;
      await route.fulfill({ response }).catch(() => {});
    },
  );
  const deletions: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "DELETE" && r.url().includes("/collections/"))
      deletions.push(r.url());
  });
  try {
    await page.goto(`/#library?profile=${f.profileId}&collection=${b.id}`);
    await expect(
      page.getByRole("dialog", { name: b.name, exact: true }),
    ).toBeVisible();
    await page.evaluate(
      (hash) => (location.hash = hash),
      `library?profile=${f.profileId}&collection=${a.id}`,
    );
    await expect(
      page.getByRole("dialog", { name: a.name, exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: `Details for ${f.videos[0]!.title}`,
        exact: true,
      })
      .click();
    await expect.poll(() => held).toBe(1);
    await page.goBack();
    await expect(
      page.getByRole("dialog", { name: b.name, exact: true }),
    ).toBeVisible();
    release();
    await expect(
      page.getByRole("dialog", { name: "Video details", exact: true }),
    ).toHaveCount(0);
    await page.evaluate(
      (hash) => (location.hash = hash),
      `library?profile=${f.profileId}&collection=${a.id}`,
    );
    await expect(
      page.getByRole("dialog", { name: a.name, exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Delete collection", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Delete collection", exact: true }),
    ).toContainText(a.name);
    await page.goBack();
    await expect(
      page.getByRole("dialog", { name: b.name, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Delete collection", exact: true }),
    ).toHaveCount(0);
    expect(deletions).toHaveLength(0);
    await page
      .getByRole("button", { name: "Delete collection", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Delete collection", exact: true }),
    ).toContainText(b.name);
    await page
      .getByRole("button", { name: "Delete saved collection", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(deletions).toHaveLength(1);
    expect(deletions[0]).toContain(b.id);
    await page
      .getByRole("button", { name: "Undo deletion", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Undo deletion", exact: true }),
    ).toHaveCount(0);
    await mutate(
      page,
      `/api/profiles/${f.profileId}/collections/${b.id}`,
      "DELETE",
    );
    await page
      .getByRole("button", { name: "Recently deleted", exact: true })
      .click();
    const deleted = page.getByRole("dialog", {
      name: "Recently deleted collections",
      exact: true,
    });
    await expect(deleted).toContainText(b.name);
    // Keep expiry date deterministic for visual regression.
    await page.route(
      `**/api/profiles/${f.profileId}/deleted-collections`,
      (r) =>
        r.fulfill({
          json: {
            items: [
              { id: b.id, name: b.name, count: 1, expiresMs: 1893456000000 },
            ],
          },
        }),
    );
    await deleted.getByRole("button", { name: "Close dialog" }).click();
    await page
      .getByRole("button", { name: "Recently deleted", exact: true })
      .click();
    await expect(deleted).toHaveScreenshot("deleted-collections.png");
    await page.unroute(`**/api/profiles/${f.profileId}/deleted-collections`);
    await deleted
      .getByRole("button", { name: `Restore ${b.name}`, exact: true })
      .click();
    await expect(deleted).not.toContainText(b.name);
    const check = await page.evaluate(
      async ({ p, id }) =>
        (await fetch(`/api/profiles/${p}/collections/${id}`)).json(),
      { p: f.profileId, id: b.id },
    );
    expect(check.id).toBe(b.id);
    expect(check.items[0].id).toBe(f.videos[1]!.id);
  } finally {
    release();
  }
});

test("I43 stale previews/publications preserve the local draft and require deliberate review plus fresh preview", async ({
  page,
}) => {
  const f = await fixture(page),
    ch = await mutate(page, "/api/channels", "POST", {
      profileId: f.profileId,
      name: "R7 conflict channel",
      visibility: "private",
    });
  await mutate(page, `/api/channels/${ch.id}/programming`, "PUT", f.config);
  const editor = await openEditor(page, f.profileId, ch.id);
  await editor
    .getByRole("combobox", { name: "Rotation", exact: true })
    .selectOption("random");
  await mutate(page, `/api/channels/${ch.id}/programming`, "PUT", {
    ...f.config,
    seed: 99,
  });
  await editor.getByRole("button", { name: "Preview", exact: true }).click();
  await editor
    .getByRole("button", { name: "Generate two-hour preview" })
    .click();
  await expect(
    editor.getByRole("heading", {
      name: "Channel changed elsewhere",
      exact: true,
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 1024 });
  await expect(editor.locator("section.notice")).toHaveScreenshot(
    "programming-conflict-narrow.png",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await editor
    .getByRole("button", { name: "Keep draft and review against latest" })
    .click();
  await expect(
    editor.getByRole("heading", {
      name: "Channel changed elsewhere",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    editor.getByRole("button", { name: "Publish programming", exact: true }),
  ).toBeDisabled();
  await editor.getByRole("button", { name: "Content", exact: true }).click();
  await expect(
    editor.getByRole("combobox", { name: "Rotation", exact: true }),
  ).toHaveValue("random");
  await editor.getByRole("button", { name: "Preview", exact: true }).click();
  await editor
    .getByRole("button", { name: "Generate two-hour preview" })
    .click();
  await expect(
    editor.getByRole("button", { name: "Publish programming", exact: true }),
  ).toBeEnabled();
  await mutate(page, `/api/channels/${ch.id}/programming`, "PUT", {
    ...f.config,
    seed: 100,
  });
  await editor
    .getByRole("button", { name: "Publish programming", exact: true })
    .click();
  await expect(
    editor.getByRole("heading", {
      name: "Channel changed elsewhere",
      exact: true,
    }),
  ).toBeVisible();
  await editor
    .getByRole("button", { name: "Keep draft and review against latest" })
    .click();
  await editor
    .getByRole("button", { name: "Generate two-hour preview" })
    .click();
  await editor
    .getByRole("button", { name: "Publish programming", exact: true })
    .click();
  await expect(editor.getByRole("status")).toContainText("Programming saved");
  const saved = await page.evaluate(
    async (id) =>
      (await (await fetch(`/api/channels/${id}/programming`)).json()).config,
    ch.id,
  );
  expect(saved.groups[0].mode).toBe("random");
  expect(saved.expectedRevisionId).toBeUndefined();
});

test("R7-02 changing/removing a commercial pool clears old exclusions in the browser draft", async ({
  page,
}) => {
  const f = await fixture(page),
    ch = await mutate(page, "/api/channels", "POST", {
      profileId: f.profileId,
      name: "R7 pool change",
      visibility: "private",
    });
  let sources: Source[] = await page.evaluate(async () =>
      (await fetch("/api/sources")).json(),
    ),
    ads = sources.find((s) => s.kind === "commercials");
  if (!ads) {
    ads = await mutate(page, "/api/sources", "POST", {
      name: "R7 commercials",
      kind: "commercials",
      root: f.shows.rootPath!.replace(/\/media$/, "/commercials"),
      recursive: true,
    });
    await mutate(page, `/api/sources/${ads!.id}/scan`, "POST");
    await mutate(page, `/api/profiles/${f.profileId}/grants`, "POST", {
      sourceId: ads!.id,
      subtree: "",
    });
  }
  const pool = {
      type: "folder" as const,
      sourceId: ads!.id,
      directory: "",
      recursive: true,
    },
    clips = await mutate(
      page,
      `/api/profiles/${f.profileId}/selection`,
      "POST",
      pool,
    );
  await mutate(page, `/api/channels/${ch.id}/programming`, "PUT", {
    ...f.config,
    commercialSelection: pool,
    disabledCommercialIds: [clips.items[0].id],
  });
  const editor = await openEditor(page, f.profileId, ch.id);
  await editor
    .getByRole("button", { name: "Commercials", exact: true })
    .click();
  await editor
    .getByRole("combobox", { name: "Commercial pool", exact: true })
    .selectOption("");
  await editor
    .getByRole("button", { name: "Apply commercial rules", exact: true })
    .click();
  let previewBody: Programming | null = null;
  page.on("request", (r) => {
    if (r.url().includes("/programming/preview"))
      previewBody = r.postDataJSON();
  });
  await editor.getByRole("button", { name: "Preview", exact: true }).click();
  await editor
    .getByRole("button", { name: "Generate two-hour preview" })
    .click();
  await expect(editor.getByRole("table")).toBeVisible();
  expect(previewBody!.commercialSelection).toBeUndefined();
  expect(previewBody!.disabledCommercialIds).toEqual([]);
});

test("I39 guide recent lookup is read-only, date-aware, accessible and fits narrow screens", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.route("**/recent", (r) =>
    r.fulfill({
      json: {
        checkedMs: 1893456000000,
        startMs: 1893448800000,
        endMs: 1893456000000,
        truncated: false,
        retention:
          "Retained scheduled airings only; this may be a partial window. These are not viewing records or replay links.",
        items: [
          {
            programId: "synthetic-airing",
            title: "The Last Platform",
            seriesTitle: "Orbit Patrol",
            seasonNumber: 1,
            episodeNumber: 1,
            startMs: 1893455000000,
            endMs: 1893455990000,
          },
        ],
      },
    }),
  );
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.url().includes("/api/playback/"))
      writes.push(r.url());
  });
  await page.getByRole("link", { name: "Watch TV", exact: true }).click();
  await page
    .getByRole("button", { name: /Recently aired on/ })
    .first()
    .click();
  const recent = page.getByRole("dialog", {
    name: "Recently aired",
    exact: true,
  });
  await expect(recent).toContainText("S1 E1");
  await expect(recent).toContainText("2029");
  await page.setViewportSize({ width: 390, height: 1024 });
  await expect(recent).toHaveScreenshot("recent-airings-narrow.png");
  expect(
    (await new AxeBuilder({ page }).include("dialog[open]").analyze())
      .violations,
  ).toEqual([]);
  expect(writes).toEqual([]);
  void f;
});

test("I40 explicit report cancel/retry leaves paused playback intact and reaches admin inbox once", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("link", { name: "Watch TV", exact: true }).click();
  await page
    .getByRole("button", { name: "Watch live", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  let sends = 0,
    controls = 0,
    joins = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/problem-reports") && r.method() === "POST")
      sends++;
    if (
      /\/(pause|resume|goLive|negotiate)$/.test(r.url()) &&
      r.method() === "POST"
    )
      controls++;
    if (
      new URL(r.url()).pathname === "/api/playback/sessions" &&
      r.method() === "POST"
    )
      joins++;
  });
  await page
    .getByRole("button", { name: "Report a problem", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "Report a playback problem",
    exact: true,
  });
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  expect(sends).toBe(0);
  await page
    .getByRole("button", { name: "Report a problem", exact: true })
    .click();
  await dialog.getByLabel("Problem category").selectOption("captions");
  await dialog
    .getByRole("button", { name: "Review summary", exact: true })
    .click();
  await expect(dialog).toContainText("paused");
  await page.setViewportSize({ width: 390, height: 1024 });
  await expect(dialog).toHaveScreenshot("report-review-narrow.png", {
    mask: [
      dialog
        .locator(".report-summary")
        .locator("div")
        .filter({
          has: page.locator("dt").filter({
            hasText: /Prepared at|Channel reference|Airing reference/,
          }),
        }),
    ],
  });
  let lost = true;
  await page.route("**/api/problem-reports", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    if (lost) {
      lost = false;
      return route.abort("connectionfailed");
    }
    return route.fulfill({ response });
  });
  await dialog
    .getByRole("button", { name: "Send report", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("unconfirmed");
  await dialog
    .getByRole("button", { name: "Retry sending report", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("Report sent");
  expect(sends).toBe(2);
  expect(controls).toBe(0);
  expect(joins).toBe(0);
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await expect(page.locator("video")).toHaveJSProperty("paused", true);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page
    .getByRole("link", { name: "Problem reports", exact: true })
    .click();
  await expect(
    page.getByRole("article").filter({
      has: page.getByRole("heading", { name: "captions · New", exact: true }),
    }),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "Acknowledge report", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "captions · Acknowledged", exact: true }),
  ).toBeVisible();
});
