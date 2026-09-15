import { expect, test } from "@playwright/test";

// Regression for the archived-mode link bug: every document link must preserve
// includeArchived=true while the browser is in archived mode, because an
// ACTIVE child document under an ARCHIVED source stays readable only with the
// flag (requireVisibleDocument gates on the source status). Workspace-scoped
// rewrite (Task 11): canonical /w/:workspaceId/knowledge/:sourceId/:documentId
// routes with the persistent shell and persistent Source Tree.
// Mirrors scripts/db/seed.ts BROWSER_FIXTURES (Playwright cannot resolve `@/` aliases).
const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const OBSIDIAN_SOURCE = "0199f100-0000-7000-8000-000000000101";
const ARCHIVED_SOURCE = "0199f100-0000-7000-8000-000000000104";
const ARCHIVED_ACTIVE_DOCUMENT = "0199f100-0000-7000-8000-000000000204";
const ARCHIVED_ACTIVE_TITLE = "Still Readable";
const ARCHIVED_ACTIVE_BODY = "Active notes inside an archived source stay readable with the archived flag.";

test("keeps an active doc under an archived source readable in archived mode", async ({ page }) => {
  await page.goto(
    `/w/${QUERY_MASTER_WORKSPACE}/knowledge/${ARCHIVED_SOURCE}/${ARCHIVED_ACTIVE_DOCUMENT}?includeArchived=true`,
  );

  // Persistent shell and persistent Source Tree survive on the archived route.
  await expect(page.getByText("Knowledge Hub", { exact: true })).toBeVisible();
  const tree = page.getByRole("tree", { name: "Knowledge tree" });
  await expect(tree).toBeVisible();
  await expect(page.getByLabel("Show archived")).toBeChecked();

  const docLinks = tree.getByRole("treeitem").getByRole("link");
  expect(await docLinks.count()).toBeGreaterThan(0);
  for (const link of await docLinks.all()) {
    await expect(link).toHaveAttribute("href", /includeArchived=true/);
  }

  const activeDocItem = tree.getByRole("treeitem", { name: ARCHIVED_ACTIVE_TITLE, exact: true });
  await expect(activeDocItem).toBeVisible();
  await expect(activeDocItem.getByRole("link").first()).toHaveAttribute("href", /includeArchived=true/);

  await expect(page.getByRole("heading", { name: ARCHIVED_ACTIVE_TITLE })).toBeVisible();
  // Next.js retains a hidden RSC flight segment duplicating the document; scope to the
  // visible article instead of asserting a global single match.
  await expect(page.locator("article").first().getByText(ARCHIVED_ACTIVE_BODY, { exact: true })).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/${ARCHIVED_SOURCE}/${ARCHIVED_ACTIVE_DOCUMENT}\\?includeArchived=true`),
  );

  const plainUrl = page.url().replace("?includeArchived=true", "");
  await page.goto(plainUrl);
  await expect(page.getByRole("heading", { name: "Not found or no access" })).toBeVisible();
  // The persistent sidebar Tree may still list the node, so scope absence to
  // the Document region: no heading and no article body for the gated doc.
  await expect(page.getByRole("heading", { name: ARCHIVED_ACTIVE_TITLE })).toHaveCount(0);
  await expect(page.locator("article").getByText(ARCHIVED_ACTIVE_BODY, { exact: true })).toHaveCount(0);
});

test("switching to an archived Source preserves archived mode", async ({ page }) => {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/${OBSIDIAN_SOURCE}?includeArchived=true`);
  await expect(page.getByLabel("Show archived")).toBeChecked();

  await page.getByLabel("Source").selectOption(ARCHIVED_SOURCE);

  await expect(page).toHaveURL(
    new RegExp(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/${ARCHIVED_SOURCE}/${ARCHIVED_ACTIVE_DOCUMENT}\\?includeArchived=true`),
  );
  await expect(page.getByRole("heading", { name: ARCHIVED_ACTIVE_TITLE })).toBeVisible();
});
