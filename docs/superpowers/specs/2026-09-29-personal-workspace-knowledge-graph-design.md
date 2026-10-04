# Personal Workspace knowledge links and graphs — design specification

**English** | [繁體中文](2026-09-29-personal-workspace-knowledge-graph-design.zh-TW.md)

| Item | Content |
| --- | --- |
| Date | 2026-09-29 |
| Type | Design specification for pre-implementation review |
| Scope | Document outline (TOC), bidirectional links (`[[wikilinks]]`, relative `.md` links, backlinks), local/workspace graphs, and subsequent personal knowledge workflow backlog (§16) |
| Contract changes | None. Add a **rebuildable derived index**, without changing scope, authorization, ownership, or lifecycle invariants (§12) |
| Prior decisions superseded | Phase 2.5 §3 deferred internal wiki-link resolution. This specification adopts wikilink resolution; Obsidian callouts/embeds remain excluded (§2) |
| References | Phase 3 §§3–5 (My Space), Phase 5 authoring, share links, action model, `frontend-design-language.md` |
| Status | **Implemented in four slices (§13).** §15 lists decisions and recommended defaults, used by implementation. Changes affect only their respective slices. Verification: `docs/superpowers/verification/2026-09-29-personal-workspace-knowledge-graph-verification.md` |
| Plan | `docs/superpowers/plans/2026-09-29-personal-workspace-knowledge-graph.md` |

## 1. Problem

The product is personal-first: users enter My Space and author/import knowledge there, including Obsidian/LLM Wiki folders explicitly supported by Phase 3 §3.1. Today it is only a tree plus individual readers, without document relationships or long-document navigation.

Code-based inventory:

| Capability | Current behavior | Gap | Priority |
| --- | --- | --- | --- |
| Long-document navigation | No TOC or heading IDs; even `[x](#section)` fails | Outline, anchors, scroll tracking | **P0** §9 |
| Document links | `[[Note]]` is text; `[x](../Note.md)` is a relative URL yielding 404 because `MarkdownLink` passes href through | Resolution, navigation, unavailable hints | **P0** §§5–6 |
| Backlinks | None | Index, read model, UI | **P0** §§7–8 |
| Graph | None | Local/workspace graphs | **P0** §10 |
| Create from unresolved link | None | Reuse creation with seeded title | P1 §16 |
| `[[` completion | None; textarea editor and design-language §18 item 3 pending | Title query | P1 §16 |
| Tags | Frontmatter is stripped into metadata JSON but unused | Extraction, browsing, filters | P1 §16 |
| Favorites/Recents | `document.favorite` exists but `favorite` is fixed false | Per-user persistence | P1 §16 |
| Unlinked mentions | None | Full-text lookup, possibly Phase 4 search | P1 §16 |
| Link hover preview, daily notes, properties | None | — | P2 §16 |

TOC, links, backlinks, and graphs form one chain. Heading anchors give `[[Note#Heading]]` a destination; extraction/resolution feed both backlinks and graphs. Keep one specification with four independently deliverable slices (§13).

## 2. Non-goals

- **Embeds/transclusion** (`![[Note]]`) and block references (`[[Note#^id]]`). Preserve embeds as text; ignore block ID but still link to the document.
- **Obsidian-specific callouts, Dataview, and similar extensions.**
- **Rewriting other documents to maintain links:** rename makes name/path links unresolved instead of modifying content (D10).
- **Cross-workspace links:** resolve only inside the origin's workspace (§6.4).
- **Link-granted authority:** membership still governs target reads (§12).
- **Live collaboration/push:** compute on reads; refresh for updated backlinks.
- **Semantic/vector graph relationships:** Phase 8/9 agent-derived relations. Only explicitly authored links here. This index may later feed Phase 9 but is neither part of it nor a patch layer.
- **HTTP/MCP endpoints:** v1 provides application services; Phase 7 reuses them (§8).

