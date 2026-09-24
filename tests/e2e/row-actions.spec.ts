import { expect, test } from "@playwright/test";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS.
const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const OBSIDIAN_SOURCE = "0199f100-0000-7000-8000-000000000101";
const KNOWLEDGE = `/w/${QUERY_MASTER_WORKSPACE}/knowledge/${OBSIDIAN_SOURCE}`;

/**
 * One registry, three surfaces. What is asserted here is not that a menu
 * opens, but that the same availability rules reach every opening of it: a
 * row's `⋯` button, a right-click, and `⌘K`.
 */

async function expandVault(page: import("@playwright/test").Page) {
  const header = page.getByRole("button", { name: "Vendor Compliance Vault", exact: true });
  if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
}

/** A menu stays mounted through its closing transition; the next one must not overlap it. */
async function closeMenu(page: import("@playwright/test").Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
}

/** `/knowledge/:sourceId` redirects to a document; act only once it has landed. */
async function openTree(page: import("@playwright/test").Page) {
  await page.goto(KNOWLEDGE);
  await expect(page.getByRole("treeitem", { name: "Architecture", exact: true })).toBeVisible();
  await page.waitForURL(/\/knowledge\/[^/]+\/[^/]+$/);
}

test("a row's actions open by right-click and by its button, with the same items", async ({ page }) => {
  await openTree(page);
  const row = page.getByRole("treeitem", { name: "Architecture", exact: true });

  await row.click({ button: "right" });
  const contextMenu = page.getByRole("menu");
  await expect(contextMenu.getByRole("menuitem", { name: "Open document" })).toBeVisible();
  await expect(contextMenu.getByRole("menuitem", { name: "Edit document" })).toBeVisible();
  await expect(contextMenu.getByRole("menuitem", { name: "Add to favorites" })).toBeVisible();
  await closeMenu(page);

  // Right-click is the shortcut; the button is the door that keyboard and
  // touch users can find.
  await row.hover();
  await page.getByRole("button", { name: "Actions for Architecture" }).click();
  const buttonMenu = page.getByRole("menu");
  await expect(buttonMenu.getByRole("menuitem", { name: "Open document" })).toBeVisible();
  await expect(buttonMenu.getByRole("menuitem", { name: "Edit document" })).toBeVisible();
  await expect(buttonMenu.getByRole("menuitem", { name: "Add to favorites" })).toBeVisible();
});

test("source-managed content offers no Edit, however capable the caller", async ({ page }) => {
  await openTree(page);
  await expandVault(page);

  // The same caller, one row apart: the difference is the source's ownership.
  await page.getByRole("treeitem", { name: "Architecture", exact: true }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Edit document" })).toBeVisible();
  await closeMenu(page);

  await page.getByRole("treeitem", { name: "Compliance Policy", exact: true }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Open document" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Edit document" })).toHaveCount(0);
});

test("a row action runs: Edit opens the editor", async ({ page }) => {
  await openTree(page);
  await page.getByRole("treeitem", { name: "Architecture", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit document" }).click();
  await expect(page).toHaveURL(/\/edit$/);
});

test("the palette offers actions as well as documents, and keeps the keyboard over both", async ({ page }) => {
  await openTree(page);
  await page.keyboard.press("ControlOrMeta+k");

  const field = page.getByRole("combobox", { name: "Search documents and actions" });
  await expect(field).toBeFocused();
  const list = page.getByRole("listbox", { name: "Actions and documents" });
  await expect(list.getByRole("option", { name: "Go to Sources" })).toBeVisible();
  await expect(list.getByRole("option", { name: "Create document" })).toBeVisible();

  // The active row is the first one, and arrow keys move over the merged list.
  await expect(list.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(list.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");

  await field.fill("settings");
  await expect(list.getByRole("option", { name: "Go to Settings" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/w/${QUERY_MASTER_WORKSPACE}/settings`));
});

test("favouriting from the row menu reaches the sidebar without a reload", async ({ page }) => {
  await openTree(page);
  const row = page.getByRole("treeitem", { name: "Runbooks", exact: true });
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add to favorites" }).click();

  const favorites = page.getByRole("region", { name: "Favorites" });
  await expect(favorites.getByRole("link", { name: /Runbooks/ })).toBeVisible();

  // And the registry now offers the inverse, because the target's state changed.
  await row.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Remove from favorites" })).toBeVisible();
});

/**
 * The row menu replaced the browser's own right-click menu on a link, and that
 * menu offered "Open in new tab" and "Copy link address". These assert the
 * replacement does what those did, not merely that it lists them.
 */
test("Open in new tab opens the document in a new tab and leaves this one alone", async ({ page, context }) => {
  await openTree(page);
  const here = page.url();
  const row = page.getByRole("treeitem", { name: "Runbooks", exact: true });
  const href = await row.getByRole("link").getAttribute("href");

  await row.click({ button: "right" });
  const [opened] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("menuitem", { name: "Open in new tab" }).click(),
  ]);
  await opened.waitForLoadState();
  expect(new URL(opened.url()).pathname).toBe(href);
  expect(page.url()).toBe(here);
});

test("Copy link puts the document's full URL on the clipboard and says so", async ({ page, context, baseURL }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openTree(page);
  const row = page.getByRole("treeitem", { name: "Runbooks", exact: true });
  const href = await row.getByRole("link").getAttribute("href");

  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy link" }).click();

  await expect(page.getByRole("status")).toContainText("Link copied.");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(new URL(href!, baseURL).toString());
});
