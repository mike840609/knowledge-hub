import { expect, test as base } from "./fixtures/test";
import { personalWorkspaceId } from "./fixtures/my-space";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument } from "./fixtures/document-review";
import { projectReviewBlocks } from "../../src/modules/knowledge/domain/review-anchor";
import { openKnowledgeDestinations } from "./fixtures/knowledge-destinations";

const ROUND_TRIP = { timeout: 15_000 };

testDestinations();

function testDestinations() {
  base("the page switch names only the current page and leaves the explorer its own heading", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const workspace = `/w/${await personalWorkspaceId(page)}`;
    await page.goto(`${workspace}/home`);
    const primary = page.getByRole("navigation", { name: "Primary", exact: true });
    const graph = primary.getByRole("link", { name: "Graph", exact: true });
    const home = primary.getByRole("link", { name: "Home", exact: true });
    await expect(home).toHaveAttribute("aria-current", "page");
    await expect(home).toHaveText("Home");
    for (const name of ["Graph", "Sources", "Shares"]) {
      const link = primary.getByRole("link", { name, exact: true });
      await expect(link).toBeVisible();
      await expect(link.locator("span[aria-hidden]")).toHaveCSS("opacity", "0");
      await expect(link).not.toHaveAttribute("aria-current");
    }
    const explorer = page.getByRole("complementary", { name: "Knowledge explorer" });
    await expect(explorer.getByRole("heading", { name: "Knowledge", exact: true })).toBeVisible();
    await expect(explorer.getByRole("link", { name: /^(Graph|Sources|Shares)$/ })).toHaveCount(0);
    await graph.hover();
    await expect(page.getByText("Graph", { exact: true }).last()).toBeVisible(); // the tooltip portals last, after the hidden label
    await graph.click();
    await expect(page).toHaveURL(`${workspace}/graph`, ROUND_TRIP);
    await expect(graph).toHaveAttribute("aria-current", "page");
    await expect(graph).toHaveText("Graph");
    await expect(home.locator("span[aria-hidden]")).toHaveCSS("opacity", "0");
    await page.getByRole("button", { name: "Collapse navigation", exact: true }).click();
    for (const name of ["Graph", "Sources", "Shares"]) {
      await expect(primary.getByRole("link", { name, exact: true })).toHaveAttribute("href", `${workspace}/${name.toLowerCase()}`);
    }
    await primary.getByRole("link", { name: "Graph", exact: true }).focus();
    await page.keyboard.press("ControlOrMeta+Backslash");
    await expect(page.getByRole("button", { name: "Collapse navigation", exact: true })).toBeFocused();
  });

  for (const density of ["comfortable", "compact"] as const) {
    base(`the current page's name fits the ${density} switch, which sits on one line`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const workspace = `/w/${await personalWorkspaceId(page)}`;
      await page.addInitScript((value) => localStorage.setItem("kh:density", value), density);
      await page.goto(`${workspace}/sources`);
      const primary = page.getByRole("navigation", { name: "Primary", exact: true });
      const sources = primary.getByRole("link", { name: "Sources", exact: true });
      await expect(sources).toHaveText("Sources");
      // The label grows in over 160ms; read it once settled.
      await expect.poll(() => sources.locator("span.truncate").evaluate((span) => span.scrollWidth <= span.clientWidth)).toBe(true);
      const boxes = await Promise.all(["Home", "Graph", "Sources", "Shares"].map((name) => primary.getByRole("link", { name, exact: true }).boundingBox()));
      for (const box of boxes) expect(Math.abs(box!.y - boxes[0]!.y)).toBeLessThan(1);
    });
  }

  base.describe("mobile sidebar destinations", () => {
    base.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

    base("the page switch works in the touch drawer", async ({ page }) => {
      const workspace = `/w/${await personalWorkspaceId(page)}`;
      await page.goto(`${workspace}/home`);
      await page.getByRole("button", { name: "Open menu", exact: true }).tap();
      const drawer = page.getByRole("dialog", { name: "Menu", exact: true });
      const graph = drawer.getByRole("navigation", { name: "Primary", exact: true }).getByRole("link", { name: "Graph", exact: true });
      const [newPage] = await Promise.all([
        page.context().waitForEvent("page"),
        graph.click({ modifiers: ["ControlOrMeta"] }),
      ]);
      await newPage.close();
      await expect(drawer).toBeVisible();
      await graph.tap();
      await expect(page).toHaveURL(`${workspace}/graph`, ROUND_TRIP);
      await expect(drawer).toBeHidden();
    });
  });
}

