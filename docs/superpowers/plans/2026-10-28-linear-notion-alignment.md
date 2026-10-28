# Linear / Notion alignment (second pass) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the six agreed Linear/Notion slices from the 2026-10-27 audit — theme, Inbox, document topbar, block menu, page identity and multi-select — except the two-rail shell restructure. The audit's smaller P2/P3 items (page width, @ mentions, defaults, image captions, Graph/Shares polish) stay deferred.

**Architecture:** Six independent slices on one branch: theme choice, Inbox navigation, document topbar actions, block menu, page identity (32px title + icon), and document multi-select. Each slice keeps the registry as the source of action availability and the server as the source of truth.

**Tech Stack:** Next.js App Router, React, Milkdown/ProseMirror, Base UI, MariaDB, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/frontend-design-language.md`, audit snapshot `.impeccable/critique/2026-10-27T02-23-01Z__src-components.md`.

## Global Constraints

- Keep explicit Light and Dark choices; add **System** as a third choice that follows `prefers-color-scheme`.
- Do not add a second sidebar rail; the 176px primary rail and 288px explorer stay.
- Document page title becomes 32/40; list/table titles keep 14/20.
- Every new action must be refused by the server even when the UI hides it.
- `SOURCE_MANAGED` documents stay read-only; archived documents offer restore, not edit.
- No new runtime dependency.
- `docs/ui-comparisons/` stays gitignored.

---

### Task 1: System theme

**Files:** `src/lib/theme.ts` (new), `src/components/shell/use-theme.ts`, `src/components/shell/user-menu.tsx`, `src/app/theme-script.ts`, `src/app/globals.css` (comment), `tests/unit/theme.test.ts` (new), `tests/e2e/menus.spec.ts`.

- [ ] Pure helpers: `ThemeChoice = "light" | "dark" | "system"`, `resolveTheme(choice, prefersDark)`, `isThemeChoice`.
- [ ] `useTheme` stores the choice, applies the resolved theme, and listens to `matchMedia("(prefers-color-scheme: dark)")` while the choice is `system`.
- [ ] Pre-paint script resolves `system` before paint, with no flash.
- [ ] User menu adds System (Monitor icon).
- [ ] Unit tests for resolution; E2E chooses System and asserts the OS value is applied.

### Task 2: Inbox in primary navigation

**Files:** `src/components/shell/primary-nav.tsx`, `src/components/shell/use-inbox-unread.ts` (new), `src/components/shell/inbox-popover.tsx` (share the count), `tests/e2e/inbox-popover.spec.ts`.

- [ ] A shared hook fetches `/api/review-notifications/unread`, refreshes on `kh:notification-changed`, `focus`, and route change.
- [ ] Personal workspaces get an **Inbox** row, first in PrimaryNav, with a count badge and `aria-label="Inbox, N unread"`.
- [ ] Keep the header popover as the quick peek; the nav row links to `/w/:id/inbox`.
- [ ] Update the E2E contract: the desktop rail has an Inbox navigation row with the count, and the popover still opens from the header.

### Task 3: Document topbar star and overflow

**Files:** `src/components/actions/action-registry.ts`, `src/components/actions/action-menu.tsx`, `src/components/knowledge/document-header.tsx`, `src/components/knowledge/document-inspector.tsx`, `src/components/knowledge/editable-document.tsx`, `src/components/shell/document-context-bar.tsx`, `src/components/shell/document-topbar-context.tsx`, `src/components/knowledge/use-tree-mutations.ts`, `src/app/api/documents/[documentId]/duplicate/route.ts` (new), `src/modules/knowledge/application/internal/duplicate-document.ts` (new), `src/modules/knowledge/application/hub-knowledge-command-service.ts`, `tests/unit/action-registry.test.ts`.

- [ ] Registry gains `document.duplicate`, shown on `palette` and `row` for ACTIVE HUB_MANAGED documents.
- [ ] Duplicate creates a sibling with the same Markdown, title + " copy", same icon, and returns the new IDs.
- [ ] Document header shows a star toggle (shared document shortcuts state) and a `…` menu with Copy link, Duplicate, Move, Download Markdown, Share, Archive/Restore.
- [ ] The narrow topbar exposes the same star and menu.
- [ ] Toast + Undo for duplicate (archive the copy) and for archive as today.
- [ ] Unit tests pin the registry availability; integration covers the duplicate service authoring rules.

### Task 4: Block menu Turn into / Duplicate / Delete

**Files:** `src/components/knowledge/editor/block-actions.ts`, `src/components/knowledge/editor/block-gutter.ts`, `src/components/knowledge/editor/block-actions.test` (new unit), `tests/unit/editor-block-gutter.test.ts`.

- [ ] `blockKind(node)` reports paragraph/heading/list/quote/code/other for the current row.
- [ ] `turnBlockInto(view, pos, kind)` converts paragraph ↔ heading 1–3, quote, code, bullet/ordered list, and back to paragraph, preserving inline content and one undo step.
- [ ] `duplicateBlock` inserts a copy below with a caret in it; `deleteBlock` removes it and puts the caret at the nearest block.
- [ ] Gutter menu order: Turn into ▸, Duplicate, Delete, separator, Move up, Move down.
- [ ] Keyboard: menu items are reachable with arrows; Escape restores the grip.
- [ ] Unit tests for each conversion and for delete at the first/last block.

### Task 5: Page identity — 32px title and page icon

**Files:** `tailwind.config.ts`, `src/components/knowledge/document-header.tsx`, `src/components/knowledge/editable-document.tsx`, `src/app/s/[token]/page.tsx`, `src/infrastructure/database/mariadb/migrations/026-document-page-icon.ts` (new), `src/infrastructure/database/mariadb/migrations/index.ts`, `src/modules/knowledge/domain/document.ts`, `src/modules/knowledge/ports/document-repository.ts`, `src/infrastructure/database/mariadb/repositories/documents.ts`, `src/infrastructure/database/mariadb/repositories/tree.ts`, `src/modules/knowledge/ports/tree-repository.ts`, `src/modules/knowledge/application/knowledge-query-service.ts`, `src/modules/knowledge/application/hub-knowledge-command-service.ts`, `src/modules/knowledge/application/internal/set-document-icon.ts` (new), `src/app/api/documents/[documentId]/icon/route.ts` (new), `src/server/knowledge-read.ts`, `src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/page.tsx`, `src/components/knowledge/page-icon-picker.tsx` (new), `src/components/knowledge/knowledge-tree.tsx`, `src/components/knowledge/source-sidebar.tsx`, `tests/unit/page-icon.test.ts` (new).

- [ ] Add `page` type token 32/40 and apply it only to the document H1, the title input, and the public share H1.
- [ ] Migration adds `knowledge_documents.page_icon VARCHAR(32) NULL`; default null.
- [ ] Repository reads and writes the icon; the tree and document read model carry it.
- [ ] `PUT /api/documents/:id/icon` accepts `{ icon: string | null }`, validates a short emoji, and requires HUB_MANAGED + write capability.
- [ ] Page icon picker: button above the title, curated emoji grid, Remove, keyboard accessible; tree rows render the icon in place of FileText.
- [ ] Icon persists across reloads and is visible to other members of the workspace.
- [ ] Unit tests for validation and the tree mapping; manual check that the title is 32px and list pages are unchanged.

### Task 6: Multi-select in the explorer

**Files:** `src/components/knowledge/knowledge-tree.tsx`, `src/components/knowledge/source-sidebar.tsx`, `src/components/knowledge/move-request.ts`, `src/components/knowledge/move-dialog.tsx`, `src/components/knowledge/use-tree-mutations.ts`, `tests/unit/knowledge-navigation.test.ts` (selection helpers), `tests/e2e/bulk-actions.spec.ts` (new).

- [ ] A checkbox appears on hover/focus of each document row; shift-click selects the range; Escape clears.
- [ ] A sticky bulk bar reports "N selected" and offers Favorite, Move…, Archive, and Clear; actions disabled unless every selected document offers them.
- [ ] Favorite updates all selected locally; Archive calls each document's endpoint and reports one summary toast; Move reuses the move dialog with a list of document IDs and moves each to the chosen folder.
- [ ] Selection survives tree refresh; it clears on route change and when a selected document disappears.
- [ ] E2E covers select-two → favorite, and select-two → archive with Undo restoring both.

---

## Verification

- `npm run typecheck`
- `npm run test:unit`
- `npm run build`
- E2E shards on CI
- Spot-check 390 / 1024 / 1440 in light, dark, and system dark.
