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
because the page shows a number the Markdown does not have. *(Superseded by §3c.)*

## 3c. A paragraph with a link, an image, a footnote reference or `<br>`

Added 2026-10-23. The same rule as §3b — a block's text is the words on the
page — applied to the four inline kinds still refused. Each is projected by a
decision the page already makes, so the two cannot disagree.

| In the Markdown | Its text | Why the page agrees |
|---|---|---|
| a link, whatever its URL (relative `.md` included) | its link text | Every link the renderer draws — external, document, unresolved, plain `<span>` where there is no `links` — draws its children and nothing else visible. The external icon is `aria-hidden` and the announcements are `.sr-only`, which the selection reader already leaves out. |
| an image | nothing | An `<img>` holds no text. The label drawn where it is blocked or fails (`role="img"`, *Image blocked: …*) is left out by the selection reader. Whether an image loads is decided at run time, so its label can never be part of a block's text. |
| a footnote reference | nothing | The number is the page's (`[data-footnote-ref]`), not the Markdown's, and is left out by the selection reader. A `[^x]` with no definition is not a reference; it is text, and is text on the page. |
| HTML that is `<br>` or a comment | `htmlAsText`: one space, or nothing | `remark-known-html` makes `<br>` a line break and drops a comment, using the same patterns. |

The canonical review spec's "renderer-dependent relative document links" (§6.1)
are not renderer-dependent in their text: resolving one changes the element
around the words, never the words. That disable is lifted.

What the selection reader leaves out is one list in `review-selection.ts`,
used both to read a block's text and to map a selection to offsets:
`.sr-only`, `[aria-hidden="true"]`, `[role="img"]`, `[data-footnote-ref]`, and
the editor's two below. `[role="img"]` cannot come from a document — the reader
passes no HTML through — only from the renderer's own label for an image.

**In the owner's rendered editor**, a third view, the same blocks are drawn
differently: a footnote reference as its label
(`sup[data-type="footnote_reference"]`), inline HTML as its raw source
(`span[data-type="html"]`, the source in `data-value`), and a non-final `<br>`
in a table cell as a hard break (`br[data-type="hardbreak"]`, made by
`remarkCellBreaks`). Its stamper reads the first as nothing, the second as
`htmlAsText` of its source, and the hard break as the one space the projection
gives it, so every block keeps its path (a stamp says which block an element is,
not that it may take a comment). The selection list also leaves out the
reference and a comment's span (`data-value` opening `<!--` and closing `-->`),
so a paragraph beside either takes a comment in the editor too.

The editor does not draw a `<br>` as the space the page does: in a paragraph it
stays raw HTML source, and in a cell it is a text-less hard break (raw source
too when it ends the cell). A block holding one therefore fails the editor's
proof and is refused ("This passage cannot take a comment"), except a cell whose
`<br>` only opens it: that gap is dropped on both sides, so the cell is accepted.
The shared page and the reader accept every block holding one. That is the
accepted, fail-closed limit: the editor reads no space in its place.

A consequence: a quote over a footnote reference or an image does not show the
number or the picture; the words around them are the quote.

Two rules follow from the table.

- **A non-code block's text drops one leading space.** A paragraph that opens
  with an image, a footnote reference or `<br>`, then text, projects a space
  first, and the page drops the gap a block opens with (`fromStart` in
  `review-selection.ts`); the projection drops it too. Without this, a passage
  after a leading image or `<br>` could never be proved. Code keeps its text as
  written. Compatibility: any non-code block whose text began with whitespace
  (a hard break, an encoded space or tab, inline code opening with a space) used
  to project with that leading space, while the page always stripped it — its
  text differed — so no page-made anchor exists there. Such an anchor's offsets
  are off by one, so on the same revision it is Outdated; on a later revision
  the relocator may find it again by its quote and context (Moved), or, near the
  block's start, report Outdated. It is never shown at a place whose words
  differ from its quote.
- **A leaf with no text is not selectable.** An image alone in its paragraph
  has nothing to quote, and no paragraph button is offered that would send an
  empty quote.

No stored anchor changes meaning: every block these open was unselectable
before, except any non-code block whose text began with whitespace (a hard
break, an encoded space or tab, inline code opening with a space; above).
`schemaVersion` stays 1; no migration.

Still refused, for a later change: a reference-style link (`[text][ref]`, whose
words depend on a separate definition) and any other HTML (the five inline tags
`remark-html-subset` draws pair up by rules the projection does not share yet).
The paragraphs of a footnote definition are selectable in the projection but
refused by the page, which draws them at the foot with a back link their text
does not have. The editor draws no back link, so there they take a comment, as
they did before §3c.

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
*Amended 2026-10-15:* the Comment control, and the sentence of §2 in its place,
are no longer in the header, on either page: they float beside the selection,
above its first line (below it where that line is at the article's top), in the
reading box. Choosing it opens the rail with the comment box level with the
passage (`2026-10-12-owner-comments-rail-design.md`, 2026-10-15). The rail's
"Add comment" row stays, as the way in from the keyboard.

## 5. Limits that remain

- A paragraph containing a reference-style link or HTML other than `<br>` and
  comments, and a footnote definition on the shared page, still cannot be
  commented on. They say so (§2). Links, images, footnote references and `<br>`
  can since §3c; a `<br>` inside a block's text is not commentable in the
  owner's editor, and a footnote definition's paragraph is (see §3c).
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
