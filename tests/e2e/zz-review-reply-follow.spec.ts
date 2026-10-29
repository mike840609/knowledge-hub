import { expect, test } from "./fixtures/test";
import { phase3NoSessionOrigin, phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument } from "./fixtures/document-review";

// Spec 2026-10-22: a reader who comments on a shared page follows the discussion; the owner's
// reply reaches the reader's Inbox, which opens the shared page on that discussion.
test("a reader's Inbox brings the owner's reply back to the discussion on the shared page", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const owner = phase3Origin("reviewOwner"), viewer = phase3Origin("viewer");
  const token = doc.links[0].path.split("/").pop()!;
  const query = await (await request.post(`${viewer}/api/share-review/threads/query`, { headers: { Origin: viewer }, data: { token } })).json();
  const created = await request.post(`${viewer}/api/share-review/threads`, { headers: { Origin: viewer }, data: { token, expectedRevisionId: query.revisionId, anchor: { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 2, endUtf16: 9, exact: "😀 bold", prefix: "A ", suffix: " passage to review." }, body: "Reader question", idempotencyKey: crypto.randomUUID() } });
  expect(created.status()).toBe(201);
  const thread = await created.json();
  const replied = await request.post(`${owner}/api/documents/${doc.documentId}/review-threads/${thread.id}/replies`, { headers: { Origin: owner }, data: { body: "Owner answer", idempotencyKey: crypto.randomUUID() } });
  expect(replied.ok()).toBe(true);

  const followed = async () => (await (await request.get(`${viewer}/api/review-notifications/unread`, { headers: { Origin: viewer } })).json())
    .notifications.filter((notice: { kind?: string; threadId: string }) => notice.kind === "FOLLOW" && notice.threadId === thread.id);
  expect(await followed()).toEqual([expect.objectContaining({ excerpt: "Owner answer", authorName: "Phase3 reviewOwner", replyCount: 1, linkAvailable: true })]);

  // The reader's own Inbox: the entry opens the shared page, not a Workspace they are not in.
  await page.goto(`${viewer}/`);
  await expect(page).toHaveURL(/\/w\/[^/]+\//);
  const workspaceId = new URL(page.url()).pathname.split("/")[2];
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${viewer}/w/${workspaceId}/inbox`);
  // Other tests' discussions reach this reader's Inbox too: this one is known by where it leads.
  const entry = page.getByRole("list", { name: "Inbox discussions" }).locator(`a[href="/s/${token}?thread=${thread.id}"]`);
  await expect(entry).toContainText("Owner answer");
  // Beside the list, through the link: the discussion is read in the Inbox, then opened in place.
  await entry.click();
  const selected = page.getByRole("region", { name: "Selected discussion" });
  await expect(selected.getByText("Owner answer", { exact: true })).toBeVisible();
  await selected.getByRole("link", { name: "Open document" }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${token}\\?thread=${thread.id}`));
  const card = page.locator(`[data-review-thread="${thread.id}"]`);
  await expect(card).toHaveAttribute("data-active", "");
  await expect(card.getByText("Owner answer", { exact: true })).toBeVisible();
  await expect.poll(followed).toEqual([]);

  // Unfollowing stops the next reply from arriving.
  await card.getByRole("button", { name: "Unfollow" }).click();
  await expect(card.getByRole("button", { name: "Follow replies" })).toBeVisible();
  await request.post(`${owner}/api/documents/${doc.documentId}/review-threads/${thread.id}/replies`, { headers: { Origin: owner }, data: { body: "Second answer", idempotencyKey: crypto.randomUUID() } });
  expect(await followed()).toEqual([]);
});

test("an anonymous reader is offered no following", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const token = doc.links[0].path.split("/").pop()!;
  const viewer = phase3Origin("viewer"), anonymous = phase3NoSessionOrigin();
  const created = await request.post(`${viewer}/api/share-review/threads`, { headers: { Origin: viewer }, data: { token, expectedRevisionId: doc.revisionId, anchor: { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 2, endUtf16: 9, exact: "😀 bold", prefix: "A ", suffix: " passage to review." }, body: "Signed-in question", idempotencyKey: crypto.randomUUID() } });
  const thread = await created.json();
  const read = await (await request.post(`${anonymous}/api/share-review/threads/query`, { headers: { Origin: anonymous }, data: { token } })).json();
  expect(read.callerUserId).toBeNull();
  expect(read.threads.find((candidate: { id: string }) => candidate.id === thread.id).following).toBeUndefined();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${anonymous}/s/${token}?thread=${thread.id}`);
  await expect(page.locator(`[data-review-thread="${thread.id}"]`)).toHaveAttribute("data-active", "");
  await expect(page.getByRole("button", { name: /Follow replies|Unfollow/ })).toHaveCount(0);
});
