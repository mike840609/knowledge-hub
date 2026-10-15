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

/** main form + first(): the duplicate-DOM quirk phase5-authoring.spec.ts documents. */
function composer(page: Page) {
  return page.locator("main form").first();
}

async function createNote(page: Page, workspaceId: string, title: string, markdown: string) {
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  return `/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`;
}

async function openEditor(page: Page, documentUrl: string) {
  await page.goto(`${documentUrl}/edit`);
  const surface = composer(page).getByRole("textbox", { name: "Content" });
  await expect(surface).toBeEditable(ROUND_TRIP);
  // The composer puts the caret at the start once the editor has loaded. Keys and clicks that come
  // straight after can be lost to it (seen on main as well), so these tests never place the caret
  // themselves: they act on the block it starts in.
  await expect(surface).toBeFocused(ROUND_TRIP);
  return surface;
}

/** Saves, and returns the Markdown the page sent. */
async function save(page: Page) {
  const sent = page.waitForRequest((request) => request.method() === "PATCH" && /\/api\/documents\//.test(request.url()), ROUND_TRIP);
  await composer(page).getByRole("button", { name: "Save" }).click();
  const markdown = (JSON.parse((await sent).postData() ?? "{}") as { markdown?: string }).markdown ?? "";
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
  return markdown;
}

test.describe("blocks in the rendered editor", () => {
  test("the editor lays the page out as the reader does, from the title to the text", async ({ page }) => {
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
        const article = page.locator("main article");
        await expect(article.locator("p").first()).toBeVisible();
        const read = {
          title: await box(page.locator("main header h1")),
          h1: await box(article.locator("h1")),
          text: await box(article.locator("p")),
          heading: await box(article.locator("h2")),
        };
        const surface = await openEditor(page, url);
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

  test("Details open while reading stays open while editing, and the text beside it stays put", async ({ page }) => {
    const stamp = unique("Details");
    const workspaceId = await mySpace(page);
    const url = await createNote(page, workspaceId, `Details ${stamp}`, "A paragraph long enough to fill the measure of the reading column, so its width says where the column ends as well as where it begins.");
    const panel = page.getByRole("complementary", { name: "Document details", exact: true });
    const text = async (locator: ReturnType<Page["locator"]>) => {
      const found = await locator.first().boundingBox();
      return found && { x: Math.round(found.x), y: Math.round(found.y), width: Math.round(found.width) };
    };
    // Leave once by each way out: both return to the reader through the client router.
    for (const [width, leave] of [[1600, "Cancel"], [1920, "Save"]] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      await expect(page.locator("main article p").first()).toBeVisible(ROUND_TRIP);
      await page.getByRole("button", { name: "Details", exact: true }).first().click();
      await expect(panel).toBeVisible();
      const read = await text(page.locator("main article p"));
      await page.getByRole("link", { name: "Edit" }).first().click();
      const surface = composer(page).getByRole("textbox", { name: "Content" });
      await expect(surface).toBeFocused(ROUND_TRIP);
      await expect(panel).toBeVisible();
      expect(await text(surface.locator("p")), `editing at ${width}px`).toEqual(read);
      await composer(page).getByRole("button", { name: leave, exact: true }).click();
      await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
      await expect(panel).toBeVisible();
      expect(await text(page.locator("main article p")), `back after ${leave} at ${width}px`).toEqual(read);
    }
  });

  test("a paragraph with a wikilink is moved from the keyboard, and the saved document still links", async ({ page }) => {
    const stamp = unique("Move");
    const target = `Target ${stamp}`;
    const workspaceId = await mySpace(page);
    const targetUrl = await createNote(page, workspaceId, target, "The target document.");
    const sourceUrl = await createNote(page, workspaceId, `Source ${stamp}`, `Linked: see [[${target}]].\n\nSecond paragraph.`);

    const surface = await openEditor(page, sourceUrl);
    await expect(surface.locator("span.kh-wikilink")).toHaveCount(1);
    await page.keyboard.press("Alt+F10");
    await expect(page.getByRole("button", { name: "Add paragraph below" })).toBeFocused();
    await page.getByRole("button", { name: "Move block" }).click();
    await page.getByRole("menuitem", { name: "Move down" }).click();
    await expect(surface.locator("p").first()).toHaveText("Second paragraph.");
    await expect(surface.locator("span.kh-wikilink")).toHaveCount(1);

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

    const surface = await openEditor(page, url);
    // A new empty line from the block controls, below the paragraph the caret is in.
    await page.keyboard.press("Alt+F10");
    await page.getByRole("button", { name: "Add paragraph below" }).click();
    await expect(surface).toBeFocused();
    // The empty line says which key to press; the document's own empty-state sentence is not it.
    await expect(surface.locator("p[data-placeholder]")).toHaveCount(1);
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
  await page.keyboard.type(`See [[${target}]].`);
  const summary = surface.locator("summary");
  await summary.click({ position: { x: 22, y: 8 } });
  await page.keyboard.type("Project notes");
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
