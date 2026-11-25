import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { showMarkdown } from "./composer-helpers";
import { ROUND_TRIP, unique, composer, createNote, leaveEditor, openEditor, surfaceOf } from "./fixtures/document-composer";

/**
 * Review fixes to the document-page polish (editor page polish spec, "Review fixes"): the meta line is drawn once,
 * wherever the page's own `# Title` is not what the header counts on, and "On this page" inside the article is the
 * list the rail draws, not the article's prose. It writes into the shared workspace like document-composer-drafts.
 */

const BODY = "# Alpha\n\nBody text.\n\n## First part\n\nText.\n\n## Second part\n\nText.\n";
const meta = (page: Page) => page.locator("main [data-document-meta]");

test("clearing the opening title leaves one meta line, not two", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const url = await createNote(page, unique("Meta empty"), BODY);
  const surface = await openEditor(page, url);
  await expect(meta(page)).toHaveCount(1);
  await surface.locator("h1").click({ clickCount: 3 });
  // Delete, not Backspace: Backspace in an emptied heading turns it into a paragraph, which is another case.
  await page.keyboard.press("Delete");
  await expect(surface.locator("h1").first()).toHaveText("");
  await expect(meta(page)).toHaveCount(1);
  await page.keyboard.type("Beta");
  await expect(meta(page)).toHaveCount(1);
});

test("recovered changes show one meta line", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const url = await createNote(page, unique("Meta recovery"), BODY);
  const SAVES = "**/api/documents/*";
  const failPatch = (route: Route) => route.request().method() === "PATCH" ? route.abort() : route.continue();
  await page.route(SAVES, failPatch);
  await openEditor(page, url);
  await (await showMarkdown(composer(page))).fill("# Mine\n\ndraft text\n");
  await leaveEditor(page, url);
  const other = await page.context().newPage();
  await openEditor(other, url);
  await (await showMarkdown(composer(other))).fill("# Theirs\n\nbody\n");
  await expect(other.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "saved", ROUND_TRIP);
  await other.close();
  await page.unroute(SAVES, failPatch);
  await page.goto(url);
  await expect(composer(page).getByRole("status").filter({ hasText: "changed while you were away" })).toBeVisible(ROUND_TRIP);
  await expect(meta(page)).toHaveCount(1);
  // A recovery shows the article, so the line sits under its `# Title`, not in the header above the notices.
  const line = page.locator("main [data-review-document] [data-document-meta]");
  await expect(line).toHaveCount(1);
  expect(await line.evaluate(node => !!(node.closest("[data-review-document]")!.querySelector("h1")!.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
});

test("the disclosure in the article is the rail's list, in the reader and in the editor", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  const url = await createNote(page, unique("Meta outline"), BODY);
  const check = async (scope: ReturnType<Page["locator"]>) => {
    const details = scope.locator("details").filter({ hasText: "On this page" }).first();
    await details.locator("summary").click();
    const list = details.locator("ol");
    await expect(list).toBeVisible();
    await expect(list).toHaveCSS("list-style-type", "none");
    await expect(list).toHaveCSS("padding-left", "0px");
    await expect(list.locator("li").first()).toHaveCSS("margin-top", "0px");
    // The first entry is the active one; the second shows the rail's resting look.
    const link = list.locator("a").nth(1);
    await expect(link).toHaveCSS("text-decoration-line", "none");
    await expect(link).toHaveCSS("font-weight", "400");
    // Muted, as the rail's: not the article's link colour.
    const [linkColour, mutedColour] = await Promise.all([
      link.evaluate((node) => getComputedStyle(node).color),
      page.evaluate(() => { const probe = document.createElement("span"); probe.className = "text-kh-text-muted"; document.body.appendChild(probe); const colour = getComputedStyle(probe).color; probe.remove(); return colour; }),
    ]);
    expect(linkColour).toBe(mutedColour);
  };
  await page.goto(`${url}?revision=1`);
  await check(page.locator("main article"));
  await page.goto(url);
  await expect(surfaceOf(page)).toBeEditable(ROUND_TRIP);
  await check(surfaceOf(page));
});
