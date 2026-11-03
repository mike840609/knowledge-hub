# Phase 1 Connection Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing Workspace Graph into an evidence-first, direct-connection explorer so a user can select a Wiki, inspect the directional link and its original paragraph, and deliberately continue exploring without leaving the graph.

**Architecture:** Reuse the current authorized, Workspace-scoped Markdown link index and graph; keep Graph/List metadata-only at first paint. Add focused read-only connection summary and evidence methods to `KnowledgeLinkService`, exposed through two private/no-store Workspace routes. Selection/panel state stays in the current Graph page; excerpts load only on selected pairs, and the existing Document Inspector graph is unchanged.

**Tech Stack:** Next.js 15 App Router, React, TypeScript, MariaDB 10.11, existing modular-monolith/application ports, unified/remark-parse/remark-gfm, Vitest, Playwright, shadcn-style existing Knowledge Hub components.

**Spec:** `docs/superpowers/specs/2026-11-03-phase-1-connection-explorer-design.md` (user-approved 2026-11-03). This is the *new product-direction Phase 1*, not the original Core Tree Phase 1.

## Global Constraints

- **No implementation has been authorized yet.** This document is only a plan; wait for user approval and selection of execution mode.
- Do **not** add a Sidebar item; rename existing “Graph” navigation to **“Connections”**, preserve `/w/:workspaceId/graph`.
- Main Graph node click selects, main Graph row click shows Evidence, and **Explore Node** alone changes focus. Selection does not remount/re-layout the graph or reset pan/zoom.
- Only **explicit** `[[wikilink]]` and relative `.md/.markdown` links count. “References” must never be described as verified dependencies; do not use LLM, GPU, embeddings, graph DB or TKMS.
- Use source document's **current saved revision** for evidence; read **only selected source Markdown** and return text safely, never HTML.
- Every read rechecks authenticated caller, Workspace membership, source + target visibility; share-token routes confer no graph/evidence access. Index rows are *not* permission grants.
- Existing `GraphEdge` remains `{from,to,count}` with aggregate count; **do not** add unbounded excerpts to `WorkspaceGraphView` or a stored relation table.
- Existing `?focus=` remains backward-compatible with “Open in graph”, existing Copy for Agent (Personal-only, cap 20 docs and 256 KiB), source/Graph filters and document-link navigation.
- Preserve existing graph 1000-node cap, local graph 60-node cap; show true totals/caps and stale-index/ambiguous/missing disclaimers.
- Evidence excerpt maximum **8 source lines OR 600 Unicode code points**, clearly marked on truncation; **10 occurrences per page** with revision-safe cursor.
- First implementation defaults: fixed right-hand panel **360px**, responsive switch around **1024px** content width, drawer/bottom sheet on narrow screens. Use existing visual-design tokens.

## Review Focus

The five most likely user-facing failure modes are each pinned by tests later in this plan.

1. **Two distinct links on the same Markdown line** — matching by line alone confuses occurrences; Task 5 tests line + `ordinal` + source offset.
2. **Source/target archived or permissions revoked after selection** — old panel data must not reveal titles or excerpts; Tasks 3, 6 and 8 test live authorization and neutral failures.
3. **Graph filtered/capped while a document's other references are outside the drawing** — panel must not pretend it shows every visible/invisible relationship; Tasks 3, 4 and 8 test counts and “not shown”.
4. **Rapid focus/pair changes** — response to A must never appear under B; Tasks 2 and 7 exercise request cancellation/selection identity.
5. **URL/back/filter transitions resetting the graph or breaking Copy for Agent** — Task 1 and 8 E2E assertions pin `?focus=`, graph transform and existing agent-context link.

---

## File Structure / ownership map

