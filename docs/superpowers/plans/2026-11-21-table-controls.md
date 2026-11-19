# Table Controls at the Table's Edges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the floating table toolbar, which covers the paragraph above the table, with Notion-style grips, menus and `+` bars on the table's edges.

**Architecture:** `table-actions.ts` keeps its one exported plugin, `tableActions()`. Its view draws these controls on `document.body`, `fixed`, positioned from the target cell's rects:
- a row grip;
- a column grip;
- two menus;
- two `+` bars.

The target cell is the cell under the pointer, or the caret's cell when the pointer is off the table. Every action puts the caret in the target cell first, then runs a `prosemirror-tables` command. The doc change is one undo step.

**Tech Stack:** Milkdown / ProseMirror, `@milkdown/kit/prose/tables`, Vitest (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-21-table-controls-design.md`

## Global Constraints

- No table control covers anything outside its table. Allowed places: inside the table's box, the editor's left gutter beside a row, and the strip just right of or just below the table.
- Row menu: `Insert row above`, `Insert row below`, rule, `Delete row`. The header row offers only `Insert row below` and `Delete row`.
- Column menu: `Insert column left`, `Insert column right`, Align as four radio rows (`Default`, `Left`, `Center`, `Right`, current one checked), rule, `Delete column`.
- `aria-label`s: `Row N actions` and `Column N actions`, 1-based, where the header row is row 1. `Add row`, `Add column`.
- `Delete table` is removed from the table controls. It remains in the block gutter menu.
- `Alt+F10` with the caret in a cell focuses the row grip. Tab goes on to the column grip, then `Add row`, then `Add column`. Escape in a grip or menu returns to the cell.
- No new design tokens:
  - grips reuse the block gutter's button styles and grip glyph;
  - bars use `border` plus `bg-hover` on hover;
  - menus reuse `.kh-block-move-menu`, `.kh-block-menu-separator` and the menu rows.
- Tab in the last cell still adds a row (2026-11-15 decision 18): untouched.
- Each action is one undo step. The caret goes to the same cell, or to the nearest remaining one.

## Review Focus

- **Pointer on one cell, caret in another.** A menu action applies to the pointer's cell. Test: Task 1, `acts on the hovered cell, not the caret's`.
- **Table scrolled sideways in its region.** A grip whose cell is scrolled out of the region hides. E2E: Task 3.
- **Read-only editor.** Grips and bars never show, and actions change nothing. Test: Task 1, `read-only shows no controls`.
- **Deleting the last body row, or the only column.** The table either stays valid or is removed as `deleteRow`/`deleteColumn` already do. No exception. Test: Task 1, `deleting the last body row and the only column does not throw`.
- **Editor destroyed while a menu is open.** All body-level nodes and listeners are removed. Test: Task 1, `cleans up every control on destroy`.

---

### Task 1: Grips and menus replace the floating bar

**Files:**
- Modify: `src/components/knowledge/editor/table-actions.ts` (rewrite the `view()` part; keep `currentColumn`, `columnAlignment`, `setColumnAlignment`, and generalise them to take a target cell position)
- Modify: `src/app/globals.css` (`.kh-table-grip`, `.kh-table-col-grip`; replace `.kh-table-actions` rules)
- Test: `tests/unit/editor-table-actions.test.ts` (rewrite against the new controls; keep the alignment cases through the column menu)

**Interfaces:**
- Produces:
  - `tableActions(): MilkdownPlugin`, unchanged name and wiring.
  - DOM contract for tests: buttons `[aria-label="Row N actions"]` and `[aria-label="Column N actions"]`. Each has `aria-haspopup="menu"` and opens a `[role=menu]` with `menuitem` rows; Align rows are `menuitemradio` with `aria-checked`.
  - Internal `targetCell: number | null` (position of the cell node). It is set from `pointermove` over a cell, or from the selection.

- [ ] **Step 1: Write the failing tests.** In `editor-table-actions.test.ts`, reuse `open()`; it puts the caret in `one`, row 2, column 1. Add these tests:
  - `row menu inserts above and below`: click `Row 2 actions`, then `Insert row above`. The Markdown has an empty row between the header and `one`. `undo` restores the original. Repeat with `Insert row below`.
  - `column menu inserts left and right`: `Column 1 actions` → `Insert column left`. Each row has 3 cells, and `undo` restores.
  - `header row offers no Insert row above`: with the caret in header cell `A`, `Row 1 actions` shows exactly `Insert row below` and `Delete row`.
  - `aligns from the column menu`: `Column 1 actions` → `Center`. The header cell alignment is `center`, and the Markdown matches `/\|\s*:-+:\s*\|/`. Reopening shows `Center` with `aria-checked="true"`.
  - `delete row and delete column, one undo each`: port the existing `it.each`, without `Delete table`.
  - `no Delete table among the table controls`: `document.querySelector('[aria-label="Delete table"]')` is `null`.
  - `acts on the hovered cell, not the caret's`: dispatch `pointermove` on the `td` holding `four`, then `Row 3 actions` → `Delete row`. `four` and `three` are gone, `one` stays.
  - `read-only shows no controls`: after `setEditable(false)`, both grips are `hidden`.
  - `deleting the last body row and the only column does not throw`, on a 1×1 body table.
  - `cleans up every control on destroy`: no `.kh-table-grip`, `.kh-table-col-grip` or `[role=menu]` is left on `document.body`.
- [ ] **Step 2: Run them and see them fail.** `npx vitest run --config vitest.config.ts tests/unit/editor-table-actions.test.ts`. Expected: FAIL, because no element has the label `Row 2 actions`.
- [ ] **Step 3: Implement the grips and menus.** Build them in `table-actions.ts`.
  - Use `addRowBefore`, `addRowAfter`, `addColumnBefore`, `addColumnAfter`, `deleteRow` and `deleteColumn` from `@milkdown/kit/prose/tables`.
  - To run an action: dispatch a selection-only transaction putting the caret in `targetCell`, then run the command on the new state. Wrap the doc change with `closeHistory`, then `view.focus()`.
  - Menus open below their grip. Escape closes the menu and returns focus to the editor. A mousedown on a menu row calls `preventDefault`, as `block-gutter.ts`'s `menuButton` does.
  - Positioning:
    - the row grip's left is `view.dom` rect left plus `(56 - 24) / 2`, vertically centred on the row;
    - the column grip is centred on the column's header cell top border;
    - a grip whose cell rect lies outside the nearest horizontally scrolling ancestor's rect is `hidden`.
- [ ] **Step 4: Run the tests and see them pass.** Same command. Expected: all PASS.
- [ ] **Step 5: Commit.** `git add src tests` and commit with the message `Table rows and columns get grips and menus instead of the floating bar`.

### Task 2: `+` bars and the keyboard route

**Files:**
- Modify: `src/components/knowledge/editor/table-actions.ts`
- Modify: `src/app/globals.css` (`.kh-table-add`)
- Test: `tests/unit/editor-table-actions.test.ts`

**Interfaces:**
- Consumes: Task 1's `targetCell` and its action runner.
- Produces: buttons `[aria-label="Add row"]` and `[aria-label="Add column"]`, and an `Alt+F10` handler in the plugin's `props.handleKeyDown`.

- [ ] **Step 1: Write the failing tests.**
  - `Add row appends a row and puts the caret in its first cell`: the row count goes up by one, `$from` is in the last row's first cell, and one `undo` restores.
  - `Add column appends a column and keeps the caret's row`: every row has 3 cells, and the caret is in the new column's cell of row 2.
  - `Alt+F10 in a cell focuses the row grip`: dispatch `keydown` `{key: "F10", altKey: true}` on `view.dom`. `document.activeElement` is `Row 2 actions`, and the block gutter's buttons do not have focus. Register `blockGutter()` too in this test's `extraPlugins`, so the precedence is real.
  - `Tab order from the row grip`: `Column 1 actions`, then `Add row`, then `Add column`. The focus sequence comes from DOM order: append them in that order.
  - `Escape in a grip returns to the cell`: `view.hasFocus()` is true and the selection is unchanged.
- [ ] **Step 2: Run and see them fail.** Same command as Task 1. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The bars show whenever the grips do (pointer over the table, or caret in it with focus in the editor or the controls).
  - The bottom bar spans the table's visible width, directly below it. The right bar spans its height, directly right of it.
  - In `handleKeyDown`, `F10` with `altKey` only, inside a table: focus the row grip, `stopPropagation`, and return `true`. Make sure this plugin's handler runs before `blockGutter`'s. If `extraPlugins` order puts it after, move the check into `blockGutter`'s handler as an early `isInTable` return `false`, and keep the focus in `tableActions`.
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** with the message `Table + bars on the bottom and right edges, and Alt+F10 to the row grip`.

### Task 3: Browser check, contract and docs

**Files:**
- Create: `tests/e2e/zz-table-controls.spec.ts`
- Modify: `docs/superpowers/specs/frontend-design-language.md`. In "Images and tables in a document", or after "Block controls", add a paragraph: "Table controls", the grips, menus, bars and `Alt+F10` route as the spec says, with no new tokens.

- [ ] **Step 1: Write the e2e spec.** Follow `tests/e2e/zz-multi-block.spec.ts` for sign-in and document set-up.
  - `the paragraph above a table stays clickable`:
    - Create a document whose first paragraph is long enough to fill its line at 1440px (one 300-character sentence), then `/table`.
    - Click into the first body cell.
    - For every character of the paragraph: take its `Range` rect centre, and `document.elementFromPoint` returns a node inside that paragraph.
  - `a row added and a column aligned from the menus are saved`:
    - Do both through the menus.
    - Wait for save, reload, and check the Markdown (via the source view or the API, as `zz-multi-block` reads it) has 3 body rows and `:-:` in the delimiter row.
  - `Alt+F10 from a cell focuses the row grip`.
  - `a cell scrolled out of view hides its grip`:
    - A table with 12 columns of long text.
    - Click a cell in column 1.
    - Scroll the table region fully right.
    - `Row 2 actions` is hidden.
- [ ] **Step 2: Run it.** Use the E2E command from the maintainer notes (`npm run -s test:e2e -- --reporter=line --trace off tests/e2e/zz-table-controls.spec.ts` with the `KM_TEST_DB_*` env), then `git checkout -- tsconfig.json next-env.d.ts`. Expected: 4 passed.
- [ ] **Step 3: Update the contract paragraph.**
- [ ] **Step 4: Run `make verify`.** Expected: unit, typecheck, lint and build all pass.
- [ ] **Step 5: Commit** with the message `Browser check and contract for the table edge controls`.
