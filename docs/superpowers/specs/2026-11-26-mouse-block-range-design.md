# Editor: choosing a range of blocks with the mouse (Notion parity)

`2026-11-21-block-unit-design.md` left "choosing a range with the mouse: a drag
from the margin, or Shift-click" as the next step, reusing its decision 3's
sequence. This spec adds both. Nothing stored changes: a range is the plugin
state of `block-range.ts` (an anchor and a head in one sequence, the anchor
held as ProseMirror's node selection), and every range operation (delete,
`Mod-d`, move, copy, cut, turn, the grip menu, dragging a grip inside the range)
already acts on it. The mouse only has to make one. The wikilink rule is
unaffected: no operation here writes Markdown.

## Decisions

1. **Shift-click extends from the chosen block.** With a block (or a range)
   chosen, Shift-click on another block's text, or on its grip, makes the range
   run from the anchor to that block, in the anchor's sequence
   (block-unit decision 3). The anchor stays the block Escape chose; clicking
   again moves the head (narrowing included); clicking the anchor itself leaves
   that block alone.
2. **A block of another sequence is chosen alone.** If the clicked block is not
   in the anchor's sequence (a nested item, or a block of the top level when the
   anchor is a nested item), the range cannot cross, so the clicked block
   becomes the one chosen block. Ignoring the click would look broken.
3. **A plain click is unchanged.** A click in text places the caret and ends a
   range, as today. Shift-click on text with only a caret (no block chosen)
   stays ProseMirror's own text-selection extension (decision 6).
4. **Shift-click on a grip with no block chosen starts from the caret's block**
   (the one the controls show: the nearest list item, else the top-level block).
   A grip is not text, so there is no text selection to extend; this gives the
   keyboard-free path "click in a block, Shift-click another's grip". A plain
   grip click still opens the menu and a grip drag still moves; Shift-click on
   the grip does not open the menu.
5. **A drag from the margin draws a box.** A mouse press that lands on the
   editor's own surface rather than on any block in it (the 56px gutter, the
   space between blocks, below the last block) starts a marquee. So does a press
   on the blank column either side of the editor: an element that holds this
   editor (and no other), within the editor's vertical extent and its client
   box (a press on its scrollbar stays the scrollbar's). The outline rail beside
   the column is a panel of its own, not blank column. Amended
   2026-11-26 after the browser check: the gutter's own controls cover most of
   the 56px margin beside a pointed-at block, so the editor's surface alone left
   only the gaps between blocks to start from. A short press there is a click:
   the caret goes to the nearest text on that line.
   - It draws a box with `--kh-bg-selected` fill and a `--kh-primary` border
     (no new token), `position: fixed`, `pointer-events: none`, `z-index: 30`
     like the gutter controls.
   - Blocks of the top-level sequence whose vertical span meets the box's
     vertical span are the range. The box's horizontal extent does not matter
     (Notion's does not either for a margin drag). The anchor is the first block
     touched in the drag's direction: dragging down, the topmost; dragging up,
     the bottommost. One block touched is that block chosen alone; none, the
     selection as it was before the drag.
   - The range is live while dragging, and the live region announces it as for
     the keyboard (`3 blocks selected`; it speaks from the range plugin's own
     view, so every way of making a range is announced).
   - Release keeps the range, and the editor is focused so the keys act on it.
   - Escape during the drag stops it and restores the selection and range from
     before the press, and is swallowed (it does not also choose a block).
   - A press that does not move (under 4px) is a click: the caret goes to the
     nearest text in that line, as the browser's press would have put it. The
     press's default is suppressed only so a drag cannot also select text.
   - Shift, Ctrl, Alt or Cmd held at the press: not a marquee (Shift is
     decision 1).
   - Only a mouse or pen press starts one. **Touch does not**: a touch drag
     scrolls, and the marquee would take the scroll.
   - **Autoscroll** at the pane's top and bottom 40px while dragging, scrolling
     the document pane (or the window), keeps the box's start fixed to the
     content.
6. **A text selection dragged across blocks stays a text selection.** Pressing
   on text and dragging is ProseMirror's own selection (the toolbar acts on it,
   Delete removes the text). It does not become a range. Notion converts it;
   here the toolbar and the review-comment flow depend on the text selection, so
   this spec leaves it.
7. **Keyboard behaviour is unchanged.** Every key, Escape included, acts as in
   the two earlier specs. The reader and the server-rendered stand-in have no
   editor, so no marquee or Shift-click exists there; a read-only editor makes no
   range.

## Out of scope, recorded

- Ranges across nested sequences by a marquee: the box chooses in the top-level
  sequence; a nested item is reached by Shift-click or the keys.
- Ctrl/Cmd-click to add separate blocks (a non-contiguous choice): a range is
  contiguous.
- A marquee started beside the column (the sidebar, the header, a panel).
- Converting a text selection across blocks into a range (decision 6).

## Verification

- `tests/unit/editor-mouse-range.test.ts`, through the rendered editor:
  Shift-click on a block extends an Escape-chosen block and Delete then acts on
  all; the head moves back; a different sequence chooses the clicked block alone;
  Shift-click with only a caret does not make a range; the marquee's pure
  function (`marqueeRange`) both directions, one block, none; a marquee in a
  rendered editor with geometry supplied, including Escape restoring the prior
  state; a touch press starting nothing.
- `tests/e2e/zz-mouse-block-range.spec.ts`: a real drag from the left margin
  over three paragraphs gives three selected blocks and "3 blocks selected";
  Delete removes them from the saved Markdown; Shift-click on a grip extends; a
  plain click in text still edits; a wikilink in a range survives `Mod-d` in the
  saved document's links.
- The Escape and range specs of `zz-multi-block`, `zz-block-unit` and
  `zz-inline-editing`; `make verify`.
