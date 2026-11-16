import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/**
 * The 2026-11-17 edit-mode audit: a to-do that can be ticked in place, and block actions that reach
 * the list item under the caret rather than the whole list. Both write through the rendered editor,
 * so both read the persisted Markdown back.
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
  return surface;
}

async function saved(page: Page) {
  await expect(page.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "saved", ROUND_TRIP);
  const documentId = new URL(page.url()).pathname.split("/").at(-1);
  const exported = await page.request.get(`/api/documents/${documentId}/export`);
  expect(exported.ok()).toBe(true);
  return exported.text();
}

test.describe("the 2026-11-17 Notion gaps", () => {
  test("a to-do is ticked from its box and saves as a checked item", async ({ page }) => {
    const workspaceId = await mySpace(page);
    const url = await createNote(page, workspaceId, unique("Ticks"), "- [ ] Buy milk\n- [x] Already done\n");
    const surface = await openEditor(page, url);
    await surface.getByRole("checkbox", { name: "Mark task complete" }).click();
    const markdown = await saved(page);
    expect(markdown).toContain("- [x] Buy milk");
    expect(markdown).toContain("- [x] Already done");
    // The box now offers the other direction, so a second press would undo it.
    await expect(surface.getByRole("checkbox", { name: "Mark task incomplete" }).first()).toBeVisible();
  });

  test("the block menu duplicates the list item under the caret, not the list", async ({ page }) => {
    const workspaceId = await mySpace(page);
    const url = await createNote(page, workspaceId, unique("Nested"), "- First\n- Second\n- Third\n");
    const surface = await openEditor(page, url);
    await surface.getByText("Second", { exact: true }).click();
    await page.keyboard.press("Alt+F10");
    await page.getByRole("button", { name: "Move block" }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    const markdown = await saved(page);
    const items = markdown.split("\n").filter((line) => /^- /.test(line));
    expect(items).toEqual(["- First", "- Second", "- Second", "- Third"]);
  });
});
