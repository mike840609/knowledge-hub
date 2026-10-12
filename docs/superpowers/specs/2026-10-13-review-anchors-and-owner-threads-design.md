# Review anchors on more of a document, and discussions the owner starts

Amends `2026-10-09-shared-personal-document-inline-review-design.md` (§3, §6)
and `2026-10-12-owner-comments-rail-design.md` ("What the owner may do"). Those
remain canonical for everything this document does not name.

## Intent and agreed product direction

Asked by the user on 2026-10-13, after a review of what a comment can and cannot
be attached to. Four changes, chosen from five proposed:

1. **A callout, a task list or a footnote no longer puts the whole document out
   of reach.** A defect, introduced with reader callouts (#171).
2. **A selection that cannot take a comment says why.** Before, the Comment
   button simply did not appear.
3. **The owner may start a discussion** on their own document, without holding
   one of its links.
4. **A table cell and a fenced code block can be commented on.**

The fifth, asked for the same day and added here as §3a: the opening paragraph
of a callout and the text of a task can be commented on.

## 1. Which block a selection is in

**What was wrong.** The client proved a selection by zipping two lists by
index: the blocks of the Markdown (`projectReviewBlocks`) and the block
elements of the rendered article. Anything the reader draws with a different
number of elements than the Markdown has blocks — a callout's title, a task
item's checkbox paragraph, the footnote section — shifted every later index,
the texts stopped matching, and the proof failed for the entire document.

**What a selection needs to know** is one fact: which Markdown block this
element was drawn from. That fact exists at the moment the block is turned into
an element and nowhere later, so it is recorded there.

- `src/shared/markdown/remark-review-paths.ts` writes each selectable block's
  path in the Markdown tree on its element, as `data-review-path="4.1"`
  (paragraph, heading, table cell, code), and on a list item whose paragraph the
  reader does not draw as a `<p>` (a tight list), as `data-review-para`.
- **It runs before every plugin that adds, removes or moves a node**
  (`markdown-base.tsx`: directly after `remark-gfm`). A path taken after
  `remarkKnownHtml` or the callout transform would not be the path
  `projectReviewBlocks` computes from the stored Markdown.
- The client finds the selection's element by that attribute, looks up the block
  with the same path, and proves the pair by **that block's whole text only**.
  An element the reader invented has no path and is not selectable; it no longer
  affects its neighbours.

The attribute is a number list derived from the document's structure. It carries
nothing the document's reader could not already count, decides no access, and is
not trusted: the server validates every anchor against the stored Markdown as
before (`validateReviewAnchor`).

The proof stays strict. If the element's text is not exactly the block's
canonical text — a wikilink drawn as its title, a footnote reference drawn as a
number — the block is refused rather than guessed at.

## 2. Saying why not

`readReviewSelection` returns either an anchor or one of three reasons, and the
place the Comment button would be shows the sentence instead (`role="status"`,
after a 400 ms pause so that dragging a selection through the article does not
flicker it):

| Reason | Sentence |
|---|---|
| the selection spans two blocks | Select within one paragraph to comment. |
| more than 512 characters | Select 512 characters or fewer to comment. |
| the block cannot be anchored | This passage cannot take a comment. |

Nothing is said when nothing is selected, when the selection is outside the
article, or when the reader may not write at all. A selection that ends at the
very start of the next block — what a triple click produces — is read as the
block it covers, not as spanning two.

## 3. Table cells and code

`blockKind` gains `tableCell` and `code`. `anchor_json` is versioned JSON and
its `schemaVersion` stays 1: the two are additions an older reader of the column
never produced and no stored anchor changes meaning. No migration.

- **Table cell:** a leaf like a paragraph — same inline rules, same collapsed
  whitespace. A header cell counts.
- **Code:** the canonical text is the block's value **as written**, whitespace
  and line breaks included; collapsing would make two different programs the same
  text. Offsets are into that value. Syntax colouring splits the text across
  elements and does not change it. A selection may span lines.

A quote from code is shown in the monospace face with its line breaks kept.

## 3a. A callout's opening paragraph, and a task

Both failed the whole-text proof, for opposite reasons.

- **A callout.** The Markdown paragraph's text is `[!NOTE] Heads up`; the page
  shows `Heads up`. The marker is real text of the block, so offsets keep
  counting it — an anchor's place is a place in the Markdown, and the stored
  format does not change. What changes is that the projection now says how much
  of a block's start is not shown (`hidden`, the marker and its line break as one
  space; `0` everywhere else), worked out by the same function the reader uses to
  take the marker out (`calloutMarker` in `remark-callouts.ts`), so the two cannot
  disagree about what a marker is. The page proves the block by the text after
  `hidden`. **The server refuses an anchor that starts inside it**, and relocation
  does not look there: the reader is never shown the marker, so no one can have
  selected it.
