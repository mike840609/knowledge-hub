import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument, openReviewDiscussions, selectPassage } from "./fixtures/document-review";

test("owner and shared readers agree on emoji, formatting and duplicate block offsets", async ({ page, request }) => {
  const markdown = "A 😀 **bold** passage to review.\n\nA 😀 **bold** passage to review.\n\nOther <kbd>Wiki</kbd> text.\n\nA [relative](./document.md) link.";
  const doc = await createReviewDocument(request, markdown);
  await page.goto(doc.href);
  await expect(page.getByRole("textbox", { name: "Content", exact: true })).toBeVisible();
  await expect(page.locator("[data-review-document] p")).toHaveCount(4);
  const owner = await page.locator("[data-review-document] p").allTextContents();
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await expect(page.locator("[data-review-document] p")).toHaveCount(4);
  const shared = await page.locator("[data-review-document] p").allTextContents();
  expect(owner.slice(0, 2)).toEqual(shared.slice(0, 2));
  await openReviewDiscussions(page);
  await selectPassage(page);
  await page.getByRole("button", { name: "Comment on selection" }).click();
  await page.getByRole("textbox", { name: "Add comment" }).fill("UTF-16 check");
  const submitted = page.waitForRequest(request => request.url().endsWith("/api/share-review/threads") && request.method() === "POST");
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  const body = (await submitted).postDataJSON();
  expect(body.anchor).toMatchObject({ startUtf16: 2, endUtf16: 9, exact: "😀 bold", blockPath: [0] });
  await expect(page.getByText("UTF-16 check", { exact: true })).toBeVisible();
  await page.goto(doc.href);
  await expect(page.getByRole("textbox", { name: "Content", exact: true })).toBeVisible();
  await openReviewDiscussions(page);
  await page.getByRole("button", { name: "😀 bold", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("😀 bold");
  const ownerSelection = await page.locator("[data-review-document]").evaluate(root => { const selection = window.getSelection()!; const range = selection.getRangeAt(0); const paragraph = root.querySelector("p")!; const before = range.cloneRange(); before.selectNodeContents(paragraph); before.setEnd(range.startContainer, range.startOffset); return { exact: selection.toString(), startUtf16: before.toString().length }; });
  expect(ownerSelection).toEqual({ exact: "😀 bold", startUtf16: 2 });
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await openReviewDiscussions(page);
  for (const index of [2, 3]) {
    await page.locator("[data-review-document] p").nth(index).evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); });
    await page.getByRole("button", { name: "Add comment from selected text" }).click();
    await expect(page.getByRole("textbox", { name: "Add comment" })).toHaveCount(0);
  }
});

test("new server revision disables mapping into an older displayed document", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  await page.route("**/api/share-review/threads/query", async route => {
    const response = await route.fetch();
    const json = await response.json();
    await route.fulfill({ response, json: { ...json, revisionId: "newer-server-revision" } });
  });
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await openReviewDiscussions(page);
  await expect(page.getByRole("status").filter({ hasText: "Document changed." })).toContainText("Document changed. Refresh this page");
  await expect(page.locator("[data-review-marker]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Comment on selection" })).toHaveCount(0);
  await page.route(`**/api/documents/${doc.documentId}/review-threads`, async route => {
    const response = await route.fetch(); const json = await response.json();
    await route.fulfill({ response, json: { ...json, revisionId: "newer-server-revision" } });
  });
  // The owner is shown a way into discussions only where there is one, so there has to be one.
  const viewer = phase3Origin("viewer");
  const created = await request.post(`${viewer}/api/share-review/threads`, { headers: { Origin: viewer }, data: {
    token: doc.links[0].path.split("/").pop(), expectedRevisionId: doc.revisionId, idempotencyKey: crypto.randomUUID(), body: "A remark on the older text",
    anchor: { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 0, endUtf16: 1, exact: "A", prefix: "", suffix: " 😀 bold passage to review." },
  } });
  expect(created.status()).toBe(201);
  await page.goto(doc.href);
  await expect(page.getByRole("textbox", { name: "Content", exact: true })).toBeVisible();
  await openReviewDiscussions(page);
  await expect(page.getByRole("status").filter({ hasText: "Document changed." }).filter({ visible: true })).toContainText("Document changed. Refresh this page");
  // And with the document changed underneath them, the discussions are not pinned to passages.
  await expect(page.locator("[data-review-marker]")).toHaveCount(0);
});

test("external references and nested lists preserve commenting on unrelated paragraphs", async ({ page, request }) => {
  const doc = await createReviewDocument(request, "See [reference](https://example.com) here.\n\n- Parent\n  - Child\n\nSafe passage here.");
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await openReviewDiscussions(page);
  const paragraph = page.locator("[data-review-document] p").filter({ hasText: "Safe passage here." });
  await paragraph.evaluate(element => { const range = document.createRange(); range.setStart(element.firstChild!, 0); range.setEnd(element.firstChild!, 4); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); });
  await page.getByRole("button", { name: "Comment on selection" }).click();
  await page.getByRole("textbox", { name: "Add comment" }).fill("Safe paragraph remains reviewable");
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  const thread = page.locator("[data-review-thread]").filter({ visible: true });
  await expect(thread).toContainText("Safe paragraph remains reviewable");
  await thread.getByRole("button", { name: "Safe", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("Safe");
});
