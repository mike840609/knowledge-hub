# Task Search + Filters + List UX — Implementation Plan

> Use Superpowers TDD / subagent-driven development: implement one scoped task, run focused tests, review, and commit before proceeding. **Planning only: no implementation has started.**

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
- Query is at most 200 characters, at most five whitespace-delimited terms. Agent and Verification are closed enums; calendar-date filtering uses a **fixed UTC offset**, not an IANA zone, and is inclusive with bounded UTC offset. Without JavaScript and without an explicit URL offset, the labeled default is UTC+00:00; with JavaScript the browser's current offset is the default. DST transitions do not change the chosen fixed offset.
- Existing My Space Tasks is the only UI entry; no new sidebar and no unrelated features. A native GET form and shareable URL must work without JavaScript. **Keep legacy Tasks list active while TASK_SEARCH_READ_ENABLED=false (the default).** Search UI and index-backed reads are enabled only after all writers are upgraded, backfill completes and projection consistency is verified.
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
| UI | src/app/w/[workspaceId]/tasks/page.tsx; src/components/task-knowledge/task-list.tsx and task-search-form.tsx |
| Tests | tests/unit/task-search-*.test.ts; tests/integration/task-search.test.ts; tests/e2e/task-search-my-space.spec.ts |

Migration number must be allocated at implementation time: latest known main migration is 033 and competing PRs may take 034.

## Task 1 — Domain query/filter/cursor contract

1. Write failing unit tests for Chinese, English case-insensitive matches, deduplication, full-width whitespace, literal percent/underscore/exclamation marks, blank q and multiple AND terms.
2. Implement bounded, typed input parsing. Agent accepts claude-code/opencode; Verification accepts passed/failed/not_run/not_applicable; invalid nonempty filters produce clear, non-sensitive validation.
3. Parse valid YYYY-MM-DD date ranges and -840..840 minute offset as a **fixed offset for both endpoints**; an exclusive next-day UTC bound includes the full selected last day. Dates apply to artifact completedAt, not DB update time. Test leap day, invalid ranges and a date interval spanning DST, which still uses the supplied fixed offset.
4. Implement versioned cursor with **UTC epoch-millisecond** timestamp, Task Result ID, and criteria fingerprint. Malformed, unsupported-version, old UUID-only and filter-mismatched cursors reset safely to canonical first page; no 500 or cross-query paging. Explicitly document that the cursor does not detect data mutations and the no-duplicate/no-skip guarantee assumes an unchanged matching dataset.
5. Run targeted tests and commit: test(task-search): define search query and cursor contracts.

Do not refactor Knowledge Search just to reuse tiny pure helpers unless a targeted test supports it.

## Task 2 — Search projection, migration, backfill

1. Write MariaDB integration tests for projection schema and repeatable backfill.
2. Add one-row-per-Task table task_result_search, keyed by task_result_id with revision_no, **completed_at_epoch_ms BIGINT SIGNED**, agent, verification_status, title, summary, and combined plain-text search body (summary/findings/decisions/changes). **Do not use DATETIME(6) for completedAt**: Artifact V1 already accepts years 0000/0001 and dates normalizing beyond UTC year 9999. Owner/Workspace are NOT authoritative fields on this table; derive through binding.
3. Normalize completedAt from existing accepted ISO8601 including timezone offsets in application code to a signed, safe-integer **epoch millisecond**; use identical integer values in DB filters, sort and cursor. Truncate fractional digits past milliseconds deterministically (do not round); sort ties by Task Result ID. Preserve Artifact JSON and validator unchanged. Add explicit tests for 0000/0001, 9999 with -23:00 offset crossing UTC year 10000, +23:59 lower-edge, and nine-digit fractional seconds. Index/ingest/backfill must not reject existing valid artifacts.
4. Add justified indexes after EXPLAIN for Workspace/binding/lifecycle joins and completed-time pagination. Avoid redundant indexes.
5. Add an explicit idempotent bounded-batch backfill of each existing Task's **latest** revision. Upsert must be conditional on revision_no not being older than the currently indexed revision, so an in-flight backfill cannot overwrite a newer ingest. Backfill must be resumable/re-runnable after a partial batch failure.
6. **Provide and test a read cutover gate.** Deploy with `TASK_SEARCH_READ_ENABLED=false` by default; while disabled, Tasks must retain its **original** list query and pagination, with no search UI/index-backed reads. Roll out schema then projection-aware writers to **all** instances; backfill latest revisions; run a repeatable administrative completeness/currency check against `task_results.latest_revision_no` (no missing projection rows, matching revision numbers). Only after the check succeeds, enable the new search UI and projection-backed list consistently across instances. If backfill is interrupted or verification fails, keep flag disabled, retain legacy list, then resume; if post-cutover fails, turn flag off to restore the original list. Record operational rollback steps and test gate-on/gate-off, missing rows, concurrent writer/backfill, retry and full consistency before enabling.
7. Test empty database, existing tasks, rerun, backfill interruption and resume, concurrency, rollback/invalid-data behavior, date extremes and migration numbering. Run integration/migration tests and commit: feat(task-search): add projection and guarded backfill.

## Task 3 — Atomic projection and scoped search service

