# Phase 3 Identity, Workspace Administration & Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Phase 0–2 binary WorkspaceMembership foundation into production Workspace governance with My Space, fixed RBAC, trusted Company SSO claims, durable external identity linking to Hub-owned UUID users, lifecycle-safe mutation serialization, direct + group grants, auditable governance, and Phase 2.5 administration UI without changing canonical Knowledge identity.

**Architecture:** Keep `Workspace → KnowledgeSource → Tree/Document/Revision` as the only Knowledge path. Company SSO yields trusted external claims. A durable `(provider, subject) → hub_user_id` identity link resolves those claims to a Hub-owned UUIDv7 user before CallerContext exists. Legacy Hub users are explicitly linked during rollout; production runtime never uses `emp_id` to claim an existing account. Workspace authorization is the union of direct + validated group grants. Database rollout is staged as `008 additive → explicit bootstrap/backfill → 009 final constraints`, under a populated-production canonical-write quiescence window. Import creation before a Snapshot exists uses `Workspace` or `Source → Workspace`; once a Snapshot exists, import mutation uses `ImportSnapshot → [Source] → Workspace`.

**Tech Stack:** Next.js 15.5, React 19, TypeScript 5.7, MariaDB 10.11 native `UUID`, Vitest, Playwright, existing modular-monolith application/ports/infrastructure layout.

**Spec:** `docs/superpowers/specs/2026-09-14-phase-3-identity-workspace-governance-design.md`

## Global Constraints

- Personal Space is `Workspace(type=PERSONAL)`, canonical name exactly `My Space`, no user rename/member/group/transfer/archive/delete.
- Assignable roles are exactly `OWNER | ADMIN | EDITOR | VIEWER`; no assignable `DISCOVERER`.
- Team Workspace must always retain at least one **direct** OWNER.
- SSO Group mappings may grant only `ADMIN | EDITOR | VIEWER`; never OWNER.
- Effective capabilities are union of direct + all matched validated group grants; no explicit deny.
- Full group-derived effective access is only computable for the current trusted caller in Phase 3.
- Workspace is the only Phase 3 Knowledge authorization boundary; no Source/Document ACL columns.
- Archived Team remains readable but blocks ordinary content/governance mutations; only OWNER restores through product APIs.
- Canonical Hub user IDs are Hub-owned UUIDv7 values; external subject/employee IDs never become `users.id`.
- Durable account identity is `(provider, subject) → hub_user_id`; `emp_id` is not long-term account-link truth.
- Existing Hub users are linked through explicit trusted bootstrap; runtime does not auto-attach an unlinked existing account by emp_id.
- Production identity must not silently fall back to Local identity.
- Migration 008 must create nullable `personal_owner_user_id` **with `UNIQUE(personal_owner_user_id)` immediately**, before Personal provisioning/backfill is allowed.
- Populated production rollout requires canonical-write quiescence from before 008 until 009 completes and a Phase-3-compatible writer is ready.
- Only migration/bootstrap/backfill scripts may perform controlled writes during the quiesced cutover window.
- Existing Snapshot mutation lock order is `ImportSnapshot → [bound Source] → Workspace → deeper resource`; never `Workspace → ImportSnapshot`.
- Pre-Snapshot initial import creation is `Workspace → insert Snapshot`; pre-Snapshot resync creation is `Source → Workspace → insert Snapshot` in one transaction.
- Non-import existing Source mutation remains `Source → Workspace → deeper resource`.
- Governance/new-source paths lock Workspace and must not later acquire unrelated Source/Snapshot locks.
- Governance mutation and audit append commit/rollback atomically.
- Existing Workspace/Source/Document/Revision stable IDs and `/w/:workspaceId/...` routes remain canonical.

---

## File Structure Map

