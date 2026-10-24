# DB Read-Path Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the source list and document history from reading payload they discard, and make the latest-successful-sync and tree-order queries use additive indexes that match their predicates.

**Architecture:** Two projection changes (pending preview ID, revision summaries) and two additive indexes in migration 025; the tree query's ORDER BY becomes index-friendly. No API shape, authorization, or visible-order changes.

**Tech Stack:** TypeScript, Next.js app router, MariaDB 10.11, Vitest (unit + integration), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-24-db-read-path-enhancement-design.md`

## Global Constraints

- MariaDB 10.11, InnoDB. Do not add `id` to secondary index definitions; extended keys append the primary key.
- Migration 025 is additive. Do not drop `sync_runs_applied_cursor`, `idx_sync_runs_source_started`, or `idx_tree_source_parent_position`; do not backfill data.
- Do not add the P2 indexes (`source_import_snapshots (created_by, state, expires_at)` or the ready-latest index), a `snapshotId` column, source-list batching, a `sync_runs` summary projection, or tree lazy loading.
- `listRevisionSummaries()` must call the same `requireVisibleDocument()` check as `listRevisions()`; no authorization bypass.
- Do not add `FORCE INDEX` or optimizer hints. The tree's visible order is owned by `buildKnowledgeTree()`; the repository order must remain equivalent to the old `COALESCE` order.
- Run tests with `npx vitest` or the package scripts; do not pipe a test command (it hides the exit code).
- Every task ends with a green typecheck and its focused tests before the commit.

## Review Focus

These are the failure modes most likely to bite a reader or an operator. Each line is pinned to a task's test.

1. **Expired, foreign-creator, or old-version READY snapshots must not win the pending preview.** Task 1 test covers unknown creator, future `now`, and `basedOnVersion` mismatch.
2. **Two READY snapshots for the same source/creator/version must resolve to the latest by `finalized_at DESC, id DESC`.** Task 1 test creates a second READY snapshot and asserts it wins.
3. **Revision summaries must include the current WORKING revision and exclude non-current WORKING drafts.** Task 2 test uses the existing autosave-history helpers.
4. **Revision summaries must enforce the same authorization as full revision reads.** Task 2 adds outsider, missing-document, and archived-document cases in `phase1-query`.
5. **Tree order must remain deterministic with duplicate positions and mixed roots/folders/documents.** Task 4 test seeds duplicate positions and compares the new order with the old `COALESCE` order.

## File Structure

- `src/modules/sources/ports/import-snapshot-repository.ts` — replace the full-snapshot lookup with an ID-only method.
- `src/infrastructure/database/mariadb/repositories/import-snapshots.ts` — the ID-only SQL and mapper-free return.
- `src/server/source-read.ts` — use the ID method; one `now` for the source list.
- `src/modules/knowledge/domain/revision.ts` — `KnowledgeRevisionSummary` type.
- `src/modules/knowledge/ports/revision-repository.ts` — `listSummariesByDocument`.
- `src/infrastructure/database/mariadb/repositories/revisions.ts` — summary SQL and history mapper.
- `src/modules/knowledge/application/knowledge-query-service.ts` — `listRevisionSummaries` service method.
- `src/server/knowledge-read.ts` — use the summary service method.
- `src/infrastructure/database/mariadb/repositories/tree.ts` — index-friendly `ORDER BY`.
- `src/infrastructure/database/mariadb/migrations/025-query-path-indexes.ts` — new additive migration.
- `src/infrastructure/database/mariadb/migrations/index.ts` — register migration 25.
- Tests as named in each task.

---

### Task 1: Pending preview returns only an ID

**Files:**
- Modify: `src/modules/sources/ports/import-snapshot-repository.ts:17`
- Modify: `src/infrastructure/database/mariadb/repositories/import-snapshots.ts:67-70`
- Modify: `src/server/source-read.ts:57-63`
- Test: `tests/integration/import-safety.test.ts:93-145`
- Test: `tests/integration/phase3-request-authorization.test.ts` (new case)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `findLatestReadyIdBySourceForCreator(sourceId: string, creatorId: string, now: Date, basedOnVersion: number): Promise<string | null>`
  - `SourceListItemModel.pendingPreviewId` keeps its existing `string | null` shape.

- [x] **Step 1: Add the failing repository test**

In `tests/integration/import-safety.test.ts`, remove the four `findLatestReadyBySourceForCreator` assertions from the preview-safety test (lines 103-144). Add a new `it` block that creates two READY snapshots for the same source and version and asserts the latest wins:

```ts
it("returns the latest ready snapshot id for the creator, version, and time", async () => {
  const initial = await prepareReadingImport(uow, workspaceId, null, files);
  const applied = await s.imports.apply.apply(fixtureCaller(), initial);
  if (applied.kind !== "APPLIED") throw new Error("fixture failed");

  const older = await prepareReadingImport(
    uow, workspaceId, applied.sourceId,
    files.map((f) => ({ ...f, path: f.path.replace("docs/", "older/") })),
  );
  const newer = await prepareReadingImport(
    uow, workspaceId, applied.sourceId,
    files.map((f) => ({ ...f, path: f.path.replace("docs/", "newer/") })),
  );

  const latest = await uow.run((r) =>
    r.importSnapshots.findLatestReadyIdBySourceForCreator(
      applied.sourceId, fixtureCaller().identity.id, new Date(), 1,
    ),
  );
  expect(latest).toBe(newer);
  expect(latest).not.toBe(older);

  expect(await uow.run((r) =>
    r.importSnapshots.findLatestReadyIdBySourceForCreator(
      applied.sourceId, "0199f000-0000-7000-8000-000000009999", new Date(), 1,
    ),
  )).toBeNull();
  expect(await uow.run((r) =>
    r.importSnapshots.findLatestReadyIdBySourceForCreator(
      applied.sourceId, fixtureCaller().identity.id, new Date(Date.now() + 86400_000), 1,
    ),
  )).toBeNull();
  expect(await uow.run((r) =>
    r.importSnapshots.findLatestReadyIdBySourceForCreator(
      applied.sourceId, fixtureCaller().identity.id, new Date(), 2,
    ),
  )).toBeNull();
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/import-safety.test.ts`

Expected: FAIL with `findLatestReadyIdBySourceForCreator is not a function`.

- [x] **Step 3: Implement the port and repository method**

Replace the old method in `import-snapshot-repository.ts` with the ID-only signature. In `import-snapshots.ts`, replace the implementation with:

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

Delete the old `findLatestReadyBySourceForCreator` implementation. Do not select or parse `plan`/`summary`.

- [x] **Step 4: Run the repository test to verify it passes**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/import-safety.test.ts`

Expected: PASS.

- [x] **Step 5: Update the source-list caller**

In `getSourceListModel()`:

- Add `const now = new Date();` before the `Promise.all`.
- Call `findLatestReadyIdBySourceForCreator(source.id, caller.identity.id, now, source.syncVersion)`.
- Set `pendingPreviewId: pending` (the returned string or null).
- Remove the old `pending?.id`.

- [x] **Step 6: Add the model-level integration test**

In `tests/integration/phase3-request-authorization.test.ts`, add a test using the existing `team()`, `createThroughRoute`, `finish`, `createSourceResync`, `uploadSourceImportEntries`, `finalizeSourceImport`, and `getSourceListModel` helpers:

```ts
it("exposes the latest READY preview id on the source list", async () => {
  const { workspace } = await team();
  const { snapshotId } = await (await createThroughRoute(workspace.id)).json();
  const first = await finish(snapshotId);

  const resync = await createSourceResync(first.sourceId, {
    rootName: "wiki",
    manifest,
  });
  await uploadSourceImportEntries(resync.snapshotId, [{ uploadKey: "m1", bytes }]);
  await finalizeSourceImport(resync.snapshotId);

  const item = (await getSourceListModel(workspace.id))?.items
    .find((candidate) => candidate.source.id === first.sourceId);
  expect(item?.pendingPreviewId).toBe(resync.snapshotId);
});
```

- [x] **Step 7: Run typecheck and the focused tests**

Run:
- `npm run typecheck`
- `npx vitest run --config vitest.integration.config.ts tests/integration/import-safety.test.ts tests/integration/phase3-request-authorization.test.ts`
- `npm run test:unit`

Expected: all pass.

- [x] **Step 8: Commit**

```bash
git add src/modules/sources/ports/import-snapshot-repository.ts src/infrastructure/database/mariadb/repositories/import-snapshots.ts src/server/source-read.ts tests/integration/import-safety.test.ts tests/integration/phase3-request-authorization.test.ts
git commit -m "perf(sources): read only the pending preview id"
```

---

### Task 2: Revision history returns summaries

**Files:**
- Modify: `src/modules/knowledge/domain/revision.ts`
- Modify: `src/modules/knowledge/ports/revision-repository.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/revisions.ts:85-91`
- Modify: `src/modules/knowledge/application/knowledge-query-service.ts:59-68, 206-212`
- Modify: `src/server/knowledge-read.ts:47-60`
- Test: `tests/integration/phase1-revisions.test.ts`
- Test: `tests/integration/autosave-history.test.ts`
- Test: `tests/integration/phase1-query.test.ts`
- Test: `tests/unit/knowledge-document-model.test.ts`
- Test: `tests/unit/phase1-read-model.test.ts`
- Test: `tests/unit/phase1-contracts.test.ts`

**Interfaces:**
- Consumes: `requireVisibleDocument`, `asDate`, `asNumber`.
- Produces:
  - `KnowledgeRevisionSummary = Pick<KnowledgeRevision, "id" | "revisionNo" | "createdAt" | "history">`
  - `RevisionRepository.listSummariesByDocument(documentId: string): Promise<KnowledgeRevisionSummary[]>`
  - `KnowledgeQueryService.listRevisionSummaries(caller: CallerContext, documentId: string, input?: { includeArchived?: boolean }): Promise<KnowledgeRevisionSummary[]>`

- [x] **Step 1: Add the failing tests**

In `tests/integration/phase1-revisions.test.ts`, add a test that seeds a document with two checkpoint revisions and asserts the summary method returns the same IDs as `listByDocument()` with no content fields:

```ts
it("lists revision summaries without content", async () => {
  const { source, folderId } = await createSourceFixture(pool);
  const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
  const created = await hub.createDocument(fixtureCaller(), {
    sourceId: source.id, parentId: folderId,
    title: "Summary", markdown: "v1", metadata: {},
  });
  await hub.createRevision(fixtureCaller(), {
    documentId: created.documentId, expectedCurrentRevisionId: created.revisionId,
    title: "Summary", markdown: "v2", metadata: {},
  });

  const uow = new MariaDbUnitOfWork(pool);
  const full = await uow.run((r) => r.revisions.listByDocument(created.documentId));
  const summaries = await uow.run((r) => r.revisions.listSummariesByDocument(created.documentId));

  expect(summaries.map((s) => s.id)).toEqual(full.map((r) => r.id));
  expect(summaries.map((s) => s.revisionNo)).toEqual([1, 2]);
  for (const summary of summaries) {
    expect(summary).not.toHaveProperty("markdown");
    expect(summary).not.toHaveProperty("title");
    expect(summary).not.toHaveProperty("metadata");
  }
});
```

In `tests/integration/autosave-history.test.ts`, add a test using the existing `setup()` helper. Save two autosaves, then compare the summary IDs with `listByDocument()` and assert the content fields are absent:

```ts
it("lists the same history ids as full reads, without content", async () => {
  const f = await setup();
  await f.save("draft 1");
  await f.save("draft 2");

  const uow = new MariaDbUnitOfWork(pool);
  const full = await uow.run((r) =>
    r.revisions.listByDocument(f.created.documentId),
  );
  const summaries = await uow.run((r) =>
    r.revisions.listSummariesByDocument(f.created.documentId),
  );

  expect(summaries.map((s) => s.id)).toEqual(full.map((r) => r.id));
  for (const summary of summaries) {
    expect(summary).not.toHaveProperty("markdown");
  }
});
```

In `tests/integration/phase1-query.test.ts`, add authorization cases mirroring `listRevisions`:

```ts
await expect(queries.listRevisionSummaries(outsider, scope.documentId))
  .rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
await expect(queries.listRevisionSummaries(member, uuidv7()))
  .rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
expect(await queries.listRevisionSummaries(member, scope.documentId)).toHaveLength(2);
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/phase1-revisions.test.ts tests/integration/autosave-history.test.ts tests/integration/phase1-query.test.ts`

Expected: FAIL with `listSummariesByDocument is not a function` / `listRevisionSummaries is not a function`.

- [x] **Step 3: Add the domain type and repository port**

Add to `src/modules/knowledge/domain/revision.ts`:

```ts
export type KnowledgeRevisionSummary = Pick<
  KnowledgeRevision,
  "id" | "revisionNo" | "createdAt" | "history"
>;
```

Add to `RevisionRepository`:

```ts
listSummariesByDocument(documentId: string): Promise<KnowledgeRevisionSummary[]>;
```

Keep `listByDocument()` unchanged.

- [x] **Step 4: Implement the repository summary query**

In `revisions.ts`, add a mapper and method. The SQL must select only:

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

The mapper mirrors `mapRevision()` for `history`, but returns only `id`, `revisionNo`, `createdAt`, and `history`. Do not select `title`, `markdown`, `metadata`, `content_hash`, or `created_by`.

- [x] **Step 5: Add the service method and switch the caller**

Add `listRevisionSummaries` to `KnowledgeQueryService` and `KnowledgeQueryServiceImpl`. Its implementation must mirror `listRevisions()`:

```ts
return this.unitOfWork.run(async (repositories) => {
  const { document } = await requireVisibleDocument(
    repositories, caller, documentId, input.includeArchived ?? false,
  );
  return repositories.revisions.listSummariesByDocument(document.id);
});
```

In `knowledge-read.ts`, replace `services.queries.listRevisions(...)` with `services.queries.listRevisionSummaries(...)`. Keep the existing `WORKING`/current-revision filter and the `.map()` that drops all other fields; after this change the map can return the summaries unchanged. The selected revision still comes from `getCurrentRevision` / `getRevision`.

Define `RevisionSummary` as `KnowledgeRevisionSummary` in `knowledge-read.ts` (or keep the structurally identical `Pick<KnowledgeRevisionView, ...>`; one definition is preferred).

- [x] **Step 6: Update the unit tests, fakes, and contract mirror**

- `tests/unit/knowledge-document-model.test.ts`: replace the `listRevisions` fake with `listRevisionSummaries`, returning objects with only `{ id, revisionNo, createdAt, history }`. Add an assertion that the model calls `listRevisionSummaries` once and never calls `listRevisions`.
- `tests/unit/phase1-read-model.test.ts`: add `listSummariesByDocument` to the fake repository (map the existing revisions to summaries). Add a test for `listRevisionSummaries` that asserts the revision numbers and that no summary has `markdown`.
- `tests/unit/phase1-contracts.test.ts`: add `listRevisionSummaries` to the local `KnowledgeQueryService` mirror and the stub object; add `assertCallerFirst<KnowledgeQueryService["listRevisionSummaries"]>(true)`.

- [x] **Step 7: Run typecheck and the focused tests**

Run:
- `npm run typecheck`
- `npm run test:unit`
- `npx vitest run --config vitest.integration.config.ts tests/integration/phase1-revisions.test.ts tests/integration/autosave-history.test.ts tests/integration/phase1-query.test.ts`

Expected: all pass.

- [x] **Step 8: Commit**

```bash
git add src/modules/knowledge/domain/revision.ts src/modules/knowledge/ports/revision-repository.ts src/infrastructure/database/mariadb/repositories/revisions.ts src/modules/knowledge/application/knowledge-query-service.ts src/server/knowledge-read.ts tests/unit/knowledge-document-model.test.ts tests/unit/phase1-read-model.test.ts tests/unit/phase1-contracts.test.ts tests/integration/phase1-revisions.test.ts tests/integration/autosave-history.test.ts tests/integration/phase1-query.test.ts
git commit -m "perf(knowledge): return revision summaries without content"
```

---

### Task 3: Migration 025 and index existence

**Files:**
- Create: `src/infrastructure/database/mariadb/migrations/025-query-path-indexes.ts`
- Modify: `src/infrastructure/database/mariadb/migrations/index.ts`
- Test: `tests/integration/db-index-enhancement.test.ts` (new)

**Interfaces:**
- Consumes: `Migration`, `runMigrations`.
- Produces: migration version 25; indexes `idx_sync_runs_source_status_completed` and `idx_tree_source_parent_position_order`.

- [x] **Step 1: Add the failing migration test**

Create `tests/integration/db-index-enhancement.test.ts` using `provisionIsolatedDatabase`, `runMigrations`, and `disposeIsolatedDatabase` from the existing test helpers. Query `information_schema.statistics` and assert the exact column order:

```ts
const sync = await pool.query<{ column_name: string }[]>(
  `SELECT column_name FROM information_schema.statistics
   WHERE table_schema = ? AND table_name = 'sync_runs'
     AND index_name = 'idx_sync_runs_source_status_completed'
   ORDER BY seq_in_index`,
  [handle.databaseName],
);
expect(sync.map((row) => row.column_name))
  .toEqual(["source_id", "status", "completed_at"]);

const tree = await pool.query<{ column_name: string }[]>(
  `SELECT column_name FROM information_schema.statistics
   WHERE table_schema = ? AND table_name = 'knowledge_tree_nodes'
     AND index_name = 'idx_tree_source_parent_position_order'
   ORDER BY seq_in_index`,
  [handle.databaseName],
);
expect(tree.map((row) => row.column_name))
  .toEqual(["source_id", "parent_id", "position"]);

expect(await pool.query(
  "SELECT state FROM schema_migrations WHERE version = 25",
)).toEqual([{ state: "APPLIED" }]);
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/db-index-enhancement.test.ts`

Expected: FAIL — the index queries return an empty array and version 25 is absent.

- [x] **Step 3: Create and register migration 025**

Create `025-query-path-indexes.ts`:

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

- [x] **Step 4: Run the migration test to verify it passes**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/db-index-enhancement.test.ts`

Expected: PASS.

- [x] **Step 5: Apply to dev and smoke-check the sync-run plans**

Run `npm run db:migrate` against the dev database. Then run:

```sql
EXPLAIN SELECT * FROM sync_runs
WHERE source_id='<a source with runs>' AND status='APPLIED'
ORDER BY completed_at DESC, id DESC LIMIT 1;

EXPLAIN SELECT status FROM sync_runs
WHERE source_id='<same source>' AND status IN ('APPLIED','FAILED')
ORDER BY started_at DESC, id DESC LIMIT 1;
```

Expected: the first uses `idx_sync_runs_source_status_completed`; the second stays on `idx_sync_runs_source_started`. Dev has only two `sync_runs` rows, so if the optimizer chooses differently, record the plan and rely on the production-like gate in Task 5.

- [x] **Step 6: Commit**

```bash
git add src/infrastructure/database/mariadb/migrations/025-query-path-indexes.ts src/infrastructure/database/mariadb/migrations/index.ts tests/integration/db-index-enhancement.test.ts
git commit -m "feat(db): add sync-run and tree lookup indexes"
```

---

### Task 4: Tree ordering is index-friendly

**Files:**
- Modify: `src/infrastructure/database/mariadb/repositories/tree.ts:66-77`
- Test: `tests/integration/phase1-tree.test.ts`

**Interfaces:**
- Consumes: migration 25's `idx_tree_source_parent_position_order`.
- Produces: `listBySource()` order `parent_id, position, id`; signature unchanged.

- [x] **Step 1: Add the characterization tests**

In `tests/integration/phase1-tree.test.ts`, use `setupTreeFixture()` and its `fixture.sourceId` as `sourceId`. Create valid folders/documents through the hub service, then set duplicate positions through `repositories.tree.updatePosition` so foreign keys stay valid. Add two tests:

1. **Repository order.** Create root folders/documents and nested folders/documents with duplicate positions and assert the `listBySource()` IDs appear roots-first, then by `position`, then by `id`.
2. **Old/new equivalence.** Run the two raw SQL orders and assert the ID arrays are identical:

```ts
const oldOrder = await pool.query<{ id: string }[]>(
  `SELECT id FROM knowledge_tree_nodes
   WHERE source_id = ? ORDER BY COALESCE(parent_id, ''), position, id`,
  [sourceId],
);
const newOrder = await pool.query<{ id: string }[]>(
  `SELECT id FROM knowledge_tree_nodes
   WHERE source_id = ? ORDER BY parent_id, position, id`,
  [sourceId],
);
expect(newOrder).toEqual(oldOrder);
```

These pass against the current `COALESCE` query; they are characterization tests for a behavior-preserving change.

- [x] **Step 2: Run the tests before the change**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/phase1-tree.test.ts`

Expected: PASS (the current query already produces the same order).

- [x] **Step 3: Change the SQL order**

In `tree.ts`, replace:

```sql
ORDER BY COALESCE(n.parent_id, ''), n.position, n.id
```

with:

```sql
ORDER BY n.parent_id, n.position, n.id
```

Add a short comment: MariaDB sorts `NULL` first, so this matches the old `COALESCE(parent_id, '')` order and lets `(source_id, parent_id, position)` supply the order.

- [x] **Step 4: Run the tests after the change**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/phase1-tree.test.ts`

Expected: PASS.

- [x] **Step 5: Smoke-check the plan on dev**

Run `EXPLAIN` for the rewritten `listBySource()` query. On dev, the source holds 70/118 nodes, so a full scan is expected; record it. The production-like gate in Task 5 is where the index choice is accepted.

- [x] **Step 6: Commit**

```bash
git add src/infrastructure/database/mariadb/repositories/tree.ts tests/integration/phase1-tree.test.ts
git commit -m "perf(knowledge): make tree ordering index-friendly"
```

---

### Task 5: Full verification and production-like release gate

**Files:** none unless a verification step finds a defect.

- [x] **Step 1: Run typecheck**

Run: `npm run typecheck`

Expected: exit 0.

- [x] **Step 2: Run lint**

Run: `npm run lint`

Expected: exit 0.

Result: the committed project code passes `npx eslint . --ignore-pattern '.superpowers/**'` (exit 0). The unfiltered `npm run lint` exits 1 only on gitignored `.superpowers/` scratch files from a sibling plan, which are not part of this branch.

- [x] **Step 3: Run the unit suite**

Run: `npm run test:unit`

Expected: all tests pass.

- [x] **Step 4: Run the integration suite**

Run: `npm run test:integration`

Expected: all tests pass, including the new migration and projection tests.

- [x] **Step 5: Run the targeted browser suites**

Run:

```bash
npm run test:e2e -- tests/e2e/mvp-freshness.spec.ts tests/e2e/revision-history.spec.ts tests/e2e/phase2.5-knowledge-explorer.spec.ts
```

Expected: all pass. The checks are: the source-list “Review preview” link opens the pending snapshot; the document history lists the same versions; the explorer tree order is unchanged.

- [ ] **Step 6: Production-like EXPLAIN gate**

This is a release gate, not a code change. Use a pre-migration production dump restored into a scratch database, or a read replica.

1. Record the “before” plans with the two new indexes absent.
2. Apply migration 025.
3. Record `EXPLAIN FORMAT=JSON` and `ANALYZE FORMAT=JSON` for:
   - `sync_runs` latest APPLIED per source — expect `idx_sync_runs_source_status_completed`, no `Using filesort`.
   - `sync_runs` `MAX(completed_at)` — expect “Select tables optimized away”.
   - `sync_runs` latest attempt — expect `idx_sync_runs_source_started`, no filesort.
   - `sync_runs` unfiltered run list — expect `idx_sync_runs_source_started`, no filesort.
   - `findAppliedBySnapshotId()` — expect the new index for the source/status prefix; JSON remains residual.
   - tree `listBySource()` rewritten order — expect `idx_tree_source_parent_position_order` and no filesort when the source is a small fraction of the table; a full scan is acceptable only if the optimizer proves it cheaper.
4. Record `r_rows`, `r_total_time_ms`, chosen key, and filesort before and after in the PR or verification note.

Do not deploy to production until this table is recorded. The dev plans are a smoke test only; dev has 2 `sync_runs` rows and 1 snapshot.

**Status: OPEN — not executed.** No pre-migration production dump or read replica was available, and no production-like numbers were fabricated. The dev and synthetic smoke results recorded in the Task 5 report are not a substitute.

- [x] **Step 7: Commit any fixes**

If a verification step required code or test changes, commit them with a message that names the gate, for example:

```bash
git commit -m "test: cover the read-path projection and index gates"
```

---

## Self-Review Notes

- Spec coverage: G1 → Task 1; G2 → Task 2; G3 → Task 3; G4 → Task 4; G5 → Tasks 3-5.
- Task 1 and Task 2 each leave the build green; Task 3 adds both indexes before Task 4 uses the tree one.
- Types are consistent: `KnowledgeRevisionSummary`, `listSummariesByDocument`, `listRevisionSummaries`, and `findLatestReadyIdBySourceForCreator` are used with the same signatures in every task.
- The Review Focus items are pinned to Task 1 (two), Task 2 (two), and Task 4 (one).
- The production-like EXPLAIN gate is explicit and is not replaced by the dev smoke checks.
