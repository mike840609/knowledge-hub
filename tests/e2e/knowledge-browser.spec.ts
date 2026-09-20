import { expect, test } from "@playwright/test";

// Workspace-scoped Knowledge Explorer acceptance (Task 11 rewrite of the
// legacy /knowledge browser spec). Canonical route:
// /w/:workspaceId/knowledge/:sourceId/:documentId with a persistent shell and
// a persistent Source Tree. Mirrors scripts/db/seed.ts BROWSER_FIXTURES
// (Playwright cannot resolve `@/` aliases).
const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const SWFP_WORKSPACE = "0199f100-0000-7000-8000-000000000002";
const OBSIDIAN_SOURCE = "0199f100-0000-7000-8000-000000000101";
const SWFP_SOURCE = "0199f100-0000-7000-8000-000000000102";
const ARCHITECTURE_TITLE = "Architecture";
const ARCHITECTURE_BODY_V1 = "The Query Master architecture notes, first revision.";
const ARCHITECTURE_BODY_V2 = "The Query Master architecture notes, second revision.";
const RUNBOOKS_TITLE = "Runbooks";
const RUNBOOKS_BODY = "Team runbooks for Query Master operations.";
const RETIRED_TITLE = "Retired Notes";
const SWFP_TITLE = "SWFP Onboarding";
const SWFP_BODY = "Onboarding notes for the SWFP workspace.";
const SECRET_DOCUMENT_ID = "0199f100-0000-7000-8000-000000000201";
const SECRET_TITLE = "Restricted Secret Plan";
const SECRET_BODY = "restricted-secret-body-9f31";
const MISSING_DOCUMENT_ID = "0199f100-0000-7000-8000-000000009999";

const CANONICAL_DOC_URL = new RegExp(
  `/w/${QUERY_MASTER_WORKSPACE}/knowledge/${OBSIDIAN_SOURCE}/[0-9a-f-]+`,
);

