# Source trees loaded on demand — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load only the current source tree initially and other source trees on demand, without breaking shortcuts, filtering or organization.

**Architecture:** Keep the two existing navigation columns. A Knowledge-layout client cache owns explicit source load states, seeded with the current tree; an authorized route loads additional trees. Sidebar and move dialog share this cache. Shortcut metadata is read independently of tree expansion.

**Tech Stack:** Next.js App Router, React 19, TypeScript, existing MariaDB application services, Vitest and Playwright. No new dependencies or schema migrations.

**Spec:** `docs/superpowers/specs/2026-10-24-lazy-source-trees-design.md`

## Global Constraints

- Preserve two-column navigation and existing persisted expansion keys.
- Source-level loading only; no folder pagination or cross-page sidebar persistence.
- Unloaded, loading, loaded-empty and failed are distinct states.
- Inclusive trees retain existing archive visibility rules.
- Never use a source/Workspace ID as authorization proof.
- Do not transfer Markdown for shortcut metadata.
- Cross-source filtering deliberately loads visible trees only while a non-empty query is active.
- Existing tokens and control labels remain authoritative.

## Review Focus

1. Favorites/recents in unopened sources remain visible without fetching those trees: Task 3.
2. A response from an old scope or pre-refresh snapshot cannot replace new data: Task 2.
3. Restored expansion settings do not trigger duplicate requests or initially classify data as empty: Tasks 2–3.
4. Move dialogs cannot silently lose destinations after lazy loading: Task 3.
5. Filtering and archive visibility continue to cover unloaded sources: Tasks 1 and 3.

## File map

| File | Responsibility |
| --- | --- |
| `src/server/source-tree-read.ts` (new) | Authorized, Workspace-bound tree projection and shortcut metadata projection |
| `src/app/api/workspaces/[workspaceId]/sources/[sourceId]/tree/route.ts` (new) | Tree GET adapter |
| `src/app/api/workspaces/[workspaceId]/sidebar-shortcuts/route.ts` (new) | Metadata-only shortcut GET adapter |
| `src/server/knowledge-read.ts` | New sidebar bootstrap without reading unrelated trees; retain existing full read-model contracts for other consumers |
| `src/app/w/[workspaceId]/knowledge/[sourceId]/layout.tsx` | Bootstrap source headers plus the current tree |
| `src/components/knowledge/use-source-trees.ts` (new) | Tree load states, deduplication, refresh invalidation and late-response isolation |
| `src/components/knowledge/knowledge-layout.tsx` | Cache owner and shared sidebar/move data wiring |
| `src/components/knowledge/source-sidebar.tsx` | First-expansion loading, retry, independent shortcuts and filter completion |
| `src/components/knowledge/move-dialog.tsx` | Request the relevant source tree before computing destinations |
| `tests/unit/source-tree-read.test.ts` (new) | Projection authorization, scope and minimal payload |
| `tests/unit/source-tree-routes.test.ts` (new) | HTTP adapter and error mapping |
| `tests/unit/use-source-trees.test.tsx` (new) | Stateful asynchronous behavior |
| `tests/unit/source-sidebar-lazy.test.tsx` (new) | Rendered lazy sidebar behavior |
| `tests/e2e/lazy-source-trees.spec.ts` (new) | End-to-end expansion/filter/move/refresh behavior |

### Task 1: Scoped tree and shortcut reads

**Interfaces:**
- Produce `readSourceTree(services, caller, workspaceId, sourceId): Promise<{ source: SourceView; tree: KnowledgeTreeItem[] }>` with inclusive authorized data.
- Produce a metadata-only shortcut read accepting validated document IDs and archive mode. Response rows carry `documentId`, `sourceId`, `label`, `sourceName`, `ownership`, and the visibility information needed by shortcut rendering.
- Tree route returns `{ source, tree }`; shortcut route returns `{ documents }`. Use existing ID guards, workspace HTTP error mapping and no-store behavior. Bound metadata requests and chunk long favorite lists client-side without truncating Show all.

- [ ] Write projection/route tests: Workspace mismatch and unreadable source refused; archived inclusive tree available only through current policy; unexpected failures not represented as empty success; no Markdown/revision body in shortcuts; unopened source shortcuts resolve independently.
- [ ] Run new tests and record expected failures.
- [ ] Implement projections/routes using composition services and existing application ports.
- [ ] Run tests and typecheck; commit this coherent read boundary.

### Task 2: Initial bootstrap and shared client cache

**Interfaces:**
- Bootstrap `{ sources: SourceView[]; initialCollection: { source: SourceView; tree: KnowledgeTreeItem[] } }` for the current source only.
- Hook `useSourceTrees(workspaceId, sources, initialCollection)` produces `states`, `ensure(sourceId)`, `retry(sourceId)`, and loaded `collections`.
- State is discriminated: `unloaded | loading | loaded | error`; only loaded carries a tree. Seed changes are snapshot boundaries, not merely source-ID changes.

- [ ] Write bootstrap test asserting only the current source reaches `listTree`.
- [ ] Write hook tests: ensure deduplicates, collapse/reopen reuses loaded data, failure retries, late responses ignored after scope/seed replacement, and refresh invalidates old extra trees.
- [ ] Observe red tests, then implement hook and bootstrap. Keep server snapshots stable enough that ordinary client rerenders do not invalidate data.
- [ ] Run targeted tests and typecheck; commit.

### Task 3: Sidebar and move compatibility

**Interfaces:**
- Sidebar receives source headers, explicit load states, `ensure`/`retry`, and metadata shortcuts separately.
- Move dialog requests its source with the same `ensure` function and consumes that cache's loaded collection.

- [ ] Write rendered tests: initial current tree visible; unopened source causes zero tree requests; expand triggers one request; loaded-empty differs from failed; retry recovers.
- [ ] Add tests for persisted-open hydration, favorites/recents from unloaded sources, Show all ordering, non-empty filtering finding an unloaded source document, archive mode, conservative onboarding emptiness and complete move destinations.
- [ ] Observe red tests, then wire the layout hook into sidebar/move dialog. Preserve original-source context for folder/document action menus.
- [ ] Load extra trees only for explicit expansion, restored-open sections, active filtering or a move request. Keep expanded source headers visible while loading/failing.
- [ ] Run targeted tests plus existing shortcut, organizer, move and tree keyboard tests; commit.

### Task 4: End-to-end and performance evidence

- [ ] Add E2E checks for request counts, cached reopening, retry, direct-document reveal, filter completeness, move destinations and refreshed mutations.
- [ ] Run full unit suite, typecheck and lint (exclude local `.claude` worktree copies, documenting the exact command).
- [ ] Run production build and relevant DB-backed E2E scenarios in their isolated harness; report any unavailable prerequisites explicitly.
- [ ] Compare baseline and branch on identical multi-source fixtures with at least 400 documents. Record initial tree reads, response size and content arrival; include warm expansion/reopening behavior and test conditions.
- [ ] Save evidence to `docs/superpowers/verification/2026-10-24-lazy-source-trees.md`, update canonical documentation references where needed, and review the full diff.
- [ ] Create a focused PR against the intended base, with scope/behavior and actual verification results. Attach it to this chat.

## Self-review

All spec behaviors map to Tasks 1–4. Shared cache and explicit load states prevent empty/unloaded confusion. Shortcut metadata and move requests are explicit dependencies rather than accidental consumers of complete trees. Filtering's exceptional full load is documented. PR 3 (cross-page persistence), PR 4 (targeted operation-result reveal) and unrelated visual changes remain outside this plan.