## 3. Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | **Workspace-wide** features for every readable workspace; My Space is first acceptance scenario | Query Master fixture imports an Obsidian Wiki into Team. Personal-only adds a type branch despite Workspace being the access boundary. D8 protects large workspaces. Restricting to Personal later changes only two entry conditions, not the model. |
| D2 | Store **raw edges**; resolve **at read time in memory** | Resolution depends on current documents, names, paths; moves/renames create no revisions. Persisted resolution would require cascading updates on create/rename/move/archive. Raw edges depend only on immutable revision content. |
| D3 | Index is **rebuildable derived data**, never authorization truth | Like Phase 4 search, rebuilding changes no read authority. |
| D4 | Maintain index **in the revision transaction** at four write points (§7.3); provide `db:reindex-document-links` | Atomic revision/index coherence; migration's read-only `beforeApply` cannot backfill data, so use a script. |
| D5 | Support `[[Target]]`, `[[Target\|Alias]]`, `[[Target#Heading]]`, `[[#Heading]]`, relative `.md`/`.markdown` | Covers Obsidian and typical LLM Wiki body syntax after frontmatter stripping. |
| D6 | Same-workspace resolution only; unresolved never distinguishes missing from existing elsewhere | Avoid an oracle about titles in other workspaces. |
| D7 | **Server-side**, seeded reproducible `d3-force` layout; browser draws SVG and handles pan/zoom | No force simulation in client bundle; complete SSR, pure unit-testable layout; server-only new dependency. |
| D8 | Maximum **1000** nodes, highest-degree first, explicit truncation | Thousands of SVG nodes become unusable; orphans are removed first. |
| D9 | Share pages **do not resolve links**; `[[X]]` stays text | Anonymous readers have no workspace access; `/w/` links are useless and disclose existence. |
| D10 | **No content rewriting**; rename failures appear in Unresolved | SOURCE_MANAGED cannot be edited; bulk HUB_MANAGED rewrite creates revisions in every affected document, weakening history. Rewriting rename is backlog §16. |
| D11 | **GitHub-compatible unprefixed heading slugs** | Imported anchors work without rewriting content. |
| D12 | v1 **has no HTTP API**; server components call service through read model | Matches Knowledge reading; Phase 7 determines external shape. |

## 4. User flows

**Reading, for anyone with access:**

```text
Open document with at least 2 headings
→ ≥1280px, inspector closed: sticky “On this page” rail, current section highlighted
→ Narrow screens: expandable “On this page” above content
→ Click: smooth scroll respecting reduced motion, update URL hash

[[Query Master]] in body
→ Resolved: normal internal link
→ Missing: dashed underline, tooltip “No document titled ‘Query Master’ in this workspace”
→ Ambiguous: link to §6.2 winner, tooltip notes N other matches

Footer “Linked from N documents”: source document title, Source, link-line context
Title chip: “3 backlinks”, or “2 outgoing links” if no backlinks → inspector Links (§11.1)
Links tab: Backlinks / Outgoing / Unresolved + Local graph
Inspector remembers its last tab (§11.1)
```

**Graph:**

```text
Primary Graph or ⌘K → Open graph → /w/:workspaceId/graph
→ Workspace documents as nodes, links as edges, degree-based node size
→ Source / Show orphans / Show unresolved filters; title-search highlights
→ Drag background, wheel or + / − / Reset zoom, highlight neighbors on hover, click to read
→ List view provides an accessible table of the same data (§10.5)

Inspector Links → local 1-/2-hop neighborhood → Open in graph with ?focus=<documentId>
```

**Writing:** no new operation. Write `[[Title]]`; save creates revision and index in one transaction, making backlinks immediately available.

## 5. Link syntax and extraction

Pure `extractDocumentLinks(markdown): ExtractedLink[]` in `src/modules/knowledge/domain/document-links.ts`, without I/O. Share mdast+GFM configuration with rendering so indexed and displayed links agree.

```ts
type ExtractedLink = {
  kind: "WIKI" | "PATH";
  target: string; // WIKI name or path/name excluding fragment/alias; PATH decoded relative path excluding fragment/query
  fragment: string | null; // WIKI heading text or PATH anchor; discard ^block IDs
  display: string | null; // WIKI alias or PATH link text
  line: number; // 1-based body line for backlink context
  ordinal: number; // Unique occurrence order within the document
};
```

