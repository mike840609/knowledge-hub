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
 * not a 288px column; above 1280 it is inline again. Favorites and Recent are
 * visible on arrival, because finding a document is the first job.
 */
test("the explorer becomes a drawer between the narrow and wide desktop layouts", async ({ page }) => {
  const workspaceId = await mySpace(page);
  const title = unique("Retrieval drawer");
  const note = await createNote(page, workspaceId, title);

  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto(`/w/${workspaceId}/knowledge/${note.sourceId}`);
  const strip = page.getByRole("button", { name: "Show documents", exact: true });
  await expect(strip).toBeVisible(ROUND_TRIP);
  // The inline explorer is CSS-hidden at this width; the strip is the only door.
  await expect(page.getByRole("complementary", { name: "Knowledge explorer" })).not.toBeVisible();

  await strip.click();
  const browse = page.getByRole("dialog", { name: "Browse", exact: true });
  await expect(browse).toBeVisible(ROUND_TRIP);
  await expect(browse.getByRole("complementary", { name: "Knowledge explorer" })).toBeVisible();
  await browse.getByRole("link", { name: title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${note.documentId}$`), ROUND_TRIP);
  await expect(browse).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/w/${workspaceId}/knowledge/${note.sourceId}`);
  await expect(page.getByRole("complementary", { name: "Knowledge explorer" })).toBeVisible(ROUND_TRIP);
  await expect(page.getByRole("button", { name: "Show documents", exact: true })).toHaveCount(0);
});

test("Favorites and Recent are open without a first click", async ({ page }) => {
  const workspaceId = await mySpace(page);
  const recentTitle = unique("Retrieval recent");
  const favoriteTitle = unique("Retrieval favorite");
  const recent = await createNote(page, workspaceId, recentTitle);
  const favorite = await createNote(page, workspaceId, favoriteTitle);

  // Reading one document puts it in Recent; starring the other puts it in Favorites.
  await page.goto(recent.href);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(recentTitle, ROUND_TRIP);
  await page.goto(`/w/${workspaceId}/knowledge/${favorite.sourceId}`);
  await page.getByRole("button", { name: `Add to favorites: ${favoriteTitle}`, exact: true }).click();

  const favorites = page.getByRole("region", { name: "Favorites" });
  const recentRegion = page.getByRole("region", { name: "Recent" });
  await expect(favorites.getByRole("link", { name: favoriteTitle, exact: true })).toBeVisible(ROUND_TRIP);
  await expect(recentRegion.getByRole("link", { name: recentTitle, exact: true })).toBeVisible(ROUND_TRIP);
  // The headings say they are open, which is the difference from the old default.
  await expect(favorites.getByRole("button", { name: "Favorites", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(recentRegion.getByRole("button", { name: "Recent", exact: true })).toHaveAttribute("aria-expanded", "true");
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
    await expect(page.getByRole("region", { name: "Recent" }).getByRole("link", { name: firstTitle, exact: true })).toBeVisible(ROUND_TRIP);
  });
}

test("a section closed in the drawer is still closed when the drawer opens again", async ({ page }) => {
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
  await heading("Recent").click();
  await expect(heading("Recent")).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Escape");
  await expect(browse).toHaveCount(0);
  await expect(strip).toBeFocused();

  await strip.click();
  await expect(heading("Recent")).toHaveAttribute("aria-expanded", "false", ROUND_TRIP);
  await page.reload();
  await strip.click();
  await expect(heading("Recent")).toHaveAttribute("aria-expanded", "false", ROUND_TRIP);
});
