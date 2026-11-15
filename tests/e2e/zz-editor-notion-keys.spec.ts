import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/**
 * Typing rules and keys of the rendered editor, driven the way a person drives them
 * (docs/superpowers/specs/2026-11-15-editor-notion-parity-design.md, decisions 1-8). Everything is saved
 * and read back through export, links included. It writes into the E2E user's My Space, so it sorts last
 * for the reasons zz-wikilinks-composer.spec.ts gives.
 */

const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const composer = (page: Page) => page.locator("main");

async function createNote(page: Page, workspaceId: string, title: string, markdown: string) {
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  return `/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`;
}

async function openEditor(page: Page, documentUrl: string) {
  await page.goto(documentUrl);
  const surface = composer(page).getByRole("textbox", { name: "Content" });
  await expect(surface).toBeEditable(ROUND_TRIP);
  await surface.locator("p").first().click();
  await page.keyboard.press("Control+End");
  // ProseMirror learns of a caret the browser moved on `selectionchange`, a task later than the key.
  await page.waitForTimeout(150);
  return surface;
}

async function save(page: Page) {
  await expect(page.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "saved", ROUND_TRIP);
  const documentId = new URL(page.url()).pathname.split("/").at(-1);
  const exported = await page.request.get(`/api/documents/${documentId}/export`);
  expect(exported.ok()).toBe(true);
  return exported.text();
}

test.describe("typing rules and keys in the rendered editor", () => {
  test("a mark ends at its closing delimiter, and typographic replacements undo with one Backspace", async ({ page }) => {
    const workspaceId = await mySpace(page);
    const surface = await openEditor(page, await createNote(page, workspaceId, unique("Typing"), "Start"));
    await page.keyboard.press("Enter");
    await page.keyboard.type("**bold** plain *it* more");
    await expect(surface.locator("strong")).toHaveText("bold");
    await expect(surface.locator("em")).toHaveText("it");
    await expect(surface.locator("p").last()).toHaveText("bold plain it more");
    await page.keyboard.press("Enter");
    await page.keyboard.type("a -> b (c)");
    await expect(surface.locator("p").last()).toHaveText("a → b ©");
    await page.keyboard.press("Backspace");
    await expect(surface.locator("p").last()).toHaveText("a → b (c)");
    const markdown = await save(page);
    expect(markdown).toContain("**bold** plain *it* more");
  });

  test("[] makes a to-do item that saves as - [ ]", async ({ page }) => {
    const workspaceId = await mySpace(page);
    const surface = await openEditor(page, await createNote(page, workspaceId, unique("Todo"), "Start"));
    await page.keyboard.press("Enter");
    await page.keyboard.type("[] first");
    await expect(surface.locator("li[data-checked]")).toHaveCount(1);
    expect(await save(page)).toContain("- [ ] first");
  });

  test("Escape selects the block, Escape again returns to the text, Backspace removes the block, and links survive", async ({ page }) => {
    const stamp = unique("Escape");
    const workspaceId = await mySpace(page);
    const targetUrl = await createNote(page, workspaceId, `Target ${stamp}`, "The target.");
    expect(targetUrl).toBeTruthy();
    const surface = await openEditor(page, await createNote(page, workspaceId, `Source ${stamp}`, `Linked: see [[Target ${stamp}]].\n\nSecond.`));
    // Dirty first: Esc on an untouched document leaves the page, as the composer has always had it.
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("End");
    await page.keyboard.type(" Edited.");
    await page.keyboard.press("Escape");
    const selected = surface.locator(".ProseMirror-selectednode");
    await expect(selected).toHaveCount(1);
    await expect(selected).toContainText("Linked");
    await expect(selected).toHaveCSS("background-color", /^(?!rgba\(0, 0, 0, 0\))/);
    await page.keyboard.press("Escape");
    await expect(selected).toHaveCount(0);
    await page.keyboard.type("!");
    await expect(surface.locator("p").first()).toContainText("!Linked");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+Shift+ArrowDown");
    await expect(surface.locator("p").first()).toHaveText("Second.");
    await page.keyboard.press("Control+d");
    await expect(surface.locator("p")).toHaveCount(3);
    // The copy takes the caret; Escape selects it as a block, and Backspace removes it.
    await page.keyboard.press("Escape");
    await expect(selected).toHaveCount(1);
    await page.keyboard.press("Backspace");
    await expect(surface.locator("p")).toHaveCount(2);
    await expect(surface.locator("[data-kh-wiki-raw]")).toHaveCount(1);
    expect(await save(page)).toContain(`[[Target ${stamp}]]`);
  });

  test("Mod-a selects the block's text, then the whole document", async ({ page }) => {
    const workspaceId = await mySpace(page);
    const surface = await openEditor(page, await createNote(page, workspaceId, unique("SelectAll"), "First block\n\nSecond block"));
    await surface.locator("p").last().click();
    await page.waitForTimeout(150); // ProseMirror learns of a click's caret on `selectionchange`, a task later.
    const selection = () => page.evaluate(() => window.getSelection()?.toString() ?? "");
    await page.keyboard.press("Control+a");
    expect((await selection()).trim()).toBe("Second block");
    await page.keyboard.press("Control+a");
    const everything = await selection();
    expect(everything).toContain("First block");
    expect(everything).toContain("Second block");
    await expect(surface).toBeFocused();
  });

  test("Mod-Shift-8 makes a bulleted list and Backspace at a heading's start makes a paragraph", async ({ page }) => {
    const workspaceId = await mySpace(page);
    const surface = await openEditor(page, await createNote(page, workspaceId, unique("Keys"), "Item\n\n## Head"));
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("Control+Shift+8");
    await expect(surface.locator("ul > li")).toHaveCount(1);
    await surface.locator("h2").click();
    await page.keyboard.press("Home");
    // ProseMirror learns of a caret the browser moved on `selectionchange`, a task later than the key.
    await page.waitForTimeout(150);
    await page.keyboard.press("Backspace");
    await expect(surface.locator("h2")).toHaveCount(0);
    await expect(surface.locator(":scope > p")).toHaveText(["Head"]);
    await expect(surface.locator("ul > li")).toHaveCount(1);
  });
});
