import { expect, type Locator } from "@playwright/test";

/**
 * The composer opens in rendered editing. Tests that need to type exact
 * Markdown switch to the source first; this does that and returns the textarea.
 */
export async function showMarkdown(form: Locator): Promise<Locator> {
  const toggle = form.getByRole("button", { name: "Markdown", exact: true });
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  const source = form.getByLabel("Markdown", { exact: true });
  await expect(source).toBeVisible();
  return source;
}
