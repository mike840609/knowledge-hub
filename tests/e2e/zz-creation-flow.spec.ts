import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/** The 2026-11-19 creation-flow pass: making a document should feel like making a Notion page. */

function unique(label: string) {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function knowledge(page: Page) {
  const workspaceId = await mySpace(page);
  // A document makes the Notes source exist, so its row (and `+`) is in the tree.
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title: unique("Seed"), markdown: "Seed.\n" } });
  expect(response.ok()).toBe(true);
  // The workspace landing page redirects late, possibly into another Source's tree (fixtures/organize.ts):
  // open the seed itself, so the Notes tree is the one shown.
  const seed = (await response.json()) as { sourceId: string; documentId: string };
  await page.goto(`/w/${workspaceId}/knowledge/${seed.sourceId}/${seed.documentId}`);
  const create = page.getByRole("complementary", { name: "Knowledge explorer" }).getByRole("link", { name: "Create document" });
  await expect(create).toBeVisible(ROUND_TRIP);
  return { workspaceId, create };
}

/** Opacity as drawn, every ancestor included: Playwright counts `opacity: 0` as visible. */
const drawnOpacity = (page: Page, selector: Parameters<Page["locator"]>[0]) =>
  page.locator(selector).first().evaluate((element) => {
    let opacity = 1;
    for (let node: Element | null = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
    return opacity;
  });

test.describe("creation flow", () => {
  test("shows the Notes row's + at rest, without a hover", async ({ page }) => {
    await knowledge(page);
    await page.mouse.move(1000, 700);
    expect(await drawnOpacity(page, '[aria-label="Knowledge explorer"] a[aria-label="Create document"]')).toBe(1);
  });

  test("keeps what is typed straight after pressing + as the title", async ({ page }) => {
    const { create } = await knowledge(page);
    const title = unique("Typed right away");
    await create.click();
    await page.keyboard.type(title);
    const field = page.locator("main").getByRole("textbox", { name: "Title" });
    await expect(page.locator("main").getByRole("textbox", { name: "Content" })).toBeEditable(ROUND_TRIP);
    await expect(field).toHaveValue(title, ROUND_TRIP);
    await page.keyboard.type("!");
    await expect(field).toHaveValue(`${title}!`);
  });

  test("Enter straight after the title, before the note opens, puts the caret in the body", async ({ page }) => {
    const { create } = await knowledge(page);
    const title = unique("Entered");
    await create.click();
    await page.keyboard.type(`${title} `);
    await page.keyboard.press("Enter");
    const content = page.locator("main").getByRole("textbox", { name: "Content" });
    await expect(content).toBeFocused(ROUND_TRIP);
    await page.keyboard.type("Body.");
    await expect(content).toHaveText("Body.");
    await expect(page.locator("main").getByRole("textbox", { name: "Title" })).toHaveValue(`${title} `);
    await expect(page.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "saved", ROUND_TRIP);
    await expect(page.getByRole("treeitem", { name: title })).toBeVisible({ timeout: 10_000 });
  });

  test("keeps a space typed last before the note opens, so the next word stays apart", async ({ page }) => {
    const { create } = await knowledge(page);
    await create.click();
    await page.keyboard.type("Weekly ");
    const field = page.locator("main").getByRole("textbox", { name: "Title" });
    await expect(page.locator("main").getByRole("textbox", { name: "Content" })).toBeEditable(ROUND_TRIP);
    await expect(field).toBeFocused();
    await page.keyboard.type("plan");
    await expect(field).toHaveValue("Weekly plan");
  });

  test("from the palette opened in a document, keys typed after Create document are the new title", async ({ page }) => {
    await knowledge(page);
    await page.locator("main").getByRole("textbox", { name: "Content" }).click();
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog", { name: "Search and actions" });
    await expect(palette).toBeVisible();
    await page.keyboard.type("Create document");
    await expect(palette.getByRole("option", { name: /Create document/ }).first()).toBeVisible();
    await page.keyboard.press("Enter");
    const title = unique("From palette");
    await page.keyboard.type(title);
    await expect(page.locator("main").getByRole("textbox", { name: "Title" })).toHaveValue(title, ROUND_TRIP);
  });

  test("names the new document in the tree as soon as its title is saved", async ({ page }) => {
    const { create } = await knowledge(page);
    await create.click();
    await expect(page.locator("main").getByRole("textbox", { name: "Content" })).toBeEditable(ROUND_TRIP);
    const title = unique("Named");
    await expect(page.locator("main").getByRole("textbox", { name: "Title" })).toBeFocused();
    await page.keyboard.type(title);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Body.");
    await expect(page.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "saved", ROUND_TRIP);
    // Well inside the 30-second refresh that used to be the only one.
    await expect(page.getByRole("treeitem", { name: title })).toBeVisible({ timeout: 10_000 });
  });

  test("makes a document inside a folder from the folder's own +", async ({ page }) => {
    const { workspaceId } = await knowledge(page);
    const name = unique("Folder");
    const response = await page.request.post(`/api/workspaces/${workspaceId}/folders`, { data: { name, parentId: null } });
    expect(response.status()).toBe(201);
    await page.reload();
    const folder = page.getByRole("treeitem", { name });
    await expect(folder).toBeVisible(ROUND_TRIP);
    await folder.hover();
    await folder.getByRole("button", { name: `New document in ${name}` }).click();
    await expect(page.locator("main").getByRole("textbox", { name: "Content" })).toBeEditable(ROUND_TRIP);
    await expect(page.locator("main nav").first()).toContainText(name);
  });

  test("says how to start in an empty document", async ({ page }) => {
    const { create } = await knowledge(page);
    await create.click();
    const content = page.locator("main").getByRole("textbox", { name: "Content" });
    // The seed's editor stays editable until the new note's page replaces it.
    await expect(content).toHaveText("", ROUND_TRIP);
    await expect(content).toBeEditable(ROUND_TRIP);
    const hint = await page.locator('main [aria-label="Content"] > p').first().evaluate((element) => getComputedStyle(element, "::before").content);
    expect(hint).toBe('"Write, or press / for commands"');
  });
});
