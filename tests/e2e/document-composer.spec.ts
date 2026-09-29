import { expect, test, type Dialog, type Locator, type Page } from "@playwright/test";
import { showMarkdown } from "./composer-helpers";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS (Playwright cannot resolve `@/` aliases).
const EMPTY_WORKSPACE = "0199f100-0000-7000-8000-000000000004";
// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/** Unique per call: the workspace is shared across tests and repeats. */
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

/**
 * Creates a note through the API and returns its URL. Not through the
 * new-document page: these tests are about editing, and must not depend on
 * how that page looks.
 */
async function createNote(page: Page, title: string, markdown = "") {
  const response = await page.request.post(`/api/workspaces/${EMPTY_WORKSPACE}/documents`, { data: { title, markdown } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  return `/w/${EMPTY_WORKSPACE}/knowledge/${created.sourceId}/${created.documentId}`;
}

/**
 * Leaves a dirty editor for the document page by a full load, accepting the
 * `beforeunload` prompt the dirty editor raises. Not by clicking the sidebar:
 * a client navigation from `/edit` to its document is sometimes dropped by the
 * router after its response arrives — on `main` too, with the old editor (see
 * the composer verification record). These tests are about the draft, which
 * survives any way of leaving; that defect is tracked on its own.
 */
async function leaveEditor(page: Page, documentUrl: string) {
  const accept = (dialog: Dialog) => void dialog.accept();
  page.on("dialog", accept);
  await page.goto(documentUrl);
  page.off("dialog", accept);
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
}

/**
 * The title the reader shows for the document: its breadcrumb's last segment, which is the
 * stored title. Not the sidebar: its refresh after a save is dropped now and then, a known
 * defect on main (composer verification record).
 */
function readerTitle(page: Page) {
  return page.getByRole("region", { name: "Document content" }).getByRole("navigation", { name: "Breadcrumb" }).getByRole("listitem").last();
}

/** The rendered editor's code: the app's only lazily loaded chunks (`<id>.<hash>.js`; first-load chunks are `<id>-<hash>.js`). */
const EDITOR_CODE = /\/_next\/static\/chunks\/[^/-]+\.[0-9a-f]+\.js$/;

/** Holds the editor's code back until released, so the page can be used while the editor is still loading. */
async function holdEditorCode(page: Page) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(EDITOR_CODE, async (route) => {
    await held;
    await route.continue();
  });
  return release;
}

/** Opens the editor and returns the rendered surface once it can be typed into. */
async function openEditor(page: Page, documentUrl: string) {
  await page.goto(`${documentUrl}/edit`);
  const surface = surfaceOf(page);
  await expect(surface).toBeEditable(ROUND_TRIP);
  return surface;
}

/** The next save's PATCH, as the page sends it. */
function nextSave(page: Page) {
  return page.waitForRequest((request) => request.method() === "PATCH" && request.url().includes("/api/documents/"), ROUND_TRIP);
}

function sentBody(request: Awaited<ReturnType<typeof nextSave>>) {
  return JSON.parse(request.postData() ?? "{}") as { title?: string; markdown?: string };
}

/** Types into a note's body, then into its H1: the editor's last output is the one that renames it. */
async function editBodyThenHeading(page: Page, surface: Locator) {
  await surface.locator("p").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" typed");
  await surface.getByRole("heading", { level: 1 }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" renamed");
}

/**
 * An init script. Presses ⌘/Ctrl Enter where a real key press queued behind the editor's debounced
 * output is handled: after that output has run (it writes the draft) and React has scheduled the
 * render it asks for, but before that render. A person lands there only now and then (the window is
 * about as long as the output task, longer for a longer document); wrapping `setTimeout` lands there
 * every time. Only an output that carries every one of `words` sets it off, never one delivered
 * mid-typing. It records the Markdown React last rendered, to show the press did land before it.
 */
function pressSaveBeforeOutputRenders(words: string[]) {
  let draftWrites = 0;
  let pressed = false;
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key: string, value: string) {
    if (key.startsWith("kh:draft:")) draftWrites += 1;
    setItem.call(this, key, value);
  };
  const schedule = window.setTimeout;
  window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
    if (typeof handler !== "function") return schedule(handler, delay, ...args);
    return schedule((...callArgs: unknown[]) => {
      const writesBefore = draftWrites;
      handler(...callArgs);
      const shown = document.querySelector(".ProseMirror")?.textContent ?? "";
      if (pressed || draftWrites === writesBefore || !words.every((word) => shown.includes(word))) return;
      pressed = true;
      // React schedules its render from a microtask queued while `handler` ran; these two run after it.
      queueMicrotask(() => queueMicrotask(() => {
        const source = document.querySelector<HTMLTextAreaElement>('main form textarea[aria-label="Markdown"]');
        (window as unknown as { renderedAtPress?: string }).renderedAtPress = source?.value;
        const save = { key: "Enter", metaKey: true, ctrlKey: true, bubbles: true, cancelable: true };
        document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", save));
      }));
    }, delay, ...args);
  }) as typeof window.setTimeout;
}

