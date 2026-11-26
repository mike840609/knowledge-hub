# Editor page polish

A design review of a writer's own note (`/w/:ws/knowledge/:sourceId/:documentId`, HUB_MANAGED) found
four things. They share one page and one file set, so they share one spec.

## Decisions

### 1. The stand-in and the editor lay a note out alike (P1)

`EditableDocument` shows the reader's own render (the stand-in) until `rendered-editor` has loaded,
then swaps the editor in. Both wear `MARKDOWN_PROSE`, but the stand-in is the reader's React tree
(GFM task lists, `MarkdownAnchor`) and the editor is ProseMirror, and four things differed:

- **To-do items.** The reader drew a bullet (the `ul`'s `list-disc`) and a native checkbox, indented as
  text; the editor draws a box only, with no bullet. A to-do is now one thing in both: no bullet, the
  box hung in the list's gutter where a bullet or a number would be, so a to-do's text starts where a
  bullet's does, in a list of either kind. The reader's checkbox is not dimmed (it is not a control
  that is unavailable, only one a reader cannot press), and the editor's box moves out of the item's
  padding into the gutter. This changes what every reader page shows, which consistency requires: the
  stand-in is the reader component, and the reader's bullet-and-box was the defect.
- **Wikilinks.** The editor's node view renders through `MarkdownAnchor` with the page's resolutions,
  as the stand-in does, but `.kh-editor a` (blue, underlined, medium) also matched the "create it"
  link inside it and won. It now yields to `[data-unresolved-link]`, so the link is grey and dashed
  in both.
- **Quotes** and spacing: measured and found equal (same `MARKDOWN_PROSE`); the test keeps them so.
- **The meta line.** Under the title the line read "Click anywhere in the text to edit." and, after
  the swap, "87 words". It now carries the word count from the first render, and the first-visit hint
  now follows the count and is drawn from `sm` up only (both would wrap a phone-width header), so the
  line's facts and height are the same before and after, and the hint going moves nothing.
- **Starting early.** The module import already starts on mount; it is kept there and not delayed to
  first interaction.

### 2. No default page icon in edit mode (P3)

A page with no icon shows none, in the editor as in the reader. The "Add icon" affordance (icon and
words) is revealed on pointing at the header, on focus anywhere in it, and permanently where nothing
can point (`@media (hover: none)`), so it stays reachable by keyboard (Tab reaches the invisible
button, which shows itself on focus). The row keeps a fixed 32px height so that revealing it moves
nothing. This supersedes the "hover row above the title" entry of `2026-11-20-page-chrome-design.md`
out-of-scope list for the icon only. A page that has an icon is unchanged (the glyph, "Change page
icon").

### 3. One outline rule (P3)

The outline lists the headings *written in the Markdown* and nothing else, on every surface that
shows one. A title that lives in the title field (the Markdown has no opening `#`) is the page's name,
not a heading in it, and is not listed; a title that is the opening `#` is a heading of the Markdown
and is listed first. Both pages already computed the outline with the same function from the same
Markdown, and the e2e probe (an opening `#` and a title-field note, each opened as the writer and as
`?revision=1`) found identical lists, so the mismatch in the review was not reproduced in code. The
rule is recorded in the contract and pinned by that probe, and the editor's list is computed from the
same function as the reader's, so a future divergence fails a test.

### 4. H2 and H3 (P3)

The editor and the reader already share `MARKDOWN_PROSE`, whose headings are `display` 24 /
`heading` 20 / `subheading` 17 / `reading` 15, as the contract says: there is no mapping bug. The two
levels read as one because both were semibold with 24px and 20px above. Within the existing tokens:
H2 keeps 24px above it (`mt-6`, the top of the margin ladder) and H3 takes 16px (`mt-4`, was 20) and is `font-medium`, so a section starts with air and a
sub-section is lighter. No token is added. It applies to the reader too, since the two are one class
by contract.

## Amendment (2026-11-25, review)

Two more causes of the handoff shift were found by measuring each block before and after:

- A line ending in a wikilink was 6px taller in the editor: ProseMirror draws a
  separator `<img>` after a trailing inline node, and in the line box it adds height.
  The separator is taken out of the flow (`position: absolute`); it still marks the
  caret's place.
- The editor writes an empty paragraph as `<br />`. The reader drew that, standing
  as a block, as a bare line break (19px), the editor as a paragraph (28px plus its
  margin). The reader now reads a `<br>` that stands alone at the top level, in a
  quote or in a list item as an empty paragraph (`remark-known-html.ts`); a `<br>`
  inside a line or a table cell is still a line break. Nothing is passed through.

## Out of scope

- A new type token or weight token; a title row in the outline for title-field documents; moving the
  icon into the title row; the stand-in becoming ProseMirror (the reader must stay React, with no HTML
  passed through).
- Draft pages (the composer at `/knowledge/new`) are not changed beyond what they share.

## Verification

- `tests/e2e/zz-editor-handoff-shift.spec.ts`: a note with a wikilink, a bullet/to-do list, a quote
  and a table is opened with the lazily loaded chunks delayed; every frame's block rectangles and
  Chromium's `layout-shift` entries are recorded, and the first editable frame is compared with the
  last stand-in frame: each block moves at most 1px, the meta line keeps its height, to-do text and
  link colour agree.
- `tests/e2e/page-icon-picker.spec.ts`: no icon at rest, the trigger shown on hover and focus, and
  the picker as before.
- `tests/unit/markdown-prose.test.ts`: H2 and H3 differ in weight and spacing; the to-do's native box
  hangs in the gutter. `tests/unit/native-controls.test.ts`: one to-do geometry and the unresolved-link
  exception in `globals.css`. `tests/unit/document-header.test.tsx`: the count with the hint.
- `tests/e2e/zz-editor-handoff-shift.spec.ts` also pins the outline rule on both pages.
- `npm run -s typecheck`, `npm run -s lint`, `npm run -s test:unit`.

## Review fixes

- **The title slot follows its node.** The title-meta widget's `destroy` cleared the slot unconditionally; on a
  whole-document replace that changes the title ProseMirror builds the new widget before destroying the old, so the
  last call (null) won and the meta line vanished. `destroy` now clears the slot only if it is still the destroyed
  node. `tests/unit/editor-title-meta.test.ts`.
- The meta line is drawn once and the outline disclosure is reset inside prose; see the reader chrome spec's
  "Review fixes".

## Review round 3

Decision 4 first gave H2 `mt-8`, which is not on the replaced margin ladder (0–6) and compiled to nothing, so every H2
lost its room above it. H2 keeps `mt-6` and H3 moves to `mt-4`, which keeps the intent within the existing tokens.
`tests/unit/markdown-prose.test.ts` now checks every margin and padding step in `MARKDOWN_PROSE` against the scales.
