import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

const ROUND_TRIP = { timeout: 15_000 };

function unique(label: string) {
  return `${label}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function createNote(page: Page, workspaceId: string, title: string) {
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown: "Some words." } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  return { url: `/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}` };
}

/**
 * The document's own top line: the favorite star, the page icon above the
 * title, and the overflow that carries Duplicate. None of these need a detour
 * through the explorer.
 */
test("a document can be favorited, given an icon, and duplicated from its own header", async ({ page }) => {
  const workspaceId = await mySpace(page);
  const title = unique("Topbar document");
  const note = await createNote(page, workspaceId, title);
  await page.goto(note.url);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(title, ROUND_TRIP);

  const main = page.locator("main");
  await main.getByRole("button", { name: "Add to favorites", exact: true }).click();
  await expect(main.getByRole("button", { name: "Remove from favorites", exact: true })).toHaveAttribute("aria-pressed", "true");

  await main.getByRole("button", { name: "Add page icon", exact: true }).click();
  // The picker shows the icon before the server has it; reloading earlier would read the page without it.
  const saved = page.waitForResponse((response) => response.url().endsWith("/icon") && response.request().method() === "PUT");
  await page.getByRole("button", { name: "Use 📌", exact: true }).click();
  await expect(main.getByRole("button", { name: "Change page icon", exact: true })).toBeVisible(ROUND_TRIP);
  expect((await saved).ok()).toBe(true);
  await page.reload();
  await expect(main.getByRole("button", { name: "Change page icon", exact: true })).toBeVisible(ROUND_TRIP);

  await main.getByRole("button", { name: "Document actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Duplicate document", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(`${title} copy`, ROUND_TRIP);
  // The copy inherits the page's identity, not only its words.
  await expect(main.getByRole("button", { name: "Change page icon", exact: true })).toBeVisible(ROUND_TRIP);
});
