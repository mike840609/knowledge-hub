import { expect, test } from "./fixtures/test";
import { showMarkdown } from "./composer-helpers";
import { EMPTY_WORKSPACE, ROUND_TRIP, unique, composer, createNote, readerTitle, EDITOR_CODE, HELD, holdEditorCode, openEditor } from "./fixtures/document-composer";

test("the rendered editor mounts without hydration or page errors", { tag: "@smoke-team" }, async ({ page }) => {
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

test("new documents focus Title while existing documents wait for an editing gesture", async ({ page }) => {
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge/new`);
  await expect(composer(page).getByLabel("Title", { exact: true })).toBeFocused(ROUND_TRIP);

  const title = unique("Focus H1");
  const url = await createNote(page, title, `# ${title}\n\nbody`);
  const surface = await openEditor(page, url);
  await expect(surface).not.toBeFocused();
  await surface.getByRole("heading", { level: 1 }).click({ position: { x: 1, y: 10 } });
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

test("selecting text shows the toolbar, and Bold writes ** into the Markdown", async ({ page }) => {
  const url = await createNote(page, unique("Toolbar"), "hello world\n");
  const surface = await openEditor(page, url);
  const toolbar = page.getByRole("toolbar", { name: "Formatting" });
  await expect(toolbar).toBeHidden();

  await surface.locator("p").click();
  await surface.locator("p").selectText();
  await expect(toolbar).toBeVisible(ROUND_TRIP);
  const box = await toolbar.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);

  await toolbar.getByRole("button", { name: "Bold" }).click();
  // Formatting stays on the canonical document page.
  await expect(page).toHaveURL(new RegExp(`${url}$`));
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
  // Start editing explicitly; opening an inline document does not move focus.
  await surface.click();
  // Keys at a hand's pace. A script presses them 4ms apart, under the 20-50ms in which ProseMirror
  // puts its own selection back after a key (prosemirror-view's focus and arrow-key timers) when
  // it has not yet read the browser's: the next key then moves from the old place, and CI once
  // bolded "wor" or "w". 40ms apart is about the pace of a held key repeating (~33ms).
  const press = async (key: string) => { await page.keyboard.press(key); await page.waitForTimeout(40); };
  await press("ControlOrMeta+a");
  await press("ArrowLeft");
  for (let letter = 0; letter < "hello ".length; letter += 1) await press("ArrowRight");
  for (let letter = 0; letter < "world".length; letter += 1) await press("Shift+ArrowRight");
  await expect(toolbar).toBeVisible(ROUND_TRIP);

  // The toolbar follows the editor in the tab order, and focus moving into it keeps it open.
  await page.keyboard.press("Tab");
  await expect(bold).toBeFocused();
  await expect(toolbar).toBeVisible();
  await page.keyboard.press("Enter");

  // Enter presses the toolbar button without navigating.
  await expect(page).toHaveURL(new RegExp(`${url}$`));
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
  await surface.locator("p").click();
  await surface.locator("p").selectText();
  await toolbar.getByRole("button", { name: "Link" }).click();
  const address = toolbar.getByLabel("Link address");
  await expect(address).toBeFocused();
  await address.fill("https://example.com");
  await address.press("Enter");

  // Enter applies the link without leaving the document.
  await expect(page).toHaveURL(new RegExp(`${url}$`));
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
  await surface.locator("p").click();
  await surface.locator("p").selectText();
  await expect(toolbar).toBeVisible(ROUND_TRIP);
  await composer(page).getByLabel("Title", { exact: true }).click();
  await expect(toolbar).toBeHidden();
});

test("the bulleted-list button wraps a paragraph into a list and lifts it back out", async ({ page }) => {
  const url = await createNote(page, unique("List Toggle"), "item\n");
  const surface = await openEditor(page, url);
  const toolbar = page.getByRole("toolbar", { name: "Formatting" });
  await surface.locator("p").click();
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
  await expect(composer(page).getByRole("status").filter({ hasText: "Rendered editing is unavailable. You can continue in Markdown." })).toBeVisible();
  await expect(source).toBeVisible();
  await expect(source).toHaveValue("[a]: https://example.com\n");
  await expect(toggle).toBeDisabled();
});

test("Markdown accepts edits while rendered editor code is still loading", async ({ page }) => {
  const url = await createNote(page, unique("Wait For Editor"), "body\n");
  const release = await holdEditorCode(page);
  await page.goto(`${url}/edit`, HELD);
  const toggle = composer(page).getByRole("button", { name: "Markdown", exact: true });
  await expect(toggle).toBeEnabled(ROUND_TRIP);
  await toggle.click();
  const source = composer(page).getByLabel("Markdown", { exact: true });
  await expect(source).toBeVisible();
  await expect(source).toBeEditable();
  await source.fill("typed while loading\n");
  release();
  await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "false", ROUND_TRIP);
  await expect(source).toHaveValue("typed while loading\n");
  await toggle.click();
  await expect(page.getByRole("textbox", { name: "Content" })).toHaveText("typed while loading");
});

test("the editor arriving does not take the caret from a field the person moved to", async ({ page }) => {
  const url = await createNote(page, unique("Keep Focus"), "body\n");
  const release = await holdEditorCode(page);
  await page.goto(`${url}/edit`, HELD);
  const toggle = composer(page).getByRole("button", { name: "Markdown", exact: true });
  await expect(toggle).toBeEnabled(ROUND_TRIP);
  await toggle.click();
  const titleField = composer(page).getByLabel("Title", { exact: true });
  await titleField.click();
  // The field is 32px now, so a centre click lands inside the title rather
  // than past it. Put the caret at the end explicitly; the point of this test
  // is that the arriving editor does not take focus, not where a click lands.
  await titleField.evaluate((el) => { const input = el as HTMLInputElement; input.setSelectionRange(input.value.length, input.value.length); });
  await page.keyboard.type(" more");
  release();
  await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "false", ROUND_TRIP);
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
  await expect(composer(page).getByRole("status").filter({ hasText: "Rendered editing is unavailable. You can continue in Markdown." })).toBeVisible(ROUND_TRIP);
  const source = composer(page).getByLabel("Markdown", { exact: true });
  await expect(source).toBeEditable();
  await source.fill("still editable");
  await expect(page.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "saved", ROUND_TRIP);
  await page.reload();
  await expect(source).toHaveValue("still editable", ROUND_TRIP);
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
  await expect(composer(page).getByLabel("Title", { exact: true })).toHaveCount(0);
  await expect(readerTitle(page)).toHaveText(title);
  // The body opens with its own H1, so the editor shows that one heading, as the reader does.
  await expect(surface.getByRole("heading", { level: 1 })).toHaveCount(1);
  const source = await showMarkdown(composer(page));
  await source.fill("# Another heading entirely\n\ntext");
  await expect(page.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "saved", ROUND_TRIP);
  await page.reload();
  await expect(surface.getByRole("heading", { name: "Another heading entirely" })).toBeVisible(ROUND_TRIP);
  await expect(readerTitle(page)).toHaveText(title);
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
