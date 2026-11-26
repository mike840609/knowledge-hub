import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";
import { chooseOption } from "./fixtures/select-menu";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/** The 2026-11-20 page-chrome pass (docs/superpowers/specs/2026-11-20-page-chrome-design.md). */

function unique(label: string) {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function openNote(page: Page, markdown: string, title = unique("Chrome"), parentId?: string) {
  const workspaceId = await mySpace(page);
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown, parentId } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  await page.goto(`/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`);
  const surface = page.locator("main").getByRole("textbox", { name: "Content" });
  await expect(surface).toBeEditable(ROUND_TRIP);
  await page.waitForTimeout(600);
  return { surface, url: `/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}` };
}

async function fullWidthAction(page: Page) {
  await page.getByRole("button", { name: "Document actions" }).click();
  return page.getByRole("menuitemcheckbox", { name: "Full width" });
}

async function expectActionsAtPaneRight(page: Page) {
  const pane = page.getByRole("region", { name: "Document content", exact: true });
  const actions = pane.getByRole("button", { name: "Document actions", exact: true });
  await expect(actions).toBeVisible();
  await expect.poll(() => actions.evaluate((button) => {
    const content = button.closest(".kh-document-pane")!;
    return Math.round(content.getBoundingClientRect().left + content.clientWidth - button.getBoundingClientRect().right);
  })).toBe(24);
  await expect.poll(() => pane.evaluate((content) => content.scrollWidth <= content.clientWidth)).toBe(true);
}

