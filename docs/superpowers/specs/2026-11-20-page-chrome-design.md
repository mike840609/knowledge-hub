# Editor: page chrome (Notion parity, seventh group)

The 2026-11-20 gap analysis listed what the page around the editor lacks next to
Notion's. Two of them are decided here. Nothing stored in a document changes.

## Decisions

1. **The header counts the words.** The meta line reads `Updated 2 min ago · 120
   words`, from the Markdown as it is being written, so the count follows the
   typing. A word is what a reader reads: link and image addresses, HTML tags,
   fence markers and list numbers are not words, a `[[wikilink]]` counts its
   target, Latin words and numbers count by run, and each Han, kana or hangul
   character counts as one (`src/shared/markdown/word-count.ts`). A page with no
   words says nothing.
2. **Full width is the reader's own arrangement.** A header button (`Full
   width`, a pressed toggle, from the `sm` breakpoint up) lets the reading
   column fill the pane. It is kept in this browser (`kh.document-full-width`,
   local storage), not in the document, and is set as `data-full-width` on the
   document pane by the document page. The column fills the pane with the
   editor's 56px block gutter kept inside it, the article's own reading width
   is lifted, and the outline moves to the right rail at every width (a column
   that fills the pane has no left margin to hang it from). While the
   discussions rail is open the existing layout, which makes room for it, wins,
   and full width waits. No colour, radius or elevation token is added.

## Out of scope, recorded

- Removing the Rename pencil: Notion has none, but here it is the only way to
  reach the title when the document's own `#` heading is its title (there is no
  title field then), and the title-field case is one Tab away. It stays.
- A hover row above the title (Add icon, Add comment): the icon picker is
  already the page icon, and comments open from the selection toolbar and the
  header's comment button.
- Lock page and a font choice: a lock needs a stored state and an
  authorization rule of its own; neither is decided here.

## Verification

- `tests/unit/word-count.test.ts`: Latin, CJK, mixed, links, images, fences,
  wikilinks, HTML and list markers.
- `tests/e2e/zz-page-chrome.spec.ts`: the header's count and its following the
  typing; Full width widening the column at a wide window, surviving a reload
  and turning off.
- `docs/superpowers/verification/2026-11-20-page-chrome/full-width-after.png`
  (a 2200px window, Full width on): the body, title and breadcrumb share one
  left edge, and the outline is in the right rail.
- `make verify`.
