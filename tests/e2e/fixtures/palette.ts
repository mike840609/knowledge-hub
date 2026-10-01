import { expect, type Page } from "@playwright/test";

/**
 * Opens the command palette and returns its search field.
 *
 * A key pressed before React hydrates reaches no listener, and a page can look
 * finished well before it is (keyboard-shortcuts.spec.ts has the same note).
 * So press, and press again until the palette answers, rather than guessing
 * how long hydration takes.
 *
 * It returns once the list has settled; `{ settled: false }` returns as soon as the palette is open.
 */
export async function openPalette(page: Page, { settled = true }: { settled?: boolean } = {}) {
  const field = page.getByRole("dialog").getByRole("combobox");
  await expect(async () => {
    await page.keyboard.press("Control+k");
    await expect(field).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  // Until the recent documents have been asked for, rows are about to be put above the ones showing, and a
  // key pressed now moves over a list that changes under it. The list says so with `aria-busy`.
  if (settled) await expect(page.locator('[role="listbox"][aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
  return field;
}