| Rule | Behavior |
| --- | --- |
| Scope | Body Markdown without frontmatter. Scan mdast text nodes; `[[x]]` in code/inlineCode/html is excluded. |
| WIKI | `[[` target until first `#`/`\|`, optional heading until `\|`, optional alias, `]]`. Trim target/fragment edges, preserve internal whitespace until resolution (§6.1). |
| `[[#Heading]]` | In-page anchor, **not an edge**; render `#slug`. |
| Embed | Ignore `[[…]]` immediately preceded by `!`. |
| PATH | mdast link URL with no scheme or leading `//`, ending case-insensitively in `.md`/`.markdown` after removing fragment/query. Apply `decodeURI`; preserve original if decoding fails. `My%20Note.md` becomes `My Note.md`. |
| Other links | External URLs, non-Markdown relative assets, pure fragment anchors remain existing behavior. |
| Limits | **2000** links/document; target at most **512** characters, otherwise skip. Volume guard, not semantics. |
| Self-links | Keep during extraction; remove after resolution (§6.3). |

Initial `extractorVersion = 1`; increment when rules change. Rows store it, enabling stale detection (§7.4).

## 6. Resolution

Pure domain function using workspace catalog and origin document.

```ts
type CatalogDocument = {
  documentId: string;
  sourceId: string;
  title: string; // Current revision title
  sourcePath: string | null; // source_entries.source_path, slash-separated relative to Source root; HUB has null
  createdAt: Date;
};
```

Catalog includes only **ACTIVE documents, Sources, and tree nodes**; archives are not targets.

### 6.1 Normalization

`normalizeLinkKey(s) = s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase()`; remove trailing `.md`/`.markdown` for target-name comparison. Titles use case-sensitive `utf8mb4_bin`, so exact matches precede normalized ones (§6.2-2).

### 6.2 `[[Target]]`

1. Candidates:
   - No `/`: normalized title **or filename stem** matches key. Stem is final sourcePath segment without extension. Obsidian links filenames, but Hub title may come from frontmatter/H1; support both.
   - With `/`: normalized extensionless sourcePath equals key or ends with `"/" + key`, supporting shortest-path suffixes.
2. Rank multiple candidates: same Source first → exact original title/stem → title match before stem-only → fewer sourcePath segments (HUB counts 0) → earlier createdAt → lexicographic documentId. **Deterministic**, independent of query order.
3. Return `{ status: "RESOLVED", documentId, ambiguousWith: candidateCount - 1 }` or `{ status: "UNRESOLVED" }`.

### 6.3 Relative `.md` links

Require origin sourcePath from folder sync; HUB relative Markdown links are unresolved. Normalize POSIX paths relative to origin directory, including `.`/`..`; leading `/` means Source root; escaping root is unresolved. Within the **same Source**, try exact sourcePath, then case-insensitive match.

**Exclude self-links** from backlinks/graphs. Merge repeated links to a target into one edge with `count`.

### 6.4 Scope

Build catalog only for the **origin's Workspace**, joining `knowledge_sources.workspace_id`. Cross-workspace resolution is impossible; no output reveals a matching title elsewhere.

## 7. Data model and maintenance

### 7.1 Schema, migration `012-document-link-index`

```sql
CREATE TABLE knowledge_link_index (
  document_id UUID NOT NULL,
  revision_id UUID NOT NULL,                 -- Revision from which edges were extracted
  extractor_version SMALLINT UNSIGNED NOT NULL,
  link_count INT UNSIGNED NOT NULL,          -- Must equal knowledge_document_links row count
  indexed_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (document_id),
  CONSTRAINT fk_link_index_revision FOREIGN KEY (document_id, revision_id)
    REFERENCES knowledge_revisions (document_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE knowledge_document_links (
  document_id UUID NOT NULL,
  ordinal INT UNSIGNED NOT NULL,
  link_kind VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,   -- WIKI | PATH
  target_text VARCHAR(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  target_fragment VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  display_text VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  line_no INT UNSIGNED NOT NULL,
  PRIMARY KEY (document_id, ordinal),
  CONSTRAINT fk_document_links_index FOREIGN KEY (document_id)
    REFERENCES knowledge_link_index (document_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_document_links_kind CHECK (link_kind IN ('WIKI', 'PATH'))
);
```

