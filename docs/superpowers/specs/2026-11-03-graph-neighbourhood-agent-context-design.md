# Copy a document's link neighbourhood for an agent — design

Status: proposed, 2026-11-03. Extends Copy for Agent
(`2026-10-04-mvp-discovery-agent-design.md`) and reads the link graph of
`2026-09-29-personal-workspace-knowledge-graph-design.md`. Amends the
2026-10-04 spec's bundle format and response (§5.3 adds a `## Links`
section and `linkCount`); that spec gets a one-line pointer to this one.
The graph spec is unchanged.

## 1. Intent

A reader looking at one document wants to hand it to an AI agent *together
with the documents around it*, and have the agent know how those documents
link to each other. Today Copy for Agent takes documents one checkbox at a
time and emits no link structure, so the one thing the graph knows that a
pile of pasted documents does not — who links to whom — never reaches the
agent.

Success: from a document, one click lands on Copy for Agent with its
neighbourhood already selected; the generated Markdown opens with a map of
the links among the selected documents.

## 2. Goals

- G1. A "Copy for Agent" entry beside the inspector's local graph that
  preselects the neighbourhood currently drawn (same document, same depth).
- G2. The same entry on the workspace graph page when a `focus` is set.
- G3. Every Copy for Agent bundle gains a `## Links` section when its
  selected documents link to each other or to targets that name no document
  (the dashed nodes of the graph).

## 3. Non-goals

- Exporting the graph page's find matches (title search). Deferred; the
  entry point here is the neighbourhood.
- Content (full-text) search on the graph page.
- Opening Copy for Agent to Team workspaces. It stays Personal-only, owner
  only, ACTIVE only, exactly as `AgentContextService.build` checks today.
- Raising the 20-document or 256 KiB limits.
- Links to existing documents outside the selection, or link
  anchors/headings in the map. *(Call: the agent cannot read an unselected
  document, the reader chose the selection, and listing them would push
  link-heavy documents toward the 256 KiB cap.)*

## 4. Anti-goals

- The preselection must not become authorization. `around=<id>` is a
  navigation input; `build` re-verifies every document as it does now.
- No silent truncation of content. The 256 KiB rule still fails loudly.
- No new MCP/HTTP surface; the existing POST route is the only producer.

## 5. Decisions

### 5.1 Entry points (G1, G2)

- Inspector Links panel (`document-links-panel.tsx`, `LocalGraph`): a
  "Copy for Agent" link beside "Open in graph", to
  `/w/:ws/agent-context?around=<documentId>&depth=<1|2>` using the depth the
  panel is showing. Shown only when the same condition the action registry
  uses for `document.agent-context` holds (PERSONAL workspace, `canSearch`,
  ACTIVE document and source, current revision; `action-registry.ts:354`)
  **and** the local graph has at least one other `DOCUMENT` node (unresolved
  targets do not count: they would preselect nothing but the document). With
  no linked document, the existing per-document "Copy for Agent" action
  already covers it.
- Not in the composer (the inspector there has `depthHrefs: null`): the
  bundle reads the saved revision and link index, not the unsaved draft, and
  following the link would leave the editor. *(Builder-check call.)*
- Graph page with a valid `focus`: the same link, `depth=1` (the graph page
  has no depth control), under the same workspace/action condition. Its
  visibility does not require a local-graph read: the agent-context page
  already handles a neighbourhood with nothing to add. The neighbourhood
  **ignores the graph page's source/orphans/unresolved filters** — it is the
  document's neighbourhood, the same one the inspector draws, not a slice of
  the filtered drawing. *(Builder-check call.)*
- Both are plain `<Link prefetch={false}>` navigations; no client fetch.

### 5.2 Preselection (agent-context page)

- The page accepts `around` and `depth` (`1` or `2`; anything else is `1`).
  The existing `document` param keeps working; if both are given, `around`
  wins.
- Server-side, the page calls `getLocalGraphModel(workspaceId, around, depth)`
  (`src/server/link-graph-read.ts`), which wraps the composition root's
  `links.getLocalGraph` and also checks the document belongs to the URL's
  workspace. If it returns `null` or throws (not visible, not found, other
  workspace), the page renders with nothing preselected — no error, same as
  an unknown `document` param today.
