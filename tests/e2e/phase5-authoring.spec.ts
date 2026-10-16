import { expect, test, type Page } from "./fixtures/test";
import { showMarkdown } from "./composer-helpers";

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

/** The new-document page's title field. main form + first(): the duplicate-DOM quirk noted below. */
function newTitle(page: Page) {
  return page.locator("main form").first().getByLabel("Title", { exact: true });
}

// Navigate to the standalone authoring page and return only once the form is
// interactive. The create action stays disabled until the client confirms the
// workspace authorization, which gives the upload tests a stable hydration
// signal before setInputFiles dispatches the file input's change event.
async function gotoKnowledgeReadyToUpload(page: Page, workspaceId: string) {
  await page.goto(`/w/${workspaceId}/knowledge/new`);
  const title = newTitle(page);
  await expect(title).toBeEditable(ROUND_TRIP);
  // A temporary value proves the controlled input and submit handler are
  // wired after hydration without creating a document.
  await title.fill("Hydration probe");
  await expect(page.getByRole("button", { name: "Create document" })).toBeEnabled(ROUND_TRIP);
  await title.fill("");
}

test("creates the first document in a workspace with no sources", async ({ page }) => {
  await gotoKnowledgeReadyToUpload(page, EMPTY_WORKSPACE);
  await newTitle(page).fill("My First Note");
  await page.getByRole("button", { name: "Create document" }).click();

  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("My First Note", ROUND_TRIP);
});

test("edits a hub-managed document and records a second revision", async ({ page }) => {
  await gotoKnowledgeReadyToUpload(page, EMPTY_WORKSPACE);
  await newTitle(page).fill("Editable Note");
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Editable Note", ROUND_TRIP);

  const editorForm = page.locator("main");
  const source = await showMarkdown(editorForm);
  await source.fill("updated body");
  await expect(page.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "saved", ROUND_TRIP);

  await editorForm.getByRole("button", { name: "Markdown", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Content", exact: true })).toContainText("updated body", ROUND_TRIP);
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
  await newTitle(page).fill(before);
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(before, ROUND_TRIP);
  // Creating navigates to the new document too, and the tree must gain its row.
  await expect(page.getByRole("treeitem", { name: before, exact: true })).toBeVisible(ROUND_TRIP);

  const editorForm = page.locator("main");
  await editorForm.getByLabel("Title", { exact: true }).fill(after);
  await expect(page.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "saved", ROUND_TRIP);

  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(after, ROUND_TRIP);
  // Opening Details refreshes saved metadata immediately, including the shared tree.
  await page.getByRole("button", { name: "Details", exact: true }).click();
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
  await newTitle(page).fill("Conflict Note");
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Conflict Note", ROUND_TRIP);
  const documentUrl = page.url();

  // Two editors open the same base revision. A second page in the same context is
  // the same identity — the conflict is about revision versioning, not authorization.
  await page.goto(documentUrl);
  const editorA = page.locator("main");
  const pageB = await page.context().newPage();
  pageB.on("dialog", (dialog) => void dialog.accept());
  await pageB.goto(documentUrl);
  const editorB = pageB.locator("main");

  // A saves first and wins.
  const sourceA = await showMarkdown(editorA);
  await sourceA.fill("winner body");
  await expect(page.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "saved", ROUND_TRIP);

  // B saves stale: conflict shown, input preserved, reload offered — no silent overwrite.
  const sourceB = await showMarkdown(editorB);
  await sourceB.fill("loser body");
  await expect(pageB.getByText("Someone updated this document.", { exact: false })).toBeVisible(ROUND_TRIP);
  await expect(sourceB).toHaveValue("loser body");
  await expect(pageB.getByRole("button", { name: "Load latest version", exact: true })).toBeVisible();

  // Explicitly discard the local recovery copy before reading the persisted winner.
  await pageB.getByRole("button", { name: "Load latest version", exact: true }).click();
  await pageB.getByRole("button", { name: "Discard and load latest", exact: true }).click();
  await expect(pageB.locator("article").first().getByText("winner body")).toBeVisible(ROUND_TRIP);
  await expect(pageB.getByText("loser body")).toHaveCount(0);
  await pageB.close();
});

// Blocking framework chunks allows streamed HTML to appear without hydration.
// The inline title must remain disabled and there must be no native submit path.
test("the editor cannot accept changes before hydration", async ({ page, browser }) => {
  await gotoKnowledgeReadyToUpload(page, EMPTY_WORKSPACE);
  await newTitle(page).fill("Pre-hydration Note");
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Pre-hydration Note", ROUND_TRIP);
  const documentUrl = page.url();
  const context = await browser.newContext();
  const unhydrated = await context.newPage();
  try {
    await unhydrated.route("**/_next/static/chunks/**", (route) => route.abort());
    await unhydrated.goto(documentUrl);
    await expect(unhydrated.getByRole("textbox", { name: "Title", exact: true })).toBeDisabled();
    await expect(unhydrated.getByRole("textbox", { name: "Content", exact: true })).toHaveCount(0);
    await expect(unhydrated.locator('main button[type="submit"]')).toHaveCount(0);
    expect(unhydrated.url()).toBe(documentUrl);
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
  await expect(page.getByText("This file is not valid UTF-8 text and cannot be uploaded.")).toBeVisible();
});
