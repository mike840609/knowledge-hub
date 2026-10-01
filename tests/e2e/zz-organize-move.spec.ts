import { expect, test, type Locator, type Page } from "@playwright/test";
import { ROUND_TRIP, childrenOf, mySpace, openKnowledge, row, toast, unique } from "./fixtures/organize";
import { openPalette } from "./fixtures/palette";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS: a workspace with a SOURCE_MANAGED source in it, read here and never changed.
const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const OBSIDIAN_SOURCE = "0199f100-0000-7000-8000-000000000101";

/**
 * Moving what is written, from the tree (daily-driver spec §7): the Move dialog from a row and from the
 * palette, and Alt+↑/↓ to reorder a row where it is. The registry decides who is offered this and the
 * server what happens (organize-api.test.ts holds every refusal); what only a browser can say is that
 * the dialog lists the right places, that where a row went is where the tree shows it, that an Undo puts
 * it back in its old place, and that the keyboard moves the row and not the focus and leaves the focus
 * on it.
 *
 * It works in the E2E user's own My Space, with folders and documents made through the API so their
 * order is known, and sorts last for the reason zz-organize.spec.ts gives.
 */

async function apiFolder(page: Page, workspaceId: string, name: string, parentId?: string) {
  const response = await page.request.post(`/api/workspaces/${workspaceId}/folders`, { data: { name, ...(parentId ? { parentId } : {}) } });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { treeNodeId: string }).treeNodeId;
}

async function apiDocument(page: Page, workspaceId: string, title: string, parentId?: string) {
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown: `Body of ${title}.`, ...(parentId ? { parentId } : {}) } });
  expect(response.status()).toBe(201);
  return (await response.json()) as { documentId: string; sourceId: string };
}

/** Counts the requests that change the tree's arrangement, so "nothing was asked of the server" is something to assert. */
function countTreeRequests(page: Page) {
  let count = 0;
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().includes("/api/tree-nodes/")) count += 1;
  });
  return () => count;
}