| Responsibility | Files |
| --- | --- |
| Connections title and nav only | Modify `src/components/shell/primary-nav.tsx`, `src/app/w/[workspaceId]/graph/page.tsx`; audit `src/components/actions/action-registry.ts` and existing command palette actions for “Open graph” discoverability |
| Browser selection / URL state | Create `src/components/knowledge/use-connection-focus.ts`; modify `graph-explorer.tsx` and `graph-canvas.tsx`; add pure helpers in `src/components/knowledge/connection-selection.ts` |
| Graph/List parity and panel shell | Modify `src/components/knowledge/graph-list.tsx`; create `src/components/knowledge/connection-detail-panel.tsx`; modify `graph-explorer.tsx` |
| Directional summary | Create `src/modules/knowledge/domain/connection-summary.ts`; extend `src/modules/knowledge/application/knowledge-link-service.ts` |
| Evidence extraction | Create `src/modules/knowledge/domain/connection-excerpt.ts`; modify `src/modules/knowledge/domain/document-links.ts` minimally to reuse its own link collection + positional ordering |
| Authenticated evidence query | Extend `knowledge-link-service.ts`; use existing `DocumentLinkRepository` / `RevisionRepository` ports; add read-specific port method **only if** profiling shows necessary |
| Route/API wiring | Create `src/app/api/workspaces/[workspaceId]/connections/[documentId]/route.ts` and `src/app/api/workspaces/[workspaceId]/connection-evidence/route.ts`; use existing `src/server/workspace-http.ts` and `applicationServices().links` |
| Panel data fetching | Create `src/components/knowledge/connection-data.ts` (typed fetch helpers) and `connection-evidence-view.tsx` |
| Verification | Add `tests/unit/connection-summary.test.ts`, `tests/unit/connection-excerpt.test.ts`, `tests/unit/connection-selection.test.ts`, `tests/integration/connection-explorer.test.ts`; update `tests/e2e/workspace-graph.spec.ts`; create `tests/e2e/connection-explorer.spec.ts` only when tests warrant separate fixture orchestration |

> Map files to tasks by responsibility, not a parallel new “knowledge graph” subsystem. All paths above are design targets; preserve project lint boundaries in `CLAUDE.md`.

---

### Task 1: Main Graph node selection and stable focus URL

**Files:**
- Create: `src/components/knowledge/connection-selection.ts`, `src/components/knowledge/use-connection-focus.ts`
- Modify: `src/components/knowledge/graph-canvas.tsx`, `graph-explorer.tsx`
- Test: `tests/unit/connection-selection.test.ts`; update `tests/e2e/workspace-graph.spec.ts`

**Interfaces:**
- `GraphCanvas` adds optional `onSelectNode?: (documentId: string) => void`. If absent (Document Inspector), keep existing anchor navigation; if present (Connections), an accessible node control selects rather than navigates.
- `useConnectionFocus({initialFocusId, visibleDocumentIds})` returns `{focusId, selectFocus(documentId: string | null): void}`. `?focus=` represents **DOCUMENT** nodes only, never unresolved ghost IDs.

