import { test, expect, type Page, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { selectInitialProfile } from "./workspace";

const createdSources: string[] = [];
const createdProfiles: string[] = [];
const createdDirectories: string[] = [];
test.afterEach(async ({ page }) => {
  for (const id of createdSources.splice(0))
    expect((await request(page, `/api/sources/${id}`, "DELETE")).status).toBe(
      204,
    );
  for (const directory of createdDirectories.splice(0)) await rmdir(directory);
  for (const id of createdProfiles.splice(0)) {
    const current = await request(page, `/api/profiles/${id}/configuration`);
    if (current.status === 404) continue;
    expect(
      (
        await request(page, `/api/profiles/${id}`, "DELETE", {
          revision: current.data.revision,
        })
      ).status,
    ).toBe(204);
  }
});

async function login(
  page: Page,
  origin = "/",
  credentials = {
    username: "designer",
    password: "synthetic-browser-password",
  },
) {
  await page.goto(origin);
  await page.getByLabel("Username", { exact: true }).fill(credentials.username);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await selectInitialProfile(page);
}
async function request(
  page: Page,
  path: string,
  method = "GET",
  body?: unknown,
) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const headers: Record<string, string> = {};
      if (method !== "GET") {
        if (body !== undefined) headers["Content-Type"] = "application/json";
        headers["X-CSRF-Token"] = (
          await (await fetch("/api/auth/csrf")).json()
        ).csrfToken;
      }
      const result = await fetch(path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: result.status,
        data: result.status === 204 ? null : await result.json(),
      };
    },
    { path, method, body },
  );
}
async function createSource(page: Page) {
  const { data: sources } = await request(page, "/api/sources");
  const root = sources
    .find((source: { kind: string }) => source.kind === "shows")
    .rootPath.replace(/\/media$/, "/spare");
  const name = `Management ${randomUUID()}`;
  const result = await request(page, "/api/sources", "POST", {
    name,
    root,
    kind: "videos",
    recursive: true,
  });
  expect(result.status).toBe(201);
  createdSources.push(result.data.id);
  return { id: result.data.id as string, name, root };
}
async function expectVisibleSubmissionError(page: Page, dialog: Locator) {
  const alert = dialog.locator(".submission-error");
  await expect(alert).toBeVisible();
  await expect(alert).toBeFocused();
  const box = await alert.boundingBox();
  const body = await dialog.locator(".dialog-body").boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(body!.y - 1);
  expect(box!.y).toBeLessThan(body!.y + body!.height);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  return alert;
}

