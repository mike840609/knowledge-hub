import { expect, test } from "@playwright/test";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS (Playwright cannot resolve `@/` aliases).
const EMPTY_WORKSPACE = "0199f100-0000-7000-8000-000000000004";
const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const SOURCE_MANAGED_SOURCE = "0199f100-0000-7000-8000-000000000105";
const SOURCE_MANAGED_DOCUMENT = "0199f100-0000-7000-8000-000000000210";

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
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge`);
  await page.setInputFiles('input[type="file"]', {
    name: "leave.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("---\ntitle: 請假流程 Uploaded\n---\n\n內容\n", "utf8"),
  });
  // level: 1 disambiguates from the setext-style "title: ..." pseudo-heading CommonMark derives
  // from the frontmatter block that stays in the stored markdown body (upload does not strip it).
  await expect(page.getByRole("heading", { name: "請假流程 Uploaded", level: 1 })).toBeVisible();
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
