# Editor: drag a table's rows and columns by their grips (Notion parity)

`2026-11-21-table-controls-design.md` gave a table a row grip and a column
grip that open menus, and recorded "dragging rows or columns by their grips:
still deferred". The menus have no Move entry (that spec's menus are Insert,
Align and Delete), so there is no keyboard route that reorders either. This
spec adds the drag. Nothing stored changes: GFM tables, one delimiter row.

## Approaches

- **Pointer events on the existing grips, one transaction on drop (chosen).**
  The grips already know their row and column. A press that travels past a
  small threshold becomes a drag; a release without that travel is the click
  it always was. The block gutter's drop line and tint are reused.
- **Native HTML5 drag (`draggable`), as the block gutter does.** It gives no
  touch, a ghost image the page cannot style, and a `click` that still fires
  inconsistently across browsers. Rejected: the table already scrolls, and
  the drop line must track cells, not blocks.
- **Move live while dragging.** Every pointer move would be a document change
  and an undo candidate. Rejected: one drag is one step, made on drop.

## Decisions

1. **A press on a grip, moved past 4px, drags it.** The row grip drags the row
   it belongs to; the column grip drags that column, every cell in it. The row
   or column is tinted (`kh-block-drag-source`'s fill) while it moves. A press
   released within 4px is a click and opens the menu as before. The click that
   ends a drag is swallowed, so a drag never opens a menu.
2. **A drop line shows where it will land.** The block gutter's
   `.kh-block-drop-line` (2px, `--kh-primary`, `pointer-events: none`):
   horizontal along the table's width at a row boundary, vertical along the
   table's height at a column boundary. The boundary is the nearest to the
   pointer by cell midpoints. It stays on the table while the pointer is
   outside it; the nearest boundary still wins.
3. **The header row stays the header.** The header row's grip does not drag
   (a press on it only clicks), and no body row can land above it: the
   boundary above the header is not offered, and a pointer over or above the
   header resolves to the boundary just below it. GFM has exactly one header
   row, the delimiter row sits under it, and promoting a body row would change
   what the writer sees as headings. The existing header-row rule is the same
   one: the row menu offers nothing above the header ("Insert row above" is
   absent). There is no Move row entry to match, so this decision is the
   record.
4. **A column keeps its alignment.** GFM stores alignment once per column, in
   the delimiter row. The editor holds it on every cell of the column
   (`setColumnAlignment`), so moving every cell of the column moves its
   alignment with it; the writer then reads it back from the header cell. The
   header row is a column's first cell and moves with it.
5. **Dropping in place is a no-op.** A drop at the dragged row's own boundary
   (above or just below it), or the column's, dispatches nothing: no history
   entry, no document change.
6. **Escape cancels.** Escape during a drag removes the line and tint and
   dispatches nothing. Releasing afterwards is not a click. A document change
   during the drag, `pointercancel`, or the editor going read-only cancels it
   the same way.
7. **One drag, one undo step.** A drop is one transaction that replaces the
   table with the rebuilt one (`closeHistory` before and after, as the menu
   actions do). The caret moves to the moved row's or column's cell. Cell
   content is moved as nodes, never re-parsed, so `[[wikilinks]]` stay
   `wiki_link` nodes and the saved document keeps its link edges.
8. **Pointer events, not mouse events.** It works with a mouse and with a
   pen or finger: the grips set `touch-action: none` so a touch drag is not
   taken for a scroll. Keyboard users have no new route here: reordering by
   keyboard is a menu concern, not a drag one, and is still out of scope.
9. **Reduced motion.** The drop line fades in with `kh-fade-in`, which the
   global `prefers-reduced-motion` rule shortens to nothing. The drag itself
   animates nothing.
10. **No new tokens.** Colours, the line and the tint are existing ones.

## Out of scope, recorded

- A keyboard or menu route to move a row or column (Move up/down, Move
  left/right). Dragging only; menus unchanged.
- Auto-scrolling the table or pane while dragging near an edge. A column
  scrolled out of view is reached by scrolling first.
- Dragging several rows or columns at once; selecting them from a grip.
- A header-row toggle: no Markdown state (2026-11-17 decision 3).

## Deviations

- None from `2026-11-21-table-controls-design.md` beyond lifting its deferred
  drag entry, which this spec does. The brief called for matching "the
  existing Move row up/down semantics"; no such menu entries exist, so
  decision 3 sets the rule from the header row's existing one.

- Review (2026-11-25): a drop is chosen only among the rows or columns the writer
  can see — the table's own box, the document pane and the viewport — and the line
  is held inside that visible part. In a table scrolled in its box, a pointer past
  its edge used to draw the line over the next block and drop among hidden rows.
  A drag follows the one pointer that began it, keeps its grips still until it
  ends, and does not begin or drop during IME composition.

## Verification

- `tests/unit/editor-table-drag.test.ts`, through the rendered editor, with
  pointer events on the grips: row moved up and down, column moved either way
  (alignment follows it), a header row that does not drag, a body row held
  below the header, no-op drop, Escape, click still opens the menu, one undo
  step, and `[[wikilinks]]` in moved cells read back through
  `extractDocumentLinks`.
- `tests/e2e/zz-table-drag.spec.ts`: real `page.mouse` drags of a row and a
  column in a saved document, the drop line visible mid-drag, the saved
  Markdown re-read, Escape leaving the document alone, and a wikilink in a
  moved cell still present in the saved document.
- `make verify`.
