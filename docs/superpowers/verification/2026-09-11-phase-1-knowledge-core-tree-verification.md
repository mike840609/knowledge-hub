# Phase 1 Knowledge Core & Tree verification

Date: 2026-09-11 (Asia/Taipei)

Code HEAD verified: `7d09536` (post-PR-review fixes on top of Task 10:
`e66b822` PR6 blockers + `3060776` P2 fingerprint/history + strict revision
param validation).
No production-code changes were made or needed during Task 10; this is a docs-only
acceptance task on top of Task 9. Any docs-commit SHA after this run is recorded in
`.superpowers/sdd/2026-09-10-phase-1-knowledge-core-tree-implementation/task-10-report.md`.

## Environment

- Node.js `v24.6.0` (`node --version` on the verification machine).
- npm `11.5.1` (`npm --version`).
- MariaDB `10.11.19-MariaDB-ubu2204`, queried live from the test database host
  (`SELECT VERSION()` against container `hcm-km-mariadb-10-11`, exposed on
  `127.0.0.1:3307`; image `MARIADB_VERSION=1:10.11.19+maria~ubu2204`).
- Chromium supplied by the installed Playwright browser cache.
- Dependencies installed fresh with `npm ci` from the committed `package-lock.json`.

## Executed checks (fresh, all exit 0)

| Command | Result | Evidence |
| --- | --- | --- |
| `npm ci` | PASS | clean install from committed lockfile |
| `npm run typecheck` | PASS | strict TypeScript check, no diagnostics |
| `npm run lint` | PASS | ESLint, zero errors |
| `npm run test:unit` | PASS | 8 files, 47 tests |
| `npm run test:integration` | PASS | isolated MariaDB 10.11 databases; 13 files, 111 tests |
| `npm run build` | PASS | Next.js production build (`/`, `/knowledge`, `/knowledge/[documentId]`) |
| `npm run test:e2e` | PASS | isolated database + production server; 8 E2E tests (5 browser + archived-source active-doc + 2 revision-history) |

Nothing was UNVERIFIED: the MariaDB test host and Chromium were both available,
so every gate ran for real. Missing DB/browser would have been recorded as
UNVERIFIED, not passed — that fallback was not needed.

## Explicit concurrency evidence (each re-run in isolation, fresh DB, PASS)

| Evidence | Test | Result |
| --- | --- | --- |
| concurrent cycle moves | `phase1-concurrency`: "allows at most one of two concurrent cycle moves and keeps the tree acyclic" | 1 passed |
| READ COMMITTED lock-wait / latest-state | `phase1-concurrency`: "validates the latest committed hierarchy after waiting on the Source lock" | 1 passed |
| stale expected revision (two connections) | `phase1-authority`: "rejects stale expected revisions across two real connections without writing" | 1 passed |
| READ COMMITTED locking-read semantics | `source-safety`: "locking read observes latest committed state under READ COMMITTED" | 1 passed |
| transaction commit + rollback | `source-safety`: "proves commit and rollback outcomes with two real connections and a barrier" | 1 passed |
| concurrent writers / cycle + revision serialization | `core`: "blocks concurrent moves from forming a cycle and serializes revision numbers" | 1 passed |

The concurrency runs used a temporary isolated-DB runner that was deleted
afterwards; no runner or test code was changed.

## Architecture-boundary audit (all hold at `7d09536`)

- `src/modules/workspaces/` is present (`application`, `domain`, `ports`).
- Knowledge/Sources sources contain no `org_code` access-ownership logic
  (`org_code` remains User identity metadata only).
- Canonical mutation order holds: CallerContext → one connection →
  `READ COMMITTED` (`src/infrastructure/database/mariadb/transaction.ts`) →
  Source lock → transaction-scoped Workspace policy → Document lock → validate →
  write → single COMMIT. `SELECT ... FOR UPDATE` locks remain in the
  sources/documents/tree repositories and the tree/lifecycle internals.
- Cross-org member allow / same-org non-member deny / multi-Workspace caller /
  direct-UUID bypass are tested (`phase1-query`: cross-org read, two-workspace
  caller, unauthorized-UUID no-leak; E2E direct unauthorized document URL leaks
  no title/snippet, server log shows `WORKSPACE_ACCESS_DENIED`).
- UI workspace selector is navigation only; every application read re-checks
  membership (denial preserved end-to-end in E2E test 5).
- Application IDs use UUIDv7 (`src/shared/ids/uuidv7.ts`) with MariaDB native
  UUID round-trip.
- Public services take `caller: CallerContext` as an explicit first parameter;
  payloads cannot smuggle caller/workspace (spoofing tests in
  `phase1-authority` and `phase1-source-mapping`).
- Knowledge imports no scanner/sync code; UI (`src/app/`) imports no MariaDB
  repositories; `SourceKnowledgeProjectionService` is never referenced from
  `src/app/` (Web reads go through the query services only).
- The only `force`/`bypass`/`isSync` matches are comments asserting that no
  such escape flag exists.
- No revision update/delete operation exists (`updateRevision`/`deleteRevision`
  have zero non-test matches; immutability + NOOP semantics tested).
- No Workspace administration (no `createWorkspace`/membership-admin model) and
  no Agent Principal/actor model exist.

