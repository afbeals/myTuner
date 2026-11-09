import { test, expect, type Page } from "@playwright/test";
import type { Playback, Source } from "../web/src/types";
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
async function mutate(page: Page, path: string, method: string, body: unknown) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const { csrfToken } = await (await fetch("/api/auth/csrf")).json();
      const r = await fetch(path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw Error(`${r.status}: ${await r.text()}`);
      return r.status === 204 ? null : r.json();
    },
    { path, method, body },
  );
}
async function watch(page: Page) {
  await page.goto("/#watch");
  await page
    .getByRole("article")
    .filter({ hasText: "Concurrent format proof" })
    .getByRole("button", { name: "Watch live", exact: true })
    .click();
}
async function advancing(page: Page) {
  await expect
    .poll(
      () =>
        page
          .locator("video")
          .evaluate((v: HTMLVideoElement) => !v.paused && v.readyState >= 2),
      { timeout: 20000 },
    )
    .toBe(true);
  const before = await page
    .locator("video")
    .evaluate((v: HTMLVideoElement) => v.currentTime);
  await expect
    .poll(
      () =>
        page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
      { timeout: 10000 },
    )
    .not.toBe(before);
}

test("two viewers retain independent pause/audio/captions through HLS buffering, reload and repeated mixed-format breaks", async ({
  browser,
  page,
}) => {
  test.setTimeout(180000);
  const profileId = await login(page);
  const sources: Source[] = await page.evaluate(async () =>
    (await fetch("/api/sources")).json(),
  );
  const shows = sources.find((s) => s.kind === "shows")!;
  const selected = await mutate(
    page,
    `/api/profiles/${profileId}/selection`,
    "POST",
    { type: "folder", sourceId: shows.id, directory: "", recursive: true },
  );
  const ids = selected.items
    .sort((a: { path: string }, b: { path: string }) =>
      a.path.localeCompare(b.path),
    )
    .map((m: { id: string }) => m.id);
  expect(
    selected.items.some((m: { path: string }) => m.path.endsWith(".mkv")),
  ).toBe(true);
  const ads = await mutate(page, "/api/sources", "POST", {
    name: "Acceptance synthetic ads",
    root: shows.rootPath!.replace(/\/media$/, "/commercials"),
    kind: "commercials",
    recursive: true,
  });
  await mutate(page, `/api/sources/${ads.id}/scan`, "POST", {});
  await mutate(page, `/api/profiles/${profileId}/grants`, "POST", {
    sourceId: ads.id,
    subtree: "",
  });
  const ch = await mutate(page, "/api/channels", "POST", {
    name: "Concurrent format proof",
    profileId,
    visibility: "private",
  });
  await mutate(
    page,
    `/api/channels/${ch.id}/programming?horizonMs=3600000`,
    "PUT",
    {
      profileId,
      seed: 42,
      groups: [
        { id: "mixed", mode: "ordered", selection: { type: "media", ids } },
      ],
      commercialSelection: {
        type: "folder",
        sourceId: ads.id,
        directory: "",
        recursive: true,
      },
      rules: {
        between: true,
        positions: [],
        maxClips: 1,
        maxDurationMs: 7000,
        overflowPolicy: "truncate",
        minRemainingMs: 6000,
        repeatAllowance: 100,
        maxPerBreak: 1,
        cooldownMs: 0,
      },
    },
  );
  await mutate(
    page,
    `/api/profiles/${profileId}/subscriptions/${ch.id}`,
    "PUT",
    {},
  );
  const secondContext = await browser.newContext({
    baseURL: "http://127.0.0.1:8791",
  });
  const second = await secondContext.newPage();
  const states: Playback[] = [];
  let segments = 0,
    captionBodies = 0;
  page.on("response", async (r) => {
    try {
      if (
        r.ok() &&
        /\/api\/playback\/sessions(?:\/[^/]+)?$/.test(
          new URL(r.url()).pathname,
        ) &&
        ["GET", "POST"].includes(r.request().method())
      )
        states.push(await r.json());
      if (r.ok() && r.url().includes(".ts?audioTrack=2")) segments++;
      if (
        r.ok() &&
        r.url().includes("/subtitles/") &&
        (await r.text()).includes("External fixture episode")
      )
        captionBodies++;
    } catch {
      /* A navigation may abort an in-flight observation. */
    }
  });
  try {
    await login(second);
    await watch(page);
    const secondJoined = second.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === "/api/playback/sessions" &&
        r.status() === 201,
    );
    await watch(second);
    const secondSession: Playback = await (await secondJoined).json();
    await advancing(second);
    const audio = page.getByRole("combobox", { name: "Audio", exact: true });
    await expect(audio.locator('option[value="2"]')).toBeAttached();
    // Hold a real first selected-audio segment, then allow the media pipeline to recover.
    let release!: () => void,
      held = false;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await page.route(/\.ts\?audioTrack=2$/, async (route) => {
      if (!held) {
        held = true;
        await gate;
      }
      await route.continue();
    });
    try {
      await audio.selectOption("2");
      await expect.poll(() => held).toBe(true);
      await page.waitForTimeout(3000);
      release();
      await expect.poll(() => segments, { timeout: 20000 }).toBeGreaterThan(0);
      await advancing(page);
    } finally {
      release();
    }
    const subtitles = page.getByRole("combobox", {
      name: "Subtitles",
      exact: true,
    });
    const english = subtitles
      .locator("option")
      .filter({ hasText: "en · subfolder" });
    await expect(english).toBeAttached();
    await subtitles.selectOption((await english.getAttribute("value"))!);
    await expect(page.locator(".subtitle-cue")).toContainText(
      "External fixture episode",
    );
    await second.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(
      second.getByRole("button", { name: "Resume", exact: true }),
    ).toBeVisible();
    const firstId = states.at(-1)!.id;
    expect(secondSession.id).not.toBe(firstId);
    await advancing(page);
    await expect(audio).toHaveValue("2");
    await expect(
      second.getByRole("combobox", { name: "Audio", exact: true }),
    ).toHaveValue("-1");
    await expect(
      second.getByRole("button", { name: "Resume", exact: true }),
    ).toBeVisible();
    const pausedVideo = await second
      .locator("video")
      .evaluate((v: HTMLVideoElement) => v.currentTime);
    await page.waitForTimeout(2500);
    expect(
      await second
        .locator("video")
        .evaluate((v: HTMLVideoElement) => v.currentTime),
    ).toBe(pausedVideo);
    await second.getByRole("button", { name: "Go Live", exact: true }).click();
    await advancing(second);
    // Bounded local endurance: enough for multiple complete MP4 -> ad -> MKV -> ad cycles.
    const deadline = Date.now() + 90000;
    let reloaded = false;
    while (Date.now() < deadline) {
      await page.waitForTimeout(5000);
      expect(await page.locator("video").count()).toBe(1);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(second.getByRole("alert")).toHaveCount(0);
      if (!reloaded && deadline - Date.now() < 60000) {
        await page.reload();
        await watch(page);
        await advancing(page);
        reloaded = true;
      }
    }
    await advancing(page);
    await advancing(second);
    expect(
      new Set(
        states
          .filter((s) => s.playback?.entry.kind === "program")
          .map((s) => s.playback!.entry.mediaId),
      ).size,
    ).toBe(2);
    expect(states.some((s) => s.playback?.entry.kind === "commercial")).toBe(
      true,
    );
    expect(states.some((s) => s.id !== firstId)).toBe(true);
    expect(segments).toBeGreaterThan(3);
    expect(captionBodies).toBeGreaterThan(1);
    const exited = page.waitForResponse(
      (r) =>
        r.request().method() === "DELETE" &&
        /\/api\/playback\/sessions\/[^/]+$/.test(new URL(r.url()).pathname),
    );
    await page
      .locator(".video-stage")
      .getByRole("button", { name: "Channel guide", exact: true })
      .click();
    expect((await exited).ok()).toBe(true);
    await second
      .locator(".video-stage")
      .getByRole("button", { name: "Channel guide", exact: true })
      .click();
  } finally {
    await secondContext.close();
  }
});