test.describe("page chrome", () => {
  test("the nearest folder stays readable beside desktop document actions", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const workspaceId = await mySpace(page);
    const folder = async (name: string, parentId?: string) => {
      const response = await page.request.post(`/api/workspaces/${workspaceId}/folders`, { data: { name, parentId } });
      expect(response.ok()).toBe(true);
      return (await response.json() as { treeNodeId: string }).treeNodeId;
    };
    const ancestor = await folder(unique("Design references and working notes for the wider team"));
    const nearest = "Roadmaps and planning";
    const parent = await folder(nearest, ancestor);
    const title = "Roadmap for the next release and related decisions across the design and engineering teams";
    await openNote(page, "Some text.\n", title, parent);
    await expectActionsAtPaneRight(page);
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    const fits = (node: HTMLElement | SVGElement) => node.scrollWidth <= node.clientWidth;
    await expect(breadcrumb.getByText(nearest, { exact: true })).toBeVisible();
    await expect.poll(() => breadcrumb.getByText(nearest, { exact: true }).evaluate(fits)).toBe(true);
    await expect(breadcrumb.getByText(title, { exact: true })).toBeVisible();
    await expect.poll(() => breadcrumb.getByText(title, { exact: true }).evaluate(fits)).toBe(false);
    // Share is the same icon button as Comments and Details: no label, and the same box
    // (2026-11-25-reader-chrome-polish-design.md, 2026-11-26 amendment).
    const share = page.getByRole("button", { name: "Share link…" });
    await expect(share).toBeVisible();
    await expect(share.getByText("Share", { exact: true })).toHaveCount(0);
    const details = page.getByRole("button", { name: "Details", exact: true });
    const shareBox = await share.boundingBox();
    const detailsBox = await details.boundingBox();
    expect(shareBox?.height).toBe(detailsBox?.height);
    expect(shareBox?.width).toBe(detailsBox?.width);
  });

  test("Comments opens the empty document discussion panel", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNote(page, "A paragraph for the first comment.\n");
    const entry = page.getByRole("button", { name: /Show comments, 0 comments/ });
    await expect(entry).toBeVisible();
    await entry.click();
    await expect(page.getByText(/No comments yet.*select text or use a block/i)).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Add comment" })).toHaveCount(0);
  });

  test("the share summary follows the selected link expiry", async ({ page }) => {
    await openNote(page, "Some text.\n");
    await page.getByRole("button", { name: "Share link…" }).click();
    const dialog = page.getByRole("dialog", { name: "Share link" });
    await expect(dialog).toHaveAccessibleDescription(/expires after 30 days/i);
    await chooseOption(dialog.getByLabel("Expires after", { exact: true }), "1");
    await expect(dialog).toHaveAccessibleDescription(/expires after 1 day\./i);
  });

  test("the header counts the words, and the count follows the typing", async ({ page }) => {
    const { surface } = await openNote(page, "one two three\n");
    const count = page.locator("header").getByText(/\d+ words?/);
    // The first-use hint holds the line until the editor is focused.
    await surface.getByText("one two three", { exact: true }).click();
    await expect(count).toHaveText("3 words", ROUND_TRIP);
    await page.keyboard.press("End");
    await page.keyboard.type(" four 請假");
    await expect(count).toHaveText("6 words", ROUND_TRIP);
  });

  test("Full width lets the column fill the pane, and is remembered by this browser", async ({ page }) => {
    await page.setViewportSize({ width: 2200, height: 900 });
    await openNote(page, "Some text.\n\n## Heading one\n\ntext\n\n## Heading two\n\ntext\n");
    const column = page.locator("[data-document-pane] article").locator("xpath=ancestor::div[contains(@class,'kh-reading-column')][1]");
    const width = () => column.evaluate((node) => node.getBoundingClientRect().width);
    const normal = await width();
    await expectActionsAtPaneRight(page);
    const toggle = await fullWidthAction(page);
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect.poll(width).toBeGreaterThan(normal + 100);
    await expectActionsAtPaneRight(page);
    await page.reload();
    const stored = await fullWidthAction(page);
    await expect(stored).toHaveAttribute("aria-checked", "true", ROUND_TRIP);
    await stored.click();
    await expect.poll(width).toBeLessThan(normal + 5);
    await page.getByRole("button", { name: "Details", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Document details", exact: true })).toBeVisible();
    await expectActionsAtPaneRight(page);
  });

  const columnWidth = (page: Page) =>
    page.locator("[data-document-pane] article").first().locator("xpath=ancestor::div[contains(@class,'kh-reading-column')][1]").evaluate((node) => ({ width: node.getBoundingClientRect().width, padding: getComputedStyle(node).paddingLeft }));

  test("Full width moves the outline to the right rail, and every page of a document honours it", async ({ page }) => {
    await page.setViewportSize({ width: 2200, height: 900 });
    const { url } = await openNote(page, "Some text.\n\n## Heading one\n\ntext\n\n## Heading two\n\ntext\n");
    const normal = (await columnWidth(page)).width;
    await (await fullWidthAction(page)).click();
    await expect.poll(async () => (await columnWidth(page)).width).toBeGreaterThan(normal + 100);
    // The outline is in the right rail; the left-hung one, which needs the column's margin, is gone.
    await expect(page.locator(".kh-outline-rail").first()).toBeVisible();
    await expect(page.locator(".kh-outline-rail-left")).toBeHidden();
    // A revision snapshot sits at the same width and offers the same setting.
    await page.goto(`${url}?revision=1`);
    await expect(page.locator("main article").first()).toBeVisible(ROUND_TRIP);
    await expect.poll(async () => (await columnWidth(page)).width).toBeGreaterThan(normal + 100);
    const stored = await fullWidthAction(page);
    await expect(stored).toHaveAttribute("aria-checked", "true");
    await stored.click();
    await expect.poll(async () => (await columnWidth(page)).width).toBeLessThan(normal + 5);
  });

  test("a stored Full width leaves the reading column at its phone width", async ({ page }) => {
    await page.setViewportSize({ width: 2200, height: 900 });
    await openNote(page, "Some text.\n");
    await (await fullWidthAction(page)).click();
    await page.setViewportSize({ width: 500, height: 900 });
    await expect(await fullWidthAction(page)).toBeHidden();
    // 24px, the column's own padding at a phone's width, not the 56px full width gives the block gutter.
    await expect.poll(async () => (await columnWidth(page)).padding).toBe("24px");
  });
});
