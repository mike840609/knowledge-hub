import { expect, test, type Page } from "@playwright/test";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS.
const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const EMPTY_WORKSPACE = "0199f100-0000-7000-8000-000000000004";
const OBSIDIAN_SOURCE = "0199f100-0000-7000-8000-000000000101";
const SOURCE_MANAGED_SOURCE = "0199f100-0000-7000-8000-000000000105";
const SOURCE_MANAGED_DOCUMENT = "0199f100-0000-7000-8000-000000000210";
const ROUND_TRIP = { timeout: 15_000 };

/**
 * A key pressed before hydration reaches no listener. Press, and retry until
 * the page answers, rather than guessing how long hydration takes.
 */
async function pressUntil(page: Page, key: string, answered: () => Promise<void>) {
  await expect(async () => {
    await page.keyboard.press(key);
    await answered();
  }).toPass(ROUND_TRIP);
}

/** `/knowledge/:sourceId` redirects to a document; act once it has landed. */
async function openArchitecture(page: Page) {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/${OBSIDIAN_SOURCE}`);
  await page.getByRole("treeitem", { name: "Architecture", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Architecture" })).toBeVisible(ROUND_TRIP);
}

test("/ opens the palette without typing the slash, and the palette shows shortcuts", async ({ page }) => {
  await openArchitecture(page);
  const field = page.getByRole("combobox", { name: "Search documents and actions" });
  await pressUntil(page, "/", () => expect(field).toBeVisible({ timeout: 1_000 }));
  await expect(field).toHaveValue("");

  const list = page.getByRole("listbox", { name: "Actions and documents" });
  await expect(list.getByRole("option", { name: /Create document/ }).locator("kbd")).toHaveText("C");
  await expect(list.getByRole("option", { name: /Edit document/ }).locator("kbd")).toHaveText("E");
});

test("C opens a new note", async ({ page }) => {
  await openArchitecture(page);
  await pressUntil(page, "c", () => expect(page).toHaveURL(/\/knowledge\/new$/, { timeout: 1_000 }));
});

test("a letter typed into a field stays in the field", async ({ page }) => {
  await openArchitecture(page);
  const before = page.url();
  await page.getByRole("button", { name: "Filter documents and sources" }).click();
  const filter = page.locator("#tree-filter");
  await filter.focus();
  await page.keyboard.press("c");
  await expect(filter).toHaveValue("c");
  expect(page.url()).toBe(before);
});

test("E edits the document being read", async ({ page }) => {
  await openArchitecture(page);
  await pressUntil(page, "e", () => expect(page).toHaveURL(/\/edit$/, { timeout: 1_000 }));
});

test("E does nothing on source-managed content", async ({ page }) => {
  const url = `/w/${QUERY_MASTER_WORKSPACE}/knowledge/${SOURCE_MANAGED_SOURCE}/${SOURCE_MANAGED_DOCUMENT}`;
  await page.goto(url);
  // Prove the shortcuts are live on this page before asserting that E is not.
  const field = page.getByRole("combobox", { name: "Search documents and actions" });
  await pressUntil(page, "/", () => expect(field).toBeVisible({ timeout: 1_000 }));
  await page.keyboard.press("Escape");
  await expect(field).toHaveCount(0);

  await page.keyboard.press("e");
  await page.waitForTimeout(500);
  expect(new URL(page.url()).pathname).toBe(url);
});

/** A note of our own, so saving it cannot disturb another test's fixture. */
async function editOwnNote(page: Page, title: string) {
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge/new`);
  const field = page.getByLabel("Document title");
  await expect(field).toBeEditable(ROUND_TRIP);
  await field.fill(title);
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible(ROUND_TRIP);
  await pressUntil(page, "e", () => expect(page).toHaveURL(/\/edit$/, { timeout: 1_000 }));
  // main form + first(): the duplicate-DOM quirk phase5-authoring documents.
  const titleField = page.locator("main form").first().getByLabel("Title", { exact: true });
  await expect(titleField).toBeEditable(ROUND_TRIP);
  return titleField;
}

test("⌘Enter saves from inside the editor", async ({ page }) => {
  const titleField = await editOwnNote(page, "Shortcut Save Note");
  await titleField.fill("Saved By Keyboard");
  await titleField.press("ControlOrMeta+Enter");
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
  await expect(page.getByRole("heading", { name: "Saved By Keyboard" })).toBeVisible(ROUND_TRIP);
});

test("Esc leaves an unchanged editor", async ({ page }) => {
  const titleField = await editOwnNote(page, "Shortcut Esc Clean Note");
  await titleField.press("Escape");
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
  await expect(page.getByRole("heading", { name: "Shortcut Esc Clean Note" })).toBeVisible(ROUND_TRIP);
});

test("Esc never discards a changed draft", async ({ page }) => {
  const titleField = await editOwnNote(page, "Shortcut Esc Dirty Note");
  await titleField.fill("Unsaved change");
  await titleField.press("Escape");
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/edit$/);
  await expect(titleField).toHaveValue("Unsaved change");
});
