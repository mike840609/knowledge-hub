import { expect, test } from "@playwright/test";

// Regression for the archived-mode link bug: every document link must preserve
// includeArchived=true while the browser is in archived mode, because an
// ACTIVE child document under an ARCHIVED source stays readable only with the
// flag (requireVisibleDocument gates on the source status).
// Mirrors scripts/db/seed.ts BROWSER_FIXTURES (Playwright cannot resolve `@/` aliases).
const ARCHIVED_SOURCE_NAME = "Retired Wiki";
const ARCHIVED_ACTIVE_TITLE = "Still Readable";
const ARCHIVED_ACTIVE_BODY = "Active notes inside an archived source stay readable with the archived flag.";

test("keeps an active doc under an archived source readable in archived mode", async ({ page }) => {
  await page.goto("/knowledge");
  await page.getByLabel("Choose a workspace").selectOption({ label: "Query Master" });
  await page.getByLabel("Include archived").check();
  await page.getByRole("button", { name: "Apply" }).click();

  const tree = page.getByRole("region", { name: "Your source tree" });
  await expect(tree.getByRole("heading", { name: ARCHIVED_SOURCE_NAME })).toBeVisible();

  const archivedSection = page.locator("section", { has: page.getByRole("heading", { name: ARCHIVED_SOURCE_NAME }) });
  const docLinks = archivedSection.getByRole("link");
  expect(await docLinks.count()).toBeGreaterThan(0);
  for (const link of await docLinks.all()) {
    await expect(link).toHaveAttribute("href", /includeArchived=true/);
  }

  const activeDocLink = archivedSection.getByRole("link", { name: ARCHIVED_ACTIVE_TITLE, exact: true });
  await expect(activeDocLink).toBeVisible();
  await expect(activeDocLink).toHaveAttribute("href", /includeArchived=true/);

  await activeDocLink.click();
  await expect(page).toHaveURL(/\/knowledge\/[0-9a-f-]+\?includeArchived=true$/);
  await expect(page.getByRole("heading", { name: ARCHIVED_ACTIVE_TITLE })).toBeVisible();
  await expect(page.getByText(ARCHIVED_ACTIVE_BODY, { exact: true })).toBeVisible();

  const plainUrl = page.url().replace("?includeArchived=true", "");
  await page.goto(plainUrl);
  await expect(page.getByRole("heading", { name: ARCHIVED_ACTIVE_TITLE })).toHaveCount(0);
  await expect(page.getByText(ARCHIVED_ACTIVE_BODY, { exact: true })).toHaveCount(0);
});
