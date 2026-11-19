# One Block Is One Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a list item the block unit for Escape, the Shift-Arrow range, the grip menu and drag. Make every range operation one undo step. Show a block's controls when the pointer is anywhere on its line.

**Architecture:**
- A new `block-sequence.ts` owns the unit:
  - a block is a top-level non-list node, or a list item;
  - sequences are the top-level run, or one nested list's items.
- Range operations are pure transaction builders over a sequence. They rebuild the affected region from a list of entries, each a block or an item tagged with its list.
- `block-actions.ts` gains a transaction-level `turnInto`, so several turns share one transaction.
- `block-range.ts` and `block-gutter.ts` both call the sequence operations. The keys and the menu therefore share one implementation.

**Tech Stack:** Milkdown / ProseMirror, Vitest (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-21-block-unit-design.md`

## Global Constraints

- A block is a top-level block that is not a list, or a list item (with whatever is nested under it).
- Escape in a list item's text selects the innermost item as a `NodeSelection`. Elsewhere it still selects the top-level block. Escape again returns to the text.
- Tab with a block or item selected still leaves the editor (`LEAVE_EDITOR`). Never indent.
- The top-level sequence is every top-level non-list block plus every item of every top-level list, in document order. A nested item's sequence is its own list's items.
- Every range operation is one transaction and one undo step: delete, duplicate, move, turn (including heading, quote, code and callout), copy, cut.
- Move: an item landing outside its list forms a list of its kind. Two same-kind lists made adjacent by the move are joined.
- Duplicate: copies go after the last block. Copies of items following an item join that list. The copies become the range.
- The grip menu on a block inside the range acts on the range:
  - accessible name `Block actions, N blocks`;
  - live text `N blocks duplicated`, `N blocks deleted`, `N blocks moved`, `N blocks turned into <kind>`;
  - no `Copy link to heading`;
  - a Turn into entry is enabled only if `canTurnInto` holds for every block.

  The grip of a block outside the range ends the range.
- Hover:
  - the pointer anywhere over the editor's box at a block's height shows its controls, still drawn in the gutter;
  - typing hides them until the pointer moves;
  - a mouse button held for a text selection keeps them hidden;
  - where the gutter has under 56px visible, the trigger stays the gutter alone.
- No new design tokens. Selected items use `.kh-editor .ProseMirror-selectednode` (`kh-bg-selected`, `sm` radius).
- Wikilink rule: tests that rewrite documents read the saved Markdown's links (`tests/fixtures/link-markdown.ts` cases) through the rendered editor.

## Review Focus

- **A range whose last block is the last item of a list, moved down past a paragraph.** It forms a one-item list after the paragraph, and the original list keeps its other items. Test: Task 3, `move down out of a list`.
- **Deleting a range that covers every item of a list plus the paragraph after it.** The list node goes entirely; there is no empty list. Test: Task 3, `delete covers a whole list`.
- **Escape in a nested item, then Backspace.** Only that nested item goes, and its parent item keeps its text. Test: Task 2, `nested item`.
- **An ordered list split by a moved paragraph.** The second part keeps its numbers (2026-11-17 rule), and one undo restores the list. Test: Task 3, `ordered numbers after a move`.
- **Typing over a selected task item.** It stays a task item, unchecked state kept, with the typed text. Test: Task 2, `typing over a task item`.

---

### Task 1: Turning inside a shared transaction

**Files:**
- Modify: `src/components/knowledge/editor/block-actions.ts`
- Test: `tests/unit/editor-block-actions.test.ts`

**Interfaces:**
- Produces:
  - `turnInto(tr: Transaction, pos: number, target: BlockKind): number | null`. It applies the same conversion `turnBlockInto` does to `tr.doc` at `pos` and returns the caret position, or `null` when refused.
  - `turnBlockInto(view, pos, target)` becomes `turnInto` plus `dispatchBlockAction`. Behaviour is unchanged.
  - `turnListItemInto` takes `tr` likewise.
  - `selectedBlockPos(state: EditorState): number | null`. It returns `selection.from` when the selection is a `NodeSelection` of a top-level node or of a `list_item`, else `null`.

- [ ] **Step 1: Write the failing test.** `turnInto composes two turns in one transaction`:
  - Doc: `One\n\nTwo`.
  - `tr = state.tr`. Call `turnInto(tr, posOfTwo, "h2")`, then `turnInto(tr, 0, "h2")` (bottom first), then dispatch once.
  - The Markdown is `## One\n\n## Two`.
  - One `undo` gives `One\n\nTwo`.

  Also add `selectedBlockPos` cases: an item `NodeSelection` gives the item's position, and a text selection gives `null`.
- [ ] **Step 2: Run and see it fail.** `npx vitest run --config vitest.config.ts tests/unit/editor-block-actions.test.ts`. Expected: FAIL, `turnInto` is not exported.
- [ ] **Step 3: Refactor.** Move every `view.state.tr…` inside `turnBlockInto` and `turnListItemInto` onto the passed `tr` and `tr.doc`. Callers keep their signatures.
- [ ] **Step 4: Run the block-actions, block-gutter, block-range and slash-commands unit tests.** Expected: all PASS.
- [ ] **Step 5: Commit** with the message `Block turns can share one transaction`.

### Task 2: Escape selects the list item

**Files:**
- Modify: `src/components/knowledge/editor/notion-keys.ts`:
  - `escapeSelection`;
  - `actionBlockPos`, which uses `selectedBlockPos` first;
  - `toggleList`'s `NodeSelection` branch, which also accepts an item;
  - Backspace/Delete and text input on an item selection.
- Modify: `src/components/knowledge/editor/block-range.ts`: `chosenBlock` uses `selectedBlockPos`.
- Test: `tests/unit/editor-notion-keys.test.ts`

**Interfaces:**
- Consumes: `selectedBlockPos`, `turnInto`, `deleteBlock` (Task 1, existing).
- Produces: an item `NodeSelection` as the anchor every later task starts from.

- [ ] **Step 1: Write the failing tests** on `- a\n- b\n- c` with the caret in `b`:
  - `Escape selects the item`: the selection is a `NodeSelection` with `node.type.name === "list_item"` and text `b`.
  - `Escape then Backspace keeps the other items`: the Markdown is `- a\n- c`.
  - `Escape twice returns to the item's text`: `$from.parent.textContent === "b"`.
  - `nested item`: on `- a\n  - n\n- c` with the caret in `n`, Escape then Backspace gives `- a\n- c`, and `a` is intact.
  - `typing over a task item`: on `- [ ] a\n- [ ] b`, Escape in `b`, then type `x`. Result: `- [ ] a\n- [ ] x`.
  - `turn key on an item`: Escape in `b`, then `Mod-Alt-6` moves `b` into its own numbered list. Use the 2026-11-17 rule's expected Markdown from `editor-block-gutter.test.ts`'s item-turn case.
  - `Mod-d on an item`: the result is `- a\n- b\n- b\n- c`.
  - `Escape then Tab leaves the editor`: an existing case; keep it passing with an item selected.
  - `Escape in a paragraph still selects the paragraph`.
- [ ] **Step 2: Run and see them fail.** `npx vitest run --config vitest.config.ts tests/unit/editor-notion-keys.test.ts`.
- [ ] **Step 3: Implement.**
  - In `escapeSelection`'s fallback branch, select the innermost `list_item` ancestor if any, else `topBlockPos`.
  - The "Escape on a selected block returns to its text" branch must also accept an item `NodeSelection` (`Selection.near(doc.resolve(from + 1), 1)`).
  - Backspace and Delete on an item selection call `deleteBlock`.
  - `handleTextInput` on an item selection replaces the item's first paragraph's content with the text and puts the caret after it.
- [ ] **Step 4: Run** the notion-keys, small-keys, block-range and block-gutter unit tests. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Escape in a list selects the item, not the list`.

### Task 3: Sequences and one-step range operations

**Files:**
- Create: `src/components/knowledge/editor/block-sequence.ts`
- Modify: `src/components/knowledge/editor/block-range.ts`. Replace `topLevelBlocks` with `sequenceOf`, and replace the inline delete, duplicate, move and turn with the functions below. `clip` uses the same `from`/`to` span.
- Test: `tests/unit/editor-block-range.test.ts`

**Interfaces:**
- Produces, exported from `block-sequence.ts`:
  - `sequenceOf(doc: ProseNode, pos: number): EditorBlock[]`: the sequence containing the block at `pos`.
  - `deleteBlocks(state: EditorState, blocks: EditorBlock[]): Transaction`
  - `duplicateBlocks(state: EditorState, blocks: EditorBlock[]): { tr: Transaction; copies: EditorBlock[] }`
  - `moveBlocks(state: EditorState, blocks: EditorBlock[], toIndex: number): { tr: Transaction; moved: EditorBlock[] }`. `toIndex` is the destination index in the sequence with the blocks removed.
  - `turnBlocks(state: EditorState, blocks: EditorBlock[], into: BlockKind): Transaction | null`
- Every function returns an undispatched transaction. Callers dispatch with `closeHistory` as `setRange` does.

Approach for delete, duplicate and move:
- Read the region (the top-level span from the first to the last affected top-level node, or the nested list node) into entries:
  - `{ node }` for a plain block;
  - `{ node: item, list: { key, type, attrs } }` for an item, where `key` is the original list's position.
- Edit the entry array.
- Regroup: consecutive item entries with the same `key` become one list with the first group's attrs.
- `moveBlocks` gives a moved item the `key` of an adjacent same-kind list at its destination, else a fresh key. This is the join.
- Replace the region with the regrouped nodes in one `replaceWith`.
- `turnBlocks` keeps the existing many-lines-into-one-list rule, and otherwise calls Task 1's `turnInto` bottom-up on one `tr`.

- [ ] **Step 1: Write the failing tests.** Doc: `Para\n\n- a\n- b\n- c\n\nAfter`.
  - `Shift-ArrowDown crosses into a list`: Escape on `Para`, then Shift-Down twice. The range is `Para`, `a`, `b`, and the live region says `3 blocks selected`.
  - `delete covers a whole list`: a range of `a`, `b`, `c` and `After` (Escape on `a`, Shift-Down ×3), then Backspace. The Markdown is `Para`, with no empty list.
  - `duplicate after an item joins its list`: a range of `a`, `b`, then `Mod-d`. Result: `- a\n- b\n- a\n- b\n- c`. The range is the copies.
  - `move down out of a list`: Escape on `c`, Shift-Up (range `b`, `c`), then `Mod-Shift-ArrowDown` ×1. Result: `Para\n\n- a\n\nAfter\n\n- b\n- c`. Then `Mod-Shift-ArrowUp` once rejoins it to `- a\n- b\n- c`.
  - `ordered numbers after a move`: on `1. a\n2. b\n3. c\n\nP`, moving `P` up one block splits the list. The numbering follows 2026-11-17, and one `undo` restores it exactly.
  - `turn a mixed range to H2 is one undo step`: `Para`, `a`, `b` → `Mod-Alt-2`. All are headings. One `undo` restores the original Markdown.
  - `nested sequence stops at its list's ends`: on `- a\n  - n1\n  - n2\n- c`, Escape on `n2`, then Shift-Down. Nothing changes (the range is `n2` only).
  - `copy of a mixed range`: the clipboard text holds `Para`, `a`, `b` in order.
  - Wikilink round-trip: a range holding `[[Target]]` duplicated keeps its edge. Read the links with the extractor, as `editor-block-actions.test.ts` does.
- [ ] **Step 2: Run and see them fail.** `npx vitest run --config vitest.config.ts tests/unit/editor-block-range.test.ts`.
- [ ] **Step 3: Implement `block-sequence.ts` and switch `block-range.ts` over.** `sameBlocks` must compare the whole doc's top-level children still. A range's `anchor` and `head` are block positions, recomputed from the returned `copies` or `moved`.
- [ ] **Step 4: Run** the block-range, block-actions, notion-keys and wikilinks unit tests. Expected: PASS.
- [ ] **Step 5: Commit** with the message `A range can cross list items, and every range operation is one undo step`.

### Task 4: The grip menu and drag act on the range

**Files:**
- Modify: `src/components/knowledge/editor/block-range.ts`. Export `rangeBlocks(state: EditorState): EditorBlock[] | null` (the range's blocks when there are 2 or more), and `setBlockRange(view, tr, range)` (the existing `setRange`).
- Modify: `src/components/knowledge/editor/block-gutter.ts`
- Test: `tests/unit/editor-block-gutter.test.ts`

**Interfaces:**
- Consumes: Task 3's four functions, `rangeBlocks` and `setBlockRange`.

- [ ] **Step 1: Write the failing tests.** Set up a doc and a range of `Two`, `Three` from `One\n\nTwo\n\nThree`. Each test opens the grip menu of `Three`.
  - `Duplicate acts on the range`: result `One\n\nTwo\n\nThree\n\nTwo\n\nThree`, live text `2 blocks duplicated`.
  - `the menu names the count`: the menu's `aria-label` is `Block actions, 2 blocks`.
  - `Delete, Move up, Turn into Heading 2 act on the range`: one `undo` each restores.
  - `Turn into is disabled when one block cannot take it`: with a range of a table and a paragraph, `Toggle` is disabled.
  - `no Copy link to heading on a range`.
  - `opening the menu keeps the range`.
  - `the grip of a block outside the range ends it`: the `One` grip → Duplicate copies `One` only.
  - `dragging a grip inside the range moves the range`: simulate `dragstart` on `Three`'s grip and `drop` above `One`, as the existing drag test does. The result is `Two\n\nThree\n\nOne`.
- [ ] **Step 2: Run and see them fail.** `npx vitest run --config vitest.config.ts tests/unit/editor-block-gutter.test.ts`.
- [ ] **Step 3: Implement.**
  - When the menu opens, compute `group = rangeBlocks(state)` if it contains `active`.
  - `renderMain` and `renderTurn` use `group` when set.
  - The drag source decoration covers every block of the group.
  - A drop calls `moveBlocks` with the drop line's sequence index.
  - A grip `mousedown` outside the group ends the range: `setBlockRange(view, tr, null)`.
- [ ] **Step 4: Run** the block-gutter and block-range unit tests. Expected: PASS.
- [ ] **Step 5: Commit** with the message `The block menu and drag act on the selected range`.

### Task 5: The pointer over the text shows its block's controls

**Files:**
- Modify: `src/components/knowledge/editor/block-gutter.ts` (`hover`, plus new `keydown`, `mousedown` and `mouseup` listeners on `dom`)
- Test: `tests/unit/editor-block-gutter.test.ts`

**Interfaces:**
- Produces: `gutterFits(dom: HTMLElement): boolean`. It is true when the horizontal space between the editor's text left edge and the left edge of its nearest clipping ancestor (`overflow-x` not `visible`) is at least 56px.

- [ ] **Step 1: Write the failing tests.** Stub `getBoundingClientRect` for `dom` and its blocks, as existing hover tests do.
  - `pointer over the text shows the controls` (clientX inside the text column): the toolbar is not `hidden`, and `active` is that block.
  - `typing hides them until the pointer moves`: a `keydown` with `a` makes the toolbar `hidden`. The next `mousemove` shows it.
  - `a held mouse button keeps them hidden`: `mousedown` in the text, then `mousemove` → hidden. After `mouseup` and `mousemove` → shown.
  - `a narrow gutter keeps the gutter-only trigger`: with `gutterFits` false, pointer over the text → hidden; pointer in the gutter → shown.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.** The `hover` condition becomes: x is inside `[rect.left, rect.right)` when `gutterFits(dom)`, else the current gutter test. The suppression flags clear on the next `mousemove` with a changed `clientX` or `clientY`.
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** with the message `A block's controls show with the pointer anywhere on its line`.

### Task 6: Browser checks, older e2e expectations, contract

**Files:**
- Create: `tests/e2e/zz-block-unit.spec.ts`
- Modify: `tests/e2e/zz-editor-notion-keys.spec.ts` and `tests/e2e/zz-multi-block.spec.ts`, only where they assumed Escape selects a whole list.
- Modify: `docs/superpowers/specs/frontend-design-language.md`. In "A block can be chosen from the keyboard", Escape selects the item. In "Block controls and the `/` list", replace "in the text it does nothing" with the hover rule. Add the range-aware menu.

- [ ] **Step 1: Write the e2e tests.** At 1440 × 900, each reading the saved Markdown:
  - `Escape then Backspace in a list keeps the other items`;
  - `the grip's Duplicate copies a two-block range`;
  - `dragging a range moves it`;
  - `controls show with the pointer over the text`: hover the middle of a paragraph's text, and `Move block` is visible.
- [ ] **Step 2: Run** the new spec and both edited specs with the E2E command, then `git checkout -- tsconfig.json next-env.d.ts`. Expected: all pass.
- [ ] **Step 3: Update the contract.**
- [ ] **Step 4: Run `make verify`.** Expected: pass.
- [ ] **Step 5: Commit** with the message `Browser checks and contract for the block unit`.