```text
src/modules/identity/domain/
  external-company-identity.ts
  trusted-identity-claims.ts
  authenticated-principal.ts
  caller-context.ts
src/modules/identity/application/
  hub-identity-resolver.ts
src/modules/identity/ports/
  identity-provider.ts
  company-sso-session-reader.ts
  user-repository.ts
  external-identity-link-repository.ts
src/infrastructure/identity/
  local-identity-provider.ts
  company-sso-identity-provider.ts
src/infrastructure/database/mariadb/repositories/
  users.ts
  external-identity-links.ts

src/modules/workspaces/domain/
  workspace.ts
  workspace-membership.ts
  workspace-capability.ts
  workspace-group-mapping.ts
  workspace-audit-event.ts
  errors.ts
src/modules/workspaces/application/
  workspace-authorization.ts
  workspace-query-service.ts
  personal-workspace-service.ts
  team-workspace-service.ts
  workspace-membership-service.ts
  workspace-recovery-service.ts
  platform-access-policy.ts
  workspace-readiness.ts
src/modules/workspaces/ports/
  workspace-repository.ts
  workspace-membership-repository.ts
  workspace-group-mapping-repository.ts
  workspace-audit-repository.ts
  workspace-access-policy.ts
  unit-of-work.ts

src/infrastructure/database/mariadb/migrations/
  008-phase-3-workspace-governance-additive.ts
  009-phase-3-workspace-governance-finalize.ts
  index.ts
src/infrastructure/database/mariadb/
  repositories/workspaces.ts
  repositories/workspace-memberships.ts
  repositories/workspace-group-mappings.ts
  repositories/workspace-audit-events.ts
  repositories/index.ts
  transaction.ts

scripts/db/bootstrap-phase3-workspace-governance.ts
scripts/db/bootstrap-phase3-identity-links.ts
scripts/db/backfill-personal-workspaces.ts
scripts/admin/recover-team-workspace-governance.ts

src/server/
  identity-provider-factory.ts
  trusted-caller.ts
  workspace-admin.ts
  composition.ts
  config.ts
src/app/api/workspaces/...
src/app/page.tsx
src/components/shell/workspace-selector.tsx
src/app/w/[workspaceId]/settings/page.tsx
src/components/workspaces/...

docs/operations/
  phase3-workspace-governance-cutover.md

tests/unit/phase3-workspace-capabilities.test.ts
tests/unit/phase3-identity-provider.test.ts
tests/unit/phase3-workspace-admin-policy.test.ts
tests/integration/phase3-schema.test.ts
tests/integration/phase3-identity-resolution.test.ts
tests/integration/phase3-bootstrap.test.ts
tests/integration/phase3-authorization.test.ts
tests/integration/phase3-personal-workspace.test.ts
tests/integration/phase3-team-governance.test.ts
tests/integration/phase3-concurrency.test.ts
tests/integration/phase3-audit.test.ts
tests/e2e/phase3-workspace-governance.spec.ts
```

---

### Task 1: Add migration 008 additive schema and governance domain types

**Files:**
- Create: `src/infrastructure/database/mariadb/migrations/008-phase-3-workspace-governance-additive.ts`
- Modify: `src/infrastructure/database/mariadb/migrations/index.ts`
- Modify: `src/modules/workspaces/domain/workspace.ts`
- Modify: `src/modules/workspaces/domain/workspace-membership.ts`
- Create: `src/modules/workspaces/domain/workspace-group-mapping.ts`
- Create: `src/modules/workspaces/domain/workspace-audit-event.ts`
- Create: `src/modules/identity/domain/external-company-identity.ts`
- Create: `src/modules/identity/ports/external-identity-link-repository.ts`
- Create: `tests/integration/phase3-schema.test.ts`

- [ ] **Step 1: Write failing additive-schema tests**

Cover:

```text
- existing Workspace IDs survive migration 008
- existing Workspaces become TEAM candidates
- role/membership_source may remain nullable until bootstrap
- personal_owner_user_id is nullable but UNIQUE already in 008
- two rows with the same non-null personal_owner_user_id are rejected
- multiple TEAM rows with personal_owner_user_id = NULL are allowed
- external_identity_links protects exact (provider, subject_bytes)
- same provider cannot silently bind two subjects to one Hub user
- group mapping cannot grant OWNER
- orphan rows on new tables are rejected where 008 can safely add FKs
```

- [ ] **Step 2: Run integration tests and confirm red state**

```bash
npm run test:integration
```

- [ ] **Step 3: Implement migration 008**

Add Workspace type/lifecycle columns and membership role/source columns with compatibility nullability. Backfill existing Workspaces explicitly to TEAM.

The Workspace DDL must include early Personal uniqueness, for example:

