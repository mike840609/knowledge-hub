# DB read-path enhancement: narrow projections and lookup indexes

Status: Approved 2026-10-24; implementation complete
Date: 2026-10-24
Branch: `db-enhancement`
Measurement context: dev MariaDB 10.11.19, 2026-10-24. Dev has 2 `sync_runs` and 1
`source_import_snapshots` row, so its plans prove query shape, not production
cardinality. The synthetic 50k-row probe and the dev probe are recorded in
`## Appendix: measurements`.

## Intent and why

Two hot read paths are doing more work than the page needs, and two lookup
queries use indexes that do not match their filter/sort shape.

- **Source list pending preview.** `getSourceListModel()` asks for the latest
  READY import snapshot for every source, but the caller only uses
  `pending?.id` (`src/server/source-read.ts:61-63`). The repository currently
  does `SELECT *` and maps the full snapshot, including the `plan` JSON
  (`import-snapshots.ts:67-70`). On dev, one snapshot's `SELECT *` sent
  **67,015 bytes**; `SELECT id` sent **169 bytes**. The plan column alone is
  **63,447 bytes**.
- **Document history.** `knowledge-read.ts` hands the browser only
  `{ id, revisionNo, createdAt, history }` (`knowledge-read.ts:60`), but
  `revisions.listByDocument()` is `SELECT r.*` (`revisions.ts:85-91`). On dev,
  7 rows were **3,195 bytes** for `SELECT r.*` and **1,323 bytes** for the
  summary columns. Dev markdown is short; production documents make the
  difference larger.
- **Latest successful sync run per source.** The query is
  `WHERE source_id=? AND status='APPLIED' ORDER BY completed_at DESC, id DESC LIMIT 1`
  (`sync-runs.ts:35-43`). Existing indexes are `(source_id, started_at)` and
  the global `sync_runs_applied_cursor (status, completed_at, id)`. The former
  filters by source but needs a filesort; the latter orders globally and must
  scan other sources. Dev probe: adding `(source_id, status, completed_at)`
  removes the filesort, and `MAX(completed_at)` becomes
  **“Select tables optimized away”**.
- **Tree order.** `tree.listBySource()` orders by
  `COALESCE(parent_id, ''), position, id` (`tree.ts:66-77`), while the index is
  `(source_id, parent_id, status, position)`. The expression and the `status`
  column prevent the index from supplying order. Dev probe: the original query
  uses a full scan + filesort; after rewriting the order and adding
  `(source_id, parent_id, position)`, a forced plan has no filesort.

The goal is to stop reading payload the caller discards, and to make the two
lookups use indexes that match their predicates and ordering. This is a
read-path change only: no document, import, sync, or tree semantics change.

## Goals

- **G1.** The source list fetches only the pending preview ID, not the full
  snapshot. No `plan`/`summary` JSON is selected, parsed, or sent to the page.
- **G2.** Document history fetches only the fields the browser uses. No
  `markdown`, `title`, `metadata`, or `content_hash` is selected for the list.
- **G3.** Add an additive `sync_runs` index for the per-source latest APPLIED
  lookup. Existing run-list and workspace-wide feed queries keep their current
  results; their plans are a measured expectation, not an assumed side effect.
  The dev probe already showed `latestAttempt` staying on
  `idx_sync_runs_source_started` with the new index present. Production-like
  `EXPLAIN` must confirm the unfiltered run list and
  `findAppliedBySnapshotId()` do not regress.
- **G4.** Rewrite the tree order to be index-friendly and add an additive
  `knowledge_tree_nodes` index. The visible order must remain exactly the same.
- **G5.** Migration 025 creates both indexes; tests cover the new repository
  methods, the tree order, and the migration.

## Non-goals

- **P2 indexes are out of scope.** Do not add
  `source_import_snapshots (created_by, state, expires_at)` or
  `(source_id, created_by, state, based_on_version, finalized_at)` in this
  change. They remain candidates after production measurement.
