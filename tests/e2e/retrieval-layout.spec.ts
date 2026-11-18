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
  return { documentId: created.documentId, sourceId: created.sourceId, href: `/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}` };
}

/**
 * Retrieval-first layout: at 1024–1279 the explorer is a strip and a drawer,
 * and returns as a 288px inline explorer at 1280px.
 */
test("the explorer becomes a drawer between the narrow and wide desktop layouts", async ({ page }) => {
  const workspaceId = await mySpace(page);
  const title = unique("Retrieval drawer");
  const note = await createNote(page, workspaceId, title);

  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto(`/w/${workspaceId}/knowledge/${note.sourceId}`);
  const strip = page.getByRole("button", { name: "Show documents", exact: true });
  const stripTrigger = page.locator('button[aria-label="Show documents"]');
  await expect(strip).toBeVisible(ROUND_TRIP);
  await expect(strip).toHaveAttribute("aria-haspopup", "dialog");
  await expect(stripTrigger).toHaveAttribute("aria-expanded", "false");
  // The inline explorer is CSS-hidden at this width; the strip is the only door.
  await expect(page.getByRole("complementary", { name: "Knowledge explorer" })).not.toBeVisible();

  await strip.click();
  const browse = page.getByRole("dialog", { name: "Browse", exact: true });
  await expect(browse).toBeVisible(ROUND_TRIP);
  // The modal makes the strip inert, so role lookup cannot see it while the drawer is open.
  await expect(stripTrigger).toHaveAttribute("aria-expanded", "true");
  await expect(browse.getByRole("complementary", { name: "Knowledge explorer" })).toBeVisible();
  await browse.getByRole("link", { name: title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${note.documentId}$`), ROUND_TRIP);
  await expect(browse).toHaveCount(0);
  await expect(stripTrigger).toHaveAttribute("aria-expanded", "false");

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/w/${workspaceId}/knowledge/${note.sourceId}`);
  await expect(page.getByRole("complementary", { name: "Knowledge explorer" })).toBeVisible(ROUND_TRIP);
  await expect(page.getByRole("button", { name: "Show documents", exact: true })).toHaveCount(0);
});

test("wide Favorites stay visible and Recent remembers its open state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const workspaceId = await mySpace(page);
  const recentTitle = unique("Retrieval recent");
  const favoriteTitle = unique("Retrieval favorite");
  const recent = await createNote(page, workspaceId, recentTitle);
  const favorite = await createNote(page, workspaceId, favoriteTitle);

  // Reading one document puts it in Recent; starring the other puts it in Favorites.
  await page.goto(recent.href);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(recentTitle, ROUND_TRIP);
  await expect.poll(() => page.evaluate(({ key, id }) =>
    (JSON.parse(localStorage.getItem(key) ?? "{}").recent ?? []).some((value: string) => value.endsWith(`:${id}`)),
  { key: `kh:document-shortcuts:${workspaceId}`, id: recent.documentId }), ROUND_TRIP).toBe(true);
  await page.goto(favorite.href);
  await page.getByRole("treeitem", { name: favoriteTitle, exact: true }).getByRole("button", { name: `Add to favorites: ${favoriteTitle}`, exact: true }).click();

  const explorer = page.getByRole("complementary", { name: "Knowledge explorer" });
  const favorites = explorer.getByRole("region", { name: "Favorites" });
  const recents = explorer.getByRole("region", { name: "Recent" });
  const disclosure = recents.getByRole("button", { name: "Recent", exact: true });
  await expect(favorites.getByRole("link", { name: favoriteTitle })).toBeVisible(ROUND_TRIP);
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await expect(recents.getByRole("link")).toHaveCount(0);
  await disclosure.click();
  await expect(recents.getByRole("link", { name: recentTitle })).toBeVisible(ROUND_TRIP);
  await expect(recents.getByRole("link", { name: favoriteTitle })).toHaveCount(0);
  await page.reload();
  await expect(disclosure).toHaveAttribute("aria-expanded", "true", ROUND_TRIP);
  await expect(recents.getByRole("link", { name: recentTitle })).toBeVisible();
});

// The explorer is what records an open, so it stays mounted where it is not shown: a document read at a width
// without the inline explorer is still in Recent the next time the explorer is opened.
for (const width of [1100, 390]) {
  test(`documents opened at ${width}px are recorded in Recent`, async ({ page }) => {
    const workspaceId = await mySpace(page);
    const firstTitle = unique("Recent first");
    const first = await createNote(page, workspaceId, firstTitle);
    const second = await createNote(page, workspaceId, unique("Recent second"));

    await page.setViewportSize({ width, height: 800 });
    await page.goto(first.href);
    await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(firstTitle, ROUND_TRIP);
    await page.goto(second.href);
    await page.getByRole("button", { name: width < 1024 ? "Open menu" : "Show documents", exact: true }).click();
    await page.getByRole("button", { name: "Recent documents", exact: true }).click();
    const item = page.getByRole("menuitem").filter({ hasText: firstTitle });
    await expect(item).toBeVisible(ROUND_TRIP);
    await item.click();
    await expect(page).toHaveURL(new RegExp(`${first.documentId}$`), ROUND_TRIP);
    await expect(page.getByRole("menu")).toBeHidden();
  });
}

test("Recent menu is closed on drawer reopening and page reload", async ({ page }) => {
  const workspaceId = await mySpace(page);
  const read = await createNote(page, workspaceId, unique("Closed recent read"));
  const note = await createNote(page, workspaceId, unique("Closed recent"));
  await page.setViewportSize({ width: 1100, height: 800 });
  // Recent lists documents other than the one open, and only when it has one.
  await page.goto(read.href);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeVisible(ROUND_TRIP);
  await page.goto(note.href);
  const strip = page.getByRole("button", { name: "Show documents", exact: true });
  const browse = page.getByRole("dialog", { name: "Browse", exact: true });
  const heading = (name: string) => browse.getByRole("button", { name, exact: true });

  await strip.click();
  await heading("Recent documents").click();
  await expect(heading("Recent documents")).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(heading("Recent documents")).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Escape");
  await expect(browse).toHaveCount(0);
  await expect(strip).toBeFocused();

  await strip.click();
  await expect(heading("Recent documents")).toHaveAttribute("aria-expanded", "false", ROUND_TRIP);
  await page.reload();
  await strip.click();
  await expect(heading("Recent documents")).toHaveAttribute("aria-expanded", "false", ROUND_TRIP);
});

test("the drawer closes when the page changes from outside it", async ({ page }) => {
  const workspaceId = await mySpace(page);
  const firstTitle = unique("Drawer route first");
  const first = await createNote(page, workspaceId, firstTitle);
  const secondTitle = unique("Drawer route second");
  const second = await createNote(page, workspaceId, secondTitle);

  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto(first.href);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(firstTitle, ROUND_TRIP);

  const strip = page.getByRole("button", { name: "Show documents", exact: true });
  const browse = page.getByRole("dialog", { name: "Browse", exact: true });
  // Reach the second document from the drawer, so both history entries are client-side.
  await strip.click();
  await browse.getByRole("link", { name: secondTitle, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${second.documentId}$`), ROUND_TRIP);

  await strip.click();
  await expect(browse).toBeVisible(ROUND_TRIP);
  // The palette, a search result, or the browser's Back change the page without touching the drawer.
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${first.documentId}$`), ROUND_TRIP);
  await expect(browse).toHaveCount(0, ROUND_TRIP);
  await expect(strip).toHaveAttribute("aria-expanded", "false");
});
