# Outline Right of the Article Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The document outline sits right of the article on both the workspace reader and the shared page at every width, with discussions between article and outline, so no sidebar toggle or resize moves it across the article.

**Architecture:** Pure CSS placement plus deleting one JSX box. The workspace keeps its existing right-hand `kh-outline-rail` flex sibling and loses the `88rem` left-hand variant; when discussions open, the article narrows to a floor of 688px (640px measure + 2 × 24px column padding) before the column slides. The shared page mirrors its left-hanging rail to the right and widens the rail's anchor box across the discussions while they are open.

**Tech Stack:** Next.js 15, Tailwind (replaced scales — see CLAUDE.md), CSS container queries, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-10-23-outline-right-of-article-design.md`

## Global Constraints

- Order on both pages, left to right: article · discussions (when open) · outline. The outline is never left of the article.
- Article floor: 688px box (`theme("maxWidth.measure")` + `theme("spacing.12")`); paragraphs ≥ 608px when the article carries its 32px mark margin.
- Workspace: outline rail stays with discussions open from a `77rem` pane; start margin `max(0, min((A − 860) / 2, A − 1008))`, *A* = pane − 224px.
- Shared page: outline rail from an `82rem` window; open start margin `max(0, min((100% − 860px) / 2, 100% − 1232px))`; discussions layout `min(1180px, 100% − margin − 224px)`.
- Unchanged: narrow layout, the disclosure, outline content/following, `--review-rail` thresholds (60rem pane / 1200px window).
- No colour, font-size, radius, shadow or duration spelled outside the token layer (frontend design language).
- **Running commands on this machine:** bare `npm`/`npx`/`node` are shadowed by a broken nvm shell function in non-interactive shells. Use `N=$HOME/.nvm/versions/node/v24.6.0/bin; PATH="$N:$PATH" "$N/npm" run test:e2e -- <file>`. Never pipe a test command into `tail`/`head`; print the exit code (`; echo "EXIT=$?"`). A run that reports 0 tests ran is a failure.
- If e2e shows "PROBE-NEXT" console lines or documents stuck on "Loading document", move `.next/cache` aside and rebuild — stale cache, not your change.

---

### Task 1: Workspace — the outline stays right of the article

**Files:**
- Modify: `src/app/globals.css:703-741` (workspace review-column block and the `88rem` outline block)
- Modify: `src/components/knowledge/document-pane.tsx:27-29`
- Test: `tests/e2e/owner-review.spec.ts:139-191` (two tests replaced), `:337-348` (comment), new test after `:191`
- Test: `tests/e2e/reading-loading.spec.ts:47-48`
- Test: `tests/e2e/zz-explorer-collapse.spec.ts:51-84`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `.kh-outline-rail-left` no longer exists anywhere (Task 3's docs and Task 2 must not reference it).

- [ ] **Step 1: Replace the left-outline test with a right-outline one**

In `tests/e2e/owner-review.spec.ts`, replace the whole test `"a pane wide enough for outline, article and discussions keeps all three side by side, the outline on the left"` with:

```ts
test("a pane wide enough for article, discussions and outline keeps all three side by side, the outline on the right", async ({ page, request }) => {
  const doc = await documentWithDiscussion(request);
  // The pane is the window less the navigation and the explorer: 2000px leaves it past 1380px, where opening moves nothing.
  await page.setViewportSize({ width: 2000, height: 900 });
  await page.goto(doc.href);
  const pane = page.getByRole("region", { name: "Document content" });
  expect(await pane.evaluate((element) => element.clientWidth)).toBeGreaterThanOrEqual(1380);
  const rail = page.getByRole("complementary", { name: "Document discussions" });
  const outlineRail = page.getByRole("complementary", { name: "On this page" });
  const article = page.locator("[data-review-document]");
  await expect(rail).toBeVisible();
  await expect(outlineRail).toHaveCount(1);
  await expect(outlineRail).toBeVisible();
  await expect(page.locator(".kh-outline-inline")).toBeHidden();
  // Article, discussions, outline — the discussions level with their passages, beside the article —
  // none over another and all inside the pane, once the column's 120ms slide has settled.
  const order = async () => {
    // Mid-slide a box can be momentarily absent: that is "not yet", for the poll to ask again, not a failure.
    const [paneBox, outlineBox, articleBox, railBox] = [await pane.boundingBox(), await outlineRail.boundingBox(), await article.boundingBox(), await rail.boundingBox()];
    if (!paneBox || !outlineBox || !articleBox || !railBox) return false;
    return railBox.x >= articleBox.x + articleBox.width - 1
      && outlineBox.x >= railBox.x + railBox.width - 1
      && outlineBox.x + outlineBox.width <= paneBox.x + paneBox.width + 1;
  };
  await expect.poll(order).toBe(true);
  expect((await rail.boundingBox())!.width).toBe(320);
  expect(await pane.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  // An outline entry still jumps to its heading with the discussions open.
  await outlineRail.getByRole("link", { name: "Beta" }).click();
  await expect(page.getByRole("heading", { name: "Beta" })).toBeInViewport();
  await expect(rail).toBeVisible();

  // Past 1380px of pane the discussions fit right of the column where it stands: closing moves nothing,
  // and the outline is still right of the article.
  const articleX = async () => Math.round((await article.boundingBox())!.x);
  const open = await articleX();
  await page.getByRole("button", { name: "Collapse discussions" }).click();
  await expect(rail).toBeHidden();
  await expect(outlineRail).toBeVisible();
  await page.waitForTimeout(250);
  expect(await articleX()).toBe(open);
  const [outlineBox, articleBox] = [(await outlineRail.boundingBox())!, (await article.boundingBox())!];
  expect(outlineBox.x).toBeGreaterThanOrEqual(articleBox.x + articleBox.width - 1);
});
```

- [ ] **Step 2: Replace the "below 88rem" test with the explorer-toggle test, and add the narrow-pane test**

Replace the whole test `"below 88rem of pane the outline stays on the right, as before"` with these two tests:

```ts
test("hiding and showing the explorer never moves the outline to the other side of the article", async ({ page, request }) => {
  const doc = await createReviewDocument(request, "## Alpha\n\nA paragraph.\n\n## Beta\n\nAnother.\n");
  // 1728px, a 16-inch laptop's default: hiding the explorer took the pane across the old 88rem flip.
  await page.setViewportSize({ width: 1728, height: 900 });
  await page.goto(doc.href);
  const outlineRail = page.getByRole("complementary", { name: "On this page" });
  const article = page.locator("[data-review-document]");
  const rightOfArticle = async () => {
    const [outlineBox, articleBox] = [await outlineRail.boundingBox(), await article.boundingBox()];
    return !!outlineBox && !!articleBox && outlineBox.x >= articleBox.x + articleBox.width - 1;
  };
  await expect(outlineRail).toBeVisible();
  await expect.poll(rightOfArticle).toBe(true);
  await page.getByRole("button", { name: "Hide documents" }).click();
  await expect(page.getByRole("button", { name: "Show documents" })).toBeVisible();
  await expect(outlineRail).toBeVisible();
  await expect.poll(rightOfArticle).toBe(true);
  await page.getByRole("button", { name: "Show documents" }).click();
  await expect(page.getByRole("button", { name: "Hide documents" })).toBeVisible();
  await expect.poll(rightOfArticle).toBe(true);
});

test("where the pane cannot hold all three, the outline folds above the article and the prose keeps its measure", async ({ page, request }) => {
  const doc = await documentWithDiscussion(request);
  // 1566px less the navigation and the explorer (466px) is a 1100px pane: under 77rem.
  await page.setViewportSize({ width: 1566, height: 900 });
  await page.goto(doc.href);
  const pane = page.getByRole("region", { name: "Document content" });
  expect(await pane.evaluate((element) => element.clientWidth)).toBeLessThan(1232);
  const rail = page.getByRole("complementary", { name: "Document discussions" });
  await expect(rail).toBeVisible();
  await expect(page.getByRole("complementary", { name: "On this page" })).toBeHidden();
  await expect(page.locator(".kh-outline-inline")).toBeVisible();
  // The disclosure is above the article, not beside it on either side.
  const [disclosureBox, articleBox] = [(await page.locator(".kh-outline-inline").boundingBox())!, (await page.locator("[data-review-document]").boundingBox())!];
  expect(disclosureBox.y + disclosureBox.height).toBeLessThanOrEqual(articleBox.y + 1);
  // 640px of measure less the 32px the marks keep.
  const paragraph = page.locator("[data-review-document] p").first();
  await expect.poll(async () => (await paragraph.boundingBox())!.width).toBeGreaterThanOrEqual(608);
  expect(await pane.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
```

- [ ] **Step 3: Update the comment in the "moves nothing under the pointer" test**

In `"opening and closing the owner's discussions moves nothing under the pointer where the pane has room"`, replace the five comment lines above `for (const width of [2400, 1440])` with:

```ts
  // 2400: a pane past 1380px holds article, discussions and outline with the column where it stood. 1440:
  // the pane is under 77rem, so the outline's slot is what the discussions take. Re-centred, the path
  // line's controls leapt 224-272px right and the column slid 48px left. Between 1232px and 1380px of
  // pane the column slides up to 74px (outline-right-of-article spec); the side-by-side test covers the rest.
```

- [ ] **Step 4: Drop the left box from reading-loading's column locator**

In `tests/e2e/reading-loading.spec.ts`, replace lines 47-48:

```ts
    // The first column that holds content; the outline's zero-height box (`kh-outline-rail-left`) shares the class only to share its edge.
    const readingColumn = () => content.locator(".kh-reading-column:not(.kh-outline-rail-left)").first();
```

with:

```ts
    const readingColumn = () => content.locator(".kh-reading-column").first();
```

- [ ] **Step 4b: Turn the explorer-collapse side-by-side test around**

In `tests/e2e/zz-explorer-collapse.spec.ts`, test `"at 1512px, with the primary rail and the explorer collapsed, outline, article and discussions stand side by side"`:

- rename it to `"at 1512px, with the primary rail and the explorer collapsed, article, discussions and outline stand side by side"`;
- change `.toBeGreaterThanOrEqual(1408)` to `.toBeGreaterThanOrEqual(1232)` (77rem: 224 + 688 + 320);
- replace the poll body's `return` line with:

```ts
    return railBox.x >= articleBox.x + articleBox.width - 1 && outlineBox.x >= railBox.x + railBox.width - 1;
```

- [ ] **Step 5: Run the workspace tests to see them fail**

Run: `N=$HOME/.nvm/versions/node/v24.6.0/bin; PATH="$N:$PATH" "$N/npm" run test:e2e -- tests/e2e/owner-review.spec.ts tests/e2e/zz-explorer-collapse.spec.ts; echo "EXIT=$?"`
Expected: FAIL. The side-by-side test fails on `order` (the outline is left), and the explorer test fails after "Hide documents" (pane 1510px ≥ 88rem puts the outline left). The narrow-pane test may already pass, because it describes behaviour this change keeps.

- [ ] **Step 6: Delete the left box in the pane**

In `src/components/knowledge/document-pane.tsx`, delete these three lines:

```tsx
            {/* Where the pane holds outline, article and discussions (88rem), the outline hangs off the
                column's left edge instead, as on a shared page; CSS shows one of the two. */}
            <div className="kh-outline-rail-left kh-reading-column sticky top-8 h-0"><div className="absolute right-full top-0 w-56">{outline}</div></div>
```

- [ ] **Step 7: Rewrite the workspace CSS**

In `src/app/globals.css`, in the rule
`.kh-document-pane:has(.kh-review-document[data-review-inline][data-review-open]) .kh-reading-column { … }`
replace its `margin-inline-start` line with:

```css
  margin-inline-start: max(0px, min(calc((100% - theme("spacing.56") - theme("maxWidth.reading")) / 2), calc(100% - theme("maxWidth.measure") - theme("spacing.12") - 320px)));
```

Then replace everything from the comment `/* A pane that holds outline, article and rail (224 + 860 + 320 = 1404px, 88rem) shows the outline on the` through the closing `}` of `@container kh-document (min-width: 88rem) { … }` with:

```css
/* The outline is always right of the article: article, discussions, outline (outline-right-of-article
   spec). Opening the discussions narrows the article from the right down to its measure plus the
   column's padding (640 + 48 = 688px) before the column moves, so prose never rewraps. Where the pane
   holds outline slot, that article and the discussions (224 + 688 + 320 = 1232px, 77rem) the outline
   stays a rail; below, it folds above the article and the discussions take its slot. Hiding the
   explorer or opening Details changes only how much fits, never which side the outline is on. */
@container kh-document (min-width: 77rem) {
  .kh-document-pane:has(.kh-review-document[data-review-inline][data-review-open]) .kh-outline-rail { display: block; }
  .kh-document-pane:has(.kh-review-document[data-review-inline][data-review-open]) .kh-outline-inline { display: none; }
  .kh-document-pane:has(.kh-review-document[data-review-inline][data-review-open]) .kh-reading-column {
    margin-inline-start: max(0px, min(calc((100% - theme("maxWidth.reading")) / 2), calc(100% - theme("maxWidth.measure") - theme("spacing.12") - 320px)));
    /* The flex area already excludes the outline's slot; the path line keeps the width it had closed. */
    max-width: theme("maxWidth.reading");
  }
}
```

Also update the long comment above `.kh-document-pane .kh-reading-column {` where it says "The outline gives the rail its place and is shown above the article instead, as it is in a narrow pane": append "— below 77rem; from there the outline keeps its rail right of the discussions."

Specificity check, no action needed: `.kh-reading-column:has(> .kh-review-document)` (max-width reading + 320px) outranks the container rule's `.kh-reading-column`, so the column that holds the article stays 1180px wide at most while the path line is 860px.

- [ ] **Step 8: Run the workspace tests to see them pass**

Run: `N=$HOME/.nvm/versions/node/v24.6.0/bin; PATH="$N:$PATH" "$N/npm" run test:e2e -- tests/e2e/owner-review.spec.ts tests/e2e/reading-loading.spec.ts tests/e2e/zz-explorer-collapse.spec.ts tests/e2e/zz-editor-blocks.spec.ts; echo "EXIT=$?"`
Expected: PASS, EXIT=0, test count > 0. `zz-editor-blocks` checks that reader and composer lay out line for line alike, and the composer shares DocumentPane.

- [ ] **Step 9: Commit**

```bash
git add src/app/globals.css src/components/knowledge/document-pane.tsx tests/e2e/owner-review.spec.ts tests/e2e/reading-loading.spec.ts tests/e2e/zz-explorer-collapse.spec.ts
git commit -m "feat(knowledge): the workspace outline stays right of the article at every pane width

Claude-Session: https://claude.ai/code/session_01LebPg2xWe67voX4qtrR94u"
```

---

### Task 2: Shared page — the outline mirrors to the right

**Files:**
- Modify: `src/app/s/[token]/page.tsx:67-69`
- Modify: `src/app/globals.css` (share-page block, from `.kh-share-page .kh-review-entry,` through the `@media (max-width: 87.99rem)` block)
- Test: `tests/e2e/zz-share-outline.spec.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (it touches separate selectors).
- Produces: custom property `--kh-share-start` on `.kh-share-page` while discussions are open inline, used only inside `globals.css`.

- [ ] **Step 1: Rewrite the share-outline tests**

In `tests/e2e/zz-share-outline.spec.ts`:

(a) In the first test, rename it to `"share outline: a rail right of the article on a wide window, jumping to headings"` and replace its two position assertions

```ts
  expect(railBox.x + railBox.width).toBeLessThanOrEqual(text.x);
  expect(railBox.x).toBeGreaterThanOrEqual(0);
```

with:

```ts
  expect(railBox.x).toBeGreaterThanOrEqual(text.x + text.width);
  expect(railBox.x + railBox.width).toBeLessThanOrEqual(1440);
```

(b) In `"share outline: a disclosure on a narrower window, and while comments are open"`, replace the block from `// Between 82rem and 88rem …` to the end of the test with:

```ts
  // Under 82rem the comments rail is inline, and the outline stays the disclosure above the article.
  await page.getByRole("button", { name: /^Open discussions/ }).click();
  await expect(page.getByRole("complementary", { name: "Document discussions" })).toBeVisible();
  await expect(rail(page)).toBeHidden();
  await expect(disclosure(page)).toBeVisible();
```

(c) Replace the whole test `"share outline: from 88rem the outline, the article and the comments stand side by side"` with:

```ts
test("share outline: from 82rem the article, the comments and the outline stand side by side", async ({ page }) => {
  const path = await shareOf(page, LONG);
  // 1312 is 82rem, where the column slides furthest; 1680 is past 1604px, where it does not slide at all.
  for (const width of [1312, 1366, 1440, 1680]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(path);
    const comments = page.getByRole("complementary", { name: "Document discussions" });
    await expect(rail(page)).toBeVisible();
    await page.getByRole("button", { name: /^Open discussions/ }).click();
    await expect(comments).toBeVisible();
    await expect(rail(page)).toBeVisible();
    await expect(disclosure(page)).toBeHidden();
    // Wait for the column's 120ms slide; then article, comments, outline, in that order, all on screen.
    await expect.poll(async () => {
      const [outline, commentsBox, text] = [await rail(page).boundingBox(), await comments.boundingBox(), await page.locator("article[data-review-document] p").first().boundingBox()];
      if (!outline || !commentsBox || !text) return false;
      return commentsBox.x >= text.x + text.width - 1 && outline.x >= commentsBox.x + commentsBox.width - 1 && outline.x + outline.width <= width;
    }).toBe(true);
    // 640px of measure less the 32px the marks keep.
    expect((await page.locator("article[data-review-document] p").first().boundingBox())!.width).toBeGreaterThanOrEqual(608);
  }
});

test("share outline: opening comments on a wide window leaves the article where it was", async ({ page }) => {
  const path = await shareOf(page, LONG);
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(path);
  const articleX = async () => Math.round((await page.locator("article[data-review-document]").boundingBox())!.x);
  const before = await articleX();
  await page.getByRole("button", { name: /^Open discussions/ }).click();
  await expect(page.getByRole("complementary", { name: "Document discussions" })).toBeVisible();
  await page.waitForTimeout(250);
  expect(await articleX()).toBe(before);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `N=$HOME/.nvm/versions/node/v24.6.0/bin; PATH="$N:$PATH" "$N/npm" run test:e2e -- tests/e2e/zz-share-outline.spec.ts; echo "EXIT=$?"`
Expected: FAIL. The first test fails because the rail is left of the text; the side-by-side test fails on order.

- [ ] **Step 3: Mirror the rail in the page**

In `src/app/s/[token]/page.tsx`, change the comment on line 67 to:

```tsx
      {/* Outline: a rail off the column's right edge — off the comments' right edge while they are open — when there is room, else a disclosure above the title (outline-right-of-article spec). */}
```

and in line 69 change `absolute right-full top-0 w-52` to `absolute left-full top-0 w-52`.

- [ ] **Step 4: Rewrite the share-page CSS**

In `src/app/globals.css`, replace the rule

```css
.kh-share-page:has(.kh-review-document[data-review-inline][data-review-open]) :is(.kh-review-entry, .kh-review-document),
.kh-share-page:has(.kh-review-document[data-review-inline][data-review-open]) > footer {
  margin-inline-start: max(0px, min(calc((100% - theme("maxWidth.reading")) / 2), calc(100% - theme("maxWidth.reading") - 320px)));
}
```

with:

```css
/* The column keeps its left edge and the article narrows to its measure plus the column's padding
   (640 + 48 = 688px) before the column slides (outline-right-of-article spec). */
.kh-share-page:has(.kh-review-document[data-review-inline][data-review-open]) {
  --kh-share-start: max(0px, min(calc((100% - theme("maxWidth.reading")) / 2), calc(100% - theme("maxWidth.measure") - theme("spacing.12") - 320px)));
}
.kh-share-page:has(.kh-review-document[data-review-inline][data-review-open]) :is(.kh-review-entry, .kh-review-document),
.kh-share-page:has(.kh-review-document[data-review-inline][data-review-open]) > footer {
  margin-inline-start: var(--kh-share-start);
}
```

Replace the outline comment and rules from `/* The outline hangs off the column's left edge where the centred column leaves room for it (82rem:` through the closing `}` of `@media (max-width: 87.99rem) { … }` with:

```css
/* The outline hangs off the column's right edge where the centred column leaves room for it (82rem:
   a w-52 rail and a 16px edge), else it is a disclosure above the Comments row. While the comments
   are open inline its box spans reading part and comments, so it hangs off the comments' right edge,
   and the comments' layout leaves it that room (224px): article, comments, outline. */
.kh-share-page .kh-share-outline-rail { display: none; }
/* The disclosure is the first thing under the pinned bar, above the title, inside the reading column. */
.kh-share-page .kh-share-outline > .kh-outline-inline { margin-top: theme("spacing.3"); }
.kh-share-page .kh-review-document[data-review-inline][data-review-open] .kh-share-outline-rail {
  width: calc(100% + 320px);
  max-width: none;
  margin-inline: 0;
}
@media (min-width: 82rem) {
  .kh-share-page .kh-share-outline-rail { display: block; }
  .kh-share-page .kh-share-outline > .kh-outline-inline { display: none; }
  .kh-share-page:has(.kh-share-outline-rail):has(.kh-review-document[data-review-inline][data-review-open]) {
    --kh-share-start: max(0px, min(calc((100% - theme("maxWidth.reading")) / 2), calc(100% - theme("maxWidth.measure") - theme("spacing.12") - 320px - theme("spacing.56"))));
  }
  .kh-share-page:has(.kh-share-outline-rail) .kh-review-document[data-review-inline][data-review-open],
  .kh-share-page:has(.kh-share-outline-rail):has(.kh-review-document[data-review-inline][data-review-open]) > footer {
    max-width: min(calc(theme("maxWidth.reading") + 320px), calc(100% - var(--kh-share-start) - theme("spacing.56")));
  }
}
```

Why `:has(.kh-share-outline-rail)`: a document with fewer than two headings renders no rail, so it reserves no room for one.

- [ ] **Step 5: Run the share tests to see them pass**

Run: `N=$HOME/.nvm/versions/node/v24.6.0/bin; PATH="$N:$PATH" "$N/npm" run test:e2e -- tests/e2e/zz-share-outline.spec.ts tests/e2e/shared-review.spec.ts tests/e2e/share-page-header.spec.ts; echo "EXIT=$?"`
Expected: PASS, EXIT=0, test count > 0.

- [ ] **Step 6: Commit**

```bash
git add 'src/app/s/[token]/page.tsx' src/app/globals.css tests/e2e/zz-share-outline.spec.ts
git commit -m "feat(share): the shared page's outline stands right of the article and its comments

Claude-Session: https://claude.ai/code/session_01LebPg2xWe67voX4qtrR94u"
```

---

### Task 3: Contract and canonical documents

**Files:**
- Modify: `docs/superpowers/specs/frontend-design-language.md:1562` (and any other line `grep` finds)
- Modify: `docs/superpowers/specs/2026-10-12-owner-comments-rail-design.md:247` (amendment heading)
- Modify: `docs/superpowers/specs/2026-10-20-share-page-outline-design.md` (§2 and §6 headings)
- Modify: `README.md:291` (canonical table)

**Interfaces:**
- Consumes: the behaviour shipped in Tasks 1-2.
- Produces: nothing code depends on.

- [ ] **Step 1: Find every place that still describes the left outline**

Run: `grep -n "outline" docs/superpowers/specs/frontend-design-language.md | grep -niE "left|88rem|82rem"; echo "EXIT=$?"`
Expected: at least line 1562. Every hit is rewritten in Step 2.

- [ ] **Step 2: Rewrite the design-language paragraph**

In `frontend-design-language.md` line 1562, replace the sentences from "where the document pane is 60rem or wider" through "Below 88rem the outline is on the right and the rail takes its slot." with:

```markdown
where the document pane is 60rem or wider — the outline's own container query — opening Comments puts the rail between the article and the outline: **the outline is always right of the article, on this page and on the shared page** (`2026-10-23-outline-right-of-article-design.md`), so hiding the explorer, collapsing the rail or opening Details never moves it across the article. Opening the rail narrows the article from the right down to 688px (its 640px measure plus the column's padding) before the column moves, so prose never rewraps and Edit, Share, Comments and Details stay under the pointer. Where the pane is 77rem or wider (224 + 688 + 320) the outline keeps its rail beside the open discussions; below that it folds into the disclosure above the article and the rail takes its slot.
```

Rewrite any other hit from Step 1 to say the same: right of the article, never left.

- [ ] **Step 3: Mark the superseded sections**

In `2026-10-12-owner-comments-rail-design.md`, directly under the heading `## Amendment (2026-10-21): the outline stays where the pane holds all three`, insert:

```markdown
> **Superseded (2026-10-23)** by `2026-10-23-outline-right-of-article-design.md`: the outline is always
> right of the article. Changing side at 88rem moved it whenever the explorer was hidden or shown.
```

In `2026-10-20-share-page-outline-design.md`, directly under `## 2. Placement` and under `## 6. Amendment (2026-10-21): the outline stays beside open comments where it fits`, insert:

```markdown
> **Superseded (2026-10-23)** by `2026-10-23-outline-right-of-article-design.md`: the rail hangs off the
> column's right edge, and off the comments' right edge while they are open.
```

- [ ] **Step 4: Add the canonical row**

In `README.md`, after the `| Owner comments rail | … |` row (line 291), add:

```markdown
| Outline placement | [Spec](docs/superpowers/specs/2026-10-23-outline-right-of-article-design.md) | — | The outline is always right of the article, in the workspace and on the shared page; discussions between them. |
```

- [ ] **Step 5: Run the DB-free gate**

Run: `N=$HOME/.nvm/versions/node/v24.6.0/bin; PATH="$N:$PATH" make verify; echo "EXIT=$?"`
Expected: EXIT=0 (unit, typecheck, lint, build).

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/frontend-design-language.md docs/superpowers/specs/2026-10-12-owner-comments-rail-design.md docs/superpowers/specs/2026-10-20-share-page-outline-design.md README.md
git commit -m "docs: the outline is always right of the article in the contract and canonical table

Claude-Session: https://claude.ai/code/session_01LebPg2xWe67voX4qtrR94u"
```

---

### Task 4: Full e2e run

- [ ] **Step 1: Run the whole e2e suite**

Run: `N=$HOME/.nvm/versions/node/v24.6.0/bin; PATH="$N:$PATH" make test-e2e; echo "EXIT=$?"`
Expected: EXIT=0. Any failure that names the outline, `kh-reading-column`, the comments rail or a column's x position is this change's; fix it in the task that owns the file and re-run. Failures elsewhere: re-run once (transient); if one persists, run it on `main` to show whether it predates this branch before touching it.
