import { expect, test, type Dialog, type Page } from "@playwright/test";

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

async function openEditor(page: Page, documentUrl: string) {
  await page.goto(`${documentUrl}/edit`);
  const body = composer(page).getByLabel("Markdown");
  await expect(body).toBeEditable(ROUND_TRIP);
  return body;
}

test("focus lands in Title on arrival, and in Markdown at position 0 for an H1-led document", async ({ page }) => {
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge/new`);
  const titleField = composer(page).getByLabel("Title", { exact: true });
  await expect(titleField).toBeFocused(ROUND_TRIP);

  const title = unique("Focus H1");
  const url = await createNote(page, title, `# ${title}\n\nbody`);
  const body = await openEditor(page, url);
  await expect(body).toBeFocused(ROUND_TRIP);
  expect(await body.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(0);
});

test("a document that opens with an H1 is named by it, with no title field", async ({ page }) => {
  const before = unique("Composer H1");
  const after = unique("Composer Renamed");
  const url = await createNote(page, before, `# ${before}\n\nbody`);
  const body = await openEditor(page, url);
  await expect(composer(page).getByLabel("Title", { exact: true })).toHaveCount(0);

  await body.fill(`# ${after}\n\nbody`);
  await expect(composer(page).getByRole("navigation", { name: "Breadcrumb" })).toContainText(after);
  await composer(page).getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("treeitem", { name: after, exact: true })).toBeVisible(ROUND_TRIP);
});

test("deleting the opening H1 brings back the title field, filled with it", async ({ page }) => {
  const title = unique("Carry");
  const url = await createNote(page, title, `# ${title}\n\nbody`);
  const body = await openEditor(page, url);
  // Change the H1 away from the stored title first, so a no-op carryTitle
  // (one that just leaves the stored title alone) cannot pass this test.
  const changedHeading = unique("Carry Changed");
  await body.fill(`# ${changedHeading}\n\nbody`);
  await expect(composer(page).getByLabel("Title", { exact: true })).toHaveCount(0);

  await body.fill("body");
  await expect(composer(page).getByLabel("Title", { exact: true })).toHaveValue(changedHeading);
});

test("a frontmatter title survives editing the H1", async ({ page }) => {
  const title = unique("Frontmatter Title");
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge/new`);
  // Enabled once hydrated and authorized, on the old form and the composer alike.
  await expect(page.locator('input[type="file"]')).toBeEnabled(ROUND_TRIP);
  await page.setInputFiles('input[type="file"]', {
    name: "fm.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(`---\ntitle: ${title}\n---\n\n# A different heading\n\ntext\n`, "utf8"),
  });
  await expect(page).not.toHaveURL(/\/new$/, ROUND_TRIP);

  const body = await openEditor(page, page.url());
  await expect(composer(page).getByText("標題來自上傳檔案的 frontmatter")).toBeVisible();
  // The body opens with its own H1, so preview shows that one heading, as the reader does.
  await composer(page).getByRole("button", { name: "Preview" }).click();
  await expect(composer(page).getByRole("region", { name: "Preview" }).getByRole("heading", { level: 1 })).toHaveCount(1);
  await page.keyboard.press("Escape");
  await body.fill("# Another heading entirely\n\ntext");
  await composer(page).getByRole("button", { name: "Save" }).click();
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
  await expect(page.getByRole("treeitem", { name: title, exact: true })).toBeVisible(ROUND_TRIP);
});

test("preview shows the saved look and returns to the same text and caret", async ({ page }) => {
  const url = await createNote(page, unique("Preview"));
  const body = await openEditor(page, url);
  await body.fill("Some **bold** words");
  await body.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(4, 4));

  await composer(page).getByRole("button", { name: "Preview" }).click();
  const preview = composer(page).getByRole("region", { name: "Preview" });
  await expect(preview.locator("strong")).toHaveText("bold");
  await expect(body).toBeHidden();

  await page.keyboard.press("Escape");
  await expect(body).toBeVisible();
  await expect(body).toBeFocused();
  await expect(body).toHaveValue("Some **bold** words");
  expect(await body.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(4);

  await page.keyboard.press("ControlOrMeta+Shift+P");
  await expect(preview).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
  await expect(page.locator("article").first().locator("strong")).toHaveText("bold", ROUND_TRIP);
});

