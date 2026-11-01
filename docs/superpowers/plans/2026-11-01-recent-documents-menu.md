# Recent Documents Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shifting inline Recent list with a Documents toolbar history menu.

**Architecture:** SourceSidebar owns an ephemeral menu and captures history order on open. Existing shortcut metadata and menu rows supply eligible document links. Expose metadata loading state so the menu distinguishes loading, failure, and empty history.

**Tech Stack:** React 19, Next.js 15, Base UI menus, Vitest, Playwright; npm.

**Spec:** docs/superpowers/specs/2026-11-01-knowledge-sidebar-scroll-stability-design.md (approved 2026-11-01).

## Global Constraints

- No API, database, dependency, history-limit, or sidebar width changes.
- Preserve current eligibility rules, link semantics, and read-only cues.
- Remove inline Recent, its Show all row, persisted expansion readiness, and its tree layout-key contribution.
- Do not add Show in document tree or change general tree positioning.

## Review Focus

- History arrives after opening: loading resolves into usable links, not a stuck empty snapshot.
- Metadata fails: distinguish error from empty and allow retry.
- History reorders while open: current order stays stable; reopen uses latest order.
- Eligibility changes: inaccessible, archived, current, and favorited documents remain filtered.
- Compact drawer and keyboard use: toolbar fits, menu is reachable, selection/Escape dismiss it.

### Task 1: Replace inline Recent with a toolbar menu

**Files:**
- Modify: `src/components/knowledge/source-sidebar.tsx`
- Modify: `src/components/knowledge/use-sidebar-shortcuts.ts`
- Modify: `src/lib/document-shortcuts.ts` and `tests/unit/document-shortcuts.test.ts` (remove unused inline-only helper/tests).
- Replace: `tests/unit/source-sidebar-recent-show-all.test.tsx` with `tests/unit/source-sidebar-recent-menu.test.tsx`.
- Modify: `tests/unit/sidebar-shortcuts-transition.test.tsx` and `tests/e2e/retrieval-page-icons.spec.ts`.

**Interfaces:**
- Consumes: `useSidebarShortcuts(workspaceId, idsKey, includeArchived, snapshot)` and existing `shortcutMenuItem(key)`.
- Produces: hook adds `loading: boolean`; SourceSidebar props remain unchanged; clock button accessible name is `Recent documents`.

- [ ] Write behavioral tests for no inline list, clock menu displaying all six fixture recents, close on selection, latest order on reopen, stable order while open, empty/loading/error/retry, delayed history, exclusions, and source/read-only cues. Adapt page-icon E2E to use the clock and verify keyboard/drawer behavior.
- [ ] Run `npm run test:unit -- tests/unit/source-sidebar-recent-menu.test.tsx tests/unit/sidebar-shortcuts-transition.test.tsx`; expect missing clock/loading failures before implementation.
- [ ] Implement the menu using existing controls. Capture history keys on opening (or on delayed history readiness), filter against current eligible metadata, and remove obsolete inline state/helper. Use existing menu links and close semantics.
- [ ] Run the focused tests plus Favorites and shortcut tests; expect all pass. Run `npm run typecheck` and targeted ESLint; expect success.
- [ ] Run `npm run test:unit`; expect success or identify unrelated failures. Run the isolated browser harness for `retrieval-page-icons.spec.ts`; expect current/new icon, navigation, keyboard, and layout assertions pass. Record infrastructure limitations if any.
- [ ] Commit the implementation and tests. Obtain one fresh review under executing-plans, address substantive findings, and report actual verification.
