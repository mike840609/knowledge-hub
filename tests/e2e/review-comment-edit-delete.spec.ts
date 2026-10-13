import { expect, test } from "./fixtures/test";
import { phase3Origin, phase3NoSessionOrigin } from "./fixtures/phase3-identities";
import { createReviewDocument, openReviewDiscussions, selectPassage } from "./fixtures/document-review";

const anchor = { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 2, endUtf16: 9, exact: "😀 bold", prefix: "A ", suffix: " passage to review." };

test("a reader edits and then deletes their own comment through the link; nobody else can", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const token = doc.links[0].path.split("/").pop();
  const viewer = phase3Origin("viewer"), owner = phase3Origin("reviewOwner");
  await page.goto(`${viewer}${doc.links[0].path}`);
  await openReviewDiscussions(page);
  await selectPassage(page); await page.getByRole("button", { name: "Comment on selection" }).first().click();
  await page.getByRole("textbox", { name: "Add comment" }).fill("First wording"); await page.getByRole("button", { name: "Add comment", exact: true }).click();
  const thread = page.locator("[data-review-thread]").filter({ visible: true });
  await expect(thread.getByText("First wording", { exact: true })).toBeVisible();

  await thread.getByRole("button", { name: "Comment options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Edit comment", exact: true });
  await expect(editor).toHaveValue("First wording");
  await editor.fill("Second wording"); await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(thread.getByText("Second wording", { exact: true })).toBeVisible();
  await expect(thread.getByText("Edited", { exact: false })).toBeVisible();
  await expect(editor).toHaveCount(0);

  // The owner reads the new wording and is told it was edited, and may hide it — not rewrite or delete it.
  const read = await (await request.get(`${owner}/api/documents/${doc.documentId}/review-threads`)).json();
  const comment = read.threads[0].comments[0];
  expect(comment).toMatchObject({ body: "Second wording", own: false, deleted: false }); expect(comment.editedAt).not.toBeNull();
  const base = `/api/documents/${doc.documentId}/review-threads/${read.threads[0].id}/comments/${comment.id}`;
  expect((await request.post(`${owner}${base}/body`, { headers: { Origin: owner }, data: { body: "Owner rewrite" } })).status()).toBe(404);
  expect((await request.post(`${owner}${base}/deletion`, { headers: { Origin: owner }, data: {} })).status()).toBe(404);
  // Without an identity the link reads, and writes nothing.
  const anonymous = phase3NoSessionOrigin();
  for (const action of ["body", "deletion"]) expect((await request.post(`${anonymous}/api/share-review/threads/${read.threads[0].id}/comments/${comment.id}/${action}`, { headers: { Origin: anonymous }, data: { token, body: "Anonymous rewrite" } })).status()).toBe(401);
  await page.goto(doc.href); await openReviewDiscussions(page);
  await page.getByRole("button", { name: "Comment options", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Hide thread", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Delete", exact: true })).toHaveCount(0);

  // Deleted with nothing under it, the discussion goes with it — for the reader, the owner, and the link.
  await page.goto(`${viewer}${doc.links[0].path}`); await openReviewDiscussions(page);
  await expect(thread.getByText("Second wording", { exact: true })).toBeVisible();
  await thread.getByRole("button", { name: "Comment options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete comment", exact: true }).click();
  await expect(page.locator("[data-review-thread]")).toHaveCount(0);
  await expect(page.getByText("No comments yet.", { exact: true }).filter({ visible: true })).toBeVisible();
  for (const result of [await (await request.get(`${owner}/api/documents/${doc.documentId}/review-threads`)).json(), await (await request.post(`${anonymous}/api/share-review/threads/query`, { headers: { Origin: anonymous }, data: { token } })).json()]) {
    expect(result.threads).toEqual([]); expect(JSON.stringify(result)).not.toContain("wording");
  }
});

test("the owner edits and deletes their own reply; it stays as a tombstone under the reader's comment", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const token = doc.links[0].path.split("/").pop();
  const viewer = phase3Origin("viewer");
  const created = await request.post(`${viewer}/api/share-review/threads`, { headers: { Origin: viewer }, data: { token, expectedRevisionId: doc.revisionId, anchor, body: "Reader question", idempotencyKey: crypto.randomUUID() } });
  expect(created.status()).toBe(201);
  await page.goto(doc.href); await openReviewDiscussions(page);
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await page.getByRole("textbox", { name: "Reply", exact: true }).fill("Owner answer SECRET"); await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page.getByText("Owner answer SECRET", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Reply options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Edit comment", exact: true }).fill("Owner answer SECRET, revised"); await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Owner answer SECRET, revised", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Reply options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete comment", exact: true }).click();
  const thread = page.locator("[data-review-thread]").filter({ visible: true });
  await expect(thread.getByText("Comment deleted by author", { exact: true })).toBeVisible();
  await expect(thread.getByText("Reader question", { exact: true })).toBeVisible();
  await expect(page.getByText("SECRET", { exact: false })).toHaveCount(0);
  // A tombstone offers nothing more to do.
  await expect(page.getByRole("button", { name: "Reply options", exact: true })).toHaveCount(0);
  const shared = await (await request.post(`${viewer}/api/share-review/threads/query`, { headers: { Origin: viewer }, data: { token } })).json();
  expect(shared.threads[0].comments).toMatchObject([{ body: "Reader question", own: true, deleted: false }, { body: "", deleted: true, own: false }]);
  expect(JSON.stringify(shared)).not.toContain("SECRET");
});
