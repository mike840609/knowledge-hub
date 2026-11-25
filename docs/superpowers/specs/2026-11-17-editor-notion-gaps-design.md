# Editor: the remaining Notion gaps

The 2026-11-15 pass closed twenty-two places where the rendered editor answered
differently from Notion. A second audit on 2026-11-17 drove the editor the way a
Notion writer would and found seven that pass did not cover. This spec decides
each, amends `2026-11-15-editor-notion-parity-design.md` and the
frontend-design-language contract, and records what stays out and why. Nothing
here changes what is stored: every change still writes Markdown through the
rendered editor and is held to the wikilink rule (CLAUDE.md, "The rendered
editor must write a wikilink back as it read it").

## Decisions

1. **A to-do can be ticked in the editor.** The box the editor draws is the
   visual; a widget decoration puts an invisible, focusable button over it
   (`editor/task-checkbox.ts`). Click, Space or Enter flips the item's
   `checked` in one undo step. The Markdown remains `- [ ]` / `- [x]`, and a
   plain bullet gets no control.
2. **A list item is its own block.** The gutter's pointer target, the block
   menu, drag, `+`, `Mod-d` and `Mod-Shift-ArrowUp/Down` resolve the nearest
   list item, not the top-level list (`block-actions.ts`, `block-gutter.ts`,
   `notion-keys.ts`). Duplicate copies the item, Delete removes it and keeps
   the rest of the list, Move swaps it with a sibling, and `+` inserts a new
   item of the same kind. Turning one item into a leaf (paragraph, heading,
   quote, code) splits its list around the result; turning it into another
   list kind moves that item out into a list of its own, with an ordered list
   that goes on after it keeping its numbers. Delete removes the item and keeps
   the list; deleting the only item removes the list. Escape still selects the
   top-level block, as 2026-11-15 decision 7 says, and the list keys still act
   on that selection. (Amended by `2026-11-21-block-unit-design.md`, decision 1: Escape selects the
   item too.)
3. **A table column can be aligned.** (Moved 2026-11-21 into the column menu:
   `2026-11-21-table-controls-design.md`, decision 3.) The table actions add a **Column
   alignment** select (default, left, centre, right). It writes every cell in
   the column, and GFM's delimiter row is what the reader reads back. A
   header-row toggle is not offered: GFM requires exactly one header row, so
   "no header" has no Markdown state.
4. **A rendered code block is entered by pressing it.** The press opens the
   raw code and focuses it, as Notion's does. The corner button remains for
   keyboard users and becomes **Done editing code**.
5. **Turn into reaches Toggle and Callout.** A paragraph or heading becomes a
   toggle with its words as the summary, or a Note callout with its words as
   the body. The summary is plain text by design (`details_summary` accepts
   text only), so Toggle is offered only for plain words (line breaks become
   spaces): a wikilink there would keep its words and lose its edge, an image
   its address, a mark its meaning (review, 2026-11-17). Turning a
   callout into text drops the marker line only; a marker-looking line that is
   not alone is a plain quote and stays as written.
6. **The `/` list is grouped and links to pages.** Rows sit under Basic blocks,
   Lists, Blocks and Links; each heading appears once per query, and a group
   takes the best rank of its rows. **Page link** replaces the `/query` paragraph with
   `[[` and puts the caret after it, so the existing `[[` list owns the rest;
   there is still one way to write a wikilink. With no query, a **Recent**
   group of up to four distinct commands picked in this browser starts the
   list (PR 367 amendment).
7. **There is one editing surface.** The peek panel's Edit opens the document
   page, which is already the editor for a writer. `/edit` already redirects
   there; the unreferenced composer wrapper (`document-editor.tsx`) is removed.

## Out of scope, recorded

- Comments inside a team document's editor. `OwnerReviewPanel` is wired only
  for personal workspaces (`editable-document.tsx`); its review API is
  document-scoped, so generalising it is an authorization change, not an
  editor fix.
- Move to another page: the editor has no block tree to move between.
  (Copy link to block was recorded here and is now in scope; see the
  amendment below.)
- Multi-block selection: deferred by the 2026-11-15 spec.
- Row and column drag reorder in a table: Markdown-preserving but needs its own
  drag design in a table that already scrolls. (Designed 2026-11-25:
  `2026-11-25-table-drag-reorder-design.md`.)
- Header-row toggle: no Markdown state (decision 3).
- The earlier deferred list: @ mentions (now in scope for pages and dates; see
  `2026-11-25-editor-at-mentions-design.md`, which also records why people are
  not offered), page width, images and captions,
  columns, embeds, cover, real-time collaboration.

## Amendment (2026-11-18, PR 367)

**Copy link to block.** The block menu in an editable document offers it for a
paragraph, list item or code block. It copies `<document URL>#kh-block-<uuid>`;
a block without an id is given one in a single undoable edit. Markdown carries the
id as an HTML comment adjacent to the block — before a paragraph or fence, and
inline at the end of a list item's paragraph — so the id survives a save and
reopen. The reader and editor remove the comment and put the id on the block's
element, so a hash link scrolls to it and the comment is invisible in every
other Markdown reader. Ids are per document; splitting a block keeps the id on
the original and removes it from the new fragment. Headings keep their own
copy-link action; quotes and tables remain out of scope.

**Recent slash commands.** With no query, the `/` list puts a Recent group of
up to four distinct commands previously chosen in this browser (`localStorage`
`kh-recent-slash-commands`) above the ordinary groups. A query shows no Recent
group.

## Verification

- Unit, through the rendered editor: `editor-task-checkbox.test.ts`,
  `editor-block-gutter.test.ts` (item duplicate/delete/move/turn/split, `+`,
  Toggle/Callout), `editor-table-actions.test.ts` (alignment),
  `editor-slash-commands.test.ts` (groups, Page link),
  `editor-notion-blocks.test.ts` (a press enters code editing), and the
  existing `editor-wikilinks` / `editor-block-actions` link round-trips for
  every rewritten document.
- E2E: a to-do ticked in the editor saves `- [x]`, and a list item's own menu
  duplicates it, in `tests/e2e/zz-editor-notion-gaps.spec.ts`.
- `npm run typecheck`, `npm run lint`, `npm run test:unit`.
