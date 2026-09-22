# Phase 3 Identity, Workspace Administration & Governance verification

Date: 2026-09-22 (Asia/Taipei)

Code HEAD verified: `af18eef` (branch `docs/verification-backfill`, = main @
`29ffcf9` + docs commits; no product-code delta between `29ffcf9` and this run
for Phase 3 paths).

Delivered by: PR #24 `ef22de3` (Phase 3 identity and workspace governance with
trusted request authorization) plus the production cutover runbook
(`docs/operations/phase3-workspace-governance-cutover.md`). This record verifies
current-main behavior against the canonical spec/plan acceptance cases and the
cutover doc; it does not re-litigate the PR #24 review history.

- Canonical spec: `docs/superpowers/specs/2026-09-14-phase-3-identity-workspace-governance-design.md`
- Canonical plan: `docs/superpowers/plans/2026-09-14-phase-3-identity-workspace-governance.md`
- Cutover runbook: `docs/operations/phase3-workspace-governance-cutover.md`
- Related prior evidence (not re-done here): the Phase 3 authorization
  integration suites (`phase3-authorization`, `phase3-request-authorization`)
  already existed as committed tests and are re-run fresh below as part of the
  full integration suite.

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
| `npm run test:unit` | PASS (exit 0) | 47 files, 369 tests |
| Phase 3 unit subset (6 files, via vitest paths) | PASS (exit 0) | 44 tests (see below) |
| `npm run test:integration` | PASS (exit 0) | 40 files, 413 tests, isolated MariaDB databases |
| Phase 3 integration subset (11 files, within the full run) | PASS | 156 tests (see below) |

Phase 3 unit files (all pass): `phase3-workspace-capabilities` (10),
`phase3-identity-provider` (15), `phase3-workspace-admin-policy` (6),
`phase3-identity-resolver-retry` (4), `phase3-governance-client` (4),
`phase3-import-permission` (5).

Phase 3 integration files (all pass): `phase3-schema` (26),
`phase3-team-governance` (20), `phase3-concurrency` (22),
`phase3-request-authorization` (13), `phase3-bootstrap` (15),
`phase3-identity-resolution` (14), `phase3-authorization` (10),
`phase3-workspace-admin-api` (21), `phase3-personal-workspace` (6),
`phase3-audit` (5), `phase3-mutation-guard` (4).

E2E was deliberately not run: the Playwright build is heavy and no Phase 3
acceptance case strictly requires a browser (unit + integration cover the
service contracts). `tests/e2e/phase3-workspace-governance.spec.ts` exists and
is recorded below as NOT RE-VERIFIED in this run.

One discarded run is recorded honestly: an early attempt invoked `vitest` on
the integration files directly, bypassing `scripts/test/integration.ts`, so the
shared `hcm_km_test_local` database was never provisioned and tests failed with
`ER_BAD_DB_ERROR`. Those numbers were thrown away; every count above comes from
the proper `npm run test:integration` runner (provision → migrate → run →
dispose), re-run fresh after the mistake.

## Acceptance-case coverage (all freshly exercised)

### Workspace lifecycle — create / rename / archive / restore

- `phase3-team-governance` 1–5: create requires platform
  `workspace.create_team` and grants the creator direct OWNER; optional group
  mappings accepted but never OWNER via group; rename requires direct OWNER on
  an ACTIVE team; archive/restore are OWNER-only ACTIVE↔ARCHIVED transitions
  under row lock; archived teams stay readable but block every mutation kind.
- `phase3-team-governance` 6: Personal workspaces stay frozen —
  rename/archive/restore reject with `PersonalWorkspaceFrozenError`.
- `phase3-personal-workspace` 4–5: system freeze passes Team workspaces through;
  provisioning before migration 008 fails with a clear migration error and
  writes nothing.
- `phase3-schema` (Task 5 writer contracts + Task 11 009-gate tests, 26 tests):
  008 additive shape, 009 fail-closed gates (unbootstrapped legacy rows,
  synthetic post-bootstrap NULL rows), final NOT NULL/CHECK/FK constraints,
  and the surviving 008 `UNIQUE(personal_owner_user_id)`.

### Roles / capabilities enforcement

- `phase3-workspace-capabilities` (unit, 10): exact OWNER / ADMIN / EDITOR /
  VIEWER bundles; no assignable DISCOVERER.
