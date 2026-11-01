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

  // Recent is an on-demand menu; visiting articles must not add a shifting list above the tree.
  const otherTitle = unique("Icon parity other");
  const other = await createNote(page, workspaceId, otherTitle);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(other.href);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(otherTitle, ROUND_TRIP);
  const explorer = page.getByRole("complementary", { name: "Knowledge explorer", exact: true });
  await expect(explorer.getByRole("region", { name: "Recent documents", exact: true })).toHaveCount(0);
  const clock = explorer.getByRole("button", { name: "Recent documents", exact: true });
  await clock.focus();
  await page.keyboard.press("Enter");
  const recentMenu = page.getByRole("menu");
  const explorerRow = recentMenu.getByRole("menuitem").filter({ hasText: title });
  await expect(explorerRow).toBeVisible(ROUND_TRIP);
  expect(await explorerRow.textContent()).toContain("📌");
  await explorerRow.click();
  await expect(page).toHaveURL(note.href, ROUND_TRIP);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(title, ROUND_TRIP);
  await expect(recentMenu).toBeHidden();
  await expect(explorer.getByRole("region", { name: "Recent documents", exact: true })).toHaveCount(0);

  // Reopening reflects the new history, and Escape returns focus to the clock.
  await clock.click();
  await expect(recentMenu.getByRole("menuitem").filter({ hasText: otherTitle })).toBeVisible(ROUND_TRIP);
  await page.keyboard.press("Escape");
  await expect(recentMenu).toBeHidden();
  await expect(clock).toBeFocused();

  // The same menu remains reachable in the narrower desktop drawer.
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.getByRole("button", { name: "Show documents", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Browse", exact: true });
  const drawerClock = drawer.getByRole("button", { name: "Recent documents", exact: true });
  await expect(drawerClock).toBeInViewport();
  const fits = await drawerClock.evaluate(button => {
    const toolbar = button.closest('aside')!;
    const bounds = toolbar.getBoundingClientRect();
    return [...toolbar.querySelectorAll(':scope > div:first-child button, :scope > div:first-child a')]
      .every(control => { const rect = control.getBoundingClientRect(); return rect.left >= bounds.left && rect.right <= bounds.right; });
  });
  expect(fits).toBe(true);
  await drawerClock.click();
  await expect(recentMenu.getByRole("menuitem").filter({ hasText: otherTitle })).toBeVisible(ROUND_TRIP);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 900 });

  // The full search page's own result row.
  await page.goto(`/w/${workspaceId}/search?q=${encodeURIComponent(title)}`);
  const result = page.locator("[data-search-result]").filter({ hasText: title });
  await expect(result).toBeVisible(ROUND_TRIP);
  expect(await result.textContent()).toContain("📌");
});
