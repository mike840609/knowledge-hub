import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/** The 2026-11-20 multi-block pass (docs/superpowers/specs/2026-11-20-multi-block-selection-design.md), with the real keyboard. */

function unique(label: string) {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function openNote(page: Page, markdown: string) {
  const workspaceId = await mySpace(page);
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title: unique("Range"), markdown } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  await page.goto(`/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`);
  const surface = page.locator("main").getByRole("textbox", { name: "Content" });
  await expect(surface).toBeEditable(ROUND_TRIP);
  await page.waitForTimeout(600);
  return { surface, documentId: created.documentId };
}

/** Escape takes the block the caret is in; the browser settles its caret first, as the other Escape specs wait for. */
async function chooseBlock(page: Page, text: string, surface: ReturnType<Page["locator"]>) {
  await surface.getByText(text, { exact: true }).click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await expect(surface.locator(".ProseMirror-selectednode")).toHaveCount(1);
}

test.describe("several blocks at once", () => {
  test("Shift-ArrowDown widens a chosen block, and Delete removes all of them", async ({ page }) => {
    const { surface, documentId } = await openNote(page, "Alpha\n\nBeta\n\nGamma\n\nDelta\n");
    await chooseBlock(page, "Beta", surface);
    await page.keyboard.press("Shift+ArrowDown");
    await expect(surface.locator(".kh-block-in-range")).toHaveCount(2);
    await page.keyboard.press("Delete");
    await expect.poll(async () => (await page.request.get(`/api/documents/${documentId}/export`)).text(), ROUND_TRIP).not.toContain("Beta");
    const markdown = await (await page.request.get(`/api/documents/${documentId}/export`)).text();
    expect(markdown).toContain("Alpha\n\nDelta");
    expect(markdown).not.toContain("Gamma");
  });

  test("Mod-Shift-ArrowUp moves the range past its neighbour, and Mod-Alt-5 makes it one list", async ({ page }) => {
    const { surface, documentId } = await openNote(page, "Alpha\n\nBeta\n\nGamma\n");
    await chooseBlock(page, "Beta", surface);
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("ControlOrMeta+Shift+ArrowUp");
    await page.keyboard.press("ControlOrMeta+Alt+5");
    await expect.poll(async () => (await page.request.get(`/api/documents/${documentId}/export`)).text(), ROUND_TRIP).toContain("- Beta\n- Gamma");
    expect((await (await page.request.get(`/api/documents/${documentId}/export`)).text())).toMatch(/- Beta\n- Gamma\n\nAlpha/);
  });
});
