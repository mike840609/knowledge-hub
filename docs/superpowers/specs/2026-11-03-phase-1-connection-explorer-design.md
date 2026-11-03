# Phase 1 — Connection Explorer (Evidence-first Direct Links)

- **Status:** DRAFT — For review only; not approved for implementation
- **Date:** 2026-11-03
- **Product direction:** Knowledge Understanding Through Connections
- **Route:** `/w/:workspaceId/graph` (existing route, proposed display name **Connections**)
- **Type:** New product-direction Phase 1, **not** historical Phase 1 Core Tree
- **Dependency:** Existing knowledge link index, graph, source read authorization, current revisions
- **Approvals:** None yet. No implementation is authorized by this document.

## 1. Intent and problem

Knowledge Hub ingests agent-generated Markdown Wiki folders and already offers links, backlinks, local/workspace graphs, search, revisions and Copy for Agent. The existing graph shows **which documents reference each other**, but it does not let a reader inspect a relationship and its evidence while remaining in the graph. A node click currently opens a document, which makes the graph a visual link directory.

Phase 1 makes **connection inspection** the primary graph workflow: choose one document, inspect incoming and outgoing references, select a specific direction/pair, read a bounded paragraph of original source evidence, then deliberately open the original document or explore the related node. It does **not** claim that a Markdown link proves any service call, dependency, or technical conclusion.

This is a UX/product differentiation experiment, not a claim that TKMS could not implement the same functionality.

### Success hypothesis

Given a real set of generated engineering Wikis with explicit links, an engineer can identify *where a particular document-to-document connection comes from* with fewer context switches than today's Graph → Document → Backlinks workflow. Measure task completion and errors on actual Wikis before pursuing semantic connections or multi-hop paths.

## 2. Confirmed decisions from brainstorming

| ID | User-confirmed decision |
| --- | --- |
| D1 | **Connection-first**, not Document-first |
| D2 | Upgrade the existing Graph navigation item to **Connections**; no new sidebar item/page; preserve URL |
| D3 | Main Graph node click **selects** the node; it no longer navigates directly to the document |
| D4 | Selected node opens a **fixed right-hand Detail Panel** on desktop |
| D5 | Clicking a connection row **shows evidence**, does not change the exploration focus |
| D6 | Only an explicit **Explore Node** action changes the focus to the connected document |
| D7 | Evidence scope: **bounded paragraph context** around each actual Markdown reference |
| D8 | Phase 1 uses **explicit Markdown links only** and is CPU-only; no LLM/GPU, concept extraction or technical inference |
| D9 | Preserve existing workspace security and no dependence on TKMS |

## 3. Existing implementation and invariants

These are already present; do not recreate them:

- `src/modules/knowledge/domain/document-links.ts` extracts `[[wikilinks]]` and relative Markdown links with `line` and `ordinal`, from the saved Markdown body.
- `src/modules/knowledge/domain/link-graph.ts` resolves edges within one workspace. `GraphEdge` contains `from`, `to` and aggregate `count`, **not** individual occurrences or paragraphs.
- `src/modules/knowledge/application/knowledge-link-service.ts` exposes outgoing links, backlinks, existing limited backlink context, and workspace/local graphs. Its current backlink response caps are 200 rows and 50 snippets. Outgoing rows are grouped, not evidence-rich.
- `src/components/knowledge/graph-canvas.tsx` draws many edges as combined SVG paths, and nodes currently navigate as anchors. It is also used by the smaller **Document Inspector local graph**.
- `src/components/knowledge/graph-list.tsx` is the accessibility/mobile alternative to the graph and currently opens documents.
- `src/components/knowledge/graph-explorer.tsx` owns Graph/List mode, filters, search and URL; `?focus=` already means a highlighted graph document, also used by Copy for Agent.
- `docs/superpowers/specs/2026-11-03-graph-neighbourhood-agent-context-design.md` is already implemented: focus/neighbourhood can preselect Copy for Agent and add a Links section. Preserve its scope (Personal workspace, permission checks, 20 documents / 256 KiB) without rebuilding it.
- `CLAUDE.md`: graph/index is **derived, not an access grant**. Links resolve only within the current workspace. A shared-page token never grants workspace graph/evidence reads. Source-managed content is read-only. Source, Workspace and document scopes must not be duplicated or inferred from URL parameters. Document content must not become raw HTML.

