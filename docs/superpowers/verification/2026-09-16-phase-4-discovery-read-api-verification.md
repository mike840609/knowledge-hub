# Phase 4 Discovery & Read API — Verification

| Item | Details |
| --- | --- |
| Date | 2026-09-16 |
| Spec | docs/superpowers/specs/2026-09-16-phase-4-discovery-read-api-design.md |
| Plan | docs/superpowers/plans/2026-09-16-phase-4-discovery-read-api.md |
| Branch tested | `feat/phase-4-discovery-read-api`, starting commit `25fa456` |
| Environment | macOS, worktree `km-wt-1`, Node v24.6.0, npm 11.5.1, MariaDB 10.11.19 (Docker `hcm-km-phase0-mariadb-1`, 127.0.0.1:3307) |

## Commands and results

First run (`25fa456`, no changes):

| Command | Result |
| --- | --- |
| `make verify` | PASS — unit 27 files / 215 tests, typecheck, lint, and build all passed, exit 0 |
| `npm run test:integration` | PASS — 36 files / 365 tests, exit 0 |
| `npm run test:e2e` | **FAIL** — 33 passed／9 failed，exit 1 |

The 9 first-run `test:e2e` failures (`knowledge-browser.spec.ts` ×3, `phase2.5-knowledge-explorer.spec.ts` ×3, `revision-history.spec.ts` ×3) all timed out because no document titled “Architecture” could be found. All 5 Phase 4 E2E cases (`phase4-search.spec.ts`) already passed in this run.

**Root-cause investigation**: `seedBrowserFixtures` in `scripts/db/seed.ts` originally checked whether the `obsidianWikiSource` tree was empty to identify a fresh database, creating the Architecture/Runbooks/Retired Notes seed documents only when empty. Task 5 commit `b0dbaca` placed Phase 4 search-fixture creation (`searchDocument` / `searchNode`) in the same transaction before this empty-table check, so the table was never empty even in a fresh database and those three documents were never created—a real fixture-ordering bug rather than environment noise or a known existing defect.

