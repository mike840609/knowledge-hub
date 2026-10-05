import { expect, test, type Page } from "@playwright/test";
import { showMarkdown } from "./composer-helpers";
import { ROUND_TRIP, childrenOf, createFolder, header, mySpace, openKnowledge, row, toast, unique } from "./fixtures/organize";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS: a workspace with a SOURCE_MANAGED source in it, read here and never changed.
const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const OBSIDIAN_SOURCE = "0199f100-0000-7000-8000-000000000101";

/**
 * Arranging what is written, from the tree (daily-driver spec §7): folders, rename, archive and
 * restore with an Undo, and a new document made inside a folder. The registry decides what a row
 * offers and the server what happens; what only a browser can say is that the menu, the dialog,
 * the toast and the tree agree — that an Undo puts the reader back where they were, that a refusal
 * is said in words, and that a row the Hub may not change offers nothing to change it with.
 *
 * It works in the E2E user's own My Space, and the specs share one database and run in file-name
 * order, so it sorts last for the reason zz-wikilinks-composer.spec.ts gives: more documents there
 * move the nodes workspace-graph.spec.ts hovers, which sorts before this and must not see them. Its
 * names are unique, so nothing here depends on what earlier specs left in the tree.
 */

/** Open a folder's menu by its `⋯` button. */
async function openFolderMenu(page: Page, name: string) {
  // A mutation's toast can arrive before its menu has finished closing. Wait for that
  // exit before clicking the same trigger again, otherwise the click can toggle it shut.
  await expect(page.getByRole("menu")).toHaveCount(0);
  await header(page, name).hover();
  const trigger = page.getByRole("button", { name: `Actions for ${name}` });
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  return page.getByRole("menu");
}

/**
 * Counts the times the shell is asked to re-check the caller's access. A refusal that says nothing
 * about access must not ask: the re-check pauses every mutation and says "Unable to confirm workspace"
 * while it runs, and it is over too fast to see after the fact — so this listens for the request itself.
 */
async function countAccessChecks(page: Page) {
  await page.evaluate(() => {
    const counter = window as unknown as { __accessChecks: number };
    counter.__accessChecks = 0;
    window.addEventListener("kh:workspace-access-check", () => { counter.__accessChecks += 1; });
  });
  return () => page.evaluate(() => (window as unknown as { __accessChecks: number }).__accessChecks);
}

async function closeMenu(page: Page) {
  await page.getByRole("menu").press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
}

async function chooseFromFolderMenu(page: Page, folder: string, item: string) {
  const menu = await openFolderMenu(page, folder);
  await menu.getByRole("menuitem", { name: item }).click();
}

/** New document in a folder, through the folder's own menu and the new-document page. */
async function createDocumentIn(page: Page, folder: string, title: string) {
  await chooseFromFolderMenu(page, folder, "New document here");
  await expect(page).toHaveURL(/\/knowledge\/new\?folder=[0-9a-f-]{36}$/);
  const form = page.locator("main form").first();
  await form.getByLabel("Title", { exact: true }).fill(title);
  await (await showMarkdown(form)).fill(`Body of ${title}.`);
  await expect(page.getByRole("button", { name: "Create document" })).toBeEnabled(ROUND_TRIP);
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page.getByRole("region", { name: "Document content" })).toBeVisible(ROUND_TRIP);
  await expect(row(page, title)).toBeVisible(ROUND_TRIP);
  await expect(row(page, title)).toHaveAttribute("aria-current", "page", ROUND_TRIP);
}

async function showArchived(page: Page, on: boolean) {
  await page.getByRole("button", { name: "Document display options" }).click();
  const item = page.getByRole("menuitemcheckbox", { name: "Show archived" });
  if ((await item.getAttribute("aria-checked")) !== String(on)) await item.click();
  else await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
}

