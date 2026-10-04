# Phase 2 Knowledge Source Import & Sync verification

Date: 2026-09-22 (Asia/Taipei)

Code HEAD verified: `af18eef` (branch `docs/verification-backfill`, = main @
`29ffcf9` + docs commits; no product-code delta between `29ffcf9` and this run
for Phase 2 paths).

Delivered by: PR #7 `0c08695` (Phase 2 knowledge source import and sync) plus
review batches #27 / #28 / #30 / #31 / #34 (PR #9 items), plus the
stable-source-identity amendment (#37 design / #39 implementation, `6cb0c59`).
This record verifies current-main behavior against the canonical spec and plan;
it does not re-litigate the per-batch review history.

- Canonical spec: `docs/superpowers/specs/2026-09-12-phase-2-knowledge-source-import-sync-design.md`
- Canonical plan: `docs/superpowers/plans/2026-09-12-phase-2-knowledge-source-import-sync.md`
- Related prior evidence (not re-done here):
  `docs/superpowers/verification/2026-09-17-phase-2-stable-source-identity-verification.md`
  covers the v1/v2 identity adoption amendment.

No product code, configs, contracts, or existing docs were touched for this
task; this file is the only change.

## Environment

- Node.js `v24.6.0`, npm `11.5.1` (`node --version` / `npm --version`).
- MariaDB via `make db-up` (container `hcm-km-phase0-mariadb-1`, healthy,
  exposed on `127.0.0.1:3307`); integration suites self-provision isolated
  databases per run (`scripts/test/integration.ts` → provision / migrate /
  dispose), so parallel runs are safe.

## Executed checks (fresh, all exit 0)

| Command | Result | Evidence |
| --- | --- | --- |
| `npm run test:unit` | PASS | 47 files, 369 tests |
| Phase 2 unit subset (10 files) | PASS | 132 tests (see below) |
| `npm run test:integration` | PASS | 40 files, 413 tests, isolated MariaDB databases |
| Phase 2 integration subset (12 files) | PASS | 117 tests (see below) |

Phase 2 unit files (all pass): `phase2-import-parser` (28),
`phase2-reconciler` (42), `phase2-import-http` (5),
`phase2-import-integrity` (10), `phase2-db-error-mapping` (9),
`phase2-import-apply-perf` (4), `phase2-import-cleanup-tx` (2),
`phase2-import-route-adapters` (16),
`phase2-import-snapshot-entries-chunked` (5),
`phase2-import-ui-error-codes` (11).

Phase 2 integration files (all pass): `phase2-import-apply` (26),
`phase2-import-finalize` (17), `phase2-import-concurrency` (14),
`phase2-import-session` (15), `phase2-import-cleanup` (8),
`phase2-import-apply-invariants` (6), `phase2-import-finalize-races` (5),
`phase2-import-schema` (9), `phase2-import-finalize-edge` (4),
`phase2-asset-projection-gate` (6),
`phase2-import-manifest-storage-bounds` (4), `phase2-import-integrity` (3).

E2E was deliberately not run: the Playwright build is heavy and no Phase 2
acceptance case strictly requires a browser (unit + integration cover the
service contracts). `tests/e2e/source-import.spec.ts` exists and is recorded
below as NOT RE-VERIFIED in this run.

## Acceptance evidence (spec §26 → fresh test results)

| Acceptance case | Verdict | Fresh evidence |
| --- | --- | --- |
| Whole-folder persistent immutable Preview for an accessible Workspace | VERIFIED | `phase2-import-finalize` (17): BUILDING→READY + persisted plan/hash, raw Markdown cleared; `phase2-import-integrity` (3): finalize/apply share one integrity hash; `phase2-import-session` (15): initial BUILDING, no Source before Confirm |
| Preview shows Added / Updated / Moved / Renamed / Archived / Restored / Unchanged + assets + diagnostics | VERIFIED | `phase2-reconciler` unit (42): full decision table incl. MOVED+UPDATED, RESTORED+UPDATED, asset path-only matching, folder path-only identity, deterministic repeat output; `phase2-import-finalize` (17): existing-Source move/update/archive/restore Preview |
| Warning can Apply, any blocker cannot Apply | VERIFIED | `phase2-import-finalize` (17): malformed frontmatter / invalid UTF-8 → READY with `has_blockers=true`; title conflict → warning only; `PATH_COLLISION` READY-blocker with colliding rows kept hash-NULL; Apply rejects blockers (`phase2-import-apply`, 26) |
| First Import creates SOURCE_MANAGED Source only in the Confirm transaction | VERIFIED | `phase2-import-apply` (26): Source created version 0→1 with one APPLIED SyncRun in a single transaction; failure leaves no Source and no SyncRun |
| Resync is source-scoped; Workspace derived server-side, no transfer | VERIFIED | `phase2-import-session` (15): resync derives Workspace/version, accepts no client Workspace/version |
| One Confirm = one canonical transaction, one SyncRun, `sync_version +1` exactly once | VERIFIED | `phase2-import-apply` (26): many-entry resync advances exactly once; `phase2-import-apply-invariants` (6) |
| No-op confirmed sync still version +1, `changed=false` | VERIFIED | `phase2-import-apply` (26, incl. persisted no-op `changed=false` assertion pinned in PR #7 F2) |
| UNCHANGED docs build no Revision; path-only move/rename builds none unless resolved title changes | VERIFIED | `phase2-import-apply` (26): unchanged → no Revision; filename-fallback rename keeps Document, new Revision with new title |
| Archive/reappearance reuses stable SourceEntry/Document/TreeNode IDs | VERIFIED | `phase2-import-apply` (26) |
| Ambiguous rename never guesses identity | VERIFIED | `phase2-reconciler` unit (42): multi-candidate fingerprint → ADDED + archive + `AMBIGUOUS_IDENTITY` warning |
| Folder rename does no subtree identity guessing | VERIFIED | `phase2-reconciler` unit (42): folder identity is exact normalized path only; old Archived + new Added, descendant Documents keep identity only via fingerprint match |
| Assets are current metadata/reference projection only (no binary, no history, no rename-by-hash) | VERIFIED | `phase2-asset-projection-gate` (6): same-path update preserves row ID; `phase2-import-apply` (26): same-hash-different-path = remove + add |
| Failed Apply leaves no partial canonical state | VERIFIED | `phase2-import-apply` (26): fault injection at after-folders / after-documents / after-revisions / after-assets / before-run checkpoints rolls back (PR #7 Task 6 Gap 1 coverage for initial and existing sources) |
| Version conflict → snapshot STALE, no force apply | VERIFIED | `phase2-import-concurrency` (14): two based-on-7 previews → first to 8, second commits STALE + FAILED run with no Knowledge mutation; maps to 409 `SOURCE_VERSION_CONFLICT` (`phase2-import-http`, 5; `phase2-db-error-mapping`, 9) |
| Double Apply does not repeat mutation/version/run | VERIFIED | `phase2-import-concurrency` (14): parallel double Apply → one mutation/run, second returns `alreadyApplied=true` |
| Snapshot creator-private; Apply re-checks Workspace membership | VERIFIED | `phase2-import-cleanup` (8): cross-user reads get hidden not-found; membership removal after Preview denies; `phase2-import-concurrency` (14): post-Preview membership removal denied; HUB_MANAGED/ARCHIVED source denied |
| Staging TTL cleanup deletes only snapshots/entries, never canonical history | VERIFIED | `phase2-import-cleanup` (8): BUILDING/READY expiry, STALE/APPLIED 24h windows, entry cascade, canonical counts unchanged; `phase2-import-cleanup-tx` unit (2) |
| SOURCE_MANAGED read-only guard (Hub-side writes refused) | VERIFIED | `phase2-import-concurrency` (14): HUB_MANAGED/ARCHIVED Apply denied; Phase 3 `phase3-request-authorization` (13, fresh pass in this run) additionally pins import allow/deny under group roles |
| Reconciler performance (no O(n²) matching) | VERIFIED | `phase2-import-apply-perf` unit (4): lookup-map based matching |

## NOT RE-VERIFIED (honestly noted, not claimed)

- **E2E browser flow** (`tests/e2e/source-import.spec.ts`: first-import happy
  path, v1→v2 resync semantics, malformed-frontmatter blocking UI, stale
  Preview UI): not run — heavy Playwright production build, and every
  underlying service contract is covered above by unit + integration. Last
  full-suite evidence for this spec file comes from the pre-merge Phase 2 gate
  and the 2026-09-17 stable-identity run (49/49 E2E pass at that time).
- **Full-scale 1,000-file timing**: the unit perf suite pins algorithmic shape
  (lookup maps, chunked inserts); no wall-clock measurement at 1,000 files was
  taken in this run.
- **Browser folder-picker UX details** (webkitdirectory scanning, preview
  filter rendering): covered only to unit level (`import-preview-filter`,
  `phase2-import-ui-error-codes`, route adapters); not driven in a real
  browser in this run.

## Notes

- Phase 3 governance now overlays Phase 2 membership checks on current main
  (`phase3-request-authorization` exercises real import adapters under group
  roles, 13/13 pass in this run) — behavior verified here is post-cutover
  behavior, which is the correct baseline for the backfill.
- `git status` shows only pre-existing untracked local files (`.codex/`,
  `.playwright-mcp/`, `pnpm-*.yaml`); untouched per task constraints.
