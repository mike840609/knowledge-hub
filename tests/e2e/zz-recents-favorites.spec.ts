import { expect, test, type Page } from "@playwright/test";
import { openPalette } from "./fixtures/palette";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/**
 * B.0: the empty palette lists what was opened lately, and the sidebar's Favorites lists every favorite.
 *
 * It creates documents in the E2E user's own My Space, and sorts where zz-wikilinks-composer.spec.ts does,
 * for the same two reasons (phase2.5-routing's empty My Space, workspace-graph's node layout).
 */

function unique(label: string) {
  return `${label}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function mySpace(page: Page): Promise<string> {
  await page.goto("/");
  await page.waitForURL(/\/w\/[^/]+\/knowledge/);
  return new URL(page.url()).pathname.split("/")[2];
}

async function createNote(page: Page, workspaceId: string, title: string) {
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown: "Some words." } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  return { documentId: created.documentId, url: `/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}` };
}

/** Opens the document, and waits until its tree has recorded it as opened. */
async function read(page: Page, note: { url: string }, title: string) {
  await page.goto(note.url);
  await expect(page.getByRole("heading", { name: title }).first()).toBeVisible(ROUND_TRIP);
  await expect(page.getByRole("treeitem", { name: title, exact: true })).toBeVisible(ROUND_TRIP);
}

const listbox = (page: Page) => page.getByRole("listbox", { name: "Actions and documents" });
const options = (page: Page) => listbox(page).getByRole("option");
const recentHeading = (page: Page) => page.getByRole("dialog").getByText("Recent", { exact: true });

test.describe("the palette, before anything is typed", () => {
  test("lists what was opened lately, newest first and not the one being read; Enter goes to the one before", async ({ page }) => {
    const stamp = unique("Recent");
    const workspaceId = await mySpace(page);
    const [a, b, c] = [`${stamp} Alpha`, `${stamp} Beta`, `${stamp} Gamma`];
    const notes = { a: await createNote(page, workspaceId, a), b: await createNote(page, workspaceId, b), c: await createNote(page, workspaceId, c) };
    await read(page, notes.a, a);
    await read(page, notes.b, b);
    await read(page, notes.c, c);

    await openPalette(page);
    await expect(recentHeading(page)).toBeVisible(ROUND_TRIP);
    // Beta then Alpha: Gamma is the page this is opened on.
    await expect(options(page).nth(0)).toContainText(b);
    await expect(options(page).nth(1)).toContainText(a);
    await expect(options(page).filter({ hasText: c })).toHaveCount(0);
    // Each says where it is, and the default row is the first of them.
    await expect(options(page).nth(0)).toContainText("Notes");
    await expect(options(page).nth(0)).toHaveAttribute("aria-selected", "true");
    // The actions are still there, after them.
    await expect(options(page).filter({ hasText: /Go to Knowledge|Go to My Space home/ }).first()).toBeVisible();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(notes.b.url, ROUND_TRIP);
  });

  test("leaves out a document that has since been archived", async ({ page }) => {
    const stamp = unique("Archived");
    const workspaceId = await mySpace(page);
    const [a, b, c] = [`${stamp} Alpha`, `${stamp} Beta`, `${stamp} Gamma`];
    const notes = { a: await createNote(page, workspaceId, a), b: await createNote(page, workspaceId, b), c: await createNote(page, workspaceId, c) };
    await read(page, notes.a, a);
    await read(page, notes.b, b);
    await read(page, notes.c, c);
    expect((await page.request.post(`/api/documents/${notes.b.documentId}/archive`)).ok()).toBe(true);

    await openPalette(page);
    await expect(options(page).nth(0)).toContainText(a, ROUND_TRIP);
    await expect(options(page).filter({ hasText: b })).toHaveCount(0);
  });

  test("gives way to the search once something is typed, and comes back when it is cleared", async ({ page }) => {
    const stamp = unique("Typed");
    const workspaceId = await mySpace(page);
    const [a, b] = [`${stamp} Alpha`, `${stamp} Beta`];
    const notes = { a: await createNote(page, workspaceId, a), b: await createNote(page, workspaceId, b) };
    await read(page, notes.a, a);
    await read(page, notes.b, b);

    const field = await openPalette(page);
    await expect(recentHeading(page)).toBeVisible(ROUND_TRIP);
    await field.fill("zzzz-nothing-matches");
    await expect(recentHeading(page)).toBeHidden();
    await field.fill("");
    await expect(recentHeading(page)).toBeVisible(ROUND_TRIP);
    await expect(options(page).nth(0)).toContainText(a);
  });

  test("with nothing else opened it is what it was: the first row is a place to go", async ({ page }) => {
    await mySpace(page);
    await expect(page.getByRole("treeitem").first()).toBeVisible(ROUND_TRIP);
    await openPalette(page);
    await expect(recentHeading(page)).toBeHidden();
    await expect(options(page).first()).toHaveAttribute("aria-selected", "true");
    await expect(options(page).first()).toContainText(/Go to /);
  });
});

test.describe("the sidebar's Favorites", () => {
  test("lists every favorite, not the first few, and scrolls in place when there are many", async ({ page }) => {
    const stamp = unique("Fav");
    const workspaceId = await mySpace(page);
    const titles = Array.from({ length: 10 }, (_, index) => `${stamp} Note ${String(index + 1).padStart(2, "0")}`);
    const first = await createNote(page, workspaceId, titles[0]);
    for (const title of titles.slice(1)) await createNote(page, workspaceId, title);
    await read(page, first, titles[0]);

    const favorites = page.getByRole("region", { name: "Favorites" });
    for (const [index, title] of titles.entries()) {
      await page.getByRole("button", { name: `Add to favorites: ${title}`, exact: true }).click();
      await expect(favorites.getByRole("link", { name: title, exact: true })).toBeVisible(ROUND_TRIP);
      await expect(favorites.getByRole("link")).toHaveCount(index + 1);
    }
    // All ten are there — the old limit was four — in a list that scrolls rather than pushing the tree away.
    await expect(favorites.getByRole("link")).toHaveCount(10);
    const list = favorites.locator("ul");
    const scrolls = await list.evaluate((element) => ({ scrolls: element.scrollHeight > element.clientHeight, tall: element.clientHeight <= 288 }));
    expect(scrolls).toEqual({ scrolls: true, tall: true });
    // Reload: still all ten, from wherever they are kept.
    await page.reload();
    await expect(page.getByRole("region", { name: "Favorites" }).getByRole("link")).toHaveCount(10, ROUND_TRIP);
  });
});