test("an unsaved edit survives leaving and is offered back on return", async ({ page }) => {
  const title = unique("Draft");
  const url = await createNote(page, title);
  const body = await openEditor(page, url);
  await body.fill("draft text");

  await leaveEditor(page, url);

  await openEditor(page, url);
  await expect(composer(page).getByRole("status").filter({ hasText: "已還原未存的修改" })).toBeVisible();
  await expect(body).toHaveValue("draft text");
  // F1: a restored draft's caret belongs at the start, same as a fresh open.
  await expect(body).toBeFocused(ROUND_TRIP);
  expect(await body.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(0);

  await composer(page).getByRole("button", { name: "捨棄" }).click();
  await expect(body).toHaveValue("");
  await page.reload();
  await expect(body).toBeEditable(ROUND_TRIP);
  await expect(composer(page).getByRole("status").filter({ hasText: "已還原" })).toHaveCount(0);
});

test("a restored draft on a document someone changed meanwhile conflicts instead of overwriting", async ({ page }) => {
  const title = unique("Stale Draft");
  const url = await createNote(page, title);
  const body = await openEditor(page, url);
  await body.fill("mine");
  await leaveEditor(page, url);

  // A new page is a new tab, with its own sessionStorage.
  const other = await page.context().newPage();
  const theirs = await openEditor(other, url);
  await theirs.fill("theirs");
  await composer(other).getByRole("button", { name: "Save" }).click();
  await expect(other).not.toHaveURL(/\/edit$/, ROUND_TRIP);
  await expect(other.locator("article").first().getByText("theirs")).toBeVisible(ROUND_TRIP);
  await other.close();

  await openEditor(page, url);
  await expect(composer(page).getByRole("status").filter({ hasText: "被更新過" })).toBeVisible();
  await expect(body).toHaveValue("mine");
  await composer(page).getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "已被其他人更新" })).toBeVisible(ROUND_TRIP);
  await expect(body).toHaveValue("mine");

  await composer(page).getByRole("button", { name: "載入最新版本（捨棄你的修改）" }).click();
  await expect(body).toHaveValue("theirs", ROUND_TRIP);
  await expect(composer(page).getByRole("status").filter({ hasText: "已還原" })).toHaveCount(0);
});

test("Cancel asks before discarding changes, and discarding clears the draft", async ({ page }) => {
  const url = await createNote(page, unique("Cancel"));
  const body = await openEditor(page, url);
  await body.fill("changed");
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
  await expect(body).toBeVisible();
  await expect(body).toHaveValue("changed");

  const accepted = page.waitForEvent("dialog");
  const acceptClick = cancel.click();
  const acceptDialog = await accepted;
  await acceptDialog.accept();
  await acceptClick;
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);

  await openEditor(page, url);
  await expect(body).toHaveValue("");
  await expect(composer(page).getByRole("status").filter({ hasText: "已還原" })).toHaveCount(0);
});

test("Enter in the title field moves to Markdown instead of submitting", async ({ page }) => {
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge/new`);
  const form = composer(page);
  const titleField = form.getByLabel("Title", { exact: true });
  await expect(titleField).toBeEditable(ROUND_TRIP);
  await titleField.fill(unique("Enter In Title"));

  await titleField.press("Enter");
  await expect(page).toHaveURL(/\/new$/);
  await expect(form.getByLabel("Markdown")).toBeFocused();
});

test("Esc exits preview for good, even if its keydown fires twice before React re-renders", async ({ page }) => {
  const url = await createNote(page, unique("Preview Exit"));
  const body = await openEditor(page, url);
  await composer(page).getByRole("button", { name: "Preview" }).click();
  const preview = composer(page).getByRole("region", { name: "Preview" });
  await expect(preview).toBeVisible();

  // A held key auto-repeats: two native keydowns can be dispatched before
  // React commits the state update from the first one, so both read the same
  // "still previewing" closure. A toggle() for each would flip twice and land
  // back in preview; an idempotent exit() lands on editing either way.
  await composer(page).evaluate((form) => {
    const escape = () => new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    form.dispatchEvent(escape());
    form.dispatchEvent(escape());
  });

  await expect(preview).toBeHidden();
  await expect(body).toBeVisible();
});

test("a new document can be named by its H1 alone", async ({ page }) => {
  const title = unique("Only H1");
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge/new`);
  const form = composer(page);
  await expect(form.getByLabel("Title", { exact: true })).toBeEditable(ROUND_TRIP);
  await form.getByLabel("Markdown").fill(`# ${title}\n\nbody`);
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

test("the text re-fits its height when the column rewraps", async ({ page }) => {
  const url = await createNote(page, unique("Rewrap"), "word ".repeat(400));
  const body = await openEditor(page, url);
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
  await composer(page).getByLabel("Markdown").focus();
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
  const body = await openEditor(page, url);
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
