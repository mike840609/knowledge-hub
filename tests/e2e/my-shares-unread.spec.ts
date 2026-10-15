import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument, openReviewDiscussions } from "./fixtures/document-review";

test("My shares shows one document-level unread badge across multiple share links", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const owner = phase3Origin("reviewOwner");
  const viewer = phase3Origin("viewer");
  const token = doc.links[0].path.split("/").pop();
  const query = await (await request.post(`${viewer}/api/share-review/threads/query`, {
    headers: { Origin: viewer }, data: { token },
  })).json();
  const created = await request.post(`${viewer}/api/share-review/threads`, {
    headers: { Origin: viewer },
    data: {
      token, expectedRevisionId: query.revisionId,
      anchor: { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 2, endUtf16: 9, exact: "😀 bold", prefix: "A ", suffix: " passage to review." },
      body: "A reviewer question", idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(created.status()).toBe(201);
  const thread = await created.json();
  const reply = await request.post(`${viewer}/api/share-review/comments`, {
    headers: { Origin: viewer },
    data: { token, threadId: thread.id, body: "A follow-up question", idempotencyKey: crypto.randomUUID() },
  });
  expect(reply.status()).toBe(201);

  await page.goto(`${owner}/w/${doc.workspaceId}/shares`);
  const list = page.getByRole("list", { name: "Share links" });
  const rows = list.getByRole("listitem").filter({ hasText: /Review / });
  await expect(rows).toHaveCount(2); // Two links, one document.
  const badge = rows.getByRole("link", { name: /2 unread comments/ });
  await expect(badge).toHaveCount(1);
  await expect(badge).toContainText("2 new");

  // Merely visiting Shares does not mark anything as read.
  const unread = await (await request.get(`${owner}/api/review-notifications/unread`)).json();
  expect(unread.notifications.filter((item: { documentId: string }) => item.documentId === doc.documentId)).toHaveLength(2);

  await badge.click();
  await expect(page).toHaveURL(new RegExp(`/knowledge/${doc.sourceId}/${doc.documentId}\\?thread=${thread.id}`));
  await openReviewDiscussions(page);
  await page.goto(`${owner}/w/${doc.workspaceId}/shares`);
  await expect(list.getByRole("link", { name: /unread comments/ })).toHaveCount(0);
});

test("My shares does not show a badge when there are no unread comments", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  await page.goto(`${phase3Origin("reviewOwner")}/w/${doc.workspaceId}/shares`);
  const rows = page.getByRole("list", { name: "Share links" }).getByRole("listitem").filter({ hasText: /Review / });
  await expect(rows).toHaveCount(2);
  await expect(rows.getByRole("link", { name: /unread comments/ })).toHaveCount(0);
});
