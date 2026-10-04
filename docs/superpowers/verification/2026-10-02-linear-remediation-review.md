# Linear remediation — independent code review

**English** | [繁體中文](2026-10-02-linear-remediation-review.zh-TW.md)

Date: 2026-10-02. Base: `1cf8114`. Branch: `codex/linear-uiux-remediation`.

An independent reviewer (`/root/independent_review`) was arranged using the requesting-code-review skill explicitly invoked by the user, with focused requirements, change boundaries, and existing verification records. The reviewer read the tracked diff and new source/scripts without editing files. The review covered navigation/portals/drawers, Composer/scroll/drafts, Home queries/ownership/authorization, action menus, revision diffs, import batching, and design lint.

## Finding: mobile explorer action menus intercepted by the Drawer (P1, fixed)

Trigger: at a 390px viewport, open Menu → document-row Actions → click Add to favorites.

The production Playwright regression confirmed the behavior before the fix: the menu item was visible and queryable by accessibility role, but pointer clicks kept being intercepted by the Drawer's `Document tree` nav until timeout. Checking only menu visibility or keyboard focus cannot detect this problem.

Cause: the explorer is created in KnowledgeLayout and portaled into a modal Drawer. The explorer menu's portal still lives in body, and the Base UI Positioner's transform creates its own stacking context; `z-50` on only the inner Popup cannot raise the entire menu above the Drawer.

Fix: in `src/components/ui/menu.tsx`, `MenuContent` and `ContextMenuContent` put `z-50` on the outer Positioner; the caller's className still applies to the Popup. The independent reviewer checked this minimal fix and its stacking behavior.

## Verification results

Two regression scenarios were added to `tests/e2e/linear-remediation.spec.ts`:

1. Mobile Document display options: menuitemcheckbox is visible, ArrowDown can focus it, Escape closes the menu and returns focus to the trigger, and the Drawer stays open.
2. A document row's regular menu can add a favorite and its context menu can remove it; the New folder input automatically receives focus, Escape closes only the top folder dialog and preserves the Drawer; reopening allows typing and successful folder creation.

Both scenarios passed against a production build and isolated DB. Core UI, keyboard shortcuts, and recents/favorites were rerun: 31 scenarios passed. The new row-action test initially matched two items when opening the context menu immediately because the old menu's closing animation was still in the DOM; after waiting for the old menu to close, the full scenario passed. A total of 32 distinct browser scenarios have successful post-fix evidence, verified in batches; the previously failing full batch was not claimed to have passed in a single run.

Related unit tests: `ui-primitives`, `ui-feedback-primitives`, and `linear-remediation`: 3 files / 45 tests passed. Production build, final TypeScript, ESLint, and `git diff --check` passed.

## Review conclusion and boundaries

One regression blocking mobile interactions was confirmed, fixed, and covered with pointer interaction tests. The reviewer confirmed no further consequential defects. The initial concern about Base UI focus context did not reproduce a focus-management failure in actual menu and folder-dialog focus/Escape/submission tests.

Home summary's archived-ancestor filtering has the same semantics as the original listTree and was not listed as a problem introduced by this change. This review does not establish complete coverage of screen readers across all routes, external SSO browsers, or all viewport/theme combinations; it inherits the boundaries in the [implementation verification record](2026-10-02-linear-remediation-verification.md).

At review completion, there had been no commit, push, PR creation, or merge. The harness cleaned up the test DB and server after finishing.
