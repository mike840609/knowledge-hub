import { expect, test, type Page } from "./fixtures/test";
import { ROUND_TRIP, mySpace, row, unique } from "./fixtures/organize";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument } from "./fixtures/document-review";
import { projectReviewBlocks } from "../../src/modules/knowledge/domain/review-anchor";

// One sidebar spec (2026-10-27), PR 1: navigation and the tree in one column on every workspace page.

const explorer = (page: Page) => page.getByRole("complementary", { name: "Knowledge explorer" });

async function noteIn(page: Page) {
  const workspaceId = await mySpace(page);
  const title = unique("Sidebar Note");
  const created = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown: `Body of ${title}.` } });
  expect(created.status()).toBe(201);
  return { workspaceId, title, ...((await created.json()) as { documentId: string; sourceId: string }) };
}

/** Graph, with Notes opened by hand: no source is current there, so none is open by default yet. */
async function graphWithNotes(page: Page) {
  const note = await noteIn(page);
  await page.goto(`/w/${note.workspaceId}/graph`);
  await expect(explorer(page)).toHaveAttribute("aria-busy", "false", ROUND_TRIP);
  const notes = explorer(page).locator(`button[aria-controls="collection-${note.sourceId}"]`);
  if ((await notes.getAttribute("aria-expanded")) !== "true") await notes.click();
  await expect(row(page, note.title)).toBeVisible(ROUND_TRIP);
  return note;
}

test("the sidebar is one 256px column with the tree, and has no Knowledge item", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { workspaceId } = await noteIn(page);
  await page.goto(`/w/${workspaceId}/graph`);
  const sidebar = page.locator("aside").first();
  await expect(sidebar.getByRole("complementary", { name: "Knowledge explorer" })).toBeVisible(ROUND_TRIP);
  expect((await sidebar.boundingBox())!.width).toBe(256);
  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Knowledge" })).toHaveCount(0);
  // One surface: the tree draws no background or border of its own.
  expect(await explorer(page).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  expect(await explorer(page).evaluate((el) => getComputedStyle(el).borderRightWidth)).toBe("0px");
});

test("on Graph a document opened from the tree lands selected", async ({ page }) => {
  const note = await graphWithNotes(page);
  await row(page, note.title).getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(`/knowledge/${note.sourceId}/${note.documentId}$`), ROUND_TRIP);
  await expect(row(page, note.title)).toHaveAttribute("aria-current", "page", ROUND_TRIP);
});

test("trees loaded on one page are not read again on the next", async ({ page }) => {
  const workspace = "0199f100-0000-7000-8000-000000000001";
  const source = "0199f100-0000-7000-8000-000000000101";
  const requests: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/workspaces/") && r.url().endsWith("/tree")) requests.push(r.url()); });
  await page.goto(`/w/${workspace}/knowledge/${source}`, { waitUntil: "networkidle" });
  // The current source arrives with the page; nothing is asked for.
  expect(requests).toHaveLength(0);
  const other = explorer(page).locator(`button[aria-controls^="collection-"]:not([aria-controls="collection-${source}"])`).first();
  await other.click();
  await expect(explorer(page).getByText("Loading documents…")).toHaveCount(0, ROUND_TRIP);
  expect(requests).toHaveLength(1);

  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Graph", exact: true }).click();
  await expect(page).toHaveURL(/\/graph$/, ROUND_TRIP);
  await expect(other).toHaveAttribute("aria-expanded", "true");
  await expect(explorer(page).getByText("Loading documents…")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect(requests).toHaveLength(1);
});

test("a fresh Graph reads no tree the reader has not opened", async ({ page }) => {
  const workspace = "0199f100-0000-7000-8000-000000000001";
  const requests: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/workspaces/") && r.url().endsWith("/tree")) requests.push(r.url()); });
  await page.goto(`/w/${workspace}/graph`, { waitUntil: "networkidle" });
  await expect(explorer(page)).toHaveAttribute("aria-busy", "false");
  expect(requests).toHaveLength(0);
});

test("collapsing hides the tree and keeps it as it was", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { workspaceId } = await noteIn(page);
  await page.goto(`/w/${workspaceId}/graph`);
  await explorer(page).getByRole("button", { name: "Filter documents and sources" }).click();
  const filter = page.locator("#tree-filter");
  await expect(filter).toBeVisible();
  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await expect(explorer(page)).toBeHidden();
  expect((await page.locator("main").boundingBox())!.x).toBe(48);
  await page.getByRole("button", { name: "Expand navigation" }).click();
  await expect(filter).toBeVisible();
});

test("Open in side peek from a tree row on Graph splits the page", async ({ page }) => {
  const note = await graphWithNotes(page);
  const graph = page.url();
  await row(page, note.title).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open in side peek" }).click();
  await expect(page.getByTestId("side-peek")).toContainText(`Body of ${note.title}.`, ROUND_TRIP);
  expect(page.url()).toBe(graph);
});

test("Open as full page from Home never uncovers the loading skeleton", async ({ page }) => {
  const note = await noteIn(page);
  await page.goto(`/w/${note.workspaceId}/home`);
  const homeRow = page.getByRole("main").getByRole("link", { name: note.title }).first();
  await expect(homeRow).toBeVisible(ROUND_TRIP);
  await homeRow.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open in side peek" }).click();
  const sidePeek = page.getByTestId("side-peek");
  await expect(sidePeek).toContainText(`Body of ${note.title}.`, ROUND_TRIP);

  const target = new URL((await sidePeek.getByRole("link", { name: "Open as full page" }).getAttribute("href"))!, page.url()).pathname;
  await page.route((url) => url.pathname === target, async (route) => {
    if (route.request().headers()["rsc"]) await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.evaluate(() => {
    const w = window as unknown as { uncovered: boolean };
    w.uncovered = false;
    new MutationObserver(() => {
      const skeleton = document.querySelector('[role="region"][aria-label="Document content"][aria-busy="true"]');
      if (skeleton && !document.querySelector('[data-testid="side-peek"]')) w.uncovered = true;
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  await sidePeek.getByRole("link", { name: "Open as full page" }).click();
  await expect(page.getByTestId("side-peek")).toHaveCount(0, ROUND_TRIP);
  await expect(page.getByRole("region", { name: "Document content" }).first()).toContainText(note.title);
  expect(await page.evaluate(() => (window as unknown as { uncovered: boolean }).uncovered)).toBe(false);
});

test("a narrow window's menu holds the tree, and a row closes it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const note = await noteIn(page);
  await page.goto(`/w/${note.workspaceId}/knowledge/${note.sourceId}/${note.documentId}`);
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "Menu", exact: true });
  await expect(menu.getByRole("complementary", { name: "Knowledge explorer" })).toBeVisible(ROUND_TRIP);
  // One tree on the page, so its IDs have one owner.
  await expect(page.getByRole("complementary", { name: "Knowledge explorer" })).toHaveCount(1);
  await menu.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Graph", exact: true }).click();
  await expect(menu).toHaveCount(0, ROUND_TRIP);
  await expect(page).toHaveURL(/\/graph$/, ROUND_TRIP);
});

// Moved from the explorer-collapse spec. At 1512px the sidebar collapsed gives the pane its 88rem; once the
// pane needs only 77rem (#259), this holds with the sidebar open.
test("at 1512px, with the sidebar collapsed, outline, article and discussions stand side by side", async ({ page, request }) => {
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
  const rail = page.getByRole("complementary", { name: "Document discussions" });
  const outline = page.getByRole("complementary", { name: "On this page" });
  await expect(rail).toBeVisible();
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
