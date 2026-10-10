import { expect, test } from "@playwright/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument, selectPassage } from "./fixtures/document-review";

test("owner replies, resolves, reopens and hides first comment without changing Markdown", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await selectPassage(page); await page.getByRole("button", { name: "Comment on selection" }).click();
  await page.getByRole("textbox", { name: "Add comment" }).fill("Secret review comment"); await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await expect(page.getByText("Secret review comment", { exact: true })).toBeVisible();
  await page.goto(doc.href); await page.getByText("Comments", { exact: true }).filter({ visible: true }).click();
  await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await page.getByRole("textbox", { name: "Reply", exact: true }).fill("Owner response"); await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page.getByText("Owner response", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resolve", exact: true }).click(); await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Reopen", exact: true }).click(); await expect(page.getByRole("button", { name: "Reply", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Comment options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Hide thread", exact: true }).click(); await page.getByRole("button", { name: "Confirm hide", exact: true }).click(); await expect(page.getByText("Hidden from reviewers", { exact: false })).toBeVisible();
  const response = await request.post(`${phase3Origin("viewer")}/api/share-review/threads/query`, { headers: { Origin: phase3Origin("viewer") }, data: { token: doc.links[1].path.split("/").pop() } });
  const data = await response.json(); expect(data.threads).toEqual([]); expect(JSON.stringify(data)).not.toContain("Secret review comment");
  await expect(page.locator("[data-review-document]")).toContainText("A 😀 bold passage to review.");
});

test("owner moderation survives link revocation and document archive", async ({ page, request }) => {
  const doc = await createReviewDocument(request, "Review this passage.");
  const owner = phase3Origin("reviewOwner"), viewer = phase3Origin("viewer");
  const token = doc.links[0].path.split("/").pop();
  const query = await (await request.post(`${viewer}/api/share-review/threads/query`, { headers: { Origin: viewer }, data: { token } })).json();
  const created = await request.post(`${viewer}/api/share-review/threads`, { headers: { Origin: viewer }, data: { token, expectedRevisionId: query.revisionId, anchor: { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 0, endUtf16: 6, exact: "Review", prefix: "", suffix: " this passage." }, body: "Retained moderation history", idempotencyKey: crypto.randomUUID() } });
  expect(created.status()).toBe(201);
  const thread = await created.json();
  for (const link of doc.links) expect((await request.post(`${owner}/api/share-links/${link.id}/revoke`)).ok()).toBe(true);
  expect((await request.post(`${owner}/api/documents/${doc.documentId}/archive`)).ok()).toBe(true);
  await page.goto(`${doc.href}?includeArchived=true`);
  await page.getByText("Comments", { exact: true }).filter({ visible: true }).click();
  await expect(page.getByText("Retained moderation history", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resolve", exact: true })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Comment options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Hide thread", exact: true }).click();
  await page.getByRole("button", { name: "Confirm hide", exact: true }).click();
  const moderated = await (await request.get(`${owner}/api/documents/${doc.documentId}/review-threads`)).json();
  expect(moderated.threads.find((item: { id: string }) => item.id === thread.id).visibility).toBe("HIDDEN");
});
