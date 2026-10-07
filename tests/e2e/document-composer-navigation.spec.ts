import { expect, test } from "@playwright/test";
import { showMarkdown } from "./composer-helpers";
import { EMPTY_WORKSPACE, ROUND_TRIP, unique, composer, surfaceOf, createNote, readerTitle, openEditor, nextSave, sentBody, editBodyThenHeading, pressSaveBeforeOutputRenders } from "./fixtures/document-composer";

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

test("typing Markdown syntax writes a heading and a list, and Create saves it", { tag: "@smoke-team" }, async ({ page }) => {
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

test("⌘Enter saves from inside the rendered editor", { tag: "@smoke-team" }, async ({ page }) => {
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

test("opening a document whose H1 differs from its stored title warns that saving renames it", async ({ page }) => {
  const stored = unique("Stored Title");
  const heading = unique("Divergent Heading");
  const url = await createNote(page, stored, `# ${heading}\n\nbody`);
  await openEditor(page, url);
  // The breadcrumb follows the H1, so the person sees the new name at once —
  // and is told that saving keeps it, instead of being renamed silently.
  await expect(composer(page).getByRole("navigation", { name: "Breadcrumb" })).toContainText(heading);
  await expect(composer(page).getByText(`Saving will rename this document to “${heading}”`)).toBeVisible();

  const saved = nextSave(page);
  await composer(page).getByRole("button", { name: "Save" }).click();
  expect(sentBody(await saved).title).toBe(heading);
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
  await expect(readerTitle(page)).toHaveText(heading, ROUND_TRIP);
});

test("a document whose H1 already matches its stored title shows no rename warning", async ({ page }) => {
  const title = unique("Matching Title");
  const url = await createNote(page, title, `# ${title}\n\nbody`);
  await openEditor(page, url);
  await expect(composer(page).getByText("Saving will rename this document to")).toHaveCount(0);
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

// The pre-composer new-document form renamed its submit while the create was
// in flight ("Creating…"); the composer only disabled it, so a slow save
// looked idle (#75). While the POST is held, the submit must read its busy
// label, not the idle one.
test("a create in flight reads Creating…, so the save looks busy", async ({ page }) => {
  const title = unique("Held Create");
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge/new`);
  const form = composer(page);
  const titleField = form.getByLabel("Title", { exact: true });
  await expect(titleField).toBeEditable(ROUND_TRIP);
  await titleField.fill(title);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/workspaces/*/documents", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    await gate;
    await route.continue();
  });

  await form.getByRole("button", { name: "Create document" }).click();
  const busy = form.getByRole("button", { name: "Creating…" });
  await expect(busy).toBeVisible();
  await expect(busy).toBeDisabled();

  release();
  await expect(page.getByRole("treeitem", { name: title, exact: true })).toBeVisible(ROUND_TRIP);
});

// Same busy-label contract on the edit side: "Save" becomes "Saving…".
test("a save in flight reads Saving…, so the edit looks busy", async ({ page }) => {
  const title = unique("Held Save");
  const url = await createNote(page, title, `# ${title}\n\nbody\n`);
  await openEditor(page, url);
  const form = composer(page);
  const body = await showMarkdown(form);
  await body.fill(`# ${title}\n\nchanged\n`);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/documents/*", async (route) => {
    if (route.request().method() !== "PATCH") { await route.continue(); return; }
    await gate;
    await route.continue();
  });

  await form.getByRole("button", { name: "Save" }).click();
  const busy = form.getByRole("button", { name: "Saving…" });
  await expect(busy).toBeVisible();
  await expect(busy).toBeDisabled();

  release();
  await expect(page.locator("article").first().getByText("changed")).toBeVisible(ROUND_TRIP);
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
