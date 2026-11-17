import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/** The 2026-11-20 page-chrome pass (docs/superpowers/specs/2026-11-20-page-chrome-design.md). */

function unique(label: string) {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function openNote(page: Page, markdown: string) {
  const workspaceId = await mySpace(page);
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title: unique("Chrome"), markdown } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  await page.goto(`/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`);
  const surface = page.locator("main").getByRole("textbox", { name: "Content" });
  await expect(surface).toBeEditable(ROUND_TRIP);
  await page.waitForTimeout(600);
  return { surface, url: `/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}` };
}

test.describe("page chrome", () => {
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
    const toggle = page.getByRole("button", { name: "Full width" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect.poll(width).toBeGreaterThan(normal + 100);
    await page.reload();
    await expect(page.getByRole("button", { name: "Full width" })).toHaveAttribute("aria-pressed", "true", ROUND_TRIP);
    await page.getByRole("button", { name: "Full width" }).click();
    await expect.poll(width).toBeLessThan(normal + 5);
  });

  const columnWidth = (page: Page) =>
    page.locator("[data-document-pane] article").first().locator("xpath=ancestor::div[contains(@class,'kh-reading-column')][1]").evaluate((node) => ({ width: node.getBoundingClientRect().width, padding: getComputedStyle(node).paddingLeft }));

  test("Full width moves the outline to the right rail, and every page of a document honours it", async ({ page }) => {
    await page.setViewportSize({ width: 2200, height: 900 });
    const { url } = await openNote(page, "Some text.\n\n## Heading one\n\ntext\n\n## Heading two\n\ntext\n");
    const normal = (await columnWidth(page)).width;
    await page.getByRole("button", { name: "Full width" }).click();
    await expect.poll(async () => (await columnWidth(page)).width).toBeGreaterThan(normal + 100);
    // The outline is in the right rail; the left-hung one, which needs the column's margin, is gone.
    await expect(page.locator(".kh-outline-rail").first()).toBeVisible();
    await expect(page.locator(".kh-outline-rail-left")).toBeHidden();
    // A revision snapshot is a page that cannot be edited: it sits at the same width, and has the button to undo it.
    await page.goto(`${url}?revision=1`);
    await expect(page.locator("main article").first()).toBeVisible(ROUND_TRIP);
    await expect.poll(async () => (await columnWidth(page)).width).toBeGreaterThan(normal + 100);
    await expect(page.getByRole("button", { name: "Full width" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Full width" }).click();
    await expect.poll(async () => (await columnWidth(page)).width).toBeLessThan(normal + 5);
  });

  test("a stored Full width changes nothing below the width where its button is drawn", async ({ page }) => {
    await page.setViewportSize({ width: 2200, height: 900 });
    await openNote(page, "Some text.\n");
    await page.getByRole("button", { name: "Full width" }).click();
    await page.setViewportSize({ width: 500, height: 900 });
    await expect(page.getByRole("button", { name: "Full width" })).toBeHidden();
    // 24px, the column's own padding at a phone's width, not the 56px full width gives the block gutter.
    await expect.poll(async () => (await columnWidth(page)).padding).toBe("24px");
  });
});
