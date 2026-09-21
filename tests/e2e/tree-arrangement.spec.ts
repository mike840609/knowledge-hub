import { expect, test } from "@playwright/test";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS.
const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const OBSIDIAN_SOURCE = "0199f100-0000-7000-8000-000000000101";
const KNOWLEDGE = `/w/${QUERY_MASTER_WORKSPACE}/knowledge/${OBSIDIAN_SOURCE}`;

/**
 * §11: what the user has arranged is theirs to keep. All of this used to live
 * in component state, so a refresh put the sidebar back the way it shipped.
 */
test("a collapsed source stays collapsed across a reload", async ({ page }) => {
  await page.goto(KNOWLEDGE);
  const header = page.getByRole("button", { name: "Obsidian Wiki", exact: true });
  await expect(header).toHaveAttribute("aria-expanded", "true");

  await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "false");

  await page.reload();
  await expect(page.getByRole("button", { name: "Obsidian Wiki", exact: true }))
    .toHaveAttribute("aria-expanded", "false");
});

test("the tree filter survives a reload but not a new session", async ({ page, context }) => {
  await page.goto(KNOWLEDGE);
  await page.getByLabel("Filter documents and sources").click();
  const field = page.getByPlaceholder(/filter/i);
  await field.fill("run");
  const tree = page.getByRole("tree", { name: "Knowledge tree" });
  await expect(tree.getByRole("treeitem", { name: "Runbooks", exact: true })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: "Architecture", exact: true })).toHaveCount(0);

  await page.reload();
  await expect(page.getByPlaceholder(/filter/i)).toHaveValue("run");

  // A filter is work in progress, not an arrangement: a fresh session starts
  // clean rather than greeting the reader with last week's search.
  const fresh = await context.browser()!.newContext();
  const freshPage = await fresh.newPage();
  await freshPage.goto(`${page.url().split("/w/")[0]}${KNOWLEDGE}`);
  await expect(freshPage.getByRole("tree", { name: "Knowledge tree" })
    .getByRole("treeitem", { name: "Architecture", exact: true })).toBeVisible();
  await fresh.close();
});

test("the collapsed navigation rail stays collapsed across a reload", async ({ page }) => {
  await page.goto(KNOWLEDGE);
  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await expect(page.getByRole("button", { name: "Expand navigation" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Expand navigation" })).toBeVisible();
});

test("keeps working when storage is unavailable", async ({ page }) => {
  // Privacy modes and blocked third-party storage make these throw rather
  // than return null. The shell used to call getItem unguarded.
  await page.addInitScript(() => {
    const boom = () => { throw new Error("storage blocked"); };
    for (const name of ["localStorage", "sessionStorage"]) {
      Object.defineProperty(window, name, { configurable: true, get: boom });
    }
  });
  await page.goto(KNOWLEDGE);
  await expect(page.getByRole("tree", { name: "Knowledge tree" })).toBeVisible();

  const header = page.getByRole("button", { name: "Obsidian Wiki", exact: true });
  await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "false");
});
