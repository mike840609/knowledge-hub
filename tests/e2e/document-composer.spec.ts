import { expect, test, type Page } from "@playwright/test";

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

async function openEditor(page: Page, documentUrl: string) {
  await page.goto(`${documentUrl}/edit`);
  const body = composer(page).getByLabel("Markdown");
  await expect(body).toBeEditable(ROUND_TRIP);
  return body;
}

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
  await body.fill("body");
  await expect(composer(page).getByLabel("Title", { exact: true })).toHaveValue(title);
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

  await page.getByRole("treeitem", { name: title, exact: true }).click();
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);

  await openEditor(page, url);
  await expect(composer(page).getByRole("status").filter({ hasText: "已還原未存的修改" })).toBeVisible();
  await expect(body).toHaveValue("draft text");

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
  await page.getByRole("treeitem", { name: title, exact: true }).click();
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);

  // A new page is a new tab, with its own sessionStorage.
  const other = await page.context().newPage();
  const theirs = await openEditor(other, url);
  await theirs.fill("theirs");
  await composer(other).getByRole("button", { name: "Save" }).click();
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

  page.once("dialog", (dialog) => {
    expect(dialog.message()).toBe("Discard changes?");
    void dialog.dismiss();
  });
  await composer(page).getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/edit$/);
  await expect(body).toHaveValue("changed");

  page.once("dialog", (dialog) => void dialog.accept());
  await composer(page).getByRole("button", { name: "Cancel" }).click();
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);

  await openEditor(page, url);
  await expect(body).toHaveValue("");
  await expect(composer(page).getByRole("status").filter({ hasText: "已還原" })).toHaveCount(0);
});
