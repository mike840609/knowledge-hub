# Task Search + Filters + List UX — Implementation Plan

> Use Superpowers TDD / subagent-driven development: implement one scoped task, run focused tests, review, and commit before proceeding. **Implementation in progress on PR #336: Tasks 1–2 implemented; Tasks 3–6 pending. Do not merge until the remaining tasks and verification are complete.**

**Goal:** Search completed Agent Task results in My Space by the latest revision's title, summary, findings, decisions, and changes. Add Agent, Verification, and fixed-offset completed-date filters plus a readable, mobile-friendly list. Introduce search without hiding previously uploaded Tasks during backfill.

**Design:** [Task Search design](../specs/2026-11-06-task-search-filters-list-ux-design.md).
**Stack:** existing Next.js, TypeScript, MariaDB 10.11, Vitest, Playwright. No new runtime service or dependency.

## Invariants

- Keep the existing /hub-export CLI, artifact schema, Task Detail, immutable revisions, archive/restore, and reference resolution unchanged.
- Use only the owner's ACTIVE PERSONAL My Space for Task search. All reads must establish CallerContext and recheck Workspace ownership; never infer read access from export tokens or URL IDs.
- Perform filtering and cursor paging in SQL, not on the client after reading 50 results.
- Search **only the latest committed revision**; every Task appears at most once.
- Use AND keyword terms with Chinese/English substring behavior; parameterized LIKE with explicit literal escaping and utf8mb4_unicode_ci. No MariaDB FULLTEXT or vector search.
- Default results sorted by normalized UTC completedAt **epoch milliseconds** DESC, taskResultId DESC, 50 at a time. Use a versioned composite cursor tied to normalized q/filters/lifecycle. Numeric epoch milliseconds preserve the currently accepted Artifact V1 date range, which MariaDB DATETIME cannot.
- Query is at most 200 characters, at most five whitespace-delimited terms. Agent and Verification are closed enums; calendar-date filtering uses a **fixed UTC offset**, not an IANA zone, and is inclusive with bounded UTC offset. A date-filter URL lacking `offset` is initially SSR-rendered in UTC+00:00; **with JavaScript** the browser's current offset becomes the default **only through a URL replacement and matching new server query**. Without JavaScript, missing offset always means visible UTC+00:00; explicit offset always wins. DST transitions do not change the chosen fixed offset. Never relabel UTC-filtered results as browser-local.
- Existing My Space Tasks is the only UI entry; **do not change the Sidebar, App Shell, global tokens, shared PageHeader or Task Detail**. Apply the Linear-inspired refinement only inside the Tasks page. A native GET form and shareable URL must work without JavaScript. **Keep legacy Tasks list active while TASK_SEARCH_READ_ENABLED=false (the default).** Search UI and index-backed reads are enabled only after all writers are upgraded, backfill completes and projection consistency is verified.
- Respect CLAUDE.md module boundaries and the existing single composition root. No new unauthenticated read API.
- Implement with tests first and evidence from actual commands. Do not claim CI or E2E passed without running them.

## Proposed file map

| Area | Paths |
| --- | --- |
| Pure query/cursor rules | src/modules/task-knowledge/domain/task-search-query.ts, task-search-cursor.ts |
| Search/application contracts | src/modules/task-knowledge/ports/task-export-store.ts; application/read-task-results.ts |
| Atomic updates | src/modules/task-knowledge/application/ingest-task-result.ts |
| SQL and migration | src/infrastructure/database/mariadb/repositories/task-knowledge.ts; migrations/NNN-task-search.ts and migrations/index.ts |
| Backfill | scripts/db/backfill-task-search.ts or existing suitable migration orchestration |
| UI | `src/app/w/[workspaceId]/tasks/page.tsx` (read gate and composition); `src/components/task-knowledge/task-search-form.tsx` (Search/Filter toolbar + native GET fallback); `src/components/task-knowledge/task-filter-chips.tsx` (active removable criteria); `src/components/task-knowledge/task-list.tsx` (tabs and compact rows). Reuse shared primitives; do not modify Sidebar or global Design Tokens. |
| Tests | tests/unit/task-search-*.test.ts; tests/integration/task-search.test.ts; tests/e2e/task-search-my-space.spec.ts |

Migration number must be allocated at implementation time: latest known main migration is 033 and competing PRs may take 034.

## Task 1 — Domain query/filter/cursor contract

