import { expect, type Page } from "@playwright/test";

/**
 * Opens the command palette and returns its search field.
 *
 * A key pressed before React hydrates reaches no listener, and a page can look
 * finished well before it is (keyboard-shortcuts.spec.ts has the same note).
 * So press, and press again until the palette answers, rather than guessing
 * how long hydration takes.
 */
export async function openPalette(page: Page) {
  const field = page.getByRole("dialog").getByRole("combobox");
  await expect(async () => {
    await page.keyboard.press("Control+k");
    await expect(field).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return field;
}