```sql
ALTER TABLE workspaces
  ADD COLUMN workspace_type VARCHAR(16) NULL,
  ADD COLUMN personal_owner_user_id UUID NULL,
  ADD COLUMN lifecycle_state VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN created_by UUID NULL,
  ADD COLUMN archived_by UUID NULL,
  ADD COLUMN archived_at DATETIME(6) NULL,
  ADD CONSTRAINT uq_workspaces_personal_owner UNIQUE (personal_owner_user_id);
```

MariaDB nullable UNIQUE is intentional: all legacy Team rows remain `NULL`, while concurrent Personal provisioning/backfill cannot create two Workspaces for one owner.

Create `external_identity_links`:

```sql
CREATE TABLE external_identity_links (
  id UUID NOT NULL,
  provider VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  subject_bytes VARBINARY(1020) NOT NULL,
  hub_user_id UUID NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  last_seen_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  CONSTRAINT uq_identity_provider_subject UNIQUE (provider, subject_bytes),
  CONSTRAINT uq_identity_provider_user UNIQUE (provider, hub_user_id),
  CONSTRAINT fk_identity_link_user FOREIGN KEY (hub_user_id) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;
```

Create group mappings and audit events. Add safe FKs on new tables immediately; migration 009 finalizes remaining canonical constraints on altered legacy tables.

External subjects/group IDs use exact UTF-8 bytes; never trim/case-fold/Unicode-normalize.

- [ ] **Step 4: Add domain types**

```ts
export type WorkspaceType = "PERSONAL" | "TEAM";
export type WorkspaceLifecycleState = "ACTIVE" | "ARCHIVED";
export type WorkspaceRole = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
export type WorkspaceMembershipSource = "DIRECT" | "SYSTEM_PERSONAL";
```

- [ ] **Step 5: Verify and commit**

```bash
npm run test:integration
npm run typecheck
git add src/infrastructure/database/mariadb/migrations src/modules/workspaces/domain src/modules/identity tests/integration/phase3-schema.test.ts
git commit -m "feat: add phase 3 additive governance schema"
```

---

### Task 2: Add fixed capability bundles and trusted identity claim types

**Files:**
- Create: `src/modules/identity/domain/trusted-identity-claims.ts`
- Create: `src/modules/identity/domain/authenticated-principal.ts`
- Modify: `src/modules/identity/domain/caller-context.ts`
- Create: `src/modules/workspaces/domain/workspace-capability.ts`
- Create: `tests/unit/phase3-workspace-capabilities.test.ts`

- [ ] **Step 1: Write failing capability tests**

Verify OWNER vs ADMIN authority and exact fixed role bundles.

- [ ] **Step 2: Define external claims vs resolved principal**

```ts
export type ExternalCompanyIdentity = {
  provider: string;
  subject: string;
  emp_id: string;
  name: string;
  org_code: string;
};

export type TrustedIdentityClaims = {
  externalIdentity: ExternalCompanyIdentity;
  validatedExternalGroupIds: readonly string[];
  platformCapabilities: readonly PlatformCapability[];
  refreshedAt: Date;
};

export type AuthenticatedPrincipal = {
  identity: UserIdentity;
  validatedExternalGroupIds: readonly string[];
  platformCapabilities: readonly PlatformCapability[];
  refreshedAt: Date;
};
```

`callerFromPrincipal()` must never accept browser-supplied identity/groups/platform capabilities.

- [ ] **Step 3: Implement role capability constants; no custom-role DB tables**

- [ ] **Step 4: Verify and commit**

```bash
npm run test:unit -- tests/unit/phase3-workspace-capabilities.test.ts
npm run typecheck
git add src/modules/identity src/modules/workspaces/domain tests/unit/phase3-workspace-capabilities.test.ts
git commit -m "feat: add trusted identity types and workspace capabilities"
```

---

### Task 3: Implement Company SSO claims and durable runtime identity resolution