- **No `summary.snapshotId` column.** The JSON extraction remains as-is.
- **No batching of the source-list N+1.** `getSourceListModel()` still makes
  three lookups per source. Batching is a separate change once production
  source counts justify it.
- **No `sync_runs` list/summary projection.** The source list still fetches 20
  runs and uses only `runs[0]`, and `SyncRun` still carries `summary`. This is
  the same over-read pattern as G1, but it was not measured as a bottleneck;
  it is a follow-up after source counts and payload are measured.
- **No revision-content API change.** `listRevisions()` and the endpoints that
  return full content keep working as they do.
- **No tree lazy loading.** The tree still reads the whole source tree; only
  the sort path changes.
- **No index removal.** `sync_runs_applied_cursor`,
  `idx_sync_runs_source_started`, and the existing tree index stay.
- **No full-text search work.** Markdown `%term%` search is not addressed by a
  B-tree index.

## Anti-goals

- Do not change the visible order of any tree: roots first, then `position`,
  then `id` as the deterministic tie-break.
- Do not introduce a second definition of “latest READY snapshot” or “latest
  successful run”; reuse the existing predicates.
- Do not bypass the existing authorization path. The new revision-summary
  service method must call the same `requireVisibleDocument()` check as
  `listRevisions()`.
- Do not add `id` to secondary index definitions. MariaDB 10.11 InnoDB
  extended keys append the primary key; the explicit column is redundant.
- Do not make the migration destructive or dependent on data backfill.

## Constraints

- MariaDB 10.11, InnoDB, native `UUID` columns. Secondary indexes use extended
  keys; plans in this document were verified against 10.11.19.
- The migration runner applies an ordered manifest with no down migrations.
  Migration 25 must be additive and registered in
  `src/infrastructure/database/mariadb/migrations/index.ts`.
- The repository interfaces are consumed by unit-test fakes and by
  integration tests. Adding a required method means updating the fakes that
  implement the interface or the tests that exercise the new path.
- TypeScript is strict. `KnowledgeRevisionSummary` must not expose `markdown`
  or other content fields.
- Integration tests run against an isolated migrated database. Migration
  statements must work on a fresh database and on the populated dev database.

## Approaches considered

### A. Pending preview: how to stop reading the snapshot

| Option | Trade-off | Decision |
| --- | --- | --- |
| Keep `findLatestReadyBySourceForCreator()` and add a second ID-only method | No caller breakage, but two methods with the same predicate can drift; the full method becomes dead code | Rejected |
| Replace it with `findLatestReadyIdBySourceForCreator()` returning `string \| null` | One predicate, one method; the only production caller already uses only the ID. Integration test calls must be updated | **Chosen** |
| Inline the ID query in `source-read.ts` | Avoids a port change, but puts SQL in the server adapter and duplicates the predicate | Rejected |

### B. Revision history: how to stop reading bodies

| Option | Trade-off | Decision |
| --- | --- | --- |
| Change `listByDocument()` to return summaries | Breaks callers that need content (autosave/revision tests); conflates two read shapes | Rejected |
| Add `listSummariesByDocument()` to the repository and `listRevisionSummaries()` to the query service | Keeps full-content reads intact; reuses `requireVisibleDocument()`; explicit summary type | **Chosen** |
| Keep `listByDocument()` and trim in `knowledge-read.ts` | The full markdown is still read from the database and sent through the mapper | Rejected |

### C. Tree ordering

| Option | Trade-off | Decision |
| --- | --- | --- |
| Add an index only, keep `COALESCE(parent_id, '')` | The expression prevents the index from providing order; filesort remains | Rejected |
| Rewrite to `ORDER BY parent_id, position, id` and add `(source_id, parent_id, position)` | Matches MariaDB NULL-first ordering; removes filesort when the index is selected; requires a semantics regression test | **Chosen** |
| Use an explicit `CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END` sort key | More code, no benefit over MariaDB’s NULL-first ASC order | Rejected |

### D. Migration shape

