import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument, openReviewDiscussions } from "./fixtures/document-review";

// Spec 2026-10-09, amendment 2026-10-22: Next unread and Next open step through discussions in passage order.
test("the owner steps through unread discussions, then open ones, in passage order", async ({ page, request }) => {
  const doc = await createReviewDocument(request, "First passage.\n\nSecond passage.");
  const viewer = phase3Origin("viewer");
  const token = doc.links[0].path.split("/").pop()!;
  const ids: string[] = [];
  // Written last-passage first: the order to read them in is the document's, not the order they arrived.
  for (const [block, word] of [[1, "Second"], [0, "First"]] as const) {
    const created = await request.post(`${viewer}/api/share-review/threads`, { headers: { Origin: viewer }, data: { token, expectedRevisionId: doc.revisionId, anchor: { schemaVersion: 1, blockPath: [block], blockKind: "paragraph", startUtf16: 0, endUtf16: word.length, exact: word, prefix: "", suffix: " passage." }, body: `About ${word}`, idempotencyKey: crypto.randomUUID() } });
    expect(created.status()).toBe(201);
    ids.unshift((await created.json()).id);
  }
  const [first, second] = ids;

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(doc.href);
  await openReviewDiscussions(page);
  const card = (id: string) => page.locator(`[data-review-thread="${id}"]`);
  const nextUnread = page.getByRole("button", { name: "Next unread", exact: true });
  await nextUnread.click();
  await expect(card(first)).toHaveAttribute("data-active", "");
  await nextUnread.click();
  await expect(card(second)).toHaveAttribute("data-active", "");
  // Looking at each one read it: nothing is left to step to.
  await expect(nextUnread).toBeDisabled();

  await page.getByRole("button", { name: "Next open", exact: true }).click();
  await expect(card(first)).toHaveAttribute("data-active", "");
});
