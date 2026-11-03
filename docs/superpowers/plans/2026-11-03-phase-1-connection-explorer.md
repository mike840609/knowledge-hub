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
- First implementation defaults: fixed right-hand panel `w-[360px]` (the replaced `maxWidth` scale has no 360 token; an arbitrary value compiles), side-by-side layout from the `lg` **viewport** breakpoint (a viewport breakpoint cannot measure content width, since the sidebar takes part of it), and below it the existing `src/components/ui/drawer.tsx`. Use existing visual-design tokens only (`text-body`, `rounded-md`, `shadow-popover`, …; `text-sm`/`rounded`/`shadow-sm` compile to nothing).
- **Test commands provision their own database.** Integration: `npx tsx scripts/test/integration.ts <files>` (or `make test-integration`). E2E: `npx tsx scripts/test/e2e.ts <files> [--grep …]` (or `make test-e2e`). Bare `npx vitest --config vitest.integration.config.ts` / `npx playwright test` skip the isolated DB, migrations and build, and must not be used. Unit: `npx vitest run --config vitest.config.ts <files>` (environment `node`: no DOM, no `window.history`).

## Shared types (single definition; the spec §7 mirrors it)

```ts
// Server (KnowledgeLinkService). The UI adds `inVisibleGraph` itself from GraphViewData.
type ConnectionSummary = {
  focusDocumentId: string; focusTitle: string; sourceName: string;
  incoming: ConnectionPair[]; outgoing: ConnectionPair[];
  incomingTotal: number; outgoingTotal: number;          // directed PAIRS, not occurrences
  truncated: { incoming: boolean; outgoing: boolean };    // list cap (200 / direction) hit
  unresolved: Array<{ kind: "WIKI" | "PATH"; writtenTarget: string; count: number }>; // focus doc's own outgoing, capped at 50
  unresolvedTotal: number;
  linksPossiblyCapped: boolean;                           // focus doc's indexed link count === MAX_LINKS_PER_DOCUMENT (2000)
  graphIndexStale: boolean;
};
type ConnectionPair = { fromDocumentId: string; toDocumentId: string; fromTitle: string; toTitle: string; count: number; ambiguous: boolean };

type EvidenceContextKind = "PARAGRAPH" | "REFERENCE_ONLY" | "LIMITED_LINE" | "UNAVAILABLE";
type ConnectionOccurrence = {
  ordinal: number; line: number; kind: "WIKI" | "PATH"; writtenTarget: string;
  contextKind: EvidenceContextKind; paragraphText: string | null; truncated: boolean;
};
type ConnectionEvidenceResult =
  | { status: "FOUND"; fromDocumentId: string; toDocumentId: string; sourceRevisionNo: number;
      totalOccurrences: number; occurrences: ConnectionOccurrence[]; nextCursor: string | null;
      ambiguous: boolean; linksPossiblyCapped: boolean }
  | { status: "CHANGED" }; // readable pair whose current revision no longer resolves, or cursor revision ≠ current
// A caller who may not read either document gets the route's neutral 404 (DOCUMENT_NOT_FOUND via
// workspaceHttp), identical for "does not exist" and "not allowed" — never CHANGED, never a title.
```

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
- Create: `src/components/knowledge/connection-selection.ts`, `src/components/knowledge/use-connection-focus.ts`, `src/components/knowledge/graph-focus-context.ts`
- Modify: `src/components/knowledge/graph-canvas.tsx`, `graph-explorer.tsx`, `src/app/w/[workspaceId]/graph/page.tsx`, `src/server/document-inspector-data.ts` (re-export only)
- Test: `tests/unit/connection-selection.test.ts`; update `tests/e2e/workspace-graph.spec.ts`