| Option | Trade-off | Decision |
| --- | --- | --- |
| One migration 025 with both indexes | One deploy unit; both are additive; easy rollback by index name | **Chosen** |
| Separate migrations for each index | More versions for no functional benefit | Rejected |
| Add indexes manually outside migrations | Not reproducible; dev/test/production drift | Rejected |

## Design

### 1. Pending preview returns only an ID

**Port.** Replace the method in
`src/modules/sources/ports/import-snapshot-repository.ts`:

```ts
findLatestReadyIdBySourceForCreator(
  sourceId: string,
  creatorId: string,
  now: Date,
  basedOnVersion: number,
): Promise<string | null>;
```

**Repository.** In `import-snapshots.ts`, replace the existing implementation
with:

```ts
async findLatestReadyIdBySourceForCreator(
  sourceId: string,
  creatorId: string,
  now: Date,
  basedOnVersion: number,
): Promise<string | null> {
  const rows = await this.connection.query<{ id: unknown }[]>(
    `SELECT id FROM source_import_snapshots
     WHERE source_id=? AND created_by=? AND state='READY'
       AND expires_at>? AND based_on_version=?
     ORDER BY finalized_at DESC, id DESC LIMIT 1`,
    [sourceId, creatorId, now, basedOnVersion],
  );
  return rows[0] ? String(rows[0].id) : null;
}
```

No `mapSnapshot`, no `JSON.parse`, no `plan` selection. The `expires_at`
predicate remains a row condition; the index work for this query is P2 and is
not part of this change.

**Caller.** In `getSourceListModel()`:

- Compute one `const now = new Date()` before the `Promise.all` and pass it to
  every source, instead of constructing a new `Date` per source.
- Set `pendingPreviewId: pending` (the returned string or null).
- Remove the now-unused full-snapshot method and update
  `tests/integration/import-safety.test.ts` to compare the returned ID
  directly.

**Tests to update.**
- `tests/integration/import-safety.test.ts:106-144`: replace the four calls
  and remove `?.id`.
- Any fake implementing `ImportSnapshotRepository` in unit tests: replace the
  method with the ID-only method.
- Add an integration assertion for the DB → `getSourceListModel()` →
  `pendingPreviewId` path. It must create a READY, unexpired, non-HUB snapshot
  and assert the source list item's `pendingPreviewId` equals that snapshot's
  ID. `tests/integration/phase3-request-authorization.test.ts` currently checks
  `latestRun`/`latestSuccessfulRun` only; it does not cover `pendingPreviewId`.
- `tests/e2e/mvp-freshness.spec.ts:46-51` already asserts the rendered
  “Review preview” link points at the pending snapshot; rerun it as the
  end-to-end check.

### 2. Revision history returns summaries

**Type.** Add to `src/modules/knowledge/domain/revision.ts`:

```ts
export type KnowledgeRevisionSummary = Pick<
  KnowledgeRevision,
  "id" | "revisionNo" | "createdAt" | "history"
>;
```

In `src/server/knowledge-read.ts`, define `RevisionSummary` as this type
(or keep the existing `Pick<KnowledgeRevisionView, ...>`; they are
structurally identical). One definition is preferred.

**Repository port.** Add to
`src/modules/knowledge/ports/revision-repository.ts`:

```ts
listSummariesByDocument(documentId: string): Promise<KnowledgeRevisionSummary[]>;
```

Keep `listByDocument()` unchanged for full-content consumers.

**Repository implementation.** In `revisions.ts`, add a mapper and query that
select only the summary columns:

```sql
SELECT r.id, r.revision_no, r.created_at,
       r.history_state, r.history_activity_id, r.history_window_started_at,
       r.version_name, r.history_reason
FROM knowledge_revisions r
WHERE r.document_id = ?
  AND (r.history_state = 'CHECKPOINT' OR EXISTS (
    SELECT 1 FROM knowledge_documents d WHERE d.current_revision_id = r.id
  ))
ORDER BY r.revision_no ASC
```

The predicate is intentionally identical to `listByDocument()`; it keeps
checkpoint revisions plus the current revision. The mapper mirrors
`mapRevision()` for the history fields but omits title/markdown/metadata/
content hash/created by.

