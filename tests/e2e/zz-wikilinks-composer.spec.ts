import { expect, test, type Page } from "@playwright/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/**
 * A document with a `[[wikilink]]`, opened and saved in the composer's rendered editor, must come
 * back with the link. Until the wikilink was a node of its own the editor wrote it back as
 * `\[\[x]]`: no link, so the link index, every backlink and the graph lost it on the first save.
 *
 * No test in this file types Markdown through the source view (`showMarkdown`). That is the point:
 * the specs that were adapted when the composer arrived did, so none of them ever ran the editor
 * that people actually get, and the defect went out with a green run.
 *
 * It creates documents that link to each other in the E2E user's own My Space, and the specs share
 * one database and run in file-name order, so where it sorts matters, twice over:
 *
 * - phase2.5-routing.spec.ts asserts that a fresh My Space is empty, so it must sort after that.
 * - workspace-graph.spec.ts draws My Space's graph and hovers a node in it, which depends on how
 *   the drawing lays out — more documents move the nodes, and a hover then lands on the canvas
 *   instead of the node (seen with this file's six documents, "svg intercepts pointer events").
 *   So it sorts after that too: last, which is what the name is for.
 *
 * It does not use the fixture workspace instead: workspace-graph.spec.ts asserts there that
 * nothing is linked.
 */

function unique(label: string) {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** main form + first(): the duplicate-DOM quirk phase5-authoring.spec.ts documents. */
function composer(page: Page) {
  return page.locator("main form").first();
}

/** The rendered editing surface. */
function surfaceOf(page: Page) {
  return composer(page).getByRole("textbox", { name: "Content" });
}

/** The E2E user's own My Space. */

/** Creates a note through the API — these tests are about the editor, not the new-document page — and returns its URL. */
async function createNote(page: Page, workspaceId: string, title: string, markdown: string) {
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  return `/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`;
}

/** Opens a document in the composer and returns the rendered surface once it can be typed into. */
async function openEditor(page: Page, documentUrl: string) {
  await page.goto(`${documentUrl}/edit`);
  const surface = surfaceOf(page);
  await expect(surface).toBeEditable(ROUND_TRIP);
  return surface;
}

/** The next request that writes a document, as the page sends it. */
function nextWrite(page: Page, method: "PATCH" | "POST") {
  return page.waitForRequest((request) => request.method() === method && /\/api\/(documents\/|workspaces\/[^/]+\/documents$)/.test(request.url()), ROUND_TRIP);
}

function sentMarkdown(request: Awaited<ReturnType<typeof nextWrite>>) {
  return (JSON.parse(request.postData() ?? "{}") as { markdown?: string }).markdown ?? "";
}

/** The target's page says who links to it — read from the link index the save just wrote. */
async function expectBacklinkFrom(page: Page, targetUrl: string) {
  await page.goto(targetUrl);
  await expect(page.locator("[data-backlinks]").getByRole("heading", { name: "Linked from 1 document" })).toBeVisible(ROUND_TRIP);
}

test.describe("wikilinks in the rendered editor", () => {
  test("a document with wikilinks keeps them when it is edited and saved", async ({ page }) => {
    const stamp = unique("Edit");
    const target = `Target ${stamp}`;
    const workspaceId = await mySpace(page);
    const targetUrl = await createNote(page, workspaceId, target, "The target document.");
    const sourceUrl = await createNote(page, workspaceId, `Source ${stamp}`, `Intro line.\n\nSee [[${target}]] for details, and [[${target}|the alias]].`);

    const surface = await openEditor(page, sourceUrl);
    // Held as links, not as text: two nodes, showing the target and the alias, read as links.
    const links = surface.locator("span.kh-wikilink");
    await expect(links).toHaveCount(2);
    await expect(links.nth(0)).toHaveText(target);
    await expect(links.nth(1)).toHaveText("the alias");
    await expect(links.nth(0)).toHaveCSS("text-decoration-line", "underline");
    await expect(links.nth(0)).toHaveCSS("font-weight", "500");
    // The reader's link colour, and not the text's.
    const colours = await links.nth(0).evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--kh-link)";
      document.body.appendChild(probe);
      const link = getComputedStyle(probe).color;
      probe.remove();
      return { shown: getComputedStyle(element).color, link, text: getComputedStyle(element.closest("p")!).color };
    });
    expect(colours.shown).toBe(colours.link);
    expect(colours.shown).not.toBe(colours.text);

    // Edit the text beside them, and save.
    await surface.locator("p").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" (edited)");
    const saved = nextWrite(page, "PATCH");
    await composer(page).getByRole("button", { name: "Save" }).click();

    // What is sent is what gets indexed: the links as written, never `\[`.
    const markdown = sentMarkdown(await saved);
    expect(markdown).toContain("Intro line. (edited)");
    expect(markdown).toContain(`[[${target}]]`);
    expect(markdown).toContain(`[[${target}|the alias]]`);
    expect(markdown).not.toContain("\\[");

    // The reader shows them as links that go somewhere, and the target lists the source.
    await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
    const article = page.locator("article").first();
    await expect(article.getByRole("link", { name: target, exact: true })).toBeVisible(ROUND_TRIP);
    await expect(article.getByRole("link", { name: "the alias" })).toBeVisible(ROUND_TRIP);
    await expectBacklinkFrom(page, targetUrl);
  });

  test("a wikilink typed in the rendered editor is saved as a link", async ({ page }) => {
    const stamp = unique("Typed");
    const target = `Target ${stamp}`;
    const workspaceId = await mySpace(page);
    const targetUrl = await createNote(page, workspaceId, target, "The target document.");

    await page.goto(`/w/${workspaceId}/knowledge/new`);
    await composer(page).getByLabel("Title", { exact: true }).fill(`Source ${stamp}`);
    const surface = surfaceOf(page);
    await expect(surface).toBeEditable(ROUND_TRIP);
    await surface.click();
    await page.keyboard.type(`See [[${target}]] for details.`);

    // The closing brackets turned it into a node, and the rest of the sentence went on after it.
    await expect(surface.locator("span.kh-wikilink")).toHaveText(target);
    await expect(surface.locator("p").first()).toHaveText(`See ${target} for details.`);

    const created = nextWrite(page, "POST");
    await composer(page).getByRole("button", { name: "Create document" }).click();
    const markdown = sentMarkdown(await created);
    expect(markdown).toContain(`See [[${target}]] for details.`);
    expect(markdown).not.toContain("\\[");

    await expect(page).not.toHaveURL(/\/new$/, ROUND_TRIP);
    await expect(page.locator("article").first().getByRole("link", { name: target, exact: true })).toBeVisible(ROUND_TRIP);
    await expectBacklinkFrom(page, targetUrl);
  });

  test("wikilinks in pasted text become links", async ({ page }) => {
    const stamp = unique("Pasted");
    await page.goto(`/w/${await mySpace(page)}/knowledge/new`);
    await composer(page).getByLabel("Title", { exact: true }).fill(`Source ${stamp}`);
    const surface = surfaceOf(page);
    await expect(surface).toBeEditable(ROUND_TRIP);
    await surface.click();
    // A paste as the browser delivers it: plain text on the clipboard.
    await surface.evaluate((element, text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, `see [[Alpha ${stamp}]] and [[Beta ${stamp}|the beta]] and ![[Embed ${stamp}]] and \\[\\[Escaped ${stamp}\\]\\]`);

    const links = surface.locator("span.kh-wikilink");
    await expect(links).toHaveCount(2);
    await expect(links.nth(0)).toHaveText(`Alpha ${stamp}`);
    await expect(links.nth(1)).toHaveText("the beta");
    // An embed and an escaped one stay what they were: text.
    await expect(surface.locator("p").first()).toContainText(`![[Embed ${stamp}]]`);
    await expect(surface.locator("p").first()).toContainText(`\\[\\[Escaped ${stamp}\\]\\]`);
  });

  test("Backspace right after a wikilink removes all of it, and undo brings it back", async ({ page }) => {
    const stamp = unique("Backspace");
    await page.goto(`/w/${await mySpace(page)}/knowledge/new`);
    const surface = surfaceOf(page);
    await expect(surface).toBeEditable(ROUND_TRIP);
    await surface.click();
    await page.keyboard.type(`a [[Note ${stamp}]] b`);
    const links = surface.locator("span.kh-wikilink");
    await expect(links).toHaveCount(1);

    // The caret is at the end: over "b" and the space, and it is right after the link.
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Backspace");
    await expect(links).toHaveCount(0);
    await expect(surface.locator("p").first()).toHaveText("a  b");

    await page.keyboard.press("ControlOrMeta+z");
    await expect(links).toHaveCount(1);
    await expect(surface.locator("p").first()).toHaveText(`a Note ${stamp} b`);
  });

  test("clicking a wikilink selects it as a whole, and goes nowhere from the editor", async ({ page }) => {
    const stamp = unique("Click");
    // The target exists, so the link is one that could be followed — and still is not, from here.
    const workspaceId = await mySpace(page);
    await createNote(page, workspaceId, `Target ${stamp}`, "The target document.");
    const sourceUrl = await createNote(page, workspaceId, `Source ${stamp}`, `See [[Target ${stamp}]] here.`);
    const surface = await openEditor(page, sourceUrl);
    const link = surface.locator("span.kh-wikilink");
    await expect(link).toHaveCount(1);

    await link.click();
    await expect(surface.locator(".ProseMirror-selectednode")).toHaveCount(1);
    // Selected, it takes the selection colour; a draft has no resolutions, so it is not followed from here.
    const backgrounds = await link.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.backgroundColor = "var(--kh-bg-selected)";
      document.body.appendChild(probe);
      const selected = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { shown: getComputedStyle(element).backgroundColor, selected };
    });
    expect(backgrounds.shown).toBe(backgrounds.selected);
    await expect(page).toHaveURL(new RegExp(`${sourceUrl}/edit$`));
  });
});
