# Task Search + Filters + List UX — Design Spec

**Status:** Proposed for implementation; scope approved 2026-11-06. This document fixes the engineering contract before coding.
**Area:** My Space → Tasks; read/discovery only. **Related:** [Task Knowledge Export design](2026-11-04-task-knowledge-export-design.md) and [implementation plan](../plans/2026-11-06-task-search-filters-list-ux.md).

## 1. Problem and outcome

Manual /hub-export already stores finished Claude Code/OpenCode tasks as immutable revisions with a latest revision, verification, references, and ACTIVE/ARCHIVED lifecycle. The existing Tasks page lists up to 50 newest-created task IDs, with older-task paging but **no keyword search, filters, or summary preview**. Finding past decisions requires opening tasks one at a time.

**Outcome:** An owner can find a past task by words in its latest revision, narrow by agent/verification/completed date, see enough context in the list to choose a result, and continue paging from a shareable URL.

**Non-goals:** edit or re-ingest, semantic/vector search, embeddings, search across historic revisions, repository/project metadata, tags, saved searches, references/code path search, Wiki-to-Task reverse links, Task graph nodes, Copy for Agent, sharing, Team Tasks, analytics.

## 2. Scope and interaction decisions

| Area | Decision |
| --- | --- |
| Entry | Keep existing My Space → Tasks primary-navigation row and route. No sidebar item. |
| Keyword fields | Latest revision's title, summary, findings, decisions, changes. Not verification checks or references. |
| Query | Case-insensitive Chinese/English substring matching; whitespace-separated AND terms; escape SQL LIKE metacharacters literally. |
| Latest revision | Exactly one indexed/searchable result per Task, with the latest **committed** revision only. |
| Filters | Agent (all / claude-code / opencode), Verification (all / passed / failed / not_run / not_applicable), completed date inclusive from/to. |
| Lifecycle | Preserve Active and Archived tabs; selecting one never includes the other. Retain query and filters across tabs, reset cursor. |
| Sort | Always completedAt descending, then taskResultId descending, for both filtered and unfiltered lists. No sort control in this phase. |
| Pagination | 50 results/page; opaque versioned composite keyset cursor over (completedAt, taskResultId) bound to the normalized search criteria. |
| List | Title, 2-line safe plain-text snippet/summary preview, Agent, Verification, completed time, revision when >1, binding metadata as needed. |
| Search URL | GET search on the existing /w/{workspaceId}/tasks route, bookmarkable and functional without JavaScript. |
| Empty state | Separate no tasks yet / no archived tasks from no matching tasks; clear filters without losing lifecycle. |

### User flows

1. Open Tasks with no search inputs. See the 50 most recently *completed* active tasks, with concise previews and an Older tasks link when there are more.
2. Type a keyword (e.g. "登入 redirect"), submit or allow debounced live submit. Every term must appear somewhere across the supported fields of the **same latest revision**; matching is Workspace-scoped.
3. Select Agent, Verification, and/or date range. Results update, with criteria in URL. Changing any criterion discards an old cursor. Active filter chips can remove one criterion or all of them.
4. Switch Active ↔ Archived; preserve q/agent/verification/date inputs, reset cursor.
5. Click a result; existing Task Detail and revision navigation remain unchanged. Browser back restores the list's search URL.
6. If the owner has no tasks at all in the selected lifecycle, retain the setup/no-archives empty state. If tasks exist but no match, show "No matching tasks" and a clear-search action.

### URL contract

Existing route gains optional parameters: <code>q</code>, <code>agent</code>, <code>verification</code>, <code>from</code>, <code>to</code>, <code>offset</code>, <code>archived=1</code>, <code>cursor</code>.

- <code>q</code>: at most 200 characters; up to five distinct whitespace-separated terms, each up to 64 characters. A too-long query displays a non-sensitive validation message and does not execute SQL. Empty/whitespace-only q with filters is a filter-only query; no criteria means default list.
- <code>agent</code> and <code>verification</code>: fixed enum values; empty/omitted is all. Unknown values fail validation without being interpreted as "all".
- <code>from</code>/<code>to</code>: valid YYYY-MM-DD local calendar dates (inclusive), with from ≤ to. <code>offset</code> is the submitted UTC offset in minutes, -840 to +840; use half-open UTC bounds [start, end) to avoid the final-second bug. Reuse the existing SearchDateZone presentation behavior, explicitly labeling the zone. All date filters apply to the **Agent artifact completedAt** (not database updated_at or revision created_at).
- <code>archived=1</code> only selects ARCHIVED; omitted selects ACTIVE.
- <code>cursor</code>: opaque URL-safe v1 value representing last normalized UTC completed timestamp, UUIDv7 Task Result ID, and a digest of canonical criteria (q after query normalization, agent, verification, from/to/offset, lifecycle). It is not authorization. Invalid, outdated, mismatched or legacy UUID-only cursors must never 500 or silently show data from unrelated criteria; respond with a safe first-page/canonical URL reset and a user-understandable state.
- Changing any filter, q, or lifecycle resets cursor to page one; clicking Older tasks preserves all criteria. Page-size remains 50 with limit+1 to determine hasNext.
- Query values are length- and type-bounded before hitting the DB. Unknown params do not grant any scope; avoid reflecting untrusted content as HTML.

