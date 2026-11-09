import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.use({ baseURL: "http://127.0.0.1:8786" });
async function setup(page: Page) {
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
      if (!r.ok) throw Error(await r.text());
      return r.status === 204 ? null : r.json();
    },
    { path, method, body },
  );
}
test("subtitle settings retain editable folders and failed drafts with guarded dismissal", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/#sources");
  await page
    .getByRole("button", { name: "Configure TV shows", exact: true })
    .click();
  const modal = page.getByRole("dialog", {
    name: "Configure TV shows",
    exact: true,
  });
  const settings = modal.getByRole("region", {
    name: "Subtitle search settings",
  });
  const folders = settings.getByLabel("Subtitle subdirectories", {
    exact: true,
  });
  await expect(folders).toBeEnabled();
  await folders.fill("Subs, Subtitles");
  await folders.press("End");
  await folders.pressSequentially(", CustomCaptions");
  await expect(folders).toHaveValue("Subs, Subtitles, CustomCaptions");
  page.once("dialog", (d) => d.dismiss());
  await page.keyboard.press("Escape");
  await expect(modal).toBeVisible();
  await page.route(
    "**/api/sources/*/subtitles",
    (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({
            status: 503,
            json: { error: "Synthetic settings retry" },
          })
        : route.continue(),
    { times: 1 },
  );
  await settings
    .getByRole("button", { name: "Save subtitle settings", exact: true })
    .click();
  await expect(settings.getByRole("alert")).toContainText(
    "Synthetic settings retry",
  );
  await expect(folders).toHaveValue("Subs, Subtitles, CustomCaptions");
  await settings
    .getByRole("button", { name: "Save subtitle settings", exact: true })
    .click();
  await expect(settings.getByRole("status")).toContainText(
    "Subtitle settings saved",
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1024 });
    await modal.evaluate((el) => {
      const section = el.querySelector(
        '[aria-label="Subtitle search settings"]',
      )!;
      el.scrollTop +=
        section.getBoundingClientRect().top -
        el.getBoundingClientRect().top -
        16;
    });
    await expect(modal).toHaveScreenshot(`subtitle-settings-${width}.png`);
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await modal
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
});