- **Derived scope, never duplicated:** neither table stores workspace/source IDs; derive Document → Source → Workspace.
- Keep repository-wide `ON DELETE RESTRICT`; replace by deleting children, updating marker, then inserting children, without cascade.
- One index per document for **current revision**. Do not index historical revisions or grow with history.

### 7.2 Validity

Valid iff marker revision equals document current revision **and** extractor version is current. Read only valid edges; missing/invalid markers count as `staleDocuments` (§8.3). This distinguishes zero links from not-yet-indexed, without treating missing-marker documents as orphans.

### 7.3 Write points, in the revision transaction

| Path | Location | Locks held |
| --- | --- | --- |
| Hub create document | `create-document.ts` | Source, Workspace |
| Hub create revision | `create-revision.ts`; changed=false NOOP does not rebuild | Source, Workspace, Document |
| Folder sync create document | `source-knowledge-projection-service.ts#projectDocument` | Source in Apply transaction |
| Folder sync create revision | `source-knowledge-projection-service.ts#projectRevision` | Document |

After `setCurrentRevision`, call `repositories.links.replaceForDocument(...)`. Extract at the call site: `tests/unit/share-link-single-exception.test.ts` requires CallerContext on application functions touching Markdown, already present at these four points. **Archive/restore/move/rename require no index write**: only revision content matters; read-time state controls visibility.

### 7.4 Backfill and repair

`npm run db:reindex-document-links` or `make db-reindex-links` finds missing/invalid markers, locks each document in its own transaction, verifies current revision, and replaces index. Restartable and repeatable. Deployment: migration 012 → reindex → enable. **Until complete, backlinks/graphs show “index updating (N documents)” rather than blank results.** Migration prints a hint if unindexed documents remain.

## 8. Read model and authorization

`KnowledgeLinkService` (`src/modules/knowledge/application/knowledge-link-service.ts`) follows `KnowledgeQueryService`: trusted CallerContext first, membership checked inside the unit of work; URL parameters are navigation inputs.

```ts
interface KnowledgeLinkService {
  /** Resolved outgoing links, backlinks, and unresolved links. */
  getDocumentLinks(caller, documentId, input?: { revisionNo?: number; includeArchived?: boolean }): Promise<DocumentLinkView>;
  /** Entire workspace graph. */
  getWorkspaceGraph(caller, workspaceId, input?: { sourceId?: string; includeUnresolved?: boolean; includeOrphans?: boolean; limit?: number }): Promise<WorkspaceGraphView>;
  /** One-/two-hop neighborhood around a document. */
  getLocalGraph(caller, documentId, input?: { depth?: 1 | 2 }): Promise<LocalGraphView>;
}
```

### 8.1 Authorization

- Document/local graph reuse `requireVisibleDocument`: document → Source → Workspace → membership, with getDocument's archive visibility. Extract unchanged behavior into `application/internal/require-visible-document.ts`.
- Workspace graph calls `requireMembership(caller, workspaceId)`.
- Catalog/edges both filter the **same workspaceId** through SQL join, never fetch-all-then-filter. Every output node/edge is already scoped to an authorized workspace.
- Workspace is the sole boundary (Phase 3 §13, no Source/Document ACL), so no new capability is needed. Archived workspaces retain existing readable semantics.

### 8.2 `getDocumentLinks`

Optional revisionNo supports historical `?revision=N` outgoing content; absent means current. Service fetches authorized revision itself and **accepts no caller-supplied Markdown**. Extract/resolve outgoing on demand without an index; only backlinks need other documents' stored edges.

Return:

- `outgoing`: unique links by kind + normalized target, with resolution.
- `backlinks`: `{ documentId, sourceId, sourceName, title, count, context }[]`, sorted title/documentId. Context strips wikilink/Markdown-link syntax from the link line, max 160 characters; load Markdown for only the first 50 source documents.
- `unresolved`: unresolved outgoing links.
- `index`: `{ documents, stale }`.

### 8.3 `getWorkspaceGraph`

```ts
type GraphNode = { id: string; kind: "DOCUMENT" | "UNRESOLVED"; title: string; sourceId: string | null; inDegree: number; outDegree: number };
type GraphEdge = { from: string; to: string; count: number };
type WorkspaceGraphView = {
  nodes: GraphNode[]; edges: GraphEdge[];
  total: { documents: number; edges: number }; // Before filtering
  truncated: { shown: number; total: number } | null; // Limit exceeded
  index: { documents: number; stale: number };
};
```