const test = base.extend<{
  sidebarNote: { workspaceId: string; folderName: string; title: string; href: string };
}>({
  sidebarNote: async ({ page }, use) => {
    const workspaceId = await personalWorkspaceId(page);
    const stamp = crypto.randomUUID().slice(0, 8);
    const folderName = `Sidebar folder ${stamp}`;
    const title = `Sidebar note ${stamp}`;
    const folder = await page.request.post(`/api/workspaces/${workspaceId}/folders`, { data: { name: folderName } });
    expect(folder.status()).toBe(201);
    const { treeNodeId } = await folder.json() as { treeNodeId: string };
    let noteId: string | undefined;
    try {
      const note = await page.request.post(`/api/workspaces/${workspaceId}/documents`, {
        data: { title, markdown: "A note in the workspace sidebar.", parentId: treeNodeId },
      });
      expect(note.status()).toBe(201);
      const { documentId, sourceId } = await note.json() as { documentId: string; sourceId: string };
      noteId = documentId;
      await use({ workspaceId, folderName, title, href: `/w/${workspaceId}/knowledge/${sourceId}/${documentId}` });
    } finally {
      if (noteId) expect((await page.request.post(`/api/documents/${noteId}/archive`)).status()).toBe(200);
      expect((await page.request.post(`/api/tree-nodes/${treeNodeId}/archive`)).status()).toBe(204);
    }
  },
});