**Interfaces:**
- `GraphCanvas` adds optional `onSelectNode?: (documentId: string) => void`. If absent (Document Inspector), keep existing anchor navigation unchanged; if present (Connections), each DOCUMENT node stays an `<a href="/w/:id/graph?focus=:docId">` (so modified-click / middle-click / “open in new tab” open the graph focused on that node — the spec §6.2 “meaningful URL destination”), with `aria-label="Explore connections for {title}"`; a plain unmodified primary click calls `preventDefault()` + `onSelectNode`, and a `keydown` handler maps Space (SVG `<a>` does not activate on Space) as well as Enter to `onSelectNode`. The existing drag guard (`graph-canvas.tsx` `onPointerDown`: `closest("a")`) then keeps excluding selectable nodes, so a press on a node never starts a pan or captures the pointer.
- `useConnectionFocus({initialFocusId, documentIds})` returns `{focusId, selectFocus(documentId: string | null): void}` and is the **single source of `focusId`** for everything in `GraphExplorer`: every `graphQuery(...)` call (filter `change()`, the Graph/List view tabs, the empty-state “See as a list” link) builds from `{...filters, focusId}`, never from the server’s stale `filters.focusId`. `?focus=` represents **DOCUMENT** nodes only, never unresolved ghost IDs.
- `graphFocusContextHref` (pure, currently `src/server/document-inspector-data.ts:23`) moves to `src/components/knowledge/graph-focus-context.ts` (re-exported from the old location so the page keeps compiling). `page.tsx` passes `agentContextEligible: boolean` (Personal + `canSearch`) instead of a precomputed `agentContextHref`; `GraphExplorer` computes the Copy for Agent href from the live `focusId`, so it stays in sync after a client-only focus change.

