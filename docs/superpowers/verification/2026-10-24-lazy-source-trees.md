# Lazy source trees — verification

Date: 2026-10-24 (Asia/Taipei).
Scope: standalone PR 2; retains two navigation columns. Feature based on main; unrelated editor commit from the original checkout excluded.

## Functional checks

The source explorer bootstrap enumerates headers and reads only the current source tree. Expanded sources share a per-snapshot client cache; empty success, loading and failure are distinct. Existing persisted-open sources load after hydration; repeat expansion does not refetch. A refreshed seed replaces the cache so late responses cannot overwrite the new snapshot.

Shortcut metadata is separate from full trees and contains no body or revision content. Long favorites lists use requests of at most 100 IDs. An opt-in archived-ancestor exclusion in the summary query matches the tree's visibility, without changing default workspace summaries. The regression was first observed failing against MariaDB, then passed after the fix.

A non-empty sidebar filter intentionally loads visible trees to preserve complete cross-source results. A move request loads its source using the same cache and offers explicit retry when loading fails.

Independent read-only review found the archived-ancestor issue above. Follow-up review confirmed it resolved and found no remaining blockers.

## Scale comparison

Two complementary checks use 400 documents over four sources:

1. A deterministic model test measures source headers/current tree versus the previous all-tree collection payload. Four tree reads become one; serialized DTO size is 60,473 bytes versus 15,339 bytes. No timing claim is made from this mock-backed test.
2. A real MariaDB integration fixture creates 100 documents plus one folder per source. The comparison uses the same application query services, identity and database, one warm-up per mode and ten alternating samples. It compares list-sources + four tree reads against list-sources + one current tree read, including JSON serialization.

| Metric | All source trees | Current source tree |
| --- | ---: | ---: |
| Document rows | 400 | 100 |
| Tree nodes including folders | 404 | 101 |
| Tree reads per bootstrap | 4 | 1 |
| Headers + collection DTO bytes | 115,445 | 29,501 |
| Median projection + serialization time, ms | 10.71 | 7.40 |

Environment: local macOS, Node 24.6.0, MariaDB via the project's isolated test-database harness. Other verification processes shared the host. Timings are local observations, not production budgets or a general speedup guarantee. DTO bytes are uncompressed serialized projection data, not the full HTML/RSC payload.

Cold browser page latency before/after is **not measured** in this PR. PR #201's historical page latency numbers are not reused as new measurements. The measured result is reduced bootstrap tree work/data; current-source-only workspaces naturally gain little.

## Commands and outcomes

Final gate outcomes are recorded below after completion.

- `npx vitest run --config vitest.config.ts`: **252 files, 3,153 tests passed** on the final main-based feature branch.
- `npm run typecheck`: passed.
- `npm run lint -- --ignore-pattern '.claude/**'`: passed. The exclusion is local unrelated agent worktrees, not product files.
- `npm run test:integration`: **85 files, 765 tests passed** in a newly provisioned, migrated and disposed test database.
- `npm run test:e2e -- lazy-source-trees.spec.ts phase2.5-knowledge-explorer.spec.ts zz-organize-move.spec.ts`: production build passed, **22 browser tests passed**. The harness provisions/disposes its own database. Includes expansion request counts, retry/cache, cross-source filtering, synced-source cues, moves/undo and keyboard organization.
- Mechanical UI detector over the three edited existing components returned no findings.
- `git diff --check`: passed.

The complete E2E suite was not run; the selected explorer/organizer scenarios were run. Tests verify behavior, not a full visual redesign, and this change does not introduce one.