test("the rendered editor mounts without hydration or page errors", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    const text = message.text();
    if ((message.type() === "error" && !/Failed to load resource/.test(text)) || /hydrat/i.test(text)) problems.push(text);
  });
  const url = await createNote(page, unique("Clean Mount"), "# Clean\n\nbody with **bold**");
  const surface = await openEditor(page, url);
  await expect(surface.locator("strong")).toHaveText("bold");
  await page.waitForTimeout(1_000);
  expect(problems).toEqual([]);
  // Strict Mode builds two editors while developing; a production build must hold exactly one.
  await expect(page.locator(".ProseMirror")).toHaveCount(1);
});

test("focus lands in Title on a new document, and at the start of the content for an H1-led one", async ({ page }) => {
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge/new`);
  await expect(composer(page).getByLabel("Title", { exact: true })).toBeFocused(ROUND_TRIP);

  const title = unique("Focus H1");
  const url = await createNote(page, title, `# ${title}\n\nbody`);
  const surface = await openEditor(page, url);
  await expect(surface).toBeFocused(ROUND_TRIP);
  await page.keyboard.type("X");
  const source = await showMarkdown(composer(page));
  await expect(source).toHaveValue(`# X${title}\n\nbody\n`);
});

test("a document opens rendered, and its Markdown is shown untouched", async ({ page }) => {
  const markdown = "# Shown\n\nSome **bold** words\n\n* star item\n";
  const url = await createNote(page, unique("Shown"), markdown);
  const surface = await openEditor(page, url);
  await expect(surface.locator("strong")).toHaveText("bold");

  const source = await showMarkdown(composer(page));
  // Opening rewrites nothing, not even the * list the editor would write as -.
  await expect(source).toHaveValue(markdown);

  await composer(page).getByRole("button", { name: "Markdown", exact: true }).click();
  await expect(surface).toBeVisible();
  await expect(surface.locator("strong")).toHaveText("bold");
});

test("saving without a change keeps the Markdown exactly as it was", async ({ page }) => {
  const markdown = "* one\n* two\n";
  const url = await createNote(page, unique("Untouched"), markdown);
  await openEditor(page, url);
  await composer(page).getByRole("button", { name: "Save" }).click();
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);

  await openEditor(page, url);
  const source = await showMarkdown(composer(page));
  await expect(source).toHaveValue(markdown);
});

test("an untouched rendered editor is not a modification: Esc leaves it", async ({ page }) => {
  const url = await createNote(page, unique("Not Dirty"), "# Not dirty\n\n* a\n* b\n");
  const surface = await openEditor(page, url);
  await surface.press("Escape");
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
});

