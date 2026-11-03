# Copy a Document's Link Neighbourhood for an Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One click from a document's local graph opens Copy for Agent with the neighbourhood preselected, and every bundle opens with a `## Links` map of links among the selected documents and to missing targets.

**Architecture:** Two pure domain functions in `agent-context.ts` (link map, neighbourhood selection) feed the existing `AgentContextService` / `AgentContextFormatter` and the agent-context page. The entry links are hrefs computed server-side (document page → `documentInspectorData`, graph page) and rendered as plain `<Link prefetch={false}>`.

**Tech Stack:** Next.js 15 App Router, TypeScript, Vitest (jsdom for components), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-03-graph-neighbourhood-agent-context-design.md`

## Global Constraints

- Copy for Agent stays PERSONAL-only, owner-only, ACTIVE-only; `AgentContextService.build` checks are unchanged.
- `CONTEXT_MAX_DOCUMENTS = 20`, `CONTEXT_MAX_BYTES = 256 * 1024` unchanged; the Links section counts toward the byte cap and overflow still throws (no truncation).
- Link lines are `Link: ` + `jsonRecord({...})`; the internal `unresolved:<key>` id is never written.
- Links section intro, verbatim: `Links written in the selected documents' current saved revisions, to other selected documents or to titles that name no document (missing: true).`
- `around` / `depth` are navigation inputs only; `build` re-verifies every id.
- Links to the page's own route use `prefetch={false}`; no new design tokens; reuse the "Open in graph" link classes.
- Shell setup for every command: `unset -f node npm npx pnpm`; lint `npm run lint`; typecheck `node node_modules/typescript/bin/tsc --noEmit`; integration `npx tsx scripts/test/integration.ts`.

## Review Focus

1. Duplicate titles among selected documents — the map must stay unambiguous; every `Link:` line carries `fromId`/`toId`. (Task 1 test.)
2. A selected document that links to itself and to the same target twice — one line, `count` carried, no self line. (Task 1 test.)
3. `around` pointing at a document in another workspace, or given together with `document` — page renders with nothing preselected and no error in the first case; `around` wins in the second. (Task 5 e2e.)
4. A neighbourhood larger than 20 eligible documents — focus kept first, exactly 20 selected, status line says "of M". (Task 3 test.)
5. A bundle whose documents fit at 256 KiB only without the Links section — fails loudly with the existing message rather than dropping the map. (Task 1 test.)

---

### Task 1: Link map in the bundle

**Files:**
- Modify: `src/modules/knowledge/domain/agent-context.ts`
- Modify: `src/modules/knowledge/application/agent-context-service.ts`
- Modify: `docs/superpowers/specs/2026-10-04-mvp-discovery-agent-design.md` (one line under its bundle-format section: "Amended by `2026-11-03-graph-neighbourhood-agent-context-design.md` §5.3: `## Links` section and `linkCount`.")
- Test: `tests/unit/agent-context-links.test.ts`

**Interfaces:**
- Produces:
  - `export type AgentContextLink = { from: string; fromId: string; to: string; toId: string | null; missing?: true; count: number }`
  - `export function linkMapFor(graph: LinkGraph, selectedIds: readonly string[]): AgentContextLink[]` — keeps edges with `from` selected and `to` selected or `kind === "UNRESOLVED"`; drops self-links and edges to unselected documents; order: `from` by selection index, then selected `to` by selection index, then missing `to` by title (`<` compare, then id).
  - `AgentContextFormatter.addLinks(links: AgentContextLink[]): void` — no-op for `[]`; must be called before the first `addDocument`.
  - `finish()` returns `{ ...existing, linkCount: number }`.

