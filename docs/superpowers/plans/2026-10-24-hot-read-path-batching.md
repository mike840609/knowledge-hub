# Hot Read-Path Batching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the remaining hot-page N+1 reads on the source list, recent palette, sync run detail, Team member/audit views, and Updates page, without changing results, ordering, authorization, or the schema.

**Architecture:** Add chunked batch methods to the existing repository ports (`syncRuns`, `importSnapshots`, `tree`, `revisions`, `users`), then switch the service/server callers from per-item loops to one batch per lookup shape. No migration, no cache, no API change.

**Tech Stack:** TypeScript, Next.js app router, MariaDB 10.11, Vitest (unit + integration), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-24-hot-read-path-batching-design.md`

## Global Constraints

- No migration, schema, index, or write-path change.
- Keep the exact result semantics:
  - `latestRun` = newest by `started_at DESC, id DESC` (any status).
  - `latestSuccessfulRun` = newest `APPLIED` by `completed_at DESC, id DESC`.
  - Pending preview = latest `READY` for the same source, creator, `based_on_version`, and unexpired `expires_at`.
  - Recent hits preserve the browser's ID order and exclude documents `getDocument()` would not show.
  - Run detail keeps before/after pairing and `revisionUnavailable` behavior.
  - Updates keeps run order, per-run `LIMIT 50`, `total/added/updated`, and unread calculation.
- Use 500-ID chunks for by-ID reads, 200 source/version pairs for the snapshot
  lookup, and 50 per-source probes per latest-run statement. Never interpolate
  IDs into SQL.
- Empty input returns `[]` or `new Map()` without a query.
- Do not add cross-request caching, `FORCE INDEX`, or optimizer hints.
- Authorization stays at the service boundary: `requireWorkspaceRead`, `requireVisibleDocument`, and workspace membership checks are unchanged.
- Run tests with `npx vitest` or the package scripts; do not pipe a test command.
- Every task ends with a green typecheck and its focused tests before the commit.

## Review Focus

1. **Source list selection is still exact.** Task 1 tests interleaved runs, a HUB source, two READY snapshots, and expired/foreign/wrong-version snapshots.
2. **Recent palette order and visibility match `getDocument()`.** Task 2 tests requested order, an archived document, and a document in another workspace.
3. **Run detail pairing survives a missing revision.** Task 3 tests before-only, after-only, and both-present changes.
4. **Source detail authorization does not depend on `listSources()`.** Task 4 tests archived source access and wrong-workspace refusal after the redundant call is removed.
5. **Updates keeps run order, limits, and unread flags.** Task 5 tests multiple runs with different changes and read progress.

## File Structure

- `src/modules/sources/ports/sync-run-repository.ts` — two batch run methods.
- `src/infrastructure/database/mariadb/repositories/sync-runs.ts` — per-source `UNION ALL` probe SQL.
- `src/modules/sources/ports/import-snapshot-repository.ts` — batch pending-ID method; remove the single-source ID method.
- `src/infrastructure/database/mariadb/repositories/import-snapshots.ts` — batch pending-ID SQL.
- `src/server/source-read.ts` — source-list batch wiring, batched actors, remove redundant `listSources` and the dead `SOURCE_RUN_LIST_LIMIT`.
- `src/modules/knowledge/ports/tree-repository.ts` — `listDocumentsByIds`.
- `src/infrastructure/database/mariadb/repositories/tree.ts` — batch document summary SQL.
- `src/modules/knowledge/application/knowledge-query-service.ts` — `listDocumentSummariesByIds`.
- `src/server/recent-documents.ts` — one batch call, order preserved.
- `src/modules/knowledge/ports/revision-repository.ts` — `findByIds`.
- `src/infrastructure/database/mariadb/repositories/revisions.ts` — chunked `IN` query.
- `src/modules/sources/application/get-sync-run-detail.ts` — one revision batch.
- `src/modules/identity/ports/user-repository.ts` — `findByIds`.
- `src/infrastructure/database/mariadb/repositories/users.ts` — chunked `IN` query.
- `src/server/workspace-admin.ts` — batch members and audit actors.
- `src/modules/personal/application/list-folder-updates.ts` — batch sources and progress.
- `src/app/w/[workspaceId]/updates/page.tsx` — use `queries.listSources()` for the dropdown.
- Tests as named in each task.

---

### Task 1: Source list batch reads

**Files:**
- Modify: `src/modules/sources/ports/sync-run-repository.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/sync-runs.ts`
- Modify: `src/modules/sources/ports/import-snapshot-repository.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/import-snapshots.ts`
- Modify: `src/server/source-read.ts:10-11, 42-69`
- Test: `tests/integration/import-safety.test.ts`
- Test: `tests/integration/sync-run-detail.test.ts`
- Test: `tests/unit/source-list-batching.test.ts` (new)

**Interfaces:**
- Produces:
  - `listLatestBySourceIds(sourceIds: readonly string[]): Promise<SyncRun[]>`
  - `listLatestAppliedBySourceIds(sourceIds: readonly string[]): Promise<SyncRun[]>`
  - `findLatestReadyIdsBySourceForCreator(sources: readonly { sourceId: string; basedOnVersion: number }[], creatorId: string, now: Date): Promise<Map<string, string>>`
- Removes: `findLatestReadyIdBySourceForCreator(sourceId, creatorId, now, basedOnVersion)`.

- [ ] **Step 1: Add failing repository tests**

In `tests/integration/sync-run-detail.test.ts`, add a test that seeds runs for two sources, interleaves their `started_at`/`completed_at`, and asserts `listLatestBySourceIds()` returns exactly one row per source (newest `started_at`, id tie-break) and `listLatestAppliedBySourceIds()` returns the newest APPLIED per source, with no cross-source leakage.

In `tests/integration/import-safety.test.ts`, replace the single-source ID assertions with a batch test:

```ts
const ids = await uow.run((r) =>
  r.importSnapshots.findLatestReadyIdsBySourceForCreator(
    [
      { sourceId: applied.sourceId, basedOnVersion: 1 },
      { sourceId: otherSourceId, basedOnVersion: 1 },
    ],
    fixtureCaller().identity.id,
    new Date(),
  ),
);
expect(ids.get(applied.sourceId)).toBe(newerSnapshotId);
expect(ids.has(otherSourceId)).toBe(false); // expired/foreign/wrong-version fixture
```

Keep the existing expired, foreign-creator, and wrong-version cases by asserting the map omits those sources.

- [ ] **Step 2: Run the focused tests to verify RED**

Run:

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/sync-run-detail.test.ts tests/integration/import-safety.test.ts
```