## 4. Goals, non-goals and anti-goals

### Goals

1. Explore a document's **incoming and outgoing** direct references without leaving the Connections page.
2. For a specific **directed document pair**, inspect each available occurrence with source document, line number, current source revision, link target and bounded paragraph excerpt.
3. Preserve spatial context: selecting nodes/connections must not relayout the graph or reset its pan/zoom.
4. Offer explicit **Open Source**, **Open Target** and **Explore Node** actions.
5. Support equivalent selection and evidence inspection in Graph and List modes, keyboard and touch.
6. Keep evidence truthful, permission-checked, lazy-loaded and safe with large graphs and long documents.

### Non-goals

- New document editor, review/approval, sharing, notifications, TKMS publishing, MCP API or Wiki generator.
- Semantic/embedding search, AI-generated relationship explanations, inferred service/data-flow dependencies, typed engineering knowledge graph, multi-hop path finding.
- Cross-workspace graph resolution or any cross-workspace permission bypass.
- Persisting connection-specific new business entities, historical graph snapshots or schema changes.
- Rewriting Markdown links or creating content from Connection Detail.
- Refactoring the Document Inspector local graph's navigation behavior.

### Anti-goals

- Never label a document reference as a verified *service dependency*.
- Never eagerly load all linked documents' Markdown with the graph.
- Never leak links/excerpts to callers lacking the source **and** target document read access.
- Never silently show partial/truncated link counts as complete.
- Never imply that a valid source line proves a generated technical assertion.

## 5. Approaches evaluated

| Approach | Benefits | Costs / outcome |
| --- | --- | --- |
| A. Enrich each Graph edge with all reference paragraphs at initial load | One round trip after page load | Large data payload, privacy and performance risks; rejected |
| **B. Reuse existing Graph + lazy Connection Summary + per-pair Evidence** | Small initial payload, no new storage or inference, best fit for existing services | Requires dedicated authorized read projections; **selected** |
| C. Build a new relationship database / graph service | Could support future typed/semantic relationships | Premature new model, index sync, schema, complexity; rejected |

**Implementation approach selected for this draft:** B. Exact API naming is a builder-level call as long as the contracts and authorization below hold.

## 6. User interaction and state machine

### 6.1 Modes

- **Overview:** no selected node; graph fills the content area; all existing filters, highlighting, zoom, pan and Graph/List affordances continue to work.
- **Node selected:** `focus` identifies one visible, authorized `DOCUMENT` node. Desktop graph/list and a fixed right panel share the content width; highlight the selected node and its direct visible neighbors. Panel shows name, Source, Incoming and Outgoing groups, count caveats and **Open Document**.
- **Connection selected:** selected node stays fixed. A row representing a directed pair (`fromId` → `toId`) reveals evidence in the same panel. Changing rows replaces only the evidence section. Do not switch the selected node.
- **Explore Node:** explicit action sets `focus` to the counterpart document, clears the selected pair, keeps graph zoom and pan when possible; if hidden by a Source/filter, offer **Reveal in graph** first rather than silently changing filters.
- **Close Panel:** clear `focus`, return to Overview without resetting graph viewport.

### 6.2 Selection, navigation and URL