test("fresh source revisions prevent a stale rename from resetting a newer root, settings and grants", async ({
  page,
}) => {
  await login(page);
  const source = await createSource(page);
  await page.goto("/#sources");
  await page
    .getByRole("button", { name: `Edit ${source.name}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: `Edit source ${source.name}`,
    exact: true,
  });
  await dialog
    .getByLabel("Source name", { exact: true })
    .fill("Preserved stale draft");
  const latest = await request(page, `/api/sources/${source.id}`);
  expect(latest.data.revision).toMatch(/^[a-f0-9]{64}$/);
  // Other suites legitimately create a commercial source in the shared fixture.
  // Use an owned empty directory so that overlap validation remains enabled.
  const changedRoot = await realpath(
    await mkdtemp(join(tmpdir(), "mytuner-source-revision-")),
  );
  createdDirectories.push(changedRoot);
  expect(
    (
      await request(page, `/api/sources/${source.id}`, "PATCH", {
        revision: latest.data.revision,
        root: changedRoot,
        resetConfirmed: true,
      })
    ).status,
  ).toBe(200);
  const configuration = (
    await request(page, `/api/sources/${source.id}/configuration`)
  ).data;
  configuration.subtitles.subdirectories = ["RecoverySubs"];
  expect(
    (
      await request(
        page,
        `/api/sources/${source.id}/configuration`,
        "PUT",
        configuration,
      )
    ).status,
  ).toBe(200);
  const profileId = await page
    .getByLabel("Current profile", { exact: true })
    .inputValue();
  const profile = (
    await request(page, `/api/profiles/${profileId}/configuration`)
  ).data;
  expect(
    (
      await request(page, `/api/profiles/${profileId}/configuration`, "PUT", {
        revision: profile.revision,
        grants: [...profile.grants, { sourceId: source.id, subtree: "" }],
      })
    ).status,
  ).toBe(200);
  await dialog
    .getByRole("button", { name: "Save source", exact: true })
    .click();
  const error = await expectVisibleSubmissionError(page, dialog);
  await expect(error).toContainText(/changed/i);
  await expect(dialog.getByLabel("Source name", { exact: true })).toHaveValue(
    "Preserved stale draft",
  );
  expect((await request(page, `/api/sources/${source.id}`)).data.rootPath).toBe(
    changedRoot,
  );
  expect(
    (await request(page, `/api/sources/${source.id}/configuration`)).data
      .subtitles.subdirectories,
  ).toEqual(["RecoverySubs"]);
  expect(
    (await request(page, `/api/profiles/${profileId}/configuration`)).data
      .grants,
  ).toContainEqual({ sourceId: source.id, subtree: "" });
  await error
    .getByRole("button", { name: "Check saved settings", exact: true })
    .click();
  await expect(
    error.getByRole("region", { name: "Saved settings review" }),
  ).toContainText(changedRoot);
  await error
    .getByRole("button", { name: "Load saved settings", exact: true })
    .click();
  await page
    .locator(".confirmation-dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(dialog.getByLabel("Source name", { exact: true })).toHaveValue(
    "Preserved stale draft",
  );
  await error
    .getByRole("button", { name: "Load saved settings", exact: true })
    .click();
  await page
    .locator(".confirmation-dialog")
    .getByRole("button", { name: "Load saved settings", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Media directory inside MyTuner", { exact: true }),
  ).toHaveValue(changedRoot);
  await expect(dialog.locator(".submission-error")).toHaveCount(0);
});

for (const width of [1440, 390])
  test(`source configuration conflict is visible at ${width}px and review does not overwrite the draft`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await login(page);
    const source = await createSource(page);
    await page.goto("/#sources");
    await page
      .getByRole("button", { name: `Configure ${source.name}`, exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: `Configure ${source.name}`,
      exact: true,
    });
    const folders = dialog.getByLabel("Subtitle folder names", { exact: true });
    await expect(
      dialog.getByText(/Saving changed subtitle search settings/),
    ).toHaveCount(0);
    await folders.fill("Subs, LocalDraft");
    await expect(
      dialog.getByText(/Saving changed subtitle search settings/),
    ).toBeVisible();
    await folders.fill("Subs, Subtitles");
    await expect(
      dialog.getByText(/Saving changed subtitle search settings/),
    ).toHaveCount(0);
    await folders.fill("Subs, LocalDraft");
    const latest = (
      await request(page, `/api/sources/${source.id}/configuration`)
    ).data;
    latest.subtitles.subdirectories = ["Subs", "SavedElsewhere"];
    expect(
      (
        await request(
          page,
          `/api/sources/${source.id}/configuration`,
          "PUT",
          latest,
        )
      ).status,
    ).toBe(200);
    await dialog
      .getByRole("button", { name: "Save configuration", exact: true })
      .click();
    const error = await expectVisibleSubmissionError(page, dialog);
    await expect(folders).toHaveValue("Subs, LocalDraft");
    await error
      .getByRole("button", { name: "Check saved settings", exact: true })
      .click();
    await expect(error).toContainText("SavedElsewhere");
    await expect(folders).toHaveValue("Subs, LocalDraft");
    await error
      .getByRole("button", { name: "Load saved settings", exact: true })
      .click();
    await page
      .locator(".confirmation-dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(folders).toHaveValue("Subs, LocalDraft");
    await error
      .getByRole("button", { name: "Load saved settings", exact: true })
      .click();
    await page
      .locator(".confirmation-dialog")
      .getByRole("button", { name: "Load saved settings", exact: true })
      .click();
    await expect(folders).toHaveValue("Subs, SavedElsewhere");
    await expect(dialog.locator(".submission-error")).toHaveCount(0);
  });

test("lost successful source configuration acknowledgement offers readback before retry", async ({
  page,
}) => {
  await login(page);
  const source = await createSource(page);
  await page.goto("/#sources");
  await page
    .getByRole("button", { name: `Configure ${source.name}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: `Configure ${source.name}`,
    exact: true,
  });
  await dialog
    .getByLabel("Subtitle folder names", { exact: true })
    .fill("Subs, AcknowledgementLost");
  let saves = 0;
  await page.route(
    `**/api/sources/${source.id}/configuration`,
    async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      const response = await route.fetch();
      if (response.status() === 403) {
        // Preserve the application's ordinary CSRF-refresh handshake.
        await route.fulfill({ response });
        return;
      }
      expect(response.status()).toBe(200);
      saves++;
      await route.abort("connectionreset");
    },
  );
  await dialog
    .getByRole("button", { name: "Save configuration", exact: true })
    .click();
  const error = await expectVisibleSubmissionError(page, dialog);
  await expect(error).toContainText(
    "Could not confirm whether your changes were saved",
  );
  await error
    .getByRole("button", { name: "Check saved settings", exact: true })
    .click();
  await expect(error).toContainText("AcknowledgementLost");
  expect(saves).toBe(1);
  await expect(
    dialog.getByLabel("Subtitle folder names", { exact: true }),
  ).toHaveValue("Subs, AcknowledgementLost");
});

