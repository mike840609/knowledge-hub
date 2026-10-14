import { expect, test } from "./fixtures/test";
import { mySpace } from "./fixtures/organize";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS.
const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const ROUND_TRIP = { timeout: 15_000 };

test.describe("one sidebar", () => {
  test("the tree is on a page that is not Knowledge, and opening a document from it keeps what was expanded", async ({ page }) => {
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/graph`);
    // Runbooks is a seeded document of Obsidian Wiki; the workspace has other sources (a seeded SOURCE_MANAGED one).
    const wiki = page.getByRole("region", { name: "Obsidian Wiki documents" });
    const tree = wiki.getByRole("tree", { name: "Knowledge tree" });
    await expect(tree).toBeVisible(ROUND_TRIP);
    const other = page.locator('section[aria-label$=" documents"]').filter({ hasNot: page.getByRole("button", { name: "Obsidian Wiki", exact: true }) }).first();
    const otherToggle = other.locator('button[aria-controls^="collection-"]');
    await expect(otherToggle).toBeVisible();
    const before = await otherToggle.getAttribute("aria-expanded");
    await tree.evaluate((element) => { element.setAttribute("data-probe", "mounted-on-graph"); });
    await tree.getByRole("treeitem", { name: "Runbooks", exact: true }).getByRole("link").first().click();
    await page.waitForURL(/\/knowledge\/[^/]+\/[^/]+/, ROUND_TRIP);
    await expect(tree.getByRole("treeitem", { name: "Runbooks", exact: true })).toHaveAttribute("aria-current", "page");
    // What was open stays open (and what was shut stays shut): going into Knowledge does not re-arrange the tree.
    await expect(otherToggle).toHaveAttribute("aria-expanded", before!);
    await expect(wiki.getByRole("button", { name: "Obsidian Wiki", exact: true })).toHaveAttribute("aria-expanded", "true");
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

  test("a narrow window records the documents opened, though the menu holding the tree is closed", async ({ page, request }) => {
    const personal = await mySpace(page);
    const stamp = Date.now();
    const make = async (title: string) => {
      const response = await request.post(`/api/workspaces/${personal}/documents`, { data: { title, markdown: `# ${title}\n\nBody` } });
      expect(response.ok()).toBe(true);
      const document = await response.json();
      return `/w/${personal}/knowledge/${document.sourceId}/${document.documentId}`;
    };
    const [titleA, titleB] = [`Recent A ${stamp}`, `Recent B ${stamp}`];
    const [hrefA, hrefB] = [await make(titleA), await make(titleB)];
    await page.setViewportSize({ width: 800, height: 900 });
    // Open A, then B, by URL: the menu is never opened until the end, so only a recorder outside it can know.
    await page.goto(hrefA);
    await expect(page.getByRole("heading", { level: 1, name: titleA })).toBeVisible(ROUND_TRIP);
    await page.goto(hrefB);
    await expect(page.getByRole("heading", { level: 1, name: titleB })).toBeVisible(ROUND_TRIP);
    await page.getByRole("button", { name: "Open menu" }).click();
    const menu = page.getByRole("dialog", { name: "Menu" });
    const recent = menu.getByRole("region", { name: "Recent documents" });
    await expect(recent).toBeVisible(ROUND_TRIP);
    await recent.getByRole("button", { name: "Recent" }).click();
    await expect(recent.getByRole("link", { name: titleA })).toBeVisible();
    // The one being read is not listed in its own Recent.
    await expect(recent.getByRole("link", { name: titleB })).toHaveCount(0);
  });

  test("the arrow keys resize it, a reload keeps the width, and a double-click resets it", async ({ page }) => {
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/graph`);
    const aside = page.getByRole("complementary", { name: "Navigation" });
    const handle = page.getByRole("separator", { name: "Resize navigation" });
    await expect(handle).toHaveAttribute("aria-valuenow", "256");
    await handle.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(handle).toHaveAttribute("aria-valuenow", "288");
    await page.reload();
    await expect(page.getByRole("separator", { name: "Resize navigation" })).toHaveAttribute("aria-valuenow", "288");
    await expect.poll(async () => (await aside.boundingBox())?.width ?? 0).toBe(288);
    await page.getByRole("separator", { name: "Resize navigation" }).dblclick();
    await expect(page.getByRole("separator", { name: "Resize navigation" })).toHaveAttribute("aria-valuenow", "256");
  });

  test("dragging stays inside 220–400", async ({ page }) => {
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/graph`);
    const handle = page.getByRole("separator", { name: "Resize navigation" });
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(900, box.y + 200, { steps: 5 });
    await page.mouse.up();
    await expect(handle).toHaveAttribute("aria-valuenow", "400");
    const after = (await handle.boundingBox())!;
    await page.mouse.move(after.x + after.width / 2, after.y + 200);
    await page.mouse.down();
    await page.mouse.move(10, after.y + 200, { steps: 5 });
    await page.mouse.up();
    await expect(handle).toHaveAttribute("aria-valuenow", "220");
  });

  test("collapsed, the left edge peeks it over the page; Esc hides it; ⌘\\ pins it", async ({ page }) => {
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/graph`);
    await page.getByRole("button", { name: "Collapse navigation" }).click();
    const aside = page.getByRole("complementary", { name: "Navigation" });
    await expect.poll(async () => (await aside.boundingBox())?.width ?? 0).toBe(0);
    const main = page.locator("main");
    const mainLeft = (await main.boundingBox())!.x;

    await page.mouse.move(400, 400);
    await page.mouse.move(2, 400);
    await expect(aside).toHaveAttribute("data-peeking", "");
    await expect(aside.getByRole("tree", { name: "Knowledge tree" }).first()).toBeVisible(ROUND_TRIP);
    expect((await main.boundingBox())!.x).toBe(mainLeft); // over the page, not pushing it

    await page.keyboard.press("Escape");
    await expect(aside).not.toHaveAttribute("data-peeking", "");

    await page.mouse.move(400, 400);
    await page.mouse.move(2, 400);
    await expect(aside).toHaveAttribute("data-peeking", "");
    await page.keyboard.press("ControlOrMeta+Backslash");
    await expect(page.getByRole("button", { name: "Collapse navigation" })).toBeAttached();
    await expect(aside).not.toHaveAttribute("data-peeking", "");
    await expect.poll(async () => (await aside.boundingBox())?.width ?? 0).toBe(256);
  });

  test("leaving the peeked sidebar hides it after a moment", async ({ page }) => {
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/graph`);
    await page.getByRole("button", { name: "Collapse navigation" }).click();
    const aside = page.getByRole("complementary", { name: "Navigation" });
    await page.mouse.move(400, 400);
    await page.mouse.move(2, 400);
    await expect(aside).toHaveAttribute("data-peeking", "");
    // The slide-in takes a moment; a pointer that moves in before it ends is still on the page.
    await expect.poll(async () => (await aside.boundingBox())?.width ?? 0).toBe(256);
    await page.mouse.move(100, 400);
    await page.mouse.move(800, 400);
    await expect(aside).not.toHaveAttribute("data-peeking", "", { timeout: 2_000 });
  });
});