- [ ] **Step 1: Write failing unit tests** in `connection-selection.test.ts` (pure, URL-in/URL-out — the unit environment is `node`): valid DOCUMENT focus accepted; invalid/unresolved/filtered focus ignored; setting/clearing focus preserves `source`, `orphans`, `unresolved`, `view`; a filter change built from the live focus keeps it; `graphFocusContextHref` follows the live focus (`around=B` after selecting B) and returns `null` when ineligible.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/connection-selection.test.ts`. Expected: FAIL before implementation.
- [ ] **Step 3: Implement** `connection-selection.ts` pure helpers, `graph-focus-context.ts`, and `use-connection-focus.ts`. Focus-only updates use `window.history.pushState` so the Graph is not server-refetched; a `popstate` listener re-reads `focus`; a server-supplied `filters.focusId` change (real navigation) resets local state. Read the URL as navigation input, never authorization.
- [ ] **Step 4: Add `onSelectNode` to GraphCanvas** as specified above. Unresolved ghost keeps its existing create/disabled affordance, never becomes a document focus. The panel (Task 2) holds the explicit Open Document link. Persistent selection is not overridden by hover: replace `emphasised = hovered ?? focusId` with a separate selected style that hover cannot remove.
- [ ] **Step 5: Wire** GraphExplorer to `useConnectionFocus`, the canvas callback and the live Copy for Agent href. Playwright: plain click changes `?focus=`, stays on `/graph`, does not change SVG `translate/scale`; Space and Enter on a focused node select; click-without-drag selects (no pan); ctrl/cmd-click yields a new page at `/graph?focus=…`; select B then change the Source filter → focus stays B and Copy for Agent href contains `around=B`; browser back restores the previous focus; hovering another node keeps the selected style; LocalGraph node click in the Inspector still opens its document.
- [ ] **Step 6: Run** the unit file and `npx tsx scripts/test/e2e.ts tests/e2e/workspace-graph.spec.ts`. Expected: PASS after updating obsolete assertions that expected main-Graph document navigation.
- [ ] **Step 7: Commit** `feat: make main graph nodes selectable without changing inspector links`.

### Task 2: Fixed detail shell, Graph/List parity and selected state

**Files:**
- Create: `src/components/knowledge/connection-detail-panel.tsx`
- Modify: `src/components/knowledge/graph-explorer.tsx`, `src/components/knowledge/graph-list.tsx`, `src/app/w/[workspaceId]/graph/page.tsx`, `src/components/shell/primary-nav.tsx`
- Reuse: `src/components/ui/drawer.tsx` for the narrow layout
- Test: `tests/e2e/workspace-graph.spec.ts`, `tests/unit/connection-selection.test.ts`; label updates in `tests/e2e/menus.spec.ts:81`, `tests/e2e/workspace-graph.spec.ts:61,63,114`, and the `route.startsWith('graph')?'Graph'` heading in `tests/e2e/00-ui-{agent,discovery,governance,insights}-comparison.spec.ts`

**Interfaces:**
- `ConnectionDetailPanel({focusId, onClose, children})` hosts summary/evidence in subsequent tasks.
- `GraphList` adds `selectedDocumentId?: string | null` and `onSelectNode?: (id: string) => void` while retaining explicit links to document pages.

- [ ] **Step 1: Add failing interaction E2E assertions:** selected document opens desktop right panel; header displays node title and Open Document; Graph/List both select same focus; close returns to full-width Overview; no extra sidebar item; Page title/navigation says Connections while URL remains unchanged.
- [ ] **Step 2: Run** `npx tsx scripts/test/e2e.ts tests/e2e/workspace-graph.spec.ts --grep "select|Connections"`. Expected: FAIL.
- [ ] **Step 3: Implement** panel shell and responsive layout: from `lg`, graph/list area `minmax(0,1fr)` plus a `w-[360px]` panel; below `lg`, the existing `Drawer`; panel scrolls independently; focus accessible and close restores focus. Do not remount `GraphCanvas` on panel open/close (its pan/zoom is local state).
- [ ] **Step 4: Implement** GraphList row selection separate from Open Document and selection state transfer on Graph ↔ List; hide panel when current focus disappears from authorized current filters without exposing hidden titles.
- [ ] **Step 5: Rename** the primary-nav item and the page heading to “Connections” (the Graph/List **view tab** at `graph-explorer.tsx:120` stays “Graph”); audit action palette labels before changing them; keep legacy “graph” discoverability and the bookmark route. **In the same step**, update the label assertions listed under *Test* so the suite stays green from this task on.
- [ ] **Step 6: Run** `npx tsx scripts/test/e2e.ts tests/e2e/workspace-graph.spec.ts tests/e2e/menus.spec.ts` plus the four `00-ui-*-comparison` specs, covering selection, Graph/List keyboard and 1440px / 1024px / 390px layouts. Expected: PASS. (The stale-response race is tested in Task 4, once a fetch exists.)
- [ ] **Step 7: Commit** `feat: add responsive connections panel and graph-list selection parity`.

### Task 3: Read-only direct connection summary service

**Files:**
- Create: `src/modules/knowledge/domain/connection-summary.ts`
- Modify: `src/modules/knowledge/application/knowledge-link-service.ts`
- Test: `tests/unit/connection-summary.test.ts`, `tests/integration/connection-explorer.test.ts`

**Interfaces:**
- `KnowledgeLinkService.getConnectionSummary(caller: CallerContext, workspaceId: string, focusId: string): Promise<ConnectionSummary>`.
- `ConnectionSummary` / `ConnectionPair`: exactly as in **Shared types** above. The **UI** derives `inVisibleGraph` from its filtered `GraphViewData`; the service must not pretend it knows user Graph filters.

- [ ] **Step 1: Write failing unit tests** using `resolveEdges`-style catalog/links fixtures: A→B repeated 3 times appears once with count 3; B→A is a different incoming pair; a link to a missing target is excluded from pairs **and** listed in `unresolved` with its written target and count (no invented ID); no self-link; cross-source within same workspace allowed; ambiguous resolution is marked; `incomingTotal`/`outgoingTotal` count pairs, not occurrences.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/connection-summary.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** a pure summary builder, signature `buildConnectionSummary(focusId: string, catalog: readonly CatalogDocument[], links: …): {incoming:ConnectionPair[];outgoing:ConnectionPair[];unresolved:…}`; dedup by directional pair, deterministic sorting.
- [ ] **Step 4: Add failing MariaDB integration tests** using `tests/fixtures/link-graph.ts`: owner can read; `linkOutsider` gets the neutral 404 and the response body carries no title; wrong workspace ID is refused; focus document archived → neutral unavailable; **an archived counterpart is absent** from incoming/outgoing; total and truncation disclose caps without claiming completeness; a focus document with exactly 2000 indexed links sets `linksPossiblyCapped`.
- [ ] **Step 5: Implement** `getConnectionSummary` through `unitOfWork.run`, `requireVisibleDocument` and explicit `policy.workspaceId === workspaceId`, active catalog/valid edges, Source name mapping, index health. Reuse one batch `loadValidEdges`; **no** N+1 Markdown reads. Bounded list count (200 / direction, true totals returned), truthful truncation flag; `linksPossiblyCapped` when the focus document's indexed link count equals `MAX_LINKS_PER_DOCUMENT`.
- [ ] **Step 6: Run** the unit file and `npx tsx scripts/test/integration.ts tests/integration/connection-explorer.test.ts`. Expected: PASS; denied callers receive the neutral not-found, never titles.
- [ ] **Step 7: Commit** `feat: expose authorized direct connection summaries`.

### Task 4: Private summary route and panel connections list

**Files:**
- Create: `src/app/api/workspaces/[workspaceId]/connections/[documentId]/route.ts`, `src/components/knowledge/connection-data.ts`
- Modify: `src/components/knowledge/connection-detail-panel.tsx`, `src/components/knowledge/graph-explorer.tsx`
- Test: `tests/e2e/connection-explorer.spec.ts`, `tests/integration/connection-explorer.test.ts`

**Interfaces:**
- `GET /api/workspaces/:workspaceId/connections/:documentId` calls `services.links.getConnectionSummary(caller,workspaceId,documentId)` under `workspaceHttp`, `Cache-Control: private, no-store`.
- `fetchConnectionSummary(workspaceId: string, focusId: string, signal: AbortSignal): Promise<ConnectionSummary>`.

- [ ] **Step 1: Write failing E2E tests**: select A displays accurate Incoming/Outgoing count and direction, clicking row highlights it but does not change focus, counterpart offscreen due to source filter/cap is labeled “Not shown in current graph”; empty node shows zero direct connections; an unresolved `[[…]]` in A appears as “Unresolved reference” with its written target; a slow summary for A (delayed via `page.route`) does not populate the panel after B is selected.
- [ ] **Step 2: Run** `npx tsx scripts/test/e2e.ts tests/e2e/connection-explorer.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** GET route using `workspaceHttp` and strict ID/input checks, then typed `fetchConnectionSummary` helper with abort signal and no persistent cache.
- [ ] **Step 4: Implement** incoming/outgoing sections in the panel. Sort deterministically, preserve selected pair until focus changes; derive `inVisibleGraph` from GraphViewData nodes/edges rather than expecting the service to know current UI filters.
- [ ] **Step 5: Handle** summary loading/empty/failure/partial-index/truncation/`linksPossiblyCapped` (“this document has 2000+ links; only the first 2000 are indexed”) states; ignore aborted/late requests by comparing response identity to current `focusId`. Do not use visible graph's count as the authoritative full summary.
- [ ] **Step 6: Run** targeted E2E and integration tests, including direct GET for unauthorized workspace. Expected: PASS.
- [ ] **Step 7: Commit** `feat: load and display direct connection summaries on selection`.

