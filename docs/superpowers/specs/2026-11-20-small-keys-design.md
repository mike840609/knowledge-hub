# Editor: small keys and caret fixes (Notion parity, fourth group)

The 2026-11-20 gap analysis of the edit page against Notion listed a handful of
keys and caret behaviours that are one decision each. This spec decides them. It
amends `2026-11-19-editor-keys-caret-design.md` (decisions 1, 2, 3, 4 and 7) and
the `/` list of `2026-11-15-editor-notion-parity-design.md`. Nothing stored
changes: every key writes Markdown through the rendered editor and is held to
the wikilink rule (CLAUDE.md). No colour, radius or elevation token is added.

## Decisions

1. **`Mod-Enter` in a toggle's title opens or closes it.** A to-do still ticks
   first. In a toggle's body, and anywhere else, the key stays the page's (save).
   The page's own key handler lets the key through to the editor in a title,
   as it does in a to-do.
2. **Shift-Tab in the document's first line goes to the title.** Tab stays in
   the text (keys spec, decision 2), which left Shift-Tab with nowhere to go
   but nowhere. In the document's first block, when that is text outside a list, table and
   code (a document that opens with a divider has no text there to leave from; the
   divider itself is decision 3), it fires `kh:editor-exit-top` as ArrowUp does and writes nothing.
   Elsewhere it is claimed and writes nothing, as before.
3. **ArrowUp from a block chosen at the top of the document goes to the
   title.** A divider or image that opens the document is selected, not typed
   into, so the text-caret rule of keys spec decision 3 never saw it; the same
   holds for any first block chosen with Escape, and nothing is above any of them.
4. **A `/` mid-line opens the list after marked text and after an inline
   node.** `**bold** /h` and `[[Page]]/h` open it; the line is read with inline
   nodes as one non-word character, so `and/or` and `a**b**/c` still do not. Inline code and link text keep a `/`
   as text (a path, an address), as `[[` does (`keepsAsText`).
(Mod-Enter closing a toggle from its title keeps the caret where it was; from the
body it goes to the title, where it stays visible.)

5. **Two entries are added to the `/` list.** `/diagram` (alias `mermaid`)
   writes a fenced `mermaid` block holding a two-node sample, which the reader
   and the code preview already draw. `/date` (aliases `today`) writes today's
   date as `YYYY-MM-DD` text, in the writer's own time zone, where the "/query"
   was: in place, with no block added.
6. **A press below the text is not an edit.** `focusEnd()` still adds the empty
   line to type in, but marks the transaction `addToHistory: false`, so a press
   that writes nothing no longer fires `onUserEdit`, starts the autosave or is
   an undo step.
7. **The block menu copies a link to a heading.** For a heading, the menu gains
   "Copy link to heading": the page's address plus `#slug`, where the slug is the
   one the reader gives (`HeadingSlugger`, in reading order across the
   document, so a repeated title is `-1` there and here; the text is the
   reader's, a wikilink in its written form and an image as its alt text, `headingText`, which the editor's own heading ids now use too).
   When the clipboard is refused or missing the menu says "Couldn't copy the link". A heading not yet
   saved has no id in the reader until the autosave lands; the link works from
   then on. Markdown has no block ids, so only headings can be linked to.

## Out of scope, recorded

- The numbered list after its first item is lifted keeps the list's written
  start (`3. a` `4. b` lifts to `3. b`), as a Markdown author wrote it: not a
  defect. The "1." case renumbers.
- A dismissed mid-line `/` list reopening when the query is changed to one
  nothing matches and back: it is a new query, as in Notion.
- A press on the backlinks area or a wrapper not writing at the end: the
  backlinks are content, not empty room.
- Copy link for blocks other than headings, and Move to another page: no block
  ids, no block tree to move between (the 2026-11-17 spec).

## Verification

- `tests/unit/editor-small-keys.test.ts`, through the rendered editor: each
  decision, including the `and/or` and divider-further-down cases that must
  stay as they were.
- `tests/e2e/zz-small-keys.spec.ts`: `/diagram` and `/date` survive a save, and
  `Mod-Enter` in a toggle's title is saved as `<details open>` (the page's key
  handler is in the way in a browser, not in jsdom).
- `make verify`, and the existing keys, caret and slash specs.
