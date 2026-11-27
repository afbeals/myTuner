import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { selectInitialProfile } from "./workspace";
let fixtureOrigin = "";
let fixtureChild: import("node:child_process").ChildProcess | null = null;
let fixtureLog = "";
async function goto(page: Page, path: string) {
  return page.goto(new URL(path, fixtureOrigin).href);
}
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
  fixtureOrigin = `http://127.0.0.1:${port}`;
  fixtureLog = "";
  fixtureChild = spawn(
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
  fixtureChild.stdout?.on("data", (chunk) => {
    fixtureLog = (fixtureLog + String(chunk)).slice(-20000);
  });
  fixtureChild.stderr?.on("data", (chunk) => {
    fixtureLog = (fixtureLog + String(chunk)).slice(-20000);
  });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (fixtureChild.exitCode !== null)
      throw new Error(`Isolated channel fixture exited: ${fixtureLog}`);
    try {
      if ((await fetch(`${fixtureOrigin}/api/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Isolated channel fixture did not start: ${fixtureLog}`);
});
const channels: string[] = [];
const collections: { profileId: string; id: string }[] = [];
async function login(
  page: Page,
  username = "designer",
  password = "synthetic-browser-password",
) {
  await goto(page, "/");
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
async function seedCollection(page: Page, commercial = false) {
  const profileId = await page
    .getByLabel("Current profile", { exact: true })
    .inputValue();
  const options = (
    await api(page, `/api/profiles/${profileId}/library/options?limit=50`)
  ).data;
  const commercialSource = options.sources.find(
    (source: { kind: string }) => source.kind === "commercials",
  );
  const selection = commercial
    ? {
        type: "folder",
        sourceId: commercialSource.id,
        directory: "",
        recursive: true,
      }
    : options.items.find((option: { kind: string }) => option.kind === "show")
        .selection;
  const videos = (
    await api(
      page,
      `/api/profiles/${profileId}/selection?limit=50`,
      "POST",
      selection,
    )
  ).data.items;
  const name = `Workflow collection ${randomUUID()}`;
  const saved = await api(
    page,
    `/api/profiles/${profileId}/collections`,
    "POST",
    {
      creationId: randomUUID(),
      name,
      mediaIds: videos.map((video: { id: string }) => video.id),
    },
  );
  expect(saved.status).toBe(201);
  collections.push({ profileId, id: saved.data.id });
  return {
    profileId,
    id: saved.data.id,
    name,
    mediaIds: videos.map((video: { id: string }) => video.id) as string[],
  };
}
async function seedChannel(page: Page) {
  const profileId = await page
    .getByLabel("Current profile", { exact: true })
    .inputValue();
  const items = (await api(page, "/api/admin/channels")).data.items;
  const original = items.find(
    (item: { name: string }) => item.name === "After School",
  );
  const config = (await api(page, `/api/channels/${original.id}/programming`))
    .data.config;
  const name = `Workflow channel ${randomUUID()}`;
  const created = await api(page, "/api/channels", "POST", {
    name,
    profileId,
    visibility: "private",
  });
  expect(created.status).toBe(201);
  channels.push(created.data.id);
  expect(
    (
      await api(page, `/api/channels/${created.data.id}/programming`, "PUT", {
        ...config,
        profileId,
        expectedRevisionId: null,
      })
    ).status,
  ).toBe(200);
  await goto(
    page,
    `/#channels?profile=${profileId}&channel=${created.data.id}`,
  );
  return { id: created.data.id, name, profileId, config };
}
test.afterEach(async ({ page }) => {
  try {
    for (const id of channels.splice(0))
      expect((await api(page, `/api/channels/${id}`, "DELETE")).status).toBe(
        204,
      );
    for (const item of collections.splice(0))
      expect(
        (
          await api(
            page,
            `/api/profiles/${item.profileId}/collections/${item.id}`,
            "DELETE",
          )
        ).status,
      ).toBe(204);
  } finally {
    const child = fixtureChild;
    fixtureChild = null;
    if (child && child.exitCode === null) {
      const closed = new Promise<void>((resolve) =>
        child.once("exit", () => resolve()),
      );
      child.kill("SIGTERM");
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        closed,
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            child.kill("SIGKILL");
            resolve();
          }, 5000);
        }),
      ]);
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) await closed;
    }
  }
});

