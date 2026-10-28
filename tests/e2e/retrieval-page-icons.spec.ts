import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

const ROUND_TRIP = { timeout: 15_000 };

function unique(label: string) {
  return `${label}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function createNote(page: Page, workspaceId: string, title: string) {
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown: "Some words." } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { documentId: string; sourceId: string };
  return { ...created, href: `/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}` };
}

/**
 * The page icon is a scanning aid: the same document must wear it wherever a reader looks for it,
 * not only in the tree and on the document itself.
 */
test("a page icon follows the document to Home, the palette, the explorer and search", async ({ page }) => {
  const workspaceId = await mySpace(page);
  const title = unique("Icon parity");
  const note = await createNote(page, workspaceId, title);
  const saved = await page.request.put(`/api/documents/${note.documentId}/icon`, { data: { icon: "📌" } });
  expect(saved.ok()).toBe(true);

  // Reading it records it in Recent on this device.
  await page.goto(note.href);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(title, ROUND_TRIP);

  // Home: the Recent row is the whole row, icon included.
  await page.goto(`/w/${workspaceId}/home`);
  const homeRow = page.locator('section[aria-label="Recent"]').locator(`a[href="${note.href}"]`).first();
  await expect(homeRow).toBeVisible(ROUND_TRIP);
  expect(await homeRow.textContent()).toContain("📌");

  // ⌘K: the empty palette lists the same document from the recent-documents endpoint.
  await page.keyboard.press("Meta+K");
  const palette = page.getByRole("dialog");
  await expect(palette).toBeVisible(ROUND_TRIP);
  const recentOption = palette.getByRole("option").filter({ hasText: title });
  await expect(recentOption).toBeVisible(ROUND_TRIP);
  expect(await recentOption.textContent()).toContain("📌");

  // The same palette's search answer comes through the quick-search endpoint.
  await palette.getByRole("combobox").fill(title);
  const searchOption = palette.getByRole("option").filter({ hasText: title });
  await expect(searchOption).toBeVisible(ROUND_TRIP);
  expect(await searchOption.textContent()).toContain("📌");
  await page.keyboard.press("Escape");

  // The explorer's Recent section, with another document open so the first one is recent, not current.
  const otherTitle = unique("Icon parity other");
  const other = await createNote(page, workspaceId, otherTitle);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(other.href);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(otherTitle, ROUND_TRIP);
  const explorerRecent = page.getByRole("region", { name: "Recent documents" });
  const explorerRow = explorerRecent.getByRole("link", { name: title, exact: true });
  await expect(explorerRow).toBeVisible(ROUND_TRIP);
  expect(await explorerRow.textContent()).toContain("📌");

  // The full search page's own result row.
  await page.goto(`/w/${workspaceId}/search?q=${encodeURIComponent(title)}`);
  const result = page.locator("[data-search-result]").filter({ hasText: title });
  await expect(result).toBeVisible(ROUND_TRIP);
  expect(await result.textContent()).toContain("📌");
});