**Query service.** Add to `KnowledgeQueryService` and
`KnowledgeQueryServiceImpl`:

```ts
listRevisionSummaries(
  caller: CallerContext,
  documentId: string,
  input?: { includeArchived?: boolean },
): Promise<KnowledgeRevisionSummary[]>;
```

Implementation mirrors `listRevisions()`:

```ts
return this.unitOfWork.run(async (repositories) => {
  const { document } = await requireVisibleDocument(
    repositories, caller, documentId, input.includeArchived ?? false,
  );
  return repositories.revisions.listSummariesByDocument(document.id);
});
```

`listRevisions()` remains for callers that need full revision views.

**Caller.** In `knowledge-read.ts`, replace
`services.queries.listRevisions(...)` with
`services.queries.listRevisionSummaries(...)`. Keep the existing
`WORKING`/current-revision filter and the mapping that drops all other fields;
after this change the map is a no-op or can be simplified to the summary
values. The selected revision (`getCurrentRevision` / `getRevision`) still
carries the body.

**Tests to update.**
- `tests/unit/knowledge-document-model.test.ts:50`: mock
  `listRevisionSummaries`, returning summary objects; keep the assertion that
  `JSON.stringify(model.revisions)` does not contain revision body text.
- `tests/unit/phase1-read-model.test.ts:88-93`: add
  `listSummariesByDocument` to the fake repository. Add a test for the new
  service method if the fake is used by one.
- `tests/unit/phase1-contracts.test.ts`: the local `KnowledgeQueryService`
  mirror (lines 113-122) and its stub object (lines 250-265) must include the
  new method; add `assertCallerFirst<KnowledgeQueryService["listRevisionSummaries"]>(true)`.
- `tests/integration/phase1-revisions.test.ts`: add a test that
  `listSummariesByDocument()` returns the expected revisions in order and that
  the returned objects have no `markdown`/`title`/`metadata` keys.
- `tests/integration/autosave-history.test.ts`: add a test using the existing
  `setup()` helper that saves autosaves and asserts `listSummariesByDocument()`
  returns the same IDs as `listByDocument()`, including the current WORKING
  revision, with no content fields.
- `tests/integration/phase1-query.test.ts`: add the same authorization cases
  as `listRevisions()` for the new service method (outsider, archived
  document, missing document).

### 3. `sync_runs` per-source latest APPLIED index

**Migration statement:**

```sql
CREATE INDEX idx_sync_runs_source_status_completed
  ON sync_runs (source_id, status, completed_at);
```

**Why this shape.**
- `source_id` and `status` are equality predicates.
- `completed_at` supplies `ORDER BY completed_at DESC`.
- InnoDB appends the primary key `id`, so `ORDER BY completed_at DESC, id DESC`
  is satisfied without an explicit `id` column in the index.
- `MAX(completed_at)` can use the same index and is reported as
  “Select tables optimized away” on dev.

**What it serves.**
- `listBySourceId(sourceId, 1, 'APPLIED')` (`sync-runs.ts:35-43`), used by the
  source list and source health.
- The correlated `MAX(completed_at)` in `personal-profile.ts`.
- `findAppliedBySnapshotId()` gets a narrower scan (the JSON predicate stays
  residual until the P3 `snapshotId` work).

**What it does not serve.**
- `latestAttempt` (`status IN ('APPLIED','FAILED') ORDER BY started_at`)
  continues to use `idx_sync_runs_source_started`. The probe with the new index
  present still chose `idx_sync_runs_source_started`; this is a checked
  expectation, not an assumption.
- `listBySourceId(sourceId, 20)` without a status continues to use
  `idx_sync_runs_source_started`; it must be re-checked on production-like
  data because the new index is a competing candidate.
- `listAppliedRuns()` (workspace-wide feed) continues to use
  `sync_runs_applied_cursor`.
- `findAppliedBySnapshotId()` gains the new index for its source/status
  prefix, but its JSON predicate remains residual. Check that it does not
  regress.
