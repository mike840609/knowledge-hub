import { expect, test, type Page } from "@playwright/test";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS (Playwright cannot resolve `@/` aliases).
const EMPTY_WORKSPACE = "0199f100-0000-7000-8000-000000000004";
const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const SOURCE_MANAGED_SOURCE = "0199f100-0000-7000-8000-000000000105";
const SOURCE_MANAGED_DOCUMENT = "0199f100-0000-7000-8000-000000000210";

// Navigate to Knowledge and return only once the authoring form is interactive.
// On a populated workspace the document view is heavy (tree + reading pane +
// inspector + topbar) and hydrates lazily, so setInputFiles can dispatch the
// change event before React wires the file input's onChange — silently dropping
// the upload (no POST fires). The file input has no readiness signal of its own,
// so prove hydration through its sibling in the SAME component: open and close
// the inline create form (retried until the click's handler is attached). Once
// that onClick responds, the file input's onChange in the same form is wired too.
async function gotoKnowledgeReadyToUpload(page: Page, workspaceId: string) {
  await page.goto(`/w/${workspaceId}/knowledge`);
  await expect(async () => {
    await page.getByRole("button", { name: "New document" }).click();
    await expect(page.getByLabel("Document title")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("Document title")).toHaveCount(0);
}

test("creates the first document in a workspace with no sources", async ({ page }) => {
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge`);
  await page.getByRole("button", { name: "New document" }).click();
  await page.getByLabel("Document title").fill("My First Note");
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.getByRole("heading", { name: "My First Note" })).toBeVisible();
});

test("edits a hub-managed document and records a second revision", async ({ page }) => {
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge`);
  await page.getByRole("button", { name: "New document" }).click();
  await page.getByLabel("Document title").fill("Editable Note");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "Editable Note" })).toBeVisible();

  await page.getByRole("link", { name: "Edit", exact: true }).click();
  // main form + first(): same pre-existing duplicate-DOM quirk as the "main header" convention
  // above (a hidden leftover node the a11y tree doesn't surface, but raw-DOM locators still match).
  const editorForm = page.locator("main form").first();
  await editorForm.getByLabel("Markdown").fill("updated body");
  await editorForm.getByRole("button", { name: "Save" }).click();

  await expect(page.locator("article").first().getByText("updated body")).toBeVisible();
  await page.getByRole("button", { name: "Details" }).click();
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByRole("link", { name: /Revision 2/ })).toBeVisible();
});

test("uploads a markdown file and takes its title from frontmatter", async ({ page }) => {
  await gotoKnowledgeReadyToUpload(page, EMPTY_WORKSPACE);
  await page.setInputFiles('input[type="file"]', {
    name: "leave.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("---\ntitle: 請假流程 Uploaded\n---\n\n內容\n", "utf8"),
  });
  await expect(page.getByRole("heading", { name: "請假流程 Uploaded" })).toBeVisible();
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
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge`);
  await page.getByRole("button", { name: "New document" }).click();
  await page.getByLabel("Document title").fill("Conflict Note");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "Conflict Note" })).toBeVisible();
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
  await expect(page.locator("article").first().getByText("winner body")).toBeVisible();

  // B saves stale: conflict shown, input preserved, reload offered — no silent overwrite.
  await editorB.getByLabel("Markdown").fill("loser body");
  await editorB.getByRole("button", { name: "Save" }).click();
  await expect(pageB.getByRole("alert").filter({ hasText: "已被其他人更新" })).toBeVisible();
  await expect(editorB.getByLabel("Markdown")).toHaveValue("loser body");
  await expect(pageB.getByRole("link", { name: "重新載入最新版本" })).toBeVisible();

  // The persisted current revision is the winner's, never the loser's.
  await pageB.goto(documentUrl);
  await expect(pageB.locator("article").first().getByText("winner body")).toBeVisible();
  await expect(pageB.getByText("loser body")).toHaveCount(0);
  await pageB.close();
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