- [ ] **Step 1: Write failing unit tests** in `connection-selection.test.ts`: valid visible DOCUMENT focus accepted; invalid/unresolved/filtered focus ignored; setting/clearing focus preserves `source`, `orphans`, `unresolved`, `view` URL query fields; browser back resolves the prior focus.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/connection-selection.test.ts`. Expected: FAIL before implementation.
- [ ] **Step 3: Implement** `connection-selection.ts` pure focus/query helpers and `use-connection-focus.ts` state + URL synchronization. For focus-only updates, prefer Next 15 native `window.history.pushState`/`replaceState` so Graph is not server-refetched; sync popstate and server-supplied filter changes. Read URL as navigation input, never authorization.
- [ ] **Step 4: Add `onSelectNode` to GraphCanvas.** In main view, Enter/Space/plain-click select and keep a meaningful explicit Open Document link (including accessible/new-tab access); modified-click must not unexpectedly navigate to an unrelated URL. Unresolved ghost keeps its existing create/disabled affordance, never becomes a document focus.
- [ ] **Step 5: Wire** GraphExplorer selected focus and canvas callback; keep hover transient and selected persistent. Validate with Playwright: click node changes focus URL, stays on `/graph`, does not reset SVG `translate/scale`. Existing LocalGraph node click still opens its document.
- [ ] **Step 6: Run** targeted unit and `tests/e2e/workspace-graph.spec.ts` (DB/browser setup per `CLAUDE.md`). Expected: PASS after updating obsolete assertions that expected main-Graph document navigation.
- [ ] **Step 7: Commit** `feat: make main graph nodes selectable without changing inspector links`.

### Task 2: Fixed detail shell, Graph/List parity and selected state

**Files:**
- Create: `src/components/knowledge/connection-detail-panel.tsx`
- Modify: `src/components/knowledge/graph-explorer.tsx`, `src/components/knowledge/graph-list.tsx`, `src/app/w/[workspaceId]/graph/page.tsx`, `src/components/shell/primary-nav.tsx`
- Test: `tests/e2e/workspace-graph.spec.ts`, `tests/unit/connection-selection.test.ts`

**Interfaces:**
- `ConnectionDetailPanel({focusId, onClose, children})` hosts summary/evidence in subsequent tasks.
- `GraphList` adds `selectedDocumentId?: string | null` and `onSelectNode?: (id: string) => void` while retaining explicit links to document pages.

- [ ] **Step 1: Add failing interaction E2E assertions:** selected document opens desktop right panel; header displays node title and Open Document; Graph/List both select same focus; close returns to full-width Overview; no extra sidebar item; Page title/navigation says Connections while URL remains unchanged.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/workspace-graph.spec.ts --grep "select|Connections"`. Expected: FAIL (after fixture/startup).
- [ ] **Step 3: Implement** panel shell and responsive layout: graph/list area `minmax(0,1fr)` plus ~360px panel at wide widths; narrow displays a dismissible drawer/bottom sheet; panel scrolls independently; focus accessible and close restores focus. Do not remount `GraphCanvas` on panel open/close (its pan/zoom is local state).
- [ ] **Step 4: Implement** GraphList row selection separate from Open Document and selection state transfer on Graph ↔ List; hide panel when current focus disappears from authorized current filters without exposing hidden titles.
- [ ] **Step 5: Rename** nav and page title; audit action palette labels before changing them; keep legacy “graph” discoverability and bookmark route.
- [ ] **Step 6: Run** E2E selection, Graph/List keyboard, 1440px / ~1024px / phone layout; expected: PASS. Test that a slow response from previous selection does not populate a new panel (placeholder shell + Task 4/7 data).
- [ ] **Step 7: Commit** `feat: add responsive connections panel and graph-list selection parity`.

### Task 3: Read-only direct connection summary service

**Files:**
- Create: `src/modules/knowledge/domain/connection-summary.ts`
- Modify: `src/modules/knowledge/application/knowledge-link-service.ts`
- Test: `tests/unit/connection-summary.test.ts`, `tests/integration/connection-explorer.test.ts`

**Interfaces:**
- `KnowledgeLinkService.getConnectionSummary(caller: CallerContext, workspaceId: string, focusId: string): Promise<ConnectionSummary>`.
- `ConnectionSummary`: `{focusDocumentId,focusTitle,sourceName,incoming:ConnectionPair[],outgoing:ConnectionPair[],incomingTotal,outgoingTotal,truncated:{incoming:boolean,outgoing:boolean},graphIndexStale:boolean}`.
- `ConnectionPair`: `{fromDocumentId,toDocumentId,fromTitle,toTitle,count,ambiguous,inVisibleGraph:boolean}`. The `inVisibleGraph` bit is calculated in the **UI** from the current filtered `GraphViewData`, or accepted only as a derived projection parameter; it must not pretend the service knows user Graph filters.

- [ ] **Step 1: Write failing unit tests** using `resolveEdges`-style catalog/links fixtures: A→B repeated 3 times appears once with count 3; B→A is a different incoming pair; link to missing target is excluded from resolved pairs; no self-link; cross-source within same workspace allowed; ambiguous resolution is marked.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/connection-summary.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** a pure summary builder, signature `buildConnectionSummary(focusId: string, catalog: readonly CatalogDocument[], resolved: readonly ResolvedEdge[]): {incoming:ConnectionPair[];outgoing:ConnectionPair[]}`; use dedup by directional pair and deterministic sorting.
- [ ] **Step 4: Add failing MariaDB integration tests** using `tests/fixtures/link-graph.ts`: owner can read, `linkOutsider` cannot, wrong workspace ID is refused, archived source/doc neutral unavailable, total and truncation disclose caps without claiming completeness.
- [ ] **Step 5: Implement** `getConnectionSummary` through `unitOfWork.run`, `requireVisibleDocument` and explicit `policy.workspaceId === workspaceId`, active catalog/valid edges, Source name mapping, index health. Reuse one batch `loadValidEdges`; **no** N+1 Markdown reads. Set a bounded list count (suggest 200 / direction, true totals returned), with a truthful truncation flag.
- [ ] **Step 6: Run** targeted unit and integration tests. Expected: PASS; denied callers receive generic unavailable/not-found behavior, not titles.
- [ ] **Step 7: Commit** `feat: expose authorized direct connection summaries`.

