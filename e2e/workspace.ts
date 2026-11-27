import { expect, type Page } from "@playwright/test";
/** Fresh browser sign-in now asks for a profile. Reload keeps a validated choice. */
export async function selectInitialProfile(
  page: Page,
  preferred = "Living Room",
) {
  // Watch/TV-approval intentionally hide the workspace switcher. Read its
  // attached options to detect profile loading, then choose only visible cards.
  const selector = page.getByRole("combobox", {
    name: "Current profile",
    exact: true,
    includeHidden: true,
  });
  await expect(selector.locator("option").first()).toBeAttached();
  const picker = page.getByRole("dialog", {
    name: "Who’s watching?",
    exact: true,
  });
  const expectedPicker = await page.evaluate(() => {
    const remembered = sessionStorage.getItem("mytuner:profile");
    return (
      !remembered &&
      !new URLSearchParams(location.hash.split("?")[1] ?? "").has("profile")
    );
  });
  if (expectedPicker && (await selector.locator("option").count()) > 1)
    await expect(picker).toBeVisible();
  if (await picker.isVisible()) {
    const match = picker
      .locator("button.profile-card")
      .filter({ hasText: preferred });
    if (await match.count()) await match.first().click();
    else await picker.locator("button.profile-card").first().click();
    await expect(picker).not.toBeVisible();
  }
}

/** Arm one application confirmation; browser beforeunload remains a separate test. */
export async function respondToNextConfirmation(page: Page, accepted = true) {
  await page.addLocatorHandler(
    page.locator(".confirmation-dialog"),
    async (dialog) => {
      await dialog
        .locator(".dialog-footer button")
        .nth(accepted ? 1 : 0)
        .click();
    },
    { times: 1 },
  );
}
/** Existing-editor scenarios seed an unpublished channel; wizard creation has its own coverage. */
export async function openProgrammingDraft(page: Page, name: string) {
  const profileId = await page
    .getByLabel("Current profile", { exact: true })
    .inputValue();
  const created = await page.evaluate(
    async ({ profileId, name }) => {
      const { csrfToken } = await (await fetch("/api/auth/csrf")).json();
      const response = await fetch("/api/channels", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ profileId, name, visibility: "private" }),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    { profileId, name },
  );
  await page.goto(`/#channels?profile=${profileId}&channel=${created.id}`);
  await page
    .locator(".channel-preview")
    .getByRole("button", { name: "Edit programming", exact: true })
    .click();
  return page.getByRole("dialog", { name: `Program ${name}`, exact: true });
}