### Task 5: Positional paragraph evidence extraction

**Files:**
- Create: `src/modules/knowledge/domain/connection-excerpt.ts`
- Modify: `src/modules/knowledge/domain/document-links.ts` (internal shared collection only)
- Test: `tests/unit/connection-excerpt.test.ts`, existing `tests/unit/document-links-extract.test.ts`

**Interfaces:**
- `extractDocumentLinksWithOffsets(markdown: string): {tree: Root; links: Array<ExtractedLink & {startOffset:number}>; capped: boolean}` from `document-links.ts`. **One parse per call**, and the `tree` is handed on so excerpting never parses again (parsing is ~1.7 ms/KB; re-parsing per occurrence would cost ~3.7 s for a 200 KB page of 10 occurrences). Shares the existing parser, sorting, escaped-link handling, `MAX_LINKS_PER_DOCUMENT` cap and ordinals; `capped` is true when the cap cut links off. No persisted schema change.
- `getConnectionParagraphExcerpt(markdown: string, tree: Root, startOffset: number, limits?: {maxLines?:number;maxCodePoints?:number}): {contextKind: EvidenceContextKind; text: string|null; truncated: boolean}`.
- Excerpt text is the **raw source slice** of the enclosing block (`markdown.slice(block.start.offset, block.end.offset)`), shown as React-escaped text. A raw slice keeps `[x](b.md)` and `[[B|alias]]` recognisable; `mdast toString` would hide one and not the other. `REFERENCE_ONLY` when the block's text, trimmed, is the link itself. Caps: 8 **source lines** and 600 **code points of that slice**, centred on `startOffset` when cut.
- Wikilink `startOffset` is `text-node offset + match.index` (`document-links.ts:228`), an index into the *unescaped* value; escapes/entities before the link shift it left. It still falls inside the same block (containment is safe), but centring must clamp to the block.

