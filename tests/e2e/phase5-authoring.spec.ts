import { expect, test, type Page } from "@playwright/test";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS (Playwright cannot resolve `@/` aliases).
const EMPTY_WORKSPACE = "0199f100-0000-7000-8000-000000000004";
const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const SOURCE_MANAGED_SOURCE = "0199f100-0000-7000-8000-000000000105";
const SOURCE_MANAGED_DOCUMENT = "0199f100-0000-7000-8000-000000000210";

// Creating, saving or uploading is a POST, a client navigation and a fresh
// server render before anything appears on screen. Playwright's 5s default is
// a comfortable budget for a page that is already rendered and a tight one for
// that chain, so the server-bound assertions below are given more.
//
// This comment used to go further and say the editor-save assertions "lost the
// race intermittently, on code that had not changed — and they lost it on
// `main` too", which read as a verdict: the environment is noisy, move on. It
// was wrong, and it cost time. Those two assertions were failing on a real
// defect — `router.refresh()` immediately after `router.push()` discarded the
// navigation, ten times in sixty on a production build — whose probability
// tracked machine load, which is exactly what a flake looks like from the
// outside. The measurement is in
// docs/superpowers/verification/2026-09-22-lost-navigation-after-save-measurement.md.
// A budget is a budget; it is not evidence that what it covers is noise.
//
// It is only for assertions that wait on the server. A client-side check, such
// as the UTF-8 decode, keeps the default: giving it 15s would hide a real
// regression for three times as long.
const ROUND_TRIP = { timeout: 15_000 };

// Navigate to the standalone authoring page and return only once the form is
// interactive. The create action stays disabled until the client confirms the
// workspace authorization, which gives the upload tests a stable hydration
// signal before setInputFiles dispatches the file input's change event.
async function gotoKnowledgeReadyToUpload(page: Page, workspaceId: string) {
  await page.goto(`/w/${workspaceId}/knowledge/new`);
  const title = page.getByLabel("Document title");
  await expect(title).toBeEditable(ROUND_TRIP);
  // A temporary value proves the controlled input and submit handler are
  // wired after hydration without creating a document.
  await title.fill("Hydration probe");
  await expect(page.getByRole("button", { name: "Create document" })).toBeEnabled(ROUND_TRIP);
  await title.fill("");
}

test("creates the first document in a workspace with no sources", async ({ page }) => {
  await gotoKnowledgeReadyToUpload(page, EMPTY_WORKSPACE);
  await page.getByLabel("Document title").fill("My First Note");
  await page.getByRole("button", { name: "Create document" }).click();

  await expect(page.getByRole("heading", { name: "My First Note" })).toBeVisible(ROUND_TRIP);
});

test("edits a hub-managed document and records a second revision", async ({ page }) => {
  await gotoKnowledgeReadyToUpload(page, EMPTY_WORKSPACE);
  await page.getByLabel("Document title").fill("Editable Note");
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page.getByRole("heading", { name: "Editable Note" })).toBeVisible(ROUND_TRIP);

  await page.getByRole("link", { name: "Edit", exact: true }).click();
  // main form + first(): same pre-existing duplicate-DOM quirk as the "main header" convention
  // above (a hidden leftover node the a11y tree doesn't surface, but raw-DOM locators still match).
  const editorForm = page.locator("main form").first();
  await editorForm.getByLabel("Markdown").fill("updated body");
  await editorForm.getByRole("button", { name: "Save" }).click();

  await expect(page.locator("article").first().getByText("updated body")).toBeVisible(ROUND_TRIP);
  await page.locator("main").getByRole("button", { name: "Details" }).click();
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByRole("link", { name: /Revision 2/ })).toBeVisible();
});

// The push back from a save fetches the document page fresh, but a layout the
// editor and the document share (the sidebar tree) is kept as it was, so the
// tree went on naming the revision before the save until a reload.
test("after a save, the sidebar names the document by its new title", async ({ page }) => {
  // Unique per run: the workspace is shared across tests and repeats.
  const run = Date.now().toString(36);
  const before = `Tree Title Before ${run}`;
  const after = `Tree Title After ${run}`;
  await gotoKnowledgeReadyToUpload(page, EMPTY_WORKSPACE);
  await page.getByLabel("Document title").fill(before);
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page.getByRole("heading", { name: before })).toBeVisible(ROUND_TRIP);
  // Creating navigates to the new document too, and the tree must gain its row.
  await expect(page.getByRole("treeitem", { name: before, exact: true })).toBeVisible(ROUND_TRIP);

  await page.getByRole("link", { name: "Edit", exact: true }).click();
  const editorForm = page.locator("main form").first();
  await editorForm.getByLabel("Title", { exact: true }).fill(after);
  await editorForm.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("heading", { name: after })).toBeVisible(ROUND_TRIP);
  await expect(page.getByRole("treeitem", { name: after, exact: true })).toBeVisible(ROUND_TRIP);
  await expect(page.getByRole("treeitem", { name: before, exact: true })).toHaveCount(0);
});

test("uploads a markdown file and takes its title from frontmatter", async ({ page }) => {
  await gotoKnowledgeReadyToUpload(page, EMPTY_WORKSPACE);
  await page.setInputFiles('input[type="file"]', {
    name: "leave.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("---\ntitle: 請假流程 Uploaded\n---\n\n內容\n", "utf8"),
  });
  await expect(page.getByRole("heading", { name: "請假流程 Uploaded" })).toBeVisible(ROUND_TRIP);
});