## 3. Search data and storage

Keep source of truth unchanged: <code>task_results</code> + immutable <code>task_result_revisions.artifact_json</code>. Indexing must be a **derived projection**, not a second editable artifact or a new knowledge Document.

Suggested new table <code>task_result_search</code>, one row per Task:
- <code>task_result_id UUID PRIMARY KEY</code> (FK to task_results).
- <code>revision_no INT UNSIGNED</code> tracks the indexed latest revision.
- <code>completed_at DATETIME(6)</code> normalized UTC; consistently derive from the ISO date in the latest artifact (including timezone offsets). Normalize to the same precision used by the cursor and comparisons.
- <code>agent</code>, <code>verification_status</code>, <code>title</code>, and <code>summary</code> for list rendering/filtering.
- <code>search_body</code> (TEXT/MEDIUMTEXT after sizing) containing summary + findings + decisions + changes as plain text separated with unambiguous line breaks; no Markdown/HTML interpretation or executable rendering.
- Add only the measured indexes that support the workspace/binding, lifecycle, agent/verification/date filtering and sort path. Task scope derives through task_results → binding → My Space; **do not duplicate owner/workspace authority into the projection**.

**Revision write:** in the *same transaction* as successful ingest's revision insert and latest_revision_no advancement, upsert the projection to that revision. Exact replay returning 200 makes no change. A rejected, out-of-order or conflicting revision makes no change. Archive/restore changes only the task's lifecycle and immediately affects search visibility via its join. Revoked bindings' previously stored tasks stay readable.

**Backfill/rollout:** provide an idempotent, bounded-batch backfill for all existing Task Results using their current latest revision. Coordinate migration, writer deployment, and backfill so Tasks search does not silently lose pre-existing tasks. Compare revision number on upsert to prevent an old batch overwriting a concurrently ingested newer projection; if the backfill cannot complete, surface the failure and do not claim rollout complete. Test re-runs. Migration number is allocated **at implementation time** (main is currently at 033; avoid competing branches claiming 034).

Projection recovery should be deterministic from the immutable artifact. Do not store full chat, terminal logs, thinking, or additional unapproved content. Search data must receive the same owner-only protection as existing Task Results.

## 4. Search SQL and performance

The existing MariaDB 10.11 deployment has no ngram/Mroonga parser for Chinese full-text. Do not add an Elasticsearch dependency, FULLTEXT index, GPU, embeddings or a separate search service for this phase.

- Scope and lifecycle predicate **must precede** result disclosure: join task_results to binding and projection; restrict to caller's currently ACTIVE, owned PERSONAL Workspace in the application service, and include workspace predicate in the SQL. No other Workspace contributes hits, snippets, counts or errors.
- Each AND term matches <code>title COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!'</code> OR <code>search_body COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!'</code>. Use parameterized values and literal-escape <code>!</code>, <code>%</code>, <code>_</code>. Never interpolate query text or filter values into SQL. Do not use LOWER() or case-sensitive utf8mb4_bin comparison.
- Verification and Agent filters match their exact enums; dates use projection.completed_at UTC range. Sorting and keyset comparison use the **same** normalized columns; DESC requires (completed_at < cursor.completedAt) OR (completed_at = cursor.completedAt AND task_result_id < cursor.id).
- Projection may be scanned for substring LIKE; the target is a bounded per-owner task corpus, not an assertion of index-only search. Add server-side statement timeout comparable to existing Knowledge Search (currently 5 s); show a retryable, non-leaking UI error instead of infinite loading.
- Avoid N+1 fetches; fetch a limited set of previews directly. Display at most 160–200 visible characters of summary by default, and when q hits another supported field choose a bounded matching excerpt, rendered as inert text. Prefer simple deterministic snippet logic over a second search engine.
- Verify with realistic seeds and EXPLAIN before adding multiple redundant indexes. No exact latency SLA is asserted without measurement.

## 5. UX and accessibility

