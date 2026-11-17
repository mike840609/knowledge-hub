import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/** The 2026-11-20 small-keys pass (docs/superpowers/specs/2026-11-20-small-keys-design.md), with the real keyboard. */

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

test.describe("small keys", () => {
  test("/diagram and /date write a mermaid block and today's date, and both survive a save", async ({ page }) => {
    const workspaceId = await mySpace(page);
    const url = await createNote(page, workspaceId, unique("Slash"), "Start here.\n");
    const surface = await openEditor(page, url);
    await surface.getByText("Start here.", { exact: true }).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" met on /date");
    await expect(page.getByRole("option", { name: /Today's date/ })).toBeVisible(ROUND_TRIP);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/diagram");
    await expect(page.getByRole("option", { name: /Diagram/ })).toBeVisible(ROUND_TRIP);
    await page.keyboard.press("Enter");
    const markdown = await saved(page);
    expect(markdown).toContain("```mermaid\nflowchart TD");
    expect(markdown).toMatch(/met on \d{4}-\d{2}-\d{2}/);
  });

  test("Mod-Enter in a toggle's title opens it, and the open state is saved", async ({ page }) => {
    const workspaceId = await mySpace(page);
    const url = await createNote(page, workspaceId, unique("Toggle"), "<details>\n<summary>Folded</summary>\n\nInside.\n\n</details>\n");
    const surface = await openEditor(page, url);
    await surface.getByText("Folded", { exact: true }).click();
    await page.waitForTimeout(300);
    await page.keyboard.press("ControlOrMeta+Enter");
    // The autosave may not have started yet, so read the export until it holds the change.
    const documentId = new URL(page.url()).pathname.split("/").at(-1);
    await expect.poll(async () => (await page.request.get(`/api/documents/${documentId}/export`)).text(), ROUND_TRIP).toContain("<details open>");
  });
});
