# Phase 2 Stable Source Identity — Verification

Date: 2026-09-17. Branch: `implement/pr37-stable-source-identity`.
Implementation is in the working tree on top of PR #37 (`4d69a62`); no implementation commit or remote PR update has been made.
Environment: Node v24.6.0, npm, local Docker MariaDB, Playwright Chromium.

## Results

| Check | Result |
| --- | --- |
| `npm run test:unit` | PASS — 39 files, 298 tests |
| `npm run test:integration` | PASS — 39 files, 400 tests, isolated MariaDB database |
| `npm run test:e2e` | PASS — all 49 tests, no filters |
| Production build | PASS — E2E runner executes `next build` for both ordinary application and Phase 3 identity fixture before browser tests |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `git diff --check` | PASS |

The final integration and browser runs include the corrected single execution of adoption. Initial failing runs were not counted as successful evidence.
The documentation branch predates main's PR #36; its existing Phase 5 upload hydration test fix was brought forward unchanged after reproducing that test race.

## Acceptance evidence

| Behavior | Automated evidence |
| --- | --- |
| Optional string identity, trimming, invalid type/value rejection, 512 Unicode-character bound | `tests/unit/phase2-import-parser.test.ts` |
| Reserved top-level identity excluded from metadata and revision/fingerprint hashes; nested metadata preserved | `tests/unit/phase2-import-parser.test.ts` |
| Staging external ID persistence and case-sensitive column contract; matching v1/v2 snapshot pairs | `tests/integration/phase2-import-schema.test.ts`, `phase2-import-session.test.ts`, `phase2-import-finalize.test.ts` |
| Snapshot ID integrity and adoption/preview plan integrity | `tests/unit/phase2-import-integrity.test.ts` |
| Exact-path and unique-fingerprint adoption, same ID move/edit, new identified files, mixed sources | `tests/unit/phase2-reconciler.test.ts`, `tests/integration/phase2-import-apply.test.ts` |
| Established ID removed/replaced, duplicate incoming/canonical IDs, identity/path contradiction, ambiguous adoption | `tests/unit/phase2-reconciler.test.ts`, `tests/integration/phase2-import-apply.test.ts` |
| No-ID path/fingerprint fallback retained | Existing and expanded reconciler/Apply suites |
| Identity-only adoption creates no revision; legacy revision immutable; later edit strips reserved key | `tests/integration/phase2-import-apply.test.ts` |
| Legacy metadata excluded from canonical fingerprint during rename adoption | Canonical loader regression in `tests/unit/phase2-reconciler.test.ts` |
| Move + revise + adopt commit atomically; target drift and duplicate identity roll back | `tests/integration/phase2-import-apply.test.ts` |
| Missing/wrong-source/folder adoption targets rejected | `tests/integration/phase2-import-apply.test.ts` |
| True v1 plan shape rejected before v2 hashing | `tests/integration/phase2-import-apply.test.ts` |
| Preview adoption detail with unchanged content counter; Apply succeeds; changed identity blocks | `tests/e2e/source-import.spec.ts` |
| Identity drift/unsupported plan offers fresh-preview flow | `tests/unit/phase2-import-ui-error-codes.test.ts` |

The combined move + revise + first adoption transaction test constructs a persisted v2 plan explicitly: ordinary first adoption cannot infer a predecessor after both path and content change without existing identity evidence. Established-ID move + edit is also covered through the actual scan/finalize/apply flow.

## Operational behavior

Migration 010 adds nullable staging `external_id` and permits matching `(v1,v1)` or `(v2,v2)` persisted version pairs. New snapshots use v2. READY v1 plans require a fresh Preview after deployment; historical revisions are never rewritten. No dependency or lockfile change is required.

Task 5 lifecycle coverage is consolidated in the Apply suite. Incoming conflicts are per-document blocking diagnostics; canonical duplicate identities remain a global integrity blocker. Identity adoption adds detail but no new diff counter.
