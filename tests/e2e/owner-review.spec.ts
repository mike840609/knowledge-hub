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
  // A card is a preview until it is opened; its button is the reply itself.
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await page.getByRole("textbox", { name: "Reply", exact: true }).fill("Owner response"); await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page.getByText("Owner response", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resolve", exact: true }).click(); await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveCount(0);
  // Resolved, it leaves the list of what is open; it is under Resolved, and can be opened again from there.
  await expect(page.getByText("Owner response", { exact: true }).filter({ visible: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Filter discussions" }).filter({ visible: true }).click(); await page.getByRole("menuitem", { name: "Resolved", exact: true }).click();
  await page.getByRole("button", { name: "Reopen", exact: true }).click();
  await page.getByRole("button", { name: "Filter discussions" }).filter({ visible: true }).click(); await page.getByRole("menuitem", { name: "Open", exact: true }).click(); await expect(page.getByRole("button", { name: "Reply", exact: true })).toBeVisible();
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

test("a discussion that awaits the owner is open beside its passage when the document is, in the outline's place", async ({ page, request }) => {
  const doc = await documentWithDiscussion(request);
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(doc.href);
  const rail = page.getByRole("complementary", { name: "Document discussions" });
  const outlineRail = page.getByRole("complementary", { name: "On this page" });
  const marker = page.getByRole("button", { name: "1 comment on passage: Paragraph 8" });

  // Nothing was clicked: someone said something, and the owner has not seen it.
  await expect(rail).toBeVisible();
  const card = rail.locator("[data-review-thread]").filter({ visible: true });
  await expect(card).toContainText("A reviewer's remark");
  await expect(marker).toBeVisible();
  // It did not take the reader anywhere: the page is where it opened.
  expect(await page.getByRole("region", { name: "Document content" }).evaluate((pane) => pane.scrollTop)).toBe(0);
  // Beside the article, not under it; and level with the passage.
  const article = page.locator("[data-review-document]");
  const passage = article.locator("p").nth(7);
  // The column's margin slides for 120ms as the rail opens, so measure once it has come to rest.
  await expect.poll(async () => {
    const [articleBox, railBox] = [(await article.boundingBox())!, (await rail.boundingBox())!];
    return railBox.x - (articleBox.x + articleBox.width);
  }).toBeGreaterThanOrEqual(-1);
  expect((await rail.boundingBox())!.width).toBe(320);
  const textTop = (element: Element) => { const range = document.createRange(); range.setStart(element.firstChild!, 0); range.setEnd(element.firstChild!, 11); return range.getBoundingClientRect().top; };
  await expect.poll(async () => Math.abs((await card.boundingBox())!.y - await passage.evaluate(textTop))).toBeLessThan(2);
  // The outline gives up its place and is still there, above the article.
  await expect(outlineRail).toBeHidden();
  await expect(page.locator(".kh-outline-inline")).toBeVisible();
  // Nothing is pushed off the side of the pane.
  expect(await page.getByRole("region", { name: "Document content" }).evaluate((pane) => pane.scrollWidth <= pane.clientWidth)).toBe(true);

  // The rail's own controls are one row: its name, refresh, collapse.
  const rowOf = async (name: string) => { const box = (await rail.getByRole("button", { name }).boundingBox())!; return box.y + box.height / 2; };
  expect(Math.abs(await rowOf("Refresh comments") - await rowOf("Collapse discussions"))).toBeLessThan(2);
  expect(Math.abs(await rowOf("Filter discussions") - await rowOf("Collapse discussions"))).toBeLessThan(2);

  await page.getByRole("button", { name: "Collapse discussions" }).click();
  await expect(rail).toBeHidden();
  await expect(outlineRail).toBeVisible();
  // The way back in is in the document's header, beside Edit — so it costs the article no room,
  const entry = page.getByRole("button", { name: "Open discussions, 1 comments" });
  await expect(entry).toBeVisible();
  const [entryBox, editBox] = [(await entry.boundingBox())!, (await page.getByRole("link", { name: "Edit", exact: true }).boundingBox())!];
  expect(Math.abs(entryBox.y + entryBox.height / 2 - (editBox.y + editBox.height / 2))).toBeLessThan(2);
  await expect(entry).toContainText("1");
  // What is done to the document, then what is shown beside it: Edit, Share, Comments, Details —
  // the two that open something on the right are together, at the right.
  const left = async (control: ReturnType<typeof page.getByRole>) => (await control.boundingBox())!.x;
  const order = [await left(page.getByRole("link", { name: "Edit", exact: true })), await left(page.getByRole("button", { name: "Share link…" })), await left(entry), await left(page.getByRole("button", { name: "Details", exact: true }))];
  expect(order).toEqual([...order].sort((a, b) => a - b));
  // and is still there at the end of a long document, where no mark is in sight.
  await page.getByRole("region", { name: "Document content" }).evaluate((pane) => pane.scrollTo(0, pane.scrollHeight));
  await expect(marker).not.toBeInViewport();
  await expect(entry).toBeInViewport();
  await entry.click();
  await expect(rail).toBeVisible();
  // The mark on the passage is another.
  await page.getByRole("button", { name: "Collapse discussions" }).click();
  await page.getByRole("region", { name: "Document content" }).evaluate((pane) => pane.scrollTo(0, 0));
  await marker.click();
  await expect(rail).toBeVisible();
});

test("the discussions arriving do not move the article", async ({ page, request }) => {
  const doc = await documentWithDiscussion(request);
  await page.setViewportSize({ width: 1280, height: 800 });
  // Held back, so the article can be measured before the discussions are known.
  let release = () => {};
  await page.route(`**/api/documents/${doc.documentId}/review-threads`, async (route) => { await new Promise<void>((resolve) => { release = resolve; }); await route.continue(); });
  await page.goto(doc.href);
  const top = async () => Math.round((await page.locator("[data-review-document]").boundingBox())!.y);
  await expect(page.locator("[data-review-document] p").first()).toBeVisible();
  const before = await top();
  release();
  await expect(page.getByRole("button", { name: "Open discussions, 1 comments" })).toBeVisible();
  expect(await top()).toBe(before);
});

test("once the owner has closed the discussions they stay closed, until someone says something new", async ({ page, request }) => {
  const doc = await documentWithDiscussion(request);
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(doc.href);
  const rail = page.getByRole("complementary", { name: "Document discussions" });
  await expect(rail).toBeVisible();
  await page.getByRole("button", { name: "Collapse discussions" }).click();
  await expect(rail).toBeHidden();

  await page.reload();
  await expect(page.getByRole("button", { name: "Open discussions, 1 comments" })).toBeVisible();
  await expect(rail).toBeHidden();

  const viewer = phase3Origin("viewer");
  const block = projectReviewBlocks(doc.markdown).find((candidate) => candidate.text.startsWith("Paragraph 3:"))!;
  const created = await request.post(`${viewer}/api/share-review/threads`, { headers: { Origin: viewer }, data: {
    token: doc.links[0].path.split("/").pop(), expectedRevisionId: doc.revisionId, idempotencyKey: crypto.randomUUID(), body: "Something new",
    anchor: { schemaVersion: 1, blockPath: block.path, blockKind: block.kind, startUtf16: 0, endUtf16: 11, exact: block.text.slice(0, 11), prefix: "", suffix: block.text.slice(11, 75) },
  } });
  expect(created.status()).toBe(201);
  await page.reload();
  await expect(rail).toBeVisible();
  await expect(rail).toContainText("Something new");
});

test("the owner is shown what is still open; what is resolved is one choice away", async ({ page, request }) => {
  const doc = await documentWithDiscussion(request);
  const [owner, viewer] = [phase3Origin("reviewOwner"), phase3Origin("viewer")];
  const { threads } = await (await request.get(`${owner}/api/documents/${doc.documentId}/review-threads`)).json();
  expect((await request.post(`${owner}/api/documents/${doc.documentId}/review-threads/${threads[0].id}/resolution`, { headers: { Origin: owner }, data: { status: "RESOLVED" } })).ok()).toBe(true);
  const block = projectReviewBlocks(doc.markdown).find((candidate) => candidate.text.startsWith("Paragraph 3:"))!;
  expect((await request.post(`${viewer}/api/share-review/threads`, { headers: { Origin: viewer }, data: {
    token: doc.links[0].path.split("/").pop(), expectedRevisionId: doc.revisionId, idempotencyKey: crypto.randomUUID(), body: "Still to be answered",
    anchor: { schemaVersion: 1, blockPath: block.path, blockKind: block.kind, startUtf16: 0, endUtf16: 11, exact: block.text.slice(0, 11), prefix: "", suffix: block.text.slice(11, 75) },
  } })).status()).toBe(201);

  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(doc.href);
  const rail = page.getByRole("complementary", { name: "Document discussions" });
  const cards = rail.locator("[data-review-thread]").filter({ visible: true });
  await expect(rail).toBeVisible();
  // The header says what the list shows: one is open. Both are in its name.
  const entry = page.getByRole("button", { name: "Hide discussions, 2 comments, 1 open", exact: true });
  await expect(entry).toBeVisible();
  await expect(entry).toHaveText("1");
  await expect(rail.getByRole("button", { name: "Filter discussions" })).toHaveText("Open");
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("Still to be answered");

  await rail.getByRole("button", { name: "Filter discussions" }).click();
  await page.getByRole("menuitem", { name: "All comments", exact: true }).click();
  await expect(cards).toHaveCount(2);

  // A mark on a passage whose discussion is resolved still leads to it.
  await rail.getByRole("button", { name: "Filter discussions" }).click();
  await page.getByRole("menuitem", { name: "Open", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await page.getByRole("button", { name: "1 comment on passage: Paragraph 8" }).click();
  await expect(cards).toHaveCount(2);
  await expect(rail).toContainText("A reviewer's remark");
});

test("discussions that are all resolved do not open by themselves", async ({ page, request }) => {
  const doc = await documentWithDiscussion(request);
  const owner = phase3Origin("reviewOwner");
  const { threads } = await (await request.get(`${owner}/api/documents/${doc.documentId}/review-threads`)).json();
  expect((await request.post(`${owner}/api/documents/${doc.documentId}/review-threads/${threads[0].id}/resolution`, { headers: { Origin: owner }, data: { status: "RESOLVED" } })).ok()).toBe(true);
  // Resolved from the discussions, it would have been seen there; resolved here, its notice is read the same way.
  expect((await request.post(`${owner}/api/review-notifications/mark-read`, { headers: { Origin: owner }, data: { documentId: doc.documentId } })).ok()).toBe(true);
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(doc.href);
  // Nothing awaits the owner, so the control carries no number.
  const entry = page.getByRole("button", { name: "Open discussions, 1 comments, 0 open", exact: true });
  await expect(entry).toBeVisible();
  await expect(entry).toHaveText("");
  const rail = page.getByRole("complementary", { name: "Document discussions" });
  await expect(rail).toBeHidden();
  await expect(page.getByRole("complementary", { name: "On this page" })).toBeVisible();
  // Asked for, they are all there: with nothing open, an empty list would say there was nothing at all.
  await openReviewDiscussions(page);
  await expect(rail.getByRole("button", { name: "Filter discussions" })).toHaveText("All comments");
  await expect(rail.locator("[data-review-thread]").filter({ visible: true })).toHaveCount(1);
});

test("the owner's page keeps one left edge for its title and its article, with discussions open or not", async ({ page, request }) => {
  const doc = await documentWithDiscussion(request);
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(doc.href);
  const rail = page.getByRole("complementary", { name: "Document discussions" });
  const edges = () => page.evaluate(() => {
    const textLeft = (element: Element) => { const range = document.createRange(); range.selectNodeContents(element); return Math.round(range.getClientRects()[0].left); };
    return { title: textLeft(document.querySelector('[role="region"][aria-label="Document content"] h1')!), article: textLeft(document.querySelector("[data-review-document] p")!) };
  });
  await expect(rail).toBeVisible();
  const open = await edges();
  expect(open.article).toBe(open.title);
  await page.getByRole("button", { name: "Collapse discussions" }).click();
  await expect(rail).toBeHidden();
  const closed = await edges();
  expect(closed.article).toBe(closed.title);
});

test("where the pane has no room for a rail, the owner's discussions open over the article instead", async ({ page, request }) => {
  const doc = await documentWithDiscussion(request);
  await page.setViewportSize({ width: 820, height: 800 });
  await page.goto(doc.href);
  // A drawer would cover the article the owner came to read, so here it waits to be asked for.
  await expect(page.locator(".kh-review-document")).toHaveAttribute("data-review-ready", "");
  await expect(page.getByRole("button", { name: "Open discussions, 1 comments" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
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
  await expect(page.locator(".kh-review-document")).toHaveAttribute("data-review-ready", "");
  await expect(page.getByRole("button", { name: /discussions/ })).toHaveCount(0);
  await expect(page.locator("[data-review-marker]")).toHaveCount(0);
  expect(await page.locator("[data-review-document]").evaluate((article) => getComputedStyle(article).paddingRight)).toBe("0px");
});

test("opening and closing the owner's discussions moves nothing under the pointer where the pane has room", async ({ page, request }) => {
  const doc = await documentWithDiscussion(request);
  const article = page.locator("[data-review-document]");
  const crumb = page.getByRole("region", { name: "Document content", exact: true }).getByRole("navigation", { name: "Breadcrumb" });
  const edit = page.getByRole("link", { name: "Edit", exact: true });
  const where = async () => ({ crumb: Math.round((await crumb.boundingBox())!.x), article: Math.round((await article.boundingBox())!.x), edit: Math.round((await edit.boundingBox())!.x) });
  // 1920: room for the rail beside the column as it stood. 1440: the pane is narrower than the reading
  // width beside the outline, so the outline's slot is what the rail takes. Re-centred, the path line's
  // controls leapt 224-272px right and the column slid 48px left.
  for (const width of [1920, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(doc.href);
    const rail = page.getByRole("complementary", { name: "Document discussions" });
    await expect(rail).toBeVisible();
    await page.getByRole("button", { name: "Collapse discussions" }).click();
    await expect(rail).toBeHidden();
    // Settled: the same place twice, a slide's length apart. A slide can still be under way here (the rail
    // opened by itself on arrival), and one reading taken mid-slide is not where the column rests.
    const settled = async () => { const first = await where(); await page.waitForTimeout(250); return JSON.stringify(first) === JSON.stringify(await where()) ? first : null; };
    let closed: Awaited<ReturnType<typeof where>> | null = null;
    await expect.poll(async () => (closed = await settled()) !== null).toBe(true);
    await page.getByRole("button", { name: /^Open discussions/ }).click();
    await expect(rail).toBeVisible();
    // The column slides when it must; let a slide finish before measuring where it ended.
    await expect.poll(where).toEqual(closed);
    expect(await page.getByRole("region", { name: "Document content" }).evaluate((pane) => pane.scrollWidth <= pane.clientWidth)).toBe(true);
  }
});