1. Write failing unit tests for Chinese, English case-insensitive matches, deduplication, full-width whitespace, literal percent/underscore/exclamation marks, blank q and multiple AND terms.
2. Implement bounded, typed input parsing. Agent accepts claude-code/opencode; Verification accepts passed/failed/not_run/not_applicable; invalid nonempty filters produce clear, non-sensitive validation.
3. Parse valid YYYY-MM-DD date ranges and -840..840 minute offset as a **fixed offset for both endpoints**; an exclusive next-day UTC bound includes the full selected last day. Dates apply to artifact completedAt, not DB update time. Test leap day, invalid ranges and a date interval spanning DST, which still uses the supplied fixed offset.
4. Implement versioned cursor with **UTC epoch-millisecond** timestamp, Task Result ID, and criteria fingerprint. Malformed, unsupported-version, old UUID-only and filter-mismatched cursors reset safely to canonical first page; no 500 or cross-query paging. Explicitly document that the cursor does not detect data mutations and the no-duplicate/no-skip guarantee assumes an unchanged matching dataset.
5. Run targeted tests and commit: test(task-search): define search query and cursor contracts.

Do not refactor Knowledge Search just to reuse tiny pure helpers unless a targeted test supports it.

## Task 2 — Projection schema and atomic writer (no backfill yet)

**Independent test gate:** The projection table, repository upsert, and real ingest writer all exist by the end of this task. No legacy backfill, search reader or cutover integration test is required at this commit; `TASK_SEARCH_READ_ENABLED=false` remains in force.

1. Start with failing MariaDB integration tests for the new projection schema and transactional ingest: first accepted revision inserts a projection, next revision replaces it, exact replay is unchanged, conflict/out-of-order/archive is rejected, and a failed transaction rolls back both latest revision and projection.
2. Add one-row-per-Task table `task_result_search`, keyed by `task_result_id` with `revision_no`, **`completed_at_epoch_ms BIGINT SIGNED`**, agent, verification_status, title, summary, and plain-text search_body. **Do not use DATETIME(6)** for completedAt: valid Artifact V1 dates can be outside its range. Workspace/owner come only from the existing binding.
3. Normalize accepted ISO8601 timestamps with offsets to signed UTC epoch milliseconds, sharing the precision contract with filters and cursor; truncate fractional nanoseconds past milliseconds instead of rounding. Test 0000/0001, 9999 with -23:00 crossing into UTC year 10000, +23:59 lower edge and nine-digit fractions. Preserve Artifact V1 without narrowing accepted inputs.
4. Add the typed projection-upsert port and MariaDB implementation; **within the existing `IngestTaskResultService` transaction**, upsert only when a new revision has been accepted, with monotonic `revision_no` protection. Exact replay does not update the projection. Use the Task's existing lock order; no second transaction and no new caller-less public entry.
5. Keep only the primary key in the initial projection migration; **defer secondary index selection** until Task 3 has owner-scoped SQL that can be checked with EXPLAIN. Run focused unit/integration/migration tests (including migration sequence uniqueness), verifying the old Tasks list and /hub-export still function with search read flag disabled.
6. Commit: `feat(task-search): add projection schema and atomic ingest writer`.

## Task 3 — Backfill, read cutover gate and owner-scoped search service

**Dependency:** Task 2 must already be committed and its real projection-writing ingest covered by integration tests. Only now test concurrency between backfill and actual ingest.

1. Write failing MariaDB integration tests for bounded backfill with previously stored Tasks, repeat runs, partial-batch interruption/resume, and **concurrent accepted new revisions through the real Task 2 writer**. A backfill upsert must never replace a higher `revision_no`, even when the snapshot was read earlier.
2. Implement idempotent, bounded-batch, resumable backfill of each Task's latest revision; no mutation to immutable artifacts. Include a repeatable administrative consistency check comparing `task_results.latest_revision_no` with `task_result_search.revision_no`, identifying missing and mismatched projection rows. Check under an appropriate consistency/concurrency strategy so it cannot report readiness based on a misleading partial scan.
3. Implement and test the read cutover gate: `TASK_SEARCH_READ_ENABLED=false` **by default** keeps the original list SQL/pagination and omits search UI/index-backed reads. Rollout order: deploy schema + Task 2 writer to **all** instances; backfill; verify completeness/revision currency; then enable projection-backed search on all readers. If backfill fails or is incomplete, leave the legacy read path active; if post-cutover errors occur, disable the flag to roll back reads safely. Include gate-on/off, failed backfill, mixed-worker safety and repeatability tests. Document how coordinated flag activation is performed in the deployment.
4. Add typed search port and owner-only `TaskResultReadService.list` implementation with mandatory `CallerContext` and `assertOwnedPersonal`. Scope SQL to authorized My Space and lifecycle via binding join before returning matches, snippets or metadata. Revoked bindings remain historically readable to their owners.
5. SQL applies AND keyword matches to title OR search_body using escaped parameterized LIKE, Agent/Verification, half-open UTC **epoch-millisecond** date bounds, ACTIVE/ARCHIVED selection and deterministic `completed_at_epoch_ms DESC, taskResultId DESC` keyset paging (51 fetched, 50 displayed). Return metadata, preview text and next cursor. For zero matches, compute `hasTasksInLifecycle` via a separate owner-scoped `EXISTS` **without search filter predicates**.
6. Use EXPLAIN on representative owner-scoped SQL before adding any justified secondary indexes; a global completedAt index is not presumed useful until measured. Apply DB statement timeout and a non-leaking retryable error. Test Chinese/English, escaped punctuation, latest-revision-only search, filter-only query, >50 results, tied timestamps, cursor bounds, revoked binding, workspace denial, empty states, real writer/backfill race, cutover/rollback. Never assert snapshot consistency across data changes between page requests.
7. Run focused unit and MariaDB integration tests with backfill/writer race and both read paths; commit: `feat(task-search): backfill and add guarded scoped search`.

