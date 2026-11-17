import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/** The 2026-11-19 paste-and-links pass, through the real clipboard and the saved Markdown. */

function unique(label: string) {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function openNew(page: Page, workspaceId: string, markdown: string) {
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title: unique("Paste"), markdown } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  await page.goto(`/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`);
  const surface = page.locator("main").getByRole("textbox", { name: "Content" });
  await expect(surface).toBeEditable(ROUND_TRIP);
  await page.waitForTimeout(600);
  await surface.getByText("Start.", { exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  return created.documentId;
}

async function exported(page: Page, documentId: string) {
  await expect(page.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "saved", ROUND_TRIP);
  const response = await page.request.get(`/api/documents/${documentId}/export`);
  expect(response.ok()).toBe(true);
  return response.text();
}

async function paste(page: Page, text: string) {
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await page.keyboard.press("ControlOrMeta+v");
}

test.describe("paste and links", () => {
  test.beforeEach(async ({ context }) => { await context.grantPermissions(["clipboard-read", "clipboard-write"]); });

  test("pastes Markdown as blocks and an address as a link", async ({ page }) => {
    const id = await openNew(page, await mySpace(page), "Start.\n");
    await paste(page, "## Pasted\n\n- a\n- b\n\n**bold** and [[Seed]]");
    await page.keyboard.press("Enter");
    await paste(page, "https://example.com/page");
    const markdown = await exported(page, id);
    expect(markdown).toContain("## Pasted\n\n- a\n- b\n\n**bold** and [[Seed]]");
    expect(markdown).toContain("<https://example.com/page>");
    expect(markdown).not.toContain("\\");
  });

  test("links an address and a [text](url) as they are typed", async ({ page }) => {
    const id = await openNew(page, await mySpace(page), "Start.\n");
    await page.keyboard.type("see https://example.com/x. and [the guide](https://example.com/g) now");
    const markdown = await exported(page, id);
    expect(markdown).toContain("see <https://example.com/x>. and [the guide](https://example.com/g) now");
  });
});