Expected: FAIL with `listLatestBySourceIds is not a function` and `findLatestReadyIdsBySourceForCreator is not a function`.

- [ ] **Step 3: Add the ports and repository SQL**

Implement the three methods with the SQL from the design. Chunk source IDs at 50 per-source probes (one `ORDER BY ... LIMIT 1` subquery per ID in a `UNION ALL`, not an `IN (...)` window query — `sync_runs` history is unbounded) and source/version pairs at 200. Use `ROW_NUMBER() OVER (PARTITION BY source_id ...)` for the snapshot batch only. Return a `Map` for the snapshot method. Remove the single-source snapshot method.

- [ ] **Step 4: Switch `getSourceListModel()` to the batch methods**

Replace the per-source `Promise.all` with one `unitOfWork.run` that:

1. calls `listLatestBySourceIds` for all source IDs (including archived sources, preserving the current list);
2. calls `listLatestAppliedBySourceIds` for non-HUB source IDs;
3. calls `findLatestReadyIdsBySourceForCreator` with `{ sourceId, basedOnVersion: source.syncVersion }` pairs for non-HUB sources;
4. builds maps and returns one item per source with the same fields.

Remove the dead `SOURCE_RUN_LIST_LIMIT` export (the old 20-row list read is gone). Keep the existing `listSources`, `workspaceState`, and `canInspectSources` checks.

- [ ] **Step 5: Add the model call-count test**

Create `tests/unit/source-list-batching.test.ts` with a mocked `applicationServices()` (the pattern in `tests/unit/read-failure-boundaries.test.ts`). The fake unit of work records calls. Assert:

- `listLatestBySourceIds` called once;
- `listLatestAppliedBySourceIds` called once;
- `findLatestReadyIdsBySourceForCreator` called once;
- `listBySourceId` and `findLatestReadyIdBySourceForCreator` are never called;
- a HUB source has `latestSuccessfulRun: null` and `pendingPreviewId: null`.

- [ ] **Step 6: Run typecheck and the focused tests**

Run:

```bash
npm run typecheck
npx vitest run --config vitest.integration.config.ts tests/integration/sync-run-detail.test.ts tests/integration/import-safety.test.ts
npm run test:unit
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/modules/sources/ports/sync-run-repository.ts src/infrastructure/database/mariadb/repositories/sync-runs.ts src/modules/sources/ports/import-snapshot-repository.ts src/infrastructure/database/mariadb/repositories/import-snapshots.ts src/server/source-read.ts tests/integration/sync-run-detail.test.ts tests/integration/import-safety.test.ts tests/unit/source-list-batching.test.ts
git commit -m "perf(sources): batch the source-list lookups"
```

---

### Task 2: Recent palette document batch

**Files:**
- Modify: `src/modules/knowledge/ports/tree-repository.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/tree.ts`
- Modify: `src/modules/knowledge/application/knowledge-query-service.ts`
- Modify: `src/server/recent-documents.ts`
- Test: `tests/unit/recent-documents.test.ts` (new)
- Test: `tests/integration/phase1-query.test.ts`

**Interfaces:**
- Produces:
  - `TreeRepository.listDocumentsByIds(workspaceId: string, documentIds: readonly string[], includeArchived: boolean): Promise<DocumentSummary[]>`
  - `KnowledgeQueryService.listDocumentSummariesByIds(caller: CallerContext, workspaceId: string, documentIds: readonly string[], input?: { includeArchived?: boolean }): Promise<DocumentSummary[]>`

- [ ] **Step 1: Add the failing tests**

In `tests/integration/phase1-query.test.ts`, add a test that creates two active documents and one archived document, calls `queries.listDocumentSummariesByIds(caller, workspaceId, [activeId, archivedId])`, and asserts only the active document is returned by default, both are returned with `{ includeArchived: true }`, and a document from another workspace is absent.

Create `tests/unit/recent-documents.test.ts` with fake `services.queries`:

```ts
const services = {
  queries: {
    listSources: async () => [{ id: SOURCE_ID, name: "Source" }],
    listDocumentSummariesByIds: async () => [summary("b"), summary("a")],
  },
};
const hits = await recentDocumentHits(services as never, caller, WORKSPACE_ID, ["a", "missing", "b"]);
expect(hits.map((hit) => hit.documentId)).toEqual(["a", "b"]);
expect(services.queries.listDocumentSummariesByIds).toHaveBeenCalledTimes(1);
```

Assert an empty ID list makes no batch call.

- [ ] **Step 2: Run the tests to verify RED**

Run:

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/phase1-query.test.ts
npx vitest run --config vitest.config.ts tests/unit/recent-documents.test.ts
```

Expected: FAIL with `listDocumentSummariesByIds is not a function`.

- [ ] **Step 3: Add the repository method and service method**

Add the `listDocumentsByIds` port and MariaDB implementation with the design's SQL. **Match `getDocument()` visibility: filter document and source status, not tree-node status.** Chunk IDs at 500; return `[]` for empty input.

Add `listDocumentSummariesByIds` to `KnowledgeQueryService` and `KnowledgeQueryServiceImpl`: `syncCallerIdentity`, `requireWorkspaceRead`, then `tree.listDocumentsByIds`.

- [ ] **Step 4: Switch `recentDocumentHits()` to the batch**

Build a map from the batch result, walk the requested `documentIds` in order, skip missing IDs, and keep the existing `listSources()` call for source names. Remove the per-ID `getDocument()` loop.

- [ ] **Step 5: Run the focused tests**

Run:

```bash
npm run typecheck
npx vitest run --config vitest.integration.config.ts tests/integration/phase1-query.test.ts
npx vitest run --config vitest.config.ts tests/unit/recent-documents.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/knowledge/ports/tree-repository.ts src/infrastructure/database/mariadb/repositories/tree.ts src/modules/knowledge/application/knowledge-query-service.ts src/server/recent-documents.ts tests/integration/phase1-query.test.ts tests/unit/recent-documents.test.ts
git commit -m "perf(knowledge): batch recent document summaries"
```

---

### Task 3: Sync run detail revision batch

**Files:**
- Modify: `src/modules/knowledge/ports/revision-repository.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/revisions.ts`
- Modify: `src/modules/sources/application/get-sync-run-detail.ts`
- Test: `tests/integration/sync-run-detail.test.ts`

**Interfaces:**
- Produces: `RevisionRepository.findByIds(ids: readonly string[]): Promise<KnowledgeRevision[]>`

- [ ] **Step 1: Add the failing tests**

In `tests/integration/sync-run-detail.test.ts`, add a repository test that calls `repositories.revisions.findByIds([beforeRevisionId, afterRevisionId])` and asserts both rows come back. Then add a detail test that seeds a run with three document changes: before-only, after-only, and both-present. Assert `getSyncRunDetail()` still returns the same `href`, `diff`, and `revisionUnavailable` values as before. Keep the existing single-revision behavior test.

- [ ] **Step 2: Run it to verify RED**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/sync-run-detail.test.ts`