Include unresolved nodes only on request; group by normalized key so references to the same missing title share `unresolved:<key>`.

## 9. TOC and heading anchors

### 9.1 Slug

`headingSlug(text)`: NFC → lowercase → remove characters outside `\p{L}\p{M}\p{N}\p{Pc}`, hyphen, whitespace → replace **each** whitespace with hyphen. **Do not collapse or trim hyphens**: `a - b` becomes `a---b`, matching GitHub for content compatibility. Empty result becomes `section`. Duplicates receive `-1`, `-2`, with suffixed slugs also occupying names, per GitHub. Chinese test example `## 請假流程` yields `#請假流程`.

### 9.2 Single source

One parser (`unified`/`remark-parse`/`remark-gfm`) and `assignHeadingSlugs(tree)` under `src/shared/markdown/`. Both rendering `remarkHeadingIds` and `extractOutline(markdown)` call it. Compare anchors/outline item-by-item in tests, including CJK, duplicates, and GFM strikethrough.

### 9.3 UI

- Headings depths 1–4, indentation relative to minimum document depth; hide below 2 headings; max 200 items.
- `DocumentOutline`: `<nav aria-label="On this page">` with `<ol>` and current `aria-current="location"`. IntersectionObserver root is content scroll container, not window. Click calls scrollIntoView with reduced-motion handling and history.replaceState for hash.
- Sticky right rail at `min-[1280px]` when inspector closed; inspector Outline tab replaces it while open; narrow view uses top `<details>`.
- Headings use `scroll-mt-4` and existing contain-layout scroller to avoid hidden hash destinations.

## 10. Graph

### 10.1 Construction

Pure `buildWorkspaceGraph(catalog, edges, options)` and `buildLocalGraph(graph, focusId, depth)`. Local uses undirected BFS depth 1/2, max 60 nodes, distance then degree priority.

### 10.2 Layout

`layoutGraph(nodes, edges)` runs synchronous d3-force with forceLink/ManyBody/Center/Collide, fixed ticks then stop; no simulation animation. Ticks depend on count: ≤200 → 300, ≤500 → 200, otherwise 150. Not a time budget, which makes output machine-load-dependent. Seed `simulation.randomSource` with LCG and canonically sort nodes/edges by ID: edge ordering affects accumulation, caught by determinism tests. **Identical graphs yield identical coordinates regardless of input order**, ensuring SSR/hydration consistency and reproducible tests. Measured 1000 nodes/3000 edges ≈1 second (§14).

**Unlinked nodes do not participate in force layout.** Without edges, forceCenter scatters them around the outskirts, expanding bounds and shrinking connected content. Split connected/unlinked: force-layout connected nodes, arrange others on a **shelf** 64 units below, cell width 116, row height 34, columns limited by width and √(2.4n), each row centered. Cell sizing follows title length for alignment. Include shelf in extent/fit, but constrain width to connected bounds with minimum 348. `GraphLayout.unlinked` returns “Not linked · N” title anchor, or null. Pure deterministic tests cover below-graph placement, no width inflation, alignment, all-orphan bounds, input order, and width ≤700 for 60 orphans.

### 10.3 Rendering

Client `GraphCanvas` draws SVG, targeting **quiet presentation, one accent, legible labels**, following the repository's restrained Linear-like contract. No shadows/saturated colors for hierarchy, and **no colors outside tokens** (§8 CSS variable layer; light/dark automatic with fill/stroke-kh).