test("typing Markdown syntax writes a heading and a list, and Create saves it", async ({ page }) => {
  const title = unique("Typed Heading");
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge/new`);
  const surface = surfaceOf(page);
  await expect(surface).toBeEditable(ROUND_TRIP);
  await surface.click();
  await page.keyboard.type(`# ${title}`);
  await page.keyboard.press("Enter");
  await page.keyboard.type("- one");
  await page.keyboard.press("Enter");
  await page.keyboard.type("two");
  // An empty item ends the list; then bold, typed as Markdown.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("**x**");

  await expect(surface.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(surface.getByRole("listitem")).toHaveCount(2);
  await expect(surface.locator("strong")).toHaveText("x");
  await expect(composer(page).getByLabel("Title", { exact: true })).toHaveCount(0);
  const source = await showMarkdown(composer(page));
  await expect(source).toHaveValue(`# ${title}\n\n- one\n- two\n\n**x**\n`);

  await composer(page).getByRole("button", { name: "Create document" }).click();
  await expect(page.getByRole("treeitem", { name: title, exact: true })).toBeVisible(ROUND_TRIP);
});

test("⌘Enter saves from inside the rendered editor", async ({ page }) => {
  const title = unique("Save Shortcut");
  const url = await createNote(page, title, `# ${title}\n\nbody\n`);
  const surface = await openEditor(page, url);
  await surface.click();
  await page.keyboard.type("more ");
  await surface.press("ControlOrMeta+Enter");
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
  await expect(page.locator("article").first().getByText("more")).toBeVisible(ROUND_TRIP);
});

test("⌘Enter pressed before the editor's last output has rendered still saves everything typed", async ({ page }) => {
  const title = unique("Gap Save");
  await page.addInitScript(pressSaveBeforeOutputRenders, ["start typed", `${title} renamed`]);
  const url = await createNote(page, title, `# ${title}\n\nstart\n`);
  const surface = await openEditor(page, url);
  const saved = nextSave(page);
  await editBodyThenHeading(page, surface);

  const sent = sentBody(await saved);
  const renderedAtPress = await page.evaluate(() => (window as unknown as { renderedAtPress?: string }).renderedAtPress);
  const typed = `# ${title} renamed\n\nstart typed\n`;
  expect(sent.markdown).toBe(typed);
  expect(sent.title).toBe(`${title} renamed`);
  // The press did come before that render: the Markdown React had rendered was still behind what was typed.
  expect(renderedAtPress).toEqual(expect.any(String));
  expect(renderedAtPress).not.toBe(typed);
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
  await expect(readerTitle(page)).toHaveText(`${title} renamed`, ROUND_TRIP);
  await expect(page.locator("article").first().getByText("start typed")).toBeVisible(ROUND_TRIP);
});

test("⌘Enter pressed after the editor's output has rendered saves the same", async ({ page }) => {
  const title = unique("Settled Save");
  const url = await createNote(page, title, `# ${title}\n\nstart\n`);
  const surface = await openEditor(page, url);
  await editBodyThenHeading(page, surface);
  // The breadcrumb follows the rendered Markdown, so this waits out the output and its render.
  await expect(composer(page).getByRole("navigation", { name: "Breadcrumb" })).toContainText(`${title} renamed`, ROUND_TRIP);

  const saved = nextSave(page);
  await surface.press("ControlOrMeta+Enter");
  const sent = sentBody(await saved);
  expect(sent.markdown).toBe(`# ${title} renamed\n\nstart typed\n`);
  expect(sent.title).toBe(`${title} renamed`);
  await expect(readerTitle(page)).toHaveText(`${title} renamed`, ROUND_TRIP);
});

test("⌘Enter with the caret in a code block saves, and adds nothing to the Markdown", async ({ page }) => {
  const markdown = "```js\nconst a = 1;\n```\n\nafter\n";
  const url = await createNote(page, unique("Code Save"), markdown);
  const surface = await openEditor(page, url);
  await surface.locator("pre").click();
  // ProseMirror's own ⌘Enter would leave the code block by inserting an empty paragraph (`<br />`).
  // Pressed as ProseMirror reads "Mod" in this browser: ⌘ where it reports a Mac, Ctrl elsewhere.
  // The form saves on either.
  const mod = (await page.evaluate(() => /Mac|iP(hone|[oa]d)/.test(navigator.platform))) ? "Meta" : "Control";
  const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("/api/documents/"));
  await page.keyboard.press(`${mod}+Enter`);
  const response = await saved;
  expect(response.ok()).toBe(true);
  expect((JSON.parse(response.request().postData() ?? "{}") as { markdown?: string }).markdown).toBe(markdown);
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);

  await openEditor(page, url);
  const source = await showMarkdown(composer(page));
  await expect(source).toHaveValue(markdown);
});

test("selecting text shows the toolbar, and Bold writes ** into the Markdown", async ({ page }) => {
  const url = await createNote(page, unique("Toolbar"), "hello world\n");
  const surface = await openEditor(page, url);
  const toolbar = page.getByRole("toolbar", { name: "Formatting" });
  await expect(toolbar).toBeHidden();

  await surface.locator("p").selectText();
  await expect(toolbar).toBeVisible(ROUND_TRIP);
  const box = await toolbar.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);

  await toolbar.getByRole("button", { name: "Bold" }).click();
  // A toolbar button must not submit the form it sits in.
  await expect(page).toHaveURL(/\/edit$/);
  await expect(surface.locator("strong")).toHaveText("hello world");
  await expect(toolbar.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
  const source = await showMarkdown(composer(page));
  await expect(source).toHaveValue("**hello world**\n");
});

