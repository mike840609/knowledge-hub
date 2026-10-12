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
  await earlierCard.getByRole("button", { name: "Expand comment", exact: true }).click();
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
  await expect.poll(async () => Math.abs((await laterCard.boundingBox())!.y - await later.evaluate(textTop))).toBeLessThan(1);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  // Collapsing recovers the full centered reading layout without losing the passage.
  const beforeCollapse = await page.evaluate(() => window.scrollY);
  await page.getByRole("button", { name: "Collapse discussions" }).click();
  await expect(page.getByRole("complementary", { name: "Document discussions" })).toBeHidden();
  expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(beforeCollapse, 0);
  const collapsedArticle = (await page.locator("[data-review-document]").boundingBox())!;
  expect(collapsedArticle.x + collapsedArticle.width / 2).toBeCloseTo(720, 0);
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
  await expect(drawer.getByRole("button", { name: "Comment on selection" })).toBeVisible();
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
  await expect(rail.getByRole("button", { name: "Comment on selection" })).toBeVisible();
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
  expect((await article.boundingBox())!.x).toBeCloseTo(initialBox.x, 0);
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
  const expand = card.getByRole("button", { name: "Expand comment" });
  await expand.focus();
  await expect(expand).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(card.getByRole("button", { name: "😀 bold", exact: true })).toBeFocused();
  // Reset to compact, then use keyboard activation instead of focus-triggered expansion.
  await page.getByRole("button", { name: "Collapse discussions" }).click();
  await openReviewDiscussions(page);
  await expand.focus();
  await page.keyboard.press("Enter");
  await expect(card).toBeFocused();
  await card.getByRole("button", { name: "Reply", exact: true }).click();
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
  await drawer.getByRole("button", { name: "Reply", exact: true }).click();
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
  const filter = page.getByRole("button", { name: "Filter discussions" });
  await filter.focus();
  await page.keyboard.press("Tab");
  await expect(card.getByRole("button", { name: "Expand comment" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(card).toBeFocused();
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
  await card.getByRole("button", { name: "Expand comment" }).click();
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
