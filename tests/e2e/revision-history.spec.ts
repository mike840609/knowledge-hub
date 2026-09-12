import { expect, test } from "@playwright/test";

// P2-2 regression: Task 9 Workspace→Source→Tree→Document/Revision browsing.
// The seed creates the Architecture document with R1 (first revision body)
// and R2 (second revision body). Selecting R1 from history must render its
// OLD content via caller-aware getRevision, not just the history heading.
const ARCHITECTURE_TITLE = "Architecture";
const ARCHITECTURE_BODY_V1 = "The Query Master architecture notes, first revision.";
const ARCHITECTURE_BODY_V2 = "The Query Master architecture notes, second revision.";

test("selects a historical revision and shows its old content", async ({ page }) => {
  await page.goto("/knowledge");
  await page.getByLabel("Choose a workspace").selectOption({ label: "Query Master" });
  await page.getByRole("button", { name: "Apply" }).click();
  // Seed-source scope: import E2E sources reuse the "Architecture" title.
  await page.getByLabel("Choose a source").selectOption({ label: "Obsidian Wiki" });
  await page.getByRole("button", { name: "Apply" }).click();

  const tree = page.getByRole("region", { name: "Your source tree" });
  await tree.getByRole("link", { name: ARCHITECTURE_TITLE, exact: true }).click();
  await expect(page).toHaveURL(/\/knowledge\/[0-9a-f-]+$/);

  // Default view is current (R2).
  await expect(page.getByText(ARCHITECTURE_BODY_V2, { exact: true })).toBeVisible();
  await expect(page.getByText(ARCHITECTURE_BODY_V1, { exact: true })).toHaveCount(0);
  await expect(page.getByText("Current revision 2", { exact: true })).toBeVisible();

  const history = page.locator("section", { has: page.getByRole("heading", { name: "Revision history" }) });
  const revision1Link = history.getByRole("link", { name: /Revision 1/ });
  await expect(revision1Link).toBeVisible();

  await revision1Link.click();
  await expect(page).toHaveURL(/\/knowledge\/[0-9a-f-]+\?revision=1$/);
  await expect(page.getByRole("heading", { name: "Revision history" })).toBeVisible();
  await expect(page.getByText(ARCHITECTURE_BODY_V1, { exact: true })).toBeVisible();
  await expect(page.getByText(ARCHITECTURE_BODY_V2, { exact: true })).toHaveCount(0);
  await expect(page.getByText("Viewing revision 1", { exact: false })).toBeVisible();

  await page.reload();
  await expect(page.getByText(ARCHITECTURE_BODY_V1, { exact: true })).toBeVisible();
  await expect(page.getByText(ARCHITECTURE_BODY_V2, { exact: true })).toHaveCount(0);
});

test("shows not-found for an unknown revision number", async ({ page }) => {
  await page.goto("/knowledge");
  await page.getByLabel("Choose a workspace").selectOption({ label: "Query Master" });
  await page.getByRole("button", { name: "Apply" }).click();
  await page.getByLabel("Choose a source").selectOption({ label: "Obsidian Wiki" });
  await page.getByRole("button", { name: "Apply" }).click();

  const tree = page.getByRole("region", { name: "Your source tree" });
  await tree.getByRole("link", { name: ARCHITECTURE_TITLE, exact: true }).click();
  await expect(page).toHaveURL(/\/knowledge\/[0-9a-f-]+$/);
  const documentUrl = page.url();

  await page.goto(`${documentUrl}?revision=999`);
  await expect(page.getByRole("heading", { name: "Document not found." })).toBeVisible();
  await expect(page.getByText(ARCHITECTURE_BODY_V1, { exact: true })).toHaveCount(0);
  await expect(page.getByText(ARCHITECTURE_BODY_V2, { exact: true })).toHaveCount(0);
});