- [ ] **Step 1: Write failing unit tests**: two links on one line map to distinct ordinals/offsets; inline `[[Wiki|alias]]`, relative `.md`, list item, blockquote, multiline paragraph, Chinese paragraphs, table fallback (`LIMITED_LINE`), standalone `[[B]]` (`REFERENCE_ONLY`), escaped link and code fence non-links; `\*a\* [[B]]` and `&amp; [[B]]` still excerpt the right block; 9th line/601st code point truncates visibly and **keeps the reference in the window**; >2000 links sets `capped`; the extractor's existing `extractDocumentLinks` output is byte-identical.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/connection-excerpt.test.ts tests/unit/document-links-extract.test.ts`. Expected: new tests FAIL, existing extraction PASS.
- [ ] **Step 3: Expose** `extractDocumentLinksWithOffsets` by factoring existing internal `collect` offset/ordinal sorting without duplicating parser or modifying indexed `ExtractedLink` format; `extractDocumentLinks` becomes a thin wrapper.
- [ ] **Step 4: Implement** paragraph lookup over the passed `tree` (no second parse), selecting the containing paragraph/paragraph-like node; return the raw slice as plain text (no HTML renderer). Unsupported block → `LIMITED_LINE` (the matched source line); no reliable span → `UNAVAILABLE` with `text: null`. Bound by 8 lines/600 code points, with no silent clipping.
- [ ] **Step 5: Run** both unit suites + `npx vitest run --config vitest.config.ts tests/unit/markdown-renderer-links.test.tsx`. Expected: PASS, no extractor/rendering regression.
- [ ] **Step 6: Commit** `feat: extract bounded paragraph evidence for exact link occurrences`.

### Task 6: Authenticated per-pair evidence service and API

**Files:**
- Modify: `src/modules/knowledge/application/knowledge-link-service.ts`
- Create: `src/app/api/workspaces/[workspaceId]/connection-evidence/route.ts`
- Modify: `tests/unit/share-link-single-exception.test.ts` (share-page guard)
- Test: `tests/integration/connection-explorer.test.ts`, `tests/unit/connection-excerpt.test.ts`

**Interfaces:**
- `KnowledgeLinkService.getConnectionEvidence(caller: CallerContext, workspaceId: string, fromId: string, toId: string, cursor?: string): Promise<ConnectionEvidenceResult>` — `ConnectionEvidenceResult` exactly as in **Shared types**.
- `GET /api/workspaces/:workspaceId/connection-evidence?from=:id&to=:id&cursor=:cursor` via `workspaceHttp`. Error semantics, one rule each: invalid IDs/cursor → `INVALID_REQUEST`; either document not readable by this caller (nonexistent, archived, other Workspace, not a member) → the neutral 404, identical in all those cases; both readable but the current source revision no longer resolves a link to `toId`, or the cursor's revision ≠ current → `{status:"CHANGED"}`. `CHANGED` carries no message, title or text.

- [ ] **Step 1: Write failing integration tests:** owner reads current source revision, 2 references to same B on same line return correct distinct ordinals, B→A doesn't enter A→B evidence, PATH and WIKI resolution agree, out-of-workspace link absent, archived/revoked source or target → neutral 404 with no title in the body.
- [ ] **Step 2: Add cursor and race tests:** 11 references yields 10 and next cursor, invalid cursor rejected, cursor pinned to `revisionNo`, new revision between pages yields `CHANGED`; link removed or retargeted in a new revision yields `CHANGED`; a `<script>` / `<img onerror>` paragraph comes back as the literal characters (rendering is checked in Task 7).
- [ ] **Step 3: Extend the share-page guard** in `tests/unit/share-link-single-exception.test.ts` (the `/s/:token` link-services test, ~line 112): add `getConnectionSummary|getConnectionEvidence` to the `.links.(…)` alternation, and `connection-data|/connections/|connection-evidence` as forbidden in files under `src/app/s`, `src/server/share-read.ts` and `src/components/knowledge/shared-reading.tsx`. Confirm it fails when one such import is added on purpose, then remove it.
- [ ] **Step 4: Run** `npx tsx scripts/test/integration.ts tests/integration/connection-explorer.test.ts`. Expected: FAIL before service.
- [ ] **Step 5: Implement** service in a single `unitOfWork.run` using `requireVisibleDocument` for **both** IDs, exact Workspace match, `revisions.findCurrent(fromId)`, active catalog + **existing** `buildLinkResolver`, then filter located occurrences resolved to `toId`. Do **not** trust client count, graph IDs or prior permission. Call `extractDocumentLinksWithOffsets` **once** and pass its `tree` to every excerpt; set `linksPossiblyCapped` from its `capped`.
- [ ] **Step 6: Implement** revision-safe cursor encoding/validation (opaque base64url containing revision number and last ordinal; reject malformed and excessive length), cap page size at 10 and expose true count. Do not insert/expose a new database model.
- [ ] **Step 7: Implement** read route with `workspaceHttp`, explicit query parameter validation, no-store; ensure anonymous `/s/:token` grants do not apply. Add direct HTTP denied/invalid cases to test suite.
- [ ] **Step 8: Run** `npx tsx scripts/test/integration.ts tests/integration/connection-explorer.test.ts` and `make test-unit`. Expected: PASS.
- [ ] **Step 9: Commit** `feat: fetch current authorized evidence for a directed link pair`.

