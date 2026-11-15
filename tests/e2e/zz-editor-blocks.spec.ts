import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/**
 * The block controls and the "/" list of the rendered editor. Both rewrite the document through the
 * editor people get, so both are held to the wikilink rule: what is saved is read back, links
 * included. Nothing here types through the Markdown source view.
 *
 * It writes linked documents into the E2E user's My Space, so it sorts last for the reasons
 * zz-wikilinks-composer.spec.ts gives.
 */

function unique(label: string) {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** The inline document and new-note composer share the main landmark. */
function composer(page: Page) {
  return page.locator("main");
}

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
  await page.keyboard.press("Home");
  return surface;
}

/** Wait for autosave, then read the persisted Markdown through export. */
async function save(page: Page) {
  await expect(page.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "saved", ROUND_TRIP);
  const documentId = new URL(page.url()).pathname.split("/").at(-1);
  const exported = await page.request.get(`/api/documents/${documentId}/export`);
  expect(exported.ok()).toBe(true);
  return exported.text();
}

test.describe("blocks in the rendered editor", () => {
  test("focusing the inline editor preserves the reading layout from title to text", async ({ page }) => {
    const stamp = unique("Measure");
    const workspaceId = await mySpace(page);
    const prose = "A paragraph long enough to fill the measure of the reading column, so its width says where the column ends as well as where it begins.";
    const sections = `${prose}\n\n## First part\n\n${prose}\n\n## Second part\n\n${prose}`;
    // One with the title above the text, one whose text opens with its own # heading.
    const typed = await createNote(page, workspaceId, `Measure ${stamp}`, sections);
    const owned = await createNote(page, workspaceId, `Owned ${stamp}`, `# Owned ${stamp}\n\n${sections}`);
    const box = async (locator: ReturnType<Page["locator"]>) => {
      if ((await locator.count()) === 0) return null;
      const found = await locator.first().boundingBox();
      return found && { x: Math.round(found.x), y: Math.round(found.y), width: Math.round(found.width) };
    };
    // A phone; a pane narrow enough for the outline to sit above the text; wide enough for its rail; very wide.
    for (const width of [390, 1100, 1600, 2560]) {
      for (const url of [typed, owned]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(url);
        const surface = composer(page).getByRole("textbox", { name: "Content" });
        await expect(surface).toBeEditable(ROUND_TRIP);
        const article = page.locator("main article");
        await expect(article.locator("p").first()).toBeVisible();
        const read = {
          title: await box(composer(page).getByRole("textbox", { name: "Title" })),
          h1: await box(article.locator("h1")),
          text: await box(article.locator("p")),
          heading: await box(article.locator("h2")),
        };
        await surface.locator("p").first().click();
        const edit = {
          title: await box(composer(page).getByRole("textbox", { name: "Title" })),
          h1: await box(surface.locator("h1")),
          text: await box(surface.locator("p")),
          heading: await box(surface.locator("h2")),
        };
        expect(read.text, `at ${width}px`).not.toBeNull();
        expect(edit, `${url} at ${width}px`).toEqual(read);
      }
    }
  });

  test("with both sidebars open, the block controls sit left of the text at 1440px and wider, where reading puts it", async ({ page }) => {
    const stamp = unique("Gutter");
    const workspaceId = await mySpace(page);
    const prose = "A paragraph long enough to fill the measure of the reading column, so its width says where the column ends as well as where it begins.";
    const url = await createNote(page, workspaceId, `Gutter ${stamp}`, `${prose}\n\n## A heading\n\n${prose}`);
    const box = async (locator: ReturnType<Page["locator"]>) => {
      const found = await locator.first().boundingBox();
      return found && { x: Math.round(found.x), y: Math.round(found.y), width: Math.round(found.width) };
    };
    for (const width of [1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      // The default layout: the primary nav and the explorer both open.
      await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
      await expect(page.getByRole("complementary", { name: "Knowledge explorer" })).toBeVisible();
      const surface = composer(page).getByRole("textbox", { name: "Content" });
      await expect(surface).toBeEditable(ROUND_TRIP);
      const article = page.locator("main article");
      await expect(article.locator("p").first()).toBeVisible();
      const read = { text: await box(article.locator("p")), heading: await box(article.locator("h2")) };
      await surface.locator("p").first().click();
      const edit = { text: await box(surface.locator("p")), heading: await box(surface.locator("h2")) };
      expect(edit, `at ${width}px`).toEqual(read);

      const pane = (await page.getByRole("region", { name: "Document content" }).boundingBox())!;
      const gutter = page.getByRole("group", { name: "Block actions" });
      for (const block of [surface.locator("p").first(), surface.locator("h2")]) {
        const text = (await block.boundingBox())!;
        await page.mouse.move(text.x - 20, text.y + Math.min(10, text.height / 2));
        await expect(gutter).toBeVisible();
        const controls = (await gutter.boundingBox())!;
        // Both controls stand in the gutter: inside the pane, and wholly left of the text.
        expect(controls.x, `at ${width}px`).toBeGreaterThanOrEqual(pane.x);
        expect(controls.x + controls.width, `at ${width}px`).toBeLessThanOrEqual(text.x);
        await expect(page.getByRole("button", { name: "Add paragraph below" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Move block" })).toBeVisible();
      }
    }
  });

  test("Details open while reading stays open while editing, and the text beside it stays put", async ({ page }) => {
    const stamp = unique("Details");
    const workspaceId = await mySpace(page);
    const url = await createNote(page, workspaceId, `Details ${stamp}`, "A paragraph long enough to fill the measure of the reading column, so its width says where the column ends as well as where it begins.");
    const panel = page.getByRole("complementary", { name: "Document details", exact: true });
    const text = async (locator: ReturnType<Page["locator"]>) => {
      const found = await locator.first().boundingBox();
      return found && { x: Math.round(found.x), y: Math.round(found.y), width: Math.round(found.width) };
    };
    for (const width of [1600, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      await expect(composer(page).getByRole("textbox", { name: "Content" })).toBeEditable(ROUND_TRIP);
      await page.getByRole("button", { name: "Details", exact: true }).first().click();
      await expect(panel).toBeVisible();
      const read = await text(page.locator("main article p"));
      const surface = composer(page).getByRole("textbox", { name: "Content" });
      await surface.locator("p").first().click();
      await expect(surface).toBeFocused(ROUND_TRIP);
      await expect(panel).toBeVisible();
      expect(await text(surface.locator("p")), `editing at ${width}px`).toEqual(read);
      await page.keyboard.press("End");
      await page.keyboard.type(" Saved inline.");
      await save(page);
      await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
      await expect(panel).toBeVisible();
      expect(await text(page.locator("main article p")), `after autosave at ${width}px`).toEqual(read);
    }
  });

  test("a paragraph with a wikilink is moved from the keyboard, and the saved document still links", async ({ page }) => {
    const stamp = unique("Move");
    const target = `Target ${stamp}`;
    const workspaceId = await mySpace(page);
    const targetUrl = await createNote(page, workspaceId, target, "The target document.");
    const sourceUrl = await createNote(page, workspaceId, `Source ${stamp}`, `Linked: see [[${target}]].\n\nSecond paragraph.`);

    const surface = await openEditor(page, sourceUrl);
    await expect(surface.locator("[data-kh-wiki-raw]")).toHaveCount(1);
    await page.keyboard.press("Alt+F10");
    await expect(page.getByRole("button", { name: "Add paragraph below" })).toBeFocused();
    await page.getByRole("button", { name: "Move block" }).click();
    await page.getByRole("menuitem", { name: "Move down" }).click();
    await expect(surface.locator("p").first()).toHaveText("Second paragraph.");
    await expect(surface.locator("[data-kh-wiki-raw]")).toHaveCount(1);

    const markdown = await save(page);
    expect(markdown.indexOf("Second paragraph.")).toBeLessThan(markdown.indexOf(`[[${target}]]`));
    expect(markdown).toContain(`Linked: see [[${target}]].`);
    expect(markdown).not.toContain("\\[");

    await expect(page.locator("article").first().getByRole("link", { name: target, exact: true })).toBeVisible(ROUND_TRIP);
    await page.goto(targetUrl);
    await expect(page.locator("[data-backlinks]").getByRole("heading", { name: "Linked from 1 document" })).toBeVisible(ROUND_TRIP);
  });

  test('"/" on an empty line lists the blocks, and the pick is saved as Markdown', async ({ page }) => {
    const workspaceId = await mySpace(page);
    const url = await createNote(page, workspaceId, unique("Slash"), "Opening line.");

    await openEditor(page, url);
    // By its label, not its role: it is a combobox, not a textbox, while the list is open.
    const surface = composer(page).locator('.ProseMirror[aria-label="Content"]');
    // A new empty line from the block controls, below the paragraph the caret is in.
    await page.keyboard.press("Alt+F10");
    await page.getByRole("button", { name: "Add paragraph below" }).click();
    await expect(surface).toBeFocused();
    // + has opened the list already; Escape leaves the empty line, which says which key to press
    // (the document's own empty-state sentence is not it).
    await page.keyboard.press("Escape");
    await expect(surface.locator("p[data-placeholder]")).toHaveAttribute("data-placeholder", 'Type "/" for commands');
    await page.keyboard.type("/quo");
    const list = page.getByRole("listbox");
    await expect(list.getByRole("option")).toHaveCount(1);
    await expect(list.getByRole("option", { name: /Quote/ })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(list).toBeHidden();
    await page.keyboard.type("Quoted words");
    await expect(surface.locator("blockquote")).toHaveText("Quoted words");

    const markdown = await save(page);
    expect(markdown).toContain("Opening line.");
    expect(markdown).toContain("> Quoted words");
    expect(markdown).not.toContain("/quo");
    await expect(page.locator("article").first().locator("blockquote")).toHaveText("Quoted words", ROUND_TRIP);
  });
});


test("+ opens the \"/\" list on the new line; Escape leaves the line empty, and a pick saves with its links", async ({ page }) => {
  const stamp = unique("Plus");
  const target = `Target ${stamp}`;
  const workspaceId = await mySpace(page);
  const targetUrl = await createNote(page, workspaceId, target, "The target document.");
  const url = await createNote(page, workspaceId, `Plus ${stamp}`, `Linked: see [[${target}]].`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page, url);
  // By its label, not its role: it is a combobox, not a textbox, while the list is open.
  const surface = composer(page).locator('.ProseMirror[aria-label="Content"]');
  const list = page.getByRole("listbox", { name: "Block commands" });
  const paragraph = surface.locator("p").first();
  const text = (await paragraph.boundingBox())!;

  // The pointer's way: hover the gutter, then +.
  await page.mouse.move(text.x - 20, text.y + 10);
  await page.getByRole("button", { name: "Add paragraph below" }).click();
  await expect(list).toBeVisible();
  await expect(surface).toBeFocused();
  await expect(surface).toHaveAttribute("aria-controls", (await list.getAttribute("id"))!);
  await expect(surface.locator("p")).toHaveCount(2);
  await expect(surface.locator("p").nth(1)).toHaveText("");
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  // Nothing was typed to take back: the line is empty and the caret is in it.
  await expect(surface.locator("p")).toHaveCount(2);
  await expect(surface.locator("p").nth(1)).toHaveText("");
  await page.keyboard.type("Written after Escape.");
  await expect(surface.locator("p").nth(1)).toHaveText("Written after Escape.");
  await expect(list).toBeHidden();

  // The keyboard's way: Alt+F10, then + — and what is typed filters, with no "/" in front.
  await page.keyboard.press("Alt+F10");
  await page.keyboard.press("Enter");
  await expect(list).toBeVisible();
  await page.keyboard.type("h2");
  await expect(list.getByRole("option")).toHaveCount(1);
  await expect(list.getByRole("option", { name: /Heading 2/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(list).toBeHidden();
  await page.keyboard.type("Picked heading");
  await expect(surface.locator("h2")).toHaveText("Picked heading");

  const markdown = await save(page);
  expect(markdown).toContain(`Linked: see [[${target}]].`);
  expect(markdown).toContain("Written after Escape.");
  expect(markdown).toContain("## Picked heading");
  expect(markdown).not.toMatch(/^\/|h2Picked|\\\[/m);
  await page.goto(targetUrl);
  await expect(page.locator("[data-backlinks]").getByRole("heading", { name: "Linked from 1 document" })).toBeVisible(ROUND_TRIP);
});

test("slash blocks render while editing and survive save and reopen", async ({ page }, testInfo) => {
  const workspaceId = await mySpace(page);
  const stamp = unique("Rendered blocks");
  const target = `Target ${stamp}`;
  const targetUrl = await createNote(page, workspaceId, target, "Link target.");
  const url = await createNote(page, workspaceId, stamp, "Opening paragraph.");
  let surface = await openEditor(page, url);
  async function insert(query: string) {
    await page.keyboard.press("Alt+F10");
    await page.getByRole("button", { name: "Add paragraph below" }).click();
    await page.keyboard.type(`/${query}`);
    await page.getByRole("listbox").getByRole("option", { name: new RegExp(query, "i") }).click();
  }
  await insert("toggle");
  await expect(surface.locator("details")).toHaveAttribute("open", "");
  // The caret starts in the summary; Enter at its end goes to the body.
  await page.keyboard.type("Project notes");
  await page.keyboard.press("Enter");
  await page.keyboard.type(`See [[${target}]].`);
  const summary = surface.locator("summary");
  await summary.click({ position: { x: 5, y: 8 } });
  await expect(surface.locator("details")).not.toHaveAttribute("open");
  await summary.click({ position: { x: 5, y: 8 } });
  await expect(surface.locator("details")).toHaveAttribute("open", "");
  await insert("callout");
  await page.keyboard.type("A useful note.");
  await expect(surface.locator(".kh-callout-title")).toHaveText("Note");
  await expect(surface.locator(".kh-callout-marker")).toBeHidden();
  await insert("table");
  await page.keyboard.type("Task");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Status");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Rendering");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Ready");
  await expect(surface.locator("table th")).toHaveText(["Task", "Status"]);
  await expect(surface.locator("table tr").nth(1).locator("td")).toHaveText(["Rendering", "Ready"]);
  await expect(page.getByRole("group", { name: "Table actions" })).toBeVisible();
  await page.getByRole("button", { name: "Add row below" }).click();
  await expect(surface.locator("table tr")).toHaveCount(3);
  await page.getByRole("button", { name: "Add column right" }).click();
  await expect(surface.locator("table tr")).toHaveCount(3);
  await expect(surface.locator("table tr").first().locator("th")).toHaveCount(3);
  await expect(surface.locator("table tr").last().locator("td")).toHaveCount(3);
  const editHeight = (await surface.locator("th").first().boundingBox())!.height;
  await page.screenshot({ path: testInfo.outputPath("rendered-blocks-desktop.png"), fullPage: true });
  const markdown = await save(page);
  expect(markdown).toContain(`<summary>Project notes</summary>`);
  expect(markdown).toContain(`[[${target}]]`);
  expect(markdown).toContain("| Task");
  const article = page.locator("article").first();
  await expect(article.getByRole("link", { name: target, exact: true })).toBeVisible(ROUND_TRIP);
  await expect(article.locator("[data-callout]")).toContainText("A useful note.");
  await expect(article.locator("table tr")).toHaveCount(3);
  await expect(article.locator("table tr").first().locator("th")).toHaveCount(3);
  const readHeight = (await article.locator("th").first().boundingBox())!.height;
  expect(Math.abs(editHeight - readHeight)).toBeLessThanOrEqual(1);
  surface = await openEditor(page, url);
  await expect(surface.locator("summary")).toHaveText("Project notes");
  await expect(surface.locator("table tr").nth(1).locator("td").first()).toHaveText("Rendering");
  await expect(surface.locator("table tr")).toHaveCount(3);
  await expect(surface.locator("table tr").first().locator("th")).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(surface.locator(".kh-markdown-table")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("rendered-blocks-mobile.png"), fullPage: true });
  await page.goto(targetUrl);
  await expect(page.locator("[data-backlinks]").getByRole("heading", { name: "Linked from 1 document" })).toBeVisible(ROUND_TRIP);
});