test("profile conflicts focus their explanation and require deliberate draft replacement", async ({
  page,
}) => {
  await login(page);
  const name = `Profile ${randomUUID()}`;
  const created = await request(page, "/api/profiles", "POST", {
    name,
    kind: "room",
  });
  expect(created.status).toBe(201);
  createdProfiles.push(created.data.id);
  await page.reload();
  await page.goto("/#profiles");
  await page
    .getByRole("button", { name: `Manage ${name}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: /^Manage / }).first();
  await dialog
    .getByLabel("Profile name", { exact: true })
    .fill("Local profile draft");
  const latest = (
    await request(page, `/api/profiles/${created.data.id}/configuration`)
  ).data;
  expect(
    (
      await request(
        page,
        `/api/profiles/${created.data.id}/configuration`,
        "PUT",
        { revision: latest.revision, name: "Profile saved elsewhere" },
      )
    ).status,
  ).toBe(200);
  await dialog
    .getByRole("button", { name: "Save profile", exact: true })
    .click();
  const error = await expectVisibleSubmissionError(page, dialog);
  await error
    .getByRole("button", { name: "Check saved settings", exact: true })
    .click();
  await expect(error).toContainText("Profile saved elsewhere");
  await expect(dialog.getByLabel("Profile name", { exact: true })).toHaveValue(
    "Local profile draft",
  );
  await error
    .getByRole("button", { name: "Load saved settings", exact: true })
    .click();
  await page
    .locator(".confirmation-dialog")
    .getByRole("button", { name: "Load saved settings", exact: true })
    .click();
  await expect(dialog.getByLabel("Profile name", { exact: true })).toHaveValue(
    "Profile saved elsewhere",
  );
  await expect(dialog.locator(".submission-error")).toHaveCount(0);
});

test("asynchronous profile owners default to the signed-in administrator and room ownership is explicit", async ({
  page,
}) => {
  await login(page);
  const accounts = (await request(page, "/api/accounts")).data;
  const admin = accounts.find(
    (account: { username: string }) => account.username === "designer",
  );
  await page.route("**/api/accounts", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const options = await response.json();
    // Same real accounts, deliberately place an unrelated account before the admin.
    options.sort(
      (left: { id: string }, right: { id: string }) =>
        Number(left.id === admin.id) - Number(right.id === admin.id),
    );
    await route.fulfill({ response, json: options });
  });
  await page.goto("/#profiles");
  await page
    .getByRole("button", { name: "Create profile", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Create profile",
    exact: true,
  });
  await expect(dialog.getByLabel("Owner", { exact: true })).toHaveValue(
    admin.id,
  );
  await dialog.getByLabel("Profile type", { exact: true }).selectOption("room");
  await expect(dialog.getByLabel("Owner", { exact: true })).toHaveValue(
    admin.id,
  );
  await dialog.getByLabel("Owner", { exact: true }).selectOption("");
  const name = `Ownerless ${randomUUID()}`;
  await dialog.getByLabel("Profile name", { exact: true }).fill(name);
  await dialog
    .getByRole("button", { name: "Create profile", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const profile = (await request(page, "/api/profiles")).data.find(
    (item: { name: string }) => item.name === name,
  );
  createdProfiles.push(profile.id);
  expect(profile.ownerAccountId).toBeNull();
});

test("wrong PIN returns keyboard focus after asynchronous submission is enabled again", async ({
  page,
  browser,
  baseURL,
}) => {
  await login(page);
  const name = `PIN ${randomUUID()}`;
  const created = await request(page, "/api/profiles", "POST", {
    name,
    kind: "room",
  });
  expect(created.status).toBe(201);
  createdProfiles.push(created.data.id);
  const other = (await request(page, "/api/accounts")).data.find(
    (account: { username: string }) => account.username === "other",
  );
  const latest = (
    await request(page, `/api/profiles/${created.data.id}/configuration`)
  ).data;
  expect(
    (
      await request(
        page,
        `/api/profiles/${created.data.id}/configuration`,
        "PUT",
        {
          revision: latest.revision,
          pin: "1234",
          accounts: [{ accountId: other.id, canManage: false }],
        },
      )
    ).status,
  ).toBe(200);
  const context = await browser.newContext({ baseURL });
  try {
    const watcher = await context.newPage();
    await login(watcher, "/", {
      username: "other",
      password: "synthetic-other-password",
    });
    await watcher
      .getByLabel("Current profile", { exact: true })
      .selectOption(created.data.id);
    await watcher.goto("/#watch");
    const pin = watcher.getByLabel("TV PIN", { exact: true });
    await pin.fill("9876");
    await watcher
      .getByRole("button", { name: "Unlock profile", exact: true })
      .click();
    await expect(watcher.getByRole("alert")).toContainText("Incorrect PIN");
    await expect(pin).toBeEnabled();
    await expect(pin).toHaveValue("");
    await expect(pin).toBeFocused();
    await watcher.keyboard.type("1234");
    await expect(pin).toHaveValue("1234");
  } finally {
    await context.close();
  }
});

test("real scheduler admission appears inside generation and scan dialogs, resumes, reuses outputs and stops terminal polling", async ({
  page,
}) => {
  test.setTimeout(60000);
  // Controlled policy pause uses the real scheduler and HTTP APIs; this is not a
  // claim of physical playback or an Unraid performance test.
  const { mkdtemp, mkdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { Store } = await import("../src/database.js");
  const { BackgroundWork } = await import("../src/background-work.js");
  const { createServer } = await import("../src/server.js");
  const { createAccount } = await import("../src/security.js");
  const { addSource, scanSource } = await import("../src/catalog.js");
  const { profile } = await import("../test/helpers.js");
  const root = await mkdtemp(join(tmpdir(), "mytuner-management-"));
  const store = new Store(":memory:");
  const background = new BackgroundWork();
  let app: ReturnType<typeof createServer> | undefined;
  try {
    await mkdir(join(root, "media"));
    await promisify(execFile)("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=32x32:r=10:d=1",
      "-c:v",
      "mpeg4",
      join(root, "media", "One.mp4"),
    ]);
    const admin = await createAccount(
      store,
      "designer",
      "synthetic-browser-password",
      "admin",
    );
    profile(store, admin);
    const source = await addSource(
      store,
      {
        name: "Admission source",
        root: join(root, "media"),
        kind: "videos",
        recursive: true,
      },
      [join(root, "generated"), join(root, "cache")],
    );
    await scanSource(store, source);
    background.setPaused(true);
    app = createServer(store, {
      webRoot: resolve("web-dist"),
      generatedRoot: join(root, "generated"),
      cacheRoot: join(root, "cache"),
      writableRoots: [join(root, "generated"), join(root, "cache")],
      backgroundWork: background,
      integrationKey: Buffer.alloc(32, 7),
    });
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    await login(page, origin);
    await page.goto(`${origin}/#generated`);
    await page
      .getByRole("button", { name: "Preview scope", exact: true })
      .click();
    const scope = page.getByRole("dialog", {
      name: "Confirm generation scope",
      exact: true,
    });
    await expect(scope).toContainText("1 requested outputs");
    await scope
      .getByRole("button", { name: "Start generation", exact: true })
      .click();
    const progress = page.getByRole("dialog", {
      name: "Generation progress",
      exact: true,
    });
    await expect(progress).toContainText("Waiting for playback");
    await expect(progress).not.toContainText("Processing:");
    const paused = (await request(page, "/api/admin/background")).data;
    expect(paused).toMatchObject({
      active: null,
      paused: true,
      waiting: 1,
      admitted: 0,
    });
    await progress.getByRole("button", { name: "Done", exact: true }).click();
    await expect(
      page
        .getByRole("heading", { name: "Active queue", exact: true })
        .locator(".."),
    ).toContainText("Waiting for playback");
    await page.goto(`${origin}/#sources`);
    await page
      .getByRole("button", { name: "Scan and refresh", exact: true })
      .click();
    const scan = page.getByRole("dialog", {
      name: "Scan Admission source",
      exact: true,
    });
    await expect(
      scan.getByRole("checkbox", { name: /Refresh connected/ }),
    ).toHaveCount(0);
    await scan.getByRole("button", { name: "Start scan", exact: true }).click();
    await expect(scan).toContainText(
      "Optional work resumes automatically when playback stops",
    );
    expect(
      (await request(page, `/api/sources/${source.id}/scan-status`)).data,
    ).toMatchObject({
      running: true,
      admission: "waiting",
      waitingReason: "playback",
    });
    expect((await request(page, "/api/admin/background")).data).toMatchObject({
      waiting: 2,
      admitted: 0,
    });
    background.setPaused(false);
    await expect
      .poll(
        async () =>
          (await request(page, `/api/sources/${source.id}/scan-status`)).data
            .running,
      )
      .toBe(false);
    await scan
      .getByRole("button", { name: /Close.*scan continues|^Close$/ })
      .last()
      .click();
    await page.goto(`${origin}/#generated`);
    await page
      .getByRole("button", {
        name: "View completed generation job",
        exact: true,
      })
      .click();
    await expect(progress).toContainText("1/1 outputs completed");
    await expect(progress).toContainText("Work finished");
    let detailPolls = 0;
    page.on("request", (req) => {
      if (
        req.method() === "GET" &&
        /\/api\/generation\/jobs\/[^/?]+\?/.test(req.url())
      )
        detailPolls++;
    });
    await page.waitForTimeout(3400);
    expect(detailPolls).toBe(0);
    await progress.getByRole("button", { name: "Done", exact: true }).click();
    await page
      .getByRole("button", { name: "Preview scope", exact: true })
      .click();
    await expect(scope).toContainText("1 reusable · 0 new");
  } finally {
    await page.goto("about:blank");
    await app?.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
