import { expect, test, type Locator, type Page } from "./fixtures/test";
import { ROUND_TRIP, mySpace, openKnowledge, row, unique } from "./fixtures/organize";
import { openPalette } from "./fixtures/palette";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS: a workspace with a SOURCE_MANAGED source in it, read here and never changed.
const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const OBSIDIAN_SOURCE = "0199f100-0000-7000-8000-000000000101";

/**
 * Row keys (row-keyboard-actions spec): the key goes to the row in focus, not the document being read.
 * Works in the E2E user's own My Space with documents and folders made through the API, and sorts last for
 * the reason zz-organize.spec.ts gives. The read-only case uses the seeded workspace, read and never changed.
 */

async function apiDocument(page: Page, workspaceId: string, title: string) {
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown: `Body of ${title}.` } });
  expect(response.status()).toBe(201);
  return (await response.json()) as { documentId: string; sourceId: string };
}

async function apiFolder(page: Page, workspaceId: string, name: string) {
  const response = await page.request.post(`/api/workspaces/${workspaceId}/folders`, { data: { name } });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { treeNodeId: string }).treeNodeId;
}

/**
 * A key pressed before hydration reaches no listener. `j` is harmless to repeat, so press it until the focus
 * leaves `from` (where it goes depends on the order the tree draws, which is not the point), then put it back.
 * `from` needs a row after it, or `j` has nowhere to go.
 */
async function armTree(page: Page, from: Locator) {
  await from.focus();
  await expect(async () => {
    await page.keyboard.press("j");
    await expect(from).not.toBeFocused({ timeout: 1_000 });
  }).toPass(ROUND_TRIP);
  await from.focus();
}

/** A tree to act on: the seed document being read, and two more documents and a folder beside it. */
async function setUp(page: Page) {
  const workspaceId = await mySpace(page);
  const a = unique("Row A");
  const b = unique("Row B");
  const folder = unique("Row F");
  const docA = await apiDocument(page, workspaceId, a);
  await apiDocument(page, workspaceId, b);
  const folderId = await apiFolder(page, workspaceId, folder);
  await openKnowledge(page, workspaceId);
  // openKnowledge already loads the current tree; armTree verifies keyboard listeners before use.
  await expect(row(page, a)).toBeVisible(ROUND_TRIP);
  // The document being read is not `a`, so a key that reaches `a` can only have come from the tree's claim.
  expect(page.url()).not.toContain(docA.documentId);
  return { workspaceId, a, b, folder, folderId, docA };
}

test("j and k move the focus like the arrows, and Alt+j does not", async ({ page }) => {
  const { a } = await setUp(page);
  await armTree(page, row(page, a)); // leaves the focus on `a`, having proved that j moves it
  await page.keyboard.press("j");
  await expect(row(page, a)).not.toBeFocused();
  await page.keyboard.press("k");
  await expect(row(page, a)).toBeFocused();
  await page.keyboard.press("Alt+j");
  await expect(row(page, a)).toBeFocused();
});

test("E edits the row in focus, not the document being read", async ({ page }) => {
  const { a, docA } = await setUp(page);
  const reading = page.url();
  await armTree(page, row(page, a));
  await page.keyboard.press("e");
  await expect(page).toHaveURL(new RegExp(`/knowledge/${docA.sourceId}/${docA.documentId}/edit$`), ROUND_TRIP);
  expect(page.url()).not.toBe(reading);
});

test("F favourites the row in focus, and the menu then offers the way back", async ({ page }) => {
  const { a } = await setUp(page);
  await armTree(page, row(page, a));
  await page.keyboard.press("f");
  await expect(page.getByRole("region", { name: "Favorites" }).getByRole("link", { name: new RegExp(a) })).toBeVisible(ROUND_TRIP);
  await row(page, a).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Remove from favorites" })).toBeVisible();
});

test("M opens Move for the row in focus, and closing it puts the focus back on that row", async ({ page }) => {
  const { b } = await setUp(page);
  await armTree(page, row(page, b));
  await page.keyboard.press("m");
  const dialog = page.getByRole("dialog", { name: "Move document" });
  await expect(dialog).toBeVisible(ROUND_TRIP);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(row(page, b)).toBeFocused();
});

test("R renames the folder in focus", async ({ page }) => {
  const { a, folder } = await setUp(page);
  await armTree(page, row(page, a));
  await row(page, folder).focus();
  await page.keyboard.press("r");
  await expect(page.getByRole("dialog", { name: "Rename folder" })).toBeVisible(ROUND_TRIP);
});

