# Linear UI/UX Fixes and Verification

Base: `1cf8114` on `origin/main`. Implementation branch: `codex/linear-uiux-remediation`. This record continues the [original audit](2026-10-02-linear-ui-ux-audit.md) and [remediation design](../specs/2026-10-02-linear-remediation-design.md); the original audit's version and scores remain historical snapshots.

## Fix comparison

| Finding | Outcome and evidence |
| --- | --- |
| F01 Share-page scrolling | Removed the global body scroll lock; AppShell retains its own viewport. A production-browser 35-section shared article can scroll to the final section. |
| F02 Two sidebars | Desktop retains collapsible primary navigation (160px / 48px) and an independent 288px document tree; the tree starts at the top and retains its full height when primary navigation collapses. Mobile keeps a single Menu drawer. The reading/editing column alignment fix is preserved. |
| F03 Reading/editing displacement and long-document operations | Composer uses the same DocumentPane and reserved outline area. Breadcrumb starting positions differ by less than 2px; Save stays in the viewport at the bottom of a document. Save/Cancel/Markdown and personal draft status are in the sticky header. After scrolling, Reader supports Edit/Share/Details from the topbar; mobile groups them in a document-actions menu. |
| F04 Home hierarchy and document rows | Organize, export, and export scope move into Home actions; New note remains the primary action. Document rows connect to the action registry/menu, and mobile retains dates; empty Drafts/Favorites do not occupy Home. Move remains accessible through Organize documents; Home does not show an unusable Move action. |
| F05 Import controls | Source name uses Input with an actual 32px height; Choose folder uses Button and a hidden directory picker, displays folder name/count, and permits reselection. Existing real import/apply E2E passes. |
| F06 Hint contrast | Kbd and graph zoom hint use muted text. Unit tests confirm 4.5:1 across canvas/subtle/sunken backgrounds in light and dark themes. |
| F07 Palette ordering | Recent stays first; with an empty query, document/folder actions precede create and navigation, and duplicate navigation to the current section is removed. Typed queries retain full matching. Regression tests cover recents failure, empty lists, unexpected responses, selection position, and keyboard operations. |
| F08 Sources keyboard | Connects to shared list navigation used by Home/Search, preserving native links. Browser verification confirms ArrowDown moves focus to the next row. |
| F09 Copy and diagnostics | Composer uses the existing interface's primary English language. Import message/path come first, with code/details retained under Technical details; audit converts known event/target values into readable labels and uses readable fallbacks for unknown values, with expandable raw code/ID/payload. Domain diagnostic codes and error classification are unchanged. |
| F10 Responsive / touch | CSS determines desktop-sidebar visibility before hydration; at 390px, initial main and loading pane reserve no desktop-explorer space. Mobile navigation and explorer are combined and close after selecting a document. Shared buttons, menus, primary navigation, and tree controls are at least 40px on coarse pointers; common row actions remain visible, and star/menu touch areas do not overlap. Only one explorer mounts at a time, avoiding duplicate filter IDs. |
| F11 Large datasets | Home uses a single metadata-join query, eliminating current-revision Markdown reads for each document. Real-DB verification confirms workspace permissions, scope, archived documents/sources, and includeArchived behavior. 20,000 import changes initially create only 50 DOM rows; diagnostic summaries likewise use batches of 50 with Show more. These are verifiable query/DOM improvements, without claiming comprehensive production-latency or memory measurements. |
| F12 Revision comparison | Shows added/removed line counts, timestamps for both versions, title change, line numbers, and diff context. LCS is capped at 500,000 cells; large rewrites fall back to an exact replacement block. Initially shows 100 lines with expansion available. Full Markdown remains in a disclosure; restore's new revision/conflict guard retains existing behavior. |
| F13 Favorites Show all | Already fixed on latest main; the original implementation is retained, and regression tests for the full Show all list and 4-item cap pass. |
| F14 Duplicate share title | Uses the same opening-H1 ownership helper as reader; shared articles have one opening H1. |
| F15 Design enforcement | Corrected documentation and Tailwind comments: arbitrary values still compile. Added ESLint `design/contract` checks for arbitrary type/radius/shadow/motion/spacing and visible native form fields, retaining editor/search/tree exceptions and geometry. Actual ESLint probes verify literal/template classes are blocked and valid geometry passes. Search icon clearance uses a semantic CSS class. |
| F16 Palette style | Retains the cool neutral and blue accent explicitly chosen by the living contract. This is an optional brand direction rather than a defect; warm-gray replacement was not mixed into functional fixes. Representative screens were inspected in light and dark modes. |

## Verification

- TypeScript：`npm run typecheck`。
- ESLint: `npm run lint`, including the new design contract rule.
- Unit: 99 files, 1,468 tests passed. Added diff correctness/context/large rewrite, palette context, 20,000-change presentation, no summary reads on access refusal, ESLint enforcement, and light/dark hint contrast.
- Integration: 53 files, 614 tests passed; isolated MariaDB, including new Home-summary permission, scope, and archive-filtering tests.
- Production build: the E2E harness successfully ran `next build`.
- Browser core acceptance: 8 scenarios in `linear-remediation.spec.ts` passed, covering share scrolling/title, 1850px reading/editing position and sticky Save, 390px Menu/document actions after scrolling, Home, Sources keys/import field, coarse-pointer light/dark modes, and initial CSS geometry.
- Existing browser regressions: composer 42, authoring 8, imports 5, outline 4, recents/favorites 9, keyboard shortcuts 13, knowledge explorer 6, and reading loading 5 scenarios passed. Uses successful evidence for the current state; reruns were limited to areas affected by changes or failures.
- Personal-only browser: additionally verified cross-browser drafts, organize/export/restore/favorites, and resuming from Home after closing a tab with `KM_TEAM_WORKSPACES_ENABLED=false`; 2 complete scenarios passed. Core and existing regressions total 102 distinct browser scenarios, verified in batches rather than one complete E2E suite.
- Final layout mechanical scan: shell, Home, composer, revision restore, and imports scope produced `[]`; `git diff --check` passed.