- Preserve `/w/:workspaceId/graph` and the existing `?focus=<documentId>` key. It is a *navigation input only*, checked against the filtered, authorized visible graph. Invalid/hidden IDs do not reveal a panel or existence details.
- A pair selection is **ephemeral in v1**, not another URL parameter. Returning to a focused graph restores node selection, not necessarily the specific evidence occurrence.
- Node clicks update URL focus without causing server-side graph relayout; preserve client zoom/pan. Browser back/forward and refresh must synchronize the selected node. An implementation may use Next-compatible client history for focus-only changes; whichever technique is chosen must also keep the existing Copy for Agent link in sync with focus.
- **Main Connections Graph** has a select-node interaction; the same shared `GraphCanvas` in the **Document Inspector** continues to open documents as before. Make mode/handler distinction explicit, not implicit in touch/hover.
- Main Graph node should be keyboard-operable with accessible “Explore connections for [title]” semantics; Enter and Space select. Modified-click/new-tab behavior must have a meaningful URL destination. The panel contains an unambiguous Open Document link.
- **Graph List** must offer an equally accessible Select / Explore Connections action **and** Open Document, with selected row state preserved when toggling views.
- Graph hover transient emphasis must not override persistent selected emphasis. Selection must not re-run server force layout. Panel open/close must not steal keyboard focus; close restores sensible focus.
- Selecting a row must distinguish **direction** (A→B versus B→A), even if both reference each other. Same pair repeated references belong under one row with count and individual occurrences.

### 6.3 Panel and responsive layout — proposed UI defaults

- Desktop (approximately ≥1024px content viewport): graph/list `minmax(0,1fr)` plus fixed-width right panel (proposed **360px**, allow resizing only in later work); only panel content scrolls independently.
- At narrower widths: nonblocking drawer or bottom sheet, with graph/List still navigable, explicit dismiss button and responsive accessible focus behavior. Do not introduce a new global sidebar menu.
- Header: selected document title, Source, Open Document, Close.
- Connections: Incoming, Outgoing, direction arrows, pair reference count, pending/unresolved/ambiguous hints, connection selection indicator.
- Evidence: source → target, source version and line, literal link target, paragraph excerpt, truncated indicator, previous/next occurrence when needed; Open Source / Open Target / Explore Node.
- Display “Document A references Document B”, not “A depends on B” or AI-generated “Why related”.
- Existing Page title/sidebar label may become “Connections”; URL and stored links stay unchanged. Do not add new primary navigation item.

## 7. Connection summary and evidence data

### 7.1 Summary contract (illustrative)

```ts
type ConnectionSummary = {
  focusDocumentId: string;
  focusTitle: string;
  sourceName: string;
  incoming: ConnectionPair[];
  outgoing: ConnectionPair[];
  incomingTotal: number;
  outgoingTotal: number;
  truncated: { incoming: boolean; outgoing: boolean };
  graphIndexStale: boolean;
};

type ConnectionPair = {
  fromDocumentId: string;
  toDocumentId: string;
  fromTitle: string;
  toTitle: string;
  count: number;
  ambiguous: boolean;
  /** Whether this pair is in the currently displayed graph; may be false due to filters/caps. */
  inVisibleGraph: boolean;
};
```

- One selected node triggers **one lazy authorized summary read**. Do not attach complete Markdown to `WorkspaceGraphView`.
- Summary should describe **all permitted direct relationships within that workspace**, not falsely claim the graph-filtered subset is complete. If a counterpart is outside a visible source filter or node cap, label “Not shown in current graph” and provide Open Document / optional Reveal in graph.
- Preserve existing graph limits (1000 displayed nodes; local neighborhood 60). The existing backlink cap (200) and extractor limit (2000 links/document) must be made explicit in UI; do not display 200 as a total if more exist. The initial panel may show fewer rows with an explicit “More” affordance or truthful capped indication.
- A pair where A references B and B references A is **two directed pairs**. A repeated `[[B]]` in A produces multiple evidence occurrences for A→B, not multiple summary rows.
- Unresolved targets may be listed separately as “Unresolved reference” without inventing a target ID. Pair evidence applies to **resolved** document pairs; handling unresolved raw references in an evidence view may be deferred.

### 7.2 Evidence contract (illustrative)

