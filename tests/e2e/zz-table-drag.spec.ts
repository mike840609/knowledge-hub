import { expect, test, type Page, type Locator } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/**
 * Dragging a table's rows and columns by their grips (docs/superpowers/specs/2026-11-25-table-drag-reorder-design.md),
 * with a real pointer in the rendered editor. It writes documents into the E2E user's My Space, so it sorts last
 * like zz-table-controls.spec.ts.
 */

function unique(label: string) {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function openNote(page: Page, markdown: string) {
  const workspaceId = await mySpace(page);
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title: unique("Drag"), markdown } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  await page.goto(`/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`);
  const surface = page.locator("main").getByRole("textbox", { name: "Content" });
  await expect(surface).toBeEditable(ROUND_TRIP);
  await page.waitForTimeout(600);
  return { surface, documentId: created.documentId };
}

const GRID = "| A | B | C |\n| :-- | :-: | --: |\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |\n| a3 | b3 | c3 |\n";

const cellTexts = (surface: Locator) => surface.locator("tr").evaluateAll(rows => rows.map(row => [...row.querySelectorAll("th, td")].map(cell => cell.textContent?.trim() ?? "")));

async function center(locator: Locator) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

async function saved(page: Page) {
  await expect(page.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "saved", ROUND_TRIP);
}
async function exported(page: Page, documentId: string) {
  return (await page.request.get(`/api/documents/${documentId}/export`)).text();
}

