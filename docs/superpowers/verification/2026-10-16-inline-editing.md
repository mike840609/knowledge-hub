# Inline editing and autosave verification

Validated on the branch rebased onto `69ba37a5` (side-peek feature).

| Check | Result |
| --- | --- |
| `npm run test:unit` | 218 files, 2,744 tests passed |
| `npm run test:integration` | 81 files, 742 tests passed |
| `npm run lint` | Passed |
| Production build | Passed in the E2E runner |
| `npm run typecheck` | Passed, including test sources |
| `KM_E2E_PORT=3217 npm run test:e2e -- zz-inline-editing.spec.ts zz-side-peek.spec.ts` | 15 passed |

Browser assertions include no focus/write on opening, debounce and maximum wait, no duplicate account draft PUTs or immediate RSC refreshes on normal saves, slow requests without lost input, conflicts, recovery after reload and in another browser, composition, Markdown switching, mobile layout, history and side peek.

The first post-rebase browser run lost its server at port 3101; subsequent requests were refused. The complete selected suite passed when rerun alone on port 3217. The server exit cause was not established.

This is not a complete legacy E2E pass. Existing tests for the old separate editor, Save/Cancel and reader-only UI still need migration and full-suite validation. Keep the PR in draft until that work is complete. No throughput/capacity benchmark was performed; request-count assertions validate reduced redundant traffic, not database capacity.

The standalone type check caught an untyped React test-environment global in the new indicator test. It now uses Vitest global stubbing; type checking, the three indicator tests and the changed-file lint check passed after the fix.

## Removal of redundant editing actions

Removed Edit document from the shared action registry (row menus and command palette), the E binding, and the narrow-window document context bar. Recovery and Retry save actions remain available.

The 210 affected unit tests and the full unit suite (218 files, 2,744 tests) passed. The row-actions browser suite passed all 8 tests, including absence of Edit in both row menu variants and the palette, and no navigation on E. Its production build passed; lint and standalone type checking also passed. Other modified legacy browser expectations have not been run as a complete suite; the draft limitation above still applies.

## Typing-first shortcut follow-up

Removed global and row F/M/C/D/R action bindings, the global slash search binding, and obsolete tooltip/ARIA hints. Cmd/Ctrl+K respects an already-handled event and IME composition; local tree navigation and editor commands remain. Tests verify literal typing in title/body, unchanged page/tree state on action letters or slash, and explicit menu/button access to commands and discussions.

- Full unit suite: 218 files, 2,738 tests passed (obsolete action-key assertions replaced).
- Lint, standalone type checking, and production build passed.
- The inline/row-actions run passed 21 of 22 tests; the remaining test used the wrong Details button label. After correcting the locator, that browser case passed.
- Both shared/owner discussion tests passed, including D remaining unbound and explicit controls working.
- Full row keyboard/menu suite: 16 tests passed after adapting direct-key focus assumptions to menu invocation. Together with the inline, row-actions and review checks, 40 distinct browser scenarios passed across the runs.
- Keyboard/browser changes do not constitute a complete legacy E2E migration; the PR remains draft.

## CI repair on 2026-10-17

Migrated the legacy editor assertions to canonical inline editing: intentional focus, silent autosave state, conflict/recovery confirmation, and editable titles. Restored code copying/highlighting, Mermaid preview, heading anchors, and canonical review paths in the editable surface. Review paths are ProseMirror decorations, with whole-block proof before assigning an anchor; explicit passage navigation synchronizes the editor selection.

Clean documents may adopt a newer server revision. Older refresh responses cannot replace a newer acknowledged local save, and dirty/recovered text is never adopted over. Code insertion and explicit Edit code reveal and focus the actual editing surface. Added regressions for both refresh ordering and code focus.

Full unit suite: 219 files, 2,749 tests passed. Lint and standalone type checking passed. Full browser discovery ran 384 scenarios: 368 passed, 14 failed and 2 skipped before the final repairs. The affected 90-scenario rerun passed 87, exposing three selection timing failures; the complete 19-scenario editor suite then passed three consecutive repetitions (57/57) after fixing review decoration timing and capturing the final native selection before Tab leaves the editor. The other affected scenarios, including comments, conflicts, delayed refreshes, code focus, links and Mermaid, passed their rerun.

Link target changes refresh resolved links immediately after saving; ordinary saves retain the coalesced metadata refresh. Read-only code previews keep native disclosures and wide-diagram scrolling, independently of the editor's disclosure commands. A new unit regression covers the keyboard selection/Tab race. Generated comparison screenshots were restored and are not part of the repair.

The repair is ready for fresh GitHub CI; remote completion will be recorded after all checks finish.