### Task 4: Private summary route and panel connections list

**Files:**
- Create: `src/app/api/workspaces/[workspaceId]/connections/[documentId]/route.ts`, `src/components/knowledge/connection-data.ts`
- Modify: `src/components/knowledge/connection-detail-panel.tsx`, `src/components/knowledge/graph-explorer.tsx`
- Test: `tests/e2e/connection-explorer.spec.ts`, `tests/integration/connection-explorer.test.ts`

**Interfaces:**
- `GET /api/workspaces/:workspaceId/connections/:documentId` calls `services.links.getConnectionSummary(caller,workspaceId,documentId)` under `workspaceHttp`, `Cache-Control: private, no-store`.
- `fetchConnectionSummary(workspaceId: string, focusId: string, signal: AbortSignal): Promise<ConnectionSummary>`.

- [ ] **Step 1: Write failing E2E tests**: select A displays accurate Incoming/Outgoing count and direction, clicking row highlights it but does not change focus, counterpart offscreen due to source filter/cap is labeled “Not shown in current graph”; empty node shows zero direct connections.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/connection-explorer.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** GET route using `workspaceHttp` and strict ID/input checks, then typed `fetchConnectionSummary` helper with abort signal and no persistent cache.
- [ ] **Step 4: Implement** incoming/outgoing sections in the panel. Sort deterministically, preserve selected pair until focus changes; derive `inVisibleGraph` from GraphViewData nodes/edges rather than expecting the service to know current UI filters.
- [ ] **Step 5: Handle** summary loading/empty/failure/partial-index/truncation states; ignore aborted/late requests by comparing response identity to current `focusId`. Do not use visible graph's count as the authoritative full summary.
- [ ] **Step 6: Run** targeted E2E and integration tests, including direct GET for unauthorized workspace. Expected: PASS.
- [ ] **Step 7: Commit** `feat: load and display direct connection summaries on selection`.

### Task 5: Positional paragraph evidence extraction

**Files:**
- Create: `src/modules/knowledge/domain/connection-excerpt.ts`
- Modify: `src/modules/knowledge/domain/document-links.ts` (internal shared collection only)
- Test: `tests/unit/connection-excerpt.test.ts`, existing `tests/unit/document-links-extract.test.ts`

**Interfaces:**
- `extractDocumentLinksWithOffsets(markdown: string): Array<ExtractedLink & {startOffset:number}>` from `document-links.ts`. Must share the existing parser, sorting, escaped-link handling, link cap and ordinals; no persisted schema change.
- `getConnectionParagraphExcerpt(markdown: string, startOffset: number, limits?: {maxLines:8,maxCodePoints:600}): {text:string|null;truncated:boolean;kind:"PARAGRAPH"|"LIMITED_LINE"|"UNAVAILABLE"}`.

