import { expect, test } from "./fixtures/test";

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
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
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
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
  // Scoped to main > header: a hidden RSC flight segment duplicates this text elsewhere.
  // The seed identity is an OWNER on a HUB_MANAGED, ACTIVE document, so the header shows
  // Edit (not the "Read only" badge, which is reserved for viewers who cannot edit). Edit is on the
  // breadcrumb line, which sits just above <header> so that a wide screen can pin it.
  await expect(page.getByRole("region", { name: "Document content", exact: true }).getByRole("link", { name: "Edit" })).toHaveCount(0);
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
    await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();

    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();

    // The right-hand drawer covers the document toolbar at this width.
    // Close it through its visible control before opening document details.
    await page.getByRole("dialog", { name: "Menu" }).getByRole("button", { name: "Close panel" }).click();
    await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0);
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
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("New document");
  await expect(page.locator("main").getByRole("textbox", { name: "Content" })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toBeAttached();
  await expect(page.getByText("Upload .md")).toBeVisible();
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

test("a synced source's heading marks it read-only, and hover or focus shows its chevron", async ({ page }) => {
  await page.goto(`/w/${WORKSPACE}/knowledge/${SOURCE}`, { waitUntil: "networkidle" });
  const explorer = page.getByRole("complementary", { name: "Knowledge explorer" });
  const synced = explorer.getByRole("button", { name: "Vendor Compliance Vault", exact: true });
  const hub = explorer.getByRole("button", { name: "Obsidian Wiki", exact: true });

  // At rest: the synced source shows the lock, and says why; the Hub source shows neither.
  await expect(synced.locator("[data-read-only-cue]")).toBeVisible();
  await expect(synced.locator("[data-expand-cue]")).toBeHidden();
  await expect(synced).toHaveAccessibleDescription("Synced from a folder, read-only in the Hub");
  await expect(hub.locator("[data-read-only-cue]")).toHaveCount(0);
  await expect(hub.locator("[data-expand-cue]")).toBeHidden();
  await expect(hub).not.toHaveAccessibleDescription(/read-only/);

  // Keyboard focus (no pointer press yet, so focus is focus-visible) shows the chevron in place of the lock.
  await page.mouse.move(0, 0);
  await synced.focus();
  await expect(synced.locator("[data-expand-cue]")).toBeVisible();
  await expect(synced.locator("[data-read-only-cue]")).toBeHidden();
  await synced.blur();

  // Hover does the same, and changes nothing but the glyph.
  const expanded = await synced.getAttribute("aria-expanded");
  await synced.hover();
  await expect(synced.locator("[data-expand-cue]")).toBeVisible();
  await expect(synced.locator("[data-read-only-cue]")).toBeHidden();
  await expect(synced).toHaveAttribute("aria-expanded", expanded!);
  await hub.hover();
  await expect(hub.locator("[data-expand-cue]")).toBeVisible();
});

test("a favorite from a synced source carries the read-only cue; one from a Hub source does not", async ({ page }) => {
  await page.goto(`/w/${WORKSPACE}/knowledge/${SOURCE}`, { waitUntil: "networkidle" });
  const explorer = page.getByRole("complementary", { name: "Knowledge explorer" });
  const vault = explorer.getByRole("button", { name: "Vendor Compliance Vault", exact: true });
  if (await vault.getAttribute("aria-expanded") === "false") await vault.click();
  await explorer.getByRole("button", { name: "Add to favorites: Compliance Policy", exact: true }).click();
  await explorer.getByRole("button", { name: "Add to favorites: Runbooks", exact: true }).click();
  try {
    const favorites = explorer.getByRole("region", { name: "Favorites" });
    const toggle = favorites.getByRole("button", { name: "Favorites", exact: true });
    if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
    const synced = favorites.getByRole("link", { name: "Compliance Policy", exact: true });
    const hub = favorites.getByRole("link", { name: "Runbooks", exact: true });
    await expect(synced.locator("[data-read-only-cue]")).toBeVisible();
    await expect(synced).toHaveAccessibleDescription("Synced from a folder, read-only in the Hub");
    await expect(hub.locator("[data-read-only-cue]")).toHaveCount(0);
    await expect(hub).not.toHaveAccessibleDescription(/read-only/);
  } finally {
    for (const title of ["Compliance Policy", "Runbooks"]) {
      const remove = explorer.getByRole("button", { name: `Remove from favorites: ${title}`, exact: true }).first();
      if (await remove.count()) await remove.click();
    }
    await expect(explorer.getByRole("button", { name: /^Remove from favorites: (Compliance Policy|Runbooks)$/ })).toHaveCount(0);
  }
});
