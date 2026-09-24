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
  await expect(list.getByRole("option", { name: /Add to Notes/ }).locator("kbd")).toHaveText("C");
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
