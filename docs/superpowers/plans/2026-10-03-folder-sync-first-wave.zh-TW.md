# Folder Sync First Wave Implementation Plan

[English](2026-10-03-folder-sync-first-wave.md) | **繁體中文**

## 繁體中文導讀

本計畫完成安全的 folder-check → Preview → Apply → 讀取更新流程，並提供以閱讀為主的 My Space 及前後畫面比較。它在既有 MariaDB unit of work 新增不可變 run-change 紀錄及單調遞增的個人閱讀進度，重用 reconciler、canonical revisions、Workspace 授權、reader、搜尋與精簡清單元件。

此檔提供繁體中文導讀；下方完整技術與歷史原文保留英文（原有中文範例及註記亦保留），並非全文中文翻譯。需要英文主文件時，請使用上方 English 連結。

---

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete a safe folder-check → preview → Apply → read-updates workflow, with a reading-oriented My Space and before/after screenshots.

**Architecture:** Add immutable run-change records and monotonic per-user read progress to the existing MariaDB unit of work. Reuse the import reconciler, canonical revisions, workspace authorization, reader, search, and compact list components. Build preview safety and history services around those contracts rather than relying on expiring staging snapshots.

**Tech Stack:** TypeScript, Next.js 15, React 19, MariaDB 10.11, Tailwind, Vitest, Playwright; no new production dependency required.

**Spec:** `docs/superpowers/specs/2026-10-03-folder-sync-first-wave-design.md` (approved by user).

## Global Constraints

- Baseline main `15c8b7786239735ece7112bb663760346b33a580`; branch `feat/folder-sync-first-wave`.
- No image binary storage, rendering, new missing-image diagnostics, or attachment binary service this wave.
- Preserve compact PageHeader, light list layout, design tokens, source-managed read-only behavior, workspace gates, Team flows, favorites, drafts, keyboard navigation, and Apply atomicity.
- Hover rotates 12 degrees and scales 110%; only active checking spins continuously; respect reduced motion.
- Risk conditions: nonempty old source with zero incoming documents; archive count ≥5 and ≥30%; previous count ≥5 with <20% matched and archive count >0; any complete archive of a nonempty source.
- High-risk Apply requires source-name confirmation tied to the snapshot ID and exact plan hash, enforced server-side.
- Preview diff is lazy, bounded to 2,000 displayed lines or 200 KiB, with an explicit truncation/fallback message.
- Home: Search → My folders → Continue reading → Updates → Favorites → secondary writing entries. Home Updates: 3 runs, 5 documents per run. Full Updates: 20 runs per cursor page.
- Read progress uses immutable revisionNo; a read from an older tab cannot lower it.
- Snapshot cleanup must not delete run-change history. Legacy summary-only runs must not fabricate article details.
- Exclude background auto-sync, CLI, MCP, AI Chat, Collections, new search path/date filters, share-management pages, and cross-device recent-reading synchronization.
- Unit and integration suites, relevant Team and Personal E2E, typecheck, lint, production build, and paired 1440px light screenshots are deliverables.

## Review Focus

1. Legacy READY previews and legacy runs: new safety cannot be bypassed by an old payload; missing history must be honestly displayed (Tasks 2, 5, 6).
2. Renamed/moved articles combined with edits: stable document/revision identity must survive path changes, including metadata-only edits (Tasks 2, 4, 11).
3. Network response loss after Apply commits: recovery must use the same result/run, not duplicate an event or claim no data changed (Tasks 2, 7).
4. Two devices or historical reader opened after current reader: older reads must not hide a newer update or regress the read marker (Tasks 3, 8).
5. Permissions revoked, source archived, or stale link indexes: private paths/body must not leak and source health must not report a false clean result (Tasks 4, 6, 8, 10).

## File and Contract Map

Create domain contracts in `src/modules/sources/domain/sync-run-change.ts` and `src/modules/personal/domain/document-read-progress.ts`:

