import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument, openReviewDiscussions, selectPassage } from "./fixtures/document-review";
import { projectReviewBlocks } from "../../src/modules/knowledge/domain/review-anchor";

test("owner replies, resolves, reopens and hides first comment without changing Markdown", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await openReviewDiscussions(page);
  await selectPassage(page); await page.getByRole("button", { name: "Comment on selection" }).click();
  await page.getByRole("textbox", { name: "Add comment" }).fill("Secret review comment"); await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await expect(page.getByText("Secret review comment", { exact: true })).toBeVisible();
  await page.goto(doc.href); await openReviewDiscussions(page);
  await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveCount(0);
  // A card is a preview until it is opened, as on the shared page.
  await page.getByRole("button", { name: "Expand comment", exact: true }).click();
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await page.getByRole("textbox", { name: "Reply", exact: true }).fill("Owner response"); await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page.getByText("Owner response", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resolve", exact: true }).click(); await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Reopen", exact: true }).click(); await expect(page.getByRole("button", { name: "Reply", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Comment options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Hide thread", exact: true }).click(); await page.getByRole("button", { name: "Confirm hide", exact: true }).click(); await expect(page.getByText("Hidden from reviewers", { exact: false }).filter({ visible: true })).toBeVisible();
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
  await openReviewDiscussions(page);
  await expect(page.getByText("Retained moderation history", { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole("button", { name: "Expand comment", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resolve", exact: true })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Comment options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Hide thread", exact: true }).click();
  await page.getByRole("button", { name: "Confirm hide", exact: true }).click();
  // The click starts the write; a read takes no lock and does not wait for it, so ask until it has landed.
  await expect.poll(async () => {
    const moderated = await (await request.get(`${owner}/api/documents/${doc.documentId}/review-threads`)).json();
    return moderated.threads.find((item: { id: string }) => item.id === thread.id)?.visibility;
  }).toBe("HIDDEN");
});

/** A document long enough to scroll, with an outline, and one discussion on a passage well down it. */
async function documentWithDiscussion(request: Parameters<typeof createReviewDocument>[0]) {
  const paragraphs = (from: number) => Array.from({ length: 20 }, (_, i) => `Paragraph ${from + i}: a clear recommendation with enough context for a colleague to review.`).join("\n\n");
  const markdown = `## Alpha\n\n${paragraphs(1)}\n\n## Beta\n\n${paragraphs(21)}\n`;
  const doc = await createReviewDocument(request, markdown);
  const viewer = phase3Origin("viewer");
  const block = projectReviewBlocks(markdown).find((candidate) => candidate.text.startsWith("Paragraph 8:"))!;
  const created = await request.post(`${viewer}/api/share-review/threads`, { headers: { Origin: viewer }, data: {
    token: doc.links[0].path.split("/").pop(), expectedRevisionId: doc.revisionId, idempotencyKey: crypto.randomUUID(), body: "A reviewer's remark",
    anchor: { schemaVersion: 1, blockPath: block.path, blockKind: block.kind, startUtf16: 0, endUtf16: 11, exact: block.text.slice(0, 11), prefix: "", suffix: block.text.slice(11, 75) },
  } });
  expect(created.status()).toBe(201);
  return doc;
}

test("the owner reads a discussion beside the passage it is about, in the outline's place", async ({ page, request }) => {
  const doc = await documentWithDiscussion(request);
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(doc.href);
  const rail = page.getByRole("complementary", { name: "Document discussions" });
  const outlineRail = page.getByRole("complementary", { name: "On this page" });
  const marker = page.getByRole("button", { name: "1 comment on passage: Paragraph 8" });

  // Reading first: the article, its outline beside it, and a mark on the passage that has a discussion.
  await expect(marker).toBeVisible();
  await expect(rail).toBeHidden();
  await expect(outlineRail).toBeVisible();
  await expect(page.getByRole("button", { name: "Open discussions, 1 comments" })).toBeVisible();

  await marker.click();
  await expect(rail).toBeVisible();
  const card = rail.locator("[data-review-thread]").filter({ visible: true });
  await expect(card).toContainText("A reviewer's remark");
  // Beside the article, not under it; and level with the passage.
  const article = page.locator("[data-review-document]");
  const passage = article.locator("p").nth(7);
  const [articleBox, railBox] = [(await article.boundingBox())!, (await rail.boundingBox())!];
  expect(railBox.x).toBeGreaterThanOrEqual(articleBox.x + articleBox.width - 1);
  expect(railBox.width).toBe(320);
  const textTop = (element: Element) => { const range = document.createRange(); range.setStart(element.firstChild!, 0); range.setEnd(element.firstChild!, 11); return range.getBoundingClientRect().top; };
  await expect.poll(async () => Math.abs((await card.boundingBox())!.y - await passage.evaluate(textTop))).toBeLessThan(2);
  // The outline gives up its place and is still there, above the article.
  await expect(outlineRail).toBeHidden();
  await expect(page.locator(".kh-outline-inline")).toBeVisible();
  // Nothing is pushed off the side of the pane.
  expect(await page.getByRole("region", { name: "Document content" }).evaluate((pane) => pane.scrollWidth <= pane.clientWidth)).toBe(true);

  await page.getByRole("button", { name: "Collapse discussions" }).click();
  await expect(rail).toBeHidden();
  await expect(outlineRail).toBeVisible();
});

test("the owner's page keeps one left edge for its title and its article, with discussions open or not", async ({ page, request }) => {
  const doc = await documentWithDiscussion(request);
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(doc.href);
  const edges = () => page.evaluate(() => {
    const textLeft = (element: Element) => { const range = document.createRange(); range.selectNodeContents(element); return Math.round(range.getClientRects()[0].left); };
    return { title: textLeft(document.querySelector('[role="region"][aria-label="Document content"] h1')!), article: textLeft(document.querySelector("[data-review-document] p")!) };
  });
  const closed = await edges();
  expect(closed.article).toBe(closed.title);
  await openReviewDiscussions(page);
  await expect(page.getByRole("complementary", { name: "Document discussions" })).toBeVisible();
  const open = await edges();
  expect(open.article).toBe(open.title);
});

test("where the pane has no room for a rail, the owner's discussions open over the article instead", async ({ page, request }) => {
  const doc = await documentWithDiscussion(request);
  await page.setViewportSize({ width: 820, height: 800 });
  await page.goto(doc.href);
  await openReviewDiscussions(page);
  const drawer = page.getByRole("dialog", { name: "Comments" });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("A reviewer's remark");
  await expect(page.getByRole("complementary", { name: "Document discussions" })).toBeHidden();
});

test("a document nobody has commented on shows the owner no way into discussions, and no margin for marks", async ({ page, request }) => {
  const doc = await createReviewDocument(request, "## Alpha\n\nA paragraph.\n\n## Beta\n\nAnother.\n");
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(doc.href);
  await expect(page.locator(".kh-shared-document")).toHaveAttribute("data-review-ready", "");
  await expect(page.getByRole("button", { name: /discussions/ })).toHaveCount(0);
  await expect(page.locator("[data-review-marker]")).toHaveCount(0);
  expect(await page.locator("[data-review-document]").evaluate((article) => getComputedStyle(article).paddingRight)).toBe("0px");
});