test("collection handoff names its identity, a pool without placements stays honest, and guide addition completes", async ({
  page,
}) => {
  await login(page);
  const collection = await seedCollection(page);
  const pool = await seedCollection(page, true);
  await goto(
    page,
    `/#library?profile=${collection.profileId}&collection=${collection.id}`,
  );
  await page
    .getByRole("button", {
      name: "Program this whole selection in a channel",
      exact: true,
    })
    .click();
  const wizard = page.getByRole("dialog", {
    name: "Create channel",
    exact: true,
  });
  const name = `Wizard workflow ${randomUUID()}`;
  await wizard.getByLabel("Channel name", { exact: true }).fill(name);
  await wizard.getByRole("button", { name: "Next", exact: true }).click();
  await expect(wizard).toContainText(
    `${collection.name} · ${collection.mediaIds.length} referenced videos`,
  );
  await expect(
    wizard
      .getByLabel("Group 1 play order", { exact: true })
      .getByRole("option", { selected: true }),
  ).toHaveText("In order");
  await wizard.getByRole("button", { name: "Next", exact: true }).click();
  await wizard
    .getByLabel("Commercial pool", { exact: true })
    .selectOption(JSON.stringify({ type: "collection", id: pool.id }));
  await expect(wizard).toContainText(
    "Commercial pool selected · no break placements enabled",
  );
  await wizard.getByRole("button", { name: "Next", exact: true }).click();
  await expect(wizard).toContainText(collection.name);
  await expect(wizard).not.toContainText("Commercial breaks configured");
  await wizard
    .getByRole("button", { name: "Generate preview", exact: true })
    .click();
  await expect(wizard).toContainText("Preview ready");
  await expect(
    wizard
      .locator(".media-reference-context")
      .filter({ hasText: "Orbit.S01E01.mp4" })
      .first(),
  ).toContainText("TV shows");
  await expect(
    wizard.locator("tbody tr").first().locator("td").first(),
  ).toContainText(/\d:\d{2}:\d{2}/);
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/channels/drafts/publish") &&
      response.request().method() === "POST",
  );
  await wizard
    .getByRole("button", { name: "Create channel", exact: true })
    .click();
  const result = await (await saved).json();
  channels.push(result.id);
  await expect(wizard).toHaveCount(0);
  const preview = page.locator(".channel-preview");
  await expect(preview).toContainText(
    "Published. Add this channel to Living Room’s guide",
  );
  await preview
    .getByRole("button", { name: "Add to profile guide", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: `Added ${name} to Living Room’s guide.` }),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", {
      name: "Already in Living Room’s guide",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    preview.getByRole("link", { name: "Manage guide", exact: true }),
  ).toHaveAttribute("href", "#subscriptions");
});