```ts
type SyncRunChangeDraft = {
  kind: "DOCUMENT" | "FOLDER" | "ASSET"; labels: ImportPreviewLabel[];
  sourcePath: string; previousPath: string | null; title: string;
  documentId: string | null; beforeRevisionId: string | null;
  afterRevisionId: string | null; beforeRevisionNo: number | null;
  afterRevisionNo: number | null; diagnostics: ImportDiagnostic[];
};
type SyncRunChange = SyncRunChangeDraft & {
  id: string; runId: string; sourceId: string; workspaceId: string; ordinal: number;
};
type RunCursor = { completedAt: string; runId: string };
type DocumentReadProgress = {
  userId: string; workspaceId: string; documentId: string;
  revisionId: string; revisionNo: number; readAt: Date;
};
```

- `SyncRunChangeRepository`: `insertMany(changes: SyncRunChange[]): Promise<void>`; `listByRun(runId: string, afterOrdinal: number, limit: number): Promise<SyncRunChange[]>`; `listAppliedRuns(workspaceId: string, options: { sourceId?: string; cursor?: RunCursor; limit: number }): Promise<SyncRun[]>`.
- `DocumentReadProgressRepository`: `advance(progress: DocumentReadProgress): Promise<void>`; `getMany(userId: string, workspaceId: string, documentIds: string[]): Promise<DocumentReadProgress[]>`.
- Register both in `SourceRepositories` and the MariaDB repository factory. Service constructors consume the existing `SourceUnitOfWork`, trusted `CallerContext`, and `KnowledgeQueryService` where authorization needs document queries.
- New pages: `/w/[workspaceId]/updates`, `/w/[workspaceId]/sources/[sourceId]/runs/[runId]`, `/w/[workspaceId]/sources/[sourceId]/health`.
- New API: preview diff GET, read-progress POST. Existing Apply POST gains optional risk acknowledgment; existing APIs remain valid for ordinary previews.

## Task 1: Persistent history and read-progress storage

**Files:** Create `src/infrastructure/database/mariadb/migrations/014-folder-sync-reading.ts`, `repositories/sync-run-changes.ts`, `repositories/document-read-progress.ts`, domain/port files from Contract Map; modify migrations index, repository factory, sources unit-of-work; test `tests/integration/folder-sync-reading-storage.test.ts`.
**Interfaces:** Produce the Contract Map repositories; rows scoped by stable workspace/source/document IDs, not browser folder handles.

- [ ] Write integration tests for migration repeatability, run change ordering, identical timestamps cursor tie-breaking, and `advance(revisionNo=3)` followed by `advance(revisionNo=2)` still returning 3.
- [ ] Run `npx vitest run --config vitest.integration.config.ts tests/integration/folder-sync-reading-storage.test.ts`; watch expected missing migration/repository failures.
- [ ] Implement tables `sync_run_changes` and `document_read_progress`; indexes on run+ordinal, workspace/source/run access, and user+workspace+document. Unique run+ordinal prevents duplicate event inserts. Changes reference canonical IDs and never staging rows. Use atomic conditional upsert for monotonic reads; pin before/after revision references or show unavailable if canonical deletion policy disallows preservation.
- [ ] Re-run the test, typecheck, and commit `feat(sources): persist sync changes and revision read progress`.

## Task 2: Atomic Apply journal

**Files:** Create `src/modules/sources/application/record-sync-run-changes.ts`; modify `source-import-plan-executor.ts`, `apply-folder-import.ts`; test `tests/integration/folder-sync-reading-history.test.ts`.
**Interfaces:** `captureAppliedChanges(repositories: SourceRepositories, source: KnowledgeSource, plan: FolderImportPlan, before: CanonicalImportState): Promise<SyncRunChangeDraft[]>`; return drafts after successful execution and attach run/source/workspace/ordinal before inserting.