test("browses the persistent explorer with a stable canonical document URL", async ({ page }) => {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/${OBSIDIAN_SOURCE}`);
  await expect(page).toHaveURL(CANONICAL_DOC_URL);

  // Persistent shell: brand, Workspace selector, and primary nav.
  await expect(page.getByText("Knowledge Hub", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Workspace: Query Master", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Knowledge" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sources" })).toBeVisible();

  // Legacy query-form controls are gone.
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
  await expect(page.getByText("All sources", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to Knowledge" })).toHaveCount(0);

  // Persistent Source Tree scoped to the current Source.
  await expect(page.getByRole("button", { name: "Obsidian Wiki", exact: true })).toHaveAttribute("aria-expanded", "true");
  const tree = page.getByRole("tree", { name: "Knowledge tree" });
  await expect(tree).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: ARCHITECTURE_TITLE, exact: true })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: RUNBOOKS_TITLE, exact: true })).toBeVisible();
  await expect(tree.getByText(RETIRED_TITLE, { exact: true })).toHaveCount(0);

  // Current revision renders; history lives in the closed-by-default Inspector.
  await expect(page.getByRole("heading", { name: ARCHITECTURE_TITLE })).toBeVisible();
  // Current revision renders in the visible article (a hidden RSC flight segment duplicates it).
  await expect(page.locator("article").first().getByText(ARCHITECTURE_BODY_V2, { exact: true })).toBeVisible();
  await expect(page.getByText(ARCHITECTURE_BODY_V1, { exact: true })).toHaveCount(0);

  // Switching Documents keeps the Tree mounted and the URL canonical.
  await tree.getByRole("treeitem", { name: RUNBOOKS_TITLE, exact: true }).click();
  await expect(page).toHaveURL(CANONICAL_DOC_URL);
  await expect(tree).toBeVisible();
  await expect(page.getByRole("heading", { name: RUNBOOKS_TITLE })).toBeVisible();
  await expect(page.locator("article").first().getByText(RUNBOOKS_BODY, { exact: true })).toBeVisible();

  const stableUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL(stableUrl);
  await expect(tree).toBeVisible();
  await expect(page.getByRole("heading", { name: RUNBOOKS_TITLE })).toBeVisible();
});

test("switches workspace through the shell selector", async ({ page }) => {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/${OBSIDIAN_SOURCE}`);
  await expect(page.getByRole("heading", { name: ARCHITECTURE_TITLE })).toBeVisible();

  await page.getByLabel("Workspace: Query Master", { exact: true }).click();
  await page.getByRole("menuitem", { name: "SWFP", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/w/${SWFP_WORKSPACE}/knowledge/${SWFP_SOURCE}/[0-9a-f-]+`),
  );
  await expect(page.getByRole("heading", { name: SWFP_TITLE })).toBeVisible();
  await expect(page.locator("article").first().getByText(SWFP_BODY, { exact: true })).toBeVisible();
  await expect(page.getByRole("tree", { name: "Knowledge tree" })).toBeVisible();
  await expect(page.getByText(ARCHITECTURE_TITLE, { exact: true })).toHaveCount(0);
});

test("reveals archived documents only with the archived toggle", async ({ page }) => {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/${OBSIDIAN_SOURCE}`);
  // The bare source URL redirects to its first document. Wait for that landing
  // before touching the toggle: the tree renders on both the intermediate and
  // the final page, so the assertions below do not gate the redirect, and a
  // click issued mid-navigation is discarded (seen as an intermittent failure
  // under full-suite load, reproducing as a plain document URL with no query).
  await expect(page).toHaveURL(new RegExp(`/knowledge/${OBSIDIAN_SOURCE}/[0-9a-f-]+$`));
  const tree = page.getByRole("tree", { name: "Knowledge tree" });
  await expect(tree).toBeVisible();
  await expect(tree.getByText(RETIRED_TITLE, { exact: true })).toHaveCount(0);

  // The toggle is a controlled checkbox driving a client navigation, so click
  // the label and wait for the URL + checked state instead of check().
  await page.getByRole("complementary", { name: "Knowledge explorer" }).getByLabel("Document display options").click();
  await page.getByRole("menuitemcheckbox", { name: "Show archived" }).click();
  await expect(page).toHaveURL(/includeArchived=true/);
  // Choosing an option closes the menu: this one navigates, so leaving it open
  // would park it over a view that changed underneath. Base UI defaults
  // checkbox items to staying open, so assert the close rather than assume it
  // — this passed for years on the reopen alone, which is satisfied just as
  // well by a menu that never closed.
  await expect(page.getByRole("menuitemcheckbox", { name: "Show archived" })).toHaveCount(0);
  // Reopen to read the state back.
  await page.getByRole("complementary", { name: "Knowledge explorer" }).getByLabel("Document display options").click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Show archived" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");

  const retiredItem = tree.getByRole("treeitem", { name: RETIRED_TITLE, exact: true });
  await expect(retiredItem).toBeVisible();
  const retiredLink = retiredItem.getByRole("link").first();
  await expect(retiredLink).toHaveAttribute("href", /includeArchived=true/);

  await retiredItem.click();
  await expect(page).toHaveURL(
    new RegExp(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/${OBSIDIAN_SOURCE}/[0-9a-f-]+\\?includeArchived=true`),
  );
  await expect(page.getByRole("heading", { name: RETIRED_TITLE })).toBeVisible();

  const plainUrl = page.url().replace("?includeArchived=true", "");
  await page.goto(plainUrl);
  await expect(page.getByRole("heading", { name: "Not found or no access" })).toBeVisible();
  await expect(page.getByText(RETIRED_TITLE, { exact: true })).toHaveCount(0);
});

test("shows not-found for a missing document URL", async ({ page }) => {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/${OBSIDIAN_SOURCE}/${MISSING_DOCUMENT_ID}`);
  await expect(page.getByRole("heading", { name: "Not found or no access" })).toBeVisible();
});

test("leaks no title or snippet on a direct unauthorized document URL", async ({ page }) => {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/${OBSIDIAN_SOURCE}/${SECRET_DOCUMENT_ID}`);
  await expect(page.getByText(SECRET_TITLE, { exact: true })).toHaveCount(0);
  await expect(page.getByText(SECRET_BODY, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Not found or no access" })).toBeVisible();
});
