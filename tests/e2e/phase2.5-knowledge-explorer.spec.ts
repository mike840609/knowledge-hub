import { expect, test } from "@playwright/test";

const WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const SOURCE = "0199f100-0000-7000-8000-000000000101";

test("keeps Source Tree visible while switching Documents", async ({ page }) => {
  await page.goto(`/w/${WORKSPACE}/knowledge/${SOURCE}`);
  const tree = page.getByRole("tree", { name: "Knowledge tree" });
  await expect(tree).toBeVisible();
  await expect(page.getByLabel("Source")).toHaveValue(SOURCE);
  await tree.getByRole("treeitem", { name: "Runbooks" }).click();
  await expect(tree).toBeVisible();
  await expect(page.getByRole("heading", { name: "Runbooks" })).toBeVisible();
});

test("filters the current Source", async ({ page }) => {
  // Wait for hydration: filling the controlled filter before React attaches
  // listeners loses the input event (DOM shows text, tree never filters).
  await page.goto(`/w/${WORKSPACE}/knowledge/${SOURCE}`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("Filter tree").fill("Runbooks");
  await expect(page.getByRole("treeitem", { name: "Runbooks" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Architecture" })).toHaveCount(0);
});

test("renders the Document inside the Explorer with a compact header", async ({ page }) => {
  await page.goto(`/w/${WORKSPACE}/knowledge/${SOURCE}`);
  await expect(page.getByRole("heading", { name: "Architecture" })).toBeVisible();
  await expect(page.getByText("Read only")).toBeVisible();
  await expect(page.getByText(/Updated/)).toBeVisible();
  await expect(page.locator("pre").filter({
    hasText: "The Query Master architecture notes",
  })).toHaveCount(0);
});

test.describe("narrow knowledge layout", () => {
  test.use({ viewport: { width: 900, height: 900 } });

  test("uses Browse Drawer on narrow screens", async ({ page }) => {
    await page.goto(`/w/${WORKSPACE}/knowledge/${SOURCE}`);
    await expect(page.getByRole("button", { name: "Browse" })).toBeVisible();

    await page.getByRole("button", { name: "Browse" }).click();
    await expect(page.getByRole("dialog", { name: "Browse knowledge" })).toBeVisible();

    await page.getByRole("button", { name: "Details" }).click();
    await expect(page.getByRole("dialog", { name: "Browse knowledge" }))
      .toHaveCount(0);
  });
});