/** Open the Move dialog for a row, by its menu, as a reader does. */
async function openMoveDialog(page: Page, rowName: string, kind: "document" | "folder") {
  const target = row(page, rowName);
  await (kind === "folder" ? target.locator(":scope > div").first() : target).click({ button: "right" });
  await page.getByRole("menuitem", { name: kind === "folder" ? "Move folder…" : "Move document…" }).click();
  const dialog = page.getByRole("dialog", { name: kind === "folder" ? "Move folder" : "Move document" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Choose a place as a reader does: by its row. The radio itself is visually hidden, and its label is what is clicked. */
async function choose(dialog: Locator, place: string) {
  await dialog.getByText(place, { exact: true }).click();
  await expect(dialog.getByRole("radio", { name: place })).toBeChecked();
}

const saidAloud = (page: Page, text: string) => page.locator('[aria-live="polite"]').filter({ hasText: text });

async function focusRow(target: Locator) {
  await target.focus();
  await expect(target).toBeFocused();
}

/** Wait for the tree to show a folder's children in an order — the server's answer arriving. */
async function expectOrder(folder: Locator, expected: string[]) {
  await expect.poll(() => childrenOf(folder), ROUND_TRIP).toEqual(expected);
}

test.describe("the Move dialog", () => {
  test("puts a document last in the folder chosen, opens it there, and an Undo puts it back where it was", async ({ page }) => {
    const workspaceId = await mySpace(page);
    const from = unique("Origin");
    const to = unique("Destination");
    const fromId = await apiFolder(page, workspaceId, from);
    await apiFolder(page, workspaceId, to);
    const first = unique("First");
    const second = unique("Second");
    await apiDocument(page, workspaceId, first, fromId);
    await apiDocument(page, workspaceId, second, fromId);
    await openKnowledge(page, workspaceId);
    expect(await childrenOf(row(page, from))).toEqual([first, second]);
    // The destination is closed, as a reader may well have left it.
    await row(page, to).locator(":scope > div > button[aria-expanded]").click();
    await expect(row(page, to)).toHaveAttribute("aria-expanded", "false");

    const dialog = await openMoveDialog(page, first, "document");
    // Where it is now is marked and cannot be chosen; the top level and the other folder can.
    await expect(dialog.getByRole("radio", { name: from })).toBeDisabled();
    await expect(dialog.getByRole("radio", { name: "Top level" })).toBeEnabled();
    await expect(dialog.getByRole("button", { name: "Move", exact: true })).toBeDisabled();
    await choose(dialog, to);
    await dialog.getByRole("button", { name: "Move", exact: true }).click();

    await expect(dialog).toHaveCount(0, ROUND_TRIP);
    await expect(toast(page, `Moved “${first}” to “${to}”.`)).toBeVisible(ROUND_TRIP);
    // It is where it went, and that folder was opened for it rather than hiding it.
    await expect(row(page, to)).toHaveAttribute("aria-expanded", "true");
    await expectOrder(row(page, to), [first]);
    await expect(row(page, first)).toBeVisible();
    expect(await childrenOf(row(page, from))).toEqual([second]);

    // Undo: back in the first folder, and first there — not last.
    await toast(page, `Moved “${first}” to “${to}”.`).getByRole("button", { name: "Undo" }).click();
    await expectOrder(row(page, from), [first, second]);
    expect(await childrenOf(row(page, to))).toEqual([]);
  });

  test("can be worked from the keyboard alone: arrow to a folder, Enter to move", async ({ page }) => {
    const workspaceId = await mySpace(page);
    const from = unique("Origin");
    const to = unique("Destination");
    const fromId = await apiFolder(page, workspaceId, from);
    await apiFolder(page, workspaceId, to);
    const title = unique("Keyed");
    await apiDocument(page, workspaceId, title, fromId);
    await openKnowledge(page, workspaceId);

    const dialog = await openMoveDialog(page, title, "document");
    // Top level is the first place to go; the folder it is in is skipped over, being where it is now.
    const topLevel = dialog.getByRole("radio", { name: "Top level" });
    await topLevel.press("ArrowDown");
    await expect(dialog.getByRole("radio", { name: from })).not.toBeChecked();
    // The folders are listed in the tree's order; keep going until the one wanted is chosen.
    const wanted = dialog.getByRole("radio", { name: to });
    const places = await dialog.getByRole("radio").count();
    for (let presses = 0; presses < places && !(await wanted.isChecked()); presses += 1) await page.keyboard.press("ArrowDown");
    await expect(wanted).toBeChecked();
    // Dialog autofocus can settle after the radio's checked state. Enter belongs to this
    // destination, rather than whichever control happens to have focus at that moment.
    await wanted.press("Enter");

    await expect(dialog).toHaveCount(0, ROUND_TRIP);
    await expect(toast(page, `Moved “${title}” to “${to}”.`)).toBeVisible(ROUND_TRIP);
    await expectOrder(row(page, to), [title]);
  });

  test("moves a folder with everything in it, and does not offer the folder itself or anything inside it", async ({ page }) => {
    const workspaceId = await mySpace(page);
    const moving = unique("Moving");
    const inner = unique("Inner");
    const other = unique("Other");
    const movingId = await apiFolder(page, workspaceId, moving);
    await apiFolder(page, workspaceId, inner, movingId);
    await apiFolder(page, workspaceId, other);
    const child = unique("Child");
    await apiDocument(page, workspaceId, child, movingId);
    await openKnowledge(page, workspaceId);

    const dialog = await openMoveDialog(page, moving, "folder");
    await expect(dialog.getByRole("radio", { name: other })).toBeVisible();
    // A folder cannot go into itself or into what it holds, so those are not there to choose.
    await expect(dialog.getByRole("radio", { name: moving })).toHaveCount(0);
    await expect(dialog.getByRole("radio", { name: inner })).toHaveCount(0);
    // It is at the top level now, and that is marked.
    await expect(dialog.getByRole("radio", { name: "Top level" })).toBeDisabled();
    await choose(dialog, other);
    await dialog.getByRole("button", { name: "Move", exact: true }).click();

    await expect(toast(page, `Moved “${moving}” to “${other}”.`)).toBeVisible(ROUND_TRIP);
    await expectOrder(row(page, other), [moving]);
    // Everything went with it.
    await expect(row(page, moving).getByRole("treeitem", { name: child, exact: true })).toBeVisible();
    await expect(row(page, moving).getByRole("treeitem", { name: inner, exact: true })).toBeVisible();
  });

  test("takes a document back to the top level", async ({ page }) => {
    const workspaceId = await mySpace(page);
    const folder = unique("Holder");
    const folderId = await apiFolder(page, workspaceId, folder);
    const title = unique("Leaving");
    await apiDocument(page, workspaceId, title, folderId);
    await openKnowledge(page, workspaceId);

    const dialog = await openMoveDialog(page, title, "document");
    await choose(dialog, "Top level");
    await dialog.getByRole("button", { name: "Move", exact: true }).click();
    await expect(toast(page, `Moved “${title}” to the top level.`)).toBeVisible(ROUND_TRIP);
    await expect.poll(() => childrenOf(row(page, folder)), ROUND_TRIP).toEqual([]);
    // Straight under the tree, not inside any folder.
    await expect(page.getByRole("tree", { name: "Knowledge tree" }).locator(":scope > li[role=treeitem]").filter({ has: page.locator(`[title="${title}"]`) })).toHaveCount(1);
  });

  test("is offered for the document being read, from the palette", async ({ page }) => {
    const workspaceId = await mySpace(page);
    const folder = unique("Palette target");
    await apiFolder(page, workspaceId, folder);
    const title = unique("Being read");
    const document = await apiDocument(page, workspaceId, title);
    await page.goto(`/w/${workspaceId}/knowledge/${document.sourceId}/${document.documentId}`);
    await expect(row(page, title)).toHaveAttribute("aria-current", "page", ROUND_TRIP);
    const readingUrl = page.url();

    await (await openPalette(page)).fill("move");
    await page.getByRole("option", { name: "Move document…" }).click();
    const dialog = page.getByRole("dialog", { name: "Move document" });
    await expect(dialog).toBeVisible();
    await choose(dialog, folder);
    await dialog.getByRole("button", { name: "Move", exact: true }).click();

    await expect(toast(page, `Moved “${title}” to “${folder}”.`)).toBeVisible(ROUND_TRIP);
    await expectOrder(row(page, folder), [title]);
    // Moving a document does not take the reader anywhere: the page they were on is still the page.
    expect(page.url()).toBe(readingUrl);
    await expect(row(page, title)).toHaveAttribute("aria-current", "page");
  });

  test("says why in words beside the list when the folder chosen is gone, and keeps the dialog open", async ({ page }) => {
    const workspaceId = await mySpace(page);
    const folder = unique("Vanishing");
    const folderId = await apiFolder(page, workspaceId, folder);
    const title = unique("Stranded");
    await apiDocument(page, workspaceId, title);
    await openKnowledge(page, workspaceId);

    const dialog = await openMoveDialog(page, title, "document");
    await choose(dialog, folder);
    // Archived from somewhere else after the list was made.
    expect((await page.request.post(`/api/tree-nodes/${folderId}/archive`)).status()).toBe(204);
    const accessChecks = await page.evaluate(() => {
      const counter = window as unknown as { __accessChecks: number };
      counter.__accessChecks = 0;
      window.addEventListener("kh:workspace-access-check", () => { counter.__accessChecks += 1; });
      return true;
    });
    expect(accessChecks).toBe(true);
    await dialog.getByRole("button", { name: "Move", exact: true }).click();

    await expect(dialog.getByRole("alert")).toHaveText("The destination folder no longer exists, or has been archived.", ROUND_TRIP);
    await expect(dialog).toBeVisible();
    // About the folder and not about the caller: no re-check of access, which would pause everything and say so.
    expect(await page.evaluate(() => (window as unknown as { __accessChecks: number }).__accessChecks)).toBe(0);
  });

  test("is not offered for a row in a source the Hub does not own", async ({ page }) => {
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/${OBSIDIAN_SOURCE}`);
    await expect(row(page, "Architecture")).toBeVisible(ROUND_TRIP);
    await page.waitForURL(/\/knowledge\/[^/]+\/[^/]+$/);
    // A Hub-managed document here may be moved; a source-managed one may not.
    await row(page, "Architecture").click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Move document…" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);

    const vault = page.getByRole("button", { name: "Vendor Compliance Vault", exact: true });
    if ((await vault.getAttribute("aria-expanded")) !== "true") await vault.click();
    await row(page, "Compliance Policy").click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Open document" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Move document…" })).toHaveCount(0);
  });
});

test.describe("Alt+↑ and Alt+↓", () => {
  async function folderOf(page: Page, titles: string[]) {
    const workspaceId = await mySpace(page);
    const folder = unique("Ordered");
    const folderId = await apiFolder(page, workspaceId, folder);
    const documents: Record<string, string> = {};
    for (const title of titles) documents[title] = (await apiDocument(page, workspaceId, title, folderId)).documentId;
    await openKnowledge(page, workspaceId);
    return { workspaceId, folder, documents };
  }

  test("move the focused row among its siblings, keep the focus on it, and say where it is now", async ({ page }) => {
    const [a, b, c] = [unique("Alpha"), unique("Bravo"), unique("Charlie")];
    const { folder } = await folderOf(page, [a, b, c]);
    const requests = countTreeRequests(page);
    expect(await childrenOf(row(page, folder))).toEqual([a, b, c]);

    await focusRow(row(page, b));
    await page.keyboard.press("Alt+ArrowUp");
    await expectOrder(row(page, folder), [b, a, c]);
    await expect(saidAloud(page, `Moved “${b}” up. Position 1 of 3.`)).toBeAttached();
    // The row that moved is the row that has the focus, though the list changed under it.
    await expect(row(page, b)).toBeFocused();

    // At the top there is nowhere further: it says so, and asks the server for nothing.
    const before = requests();
    await page.keyboard.press("Alt+ArrowUp");
    await expect(saidAloud(page, `“${b}” is already first.`)).toBeAttached();
    expect(requests()).toBe(before);

    await page.keyboard.press("Alt+ArrowDown");
    await expectOrder(row(page, folder), [a, b, c]);
    await expect(row(page, b)).toBeFocused();
    await page.keyboard.press("Alt+ArrowDown");
    await expectOrder(row(page, folder), [a, c, b]);
    await expect(saidAloud(page, `Moved “${b}” down. Position 3 of 3.`)).toBeAttached();
    await expect(row(page, b)).toBeFocused();
    await page.keyboard.press("Alt+ArrowDown");
    await expect(saidAloud(page, `“${b}” is already last.`)).toBeAttached();

    // It was kept: a reload draws the same order.
    await page.reload();
    await expectOrder(row(page, folder), [a, c, b]);
  });

  test("step over a sibling that is archived and out of sight", async ({ page }) => {
    const [a, hidden, c, d] = [unique("Alpha"), unique("Hidden"), unique("Charlie"), unique("Delta")];
    const { workspaceId, folder, documents } = await folderOf(page, [a, hidden, c, d]);
    expect((await page.request.post(`/api/documents/${documents[hidden]}/archive`)).status()).toBe(200);
    await page.goto(`/w/${workspaceId}/knowledge`);
    await expectOrder(row(page, folder), [a, c, d]);

    await focusRow(row(page, a));
    await page.keyboard.press("Alt+ArrowDown");
    await expectOrder(row(page, folder), [c, a, d]);
    await expect(row(page, a)).toBeFocused();
    await page.keyboard.press("Alt+ArrowDown");
    await expectOrder(row(page, folder), [c, d, a]);
    await expect(row(page, a)).toBeFocused();
    await page.keyboard.press("Alt+ArrowUp");
    await expectOrder(row(page, folder), [c, a, d]);
    await page.keyboard.press("Alt+ArrowUp");
    await expectOrder(row(page, folder), [a, c, d]);

    await page.reload();
    await expectOrder(row(page, folder), [a, c, d]);
  });

  test("keep a key pressed while the last step is still on its way, and make it when the tree arrives", async ({ page }) => {
    const [a, b, c, d] = [unique("Alpha"), unique("Bravo"), unique("Charlie"), unique("Delta")];
    const { folder } = await folderOf(page, [a, b, c, d]);
    await focusRow(row(page, b));
    // Down and then Up, in the same instant — so the second arrives while the first is still a request.
    // Made one after the other they are a step and its undoing; a second press dropped would leave the row a step down.
    await row(page, b).evaluate((element) => {
      for (const key of ["ArrowDown", "ArrowUp"]) element.dispatchEvent(new KeyboardEvent("keydown", { key, altKey: true, bubbles: true, cancelable: true }));
    });
    await expect(saidAloud(page, `Moved “${b}” up. Position 2 of 4.`)).toBeAttached(ROUND_TRIP);
    await expectOrder(row(page, folder), [a, b, c, d]);
    await expect(row(page, b)).toBeFocused();
    // Both went to the server, one after the other, each aimed at the tree as it was then.
    await page.reload();
    await expectOrder(row(page, folder), [a, b, c, d]);
  });

  test("leave the plain arrow keys alone: they still move the focus, and the server hears nothing", async ({ page }) => {
    const [a, b] = [unique("Alpha"), unique("Bravo")];
    const { folder } = await folderOf(page, [a, b]);
    const requests = countTreeRequests(page);
    await focusRow(row(page, a));
    await page.keyboard.press("ArrowDown");
    await expect(row(page, b)).toBeFocused();
    expect(requests()).toBe(0);
    expect(await childrenOf(row(page, folder))).toEqual([a, b]);
  });

  test("do nothing on a row the Hub does not own, and ask the server for nothing", async ({ page }) => {
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/${OBSIDIAN_SOURCE}`);
    await expect(row(page, "Architecture")).toBeVisible(ROUND_TRIP);
    await page.waitForURL(/\/knowledge\/[^/]+\/[^/]+$/);
    const vault = page.getByRole("button", { name: "Vendor Compliance Vault", exact: true });
    if ((await vault.getAttribute("aria-expanded")) !== "true") await vault.click();
    const requests = countTreeRequests(page);
    const managed = row(page, "Compliance Policy");
    const before = await managed.evaluate((element) => element.parentElement?.textContent);
    await focusRow(managed);
    await page.keyboard.press("Alt+ArrowDown");
    await page.keyboard.press("Alt+ArrowUp");
    await expect(managed).toBeFocused();
    expect(requests()).toBe(0);
    expect(await managed.evaluate((element) => element.parentElement?.textContent)).toBe(before);
  });

  test("say why they do nothing while the tree is filtered, where the neighbours are not the real ones", async ({ page }) => {
    const [a, b] = [unique("Alpha"), unique("Bravo")];
    const { folder } = await folderOf(page, [a, b]);
    const requests = countTreeRequests(page);
    await page.getByRole("button", { name: "Filter documents and sources" }).click();
    await page.getByPlaceholder("Filter documents and sources").fill(a);
    await expect(row(page, a)).toBeVisible();
    await focusRow(row(page, a));
    await page.keyboard.press("Alt+ArrowDown");
    await expect(saidAloud(page, "Clear the filter to reorder.")).toBeAttached();
    expect(requests()).toBe(0);
    // Cleared, the same key does what it says.
    await page.getByRole("button", { name: "Filter documents and sources" }).click();
    await focusRow(row(page, a));
    await page.keyboard.press("Alt+ArrowDown");
    await expectOrder(row(page, folder), [b, a]);
  });
});