## Task 4 — Linear-inspired Tasks-only search toolbar, tabs, URL filters

**Files:** `src/app/w/[workspaceId]/tasks/page.tsx`, `src/components/task-knowledge/task-search-form.tsx`, `src/components/task-knowledge/task-filter-chips.tsx`, `src/components/task-knowledge/task-list.tsx`; tests `tests/unit/task-search-form.test.tsx`, `tests/unit/task-filter-chips.test.tsx`, `tests/e2e/task-search-my-space.spec.ts`. Use current shared input/select/menu/button primitives and design tokens. Do not touch Sidebar/App Shell/global CSS/Tailwind token definitions.

1. **Red:** Add failing component/E2E tests for a feature-flagged Tasks hierarchy: existing compact PageHeader/“Set up export”, full-width labelled **Search tasks** field, compact **Agent / Verification / Completed** toolbar, optional selected chips, Active/Archived tabs and list. The old Tasks UI remains unchanged when `TASK_SEARCH_READ_ENABLED=false`. There is no `⌘K` hint in the field (reserved for global Quick Search).
2. Implement an accessible native **GET** form at the existing Tasks route. Search takes available width and Enter submits immediately; optionally debounce input changes by 250 ms. Agent and Verification expose clear labelled selections, Completed expands a fixed-offset date range selector. JS-enhanced accessible popover/dropdown UI may be used, **but a no-JS keyboard-operable equivalent must remain** (labelled select / native `<details>` or inline date inputs). Use neutral 32px-class controls and avoid a persistent multi-row form or card grid.
3. Add URL-backed **active Filter Chips**, rendered only for applied q, Agent, Verification and/or Completed date constraints. Individual remove actions preserve all other criteria and lifecycle; removing the final date bound removes now-unused offset; every criteria change drops `cursor`. `Clear all filters` drops q/agent/verification/from/to/offset/cursor but **preserves Active/Archived**. Chips must be actual accessible links/buttons with visible focus; avoid redundant badge decoration.
4. Keep compact Active/Archived tabs immediately above the results and preserve all active criteria when switching (except cursor). Older tasks links preserve the complete canonical criteria and use the fresh composite cursor. Any user-visible results number must clearly indicate the **current page**, or show “50+” only when `limit+1` proves more results; do not claim a global total from a limited page or add an unscoped count.
5. Preserve the already-approved Task-specific fixed-offset zone behavior: when a date-filtered URL lacks offset, SSR renders results/label as UTC+00:00; JS adds browser offset via one `router.replace`, removes cursor, and only updates the displayed zone and results together **after** the new server response. No-JS remains visibly UTC+00:00; explicit offset wins; no IANA/DST wall-clock semantics. Guard against navigation loops, debounced submits and label/data mismatch.
6. **Green + verify:** tests cover search-only, filter-only, popover keyboard/focus, Enter, no-JS native GET, a selected chip removal, Clear all, tab change, paging, refresh/back, invalid inputs and date deep links at UTC+00/+08 and fixed-offset DST. Run focused unit tests and Playwright with read flag on/off; commit `feat(task-search): add compact Tasks-only filter toolbar`.

## Task 5 — Compact Linear-inspired list rows and useful states

**Files:** `src/components/task-knowledge/task-list.tsx` and a small adjacent excerpt/highlight helper if needed; tests `tests/unit/task-list.test.tsx` and `tests/e2e/task-search-my-space.spec.ts`. Preserve the existing Task Detail link destination and public props where possible; share status primitives but do not modify the global Sidebar, UI theme or shell.