- `findById` continues to use the primary key.

**Do not change** the existing indexes in this migration.

### 4. Tree ordering

**SQL.** In `tree.ts:66-77`, change:

```sql
ORDER BY COALESCE(n.parent_id, ''), n.position, n.id
```

to:

```sql
ORDER BY n.parent_id, n.position, n.id
```

**Why it is equivalent.** MariaDB sorts `NULL` first in ascending order.
`COALESCE(parent_id, '')` maps `NULL` to the empty string, which sorts before
every UUID string, so roots remain first. The `position` and `id` tie-breaks
are unchanged. A 500-row probe compared the two orderings and found **0
mismatches**.

**ID-format assumption.** The equivalence also relies on the app's UUIDv7
primary keys and MariaDB's native UUID ordering (available on 10.11.5+). A
different id format, or a server that compares the UUID type byte order
differently, could change the `id` tie-break. Re-check the order before either
assumption changes; the release gate includes the server version.

**Index:**

```sql
CREATE INDEX idx_tree_source_parent_position_order
  ON knowledge_tree_nodes (source_id, parent_id, position);
```

With `source_id` equality, the index order is `parent_id, position`, and the
extended primary key supplies `id`. The new index has no `status` column; the
old `(source_id, parent_id, status, position)` index stays for now. No current
query filters `status` together with `source_id` and `parent_id`, but the old
index is not removed until production EXPLAIN confirms it is unused.

**Scope note.** This changes the SQL sort path, not the visible tree. The UI
independently rebuilds and sorts the tree in `buildKnowledgeTree()`
(`src/lib/knowledge-navigation.ts:28-53`) by `position` then `id`, so the
visible order is already guaranteed there; `listBySource()` order also feeds
`collectAncestors()`, which is order-insensitive. The rewrite is for DB sort
cost, and the new index is for removing the filesort when the optimizer
chooses it. Do **not** add `FORCE INDEX` or a hint in this change. On dev, the
optimizer still chose a full scan because the source held 70/118 rows; that is
not evidence against the index. Production-like EXPLAIN decides whether the
index is used. If production never chooses it, revisit the index set (for
example, whether the old `(source_id, parent_id, status, position)` index can
be dropped) in a follow-up; do not force the plan here.

The query still reads every node of the source (`SELECT n.*` plus
document/revision joins). Folder-level lazy loading is a separate design.

**Tests.**
- Add an integration test in `tests/integration/phase1-tree.test.ts` that
  creates root folders/documents and nested folders/documents with distinct
  positions and asserts the repository `listBySource()` order: roots first,
  then `position`, then `id`. This protects `collectAncestors()` and any
  non-UI consumer; the browser order is covered by the existing explorer E2E.
- Add a direct SQL equivalence check in the same test (or a small integration
  test) comparing `ORDER BY COALESCE(parent_id, ''), position, id` with
  `ORDER BY parent_id, position, id` over the seeded rows. This guards the
  claim on the real schema type.
- Existing tree tests (`phase1-tree.test.ts`, `phase1-lifecycle.test.ts`,
  `core.test.ts`, `organize-api.test.ts`, and the explorer E2E) continue to
  pass.

### 5. Migration 025

Create
`src/infrastructure/database/mariadb/migrations/025-query-path-indexes.ts`:

```ts
import type { Migration } from "./types";

/**
 * Additive read-path indexes. The sync-run index serves the per-source latest
 * APPLIED lookup; the tree index lets the rewritten order avoid a filesort.
 * No data is backfilled and no existing index is removed.
 */
export const queryPathIndexesMigration: Migration = {
  version: 25,
  name: "query-path-indexes",
  statements: [
    "CREATE INDEX idx_sync_runs_source_status_completed ON sync_runs (source_id, status, completed_at)",
    "CREATE INDEX idx_tree_source_parent_position_order ON knowledge_tree_nodes (source_id, parent_id, position)",
  ],
};
```

Register it in `migrations/index.ts` after `reviewThreadFollowsMigration`.