### Task 7: Evidence UI and deliberate navigation

**Files:**
- Create: `src/components/knowledge/connection-evidence-view.tsx`
- Modify: `src/components/knowledge/connection-data.ts`, `connection-detail-panel.tsx`, `graph-explorer.tsx`
- Test: `tests/e2e/connection-explorer.spec.ts`

**Interfaces:**
- `fetchConnectionEvidence(workspaceId:string,fromId:string,toId:string,cursor:string|null,signal:AbortSignal):Promise<ConnectionEvidenceResult>`.
- `ConnectionEvidenceView({pair,onExploreNode,onOpenSource,onOpenTarget})` wired to current focus/pair; “Explore Node” changes focus only on explicit click.

- [ ] **Step 1: Write failing E2E tests** on two docs with repeated links: selecting pair renders source→target, current revision and first bounded paragraph; “Next occurrences” reveals later references; selecting pair alone keeps original focus; Explore Node changes focus and clears pair.
- [ ] **Step 2: Add failure/race tests:** late evidence for A→B cannot paint under A→C; stale revision shows “Connection changed — refresh”; “Reference only” for a bare link; 8-line / 600-codepoint truncation visibly labeled; invalidated permission hides evidence and shows neutral unavailability; a paragraph containing `<img src=x onerror=…>` and `<script>` renders as visible text, adds no `img`/`script` element to the panel, and fires no dialog.
- [ ] **Step 3: Run** `npx tsx scripts/test/e2e.ts tests/e2e/connection-explorer.spec.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** lazy, abortable evidence read; render safe text with explicit source/target links and revision/line. Use the current saved Source/Reader navigation; no false promise of line-deep-link when unsupported.
- [ ] **Step 5: Implement** Explore Node action: if counterpart is in current graph, change `focus` without relayout; if filtered/capped, show **Reveal in graph** before changing the filters; never silently grant visibility. Close clears focus while preserving zoom/pan.
- [ ] **Step 6: Run** E2E at 1440px, ~1024px and 390px viewport, keyboard only and touch interactions. Expected: PASS.
- [ ] **Step 7: Commit** `feat: browse connection evidence and explicitly explore adjacent documents`.

### Task 8: Regression, hardening and user-validation handoff

**Files:**
- Modify: `tests/e2e/workspace-graph.spec.ts` and focused new E2E tests
- Modify: any remaining test with the old main-Graph node-click-navigates expectation (labels were already updated in Task 2)
- Modify: `docs/superpowers/specs/2026-09-29-personal-workspace-knowledge-graph-design.md` — mark as superseded by this phase's spec: the overview's “click to read” (~line 90), §10.4's “Click uses client navigation” and “focus filters use … server recomputation” (~line 317; focus is now client history, filters still server), and the walkthrough's “click A opens it” (~line 382). Mark in place; do not delete.
- Modify: `README.md` “Current canonical documents” row *Knowledge links and graph* (~line 363) — add this spec and plan beside the 2026-09-29 ones.
- Optional: small `docs/superpowers/verification/2026-11-03-phase-1-connection-explorer-verification.md` with actual results (not fabricated)

**Interfaces:** No new production interface. Acceptance AC-01 through AC-10 in the approved spec must all have a corresponding assertion or documented manual check.

- [ ] **Step 1: Add regressions** for Document Inspector local graph navigation, Graph/List semantics, existing Link Index, Copy for Agent focus/neighborhood, incoming/outgoing direction, no-link, unresolved, ambiguous, stale, filtered and truncated states.
- [ ] **Step 1b: Record the deviation** in the 2026-09-29 graph spec and the README canonical table, as listed under *Files*.
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
- Unresolved references (§6.3, §8, AC-08) and 2000-link cap disclosure (§7.1): Tasks 3–5.
- Share-link non-exposure (§9, AC-09) enforced by guard test: Task 6 Step 3.
- Recording the change to the canonical graph spec (CLAUDE.md documentation workflow): Task 8.

**Work not to start without separate approval:** changing product code, running migrations, deploying, or merging into `main`.

**Plan approval:** Pending user review and execution-mode choice.
