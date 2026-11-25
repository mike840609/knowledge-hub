import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/**
 * The table's edge controls (docs/superpowers/specs/2026-11-21-table-controls-design.md), in the rendered editor.
 * It writes documents into the E2E user's My Space, so it sorts last like zz-multi-block.spec.ts.
 */

function unique(label: string) {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function openNote(page: Page, markdown: string) {
  const workspaceId = await mySpace(page);
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title: unique("Table"), markdown } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  await page.goto(`/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`);
  const surface = page.locator("main").getByRole("textbox", { name: "Content" });
  await expect(surface).toBeEditable(ROUND_TRIP);
  await page.waitForTimeout(600);
  return { surface, documentId: created.documentId };
}

const SMALL = "| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\nAfter the table.\n";

test.describe("table edge controls", () => {
  test("the paragraph above a table stays clickable", async ({ page }) => {
    const sentence = "Every character of this sentence has to stay reachable by the pointer while the table below it shows its controls, ".repeat(3).slice(0, 300).trimEnd();
    expect(sentence.length).toBeGreaterThanOrEqual(295);
    await page.setViewportSize({ width: 1440, height: 900 });
    const { surface } = await openNote(page, `${sentence}\n\n| A | B |\n| - | - |\n| one | two |\n\nAfter the table.\n`);
    await expect(surface.locator("table")).toBeVisible();
    const precedingText = await surface.locator("table").evaluate(table => (table.closest(".kh-markdown-table") ?? table).previousElementSibling?.textContent ?? null);
    expect(precedingText).toBe(sentence);
    await surface.locator("tbody td").first().click();
    await expect(page.getByRole("button", { name: /^Row \d+ actions$/ })).toBeVisible();
    const misses = await page.evaluate(() => {
      const paragraph = document.querySelector<HTMLElement>("main [role=textbox] p");
      if (!paragraph) return { bad: ["no paragraph"], checked: 0 };
      const bad: string[] = [];
      let checked = 0;
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as Text;
        for (let i = 0; i < text.length; i++) {
          const range = document.createRange();
          range.setStart(text, i); range.setEnd(text, i + 1);
          const rect = range.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          checked++;
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          if (!hit || !paragraph.contains(hit)) bad.push(`${i}:${text.data[i]}:${hit?.className ?? "none"}`);
        }
      }
      return { bad, checked };
    });
    expect(misses.checked).toBeGreaterThanOrEqual(290);
    expect(misses.bad).toEqual([]);
  });

  test("a row added and a column aligned from the menus are saved", async ({ page }) => {
    const { surface, documentId } = await openNote(page, SMALL);
    await surface.locator("tbody td").first().click();
    await page.getByRole("button", { name: "Row 2 actions" }).click();
    await page.getByRole("menuitem", { name: "Insert row below" }).click();
    await expect(surface.locator("table tr")).toHaveCount(4);
    await surface.locator("tbody td").first().click();
    await page.getByRole("button", { name: "Column 1 actions" }).click();
    await page.getByRole("menuitemradio", { name: "Center" }).click();
    await expect(page.locator("[data-autosave-status]")).not.toHaveAttribute("data-autosave-status", "saved");
    await expect(page.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "saved", ROUND_TRIP);
    await page.reload();
    await expect(surface).toBeEditable(ROUND_TRIP);
    await expect(surface.locator("table tr")).toHaveCount(4); // header and 3 body rows
    const markdown = await (await page.request.get(`/api/documents/${documentId}/export`)).text();
    const rows = markdown.split("\n").filter(line => line.trim().startsWith("|"));
    expect(rows).toHaveLength(5); // header, delimiter, 3 body rows
    expect(rows[1]).toContain(":-:");
  });

  test("Alt+F10 from a cell focuses the row grip", async ({ page }) => {
    const { surface } = await openNote(page, SMALL);
    await surface.locator("tbody td").first().click();
    // Move off the table: the grip can then only come from the caret ProseMirror has read, not the pointer.
    await page.mouse.move(0, 0);
    await expect(page.getByRole("button", { name: "Row 2 actions" })).toBeVisible();
    await page.keyboard.press("Alt+F10");
    await expect(page.getByRole("button", { name: "Row 2 actions" })).toBeFocused();
  });

  test("Alt+F10 reaches the visible part of a tall row", async ({ page }) => {
    const text = "Long text wraps in this table cell. ".repeat(800);
    const { surface } = await openNote(page, `| Details |\n| --- |\n| ${text} |\n`);
    const cell = surface.locator("td").first();
    await cell.click({ position: { x: 20, y: 16 } });
    await page.mouse.move(0, 0);
    const visible = await cell.evaluate(td => {
      const row = td.getBoundingClientRect();
      const table = td.closest(".kh-markdown-table")!.getBoundingClientRect();
      const pane = td.closest(".kh-document-pane")!.getBoundingClientRect();
      return {
        top: Math.max(0, row.top, table.top, pane.top),
        bottom: Math.min(innerHeight, row.bottom, table.bottom, pane.bottom),
        centre: row.top + row.height / 2,
      };
    });
    expect(visible.bottom - visible.top).toBeGreaterThan(24);
    expect(visible.centre).toBeGreaterThan(visible.bottom);
    await page.keyboard.press("Alt+F10");
    const grip = page.getByRole("button", { name: "Row 2 actions" });
    await expect(grip).toBeFocused();
    const box = (await grip.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(visible.top);
    expect(box.y + box.height).toBeLessThanOrEqual(visible.bottom);
  });

  test("a wide table is shown whole, not scrolled, and every column keeps its grip", async ({ page }) => {
    const cell = (prefix: string) => Array.from({ length: 12 }, (_, i) => `${prefix}${i} ${"w".repeat(40)}`);
    const markdown = `| ${cell("H").join(" | ")} |\n| ${cell("-").map(() => "---").join(" | ")} |\n| ${cell("C").join(" | ")} |\n`;
    const { surface } = await openNote(page, markdown);
    const region = surface.locator(".kh-markdown-table");
    const fits = await region.evaluate(node => ({ wide: node.scrollWidth <= node.clientWidth + 1, tall: node.scrollHeight <= node.clientHeight + 1 }));
    expect(fits).toEqual({ wide: true, tall: true });
    // The header's last cell: the grip sits on the table's top border, which stays in view.
    await surface.locator("tr").first().locator(":scope > *").last().click();
    await expect(page.getByRole("button", { name: "Column 12 actions" })).toBeVisible();
  });

  test("the bars and grips stay out of the text around the table", async ({ page }) => {
    const { surface } = await openNote(page, SMALL);
    await surface.locator("tbody td").first().click();
    const addRow = page.getByRole("button", { name: "Add row" });
    const colGrip = page.getByRole("button", { name: "Column 1 actions" });
    await expect(addRow).toBeVisible();
    await expect(colGrip).toBeVisible();
    const bar = (await addRow.boundingBox())!;
    const after = (await surface.getByText("After the table.", { exact: true }).boundingBox())!;
    const table = (await surface.locator("table").boundingBox())!;
    const grip = (await colGrip.boundingBox())!;
    const overlaps = bar.x < after.x + after.width && bar.x + bar.width > after.x && bar.y < after.y + after.height && bar.y + bar.height > after.y;
    expect(overlaps).toBe(false);
    // A low handle straddling the top border: half in the table's own margin, half over the header.
    expect(grip.x).toBeGreaterThanOrEqual(table.x);
    expect(grip.x + grip.width).toBeLessThanOrEqual(table.x + table.width);
    expect(grip.height).toBeLessThanOrEqual(12);
    expect(grip.y).toBeLessThan(table.y);
    expect(grip.y + grip.height).toBeGreaterThan(table.y);
    expect(grip.y).toBeGreaterThanOrEqual(table.y - 6 - 1);
  });

  test("the column grip leaves a centred header's text clickable", async ({ page }) => {
    const heading = "Quarterly revenue figures";
    const { surface } = await openNote(page, `| ${heading} | Other |\n| :-: | --- |\n| one | two |\n`);
    const header = surface.locator("th").first();
    await header.click();
    await expect(page.getByRole("button", { name: "Column 1 actions" })).toBeVisible();
    const result = await header.evaluate(th => {
      const bad: string[] = [];
      let checked = 0;
      const walker = document.createTreeWalker(th, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as Text;
        for (let i = 0; i < text.length; i++) {
          const range = document.createRange();
          range.setStart(text, i); range.setEnd(text, i + 1);
          const rect = range.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          checked++;
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          if (!hit || !th.contains(hit)) bad.push(`${i}:${text.data[i]}:${hit?.className ?? "none"}`);
        }
      }
      return { bad, checked };
    });
    expect(result.checked).toBeGreaterThanOrEqual(heading.replace(/ /g, "").length);
    expect(result.bad).toEqual([]);
  });
});
