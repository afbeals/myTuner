import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { selectInitialProfile } from "./workspace";
import type { Playback } from "../web/src/types";

test("a delayed pre-handover poll cannot undo refreshed playback, and legacy recovery remains visible", async ({
  page,
}) => {
  let releasePoll!: () => void, releaseNegotiation!: () => void;
  const pollGate = new Promise<void>((r) => (releasePoll = r)),
    negotiationGate = new Promise<void>((r) => (releaseNegotiation = r));
  let oldPoll = false,
    newState: Playback | undefined,
    legacy = false,
    goLiveCalls = 0;
  const sessionPath = /\/api\/playback\/sessions\/[^/]+$/;
  await page.route(sessionPath, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    if (!oldPoll) {
      oldPoll = true;
      const response = await route.fetch(),
        old = (await response.json()) as Playback;
      newState = {
        ...old,
        stateVersion: (old.stateVersion ?? 0) + 2,
        revisionId: "11111111-1111-4111-8111-111111111111",
        paused: true,
        positionMs: old.positionMs + 2000,
        behindLiveMs: 10000,
        scheduleUpdate: null,
        context: old.context
          ? {
              ...old.context,
              next: {
                title: "Updated next program",
                startMs: old.positionMs + 10000,
              },
            }
          : null,
      };
      releaseNegotiation();
      await pollGate;
      return route.fulfill({ response, json: old });
    }
    return route.fulfill({
      json: {
        ...newState,
        ...(legacy
          ? {
              stateVersion: (newState!.stateVersion ?? 0) + 1,
              scheduleUpdate: { atMs: null, rejoinRequired: true },
            }
          : {}),
      },
    });
  });
  await page.route("**/api/playback/sessions/*/negotiate", async (route) => {
    const response = await route.fetch(),
      delivery = await response.json();
    await negotiationGate;
    return route.fulfill({
      response,
      json: { ...delivery, revisionId: "11111111-1111-4111-8111-111111111111" },
    });
  });
  page.on("request", (request) => {
    if (request.url().endsWith("/goLive")) goLiveCalls++;
  });
  try {
    await page.goto("/");
    await page.getByLabel("Username", { exact: true }).fill("designer");
    await page
      .getByLabel("Password", { exact: true })
      .fill("synthetic-browser-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await selectInitialProfile(page);
    await page.goto("/#watch");
    await page
      .getByRole("article")
      .filter({ hasText: "After School" })
      .getByRole("button", { name: "Watch live", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Resume", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Updated next program", { exact: true }),
    ).toBeVisible();
    const staleResponse = page.waitForResponse(
      async (response) =>
        sessionPath.test(new URL(response.url()).pathname) &&
        response.request().method() === "GET" &&
        (await response.json()).stateVersion < newState!.stateVersion!,
    );
    releasePoll();
    await staleResponse;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(
      page.getByRole("button", { name: "Resume", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Updated next program", { exact: true }),
    ).toBeVisible();
    expect(goLiveCalls).toBe(0);
    legacy = true;
    const notice = page.getByText(
      "Programming has changed. Choose Go Live to receive the updated schedule.",
      { exact: true },
    );
    await expect(notice).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Go Live", exact: true }),
    ).toBeEnabled();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(notice).toHaveScreenshot(
        `playback-update-recovery-${width}.png`,
      );
    }
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  } finally {
    releasePoll();
    releaseNegotiation();
    await page.unrouteAll({ behavior: "wait" });
  }
});