**Files:**
- Modify: `src/modules/identity/ports/identity-provider.ts`
- Create: `src/modules/identity/ports/company-sso-session-reader.ts`
- Modify: `src/modules/identity/ports/user-repository.ts`
- Create: `src/modules/identity/application/hub-identity-resolver.ts`
- Create/Modify: `src/infrastructure/database/mariadb/repositories/external-identity-links.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/users.ts`
- Modify: `src/infrastructure/identity/local-identity-provider.ts`
- Create: `src/infrastructure/identity/company-sso-identity-provider.ts`
- Create: `src/server/identity-provider-factory.ts`
- Modify: `src/server/config.ts`
- Modify: `src/server/composition.ts`
- Create: `tests/unit/phase3-identity-provider.test.ts`
- Create: `tests/integration/phase3-identity-resolution.test.ts`

**Interfaces:**
- `IdentityProvider.getCurrentClaims(): Promise<TrustedIdentityClaims>`.
- `HubIdentityResolver.resolve(externalIdentity): Promise<UserIdentity>`.

- [ ] **Step 1: Write provider tests**

Verify trusted provider+subject/profile/groups, server-side platform capability mapping, refresh semantics, and production fail-closed behavior.

- [ ] **Step 2: Write runtime resolver tests**

Must prove:

```text
A. existing (provider, subject) link -> same Hub UUID
B. external subject / emp_id never becomes users.id
C. missing link + existing emp_id -> IDENTITY_LINK_REQUIRED; no auto-attach
D. different subject + emp_id owned by already-linked user -> IDENTITY_LINK_CONFLICT
E. missing link + unused emp_id -> new UUIDv7 user + link atomically
F. concurrent identical first-login converges to one new user/link
G. subject whose trusted emp_id later differs does not silently relink another account
```

- [ ] **Step 3: Implement runtime resolver**

Runtime order:

```text
(provider,subject) link exists
  → load Hub user
  → verify identity consistency
  → update allowed profile fields only

link missing + emp_id already exists
  → IDENTITY_LINK_REQUIRED / IDENTITY_LINK_CONFLICT
  → never claim existing user by emp_id

link missing + unused emp_id
  → create UUIDv7 Hub user + durable link atomically
```

- [ ] **Step 4: Implement Local/Company providers and production factory**

Browser input never supplies identity/group/platform capability truth. Local identity disabled in production.

- [ ] **Step 5: Verify and commit**

```bash
npm run test:unit -- tests/unit/phase3-identity-provider.test.ts
npm run test:integration -- --run tests/integration/phase3-identity-resolution.test.ts
npm run typecheck
npm run build
git add src/modules/identity src/infrastructure/identity src/infrastructure/database/mariadb/repositories src/server tests/unit/phase3-identity-provider.test.ts tests/integration/phase3-identity-resolution.test.ts
git commit -m "feat: resolve linked company identities to hub users"
```

---

### Task 4: Bootstrap legacy governance + identity links, enforce cutover quiescence, then finalize migration 009

**Files:**
- Create: `scripts/db/bootstrap-phase3-workspace-governance.ts`
- Create: `scripts/db/bootstrap-phase3-identity-links.ts`
- Create: `src/modules/workspaces/application/workspace-readiness.ts`
- Create: `src/infrastructure/database/mariadb/migrations/009-phase-3-workspace-governance-finalize.ts`
- Modify: `src/infrastructure/database/mariadb/migrations/index.ts`
- Modify: `scripts/db/migrate.ts` runbook/help
- Modify: `src/server/config.ts`
- Modify: `src/server/composition.ts`
- Create: `docs/operations/phase3-workspace-governance-cutover.md`
- Create: `tests/integration/phase3-bootstrap.test.ts`
- Extend: `tests/integration/phase3-schema.test.ts`
- Extend: `tests/integration/phase3-identity-resolution.test.ts`

- [ ] **Step 1: Write governance bootstrap tests**

Cover all-EDITOR Team, zero-member Team, unknown owner target, NULL role/source, and successful explicit owner bootstrap.

- [ ] **Step 2: Implement explicit governance bootstrap**

Every Team ends with direct OWNER >= 1. No heuristic elevation.

- [ ] **Step 3: Write and implement legacy identity-link bootstrap**

Input:

```ts
export type LegacyIdentityLinkBootstrapEntry = {
  provider: string;
  subject: string;
  hubUserId: string;
  expectedEmpId: string;
};
```