- [ ] Write tests: initial import creates run+article revision references; moved+updated retains document ID and old/new revisions; metadata-only update is recorded; Apply retry yields same run and row count; injected failure rolls back knowledge/run/changes; terminal snapshot cleanup leaves historical references usable.
- [ ] Run the integration file and watch missing journal assertions fail.
- [ ] Capture canonical before state in the existing locked Apply transaction, execute the plan, then journal document/folder/asset changes and diagnostics with the successful run. Use final canonical state to identify newly created documents and revisions. Resolve alreadyApplied to its existing run even when the response was lost; preserve legacy runId-null fallback.
- [ ] Re-run history tests plus `tests/integration/phase2-import-apply.test.ts`, then commit `feat(import): journal applied changes atomically`.

## Task 3: Authorized monotonic reading progress

**Files:** Create `src/modules/personal/application/document-read-progress-service.ts`, `src/server/document-read-progress.ts`, `src/app/api/workspaces/[workspaceId]/documents/[documentId]/read/route.ts`; modify `src/server/composition.ts`; test `tests/integration/document-read-progress.test.ts`.
**Interfaces:** `DocumentReadProgressService.markRead(caller: CallerContext, input: { workspaceId: string; documentId: string; revisionId: string }): Promise<void>`; resolves immutable revisionNo and advances repository state.

- [ ] Write tests for current/historical revision, revision belonging to a different document, wrong workspace, another owner's My Space, revoked membership, repeated calls, and out-of-order calls.
- [ ] Run the integration file; verify rejection assertions and absent-marker assertion fail for the right reasons.
- [ ] Authorize document and revision before mutation, restrict this account Updates contract to the caller's PERSONAL workspace, and store monotonic read state. Return a private response without article bodies; do not turn read failures into reader failures. Do not overload favorite or draft keys.
- [ ] Run tests, typecheck, commit `feat(personal): track read revisions without regressing progress`.

## Task 4: Lazy bounded preview diff

**Files:** Create `src/modules/sources/domain/import-content-diff.ts`, `application/get-folder-import-diff.ts`, `src/components/imports/import-content-diff.tsx`, `src/app/api/source-imports/[snapshotId]/diff/route.ts`; modify composition, `src/server/source-imports.ts`, `import-change-group.tsx`; tests `tests/unit/import-content-diff.test.ts`, `tests/integration/import-content-diff.test.ts`, `tests/unit/import-content-diff-view.test.tsx`.
**Interfaces:** `buildImportContentDiff(before: RevisionPayload | null, after: RevisionPayload | null): ImportContentDiff`; response includes `{ snapshotId, basedOnVersion, beforeRevisionId, afterUploadKey, beforePath, afterPath, titleChanges, metadataChanges, lines, truncated }`. `GetFolderImportDiffService.get(caller, snapshotId: string, sourcePath: string): Promise<ImportContentDiff>`.

- [ ] Write tests for added/deleted lines, Unicode/CRLF, title/metadata-only edits, renamed+updated articles, duplicate filename in different folders, 2,001-line/200KiB bounds, inaccessible snapshot, arbitrary path, and version conflict while diff is requested.
- [ ] Run named unit/integration files; see unavailable diff and required bounds fail.
- [ ] Use prefix/suffix trimming and a bounded line-comparison algorithm with an operation budget; fall back to bounded before/after text when the budget is exceeded. Read only plan-selected revision and staged upload. Expose stale/expired reason without changing source data. Render text safely with lazy expand/loading/retry and explicit truncation copy.
- [ ] Run tests, typecheck, commit `feat(import): preview article and metadata differences`.

## Task 5: Server-enforced archive risk

**Files:** Create `src/modules/sources/domain/import-safety.ts`, `src/components/imports/import-safety-warning.tsx`; modify `reconcile-import-snapshot.ts`, `get-folder-import-preview.ts`, `apply-folder-import.ts`, server imports, Apply route, `import-preview.tsx`, `import-sticky-footer.tsx`; tests `tests/unit/import-safety.test.ts`, `tests/integration/import-safety.test.ts`, `tests/unit/import-safety-warning.test.tsx`.
**Interfaces:** `assessImportSafety(input: { previousDocuments: number; incomingDocuments: number; matchedDocuments: number; archivedDocuments: number }): ImportSafetySummary`; `ImportSafetySummary={previousDocuments,incomingDocuments,matchedDocuments,archivedDocuments,archiveRatio,highRisk,reasons}`. Apply accepts optional `riskAcknowledgment: { planHash: string; sourceName: string }`; snapshotId comes from the route.

