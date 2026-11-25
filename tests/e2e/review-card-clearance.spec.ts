import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument, openReviewDiscussions } from "./fixtures/document-review";

// A card jumped to is shown whole below the rail's pinned toolbar (inline review spec, 2026-11-24 amendment).
const SENTENCE = " has words enough for a line of its own in the shared document.";
const MARKDOWN = Array.from({ length: 30 }, (_, index) => `Paragraph ${index}${SENTENCE}`).join("\n\n");

async function postThread(request: APIRequestContext, doc: Awaited<ReturnType<typeof createReviewDocument>>, block: number) {
  const token = doc.links[0].path.split("/").pop();
  const viewer = phase3Origin("viewer");
  const exact = `Paragraph ${block}`;
  const response = await request.post(`${viewer}/api/share-review/threads`, { headers: { Origin: viewer }, data: { token, expectedRevisionId: doc.revisionId, anchor: { schemaVersion: 1, blockPath: [block], blockKind: "paragraph", startUtf16: 0, endUtf16: exact.length, exact, prefix: "", suffix: SENTENCE }, body: `A remark on paragraph ${block}, long enough to take two lines in the card of the rail.`, idempotencyKey: crypto.randomUUID() } });
  expect(response.status()).toBe(201);
  return (await response.json()).id as string;
}

/** The card's top, once nothing moves, is at or below the toolbar's bottom. */
async function expectClear(page: Page, card: Locator) {
  const toolbar = page.locator(".kh-review-panel .kh-review-toolbar").filter({ visible: true });
  let last = Number.NaN;
  await expect.poll(async () => { const y = (await card.boundingBox())!.y; const still = Math.abs(y - last) < 0.5; last = y; return still; }).toBe(true);
  const bar = (await toolbar.boundingBox())!;
  expect(last).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
}

test("Next open shows the card it lands on below the rail's toolbar", async ({ page, request }) => {
  const doc = await createReviewDocument(request, MARKDOWN);
  await postThread(request, doc, 2);
  const last = await postThread(request, doc, 9);
  await page.setViewportSize({ width: 1280, height: 520 });
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await openReviewDiscussions(page);
  const next = page.getByRole("button", { name: "Next open" });
  await next.click();
  await next.click();
  const card = page.locator(`[data-review-rail] [data-review-thread="${last}"]`);
  await expect(card).toHaveAttribute("data-active", "");
  await expectClear(page, card);
});

// The marker's path already ended below the toolbar before revealReviewCard (verified on main); it is
// held here so the shared reveal cannot regress it.
test("a passage's marker near the top of the window shows its card below the rail's toolbar", async ({ page, request }) => {
  const doc = await createReviewDocument(request, MARKDOWN);
  const thread = await postThread(request, doc, 9);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await openReviewDiscussions(page);
  // The passage just under the pinned bar, where its card is level with it under the toolbar.
  const passage = page.locator("[data-review-document] p").nth(9);
  await passage.evaluate(element => window.scrollBy({ top: element.getBoundingClientRect().top - 80, behavior: "instant" }));
  await expect.poll(() => passage.evaluate(element => Math.round(element.getBoundingClientRect().top))).toBe(80);
  await page.locator(`[data-review-marker="${thread}"]`).click();
  const card = page.locator(`[data-review-rail] [data-review-thread="${thread}"]`);
  await expect(card).toBeFocused();
  await expectClear(page, card);
});
