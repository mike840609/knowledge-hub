# Phase 3 Workspace Governance — Production Cutover Runbook

Spec authority: `docs/superpowers/specs/2026-09-14-phase-3-identity-workspace-governance-design.md`
§15 (legacy bootstrap, staged migration, readiness) and §19 (production
cutover strategy). This runbook describes the **eventual production
procedure** once all Phase 3 implementation tasks are complete. Do not start
the cutover until every implementation prerequisite in §19 is done and tested:
Phase-3-compatible Workspace/membership/Personal/Team writers, Source /
Knowledge / import canonical locking retrofit, Personal backfill tooling
(Task 7), Company SSO provider + durable identity-link resolver + capability
authorization, and Team governance API/UI + system-only recovery.

## Cutover order (spec §19, steps 1–11)

```text
1.  Enter canonical-write quiescence / maintenance mode BEFORE 008.
2.  Apply migration 008 (personal_owner_user_id nullable UNIQUE takes effect).
3.  Backfill existing Workspaces explicitly to TEAM.
4.  Run explicit Team role/owner bootstrap.
5.  Run explicit trusted legacy identity-link bootstrap (runtime never
    claims by emp_id).
6.  Provision/backfill existing users' My Space + OWNER/SYSTEM_PERSONAL
    (Task 7 implementation; concurrent duplicates converge on the 008
    unique constraint).
7.  While writes remain quiesced, apply migration 009 final
    constraints/FKs (Task 11 implementation).
8.  Pass production readiness: 009 applied + company provider configured +
    identity-link rollout complete + Phase-3-compatible writers ready.
9.  Switch traffic / enable trusted Company SSO → identity-link resolver →
    CallerContext + capability-union authorization on the
    Phase-3-compatible deployment.
10. Verify the Phase-3-compatible deployment is the only canonical
    application writer.
11. Exit maintenance / resume canonical writes.
```

Concrete commands (replace `<target>` with the production database target):

```bash
# 1. Maintenance ON first: stop canonical writes to at least users,
#    workspaces, workspace_memberships, and every path that creates or
#    changes Workspace governance state. Read-only traffic may stay.
#    (Procedure is environment-specific; record it in the rollout ticket.)

# 2. Apply 008 (additive/compatibility schema; legacy rows backfill to TEAM).
npm run db:migrate -- --to 8

# 4. Explicit governance bootstrap: every legacy Team ends direct OWNER >= 1.
#    Owners come ONLY from the operator config; nothing is guessed from row
#    order, org_code, name, or member count.
npx tsx scripts/db/bootstrap-phase3-workspace-governance.ts --config /path/to/governance.json

#    governance.json shape:
#    { "owners": { "<workspace-id>": "<existing-hub-user-id>" } }
#    Unknown workspace/user targets, zero-member or all-EDITOR Teams without
#    an entry, and uncovered NULL/invalid role/source rows all fail closed.

# 5. Explicit trusted legacy identity-link bootstrap: the ONLY legacy-link
#    path. expected_emp_id is a safety assertion, never the link key;
#    duplicate/conflicting mappings fail closed; reruns are no-ops.
npx tsx scripts/db/bootstrap-phase3-identity-links.ts --config /path/to/identity-links.json

#    identity-links.json shape:
#    { "links": [{ "provider": "company-sso", "subject": "<opaque-subject>",
#                  "hubUserId": "<existing-hub-user-id>",
#                  "expectedEmpId": "<user-emp-id-safety-assertion>" }] }

# 6. Personal Workspace backfill (Task 7 implementation — NOT part of Task 4):
npx tsx scripts/db/backfill-personal-workspaces.ts --apply

# 7. Final constraints (migration 009: NOT NULL + CHECKs + canonical FKs).
#    009 beforeApply fails closed when governance bootstrap, Personal
#    backfill, or canonical shape is incomplete — no APPLIED ledger row is
#    written, the operator repairs the data (never the checksums) and reruns.
#    009 never auto-repairs rows and never reads operator input.
npm run db:migrate

# 8-11. Readiness → switch traffic → verify single writer → maintenance OFF.
#    Production boot must await verifyProductionReadiness() (server
#    composition) before serving traffic: 009 APPLIED + KM_IDENTITY_PROVIDER
#    = company-sso + wired server-side Company SSO session reader +
#    rollout-scope identity links complete (KM_COMPANY_SSO_ROLLOUT_USER_IDS,
#    comma-separated Hub UUIDs; unset means every existing Hub user).
#    The Phase-3-compatible deployment being the only canonical writer is
#    verified procedurally (no query can prove which deployments hold write
#    credentials) before maintenance is released.
```