Use existing Task List, EmptyState, Timestamp, search input, and native filter patterns; do not redesign the navigation or change the Task Detail contract.

- One prominent search field above a compact filter row; agent, verification, and completed dates. On narrow screens, controls wrap vertically. Avoid a dashboard/card wall.
- Active/Archived tabs remain visible and keyboard-operable. Show current filter values, removability, and a Clear filters link that preserves lifecycle.
- Use a native GET form as a no-JS fallback; optional 250 ms debounced live search can reuse existing LiveSearchSubmit. Submitting with Enter applies immediately, no repeated navigations for unchanged inputs.
- Task row: title (truncate or wrap without hiding all context), summary preview max 2 lines, Agent, explicit verification label/icon (Passed, Failed, Not run, Not applicable), human-readable completed time with an exact timestamp accessible, revision indicator and existing binding revoked badge. Status is self-reported by the Agent, **not Hub certification**; color never carries the only meaning.
- Highlight matched text without interpreting content as Markdown/HTML or using dangerouslySetInnerHTML. Prefer existing HighlightedSearchText logic, with documented Unicode full-width highlighting limitation.
- Empty state differs for no tasks, no archived tasks and zero results. No horizontal scrolling at 390px; long Japanese/Chinese text, emoji, URLs and malicious markup must be inert.
- Search result cards/rows open the existing Task Detail. Preserve browser history, URL parameters and standard focus semantics; don't add a second Tasks nav destination.

## 6. Security and invariants

- All list/search reads require <code>CallerContext</code> and <code>assertOwnedPersonal</code> for the ACTIVE PERSONAL Workspace, exactly as the current TaskResultReadService. Query inputs, cursors, IDs, or the export token never grant reads.
- The single caller-less write remains only <code>IngestTaskResultService.ingest</code>; do not add a public caller-less search path or expand the export credential beyond <code>task-result:create</code>.
- Never search a global unfiltered index and filter on the client. Do not leak titles, search snippets, match counts or binding labels between users/workspaces.
- Preserve Task revision immutability, idempotent ingest, Archive/Restore and source-reference availability rules.
- Search timeout, malformed cursor, invalid date and oversize q are expected UX states, not uncaught 500s. Escape output as plain text.
- No changes to Folder Sync, Knowledge Graph, published documents, CLI or /hub-export payload schema.

## 7. Acceptance tests

1. Title/summary/findings/decisions/changes search succeeds; Unicode Chinese and English case-insensitive, whitespace AND and LIKE punctuation behave correctly. A term found only in historic revision does not match.
2. No q + no filters reproduces the complete Tasks list; filter-only search works; Agent, all four verification statuses, inclusive dates and archived filter combine via AND.
3. A new revision atomically replaces the projection. Exact replay is idempotent; rejected revision, timeout, failed transaction cannot leave stale/wrong projection. Backfill is repeatable and safe against concurrent newer revisions.
4. 50 + one pagination under completedAt ties yields deterministic no duplicate/skip on an unchanged dataset. URL cursor is bound to current filters; malformed/stale/legacy cursors fail safely, no 500.
5. A second owner, foreign My Space ID and archived Workspace cannot obtain results/counts/snippets. Revoked binding history remains visible to its owner.
6. Search URLs work after browser refresh/back; changing filters or lifecycle resets cursor; no-JS native form and accessible input labels work.
7. 390px mobile, long UTF-8 strings, invalid filters, empty states, keyboard focus and hostile HTML/script text are tested.
8. Existing task export/detail/revision/archive/restore tests and repo verify, MariaDB integration, E2E remain green.

## 8. Alternatives and decisions

- **Only client-side filtering:** rejected; current list is paginated 50 per page and would omit matching older tasks.
- **JSON_EXTRACT/LIKE directly over all revisions:** rejected as primary design; it complicates matching, latest revision and preview reads and makes backfill/reindex recovery harder.
- **MariaDB FULLTEXT:** deferred; available tokenizer lacks suitable mixed Chinese search behavior in this environment.
- **Vector/semantic search / Elasticsearch:** deferred; adds infrastructure/operational overhead and is unnecessary to validate the user workflow.
- **Search all revisions:** deferred; confusing duplicate hits and stale decisions; continue to expose historical revisions only inside Task Detail.
- **Project/Repository filters:** deferred; existing binding labels represent machines/configurations, not canonical repository identities, so inventing project attribution would be misleading.

## 9. Delivery

Implement in six reviewable steps using [the implementation plan](../plans/2026-11-06-task-search-filters-list-ux.md). Require domain/service/repository tests before UI. Deliver in one implementation PR after independent commits and full CI; this document-only PR deliberately makes no product changes.
