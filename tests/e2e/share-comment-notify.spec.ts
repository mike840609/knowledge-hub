import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument, openReviewDiscussions } from "./fixtures/document-review";

test("a share-page comment notifies the owner; opening the panel keeps it, looking at the discussion clears it", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const owner = phase3Origin("reviewOwner"), viewer = phase3Origin("viewer");
  const token = doc.links[0].path.split("/").pop();
  const query = await (await request.post(`${viewer}/api/share-review/threads/query`, { headers: { Origin: viewer }, data: { token } })).json();
  const created = await request.post(`${viewer}/api/share-review/threads`, { headers: { Origin: viewer }, data: { token, expectedRevisionId: query.revisionId, anchor: { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 2, endUtf16: 9, exact: "😀 bold", prefix: "A ", suffix: " passage to review." }, body: "Holder observation", idempotencyKey: crypto.randomUUID() } });
  expect(created.status()).toBe(201);
  // The owner's unread list is every document's; other tests leave theirs in it, so this one reads its own.
  const unread = async (): Promise<Array<Record<string, string>>> => (await (await request.get(`${owner}/api/review-notifications/unread`, { headers: { Origin: owner } })).json())
    .notifications.filter((notice: { documentId: string }) => notice.documentId === doc.documentId);
  const notices = await unread();
  expect(notices).toHaveLength(1);
  expect(notices[0]).toMatchObject({ documentId: doc.documentId, excerpt: "Holder observation" });
  expect(typeof notices[0].documentTitle).toBe("string");
  expect(notices[0].documentTitle.length).toBeGreaterThan(0);
  expect(notices[0].authorName).toBe("Phase3 viewer");
  await page.goto(doc.href);
  await expect(page.getByText("1 new", { exact: true })).toBeVisible();
  await openReviewDiscussions(page);
  // Opening the panel marks nothing: the owner has not looked at the discussion yet (spec 2026-10-22).
  const card = page.getByRole("region", { name: "Discussion thread" }).filter({ hasText: "Holder observation" });
  await expect(card.getByText("Unread", { exact: true })).toBeVisible();
  expect(await unread()).toHaveLength(1);
  await card.click();
  await expect.poll(unread).toEqual([]);
  await expect(card.getByText("Unread", { exact: true })).toHaveCount(0);
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