Expected: FAIL with `findByIds is not a function`.

- [ ] **Step 3: Implement `findByIds`**

Add the port method and a chunked `SELECT * FROM knowledge_revisions WHERE id IN (...)` implementation. Return `[]` for empty input.

- [ ] **Step 4: Switch the service**

Collect distinct before/after IDs from `rows`, call `findByIds()` once, build a `Map`, and read before/after from the map. Keep the existing `hasRecordedChanges` existence query.

- [ ] **Step 5: Run typecheck and the focused test**

Run:

```bash
npm run typecheck
npx vitest run --config vitest.integration.config.ts tests/integration/sync-run-detail.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/knowledge/ports/revision-repository.ts src/infrastructure/database/mariadb/repositories/revisions.ts src/modules/sources/application/get-sync-run-detail.ts tests/integration/sync-run-detail.test.ts
git commit -m "perf(sources): batch run-detail revisions"
```

---

### Task 4: Batch user lookups

**Files:**
- Modify: `src/modules/identity/ports/user-repository.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/users.ts`
- Modify: `src/server/source-read.ts:73-111`
- Modify: `src/server/workspace-admin.ts:108-154`
- Test: `tests/unit/source-run-actors.test.tsx`
- Test: `tests/integration/phase3-workspace-admin-api.test.ts`
- Test: `tests/integration/phase3-request-authorization.test.ts`

**Interfaces:**
- Produces: `UserRepository.findByIds(ids: readonly string[]): Promise<UserIdentity[]>`

- [ ] **Step 1: Add the failing tests**

In `tests/integration/phase3-workspace-admin-api.test.ts`, add a repository-level test that calls `repositories.users.findByIds([memberId, actorId])` and asserts both users come back, plus a missing ID is absent. Keep the existing member/audit assertions and add a case with multiple members and audit actors whose names must still resolve.

In `tests/unit/source-run-actors.test.tsx`, keep the existing callback test and add a caller-level test only if the service is unit-testable without the DB.