- [ ] **Step 1: Write failing unit tests**: two links on one line map to distinct ordinals/offsets; inline `[[Wiki|alias]]`, relative `.md`, list item, blockquote, multiline paragraph, Chinese paragraphs, table fallback, escaped link and code fence non-links; 9th line/601st Unicode code point truncates visibly and **keeps reference context**.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/connection-excerpt.test.ts tests/unit/document-links-extract.test.ts`. Expected: new tests FAIL, existing extraction PASS.
- [ ] **Step 3: Expose** `extractDocumentLinksWithOffsets` by factoring existing internal `collect` offset/ordinal sorting without duplicating parser or modifying indexed `ExtractedLink` format.
- [ ] **Step 4: Implement** paragraph lookup using `parseMarkdown` AST node offsets, selecting containing paragraph/paragraph-like node; return safe **plain text** (no HTML renderer). If unsupported, show `LIMITED_LINE` fallback; if no reliable span, `UNAVAILABLE`. Bound by 8 lines/600 code points, with no silent clipping.
- [ ] **Step 5: Run** both unit suites + `npx vitest run --config vitest.config.ts tests/unit/markdown-renderer-links.test.tsx`. Expected: PASS, no extractor/rendering regression.
- [ ] **Step 6: Commit** `feat: extract bounded paragraph evidence for exact link occurrences`.

### Task 6: Authenticated per-pair evidence service and API

**Files:**
- Modify: `src/modules/knowledge/application/knowledge-link-service.ts`
- Create: `src/app/api/workspaces/[workspaceId]/connection-evidence/route.ts`
- Test: `tests/integration/connection-explorer.test.ts`, `tests/unit/connection-excerpt.test.ts`

**Interfaces:**
- `KnowledgeLinkService.getConnectionEvidence(caller: CallerContext, workspaceId: string, fromId: string, toId: string, cursor?: string): Promise<ConnectionEvidenceResult>`.
- `ConnectionEvidenceResult = {status:"FOUND";fromDocumentId;toDocumentId;sourceRevisionNo;totalOccurrences;occurrences:Array<{ordinal;line;kind;writtenTarget;paragraphText;truncated;contextKind}>;nextCursor:string|null;ambiguous:boolean} | {status:"CHANGED";message:string}`.
- `GET /api/workspaces/:workspaceId/connection-evidence?from=:id&to=:id&cursor=:cursor` via `workspaceHttp`. Error semantics: invalid IDs = INVALID_REQUEST, inaccessible source/target = same neutral not-found; readable pair disappearing = `CHANGED`, never leak the contents of now-private documents.

- [ ] **Step 1: Write failing integration tests:** owner reads current source revision, 2 references to same B on same line return correct distinct ordinals, B→A doesn't enter A→B evidence, PATH and WIKI resolution agree, out-of-workspace link absent, archived/revoked source or target denied.
- [ ] **Step 2: Add cursor and race tests:** 11 references yields 10 and next cursor, invalid cursor rejected, cursor pinned to `revisionNo`, new revision between pages yields `CHANGED`; source/target renamed or link resolution altered yields `CHANGED`/neutral unavailable rather than stale evidence; no raw HTML execution.
- [ ] **Step 3: Run** `npx vitest run --config vitest.integration.config.ts tests/integration/connection-explorer.test.ts` (check exact project Vitest integration config if different). Expected: FAIL before service.
- [ ] **Step 4: Implement** service in a single `unitOfWork.run` using `requireVisibleDocument` for **both** IDs, exact Workspace match, `revisions.findCurrent(fromId)`, active catalog + **existing** `buildLinkResolver`, then filter located occurrences resolved to `toId`. Do **not** trust client count, graph IDs or prior permission. Reuse extracted offsets and excerpt helper on only selected source Markdown.
- [ ] **Step 5: Implement** revision-safe cursor encoding/validation (opaque base64url containing revision number and last ordinal; reject malformed and excessive length), cap page size at 10 and expose true count. Do not insert/expose a new database model.
- [ ] **Step 6: Implement** read route with `workspaceHttp`, explicit query parameter validation, no-store; ensure anonymous `/s/:token` grants do not apply. Add direct HTTP denied/invalid cases to test suite.
- [ ] **Step 7: Run** integration tests and `make test-unit`. Expected: PASS, with MariaDB local fixture up.
- [ ] **Step 8: Commit** `feat: fetch current authorized evidence for a directed link pair`.

### Task 7: Evidence UI and deliberate navigation

**Files:**
- Create: `src/components/knowledge/connection-evidence-view.tsx`
- Modify: `src/components/knowledge/connection-data.ts`, `connection-detail-panel.tsx`, `graph-explorer.tsx`
- Test: `tests/e2e/connection-explorer.spec.ts`

**Interfaces:**
- `fetchConnectionEvidence(workspaceId:string,fromId:string,toId:string,cursor:string|null,signal:AbortSignal):Promise<ConnectionEvidenceResult>`.
- `ConnectionEvidenceView({pair,onExploreNode,onOpenSource,onOpenTarget})` wired to current focus/pair; “Explore Node” changes focus only on explicit click.

- [ ] **Step 1: Write failing E2E tests** on two docs with repeated links: selecting pair renders source→target, current revision and first bounded paragraph; “Next occurrences” reveals later references; selecting pair alone keeps original focus; Explore Node changes focus and clears pair.
- [ ] **Step 2: Add failure/race tests:** late evidence for A→B cannot paint under A→C; stale revision shows “Connection changed — refresh”; “Reference only” for a bare link; 8-line / 600-codepoint truncation visibly labeled; invalidated permission hides evidence and shows neutral unavailability.
- [ ] **Step 3: Run** `npx playwright test tests/e2e/connection-explorer.spec.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** lazy, abortable evidence read; render safe text with explicit source/target links and revision/line. Use the current saved Source/Reader navigation; no false promise of line-deep-link when unsupported.
- [ ] **Step 5: Implement** Explore Node action: if counterpart is in current graph, change `focus` without relayout; if filtered/capped, show **Reveal in graph** before changing the filters; never silently grant visibility. Close clears focus while preserving zoom/pan.
- [ ] **Step 6: Run** E2E at 1440px, ~1024px and 390px viewport, keyboard only and touch interactions. Expected: PASS.
- [ ] **Step 7: Commit** `feat: browse connection evidence and explicitly explore adjacent documents`.

