# `/`, `+` and Turn into Inside Lists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/` and `+` work in list items as they do in paragraphs. Replace the selection toolbar's block buttons with one Turn into menu. Every way of turning a block then gives the same result.

**Architecture:**
- `slash-commands.ts`'s trigger learns an `item` position.
- A choice made on an item maps the command to a `BlockKind` and calls `turnInto` (block-unit plan, Task 1). Commands that are not kinds go through a new item-replacement helper in `block-actions.ts`, in the same transaction that removes `/query`.
- The selection toolbar's Turn into reuses the block menu's `turnOptions` and calls `turnBlocks` (block-unit plan, Task 3) on the blocks the selection touches.

**Tech Stack:** Milkdown / ProseMirror, Vitest (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-21-list-commands-and-turn-into-design.md`. This plan depends on `docs/superpowers/plans/2026-11-21-block-unit.md` being merged.

## Global Constraints

- `/` opens in a list item's first paragraph under the same two triggers as a paragraph:
  - alone on an otherwise empty item;
  - after a space mid-line when a command matches.

  Inline code and link text keep `/` as text.
- `/query` alone in an item, then a choice:
  - the item's own kind keeps the item;
  - another list kind moves it into its own list;
  - Text, H1–H3, Quote, Code, Diagram, Toggle or Callout replaces the item and splits the list;
  - Divider and Table do the same with a divider or a 2×2 table.

  `/query` is removed. Today's date and Page link write inline where the `/` was.
- After text in an item:
  - the same list kind adds an item after it;
  - anything else splits the list after the item and stands between the two parts;
  - an ordered list keeps its numbers after the block;
  - for a nested item, the block becomes a child of the parent item.
- `+` on an item adds an empty item of the same kind below and writes a visible `/`. Dismissing the list while `/` is still alone takes the `/` back and leaves the empty item. Enter is unchanged.
- Toolbar:
  - Heading 1–3, Bulleted list, Numbered list and Toggle are replaced by one first `ghost` `sm` button.
  - Its label is the current kind: `Text`, `Heading 1`, `Heading 2`, `Heading 3`, `Bulleted list`, `Numbered list`, `To-do list`, `Quote`, `Code`, `Toggle`, `Callout`, or `Mixed`. A chevron follows it.
  - It opens the block menu's Turn into entries in the same order, with the current kind checked.
  - An entry is disabled only when `canTurnInto` refuses it for some touched block.
  - The marks, Link and Clear formatting follow after a separator.
  - After a turn, the same text stays selected.
- Every entry point (toolbar, grip menu, `/`, turn keys) gives identical Markdown for the same block and kind.
- No new design tokens.

## Review Focus

- **`/` typed inside inline code or a link inside a list item.** No list opens. Test: Task 1, `inline code in an item keeps the slash`.
- **`/code` alone in the only item of a list.** The list disappears and a code block stands in its place, with no empty list. Test: Task 1, `only item turned`.
- **A toolbar selection spanning a paragraph and two items of a list.** The label is `Mixed`, and Turn into Numbered gives one numbered list of three. Test: Task 3, `mixed selection`.
- **`+` on a task item.** The new item is an unchecked task, and dismissing the list leaves `- [ ] ` empty, not a bullet. Test: Task 2, `plus on a task item`.
- **Choosing Page link in an item.** `[[` is written in the item, and the item stays an item. Test: Task 1, `page link stays inline`.

---

### Task 1: `/` in a list item

**Files:**
- Modify: `src/components/knowledge/editor/slash-commands.ts`:
  - `detect`, `detectInline`: allow the first paragraph of a `list_item`; `Trigger` gains `item: number | null`;
  - `choose`: the item branches.
- Modify: `src/components/knowledge/editor/block-actions.ts`
- Test: `tests/unit/editor-slash-commands.test.ts`

**Interfaces:**
- Consumes: `turnInto(tr, pos, kind)` from the block-unit plan.
- Produces, from `block-actions.ts`:
  - `replaceListItem(tr: Transaction, itemPos: number, nodes: ProseNode[]): number`: splits the item's list around the item, puts `nodes` in its place, and returns the position of the first node. The list's other parts follow the 2026-11-17 split rule, ordered numbering included.
  - `insertAfterListItem(tr: Transaction, itemPos: number, nodes: ProseNode[]): number`: splits after the item, or adds a sibling item when `nodes` is one same-kind `list_item`.
  - `COMMAND_KIND: Partial<Record<Command["id"], BlockKind>>` in `slash-commands.ts` maps `text`, `h1`, `h2`, `h3`, `bullet`, `ordered`, `task`, `quote`, `code`, `toggle` and `callout`.

- [ ] **Step 1: Write the failing tests.** Doc `- a\n- b\n- c`, with `b` emptied and `/quo` typed in it unless stated.
  - `quote alone in an item splits the list`: Enter gives `- a\n\n> \n\n- c`. Compare the parsed node types: `bullet_list`, `blockquote`, `bullet_list`.
  - `numbered from a bulleted item`: `/num`, Enter. `b`'s row becomes an `ordered_list` between two bullet lists.
  - `same kind keeps the item`: `/bul`, Enter. The Markdown is `- a\n- \n- c`, and the slash is gone.
  - `only item turned`: `- x` with `/code` → one `code_block`, and no list remains.
  - `page link stays inline`: `/page` → the item holds `[[`, still a `list_item`.
  - `date stays inline`: `/date` → the item holds a `YYYY-MM-DD` text.
  - `divider and table split`: `/hr` → `bullet_list`, `hr`, `bullet_list`.
  - `mid-line code goes below the item`: in item `b` typed `b /code`, Enter. Result: `- a\n- b` then a code block, then `- c`.
  - `mid-line bullet adds an item`: `b /bul` → a new empty item after `b`, with `b` keeping its text.
  - `nested item's block becomes a child of the parent item`: `- a\n  - n` with `n` emptied and `/quo` → the quote is inside `a`'s `list_item`.
  - `inline code in an item keeps the slash`: no list opens.
  - Wikilink round-trip: item `[[T]] /code` → the code block is below, and `[[T]]` keeps its edge.
- [ ] **Step 2: Run and see them fail.** `npx vitest run --config vitest.config.ts tests/unit/editor-slash-commands.test.ts`.
- [ ] **Step 3: Implement.**
  - Use one transaction per choice: delete `/query`, then `turnInto`, `replaceListItem` or `insertAfterListItem`, then `dispatchBlockAction`.
  - Top-level behaviour is unchanged.
- [ ] **Step 4: Run** the slash-commands, block-actions and wikilinks unit tests. Expected: PASS.
- [ ] **Step 5: Commit** with the message `The / list works inside list items`.

### Task 2: `+` on an item opens the list

**Files:**
- Modify: `src/components/knowledge/editor/slash-commands.ts` (`openBlockList`, `loneSlash` and the dismissal path accept an empty item's paragraph)
- Test: `tests/unit/editor-block-gutter.test.ts`

**Interfaces:**
- Consumes: `insertBlockBelow` (existing; it already adds a same-kind item) and Task 1's item trigger.

- [ ] **Step 1: Write the failing tests.**
  - `plus on an item writes a slash`: grip `+` on `b`. A new item after `b` holds `/`, and the `/` list is open.
  - `dismissing takes the slash back`: Escape → `- a\n- b\n- \n- c`.
  - `plus on a task item`: on `- [ ] a`, `+` then Escape → `- [ ] a\n- [ ] `.
  - `choosing from plus turns the new item`: `+`, type `quo`, Enter → a quote between the list's parts.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the block-gutter and slash-commands unit tests. Expected: PASS.
- [ ] **Step 5: Commit** with the message `+ on a list item opens the / list`.

### Task 3: Turn into on the selection toolbar

**Files:**
- Modify: `src/components/knowledge/editor/selection-toolbar.ts`: remove the H1–H3, list and Toggle items, and add the Turn into button and its menu.
- Modify: `src/components/knowledge/editor/block-gutter.ts`: export `TURN_OPTIONS` (today's `turnOptions`) so both menus share it.
- Modify: `src/components/knowledge/editor/block-sequence.ts`: add `blocksTouched(state: EditorState): EditorBlock[]`, the blocks of one sequence that the text selection's `from`–`to` touches.
- Test: `tests/unit/selection-toolbar.test.ts`

**Interfaces:**
- Consumes: `turnBlocks` (block-unit plan, Task 3), `canTurnInto` and `blockKind`.
- Produces: `TURN_OPTIONS: readonly [BlockKind, string][]` and `blocksTouched`.

- [ ] **Step 1: Write the failing tests.**
  - `label names the kind`: `Text` for a paragraph, `Heading 2`, and `Bulleted list` for text in an item.
  - `mixed selection`: on `P\n\n- a\n- b`, a selection from `P` into `b` → `Mixed`. Choosing `Numbered list` gives one ordered list of three (`P`, `a`, `b`), and one `undo` restores it.
  - `numbered list is enabled in a bulleted item`, and choosing it turns only that item (2026-11-17 rule).
  - `text stays selected after a turn`: `state.selection.from/to` cover the same text.
  - `no H1, H2, H3, list or Toggle buttons remain`.
  - `entries follow canTurnInto`: in a code block, `Toggle` is disabled.
  - `Escape closes the menu and returns to the text`.
- [ ] **Step 2: Run and see them fail.** `npx vitest run --config vitest.config.ts tests/unit/selection-toolbar.test.ts`.
- [ ] **Step 3: Implement.** The menu sits below the button with the block menu's styles, and keeps the toolbar open while it is open. After `turnBlocks`, restore the selection by mapping the old `from`/`to` through `tr.mapping`.
- [ ] **Step 4: Run** the selection-toolbar, editor-links-toolbar and block-gutter unit tests. Expected: PASS.
- [ ] **Step 5: Commit** with the message `The selection toolbar turns blocks through one Turn into menu`.

### Task 4: Same result from every entry point; browser checks; contract

**Files:**
- Create: `tests/unit/editor-turn-parity.test.ts`
- Create: `tests/e2e/zz-list-commands.spec.ts`
- Modify: `docs/superpowers/specs/frontend-design-language.md`:
  - "The selection toolbar and the link card": the toolbar holds Turn into, then the marks.
  - "Block controls and the `/` list": `/` and `+` in items.

- [ ] **Step 1: Write the parity test.** For each kind in `quote`, `h2`, `ordered` and `code`, turn item `b` of `- a\n- b\n- c` four ways, each on a fresh editor:
  - the grip menu;
  - the toolbar;
  - `/` (item emptied, `/` plus the kind's alias typed, Enter);
  - the turn key where one exists.

  Assert that the grip, toolbar and key results are identical saved Markdown for each kind. The `/` result has the same sequence of top-level node types and list kinds, since its item was emptied.
- [ ] **Step 2: Write the e2e tests.** At 1440 × 900, read from the saved Markdown:
  - `+ on an item opens the list`;
  - `/quo in an item makes a quote`;
  - `Numbered list from the toolbar in a bulleted item`.
- [ ] **Step 3: Run** the unit test and the e2e spec, then `git checkout -- tsconfig.json next-env.d.ts`. Expected: pass.
- [ ] **Step 4: Update the contract, then run `make verify`.** Expected: pass.
- [ ] **Step 5: Commit** with the message `Turn parity check, browser checks and contract for list commands`.
