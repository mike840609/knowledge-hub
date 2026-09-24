import { expect, test } from "@playwright/test";

const WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const SOURCE = "0199f100-0000-7000-8000-000000000101";

async function openDocumentFilter(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Filter documents and sources" }).click();
  return page.getByPlaceholder("Filter documents and sources");
}

test("keeps Source Tree visible while switching Documents", async ({ page }) => {
  await page.goto(`/w/${WORKSPACE}/knowledge/${SOURCE}`);
  const tree = page.getByRole("tree", { name: "Knowledge tree" });
  await expect(tree).toBeVisible();
  await expect(page.getByRole("button", { name: "Obsidian Wiki", exact: true })).toHaveAttribute("aria-expanded", "true");
  await tree.getByRole("treeitem", { name: "Runbooks" }).click();
  await expect(tree).toBeVisible();
  await expect(page.getByRole("heading", { name: "Runbooks" })).toBeVisible();
});

test("filters the current Source", async ({ page }) => {
  // Wait for hydration: filling the controlled filter before React attaches
  // listeners loses the input event (DOM shows text, tree never filters).
  await page.goto(`/w/${WORKSPACE}/knowledge/${SOURCE}`, { waitUntil: "networkidle" });
  const filter = await openDocumentFilter(page);
  await filter.fill("Runbooks");
  await expect(page.getByRole("treeitem", { name: "Runbooks" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Architecture" })).toHaveCount(0);
});

test("renders the Document inside the Explorer with a compact header", async ({ page }) => {
  await page.goto(`/w/${WORKSPACE}/knowledge/${SOURCE}`);
  await expect(page.getByRole("heading", { name: "Architecture" })).toBeVisible();
  // Scoped to main > header: a hidden RSC flight segment duplicates this text elsewhere.
  // The seed identity is an OWNER on a HUB_MANAGED, ACTIVE document, so the header shows
  // Edit (not the "Read only" badge, which is reserved for viewers who cannot edit).
  await expect(page.locator("main header").first().getByRole("link", { name: "Edit" })).toBeVisible();
  await expect(page.locator("main header").first().getByText(/Updated/)).toBeVisible();
  await expect(page.locator("pre").filter({
    hasText: "The Query Master architecture notes",
  })).toHaveCount(0);
});

test.describe("narrow knowledge layout", () => {
  test.use({ viewport: { width: 900, height: 900 } });

  test("uses Browse Drawer on narrow screens", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/w/${WORKSPACE}/knowledge/${SOURCE}`);
    await expect(page.getByRole("button", { name: "Browse" })).toBeVisible();

    await page.getByRole("button", { name: "Browse" }).click();
    await expect(page.getByRole("dialog", { name: "Browse knowledge" })).toBeVisible();

    // The right-hand drawer covers the document toolbar at this width.
    // Close it through its visible control before opening document details.
    await page.getByRole("dialog", { name: "Browse knowledge" }).getByRole("button", { name: "Close panel" }).click();
    await expect(page.getByRole("dialog", { name: "Browse knowledge" })).toHaveCount(0);
    await page.locator("main").getByRole("button", { name: "Details" }).click();
    await expect(page.getByRole("dialog", { name: "Document details" })).toBeVisible();
    expect(errors.filter((error) => /hydration|server rendered HTML/i.test(error))).toEqual([]);
  });
});

test("reading navigation separates collections from authoring and source management", async ({ page }) => {
  await page.goto(`/w/${WORKSPACE}/knowledge/${SOURCE}`, { waitUntil: "networkidle" });
  const explorer = page.getByRole("complementary", { name: "Knowledge explorer" });
  await expect(explorer.getByRole("heading", { name: "Documents" })).toBeVisible();
  await expect(explorer.getByRole("combobox")).toHaveCount(0);
  await expect(explorer.getByRole("button", { name: "New document" })).toHaveCount(0);
  await expect(explorer.locator('input[type="file"]')).toHaveCount(0);
  await expect(explorer.getByRole("link", { name: "Update from folder" })).toHaveCount(0);
  await expect(explorer.getByLabel("Show archived")).not.toBeVisible();

  await explorer.getByRole("button", { name: "Vendor Compliance Vault", exact: true }).click();
  await explorer.getByRole("link", { name: "Compliance Policy", exact: true }).click();
  await expect(page).toHaveURL(/\/knowledge\/0199f100-0000-7000-8000-000000000105\//);
  await expect(page.getByRole("heading", { name: "Compliance Policy", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Create document", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New document" })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toBeAttached();
  await expect(page.getByText(/upload a Markdown file to Notes/)).toBeVisible();
});

test("filters documents across collections without switching sources", async ({ page }) => {
  await page.goto(`/w/${WORKSPACE}/knowledge/${SOURCE}`, { waitUntil: "networkidle" });
  const filter = await openDocumentFilter(page);
  await filter.fill("Compliance Policy");
  await expect(page.getByRole("link", { name: "Compliance Policy", exact: true })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Architecture", exact: true })).toHaveCount(0);
  await filter.fill("no-such-document-123");
  await expect(page.getByRole("status").filter({ hasText: "No matching documents." })).toBeVisible();
});
