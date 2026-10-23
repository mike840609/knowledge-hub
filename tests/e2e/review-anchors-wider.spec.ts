import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument, openReviewDiscussions } from "./fixtures/document-review";

// docs/superpowers/specs/2026-10-13-review-anchors-and-owner-threads-design.md

/** Selects from `from` in the first element `fromSelector` finds to the end of `to` in `toSelector`'s, across the text nodes they are split over. */
async function selectText(page: Page, fromSelector: string, from: string, toSelector = fromSelector, to = from) {
  await page.locator("[data-review-document]").evaluate((root, [fromSelector, from, toSelector, to]) => {
    const point = (selector: string, text: string, end: boolean) => {
      const element = Array.from(root.querySelectorAll(selector)).find(candidate => candidate.textContent!.includes(text));
      if (!element) throw new Error(`"${text}" is not in ${selector}`);
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let offset = element.textContent!.indexOf(text) + (end ? text.length : 0);
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (end ? offset <= node.length : offset < node.length) return { node, offset };
        offset -= node.length;
      }
      throw new Error("offset outside the element");
    };
    const start = point(fromSelector, from, false), finish = point(toSelector, to, true);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(finish.node, finish.offset);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }, [fromSelector, from, toSelector, to]);
}

async function comment(page: Page, body: string) {
  await page.getByRole("button", { name: "Comment on selection" }).filter({ visible: true }).click();
  await page.getByRole("textbox", { name: "Add comment" }).fill(body);
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await expect(page.locator("[data-review-thread]").filter({ visible: true }).filter({ hasText: body })).toBeVisible();
}

const MIXED = [
  "> [!NOTE]", "> Heads up", "",
  "- [ ] a task", "",
  "Text with a note[^1].", "",
  "Plain passage to review.", "",
  "| Name | Role |", "|---|---|", "| Ada | Owner here |", "",
  "```js", "const total = 1;", "const next = total + 1;", "```", "",
  "See [[Another page|that page]] for more,  ", "on its second line.", "",
  "[^1]: The note",
].join("\n");

test("a reader comments on a paragraph, a table cell, code, a callout and a task, in a document that also has a footnote", async ({ page, request }) => {
  const doc = await createReviewDocument(request, MIXED);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await openReviewDiscussions(page);

  // What the reader draws differently from the Markdown used to put every paragraph out of reach.
  await selectText(page, "p", "passage");
  await comment(page, "On the paragraph");

  const posted = page.waitForRequest(sent => sent.url().endsWith("/api/share-review/threads") && sent.method() === "POST");
  await selectText(page, "td", "Owner");
  await comment(page, "On the cell");
  expect((await posted).postDataJSON().anchor).toMatchObject({ blockKind: "tableCell", exact: "Owner", suffix: " here" });

  // Across two lines of code, and across the tokens it is coloured in.
  const code = page.waitForRequest(sent => sent.url().endsWith("/api/share-review/threads") && sent.method() === "POST");
  await selectText(page, "pre code", "total = 1;", "pre code", "const next");
  await comment(page, "On the code");
  expect((await code).postDataJSON().anchor).toMatchObject({ blockKind: "code", exact: "total = 1;\nconst next" });

  // A callout's opening, whose Markdown starts with a marker the page does not show.
  const callout = page.waitForRequest(sent => sent.url().endsWith("/api/share-review/threads") && sent.method() === "POST");
  await selectText(page, "[data-callout] p", "Heads");
  await comment(page, "On the callout");
  expect((await callout).postDataJSON().anchor).toMatchObject({ blockKind: "paragraph", exact: "Heads", prefix: "[!NOTE] ", startUtf16: 8 });

  // A task, which the page opens with a box.
  const task = page.waitForRequest(sent => sent.url().endsWith("/api/share-review/threads") && sent.method() === "POST");
  await selectText(page, "li", "a task");
  await comment(page, "On the task");
  expect((await task).postDataJSON().anchor).toMatchObject({ exact: "a task", startUtf16: 0 });

  // Across a wikilink, shown by its alias, and a hard line break: the words on the page are the passage.
  const linked = page.waitForRequest(sent => sent.url().endsWith("/api/share-review/threads") && sent.method() === "POST");
  await selectText(page, "p", "that page", "p", "on its");
  await comment(page, "On the link");
  expect((await linked).postDataJSON().anchor).toMatchObject({ exact: "that page for more, on its", startUtf16: 4 });

  // Each has its mark beside the article, and is found again from its card — after a reload too.
  await expect(page.locator("[data-review-marker]")).toHaveCount(6);
  await page.reload();
  await openReviewDiscussions(page);
  await expect(page.locator("[data-review-marker]")).toHaveCount(6);
  const quote = (text: string) => page.locator("[data-review-thread]").filter({ visible: true }).filter({ hasText: text }).locator("blockquote button");
  await quote("On the code").click();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("total = 1;\nconst next");
  await quote("On the cell").click();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("Owner");
  await quote("On the callout").click();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("Heads");
  await quote("On the task").click();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("a task");
  await quote("On the link").click();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().replace(/\s+/g, " "))).toBe("that page for more, on its");
});