### Task 8: Regression, hardening and user-validation handoff

**Files:**
- Modify: `tests/e2e/workspace-graph.spec.ts` and focused new E2E tests
- Modify: relevant tests identified by stale “Graph” labels/old node-link expectation
- Optional: small `docs/superpowers/verification/2026-11-03-phase-1-connection-explorer-verification.md` with actual results (not fabricated)

**Interfaces:** No new production interface. Acceptance AC-01 through AC-10 in the approved spec must all have a corresponding assertion or documented manual check.

- [ ] **Step 1: Add regressions** for Document Inspector local graph navigation, Graph/List semantics, existing Link Index, Copy for Agent focus/neighborhood, incoming/outgoing direction, no-link, unresolved, ambiguous, stale, filtered and truncated states.
- [ ] **Step 2: Run** `make verify`, `make test-integration`, `make test-e2e`. Expected: all PASS. If an environment dependency is missing, record exact blocker and do **not** claim passes.
- [ ] **Step 3: Measure** graph stability and selected-query cost with a realistic generated Wiki import, including near the 1000-node cap; assert no N+1 full-Markdown reads or unbounded evidence payload.
- [ ] **Step 4: Conduct** three directed-link finding tasks with engineers, comparing prior Graph→Reader flow to Connection Explorer: record time-to-citation, incorrect inferred-dependency claims, and document navigation count. Do not expand to semantic graph without evidence that this helps.
- [ ] **Step 5: Write** actual verification record with tested commit, commands, observable pass/fail, known limits, screenshot links (if available) and measured results. Report limitations if user-study participants are unavailable.
- [ ] **Step 6: Commit** `test: verify connection explorer security accessibility and behavior`; request a fresh full-branch review before any merge.

---

## Implementation order and verification summary

`Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8`.

- **UI first** proves selection, layout and navigation without coupling them to backend read patterns.
- **Summary second** adds secure direction/counts and reveals offscreen links.
- **Evidence third** adds precise citation and paragraph context under current authorization.
- **Final gate** checks both code correctness and whether the added workflow measurably helps a real engineer.

**Spec-to-task audit:**
- Intent, D1–D6, Node Selection, URL, responsive: Tasks 1–2, 4, 7.
- Evidence D7, multiple occurrences, excerpt cap, revisions, pagination: Tasks 5–7.
- D8–D9, auth, explicit-link semantics, no GPU/DB schema: Tasks 3, 5, 6, 8.
- Error/truncation/stale, no-link, Graph/List/a11y: Tasks 3–4, 7–8.
- Technical performance and product validation: Task 8.

**Work not to start without separate approval:** changing product code, running migrations, deploying, or merging into `main`.

**Plan approval:** Pending user review and execution-mode choice.