test.describe("table drag reorder", () => {
  test("dragging a row's grip moves it, shows a drop line, and is saved", async ({ page }) => {
    const { surface, documentId } = await openNote(page, GRID);
    const first = surface.locator("tr").nth(1).locator("td").first();
    await first.click();
    const grip = page.getByRole("button", { name: "Row 2 actions" });
    const from = await center(grip);
    const target = await center(surface.locator("tr").nth(3).locator("td").first());
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 4, from.y + 12, { steps: 3 });
    await page.mouse.move(target.x, target.box.y + target.box.height - 2, { steps: 8 });
    const line = page.locator(".kh-table-drop-line");
    await expect(line).toBeVisible();
    const lineBox = (await line.boundingBox())!;
    const tableBox = (await surface.locator("table").boundingBox())!;
    expect(lineBox.width).toBeGreaterThan(tableBox.width * 0.9);
    expect(Math.abs(lineBox.y - (tableBox.y + tableBox.height))).toBeLessThan(4);
    await page.mouse.up();
    await expect(line).toBeHidden();
    expect(await cellTexts(surface)).toEqual([["A", "B", "C"], ["a2", "b2", "c2"], ["a3", "b3", "c3"], ["a1", "b1", "c1"]]);
    await expect(page.locator('[role=menu]:not([hidden])')).toHaveCount(0);
    await saved(page);
    const markdown = await exported(page, documentId);
    const body = markdown.split("\n").filter(l => /^\|\s*a\d/.test(l)).map(l => l.split("|")[1].trim());
    expect(body).toEqual(["a2", "a3", "a1"]);
  });

  test("dragging a column keeps its alignment and is saved", async ({ page }) => {
    const { surface, documentId } = await openNote(page, GRID);
    await surface.locator("tr").nth(1).locator("td").nth(2).click();
    const grip = page.getByRole("button", { name: "Column 3 actions" });
    const from = await center(grip);
    const head = surface.locator("th").first();
    const target = await center(head);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x - 6, from.y + 4, { steps: 3 });
    await page.mouse.move(target.box.x + 4, target.y, { steps: 10 });
    const line = page.locator(".kh-table-drop-line");
    await expect(line).toBeVisible();
    const lineBox = (await line.boundingBox())!;
    expect(lineBox.height).toBeGreaterThan(40);
    expect(Math.abs(lineBox.x - target.box.x)).toBeLessThan(4);
    await page.mouse.up();
    expect(await cellTexts(surface)).toEqual([["C", "A", "B"], ["c1", "a1", "b1"], ["c2", "a2", "b2"], ["c3", "a3", "b3"]]);
    await saved(page);
    const rows = (await exported(page, documentId)).split("\n").filter(l => l.trim().startsWith("|"));
    const delimiter = rows[1].split("|").slice(1, -1).map(c => c.trim());
    expect(delimiter[0]).toMatch(/^-+:$/); // right-aligned, as column C was
    expect(delimiter[1]).toMatch(/^:-+$/);
    expect(delimiter[2]).toMatch(/^:-+:$/);
  });

  test("Escape cancels a drag and the header row never moves", async ({ page }) => {
    const { surface } = await openNote(page, GRID);
    await surface.locator("tr").nth(1).locator("td").first().click();
    const grip = page.getByRole("button", { name: "Row 3 actions" });
    // The caret is in row 2; point at row 3 by hovering its cell instead.
    await surface.locator("tr").nth(2).locator("td").first().hover();
    const from = await center(grip);
    const top = await center(surface.locator("th").first());
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 5, from.y + 5, { steps: 3 });
    await page.mouse.move(top.x, top.y, { steps: 8 });
    await expect(page.locator(".kh-table-drop-line")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".kh-table-drop-line")).toBeHidden();
    await page.mouse.up();
    expect(await cellTexts(surface)).toEqual([["A", "B", "C"], ["a1", "b1", "c1"], ["a2", "b2", "c2"], ["a3", "b3", "c3"]]);
    await expect(page.locator('[role=menu]:not([hidden])')).toHaveCount(0);

    // A body row dragged above the header lands just below it; the header stays the header.
    await surface.locator("tr").nth(3).locator("td").first().hover();
    const grip3 = await center(page.getByRole("button", { name: "Row 4 actions" }));
    const header = await center(surface.locator("th").first());
    await page.mouse.move(grip3.x, grip3.y);
    await page.mouse.down();
    await page.mouse.move(grip3.x + 5, grip3.y - 5, { steps: 3 });
    await page.mouse.move(header.x, header.box.y - 8, { steps: 10 });
    await page.mouse.up();
    expect(await cellTexts(surface)).toEqual([["A", "B", "C"], ["a3", "b3", "c3"], ["a1", "b1", "c1"], ["a2", "b2", "c2"]]);
  });

  test("a plain click on a grip still opens its menu", async ({ page }) => {
    const { surface } = await openNote(page, GRID);
    await surface.locator("tr").nth(1).locator("td").first().click();
    await page.getByRole("button", { name: "Row 2 actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Insert row below" })).toBeVisible();
    expect(await cellTexts(surface)).toHaveLength(4);
  });

  test("a wikilink in a moved cell is still a link in the saved document", async ({ page }) => {
    const workspaceId = await mySpace(page);
    const targetTitle = unique("Drag target");
    const made = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title: targetTitle, markdown: "Target body.\n" } });
    expect(made.ok()).toBe(true);
    const createdTarget = (await made.json()) as { sourceId: string; documentId: string };
    const { surface, documentId } = await openNote(page, `| Name | Link |\n| --- | --- |\n| first | [[${targetTitle}]] |\n| second | plain |\n`);
    await surface.locator("tr").nth(1).locator("td").first().click();
    const from = await center(page.getByRole("button", { name: "Column 1 actions" }));
    const last = await center(surface.locator("th").nth(1));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 6, from.y + 3, { steps: 3 });
    await page.mouse.move(last.box.x + last.box.width - 4, last.y, { steps: 10 });
    await page.mouse.up();
    expect((await cellTexts(surface))[0]).toEqual(["Link", "Name"]);
    await saved(page);
    expect(await exported(page, documentId)).toContain(`[[${targetTitle}]]`);
    // The target's page lists who links to it, from the link index the save wrote.
    await page.goto(`/w/${workspaceId}/knowledge/${createdTarget.sourceId}/${createdTarget.documentId}`);
    await expect(page.locator("[data-backlinks]").getByRole("heading", { name: "Linked from 1 document" })).toBeVisible(ROUND_TRIP);
  });
});
