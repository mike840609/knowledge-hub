import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument, openReviewDiscussions, selectPassage } from "./fixtures/document-review";
import { projectReviewBlocks } from "../../src/modules/knowledge/domain/review-anchor";

test("shared comments follow passage order and the selected card stays beside its highlight", async ({ page, request }) => {
  const markdown = Array.from({ length: 100 }, (_, i) => `Paragraph ${i + 1}: a clear recommendation with enough context for a colleague to review.`).join("\n\n");
  const doc = await createReviewDocument(request, markdown);
  const origin = phase3Origin("viewer");
  const token = doc.links[0].path.split("/").pop();
  const blocks = projectReviewBlocks(markdown);
  const ids: string[] = [];
  // Create out of order, including two discussions on the same passage.
  for (const [index, body] of [[79, "Later discussion"], [19, "Earlier discussion"], [19, "Selected discussion"]] as const) {
    const block = blocks[index];
    const response = await request.post(`${origin}/api/share-review/threads`, { headers: { Origin: origin }, data: {
      token, expectedRevisionId: doc.revisionId, idempotencyKey: crypto.randomUUID(), body,
      anchor: { schemaVersion: 1, blockPath: block.path, blockKind: block.kind, startUtf16: 0, endUtf16: 12, exact: block.text.slice(0, 12), prefix: "", suffix: block.text.slice(12, 76) },
    } });
    expect(response.status()).toBe(201);
    ids.push((await response.json()).id);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}${doc.links[0].path}`);
  // The reader's own discussions are not waiting for them, so the page opens without them.
  await expect(page.getByRole("complementary", { name: "Document discussions" })).toBeHidden();
  await expect(page.locator("[data-review-marker]")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "2 comments on passage: Paragraph 20" })).toBeVisible();
  await openReviewDiscussions(page);
  const cards = page.locator("[data-review-rail] [data-review-thread]").filter({ visible: true });
  await expect(cards).toHaveCount(3);
  expect(await cards.evaluateAll(elements => elements.map(element => (element as HTMLElement).dataset.reviewThread))).toEqual([ids[1], ids[2], ids[0]]);
  const selected = page.locator(`[data-review-thread="${ids[2]}"]`).filter({ visible: true });
  // Keyboard users can select a quote to navigate in both directions.
  await selected.getByRole("button", { name: "Paragraph 20", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(selected).toHaveAttribute("aria-current", "true");
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("Paragraph 20");
  const passage = page.locator("[data-review-document] p").nth(19);
  const textTop = (element: Element) => { const range = document.createRange(); range.setStart(element.firstChild!, 0); range.setEnd(element.firstChild!, 12); return range.getBoundingClientRect().top; };
  await expect.poll(async () => Math.abs((await selected.boundingBox())!.y - await passage.evaluate(textTop))).toBeLessThan(1);
  const boxes = await cards.evaluateAll(elements => elements.map(element => element.getBoundingClientRect()).map(rect => ({ top: rect.top, bottom: rect.bottom })));
  for (let i = 1; i < boxes.length; i++) expect(boxes[i].top - boxes[i - 1].bottom).toBeGreaterThanOrEqual(11);
  await expect.poll(() => page.evaluate(() => {
    const registry = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights;
    return Array.from(registry.get("document-review-active") ?? []).map(range => range.toString());
  })).toEqual(["Paragraph 20"]);

  // A long reply expands one of the two cards on the same passage; its neighbor moves down.
  const earlierCard = page.locator(`[data-review-thread="${ids[1]}"]`).filter({ visible: true });
  // One step from reading a remark to answering it: the card's own button is Reply.
  await earlierCard.getByRole("button", { name: "Reply", exact: true }).click();
  await earlierCard.getByRole("textbox", { name: "Reply" }).fill("A detailed reply\n".repeat(12));
  await earlierCard.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(earlierCard).toContainText("A detailed reply");
  await expect.poll(async () => (await selected.boundingBox())!.y - ((await earlierCard.boundingBox())!.y + (await earlierCard.boundingBox())!.height)).toBeGreaterThanOrEqual(11);

  // Clicking another highlighted passage keeps the reader at that passage.
  const later = page.locator("[data-review-document] p").nth(79);
  await later.scrollIntoViewIfNeeded();
  const point = await later.evaluate(element => {
    window.getSelection()?.removeAllRanges();
    const range = document.createRange(); range.setStart(element.firstChild!, 0); range.setEnd(element.firstChild!, 12);
    const rect = range.getBoundingClientRect(); return { x: rect.left + 8, y: rect.top + rect.height / 2, scrollY: window.scrollY };
  });
  await page.mouse.click(point.x, point.y);
  const laterCard = page.locator(`[data-review-thread="${ids[0]}"]`).filter({ visible: true });
  await expect(laterCard).toBeFocused();
  await expect(laterCard).toHaveAttribute("aria-current", "true");
  await expect.poll(async () => Math.abs((await laterCard.boundingBox())!.y - await later.evaluate(textTop))).toBeLessThan(1);
  expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(point.scrollY, 0);
  await page.screenshot({ path: "/tmp/document-review-anchored-desktop.png", fullPage: false });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.screenshot({ path: "/tmp/document-review-anchored-dark.png", fullPage: false });
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });

  // Adding a comment near the end must not send its composer to the top of the document.
  await later.evaluate(element => {
    const range = document.createRange(); range.setStart(element.firstChild!, 0); range.setEnd(element.firstChild!, 12);
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
  });
  const addComment = page.getByRole("button", { name: "Comment on selection" });
  await expect(addComment).toBeInViewport();
  await addComment.click();
  await expect(page.getByRole("textbox", { name: "Add comment" })).toBeInViewport();
  // The new comment takes the passage's level; the discussion already there moves aside, not under it.
  const draft = page.locator("[data-review-rail] [data-review-draft]");
  await expect.poll(async () => Math.abs((await draft.boundingBox())!.y - await later.evaluate(textTop))).toBeLessThan(1);
  const [draftBox, laterBox] = [(await draft.boundingBox())!, (await laterCard.boundingBox())!];
  expect(laterBox.y >= draftBox.y + draftBox.height || laterBox.y + laterBox.height <= draftBox.y).toBe(true);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.poll(async () => Math.abs((await laterCard.boundingBox())!.y - await later.evaluate(textTop))).toBeLessThan(1);

  // Collapsing recovers the full centered reading layout without losing the passage.
  const beforeCollapse = await page.evaluate(() => window.scrollY);
  await page.getByRole("button", { name: "Collapse discussions" }).click();
  await expect(page.getByRole("complementary", { name: "Document discussions" })).toBeHidden();
  expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(beforeCollapse, 0);
  // The column slides back to the centre; measure where it ends, not where it is mid-slide.
  await expect.poll(async () => { const collapsedArticle = (await page.locator("[data-review-document]").boundingBox())!; return Math.round(collapsedArticle.x + collapsedArticle.width / 2); }).toBe(720);
  await page.getByRole("button", { name: "1 comment on passage: Paragraph 80" }).click();
  await expect(laterCard).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  // An open desktop rail becomes a drawer; close it before testing passage entry on mobile.
  await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1");
  await page.getByRole("button", { name: "Close discussions" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await later.scrollIntoViewIfNeeded();
  const mobilePoint = await later.evaluate(element => {
    window.getSelection()?.removeAllRanges();
    const range = document.createRange(); range.setStart(element.firstChild!, 0); range.setEnd(element.firstChild!, 12);
    const rect = range.getBoundingClientRect(); return { x: rect.left + 8, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(mobilePoint.x, mobilePoint.y);
  const drawer = page.getByRole("dialog");
  await expect(drawer).toHaveCSS("opacity", "1");
  await expect(drawer.locator(`[data-review-thread="${ids[0]}"]`)).toBeFocused();
  await page.screenshot({ path: "/tmp/document-review-anchored-mobile.png", fullPage: false });
  await drawer.getByRole("button", { name: "Paragraph 80", exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(later).toBeFocused();
  await expect(later).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("comments stay compact until a reply is requested on desktop and mobile", async ({ page, request }) => {
  const markdown = "# Sharing knowledge\n\nKeep each document focused on one topic so that colleagues can find the answer quickly.\n\n## Writing guidelines\n\nStart with the decision or recommendation. Include a short example when it helps explain the next step.\n\nUse comments to ask questions and discuss changes before updating the document.";
  const doc = await createReviewDocument(request, markdown);
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await page.screenshot({ path: "/tmp/document-review-reading-default.png", fullPage: true });
  await openReviewDiscussions(page);
  await selectPassage(page, "one topic");
  await page.getByRole("button", { name: "Comment on selection" }).click();
  await page.getByRole("textbox", { name: "Add comment" }).fill("Could we add a short example here? It would help new colleagues get started.");
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  const thread = page.locator("[data-review-thread]").filter({ visible: true });
  await expect(thread).toContainText("Could we add a short example here?");
  await expect(thread.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByText("Current passage", { exact: true })).toHaveCount(0);
  await expect(page.getByText("0/3,000 characters", { exact: true })).toHaveCount(0);
  await thread.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(thread.getByRole("textbox", { name: "Reply" })).toBeFocused();
  await thread.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(thread.getByRole("textbox")).toHaveCount(0);
  await page.screenshot({ path: "/tmp/document-review-refined-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await openReviewDiscussions(page);
  const drawer = page.getByRole("dialog");
  await expect(drawer).toHaveCSS("opacity", "1");
  await expect(drawer.getByRole("textbox")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/document-review-refined-mobile.png", fullPage: true });
});

test("mobile comments can retry after a temporary loading failure", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  let failOnce = true;
  await page.route("**/api/share-review/threads/query", async route => {
    if (failOnce) { failOnce = false; await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "AUTH_UNAVAILABLE" } }) }); }
    else await route.continue();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await page.getByRole("button", { name: "Open discussions" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("status")).toContainText("unavailable");
  await drawer.getByRole("button", { name: "Refresh comments" }).click();
  await expect(drawer.getByRole("button", { name: "Add comment from selected text" })).toBeVisible();
  await expect(drawer.getByRole("status")).toHaveCount(0);
});

test("on a screen too narrow for the rail, discussions are reachable from anywhere in a long document", async ({ page, request }) => {
  const markdown = Array.from({ length: 120 }, (_, index) => `Paragraph ${index + 1} of a long document that a reader scrolls through.`).join("\n\n");
  const doc = await createReviewDocument(request, markdown);
  // A monitor turned to portrait: wide enough to read, too narrow for the reading column and a rail.
  await page.setViewportSize({ width: 1080, height: 1920 });
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  const open = page.getByRole("button", { name: "Open discussions" });
  const article = page.locator("[data-review-document]").filter({ visible: true });
  await expect(article.locator("p")).toHaveCount(120);
  expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight * 2), "the document must be long enough to scroll").toBe(true);

  // Before any scrolling: on screen, above the text and not over it.
  await expect(open).toBeInViewport();
  const atTop = (await open.boundingBox())!;
  expect(atTop.y + atTop.height).toBeLessThanOrEqual((await article.boundingBox())!.y);

  // In the middle of the document it has followed the reader.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
  await expect(open).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await open.click();
  await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1");
});

test("wide screens default to centered reading and open a 320px rail on demand", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  const rail = page.getByRole("complementary", { name: "Document discussions" });
  const article = page.locator("[data-review-document]").filter({ visible: true });
  await expect(rail).toBeHidden();
  await expect(page.getByRole("button", { name: "Open discussions" })).toHaveAttribute("aria-expanded", "false");
  const initialBox = (await article.boundingBox())!;
  expect(initialBox.x + initialBox.width / 2).toBeCloseTo(720, 0);
  await openReviewDiscussions(page);
  // The rail's name and its collapse control are one row.
  const railRow = async (locator: ReturnType<typeof page.locator>) => { const box = (await locator.boundingBox())!; return box.y + box.height / 2; };
  expect(Math.abs(await railRow(page.locator(".kh-review-panel h2").filter({ visible: true })) - await railRow(page.getByRole("button", { name: "Collapse discussions" })))).toBeLessThan(6);
  await expect(rail.getByRole("button", { name: "Add comment from selected text" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hide discussions" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const railBox = (await rail.boundingBox())!;
  const articleBox = (await article.boundingBox())!;
  expect(railBox.width).toBe(320);
  expect(articleBox.width).toBe(initialBox.width);
  expect(railBox.x).toBeGreaterThanOrEqual(articleBox.x + articleBox.width - 1);
  await page.getByRole("button", { name: "Collapse discussions" }).click();
  await expect(rail).toBeHidden();
  await expect(page.getByRole("button", { name: "Open discussions" })).toBeFocused();
  await expect.poll(async () => Math.round((await article.boundingBox())!.x)).toBe(Math.round(initialBox.x));
});

test("opening and closing the rail moves nothing under the pointer where the window has room for it", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  const article = page.locator("[data-review-document]").filter({ visible: true });
  const entry = page.getByRole("button", { name: /^(Open|Hide) discussions/ });
  const save = page.getByRole("button", { name: "Save share", exact: true });
  const where = async () => ({ article: (await article.boundingBox())!.x, entry: (await entry.boundingBox())!.x, save: (await save.boundingBox())!.x });
  const before = await where();
  await openReviewDiscussions(page);
  await expect(page.getByRole("complementary", { name: "Document discussions" })).toBeVisible();
  // The column slides when it must; let a slide finish before measuring where it ended.
  await expect.poll(where).toEqual(before);
  await page.getByRole("button", { name: "Collapse discussions" }).click();
  await expect.poll(where).toEqual(before);
});

async function seedSimpleThread(request: import("@playwright/test").APIRequestContext, doc: Awaited<ReturnType<typeof createReviewDocument>>) {
  const origin = phase3Origin("viewer");
  const response = await request.post(`${origin}/api/share-review/threads`, { headers: { Origin: origin }, data: {
    token: doc.links[0].path.split("/").pop(), expectedRevisionId: doc.revisionId, idempotencyKey: crypto.randomUUID(), body: "Discussion to review",
    anchor: { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 2, endUtf16: 9, exact: "😀 bold", prefix: "A ", suffix: " passage to review." },
  } });
  expect(response.status()).toBe(201);
}

test("keyboard expansion keeps a stable focus target and Escape preserves reply drafts", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  await seedSimpleThread(request, doc);
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await openReviewDiscussions(page);
  const card = page.locator("[data-review-thread]").filter({ visible: true });
  // The card's one button: Reply, since there is nothing more of this remark to show.
  await expect(card.getByRole("button", { name: "Expand comment" })).toHaveCount(0);
  const expand = card.getByRole("button", { name: "Reply", exact: true });
  await expand.focus();
  await expect(expand).toBeFocused();
  // Focus alone opens nothing.
  await expect(card.getByRole("textbox")).toHaveCount(0);
  await page.keyboard.press("Shift+Tab");
  await expect(card.getByRole("button", { name: "😀 bold", exact: true })).toBeFocused();
  // Reset to compact, then use keyboard activation instead of focus-triggered expansion.
  await page.getByRole("button", { name: "Collapse discussions" }).click();
  await openReviewDiscussions(page);
  await expand.focus();
  await page.keyboard.press("Enter");
  // The button is gone once the card is open; focus is in the reply it asked for, not lost.
  await expect(card).toHaveAttribute("aria-current", "true");
  await expect(card.getByRole("textbox", { name: "Reply" })).toBeFocused();
  await card.getByRole("textbox", { name: "Reply" }).fill("Keep this draft");
  await page.keyboard.press("Escape");
  await expect(card.getByRole("textbox", { name: "Reply" })).toHaveValue("Keep this draft");
  await expect(card.getByRole("textbox", { name: "Reply" })).toBeFocused();
  await page.getByRole("button", { name: "Collapse discussions" }).click();
  await openReviewDiscussions(page);
  await expand.click();
  await expect(card.getByRole("textbox", { name: "Reply" })).toHaveValue("Keep this draft");

  // The same form key must not invoke the modal drawer's Escape dismissal.
  await page.setViewportSize({ width: 390, height: 844 });
  const drawer = page.getByRole("dialog");
  await expect(drawer).toHaveCSS("opacity", "1");
  // The drawer's copy of the card opens on the reply the rail's held: the draft is kept, not the form.
  await expect(drawer.getByRole("textbox", { name: "Reply" })).toHaveValue("Keep this draft");
  await drawer.getByRole("textbox", { name: "Reply" }).fill("Mobile draft");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("textbox", { name: "Reply" })).toHaveValue("Mobile draft");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await drawer.getByRole("button", { name: "😀 bold", exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page.locator("[data-review-document] p")).toBeFocused();
});

test("an outdated discussion's expansion button stays focused until activated", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  await seedSimpleThread(request, doc);
  await page.route("**/api/share-review/threads/query", async route => {
    const response = await route.fetch(); const json = await response.json();
    json.threads[0].currentAnchor = { match: "OUTDATED", anchor: null };
    await route.fulfill({ response, json });
  });
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await openReviewDiscussions(page);
  const card = page.locator("[data-review-thread]").filter({ visible: true });
  // From the last control above the list, Tab reaches the card's button.
  await page.getByRole("button", { name: "Add comment from selected text" }).focus();
  await page.keyboard.press("Tab");
  await expect(card.getByRole("button", { name: "Reply", exact: true })).toBeFocused();
  await expect(card).not.toHaveAttribute("aria-current", "true");
  await page.keyboard.press("Enter");
  await expect(card).toHaveAttribute("aria-current", "true");
  await expect(card.getByRole("textbox", { name: "Reply" })).toBeFocused();
});

test("collapsed selection offers Comment, and Escape preserves a new-comment draft", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await expect(page.getByRole("button", { name: "Open discussions, 0 comments", exact: true })).toBeVisible();
  await selectPassage(page);
  await page.getByRole("button", { name: "Comment on selection" }).click();
  const input = page.getByRole("textbox", { name: "Add comment" });
  await input.fill("New draft");
  await page.keyboard.press("Escape");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("New draft");
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hide discussions, 1 comments", exact: true })).toBeVisible();
});

test("a comment starts from a button beside the selection and opens in the rail level with the passage", async ({ page, request }) => {
  const markdown = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1}: a clear recommendation with enough context for a colleague to review.`).join("\n\n");
  const doc = await createReviewDocument(request, markdown);
  const origin = phase3Origin("viewer");
  const token = doc.links[0].path.split("/").pop();
  const block = projectReviewBlocks(markdown)[44];
  // A discussion already on the same passage: the new comment takes the passage's level, the card moves aside.
  const existing = await request.post(`${origin}/api/share-review/threads`, { headers: { Origin: origin }, data: {
    token, expectedRevisionId: doc.revisionId, idempotencyKey: crypto.randomUUID(), body: "Already here",
    anchor: { schemaVersion: 1, blockPath: block.path, blockKind: block.kind, startUtf16: 0, endUtf16: 12, exact: block.text.slice(0, 12), prefix: "", suffix: block.text.slice(12, 76) },
  } });
  expect(existing.status()).toBe(201);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}${doc.links[0].path}`);
  await expect(page.locator(".kh-review-document")).toHaveAttribute("data-review-ready", "");
  const passage = page.locator("[data-review-document] p").nth(44);
  await passage.scrollIntoViewIfNeeded();
  const textTop = await passage.evaluate(element => {
    const range = document.createRange(); range.setStart(element.firstChild!, 0); range.setEnd(element.firstChild!, 12);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    return range.getBoundingClientRect().top;
  });
  const scrollY = await page.evaluate(() => window.scrollY);
  // The way in floats just above the selection; the page's bar offers none.
  const bubble = page.locator(".kh-selection-bubble");
  await expect(bubble).toBeVisible();
  const bubbleBox = (await bubble.boundingBox())!;
  expect(textTop - (bubbleBox.y + bubbleBox.height)).toBeGreaterThanOrEqual(0);
  expect(textTop - (bubbleBox.y + bubbleBox.height)).toBeLessThan(16);
  await expect(page.locator(".kh-review-entry").getByRole("button", { name: "Comment on selection" })).toHaveCount(0);
  await bubble.getByRole("button", { name: "Comment on selection" }).click();
  const draft = page.locator("[data-review-rail] [data-review-draft]");
  await expect(draft.getByRole("textbox", { name: "Add comment" })).toBeFocused();
  await expect.poll(async () => Math.abs((await draft.boundingBox())!.y - textTop)).toBeLessThan(1);
  expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(scrollY, 0);
  const card = page.locator("[data-review-rail] [data-review-thread]").filter({ visible: true });
  await expect(card).toHaveCount(1);
  const [draftBox, cardBox] = [(await draft.boundingBox())!, (await card.boundingBox())!];
  expect(cardBox.y >= draftBox.y + draftBox.height || cardBox.y + cardBox.height <= draftBox.y).toBe(true);
  await draft.getByRole("textbox", { name: "Add comment" }).fill("Written beside the passage");
  await draft.getByRole("button", { name: "Add comment", exact: true }).click();
  await expect(draft).toHaveCount(0);
  await expect(card.filter({ hasText: "Written beside the passage" })).toBeVisible();
});

test("collapsed errors and stale revision notices remain visible, with stale replies enabled", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  await seedSimpleThread(request, doc);
  let failed = true;
  await page.route("**/api/share-review/threads/query", async route => {
    if (failed) { failed = false; await route.fulfill({ status: 503, contentType: "application/json", body: "{}" }); return; }
    const response = await route.fetch(); const json = await response.json();
    await route.fulfill({ response, json: { ...json, revisionId: "new-revision" } });
  });
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await expect(page.getByRole("status")).toContainText("unavailable");
  await page.getByRole("button", { name: "Refresh comments" }).click();
  await expect(page.getByRole("status")).toContainText("Document changed.");
  await openReviewDiscussions(page);
  const card = page.locator("[data-review-thread]").filter({ visible: true });
  await card.getByRole("button", { name: "Reply", exact: true }).click();
  await card.getByRole("textbox", { name: "Reply" }).fill("Reply despite stale displayed revision");
  await card.getByRole("button", { name: "Reply", exact: true }).click();
  // Wait for the awaited mutation + refresh, not text still present in the draft textarea.
  await expect(card.getByRole("textbox", { name: "Reply" })).toHaveCount(0);
  await expect(card).toContainText("Reply despite stale displayed revision");
  await expect(page.getByRole("button", { name: "Comment on selection" })).toHaveCount(0);
  await expect(page.locator("[data-review-marker]")).toHaveCount(0);
  await page.unrouteAll({ behavior: "wait" });
});

test("saved-share actions coexist with comments on mobile without overflow", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  const save = page.getByRole("button", { name: "Save share", exact: true });
  await expect(save).toBeEnabled();
  try {
  await save.click();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View saved shares" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const saved = (await page.getByRole("button", { name: "Saved", exact: true }).boundingBox())!;
  const entry = (await page.getByRole("button", { name: "Open discussions" }).boundingBox())!;
  expect(saved.y + saved.height).toBeLessThanOrEqual(entry.y);
  await openReviewDiscussions(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Close discussions" }).click();
  await expect(page.getByRole("button", { name: "Open discussions" })).toBeFocused();
  await page.screenshot({ path: "/tmp/document-review-saved-share-mobile.png", fullPage: true });
  } finally {
    const state = await request.get(`${phase3Origin("viewer")}/api/saved-shares/state?token=${doc.links[0].path.split("/").pop()}`);
    const saved = await state.json();
    if (saved.id) expect((await request.delete(`${phase3Origin("viewer")}/api/saved-shares/${saved.id}`, { headers: { Origin: phase3Origin("viewer") } })).ok()).toBe(true);
  }
});

test("the shared page keeps one left edge: its bar, its byline, its article and its footer", async ({ page, request }) => {
  const doc = await createReviewDocument(request, "# A shared title\n\nA paragraph of the article.\n");
  const origin = phase3Origin("viewer");
  // Where each part's text starts, not where its box does: padding is what went wrong.
  const edges = () =>
    page.evaluate(() => {
      const textLeft = (selector: string) => {
        const range = document.createRange();
        range.selectNodeContents(document.querySelector(selector)!);
        return Math.round(range.getClientRects()[0].left);
      };
      return { bar: textLeft(".kh-share-page > div:first-child span"), byline: textLeft(".kh-share-page .kh-byline > span > span"), article: textLeft("[data-review-document] p"), footer: textLeft(".kh-share-page footer p") };
    });
  const aligned = async () => {
    const { bar, byline, article, footer } = await edges();
    expect({ byline, article, footer }).toEqual({ byline: bar, article: bar, footer: bar });
  };

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${origin}${doc.links[0].path}`);
    await expect(page.locator("[data-review-document] p")).toBeVisible();
    await aligned();
  }

  // With the discussions beside it the article moves left to make room, and everything moves with it.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}${doc.links[0].path}`);
  await openReviewDiscussions(page);
  await expect(page.getByRole("complementary", { name: "Document discussions" })).toBeVisible();
  await aligned();
});