- [ ] **Step 2: Run the focused tests to verify RED**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/phase3-workspace-admin-api.test.ts`

Expected: FAIL with `findByIds is not a function`.

- [ ] **Step 3: Implement `findByIds`**

Add the port method and a chunked `SELECT id, emp_id, name, org_code FROM users WHERE id IN (...)` implementation. Return `[]` for empty input.

- [ ] **Step 4: Use it in the three call sites**

- `getSourceDetailModel()`: collect distinct actor IDs, call `findByIds()`, build a `Map`, and pass an in-memory callback to the unchanged `resolveRunActors()`. Remove the redundant `services.queries.listSources()` check; keep `getSource()`, the workspace match, `listWorkspaces`, and `workspaceState`.
- `workspace-admin.listMembers()`: load memberships once, `findByIds()` once, then build the same view in membership order.
- `workspace-admin.listAudit()`: collect actor IDs from the page, `findByIds()` once, then map names.

- [ ] **Step 5: Run typecheck and focused tests**

Run:

```bash
npm run typecheck
npx vitest run --config vitest.integration.config.ts tests/integration/phase3-workspace-admin-api.test.ts tests/integration/phase3-request-authorization.test.ts
npx vitest run --config vitest.config.ts tests/unit/source-run-actors.test.tsx
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/identity/ports/user-repository.ts src/infrastructure/database/mariadb/repositories/users.ts src/server/source-read.ts src/server/workspace-admin.ts tests/unit/source-run-actors.test.tsx tests/integration/phase3-workspace-admin-api.test.ts tests/integration/phase3-request-authorization.test.ts
git commit -m "perf(identity): batch user name lookups"
```

---

### Task 5: Updates page and folder-update batching

**Files:**
- Modify: `src/modules/personal/application/list-folder-updates.ts`
- Modify: `src/app/w/[workspaceId]/updates/page.tsx`
- Test: `tests/integration/folder-sync-reading-history.test.ts`

**Interfaces:**
- Consumes: `SourcePolicyPort.listByWorkspaceId`, `DocumentReadProgressRepository.getMany`.
- Produces: no signature change; the service returns the same `FolderUpdatesPage`.

- [ ] **Step 1: Add the failing/characterization test**

In `tests/integration/folder-sync-reading-history.test.ts`, add a test with two runs, different sources, multiple changes, and read progress for one document. Assert the same groups, run order, `total/added/updated`, unread flags, and pagination as today. This is a behavior-preserving characterization test; it should pass before the change.

- [ ] **Step 2: Update the service**

Replace the per-run source/progress reads with:

1. `listAppliedRuns()` once;
2. `sourcePolicy.listByWorkspaceId(workspaceId, {})` once;
3. `Promise.all(selected.map(run => syncRunChanges.listReadingChanges(...)))`;
4. one `documentReadProgress.getMany()` over the union of document IDs;
5. build groups in the original run order with the same filters and unread calculation.

Keep the existing `listReadingChanges` per-run query; it carries the run's own limit and aggregates.

- [ ] **Step 3: Update the page**

In `updates/page.tsx`, replace `getSourceListModel(workspaceId)` with `applicationServices().queries.listSources(caller, workspaceId, { includeArchived: true })` and filter `sourceType === "FOLDER_SYNC"`. Keep the same dropdown labels and values; archived folders stay in the list because their applied runs still show.

- [ ] **Step 4: Run typecheck and the focused test**

Run:

```bash
npm run typecheck
npx vitest run --config vitest.integration.config.ts tests/integration/folder-sync-reading-history.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/personal/application/list-folder-updates.ts src/app/w/[workspaceId]/updates/page.tsx tests/integration/folder-sync-reading-history.test.ts
git commit -m "perf(updates): batch folder-update lookups"
```

---

### Task 6: Full verification

**Files:** none unless a gate finds a defect.

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 2: Lint the tracked code**

Run: `npx eslint . --ignore-pattern '.superpowers/**'`

Expected: exit 0. The full `npm run lint` may still fail on another plan's gitignored `.superpowers/` scratch files.

- [ ] **Step 3: Unit suite**

Run: `npm run test:unit`

Expected: all pass.

- [ ] **Step 4: Integration suite**

Run: `npm run test:integration`

Expected: all pass.

- [ ] **Step 5: Targeted E2E**

Run:

```bash
npm run test:e2e -- tests/e2e/phase2.5-sources.spec.ts tests/e2e/mvp-freshness.spec.ts tests/e2e/folder-sync-reading-flow.spec.ts tests/e2e/source-import.spec.ts tests/e2e/zz-recents-favorites.spec.ts tests/e2e/settings-navigation.spec.ts
```

Expected: all pass. Members/audit result behavior is covered by the integration suite; the browser run covers navigation and the source/updates/recents surfaces.

- [ ] **Step 6: Query-count evidence**

Capture the unit tests' call-count assertions and, for the source-list run
selection, the `ANALYZE FORMAT=JSON` access-path comparison on a synthetic
`sync_runs` table (window `IN` shape vs the shipped per-source probes). If a
production-like environment is available, page p95 and DB QPS for Home,
Sources, Updates, the palette, run detail, and members/audit before and after.
No index is added: the probes reuse `(source_id, started_at)` and
`(source_id, status, completed_at)`.

- [ ] **Step 7: Commit any fixes**

If a gate required a change, commit it with a message naming the gate.

---

## Self-Review Notes

- Spec coverage: G1 → Task 1; G2 → Task 2; G3 → Task 3; G4 → Task 4; G5 → Task 5; G6 is enforced by each task's characterization/behavior tests.
- Task 2's batch visibility intentionally matches `getDocument()`, not `listDocumentsByWorkspace()`; this is the main correctness trap.
- Task 4's source-detail authorization removes only a redundant `listSources()` enumeration; `getSource()` and the workspace match remain.
- Task 5 keeps the per-run `listReadingChanges()` because its limit and aggregates are per run; only the repeated source and progress reads are batched.
- No task adds a migration, cache, hint, or response-shape change.