test("controlled commercial positions preserve invalid text, block preview, and save seconds without Apply", async ({
  page,
}) => {
  await login(page);
  const collection = await seedCollection(page, true);
  const channel = await seedChannel(page);
  await page
    .locator(".channel-preview")
    .getByRole("button", { name: "Edit programming", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: `Program ${channel.name}`,
    exact: true,
  });
  await editor
    .getByRole("button", { name: "2. Commercials", exact: true })
    .click();
  const pool = editor.getByLabel("Commercial pool", { exact: true });
  const selectedPool = JSON.stringify({
    type: "collection",
    id: collection.id,
  });
  await pool.selectOption(selectedPool);
  await expect(
    editor.getByRole("button", { name: "Apply commercial rules", exact: true }),
  ).toHaveCount(0);
  const positions = editor.getByLabel("Break positions", { exact: true });
  await positions.fill("twenty-five");
  await expect(positions).toHaveValue("twenty-five");
  await expect(positions).toHaveAttribute("aria-invalid", "true");
  await expect(editor.getByRole("alert")).toContainText(
    "greater than 0 and less than 100",
  );
  await expect(
    editor.getByRole("button", { name: "Next", exact: true }),
  ).toBeDisabled();
  await editor.getByRole("button", { name: "3. Preview", exact: true }).click();
  await expect(
    editor.getByRole("button", {
      name: "Generate two-hour preview",
      exact: true,
    }),
  ).toBeDisabled();
  await editor
    .getByRole("button", { name: "2. Commercials", exact: true })
    .click();
  await editor
    .getByLabel("Break position unit", { exact: true })
    .selectOption("timestamp");
  await positions.fill("2.5, 5");
  await expect(positions).toHaveAttribute("aria-invalid", "false");
  await expect(pool).toHaveValue(selectedPool);
  await editor.getByRole("button", { name: "Next", exact: true }).click();
  await editor
    .getByRole("button", { name: "Generate two-hour preview", exact: true })
    .click();
  const schedule = editor.getByRole("region", {
    name: "Schedule review",
    exact: true,
  });
  await expect(schedule.locator("tbody tr")).toHaveCount(20);
  await expect(schedule).toContainText("(continued)");
  await expect(editor.getByText(/^Break explanations/)).toBeVisible();
  expect(
    await editor
      .getByText(/^Break explanations/)
      .evaluate(
        (element) => (element.parentElement as HTMLDetailsElement).open,
      ),
  ).toBe(false);
  await editor
    .getByRole("button", { name: "Publish programming", exact: true })
    .click();
  await expect(editor.getByRole("status")).toContainText("Programming saved");
  await expect(
    editor.getByRole("button", { name: "Done", exact: true }),
  ).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "Cancel", exact: true }),
  ).toHaveCount(0);
  await expect(editor).not.toContainText(
    "Preview this draft before publishing",
  );
  const saved = (await api(page, `/api/channels/${channel.id}/programming`))
    .data.config;
  expect(saved.commercialSelection).toEqual({
    type: "collection",
    id: collection.id,
  });
  expect(saved.rules.positions).toEqual([
    { kind: "timestamp", value: 2500 },
    { kind: "timestamp", value: 5000 },
  ]);
});

test("programming filename selection has one visible pressed choice and applying it keeps only that video", async ({
  page,
}) => {
  await login(page);
  const channel = await seedChannel(page);
  await page
    .locator(".channel-preview")
    .getByRole("button", { name: "Edit programming", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: `Program ${channel.name}`,
    exact: true,
  });
  await editor
    .getByRole("button", { name: "Change content selection", exact: true })
    .first()
    .click();
  const picker = page.getByRole("dialog", {
    name: "Choose programming content",
    exact: true,
  });
  await picker
    .getByRole("button", { name: "Folders and file names", exact: true })
    .click();
  await picker.getByLabel("Match", { exact: true }).selectOption("files");
  await picker
    .getByLabel("Find folders or files", { exact: true })
    .fill("Orbit");
  await picker
    .getByRole("button", { name: "Search", exact: true })
    .first()
    .click();
  const choices = picker.getByRole("button", { name: /^Select video / });
  await expect(choices).toHaveCount(2);
  await choices.nth(0).click();
  await expect(choices.nth(0)).toHaveAttribute("aria-pressed", "true");
  await choices.nth(1).click();
  await expect(choices.nth(0)).toHaveAttribute("aria-pressed", "false");
  await expect(choices.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(picker.locator(".dialog-footer")).toContainText(
    "Current choice:",
  );
  await expect(picker.locator(".dialog-footer")).toContainText("Orbit.S01E02");
  await picker
    .getByRole("button", { name: "Use selection", exact: true })
    .click();
  await editor.getByRole("button", { name: "3. Preview", exact: true }).click();
  const preview = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().includes("/programming/preview"),
  );
  const previewResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/programming/preview") &&
      response.status() === 200,
  );
  await editor
    .getByRole("button", { name: "Generate two-hour preview", exact: true })
    .click();
  const group = (await preview).postDataJSON().groups[0];
  expect(group.selection.type).toBe("media");
  expect(group.selection.ids).toHaveLength(1);
  expect((await previewResponse).status()).toBe(200);
  await expect(
    editor.getByRole("region", { name: "Schedule review", exact: true }),
  ).toBeVisible();
});