Prove target user exists, expected emp_id matches as safety assertion, duplicate link conflicts fail closed, runtime resolves immediately after bootstrap, and runtime cannot claim an unlinked legacy user by emp_id.

- [ ] **Step 4: Define populated-production cutover runbook before implementing 009**

`docs/operations/phase3-workspace-governance-cutover.md` must state:

```text
1. Enter maintenance / stop canonical application writes BEFORE migration 008.
2. Apply migration 008.
3. Keep old application writers stopped.
4. Run governance bootstrap.
5. Run trusted legacy identity-link bootstrap.
6. Run Personal Workspace backfill.
7. Apply migration 009 while writes remain quiesced.
8. Verify 009 APPLIED + Company SSO/identity-link readiness + Phase-3-compatible application writer ready.
9. Cut traffic/write capability to Phase-3-compatible deployment.
10. Resume canonical writes.
```

During the cutover window only migration/bootstrap/backfill scripts may write canonical governance state. `beforeApply` and the migration advisory lock are **not** application write fences.

- [ ] **Step 5: Update `scripts/db/migrate.ts` help/runbook**

Mirror the existing Phase 1 safety language: populated Phase 3 upgrade requires canonical-write quiescence through finalization. Do not document an online mixed-version upgrade.

- [ ] **Step 6: Add migration 009 readiness/race-defense tests**

```bash
npm run db:migrate -- --to 8
```

Required tests:

```text
A. 009 before bootstrap -> fails with no APPLIED ledger row
B. bootstrap complete -> 009 can apply
C. after bootstrap, inject a synthetic legacy Workspace/Membership row with NULL Phase-3 governance fields -> 009 fails closed
D. remove/repair the synthetic row -> 009 applies
```

Test C does not replace operational quiescence; it proves readiness catches stale legacy state rather than silently finalizing it.

- [ ] **Step 7: Implement migration 009**

`beforeApply` is read-only and checks:

```text
- every TEAM has direct OWNER >= 1
- no membership has NULL/invalid role
- no membership has NULL/invalid membership_source
- no invalid Workspace type/lifecycle combinations
- Personal rows satisfy canonical shape required before final DDL
```

DDL finalizes:

```text
- workspaces.workspace_type NOT NULL
- workspace_memberships.role NOT NULL
- workspace_memberships.membership_source NOT NULL
- final role/source/type/lifecycle/actor CHECKs
- canonical FKs for Workspace/User relationships
- verify existing 008 unique personal_owner_user_id remains present
```

- [ ] **Step 8: Add production application readiness**

Production Phase 3 requires:

```text
- migration 009 APPLIED
- company provider/session configured
- all configured legacy human users in rollout scope have expected company-provider identity links
- Phase-3-compatible writer is active before maintenance mode is released
```

- [ ] **Step 9: Verify staged rollout and commit**

```bash
npm run db:migrate -- --to 8
npx tsx scripts/db/bootstrap-phase3-workspace-governance.ts --config /path/to/governance.json
npx tsx scripts/db/bootstrap-phase3-identity-links.ts --config /path/to/identity-links.json
npx tsx scripts/db/backfill-personal-workspaces.ts
npm run db:migrate -- --to 9
npm run test:integration
npm run typecheck
git add scripts/db src/infrastructure/database/mariadb/migrations src/modules/workspaces/application/workspace-readiness.ts src/server docs/operations tests/integration
git commit -m "feat: bootstrap and finalize phase 3 governance safely"
```

---

### Task 5: Extend repositories, UnitOfWork, and Workspace row locking

**Files:**
- Modify/create Workspace membership/group/audit repositories and ports
- Modify `src/infrastructure/database/mariadb/repositories/index.ts`
- Modify `src/infrastructure/database/mariadb/transaction.ts`

- [ ] **Step 1: Add two-connection Workspace lock tests**
- [ ] **Step 2: Implement `WorkspaceRepository.lockById(... FOR UPDATE)`**
- [ ] **Step 3: Add direct-owner count, exact group lookup, audit append primitives**
- [ ] **Step 4: Ensure governance service + audit share one UoW transaction**
- [ ] **Step 5: Verify and commit**

```bash
npm run test:integration
npm run typecheck
git add src/modules/workspaces/ports src/infrastructure/database/mariadb
git commit -m "feat: add workspace governance persistence and locking"
```

