# Review anchors in paragraphs with links, images, footnote references and `<br>` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reader can comment on a passage in a paragraph or table cell that holds a link of any URL, an image, a footnote reference, `<br>` or an HTML comment.

**Architecture:** The server's block projection (`projectReviewBlocks`, a pure function of the Markdown) learns four inline kinds and what text each contributes; the page's selection reader learns two more kinds of element that are not text. The proof — the element's text equals the block's text — is unchanged.

**Tech Stack:** TypeScript, mdast (remark), React renderer, Vitest (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-13-review-anchors-and-owner-threads-design.md` §3c

## Global Constraints

- `anchor_json` `schemaVersion` stays 1; no migration.
- Still refused: `linkReference`, HTML other than `<br>` and comments (including `<u> <sub> <sup> <kbd> <mark>`), paragraphs of a footnote definition.
- Which HTML is `<br>` or a comment is decided only by `src/shared/markdown/remark-known-html.ts`.
- What the page leaves out is one selector list in `review-selection.ts`: `.sr-only`, `[aria-hidden="true"]`, `[role="img"]`, `[data-footnote-ref]`.
- Run Vitest as `./node_modules/.bin/vitest` (bare `npm`/`npx` may be shadowed by an nvm shell function), never piped through `| tail` without `set -o pipefail`.

---

### Task 1: The projection reads the four kinds

**Files:**
- Modify: `src/shared/markdown/remark-known-html.ts` (export a comment test)
- Modify: `src/modules/knowledge/domain/review-anchor.ts:13-32`
- Test: `tests/unit/review-anchor.test.ts:18`, `:70`

**Interfaces:**
- Produces: `isCommentHtml(value: string): boolean` from `remark-known-html.ts`; `projectReviewBlocks` gives `selectable: true` for the new blocks with the texts below.

- [ ] **Step 1: Replace the two refusal tests with the new behaviour (failing)**

In `tests/unit/review-anchor.test.ts`, replace line 18 (`it("refuses relative links and images for whole block", …)`) with:

```ts
it("reads a link of any URL as its words, an image and a footnote's number as nothing, <br> as a space",()=>{
 expect(projectReviewBlocks("see [the doc](./file.md) now")[0]).toMatchObject({text:"see the doc now",selectable:true});
 expect(projectReviewBlocks("see [x](/w/a) and [y](javascript:void0) now")[0]).toMatchObject({text:"see x and y now",selectable:true});
 expect(projectReviewBlocks("look ![alt](https://a/img) here")[0]).toMatchObject({text:"look here",selectable:true});
 // The page drops the gap a block opens with (`fromStart`); so does this, or a passage after a leading image could never be proved.
 expect(projectReviewBlocks("[![alt](./a.png)](https://a) after")[0]).toMatchObject({text:"after",selectable:true});
 expect(projectReviewBlocks("<br>two")[0]).toMatchObject({text:"two",selectable:true});
 // Nothing to quote: no passage, and no paragraph button that would send an empty one.
 expect(projectReviewBlocks("![alt](./a.png)")[0]).toMatchObject({text:"",selectable:false});
 expect(projectReviewBlocks("a note[^1] here\n\n[^1]: The note")[0]).toMatchObject({text:"a note here",selectable:true});
 expect(projectReviewBlocks("one<br>two")[0]).toMatchObject({text:"one two",selectable:true});
 expect(projectReviewBlocks("one<br />two")[0]).toMatchObject({text:"one two",selectable:true});
 expect(projectReviewBlocks("one <!-- note --> two")[0]).toMatchObject({text:"one two",selectable:true});
});
it("still refuses a reference link, other HTML and a footnote definition's paragraph",()=>{
 for(const markdown of ["a [ref][a]\n\n[a]: ./file.md","press <kbd>K</kbd>","a <span>x</span>"]) expect(projectReviewBlocks(markdown)[0].selectable).toBe(false);
 // A `[^x]` with no definition is text, on the page and here.
 expect(projectReviewBlocks("a [^missing] b")[0]).toMatchObject({text:"a [^missing] b",selectable:true});
});
```

Replace the test at line 69-71 (`a cell that holds what a paragraph may not …`) with:

```ts
 it("a cell with <br> or an image is read as a paragraph would be",()=>{
  expect(projectReviewBlocks("| a |\n|---|\n| one<br>two |").filter(block=>block.kind==="tableCell").at(-1)).toMatchObject({text:"one two",selectable:true});
  expect(projectReviewBlocks("| a |\n|---|\n| ![x](https://a/img) cap |").filter(block=>block.kind==="tableCell").at(-1)).toMatchObject({text:"cap",selectable:true});
 });
 it("a cell with HTML the reader draws as an element is refused as the paragraph would be",()=>{
  expect(projectReviewBlocks("| a |\n|---|\n| <kbd>K</kbd> |").filter(block=>block.kind==="tableCell").at(-1)!.selectable).toBe(false);
 });
```

- [ ] **Step 2: Run and see them fail**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts tests/unit/review-anchor.test.ts`
Expected: FAIL — `selectable` is `false` for the link/image/footnote/`<br>` cases, and `<br>` text is `"one<br>two"`.

- [ ] **Step 3: Export the comment test**

In `src/shared/markdown/remark-known-html.ts`, after `isLineBreakHtml`:

```ts
/** Whether a piece of HTML is a comment, which the reader does not show. */
export function isCommentHtml(value: string): boolean {
  return COMMENT.test(value.trim());
}
```

- [ ] **Step 4: Teach the projection**

In `src/modules/knowledge/domain/review-anchor.ts`:

```ts
import { htmlAsText, isCommentHtml, isLineBreakHtml } from "@/shared/markdown/remark-known-html";
```

Replace `inlineKinds`, `textOf` and `safeInline` (lines 13-32) with:

```ts
// An image and a footnote reference hold no text the reader shows as theirs (its label, the
// number, are left out on the page too); HTML is read as the reader draws it (§3c).
const inlineKinds = new Set(["text","inlineCode","emphasis","strong","delete","link","linkReference","break","image","footnoteReference","html"]);
```

keep the existing comment block above `textOf`, then:

```ts
function textOf(node:Nodes):string {
  if(node.type==="break") return "\n";
  if(node.type==="html") return htmlAsText(node.value);
  if("value" in node) return typeof node.value==="string"?node.value:"";
  if("children" in node) return node.children.map(n=>textOf(n as Nodes)).join("");
  return "";
}
function safeInline(node:Nodes):boolean {
  if(!inlineKinds.has(node.type)) return false;
  // Reference destinations depend on separate nodes; conservatively refuse.
  if(node.type==="linkReference") return false;
  // `<br>` and comments only: the inline tags the reader draws pair up by rules this does not share.
  if(node.type==="html" && !isLineBreakHtml(node.value) && !isCommentHtml(node.value)) return false;
  return !("children" in node) || node.children.every(n=>safeInline(n as Nodes));
}
```

In `projectReviewBlocks`, replace the two lines computing `text` and `selectable` with:

```ts
     // No block's own text started with a space until an image, `<br>` or footnote number could
     // open it; the page drops that gap (`fromStart` in review-selection.ts), and so does this.
     const text=code?node.value:textOf(node).replace(/\r\n?/g,"\n").replace(/[\t\n\r ]+/g," ").replace(/^ /,"");
     // Container blocks are deliberately unselectable: their nested leaf blocks
     // receive paths separately, preventing overlapping DOM anchor candidates.
     // A leaf with no text (an image alone) has nothing to quote.
     const selectable=code || (leaves.has(node.type) && text!=="" && "children" in node && node.children.every(n=>safeInline(n as Nodes)));
```

(`image` and `footnoteReference` have neither `value` nor `children`, so `textOf` gives them `""` already. No stored anchor moves: before this change no non-code block's text could start with a space, and no leaf could be empty.)

- [ ] **Step 5: Run the file, then all anchor/review unit tests**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts tests/unit/review-anchor.test.ts`
Expected: PASS.
Run: `./node_modules/.bin/vitest run --config vitest.config.ts tests/unit/review`
Expected: the only failures are the refusal cases in `tests/unit/review-selection.test.tsx` that Task 2 turns into accepted cases (they now pass the server but the page still disagrees on images/footnotes). Note which ones fail; anything else failing is a defect of this task.

- [ ] **Step 6: Commit**

```bash
git add src/shared/markdown/remark-known-html.ts src/modules/knowledge/domain/review-anchor.ts tests/unit/review-anchor.test.ts
git commit -m "feat(review): the anchor projection reads links, images, footnote references and <br>"
```

---

### Task 2: The page leaves out an image's label and a footnote's number

**Files:**
- Modify: `src/components/knowledge/review-selection.ts:29`, `:132`
- Test: `tests/unit/review-selection.test.tsx` (accepted cases ~line 92, links harness ~line 171, refused list ~line 194)

**Interfaces:**
- Consumes: Task 1's `projectReviewBlocks`.
- Produces: nothing exported.

- [ ] **Step 1: Prove the footnote attribute exists (the spec's unverified premise)**

Add inside `describe("a passage that can take a comment", …)`:

```tsx
  test("the page marks a footnote's number and an image's label as its own (spec §3c's premise)", () => {
    const root = page("a note[^1] and ![x](https://e.example/a.png) end\n\n[^1]: The note");
    expect(root.querySelector("p [data-footnote-ref]")?.textContent).toBe("1");
    expect(root.querySelector('p [role="img"]')?.textContent).toContain("Image blocked");
  });
```

Run: `./node_modules/.bin/vitest run --config vitest.config.ts tests/unit/review-selection.test.tsx -t "premise"`
Expected: PASS. **If it fails, stop**: the spec names the wrong attribute; report back rather than choosing another selector.

- [ ] **Step 2: Move the cases (failing)**

In the `refused` list, delete these five rows:

```tsx
    ["a paragraph with a link to another document", "See [doc](./other.md) now", "p", "now"],
    ["a paragraph with an image", "Look ![x](https://e.example/a.png) here", "p", "Look"],
    ["a paragraph with a <br>", "one<br>two", "p", "one"],
    ["a paragraph with a footnote's number", "Text here[^1]\n\n[^1]: The note", "p", "Text"],
    ["a table cell with a line break", "| a |\n|---|\n| one<br>two |", "td", "one"],
```

and add to `refused`:

```tsx
    ["a paragraph with a reference link", "See [doc][d] now\n\n[d]: ./other.md", "p", "now"],
```

(`<kbd>` and the footnote definition rows stay.)

Append to the accepted `cases` list:

```tsx
    ["a paragraph with a link to another document, across it", "See [the doc](./other.md) now", "p", "the doc now", "paragraph"],
    ["a paragraph with a blocked image, after it", "Look ![x](https://e.example/a.png) here", "p", "here", "paragraph"],
    ["a paragraph with an image that loads, after it", "Look ![x](./a.png) here", "p", "here", "paragraph"],
    ["a paragraph with a <br>, after it", "one<br>two", "p", "two", "paragraph"],
    ["a paragraph with a comment in it", "one <!-- quiet --> two", "p", "two", "paragraph"],
    ["a table cell with a line break", "| a |\n|---|\n| one<br>two |", "td", "two", "tableCell"],
    ["a paragraph with a footnote's number, before it", "Text here[^1] after\n\n[^1]: The note", "p", "Text here", "paragraph"],
```

After the "a selection across a hard line break …" test add:

```tsx
  test.each([
    ["a footnote's number", "Text here[^1] after\n\n[^1]: The note", "here", "after", "here after", 5],
    ["a blocked image", "Look ![x](https://e.example/a.png) here", "Look", "here", "Look here", 0],
    ["a <br>", "one<br>two", "one", "two", "one two", 0],
  ])("a selection over %s leaves it out of the quote", (_name, markdown, from, to, exact, startUtf16) => {
    const root = page(markdown);
    const paragraph = root.querySelector("p")!;
    const anchor = selectedReviewAnchor(root, markdown, select(span(paragraph, from).from, span(paragraph, to).to))!;
    expect(anchor).toMatchObject({ exact, startUtf16 });
    expect(validateReviewAnchor(markdown, anchor)).toEqual(anchor);
    expect(reviewAnchorRange(root, markdown, anchor)).not.toBeNull();
  });
```

After the wikilink-in-owner's-reader `test.each` add the same check for a relative link:

```tsx
  test.each([
    ["one it can follow", { status: "RESOLVED" as const, basePath: "/w/w1/knowledge/s1/d1", title: "Other page", ambiguousWith: 0 }],
    ["one that leads nowhere", { status: "UNRESOLVED" as const }],
    ["none given, as on a shared page", undefined],
  ])("a link to another document, %s, is the same text", (_name, resolution) => {
    const markdown = "See [the doc](./other.md) now";
    const links = resolution && { [linkLookupKey("PATH", parseDocumentHref("./other.md")!.target)]: resolution };
    document.body.innerHTML = `<article>${renderToStaticMarkup(<MarkdownRenderer markdown={markdown} links={links} />)}</article>`;
    const root = document.querySelector<HTMLElement>("article")!;
    const paragraph = root.querySelector("p")!;
    const anchor = selectedReviewAnchor(root, markdown, select(span(paragraph, "doc").from, span(paragraph, "now").to))!;
    expect(anchor).toMatchObject({ exact: "doc now", startUtf16: 8 });
    expect(validateReviewAnchor(markdown, anchor)).toEqual(anchor);
    expect(reviewAnchorRange(root, markdown, anchor)).not.toBeNull();
  });
```

and add the import `import { parseDocumentHref } from "@/modules/knowledge/domain/document-links";`. If `links={undefined}` is a type error, render without the prop in that case.

- [ ] **Step 3: Run and see which fail**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts tests/unit/review-selection.test.tsx`
Expected: FAIL for the image and footnote cases (the page's text has the label / the `1`); the link, `<br>`, comment and cell cases may already pass after Task 1 — that is the spec's claim that the page already agreed.

- [ ] **Step 4: One list of what is not text**

In `src/components/knowledge/review-selection.ts`, above `readableText`:

```ts
/** What the page draws that is no part of a block's text: announcements, icons, an image's label, a footnote's number (spec §3c). */
const NOT_TEXT = '.sr-only,[aria-hidden="true"],[role="img"],[data-footnote-ref]';
```

Line 29: `copy.querySelectorAll(NOT_TEXT).forEach(extra => extra.remove());`
Line 132: `const extra = node.parentElement?.closest(NOT_TEXT);`
Update `readableText`'s doc comment to `/** Match the renderer's visible Markdown text: what is \`NOT_TEXT\` is left out. */`.

- [ ] **Step 5: Run selection, anchor and the whole review unit set**

Run: `./node_modules/.bin/vitest run --config vitest.config.ts tests/unit/review-selection.test.tsx tests/unit/review-anchor.test.ts tests/unit/review-block-comment.test.tsx tests/unit/review-block-anchor-editor.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/knowledge/review-selection.ts tests/unit/review-selection.test.tsx
git commit -m "feat(review): a passage beside an image, a footnote's number, a document link or <br> takes a comment"
```

---

### Task 3: A shared page's reader comments across them, and it holds after reload

**Files:**
- Test: `tests/e2e/review-anchors-wider.spec.ts` (append a test)

**Interfaces:**
- Consumes: `selectText`, `comment` (same file), `createReviewDocument`, `openReviewDiscussions` (`./fixtures/document-review`), `phase3Origin`.

- [ ] **Step 1: Write the test**

Append:

```ts
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
```

`selectText` finds positions by `textContent.indexOf`, which includes the footnote's `1` and the image's label; selecting from the start of one word to the end of another stays correct because neither word is inside them. If `"Before after the end"` is not what the browser posts (e.g. the `<br>` gives no space because Chromium serialises differently), compare with the unit case in Task 2 — the unit case and the server are the authority; fix the expectation, not the code, only if the server's `validateReviewAnchor` accepted it.

- [ ] **Step 2: Run it**

Run: `make test-e2e` is the full suite; for this file only, follow `make help` for the single-spec target, or: `./node_modules/.bin/playwright test tests/e2e/review-anchors-wider.spec.ts` after `make db-up` if the e2e harness allows it (check `Makefile` target `test-e2e` for the env it sets and reuse it).
Expected: PASS. If documents stay on "Loading document" with `PROBE-NEXT` console lines, move `.next/cache` aside (stale build cache), not a defect of this change.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/review-anchors-wider.spec.ts
git commit -m "test(review): comment across a document link, a footnote's number, <br> and an image on a shared page"
```

---

### Task 4: Verify the gate

- [ ] **Step 1:** `make verify` — Expected: unit + typecheck + lint + build all pass.
- [ ] **Step 2:** `make test-integration` (needs `make db-up`) — Expected: PASS; nothing here touches the database, so a failure is pre-existing or environmental — report it, do not "fix" around it.
- [ ] **Step 3:** Amend §3c with the two rules Task 1 adds (a leading gap is dropped, as the page drops it; a leaf with no text is not selectable) and commit with the code.