test("an editor with Watch access cannot create or manage channels for that profile", async ({
  page,
  browser,
  baseURL,
}) => {
  await login(page);
  const profileId = await page
    .getByLabel("Current profile", { exact: true })
    .inputValue();
  const original = (await api(page, `/api/profiles/${profileId}/configuration`))
    .data;
  const other = (await api(page, "/api/accounts")).data.find(
    (account: { username: string }) => account.username === "other",
  );
  expect(
    (
      await api(page, `/api/profiles/${profileId}/configuration`, "PUT", {
        revision: original.revision,
        accounts: [
          ...original.accounts.filter(
            (grant: { accountId: string }) => grant.accountId !== other.id,
          ),
          { accountId: other.id, canManage: false },
        ],
      })
    ).status,
  ).toBe(200);
  const context = await browser.newContext({ baseURL });
  try {
    const watcher = await context.newPage();
    await login(watcher, "other", "synthetic-other-password");
    await watcher
      .getByLabel("Current profile", { exact: true })
      .selectOption(profileId);
    await goto(watcher, "/#channels");
    await expect(
      watcher.getByRole("button", { name: "Create channel", exact: true }),
    ).toHaveCount(0);
    await expect(
      watcher.getByRole("button", { name: "Edit programming", exact: true }),
    ).toHaveCount(0);
    await expect(
      watcher.getByRole("button", {
        name: "Add to profile guide",
        exact: true,
      }),
    ).toHaveCount(0);
  } finally {
    await context.close();
    const current = (
      await api(page, `/api/profiles/${profileId}/configuration`)
    ).data;
    expect(
      (
        await api(page, `/api/profiles/${profileId}/configuration`, "PUT", {
          revision: current.revision,
          accounts: original.accounts,
        })
      ).status,
    ).toBe(200);
  }
});