test("the toolbar works from the keyboard: select, Tab into it, press Bold", async ({ page }) => {
  const url = await createNote(page, unique("Toolbar Keys"), "hello world\n");
  const surface = await openEditor(page, url);
  const toolbar = page.getByRole("toolbar", { name: "Formatting" });
  const bold = toolbar.getByRole("button", { name: "Bold" });
  // A titled note without an H1 opens with the caret at the start of its text.
  await expect(surface).toBeFocused(ROUND_TRIP);
  for (let letter = 0; letter < "hello ".length; letter += 1) await page.keyboard.press("ArrowRight");
  // One key makes the selection: the editor reads it after the key, so a toolbar shown means it holds all of it.
  await page.keyboard.press("Shift+End");
  await expect(toolbar).toBeVisible(ROUND_TRIP);

  // The toolbar follows the editor in the tab order, and focus moving into it keeps it open.
  await page.keyboard.press("Tab");
  await expect(bold).toBeFocused();
  await expect(toolbar).toBeVisible();
  await page.keyboard.press("Enter");

  // Enter on a toolbar button presses it; it does not submit the form.
  await expect(page).toHaveURL(/\/edit$/);
  await expect(surface.locator("strong")).toHaveText("world");
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  // Pressing a button hands focus back to the editor, selection kept.
  await expect(surface).toBeFocused();
  await expect(toolbar).toBeVisible();
  const source = await showMarkdown(composer(page));
  await expect(source).toHaveValue("hello **world**\n");
});

test("the toolbar adds a link from an address typed into it", async ({ page }) => {
  const url = await createNote(page, unique("Link"), "hello world\n");
  const surface = await openEditor(page, url);
  const toolbar = page.getByRole("toolbar", { name: "Formatting" });
  await surface.locator("p").selectText();
  await toolbar.getByRole("button", { name: "Link" }).click();
  const address = toolbar.getByLabel("Link address");
  await expect(address).toBeFocused();
  await address.fill("https://example.com");
  await address.press("Enter");

  // Enter in the address box must neither save the document nor leave the page.
  await expect(page).toHaveURL(/\/edit$/);
  await expect(surface.locator('a[href="https://example.com"]')).toHaveText("hello world");
  const source = await showMarkdown(composer(page));
  await expect(source).toHaveValue("[hello world](https://example.com)\n");
});

test("a javascript: link is not a live link in the editor, and the document keeps what was written", async ({ page }) => {
  // Milkdown sanitises an anchor's href when it draws the link; the editor's
  // ⌘-click reads that rendered href. This pins the sanitising to the locked version.
  const markdown = "[click](javascript:alert(1)) and [ok](https://example.com)\n";
  const url = await createNote(page, unique("Unsafe Link"), markdown);
  const surface = await openEditor(page, url);
  await expect(surface.locator("a", { hasText: "click" })).not.toHaveAttribute("href", /javascript/i);
  await expect(surface.locator("a", { hasText: "ok" })).toHaveAttribute("href", "https://example.com");
  const source = await showMarkdown(composer(page));
  await expect(source).toHaveValue(markdown);
});

test("the toolbar goes away when focus leaves the editor", async ({ page }) => {
  const url = await createNote(page, unique("Blur"), "hello world\n");
  const surface = await openEditor(page, url);
  const toolbar = page.getByRole("toolbar", { name: "Formatting" });
  await surface.locator("p").selectText();
  await expect(toolbar).toBeVisible(ROUND_TRIP);
  await composer(page).getByLabel("Title", { exact: true }).click();
  await expect(toolbar).toBeHidden();
});

test("the bulleted-list button wraps a paragraph into a list and lifts it back out", async ({ page }) => {
  const url = await createNote(page, unique("List Toggle"), "item\n");
  const surface = await openEditor(page, url);
  const toolbar = page.getByRole("toolbar", { name: "Formatting" });
  await surface.locator("p").selectText();
  await toolbar.getByRole("button", { name: "Bulleted list" }).click();
  await expect(surface.getByRole("listitem")).toHaveCount(1);
  await expect(toolbar.getByRole("button", { name: "Bulleted list" })).toHaveAttribute("aria-pressed", "true");
  let source = await showMarkdown(composer(page));
  await expect(source).toHaveValue("- item\n");

  await composer(page).getByRole("button", { name: "Markdown", exact: true }).click();
  await surface.locator("li p").selectText();
  await toolbar.getByRole("button", { name: "Bulleted list" }).click();
  await expect(surface.getByRole("listitem")).toHaveCount(0);
  source = await showMarkdown(composer(page));
  await expect(source).toHaveValue("item\n");
});