test("subtitle discovery shows provenance and manual preview/save preserves drafts through failure", async ({
  page,
}) => {
  await setup(page);
  // Normalize only the display timestamp in this local screenshot; real discovery remains server-side.
  for (const pattern of ["**/media/*/subtitles", "**/media/*/subtitles/check"])
    await page.route(pattern, async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      await route.fulfill({
        response,
        json: { ...data, checkedMs: 1794168000000 },
      });
    });
  await page.goto("/#library");
  await page
    .getByRole("article")
    .filter({ hasText: "Orbit Patrol" })
    .getByRole("button", { name: "Open details" })
    .click();
  await page
    .getByRole("button", { name: "Details for The Last Platform", exact: true })
    .click();
  const modal = page.getByRole("dialog", {
    name: "Video details",
    exact: true,
  });
  const panel = modal.getByRole("region", { name: "Discovered subtitles" });
  await panel
    .getByRole("button", { name: "Check / Rescan subtitles", exact: true })
    .click();
  await expect(panel).toContainText("subfolder");
  await expect(panel).toContainText("ambiguous");
  await panel
    .getByLabel("Relative subtitle filename", { exact: true })
    .fill("Subs/English.srt");
  page.once("dialog", (d) => d.dismiss());
  await page.keyboard.press("Escape");
  await expect(modal).toBeVisible();
  await panel
    .getByRole("button", { name: "Check subtitle candidate", exact: true })
    .click();
  await expect(panel).toContainText("ready to associate");
  await page.route(
    "**/subtitles/check",
    (route) =>
      route.fulfill({
        status: 503,
        json: { error: "Synthetic association retry" },
      }),
    { times: 1 },
  );
  await panel
    .getByRole("button", { name: "Save subtitle association", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "Synthetic association retry",
  );
  await expect(
    panel.getByLabel("Relative subtitle filename", { exact: true }),
  ).toHaveValue("Subs/English.srt");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1024 });
    await modal.evaluate((el) => {
      const section = el.querySelector('[aria-label="Discovered subtitles"]')!;
      el.scrollTop +=
        section.getBoundingClientRect().top -
        el.getBoundingClientRect().top -
        16;
    });
    await expect(modal).toHaveScreenshot(`subtitle-discovery-${width}.png`);
    await modal.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(modal).toHaveScreenshot(`subtitle-manual-${width}.png`);
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await panel
    .getByRole("button", { name: "Save subtitle association", exact: true })
    .click();
  await expect(panel).toContainText("Subtitle association saved");
  await expect(
    panel.getByLabel("Relative subtitle filename", { exact: true }),
  ).toHaveValue("");
  const recheck = page.waitForResponse(
    (r) => r.url().endsWith("/subtitles/check") && r.status() === 200,
  );
  await panel
    .getByRole("button", { name: "Check / Rescan subtitles", exact: true })
    .click();
  await recheck;
  await expect(
    panel.getByRole("button", {
      name: "Check / Rescan subtitles",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(panel).toContainText("manual");
  await page.unrouteAll({ behavior: "wait" });
});

test.describe("external subtitle playback", () => {
  // Keep the post-commercial program observable while real HLS buffers in CI.
  test.use({ baseURL: "http://127.0.0.1:8792" });
  test("browser renders real external subtitles and retains source-time cues during pause with authenticated HLS audio", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const profileId = await setup(page);
    const sources = await page.evaluate(async () =>
      (await fetch("/api/sources")).json(),
    );
    const source = sources.find((s: { kind: string }) => s.kind === "shows");
    const selection = await mutate(
      page,
      `/api/profiles/${profileId}/selection`,
      "POST",
      { type: "folder", sourceId: source.id, directory: "", recursive: true },
    );
    const item = selection.items.find(
      (m: { metadata: { episodeNumber: number } }) =>
        m.metadata.episodeNumber === 1,
    );
    const ads =
      sources.find((s: { kind: string }) => s.kind === "commercials") ??
      (await mutate(page, "/api/sources", "POST", {
        name: "Subtitle proof ads",
        root: source.rootPath.replace(/\/media$/, "/commercials"),
        kind: "commercials",
        recursive: true,
      }));
    await mutate(page, `/api/sources/${ads.id}/scan`, "POST", {});
    await mutate(page, `/api/profiles/${profileId}/grants`, "POST", {
      sourceId: ads.id,
      subtree: "",
    });
    const ch = await mutate(page, "/api/channels", "POST", {
      name: "External caption proof",
      profileId,
      visibility: "private",
    });
    await mutate(
      page,
      `/api/channels/${ch.id}/programming?horizonMs=3600000`,
      "PUT",
      {
        profileId,
        seed: 123,
        groups: [
          {
            id: "external",
            mode: "ordered",
            selection: { type: "media", ids: [item.id] },
          },
        ],
        commercialSelection: {
          type: "folder",
          sourceId: ads.id,
          directory: "",
          recursive: true,
        },
        rules: {
          between: false,
          positions: [{ kind: "timestamp", value: 20000 }],
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
    const commercial = page.waitForResponse(
      async (r) =>
        r.request().method() === "GET" &&
        /\/api\/playback\/sessions\/[^/]+$/.test(new URL(r.url()).pathname) &&
        r.status() === 200 &&
        (await r.json()).playback?.entry.kind === "commercial",
    );
    await page.reload();
    await page.goto("/#watch");
    await page
      .getByRole("article")
      .filter({ hasText: "External caption proof" })
      .getByRole("button", { name: "Watch live", exact: true })
      .click();
    const captions = page.getByRole("combobox", {
      name: "Subtitles",
      exact: true,
    });
    const en = await captions
      .locator("option")
      .filter({ hasText: "en · subfolder" })
      .getAttribute("value");
    expect(en).toBeTruthy();
    const captionResponse = page.waitForResponse(
      (r) => /subtitles\/1\d+\.vtt/.test(r.url()) && r.status() === 200,
    );
    await captions.selectOption(en!);
    await captionResponse;
    await expect(page.locator(".subtitle-cue")).toHaveText(
      "External fixture episode 1",
    );
    // Observe the commercial and its matching return while real audio buffers.
    // The long fixture leaves enough program time to inspect returned cues.
    await Promise.all([
      (async () => {
        const ad = await (await commercial).json();
        expect(ad.playback.entry.endMs - ad.playback.entry.startMs).toBe(7000);
        // Joining midway can skip the first ad. Match the return to the ad seen.
        const returnedProgram = page.waitForResponse(async (r) => {
          if (
            r.request().method() !== "GET" ||
            !/\/api\/playback\/sessions\/[^/]+$/.test(
              new URL(r.url()).pathname,
            ) ||
            r.status() !== 200
          )
            return false;
          const current = await r.json();
          return (
            current.playback?.entry.kind === "program" &&
            current.playback.entry.startMs === ad.playback.entry.endMs &&
            current.playback.entry.offsetMs === 20000
          );
        });
        await expect(page.locator(".subtitle-cue")).toBeHidden();
        const program = await returnedProgram;
        expect((await program.json()).playback.entry.offsetMs).toBe(20000);
        await expect(page.locator(".subtitle-cue")).toHaveText(
          "External fixture episode 1",
        );
      })(),
      (async () => {
        let pausedProgram = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          await expect(page.locator(".subtitle-cue")).toHaveText(
            "External fixture episode 1",
          );
          const pausedResponse = page.waitForResponse(
            (r) =>
              r.request().method() === "POST" &&
              r.url().endsWith("/pause") &&
              r.status() === 200,
          );
          await page
            .getByRole("button", { name: "Pause", exact: true })
            .click();
          const paused = await (await pausedResponse).json();
          expect(paused.paused).toBe(true);
          await expect(
            page.getByRole("button", { name: "Resume", exact: true }),
          ).toBeVisible();
          if (paused.playback.entry.kind === "program") {
            pausedProgram = true;
            await expect(page.locator(".subtitle-cue")).toHaveText(
              "External fixture episode 1",
            );
            break;
          }
          // A real live boundary can occur between seeing a cue and the server
          // applying Pause. Commercials correctly have no episode captions.
          expect(paused.playback.entry.kind).toBe("commercial");
          await expect(page.locator(".subtitle-cue")).toBeHidden();
          await page
            .getByRole("button", { name: "Resume", exact: true })
            .click();
        }
        expect(
          pausedProgram,
          "pause an authoritative program interval before checking its cue",
        ).toBe(true);
        await page.getByRole("button", { name: "Resume", exact: true }).click();
        const segment = page.waitForResponse(
          (r) => r.url().includes(".ts?audioTrack=2") && r.status() === 200,
        );
        await page
          .getByRole("combobox", { name: "Audio", exact: true })
          .selectOption("2");
        await segment;
      })(),
    ]);
    await expect
      .poll(() =>
        page
          .locator("video")
          .evaluate((v) => (v as HTMLVideoElement).readyState),
      )
      .toBeGreaterThanOrEqual(2);
  });
});

test("output cleanup shows a readable review, guards confirmation, and recovers a stale review before applying", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/#generated");
  const panel = page.getByRole("region", {
    name: "Output storage",
    exact: true,
  });
  await panel
    .getByRole("button", { name: "Review cleanup", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "No files or references have changed",
  );
  await expect(panel).toContainText("Unknown files preserved");
  expect(await panel.textContent()).not.toMatch(/"review"|[a-f0-9]{64}/);
  let applies = 0;
  page.on("request", (r) => {
    if (
      r.url().endsWith("/api/admin/assets/cleanup") &&
      r.method() === "POST" &&
      !r.postDataJSON().dryRun
    )
      applies++;
  });
  page.once("dialog", (d) => d.dismiss());
  await panel
    .getByRole("button", { name: "Apply reviewed cleanup", exact: true })
    .click();
  expect(applies).toBe(0);
  await page.route(
    "**/api/admin/assets/cleanup",
    (route) =>
      route.request().postDataJSON().dryRun
        ? route.continue()
        : route.fulfill({
            status: 409,
            json: {
              error:
                "Output storage changed; review reconciliation again before applying",
            },
          }),
    { times: 1 },
  );
  page.once("dialog", (d) => d.accept());
  await panel
    .getByRole("button", { name: "Apply reviewed cleanup", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "review reconciliation again",
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1024 });
    await expect(panel).toHaveScreenshot(`output-cleanup-${width}.png`);
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await panel
    .getByRole("button", { name: "Review cleanup", exact: true })
    .click();
  const applied = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/admin/assets/cleanup") &&
      r.status() === 200 &&
      !r.request().postDataJSON().dryRun,
  );
  page.once("dialog", (d) => d.accept());
  await panel
    .getByRole("button", { name: "Apply reviewed cleanup", exact: true })
    .click();
  await applied;
  await expect(panel.getByRole("status")).toContainText("Cleanup complete");
  await expect(
    panel.getByRole("button", { name: "Apply reviewed cleanup", exact: true }),
  ).toHaveCount(0);
});
