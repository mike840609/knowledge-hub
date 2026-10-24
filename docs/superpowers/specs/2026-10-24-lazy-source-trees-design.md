# Source trees loaded on demand

## Intent and approved direction

Implement PR 2 from the sidebar split discussed with the user: separate source enumeration from tree loading, render the current source immediately, and fetch other source trees when first expanded. Preserve the current two-column navigation. The single-sidebar changes in PR #201 and cross-page tree persistence belong to other PRs.

## Current implementation

`SourceExplorerLayout` calls `getKnowledgeExplorerModel` with `includeCollections:true`. That option reads every source tree, although only the current source opens by default. `SourceSidebar` derives favorites, recent documents, filtering and onboarding emptiness from those trees. `KnowledgeLayout` also passes the same trees to `MoveDialogHost`. Partial data cannot be represented as an empty tree without changing these behaviors.

## Approaches

1. Fetch each source when expanded, preserving a complete current-source tree from the server. Recommended: removes unrelated tree queries while keeping direct-document navigation reliable.
2. Fetch all trees after initial paint. Rejected: moves the cost rather than removing it, and still transfers every tree.
3. Fetch individual folder children. Deferred: substantially changes keyboard navigation, ancestor reveal, move destinations and filtering. This PR loads one complete source at a time.

The user selected PR 2's source-level lazy-loading direction; details below are implementation proposals for review.

## Behavior

- Server bootstrap enumerates readable sources and loads only the current source tree. Other sources have an explicit unloaded state, distinct from a loaded empty tree.
- The current source's inclusive tree remains available for breadcrumbs, initial selection, ancestor reveal and same-source moves.
- Existing saved expansion choices remain authoritative. After persisted settings hydrate, previously expanded sources may load; unopened sources do not load by default.
- First expansion shows `Loading documents…` and starts one request. Repeated expansion while loading reuses it. Loaded trees remain available while this Knowledge layout is mounted.
- A failed source shows `Documents could not be loaded.` and a `Retry` button within its section. Failure must not become an empty-tree or missing-source state.
- A request for an old Workspace or superseded server snapshot cannot replace current data. Aborted/late requests do not show a false failure.
- A refreshed server snapshot invalidates previously loaded extra trees. Reload only those still needed (expanded or the active source), preserving expansion choices. Targeted mutation invalidation beyond this conservative refresh behavior is PR 4.
- Show archived continues to work with inclusive per-source tree data and the existing client visibility rules. Authorization remains in application queries.

## Compatibility requirements

### Favorites and recent documents

They must stay visible even when their source is not expanded. Resolve shortcut IDs through a metadata-only read (document/source IDs, title, source name, ownership and lifecycle visibility); do not fetch a complete tree merely to display a shortcut. Preserve favorites ordering, Show all, selected state and read-only cues. Do not change account synchronization or recents storage in this PR.

### Sidebar filtering

Retain existing cross-source label filtering. Only while a non-empty filter is active, load all visible source trees to evaluate it completely. Show loading/failure feedback rather than treating unloaded sources as no matches. Clearing the filter restores persisted expansion settings. This intentional full-search exception does not run when filtering is closed or empty.

### Empty state

An unloaded source is not proof that the Workspace is empty. Show the full initial import/create guidance only when emptiness is established; otherwise retain ordinary source headings and per-source empty states.

### Move dialog

Use the same loaded tree cache as the sidebar. Opening a move for a source whose tree has not loaded requests that source before calculating destinations, with loading and retry states. Never offer top level as the only destination simply because data is missing. Cross-source move rules remain unchanged.

## Interface and scope

- Add an authenticated Workspace/source-scoped tree GET route; verify that the readable source belongs to the requested Workspace before returning tree data. Return private/no-store responses through the existing HTTP adapter.
- Add a dedicated client hook for per-source load state and request deduplication. Keep fetched trees out of localStorage.
- Represent source headers separately from loaded trees at the Knowledge layout boundary; do not change every read-model consumer to a partial-tree type.
- Add metadata-only shortcut projection using existing authorized document summary/read ports. Do not return Markdown or revisions to this endpoint.
- Preserve existing design tokens, navigation labels, keyboard tree semantics and archive behavior. No schema migration or new dependency.

## Verification

Behavioral tests prove request counts as well as UI states: no read for unopened sources, one read per first expansion, cache reuse, retry after failure, stale response isolation, archive mode, shortcut visibility, filtering completeness and move destinations. Existing organizer, shortcut and tree keyboard tests must continue passing.

E2E covers real API calls: open an article, expand another source, collapse/reopen it, filter across sources, move a document, mutate/refresh and verify the tree. Measure equivalent data before/after using at least 400 documents across multiple sources: initial tree query count, response bytes and content arrival. Report hardware/data setup and results; do not reuse PR #201's historical numbers as new measurements.

## Implemented detail

Shortcut visibility required an opt-in `excludeArchivedAncestors` summary option, backed by a Workspace-scoped recursive SQL exclusion. Default summary consumers keep their previous behavior. Performance evidence covers equivalent read projections and DTO sizes on real MariaDB; full-browser before/after cold latency remains unmeasured, explicitly reported in the verification record.