test("one desktop sidebar collapses to a rail, keeps focus and remembers the choice", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/w/${await personalWorkspaceId(page)}/home`);
  const primary = page.getByRole("navigation", { name: "Primary", exact: true });
  const sidebar = page.locator("aside").filter({ has: primary });
  const explorer = sidebar.getByRole("complementary", { name: "Knowledge explorer" });
  const collapse = sidebar.getByRole("button", { name: "Collapse navigation", exact: true });
  const expand = sidebar.getByRole("button", { name: "Expand navigation", exact: true });
  const main = page.locator("#kh-workspace-main");
  await expect(explorer).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Document tree", exact: true })).toHaveCount(1);
  await expect(primary.getByRole("link", { name: "Knowledge", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(Hide|Show) documents$/ })).toHaveCount(0);
  await expect(sidebar).toHaveCSS("width", "272px");
  await expect(main).toHaveCSS("width", "1168px");

  await collapse.click();
  await expect(explorer).toBeHidden();
  await expect(expand).toBeFocused();
  await expect(primary.getByRole("link", { name: /^Inbox/ })).toBeVisible();
  await expect(sidebar).toHaveCSS("width", "48px");
  await expect(main).toHaveCSS("width", "1392px");

  await page.reload();
  await expect(expand).toBeVisible();
  await expect(explorer).toBeHidden();

  await expand.click();
  await expect(explorer).toBeVisible();
  await expect(collapse).toBeFocused();
  await expect(page.getByRole("dialog", { name: "Menu", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(explorer).toBeVisible();
});

test("the sidebar shortcut moves focus to the rail and retains the Knowledge filter", async ({ page, sidebarNote }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(sidebarNote.href);
  await page.getByRole("button", { name: "Filter documents and sources" }).click();
  const filter = page.getByPlaceholder("Filter documents and sources");
  await expect(filter).toBeVisible();
  await filter.fill(sidebarNote.title);
  await filter.press("ControlOrMeta+Backslash");
  await expect(filter).toBeHidden();
  const expand = page.getByRole("button", { name: "Expand navigation", exact: true });
  await expect(expand).toBeFocused();
  await expand.click();
  await expect(filter).toHaveValue(sidebarNote.title);
});

test("the same Knowledge tree and folder state follow navigation across workspace pages", async ({ page, sidebarNote }) => {
  await page.setViewportSize({ width: 1512, height: 900 });
  const workspace = `/w/${sidebarNote.workspaceId}`;
  await page.goto(`${workspace}/home`);
  const tree = page.getByRole("navigation", { name: "Document tree", exact: true });
  const notes = tree.getByRole("button", { name: "Notes", exact: true });
  if (await notes.getAttribute("aria-expanded") === "false") await notes.click();
  const folder = tree.getByRole("treeitem", { name: sidebarNote.folderName, exact: true });
  const toggleFolder = folder.getByRole("button", { name: sidebarNote.folderName, exact: true });
  const noteRow = folder.getByRole("treeitem", { name: sidebarNote.title, exact: true });
  await expect(noteRow).toBeVisible(ROUND_TRIP);
  const treeElement = await tree.elementHandle();
  await toggleFolder.click();
  await expect(folder).toHaveAttribute("aria-expanded", "false");

  await page.getByRole("complementary", { name: "Workspace navigation", exact: true }).getByRole("link", { name: /^Inbox/ }).click();
  await expect(page).toHaveURL(`${workspace}/inbox`, ROUND_TRIP);
  await expect(folder).toHaveAttribute("aria-expanded", "false");
  expect(await tree.evaluate((element, original) => element === original, treeElement)).toBe(true);

  await toggleFolder.click();
  await noteRow.getByRole("link", { name: sidebarNote.title, exact: true }).click();
  await expect(page).toHaveURL(sidebarNote.href, ROUND_TRIP);
  await expect(noteRow).toHaveAttribute("aria-current", "page");
  expect(await tree.evaluate((element, original) => element === original, treeElement)).toBe(true);

  await (await openKnowledgeDestinations(page)).getByRole("link", { name: "Sources", exact: true }).click();
  await expect(page).toHaveURL(`${workspace}/sources`, ROUND_TRIP);
  await expect(folder).toHaveAttribute("aria-expanded", "true");
  await expect(noteRow).toBeVisible();
  await expect(noteRow).not.toHaveAttribute("aria-current", "page");
  expect(await tree.evaluate((element, original) => element === original, treeElement)).toBe(true);
});

test("at 1512px, the compact sidebar leaves room for outline, article and discussions", async ({ page, request }) => {
  const paragraphs = (from: number) => Array.from({ length: 12 }, (_, i) => `Paragraph ${from + i}: a clear recommendation with enough context for a colleague to review.`).join("\n\n");
  const markdown = `## Alpha\n\n${paragraphs(1)}\n\n## Beta\n\n${paragraphs(13)}\n`;
  const doc = await createReviewDocument(request, markdown);
  const viewer = phase3Origin("viewer");
  const block = projectReviewBlocks(markdown).find((candidate) => candidate.text.startsWith("Paragraph 3:"))!;
  const created = await request.post(`${viewer}/api/share-review/threads`, { headers: { Origin: viewer }, data: {
    token: doc.links[0].path.split("/").pop(), expectedRevisionId: doc.revisionId, idempotencyKey: crypto.randomUUID(), body: "A reviewer's remark",
    anchor: { schemaVersion: 1, blockPath: block.path, blockKind: block.kind, startUtf16: 0, endUtf16: 11, exact: block.text.slice(0, 11), prefix: "", suffix: block.text.slice(11, 75) },
  } });
  expect(created.status()).toBe(201);

  await page.setViewportSize({ width: 1512, height: 900 });
  await page.goto(doc.href);
  const rail = page.getByRole("complementary", { name: "Document comments" });
  const outline = page.getByRole("complementary", { name: "On this page" });
  await expect(rail).toBeVisible();
  // With the sidebar expanded the outline yields space to the discussions.
  await expect(outline).toBeHidden();

  await page.getByRole("button", { name: "Collapse navigation" }).click();
  const pane = page.getByRole("region", { name: "Document content" });
  await expect.poll(() => pane.evaluate((element) => element.clientWidth)).toBeGreaterThanOrEqual(1408);
  await expect(rail).toBeVisible();
  await expect(outline).toBeVisible();
  const article = page.locator("[data-review-document]");
  await expect.poll(async () => {
    const [outlineBox, articleBox, railBox] = [(await outline.boundingBox())!, (await article.boundingBox())!, (await rail.boundingBox())!];
    return outlineBox.x >= 0 && outlineBox.x + outlineBox.width <= articleBox.x + 1 && railBox.x >= articleBox.x + articleBox.width - 1;
  }).toBe(true);
  expect(await pane.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("the phone uses one Menu for primary navigation and Knowledge", async ({ page, sidebarNote }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const home = `/w/${sidebarNote.workspaceId}/home`;
  await page.goto(home);
  const trigger = page.getByRole("button", { name: "Open menu", exact: true });
  const primary = page.getByRole("navigation", { name: "Primary", exact: true });
  const tree = page.getByRole("navigation", { name: "Document tree", exact: true });
  await expect(primary).toBeHidden();
  await expect(tree).toBeHidden();

  await trigger.click();
  const menu = page.getByRole("dialog", { name: "Menu", exact: true });
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(menu.getByRole("navigation", { name: "Primary", exact: true }).getByRole("link", { name: "Home", exact: true })).toBeVisible();
  await expect(menu.getByRole("navigation", { name: "Document tree", exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: /^(Collapse|Expand) navigation$/ })).toHaveCount(0);
  const notes = tree.getByRole("button", { name: "Notes", exact: true });
  if (await notes.getAttribute("aria-expanded") === "false") await notes.click();
  const note = tree.getByRole("link", { name: sidebarNote.title, exact: true });

  // Modified clicks behave like links: no same-page navigation, and the
  // drawer stays open. Opening the tab itself is covered once, in the
  // destinations test above.
  await note.click({ modifiers: ["ControlOrMeta"] });
  await expect(page).toHaveURL(home);
  await expect(menu).toBeVisible();

  await note.click();
  await expect(page).toHaveURL(sidebarNote.href, ROUND_TRIP);
  await expect(menu).toHaveCount(0);
  await trigger.click();
  await tree.getByRole("button", { name: `Actions for ${sidebarNote.title}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Add to favorites", exact: true }).click();
  await menu.getByRole("button", { name: "Favorite documents", exact: true }).click();
  await page.getByRole("menuitem", { name: new RegExp(sidebarNote.title) }).click();
  await expect(menu).toHaveCount(0);
  await expect(page).toHaveURL(sidebarNote.href);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await menu.getByRole("link", { name: /^Inbox/ }).click();
  await expect(page).toHaveURL(`/w/${sidebarNote.workspaceId}/inbox`, ROUND_TRIP);
  await expect(menu).toHaveCount(0);
});