test("C on a folder starts a document inside it, and on a document it is still Create document", async ({ page }) => {
  const { a, folder, folderId } = await setUp(page);
  await armTree(page, row(page, a));
  await row(page, folder).focus();
  await page.keyboard.press("c");
  await expect(page).toHaveURL(new RegExp(`/knowledge/new\\?folder=${folderId}$`), ROUND_TRIP);

  await page.goBack();
  await armTree(page, row(page, a));
  await page.keyboard.press("c");
  await expect(page).toHaveURL(/\/knowledge\/new$/, ROUND_TRIP);
});

test("E and F on a focused folder do nothing, and do not reach the document being read", async ({ page }) => {
  const { a, folder } = await setUp(page);
  const reading = await page.getByRole("region", { name: "Document content" }).getByRole("heading").first().innerText();
  const before = page.url();
  await armTree(page, row(page, a));
  await row(page, folder).focus();
  await page.keyboard.press("f");
  await page.keyboard.press("e");
  await expectUntouched(page, reading, before, 0);
  await expect(row(page, folder)).toBeFocused();
});

test("with no row in focus, F favourites the document being read", async ({ page }) => {
  const { a, docA, workspaceId } = await setUp(page);
  await page.goto(`/w/${workspaceId}/knowledge/${docA.sourceId}/${docA.documentId}`);
  await expect(page.getByRole("heading", { name: a })).toBeVisible(ROUND_TRIP);
  await page.getByRole("heading", { name: a }).click();
  // Not a tree key: wait for the page to answer a key at all, then press the one that is not idempotent once.
  await openPalette(page, { settled: false });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("heading", { name: a }).click();
  await page.keyboard.press("f");
  await expect(page.getByRole("region", { name: "Favorites" }).getByRole("link", { name: new RegExp(a) })).toBeVisible(ROUND_TRIP);
});

test("a letter typed into the tree's filter stays in the filter", async ({ page }) => {
  await setUp(page);
  const before = page.url();
  await page.getByRole("button", { name: "Filter documents and sources" }).click();
  const filter = page.locator("#tree-filter");
  await filter.focus();
  await page.keyboard.type("efmrcjk");
  await expect(filter).toHaveValue("efmrcjk");
  expect(page.url()).toBe(before);
});

test("E on a read-only row does nothing, and does not edit the document being read", async ({ page }) => {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/${OBSIDIAN_SOURCE}`);
  await expect(row(page, "Architecture")).toBeVisible(ROUND_TRIP);
  await page.waitForURL(/\/knowledge\/[^/]+\/[^/]+$/);
  // The document being read is editable (Architecture): until it has rendered there is no Edit for the page's E to run.
  await expect(page.getByRole("heading", { name: "Architecture" })).toBeVisible(ROUND_TRIP);
  await page.getByRole("button", { name: "Vendor Compliance Vault", exact: true }).click();
  const policy = row(page, "Compliance Policy");
  await expect(policy).toBeVisible(ROUND_TRIP);
  await openPalette(page, { settled: false });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const here = page.url();
  await policy.focus();
  await page.keyboard.press("e");
  await page.waitForTimeout(300);
  expect(page.url()).toBe(here);
});

const RULE = "---";

/** The menu top to bottom: each item's label (not its key hint), and a rule where a separator is drawn. */
async function menuShape(menu: Locator) {
  return menu.locator('[role="menuitem"], [role="separator"]').evaluateAll((nodes) =>
    nodes.map((node) => (node.getAttribute("role") === "separator" ? "---" : (node.querySelector("span.truncate")?.textContent ?? "").trim())),
  );
}

/** Never leading, trailing or doubled. */
function expectRulesOnlyBetweenItems(shape: readonly string[]) {
  expect(shape[0]).not.toBe(RULE);
  expect(shape.at(-1)).not.toBe(RULE);
  for (let i = 1; i < shape.length; i += 1) expect(shape[i] === RULE && shape[i - 1] === RULE).toBe(false);
}

test("the row menu shows each action's key, without truncating its label, and nothing for what is not offered", async ({ page }) => {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/${OBSIDIAN_SOURCE}`);
  await expect(row(page, "Runbooks")).toBeVisible(ROUND_TRIP);
  await page.waitForURL(/\/knowledge\/[^/]+\/[^/]+$/);

  await row(page, "Runbooks").click({ button: "right" });
  const menu = page.getByRole("menu");
  // The key is announced by aria-keyshortcuts, so the visible hint must stay out of the accessible name.
  for (const name of ["Edit document", "Add to favorites", "Move document…"]) {
    await expect(menu.getByRole("menuitem", { name, exact: true })).toBeVisible();
  }
  await expect(menu.getByRole("menuitem", { name: /Edit document/ }).locator("kbd")).toHaveText("E");
  await expect(menu.getByRole("menuitem", { name: /Add to favorites/ }).locator("kbd")).toHaveText("F");
  await expect(menu.getByRole("menuitem", { name: /Move document/ }).locator("kbd")).toHaveText("M");
  // Grouped by what the reader is doing (open, change, export, remove), one rule between each pair of sections.
  const shape = await menuShape(menu);
  expect(shape).toEqual(["Open in new tab", "Copy link", RULE, "Edit document", "Add to favorites", "Move document…", RULE, "Download Markdown", RULE, "Archive document"]);
  expectRulesOnlyBetweenItems(shape);
  expect(await menu.getByRole("separator").count()).toBe(3);
  const labels = menu.getByRole("menuitem").locator("span.truncate");
  expect(await labels.count()).toBeGreaterThan(0);
  expect(await labels.count()).toBe(await menu.getByRole("menuitem").count());
  const truncated = await labels.evaluateAll((spans) => spans.filter((span) => span.scrollWidth > span.clientWidth).length);
  expect(truncated).toBe(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);

  await page.getByRole("button", { name: "Vendor Compliance Vault", exact: true }).click();
  await row(page, "Compliance Policy").click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible(ROUND_TRIP);
  await expect(page.getByRole("menuitem", { name: /Open in new tab/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Edit document/ })).toHaveCount(0);
  for (const gone of ["Move document…", "Archive document"]) await expect(page.getByRole("menuitem", { name: gone })).toHaveCount(0);
  // Only what is offered is drawn, and a rule only between two sections that both have something in them.
  const readOnlyShape = await menuShape(page.getByRole("menu"));
  expect(readOnlyShape).toEqual(["Open in new tab", "Copy link", RULE, "Add to favorites", RULE, "Download Markdown"]);
  expectRulesOnlyBetweenItems(readOnlyShape);
});

