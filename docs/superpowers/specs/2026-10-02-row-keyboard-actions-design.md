# Row keyboard actions on the focused row — design specification

| Item | Content |
| --- | --- |
| Date | 2026-10-02 |
| Type | Design specification for pre-implementation review |
| Addresses | Item C.2 of the UI/UX review against the Linear design language: keyboard operation of rows. Visual tokens and feedback primitives are already aligned; the remaining gap in feel is "act directly on the focused row" |
| Reference contract | `docs/superpowers/specs/frontend-design-language.md` §10 (Shortcuts), §15 (One registry decides what can be done), §18 item 5 |
| Reference specifications | `docs/superpowers/specs/2026-09-24-keyboard-shortcuts-design.md` (this specification revises its §2, §3.2 and §4.4), `2026-09-21-action-model-spec.md` |
| Status | Approved and implemented (see `docs/superpowers/plans/2026-10-02-row-keyboard-actions.md`) |

## 1. Current state (against the code after PR #96 was merged; all confirmed by reading the code)

- **The tree already has the WAI-ARIA tree keyboard**: roving tabindex, `↑↓` to move, `←→` to collapse and to jump to the parent, `Enter` to open, `Alt+↑↓` to reorder (`src/components/knowledge/knowledge-tree.tsx:368`). What is missing is "act on the focused row".
- **Every row can already work out what it may do**: `documentActions(item)` / `folderActions(item)` return registry actions, and both the context menu and `Alt+↑↓` use them; `onRunAction` can already run move, rename and favorite (`useActionRunner`, `action-menu.tsx`).
- **Single keys are attached in exactly one global place**: the `window` `keydown` in `QuickSearch` (`quick-search.tsx:151–171`), which looks among the palette's actions for one whose `shortcut` matches and runs it. The target is always the document being read.
- **The registry has only four shortcuts**: `C` (`create.document`), `E` (`document.edit`), `⌘I` and `⌘\`. Most row actions have no key.
- **The tree is not an exception to single keys**: `isSingleKeyShortcut` excludes inputs, dialogs, menus and listboxes, and does not exclude `[role="tree"]`. So pressing `C` with the focus in the tree creates a document today, and pressing `E` edits **the document on the right that is being read**, not the focused row.
- **`aria-selected` on the tree means "the current page"** (synonymous with `aria-current="page"`), not multi-selection.
- **The right-click menu is used only by the tree** (the only callers of `RowContextMenu` and `RowActionsTrigger` are in `knowledge-tree.tsx`).

## 2. Scope

The first slice: **on the focused row of the tree, run registry actions with a single key.** The target is decided by keyboard focus.

| Key | Focused row is a document | Focused row is a folder |
| --- | --- | --- |
| `j` / `k` | Next row / previous row (aliases of `↓` / `↑`) | Same |
| `E` | `document.edit` | No action (the key is taken, see §4.2) |
| `F` | `document.favorite` | No action (the key is taken, see §4.2) |
| `M` | `document.move` | `folder.move` |
| `R` | No action (only folders can be renamed) | `folder.rename` |
| `C` | Unchanged: the global `create.document` | `folder.new-document` (create a document inside that folder) |

**A key runs only when the registry action for that row is available.** For `SOURCE_MANAGED`, archived, historical and read-only rows the registry does not offer the corresponding action, so the key does nothing (§4.2 explains why it also does not fall through to another document). The same holds for the "No action" cells in the table: pressing `E` or `F` with the focus on a folder, the key is taken by the tree and does nothing; it does not reach the document being read. Archive gets no single key: it has a confirmation dialog and breaks the links that point at it, so the menu is the right place for it.

**Out of scope**, recorded item by item so they are not mistaken for omissions:

- **Multi-select, `x` to select, Shift range selection, a batch action bar.** These first need the conflict between `aria-selected` and "current page" resolved, the availability of actions when `SOURCE_MANAGED` and `HUB_MANAGED` rows are mixed in one selection, and the confirmation copy and undo for how many links a batch archive would break. Team workspaces are currently off and the need for batch operations in personal workspaces is unproven; revisit when the need appears.
- **Rows in Personal Home and in search results.** They have no `treeitem` and no focused-row model. When a second user appears, extract the mechanism of §4 into a shared hook (with only the tree using it today, extracting now would be premature abstraction).
- **Two-key sequences starting with `G`, and a `?` shortcut overview.** The reasoning is the same as keyboard-shortcuts specification §2.
- **A single sidebar** (contract §18 item 4). It depends on the keyboard model this specification decides: where the focused row is, and whether the sidebar tree takes the same keys.

## 3. Behaviour rules

1. **The target is decided by focus.** If the event comes from inside a `treeitem` of the tree, the target is that row; otherwise, as before, it is the document being read. This replaces "`E` acts only on the document being read" in keyboard-shortcuts specification §3.2. The re-evaluation condition written there is "rows gain actions a reader reaches by focus", and this specification is that condition being met.
2. **The registry is the only source of availability.** The tree restates no condition; it only asks "does this row's action list contain an action whose `shortcut` is this key?".
3. **This is still not authorization.** As with `C` and `E` today, the key only starts a registry action; the write is re-verified by the application service.
4. **The trigger condition reuses `isSingleKeyShortcut`** (no `⌘`/`Ctrl`/`Alt`, not during IME composition, not in an input, dialog, menu or listbox, not a repeated event, letters without Shift). `j`/`k` obey it too, so `Alt+↑↓` reordering is unaffected.
5. **After the menu or the Move dialog closes, focus returns to that row**, so a keyboard user can press the next key. When implementing, first verify whether this is already the case; if it is not, it is a defect this specification must fix.

## 4. Mechanism

### 4.1 The tree handles it itself

The tree's `handleKeyDown` (`knowledge-tree.tsx:368`), before the arrow keys, for the focused row:

```text
j / k           → same as ArrowDown / ArrowUp
other single key → actionForKey(focusedRowActions, event)
                  found     → preventDefault, onRunAction(action)
                  not found → not handled (§4.2)
