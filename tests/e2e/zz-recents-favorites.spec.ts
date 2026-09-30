import { expect, test, type Locator, type Page } from "@playwright/test";
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

/**
 * Opens the document, and waits until it has been remembered as opened. That is the sidebar's effect, which
 * runs after the row is on screen: going on to the next page from the row alone loses the ones the effect
 * had not reached (it did, about one full run in thirty under load), so this looks at what was stored.
 */
async function read(page: Page, note: { url: string; documentId: string }, title: string) {
  await page.goto(note.url);
  await expect(page.getByRole("heading", { name: title }).first()).toBeVisible(ROUND_TRIP);
  await expect(page.getByRole("treeitem", { name: title, exact: true })).toBeVisible(ROUND_TRIP);
  const storageKey = `kh:document-shortcuts:${note.url.split("/")[2]}`;
  await expect
    .poll(
      () => page.evaluate(([key, id]) => (JSON.parse(localStorage.getItem(key) ?? "{}").recent ?? [])[0]?.endsWith(`:${id}`) === true, [storageKey, note.documentId]),
      ROUND_TRIP,
    )
    .toBe(true);
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
    await expect(options(page).nth(0)).toContainText(b, ROUND_TRIP);
    await expect(options(page).nth(1)).toContainText(a, ROUND_TRIP);
    await expect(options(page).filter({ hasText: c })).toHaveCount(0, ROUND_TRIP);
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
    await expect(options(page).filter({ hasText: b })).toHaveCount(0, ROUND_TRIP);
  });

  test("does not list a document it did not ask for, whatever the answer names", async ({ page }) => {
    // An answer can be older than the question: it was sent before this page had said which document it is,
    // so it names that one too, and it may arrive last. What it names beyond what is asked for is not shown.
    const stamp = unique("Stale");
    const workspaceId = await mySpace(page);
    const [a, b, c] = [`${stamp} Alpha`, `${stamp} Beta`, `${stamp} Gamma`];
    const notes = { a: await createNote(page, workspaceId, a), b: await createNote(page, workspaceId, b), c: await createNote(page, workspaceId, c) };
    await read(page, notes.a, a);
    await read(page, notes.b, b);
    await read(page, notes.c, c);
    const wide = await page.request.get(`/api/workspaces/${workspaceId}/recent-documents?ids=${notes.c.documentId},${notes.b.documentId},${notes.a.documentId}`);
    expect(wide.ok()).toBe(true);
    const body = JSON.stringify(await wide.json());
    await page.route("**/recent-documents?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));

    await openPalette(page);
    await expect(options(page).nth(0)).toContainText(b, ROUND_TRIP);
    await expect(options(page).nth(1)).toContainText(a, ROUND_TRIP);
    await expect(options(page).filter({ hasText: c })).toHaveCount(0);
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
    await expect(options(page).nth(0)).toContainText(a, ROUND_TRIP);
  });

  test("when the list cannot be had it is what it was: no Recent, and the first row is a place to go", async ({ page }) => {
    const stamp = unique("Down");
    const workspaceId = await mySpace(page);
    const [a, b] = [`${stamp} Alpha`, `${stamp} Beta`];
    const notes = { a: await createNote(page, workspaceId, a), b: await createNote(page, workspaceId, b) };
    await read(page, notes.a, a);
    await read(page, notes.b, b);
    let asked = 0;
    await page.route("**/recent-documents?*", (route) => {
      asked += 1;
      return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    });

    await openPalette(page);
    await expect.poll(() => asked, ROUND_TRIP).toBeGreaterThan(0);
    await expect(recentHeading(page)).toBeHidden();
    await expect(options(page).first()).toContainText(/Go to /);
    // Typing still searches.
    await page.getByRole("dialog").getByRole("combobox").fill(stamp);
    await expect(options(page).filter({ hasText: a })).toBeVisible(ROUND_TRIP);
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
    // Counted among this test's own documents: favorites follow the account, so others may be there too.
    const mine = (region: Locator) => region.getByRole("link", { name: stamp });
    for (const [index, title] of titles.entries()) {
      await page.getByRole("button", { name: `Add to favorites: ${title}`, exact: true }).click();
      await expect(favorites.getByRole("link", { name: title, exact: true })).toBeVisible(ROUND_TRIP);
      await expect(mine(favorites)).toHaveCount(index + 1);
    }
    // All ten are there — the old limit was four — in a list that scrolls rather than pushing the tree away.
    await expect(mine(favorites)).toHaveCount(10);
    const list = favorites.locator("ul");
    const scrolls = await list.evaluate((element) => ({ scrolls: element.scrollHeight > element.clientHeight, tall: element.clientHeight <= 288 }));
    expect(scrolls).toEqual({ scrolls: true, tall: true });
    // Reload: still all ten, from wherever they are kept.
    await page.reload();
    await expect(mine(page.getByRole("region", { name: "Favorites" }))).toHaveCount(10, ROUND_TRIP);
  });
});
