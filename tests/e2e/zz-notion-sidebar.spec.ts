import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { createFolder, header, mySpace, openKnowledge, unique } from "./fixtures/organize";
import { stageReadingFolder } from "./fixtures/folder-reading";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS.
const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const ROUND_TRIP = { timeout: 15_000 };

/** Every distinct x that `main` has over the next `ms`, a frame at a time: a page that jumps and comes back shows both. */
const mainXWithin = (page: Page, ms: number) => page.evaluate(async (window) => {
  const main = document.querySelector("main")!;
  const seen = new Set<number>();
  for (const end = performance.now() + window; performance.now() < end;) {
    seen.add(main.getBoundingClientRect().x);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  return [...seen];
}, ms);

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

  test("there is no Knowledge item; low-frequency destinations sit above the tree, outside its scroll", async ({ page }) => {
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/graph`);
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Knowledge", exact: true })).toHaveCount(0);
    const tree = page.getByRole("tree", { name: "Knowledge tree" }).first();
    await expect(tree).toBeVisible(ROUND_TRIP);
    const settings = page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Settings", exact: true });
    await expect(settings).toBeAttached();
    const [treeBox, settingsBox] = [await tree.boundingBox(), await settings.boundingBox()];
    expect(settingsBox!.y).toBeLessThan(treeBox!.y);
    expect(await settings.evaluate(el => el.closest("[data-sidebar-scroll]") === null)).toBe(true);
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

    await expect.poll(async () => (await aside.boundingBox())?.width ?? 0).toBe(256);
    const afterEsc = mainXWithin(page, 600); // the slide-out takes 160ms; the page must not move while it does
    await page.keyboard.press("Escape");
    await expect(aside).not.toHaveAttribute("data-peeking", "");
    expect(await afterEsc).toEqual([mainLeft]);
    await expect.poll(async () => (await aside.boundingBox())?.width ?? 0).toBe(0);

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
    const mainLeft = (await page.locator("main").boundingBox())!.x;
    const afterLeave = mainXWithin(page, 1_000); // the 300ms wait plus the slide-out
    await page.mouse.move(100, 400);
    await page.mouse.move(800, 400);
    await expect(aside).not.toHaveAttribute("data-peeking", "", { timeout: 2_000 });
    expect(await afterLeave).toEqual([mainLeft]);
  });

  test("a peek that outlived a menu opened from it hides once the menu is closed with the pointer elsewhere", async ({ page }) => {
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/graph`);
    await page.getByRole("button", { name: "Collapse navigation" }).click();
    const aside = page.getByRole("complementary", { name: "Navigation" });
    await page.mouse.move(400, 400);
    await page.mouse.move(2, 400);
    await expect(aside).toHaveAttribute("data-peeking", "");
    await expect.poll(async () => (await aside.boundingBox())?.width ?? 0).toBe(256);
    const trigger = aside.getByRole("button", { name: /^Actions for / }).first();
    await expect(trigger).toBeVisible(ROUND_TRIP);
    await trigger.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await page.mouse.move(800, 400);
    // A negative claim needs a window: the leave timer fires (300ms) while the menu is open, twice over.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 800)));
    await expect(aside).toHaveAttribute("data-peeking", "");
    // Esc closes the menu, the layer on top, and leaves the peek to the leave timer; no pointer event
    // reaches the sidebar to start that over.
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(aside).not.toHaveAttribute("data-peeking", "", { timeout: 2_000 });
  });

  test("a folder's + makes a document inside it", async ({ page }) => {
    const workspaceId = await mySpace(page);
    await openKnowledge(page, workspaceId);
    const name = unique("Plus");
    await createFolder(page, name);
    await header(page, name).hover();
    await page.getByRole("button", { name: `New in ${name}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "New document here" }).click();
    await page.waitForURL(/\/knowledge\/new\?folder=/, ROUND_TRIP);
    // The form names the folder it will write into; the sidebar's own row for it is outside `main`.
    await expect(page.locator("main").getByText(name).first()).toBeVisible(ROUND_TRIP);
  });

  test("a folder imported while the sidebar is open appears in it without a reload", async ({ page, request }) => {
    const workspaceId = await mySpace(page);
    const sourceName = unique("Imported");
    // A workspace with nothing in it has no explorer; a note gives the sidebar a tree to be stale.
    expect((await request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title: unique("Seed"), markdown: "seed" } })).ok()).toBe(true);
    const snapshotId = await stageReadingFolder(request, { workspaceId, sourceName, fixture: "reading-flow-v1" });
    // The workspace layout renders here, once; everything after is client navigation inside /w/:id.
    await page.goto(`/w/${workspaceId}/sources/imports/${snapshotId}`);
    const nav = page.getByRole("complementary", { name: "Navigation" });
    await expect(nav.getByRole("region", { name: "Notes documents", exact: true })).toBeVisible(ROUND_TRIP);
    await expect(nav.getByRole("region", { name: `${sourceName} documents`, exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Apply changes" }).click();
    await page.waitForURL(/\/sources\/[^/]+\/runs\/[0-9a-f-]+$/, ROUND_TRIP);
    await expect(nav.getByRole("region", { name: `${sourceName} documents`, exact: true })).toBeVisible(ROUND_TRIP);
  });

  test("section controls are there on hover and on focus, not at rest", async ({ page }) => {
    const workspaceId = await mySpace(page);
    await openKnowledge(page, workspaceId);
    const explorer = page.getByRole("complementary", { name: "Knowledge explorer" });
    const heading = explorer.getByRole("heading", { name: "Documents" });
    // The fade is on the group of controls beside the heading, not on the button: opacity is not inherited.
    const controls = heading.locator("xpath=following-sibling::div");
    const filter = controls.getByRole("button", { name: "Filter documents and sources" });
    await page.mouse.move(900, 400);
    await expect(controls).toHaveCSS("opacity", "0");
    await heading.hover();
    await expect(controls).toHaveCSS("opacity", "1");
    await page.mouse.move(900, 400);
    await filter.focus();
    await expect(controls).toHaveCSS("opacity", "1");
  });
});