test("changes made in the Markdown show when switching back", async ({ page }) => {
  const url = await createNote(page, unique("Back"), "old\n");
  const surface = await openEditor(page, url);
  const source = await showMarkdown(composer(page));
  await source.fill("# Changed heading\n\nnew body\n");
  await composer(page).getByRole("button", { name: "Markdown", exact: true }).click();
  await expect(surface.getByRole("heading", { level: 1 })).toHaveText("Changed heading");
  await expect(surface).toContainText("new body");
});

test("⌘/ switches between the rendered editor and the Markdown", async ({ page }) => {
  const url = await createNote(page, unique("Shortcut"), "text\n");
  const surface = await openEditor(page, url);
  await surface.press("ControlOrMeta+/");
  const source = composer(page).getByLabel("Markdown", { exact: true });
  await expect(source).toBeVisible();
  await source.press("ControlOrMeta+/");
  await expect(surface).toBeVisible();
});

test("Markdown the editor makes nothing of stays in the source, with the reason shown", async ({ page }) => {
  const url = await createNote(page, unique("Unparsed"), "body\n");
  await openEditor(page, url);
  const source = await showMarkdown(composer(page));
  // A lone link reference definition: the editor has no node for it, so it would come out empty.
  await source.fill("[a]: https://example.com\n");
  const toggle = composer(page).getByRole("button", { name: "Markdown", exact: true });
  await toggle.click();
  await expect(composer(page).getByRole("status").filter({ hasText: "已改用 Markdown 模式" })).toBeVisible();
  await expect(source).toBeVisible();
  await expect(source).toHaveValue("[a]: https://example.com\n");
  await expect(toggle).toBeDisabled();
});

test("the Markdown waits for the editor to load before it takes typing", async ({ page }) => {
  const url = await createNote(page, unique("Wait For Editor"), "body\n");
  const release = await holdEditorCode(page);
  await page.goto(`${url}/edit`);
  const toggle = composer(page).getByRole("button", { name: "Markdown", exact: true });
  await expect(toggle).toBeEnabled(ROUND_TRIP);
  await toggle.click();
  const source = composer(page).getByLabel("Markdown", { exact: true });
  await expect(source).toBeVisible();
  await expect(source).toBeDisabled();
  release();
  await expect(source).toBeEnabled(ROUND_TRIP);
});

test("the editor arriving does not take the caret from a field the person moved to", async ({ page }) => {
  const url = await createNote(page, unique("Keep Focus"), "body\n");
  const release = await holdEditorCode(page);
  await page.goto(`${url}/edit`);
  const toggle = composer(page).getByRole("button", { name: "Markdown", exact: true });
  await expect(toggle).toBeEnabled(ROUND_TRIP);
  await toggle.click();
  const titleField = composer(page).getByLabel("Title", { exact: true });
  await titleField.click();
  await page.keyboard.type(" more");
  release();
  await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "true", ROUND_TRIP);
  // A steal would come right after the editor is built; keep watching for a while.
  for (let check = 0; check < 5; check += 1) {
    await expect(titleField).toBeFocused();
    await page.waitForTimeout(100);
  }
  await expect(titleField).toHaveValue(/ more$/);
});

test("an editor whose code cannot load leaves the Markdown in charge", async ({ page }) => {
  const url = await createNote(page, unique("No Editor Code"), "body\n");
  await page.route(EDITOR_CODE, (route) => route.abort());
  await page.goto(`${url}/edit`);
  await expect(composer(page).getByRole("status").filter({ hasText: "已改用 Markdown 模式" })).toBeVisible(ROUND_TRIP);
  const source = composer(page).getByLabel("Markdown", { exact: true });
  await expect(source).toBeEditable();
  await source.fill("still editable");
  await composer(page).getByRole("button", { name: "Save" }).click();
  await expect(page.locator("article").first().getByText("still editable")).toBeVisible(ROUND_TRIP);
});

test("an image the reader would refuse is not loaded by the editor either", async ({ page }) => {
  const markdown = "![x](https://evil.example/a.png)\n\nbody\n";
  const requested: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname === "evil.example") requested.push(request.url());
  });
  const url = await createNote(page, unique("Image"), markdown);
  const surface = await openEditor(page, url);
  // The image is there, with its address only where no browser loads it.
  const image = surface.locator('img[data-kh-src="https://evil.example/a.png"]');
  await expect(image).toHaveCount(1);
  await expect(image).not.toHaveAttribute("src", /./);
  expect(requested).toEqual([]);
  // The document still holds the address; only the element lost it.
  const source = await showMarkdown(composer(page));
  await expect(source).toHaveValue(markdown);
});