```ts
type ConnectionEvidenceResult =
  | { status: "FOUND"; fromDocumentId: string; toDocumentId: string;
      sourceRevisionNo: number; totalOccurrences: number;
      occurrences: Array<{
        ordinal: number; line: number;
        kind: "WIKI" | "PATH"; writtenTarget: string;
        paragraphText: string | null;
        truncated: boolean;
      }>;
      nextCursor: string | null;
      ambiguous: boolean;
    }
  | { status: "CHANGED"; message: string }; // same private-safe response for stale/nonexistent pairs
```

- Evidence is loaded **only after a user selects a directed pair**. Use a dedicated read-only query, not the entire Workspace Graph plus all Markdown excerpts.
- Validate authenticated caller, Workspace, source document, target document, active Source/document policies and read access **before** returning titles/Markdown. The link index never grants access. Do not expose evidence on anonymous or share-link routes.
- Read current source revision and catalog in one authorized read unit; extract current Markdown links with the existing extractor, resolve with the **existing resolver**, and retain occurrences resolving to the requested target. Verify that the pair still exists before returning excerpts.
- The existing Link Index is a derived accelerator. If the source revision or link resolution changed since the graph loaded, return CHANGED / “Connection changed — refresh” rather than a fabricated/extraneous paragraph. Do not infer a graph edge if there is no current resolvable reference.
- Include true `line` and `ordinal`, which distinguish multiple links on the same line. Source revision ties the excerpt to its exact saved source content; links should navigate using the existing reader semantics and may use line/heading deep link only where reliably supported.
- **No new stored relation table or revision rewrite.** Add a read-only application service method and repository port method only if needed for efficient focused queries. Exact API route naming is a builder call; route handlers go through the composition root.

### 7.3 Bounded paragraph extraction — proposed concrete default

- Parse **only the selected source revision** with the same Markdown parsing rules; find the AST paragraph or paragraph-like container that encloses the matched link occurrence (list item paragraph and blockquote paragraph are paragraphs). Use occurrence line/ordinal and node positions to disambiguate same-line links.
- Return visible source-authored context as **plain text** (escaped by React; never raw HTML). Preserve enough text to recognize the reference. No LLM rewriting or speculative summary.
- Cap each excerpt to **8 source lines or 600 Unicode characters**, centered around the reference when necessary. Show a visible ellipsis/truncation label; never silently truncate. For a standalone `[[Title]]`, show it as **Reference only**, not an invented explanation.
- For a table cell or otherwise unsupported block with no suitable paragraph, fall back to the matched source line with a clear “Limited context” label. If a span cannot be safely located, return `paragraphText: null` and “Evidence unavailable”.
- No full-heading section rendering, no embedded HTML, no auto-execution of markdown/mermaid/scripts inside the detail.
- Bound response to **10 occurrences/page**, cursor tied to the source revision and occurrence ordinal. If revision changes mid-pagination, show “Source changed — reload evidence” rather than mixing versions. Actual totals and continuation availability must be truthful.

### 7.4 Sample read model and proposed API shape

- `GET /api/workspaces/:workspaceId/connections/:focusDocumentId` → ConnectionSummary
- `GET /api/workspaces/:workspaceId/connection-evidence?from=:id&to=:id&cursor=:cursor` → ConnectionEvidenceResult

These are **proposed read-only routes**, not an API commitment. Return private content with no-store headers, explicit input validation, bounded limits and authorization. Existing application/service/port architecture is mandatory; do not query MariaDB directly from the UI or route.

## 8. State, failure and edge cases

