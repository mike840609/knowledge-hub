import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/**
 * One block is one block, for every input (docs/superpowers/specs/2026-11-21-block-unit-design.md), at the audit's
 * 1440 × 900 with the real keyboard and pointer, each read back from the saved Markdown. It writes documents into the
 * E2E user's My Space, so it sorts last like zz-multi-block.spec.ts.
 */

test.use({ viewport: { width: 1440, height: 900 } });

function unique(label: string) {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function openNote(page: Page, markdown: string) {
  const workspaceId = await mySpace(page);
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title: unique("Block"), markdown } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  await page.goto(`/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`);
  const surface = page.locator("main").getByRole("textbox", { name: "Content" });
  await expect(surface).toBeEditable(ROUND_TRIP);
  await page.waitForTimeout(600);
  return { surface, documentId: created.documentId };
}

const exported = async (page: Page, documentId: string) => (await page.request.get(`/api/documents/${documentId}/export`)).text();

/** Escape takes the block the caret is in; the browser settles its caret first, as the other Escape specs wait for. */
async function chooseBlock(page: Page, text: string, surface: ReturnType<Page["locator"]>) {
  await surface.getByText(text, { exact: true }).click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await expect(surface.locator(".ProseMirror-selectednode")).toHaveCount(1);
}

test.describe("one block is one block", () => {
  test("Escape then Backspace in a list keeps the other items", async ({ page }) => {
    const { surface, documentId } = await openNote(page, "Before\n\n- one\n- two\n- three\n\nAfter\n");
    await chooseBlock(page, "two", surface);
    const chosen = surface.locator(".ProseMirror-selectednode");
    await expect(chosen).toHaveText("two");
    // Drawn as a chosen block is: the item alone carries the selection fill.
    await expect(chosen).toHaveCSS("background-color", /^(?!rgba\(0, 0, 0, 0\))/);
    await expect(surface.locator("li").filter({ hasText: "one" })).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await page.keyboard.press("Shift+ArrowDown");
    await expect(surface.locator("li.kh-block-in-range")).toHaveCount(2);
    await expect(surface.locator("li").filter({ hasText: "three" })).toHaveCSS("background-color", /^(?!rgba\(0, 0, 0, 0\))/);
    await page.keyboard.press("Shift+ArrowUp");
    await expect(surface.locator("li").filter({ hasText: "three" })).not.toHaveClass(/kh-block-in-range/);
    await expect(chosen).toHaveText("two");
    await page.keyboard.press("Backspace");
    await expect.poll(() => exported(page, documentId), ROUND_TRIP).not.toContain("two");
    expect(await exported(page, documentId)).toMatch(/Before\n\n- one\n- three\n\nAfter/);
  });

  test("the grip's Duplicate copies a two-block range", async ({ page }) => {
    const { surface, documentId } = await openNote(page, "Alpha\n\nBeta\n\nGamma\n");
    await chooseBlock(page, "Alpha", surface);
    await page.keyboard.press("Shift+ArrowDown");
    await expect(surface.locator(".kh-block-in-range")).toHaveCount(2);
    await surface.getByText("Beta", { exact: true }).hover();
    await page.getByRole("button", { name: "Move block" }).click();
    const menu = page.getByRole("menu", { name: "Block actions, 2 blocks" });
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(page.getByText("2 blocks duplicated")).toBeAttached();
    await expect.poll(() => exported(page, documentId), ROUND_TRIP).toMatch(/Alpha\n\nBeta\n\nAlpha\n\nBeta\n\nGamma/);
  });

  test("dragging a range moves it", async ({ page }) => {
    const { surface, documentId } = await openNote(page, "Alpha\n\nBeta\n\nGamma\n\nDelta\n");
    await chooseBlock(page, "Alpha", surface);
    await page.keyboard.press("Shift+ArrowDown");
    await expect(surface.locator(".kh-block-in-range")).toHaveCount(2);
    await surface.getByText("Beta", { exact: true }).hover();
    const grip = page.getByRole("button", { name: "Move block" });
    await expect(grip).toBeVisible();
    const delta = surface.getByText("Delta", { exact: true });
    const box = await delta.boundingBox();
    expect(box).not.toBeNull();
    await grip.dragTo(delta, { targetPosition: { x: 20, y: box!.height - 2 } });
    await expect.poll(() => exported(page, documentId), ROUND_TRIP).toMatch(/Gamma\n\nDelta\n\nAlpha\n\nBeta/);
  });

  test("controls show with the pointer over the text", async ({ page }) => {
    const sentence = "A paragraph long enough that the middle of its text sits well inside the column, far from the gutter on its left.";
    const { surface } = await openNote(page, `Opening line.\n\n${sentence}\n\nClosing line.\n`);
    const paragraph = surface.getByText(sentence, { exact: true });
    // The middle of the text itself, not of the paragraph's box, which runs past the text's end.
    const middle = await paragraph.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const rect = range.getClientRects()[0];
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    const editorLeft = (await surface.boundingBox())!.x;
    expect(middle.x).toBeGreaterThan(editorLeft + 56 + 100);
    await page.mouse.move(middle.x, middle.y - 40);
    await page.mouse.move(middle.x, middle.y, { steps: 4 });
    const grip = page.getByRole("button", { name: "Move block" });
    await expect(grip).toBeVisible();
    // The controls stand beside the hovered paragraph, in its line.
    const gripBox = (await grip.boundingBox())!;
    const paragraphBox = (await paragraph.boundingBox())!;
    expect(gripBox.y + gripBox.height / 2).toBeGreaterThanOrEqual(paragraphBox.y - 4);
    expect(gripBox.y).toBeLessThanOrEqual(paragraphBox.y + paragraphBox.height);
    // Drawn in the gutter, never over the text (2026-11-15's "controls stay in the gutter"): the grip ends where the
    // editor's text column begins, or before.
    const textLeft = await surface.evaluate((element) => element.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(element).paddingLeft));
    expect(gripBox.x + gripBox.width).toBeLessThanOrEqual(textLeft + 0.5);
    expect(paragraphBox.x).toBeGreaterThanOrEqual(textLeft - 0.5);
  });
});
