# Editor: table controls at the table's edges (Notion parity)

A 2026-11-21 desktop audit (1440 × 900, `b66a360a`) inserted a table under a
long paragraph and put the caret in a cell. The table's floating controls
(`table-actions.ts`: + Row, + Column, Delete row, Delete column, Delete table,
Column alignment) sit `4px` above the table's top edge, right-aligned. That is
where the previous paragraph's last line is. They cover its second half, and a
click on those words lands on Delete row or Delete column.

Notion keeps table controls on the table itself. A grip on the row's left edge
opens that row's menu. A grip on the column's top edge opens that column's
menu. A `+` along the bottom and right edges adds a row or a column. This spec
follows that layout. It amends decision 3 of
`2026-11-17-editor-notion-gaps-design.md`, where Column alignment joined the
floating set. It also amends the design-language contract's table section.
Nothing stored changes: GFM tables, alignment in the delimiter row.

## Approaches

- **Edge handles and menus (chosen).** Every control sits on the table or in
  the gutter beside it. This is Notion's layout. Destructive actions go one
  click deeper, into a menu, so a stray click cannot delete.
- **Keep the floating bar and move it below the table, or into the gutter.**
  This is the smallest diff. Below the table it would cover the next
  paragraph instead, so it moves the problem rather than fixing it. In the
  gutter, five buttons and a select do not fit in 56px. Rejected.
- **Show the bar only on hover over the table.** It still covers text whenever
  it shows. Rejected.

## Decisions

1. **No table control covers anything outside its table.** Every control is
   drawn inside the table's box, in the editor's left gutter beside a row, or
   in the strip just right of or just below the table. Neither strip holds
   text. The acceptance test: with the caret in a cell, every character of the
   paragraph above the table is still the element under its own centre point.
2. **A row grip and a column grip follow the cell.** The grips belong to the
   row and the column of the cell under the pointer. With the pointer off the
   table, they belong to the cell the caret is in.
   - **Row grip:** a `size-6` icon button in the left gutter, level with the
     row.
   - **Column grip:** a small handle centred on the column's top border.
   - Both use the block gutter's grip glyph and muted colour. Both hide while
     their cell is scrolled out of the table's scrolling region
     (`.kh-markdown-table` scrolls sideways).
3. **The grips open menus.** The menus are built like the block menu
   (`block-gutter.ts`): same surface, rows and Escape behaviour, with the
   destructive entry last, after a rule.
   - **Row menu:** Insert row above, Insert row below, then a rule, then Delete
     row. The header row offers only Insert row below and Delete row. GFM has
     exactly one header row, so nothing goes above it. Deleting the header row
     does what Delete row does today.
   - **Column menu:** Insert column left, Insert column right, then Align as
     four radio rows (Default, Left, Center, Right, with the current one
     checked), then a rule, then Delete column.
   - Each action is one undo step. After it, the caret goes to the same cell,
     or to the nearest one that remains.
4. **`+` on the bottom and right edges.** While the pointer is over the table,
   or the caret is in it, a thin `+` bar runs along the table's bottom edge and
   another along its right edge. Clicking the bottom bar adds a row at the end.
   Clicking the right bar adds a column at the end. Each puts the caret in the
   new row's first cell, or the new column's cell in the caret's row. Tab in
   the last cell still adds a row (2026-11-15 decision 18).
5. **Delete table leaves the table controls.** It stays where every block's
   delete is: the block gutter's menu on the table. Escape from a cell selects
   the table block, and Backspace removes it, as for any other block.
6. **The keyboard reaches the same actions.** With the caret in a cell,
   `Alt+F10` moves focus to the row grip; Tab then goes to the column grip and
   the two `+` bars. This replaces `Alt+F10`'s route to the block gutter for a
   caret in a table; the gutter is still reached by Escape (table selected),
   then `Alt+F10`. Escape in a grip or a menu returns to the cell. Each control
   has an `aria-label`: "Row 3 actions", "Column 2 actions", "Add row", "Add
   column".
7. **No new tokens.** The grips use the block gutter's button styles. The bars
   use `border` and `bg-hover` on hover. The menus reuse the block menu.

## Out of scope, recorded

- Dragging rows or columns by their grips: still deferred (2026-11-17).
- Selecting several cells, rows or columns from a grip, with colour or
  background for them. Markdown has no cell colour.
- A header-row or header-column toggle: no Markdown state (2026-11-17 decision 3).

## Verification

- `tests/unit/editor-table-actions.test.ts`, through the rendered editor:
  - row above and below;
  - column left and right;
  - alignment from the column menu, read back from the saved Markdown;
  - the header row's menu;
  - the two `+` bars;
  - the caret after each action;
  - one undo step each.
- `tests/e2e/zz-table-controls.spec.ts`:
  - The audit's case: a long paragraph, then a table, with the caret in a
    cell. Every character box of the paragraph returns the paragraph from
    `elementFromPoint`.
  - A row added from the row menu and a column aligned from the column menu,
    read from the saved Markdown.
  - `Alt+F10` from a cell focuses the row grip.
- `make verify`.
