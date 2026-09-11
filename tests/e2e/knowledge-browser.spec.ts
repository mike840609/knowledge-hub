import { expect, test, type Page } from "@playwright/test";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURES (Playwright cannot resolve `@/` aliases).
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

async function openWorkspace(page: Page, workspaceName: string): Promise<string> {
  await page.goto("/knowledge");
  await page.getByLabel("Choose a workspace").selectOption({ label: workspaceName });
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(new RegExp(`/knowledge\\?workspaceId=`));
  return page.url();
}

test("browses workspace, source, tree, and stable document URL with history", async ({ page }) => {
  const browserUrl = await openWorkspace(page, "Query Master");

  const workspaceSelect = page.getByLabel("Choose a workspace");
  await expect(workspaceSelect.locator("option:checked")).toHaveText("Query Master");
  await expect(workspaceSelect).toContainText("SWFP");

  const sourceSelect = page.getByLabel("Choose a source");
  await expect(sourceSelect.locator("option:checked")).toHaveText("All sources");
  await expect(sourceSelect).toContainText("Obsidian Wiki");

  const tree = page.getByRole("region", { name: "Your source tree" });
  await expect(tree.getByRole("heading", { name: "Obsidian Wiki" })).toBeVisible();
  await expect(tree.getByRole("link", { name: ARCHITECTURE_TITLE, exact: true })).toBeVisible();
  await expect(tree.getByRole("link", { name: RUNBOOKS_TITLE, exact: true })).toBeVisible();
  await expect(tree.getByText(RETIRED_TITLE, { exact: true })).toHaveCount(0);

  await expect(page.getByText("Create a Hub document")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create document" })).toHaveCount(0);
  await expect(page.locator('input[name="id"], input[name="emp_id"], input[name="org_code"]')).toHaveCount(0);

  await tree.getByRole("link", { name: ARCHITECTURE_TITLE, exact: true }).click();
  await expect(page).toHaveURL(/\/knowledge\/[0-9a-f-]+$/);
  const stableUrl = page.url();
  await expect(page.getByRole("heading", { name: ARCHITECTURE_TITLE })).toBeVisible();
  await expect(page.getByText(ARCHITECTURE_BODY_V2, { exact: true })).toBeVisible();
  await expect(page.getByText(ARCHITECTURE_BODY_V1, { exact: true })).toHaveCount(0);
  await expect(page.getByText("Current revision 2", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Revision history" })).toBeVisible();
  const history = page.locator("section", { has: page.getByRole("heading", { name: "Revision history" }) });
  await expect(history.getByText("Revision 1", { exact: false })).toBeVisible();
  await expect(history.getByText("Revision 2", { exact: false })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(stableUrl);
  await expect(page.getByRole("heading", { name: ARCHITECTURE_TITLE })).toBeVisible();
  await expect(page.getByText(ARCHITECTURE_BODY_V2, { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "← Back to Knowledge" }).click();
  await expect(page).toHaveURL(/\/knowledge(\?.*)?$/);
  await expect(page.getByRole("heading", { name: "Knowledge" })).toBeVisible();

  await page.goto(browserUrl);
  await page.getByRole("region", { name: "Your source tree" }).getByRole("link", { name: RUNBOOKS_TITLE, exact: true }).click();
  await expect(page).toHaveURL(/\/knowledge\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: RUNBOOKS_TITLE })).toBeVisible();
  await expect(page.getByText(RUNBOOKS_BODY, { exact: true })).toBeVisible();
});

test("switches workspace to SWFP through the selector", async ({ page }) => {
  await openWorkspace(page, "SWFP");

  const tree = page.getByRole("region", { name: "Your source tree" });
  await expect(tree.getByRole("heading", { name: "SWFP Handbook" })).toBeVisible();
  await expect(tree.getByText(ARCHITECTURE_TITLE, { exact: true })).toHaveCount(0);
  await tree.getByRole("link", { name: SWFP_TITLE, exact: true }).click();
  await expect(page).toHaveURL(/\/knowledge\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: SWFP_TITLE })).toBeVisible();
  await expect(page.getByText(SWFP_BODY, { exact: true })).toBeVisible();
});

test("reveals archived documents only with the archived toggle", async ({ page }) => {
  await page.goto("/knowledge");
  await page.getByLabel("Choose a workspace").selectOption({ label: "Query Master" });
  await page.getByLabel("Include archived").check();
  await page.getByRole("button", { name: "Apply" }).click();

  const tree = page.getByRole("region", { name: "Your source tree" });
  const retiredLink = tree.getByRole("link", { name: RETIRED_TITLE, exact: true });
  await expect(retiredLink).toBeVisible();
  await expect(retiredLink).toHaveAttribute("href", /includeArchived=true/);

  await retiredLink.click();
  await expect(page).toHaveURL(/\/knowledge\/[0-9a-f-]+\?includeArchived=true$/);
  await expect(page.getByRole("heading", { name: RETIRED_TITLE })).toBeVisible();

  const plainUrl = page.url().replace("?includeArchived=true", "");
  await page.goto(plainUrl);
  await expect(page.getByRole("heading", { name: "Document not found." })).toBeVisible();
  await expect(page.getByText(RETIRED_TITLE, { exact: true })).toHaveCount(0);
});

test("shows not-found for a missing document URL", async ({ page }) => {
  await page.goto(`/knowledge/${MISSING_DOCUMENT_ID}`);
  await expect(page.getByRole("heading", { name: "Document not found." })).toBeVisible();
});

test("leaks no title or snippet on a direct unauthorized document URL", async ({ page }) => {
  await page.goto(`/knowledge/${SECRET_DOCUMENT_ID}`);
  await expect(page.getByText(SECRET_TITLE, { exact: true })).toHaveCount(0);
  await expect(page.getByText(SECRET_BODY, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Knowledge is temporarily unavailable." })).toBeVisible();
});
