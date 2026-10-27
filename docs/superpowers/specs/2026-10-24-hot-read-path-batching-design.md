# Hot read-path batching: source list, recent palette, run detail, updates, and user lookups

Status: Draft for review
Date: 2026-10-24
Branch: `db-enhancement` (follow-up to PR #264)

## Intent and why

The first DB enhancement (PR #264) removed two over-reads and added the
lookup indexes that match the hottest query shapes. A follow-up scan found
that the remaining DB load is mostly **application-level N+1** and **repeated
authorization**, not missing indexes.

The worst examples:

- `getSourceListModel()` runs three queries per source (`20` runs, the latest
  APPLIED run, and the pending preview). The source list only shows
  `latestRun`, `latestSuccessfulRun`, and `pendingPreviewId`; 20 runs are
  fetched and one is used.
- `recentDocumentHits()` calls `getDocument()` once per recent ID. Each call
  re-checks visibility and loads the current revision.
- `GetSyncRunDetailService` calls `revisions.findById()` twice per change
  (before and after), up to 50 changes per page.
- `resolveRunActors()`, `workspace-admin.listMembers()`, and
  `workspace-admin.listAudit()` call `users.findById()` once per actor/member/
  event.
- `ListFolderUpdatesService` reads the source and read progress per run, and
  the Updates page separately calls `getSourceListModel()` just to render the
  source dropdown.

These are hot pages: Home, Sources, Sources health/import, Updates, the command palette, a source's
run detail, and Team member/audit settings. None of the fixes needs a schema
change, and none changes a response shape, authorization rule, or visible
ordering.

## Goals

- **G1. Source list:** replace `1 + 3N` lookups with `1 + 3` batched lookups
  and fetch only the latest run per source. `latestRun`,
  `latestSuccessfulRun`, and `pendingPreviewId` keep their exact meanings.
- **G2. Recent palette:** replace one `getDocument()` per ID with one
  visibility-aware batch read, preserving the caller's requested order and
  hiding archived/unreadable documents exactly as today. The batch matches
  `getDocument()` / `requireVisibleDocument()`: document and source status,
  not tree-node status.
- **G3. Sync run detail:** replace two revision lookups per change with one
  `findByIds()` read. Before/after pairing and `revisionUnavailable` behavior
  stay identical.
- **G4. User names:** add `users.findByIds()` and use it for run actors,
  Team members, and audit events. No authorization changes: the batch is only
  a name lookup after the caller has already passed the page's access check.
- **G5. Updates:** load the source dropdown with `queries.listSources()` (one
  query) instead of `getSourceListModel()`, and batch source names and read
  progress across the page's runs.
- **G6. No behavior change:** same results, same ordering, same visibility,
  same error mapping.

## Non-goals

This design deliberately does not touch the larger data-shape changes found in
the same scan. They get separate designs:

- Knowledge explorer batching/lazy collection trees.
- Document page link catalog/edge loading.
- Home's whole-workspace document query.
- Review/discussion and notification N+1.
- Search (`%term%`), JSON predicate indexes, import cleanup.
- Any schema, migration, index, or write-path change.

No caching across requests, no `FORCE INDEX`, no query hints, no API shape
changes.

## Anti-goals

- Do not change the meaning of "latest run": `latestRun` is the newest by
  `started_at DESC, id DESC` (any status); `latestSuccessfulRun` is the newest
  `APPLIED` by `completed_at DESC, id DESC`.
- Do not return a snapshot whose `based_on_version` differs from the source's
  current `syncVersion`, whose creator differs, or whose `expires_at` has
  passed.
- Do not return an archived document to the recent palette.
- Do not change the order of recent hits from the order the browser supplied.
- Do not make `getSourceDetailModel()` rely on `listSources()` for
  authorization; `getSource()` already checks workspace membership and the
  adapter's `source.workspaceId === workspaceId` check is kept.
- Do not batch a page into one unbounded query. Use 500-parameter chunks for
  by-ID reads, 200 source/version pairs for the snapshot lookup, and 50
  per-source probes for the latest-run statements.

## Constraints

- MariaDB 10.11, InnoDB. Window functions are available and already used in
  `share-comment-events.ts`.
- TypeScript strict; the repository ports are also consumed by unit-test
  fakes. Adding a required method means updating every fake that implements
  the interface.
- Batches must preserve the existing authorization boundary: call the same
  `requireWorkspaceRead` / `requireVisibleDocument` / workspace membership
  checks before the batch read. A batch method is never an authorization
  shortcut.
- Empty input returns `[]`/`new Map()` without a query.
- SQL uses placeholders generated from the chunk length, never string-
  interpolated IDs.

## Approaches considered

### A. Batch in the repository with `IN`, plus per-source index probes

By-ID reads use one chunked `WHERE id IN (...)` query. For "latest per
source", one statement holds up to 50 `ORDER BY ... LIMIT 1` subqueries joined
with `UNION ALL`, one per source ID. For by-ID reads this removes round trips;
for latest-per-source it turns one full-history window scan into one index
probe per source.

**Chosen.** It removes round trips and lets MariaDB use the existing
`(source_id, started_at)` / `(source_id, status, completed_at)` indexes.
`sync_runs` has no retention path, so the earlier
`ROW_NUMBER() OVER (PARTITION BY source_id ...)` draft read every run in the
workspace (and its `summary`) before discarding all but one row per source;
the probe shape reads exactly one row per source, as the old per-source
`LIMIT 1` calls did.

### B. Keep per-item queries but run them in parallel

`Promise.all` per source/ID hides latency but still sends N queries and holds
N pool slots. It does not reduce DB load.

**Rejected.** It trades latency for connection pressure.

### C. Cache per request or across requests

A request-level cache only helps duplicate reads in one request; these are
distinct keys. A cross-request cache would need invalidation on every source,
run, snapshot, user, document, and revision write.

**Rejected for this change.** Correctness risk is not justified by the
measured need.

### D. Updates: batch sources/progress but keep one changes query per run

The per-run change query carries its own `LIMIT 50`, unread filter, and
`total/added/updated` aggregate. A single window-function query is possible
but more complex; the page already bounds runs to 20.

**Chosen for this change.** Batch the two lookups that are pure repetition
(source name and read progress), keep the per-run changes query. A later
measurement can decide whether to batch it.

## Design

### 1. Source list: three batch queries

**Ports.**

`SyncRunRepository` gains:

```ts
listLatestBySourceIds(sourceIds: readonly string[]): Promise<SyncRun[]>;
listLatestAppliedBySourceIds(sourceIds: readonly string[]): Promise<SyncRun[]>;
```

`ImportSnapshotRepository` gains:

```ts
findLatestReadyIdsBySourceForCreator(
  sources: readonly { sourceId: string; basedOnVersion: number }[],
  creatorId: string,
  now: Date,
): Promise<Map<string, string>>;
```

The existing single-source `findLatestReadyIdBySourceForCreator` is removed
once its only caller (`source-read.ts`) uses the batch method. The old
`findLatestReadyBySourceForCreator` is already gone from PR #264.

**SQL.** For latest run per source (chunked, 50 source IDs per statement):

```sql
SELECT * FROM (
  (SELECT * FROM sync_runs WHERE source_id = ? ORDER BY started_at DESC, id DESC LIMIT 1)
  UNION ALL
  (SELECT * FROM sync_runs WHERE source_id = ? ORDER BY started_at DESC, id DESC LIMIT 1)
) latest
```

Latest APPLIED per source is the same shape with `AND status = 'APPLIED'` and
`ORDER BY completed_at DESC, id DESC`. Each subquery is one
`(source_id, started_at)` or `(source_id, status, completed_at)` index probe
that stops after one row, so the statement's cost follows the source count and
not the unbounded run history. Result order is irrelevant because the caller
maps by source ID. A realistic workspace needs one or two statements.

Pending preview IDs (chunked, 200 source/version pairs):

```sql
SELECT source_id, id FROM (
  SELECT i.source_id, i.id,
         ROW_NUMBER() OVER (
           PARTITION BY i.source_id ORDER BY i.finalized_at DESC, i.id DESC
         ) AS rn
  FROM source_import_snapshots i
  WHERE i.created_by = ? AND i.state = 'READY' AND i.expires_at > ?
    AND (i.source_id, i.based_on_version) IN ((?, ?), (?, ?), ...)
) ranked
WHERE ranked.rn = 1
```

The READY quota is small (default 10 per creator), so the snapshot batch is
cheap even without the P2 snapshot index.

**Caller.** `getSourceListModel()` runs one unit of work that calls the three
batch methods once for the whole source list, then builds a map per source.
The old `SOURCE_RUN_LIST_LIMIT = 20` list read disappears with the batching;
the source list item has only `latestRun`, so 20 rows were never used. HUB
sources are skipped for the APPLIED and pending lookups.

**Tests.**
- Repository integration: two sources with interleaved runs; assert one
  latest run per source, one latest APPLIED per source, and no cross-source
  leakage.
- Snapshot integration: two READY snapshots for the same source and version;
  the newer `finalized_at`/id wins; expired, foreign-creator, and
  wrong-version rows are excluded.
- Source-list model test: `latestRun`, `latestSuccessfulRun`, and
  `pendingPreviewId` match the old per-source results.
- A unit test with a fake unit of work asserts each batch method is called
  once and the old per-source methods are not called.

### 2. Recent palette: one visibility-aware document batch

**Port and service.** Add to `TreeRepository`:

```ts
listDocumentsByIds(
  workspaceId: string,
  documentIds: readonly string[],
  includeArchived: boolean,
): Promise<DocumentSummary[]>;
```

Add to `KnowledgeQueryService`:

```ts
listDocumentSummariesByIds(
  caller: CallerContext,
  workspaceId: string,
  documentIds: readonly string[],
  input?: { includeArchived?: boolean },
): Promise<DocumentSummary[]>;
```

The service calls `syncCallerIdentity()`, `requireWorkspaceRead()`, then the
repository batch. The SQL is the same shape as `listDocumentsByWorkspace()`
but with `d.id IN (...)` and the **same visibility as `getDocument()`**
(document and source status; no tree-node status filter):

```sql
SELECT d.id AS document_id, d.source_id, r.title, r.created_at AS updated_at,
       s.ownership, s.status AS source_status, d.status
FROM knowledge_documents d
JOIN knowledge_sources s ON s.id = d.source_id
JOIN knowledge_revisions r ON r.id = d.current_revision_id AND r.document_id = d.id
WHERE s.workspace_id = ? AND d.id IN (?, ?, ...)
  AND (? = 1 OR (s.status = 'ACTIVE' AND d.status = 'ACTIVE'))
```

Do not copy `listDocumentsByWorkspace()`'s `n.status = 'ACTIVE'` predicate
here: `getDocument()` does not require the tree node to be active, so adding it
would change which recent documents the palette shows.

**Caller.** `recentDocumentHits()` makes one batch call, maps by document ID,
and walks the caller's requested ID order. It keeps the existing
`listSources()` call for source names. The per-ID `try/catch` disappears;
`workspaceHttp` already turns a failure into the route's error response, and
an unknown ID simply has no row.

**Tests.**
- Unit test with fake services: order is preserved; archived/unreadable IDs
  are omitted; one batch call is made; empty IDs make no call.
- Integration test: one active document, one archived document, one document
  from another workspace; only the active workspace document is returned.

### 3. Sync run detail: one revision batch

**Port.** Add to `RevisionRepository`:

```ts
findByIds(ids: readonly string[]): Promise<KnowledgeRevision[]>;
```

SQL: `SELECT * FROM knowledge_revisions WHERE id IN (...)` in 500-ID chunks.

**Service.** `GetSyncRunDetailService` collects the distinct
`beforeRevisionId`/`afterRevisionId` values from the 50 rows, calls
`findByIds()` once, builds a map, and uses the map in the per-change loop.
The rest of the diff/revisionUnavailable logic is unchanged. Keep the
existing `hasRecordedChanges` existence query; it is one small lookup and is
still needed for pagination past the first page.

**Tests.**
- Integration: a run with before/after revisions; assert the detail still
  pairs them and computes `revisionUnavailable` when only one side exists.
- Unit with a fake unit of work: `findByIds` is called once; `findById` is
  not called per change.

### 4. User lookups: one batch method, three call sites

**Port.** Add to `UserRepository`:

```ts
findByIds(ids: readonly string[]): Promise<UserIdentity[]>;
```

SQL: `SELECT id, emp_id, name, org_code FROM users WHERE id IN (...)` in
500-ID chunks.

**Call sites.**
- `resolveRunActors()`: the caller prefetches the distinct actor IDs from
  `users.findByIds()`, builds a `Map<id, name>`, and passes an in-memory
  callback to the existing function. The function's signature and unit test
  stay unchanged.
- `workspace-admin.listMembers()`: list memberships once, `findByIds()` once,
  then build the same view in membership order.
- `workspace-admin.listAudit()`: collect actor IDs from the 50 events,
  `findByIds()` once, then map names into the audit items.

Also remove the redundant `listSources()` check in
`getSourceDetailModel()`: `getSource()` already checks workspace membership,
and the adapter's `source.workspaceId === workspaceId` check is kept.

**Tests.**
- Repository integration: multiple IDs, one missing ID; returns the existing
  rows.
- `source-run-actors.test.tsx` stays green; add a unit test around the caller
  if practical.
- `phase3-workspace-admin-api.test.ts`: member and audit results unchanged.
- Source detail authorization tests: archived source still resolves with
  `includeArchived: true`; wrong workspace/source still returns null.

### 5. Updates page and folder updates

**Page.** `src/app/w/[workspaceId]/updates/page.tsx` currently calls
`getSourceListModel()` only to render the Folder dropdown. Replace it with
`queries.listSources(caller, workspaceId, { includeArchived: true })` (one
query; archived folders stay selectable because their applied runs still show)
and filter `sourceType === "FOLDER_SYNC"` in the page.

**Service.** `ListFolderUpdatesService`:

1. `listAppliedRuns()` once (unchanged).
2. `sourcePolicy.listByWorkspaceId(workspaceId, {})` once; map by source ID.
3. `Promise.all(selected.map(run => listReadingChanges(...)))` — still one
   query per run, but parallel.
4. Collect all document IDs from all run results, call
   `documentReadProgress.getMany()` once, and build one map.
5. Build groups in run order with the same `total/added/updated`, unread
   calculation, and source-active filter.

Query count drops from `1 + 4N` to `2N + 3` for the service (`listReadingChanges`
itself issues a count and a rows query per run), and the page drops its
separate `1 + 3N` source-list model in favour of one `listSources()` query.

**Tests.**
- `tests/integration/folder-sync-reading-history.test.ts` (or the existing
  updates test) asserts the same groups, order, unread flags, and pagination.
- A unit test with fake repositories asserts one source-list call and one
  `getMany` call regardless of the number of runs.
- E2E: the Updates page still lists the same runs and the Folder dropdown
  still filters by source.

## Verification

### Unit and integration gates

1. `npm run typecheck`.
2. `npm run test:unit`.
3. Focused integration:
   - `tests/integration/import-safety.test.ts`
   - `tests/integration/sync-run-detail.test.ts`
   - `tests/integration/folder-sync-reading-history.test.ts`
   - `tests/integration/phase1-query.test.ts`
   - `tests/integration/phase3-request-authorization.test.ts`
   - `tests/integration/phase3-workspace-admin-api.test.ts`
   - the new repository batch tests.
4. Targeted E2E: source list, Updates, command palette recent documents,
   source run detail, workspace members/audit.

### Query-count and access-path evidence

The source-list run selection does change an access path: the window draft read
the entire run history, while the shipped shape is one index probe per source.
Everything else is a round-trip reduction and keeps its old access path. The
evidence is therefore both call count and `ANALYZE FORMAT=JSON`:

- Source list with N sources: three batch calls instead of `3N`; the latest-run
  statements carry at most 50 probes each and return one row per source instead
  of scanning every run in the workspace. On a synthetic 50-source × 500-run
  table (`ANALYZE FORMAT=JSON`), the window shape read 25,000 run rows
  (derived-table `r_rows`, `access_type: ALL`, filesort) while the probe shape
  read 50 rows (50 × `ref` on `idx_sync_runs_source_started`, `r_rows = 1`);
  the APPLIED shapes read 2,500 vs 50 rows on
  `idx_sync_runs_source_status_completed`.
- Recent palette with M IDs: one document batch plus one source list instead
  of `M` `getDocument()` calls.
- Run detail with C changes: one revision batch instead of up to `2C`
  `findById()` calls.
- Members/audit: one user batch per page instead of one per row.
- Updates: one source list and one read-progress query instead of one each
  per run; the page no longer builds the source-list model.

Add unit tests with counting fakes for the five service-level paths. Use
integration tests for the SQL results, not for query counts.

### Measurement

Before/after query counts can be observed with a counting `QueryConnection`
wrapper in a unit/integration test. If a production-like environment is
available, record page p95 and DB QPS for Home, Sources, Updates, the palette,
run detail, and members/audit after deploy.

## Rollout and rollback

- No migration and no feature flag. Deploy as a normal code change.
- The batched methods are additive until the single-source/old paths are
  removed. The only removals are the dead single-source methods and the
  redundant `listSources()` call in `getSourceDetailModel()`.
- Rollback is a code revert; no data or schema rollback is needed.
- If a batch method is noticeably slower on production-like data, keep the
  per-item path behind the same service boundary and measure the window
  function plan; do not add a hint.

## Open questions and builder calls

- **Method names.** `listLatestBySourceIds`,
  `listLatestAppliedBySourceIds`, and
  `findLatestReadyIdsBySourceForCreator` are proposals; adjust to local
  conventions without changing semantics.
- **Remove the single-source snapshot method?** It has one production caller.
  Remove it and update tests unless the builder finds a hidden caller.
- **Chunk size.** 500 IDs / 200 source-version pairs is the default; keep it
  in one helper so it can be tuned.
- **Updates per-run change batch.** The design keeps one change query per run.
  If production run pages are slow, a later design can add a window-function
  top-N-per-run query.
- **Home/explorer/link/review/search.** These remain separate designs, in that
  order of expected impact.

## Follow-up designs (not this plan)

1. Knowledge explorer: batch/one-workspace tree read, lazy collection
   expansion, and a direct default-document query instead of looping trees.
2. Document page: bounded link catalog/backlink/neighborhood reads instead of
   whole-workspace catalog + edges on every page.
3. Home: SQL-side selection of recent/favorites/drafts instead of loading all
   document summaries and all entries.
4. Review/discussion: batch threads, comments, users, revisions, and share
   links in `DocumentReviewService`.
5. Search/JSON/cleanup: n-gram or derived search index, generated columns for
   hot JSON predicates, and cleanup query indexes if measurement justifies
   them.
