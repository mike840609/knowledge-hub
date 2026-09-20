import { expect, test } from "@playwright/test";

// Task 6 regression: Details/Revision Inspector on the Workspace-scoped
// Document route. The Inspector is closed by default; the Details action
// opens Details + History tabs, and historical revision selection stays
// URL-driven through ?revision=N.
const WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const SOURCE = "0199f100-0000-7000-8000-000000000101";

const ARCHITECTURE_BODY_V1 = "The Query Master architecture notes, first revision.";
const ARCHITECTURE_BODY_V2 = "The Query Master architecture notes, second revision.";

test("opens the Inspector and selects a historical revision", async ({ page }) => {
  await page.goto(`/w/${WORKSPACE}/knowledge/${SOURCE}`);
  await expect(page.getByRole("heading", { name: "Architecture" })).toBeVisible();

  // Inspector is closed by default.
  await expect(page.getByRole("tab", { name: "Details" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "History" })).toHaveCount(0);

  await page.locator("main").getByRole("button", { name: "Details" }).click();
  await expect(page.getByRole("tab", { name: "Details" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "History" })).toBeVisible();

  await page.getByRole("tab", { name: "History" }).click();
  const historyPanel = page.getByRole("tabpanel", { name: "History" });
  await expect(historyPanel.getByText("Revision 1")).toBeVisible();
  await expect(historyPanel.getByText("Revision 2")).toBeVisible();

  // Default view is current (R2) before navigating to history.
  // Default view is current (R2) before navigating to history; scoped to the visible article
  // because a hidden RSC flight segment duplicates the body text.
  await expect(page.locator("article").first().getByText(ARCHITECTURE_BODY_V2, { exact: true })).toBeVisible();

  await page.getByRole("link", { name: /Revision 1/ }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${WORKSPACE}/knowledge/${SOURCE}/[0-9a-f-]+.*revision=1`));
  await expect(page.locator("article").first().getByText(ARCHITECTURE_BODY_V1, { exact: true })).toBeVisible();
  await expect(page.locator("article").first().getByText(ARCHITECTURE_BODY_V2, { exact: true })).toHaveCount(0);
  await expect(page.getByText("Viewing revision 1")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to current" })).toBeVisible();
});

test("shows Details metadata in the Inspector", async ({ page }) => {
  await page.goto(`/w/${WORKSPACE}/knowledge/${SOURCE}`);
  await expect(page.getByRole("heading", { name: "Architecture" })).toBeVisible();

  await page.locator("main").getByRole("button", { name: "Details" }).click();
  await expect(page.getByRole("tab", { name: "Details" })).toBeVisible();
  const detailsPanel = page.getByRole("tabpanel", { name: "Details" });
  await expect(detailsPanel.getByText("Query Master")).toBeVisible();
  await expect(detailsPanel.getByText("Obsidian Wiki")).toBeVisible();
});

test("shows not-found for an unknown revision number", async ({ page }) => {
  await page.goto(`/w/${WORKSPACE}/knowledge/${SOURCE}`);
  await expect(page.getByRole("heading", { name: "Architecture" })).toBeVisible();
  const documentUrl = page.url();

  await page.goto(`${documentUrl}?revision=999`);
  await expect(page.getByRole("heading", { name: "Not found or no access" })).toBeVisible();
  await expect(page.locator("article").first().getByText(ARCHITECTURE_BODY_V1, { exact: true })).toHaveCount(0);
  await expect(page.locator("article").first().getByText(ARCHITECTURE_BODY_V2, { exact: true })).toHaveCount(0);
});
