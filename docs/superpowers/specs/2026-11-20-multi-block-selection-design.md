# Editor: several blocks at once (Notion parity, sixth group)

The 2026-11-15 spec chose a block with Escape and deferred "operations on several
selected blocks". The 2026-11-20 gap analysis ranked it the largest remaining
difference from Notion. This spec adds it, for the keyboard. It amends decision 7
of `2026-11-15-editor-notion-parity-design.md` and its "Out of scope". Nothing
stored changes: every operation writes Markdown through the rendered editor.

## Decisions

1. **Shift-ArrowDown/Up widens a block chosen with Escape.** The range is
   contiguous top-level blocks, from the block Escape chose to the one the far
   end has reached; the same key back narrows it, down to the one block. The
   keys stop at the document's ends. ProseMirror's selection stays the one
   chosen node; the rest of the range is the plugin's state (`block-range.ts`),
   drawn with the same fill as a chosen block (`kh-bg-selected`, no new token).
   Any change to the document that is more than attributes (the editor
   renumbers heading ids after a copy of a heading), or a selection that is no longer
   that node, ends the range, so it can never point at blocks that moved: a move
   undone, or an edit that keeps the document's size, is not an attribute change.
2. **Delete, duplicate, move, copy, cut and turn act on the whole range.** Each is one undo step
   except turning into a heading, quote, code block or callout (see "Out of scope").
   - Backspace and Delete, with or without Shift, Ctrl, Alt or Cmd (and Ctrl-H on a Mac, where it is Backspace), remove every block; if that is the whole document one
     empty paragraph is left (documents are never empty, and nothing is
     hard-deleted: this is the editor, and a revision keeps what was).
   - `Mod-d` inserts copies after the range and chooses them, keeping the range's
     direction (the copy of the anchor block is the anchor). A copied heading makes
     the editor renumber heading ids, an attribute-only change: the range stands.
   - Copy puts every block of the range on the clipboard (HTML and text), and cut
     does that and removes them: ProseMirror's own selection is the anchor block
     alone, which would have taken one of several.
   - `Mod-Shift-ArrowUp/Down` moves the range past the block above or below it,
     and the range moves with it.
   - `Mod-Alt-0…8` and `Mod-Shift-7/8/9`, the single-block turn keys, turn every
     block (where Ctrl+Alt is AltGr, as on Windows, only the character decides, so AltGr+7 is `{`, not a turn key). Paragraphs and headings turned into a list become one list, an item
     each. The same kind on every block turns them back to paragraphs, as it does
     for one.
3. **Nothing replaces one block of several.** A character, with Shift or Option
   or AltGr as much as without, a paste, and Enter, with a range is ignored (Ctrl or Cmd
   shortcuts go on), and text that reaches the editor another way is refused. An
   input method cannot be told to ignore its text, and neither can a dead key (an accent waiting for its letter): the first key of either ends the range, and
   the composed text goes into the anchor block's text, as with one block chosen. Escape ends the range and returns to the text (decision 7 of the
   2026-11-15 spec, unchanged). Tab still goes on to the page.
4. **The range is announced.** A polite live region says "3 blocks selected".

Where the Markdown cannot say it (a heading turned into a list item loses its
level, as it does for one block), the existing single-block rules apply.

## Out of scope, recorded

(Amended by `2026-11-21-block-unit-design.md`, decisions 3-6: list items in a
range, the grip menu and drag on a range, and one undo step for every turn. It
also amends decisions 1 and 2 above: the range is a run in one sequence, not of
top-level blocks only, and turning into a heading, quote, code block or callout
is one undo step too.)

- A filterable block menu on `Mod-/`: that key is the Markdown source toggle on
  the document page (`editable-document.tsx`), and a second meaning would break
  a shortcut people have learned. The block menu stays on the gutter grip and
  `Alt+F10`; Turn into keeps its list.
- Choosing a range with the mouse (a drag from the margin, Shift-click) and
  Shift-Arrow from a text caret across blocks (ProseMirror's text selection
  already does that, and the toolbar acts on it). A range across list items or
  inside a toggle: the range is top-level blocks, as a block chosen with Escape is.
- The block gutter's menu acting on a range, and Turn into for a range from a
  menu rather than the keys.
- A range turned into a heading, quote, code block or callout is turned block by
  block (`turnBlockInto`), so each block is its own undo step.
- A range of a paragraph and an existing list turned into a list gives a new
  one-item list beside the old one, two lists (`-` and `*` in Markdown): the
  single-block rule, repeated.

## Verification

- `tests/unit/editor-block-range.test.ts`, through the rendered editor: widening
  and narrowing and the ends; Backspace, Delete and deleting everything; `Mod-d`;
  moving both ways and at the end; turning to one list, to headings and back; the
  ignored keys and Escape; the range ending with the document; the announcement.
- `tests/e2e/zz-multi-block.spec.ts`: Shift-ArrowDown, Delete, `Mod-Shift-ArrowUp`
  and `Mod-Alt-5` in a browser, read from the saved Markdown; the Escape specs
  of `zz-editor-notion-keys.spec.ts` still pass.
- `make verify`.