test("a document that opens with an H1 is named by it, with no title field", async ({ page }) => {
  const before = unique("Composer H1");
  const after = unique("Composer Renamed");
  const url = await createNote(page, before, `# ${before}\n\nbody`);
  await openEditor(page, url);
  await expect(composer(page).getByLabel("Title", { exact: true })).toHaveCount(0);

  const source = await showMarkdown(composer(page));
  await source.fill(`# ${after}\n\nbody`);
  await expect(composer(page).getByRole("navigation", { name: "Breadcrumb" })).toContainText(after);
  await composer(page).getByRole("button", { name: "Save" }).click();
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
  await expect(readerTitle(page)).toHaveText(after, ROUND_TRIP);
});

test("deleting the opening H1 brings back the title field, filled with it", async ({ page }) => {
  const title = unique("Carry");
  const url = await createNote(page, title, `# ${title}\n\nbody`);
  await openEditor(page, url);
  const source = await showMarkdown(composer(page));
  // Change the H1 away from the stored title first, so a no-op carryTitle
  // (one that just leaves the stored title alone) cannot pass this test.
  const changedHeading = unique("Carry Changed");
  await source.fill(`# ${changedHeading}\n\nbody`);
  await expect(composer(page).getByLabel("Title", { exact: true })).toHaveCount(0);

  await source.fill("body");
  await expect(composer(page).getByLabel("Title", { exact: true })).toHaveValue(changedHeading);
});

test("a frontmatter title survives editing the H1", async ({ page }) => {
  const title = unique("Frontmatter Title");
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge/new`);
  // Enabled once hydrated and authorized.
  await expect(page.locator('input[type="file"]')).toBeEnabled(ROUND_TRIP);
  await page.setInputFiles('input[type="file"]', {
    name: "fm.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(`---\ntitle: ${title}\n---\n\n# A different heading\n\ntext\n`, "utf8"),
  });
  await expect(page).not.toHaveURL(/\/new$/, ROUND_TRIP);

  const surface = await openEditor(page, page.url());
  await expect(composer(page).getByText("標題來自上傳檔案的 frontmatter")).toBeVisible();
  // The body opens with its own H1, so the editor shows that one heading, as the reader does.
  await expect(surface.getByRole("heading", { level: 1 })).toHaveCount(1);
  const source = await showMarkdown(composer(page));
  await source.fill("# Another heading entirely\n\ntext");
  await composer(page).getByRole("button", { name: "Save" }).click();
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
  await expect(page.locator("article").first().getByRole("heading", { name: "Another heading entirely" })).toBeVisible(ROUND_TRIP);
  await expect(readerTitle(page)).toHaveText(title);
});

test("what was typed in the rendered editor survives leaving and is offered back on return", async ({ page }) => {
  const url = await createNote(page, unique("Draft"), "start\n");
  const surface = await openEditor(page, url);
  await surface.click();
  await page.keyboard.type("draft text");

  await leaveEditor(page, url);

  const back = await openEditor(page, url);
  await expect(composer(page).getByRole("status").filter({ hasText: "已還原未存的修改" })).toBeVisible();
  await expect(back).toContainText("draft text");
  await expect(back).toBeFocused(ROUND_TRIP);

  await composer(page).getByRole("button", { name: "捨棄" }).click();
  await expect(back).not.toContainText("draft text");
  await page.reload();
  await expect(back).toBeEditable(ROUND_TRIP);
  await expect(composer(page).getByRole("status").filter({ hasText: "已還原" })).toHaveCount(0);
});

test("a draft discarded while the editor is still loading is not what the editor shows", async ({ page }) => {
  const url = await createNote(page, unique("Discard Early"), "start\n");
  const surface = await openEditor(page, url);
  await surface.click();
  await page.keyboard.type("draft text ");
  await leaveEditor(page, url);

  // Press 捨棄 the moment the editor's host joins the page, while the editor in it is being built.
  await page.addInitScript(() => {
    new MutationObserver((records, observer) => {
      for (const record of records) {
        const host = [...record.addedNodes].find((node) => node instanceof HTMLDivElement && node.attributes.length === 0 && !node.firstChild);
        if (!host || !(record.target instanceof HTMLElement) || !record.target.parentElement?.hasAttribute("hidden")) continue;
        const discard = [...document.querySelectorAll<HTMLButtonElement>("main form button")].find((button) => button.textContent === "捨棄");
        if (!discard) continue;
        (window as unknown as { discardedWhileBuilding?: boolean }).discardedWhileBuilding = !document.querySelector(".ProseMirror");
        discard.click();
        observer.disconnect();
        return;
      }
    }).observe(document, { childList: true, subtree: true });
  });
  const back = await openEditor(page, url);
  expect(await page.evaluate(() => (window as unknown as { discardedWhileBuilding?: boolean }).discardedWhileBuilding)).toBe(true);
  await expect(composer(page).getByRole("status").filter({ hasText: "已還原" })).toHaveCount(0);
  await expect(back).not.toContainText("draft text");
  await expect(back).toHaveText("start");
});