test("a selection that cannot take a comment says why, where the button would have been", async ({ page, request }) => {
  const doc = await createReviewDocument(request, "Press <kbd>Ctrl</kbd> here.\n\nFirst plain passage.\n\nSecond plain passage.");
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await expect(page.locator(".kh-review-document")).toHaveAttribute("data-review-ready", "");
  // Beside the selection, not in the page's bar.
  const entry = page.locator(".kh-selection-bubble");
  const button = entry.getByRole("button", { name: "Comment on selection" });

  await selectText(page, "p", "here");
  await expect(entry.getByRole("status")).toHaveText("This passage cannot take a comment.");
  await expect(button).toHaveCount(0);

  await selectText(page, "p", "First", "p", "Second");
  await expect(entry.getByRole("status")).toHaveText("Select within one paragraph to comment.");
  await expect(button).toHaveCount(0);

  // One that can: the button, and nothing said.
  await selectText(page, "p", "First plain");
  await expect(button).toBeVisible();
  await expect(entry.getByRole("status")).toHaveCount(0);

  // Nothing selected: nothing said.
  await page.evaluate(() => window.getSelection()!.removeAllRanges());
  await expect(entry.getByRole("status")).toHaveCount(0);
});

test("the owner starts a discussion on their own document, and a reader of its link answers it", async ({ page, request }) => {
  const doc = await createReviewDocument(request, "The owner's own passage here.\n\nPress <kbd>Ctrl</kbd> too.");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(doc.href);
  await expect(page.getByRole("textbox", { name: "Content", exact: true })).toBeVisible();
  await expect(page.locator(".kh-review-document")).toHaveAttribute("data-review-ready", "");
  // A document nobody has said anything about offers nothing until something is selected.
  await expect(page.getByRole("button", { name: /^(Open|Hide) discussions/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Comment on selection" })).toHaveCount(0);

  // What cannot take a comment says so beside the selection, where the control would be.
  await selectText(page, "p", "too");
  await expect(page.getByRole("status").filter({ hasText: "This passage cannot take a comment." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Comment on selection" })).toHaveCount(0);

  await selectText(page, "p", "own passage");
  const posted = page.waitForResponse(response => response.url().endsWith(`/api/documents/${doc.documentId}/review-threads`) && response.request().method() === "POST");
  await comment(page, "A note to my readers");
  expect((await posted).status()).toBe(201);
  // The discussions are open on it, and the header has their control now.
  await expect(page.getByRole("button", { name: /^Hide discussions, 1 comments, 1 open/ })).toBeVisible();
  await expect(page.locator("[data-review-marker]")).toHaveCount(1);

  // What the owner said themselves does not await them: on coming back the rail is shut.
  await page.reload();
  await expect(page.getByRole("button", { name: /^Open discussions, 1 comments, 1 open/ })).toBeVisible();

  // It is the document's, not a link's: every link reads it, by the owner's name, and may answer.
  await page.goto(`${phase3Origin("viewer")}${doc.links[1].path}`);
  await openReviewDiscussions(page);
  const thread = page.locator("[data-review-thread]").filter({ visible: true });
  await expect(thread).toContainText("A note to my readers");
  await expect(thread).toContainText("Phase3 reviewOwner");
  await thread.getByRole("button", { name: "Reply", exact: true }).click();
  await page.getByRole("textbox", { name: "Reply", exact: true }).fill("Read, thanks");
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(thread).toContainText("Read, thanks");

  // Now a reader has answered, and it does: the rail is open when the owner comes back.
  await page.goto(doc.href);
  await expect(page.getByRole("textbox", { name: "Content", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Hide discussions, 1 comments, 1 open/ })).toBeVisible();
});

test("only the owner starts one that way: not another person, not another site, not on an archived document", async ({ request }) => {
  const doc = await createReviewDocument(request, "Review this passage.");
  const owner = phase3Origin("reviewOwner"), viewer = phase3Origin("viewer");
  const data = () => ({ expectedRevisionId: doc.revisionId, idempotencyKey: crypto.randomUUID(), body: "Started by the owner",
    anchor: { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 0, endUtf16: 6, exact: "Review", prefix: "", suffix: " this passage." } });
  const path = `/api/documents/${doc.documentId}/review-threads`;
  // Knowing the document's id is not owning it.
  expect((await request.post(`${viewer}${path}`, { headers: { Origin: viewer }, data: data() })).status()).toBe(404);
  // A page elsewhere cannot have the owner's browser do it.
  expect((await request.post(`${owner}${path}`, { headers: { Origin: "https://elsewhere.example" }, data: data() })).status()).toBe(403);
  expect((await request.post(`${owner}${path}`, { data: data() })).status()).toBe(403);
  // The body cannot name another document than the path's.
  const other = await createReviewDocument(request, "Review this passage.");
  const created = await request.post(`${owner}${path}`, { headers: { Origin: owner }, data: { ...data(), documentId: other.documentId } });
  expect(created.status()).toBe(201);
  expect((await (await request.get(`${owner}/api/documents/${other.documentId}/review-threads`)).json()).threads).toEqual([]);
  expect((await (await request.get(`${owner}${path}`)).json()).threads).toHaveLength(1);

  expect((await request.post(`${owner}/api/documents/${doc.documentId}/archive`, { headers: { Origin: owner } })).ok()).toBe(true);
  expect((await request.post(`${owner}${path}`, { headers: { Origin: owner }, data: data() })).status()).toBe(409);
});

// docs/superpowers/specs/2026-10-20-reader-code-block-label-collapse-design.md §2
test("a comment on a line a long code block folds away opens the block, so its mark and its jump land on the line", async ({ page, request }) => {
  const long = Array.from({ length: 45 }, (_, i) => `line ${String(i + 1).padStart(2, "0")} = value;`).join("\n");
  const doc = await createReviewDocument(request, ["Before.", "", "```js", long, "```", "", "After the code."].join("\n"));
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await openReviewDiscussions(page);
  // Line 40 is past the fold: scrolled to inside the held block, selected there, commented on.
  await page.locator("[data-code-block]").getByText("line 40").scrollIntoViewIfNeeded();
  await selectText(page, "pre code", "line 40");
  await comment(page, "On line forty");
  await expect(page.getByRole("button", { name: "Show fewer lines" })).toBeVisible();

  // Opened again, the block a comment is on is whole, and the mark is beside the line, not below the block.
  await page.reload();
  await openReviewDiscussions(page);
  await expect(page.getByRole("button", { name: "Show fewer lines" })).toBeVisible();
  await expect(page.locator("[data-review-marker]")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => {
    const line = Array.from(document.querySelectorAll("pre code span")).find(span => span.textContent === "40")!.getBoundingClientRect();
    const marker = document.querySelector("[data-review-marker]")!.getBoundingClientRect();
    return Math.abs(marker.top - line.top) < 12;
  })).toBe(true);

  await page.locator("[data-review-thread]").filter({ visible: true }).filter({ hasText: "On line forty" }).locator("blockquote button").click();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("line 40");
  await expect(page.locator("pre code").getByText("line 40")).toBeInViewport();
});

const INLINES = [
  "Read [the guide](./guide.md) and a note[^1] here.", "",
  "Before<br>after ![chart](./chart.png) the end.", "",
  "[^1]: The note",
].join("\n");

test("a reader comments across a document link, a footnote's number, a <br> and an image, and the passages hold after a reload (§3c)", async ({ page, request }) => {
  const doc = await createReviewDocument(request, INLINES);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await openReviewDiscussions(page);

  const first = page.waitForRequest(sent => sent.url().endsWith("/api/share-review/threads") && sent.method() === "POST");
  await selectText(page, "p", "guide", "p", "here");
  await comment(page, "Across the link and the note");
  expect((await first).postDataJSON().anchor).toMatchObject({ blockKind: "paragraph", exact: "guide and a note here" });

  const second = page.waitForRequest(sent => sent.url().endsWith("/api/share-review/threads") && sent.method() === "POST");
  await selectText(page, "p", "Before", "p", "the end");
  await comment(page, "Across the break and the image");
  expect((await second).postDataJSON().anchor).toMatchObject({ blockKind: "paragraph", exact: "Before after the end" });

  await page.reload();
  await openReviewDiscussions(page);
  for (const body of ["Across the link and the note", "Across the break and the image"]) {
    const card = page.locator("[data-review-thread]").filter({ visible: true }).filter({ hasText: body });
    await expect(card).toBeVisible();
    await expect(card).not.toContainText("Outdated selection");
  }
});