## Quiescence contract (spec §15.1)

- Quiescence starts **before 008** and lasts until **009 is complete AND the
  Phase-3-compatible writer deployment is ready**. There is no supported
  rollout where Phase 0–2 writers keep inserting Workspaces/Memberships after
  bootstrap and 009 is applied on top.
- During the window, the **only** allowed canonical writers are: the
  migration runner, the explicit Phase 3 bootstrap scripts
  (`bootstrap-phase3-workspace-governance.ts`,
  `bootstrap-phase3-identity-links.ts`), the Personal backfill
  (`backfill-personal-workspaces.ts`, Task 7), and system recovery tooling.
- `beforeApply` read-only validation is **not** a write fence, and the schema
  migration advisory lock cannot be assumed to be honored by a legacy
  application — neither replaces quiescence. The verification report must
  record the actual maintenance/write-fence procedure, not claim the
  migration lock provided application write fencing.

## Bootstrap gates (spec §15.3)

- Governance bootstrap verifies every Team has direct OWNER >= 1 and every
  membership role/source is valid non-null. Zero-member Teams get an explicit
  existing Hub User OWNER. Personal backfill runs idempotently under the 008
  `UNIQUE(personal_owner_user_id)` constraint.
- Company identity bootstrap links every in-scope existing human Hub user to
  its trusted `(provider, subject)`. Runtime never uses emp_id to claim an
  existing account.
- All bootstrap/backfill steps complete while write quiescence still holds,
  then 009 applies.

## Migration 009 gate (spec §15.4)

`009-phase-3-workspace-governance-finalize` re-validates, read-only, before
any DDL:

- every workspace has a valid non-null type/lifecycle; TEAM rows carry no
  owner; PERSONAL rows carry an existing owner and the `My Space` name;
- every membership has a valid non-null role/source; `SYSTEM_PERSONAL`
  implies `OWNER` inside the member's own PERSONAL workspace;
- every TEAM has direct `OWNER >= 1`;
- every user owns exactly one `My Space` PERSONAL workspace with its
  `OWNER/SYSTEM_PERSONAL` membership (the Personal backfill's output);
- no orphan `created_by`/`archived_by`/owner references that would violate
  the new canonical User FKs.

Final DDL: `workspace_type`/`role`/`membership_source` NOT NULL,
role/source/type/lifecycle/actor CHECKs, PERSONAL-shape coherence CHECKs,
canonical `workspaces → users` FKs (owner/created/archived), and the 008
`UNIQUE(personal_owner_user_id)` preserved untouched. An empty database
passes the gate (fresh installs migrate straight to 009).

## Rollback / failure handling

- Every bootstrap script runs in a single all-or-nothing transaction and is
  safe to rerun with the same config (identical identity links are no-ops;
  satisfied governance entries are no-ops).
- If any step refuses (fails closed), resolve the reported config/data issue
  and rerun that step. Do not proceed to 009 with unresolved refusals: the
  009 gate will refuse, and a synthetic legacy row with NULL Phase 3 fields
  written after bootstrap must make readiness fail rather than silently
  finalize.
- DDL failures keep the FAILED/RUNNING ledger diagnostics: repair the schema
  explicitly and clear only the affected ledger row — never edit checksums.