1. Start with failing integration tests for exact replay, revision update, conflict, archived task, rollback and owner isolation.
2. Extend TaskExportStore port/repository for projection upsert and read/search criteria.
3. In the existing IngestTaskResultService transaction, update projection only when a valid new revision commits; an exact replay does nothing. Do not create a second write transaction.
4. Extend TaskResultReadService with CallerContext-required search/list logic; call assertOwnedPersonal first, then scope SQL through task_results and task_export_bindings. Revoked bindings' historical results remain readable by the owner.
5. SQL matches every term across title OR search_body with escaped LIKE, applying Agent, Verification, **UTC epoch-millisecond completed date bounds** and ACTIVE/ARCHIVED predicates. Fetch at most 51 rows, show 50; deterministic composite keyset order (epoch milliseconds then Task Result ID). Return preview text, metadata, `hasTasksInLifecycle` and next cursor. For zero matches, compute `hasTasksInLifecycle` via a **separate owner-scoped lifecycle-only EXISTS** without q/filter predicates, never via an unscoped count.
6. Add DB statement timeout and clear retryable UI error. Test >50 tasks, tied millisecond timestamps, criteria preservation, latest revision, filter-only search, foreign workspace denial, both distinct zero-result states, and the gate-off legacy path. Concurrent changes between pages are **not** promised snapshot stability.
7. Run focused tests and commit: feat(task-search): add owner-scoped search and pagination.

## Task 4 — URL-driven search and filters

1. Add an accessible Tasks GET search form with q, Agent, Verification, completed from/to, and **fixed UTC offset** label. Preserve existing setup action, page header and Active/Archived tabs. When the rollout flag is disabled, do not display search controls; preserve the legacy Tasks listing.
2. Keep search params shareable and stable on refresh/back. Switching tabs preserves q/filters but drops cursor; changing any search criterion also resets cursor.
3. Older tasks link preserves all criteria and carries only the fresh opaque cursor. Show active filter chips and clear-filter control preserving lifecycle.
4. Reuse existing native SearchForm/LiveSearch patterns where applicable: GET works without JS; Enter submits; optional 250 ms debounce navigates only after typing pause. Label no-JS default as **UTC+00:00**; with JS use browser's current UTC offset only when URL has none; honor explicit URL offset on reload. Explain that this is **fixed-offset** filtering (not DST-aware local time).
5. Test invalid URL inputs, explicit offset, no-JS UTC default and label, dates crossing DST at a fixed offset, keyboard use, filter-only mode and stable navigation; commit: feat(task-search): add URL-driven filters.

## Task 5 — List UX and safe rendering

1. Keep the current list (no card-grid redesign). Display title, at most two lines of plain-text summary or matching excerpt, Agent, textual Verification, completed timestamp, revisions and existing binding revoked badge.
2. Highlight matched words in title/excerpt using inert text spans; never interpret task content as Markdown or HTML. Do not imply Agent-reported Passed is independent Hub certification.
3. Distinguish first-use empty, no archived tasks, and no matches under current criteria **using owner-scoped hasTasksInLifecycle** independent of q/filters. Never infer the base-state from zero filtered hits; offer Clear filters for no matches.
4. Test 390px width, wrap/truncation, long URLs/Unicode, hostile text, focus accessibility and no horizontal overflow; commit: feat(task-search): improve list readability.

## Task 6 — Regression, performance, review and PR

1. Extend Playwright Task Export tests with E2E keyword search across fields, Agent and Verification/fixed-offset date filters, cursor pagination (>50), archive/restore and browser refresh/back. Include no-JS UTC-default label, two zero-result states, and completedAt timestamp bounds across MariaDB DATETIME limits.
2. Confirm guessed/foreign Workspace IDs and malformed/version-mismatched/criteria-mismatched cursors cannot reveal titles, match counts, summaries or binding names; document unchanged-dataset paging guarantee only.
3. Run existing task-export-flow and task-export-my-space E2E alongside the new suite. Recheck 390px responsive layout and plain-text rendering. Simulate interrupted backfill: with flag off, old Tasks remain readable; enable only after no missing/mismatched search projections; test flag rollback.
4. Run EXPLAIN and performance probes at 100/1,000/10,000 tasks if possible; record actual dataset, time and statement timeout. Label unmeasured cases explicitly.
5. Execute make verify, make test-integration and make test-e2e; resolve real failures. Request Superpowers code review and address findings.
6. Open implementation PR against main with migration/backfill instructions, test/CI evidence, desktop/mobile screenshots and known limits. Do not merge without approval.

## Final acceptance

- Search covers five specified latest-revision fields and works with mixed Chinese/English and literal LIKE punctuation; filter-only works.
- Combining Agent, Verification, local date range, and Active/Archived returns only correctly scoped Tasks.
- Composite cursor yields stable paging over unchanged data, preserves all search state and handles filter changes safely.
- Search projection is consistent with latest revision after ingest, replay, failure and concurrent backfill, **without restricting any existing Artifact V1 timestamps**, including extreme date+offset values.
- Existing Task Export, Task Detail, Revision History, Archive/Restore and owner-only authorization are unchanged. During deployment, Tasks stays usable on the legacy read path until a verified projection cutover; failure/rollback does not hide old tasks.
- List is scan-friendly, accessible, inert-text-safe and usable at 390px. Empty states are distinguished using a scoped existence check; date zone is explicit and no-JS defaults to UTC+00:00.
- Tests and review provide verifiable evidence before merge.

**Deliberately deferred:** semantic search, historical revision search, references, repository metadata, Task graph, Copy for Agent, analytics and Team Workspace Tasks.
