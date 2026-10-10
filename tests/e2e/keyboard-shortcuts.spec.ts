import { expect, test, type Page } from "./fixtures/test";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS.
const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const EMPTY_WORKSPACE = "0199f100-0000-7000-8000-000000000004";
const OBSIDIAN_SOURCE = "0199f100-0000-7000-8000-000000000101";
const SOURCE_MANAGED_SOURCE = "0199f100-0000-7000-8000-000000000105";
const SOURCE_MANAGED_DOCUMENT = "0199f100-0000-7000-8000-000000000210";
const ROUND_TRIP = { timeout: 15_000 };

/**
 * A key pressed before hydration reaches no listener. Press, and retry until
 * the page answers, rather than guessing how long hydration takes.
 */
async function pressUntil(page: Page, key: string, answered: () => Promise<void>) {
  await expect(async () => {
    await page.keyboard.press(key);
    await answered();
  }).toPass(ROUND_TRIP);
}

/** `/knowledge/:sourceId` redirects to a document; act once it has landed. */
async function openArchitecture(page: Page) {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/${OBSIDIAN_SOURCE}`);
  await page.getByRole("treeitem", { name: "Architecture", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Architecture" })).toBeVisible(ROUND_TRIP);
}

test("/ opens the palette without typing the slash, and the palette shows shortcuts", async ({ page }) => {
  await openArchitecture(page);
  const field = page.getByRole("combobox", { name: "Search documents and actions" });
  await pressUntil(page, "/", () => expect(field).toBeVisible({ timeout: 1_000 }));
  await expect(field).toHaveValue("");

  const list = page.getByRole("listbox", { name: "Actions and documents" });
  await expect(list.getByRole("option", { name: /Create document/ }).locator("kbd")).toHaveText("C");
  await expect(list.getByRole("option", { name: /Edit document/ }).locator("kbd")).toHaveText("E");
});

test("C opens a new note", async ({ page }) => {
  await openArchitecture(page);
  await pressUntil(page, "c", () => expect(page).toHaveURL(/\/knowledge\/new$/, { timeout: 1_000 }));
});

test("a letter typed into a field stays in the field", async ({ page }) => {
  await openArchitecture(page);
  const before = page.url();
  await page.getByRole("button", { name: "Filter documents and sources" }).click();
  const filter = page.locator("#tree-filter");
  await filter.focus();
  await page.keyboard.press("c");
  await expect(filter).toHaveValue("c");
  expect(page.url()).toBe(before);
});

test("E edits the document being read", async ({ page }) => {
  await openArchitecture(page);
  await pressUntil(page, "e", () => expect(page).toHaveURL(/\/edit$/, { timeout: 1_000 }));
});

test("E does nothing on source-managed content", async ({ page }) => {
  const url = `/w/${QUERY_MASTER_WORKSPACE}/knowledge/${SOURCE_MANAGED_SOURCE}/${SOURCE_MANAGED_DOCUMENT}`;
  await page.goto(url);
  // Prove the shortcuts are live on this page before asserting that E is not.
  const field = page.getByRole("combobox", { name: "Search documents and actions" });
  await pressUntil(page, "/", () => expect(field).toBeVisible({ timeout: 1_000 }));
  await page.keyboard.press("Escape");
  await expect(field).toHaveCount(0);

  await page.keyboard.press("e");
  await page.waitForTimeout(500);
  expect(new URL(page.url()).pathname).toBe(url);
});

/** A note of our own, so saving it cannot disturb another test's fixture. */
async function editOwnNote(page: Page, title: string) {
  await page.goto(`/w/${EMPTY_WORKSPACE}/knowledge/new`);
  const field = page.locator("main form").first().getByLabel("Title", { exact: true });
  await expect(field).toBeEditable(ROUND_TRIP);
  await field.fill(title);
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible(ROUND_TRIP);
  await pressUntil(page, "e", () => expect(page).toHaveURL(/\/edit$/, { timeout: 1_000 }));
  // main form + first(): the duplicate-DOM quirk phase5-authoring documents.
  const titleField = page.locator("main form").first().getByLabel("Title", { exact: true });
  await expect(titleField).toBeEditable(ROUND_TRIP);
  return titleField;
}

test("⌘Enter saves from inside the editor", async ({ page }) => {
  const titleField = await editOwnNote(page, "Shortcut Save Note");
  await titleField.fill("Saved By Keyboard");
  await titleField.press("ControlOrMeta+Enter");
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
  await expect(page.getByRole("heading", { name: "Saved By Keyboard" })).toBeVisible(ROUND_TRIP);
});

test("Esc leaves an unchanged editor", async ({ page }) => {
  const titleField = await editOwnNote(page, "Shortcut Esc Clean Note");
  await titleField.press("Escape");
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
  await expect(page.getByRole("heading", { name: "Shortcut Esc Clean Note" })).toBeVisible(ROUND_TRIP);
});

test("Esc never discards a changed draft", async ({ page }) => {
  const titleField = await editOwnNote(page, "Shortcut Esc Dirty Note");
  await titleField.fill("Unsaved change");
  await titleField.press("Escape");
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/edit$/);
  await expect(titleField).toHaveValue("Unsaved change");
});

/** The primary navigation, its button and its width: collapsed is the narrow rail, expanded the one with the labels. */
function navigation(page: Page) {
  const rail = page.getByRole("navigation", { name: "Primary" }).locator("xpath=ancestor::aside");
  return {
    rail,
    collapse: page.getByRole("button", { name: "Collapse navigation" }),
    expand: page.getByRole("button", { name: "Expand navigation" }),
    width: async () => (await rail.boundingBox())?.width ?? 0,
  };
}

test.describe("⌘\\ collapses and expands the navigation", () => {
  test("from anywhere on the page, and the choice is remembered", async ({ page }) => {
    await openArchitecture(page);
    const nav = navigation(page);
    await expect(nav.collapse).toHaveAttribute("aria-keyshortcuts", "Meta+\\ Control+\\");
    expect(await nav.width()).toBeGreaterThan(150);

    await pressUntil(page, "ControlOrMeta+Backslash", () => expect(nav.expand).toBeVisible({ timeout: 1_000 }));
    await expect.poll(nav.width).toBeLessThan(60);
    await page.keyboard.press("ControlOrMeta+Backslash");
    await expect(nav.collapse).toBeVisible();
    await expect.poll(nav.width).toBeGreaterThan(150);

    // Collapsed, and reloaded: still collapsed.
    await page.keyboard.press("ControlOrMeta+Backslash");
    await expect(nav.expand).toBeVisible();
    await page.reload();
    await expect(nav.expand).toBeVisible(ROUND_TRIP);
    await expect.poll(nav.width).toBeLessThan(60);
  });

  test("also while writing, from the title and from the editor, without typing anything", async ({ page }) => {
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/new`);
    const form = page.locator("main form").first();
    const title = form.getByLabel("Title", { exact: true });
    await expect(title).toBeEditable(ROUND_TRIP);
    const nav = navigation(page);

    await title.click();
    await pressUntil(page, "ControlOrMeta+Backslash", () => expect(nav.expand).toBeVisible({ timeout: 1_000 }));
    await expect(title).toHaveValue("");

    const surface = form.getByRole("textbox", { name: "Content" });
    await expect(surface).toBeEditable(ROUND_TRIP);
    await surface.click();
    await page.keyboard.type("text");
    await page.keyboard.press("ControlOrMeta+Backslash");
    await expect(nav.collapse).toBeVisible();
    await expect(surface).toHaveText("text");
  });

  test("the palette lists it with its shortcut, finds it by what people call it, and runs it", async ({ page }) => {
    await openArchitecture(page);
    const nav = navigation(page);
    const field = page.getByRole("combobox", { name: "Search documents and actions" });
    await pressUntil(page, "/", () => expect(field).toBeVisible({ timeout: 1_000 }));
    await field.fill("sidebar");
    const option = page.getByRole("listbox", { name: "Actions and documents" }).getByRole("option", { name: /Toggle navigation/ });
    await expect(option.locator("kbd")).toHaveText("⌘\\");
    await option.click();
    await expect(field).toBeHidden();
    await expect(nav.expand).toBeVisible(ROUND_TRIP);
  });

  test("a dialog that is open keeps the key: the palette does not toggle the page behind it", async ({ page }) => {
    await openArchitecture(page);
    const nav = navigation(page);
    const field = page.getByRole("combobox", { name: "Search documents and actions" });
    await pressUntil(page, "/", () => expect(field).toBeVisible({ timeout: 1_000 }));
    await page.keyboard.press("ControlOrMeta+Backslash");
    await expect(field).toBeVisible();
    // With the palette open the page behind it is out of the accessibility tree, so look at it once the
    // palette is closed: had the key reached the shell, the navigation would be collapsed by now.
    await page.keyboard.press("Escape");
    await expect(field).toBeHidden();
    await expect(nav.collapse).toBeVisible();
    expect(await nav.width()).toBeGreaterThan(150);
  });

  test("in a window too narrow for the rail, it opens the menu that takes its place", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 });
    // The tree is behind the Browse button at this width, so go to the source and let it land on a document.
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/${OBSIDIAN_SOURCE}`);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible(ROUND_TRIP);
    await pressUntil(page, "ControlOrMeta+Backslash", () => expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible({ timeout: 1_000 }));
  });
});