- `phase3-authorization`: same-org callers without direct or group grants are
  denied (same-org non-member deny); cross-org callers with a valid grant are
  allowed (cross-org member allow); knowing an ID grants nothing — ungranted
  callers are denied regardless of which workspace/source/document ID they
  present, and untrusted request-supplied grants are refused
  (`phase3-request-authorization`: "denies VIEWER-only, untrusted request
  grants, and archived workspace writes").
- Discover/read split holds: `canDiscover=false → 404`,
  `canDiscover=true && canRead=false → 403`.
- Group grants cap at ADMIN (`phase3-authorization`: "makes group OWNER grants
  impossible and ignores fabricated OWNER rows"); external groups match by
  exact bytes only.
- Effective capabilities are the direct ∪ group union
  (`phase3-authorization`, `phase3-request-authorization`); other-user
  group-effective access is reported as unknown, never fabricated
  (`phase3-authorization`: "reports other-user group-effective access as
  unknown, never fabricated"; `phase3-workspace-admin-api` preserves unknown
  other-user group truth).

### Membership administration

- `phase3-team-governance` (membership half, tests 1–10): OWNER runs the full
  direct grant flow (add/change/remove); ADMIN manages EDITOR/VIEWER only and
  is denied on every OWNER/ADMIN touch; Group→ADMIN requires OWNER; the final
  direct OWNER is never removed or demoted (Team direct OWNER ≥ 1);
  non-managers are never governance authority; ARCHIVED teams reject every
  ordinary governance mutation; audit reads require direct OWNER or ADMIN.
- `phase3-workspace-admin-api` (21): API-level ceilings, last-owner and
  archived-write denial, `employee-id` input rejection, newest-first audit
  visible to admins only, stable audit cursor pagination.
- `phase3-mutation-guard` (4): content-write and source-import denied for
  direct VIEWER, allowed for OWNER/EDITOR, including My Space owner writes
  while governance stays frozen.

### Team / SSO group mapping

- `phase3-team-governance` 2: OWNER runs the full group-mapping flow
  (add/change/remove); ADMIN actor denied on Group→ADMIN before and after.
- `phase3-authorization`: group-only access works with no direct membership;
  removed mappings are revalidated for existing snapshots
  (`phase3-request-authorization`).
- `phase3-mutation-guard`: group mapping exact lookup matches exact bytes
  only; the Hub never materializes user↔group truth (group IDs arrive only as
  validated session claims).

### Audit events

- `phase3-audit` (5): create/rename/archive/restore append their events in the
  same transaction; system recovery audits every action; denied governance
  mutations audit nothing; no audit update/delete path exists.
- `phase3-mutation-guard`: audit events are append-only and listable per
  workspace.

### Trusted identity / SSO resolution

- `phase3-identity-resolution` A–H: existing `(provider, subject)` resolves to
  the same Hub UUID; external subject/emp_id never become `users.id`; missing
  link + existing emp_id fails `IDENTITY_LINK_REQUIRED` with no auto-attach;
  recycled emp_id cannot inherit an already-linked account
  (`IDENTITY_LINK_CONFLICT`); new subject + unused emp_id creates a UUIDv7
  user + link atomically; concurrent (1-way and 16-way) identical first-logins
  converge on one user/link; emp_id drift never silently relinks; explicit
  legacy bootstrap links only with a matching `expected_emp_id`.
- `phase3-request-authorization`: production fails closed when the provider is
  not company-sso, when no company session reader is wired, when migration 009
  is not applied, or when a rollout-scope user lacks a company-provider link.
- `phase3-bootstrap`: explicit governance bootstrap (all-EDITOR / zero-member
  / unknown targets fail closed; every legacy Team ends direct OWNER ≥ 1 with
  nothing guessed) and explicit legacy identity-link bootstrap.
- `phase3-personal-workspace` 1–3, 6: repeated ensure returns the same fixed
  `My Space` with one OWNER/SYSTEM_PERSONAL membership; concurrent ensures
  converge via `uq_workspaces_personal_owner`; rerunnable backfill gives every
  Hub user exactly one verified My Space.

### Concurrency / lock protocol

- `phase3-concurrency` (22): createInitial/createResync/initial-apply/
  resync-apply/upload/finalize/non-import Source mutation/Hub content
  mutation/member/group mutations all serialize against archive wins (no
  post-archive commit); concurrent resync/initial creates commit without
  deadlock; governance-vs-archive races settle without deadlock; explicit
  lock-inversion regression included.

## NOT RE-VERIFIED in this run (with reasons)

- `tests/e2e/phase3-workspace-governance.spec.ts` — browser E2E deliberately
  skipped per task constraints (heavy Playwright build; no Phase 3 acceptance
  case strictly requires it). UI behavior (`/` → My Space, grouped selector,
  Members/SSO Groups/Audit tabs) is therefore verified only at the service
  contract level, not in a browser.
- The populated-production cutover procedure itself (maintenance /
  write-quiescence fence, 008 → bootstrap → backfill → 009 → traffic switch)
  — procedural by nature; there is no populated production database in this
  environment. What *is* verified fresh is every automatable half of it: the
  008/009 staged-migration gates, both bootstrap scripts, the Personal
  backfill, and production readiness fail-closed checks (see above).
- Company SSO provider integration against a real IdP — the concrete company
  login/session integration is still required before production use (cutover
  doc §"Connecting the company session adapter later"). The resolver,
  readiness gates, and group-authorization paths are verified with the
  test-only session reader; no HTTP entry point accepts browser-supplied
  identity/group claims.

## Known limitations

- None new found in this run: full unit (369) and full integration (413)
  suites pass at `af18eef` with zero failures, so no gaps beyond the
  NOT RE-VERIFIED items above.
- This record covers Phase 3 only. Unrelated phases are not re-done here; the
  sibling record
  `docs/superpowers/verification/2026-09-22-phase-2-import-sync-verification.md`
  covers Phase 2 on the same HEAD.
