import { expect, test } from "./fixtures/test";
import { mySpace } from "./fixtures/organize";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS.
const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const ROUND_TRIP = { timeout: 15_000 };

test.describe("one sidebar", () => {
  test("the tree is on a page that is not Knowledge, and opening a document from it keeps the tree mounted", async ({ page }) => {
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/graph`);
    // Runbooks is a seeded document of Obsidian Wiki; the workspace has other sources, so scope to this one.
    const tree = page.getByRole("region", { name: "Obsidian Wiki documents" }).getByRole("tree", { name: "Knowledge tree" });
    await expect(tree).toBeVisible(ROUND_TRIP);
    await tree.evaluate((element) => { element.setAttribute("data-probe", "mounted-on-graph"); });
    await tree.getByRole("treeitem", { name: "Runbooks", exact: true }).getByRole("link").first().click();
    await page.waitForURL(/\/knowledge\/[^/]+\/[^/]+/, ROUND_TRIP);
    await expect(tree.getByRole("treeitem", { name: "Runbooks", exact: true })).toHaveAttribute("aria-current", "page");
    // The sidebar belongs to the workspace layout: the same tree element, not a new one with the same rows.
    await expect(tree).toHaveAttribute("data-probe", "mounted-on-graph");
  });

  test("there is no Knowledge item; low-frequency destinations follow the tree", async ({ page }) => {
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/graph`);
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Knowledge", exact: true })).toHaveCount(0);
    const tree = page.getByRole("tree", { name: "Knowledge tree" }).first();
    await expect(tree).toBeVisible(ROUND_TRIP);
    const settings = page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Settings", exact: true });
    await expect(settings).toBeAttached();
    const [treeBox, settingsBox] = [await tree.boundingBox(), await settings.boundingBox()];
    expect(settingsBox!.y).toBeGreaterThan(treeBox!.y);
  });

  test("a team workspace shows no Home, Shares or Insights; My Space does", async ({ page }) => {
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/graph`);
    const nav = page.getByRole("complementary", { name: "Navigation" });
    for (const name of ["Home", "Shares", "Insights"]) await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(0);
    const personal = await mySpace(page);
    await page.goto(`/w/${personal}/home`);
    for (const name of ["Home", "Shares", "Insights"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible(ROUND_TRIP);
  });

  test("collapsed, the sidebar takes no width, and the choice survives a reload", async ({ page }) => {
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/graph`);
    await page.getByRole("button", { name: "Collapse navigation" }).click();
    const aside = page.getByRole("complementary", { name: "Navigation" });
    await expect.poll(async () => (await aside.boundingBox())?.width ?? 0).toBe(0);
    await page.reload();
    await expect(page.getByRole("button", { name: "Expand navigation" })).toBeVisible();
    await page.getByRole("button", { name: "Expand navigation" }).click();
    await expect.poll(async () => (await aside.boundingBox())?.width ?? 0).toBe(256);
  });

  test("a narrow window's menu holds the tree", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/graph`);
    await page.getByRole("button", { name: "Open menu" }).click();
    const menuTrees = page.getByRole("dialog", { name: "Menu" }).getByRole("tree", { name: "Knowledge tree" });
    await expect(menuTrees.first()).toBeVisible(ROUND_TRIP);
    // One sidebar, in the menu only: every tree on the page is one of the menu's.
    await expect(page.getByRole("complementary", { name: "Navigation" })).toHaveCount(0);
    await expect(page.getByRole("tree", { name: "Knowledge tree" })).toHaveCount(await menuTrees.count());
  });
});
