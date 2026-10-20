import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

/**
 * The prose measure and heading scale, read from the browser where the text is laid out
 * (reader-measure spec §4): in the editor, a read-only revision, and a shared page, at two
 * desktop widths. Sorted last for the reason zz-reading-code.spec.ts gives.
 */

const LONG = "知識庫的閱讀體驗取決於行長與層級。A paragraph long enough to wrap several times at any desktop width, mixing English and 中文. ".repeat(6);
const MARKDOWN = [
  "Opening paragraph. " + LONG, "",
  "## Two", "", LONG, "",
  "### Three", "", LONG, "",
  "#### Four", "", LONG, "",
  "##### Five", "", LONG, "",
  "###### Six", "", LONG, "",
  "- a list item " + LONG, "",
  "| A | B | C |", "|---|---|---|", `| ${"wide cell ".repeat(12)} | ${"wide cell ".repeat(12)} | x |`, "",
].join("\n");

type Measured = { maxText: number; table: number; sizes: Record<string, number>; body: number };

/** The widest text block, the table's width, and each heading's and the body's font size, in px. */
function measure(page: Page, root: string) {
  return page.evaluate((selector): Measured => {
    const scope = document.querySelector(selector)!;
    const width = (element: Element) => element.getBoundingClientRect().width;
    const px = (element: Element | null) => (element ? parseFloat(getComputedStyle(element).fontSize) : 0);
    const text = Array.from(scope.querySelectorAll("p, ul, ol, h2, h3, h4, h5, h6"));
    return {
      maxText: Math.max(...text.map(width)),
      table: width(scope.querySelector("table")!),
      sizes: Object.fromEntries(["h2", "h3", "h4", "h5", "h6"].map((tag) => [tag, px(scope.querySelector(tag))])),
      body: px(scope.querySelector("p")),
    };
  }, root);
}

function expectMeasured(measured: Measured) {
  expect(measured.maxText).toBeLessThanOrEqual(640);
  // A table is not prose: it keeps the column, wider than the measure.
  expect(measured.table).toBeGreaterThan(640);
  expect(measured.sizes).toEqual({ h2: 20, h3: 17, h4: 15, h5: 15, h6: 15 });
  for (const size of Object.values(measured.sizes)) expect(size).toBeGreaterThanOrEqual(measured.body);
}

for (const [width, height] of [[1440, 900], [1920, 1080]] as const) {
  test(`at ${width}px, running text keeps the measure and headings step down to body size`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const workspaceId = await mySpace(page);
    const created = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title: `Measure ${width} ${Date.now().toString(36)}`, markdown: MARKDOWN } });
    expect(created.ok()).toBe(true);
    const { sourceId, documentId } = (await created.json()) as { sourceId: string; documentId: string };
    const url = `/w/${workspaceId}/knowledge/${sourceId}/${documentId}`;

    // The rendered editor.
    await page.goto(url);
    const editor = page.getByRole("textbox", { name: "Content", exact: true });
    await expect(editor).toBeEditable({ timeout: 15_000 });
    expectMeasured(await measure(page, '[role="textbox"][aria-label="Content"]'));

    // The reader, on a revision.
    await page.goto(`${url}?revision=1`);
    await expect(page.locator("article table")).toBeVisible({ timeout: 15_000 });
    expectMeasured(await measure(page, "article"));

    // A shared page.
    const shared = await page.request.post(`/api/documents/${documentId}/share-links`, { data: { label: "measure", expiresInDays: 1 } });
    const { link } = (await shared.json()) as { link: { path: string } };
    await page.goto(link.path);
    await expect(page.locator("article table")).toBeVisible({ timeout: 15_000 });
    expectMeasured(await measure(page, "article"));
  });
}