## Scope-exclusion audit (all hold)

No Phase 2 scanner/upload-handler/Title Resolution/diff/Preview flow, no Phase 3
Workspace admin/roles/SSO/Group mapping/production policy-audit, and no
editor/search/vector/publishing/MCP/binary/memory/Agent-actor code: targeted
greps for `scanFolder|readdir|TitleResolution|resolveTitle|computeDiff|
PreviewSession|SsoGroup|oauth|embedding|McpTool|publishTo|AgentMemory|
binary storage|createWorkspace|addMember` return zero non-test matches.
(`FILE_UPLOAD`/`FOLDER_SYNC` appear only as the Phase 1 source-type enum;
`upload`/`search`/`preview`/`diff` matches elsewhere are substrings such as
"different", not features.)

## Workspace schema / access / UUID / isolation evidence

- Ten canonical domain tables plus migration ledger; 004 nullable-column DDL →
  independent backfill → 005 constraints (NOT NULL, same-source FK,
  entry→node uniqueness, DOCUMENT `(document_id,tree_node_id)` FK) upgrade
  populated Phase 0 data (`phase1-schema` 12 + `phase1-migration-runner` 7 tests).
- `KnowledgeSource` carries `workspace_id`; Document scope resolves
  Document → Source → Workspace (no `org_code` shortcut, no duplicated
  `workspace_id` on Document).
- Default reads hide archived Source/Document/Tree; explicit `includeArchived`
  still requires Workspace membership; ancestors are gated behind the source
  archive (Task 8 fix, covered by test).
- Query services work outside React/Next runtime (non-Web caller test).

## E2E result (8/8)

1. Workspace → Source → Tree browse, stable Document URL, current revision + history.
2. Workspace selector switches to SWFP.
3. Archived documents revealed only with the archived toggle.
4. Missing document URL → not-found.
5. Direct unauthorized document URL → denial with zero title/snippet leak.
6. Active doc under archived Source stays readable in archived mode (`archived-source-active-doc`).
7. Historical revision selection shows old content (`revision-history`, `?revision=1`).
8. Unknown revision number → not-found (`revision-history`, `?revision=999`).

## Phase 2 handoff confirmation

- New Source creation takes an explicitly authorized Workspace (creation paths
  require membership on the target Workspace).
- Existing-Source sync derives the Workspace from the Source itself: projection
  is bound to the already-open Source UoW (spec §15.3), multi-command failures
  roll back all canonical writes, and cross-source moves plus ordinary Source
  Workspace-transfer attempts are rejected with the Workspace unchanged.
- Title Resolution, diff computation, Preview/Confirm/Apply product flow, and
  folder scanning remain Phase 2 work; nothing in Phase 1 pre-builds them.

## Phase 3 handoff confirmation

Phase 3 owns, and Phase 1 introduces none of: Workspace provisioning/create,
rename, archive/restore, membership administration, roles/capabilities,
Team/SSO Group mapping, production policy/audit, Company SSO adapter.
Phase 0–2 membership is a local/mock MVP foundation and must not be mistaken
for a production-grade ACL; company production multi-user governance waits on
Phase 3 as the deployment gate.

## Known limitations (deferred per ledger rulings — not re-litigated)

- **T9 A/B/C-seed ruling:** E2E runs as a single identity, so the A/B/C
  cross-org login matrix is covered by `phase1-query` integration tests
  (P1-A05/A06), not by seeding three E2E login identities. The E2E seed's
  browser-normative content (Query Master/SWFP workspaces, tree, authorized
  multi-workspace caller, no-membership denial vault) is seeded and verified.
- **T8:** two Info notes accepted as-is; the ancestors source-archive gate was
  fixed with a regression test.
- **T7 HUB-ordering note (RESOLVED in `e66b822`):** known-entry HUB apply
  surfaced `VERSION_CONFLICT` before the ownership check; authority/lifecycle
  validation now runs before version advance, HUB_MANAGED + stale version
  surfaces `HUB_MANAGED_OPERATION_REQUIRED` (pinned in
  `phase1-source-mapping`).
- **T6 convention note:** `restoreFolder` bumps `lastSeenAt` while
  `restoreDocument` preserves it — pick one convention (recommend preserve)
  when implementing projected folder restore.
- **T2 lows:** dead duplicate-ID guard, separator-less map keys, repo writes
  requiring post-004 schema.
- **T1 deferred:** `TreeCycleError` as `ValidationError` branch; contract
  import-path re-export confirmed.
- **T4 judgements (locked in tests):** cross-source parent → `INVALID_PARENT`;
  concurrent writers → one R2 + one `REVISION_CONFLICT`; Hub partial
  (create-only) staged for T5/T6.
- **T5:** TOCTOU delegation accepted; document position-0 contiguity fixed with
  a mixed doc+folder regression test.
- Source-lock-before-membership preserves Phase 0 ordering: an unauthorized
  caller may briefly hold the Source lock, then fails and rolls back with no
  external I/O; this establishes no production revocation guarantee.

## Developer-setup impact

None. No new environment variables, scripts, ports, or prerequisites were
introduced, so `README.md` and local-setup docs are intentionally left
untouched. The dirty `.gitignore` change (`.omo/` line, pre-existing local
modification) was never staged or committed.
