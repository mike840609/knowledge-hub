import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument } from "./fixtures/document-review";

// Spec 2026-10-23: Shares → Discussions lists what the reader follows and marks new replies.
test("a reader finds their discussion in Shares → Discussions, sees the reply, and lets it go", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const owner = phase3Origin("reviewOwner"), viewer = phase3Origin("viewer");
  const token = doc.links[0].path.split("/").pop()!;
  const query = await (await request.post(`${viewer}/api/share-review/threads/query`, { headers: { Origin: viewer }, data: { token } })).json();
  const created = await request.post(`${viewer}/api/share-review/threads`, { headers: { Origin: viewer }, data: { token, expectedRevisionId: query.revisionId, anchor: { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 2, endUtf16: 9, exact: "😀 bold", prefix: "A ", suffix: " passage to review." }, body: "Reader question", idempotencyKey: crypto.randomUUID() } });
  expect(created.status()).toBe(201);
  const thread = await created.json();

  await page.goto(`${viewer}/`);
  await expect(page).toHaveURL(/\/w\/[^/]+\//);
  const workspaceId = new URL(page.url()).pathname.split("/")[2];
  const row = () => page.getByRole("list", { name: "Followed discussions" }).locator("li").filter({ has: page.locator(`a[href="/s/${token}?thread=${thread.id}"]`) });
  await page.goto(`${viewer}/w/${workspaceId}/shares?tab=discussions`);
  await expect(row()).toContainText("Reader question");
  await expect(row()).not.toContainText("new repl");

  await request.post(`${owner}/api/documents/${doc.documentId}/review-threads/${thread.id}/replies`, { headers: { Origin: owner }, data: { body: "Owner answer", idempotencyKey: crypto.randomUUID() } });
  await page.reload();
  await expect(row()).toContainText("1 new reply");

  // Arriving marks the discussion seen by a request the page sends on its own: wait for it before leaving.
  const seen = page.waitForResponse(response => response.url().includes(`/api/share-review/threads/${thread.id}/seen`) && response.ok());
  await row().locator("a").click();
  await expect(page.locator(`[data-review-thread="${thread.id}"]`)).toHaveAttribute("data-active", "");
  await seen;
  await page.goto(`${viewer}/w/${workspaceId}/shares?tab=discussions`);
  await expect(row()).not.toContainText("new repl");

  await row().getByRole("button", { name: /^Unfollow:/ }).click();
  await expect(row()).toHaveCount(0);
  await page.reload();
  await expect(row()).toHaveCount(0);
});

test("a revoked link leaves a row that names nothing, and Remove clears it", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const owner = phase3Origin("reviewOwner"), viewer = phase3Origin("viewer");
  const token = doc.links[0].path.split("/").pop()!;
  const created = await request.post(`${viewer}/api/share-review/threads`, { headers: { Origin: viewer }, data: { token, expectedRevisionId: doc.revisionId, anchor: { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 2, endUtf16: 9, exact: "😀 bold", prefix: "A ", suffix: " passage to review." }, body: "Soon gone", idempotencyKey: crypto.randomUUID() } });
  expect(created.status()).toBe(201);
  const thread = await created.json();
  const revoked = await request.post(`${owner}/api/share-links/${doc.links[0].id}/revoke`, { headers: { Origin: owner } });
  expect(revoked.ok()).toBe(true);

  await page.goto(`${viewer}/`);
  await expect(page).toHaveURL(/\/w\/[^/]+\//);
  const workspaceId = new URL(page.url()).pathname.split("/")[2];
  await page.goto(`${viewer}/w/${workspaceId}/shares?tab=discussions`);
  const row = page.locator(`li[data-thread-id="${thread.id}"]`);
  await expect(row).toHaveText(/A shared discussion — this link is no longer available/);
  await expect(row.locator("a")).toHaveCount(0);
  await expect(page.getByText("Soon gone")).toHaveCount(0);
  await row.getByRole("button", { name: "Remove discussion" }).click();
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(page.locator(`li[data-thread-id="${thread.id}"]`)).toHaveCount(0);
});