test.describe("folders", () => {
  test("are made from the sidebar, renamed, archived and restored, each with a way back", async ({ page }) => {
    const workspaceId = await mySpace(page);
    await openKnowledge(page, workspaceId);
    const name = unique("Runbooks");
    await createFolder(page, name);
    await expect(toast(page, `Created folder “${name}”.`)).toBeVisible();
    await expect(row(page, name)).toContainText("No documents yet.");

    // Rename, by the `⋯` button; the row takes the new name and the Undo puts the old one back.
    const renamed = `${name} v2`;
    await chooseFromFolderMenu(page, name, "Rename folder");
    const dialog = page.getByRole("dialog", { name: "Rename folder" });
    await expect(dialog.getByLabel("Name")).toHaveValue(name);
    await dialog.getByLabel("Name").fill(renamed);
    await dialog.getByRole("button", { name: "Rename" }).click();
    await expect(row(page, renamed)).toBeVisible(ROUND_TRIP);
    await expect(row(page, name)).toHaveCount(0);
    await toast(page, `Renamed to “${renamed}”.`).getByRole("button", { name: "Undo" }).click();
    await expect(row(page, name)).toBeVisible(ROUND_TRIP);
    await expect(row(page, renamed)).toHaveCount(0);

    // Archive: gone from the tree, and the Undo brings it back.
    await chooseFromFolderMenu(page, name, "Archive folder");
    await expect(toast(page, `Archived folder “${name}”.`)).toBeVisible();
    await expect(row(page, name)).toHaveCount(0, ROUND_TRIP);
    await toast(page, `Archived folder “${name}”.`).getByRole("button", { name: "Undo" }).click();
    await expect(row(page, name)).toBeVisible(ROUND_TRIP);

    // Archived folders are found under "Show archived", marked, and restored from there.
    await chooseFromFolderMenu(page, name, "Archive folder");
    await expect(row(page, name)).toHaveCount(0, ROUND_TRIP);
    await showArchived(page, true);
    await expect(row(page, name)).toHaveAttribute("data-status", "ARCHIVED", ROUND_TRIP);
    await expect(row(page, name)).toContainText("Archived");
    const menu = await openFolderMenu(page, name);
    // An archived folder offers to come back, not to be changed.
    await expect(menu.getByRole("menuitem", { name: "Restore folder" })).toBeVisible();
    for (const gone of ["Rename folder", "Archive folder", "New document here", "New folder here"]) {
      await expect(menu.getByRole("menuitem", { name: gone })).toHaveCount(0);
    }
    await menu.getByRole("menuitem", { name: "Restore folder" }).click();
    await expect(row(page, name)).toHaveAttribute("data-status", "ACTIVE", ROUND_TRIP);
    await showArchived(page, false);
  });

  test("ask for a name in words, and keep the dialog open until there is one", async ({ page }) => {
    const workspaceId = await mySpace(page);
    await openKnowledge(page, workspaceId);
    await page.getByRole("button", { name: "Create folder" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New folder" });
    await dialog.getByRole("button", { name: "Create folder" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Enter a folder name.");
    await dialog.getByLabel("Name").fill("x".repeat(513));
    await dialog.getByRole("button", { name: "Create folder" }).click();
    await expect(dialog.getByRole("alert")).toContainText("512");
    // Typing clears the message; Escape leaves without making anything.
    await dialog.getByLabel("Name").fill("ok");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(row(page, "ok")).toHaveCount(0);
  });

  test("open their menu from the keyboard, and by right-click on the header only", async ({ page }) => {
    const workspaceId = await mySpace(page);
    await openKnowledge(page, workspaceId);
    const name = unique("Menus");
    await createFolder(page, name);
    const title = unique("Inside");
    await createDocumentIn(page, name, title);

    // The `⋯` is reachable without a pointer: focus it and press Enter.
    const trigger = page.getByRole("button", { name: `Actions for ${name}` });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu").getByRole("menuitem", { name: "Rename folder" })).toBeVisible();
    await closeMenu(page);

    // Right-click on the folder's header is the folder's menu; on a document inside it, the document's.
    await header(page, name).click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "New folder here" })).toBeVisible();
    await closeMenu(page);
    await row(page, title).click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Archive document" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "New folder here" })).toHaveCount(0);
  });
});

test.describe("documents", () => {
  test("are made inside a folder, archived with an Undo that takes the reader back, and restored to the same place", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const workspaceId = await mySpace(page);
    await openKnowledge(page, workspaceId);
    const folder = unique("Filing");
    await createFolder(page, folder);
    const first = unique("First");
    const second = unique("Second");
    await createDocumentIn(page, folder, first);
    const firstUrl = page.url();
    // The page says where it will go, and the tree shows it there — expanded, though the folder was not open.
    await expect(row(page, folder)).toContainText(first);
    await openKnowledge(page, workspaceId);
    await createDocumentIn(page, folder, second);
    expect(await childrenOf(row(page, folder))).toEqual([first, second]);

    // Back to the first, and archive it from its own row while it is open.
    await page.goto(firstUrl);
    await expect(row(page, first)).toHaveAttribute("aria-current", "page", ROUND_TRIP);
    await row(page, first).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Archive document" }).click();

    // The reader is not left on a page that is no longer there; the toast is, and so is the Undo.
    await expect(toast(page, `Archived “${first}”.`)).toBeVisible(ROUND_TRIP);
    await expect(page).not.toHaveURL(firstUrl);
    await expect(row(page, first)).toHaveCount(0, ROUND_TRIP);
    await expect(toast(page, `Archived “${first}”.`)).toBeVisible();

    // Undo restores it, and takes the reader back to it, and it is where it was: before the second.
    await toast(page, `Archived “${first}”.`).getByRole("button", { name: "Undo" }).click();
    await expect(page).toHaveURL(firstUrl, ROUND_TRIP);
    await expect(row(page, first)).toBeVisible(ROUND_TRIP);
    expect(await childrenOf(row(page, folder))).toEqual([first, second]);
    expect(errors).toEqual([]);
  });

  test("come back from Show archived, marked as archived until they do", async ({ page }) => {
    const workspaceId = await mySpace(page);
    await openKnowledge(page, workspaceId);
    const folder = unique("Shelf");
    await createFolder(page, folder);
    const title = unique("Old note");
    await createDocumentIn(page, folder, title);
    await openKnowledge(page, workspaceId);
    // Archived from a row that is not the open one: no navigation, only the tree changes.
    await row(page, title).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Archive document" }).click();
    await expect(row(page, title)).toHaveCount(0, ROUND_TRIP);

    await showArchived(page, true);
    await expect(row(page, title)).toHaveAttribute("data-status", "ARCHIVED", ROUND_TRIP);
    await expect(row(page, title)).toContainText("Archived");
    await row(page, title).click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Archive document" })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Restore document" }).click();
    await expect(toast(page, `Restored “${title}”.`)).toBeVisible();
    await expect(row(page, title)).toHaveAttribute("data-status", "ACTIVE", ROUND_TRIP);
    await showArchived(page, false);
    await expect(row(page, title)).toBeVisible();
  });

  test("say how many other documents' links stop working when they are archived", async ({ page }) => {
    const workspaceId = await mySpace(page);
    const stamp = unique("Target");
    const post = async (title: string, markdown: string) => {
      const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown } });
      expect(response.ok()).toBe(true);
    };
    await post(stamp, "The target.");
    await post(`${stamp} linker one`, `see [[${stamp}]]`);
    await post(`${stamp} linker two`, `and [[${stamp}]]`);
    await openKnowledge(page, workspaceId);

    await row(page, stamp).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Archive document" }).click();
    await expect(toast(page, "2 documents link here; those links will stop working.")).toBeVisible(ROUND_TRIP);
    // And Undo puts it back: what linked to it works again, so the sentence was about something reversible.
    await toast(page, "2 documents link here").getByRole("button", { name: "Undo" }).click();
    await expect(row(page, stamp)).toBeVisible(ROUND_TRIP);
  });
});

