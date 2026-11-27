import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { selectInitialProfile } from "./workspace";

let origin = "";
let child: import("node:child_process").ChildProcess | null = null;
let fixtureLog = "";
test.beforeEach(async () => {
  const { createServer } = await import("node:net");
  const { spawn } = await import("node:child_process");
  const reservation = createServer();
  await new Promise<void>((resolve) =>
    reservation.listen(0, "127.0.0.1", resolve),
  );
  const port = (reservation.address() as import("node:net").AddressInfo).port;
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  origin = `http://127.0.0.1:${port}`;
  fixtureLog = "";
  child = spawn(
    process.execPath,
    ["--import", "tsx", "e2e/server.ts", "--demo"],
    {
      env: {
        ...process.env,
        MYTUNER_E2E_PORT: String(port),
        npm_config_offline: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const output of [child.stdout, child.stderr])
    output?.on("data", (chunk) => {
      fixtureLog = (fixtureLog + String(chunk)).slice(-20000);
    });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Reset fixture exited: ${fixtureLog}`);
    try {
      if ((await fetch(`${origin}/api/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Reset fixture did not start: ${fixtureLog}`);
});
test.afterEach(async () => {
  const fixture = child;
  child = null;
  if (!fixture || fixture.exitCode !== null) return;
  const closed = new Promise<void>((resolve) =>
    fixture.once("exit", () => resolve()),
  );
  fixture.kill("SIGTERM");
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    closed,
    new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        fixture.kill("SIGKILL");
        resolve();
      }, 5000);
    }),
  ]);
  clearTimeout(timer);
  if (fixture.exitCode === null && fixture.signalCode === null) await closed;
  expect(fixture.exitCode, fixtureLog).toBe(0);
});
async function login(
  page: Page,
  username = "designer",
  password = "synthetic-browser-password",
) {
  await page.goto(origin);
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await selectInitialProfile(page);
}
async function api(page: Page, path: string, method = "GET", body?: unknown) {
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
      return {
        status: response.status,
        data: response.status === 204 ? null : await response.json(),
      };
    },
    { path, method, body },
  );
}

test("reset review retains the current second administrator, shows dependencies and exact counts, and only plans offline execution", async ({
  page,
  browser,
}) => {
  await login(page);
  const username = `resetadmin${randomUUID().slice(0, 8)}`;
  const password = "synthetic-reset-admin-password";
  const created = await api(page, "/api/accounts", "POST", {
    username,
    password,
    role: "admin",
  });
  expect(created.status).toBe(201);
  const originalSources = (await api(page, "/api/sources")).data;
  expect(originalSources).toHaveLength(2);
  const context = await browser.newContext();
  try {
    const administrator = await context.newPage();
    await login(administrator, username, password);
    const optionsResponse = await api(
      administrator,
      "/api/admin/reset/options",
    );
    expect(optionsResponse.status).toBe(200);
    const options = optionsResponse.data as {
      retainedAdmin: { id: string; username: string };
      categories: { id: string; label: string }[];
    };
    expect(options.retainedAdmin).toEqual({ id: created.data.id, username });
    const label = (id: string) =>
      options.categories.find((category) => category.id === id)!.label;
    await administrator.goto(`${origin}/#operations`);
    await administrator
      .getByText("Reset application data · offline execution", { exact: true })
      .click();
    await administrator
      .getByRole("button", { name: "Review reset options", exact: true })
      .click();
    const dialog = administrator.getByRole("dialog", {
      name: "Review application data reset",
      exact: true,
    });
    const retained = dialog.getByRole("region", {
      name: "Retained administrator",
      exact: true,
    });
    await expect(retained).toContainText(username);
    await expect(retained).toContainText(created.data.id);
    await expect(retained).not.toContainText("designer");
    await expect(dialog).toContainText(
      "Preview only. This page does not reset the database.",
    );
    await expect(
      dialog.getByRole("button", { name: "Review exact changes", exact: true }),
    ).toBeDisabled();
    await dialog
      .getByRole("checkbox", { name: label("sources"), exact: true })
      .check();
    for (const id of [
      "catalog",
      "metadata",
      "custom",
      "collections",
      "channels",
      "activity",
    ]) {
      const checkbox = dialog.getByRole("checkbox", {
        name: label(id),
        exact: true,
      });
      await expect(checkbox).toBeChecked();
      await expect(checkbox).toBeDisabled();
      await expect(
        checkbox.locator("xpath=ancestor::section[1]"),
      ).toContainText("Required by");
    }
    await expect(
      dialog.getByRole("checkbox", { name: label("accounts"), exact: true }),
    ).not.toBeChecked();
    const response = administrator.waitForResponse(
      (response) =>
        response.url().endsWith("/api/admin/reset/preview") &&
        response.status() === 200,
    );
    await dialog
      .getByRole("button", { name: "Review exact changes", exact: true })
      .click();
    const preview = await (await response).json();
    await expect(
      dialog.getByRole("heading", {
        name: "Review selective reset",
        exact: true,
      }),
    ).toBeFocused();
    expect(preview.requestedCategories).toEqual(["sources"]);
    expect(preview.retainedAdmin).toEqual({ id: created.data.id, username });
    const counts = dialog.getByRole("region", {
      name: "Exact database record counts",
      exact: true,
    });
    const sourceRow = counts.getByRole("row").filter({
      has: administrator.getByRole("cell", { name: "sources", exact: true }),
    });
    await expect(sourceRow.getByRole("cell").nth(1)).toHaveText("Remove");
    await expect(sourceRow.getByRole("cell").nth(2)).toHaveText("2");
    await dialog.getByText("Preview revision", { exact: true }).click();
    await expect(dialog).toContainText(preview.revision);
    const commands = dialog.getByRole("region", {
      name: /^Offline .* command$/,
    });
    await expect(commands).toHaveCount(2);
    for (const command of await commands.all()) {
      await expect(command).toContainText(created.data.id);
      await expect(command).not.toContainText(password);
    }
    await expect(dialog).toContainText(preview.confirmationText);
    await expect(dialog).toContainText(
      "verifies a recoverable backup before changing records",
    );
    await expect(dialog).toContainText(
      "Automatic filesystem cleanup remains disabled",
    );
    await expect(
      dialog.getByRole("link", {
        name: "Offline reset and recovery guide",
        exact: true,
      }),
    ).toHaveAttribute("href", /#setup\?topic=recovery/);
    await expect(dialog.getByLabel("Password", { exact: true })).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: /^Reset now$|^Apply reset$/ }),
    ).toHaveCount(0);
    for (const width of [1440, 390]) {
      await administrator.setViewportSize({ width, height: 844 });
      await expect(
        dialog.getByRole("button", { name: "Done", exact: true }),
      ).toBeVisible();
      const footer = await dialog.locator(".dialog-footer").boundingBox();
      expect(footer!.y + footer!.height).toBeLessThanOrEqual(844);
      expect(
        await administrator.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    expect(
      (
        await new AxeBuilder({ page: administrator })
          .include("dialog[open]")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect((await api(administrator, "/api/sources")).data).toEqual(
      originalSources,
    );
    // The browser has no destructive reset endpoint; this request targets only this disposable fixture.
    expect(
      (await api(administrator, "/api/admin/reset/execute", "POST", {})).status,
    ).toBe(404);
    await dialog
      .getByRole("button", { name: "Change choices", exact: true })
      .click();
    await dialog
      .getByRole("checkbox", { name: label("sources"), exact: true })
      .uncheck();
    await expect(
      dialog.getByRole("button", { name: "Review exact changes", exact: true }),
    ).toBeDisabled();
    await dialog
      .getByLabel("Reset mode", { exact: true })
      .selectOption("fresh");
    for (const category of options.categories) {
      await expect(
        dialog.getByRole("checkbox", { name: category.label, exact: true }),
      ).toBeChecked();
      await expect(
        dialog.getByRole("checkbox", { name: category.label, exact: true }),
      ).toBeDisabled();
    }
    const freshResponse = administrator.waitForResponse(
      (response) =>
        response.url().endsWith("/api/admin/reset/preview") &&
        response.status() === 200,
    );
    await dialog
      .getByRole("button", { name: "Review exact changes", exact: true })
      .click();
    const fresh = await (await freshResponse).json();
    expect(fresh.mode).toBe("fresh");
    expect(fresh.retainedAdmin.id).toBe(created.data.id);
    await expect(
      dialog.getByRole("heading", { name: "Review fresh start", exact: true }),
    ).toBeFocused();
    await expect(dialog).toContainText(`sign in as ${username}`);
    expect((await api(administrator, "/api/sources")).data).toEqual(
      originalSources,
    );
  } finally {
    await context.close();
  }
});

test("reset options and previews deny a non-admin and remain absent from its operations route", async ({
  page,
  browser,
}) => {
  await login(page);
  const username = `resetviewer${randomUUID().slice(0, 8)}`;
  const password = "synthetic-reset-viewer-password";
  const created = await api(page, "/api/accounts", "POST", {
    username,
    password,
    role: "viewer",
  });
  expect(created.status).toBe(201);
  const profileId = await page
    .getByLabel("Current profile", { exact: true })
    .inputValue();
  const profile = (await api(page, `/api/profiles/${profileId}/configuration`))
    .data;
  expect(
    (
      await api(page, `/api/profiles/${profileId}/configuration`, "PUT", {
        revision: profile.revision,
        accounts: [
          ...profile.accounts,
          { accountId: created.data.id, canManage: false },
        ],
      })
    ).status,
  ).toBe(200);
  const context = await browser.newContext();
  try {
    const viewer = await context.newPage();
    await login(viewer, username, password);
    await viewer.goto(`${origin}/#operations`);
    await expect(
      viewer.getByRole("button", { name: "Review reset options", exact: true }),
    ).toHaveCount(0);
    const options = await api(viewer, "/api/admin/reset/options");
    expect(options.status).toBe(403);
    expect(options.data).not.toHaveProperty("retainedAdmin");
    const preview = await api(viewer, "/api/admin/reset/preview", "POST", {
      mode: "fresh",
      categories: [],
      retainedAdminId: created.data.id,
    });
    expect(preview.status).toBe(403);
    expect(preview.data).not.toHaveProperty("tableCounts");
  } finally {
    await context.close();
  }
});

test("reset choices and exact preview retain readable desktop and narrow layouts", async ({
  page,
}) => {
  await login(page);
  await page.goto(`${origin}/#operations`);
  await page
    .getByText("Reset application data · offline execution", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review reset options", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Review application data reset",
    exact: true,
  });
  await expect(
    dialog.getByRole("checkbox", {
      name: "Sources and integrations",
      exact: true,
    }),
  ).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await dialog.locator(".dialog-body").evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(dialog).toHaveScreenshot(`reset-choices-${width}.png`, {
      mask: [dialog.locator("code")],
    });
  }
  await dialog
    .getByRole("checkbox", { name: "Sources and integrations", exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Review exact changes", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", {
      name: "Review selective reset",
      exact: true,
    }),
  ).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await dialog.locator(".dialog-body").evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(dialog).toHaveScreenshot(`reset-preview-${width}.png`, {
      mask: [dialog.locator("code")],
    });
  }
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("reset preview receives keyboard focus without an animation frame callback", async ({
  page,
}) => {
  await login(page);
  const before = (await api(page, "/api/sources")).data;
  await page.goto(`${origin}/#operations`);
  await page
    .getByText("Reset application data · offline execution", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review reset options", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Review application data reset",
    exact: true,
  });
  await expect(dialog.getByLabel("Reset mode", { exact: true })).toBeVisible();
  // A background/busy page cannot rely on a scheduled frame to finish a form
  // transition. Browser actionability polling runs in its own isolated world.
  const restoreFrames = await page.evaluateHandle(() => {
    const original = window.requestAnimationFrame;
    window.requestAnimationFrame = () => 0;
    return () => {
      window.requestAnimationFrame = original;
    };
  });
  try {
    for (const mode of ["selective", "fresh"] as const) {
      await dialog.getByLabel("Reset mode", { exact: true }).selectOption(mode);
      if (mode === "selective")
        await dialog
          .getByRole("checkbox", { name: "Playback and activity", exact: true })
          .check();
      await dialog
        .getByRole("button", { name: "Review exact changes", exact: true })
        .click();
      await expect(
        dialog.getByRole("heading", {
          name:
            mode === "fresh" ? "Review fresh start" : "Review selective reset",
          exact: true,
        }),
      ).toBeFocused();
      expect((await api(page, "/api/sources")).data).toEqual(before);
      if (mode === "selective")
        await dialog
          .getByRole("button", { name: "Change choices", exact: true })
          .click();
    }
  } finally {
    await restoreFrames.evaluate((restore) => restore());
    await restoreFrames.dispose();
  }
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