- [ ] **Step 1: Write failing tests** in `tests/unit/agent-context-links.test.ts`:
  - `linkMapFor keeps links between selected documents in selection order` — graph A→B, B→A, A→C (C unselected); selected `[B, A]` → `[{from:"B",…,to:"A"}, {from:"A",…,to:"B"}]`.
  - `linkMapFor writes a missing target without its internal id` — A→`unresolved:x` titled "X", count 2 → `{from:"A",fromId:A,to:"X",toId:null,missing:true,count:2}`; `JSON.stringify(result)` does not contain `"unresolved:`.
  - `linkMapFor drops self-links` — A→A → `[]`.
  - `linkMapFor keeps ids when titles collide` — two selected docs both titled "Same" linking each other → both lines, distinct `fromId`.
  - `formatter omits Links with no links` — `addLinks([])` then a document → markdown has no `## Links`.
  - `formatter writes Links before documents, one labelled JSON line each` — markdown index of `## Links` < index of `## Document`; contains the intro sentence verbatim; every line after the intro that starts with `Link: ` parses as JSON; a title `"a\n## Document x"` stays on one line (no raw `\n`/U+2028 inside the record).
  - `formatter counts Links toward the byte cap` — a document sized so it fits alone but not with a large links list → `addLinks` then `addDocument` throws `ValidationError` with "exceeds 256 KiB"; `finish().bytes` equals encoded length otherwise; `finish().linkCount` equals lines written.
  - `build emits the map for a single document with only broken links` — extend the fake repositories pattern of `tests/unit/mvp-agent-context.test.ts` with `links: { loadCatalog, loadValidEdges, countIndexState }` returning one document and one unresolved edge → `result.markdown` contains `"missing":true`, `result.linkCount === 1`.

- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/agent-context-links.test.ts` — Expected: FAIL (`linkMapFor` not exported).

- [ ] **Step 3: Implement** `AgentContextLink`, `linkMapFor`, `addLinks`, `linkCount` in `agent-context.ts`. In `AgentContextService.build`, after the workspace check and before the document loop: `const catalog = await r.links.loadCatalog(workspaceId)`, `const graph = buildWorkspaceGraph(catalog, resolveEdges(catalog, await r.links.loadValidEdges(workspaceId)), { includeUnresolved: true, includeOrphans: true, limit: Number.MAX_SAFE_INTEGER })`, `formatter.addLinks(linkMapFor(graph, ids))`. Add the 2026-10-04 spec pointer line.

- [ ] **Step 4: Run** the new file plus `tests/unit/mvp-agent-context.test.ts` and `tests/unit/agent-context-discussions.test.ts` — Expected: PASS. If the two existing service tests now fail on a missing `links` fake, add `links: { loadCatalog: async () => [], loadValidEdges: async () => [] }` to their fakes (they reject before reaching it, so ordering may also be fine).

- [ ] **Step 5: Commit** `feat(agent-context): open the bundle with a map of the selected documents' links`

---

### Task 2: Preview shows the link count

**Files:**
- Modify: `src/components/knowledge/agent-context-builder.tsx` (bundle state type + stats line)
- Test: `tests/unit/mvp-agent-context-builder.test.tsx`

**Interfaces:**
- Consumes: response field `linkCount: number` (Task 1).