test("a folder row's menu is its actions, a rule, then Archive alone", async ({ page }) => {
  const { folder } = await setUp(page);
  await row(page, folder).click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible(ROUND_TRIP);
  const shape = await menuShape(page.getByRole("menu"));
  expect(shape).toEqual(["New document here", "New folder here", "Rename folder", "Move folder…", RULE, "Archive folder"]);
  expectRulesOnlyBetweenItems(shape);
});

test("right-clicking a row makes it the row the keys act on once the menu closes", async ({ page }) => {
  const { a, b } = await setUp(page);
  await armTree(page, row(page, a));
  await row(page, b).click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.keyboard.press("f");
  const favorites = page.getByRole("region", { name: "Favorites" });
  await expect(favorites.getByRole("link", { name: new RegExp(b) })).toBeVisible(ROUND_TRIP);
  await expect(favorites.getByRole("link", { name: new RegExp(a) })).toHaveCount(0);
});

/** What a row key would have done to the page: left it, opened another dialog, or favourited the row. */
async function expectUntouched(page: Page, title: string, before: string, dialogs: number) {
  await page.waitForTimeout(300); // bounded settle: a leaked key navigates or opens something within a tick
  expect(page.url()).toBe(before);
  await expect(page.getByRole("dialog")).toHaveCount(dialogs);
  await expect(page.getByRole("region", { name: "Favorites" }).getByRole("link", { name: new RegExp(title) })).toHaveCount(0);
}

test("row keys pressed while the row menu is open do not act", async ({ page }) => {
  const { a } = await setUp(page);
  await armTree(page, row(page, a));
  const before = page.url();
  await row(page, a).click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible(ROUND_TRIP);
  for (const key of ["e", "f", "m", "r", "c"]) await page.keyboard.press(key);
  await expectUntouched(page, a, before, 0);
});

test("row keys pressed while the Move dialog is open do not act", async ({ page }) => {
  const { a } = await setUp(page);
  await armTree(page, row(page, a));
  const before = page.url();
  await page.keyboard.press("m");
  await expect(page.getByRole("dialog", { name: "Move document" })).toBeVisible(ROUND_TRIP);
  for (const key of ["f", "e", "c"]) await page.keyboard.press(key);
  await expectUntouched(page, a, before, 1);
  await expect(page.getByRole("dialog", { name: "Move document" })).toBeVisible();
});

test("row keys typed into the palette stay in the palette", async ({ page }) => {
  const { a } = await setUp(page);
  await armTree(page, row(page, a));
  const before = page.url();
  const field = await openPalette(page, { settled: false });
  // `c` is the one the page always answers (Create document); E, F and M need a document being read.
  for (const key of ["e", "f", "m", "c"]) await page.keyboard.press(key);
  await expect(field).toHaveValue("efmc");
  await expectUntouched(page, a, before, 1);
});
