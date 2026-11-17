import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/** The 2026-11-20 links pass (docs/superpowers/specs/2026-11-20-links-and-paste-design.md), with the real keyboard and clipboard. */

function unique(label: string) {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function openNew(page: Page, workspaceId: string, title: string) {
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown: "Start.\n" } });
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

async function exportedWith(page: Page, documentId: string, text: string) {
  await expect.poll(async () => (await page.request.get(`/api/documents/${documentId}/export`)).text(), ROUND_TRIP).toContain(text);
  return (await page.request.get(`/api/documents/${documentId}/export`)).text();
}

test.describe("links and paste", () => {
  test.beforeEach(async ({ context }) => { await context.grantPermissions(["clipboard-read", "clipboard-write"]); });

  test("[[ offers to create a page for a name nothing answers to, and the page then exists", async ({ page }) => {
    const workspaceId = await mySpace(page);
    const id = await openNew(page, workspaceId, unique("Create"));
    const name = unique("Roadmap");
    await page.keyboard.type(`see [[${name}`);
    const row = page.getByRole("option", { name: `Create page "${name}"` });
    await expect(row).toBeVisible(ROUND_TRIP);
    // Enter alone is the editor's; the row is chosen with an arrow key.
    await page.keyboard.press("ArrowDown");
    await expect(row).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    const markdown = await exportedWith(page, id, `[[${name}]]`);
    expect(markdown).toContain(`see [[${name}]]`);
    await expect.poll(async () => {
      const response = await page.request.get(`/api/workspaces/${workspaceId}/link-targets`);
      return ((await response.json()) as { targets: { title: string }[] }).targets.some((target) => target.title === name);
    }, ROUND_TRIP).toBe(true);
  });

  test("an address in a pasted sentence becomes a link", async ({ page }) => {
    const id = await openNew(page, await mySpace(page), unique("Paste"));
    await page.evaluate((value) => navigator.clipboard.writeText(value), "details at https://example.com/page, thanks");
    await page.keyboard.press("ControlOrMeta+v");
    const markdown = await exportedWith(page, id, "<https://example.com/page>");
    expect(markdown).toContain("details at <https://example.com/page>, thanks");
    expect(markdown).not.toContain("\\");
  });

  test("the browser tab and the breadcrumb follow the title as it is typed", async ({ page }) => {
    await openNew(page, await mySpace(page), unique("Tab"));
    const field = page.locator("main").getByRole("textbox", { name: "Title", exact: true });
    const next = unique("Renamed");
    await field.fill(next);
    await expect(page).toHaveTitle(new RegExp(`^${next} · `));
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText(next);
  });
});
