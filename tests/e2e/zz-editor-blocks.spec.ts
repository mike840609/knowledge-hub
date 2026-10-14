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