| Case | Expected behavior |
| --- | --- |
| No node selected | Full-size existing Graph/List; no panel |
| Node without links | Panel says “No direct connections”; still offers Open Document |
| Pair with multiple references | One directed row, occurrence pagination, true count |
| Only `[[Target]]` as context | “Reference only”; cannot assert a technical rationale |
| Incoming / Outgoing both exist | Show as separate directed rows, never merge |
| Unresolved target | Unresolved label, no fabricated target/pair evidence |
| Ambiguous resolver match | Show ambiguity explicitly; follow existing deterministic current resolution, do not claim uniqueness |
| Graph index stale | Existing stale warning remains; warn that relationships may be incomplete |
| Graph node/source filtered or graph capped | Panel says whether counterpart is offscreen; do not claim filtered graph contains all pairs |
| Document/source archived or permission lost | Remove private details, show neutral unavailable state; no leaked title or excerpt |
| Link/revision changed while panel open | CHANGED state with refresh; do not show stale text as current |
| Rapidly selecting nodes/pairs | Abort or ignore superseded requests; never display previous selection's evidence |
| Graph/List switch, refresh, browser history | Preserve focus when valid; selected pair may reset |
| Touch/mobile | Bottom sheet/drawer with explicit close; controls remain usable |
| Canvas layout, zoom and pan | No recompute/recenter on mere selection; existing gestures still work |
| Graph with no edges | Preserve existing no-link guidance, while List remains an accessible document inventory |

## 9. Authorization and security

- `focus`, pair IDs, cursor and source filters are **untrusted navigation/query parameters**, not access rights.
- Enforce caller identity and Workspace membership via application services on **every summary and evidence request**, including filter combinations, stale selection and direct URL calls.
- Check both source and target are available for that caller under current workspace/source/document policy before returning even the existence of a pair. A now-unavailable target should yield neutral unavailable data, not a disclosive title.
- An owned or shared link is **not** authorization to access graph/evidence; never call these endpoints from `/s/:token` share view.
- Never render document-authored HTML as HTML, including inside excerpts. Escape, bound and use plain-text content; no `dangerouslySetInnerHTML`.
- Preserve index-write invariants; this phase is **read-only** and must not change revision creation or link indexing.
- Context/quotations must be derived from the current saved revision. Do not fetch codebases, external repositories, TKMS or external AI APIs.

## 10. Performance and quality

- Remain **CPU-only** and reuse existing Next.js + MariaDB modular monolith. No new GPU workloads, model serving, queue, vector DB or graph DB.
- Initial graph payload remains node/edge metadata only. Connection summary lazy on node focus; evidence lazy on pair selection, limited to the selected source document.
- Browser transitions should be responsive; avoid graph relayout, excessive router fetches and repeated DB work for a single selection. Cache within an interaction session where safe, but invalidate on revision/permission changes; stale cached evidence must not be treated as authorized/current.
- Measure against realistic datasets, including maximum displayed graph (1000 nodes), high-degree documents, repeated references, CJK Markdown and rapid selection.
- Instrument (at least in tests or profiling) number of queries and excerpt bytes per selection, and prevent N+1 full-Markdown reads.
- Graph edges currently draw as consolidated SVG paths: **no individually clickable SVG edge requirement** in this phase. The Connections List is the accessible pair-selection control.

## 11. Acceptance criteria and tests

| ID | Acceptance |
| --- | --- |
| AC-01 | Main Graph node plain-click / Enter / Space selects; page stays on Connections; Inspector local graph still opens documents |
| AC-02 | Selected node opens a right panel at desktop size, with accurate Incoming/Outgoing direction and explicit Open Document |
| AC-03 | Selecting a pair loads evidence but does **not** change focus; Explore Node explicitly changes focus |
| AC-04 | Each evidence occurrence reports original source and target, source revision, line, ordinal and bounded paragraph excerpt or explicit fallback |
| AC-05 | Multiple references to same target are individually inspectable; bidirectional links remain distinguishable |
| AC-06 | Graph and List expose equivalent select, inspect and open-document controls; keyboard and screen readers can use all core operations |
| AC-07 | Graph pan/zoom/layout do not reset on selection; focus round-trips through URL/back/refresh; filtering does not silently hide facts |
| AC-08 | Unresolved, ambiguous, stale, truncated, no-links and changed-revision cases are truthful and recoverable |
| AC-09 | Workspace/source/doc permissions enforced on summary and evidence; cross-Workspace and share-link reads cannot expose content |
| AC-10 | No LLM calls, no GPU requirement, no new database schema; no regressions to Graph/Reader/Folder Sync/Copy for Agent |