---

### Task 6: Replace binary membership policy with capability evaluation

**Files:**
- Create: `src/modules/workspaces/application/workspace-authorization.ts`
- Modify Workspace access policy/query service
- Create: `tests/integration/phase3-authorization.test.ts`

- [ ] **Step 1: Test direct+group union, group-only access, no Group OWNER, exact group matching, same-org no-grant denial, cross-org valid grant**
- [ ] **Step 2: Implement evaluator using only current caller's validated external groups**
- [ ] **Step 3: Preserve 404 discover / 403 read semantics**
- [ ] **Step 4: Verify and commit**

```bash
npm run test:integration
npm run typecheck
git add src/modules/workspaces tests/integration/phase3-authorization.test.ts
git commit -m "feat: evaluate workspace capabilities from direct and group grants"
```

---

### Task 7: Implement trusted caller bootstrap, My Space provisioning, and system freeze

**Files:**
- Create: `src/modules/workspaces/application/personal-workspace-service.ts`
- Create: `src/server/trusted-caller.ts`
- Modify Human Web/API caller establishment and composition
- Create: `scripts/db/backfill-personal-workspaces.ts`
- Modify: `package.json`
- Create: `tests/integration/phase3-personal-workspace.test.ts`

**Shared request bootstrap:**

```text
IdentityProvider.getCurrentClaims()
→ HubIdentityResolver.resolve(provider + subject)
→ ensurePersonalWorkspace(hubIdentity.id)
→ AuthenticatedPrincipal
→ CallerContext
```

- [ ] **Step 1: Test repeated and concurrent provisioning**

Must prove:

```text
- fixed name My Space
- exactly one PERSONAL row per owner
- exactly one OWNER/SYSTEM_PERSONAL membership
- deep-link/API bootstrap uses same path
- existing-user backfill is rerunnable
```

- [ ] **Step 2: Test 008 unique owner race handling**

Two concurrent `ensurePersonalWorkspace(userId)` transactions may both observe missing state, but only one insert may win `uq_workspaces_personal_owner`. The loser must re-read and return the winning Workspace; no orphan second Workspace or duplicate system membership may remain.

- [ ] **Step 3: Ensure missing legacy identity link fails before Personal provisioning**

Runtime never creates My Space under the wrong legacy Hub UUID by emp_id matching.

- [ ] **Step 4: Implement Personal provisioning transaction and system freeze**

Provisioning depends on migration 008 or later. Do not provide a code path that can create Personal Workspaces before `uq_workspaces_personal_owner` exists.

- [ ] **Step 5: Wire one shared server helper; no route accepts caller identity/groups/capabilities**

- [ ] **Step 6: Verify and commit**

```bash
npm run test:integration
npm run typecheck
git add src/modules/workspaces src/server scripts/db/backfill-personal-workspaces.ts package.json tests/integration/phase3-personal-workspace.test.ts
git commit -m "feat: bootstrap trusted callers and personal workspaces"
```

---

### Task 8: Implement Team create/rename/archive/restore and system recovery

**Files:** Team lifecycle/recovery services, operator recovery script, integration tests.

- [ ] **Step 1: Test create capability, creator direct OWNER, OWNER/ADMIN lifecycle boundaries, archived read**
- [ ] **Step 2: Implement lifecycle mutations with Workspace row lock and post-lock re-authorization**
- [ ] **Step 3: Implement system-only audited recovery; no normal HTTP exposure**
- [ ] **Step 4: Verify and commit**

```bash
npm run test:integration
npm run typecheck
git add src/modules/workspaces scripts/admin tests/integration/phase3-team-governance.test.ts
git commit -m "feat: add team workspace lifecycle and recovery"
```

---

### Task 9: Implement direct membership and SSO group governance

**Files:** membership service, unit admin-policy tests, team-governance integration tests.

- [ ] **Step 1: Test OWNER vs ADMIN grant ceilings**
- [ ] **Step 2: Workspace lock → actor evaluate → ACTIVE TEAM → persisted beforeRole + requested afterRole checks → owner invariant → mutation + audit**
- [ ] **Step 3: Reject ordinary governance mutation when ARCHIVED**
- [ ] **Step 4: Verify and commit**

