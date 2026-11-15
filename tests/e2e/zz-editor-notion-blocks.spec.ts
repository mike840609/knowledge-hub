import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/**
 * Toggle, table, code block and callout, driven the way a person drives them
 * (docs/superpowers/specs/2026-11-15-editor-notion-parity-design.md, decisions 17-20). Each is saved and read back
 * through export, links included. It writes into the E2E user's My Space, so it sorts last for the reasons
 * zz-wikilinks-composer.spec.ts gives.
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

test.describe("blocks in the rendered editor", () => {
  test("a toggle's chevron shares the summary's line, empty or filled, and Enter goes to the body", async ({ page }) => {
    const workspaceId = await mySpace(page);
    const target = unique("Target");
    const surface = await openEditor(page, await createNote(page, workspaceId, unique("Toggle line"), "Start"));
    await page.keyboard.press("Enter");
    await page.keyboard.type("/toggle");
    await page.getByRole("listbox").getByRole("option", { name: /toggle/i }).click();
    const summary = surface.locator("summary");
    // The caret is in the summary (the focused element is the editor; the caret says where in it).
    await expect.poll(() => page.evaluate(() => getSelection()?.anchorNode?.parentElement?.closest("summary") != null || getSelection()?.anchorNode?.nodeName === "SUMMARY")).toBe(true);
    const metrics = () => summary.evaluate((element) => {
      const style = getComputedStyle(element);
      const chevron = getComputedStyle(element, "::before");
      const lineHeight = parseFloat(style.lineHeight);
      const placeholder = getComputedStyle(element, "::after");
      return { height: element.getBoundingClientRect().height, lineHeight, chevronHeight: parseFloat(chevron.height), chevronTop: parseFloat(chevron.top), chevronPosition: chevron.position, placeholderPosition: placeholder.position, placeholderContent: placeholder.content };
    });
    // Empty: the placeholder and the chevron are on the one line the summary has.
    const empty = await metrics();
    expect(empty.height).toBeLessThanOrEqual(empty.lineHeight * 1.2);
    expect(empty.chevronPosition).toBe("absolute");
    expect(empty.placeholderContent).toContain("Details");
    expect(empty.placeholderPosition).toBe("absolute");
    // The chevron box is the first line's height, so it is centred on that line.
    expect(Math.abs(empty.chevronHeight - empty.lineHeight)).toBeLessThanOrEqual(1);
    expect(empty.chevronTop).toBe(0);
    await page.keyboard.type("Project notes");
    const filled = await metrics();
    expect(filled.height).toBeLessThanOrEqual(filled.lineHeight * 1.2);
    // Enter at the end of the summary goes into the body's first line.
    await page.keyboard.press("Enter");
    await page.keyboard.type(`See [[${target}]].`);
    await expect(surface.locator("details [data-details-body]")).toContainText(`See ${target}`);
    await page.screenshot({ path: test.info().outputPath("toggle-line.png") });
    const markdown = await save(page);
    expect(markdown).toContain("<summary>Project notes</summary>");
    expect(markdown).toContain(`[[${target}]]`);
    // Collapsed, then Enter at the end of the summary opens it first.
    await summary.click({ position: { x: 5, y: 8 } });
    await expect(surface.locator("details")).not.toHaveAttribute("open");
    await summary.click({ position: { x: 120, y: 8 } });
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect(surface.locator("details")).toHaveAttribute("open", "");
    await page.keyboard.type("!");
    await expect(surface.locator("details [data-details-body] p").first()).toContainText("!");
  });

  test("Tab in the last cell adds a row, Tab elsewhere does not", async ({ page }) => {
    const workspaceId = await mySpace(page);
    const target = unique("Target");
    const surface = await openEditor(page, await createNote(page, workspaceId, unique("Table tab"), `| A | B |\n| - | - |\n| one | two |\n\nSee [[${target}]]`));
    await surface.locator("td").first().click();
    await page.keyboard.press("Tab");
    await expect(surface.locator("tr")).toHaveCount(2);
    await page.keyboard.press("Tab");
    await expect(surface.locator("tr")).toHaveCount(3);
    await page.keyboard.type("three");
    await expect(surface.locator("tr").last().locator("td").first()).toHaveText("three");
    await expect(surface.locator("tr").last().locator("td")).toHaveCount(2);
    await page.keyboard.press("Shift+Tab");
    await expect(surface.locator("tr")).toHaveCount(3);
    const markdown = await save(page);
    expect(markdown).toContain("| three");
    expect(markdown).toContain(`[[${target}]]`);
  });

  test("the code block's language field and Tab keys work while editing", async ({ page }) => {
    const workspaceId = await mySpace(page);
    const target = unique("Target");
    const surface = await openEditor(page, await createNote(page, workspaceId, unique("Code language"), `Intro\n\n\`\`\`js\nconst a = 1;\n\`\`\`\n\nSee [[${target}]]`));
    await expect(surface.getByRole("combobox", { name: "Language" })).toHaveCount(0);
    await surface.getByRole("button", { name: "Edit code", exact: true }).click({ force: true });
    const language = surface.getByRole("combobox", { name: "Language" });
    await expect(language).toBeVisible();
    await expect(language.locator("option").first()).toHaveText("Plain text");
    await language.selectOption("python");
    // The caret went back to the code: Tab indents it, and Shift-Tab takes the indent off again.
    const raw = surface.locator("pre:not([data-inline-code-preview] pre) code");
    await raw.click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Tab");
    await expect(raw).toHaveText("  const a = 1;");
    await page.keyboard.press("Shift+Tab");
    await expect(raw).toHaveText("const a = 1;");
    await page.keyboard.press("Tab");
    // Tab stayed in the code block: focus did not leave it.
    await expect(raw).toHaveText("  const a = 1;");
    let markdown = await save(page);
    expect(markdown).toContain("```python\n  const a = 1;\n```");
    expect(markdown).toContain(`[[${target}]]`);
    await language.selectOption("");
    markdown = await save(page);
    expect(markdown).toContain("```\n  const a = 1;\n```");
  });

  test("the callout label opens a menu of kinds; Escape closes it before it selects the block", async ({ page }) => {
    const workspaceId = await mySpace(page);
    const target = unique("Target");
    const surface = await openEditor(page, await createNote(page, workspaceId, unique("Callout kind"), `> [!NOTE]\n> Careful with [[${target}]]\n\nAfter`));
    const label = surface.locator(".kh-callout-title button");
    await label.click();
    const menu = page.getByRole("menu", { name: "Callout type" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitemradio")).toHaveText(["Note", "Tip", "Important", "Warning", "Caution"]);
    await expect(menu.getByRole("menuitemradio", { name: "Note" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(label).toBeFocused();
    await expect(surface.locator(".ProseMirror-selectednode")).toHaveCount(0);
    await label.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    await expect(label).toHaveText("Important");
    const markdown = await save(page);
    expect(markdown).toMatch(/\\?\[!IMPORTANT\]/);
    expect(markdown).not.toContain("NOTE");
    expect(markdown).toContain(`[[${target}]]`);
    await page.reload();
    await expect(page.locator("article [data-callout]").first()).toHaveAttribute("data-callout", "important", ROUND_TRIP);
  });
});