test("Cancel right after typing leaves no draft, even when the editor's output lands after it", async ({ page }) => {
  const url = await createNote(page, unique("Cancel Late"), "start\n");
  const surface = await openEditor(page, url);
  await surface.click();
  await page.keyboard.type("typed ");
  const cancel = composer(page).getByRole("button", { name: "Cancel" });
  const asked = page.waitForEvent("dialog");
  const click = cancel.click();
  const dialog = await asked;
  // window.confirm holds the page; answering after the editor's 200 ms output debounce makes
  // that output land after Cancel has cleared the draft, as a slow answer would.
  await page.waitForTimeout(400);
  await dialog.accept();
  await click;
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);

  await openEditor(page, url);
  await expect(composer(page).getByRole("status").filter({ hasText: "已還原" })).toHaveCount(0);
});

test("a restored draft on a document someone changed meanwhile conflicts instead of overwriting", async ({ page }) => {
  const url = await createNote(page, unique("Stale Draft"));
  await openEditor(page, url);
  const source = await showMarkdown(composer(page));
  await source.fill("mine");
  await leaveEditor(page, url);

  // A new page is a new tab, with its own sessionStorage.
  const other = await page.context().newPage();
  await openEditor(other, url);
  const theirSource = await showMarkdown(composer(other));
  await theirSource.fill("theirs");
  await composer(other).getByRole("button", { name: "Save" }).click();
  await expect(other).not.toHaveURL(/\/edit$/, ROUND_TRIP);
  await expect(other.locator("article").first().getByText("theirs")).toBeVisible(ROUND_TRIP);
  await other.close();

  const surface = await openEditor(page, url);
  await expect(composer(page).getByRole("status").filter({ hasText: "被更新過" })).toBeVisible();
  await expect(surface).toContainText("mine");
  await composer(page).getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "已被其他人更新" })).toBeVisible(ROUND_TRIP);
  await expect(surface).toContainText("mine");

  await composer(page).getByRole("button", { name: "載入最新版本（捨棄你的修改）" }).click();
  await expect(surface).toContainText("theirs", ROUND_TRIP);
  await expect(composer(page).getByRole("status").filter({ hasText: "已還原" })).toHaveCount(0);
});

test("Cancel asks before discarding changes, and discarding clears the draft", async ({ page }) => {
  const url = await createNote(page, unique("Cancel"));
  await openEditor(page, url);
  const source = await showMarkdown(composer(page));
  await source.fill("changed");
  const cancel = composer(page).getByRole("button", { name: "Cancel" });

  // waitForEvent, not page.once: a listener's own expect() cannot fail the
  // test, and toHaveURL(/\/edit$/) right after the click would pass even if
  // no dialog had appeared at all (router.push is async). Asserting the
  // Markdown field is still visible with its typed value, after the click has
  // fully resolved, is the positive signal that no navigation happened.
  //
  // The click is started but not awaited yet: window.confirm() blocks the
  // page's JS thread, and with it the click action itself, until the dialog
  // is answered — awaiting the click before consuming the dialog would
  // deadlock (measured: a real 30s test timeout on `cancel.click()`).
  const dismissed = page.waitForEvent("dialog");
  const dismissClick = cancel.click();
  const dismissDialog = await dismissed;
  expect(dismissDialog.message()).toBe("Discard changes?");
  await dismissDialog.dismiss();
  await dismissClick;
  await expect(source).toBeVisible();
  await expect(source).toHaveValue("changed");

  const accepted = page.waitForEvent("dialog");
  const acceptClick = cancel.click();
  const acceptDialog = await accepted;
  await acceptDialog.accept();
  await acceptClick;
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);

  const surface = await openEditor(page, url);
  await expect(surface).not.toContainText("changed");
  await expect(composer(page).getByRole("status").filter({ hasText: "已還原" })).toHaveCount(0);
});

