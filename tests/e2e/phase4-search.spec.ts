import { expect, test } from "@playwright/test";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURES / BROWSER_FIXTURE_IDS.
const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const RESTRICTED_WORKSPACE = "0199f100-0000-7000-8000-000000000003";
const SEARCH_TITLE = "請假流程 SWFP Leave Policy";
const RESTRICTED_BODY_NEEDLE = "restricted-secret-body-9f31";

test("finds a mixed Chinese/English document and opens it", async ({ page }) => {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge`);
  await page.getByRole("button", { name: "Quick search" }).click();
  await page.getByRole("combobox", { name: "Search documents" }).fill("請假");

  const hit = page.getByRole("button", { name: new RegExp(SEARCH_TITLE) });
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(page.getByRole("heading", { name: SEARCH_TITLE })).toBeVisible();
});

test("never returns content from a workspace without membership", async ({ page }) => {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/search?q=${encodeURIComponent(RESTRICTED_BODY_NEEDLE)}&scope=all`);
  await expect(page.getByText("No results", { exact: false })).toBeVisible();
  await expect(page.getByText(RESTRICTED_BODY_NEEDLE)).toHaveCount(0);
});

test("returns 404 for a workspace the caller cannot access", async ({ page }) => {
  const response = await page.goto(`/w/${RESTRICTED_WORKSPACE}/search?q=anything`);
  expect(response?.status()).toBe(404);
});

test("shows an empty state when nothing matches", async ({ page }) => {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/search?q=zzzznomatchzzzz`);
  await expect(page.getByText("No results", { exact: false })).toBeVisible();
});

test("keeps archived mode on result links", async ({ page }) => {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/search?q=${encodeURIComponent("請假")}&archived=1`);
  const links = page.getByRole("link", { name: SEARCH_TITLE });
  await expect(links.first()).toHaveAttribute("href", /includeArchived=true/);
});

test("moves through results with the keyboard", async ({ page }) => {
  // "Query Master" appears in both the Architecture and Runbooks fixtures, so
  // there is more than one row to move between.
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/search?q=${encodeURIComponent("Query Master")}`);
  const results = page.locator("a[data-search-result]");
  expect(await results.count()).toBeGreaterThan(1);

  const query = page.locator("#search-q");
  await query.focus();

  // The field and the list behave as one control: down enters, up leaves.
  await page.keyboard.press("ArrowDown");
  await expect(results.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(results.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(results.first()).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(query).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await expect(results.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(results.first()).toBeFocused();
});

test("opens the focused result with Enter", async ({ page }) => {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/search?q=${encodeURIComponent("Query Master")}`);
  await page.locator("#search-q").focus();
  await page.keyboard.press("ArrowDown");
  const href = await page.locator("a[data-search-result]").first().getAttribute("href");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(href!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
