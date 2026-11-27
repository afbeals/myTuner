import { selectInitialProfile } from "./workspace";
import { test, expect } from "@playwright/test";

test("library refresh returns to a valid page when the catalog shrinks", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("designer");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await selectInitialProfile(page);
  await page
    .getByLabel("Current profile")
    .selectOption({ label: "Living Room" });
  // The legacy Library and Channels hashes now share one Network mount.
  await page.goto("/#profiles");
  await expect(
    page.getByRole("heading", { name: "Profiles", exact: true }),
  ).toBeVisible();
  let shrunk = false;
  const sourceId = "11111111-1111-4111-8111-111111111111";
  await page.route("**/api/profiles/*/library?*", async (route) => {
    const offset = Number(
      new URL(route.request().url()).searchParams.get("offset"),
    );
    await route.fulfill({
      json: {
        sources: [{ id: sourceId, name: "Synthetic custom", kind: "videos" }],
        shows: [],
        movies: [],
        movieCollections: [],
        savedCollections: [],
        folders:
          shrunk && offset
            ? []
            : [
                {
                  sourceId,
                  directory: offset ? "Last folder" : "First folder",
                  available: 1,
                },
              ],
        pagination: { offset, limit: 24, total: shrunk ? 1 : 25 },
      },
    });
  });
  await page.goto("/#library");
  await expect(
    page.getByRole("heading", { name: "First folder", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next page →", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Last folder", exact: true }),
  ).toBeVisible();
  shrunk = true;
  await page.getByRole("button", { name: "Refresh view", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "First folder", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("1–1 of 1 permitted items · Page 1", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Next page →", exact: true }),
  ).toBeDisabled();
});