**Fix**: move `searchDocument` / `searchNode` creation after the `treeCount.length === 0` check and Architecture/Runbooks/Retired creation, using an independent `unitOfWork.run` block (the same pattern as the file's existing archived-source fixture). Changed file: `scripts/db/seed.ts`.

Rerun all gates after the fix (same branch, including the fix):

| Command | Result |
| --- | --- |
| `make verify` | PASS — unit 27 files / 215 tests, typecheck, lint, and build all passed, exit 0 |
| `npm run test:integration` | PASS — 36 files / 365 tests (including `core.test.ts`'s “running seed twice creates no duplicates” idempotency test), exit 0 |
| `npm run test:e2e` | PASS — 42 passed／0 failed，exit 0（26.2s） |

All three gates passed after the fix, with no skipped or selectively rerun cases; the 42 E2E cases above are the complete `tests/e2e/*.spec.ts` suite (including Phase 4's 5 cases).

## Requirement mapping

### Unit tests (U1–U6, no DB required)

| # | Test file | Cases | Result |
| --- | --- | --- | --- |
| U1 | `tests/unit/phase4-search-query.test.ts` | `parseSearchQuery`: ordinary terms, tokenization on full-width spaces, deduplication, more than 5 terms, overlong term, empty string / whitespace only | PASS |
| U2 | `tests/unit/phase4-search-query.test.ts` | `toLikePattern`: escaping `!` / `%` / `_`; `100%` does not become a wildcard | PASS |
| U3 | `tests/unit/phase4-search-capability.test.ts` | “discover-vs-read tripwire”: no role can discover without reading | PASS |
| U4 | `tests/unit/phase4-search-query.test.ts` | `highlightSnippet`: mark hits, case insensitive, no marking without a hit | PASS |
| U5 | `tests/unit/phase4-search-authorization.test.ts` (`excludes a discover-only Workspace from the workspaceIds handed to the repository`) | Authorization-set filtering: fake `KnowledgeUnitOfWork` / `WorkspaceUnitOfWork` drive real `KnowledgeSearchService.search`; `evaluateWorkspaceCapabilities` is mocked to return discover-only (no `document.read`) and readable sets, asserting `workspaceIds` passed to `repositories.search.search` exclude the former | PASS (previously incorrectly referenced `tests/integration/phase4-search-service.test.ts:76`: its `outsider` fixture has no membership, so the `accessible` list is already empty and the `readableWorkspaces` loop never runs; replacing it with `return [...candidateIds]` still passes, failing to lock down §5.2 filtering. Verified the new test fails with that replacement and passes again after restoring original code) |
| U6 | `tests/unit/phase4-search-capability.test.ts` | `canSearch` derivation: true with `document.read`, false for discover-only, still true for an archived Team | PASS |

### Integration tests (I1–I12, DB required)

| # | Test file | Cases | Result |
| --- | --- | --- | --- |
| I1 | `tests/integration/phase4-search-service.test.ts` | `never leaks content of unreadable workspaces in an all-scope search` | PASS |
| I2 | `tests/integration/phase4-search-service.test.ts` | `hides a non-member's workspace behind a non-enumerating not-found` | PASS |
| I3 | `tests/integration/phase4-search-service.test.ts` | `includes workspaces granted through a validated SSO group mapping` | PASS |
| I4 | `tests/integration/phase4-search-repository.test.ts` | `matches mixed Chinese/English content case- and width-insensitively` | PASS |
| I5 | `tests/integration/phase4-search-repository.test.ts` | `requires every term to match either the title or the body` | PASS |
| I6 | `tests/integration/phase4-search-repository.test.ts` | `hides a document archived together with its tree node unless includeArchived is set` / `hides documents under an archived source unless includeArchived is set` | PASS |
| I7 | `tests/integration/phase4-search-service.test.ts` | `keeps an archived Team searchable when scoped to it, but out of all-scope by default` | PASS |
| I8 | `tests/integration/phase4-search-repository.test.ts` | `searches only the current revision` | PASS |
| I9 | `tests/integration/phase4-search-repository.test.ts` | `treats an out-of-scope source filter exactly like a missing one` | PASS |
| I10 | `tests/integration/phase4-search-repository.test.ts` | `ranks title hits above body-only hits and returns correct snippet and attribution fields` | PASS |
| I11 | `tests/integration/phase4-search-repository.test.ts` (`applies limit and offset for pagination`) + `tests/integration/phase4-search-service.test.ts` (`reports hasNext using one extra row beyond the page size`) | Pagination: 21 rows determine whether another page exists, limit/offset | PASS (**gap**: the `page` cap of 50 / offset 980 boundary has no dedicated case; the `SEARCH_MAX_PAGE = 50` clamp is currently covered only by code review, not locked down by automated tests) |
| I12 | `tests/integration/phase4-search-repository.test.ts` | `treats wildcard characters in the query as literal text` | PASS |

### E2E（E1–E5）

| # | Test file / case | Result |
| --- | --- | --- |
| E1 | `tests/e2e/phase4-search.spec.ts` › `finds a mixed Chinese/English document and opens it` | PASS |
| E2 | `tests/e2e/phase4-search.spec.ts` › `never returns content from a workspace without membership` | PASS |
| E3 | `tests/e2e/phase4-search.spec.ts` › `keeps archived mode on result links` | PASS |
| E4 | `tests/e2e/phase4-search.spec.ts` › `shows an empty state when nothing matches` | PASS |
| E5 | `tests/e2e/phase4-search.spec.ts` › `returns 404 for a workspace the caller cannot access` | PASS (covers only the reachable half: nonmember enters URL directly and receives 404) |

**Known intentional deviation, not a gap**: the first half of spec §9.3 E5, “navigation hides Search when `canSearch === false`,” is unreachable under the current role model—all four assignable roles (OWNER/ADMIN/EDITOR/VIEWER) include `document.read`, so a `canSearch === false` fixture cannot be created to verify hiding navigation. This derivation is instead locked down by U6 (`tests/unit/phase4-search-capability.test.ts`) at the pure-function layer; E2E verifies only the reachable “nonmember 404” portion, an actual security boundary.

## Performance baseline

Corpus construction: disposable database `scratch_phase4_bench`, single table `bench_docs(id INT PK, title VARCHAR(512), markdown LONGTEXT)`, with `title` / `markdown` both `CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`, InnoDB; `SELECT seq FROM seq_1_to_20000` generates 20,000 rows, with `markdown` set to `REPEAT(CONCAT('人資系統請假流程說明 Employee Leave Policy ', seq, ' 公司規範與簽核 '), 180)` (literal Chinese benchmark sample: HR-system leave instructions and company rules/approval), and an additional rare marker appended to every 200th row. Measured corpus size (`SUM(OCTET_LENGTH(title)+OCTET_LENGTH(markdown))`) is **277.1 MB**, and `innodb_buffer_pool_size` is **128 MB** (`134217728` bytes), matching spec §4.2's environment. After the run, `DROP DATABASE scratch_phase4_bench;` deleted it, and `SHOW DATABASES` reconfirmed its absence (no writes to dev/test databases).

| Query | Measured here | Spec §4.2 baseline | Notes |
| --- | --- | --- | --- |
| Body LIKE (cold) | 778.99 ms | 2,272 ms | `markdown LIKE '%人資系統%'` (bin collation, literal Chinese substring sample meaning “HR system”) |
| Body LIKE (warm, same query rerun) | 812.81 ms | 1,940 ms | Same as above, rerun immediately |
| Body COLLATE utf8mb4_unicode_ci LIKE (English) | 836.24 ms | 1,602 ms | `markdown COLLATE utf8mb4_unicode_ci LIKE '%Employee%'` |
| Body LOWER(markdown) LIKE | 1,285.42 ms | 2,501 ms | `LOWER(markdown) LIKE '%employee%'` |
| Title COLLATE utf8mb4_unicode_ci LIKE | 2.48 ms | 3 ms | `title COLLATE utf8mb4_unicode_ci LIKE '%請假%'` (literal Chinese query meaning “leave”) |

Measured full-text scans are generally faster than spec §4.2's baseline (roughly 30%–60%), while title scans are nearly identical (2.48 ms vs 3 ms). This informational difference reflects machine load/hardware rather than failure—the current run had no other load, unlike the earlier §4.2 environment, and the difference is expected. The conclusion is unchanged: full-text scans scale linearly with corpus size, and `COLLATE ... LIKE` remains clearly faster than `LOWER()` (about 35% here, about 36% in the baseline, consistent across measurements).

Upgrade trigger (spec §10): **production search p95 exceeds 1 second**. Once triggered, evaluate in order: narrow the scan scope, then a derived n-gram index table, and finally an external search engine; engine selection is deferred to Phase 8 (Phase 0 ADR). Do not create a derived index before the trigger.

**Known baseline limitations**:

(a) This baseline creates a single-table corpus `bench_docs(id, title, markdown)` and measures raw `LIKE` scans. The deployed query is different—a five-table join (`knowledge_documents` → `knowledge_revisions` → `knowledge_tree_nodes` → `knowledge_sources` → `workspaces`), with `workspace_id IN (...)`, three status conditions, per-term `LIKE` matching, in-query `LOCATE`/`SUBSTRING`, and filesort on computed `title_hits` (see `src/infrastructure/database/mariadb/repositories/knowledge-search.ts:63-80`). The numbers above are therefore a **lower bound** on real costs, rather than a measurement of the deployed query. Spec §10's “production p95 exceeds 1 second” trigger is based on this evidence, so the first production p95 measurement should be treated as the real calibration point. This limitation comes from the baseline method specified in §4.2, which Task 6 was required to reproduce for comparability—an existing methodological limitation rather than a defect in this run.

(b) A p95 alert may also have causes outside the upgrade path documented here: `readableWorkspaces` in `src/modules/knowledge/application/knowledge-search-service.ts` (approximately lines 89–100) calls `evaluateWorkspaceCapabilities` separately for every candidate workspace, each making two queries (`workspaceMemberships.find` and `groupMappings.listByWorkspace`), in addition to the already executed `listWorkspaces`. For a caller in 30 workspaces, this costs approximately 60 serial database round trips before scanning begins. On a p95 alert, inspect round-trip count before assuming the scan itself is the bottleneck.

## Prerequisite status

Phase 3 Product Acceptance: **PASS**, recorded at `docs/superpowers/verification/2026-09-15-phase-3-workspace-governance-verification.md` (the file is on branch `docs/phase-3-product-acceptance`, not this branch; its path/status are cited without merging or cherry-picking it here).

## Changed files

This section records changes **when this acceptance record was produced** (commit `a50e2b5`), plus subsequent review-driven fixes.

At acceptance:

- `scripts/db/seed.ts`: fixed Phase 4 search-fixture creation order, avoiding writes to the `obsidianWikiSource` tree before the empty-table “fresh database” check, which would prevent Architecture/Runbooks/Retired Notes seed documents from ever being created.
- `docs/superpowers/verification/2026-09-16-phase-4-discovery-read-api-verification.md`: this acceptance record (new).

Added after acceptance following whole-branch review (commit `c2ea863`):

- `src/app/w/[workspaceId]/search/page.tsx`, `src/lib/search-params.ts`, `tests/unit/phase4-search-params.test.ts`: duplicate query parameters (`?q=a&q=b`) make `searchParams` deliver an array and cause 500; normalized at the route boundary and widened type declarations.
- This record's performance-baseline section: added that it measures only single-table `LIKE`, rather than the deployed five-table JOIN, making the numbers lower bounds.

Added after acceptance following design-conformance review (commits `a73f3a6`, `1565c94`, `8e91643`):

- `tests/unit/phase4-search-authorization.test.ts` (new): locks down §5.2's `document.read` filtering for `scope=all` (U5).
- `tests/unit/phase4-search-repository-timeout.test.ts`, `tests/unit/phase4-search-read.test.ts` (new): adds both ends of §6.6 timeout-path coverage (errno 1969 translation, unchanged propagation of non-timeout errors, `timedOut` state).
- `src/server/search-read.ts`: restores the authorization try/catch specified by §7.1.
- `src/components/search/search-form.tsx`, `src/components/search/search-results.tsx`: per §7.3, Source filtering appears only in a single-Workspace scope, and invalid `source` parameters are removed from all-scope pagination links.

## Known gaps

- I11's `page` cap of 50 (offset 980) boundary has no dedicated automated test and is covered only by code review.
- The first half of E5 (navigation hiding when `canSearch === false`) is unreachable under the current role model, as recorded under “Known deviations” above; this is not a newly introduced gap.
