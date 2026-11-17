import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/**
 * Caret and keys in a real browser (docs/superpowers/specs/2026-11-19-editor-keys-caret-design.md):
 * a press below the text, Tab, the way back up to the title, Mod-Enter on a to-do and a "/" mid-line.
 * It writes into the E2E user's My Space, so it sorts last for the reasons zz-wikilinks-composer.spec.ts gives.
 */

const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function createNote(page: Page, workspaceId: string, title: string, markdown: string) {
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  return `/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`;
}
async function openEditor(page: Page, url: string) {
  await page.goto(url);
  const surface = page.locator("main").getByRole("textbox", { name: "Content" });
  await expect(surface).toBeEditable(ROUND_TRIP);
  return surface;
}
async function save(page: Page) {
  await expect(page.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "saved", ROUND_TRIP);
  const documentId = new URL(page.url()).pathname.split("/").at(-1);
  const exported = await page.request.get(`/api/documents/${documentId}/export`);
  expect(exported.ok()).toBe(true);
  return exported.text();
}

test.describe("caret and keys in the rendered editor", () => {
  test("a press below the text writes at the end, in a new line after a list", async ({ page }) => {
    const surface = await openEditor(page, await createNote(page, await mySpace(page), unique("Below"), "Intro\n\n- item"));
    const box = (await surface.boundingBox())!;
    await page.mouse.click(box.x + 40, box.y + box.height + 60);
    await expect(surface).toBeFocused();
    await page.keyboard.type("after");
    await expect(surface.locator("p").last()).toHaveText("after");
    expect(await save(page)).toMatch(/- item\n\nafter\n?$/);
  });

  test("Tab stays in the text; ArrowUp on the first line and Backspace in an empty first line go to the title", async ({ page }) => {
    const title = unique("Top");
    const surface = await openEditor(page, await createNote(page, await mySpace(page), title, "First line"));
    await surface.locator("p").first().click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Tab");
    await expect(surface).toBeFocused();
    await page.keyboard.press("ArrowUp");
    const titleField = page.getByRole("textbox", { name: "Title" });
    await expect(titleField).toBeFocused();
    expect(await titleField.evaluate((input: HTMLTextAreaElement) => input.selectionStart)).toBe(title.length);
    await page.keyboard.press("Enter");
    await expect(surface).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(150);
    await page.keyboard.press("Backspace");
    await expect(titleField).toBeFocused();
    expect((await save(page)).trim().endsWith("First line")).toBe(true);
  });

  test("Mod-Enter ticks a to-do, Mod-Alt-4 makes one, and a / mid-line adds a block below", async ({ page }) => {
    const surface = await openEditor(page, await createNote(page, await mySpace(page), unique("Keys"), "Start"));
    await surface.locator("p").first().click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("task");
    await page.keyboard.press("ControlOrMeta+Alt+4");
    await expect(surface.locator("li[data-item-type='task']")).toHaveCount(1);
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(surface.locator("li[data-item-type='task']")).toHaveAttribute("data-checked", "true");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("words /quote");
    await expect(page.getByRole("listbox", { name: "Block commands" })).toBeVisible();
    await page.keyboard.press("Enter");
    await page.keyboard.type("quoted");
    const markdown = await save(page);
    expect(markdown).toContain("- [x] task");
    expect(markdown).toMatch(/words \n\n> quoted/);
  });
});
