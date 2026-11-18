# Editor: one block is one block, for every input (Notion parity)

A 2026-11-21 desktop audit (1440 × 900, `b66a360a`) found three places where
what is selected and what an action changes disagree.

1. **Escape in a list selects the whole list.** With the caret in the second
   of three items, Escape then Backspace deletes all three. Escape selects the
   top-level block (2026-11-15 decision 7), and that block is the list. The
   gutter grip, the block menu, `Mod-d` and `Mod-Shift-Arrow` already treat a
   list item as its own block (2026-11-17 decision 2), so the keyboard and the
   pointer disagree about the same item.
2. **The block menu ignores a range.** Choose two blocks with Escape and
   Shift-ArrowDown, then use one grip's Duplicate. Only that one block is
   copied. `Mod-d` copies both. This was deferred on purpose
   (`2026-11-20-multi-block-selection-design.md`, "Out of scope").
3. **A range turned into headings takes several undos.** Two paragraphs turned
   into H2 with `Mod-Alt-2`, then `Mod-z` once, leaves one still an H2. Each
   block is its own undo step (same "Out of scope").

The same audit also found that the grip and `+` show only while the pointer is
in the 56px gutter. Over the text nothing appears, so a reader does not learn
the controls exist.

In Notion every list item is a block. Escape, Shift-Arrow, the grip menu and
drag all act on the blocks that look selected. Hovering anywhere on a block
shows its handles. This spec adopts that rule:

> **A block is a top-level block that is not a list, or a list item.**

This spec amends:

- decision 7 of `2026-11-15-editor-notion-parity-design.md`, and its "Out of
  scope" entry on gutter controls;
- decision 2 of `2026-11-17-editor-notion-gaps-design.md` (its last sentence);
- decisions 1 and 2 and the "Out of scope" of
  `2026-11-20-multi-block-selection-design.md`;
- the design-language contract's "Block controls and the `/` list" section.

Nothing stored changes. Every operation writes Markdown through the rendered
editor, and the wikilink rule holds.

## Approaches

- **A list item is the unit everywhere (chosen).** Escape, the range, the
  menu, drag and the keys all use the same block, and what looks selected is
  what changes. This is Notion's model, and it is already the pointer's
  model. Selecting a whole list becomes Shift-Arrow across its items, as in
  Notion, where there is no list container to select.
- **Keep the top-level unit and make the pointer follow it.** This is
  consistent but works against Notion. A one-item edit would need the caret
  and the menu. It also undoes 2026-11-17 decision 2. Rejected.
- **Two-stage Escape (item, then its list).** A second Escape already returns
  to the text, and a third state would hide what Backspace removes. Notion has
  no such state. Rejected.

## Decisions

### Escape

1. **Escape in a list item's text selects that item.** This is the innermost
   item around the caret, with whatever is nested under it. Elsewhere Escape
   still selects the top-level block. Escape again returns to the item's text.
   With an item selected:
   - Backspace and Delete remove that item only. The list keeps its other
     items, and a list left with no items goes.
   - Typing replaces the item's text, and it stays an item of its kind.
   - `Mod-d`, `Mod-Shift-ArrowUp/Down` and the turn keys (`Mod-Alt-0…8`,
     `Mod-Shift-7/8/9`) act on the item, by the rules 2026-11-17 decision 2
     gives the block menu.
   - The selection is drawn as a selected block is
     (`.kh-editor .ProseMirror-selectednode`, `kh-bg-selected`, `sm` radius).