- **A task.** The Markdown parser already takes `[ ]` out of the paragraph's text;
  the page then puts a box and a space before it. A block's text never starts
  with a space (code aside), so the page drops one leading gap when reading any
  non-code block. The proof is still the whole text.

A marker followed by a hard line break leaves a paragraph with a break in it,
which was and stays unselectable.

## 3b. A paragraph with a wikilink, or a hard line break

Added 2026-10-13, asked for after the above. A paragraph holding one `[[link]]`
was wholly out of reach, and in a knowledge base most paragraphs worth
discussing hold one.

- **A wikilink.** The page shows `that page` where the Markdown says
  `[[Other page|that page]]`; the difference is in the middle of the text, so
  no count of hidden characters at one end describes it. What a reader selects
  is the words on the page, so **a block's text is now those words**: the
  projection replaces each wikilink with what is shown for it before reading the
  text, using the reader's own `replaceWikiLinks` and `shownText` (moved to
  `src/modules/knowledge/domain/replace-wiki-links.ts`, beside `findWikiLinks`,
  so the domain does not reach into the components). Which `[[…]]` is a link —
  not in code, not unclosed — is therefore one decision. The page's side needed
  no change: its text already was those words.
  No stored anchor changes meaning: a block with `[[` in it could not be
  anchored before. Whether the link resolves does not change its words; what the
  owner's reader adds for a screen reader beside one that does not is skipped as
  it already was.
  A consequence: renaming an alias, or retargeting a link shown by its target,
  changes the block's text like any other edit, and a quote over it goes
  Outdated.
- **A hard line break** (two spaces or a backslash at the line's end) is one
  space of the block's text, as a soft one is. It was refused outright; the page
  and the projection already agreed on it.

`<br>` written as HTML, a relative `.md` link and a footnote reference are still
refused: the first two for reasons the canonical review spec gives, the third
because the page shows a number the Markdown does not have.

## 4. The owner starts a discussion

`POST /api/documents/:documentId/review-threads`, beside the owner's existing
`GET`. Body: `expectedRevisionId`, `anchor`, `body`, `idempotencyKey`. `201`
with the same projection the owner's query returns.

- **Authorization is the owner scope the other owner routes use**
  (`ownerScope`): a trusted caller who owns the document's PERSONAL Workspace.
  Anyone else gets the same `404` an unknown id gets. The document is taken from
  the path; a `documentId` in the body is ignored.
- Same-origin check, idempotency, stale-revision `409`, anchor validation,
  quotas and the archived-document refusal are the link path's, through one
  shared `create`. `originShareLinkId` is `null`.
- The thread belongs to the document, as every thread does. Every live link
  reads it and its holders may reply.

This adds no caller-less entry: the two that exist (`readShared`,
`queryForLink`) are unchanged, and `createForOwner` requires a caller.

**In the page.** With text selected, the document header shows a "Comment on
selection" control (or the sentence from §2) before the Comments control; the
rail has the same "Add comment" row the shared page has. Starting one opens the
rail. A document with no discussion and no selection still shows nothing.

## 5. Limits that remain

- A paragraph containing a footnote reference, a relative `.md` link, an image
  or raw HTML (`<br>` included), and a footnote definition, still cannot be
  commented on. They now say so (§2).
- One block per comment.
- The document header is pinned only in a wide pane; in a narrow one the owner's
  control scrolls away with it. The rail's "Add comment" row is the other way in.
- ~~A discussion the owner started and left open counts as awaiting the owner.~~
  Fixed the same day: a discussion awaits the owner only where the last comment
  still shown is someone else's (`awaitingOwner` in `review-auto-open.ts`). One
  the owner started or answered waits for a reader, and opens the rail again
  when a reader replies.

## 6. Verification

- `tests/unit/review-selection.test.tsx` — the real `MarkdownRenderer`: every
  kind of block, each anchor validated by the server's validator and resolved
  back to the same range; documents with callouts, task lists and footnotes.
- `tests/unit/review-anchor.test.ts` — projection, validation and relocation of
  cells and code.
- `tests/integration/document-review-service.test.ts` — `createForOwner`: owner
  only, idempotent, stale, archived, visible through a link.
- `tests/e2e/review-anchors-wider.spec.ts` — a reader comments on a paragraph, a
  cell and code in a mixed document; the sentences of §2; the owner starts one
  and a reader answers; the owner route's refusals.