| Element | Rule |
| --- | --- |
| Edges | One combined path/DOM node; `stroke-kh-border-strong`, `vector-effect: non-scaling-stroke` preserves 1px; opacity 40%, reduced to 10% on hover; emphasized edges separate primary path |
| Nodes | Neutral `fill-kh-border-strong`; primary only for hover neighbors/current/search. Radius `3.5 + 1.5·√degree`, max 9, replacing overweight 4–12 |
| Unresolved | Hollow `fill-kh-bg`, `stroke-kh-text-muted`, dash `2 1.5`; legend only when present |
| Current document | `fill-kh-highlight` halo with `stroke-kh-focus` outer ring |
| Focus | Equivalent to kh-focus-ring: group-focus-visible outer ring, also persistent for hovered emphasis |
| Labels | 11px/micro, **fixed screen pixels** independent of zoom; `fill-kh-text-secondary` by default, `fill-kh-text` for emphasis/search, `font-medium` for current/hover; `stroke-kh-bg` with paint-order preserves readability over edges. No former ≤80-all/otherwise-almost-none threshold |
| Shelf | `fill-kh-text-muted font-medium` “Not linked · N”; orphan dots/titles below |
| Tooltip | Adjacent card, role=tooltip, data-graph-card, pointer-events none: title, Source, N in/M out. Sole rounded-lg/border/shadow-popover element because overlay; canvas has no shadow |
| Controls | Bottom-right group with `role="group" aria-label="Zoom"`: Zoom out / percentage / Zoom in / Reset view, ghost 24px icon buttons, legend/hints; no top-left overlays |

**Decluttering, pure `selectVisibleLabels`.** Client selects by **current zoom**, not count threshold. Total ordering: forced → weighted → degree → title → ID. Estimate screen-pixel label boxes with fullwidth/CJK 1em and others ≈0.58em, conservatively wide. Skip collisions with placed labels/node circles; max 140. Forced hover/focus/current labels **always show**, uncapped. Weighted neighbor/search labels precede ordinary labels but do not overlap placed ones. Zooming lets more labels fit, solving both no labels on large graphs and overlap on small graphs. Above 400 nodes, check label-label collisions only, avoiding quadratic circle checks with negligible visual benefit.

**Contract alignment.** Replace custom segmented Graph/List control and overlay-only shadow-popover with shared `ui/tab.ts` links (`aria-current="page"`, as NavTabs). Canvas changes chrome bg-kh-bg-raised to canvas bg-kh-bg/border-kh-border/no shadow. Remove nested List table border: one border, sticky header, row hover. Toolbar becomes one row: tabs left, find/filter/statistics with tabular-nums right.

### 10.4 Interaction

Background drag pans. Wheel, `+`/`−`/`0`, and three zoom buttons zoom ×1.3 within 0.3–6, keyboard-accessible. Hover emphasizes neighbors, dims others, and shows tooltip. Click uses client navigation; modifiers preserve browser behavior. Title search highlights. Source/orphans/unresolved/focus filters use URL search params and server recomputation for bookmarks/sharing/Back. Reduced motion disables zoom/hover transitions.

### 10.5 Accessibility

`<svg role="group" aria-label="Knowledge graph, N documents, M links">`; each node is native-focusable SVG `<a>`, Tab order by descending degree, label includes title/count. **List view** gives identical data (title, Source, incoming/outgoing counts) as a complete screen-reader/keyboard alternative, not a secondary feature.

### 10.6 Empty state

With no links, do not draw only orphans. Explain that `[[Title]]` links create relationships. Incomplete index uses §7.4 notice.

## 11. UI and design language

- Components in `src/components/knowledge/`: document-outline, document-links-panel, backlinks-footer, graph-canvas, graph-explorer, graph-list, graph-model. Page `src/app/w/[workspaceId]/graph/page.tsx`; keep `/w/` routes, no `/me` (Phase 3 §3.2).
- Existing tokens only: text-body/body-sm/caption, rounded-md, shadow-popover, duration-120, spacing scale (§§3–5, §18-2). No new tokens; no Tailwind/contract update required for tokens.
- Registry adds `navigate.graph` (“Open graph”) and **palette-only** `document.backlinks` (“Show backlinks”, opens Links). No row backlinks for the same reason as Details: inspector describes the open document, not another row. Read actions need no write capability, ownership, or lifecycle restriction, including history. Registry/unit tests define availability. Members without other capabilities now have two actions, Knowledge/Graph, since readers can inspect their graph.
- Add Network-icon Graph navigation for readers.
- Graph loading uses existing skeleton conventions and loading.tsx.
- **Links to the current page use `prefetch={false}`**: depth, Graph/List, wikilinks including self-link; renderer cannot know current document. Self-prefetch returns full page and Next 15's first consumption can race navigation (§9 keyboard spec). Local-depth reproduction: about 1/8 failures before fix, 30/30 after. **Correction:** later 20-run repeat had 1 failure; prefetch=false removes one cause, not all. Remaining React lost ping is in verification §9.

