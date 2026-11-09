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
  await page
    .getByLabel("Current profile")
    .selectOption({ label: "Living Room" });
}
async function report(page: Page) {
  await login(page);
  await page.goto("/#watch");
  await page
    .getByRole("button", { name: "Watch live", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Report a problem", exact: true })
    .click();
  return page.getByRole("dialog", {
    name: "Report a playback problem",
    exact: true,
  });
}
async function inbox(page: Page) {
  return page.evaluate(
    async () =>
      (await (await fetch("/api/admin/problem-reports")).json()).items as {
        id: string;
        summary: { category: string };
      }[],
  );
}
test("R3-08 periodic guide refresh retains the focused channel through loading/error/retry and clears denied data", async ({
  page,
}) => {
  await login(page);
  await page.clock.install();
  await page.goto("/#watch");
  const preview = page.getByRole("button", { name: /^Preview / }).first();
  await preview.focus();
  const name = await preview.getAttribute("aria-label");
  let release!: () => void,
    pending = 0;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/profiles/*/guide", async (route) => {
    pending++;
    await gate;
    await route.fulfill({
      status: 503,
      json: { error: "Synthetic guide refresh failure" },
    });
  });
  await page.clock.runFor(30001);
  await expect.poll(() => pending).toBe(1);
  await expect(
    page.getByRole("status").filter({ hasText: "Loading" }),
  ).toBeVisible();
  await expect(preview).toBeFocused();
  release();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic guide refresh failure",
  );
  await expect(preview).toBeFocused();
  await page.unroute("**/api/profiles/*/guide");
  // Retry with the keyboard; return to the same channel when it finishes.
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: name!, exact: true }).focus();
  await page.clock.runFor(30001);
  await expect(preview).toBeFocused();
  await page.route("**/api/profiles/*/guide", (route) =>
    route.fulfill({
      status: 403,
      json: { error: "Synthetic guide access revoked" },
    }),
  );
  await page.clock.runFor(30001);
  await expect(page.getByRole("alert")).toContainText("access revoked");
  await expect(page.getByRole("button", { name: /^Preview / })).toHaveCount(0);
});
test("R8-03 unchanged uncertain report retries once; a changed review sends a separately identified category", async ({
  page,
}) => {
  const dialog = await report(page),
    before = new Set((await inbox(page)).map((r) => r.id));
  const identities: string[] = [];
  let lost = true;
  await page.route("**/api/problem-reports", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    identities.push(route.request().postDataJSON().requestId);
    const response = await route.fetch();
    if (lost) {
      lost = false;
      return route.abort("connectionfailed");
    }
    await route.fulfill({ response });
  });
  await dialog
    .getByRole("button", { name: "Review summary", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Send report", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("unconfirmed");
  await dialog
    .getByRole("button", { name: "Retry sending report", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("Report sent");
  expect(identities[0]).toBe(identities[1]);
  expect(
    (await inbox(page))
      .filter((r) => !before.has(r.id))
      .map((r) => r.summary.category),
  ).toEqual(["picture"]);
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", { name: "Report a problem", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Review summary", exact: true })
    .click();
  lost = true;
  await dialog
    .getByRole("button", { name: "Send report", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("unconfirmed");
  await dialog.getByLabel("Problem category").selectOption("sound");
  await dialog
    .getByRole("button", { name: "Review summary", exact: true })
    .click();
  await expect(dialog.locator(".report-summary")).toContainText("sound");
  await dialog
    .getByRole("button", { name: "Send report", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("Report sent");
  expect(identities[2]).not.toBe(identities[3]);
  expect(
    (await inbox(page))
      .filter((r) => !before.has(r.id))
      .map((r) => r.summary.category)
      .sort(),
  ).toEqual(["picture", "picture", "sound"]);
});
for (const failure of [false, true]) {
  test(`R8-03 late ${failure ? "failed" : "successful"} preview cannot replace a newer report category`, async ({
    page,
  }) => {
    const dialog = await report(page);
    let release!: () => void,
      held = 0;
    const gate = new Promise<void>((r) => (release = r));
    await page.route(
      "**/api/playback/sessions/*/report-preview",
      async (route) => {
        const response = await route.fetch();
        held++;
        await gate;
        await route.fulfill(
          failure
            ? { status: 503, json: { error: "Obsolete preview failure" } }
            : { response },
        );
      },
    );
    await dialog
      .getByRole("button", { name: "Review summary", exact: true })
      .click();
    await expect.poll(() => held).toBe(1);
    await dialog.getByLabel("Problem category").selectOption("captions");
    release();
    await expect(
      dialog.getByRole("button", { name: "Review summary", exact: true }),
    ).toBeEnabled();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Send report", exact: true }),
    ).toHaveCount(0);
    await page.unroute("**/api/playback/sessions/*/report-preview");
    await dialog
      .getByRole("button", { name: "Review summary", exact: true })
      .click();
    await expect(dialog.locator(".report-summary")).toContainText("captions");
    await page.setViewportSize({ width: 390, height: 1024 });
    expect(
      (await new AxeBuilder({ page }).include("dialog[open]").analyze())
        .violations,
    ).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Report a problem", exact: true }),
    ).toBeFocused();
  });
}
test("R8-03 late successful send cannot close a changed review or reuse its identity", async ({
  page,
}) => {
  const dialog = await report(page);
  await dialog
    .getByRole("button", { name: "Review summary", exact: true })
    .click();
  let release!: () => void,
    held = 0;
  const gate = new Promise<void>((r) => (release = r)),
    ids: string[] = [];
  await page.route("**/api/problem-reports", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    ids.push(route.request().postDataJSON().requestId);
    const response = await route.fetch();
    if (++held === 1) await gate;
    await route.fulfill({ response });
  });
  await dialog
    .getByRole("button", { name: "Send report", exact: true })
    .click();
  await expect.poll(() => held).toBe(1);
  await dialog.getByLabel("Problem category").selectOption("other");
  await dialog
    .getByRole("button", { name: "Review summary", exact: true })
    .click();
  await expect(dialog.locator(".report-summary")).toContainText("other");
  release();
  await expect(dialog.getByRole("status")).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Send report", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("Report sent");
  expect(ids[0]).not.toBe(ids[1]);
});