test("the shared page's byline wraps without leaving a separator at the end of a line", async ({ page, request }) => {
  const doc = await createReviewDocument(request, "# A shared title\n\nA paragraph of the article.\n");
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  const byline = page.locator(".kh-share-page .kh-byline");
  await expect(byline).toContainText("Shared by");
  const { clip, items } = await byline.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { clip: { left: box.left, overflow: getComputedStyle(element).overflowX }, items: Array.from(element.querySelectorAll(":scope > span > span")).map((item) => { const rect = item.getBoundingClientRect(); const dot = getComputedStyle(item, "::before"); return { top: Math.round(rect.top), left: rect.left, dot: dot.content, text: item.textContent }; }) };
  });
  expect(items.length).toBe(3);
  expect(new Set(items.map((item) => item.top)).size).toBeGreaterThan(1);
  // Each item carries its separator before it, and the byline clips what is left of its edge:
  expect(clip.overflow).toBe("hidden");
  for (const item of items) expect(item.dot).toContain("·");
  // so an item that starts a line has its separator outside, and one that follows another has it inside.
  items.forEach((item, index) => {
    const startsLine = index === 0 || item.top !== items[index - 1].top;
    if (startsLine) expect(item.left, item.text ?? "").toBeLessThan(clip.left);
    else expect(item.left, item.text ?? "").toBeGreaterThan(clip.left);
  });
  // And none of it is written into the text, where it would be read out or left at a line's end.
  expect(await byline.textContent()).not.toContain("·");
});

