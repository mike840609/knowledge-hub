import { expect, test, type Page } from "./fixtures/test";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/**
 * The `[[` list in the rendered editor (daily-driver spec §6.1), in a real browser: where it is
 * put, what the keys do, that a pick is saved as a link the target then lists as a backlink.
 *
 * As in zz-wikilinks-composer.spec.ts, nothing here types Markdown through the source view: the
 * rendered editor is the one whose behaviour is under test, and the source view never runs it.
 * It creates documents in the E2E user's own My Space, and sorts where that file does, for the
 * same two reasons (phase2.5-routing's empty My Space, workspace-graph's node layout).
 *
 * Titles start with a per-run stamp so that what is typed narrows the list to this test's own
 * documents, whatever the other specs left in the workspace.
 */

function unique(label: string) {
  return `${label}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const composer = (page: Page) => page.locator("main form").first();
const surfaceOf = (page: Page) => composer(page).getByRole("textbox", { name: "Content" });
const listboxOf = (page: Page) => page.getByRole("listbox", { name: "Documents to link to" });
const optionsOf = (page: Page) => listboxOf(page).getByRole("option");

async function mySpace(page: Page): Promise<string> {
  await page.goto("/");
  await page.waitForURL(/\/w\/[^/]+\/knowledge/);
  return new URL(page.url()).pathname.split("/")[2];
}

async function createNote(page: Page, workspaceId: string, title: string, markdown = "A document to link to.") {
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  return `/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`;
}

/** The new-document page, with the editor ready and the caret in it. */
async function startWriting(page: Page, workspaceId: string, title: string) {
  await page.goto(`/w/${workspaceId}/knowledge/new`);
  await composer(page).getByLabel("Title", { exact: true }).fill(title);
  const surface = surfaceOf(page);
  await expect(surface).toBeEditable(ROUND_TRIP);
  await surface.click();
  return surface;
}

function nextWrite(page: Page, method: "PATCH" | "POST") {
  return page.waitForRequest((request) => request.method() === method && /\/api\/(documents\/|workspaces\/[^/]+\/documents$)/.test(request.url()), ROUND_TRIP);
}
const sentMarkdown = (request: Awaited<ReturnType<typeof nextWrite>>) => (JSON.parse(request.postData() ?? "{}") as { markdown?: string }).markdown ?? "";

async function expectBacklinkFrom(page: Page, targetUrl: string) {
  await page.goto(targetUrl);
  await expect(page.locator("[data-backlinks]").getByRole("heading", { name: "Linked from 1 document" })).toBeVisible(ROUND_TRIP);
}

/** Where the caret is, in the viewport: the list is placed from it. */
const caretRect = (page: Page) =>
  page.evaluate(() => {
    const range = getSelection()!.getRangeAt(0).cloneRange();
    range.collapse(false);
    const rects = range.getClientRects();
    const rect = rects.length ? rects[rects.length - 1] : (range.startContainer as Element).getBoundingClientRect?.() ?? range.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
  });

test.describe("the `[[` list", () => {
  test("offers documents while a link is typed; Enter makes the pick a link that is saved, and the target lists it", async ({ page }) => {
    const stamp = unique("Pick");
    const workspaceId = await mySpace(page);
    const targetUrl = await createNote(page, workspaceId, `${stamp} Kubernetes upgrade`);
    const surface = await startWriting(page, workspaceId, `Source ${stamp}`);

    await page.keyboard.type("See [[");
    await expect(listboxOf(page)).toBeVisible();
    await page.keyboard.type(`${stamp} kube`);
    await expect(optionsOf(page)).toHaveCount(1);
    await expect(optionsOf(page).first()).toContainText(`${stamp} Kubernetes upgrade`);
    // The editor says what it is now: a combobox that points at the row in force. (Found by its label, not
    // its role: `surface` looks for a textbox, which it is not while the list is open.)
    const editor = composer(page).locator('.ProseMirror[aria-label="Content"]');
    await expect(editor).toHaveAttribute("role", "combobox");
    await expect(editor).toHaveAttribute("aria-expanded", "true");
    await expect(optionsOf(page).first()).toHaveAttribute("aria-selected", "true");
    await expect(editor).toHaveAttribute("aria-activedescendant", (await optionsOf(page).first().getAttribute("id"))!);

    await page.keyboard.press("Enter");
    await expect(listboxOf(page)).toBeHidden();
    await expect(surface.locator("span.kh-wikilink")).toHaveText(`${stamp} Kubernetes upgrade`);
    await expect(editor).not.toHaveAttribute("role", "combobox");
    await expect(editor).not.toHaveAttribute("aria-expanded", /.*/);
    // The caret is after the link: what is typed next goes on from there.
    await page.keyboard.type(" for the plan.");
    await expect(surface.locator("p").first()).toHaveText(`See ${stamp} Kubernetes upgrade for the plan.`);

    const created = nextWrite(page, "POST");
    await composer(page).getByRole("button", { name: "Create document" }).click();
    const markdown = sentMarkdown(await created);
    expect(markdown).toContain(`See [[${stamp} Kubernetes upgrade]] for the plan.`);
    expect(markdown).not.toContain("\\[");

    await expect(page).not.toHaveURL(/\/new$/, ROUND_TRIP);
    await expect(page.locator("article").first().getByRole("link", { name: `${stamp} Kubernetes upgrade`, exact: true })).toBeVisible(ROUND_TRIP);
    await expectBacklinkFrom(page, targetUrl);
  });

  test("the arrow keys choose, Tab picks, and a click picks too", async ({ page }) => {
    const stamp = unique("Keys");
    const workspaceId = await mySpace(page);
    await createNote(page, workspaceId, `${stamp} Alpha`);
    await createNote(page, workspaceId, `${stamp} Beta`);
    const surface = await startWriting(page, workspaceId, `Source ${stamp}`);

    await page.keyboard.type(`[[${stamp}`);
    await expect(optionsOf(page)).toHaveCount(2);
    // Newest first.
    await expect(optionsOf(page).nth(0)).toContainText("Beta");
    await expect(optionsOf(page).nth(0)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(optionsOf(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(optionsOf(page).nth(0)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Tab");
    await expect(surface.locator("span.kh-wikilink")).toHaveText(`${stamp} Alpha`);

    // A click, on the second row, with the caret staying where it was.
    await page.keyboard.type(` and [[${stamp}`);
    await expect(optionsOf(page)).toHaveCount(2);
    await optionsOf(page).nth(0).click();
    await expect(surface.locator("span.kh-wikilink")).toHaveText([`${stamp} Alpha`, `${stamp} Beta`]);
    await page.keyboard.type(" done");
    await expect(surface.locator("p").first()).toHaveText(`${stamp} Alpha and ${stamp} Beta done`);
  });

  test("Esc closes the list and nothing else: the text stays, and the page is not left", async ({ page }) => {
    const stamp = unique("Esc");
    const workspaceId = await mySpace(page);
    await createNote(page, workspaceId, `${stamp} Note`);
    const surface = await startWriting(page, workspaceId, `Source ${stamp}`);
    const url = page.url();

    await page.keyboard.type(`[[${stamp}`);
    await expect(listboxOf(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(listboxOf(page)).toBeHidden();
    await expect(page).toHaveURL(url);
    await expect(surface.locator("p").first()).toHaveText(`[[${stamp}`);
    // Typing on does not bring it back; the next link does.
    await page.keyboard.type(" more");
    await expect(listboxOf(page)).toBeHidden();
    await page.keyboard.type(` [[${stamp}`);
    await expect(listboxOf(page)).toBeVisible();
  });

  test("the list is under the link being typed, on the page, and never covers the line", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const stamp = unique("Place");
    const workspaceId = await mySpace(page);
    for (const name of ["One", "Two", "Three", "Four", "Five", "Six"]) await createNote(page, workspaceId, `${stamp} ${name}`);
    await startWriting(page, workspaceId, `Source ${stamp}`);
    await page.keyboard.type(`[[${stamp}`);
    await expect(optionsOf(page)).toHaveCount(6);
    const popup = page.locator(".kh-wikilink-suggest");
    const box = (await popup.boundingBox())!;
    const caret = await caretRect(page);
    // Under the line it belongs to, starting at the link, and inside the page.
    expect(box.y).toBeGreaterThanOrEqual(caret.bottom - 1);
    expect(box.y + box.height).toBeLessThanOrEqual(720);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1280);
    expect(Math.abs(box.x - (caret.left - `[[${stamp}`.length * 8))).toBeLessThan(200);

    // Little room below: it goes above the line rather than off the page.
    await page.setViewportSize({ width: 1280, height: 330 });
    await page.keyboard.type("x");
    await page.keyboard.press("Backspace");
    await expect(popup).toBeVisible();
    const short = (await popup.boundingBox())!;
    const shortCaret = await caretRect(page);
    expect(short.y).toBeGreaterThanOrEqual(0);
    expect(short.y + short.height).toBeLessThanOrEqual(330);
    expect(short.y + short.height <= shortCaret.top + 1 || short.y >= shortCaret.bottom - 1).toBe(true);
  });

  test("is drawn in the surface colours in both themes", async ({ page }) => {
    const stamp = unique("Theme");
    const workspaceId = await mySpace(page);
    await createNote(page, workspaceId, `${stamp} Note`);
    await startWriting(page, workspaceId, `Source ${stamp}`);
    await page.keyboard.type(`[[${stamp}`);
    await expect(optionsOf(page)).toHaveCount(1);

    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      const colours = await page.evaluate(() => {
        const resolve = (property: string, token: string) => {
          const probe = document.createElement("span");
          probe.style.setProperty(property, `var(${token})`);
          document.body.appendChild(probe);
          const value = getComputedStyle(probe).getPropertyValue(property);
          probe.remove();
          return value;
        };
        const popup = document.querySelector<HTMLElement>(".kh-wikilink-suggest")!;
        const row = popup.querySelector<HTMLElement>("[role=option]")!;
        return {
          popup: getComputedStyle(popup).backgroundColor,
          raised: resolve("background-color", "--kh-bg-raised"),
          row: getComputedStyle(row).backgroundColor,
          selected: resolve("background-color", "--kh-bg-selected"),
          shadow: getComputedStyle(popup).boxShadow,
        };
      });
      expect(colours.popup, theme).toBe(colours.raised);
      expect(colours.row, theme).toBe(colours.selected);
      expect(colours.shadow, theme).not.toBe("none");
      if (process.env.KH_SHOT_DIR) await page.screenshot({ path: `${process.env.KH_SHOT_DIR}/autocomplete-${theme}.png` });
    }
  });

  test("asks for the documents only once a link is being written", async ({ page }) => {
    const stamp = unique("Lazy");
    const workspaceId = await mySpace(page);
    await createNote(page, workspaceId, `${stamp} Note`);
    const asked: string[] = [];
    page.on("request", (request) => { if (request.url().includes("/link-targets")) asked.push(request.url()); });
    await startWriting(page, workspaceId, `Source ${stamp}`);
    await page.keyboard.type("plain text and [one bracket");
    expect(asked).toEqual([]);
    await page.keyboard.type(" [[");
    await expect(optionsOf(page).first()).toBeVisible();
    await page.keyboard.type(`${stamp}`);
    await expect(optionsOf(page)).toHaveCount(1);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain(`/api/workspaces/${workspaceId}/link-targets`);
  });

  test("says so when the documents cannot be fetched, and the link can still be typed out", async ({ page }) => {
    const stamp = unique("Down");
    const workspaceId = await mySpace(page);
    const targetUrl = await createNote(page, workspaceId, `${stamp} Note`);
    await page.route("**/link-targets", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "down" } }) }));
    const surface = await startWriting(page, workspaceId, `Source ${stamp}`);

    await page.keyboard.type(`[[${stamp}`);
    await expect(page.locator(".kh-wikilink-suggest")).toContainText("Couldn't load suggestions. You can still type the link out.");
    await expect(optionsOf(page)).toHaveCount(0);
    // Typing was never in the way: the link goes in as it always could.
    await page.keyboard.type(` Note]]`);
    await expect(surface.locator("span.kh-wikilink")).toHaveText(`${stamp} Note`);
    await expect(page.locator(".kh-wikilink-suggest")).toBeHidden();

    const created = nextWrite(page, "POST");
    await composer(page).getByRole("button", { name: "Create document" }).click();
    expect(sentMarkdown(await created)).toContain(`[[${stamp} Note]]`);
    await expect(page).not.toHaveURL(/\/new$/, ROUND_TRIP);
    await expectBacklinkFrom(page, targetUrl);
  });

  test("does not offer a document to itself when it is edited", async ({ page }) => {
    const stamp = unique("Self");
    const workspaceId = await mySpace(page);
    const selfUrl = await createNote(page, workspaceId, `${stamp} Me`, "Some words.");
    await createNote(page, workspaceId, `${stamp} Other`);
    await page.goto(`${selfUrl}/edit`);
    const surface = surfaceOf(page);
    await expect(surface).toBeEditable(ROUND_TRIP);
    await surface.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(` [[${stamp}`);
    await expect(optionsOf(page)).toHaveCount(1);
    await expect(optionsOf(page).first()).toContainText(`${stamp} Other`);
  });

  test("a title that could not be written as a link is not offered", async ({ page }) => {
    const stamp = unique("Odd");
    const workspaceId = await mySpace(page);
    await createNote(page, workspaceId, `${stamp} a|b`);
    await createNote(page, workspaceId, `${stamp} a#b`);
    await createNote(page, workspaceId, `${stamp} fine`);
    await startWriting(page, workspaceId, `Source ${stamp}`);
    await page.keyboard.type(`[[${stamp}`);
    await expect(optionsOf(page)).toHaveCount(1);
    await expect(optionsOf(page).first()).toContainText(`${stamp} fine`);
  });
});
