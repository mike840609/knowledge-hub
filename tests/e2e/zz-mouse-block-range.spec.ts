import { expect, test, type Locator, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/**
 * A range of blocks chosen with the mouse (docs/superpowers/specs/2026-11-26-mouse-block-range-design.md): a real drag
 * from the left margin, and Shift-click on a grip. It writes into the E2E user's My Space like zz-multi-block.spec.ts and
 * sorts last for the same reason.
 */
test.use({ viewport: { width: 1440, height: 900 } });

function unique(label: string) {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function openNote(page: Page, markdown: string) {
  const workspaceId = await mySpace(page);
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title: unique("Mouse range"), markdown } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  await page.goto(`/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`);
  const surface = page.locator("main").getByRole("textbox", { name: "Content" });
  await expect(surface).toBeEditable(ROUND_TRIP);
  await page.waitForTimeout(600);
  return { surface, documentId: created.documentId };
}

const exported = async (page: Page, documentId: string) => (await page.request.get(`/api/documents/${documentId}/export`)).text();

/** Drags a box from the editor's left margin, level with `from`, to the vertical middle of `to`. */
async function dragFromMargin(page: Page, surface: Locator, from: string, to: string) {
  const editor = await surface.boundingBox();
  const start = await surface.getByText(from, { exact: true }).boundingBox();
  const end = await surface.getByText(to, { exact: true }).boundingBox();
  if (!editor || !start || !end) throw new Error("no layout");
  // The gutter's own controls hang from +4px; the press lands left of them, on the editor's surface.
  const x = editor.x + 1;
  await page.mouse.move(x, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(x + 6, (start.y + end.y) / 2 + 4, { steps: 6 });
  await page.mouse.move(x + 12, end.y + end.height / 2, { steps: 6 });
  return async () => { await page.mouse.up(); };
}

test.describe("a block range chosen with the mouse", () => {
  test("a drag from the left margin over three paragraphs chooses them, and Delete removes them", async ({ page }) => {
    const { surface, documentId } = await openNote(page, "Alpha\n\nBeta\n\nGamma\n\nDelta\n\nEpsilon\n");
    const release = await dragFromMargin(page, surface, "Alpha", "Gamma");
    await expect(page.locator(".kh-block-marquee")).toBeVisible();
    await release();
    await expect(page.locator(".kh-block-marquee")).toHaveCount(0);
    const chosen = surface.locator(".kh-block-in-range");
    await expect(chosen).toHaveCount(3);
    // The selected fill (the contract's `kh-bg-selected`), and the announcement the keyboard's range makes.
    const fill = await chosen.first().evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(fill).not.toBe("rgba(0, 0, 0, 0)");
    await expect(page.getByText("3 blocks selected", { exact: true })).toHaveCount(1);
    await page.keyboard.press("Delete");
    await expect.poll(() => exported(page, documentId), ROUND_TRIP).not.toContain("Beta");
    const markdown = await exported(page, documentId);
    expect(markdown).toContain("Delta\n\nEpsilon");
    expect(markdown).not.toContain("Alpha");
    expect(markdown).not.toContain("Gamma");
  });

  test("Escape during the drag cancels it", async ({ page }) => {
    const { surface } = await openNote(page, "Alpha\n\nBeta\n\nGamma\n");
    const release = await dragFromMargin(page, surface, "Alpha", "Gamma");
    await expect(surface.locator(".kh-block-in-range")).toHaveCount(3);
    await page.keyboard.press("Escape");
    await expect(surface.locator(".kh-block-in-range")).toHaveCount(0);
    await expect(page.locator(".kh-block-marquee")).toHaveCount(0);
    await release();
    await expect(surface.locator(".kh-block-in-range")).toHaveCount(0);
    await expect(surface.locator(".ProseMirror-selectednode")).toHaveCount(0);
  });

  test("Shift-click on a grip extends the chosen block into a range", async ({ page }) => {
    const { surface, documentId } = await openNote(page, "Alpha\n\nBeta\n\nGamma\n\nDelta\n");
    await surface.getByText("Alpha", { exact: true }).click();
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
    await expect(surface.locator(".ProseMirror-selectednode")).toHaveCount(1);
    await surface.getByText("Gamma", { exact: true }).hover();
    const grip = page.getByRole("button", { name: "Move block" });
    await expect(grip).toBeVisible();
    await grip.click({ modifiers: ["Shift"] });
    await expect(surface.locator(".kh-block-in-range")).toHaveCount(3);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.keyboard.press("Delete");
    await expect.poll(() => exported(page, documentId), ROUND_TRIP).not.toContain("Beta");
    expect(await exported(page, documentId)).toContain("Delta");
  });

  test("Shift-click on another block's text extends a chosen block, and a plain click in text still edits", async ({ page }) => {
    const { surface, documentId } = await openNote(page, "Alpha\n\nBeta\n\nGamma\n\nDelta\n");
    await surface.getByText("Beta", { exact: true }).click();
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
    await surface.getByText("Delta", { exact: true }).click({ modifiers: ["Shift"] });
    await expect(surface.locator(".kh-block-in-range")).toHaveCount(3);
    // A plain click in text puts the caret there and ends the range, as before.
    await surface.getByText("Alpha", { exact: true }).click();
    await expect(surface.locator(".kh-block-in-range")).toHaveCount(0);
    await page.keyboard.type("ZZ");
    await expect.poll(() => exported(page, documentId), ROUND_TRIP).toContain("ZZ");
    expect(await exported(page, documentId)).toMatch(/Beta\n\nGamma\n\nDelta/);
  });

  test("a wikilink in a mouse-made range survives Mod-d as a link", async ({ page }) => {
    const { surface, documentId } = await openNote(page, "See [[Target]] here\n\nPlain\n\nLast\n");
    const release = await dragFromMargin(page, surface, "Plain", "Plain");
    await release();
    // One block under the box: chosen alone. Widen to the wikilink's line with the box dragged up from Plain.
    const editor = await surface.boundingBox();
    const first = await surface.locator("p").first().boundingBox();
    const second = await surface.getByText("Plain", { exact: true }).boundingBox();
    if (!editor || !first || !second) throw new Error("no layout");
    await page.mouse.move(editor.x + 1, second.y + second.height / 2);
    await page.mouse.down();
    await page.mouse.move(editor.x + 8, (first.y + second.y) / 2, { steps: 6 });
    await page.mouse.move(editor.x + 12, first.y + first.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(surface.locator(".kh-block-in-range")).toHaveCount(2);
    await page.keyboard.press("ControlOrMeta+d");
    await expect(surface.locator("[data-kh-wiki-raw]")).toHaveCount(2);
    await expect.poll(async () => ((await exported(page, documentId)).match(/\[\[Target\]\]/g) ?? []).length, ROUND_TRIP).toBe(2);
    expect(await exported(page, documentId)).not.toContain("\\[");
  });
});