### 11.1 Local graph belongs in inspector Links, not fixed top-right

**Decision:** keep the graph in inspector; improve entry points rather than relocate it.

Reasons: (1) TOC rail and Edit/Share/Details already occupy the right, so another graph competes with reading. (2) Most documents have 2–4 graph dots, less information than footer “Linked from 3 documents”. (3) Graph is for intentional exploration, not persistent reading distraction.

Entry improvements:

- **Title-row link chip**, pure `summariseLinks`: ghost button after Updated metadata, opens inspector/requestedTab=Links, same destination as palette but direct pane callback rather than kh:request-details. Favor backlink count, invisible in body and signaling usefulness. Use backlinkTotal, not possibly truncated list length, matching inspector totals. With no backlinks but resolved outgoing, show outgoing count for discoverability. **Hide when no links or only unresolved links**, already dashed in body. Maintain visual row height with h-6 target/negative margin, 24px hit target (WCAG 2.5.8).
- **Remember inspector tab**, `inspector-tab-memory`: localStorage `kh:inspector-tab`, protected readStored/writeStored like theme/nav collapse, per-reader/browser with no server storage. `resolveInspectorTab`: **new request > memory > Details**, falling through absent tabs such as Outline without headings. Read directly, not usePersistedJson's default-then-effect contract: inspector is not server-rendered, so no hydration state needs alignment and default Details would flash.
- **Respond to each request once:** clear requestedTab when closing. Otherwise chip → Links → History → close → Details incorrectly revives stale Links request, caught by E2E (verification §8).

**Consequence:** untargeted Details button, `⌘/Ctrl I`, and palette Details now reopen the remembered tab, not always Details.

**Not implemented:** default wide-screen Links. That is a preference, unnecessary once graph users choose it once and memory retains it.

## 12. Security and invariants

| Invariant | Preservation |
| --- | --- |
| Derived scope | No scope columns; derive through Document/Source/Workspace |
| ID is not authority | Every read uses trusted caller/membership; focus/document/workspace IDs are navigation only, rechecked |
| org_code does not authorize | Not involved |
| Ownership decides writes | Index is a **read model** for source-managed and Hub-managed content; no content writes through backlinks |
| Identity/position/content | Index follows revision only; move/rename needs no index write; resolution sees current titles/paths |
| ACTIVE/ARCHIVED only | Filter archived sources/targets at read time; no hard delete; derived child replacement is not Knowledge deletion |
| Share link sole bearer grant | New services require callers; share pages never resolve/call links (D9). Keep three share-link-single-exception tests and add component-tree no-link-service-import assertion |
| Index never decides access | Empty/rebuild changes only displayed relationships |

**No disclosure:** unresolved does not distinguish absence from other-workspace existence (D6). Backlinks include only same-workspace ACTIVE readable documents. Workspace is the sole boundary; membership permits all its document titles/content, with no partially visible source documents.

## 13. Staged delivery and acceptance

Four independently mergeable/revertible slices; later slices depend on earlier code, not data.

| Slice | Content | Data | Acceptance excerpt; full list in plan |
| --- | --- | --- | --- |
| **1. TOC** | Shared parsing/slugs, remarkHeadingIds, extractOutline, rail/inspector/narrow outline | None | IDs/outline agree including CJK/duplicates/GFM; anchors work; scroll tracking; hide under 2 headings; historical outline matches revision |
| **2. Model/index** | Extraction/resolution, migration 012, repository, four writers, reindex, getDocumentLinks | Migration and reindex | Syntax tests; writers index, NOOP skips; replace not append; cross-workspace unresolved; nonmember refusal; idempotent reindex repairs empty index |
| **3. Rendering/backlinks** | Resolved/unresolved wiki/path links, Links inspector, footer, registry, share text | None | Correct navigation/dashed tooltip/context; deterministic ambiguity; no share-page `/w/` links |
| **4. Graph** | Builders/layout/services, graph page, local inspector, nav/palette, list | None | Determinism, cap/truncation, filters, navigation/keyboard, identical list data, empty/stale states |

