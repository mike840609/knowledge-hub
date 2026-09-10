import { expect, test } from "@playwright/test";

test("creates a document, reloads its stable URL, and finds it through the tree", async ({ page }) => {
  const title = `Phase 0 smoke ${Date.now()}`;
  const markdown = "A document created from the Knowledge Hub smoke flow.";

  await page.goto("/knowledge");
  await expect(page.getByRole("heading", { name: "Knowledge" })).toBeVisible();
  await expect(page.getByText("E2E Knowledge User")).toBeVisible();
  await expect(page.getByLabel("Choose a workspace")).toHaveValue("0199f000-0000-7000-8000-000000000001");
  await expect(page.getByLabel("Choose a workspace").locator("option:checked")).toHaveText("Local Knowledge");
  await expect(page.getByRole("region", { name: "Your source tree" }).getByRole("heading", { name: "Local Hub" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Your source tree" }).getByText("Getting Started", { exact: true })).toBeVisible();

  const form = page.getByRole("form", { name: "Create a document in Local Hub" });
  await expect(form.getByText("Source:", { exact: false })).toBeVisible();
  await form.getByLabel("Parent folder").selectOption({ label: "Getting Started" });
  await form.getByLabel("Title").fill(title);
  await form.getByLabel("Markdown").fill(markdown);
  await form.evaluate((element) => {
    for (const [name, value] of [["id", "forged-id"], ["emp_id", "FORGED-EMP"], ["org_code", "FORGED-ORG"]]) {
      const field = document.createElement("input");
      field.type = "hidden";
      field.name = name;
      field.value = value;
      element.appendChild(field);
    }
  });
  await form.getByRole("button", { name: "Create document" }).click();

  await expect(page).toHaveURL(/\/knowledge\/[0-9a-f-]+$/);
  const stableUrl = page.url();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText(markdown, { exact: true })).toBeVisible();
  await expect(page.getByText("Current revision 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Created by identity: 0199f000-0000-7000-8000-000000000909", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(stableUrl);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText(markdown, { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "← Back to Knowledge" }).click();
  await expect(page).toHaveURL(/\/knowledge$/);
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(page).toHaveURL(stableUrl);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
});
