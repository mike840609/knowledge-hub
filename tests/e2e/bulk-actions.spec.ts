import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

const ROUND_TRIP = { timeout: 15_000 };

function unique(label: string) {
  return `${label}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function createNote(page: Page, workspaceId: string, title: string) {
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown: "Some words." } });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { documentId: string; sourceId: string };
}

/**
 * The explorer's multi-select: a checkbox on a document row, shift-click for a
 * range, and one bar for what may be done to all of them. The bar's actions are
 * the row registry's, so what is disabled here is disabled for the same reason.
 */
test("two selected documents can be favorited together and cleared with Escape", async ({ page }) => {
  const workspaceId = await mySpace(page);
  const first = unique("Bulk favorite A");
  const second = unique("Bulk favorite B");
  const firstNote = await createNote(page, workspaceId, first);
  await createNote(page, workspaceId, second);

  await page.goto(`/w/${workspaceId}/knowledge/${firstNote.sourceId}`);
  await expect(page.getByRole("treeitem", { name: first, exact: true })).toBeVisible(ROUND_TRIP);
  await expect(page.getByRole("treeitem", { name: second, exact: true })).toBeVisible(ROUND_TRIP);

  await page.getByRole("button", { name: `Select ${first}`, exact: true }).click();
  await page.getByRole("button", { name: `Select ${second}`, exact: true }).click();
  const bar = page.getByRole("toolbar", { name: "Selected documents" });
  await expect(bar).toContainText("2 selected");

  await bar.getByRole("button", { name: "Add selected to favorites" }).click();
  const tree = page.getByRole("tree", { name: "Knowledge tree" });
  await expect(tree.getByRole("button", { name: `Remove from favorites: ${first}`, exact: true })).toBeVisible(ROUND_TRIP);
  await expect(tree.getByRole("button", { name: `Remove from favorites: ${second}`, exact: true })).toBeVisible(ROUND_TRIP);

  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
});

test("archiving two documents is one action, and Undo restores both", async ({ page }) => {  const workspaceId = await mySpace(page);
  const first = unique("Bulk archive A");
  const second = unique("Bulk archive B");
  const firstNote = await createNote(page, workspaceId, first);
  await createNote(page, workspaceId, second);

  await page.goto(`/w/${workspaceId}/knowledge/${firstNote.sourceId}`);
  await expect(page.getByRole("treeitem", { name: first, exact: true })).toBeVisible(ROUND_TRIP);
  await expect(page.getByRole("treeitem", { name: second, exact: true })).toBeVisible(ROUND_TRIP);

  await page.getByRole("button", { name: `Select ${first}`, exact: true }).click();
  await page.getByRole("button", { name: `Select ${second}`, exact: true }).click();
  await page.getByRole("button", { name: "Archive selected documents" }).click();
  await expect(page.getByText("Archived 2 documents.")).toBeVisible(ROUND_TRIP);
  await expect(page.getByRole("treeitem", { name: first, exact: true })).toHaveCount(0, ROUND_TRIP);
  await expect(page.getByRole("treeitem", { name: second, exact: true })).toHaveCount(0, ROUND_TRIP);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("treeitem", { name: first, exact: true })).toBeVisible(ROUND_TRIP);
  await expect(page.getByRole("treeitem", { name: second, exact: true })).toBeVisible(ROUND_TRIP);
});

test("moving two documents asks for one destination and moves both", async ({ page }) => {
  const workspaceId = await mySpace(page);
  const destination = unique("Bulk destination");
  const folderResponse = await page.request.post(`/api/workspaces/${workspaceId}/folders`, { data: { name: destination } });
  expect(folderResponse.status()).toBe(201);

  const first = unique("Bulk move A");
  const second = unique("Bulk move B");
  const firstNote = await createNote(page, workspaceId, first);
  await createNote(page, workspaceId, second);

  await page.goto(`/w/${workspaceId}/knowledge/${firstNote.sourceId}`);
  await expect(page.getByRole("treeitem", { name: first, exact: true })).toBeVisible(ROUND_TRIP);
  await page.getByRole("button", { name: `Select ${first}`, exact: true }).click();
  await page.getByRole("button", { name: `Select ${second}`, exact: true }).click();
  await page.getByRole("button", { name: "Move selected documents" }).click();

  const dialog = page.getByRole("dialog", { name: "Move documents" });
  await expect(dialog).toBeVisible();
  await dialog.getByText(destination, { exact: true }).click();
  await dialog.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByText(`Moved 2 documents to “${destination}”.`)).toBeVisible(ROUND_TRIP);
  // Not just still visible somewhere: both rows are now inside the destination folder.
  const folder = page.getByRole("treeitem", { name: destination, exact: true });
  await expect(folder.getByRole("treeitem", { name: first, exact: true })).toBeVisible(ROUND_TRIP);
  await expect(folder.getByRole("treeitem", { name: second, exact: true })).toBeVisible(ROUND_TRIP);
});

test("a partial archive says how many landed and still offers Undo", async ({ page }) => {
  const workspaceId = await mySpace(page);
  const first = unique("Partial archive A");
  const second = unique("Partial archive B");
  const firstNote = await createNote(page, workspaceId, first);
  await createNote(page, workspaceId, second);

  await page.goto(`/w/${workspaceId}/knowledge/${firstNote.sourceId}`);
  await expect(page.getByRole("treeitem", { name: first, exact: true })).toBeVisible(ROUND_TRIP);

  let failed = false;
  await page.route("**/api/documents/*/archive", async (route) => {
    if (!failed) {
      failed = true;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "INTERNAL", message: "Refused for this test." }) });
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: `Select ${first}`, exact: true }).click();
  await page.getByRole("button", { name: `Select ${second}`, exact: true }).click();
  await page.getByRole("button", { name: "Archive selected documents" }).click();
  await expect(page.getByText(/Archived 1 of 2 documents; 1 could not be archived\./)).toBeVisible(ROUND_TRIP);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("treeitem", { name: first, exact: true })).toBeVisible(ROUND_TRIP);
  await expect(page.getByRole("treeitem", { name: second, exact: true })).toBeVisible(ROUND_TRIP);
});