test("a real renamed synthetic folder identifies its empty group and requires an explicit replacement", async ({
  page,
}) => {
  test.setTimeout(60000);
  const { mkdtemp, mkdir, rename, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { Store } = await import("../src/database.js");
  const { createServer } = await import("../src/server.js");
  const { createAccount } = await import("../src/security.js");
  const { addSource, scanSource } = await import("../src/catalog.js");
  const { profile } = await import("../test/helpers.js");
  const { noBreaks } = await import("../src/scheduler.js");
  const root = await mkdtemp(join(tmpdir(), "mytuner-channel-folder-"));
  const store = new Store(":memory:");
  let app: ReturnType<typeof createServer> | undefined;
  try {
    await mkdir(join(root, "media", "Original"), { recursive: true });
    await promisify(execFile)("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=32x32:r=10:d=1",
      "-c:v",
      "mpeg4",
      join(root, "media", "Original", "One.mp4"),
    ]);
    await mkdir(join(root, "media", "Other"));
    await promisify(execFile)("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=32x32:r=10:d=1",
      "-c:v",
      "mpeg4",
      join(root, "media", "Other", "One.mp4"),
    ]);
    const account = await createAccount(
      store,
      "designer",
      "synthetic-browser-password",
      "admin",
    );
    const profileId = profile(store, account);
    const source = await addSource(
      store,
      {
        name: "Folder recovery source",
        root: join(root, "media"),
        kind: "videos",
        recursive: true,
      },
      [join(root, "generated"), join(root, "cache")],
    );
    await scanSource(store, source);
    app = createServer(store, {
      webRoot: resolve("web-dist"),
      generatedRoot: join(root, "generated"),
      cacheRoot: join(root, "cache"),
      writableRoots: [join(root, "generated"), join(root, "cache")],
      integrationKey: Buffer.alloc(32, 7),
    });
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    await goto(page, origin);
    await page.getByLabel("Username", { exact: true }).fill("designer");
    await page
      .getByLabel("Password", { exact: true })
      .fill("synthetic-browser-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await selectInitialProfile(page);
    const channel = (
      await api(page, "/api/channels", "POST", {
        name: "Folder recovery channel",
        profileId,
        visibility: "private",
      })
    ).data;
    const config = {
      profileId,
      groups: [
        {
          id: "folder",
          mode: "ordered",
          selection: {
            type: "folder",
            sourceId: source.id,
            directory: "Original",
            recursive: true,
          },
        },
        {
          id: "other-folder",
          mode: "ordered",
          selection: {
            type: "folder",
            sourceId: source.id,
            directory: "Other",
            recursive: true,
          },
        },
      ],
      rules: noBreaks,
      seed: 42,
    };
    expect(
      (
        await api(page, `/api/channels/${channel.id}/programming`, "PUT", {
          ...config,
          expectedRevisionId: null,
        })
      ).status,
    ).toBe(200);
    // Only this test's synthetic fixture is renamed; source originals are never used.
    await rename(
      join(root, "media", "Original"),
      join(root, "media", "Replacement"),
    );
    expect(
      (
        await api(page, `/api/sources/${source.id}/scan`, "POST", {
          metadata: false,
        })
      ).status,
    ).toBe(200);
    await goto(
      page,
      `${origin}/#channels?profile=${profileId}&channel=${channel.id}`,
    );
    await page
      .locator(".channel-preview")
      .getByRole("button", { name: "Edit programming", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Program Folder recovery channel",
      exact: true,
    });
    await expect(editor).toContainText(
      "Content group 1 has no available videos in the last scan",
    );
    await expect(editor).toContainText("Folder recovery source · Original");
    await editor
      .getByRole("button", { name: "Choose replacement", exact: true })
      .click();
    const picker = page.getByRole("dialog", {
      name: "Choose programming content",
      exact: true,
    });
    await expect(
      picker.getByRole("button", { name: "Select Original", exact: true }),
    ).toBeDisabled();
    await picker
      .getByRole("button", { name: "Select Replacement", exact: true })
      .click();
    await picker
      .getByRole("button", { name: "Use selection", exact: true })
      .click();
    await expect(editor).not.toContainText(
      "Content group 1 has no available videos",
    );
    await editor
      .getByRole("button", { name: "3. Preview", exact: true })
      .click();
    await editor
      .getByRole("button", { name: "Generate two-hour preview", exact: true })
      .click();
    await expect(
      editor.getByRole("region", { name: "Schedule review", exact: true }),
    ).toBeVisible();
    const schedule = editor.getByRole("region", {
      name: "Schedule review",
      exact: true,
    });
    const rows = schedule.locator("tbody tr");
    await expect(rows).toHaveCount(20);
    await expect(rows.nth(0).locator("td").nth(2)).toContainText("One");
    await expect(rows.nth(1).locator("td").nth(2)).toContainText("One");
    // Publishing preserves the active rotation, so either group can lead this window.
    const contexts = await rows
      .locator(".media-reference-context")
      .allTextContents();
    expect(
      contexts
        .slice(0, 2)
        .map((context) => context.trim())
        .sort(),
    ).toEqual([
      "Folder recovery source · Other/One.mp4",
      "Folder recovery source · Replacement/One.mp4",
    ]);
    await expect(rows.nth(0).locator("td").first()).toContainText(
      /\d:\d{2}:\d{2}/,
    );
    // Replacement is staged only; saved programming still points to Original.
    expect(
      (await api(page, `/api/channels/${channel.id}/programming`)).data.config
        .groups[0].selection.directory,
    ).toBe("Original");
  } finally {
    await goto(page, "about:blank");
    await app?.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
