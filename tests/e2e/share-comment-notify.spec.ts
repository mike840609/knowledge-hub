import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument, openReviewDiscussions } from "./fixtures/document-review";

test("a share-page comment notifies the owner, and opening the panel clears it", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const owner = phase3Origin("reviewOwner"), viewer = phase3Origin("viewer");
  const token = doc.links[0].path.split("/").pop();
  const query = await (await request.post(`${viewer}/api/share-review/threads/query`, { headers: { Origin: viewer }, data: { token } })).json();
  const created = await request.post(`${viewer}/api/share-review/threads`, { headers: { Origin: viewer }, data: { token, expectedRevisionId: query.revisionId, anchor: { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 2, endUtf16: 9, exact: "😀 bold", prefix: "A ", suffix: " passage to review." }, body: "Holder observation", idempotencyKey: crypto.randomUUID() } });
  expect(created.status()).toBe(201);
  const unread = await (await request.get(`${owner}/api/review-notifications/unread`, { headers: { Origin: owner } })).json();
  expect(unread.notifications).toHaveLength(1);
  expect(unread.notifications[0]).toMatchObject({ documentId: doc.documentId, excerpt: "Holder observation" });
  expect(typeof unread.notifications[0].documentTitle).toBe("string");
  expect(unread.notifications[0].documentTitle.length).toBeGreaterThan(0);
  expect(unread.notifications[0].authorName).toBe("Phase3 viewer");
  await page.goto(doc.href);
  await expect(page.getByText("1 new", { exact: true })).toBeVisible();
  await openReviewDiscussions(page);
  await expect.poll(async () => (await (await request.get(`${owner}/api/review-notifications/unread`, { headers: { Origin: owner } })).json()).notifications).toEqual([]);
  await page.reload();
  await openReviewDiscussions(page);
  await expect(page.getByText("1 new", { exact: true })).toHaveCount(0);
});

test("home lists the unread discussion and jumps to its thread; a bogus thread id is ignored", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const owner = phase3Origin("reviewOwner"), viewer = phase3Origin("viewer");
  const token = doc.links[0].path.split("/").pop();
  const query = await (await request.post(`${viewer}/api/share-review/threads/query`, { headers: { Origin: viewer }, data: { token } })).json();
  const created = await request.post(`${viewer}/api/share-review/threads`, { headers: { Origin: viewer }, data: { token, expectedRevisionId: query.revisionId, anchor: { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 2, endUtf16: 9, exact: "😀 bold", prefix: "A ", suffix: " passage to review." }, body: "Holder observation", idempotencyKey: crypto.randomUUID() } });
  expect(created.status()).toBe(201);
  const thread = await created.json();
  await page.goto(`${owner}/w/${doc.workspaceId}/home`);
  const row = page.getByRole("list", { name: "Unread discussions" }).getByRole("link").first();
  await expect(row).toContainText("Holder observation");
  await row.click();
  await expect(page).toHaveURL(new RegExp(`thread=${thread.id}`));
  await expect(page.getByRole("region", { name: "Discussion thread" }).getByText("Holder observation", { exact: true })).toBeVisible();
  await page.goto(`${doc.href}?thread=bogus`);
  await openReviewDiscussions(page);
  await expect(page.locator("[data-review-document]")).toContainText("bold");
});