```bash
npm run test:unit -- tests/unit/phase3-workspace-admin-policy.test.ts
npm run test:integration
git add src/modules/workspaces tests/unit/phase3-workspace-admin-policy.test.ts tests/integration/phase3-team-governance.test.ts
git commit -m "feat: govern workspace members and group mappings"
```

---

### Task 10: Retrofit canonical lock hierarchy into all Knowledge/Source/import write paths

**Files:**
- Modify: `create-folder-import.ts`, `upload-folder-import-entries.ts`, `finalize-folder-import.ts`, `apply-folder-import.ts`
- Modify current Source/Knowledge mutation services
- Create: `tests/integration/phase3-concurrency.test.ts`

**Canonical lock order:**

```text
Pre-Snapshot createInitial:
  quota/advisory (if used) → Workspace → insert Snapshot + entries

Pre-Snapshot createResync:
  quota/advisory (if used) → Source → Workspace → capture sync_version → insert Snapshot + entries (same tx)

Existing Snapshot initial apply:
  Snapshot → Workspace → create Source → deeper

Existing Snapshot resync/apply:
  Snapshot → Source → Workspace → deeper

Upload/finalize:
  Snapshot → Workspace → staging

Non-import existing Source:
  Source → Workspace → deeper

Non-import new Source:
  Workspace → create Source
```

Forbidden: Workspace→Snapshot, Workspace→existing Source, or quota/advisory lock acquired after DB row locks.

- [ ] **Step 1: Two-connection tests for createInitial vs archive**

Archive wins → no Snapshot commit. createInitial wins → archive waits and commits after snapshot transaction.

- [ ] **Step 2: Two-connection tests for createResync vs archive**

Source binding/version and snapshot insertion are one transaction under Source→Workspace. Prove old split transaction is removed.

- [ ] **Step 3: Existing Snapshot race/deadlock tests**

Initial apply, resync apply, upload/finalize, non-import Source mutation, membership vs archive; explicit inversion-deadlock regression.

- [ ] **Step 4: Retrofit createInitial and createResync**

`createResync` must not call a first UoW merely to read Source/basedOnVersion then a second UoW to insert the snapshot.

- [ ] **Step 5: Retrofit existing Snapshot and non-import mutation paths**

- [ ] **Step 6: Verify and commit**

```bash
npm run test:integration
npm run typecheck
git add src/modules src/infrastructure/database tests/integration/phase3-concurrency.test.ts
git commit -m "fix: serialize all workspace import and content mutations"
```

---

### Task 11: Add server/admin API contracts and truthful effective-access views

**Files:** server workspace admin, API routes, composition, authorization integration tests.

```ts
export type UserAccessInspection = {
  userId: string;
  directRole: WorkspaceRole | null;
  groupAccess: "EVALUATED" | "UNKNOWN_NOT_EVALUATED";
  matchedGroups?: readonly { externalGroupId: string; role: WorkspaceRole }[];
  effectiveCapabilities?: readonly WorkspaceCapability[];
};
```

- [ ] **Step 1: Test current caller vs other-user inspection**
- [ ] **Step 2: Reuse shared trusted-caller helper; no browser identity/group/capability truth**
- [ ] **Step 3: Team create/rename/archive/restore, member/group CRUD, audit read routes; no recovery HTTP route**
- [ ] **Step 4: Verify and commit**

```bash
npm run test:integration
npm run typecheck
npm run build
git add src/server src/app/api tests/integration/phase3-authorization.test.ts
git commit -m "feat: expose workspace governance server contracts"
```

---

### Task 12: Make My Space default and add grouped Workspace/admin UI

**Files:** root page, Workspace selector, Team settings/admin components, E2E test.

- [ ] **Step 1: E2E `/` → My Space; grouped selector; Personal hides governance; Team obeys OWNER/ADMIN**
- [ ] **Step 2: Update root resolution and selector**
- [ ] **Step 3: Separate Members / SSO Groups / Audit; other user shows `Group access not evaluated`**
- [ ] **Step 4: Verify and commit**

```bash
npm run test:e2e
npm run build
git add src/app src/components tests/e2e/phase3-workspace-governance.spec.ts
git commit -m "feat: add personal-first workspace governance ui"
```

---