test.describe("what cannot be done", () => {
  test("a folder that still holds something is not archived, and the reader is told what to do", async ({ page }) => {
    const workspaceId = await mySpace(page);
    await openKnowledge(page, workspaceId);
    const folder = unique("Full");
    await createFolder(page, folder);
    const title = unique("Inside");
    await createDocumentIn(page, folder, title);
    await openKnowledge(page, workspaceId);

    const accessChecks = await countAccessChecks(page);
    await chooseFromFolderMenu(page, folder, "Archive folder");
    await expect(toast(page, "Move or archive what's inside first")).toBeVisible(ROUND_TRIP);
    await expect(row(page, folder)).toHaveAttribute("data-status", "ACTIVE");
    await expect(row(page, title)).toBeVisible();
    // The refusal is about the folder, not the caller: no re-check of access was asked for, and the menu is still whole.
    expect(await accessChecks()).toBe(0);
    const menu = await openFolderMenu(page, folder);
    await expect(menu.getByRole("menuitem", { name: "Rename folder" })).toBeVisible();
    await closeMenu(page);

    // Archive what is inside, and the folder can go.
    await row(page, title).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Archive document" }).click();
    await expect(row(page, title)).toHaveCount(0, ROUND_TRIP);
    await chooseFromFolderMenu(page, folder, "Archive folder");
    await expect(toast(page, `Archived folder “${folder}”.`)).toBeVisible(ROUND_TRIP);
    await expect(row(page, folder)).toHaveCount(0, ROUND_TRIP);
  });

  test("a folder the document is asked to go into that is gone is refused in words, not with a blank page", async ({ page }) => {
    const workspaceId = await mySpace(page);
    await openKnowledge(page, workspaceId);
    const folder = unique("Vanishing");
    await createFolder(page, folder);
    await chooseFromFolderMenu(page, folder, "New document here");
    await expect(page).toHaveURL(/\/knowledge\/new\?folder=[0-9a-f-]{36}$/);
    const newUrl = page.url();
    // The folder is archived while the new-document page is open.
    const nodeId = new URL(newUrl).searchParams.get("folder")!;
    const archived = await page.request.post(`/api/tree-nodes/${nodeId}/archive`);
    expect(archived.status()).toBe(204);
    const form = page.locator("main form").first();
    await form.getByLabel("Title", { exact: true }).fill(unique("Nowhere"));
    await (await showMarkdown(form)).fill("x");
    const accessChecks = await countAccessChecks(page);
    await page.getByRole("button", { name: "Create document" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "The destination folder no longer exists, or has been archived." })).toBeVisible(ROUND_TRIP);
    await expect(page).toHaveURL(newUrl);
    // A refusal about the tree says nothing about the caller's access, so it does not ask for a re-check.
    expect(await accessChecks()).toBe(0);
  });

  test("a row in a source the Hub does not own offers nothing to arrange it with", async ({ page }) => {
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/${OBSIDIAN_SOURCE}`);
    await expect(row(page, "Architecture")).toBeVisible(ROUND_TRIP);
    await page.waitForURL(/\/knowledge\/[^/]+\/[^/]+$/);
    // The same caller, one row apart: a Hub-managed document may be archived, a source-managed one may not.
    await row(page, "Architecture").click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Archive document" })).toBeVisible();
    await closeMenu(page);

    const vault = page.getByRole("button", { name: "Vendor Compliance Vault", exact: true });
    if ((await vault.getAttribute("aria-expanded")) !== "true") await vault.click();
    await row(page, "Compliance Policy").click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Open in new tab" })).toBeVisible();
    for (const gone of ["Archive document", "Restore document", "Edit document"]) {
      await expect(page.getByRole("menuitem", { name: gone })).toHaveCount(0);
    }
  });
});
