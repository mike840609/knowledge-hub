import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/**
 * The 2026-11-18 inline-writing pass: `:shortcode` emoji completion, Clear formatting, and Copy on
 * the link card. The first two write through the rendered editor, so both read the saved Markdown
 * back; Copy reads the clipboard the browser was granted.
 */

function unique(label: string) {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function createNote(page: Page, workspaceId: string, title: string, markdown: string) {
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  return `/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`;
}

async function openEditor(page: Page, documentUrl: string) {
  await page.goto(documentUrl);
  const surface = page.locator("main").getByRole("textbox", { name: "Content" });
  await expect(surface).toBeEditable(ROUND_TRIP);
  await page.waitForTimeout(600);
  return surface;
}

async function saved(page: Page) {
  await expect(page.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "saved", ROUND_TRIP);
  const documentId = new URL(page.url()).pathname.split("/").at(-1);
  const exported = await page.request.get(`/api/documents/${documentId}/export`);
  expect(exported.ok()).toBe(true);
  return exported.text();
}

test.describe("inline writing polish", () => {
  test("chooses an emoji from :shortcode and saves the glyph", async ({ page }) => {
    const workspaceId = await mySpace(page);
    const url = await createNote(page, workspaceId, unique("Emoji"), "Start here.\n");
    const surface = await openEditor(page, url);
    await surface.getByText("Start here.", { exact: true }).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" :grin");
    const list = page.getByRole("listbox", { name: "Emoji" });
    await expect(list).toBeVisible(ROUND_TRIP);
    await list.getByRole("option").first().click();
    const markdown = await saved(page);
    expect(markdown).toMatch(/Start here\. \p{Extended_Pictographic}/u);
    expect(markdown).not.toContain(":grin");
  });

  test("Clear formatting removes the marks and keeps the words", async ({ page }) => {
    const workspaceId = await mySpace(page);
    const url = await createNote(page, workspaceId, unique("Clear"), "**bold** and plain\n");
    await openEditor(page, url);
    await page.getByText("bold", { exact: true }).dblclick();
    await page.getByRole("button", { name: "Clear formatting" }).click();
    const markdown = await saved(page);
    expect(markdown).toContain("bold and plain");
    expect(markdown).not.toContain("**bold**");
  });

  test("Copy on the link card writes the address to the clipboard", async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const workspaceId = await mySpace(page);
    const url = await createNote(page, workspaceId, unique("Copy link"), "[site](https://example.com) after\n");
    const surface = await openEditor(page, url);
    await surface.getByText("site", { exact: true }).click();
    const card = page.locator(".kh-link-card");
    await expect(card).toHaveAttribute("data-show", "true", ROUND_TRIP);
    await card.getByRole("button", { name: "Copy link" }).click();
    await expect(card.getByRole("button", { name: "Copy link" })).toHaveText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("https://example.com");
  });
});