// The seed's default HUB source (Obsidian Wiki) is HUB_MANAGED, so it alone would not exercise this
// case. scripts/db/seed.ts also seeds a SOURCE_MANAGED source ("Vendor Compliance Vault") in this
// workspace, named to sort AFTER "Obsidian Wiki" so it never changes what the bare /knowledge route
// redirects to for other specs. Navigate to its document by explicit URL instead of relying on that
// default redirect.
test("never shows Edit on source-managed content", async ({ page }) => {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/${SOURCE_MANAGED_SOURCE}/${SOURCE_MANAGED_DOCUMENT}`);
  // main header + first(): mirrors tests/e2e/phase2.5-knowledge-explorer.spec.ts, which hits the
  // same pre-existing duplicate-header DOM for this badge.
  await expect(page.locator("main header").first().getByText("Read only")).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
});

// Spec §4/§10 core acceptance: the second (stale) editor is told about the conflict,
// their typed input survives on screen, and the first editor's content is what persisted.
// Ruling B skips React component unit tests, so this browser behavior is E2E-only.
test("a stale second editor gets a conflict, keeps their input, and does not overwrite the winner", async ({ page }) => {
  await gotoKnowledgeReadyToUpload(page, EMPTY_WORKSPACE);
  await page.getByLabel("Document title").fill("Conflict Note");
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page.getByRole("heading", { name: "Conflict Note" })).toBeVisible(ROUND_TRIP);
  const documentUrl = page.url();

  // Two editors open the same base revision. A second page in the same context is
  // the same identity — the conflict is about revision versioning, not authorization.
  await page.goto(`${documentUrl}/edit`);
  const editorA = page.locator("main form").first();
  const pageB = await page.context().newPage();
  await pageB.goto(`${documentUrl}/edit`);
  const editorB = pageB.locator("main form").first();

  // A saves first and wins.
  await editorA.getByLabel("Markdown").fill("winner body");
  await editorA.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("article").first().getByText("winner body")).toBeVisible(ROUND_TRIP);

  // B saves stale: conflict shown, input preserved, reload offered — no silent overwrite.
  await editorB.getByLabel("Markdown").fill("loser body");
  await editorB.getByRole("button", { name: "Save" }).click();
  await expect(pageB.getByRole("alert").filter({ hasText: "已被其他人更新" })).toBeVisible(ROUND_TRIP);
  await expect(editorB.getByLabel("Markdown")).toHaveValue("loser body");
  await expect(pageB.getByRole("link", { name: "重新載入最新版本" })).toBeVisible();

  // The persisted current revision is the winner's, never the loser's.
  await pageB.goto(documentUrl);
  await expect(pageB.locator("article").first().getByText("winner body")).toBeVisible(ROUND_TRIP);
  await expect(pageB.getByText("loser body")).toHaveCount(0);
  await pageB.close();
});

/**
 * The editor's form is server-rendered with a `type="submit"` button and no
 * `action`, so before React attaches `preventDefault` a click is a **native**
 * submit: the browser navigates to the same URL as a GET and the draft is
 * gone. CI found this the hard way — a second page loading in the same browser
 * delayed hydration past a save.
 *
 * Holding a page in that state needs care. `javaScriptEnabled: false` does not
 * model it: this route streams, so its content arrives in a hidden `<div>` at
 * the end of the body and an *inline* script moves it into place. Turning
 * JavaScript off stops that too, and the form never reaches the page at all.
 * Blocking the framework chunks is the faithful version — inline scripts still
 * run, React never hydrates.
 */
test("the editor cannot be saved before it can handle its own submit", async ({ page, browser }) => {
  await gotoKnowledgeReadyToUpload(page, EMPTY_WORKSPACE);
  await page.getByLabel("Document title").fill("Pre-hydration Note");
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page.getByRole("heading", { name: "Pre-hydration Note" })).toBeVisible(ROUND_TRIP);
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page).toHaveURL(/\/edit$/);
  const editUrl = page.url();

  const context = await browser.newContext();
  const unhydrated = await context.newPage();
  try {
    await unhydrated.route("**/_next/static/chunks/**", (route) => route.abort());
    await unhydrated.goto(editUrl);
    const save = unhydrated.locator('main form button[type="submit"]');
    await expect(save).toHaveText("Save");
    await expect(save).toBeDisabled();

    // The guard is the attribute rather than a handler, so even a forced click
    // cannot submit the form out from under the draft.
    await save.click({ force: true }).catch(() => undefined);
    await unhydrated.waitForTimeout(500);
    expect(unhydrated.url()).toBe(editUrl);
  } finally {
    await context.close();
  }
});

// Spec §6.2 parity: folder import decodes with a fatal UTF-8 decoder, so a single
// upload must reject malformed UTF-8 too rather than storing U+FFFD replacements.
test("rejects a malformed UTF-8 upload instead of storing replacement characters", async ({ page }) => {
  await gotoKnowledgeReadyToUpload(page, EMPTY_WORKSPACE);
  await page.setInputFiles('input[type="file"]', {
    name: "broken.md",
    mimeType: "text/markdown",
    buffer: Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]), // "# " then lone invalid bytes
  });
  await expect(page.getByText("這個檔案不是有效的 UTF-8 文字，無法上傳。")).toBeVisible();
});