- Preselected = the local graph's `DOCUMENT` nodes, in `buildLocalGraph`
  order (focus first, then by distance, then by its existing node
  ordering), filtered to documents the page already offers (ACTIVE in an
  ACTIVE source), capped at `CONTEXT_MAX_DOCUMENTS` (20). `UNRESOLVED` nodes
  are dropped.
- `AgentContextBuilder` takes `initialDocumentIds: string[]` instead of
  `initialDocumentId`. When preselected from a neighbourhood it shows one
  status line: "Selected N of M nearby documents." M = eligible documents
  in the local graph, which `buildLocalGraph` has already capped at
  `LOCAL_GRAPH_NODE_LIMIT` (60, unresolved included); M therefore means "in
  the drawn neighbourhood", not the true count. Omit "of M" when M = N. Preselected
  documents must be visible in the list even when it shows only its first
  100 rows — list selected rows first.

### 5.3 Link map in the bundle (G3)

- `AgentContextService.build` loads the workspace catalog and valid edges
  inside its existing unit of work (`links.loadCatalog`,
  `links.loadValidEdges`, `resolveEdges` — the same calls `getLocalGraph`
  makes), and keeps edges whose `from` is a selected id and whose `to` is
  either a selected id or an unresolved target (`unresolved:<key>`). Edges to
  existing unselected documents are dropped, as are self-links. The
  unresolved target's display title is the one `buildWorkspaceGraph` gives
  its `UNRESOLVED` node; the internal `unresolved:<key>` id is never
  written.
- Formatting lives in `AgentContextFormatter`: after the header and before
  the first document,

  ```
  ## Links

  Links written in the selected documents' current saved revisions, to other selected documents or to titles that name no document (missing: true).

  Link: {"from":"<title>","fromId":"<uuid>","to":"<title>","toId":"<uuid>","count":<n>}
  Link: {"from":"<title>","fromId":"<uuid>","to":"<target text>","toId":null,"missing":true,"count":<n>}
  ```

  one labelled `Link: ` + `jsonRecord` line per edge, like `Provenance:`,
  `Thread:` and `Comment:` records (titles are untrusted text; JSON keeps
  them inert, and the label is what the header tells the agent to trust,
  per the 2026-10-04 review hardening), ordered by selection order of
  `from`, then selected targets in selection order, then missing targets by
  title. Titles are the current revision titles. The section
  is omitted when there are no such edges. Its bytes count toward 256 KiB.
- The response gains `linkCount`; the preview's stats line adds
  "· N links".
- The map is derived at build time and decides nothing. A stale link index
  (`countIndexState`) may make it incomplete; that is acceptable and is not
  reported in the bundle.

## 6. Invariants touched

- Scope: edges are resolved only inside the workspace, which `build` has
  already required read access to; ids outside it already fail `build`.
- Link index: read only. No revision write path changes, so
  `link-index-write-points.test.ts` is unaffected.
- Share-link single exception: no new caller-less entry.
- Design language: the new links reuse the "Open in graph" link styling;
  no new tokens.

## 7. Tests (requirement-driven)

Unit:
- Formatter: no section with zero edges; every edge line starts `Link: `; section placed before documents;
  hostile titles (newlines, `#`, U+2028) stay inside one JSON line; bytes
  counted toward the cap.
- Service: edges between selected documents kept; edge to an unresolved
  target kept as `missing: true` with `toId: null` and no internal key;
  edge to an existing unselected document omitted; self-link dropped;
  count carried; order as specified; a single selected document with only
  broken links still gets the section.
- Page preselection: focus first; cap at 20 with M reported; unresolved
  dropped; ineligible (archived) documents dropped; invisible `around`
  yields empty selection; `depth` other than 1/2 treated as 1; `around`
  beats `document`.
- Links panel / graph page: entry shown only under the 5.1 condition;
  hidden for Team workspaces, in the composer, and for a document whose only
  links are unresolved; href carries the shown depth; graph-page entry
  present with a valid `focus` regardless of filters.

E2E: from a document with links, click "Copy for Agent" in the inspector,
see the neighbourhood preselected, generate, and find the `## Links`
section listing the expected edges.

## 8. Left to the builder

- Exact wording of the link label (e.g. "Copy for Agent" vs "Copy
  neighbourhood for Agent") within the design-language contract.
- Whether the preselection helper lives in the page or a small server
  projection under `src/server/`.
- Test file names and fixture shape.