- [ ] **Step 1: Extend the existing builder test**: mocked response gains `linkCount: 4`; assert `host.textContent` contains `"3 comments · 4 links"`.
- [ ] **Step 2: Run** the file — Expected: FAIL.
- [ ] **Step 3: Implement**: stats line becomes `{documentCount} documents · {threadCount} discussions · {commentCount} comments · {linkCount} links · {bytes} bytes`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(agent-context): show how many links the bundle maps`

---

### Task 3: Neighbourhood preselection on the agent-context page

**Files:**
- Modify: `src/modules/knowledge/domain/agent-context.ts` (selection helper)
- Modify: `src/app/w/[workspaceId]/agent-context/page.tsx`
- Modify: `src/components/knowledge/agent-context-builder.tsx`
- Test: `tests/unit/agent-context-neighbourhood.test.ts`, `tests/unit/mvp-agent-context-builder.test.tsx`

**Interfaces:**
- Produces:
  - `export function neighbourhoodSelection(nodes: readonly GraphNode[], eligible: ReadonlySet<string>, limit = CONTEXT_MAX_DOCUMENTS): { ids: string[]; total: number }` — `DOCUMENT` nodes in input order filtered by `eligible`; `total` before the cap; `ids` capped at `limit`.
  - `export function parseNeighbourhoodDepth(raw: string | undefined): 1 | 2` — `"2"` → 2, anything else → 1.
  - `AgentContextBuilder` props: `initialDocumentIds?: string[]` (replaces `initialDocumentId`), `nearby?: { selected: number; total: number }`.

- [ ] **Step 1: Write failing tests** in `tests/unit/agent-context-neighbourhood.test.ts`:
  - `keeps the focus first and the graph's order` — nodes `[F, A, B]` all eligible → `ids === [F, A, B]`, `total === 3`.
  - `drops unresolved and ineligible nodes` — `[F, unresolved:x, ARCH]` with `eligible = {F}` → `{ ids: [F], total: 1 }`.
  - `caps at 20 and reports the eligible total` — 25 eligible document nodes → `ids.length === 20`, `ids[0] === focus`, `total === 25`.
  - `parseNeighbourhoodDepth` — `"2"`→2; `"1"`, `"3"`, `undefined`, `"x"` → 1.
  And in the builder test file:
  - `preselects the neighbourhood and says how much of it` — render with `initialDocumentIds={["a","b"]}` and `nearby={{selected:2,total:5}}` → two checkboxes checked; text contains `"Selected 2 of 5 nearby documents."`; with `total:2` the text is `"Selected 2 nearby documents."`.

- [ ] **Step 2: Run** both files — Expected: FAIL.

