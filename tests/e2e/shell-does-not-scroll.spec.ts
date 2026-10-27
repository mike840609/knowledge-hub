import { expect, test } from "./fixtures/test";
import { createReviewDocument } from "./fixtures/document-review";

// The app shell is one window tall and only its panes scroll. A box positioned against the page rather than
// the pane it sits in escapes that pane's clipping and makes the page itself taller than the window; then a
// scrollIntoView a pane cannot satisfy — the outline's last, short section — scrolls the whole shell away.
test("the page itself never scrolls: nothing in the explorer escapes its scroller", async ({ page, request }) => {
  const doc = await createReviewDocument(request, `## Alpha\n\n${"A paragraph of text.\n\n".repeat(60)}## Omega\n\nShort.\n`);
  // Short, so the explorer's tree runs past the bottom of the window.
  await page.setViewportSize({ width: 1440, height: 480 });
  await page.goto(doc.href);
  const tree = page.getByRole("navigation", { name: "Document tree" });
  await expect(tree.getByRole("tree").first()).toBeVisible();

  // Every box the tree places absolutely — its live regions included — is placed against something inside it.
  const escaping = await tree.evaluate((nav) => [...nav.querySelectorAll<HTMLElement>("*")]
    .filter((element) => element instanceof HTMLElement && element.getClientRects().length > 0)
    .filter((element) => getComputedStyle(element).position === "absolute")
    .filter((element) => !element.offsetParent || !nav.contains(element.offsetParent))
    .map((element) => element.outerHTML.slice(0, 120)));
  expect(escaping).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(480);

  // The last entry's section is too short to reach the top of the pane: the pane scrolls to its end, the page does not.
  await page.getByRole("complementary", { name: "On this page" }).getByRole("link", { name: "Omega" }).click();
  const pane = page.getByRole("region", { name: "Document content" });
  await expect.poll(() => pane.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => document.documentElement.scrollTop)).toBe(0);
});