### Task 13: Run full acceptance, security regression, and rollout verification

**Files:**
- Create: `docs/superpowers/verification/2026-09-14-phase-3-workspace-governance-verification.md`
- Verify: `docs/operations/phase3-workspace-governance-cutover.md`

- [ ] **Step 1: Static/unit**

```bash
npm run lint
npm run typecheck
npm run test:unit
```

- [ ] **Step 2: Integration**

```bash
npm run test:integration
```

Must include identity-link runtime/bootstrap, 008/009 staged migration, Personal uniqueness, authorization, audit, and pre-/post-Snapshot concurrency suites.

- [ ] **Step 3: E2E/build**

```bash
npm run test:e2e
npm run build
```

- [ ] **Step 4: Record explicit security/schema evidence**

```text
- production cannot silently use Local identity
- users.id is always Hub UUIDv7
- (provider,subject) is durable account-link truth
- runtime missing link + existing emp_id fails; no legacy auto-attach
- legacy identity links are explicit trusted bootstrap inputs
- recycled emp_id cannot inherit existing Hub account
- 008 creates nullable UNIQUE(personal_owner_user_id)
- concurrent Personal provisioning converges to one My Space
- 008 stages legacy DB; 009 refuses before governance bootstrap
- synthetic post-bootstrap legacy NULL governance row makes 009 fail closed
- after 009 final role/source/type constraints and canonical FKs are active
- every Team direct OWNER >= 1
- group cannot grant OWNER
- ADMIN cannot modify OWNER/ADMIN authority
- other-user group access is never fabricated
- createInitial/createResync cannot commit after archive wins
- createResync binding/version capture + Snapshot insert are one transaction
- existing import order Snapshot → [Source] → Workspace
- no Workspace → Snapshot / Workspace → existing Source inversion
- archived ordinary writes/governance fail
- system recovery is HTTP-inaccessible and audited
- existing Source/Document IDs survive; no Source/Document ACL columns
```

- [ ] **Step 5: Verify populated-production cutover contract**

The verification report must explicitly record:

```text
- maintenance/write-quiescence begins before 008
- no legacy application canonical writer remains active during bootstrap/backfill/009
- only controlled migration/bootstrap/backfill scripts write during the window
- migration beforeApply/advisory lock is not treated as application write fencing
- 009 is APPLIED before Phase-3-compatible writer activation
- maintenance mode is released only after Phase-3-compatible writer/readiness passes
```

If the deployment cannot guarantee this fence, Phase 3 production cutover is **not verified**; do not claim rollout readiness.

- [ ] **Step 6: Write verification report and commit**

```bash
git add docs/superpowers/verification docs/operations
git commit -m "docs: verify phase 3 workspace governance"
```

---

## Self-review coverage matrix

| Spec requirement | Implementation task |
| --- | --- |
| Personal/Team one Workspace model | 1, 7, 12 |
| Fixed My Space + default entry | 7, 12 |
| 008 nullable unique Personal owner invariant | 1, 7, 13 |
| Fixed roles/capabilities | 2, 6 |
| Trusted external groups/platform capability | 2, 3, 6 |
| Durable `(provider,subject)` → Hub UUID runtime identity | 1, 3, 7 |
| Explicit legacy identity-link bootstrap | 4 |
| Explicit legacy Team owner bootstrap | 4 |
| Populated-production write-quiesced 008→bootstrap→009 cutover | 4, 13 |
| Migration 009 final NOT NULL/CHECK/FK constraints | 4 |
| Direct + group capability union | 6 |
| OWNER/ADMIN governance | 8, 9 |
| Team direct OWNER >= 1 | 4, 9 |
| Workspace-only ACL | 6, 10 |
| Archive/read-only semantics | 8, 9, 10 |
| Pre-Snapshot import creation locking | 10 |
| Snapshot/Source/Workspace lock hierarchy | 5, 10 |
| Archive/write concurrency serialization | 5, 10 |
| System-only stranded governance recovery | 8 |
| Atomic audit | 5, 7, 8, 9 |
| Truthful effective-access inspection | 11, 12 |
| Grouped selector / admin UI | 12 |
| Full acceptance / rollout evidence | 13 |

Plan complete. Execution should start only after this documentation PR is merged.