- [ ] Write exact boundary assertions: 5/20 archives false; 6/20 true; 1/1 complete archive true; old>0/incoming=0 true; matching 19% true and 20% false when other conditions do not trigger; stable-identity moves count as matched. Integration: missing/wrong-name/wrong-plan acknowledgment fails; ordinary preview requires none; legacy READY resync is assessed too.
- [ ] Run unit/integration files and observe missing safety enforcement.
- [ ] Derive counts from canonical ACTIVE documents, incoming staged documents, and stable reconciler identity/path matching. For legacy previews compute safety from the still-version-matched canonical source, never assume safe. Revalidate risk, exact plan hash, and source name inside locked Apply; return `IMPORT_RISK_CONFIRMATION_REQUIRED` without changing data. Show counts and typed-source-name confirmation only when high risk.
- [ ] Verify tests and existing normal Apply HTTP callers, commit `feat(import): guard accidental mass archives`.

## Task 6: Authorized run history and result reader

**Files:** Create `src/modules/sources/application/get-sync-run-detail.ts`, `src/server/sync-reading.ts`, `src/components/sources/sync-run-detail.tsx`, run page from Contract Map; modify `src/components/sources/source-run-history.tsx` (if absent, source detail's current run table); tests `tests/integration/sync-run-detail.test.ts`, `tests/unit/sync-run-detail.test.tsx`.
**Interfaces:** `GetSyncRunDetailService.get(caller, workspaceId: string, sourceId: string, runId: string, afterOrdinal?: number): Promise<SyncRunDetail>`; detail includes run, paged changes, `hasRecordedChanges`, workspace type, and authorized revision links. Historical diff loads canonical before/after IDs using Task 4's builder, without staging.

- [ ] Write tests for summary-only legacy run, snapshot already deleted, archived readable article, missing revision, other-workspace run, revoked access, and moved+updated revision links.
- [ ] Run tests and observe missing service/page behavior.
- [ ] Verify workspace/source access then run-source binding before reading body/paths. Paginate history changes (50 rows). Build links using actual revisionNo and includeArchived policy. Display immutable warnings and summary, `Read this update`, `Browse this folder`, and PERSONAL `Back to My Space` or TEAM `Back to sources`. Do not silently substitute current revision for an unavailable historical revision.
- [ ] Run tests, commit `feat(sources): connect sync history to article reading`.

## Task 7: Checking state, cancellation, stale recovery, and Apply result navigation

**Files:** Modify `sync-now-button.tsx`, `source-sync-actions.tsx`, `source-list-row.tsx`, `folder-import-form.tsx`, `import-sticky-footer.tsx`, `src/server/source-read.ts`, import snapshot repository interface/implementation; tests existing sync/import button files plus `tests/e2e/folder-sync-recovery.spec.ts`.
**Interfaces:** Add `findLatestReadyBySourceForCreator(sourceId: string, creatorId: string, now: Date, basedOnVersion: number): Promise<ImportSnapshot|null>`. List item exposes `pendingPreviewId: string|null`; browser access errors remain client-only state, never presented as server-detected local permissions.

- [ ] Write tests for labels Check for changes/Checking/Awaiting Apply, creator-only READY visibility and expiry, AbortController cancellation with no Apply, unavailable folder, permission change mid-check, expired versus version-conflict copy, and committed Apply with lost HTTP response recovering the same run.
- [ ] Run relevant unit files and recovery E2E; watch old navigation/status assertions fail.
- [ ] Use shared status copy and existing cancellable import pipeline; show Cancel only while checking, preserve scope/duplicate-click guards, explain no changes applied on scan failure. Add explicit Review preview entry for valid pending preview. At Apply success adopt pending handle then navigate to Task 6's result; alreadyApplied/legacy null run falls back to source detail. Recover ambiguous Apply failure with a status check; never imply cancellation undoes a committed Apply.
- [ ] Run tests, update only stale expectations in existing tests that asserted old wording/navigation, commit `feat(import): unify check status and recovery flows`.

## Task 8: Updates feed and reader integration

**Files:** Create `src/modules/personal/application/list-folder-updates.ts`, `src/components/knowledge/updates-list.tsx`, `read-revision-marker.tsx`, `/w/[workspaceId]/updates/page.tsx`; modify composition, sync-reading adapter, document page; tests `tests/integration/folder-updates.test.ts`, `tests/unit/updates-list.test.tsx`.
**Interfaces:** `ListFolderUpdatesService.list(caller, workspaceId: string, input: {sourceId?: string; unreadOnly?: boolean; cursor?: RunCursor; limit: number; documentsPerRun?: number}): Promise<FolderUpdatesPage>`; returns `{runs: {run,changes: (SyncRunChange & {unread:boolean})[]}[], nextCursor}`.

- [ ] Write tests: ADDED/UPDATED revision 2 is unread after reading revision 1, reading revision 3 covers older events, reading historical revision 1 does not cover 2, move-only/identity-only/no-op does not create new reading updates, filtering pages does not skip or repeat equal-time runs, inaccessible/archived source is handled according to read policy.
- [ ] Run tests; verify absent feed and incorrect revision status failures.
- [ ] Join applied journal with read progress in bounded queries; preserve cursor progress for unread filtering even across empty pages. Use PERSONAL-only feed, 20-run pages, source/unread filters, per-run counts and revision-specific links. Mount marker after successful reader body render; send the selected revision only, best effort, and refresh relevant feed state without changing device recents behavior.
- [ ] Run tests, typecheck, commit `feat(personal): add revision-aware folder updates inbox`.

## Task 9: Folder/reading-oriented My Space and provenance

**Files:** Modify personal home, Home page, existing search result component; create `src/components/knowledge/home-folder-list.tsx`, `home-folder-updates.tsx`; tests `tests/unit/personal-home-folder-sync.test.tsx`, `tests/e2e/personal-folder-home.spec.ts`.
**Interfaces:** Home consumes SourceListItemModel plus Task 8's `FolderUpdatesPage` with `limit=3,documentsPerRun=5`; rows receive `{sourceName,sourcePath}` from authorized document location data (batched, not per-document service loops).

- [ ] Write tests for exact section order, Import folder primary CTA, preserved New note/drafts/favorites/recents shortcuts, empty sources/empty Updates, same-title docs from different sources, correct workspace search scope, permission-gated My folders action, and review pending preview link.
- [ ] Run tests and observe old writing-first Home failure.
- [ ] Reuse existing search route/control and source actions. Show only folder sources in My folders; show formal revision updates rather than generic Recently edited. Keep writing entries secondary and preserve export wording. Add source/path provenance to Home/Updates/search rows without adding new search filters. Do not add hero cards or hide drafts.
- [ ] Run tests, commit `feat(home): prioritize folders and reading updates`.

## Task 10: Source health and source path visibility

**Files:** Create `src/modules/sources/application/get-source-health.ts`, `src/server/source-health.ts`, `src/components/sources/source-health.tsx`, health page; modify source detail and existing document inspector path display where needed; tests `tests/integration/source-health.test.ts`, `tests/unit/source-health.test.tsx`.
**Interfaces:** `GetSourceHealthService.get(caller, workspaceId: string, sourceId: string, afterId?: string): Promise<SourceHealthPage>`; includes paged diagnostics `{documentId,title,sourcePath,code,message,href}` and `indexIncomplete:boolean`, next cursor. Page size 50.

- [ ] Write tests for unresolved versus ambiguous links, fixed link no longer appearing, latest persisted import warnings, warning-only legacy summary without fabricated document association, 51-row paging, stale/missing link index showing incomplete rather than healthy, inaccessible source and revoked access.
- [ ] Run tests; observe missing Health behavior.
- [ ] Authorize first, batch-load catalog/valid edges using existing link repository, resolve within current source/workspace semantics, and use latest valid persisted warning details. Do not parse all Markdown on Home or silently rebuild indexes on GET. Provide actionable article links, provenance, copy path, and a source-detail Health entry; leave images unchanged.
- [ ] Run tests, commit `feat(sources): surface link and import health diagnostics`.

## Task 11: Markdown reading contract and complete workflow E2E

**Files:** Create `tests/fixtures/import/reading-flow-v1/`, `reading-flow-v2/`, `wrong-folder/` with text-only Markdown and stable IDs; `tests/e2e/folder-sync-reading-flow.spec.ts`; modify existing affected source import/personal smoke tests.
**Interfaces:** Consumes all pages/services above; browser fixtures exercise real import/Apply and persisted read progress.

- [ ] Write failing scenario assertions before adding missing integration wiring: import→result→article→Home; recheck→expand diff (body/title/metadata/move)→Apply→Updates unread→read→read; wrong folder requires typed confirmation and cannot bypass via HTTP; link resolution survives moved articles and same-title files; history remains valid after staging cleanup.
- [ ] Run `PLAYWRIGHT_BROWSERS_PATH=/workspace/.playwright-browsers npm run test:e2e -- folder-sync-reading-flow.spec.ts personal-folder-home.spec.ts folder-sync-recovery.spec.ts` and record genuine failures; resolve each in its owning task rather than weakening assertions.
- [ ] Test both PERSONAL and TEAM navigation/permissions, reader keyboard/favorite/source-managed behavior, cancellation and failure recovery. Ensure new tests do not rely on global shared mutable fixtures or arbitrary sleeps.
- [ ] Re-run related source/import/personal tests, commit `test(e2e): verify folder sync to reading workflow`.

## Task 12: Final validation and reproducible screenshots

**Files:** Create `scripts/screenshots/folder-sync-first-wave.ts`, `docs/superpowers/verification/2026-10-03-folder-sync-first-wave.md`; artifacts under `/workspace/artifacts/folder-sync-first-wave/` (not committed binaries).
**Interfaces:** Recorder provisions an isolated DB, applies compatible fixtures separately for baseline main and final branch, launches Chromium, and disposes only its own DB/processes. Baseline Git archive `15c8b77` is kept separate from the feature tree.

- [ ] Run full `npm run test:unit`, `npm run test:integration`, `npm run typecheck`, `npm run lint`, `git diff --check`; run affected Personal/Team E2E and production build via runner. Record counts, failures, and scopes; fix failures before claiming completion.
- [ ] Capture paired 1440px/light/same-locale screenshots of Home, preview before/after expanded diff and high-risk warning, old Apply destination versus new result, source history versus Updates, source detail versus Health, and reader provenance. Use the same text fixtures/identities and browser folder memory. Label new screens as absent in baseline; no DOM fabrication of product UI.
- [ ] Inspect generated screenshots, confirm deterministic data and cleanup, and record exact baseline/final commits and artifact links in verification report. Retain optional GIF only if interaction review is useful.
- [ ] Commit recorder/report. Present self-contained implementation outcomes, risks, test results, and before/after images. Preserve workspace and do not auto-merge/deploy; publishing a new PR follows the user's integration instruction.

## Self-review

All approved sections map to tasks: Home/provenance (9), diff/safety (4–5), state/recovery (7), durable history/result (1–2,6), reading progress/Updates (3,8), text/link health (10–11), validation/screenshots (12).
The five Review Focus conditions each have an explicit owning test. Interface names and limits above are shared task contracts, not placeholders. Existing functions that need wider behavior receive compatible optional parameters, except deliberate user-facing copy/navigation changes whose tests must be updated.

## Execution handoff

Recommended: Native (the primary agent implements this plan in this session), because tasks share Apply, revision, and authorization contracts and benefit from one continuous context. A final independent whole-branch review follows the executing-plans workflow. Subagent-driven is an alternative if the user prefers a fresh implementer/reviewer per task.
Implementation begins after the user reviews this plan and selects the execution method. No production changes have been made while preparing it.