test("the shared rail's heading is one row, as the owner's is: its name and filter, then refresh and a cross", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  await seedSimpleThread(request, doc);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await openReviewDiscussions(page);
  const rail = page.getByRole("complementary", { name: "Document discussions" });
  const place = async (locator: ReturnType<typeof page.locator>) => { const box = (await locator.boundingBox())!; return { middle: box.y + box.height / 2, left: box.x, bottom: box.y + box.height }; };
  const heading = await place(rail.locator("h2").filter({ visible: true }));
  const [filter, refresh, close] = [await place(rail.getByRole("button", { name: "Filter discussions" })), await place(rail.getByRole("button", { name: "Refresh comments" })), await place(rail.getByRole("button", { name: "Collapse discussions" }))];
  for (const control of [filter, refresh, close]) expect(Math.abs(control.middle - heading.middle)).toBeLessThan(6);
  const lefts = [heading.left, filter.left, refresh.left, close.left];
  expect(lefts).toEqual([...lefts].sort((a, b) => a - b));
  // One refresh, not one per row.
  await expect(rail.getByRole("button", { name: "Refresh comments" })).toHaveCount(1);
  // Add comment is the row beneath: the one thing a reader does here that an owner does not.
  expect((await place(rail.getByRole("button", { name: "Add comment from selected text" }))).middle).toBeGreaterThan(close.bottom);

  // As a drawer, which names and closes itself, the row is the filter and refresh.
  await page.getByRole("button", { name: "Collapse discussions" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await openReviewDiscussions(page);
  const drawer = page.getByRole("dialog", { name: "Comments" });
  await expect(drawer.getByRole("button", { name: "Collapse discussions" })).toHaveCount(0);
  await expect(drawer.locator("h2").filter({ hasText: /^Comments$/ }).filter({ visible: true })).toHaveCount(1);
  const [drawerFilter, drawerRefresh] = [await place(drawer.getByRole("button", { name: "Filter discussions" })), await place(drawer.getByRole("button", { name: "Refresh comments" }))];
  expect(Math.abs(drawerFilter.middle - drawerRefresh.middle)).toBeLessThan(6);
});