**Proposed test coverage:** pure paragraph extraction and edge-direction unit tests; connection service and permission integration tests; tests for repeated links, CJK, multiline lists/quotes, table fallback, truncation and stale revisions; graph/list keyboard E2E; selected state across filters and navigation; no-leak E2E personas; existing `tests/e2e/workspace-graph.spec.ts` and `tests/unit/graph-model.test.ts` remain green.

### Product outcome verification (separate from code correctness)

Run a small moderated test on a real imported AI Wiki set. Compare existing graph+document workflow to Connection Explorer on at least 3 direct-link interpretation tasks. Track (1) time to find an accurate source citation, (2) incorrect inference of technical dependency, and (3) unnecessary document navigations. If evidence does not improve comprehension, stop before building semantic features.

## 12. Delivery slices (for later writing-plans, NOT implementation approval)

1. **S1 — Selection shell:** shared GraphCanvas selectable mode (Main Graph only), Graph/List parity, URL focus, desktop/right and mobile detail shell; preserve existing navigation elsewhere.
2. **S2 — Connection summary:** authorized on-demand direct incoming/outgoing relationships, filter/truncation semantics and states.
3. **S3 — Evidence:** focused pair read endpoint, bounded paragraph extraction, occurrence pagination, stale/permission handling, source/target/explore actions.
4. **S4 — Verification:** accessibility, security, E2E, performance measurements and user comprehension study.

No product-code changes, migrations, deployment changes or implementation PR are part of this draft.

## 13. Builder notes and review checkpoints

**Existing decisions that must remain intact:** `?focus=` also drives Copy for Agent; only focus in the rendered Graph is valid; local Inspector Graph remains document-open; Graph/List currently serve different user interactions; graph index is derived and authorization is separate. The implementer should inspect `CLAUDE.md` and specs linked below before writing a plan.

**Builder defaults, not additional user approvals:** 360px desktop panel; 1024px responsive breakpoint; excerpts 8 lines / 600 chars; 10 occurrences per evidence page; directed pairs and read-only API shape. These values may be revised during implementation planning if constraints warrant, without altering product goals.

**Reviewer should check specifically:**
1. Whether an authorized node's panel should list connections **outside the visible graph filter** (proposed yes, explicitly labeled).
2. Whether `?focus=` and Copy for Agent stay synchronized without resetting GraphCanvas zoom/pan.
3. Whether excerpts from lists, quotes, tables and multiple links on the same line remain truthful.
4. Whether a title/edge can be exposed after permission changes or from a share link.
5. Whether the UX genuinely improves understanding beyond “advanced backlinks”.

## 14. References

- `CLAUDE.md` — modular architecture, authorization, link-index and reader security invariants.
- `docs/superpowers/specs/2026-09-29-personal-workspace-knowledge-graph-design.md` — graph and link model.
- `docs/superpowers/specs/2026-11-03-graph-neighbourhood-agent-context-design.md` — existing Copy for Agent integration.
- `src/modules/knowledge/domain/document-links.ts` — raw link occurrences (line, ordinal).
- `src/modules/knowledge/domain/link-graph.ts` — resolved directed graph and caps.
- `src/modules/knowledge/application/knowledge-link-service.ts` — authorized graph/link read service.
- `src/modules/knowledge/ports/document-link-repository.ts` — valid edges and current Markdown reads.
- `src/components/knowledge/graph-canvas.tsx`, `graph-explorer.tsx`, `graph-list.tsx` — interaction surfaces.

**Approval gate:** Document is for **design review only**. Once the user approves this spec, run Superpowers writing-plans. Do not implement until the design is approved.