Early browser failures came from old copy/order assertions, codes moved into disclosures, a new test incorrectly using personal-only functionality in a Team workspace, unscoped locators matching Next's hidden flight segments, floating-point coordinates, date metadata in Home-link accessible names, and initial streaming-fallback assertions. Corresponding assertions and fixtures were corrected without removing product scenarios. The outline helper originally waited only for its region; because the new composer also has that region, it now additionally waits for create navigation to finish, avoiding recording `/new` as the document URL.

## Visual and structural inspection

- Main desktop path: navigation on the left, breadcrumb/document content in the center, reserved outline area on the right; primary navigation and explorer are grouped by dividers, removing the double rail.
- Reading/editing density: retains the reading column and original text tokens; the sticky command area stays short and clear, document content scrolls, and the outer topbar stays fixed.
- Mobile: navigation is consolidated in the same left Menu; document actions collapse into a top-row menu, and common tree actions have independent touch areas. No document-level horizontal overflow.
- Extreme content: appropriate tests cover 35-section shared articles and composer, 20,000-change imports, and 1000-line diff replacements.
- DOM/focus: native links and shared menu/dialog primitives are retained; Sources keys, navigation shortcuts, drawer closure, and rendered-editor keyboard workflows have browser regressions.

## Verification boundaries

No complete WCAG conformance is claimed, and screen-reader tests across all routes or the Cartesian viewport/theme matrix were not performed. Audit labels were source-reviewed; independent external SSO browser servers were not started in this run, and governance/authorization were verified through the full integration suite.

The initial narrow-screen test disabled JavaScript to inspect CSS geometry; Next's streaming reader remains in its loading fallback in this state, which does not establish complete JavaScript-free reading support.

Home still lists all workspace metadata; the Personal service's existing per-item permission queries, import payload size, DOM limits after repeated Show more, and real production P95 latency were not expanded into refactors or benchmarks here. Revision's large-rewrite fallback presents exact content but may show more changed lines than a minimal diff.

At implementation-verification completion, changes remained in the local working branch without commit/push. Tests used disposable databases; the harness removed the DB and stopped servers after finishing.

## Independent review follow-up

See [independent code review](2026-10-02-linear-remediation-review.md): confirmed and fixed the mobile explorer-menu stacking/pointer-blocking regression, adding 2 browser scenarios covering regular/context menus and dialog focus/Escape/submission. The original 102 scenarios document batched verification of the initial implementation; they do not imply pre-review coverage of these two new scenarios.

## PR handoff verification

During PR preparation, fetched again and rebased onto `add48f0` (main's search/tooltip fixes). The Workspace selector conflict retained main's removal of native tooltips and the `kh-control` touch size.

After rebasing, typecheck, lint, 99 unit-test files / 1,468 tests, production build, and 18 E2E tests across `linear-remediation` and `row-actions` passed again. Earlier integration and other E2E results belong to the implementation-verification stage above and were not all rerun for this handoff.

## Desktop sidebar configuration restored

Desktop primary navigation returns to 160px expanded / 48px collapsed, with Knowledge explorer restored to an independent 288px area left of main. The document tree aligns with main's top, retains its height after primary-navigation collapse, and keeps documents visible. Mobile's single Menu, reading/editing alignment, and other remediation are retained.

After this change, typecheck, lint, production build, and 23 E2E tests across `linear-remediation` and `keyboard-shortcuts` passed. New geometry verification covers document-tree top alignment, 288px width, visibility and unchanged height after primary-navigation collapse; existing reading/editing alignment, persisted collapse, mobile row/context menus, and initial narrow-screen checks without JS also passed.

Topbar also returns to its original arrangement: the Knowledge Hub/collapse-button area follows primary navigation's 160px / 48px width, Workspace occupies an independent 288px area, followed by Search. New browser-position verification confirms Workspace starts at 160px / 48px and Search at 448px / 336px. Typecheck, lint, production build, and the same 23 E2E tests passed again.

## Full CI E2E failure investigation

The complete CI run for `5d96807` had 23 E2E failures, divided into four categories:

- 18 organize/move cases shared the selected-row viewport check: asynchronously loaded account favorites shifted the document tree, and the original reveal effect did not depend on this layout change. A reproduction controlling the favorites response confirmed the selected row was visible before loading and outside the viewport afterward. KnowledgeTree now reruns bounded reveal based on sidebar-section toggles and row counts; it changes only Document tree's scrollTop.
- 3 external SSO import-governance cases still required visibility of the native file input replaced by the design; they now require the Choose folder button to be visible. Verification that import controls disappear after access revocation, archiving, and network errors remains.
- Root routing assumed no preceding tests had created personal documents. It now verifies the personal-workspace ID provided by the API and the knowledge route; the empty-workspace prompt is separately tested with a newly created Team, avoiding dependence on shared-data execution order.
- A graph SVG link's bounding box includes text with pointer-events:none, so its center may lie outside the node. Hover/click targets the actual painted circle, retaining real pointer hit-testing and card/navigation assertions without force.

A new regression test uses 35 documents and a controlled delayed Favorites response, requiring the selected row to remain in the viewport before and after loading and article scrollTop to remain 0.
