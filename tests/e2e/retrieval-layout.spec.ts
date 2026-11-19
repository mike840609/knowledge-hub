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

test("Knowledge stays in the desktop sidebar at 1024px and moves to Menu below it", async ({ page }) => {
  const workspaceId = await mySpace(page);
  const title = unique("Retrieval drawer");
  const note = await createNote(page, workspaceId, title);

  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto(`/w/${workspaceId}/knowledge/${note.sourceId}`);
  const explorer = page.getByRole("complementary", { name: "Knowledge explorer" });
  const primary = page.getByRole("navigation", { name: "Primary", exact: true });
  const sidebar = page.locator("aside").filter({ has: primary });
  await expect(sidebar.getByRole("complementary", { name: "Knowledge explorer" })).toBeVisible(ROUND_TRIP);
  await expect(sidebar).toHaveCSS("width", "272px");
  await expect(explorer.getByRole("link", { name: title, exact: true })).toBeVisible(ROUND_TRIP);

  await page.setViewportSize({ width: 1023, height: 800 });
  await expect(explorer).toBeHidden();
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "Menu", exact: true });
  await expect(menu.getByRole("navigation", { name: "Primary", exact: true })).toBeVisible();
  await menu.getByRole("link", { name: title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${note.documentId}$`), ROUND_TRIP);
  await expect(menu).toHaveCount(0);

  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(sidebar.getByRole("complementary", { name: "Knowledge explorer" })).toBeVisible(ROUND_TRIP);
  await expect(page.getByRole("button", { name: "Open menu", exact: true })).toBeHidden();
});

test("Favorites and Recent open independently from adjacent toolbar buttons", async ({ page }) => {
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
  await page.getByRole("button", { name: `Add to favorites: ${favoriteTitle}`, exact: true }).click();

  const favorites = page.getByRole("button", { name: "Favorite documents", exact: true });
  const clock = page.getByRole("button", { name: "Recent documents", exact: true });
  await expect(page.getByRole("heading", { name: "Documents", exact: true })).toHaveCount(0);
  await expect(favorites).toHaveAttribute("aria-expanded", "false");
  await expect(clock).toHaveAttribute("aria-expanded", "false");
  await favorites.click();
  await expect(page.getByRole("menuitem").filter({ hasText: favoriteTitle })).toBeVisible(ROUND_TRIP);
  await expect(page.getByRole("menuitem").filter({ hasText: recentTitle })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await clock.click();
  await expect(page.getByRole("menuitem").filter({ hasText: recentTitle })).toBeVisible(ROUND_TRIP);
});

// Articles opened while Knowledge is hidden still appear in Recent.
for (const width of [1100, 390]) {
  test(`documents opened at ${width}px are recorded in Recent`, async ({ page }) => {
    const workspaceId = await mySpace(page);
    const firstTitle = unique("Recent first");
    const first = await createNote(page, workspaceId, firstTitle);
    const second = await createNote(page, workspaceId, unique("Recent second"));

    await page.setViewportSize({ width, height: 800 });
    const mobile = width < 1024;
    if (!mobile) {
      await page.goto(`/w/${workspaceId}/home`);
      await page.getByRole("button", { name: "Collapse navigation", exact: true }).click();
    }
    await page.goto(first.href);
    await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(firstTitle, ROUND_TRIP);
    await expect(page.getByRole("navigation", { name: "Document tree", exact: true })).toBeHidden();
    await page.goto(second.href);
    await page.getByRole("button", { name: mobile ? "Open menu" : "Expand navigation", exact: true }).click();
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
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(read.href);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeVisible(ROUND_TRIP);
  await page.goto(`/w/${workspaceId}/inbox`);
  const expand = page.getByRole("button", { name: "Expand navigation", exact: true });
  const menu = page.getByRole("dialog", { name: "Menu", exact: true });
  const recent = menu.getByRole("button", { name: "Recent documents", exact: true });

  await expand.click();
  await recent.click();
  await expect(recent).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(recent).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(expand).toBeFocused();

  await expand.click();
  await expect(recent).toHaveAttribute("aria-expanded", "false", ROUND_TRIP);
  await page.reload();
  await expand.click();
  await expect(recent).toHaveAttribute("aria-expanded", "false", ROUND_TRIP);
});

test("the drawer closes when the page changes from outside it", async ({ page }) => {
  const workspaceId = await mySpace(page);
  const firstTitle = unique("Drawer route first");
  const first = await createNote(page, workspaceId, firstTitle);
  const secondTitle = unique("Drawer route second");
  const second = await createNote(page, workspaceId, secondTitle);

  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto(first.href);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(firstTitle, ROUND_TRIP);

  const trigger = page.getByRole("button", { name: "Open menu", exact: true });
  const menu = page.getByRole("dialog", { name: "Menu", exact: true });
  // Reach the second document from the drawer, so both history entries are client-side.
  await trigger.click();
  await menu.getByRole("link", { name: secondTitle, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${second.documentId}$`), ROUND_TRIP);

  await trigger.click();
  await expect(menu).toBeVisible(ROUND_TRIP);
  // The palette, a search result, or the browser's Back change the page without touching the drawer.
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${first.documentId}$`), ROUND_TRIP);
  await expect(menu).toHaveCount(0, ROUND_TRIP);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});