- [ ] **Step 3: Implement** the two helpers. In `page.tsx`: read `around`, `depth`, `document` search params; when `around` is set, `const local = await getLocalGraphModel(workspaceId, around, parseNeighbourhoodDepth(depth))`; eligible = ids of the documents the page already offers; `const nearby = local ? neighbourhoodSelection(local.nodes, eligible) : null`; pass `initialDocumentIds = nearby?.ids ?? (document ? [document] : [])` (`around` wins over `document`), `nearby = nearby && nearby.ids.length ? { selected: nearby.ids.length, total: nearby.total } : undefined`, and order the `documents` prop so preselected ids come first (so they fall inside the list's first 100 rows). Builder: initial state from `initialDocumentIds` filtered to known documents; status line `<p role="status">` above the list when `nearby` is set.

- [ ] **Step 4: Run** both files and `tests/unit/mvp-agent-context-builder.test.tsx` — Expected: PASS. Grep for other `initialDocumentId` users and update them.

- [ ] **Step 5: Commit** `feat(agent-context): preselect a document's link neighbourhood`

---

### Task 4: Entry links (inspector and graph page)

**Files:**
- Modify: `src/server/document-inspector-data.ts` (new input `agentContext: boolean`; `LocalGraphData.agentContextHref`)
- Modify: `src/components/knowledge/document-links-panel.tsx` (`LocalGraphData` type + link)
- Modify: `src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/page.tsx` (compute `agentContext`)
- Modify: `src/app/w/[workspaceId]/graph/page.tsx`, `src/components/knowledge/graph-explorer.tsx` (`agentContextHref` prop)
- Test: `tests/unit/agent-context-entry.test.ts`, `tests/unit/document-links-panel-create.test.tsx` (pattern reference for rendering the panel)

**Interfaces:**
- Produces:
  - `LocalGraphData.agentContextHref: string | null`
  - `export function neighbourhoodContextHref(input: { workspaceId: string; documentId: string; depth: 1 | 2; eligible: boolean; nodes: readonly { id: string; kind: "DOCUMENT" | "UNRESOLVED" }[] | null }): string | null` in `document-inspector-data.ts` — `null` unless `eligible` and `nodes` holds a `DOCUMENT` other than `documentId`; else `/w/${workspaceId}/agent-context?around=${documentId}&depth=${depth}`.
  - `GraphExplorer` prop `agentContextHref: string | null`.

- [ ] **Step 1: Write failing tests** in `tests/unit/agent-context-entry.test.ts`:
  - `offers the neighbourhood when another document is linked` — nodes `[self, other DOCUMENT]`, depth 2 → `"/w/ws/agent-context?around=self&depth=2"`.
  - `hides it when the only links are broken` — `[self, unresolved:x]` → `null`.
  - `hides it when not eligible` — `eligible: false` → `null`; `nodes: null` → `null`.
  - `documentInspectorData passes it through only with depth links` — `depthHrefs: null` (composer) → `localGraph.agentContextHref === null` even when eligible.
  - Panel render (jsdom, following `document-links-panel-create.test.tsx`): with `agentContextHref` set, a link named "Copy for Agent" with that href exists next to "Open in graph"; with `null`, no such link.

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement.** Document page: `agentContext = shell?.workspace.type === "PERSONAL" && shell.access.actions.canSearch === true && view.status === "ACTIVE" && explorer?.source.status === "ACTIVE" && !isHistorical` (mirrors `action-registry.ts:354`); `documentInspectorData` sets `agentContextHref = input.depthHrefs ? neighbourhoodContextHref({...depth: input.graphDepth, nodes: linkView?.localGraph?.nodes ?? null}) : null`. Panel renders `<Link prefetch={false}>Copy for Agent</Link>` with the "Open in graph" classes, side by side. Graph page: when `filters.focusId` and `shell.workspace.type === "PERSONAL" && shell.access.actions.canSearch`, pass `/w/${workspaceId}/agent-context?around=${focusId}&depth=1`; `GraphExplorer` renders it in the status row beside "Clear find"/"Reset" as a ghost-sized link.

- [ ] **Step 4: Run** the new test, the panel tests, then `npm run lint` and `node node_modules/typescript/bin/tsc --noEmit` — Expected: PASS, no lint errors (no `infrastructure/` imports from `src/app`/`src/components`).

- [ ] **Step 5: Commit** `feat(graph): copy a document's neighbourhood for an agent from the graph`

---

### Task 5: End-to-end and full verification

**Files:**
- Create: `tests/e2e/zz-neighbourhood-agent-context.spec.ts` (set up a Personal workspace document set the way `tests/e2e/mvp-discovery-agent.spec.ts` does)

- [ ] **Step 1: Write the e2e test** `copies a document's neighbourhood with its link map`: documents A (`[[B]]`, `[[Missing]]`), B (`[[C]]`), C, D (unlinked). Open A, open the Links tab, choose "2 links", click "Copy for Agent" → URL has `around=<A>&depth=2`; A, B, C are checked and D is not; text "Selected 3 nearby documents."; click "Prepare context" → preview contains `## Links`, a `Link:` line A→B, B→C, and `"to":"Missing","toId":null,"missing":true`. Second test: a Team workspace document's Links panel has no "Copy for Agent" link, and opening the Personal `/agent-context?around=<that Team document id>` renders with 0 selected and no error. Third: `/agent-context?around=<A>&document=<D>` preselects A's neighbourhood, not D.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/zz-neighbourhood-agent-context.spec.ts` (after `make browsers` once; move `.next/cache` aside if pages stick on "Loading document") — Expected: PASS.
- [ ] **Step 3: Run the full gate**: `npx vitest run --config vitest.config.ts` (unit), `npm run lint`, `node node_modules/typescript/bin/tsc --noEmit`, `npx next build`, `npx tsx scripts/test/integration.ts` — Expected: all pass. Known local-only e2e failures (composer-navigation:69/:89, sample-wiki-import:101) are not caused by this branch.
- [ ] **Step 4: Commit** `test(e2e): neighbourhood Copy for Agent with link map`
