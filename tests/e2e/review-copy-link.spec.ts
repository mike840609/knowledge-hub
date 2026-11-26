import { expect, test } from "./fixtures/test";
import { phase3Origin, phase3UserId } from "./fixtures/phase3-identities";
import { createReviewDocument, openReviewDiscussions } from "./fixtures/document-review";
import type { APIRequestContext, Page } from "@playwright/test";

/**
 * "Copy link to discussion" (inline review spec, 2026-11-26 amendment): the copied address reopens the
 * discussion where it was read — the shared page, a NAMED share's `/open` form, the owner's page.
 */
const anchor = { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 2, endUtf16: 9, exact: "😀 bold", prefix: "A ", suffix: " passage to review." };

async function startThread(request: APIRequestContext, origin: string, token: string, revisionId: string, body: string): Promise<string> {
  const created = await request.post(`${origin}/api/share-review/threads`, { headers: { Origin: origin }, data: { token, expectedRevisionId: revisionId, anchor, body, idempotencyKey: crypto.randomUUID() } });
  expect(created.status()).toBe(201);
  return (await created.json()).id;
}

async function copyLink(page: Page, threadId: string): Promise<string> {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const card = page.locator(`[data-review-thread="${threadId}"]`).filter({ visible: true });
  await card.click();
  await expect(card).toHaveAttribute("aria-current", "true");
  await card.getByRole("button", { name: "Comment options" }).click();
  await page.getByRole("menuitem", { name: "Copy link to discussion" }).click();
  await expect(card.getByRole("status")).toHaveText("Link copied");
  return page.evaluate(() => navigator.clipboard.readText());
}

async function expectOpenedOn(page: Page, url: string, threadId: string) {
  await page.goto(url);
  await expect(page.locator(`[data-review-thread="${threadId}"]`).filter({ visible: true })).toHaveAttribute("aria-current", "true");
}

test("a shared page's discussion link reopens it, even resolved", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const token = doc.links[0].path.split("/").pop()!;
  const viewer = phase3Origin("viewer");
  const threadId = await startThread(request, viewer, token, doc.revisionId, "Link me");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${viewer}${doc.links[0].path}`);
  await openReviewDiscussions(page);
  const copied = await copyLink(page, threadId);
  expect(copied).toBe(`${viewer}/s/${token}?thread=${threadId}`);
  // Resolved since, it is still where the link leads, though the list starts on Open.
  const owner = phase3Origin("reviewOwner");
  expect((await request.post(`${owner}/api/documents/${doc.documentId}/review-threads/${threadId}/resolution`, { headers: { Origin: owner }, data: { status: "RESOLVED" } })).ok()).toBe(true);
  await expectOpenedOn(page, copied, threadId);
  await expect(page.locator(`[data-review-thread="${threadId}"]`).filter({ visible: true })).toContainText("Resolved");
});

test("the owner's discussion link reopens it on the document's page", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const threadId = await startThread(request, phase3Origin("viewer"), doc.links[0].path.split("/").pop()!, doc.revisionId, "Owner link");
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(doc.href);
  await openReviewDiscussions(page);
  const copied = await copyLink(page, threadId);
  expect(copied).toBe(`${doc.href}?thread=${threadId}`);
  await expectOpenedOn(page, copied, threadId);
});

test("a NAMED share's discussion link is its /open form, which leads each recipient to it in their Hub reader", async ({ page, request }) => {
  const recipient = phase3Origin("nonCreator");
  await request.get(`${recipient}/api/workspaces`); // provisions the recipient, whom naming requires
  const doc = await createReviewDocument(request);
  const created = await request.post(`${phase3Origin("reviewOwner")}/api/documents/${doc.documentId}/share-links`, { data: { label: "named", recipients: [phase3UserId("nonCreator")] } });
  expect(created.ok()).toBe(true);
  const { path } = (await created.json()).link as { path: string };
  const token = path.slice("/s/".length);
  const threadId = await startThread(request, recipient, token, doc.revisionId, "Named link");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${recipient}${path}/open`);
  await expect(page).toHaveURL(/\/w\/[^/]+\/shares\//);
  await openReviewDiscussions(page);
  const copied = await copyLink(page, threadId);
  expect(copied).toBe(`${recipient}/s/${token}/open?thread=${threadId}`);
  await expectOpenedOn(page, copied, threadId);
  await expect(page).toHaveURL(new RegExp(`/w/[^/]+/shares/${token}\\?thread=${threadId}$`));
});