1. **Red:** Add failing tests for a **single continuous list with subtle row dividers**, no cards/grid. Every full-row detail link has one clear, 14px-medium title; below it a safe 160–200-character, max-two-line summary or matching excerpt; then muted 12px metadata in stable order: Agent, textual Verification, completed time, revision >1 and revoked binding marker as needed. Avoid bulky repeated badges, shadows and decorative icons.
2. Implement inert matched-text highlights (React escaped text/spans, never `dangerouslySetInnerHTML` or interpreted Markdown). Use `Timestamp` or equivalent exact accessible date. Show that Verification comes from the Agent rather than independent Hub certification (text/tooltip/help, not color alone). Long titles/excerpts wrap/truncate meaningfully without hiding the task identity.
3. Add an **accurate page indicator** beside the Active/Archived tabs. When only a fetched page and `hasNext` are known, use “Showing N tasks” or “50+ tasks” per the Task 4 contract; no new expensive total-count query. Preserve lightweight Older tasks link at the end.
4. Distinguish `hasTasksInLifecycle=false` initial empty and no archived tasks from a zero-match search; show action-oriented, concise copy (“Set up task export”, “Clear filters”). Invalid filters and search timeout show safe inline validation/retry; while client navigation is pending, allow non-layout-shifting inline feedback/skeletons without displaying an outdated offset label over new results. Never hang indefinitely.
5. **Green + verify:** 390px and desktop snapshots/DOM assertions in light/dark; long CJK/emoji/URL content; two-line clipping without horizontal overflow; keyboard focus/Enter; no-JS, no-match/empty/error/loading, text injection and archived state. Ensure mouse hover and focus both signal clickable rows. Run focused unit and responsive Playwright tests; commit `feat(task-search): refine compact Task rows and states`.

## Task 6 — Regression, performance, review and PR

1. Extend Playwright Task Export tests with E2E keyword search across fields, Agent and Verification/fixed-offset date filters, cursor pagination (>50), archive/restore and browser refresh/back. Include the **missing-offset direct-load SSR→hydration→re-query** case, no-JS UTC-default result/label, two zero-result states, and completedAt timestamp bounds across MariaDB DATETIME limits. Verify Filter Chips, Clear all preserving tab, count label accuracy, Enter submission and that Ctrl/⌘K still invokes global Quick Search instead of implying a Task Search shortcut.
2. Confirm guessed/foreign Workspace IDs and malformed/version-mismatched/criteria-mismatched cursors cannot reveal titles, match counts, summaries or binding names; document unchanged-dataset paging guarantee only.
3. Run existing task-export-flow and task-export-my-space E2E alongside the new suite. Recheck **390px and desktop, light/dark**, wrapped filter toolbar/chips, keyboard navigation, accessible popover focus management, two-line previews and hostile/long plain-text rendering **without horizontal scrolling**. Assert no Sidebar, App Shell or global token changes in the diff. Simulate interrupted backfill: with flag off, old Tasks remain readable; enable only after no missing/mismatched search projections; test flag rollback.
4. Run EXPLAIN and performance probes at 100/1,000/10,000 tasks if possible; record actual dataset, time and statement timeout. Label unmeasured cases explicitly.
5. Execute make verify, make test-integration and make test-e2e; resolve real failures. Request Superpowers code review and address findings.
6. **Continue PR #336 on the existing branch** with migration/backfill instructions, test/CI evidence, desktop/mobile screenshots and known limits; the user explicitly requested same-branch execution. Do not create a second PR or merge without approval.

## Final acceptance

- Search covers five specified latest-revision fields and works with mixed Chinese/English and literal LIKE punctuation; filter-only works.
- Combining Agent, Verification, local date range, and Active/Archived returns only correctly scoped Tasks.
- Composite cursor yields stable paging over unchanged data, preserves all search state and handles filter changes safely.
- Search projection is consistent with latest revision after ingest, replay, failure and concurrent backfill, **without restricting any existing Artifact V1 timestamps**, including extreme date+offset values.
- Existing Task Export, Task Detail, Revision History, Archive/Restore and owner-only authorization are unchanged. During deployment, Tasks stays usable on the legacy read path until a verified projection cutover; failure/rollback does not hide old tasks.
- List is a Linear-inspired compact **Tasks-only** surface with search first, Agent/Verification/Completed toolbar, active removable chips, compact Active/Archived tabs, truthful page-result indicator, high-density 2-line rows and keyboard/no-JS fallback. It is accessible, inert-text-safe and usable at 390px in light/dark; Empty states are distinguished using a scoped existence check; date zone is explicit and no-JS defaults to UTC+00:00. **Sidebar, App Shell, global tokens and Task Detail remain unchanged.**
- Tests and review provide verifiable evidence before merge.

**Deliberately deferred:** semantic search, historical revision search, references, repository metadata, Task graph, Copy for Agent, analytics and Team Workspace Tasks.
