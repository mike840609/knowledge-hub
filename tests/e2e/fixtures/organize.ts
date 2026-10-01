import { expect, type Locator, type Page } from "@playwright/test";

/** Server-bound assertions only; see the note in phase5-authoring.spec.ts. */
export const ROUND_TRIP = { timeout: 15_000 };

/**
 * What the specs that arrange the tree — zz-organize.spec.ts and zz-organize-move.spec.ts — both do
 * to get to a tree worth arranging, and how they read it back. They work in the E2E user's own My
 * Space with names that are unique per run, so nothing depends on what an earlier spec left there.
 */

export function unique(label: string) {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export async function mySpace(page: Page): Promise<string> {
  await page.goto("/");
  await page.waitForURL(/\/w\/[^/]+\/knowledge/);
  return new URL(page.url()).pathname.split("/")[2];
}

/**
 * The knowledge explorer of a workspace, once it is there to act on. A workspace with nothing in it
 * shows an empty state and no explorer at all — the first thing to make is a document — so this
 * makes sure Notes has one, which also means the spec does not depend on what ran before it.
 */
export async function openKnowledge(page: Page, workspaceId: string) {
  const title = unique("Seed");
  const seeded = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown: "seed" } });
  expect(seeded.ok()).toBe(true);
  const document = (await seeded.json()) as { sourceId: string; documentId: string };
  // The workspace landing page redirects after streaming the sidebar. Opening the document
  // directly keeps that late navigation from closing a menu or clearing a mutation's toast.
  // Hydration restores recents and collapsed folders and then reveals the selected row.
  // Those requests and effects move the scroll container after SSR is already visible;
  // a right-click before they settle can land on a different row in a long tree.
  await page.goto(`/w/${workspaceId}/knowledge/${document.sourceId}/${document.documentId}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("region", { name: "Document content" })).toBeVisible(ROUND_TRIP);
  await expect(page.getByRole("complementary", { name: "Knowledge explorer" })).toBeVisible(ROUND_TRIP);
  await expect(page.getByRole("button", { name: "Create folder" }).first()).toBeVisible(ROUND_TRIP);
  await expect(row(page, title)).toHaveAttribute("aria-current", "page", ROUND_TRIP);
  await expect(row(page, title)).toBeInViewport(ROUND_TRIP);
}

export const row = (page: Page, name: string) => page.getByRole("treeitem", { name, exact: true });
/** A folder row's own header, which is where its menu is — the treeitem also holds everything inside it. */
export const header = (page: Page, name: string) => row(page, name).locator(":scope > div").first();
export const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

/** Make a folder from the sidebar, as a reader does. */
export async function createFolder(page: Page, name: string) {
  await page.getByRole("button", { name: "Create folder" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create folder" }).click();
  await expect(dialog).toHaveCount(0, ROUND_TRIP);
  await expect(row(page, name)).toBeVisible(ROUND_TRIP);
}

/** The names of the treeitems directly inside a folder, in the order they are drawn. */
export async function childrenOf(folder: Locator) {
  return folder.locator(":scope > ul > li[role=treeitem]").evaluateAll((items) => items.map((item) => item.getAttribute("aria-label")));
}