test("Enter in the title field moves to the content instead of submitting", async ({ page }) => {
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge/new`);
  const form = composer(page);
  const titleField = form.getByLabel("Title", { exact: true });
  await expect(titleField).toBeEditable(ROUND_TRIP);
  await titleField.fill(unique("Enter In Title"));

  await titleField.press("Enter");
  await expect(page).toHaveURL(/\/new$/);
  await expect(surfaceOf(page)).toBeFocused();
});

test("a new document can be named by its H1 alone", async ({ page }) => {
  const title = unique("Only H1");
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge/new`);
  const form = composer(page);
  await expect(form.getByLabel("Title", { exact: true })).toBeEditable(ROUND_TRIP);
  const source = await showMarkdown(form);
  await source.fill(`# ${title}\n\nbody`);
  await expect(form.getByLabel("Title", { exact: true })).toHaveCount(0);
  await form.getByRole("button", { name: "Create document" }).click();
  await expect(page.getByRole("treeitem", { name: title, exact: true })).toBeVisible(ROUND_TRIP);
});

// Composer-side half of the create/upload exclusion (new-document-form.tsx's
// own POST is held here, not stubbed away, so the real create still runs and
// still lands): while the upload is in flight, Create must not be clickable,
// or the two could race two documents and two competing refreshOnArrival calls.
test("an upload in flight disables Create, so the two cannot race", async ({ page }) => {
  const title = unique("Held Upload");
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge/new`);
  const form = composer(page);
  const titleField = form.getByLabel("Title", { exact: true });
  await expect(titleField).toBeEditable(ROUND_TRIP);
  // Would otherwise make Create clickable: proves the disable below is the
  // upload's doing, not just an untitled document.
  await titleField.fill(unique("Would-be Create"));

  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/workspaces/*/documents", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    await gate;
    await route.continue();
  });

  await page.setInputFiles('input[type="file"]', {
    name: "held.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(`# ${title}\n\nbody`, "utf8"),
  });
  await expect(form.getByRole("button", { name: "Create document" })).toBeDisabled();

  release();
  await expect(page.getByRole("treeitem", { name: title, exact: true })).toBeVisible(ROUND_TRIP);
});

test("the Markdown text re-fits its height when the column rewraps", async ({ page }) => {
  const url = await createNote(page, unique("Rewrap"), "word ".repeat(400));
  await openEditor(page, url);
  const body = await showMarkdown(composer(page));
  const fits = () => body.evaluate((element: HTMLTextAreaElement) => element.scrollHeight <= element.clientHeight + 1);
  expect(await fits()).toBe(true);
  // Narrower column, more lines: without a re-fit the tail is clipped behind overflow-hidden.
  await page.setViewportSize({ width: 480, height: 800 });
  await expect.poll(fits).toBe(true);
});

test("Upload .md is a focusable button that opens the file picker", async ({ page }) => {
  const title = unique("Picked Upload");
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge/new`);
  const upload = page.getByRole("button", { name: "Upload .md" });
  await expect(upload).toBeEnabled(ROUND_TRIP);
  await surfaceOf(page).focus();
  await page.keyboard.press("Tab");
  await expect(upload).toBeFocused();
  await expect(upload).not.toHaveCSS("box-shadow", "none");

  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await chooser).setFiles({ name: "picked.md", mimeType: "text/markdown", buffer: Buffer.from(`# ${title}\n\nbody\n`, "utf8") });
  await expect(page.getByRole("treeitem", { name: title, exact: true })).toBeVisible(ROUND_TRIP);
});

test("a save whose client navigation never lands still ends on the document", async ({ page }) => {
  const url = await createNote(page, unique("Dropped Return"));
  await openEditor(page, url);
  const body = await showMarkdown(composer(page));
  // Hold the router's fetch of the document, so its client navigation never
  // lands — the shape of the dropped navigation measured on main. A full load
  // is a document request, not an RSC fetch, so it is not held.
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route((target) => target.pathname === url && target.searchParams.has("_rsc"), async (route) => {
    await held;
    await route.abort();
  });

  await body.fill("saved anyway");
  await composer(page).getByRole("button", { name: "Save" }).click();
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
  await expect(page.locator("article").first().getByText("saved anyway")).toBeVisible(ROUND_TRIP);

  release();
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a Cancel whose client navigation never lands still leaves the editor", async ({ page }) => {
  const url = await createNote(page, unique("Dropped Cancel"));
  await openEditor(page, url);
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route((target) => target.pathname === url && target.searchParams.has("_rsc"), async (route) => {
    await held;
    await route.abort();
  });

  await composer(page).getByRole("button", { name: "Cancel" }).click();
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);

  release();
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