2. **Tab still leaves the editor** with a block or an item selected. This is a
   deviation from Notion, which indents. It is the editor's documented
   keyboard exit (`LEAVE_EDITOR`, "Press Escape, then Tab, to leave the
   editor") and stays one.

### The range

3. **A range is a run of blocks in one sequence.** The top-level sequence is
   every top-level block that is not a list, plus every item of a top-level
   list, in document order. A nested item's sequence is the items of its own
   list. Shift-ArrowDown/Up widens or narrows within the anchor's sequence and
   stops at its ends. So a range can be paragraph, item, item, and it can
   cover a list entirely.
4. **Every range operation is one transaction and one undo step.** That
   includes turning into a heading, quote, code block or callout. A range that
   ends up covering the same blocks, re-located, stays chosen afterwards, as
   today.
   - **Delete** removes every block. A list left with no items goes. A
     document left empty keeps one empty paragraph.
   - **Duplicate** gives what copying the range and pasting it after its last
     block would give. Copies of items that follow an item join that list.
     Copies of items that follow anything else form a list of their kind. The
     copies become the range.
   - **Move** carries the range past the neighbouring block in its sequence.
     Items keep their kind. An item that lands outside its list forms a list
     of its kind, and two lists of the same kind that the move left next to
     each other are joined into one. Notion has no list boundary to keep.
   - **Turn** turns each block by the single-block rules (2026-11-17
     decision 2 for items). Paragraphs, headings and items turned into one
     list kind become one list.
   - **Copy and cut** are as today. Items go to the clipboard as a list of
     their kind.

### The grip menu and drag

5. **The grip of a block inside the range acts on the range.**
   - Turn into, Duplicate, Delete, Move up and Move down use the operations
     of decision 4.
   - A Turn into entry is enabled only if every block can take it
     (`canTurnInto`).
   - Copy link to heading is not offered.
   - The menu's accessible name says how many blocks it acts on ("Block
     actions, 3 blocks").
   - The live region reports the result ("3 blocks duplicated").
   - Opening the menu does not end the range.

   The grip of a block outside the range ends the range and acts on its own
   block, as Notion's does.
6. **Dragging a grip inside the range drags the range.** It lands as Move
   does, with the same drop line, and every block in the range is tinted while
   it is dragged.

### Hover

7. **The pointer anywhere on a block's line shows its controls.** That means
   the gutter and the whole text column, at the block's height. The controls
   are still drawn in the gutter. Nothing is drawn over text, so 2026-11-15's
   "controls stay in the gutter" holds. Text selection and clicks in the text
   are unchanged.
   - Typing hides the controls until the pointer moves again, as Notion does.
   - While a mouse button is down for a text selection, the controls stay
     hidden.
   - Where the pane gives the gutter less than 56px, the controls fall back
     to covering the first characters (contract, "Block controls"). There
     the trigger stays the gutter alone, so reading text never brings up a
     cover.

## Out of scope, recorded

- **Choosing a range with the mouse:** a drag from the margin, or
  Shift-click. This is the next step. It reuses decision 3's sequence.
- **Blocks inside a toggle, quote or callout as their own blocks.** Escape
  there still selects the container, as today. Notion treats a toggle's
  children as blocks; the Hub's `details` body is one Markdown region.
- **Tab or Shift-Tab indenting selected items** (decision 2).

## Deviations / amendments

Recorded during implementation:

- **A single block moves past its neighbour in its sequence (R2).** A chosen
  block, and a single block moved by the grip menu or by drag, passes one
  block of its sequence: an item passes one item, not a whole list. This
  amends decision 1's "act on the item by 2026-11-17 decision 2's rules" for
  moves; the rest of that rule (duplicate, turn) stands.
- **Ordered numbering after a range operation (R1).** The run holding the
  list's original first item keeps the list's attributes. The remainder of a
  split keeps its numbers. A run that left its list starts at 1.
- **Turn into on a range.** An entry is enabled when every block is already
  that kind or `canTurnInto` holds for it, and disabled when every block
  already is that kind.

## Verification

- `tests/unit/editor-block-range.test.ts` (extended) and
  `tests/unit/editor-small-keys.test.ts`, through the rendered editor:
  - Escape in the middle item of three, then Backspace, keeps the outer two.
  - Escape in a nested item selects only that item.
  - Typing over a selected item keeps an item.
  - The turn keys on an item.
  - A paragraph-item-item range: delete, duplicate, move both ways (lists
    joined), and turn to H2 with one `Mod-z` restoring all of them.
- `tests/unit/editor-block-gutter.test.ts`:
  - The grip menu on a range: duplicate, delete, move, turn.
  - Turn into is disabled when one block cannot take it.
  - The grip of a block outside the range acts on that block alone.
  - The hover target from a pointer over the text.
- `tests/e2e/zz-block-unit.spec.ts`:
  - The audit's two cases: Escape, Backspace in a list, and the grip's
    Duplicate on a two-block range. Both are read from the saved Markdown.
  - A drag of a range.
  - The controls showing with the pointer over the text at 1440px.
- The Escape specs of `zz-editor-notion-keys.spec.ts` and
  `zz-multi-block.spec.ts` are updated where they assumed a whole list.
- `make verify`.