**Operational notes.**
- MariaDB 10.11 InnoDB creates secondary indexes online for normal `CREATE
  INDEX`. The production runbook should verify no long metadata lock and use a
  low-traffic window for the first application.
- No down migration exists. To roll back after reverting the code:
  `DROP INDEX idx_tree_source_parent_position_order ON knowledge_tree_nodes;`
  and
  `DROP INDEX idx_sync_runs_source_status_completed ON sync_runs;`.
- Do not drop `idx_tree_source_parent_position` in the same rollout.

## Verification

### Unit and integration gates

1. `npm run typecheck` and `npm run lint`.
2. `npm test` (unit) and the focused integration suites:
   - `tests/integration/import-safety.test.ts`
   - `tests/integration/phase1-revisions.test.ts`
   - `tests/integration/autosave-history.test.ts`
   - `tests/integration/phase1-query.test.ts`
   - `tests/integration/phase1-tree.test.ts`
   - `tests/integration/phase1-migration-runner.test.ts`
   - `tests/integration/phase3-request-authorization.test.ts`
   - the new source-list `pendingPreviewId` integration test
3. New migration test: after `runMigrations()`, `SHOW INDEX FROM sync_runs`
   contains `idx_sync_runs_source_status_completed`, and
   `SHOW INDEX FROM knowledge_tree_nodes` contains
   `idx_tree_source_parent_position_order`. The `schema_migrations` ledger has
   version 25 in `APPLIED`.
4. Browser regression: `tests/e2e/mvp-freshness.spec.ts` (pending preview link
   opens the correct preview), document history still lists the same versions,
   and explorer tree order is unchanged. Reuse the existing source-list,
   document-history, and explorer E2E suites; no new browser fixture is
   required.

### Performance verification (must run on production-like data)

Dev has only 2 `sync_runs` and 1 snapshot, so its plans are a smoke test, not
acceptance evidence. Before merging to production, restore a production dump
into a scratch DB or use a read replica and run the following with
`EXPLAIN FORMAT=JSON` and `ANALYZE FORMAT=JSON`:

| Query | Expected after |
| --- | --- |
| `SELECT * FROM sync_runs WHERE source_id=? AND status='APPLIED' ORDER BY completed_at DESC, id DESC LIMIT 1` | uses `idx_sync_runs_source_status_completed`; no `Using filesort`; scanned rows near the source's APPLIED count, not the global APPLIED count |
| `SELECT MAX(completed_at) FROM sync_runs WHERE source_id=? AND status='APPLIED'` | “Select tables optimized away” |
| `latestAttempt`: `status IN ('APPLIED','FAILED') ORDER BY started_at DESC, id DESC LIMIT 1` (both standalone and the correlated subquery in `personal-profile.ts`) | still uses `idx_sync_runs_source_started`; no filesort; no result change |
| `listBySourceId(sourceId, 20)` without a status | still uses `idx_sync_runs_source_started`; no filesort |
| `findAppliedBySnapshotId(sourceId, snapshotId)` | uses the new index for the source/status prefix; JSON predicate remains residual; no regression |
| Tree `listBySource()` with the rewritten order | uses `idx_tree_source_parent_position_order` when the source is a small fraction of `knowledge_tree_nodes`; no filesort; full scan is acceptable if the optimizer proves it cheaper. Do not add a hint; if production never chooses it, revisit the index set in a follow-up |
| Source list pending preview | `Bytes_sent` for the lookup no longer scales with `plan` JSON; no `JSON.parse` of `plan` |
| Document history | `Bytes_sent` no longer includes markdown/title/metadata |

Record `r_rows`, `r_total_time_ms`, chosen key, and filesort for each query
before and after. Do not accept the change on “the index exists” alone.

Record the target server version as part of the gate: the tree-order
equivalence assumes MariaDB 10.11.5+ native UUID ordering and the app's UUIDv7
ids. If the target is older or the id format changes, re-run the tree order
comparison before accepting the rewrite.

## Rollout and rollback

1. Apply migration 025 to the target database. It is additive and does not
   change query results.