```

`focusedRowActions` is `documentActions(item)` or `folderActions(item)`, the same list as the right-click menu. No new state is added, and the focus target is not lifted into a context (that would add more boundaries where focus enters and leaves dialogs and inputs).

"Find the matching action from an event and an action list" is extracted into a pure function `actionForKey(actions, event)` in `src/lib/shortcut-keys.ts`, shared by `QuickSearch` and the tree so that the matching rule is not written twice. It handles only a single key without modifiers and compares the lower-cased `event.key`.

### 4.2 The tree takes only the keys it has declared

The global listener and the tree see the same event. The rule must satisfy two things at once:

- Pressing `E` on a `SOURCE_MANAGED` row **must not** fall through to the global listener and edit the other document being read on the right.
- Pressing `C` on a document row **must** still create a document, because that is today's behaviour and must not stop working just because focus is in the tree.

Availability is "is it in the action list", so "this key belongs to the tree but is unavailable on this row" cannot be told apart from "this key has nothing to do with the tree" by looking at the list. The solution is to declare the keys of row actions as static data in `action-registry.ts`:

```ts
/** The key each row action takes. An action reads its `shortcut` from here, so there is still one source. */
export const rowShortcuts = {
  "document.edit": "E", "document.favorite": "F", "document.move": "M",
  "folder.new-document": "C", "folder.move": "M", "folder.rename": "R",
} as const;
export function claimedRowKeys(kind: "document" | "folder"): ReadonlySet<string>;
```

- The `shortcut` of an action definition is changed to read `rowShortcuts` (`document.edit` currently writes the literal `"E"` directly and is changed along with the rest), so "binding, `aria-keyshortcuts` and displayed text" still have a single source.
- For the focused row, the tree **takes** a key that is in `claimedRowKeys(kind of that row)`: it runs the action if it is available, and does nothing if it is not (and calls `preventDefault`, so the global listener does not handle it again). A key that is not in the set is not touched and is left to the global listener.
- The single-key branch of `QuickSearch`: if the event has already been handled (`event.defaultPrevented`), it is skipped. The `/` branch is much earlier and is unaffected, so `/` can still open the palette from inside the tree.

Result: `C` on a document row still creates a document; `C` on a folder row creates inside that folder; `E` on a read-only row does nothing.

**Amendment (found in the final review): a folder row also takes the document keys.** The rule above, "a key that is not in the set is not touched and is left to the global listener", originally considered only `C`. If a folder row took only the `folder.*` keys (`c`, `m`, `r`), then pressing `F` or `E` with the focus on a folder would not be handled by the tree, and the page's `window` listener would find `document.favorite` / `document.edit` and run it on **the document being read**: it would favorite a different document, or open its edit page. That violates §3 rule 1 (when the event comes from a `treeitem`, the target is the focused row) and the "No action" in the folder column of the §2 table. Therefore:

- `claimedRowKeys("folder")` is the union of the `folder.*` and `document.*` keys: `{c, e, f, m, r}`; `claimedRowKeys("document")` is still only the `document.*` keys: `{e, f, m}`. Both are still derived from `rowShortcuts`; no second list is kept.
- The reason is that with no row in focus these keys act on the document being read, so whenever the focus is on a folder they must not fire. A document row does not take `c`: on a document row `C` is still the global Create document; a folder row keeps `c` (`folder.new-document`).
- The rule is restated: the tree takes every row-action key that can be pressed on a row of that kind; what is really left to the page is only the keys that belong to no row action, and `C` on a document row.

### 4.3 `shortcut` lives on the Action, not on a surface

`document.favorite` and `document.move` are listed in both the palette and the row menu (`surfaces: ["palette", "row"]`). Once they have keys, **with no focused row** (for example on a document page) pressing `F` favorites the document being read and pressing `M` opens the Move dialog for it, exactly like `E` today. This is deliberate and is an externally visible behaviour change; it is written down here rather than left to be discovered during implementation.

## 5. Display

- **Palette**: rows that have a `shortcut` already show a Kbd, so `F` and `M` appear automatically.
- **Right-click / `⋯` menu**: shows the Kbd of each action. Keyboard-shortcuts specification §4.4 and contract §10 originally showed none, for the reason "Edit on a row says `E`, but `E` edits another document, so every row is lying". Once the target is decided by focus, the key really does that thing when that row has the focus, and the reason is gone. The menu is used only by the tree, so it does not show hints for keys that do not exist on a surface that does not bind them. A right-click first gives that row the focus (it is a `tabindex="-1"` element and takes focus on mouse down), so the hint and the behaviour agree; verify this in the e2e test during implementation.
- **Focus ring**: tree rows already have `kh-focus-ring`, so the focused row is already visible and no new style is added. "Current page" stays `aria-current="page"` plus a neutral selection background (contract §8), a separate signal from the focus ring.

## 6. Tests

### 6.1 Unit

- `actionForKey`: match, no match, case, no match with modifier keys, and a `shortcut` with modifiers such as `"Meta+I Control+I"` is never matched by a single key.
- Registry:
  - The keys of `rowShortcuts` are unique **within one kind of target**: `E`, `F`, `M` for a document; `C`, `M`, `R` for a folder. `C` means different things on the two kinds of target and on the global `create.document`, so a globally-unique check is not possible.
  - Every action that has a `rowShortcuts` key has a `shortcut` equal to the table's value (single source).
  - Read-only targets (`SOURCE_MANAGED`, `ARCHIVED`, `HISTORICAL`) get an action list without `document.edit`, but `claimedRowKeys("document")` still contains `E`.
  - `claimedRowKeys("document")` is `{e, f, m}` and `claimedRowKeys("folder")` is `{c, e, f, m, r}` (the amendment in §4.2); a document row does not take `c`.

### 6.2 E2E (`tests/e2e/zz-row-keyboard-actions.spec.ts`)

- Focus on row A in the tree while document B is being read: pressing `E` goes to A's edit page, not B's.
- Pressing `E` with the focus on a `SOURCE_MANAGED` row: the URL does not change (it did not fall through to the document being read).
- `C` on a document row: still goes to `/knowledge/new`. `C` on a folder row: creates inside that folder.
- Pressing `E` and `F` on a folder row: the URL does not change, no dialog opens, and the document being read is not favorited (the key is taken by the tree and did not fall through to the page).
- `F` on a document row: favorites it, and the menu then shows Remove from favorites. `M`: opens the Move dialog, and after closing it the focus is back on that row. `R` on a folder row: opens rename.
- `j`/`k` and the arrow keys move to the same row; `Alt+↓` is still a reorder and is not swallowed by the `j`/`k` rule.
- With no focused row (in the body of a document page), `F` favorites the document being read.
- Typing `e`, `f`, `m`, `r`, `c`, `j`, `k` into the tree's filter box: the URL does not change and the filter content is correct (no trigger inside an input).
- Pressing these keys while the palette is open, the Move dialog is open, or a menu is open: no trigger.
- Right-clicking a read-only row: the menu has no Edit, and so no `E` hint; right-clicking an editable row: the menu shows `E` beside Edit.

IME composition cannot be simulated reliably in Playwright; it is covered by the existing `isComposing` counter-example of `isSingleKeyShortcut`.

### 6.3 Existing tests must not regress

The `C`, `E`, `/` cases of `tests/e2e/keyboard-shortcuts.spec.ts` and all of `row-actions.spec.ts` continue to pass.

## 7. Contract revisions

| Where | Revision |
| --- | --- |
| Contract §10 Shortcuts | "Single keys are bound in the palette … on the document being read" becomes: the target is the tree row that has the focus, and only when no row has the focus is it the document being read; the tree takes only the keys declared in `rowShortcuts`. Delete the whole sentence "The row menu shows no hints" and its reason, and say instead that the menu shows each action's key. Add one sentence: `j`/`k` are aliases of the arrow keys. |
| Contract §18 item 5 | "`E` acts only on the document being read, not on the focused row … revisit if rows gain actions a reader reaches by focus": the condition now holds, so remove that half and keep the "List pages sit in `kh-page`" half. |
| keyboard-shortcuts specification §2, §3.2, §4.4 | History is not rewritten; add a line to the "Status" at the top of the document: "The target of `E` and the decision about the row menu showing keys are superseded by `2026-10-02-row-keyboard-actions-design.md`". |
| README "Current canonical documents" table | Add this specification and its implementation plan. |

## 8. Affected files

```text
new     tests/e2e/zz-row-keyboard-actions.spec.ts
change  src/lib/shortcut-keys.ts                       actionForKey
change  src/components/actions/action-registry.ts      rowShortcuts, claimedRowKeys; shortcut of F, M, R, C
change  src/components/actions/action-menu.tsx         menu items show a Kbd
change  src/components/knowledge/knowledge-tree.tsx    handleKeyDown: j/k and single keys on the focused row
change  src/components/search/quick-search.tsx         the single-key branch skips handled events; uses actionForKey
change  tests/unit/shortcut-keys.test.ts               actionForKey
change  tests/unit/action-registry.test.ts             rowShortcuts assertions
change  docs/superpowers/specs/frontend-design-language.md  §10, §18
change  docs/superpowers/specs/2026-09-24-keyboard-shortcuts-design.md  status line
```

## 9. Unverified assumptions and risks

**About Linear (from knowledge of the product, not measured; contract §1a measured only the marketing site):**

1. Whether Linear visually distinguishes the focused row from "the page that is currently open" was not confirmed. This specification keeps the existing two-signal approach (focus ring plus neutral selection background).
2. Whether keys such as `F` and `M` act on the focused row or on the row under the cursor in Linear was not confirmed. This specification uses only keyboard focus; there is no "hovered row" concept, so that the mouse position cannot affect the keyboard target.
3. Linear's exact key assignments (which action gets which letter) were not checked one by one; the letters here were chosen for memorability (Edit, Favorite, Move, Rename, Create).

**Implementation risks:**

- The current state of §3 rule 5 (focus returns to the row after the menu and dialogs close) was unverified and might have needed to be added.
- The behaviour change in §4.3 (pressing `F` / `M` on a document page acts on the document being read) means that users who had no such keys may trigger them by accident. `F` is reversible (pressing it again removes the favorite); `M` only opens a dialog and never moves anything directly. Neither is destructive, which is one of the reasons these two keys were chosen rather than archive.

**Findings during implementation (the e2e tests verified the parts marked unverified above):**

- After the Move dialog closes, the focus returns to that row (verified; no production code needed).
- After right-clicking a row that did not have the focus, once the menu closes the keyboard target is that row (verified).
- "Keys pressed while the menu is open do not act": the e2e tests observed no key leaking. We attribute this to Base UI consuming keys inside the open menu, not to our guards (the unit tests prove only that the guard itself works when the event does reach the tree); the e2e tests pin down this observed range, but it is not guaranteed to hold after a Base UI upgrade.
- For a dialog or palette rendered through a portal, the event target has no `treeitem` ancestor, so the tree's own guard is irrelevant there; what keeps the key out is the page listener's `isSingleKeyShortcut`.