**My Space E2E:**

1. Create A/B/C. A links B and an intentionally missing Chinese fixture title `[[不存在的文件]]`; B links A.
2. B backlinks show A/context; A renders B as link and missing target unresolved.
3. Graph has three nodes, one A↔B edge, orphan C; unresolved filter adds dashed node; click A opens it.
4. Four-heading long document has four TOC entries; click third scrolls and updates hash.
5. Import `[x](../notes/b.md)`; resolve imported target and corresponding backlink/edge.

## 14. Performance and scale

| Operation | Design | Limit/measurement |
| --- | --- | --- |
| Extraction | Once/document; **skip parsing** without `[[` or `.md` | Parsing ≈1.7ms/KB; 3.7KB/40 links ≈4–8ms; link-free ≈0.003ms |
| SQL writes | Three statements: delete, marker upsert, child batches of 500 | Constant statements/document in Apply; phase2-import-apply-perf asserts one replacement each |
| Document reads | Catalog IDs/titles/paths and valid workspace edges, resolve in memory | 2000 documents/20000 edges: median96ms, p95119ms; 2-hop local median131ms |
| Graph | Read/build plus layout | Cap1000; read/build133ms; synthetic1000 nodes/3000 edges layout≈1.0s, real graphs sparser; typical hundreds much lower |
| Edge guard | 2000/document | Excess not indexed |

Development-container measurements with co-located database/tests establish magnitude and regression checks, not capacity promises. Raw methods/results in verification.

**Trade-off:** document reads cost O(workspace size), not O(document links). Fine for hundreds/thousands in My Space. If larger scale requires it, add normalized target key/index for candidate backlinks (§16), extending the raw-edge model rather than rewriting it.

## 15. Decisions and risks

| # | Question | Adopted default | If changed |
| --- | --- | --- | --- |
| Q1 | Personal-only or all workspaces | All (D1) | Add Personal condition to nav/service entry |
| Q2 | d3-force server-only, explicit unified/remark-parse dependencies (already transitive) | Accept | ~80-line handwritten force simulation; mdast-util-from-markdown with explicit GFM extension |
| Q3 | Stale notice versus read-time repair | Notice, preserving read-only reads | Small stale repairs during read add writes/lock contention |
| Q4 | Default orphans | Show, dropped first beyond cap | Change URL default only |
| Q5 | Relative Markdown same Source | Yes; relative namespace belongs to Source | Cross-source needs path namespace, discouraged |

Risks:

- **Syntax boundaries:** table `[[a\|b]]` needs escaped pipe; wikilinks split across emphasized text nodes (`[[*x*]]`) are not recognized. Tests document both.
- **Rendered editor once escaped `[[X]]` into `\[\[X]]`, discovered after rollout, fixed:** treating links as text removed edges after save. Index correctly reflected the now-linkless revision. #78 rebased on composer #62 with E2E changed to source view, leaving no rendered-save link test. Cause, fix, round trips, and read-only damaged-document report: [daily-driver §§1.1/4](2026-09-29-personal-daily-driver-design.md).
- **Heading/application ID collisions:** Main produces `id="main"`. Audit existing IDs and rename application side if needed.
- **Future revision writers forgetting index:** document becomes stale rather than silently incorrect because marker compares revision (§7.2). PR checklist asks for links.replaceForDocument; integration scans paired revisions.insert/index calls.

## 16. Backlog, outside delivery and ordered by value

| Item | Requirements | Notes |
| --- | --- | --- |
| Create from unresolved | `/knowledge/new?title=`; offer with Hub-managed source/write capability | Low-cost Obsidian-like workflow |
| `[[` completion | Detect trigger, existing quick-search, insert Title]] | Coordinate editor redesign §18-3 |
| Tags | Metadata/inline tags, index/page/graph color | Small separate spec |
| Favorites/Recents | Per-user table; registry reads favorite state | Field reserved |
| Unlinked mentions | Phase4 title-occurrence search excluding links | Read-only |
| Backlink optimization | target_key column/index | §14 extension |
| Rewrite links on rename | HUB_MANAGED only; revision per affected document, confirmation | D10 alternative; separate history-impact specification |
| Hover previews, daily notes, properties | — | P2 |