2. Deploy the code changes (ID-only preview, revision summaries, tree order).
   The tree order is correct with or without the new index; the index only
   changes performance.
3. Verify the production-like EXPLAIN table above and the browser regression.
4. If rollback is needed, revert the code first (the old query still works with
   the new indexes), then optionally drop the two indexes. Dropping
   `idx_tree_source_parent_position_order` before reverting the code would
   restore the filesort but not change correctness.

## Open questions and builder calls

- **Method naming.** `findLatestReadyIdBySourceForCreator` and
  `listSummariesByDocument` are proposals; adjust to local naming conventions
  without changing the behavior.
- **Removal of the old snapshot method.** The design replaces
  `findLatestReadyBySourceForCreator` because the only production caller uses
  the ID. If the builder finds a hidden caller, keep the old method and add the
  ID method instead; the SQL predicate must stay identical.
- **Summary type location.** `KnowledgeRevisionSummary` is proposed in
  `domain/revision.ts`. If the codebase prefers port-owned types, put it in
  `ports/revision-repository.ts` and import it from there.
- **Production measurement owner/window.** The design requires a production
  dump or replica measurement before accepting the index changes; the owner and
  window are not decided here.
- **P2 indexes.** Do not add them in this change. Revisit after the production
  measurement and after the P0 projection removes the plan payload.

## Appendix: measurements

### Dev row counts (2026-10-24)

| Table | Rows |
| --- | ---: |
| `sync_runs` | 2 |
| `source_import_snapshots` | 1 |
| `knowledge_tree_nodes` | 118 |
| `knowledge_revisions` | 126 |
| `knowledge_documents` | 97 |

### Baseline (dev, existing indexes)

| Query | Key | Filesort | `r_total_time_ms` |
| --- | --- | --- | ---: |
| latest APPLIED run | `idx_sync_runs_source_started` | yes (2.04 ms) | 2.10 |
| latest attempt | `idx_sync_runs_source_started` | no | 0.03 |
| `MAX(completed_at)` | `idx_sync_runs_source_started` | no | 0.03 |
| run list | `idx_sync_runs_source_started` | no | 0.08 |
| snapshot quota | `idx_import_snapshots_creator_state` | no | 0.03 |
| latest READY preview | `idx_import_snapshots_source_created` | yes (0.06 ms) | 0.09 |
| tree list | full scan | yes (0.18 ms, 70 rows out) | 0.29 |
| revision list | `uq_revisions_document_no` | no | 0.97 |

### Probe (clone of dev + proposed indexes)

| Query | Key | Filesort | `r_total_time_ms` |
| --- | --- | --- | ---: |
| latest APPLIED (unforced) | `idx_sync_runs_source_status_completed` | no | 0.08 |
| latest attempt | `idx_sync_runs_source_started` | no | 0.01 |
| `MAX(completed_at)` | optimized away | no | — |
| snapshot quota | `idx_import_snapshots_creator_state_expires` | no | 0.07 |
| latest READY preview | `idx_import_snapshots_ready_latest` | no | 0.15 |
| tree original `COALESCE` | full scan | yes (0.49 ms) | 0.58 |
| tree rewritten | full scan | yes (0.16 ms) | 0.26 |
| tree rewritten + old index forced | `idx_tree_source_parent_position` | yes (0.05 ms) | 0.12 |
| tree rewritten + new index forced | `idx_tree_source_parent_position_order` | no | 0.09 |
| revision list | `uq_revisions_document_no` | no | 0.59 |

The probe did not include the unfiltered run list or
`findAppliedBySnapshotId()`; both are added to the production verification
table above because the new index is a competing candidate. The probe did show
that `latestAttempt` stays on `idx_sync_runs_source_started`.

Single-run timings on a 2-row table are noise; the reliable signal is the
chosen key and the presence/absence of filesort. The synthetic 50k-row probe
showed the latest APPLIED lookup moving from the global applied cursor
(~24,250 estimated rows) to a source/status ref (~400 estimated rows), and the
tree index removing filesort when forced.
