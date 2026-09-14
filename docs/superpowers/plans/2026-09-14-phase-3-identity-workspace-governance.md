# Phase 3 Identity, Workspace Administration & Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Phase 0–2 binary WorkspaceMembership foundation into production Workspace governance with My Space, fixed RBAC, trusted Company SSO claims, durable external identity linking to Hub-owned UUID users, lifecycle-safe mutation serialization, direct + group grants, auditable governance, and Phase 2.5 administration UI without changing canonical Knowledge identity.

**Architecture:** Keep `Workspace → KnowledgeSource → Tree/Document/Revision` as the only Knowledge path. Company SSO yields trusted external claims. A durable `(provider, subject) → hub_user_id` identity link resolves those claims to a Hub-owned UUIDv7 user before CallerContext exists. Workspace authorization is the union of direct + validated group grants. Database rollout is staged as migration 008 additive schema → explicit bootstrap → migration 009 final constraints/readiness. Every Workspace-scoped mutation participates in Workspace row serialization. Import creation before a Snapshot exists uses `Workspace` or `Source → Workspace`; once a Snapshot exists, import mutation uses `ImportSnapshot → [Source] → Workspace`.

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
- Production identity must not silently fall back to Local identity.
- Rollout order is `008 additive → bootstrap/readiness → 009 final constraints`.
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

**Interfaces:**
- Produces `WorkspaceType`, `WorkspaceLifecycleState`, `WorkspaceRole`, `WorkspaceMembershipSource`, `WorkspaceGroupMapping`, `WorkspaceAuditEvent`, and the durable external identity link schema.

- [ ] **Step 1: Write failing additive-schema tests**

Cover:

```text
- existing Workspace IDs survive migration 008 and become TEAM candidates
- role/membership_source may remain nullable until bootstrap
- external_identity_links exists and uniquely protects (provider, subject_bytes)
- same provider cannot bind two subjects to the same Hub user silently
- group mapping cannot grant OWNER
- opaque group and identity subject bytes preserve case/accents/trailing spaces
- new-table Workspace/User FK relationships reject orphan rows where safe to enforce in 008
```

- [ ] **Step 2: Run integration tests and confirm red state**

```bash
npm run test:integration
```

- [ ] **Step 3: Implement migration 008 as additive/compatible**

Required shape:

```sql
ALTER TABLE workspaces
  ADD COLUMN workspace_type VARCHAR(16) NULL,
  ADD COLUMN personal_owner_user_id UUID NULL,
  ADD COLUMN lifecycle_state VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN created_by UUID NULL,
  ADD COLUMN archived_by UUID NULL,
  ADD COLUMN archived_at DATETIME(6) NULL;

UPDATE workspaces SET workspace_type='TEAM' WHERE workspace_type IS NULL;

ALTER TABLE workspace_memberships
  ADD COLUMN role VARCHAR(16) NULL,
  ADD COLUMN membership_source VARCHAR(24) NULL,
  ADD COLUMN created_by UUID NULL,
  ADD COLUMN updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);
```

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

Create `workspace_group_mappings` and `workspace_audit_events`. For these new tables, add safe FKs immediately when referenced rows already exist. Final verification of all canonical FKs still belongs to migration 009.

External group IDs and external identity subjects are opaque exact-byte identifiers. Validate non-empty valid Unicode and byte limits before storage; encode UTF-8 bytes; never trim/case-fold/normalize.

- [ ] **Step 4: Add domain types**

```ts
export type WorkspaceType = "PERSONAL" | "TEAM";
export type WorkspaceLifecycleState = "ACTIVE" | "ARCHIVED";
export type WorkspaceRole = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
export type WorkspaceMembershipSource = "DIRECT" | "SYSTEM_PERSONAL";
```

- [ ] **Step 5: Register migration 008 and verify**

```bash
npm run test:integration
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
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

**Interfaces:**
- Produces `TrustedIdentityClaims`, `AuthenticatedPrincipal`, `CallerContext`, `PlatformCapability`, `WorkspaceCapability`, `capabilitiesForRole()`.

- [ ] **Step 1: Write failing capability tests**

Verify OWNER vs ADMIN authority and role bundles.

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
  identity: UserIdentity; // canonical Hub UUID user
  validatedExternalGroupIds: readonly string[];
  platformCapabilities: readonly PlatformCapability[];
  refreshedAt: Date;
};
```

`callerFromPrincipal()` must not accept external identity directly.

- [ ] **Step 3: Implement role capability constants**

No custom-role DB tables.

- [ ] **Step 4: Verify**

```bash
npm run test:unit -- tests/unit/phase3-workspace-capabilities.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity src/modules/workspaces/domain tests/unit/phase3-workspace-capabilities.test.ts
git commit -m "feat: add trusted identity types and workspace capabilities"
```

---

### Task 3: Implement Company SSO claims and durable Hub identity resolution

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
- `CompanySsoSessionReader.readCurrentSession(): Promise<TrustedCompanySession | null>`.
- `HubIdentityResolver.resolve(externalIdentity): Promise<UserIdentity>`.

- [ ] **Step 1: Write failing provider tests**

Verify provider exposes trusted `provider + subject + emp_id/profile + groups`, server-side maps `workspace.create_team`, and production missing session fails closed.

- [ ] **Step 2: Write failing resolver integration tests**

Must prove:

```text
A. existing link (provider, subject) -> same Hub UUID
B. external subject / emp_id never becomes users.id
C. first login may attach an unlinked legacy user matched by emp_id
D. after that link exists, a different subject with the same emp_id is rejected with IDENTITY_LINK_CONFLICT
E. new subject + new emp_id creates Hub UUIDv7 user + identity link atomically
F. concurrent identical first login converges to one user/link
G. concurrent different subjects claiming same emp_id yields one winner + one conflict, not shared identity
```

- [ ] **Step 3: Implement resolver algorithm**

Pseudocode:

```ts
async resolve(external: ExternalCompanyIdentity): Promise<UserIdentity> {
  return retryUniqueRace(async () => uow.run(async (repos) => {
    const bySubject = await repos.identityLinks.findByProviderSubject(external.provider, external.subject);
    if (bySubject) {
      const user = await repos.users.findById(bySubject.hubUserId);
      if (!user) throw new IdentityIntegrityError();
      await repos.users.updateProfile(user.id, { name: external.name, org_code: external.org_code });
      await repos.identityLinks.touch(bySubject.id);
      return { ...user, name: external.name, org_code: external.org_code };
    }

    const byEmp = await repos.users.findByEmpId(external.emp_id);
    if (byEmp) {
      const existingProviderLink = await repos.identityLinks.findByProviderUser(external.provider, byEmp.id);
      if (existingProviderLink) throw new IdentityLinkConflictError();
      await repos.identityLinks.insert({
        id: uuidv7(), provider: external.provider, subject: external.subject,
        hubUserId: byEmp.id,
      });
      await repos.users.updateProfile(byEmp.id, { name: external.name, org_code: external.org_code });
      return { ...byEmp, name: external.name, org_code: external.org_code };
    }

    const user = { id: uuidv7(), emp_id: external.emp_id, name: external.name, org_code: external.org_code };
    await repos.users.insert(user);
    await repos.identityLinks.insert({ id: uuidv7(), provider: external.provider, subject: external.subject, hubUserId: user.id });
    return user;
  }));
}
```

On duplicate-key retry, re-read `(provider, subject)` first. If the collision reveals same `emp_id` already linked to another subject, fail closed; never silently share that Hub UUID.

Do not auto-update `emp_id` on an already-linked account in Phase 3. A trusted subject whose emp_id changes requires explicit reconciliation/migration rather than silent relink.

- [ ] **Step 4: Implement Local and Company providers**

Only server config/session can provide claims. Browser headers/body cannot supply identity/group/platform capability truth.

- [ ] **Step 5: Implement production provider factory**

Local provider disabled in production; missing company session integration is fatal/readiness failure.

- [ ] **Step 6: Verify**

```bash
npm run test:unit -- tests/unit/phase3-identity-provider.test.ts
npm run test:integration -- --run tests/integration/phase3-identity-resolution.test.ts
npm run typecheck
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/identity src/infrastructure/identity src/infrastructure/database/mariadb/repositories src/server tests/unit/phase3-identity-provider.test.ts tests/integration/phase3-identity-resolution.test.ts
git commit -m "feat: link company identities to hub users"
```

---

### Task 4: Bootstrap legacy governance and finalize schema with migration 009

**Files:**
- Create: `scripts/db/bootstrap-phase3-workspace-governance.ts`
- Create: `src/modules/workspaces/application/workspace-readiness.ts`
- Create: `src/infrastructure/database/mariadb/migrations/009-phase-3-workspace-governance-finalize.ts`
- Modify: `src/infrastructure/database/mariadb/migrations/index.ts`
- Modify: `scripts/db/migrate.ts` help/runbook if useful
- Modify: `src/server/config.ts`
- Modify: `src/server/composition.ts`
- Create: `tests/integration/phase3-bootstrap.test.ts`
- Extend: `tests/integration/phase3-schema.test.ts`

**Interfaces:**
- Bootstrap config explicitly maps legacy Team membership roles and zero-member Team owners.
- `assertPhase3WorkspaceReadiness(repositories): Promise<void>`.
- Migration 009 `beforeApply` refuses finalization until bootstrap invariants hold.

- [ ] **Step 1: Write failing bootstrap tests**

Cover all-EDITOR Team, zero-member Team, unknown owner target, null role/source, and successful explicit owner assignment.

- [ ] **Step 2: Implement explicit bootstrap**

```ts
export type LegacyWorkspaceBootstrapEntry = {
  workspaceId: string;
  userId: string;
  role: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
};
```

Every Team must end with direct OWNER >= 1. No heuristic elevation.

- [ ] **Step 3: Add migration 009 readiness gate tests**

Run:

```bash
npm run db:migrate -- --to 8
```

Before bootstrap, applying 009 must fail without inserting an APPLIED ledger row. After bootstrap, 009 must apply.

- [ ] **Step 4: Implement migration 009**

`beforeApply` is read-only and checks:

```text
- every TEAM has direct OWNER >= 1
- no membership has NULL/invalid role
- no membership has NULL/invalid membership_source
- no invalid Workspace type/lifecycle combinations
```

Statements finalize:

```text
- workspaces.workspace_type NOT NULL
- workspace_memberships.role NOT NULL
- workspace_memberships.membership_source NOT NULL
- CHECK constraints for workspace type/lifecycle and role/source
- FKs for personal_owner_user_id / created_by / archived_by where applicable
- membership created_by FK
- verify/add canonical FKs for external_identity_links, group mappings, audit events
```

Keep polymorphic audit `target_id` without a single FK.

- [ ] **Step 5: Wire production readiness to migration 009**

Production Phase 3 services must fail closed if migration 009 is not APPLIED even if migration 008 exists.

- [ ] **Step 6: Verify staged rollout**

```bash
npm run db:migrate -- --to 8
npm run db:bootstrap-phase3-workspace-governance -- --config /path/to/bootstrap.json
npm run db:migrate -- --to 9
npm run test:integration
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add scripts/db src/infrastructure/database/mariadb/migrations src/modules/workspaces/application/workspace-readiness.ts src/server tests/integration/phase3-bootstrap.test.ts tests/integration/phase3-schema.test.ts
git commit -m "feat: finalize phase 3 governance schema after bootstrap"
```

---

### Task 5: Extend repositories, UnitOfWork, and Workspace row locking

**Files:**
- Modify: `src/modules/workspaces/ports/workspace-repository.ts`
- Modify: `src/modules/workspaces/ports/workspace-membership-repository.ts`
- Create: `src/modules/workspaces/ports/workspace-group-mapping-repository.ts`
- Create: `src/modules/workspaces/ports/workspace-audit-repository.ts`
- Create: `src/modules/workspaces/ports/unit-of-work.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/workspaces.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/workspace-memberships.ts`
- Create: `src/infrastructure/database/mariadb/repositories/workspace-group-mappings.ts`
- Create: `src/infrastructure/database/mariadb/repositories/workspace-audit-events.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/index.ts`
- Modify: `src/infrastructure/database/mariadb/transaction.ts`

- [ ] **Step 1: Add lock/repository integration tests**

Two DB connections must block on the same Workspace row lock. Repository primitives must support direct owner count, exact group-ID lookup, append-only audit, and transaction-local authorization.

- [ ] **Step 2: Implement `WorkspaceRepository.lockById` with `FOR UPDATE`**

- [ ] **Step 3: Extend repository bundle and UoW**

All governance mutation + audit operations use the same transaction connection.

- [ ] **Step 4: Verify**

```bash
npm run test:integration
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/workspaces/ports src/infrastructure/database/mariadb
git commit -m "feat: add workspace governance persistence and locking"
```

---

### Task 6: Replace binary membership policy with capability evaluation

**Files:**
- Create: `src/modules/workspaces/application/workspace-authorization.ts`
- Modify: `src/modules/workspaces/ports/workspace-access-policy.ts`
- Modify: `src/modules/workspaces/application/workspace-query-service.ts`
- Create: `tests/integration/phase3-authorization.test.ts`

- [ ] **Step 1: Write failing authorization tests**

Cover direct VIEWER + group EDITOR union, group-only access, no OWNER group, same-org no grant denied, cross-org valid grant, exact group-ID matching, and listAccessibleWorkspaces aggregation.

- [ ] **Step 2: Implement evaluator**

Use only current caller's trusted `validatedExternalGroupIds`; never query or persist user↔group truth.

- [ ] **Step 3: Preserve discover/read semantics**

Undiscoverable = 404; discoverable but unreadable = 403.

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
- Modify Human Web/API caller establishment and `src/server/composition.ts`
- Create: `scripts/db/backfill-personal-workspaces.ts`
- Modify: `package.json`
- Create: `tests/integration/phase3-personal-workspace.test.ts`

**Shared request bootstrap:**

```text
IdentityProvider.getCurrentClaims()
→ HubIdentityResolver.resolve(provider + subject)
→ ensurePersonalWorkspace(hubIdentity.id)
→ AuthenticatedPrincipal with resolved Hub identity + trusted groups/platform capabilities
→ CallerContext
```

- [ ] **Step 1: Write failing tests**

Repeated/concurrent provisioning returns same Workspace ID; fixed name; one OWNER/SYSTEM_PERSONAL row; external subject never appears in membership/audit user FK; deep-link/API requests provision without visiting `/`; backfill is rerunnable.

- [ ] **Step 2: Implement Personal provisioning transaction**

Use unique `personal_owner_user_id`; duplicate-race re-read; Workspace + membership + audit atomic.

- [ ] **Step 3: Implement system freeze**

Lock Workspace, set ARCHIVED, append audit.

- [ ] **Step 4: Wire shared request helper and backfill**

No individual route may accept caller identity/group/capability from request body.

- [ ] **Step 5: Verify and commit**

```bash
npm run test:integration
git add src/modules/workspaces src/server scripts/db/backfill-personal-workspaces.ts package.json tests/integration/phase3-personal-workspace.test.ts
git commit -m "feat: bootstrap trusted callers and personal workspaces"
```

---

### Task 8: Implement Team create/rename/archive/restore and system recovery

**Files:**
- Create: `src/modules/workspaces/application/platform-access-policy.ts`
- Create: `src/modules/workspaces/application/team-workspace-service.ts`
- Create: `src/modules/workspaces/application/workspace-recovery-service.ts`
- Create: `scripts/admin/recover-team-workspace-governance.ts`
- Create: `tests/integration/phase3-team-governance.test.ts`

- [ ] **Step 1: Write lifecycle tests**

Create requires `workspace.create_team`; creator becomes direct OWNER; ADMIN cannot rename/archive/restore; OWNER can; archived read remains.

- [ ] **Step 2: Implement Team lifecycle with Workspace row lock**

Every rename/archive/restore re-evaluates capability/state after `lockById`.

- [ ] **Step 3: Implement system-only recovery**

Not exported through normal HTTP. Can restore Team or grant existing Hub user direct OWNER; append `TEAM_WORKSPACE_GOVERNANCE_RECOVERED` with system actor/correlation/reason.

- [ ] **Step 4: Verify and commit**

```bash
npm run test:integration
npm run typecheck
git add src/modules/workspaces scripts/admin tests/integration/phase3-team-governance.test.ts
git commit -m "feat: add team workspace lifecycle and recovery"
```

---

### Task 9: Implement direct membership and SSO group governance

**Files:**
- Create: `src/modules/workspaces/application/workspace-membership-service.ts`
- Create: `tests/unit/phase3-workspace-admin-policy.test.ts`
- Extend: `tests/integration/phase3-team-governance.test.ts`

- [ ] **Step 1: Write authority tests**

OWNER can manage OWNER/ADMIN/EDITOR/VIEWER and Group ADMIN/EDITOR/VIEWER. ADMIN can only manage EDITOR/VIEWER and Group EDITOR/VIEWER.

- [ ] **Step 2: Implement mutation contract**

```text
Workspace FOR UPDATE
→ evaluate actor in same transaction
→ require ACTIVE TEAM
→ load persisted target grant
→ validate beforeRole and afterRole authority
→ enforce final direct OWNER invariant
→ mutate grant
→ append audit
```

ADMIN may not downgrade/remove existing OWNER/ADMIN or Group ADMIN by requesting a lower role.

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
- Modify: `src/modules/sources/application/create-folder-import.ts`
- Modify: `src/modules/sources/application/upload-folder-import-entries.ts`
- Modify: `src/modules/sources/application/finalize-folder-import.ts`
- Modify: `src/modules/sources/application/apply-folder-import.ts`
- Modify current Source/Knowledge command services that mutate Workspace-scoped state
- Modify repository interfaces only where required
- Create: `tests/integration/phase3-concurrency.test.ts`

**Canonical row-lock interfaces:**

```text
Pre-Snapshot createInitial:
  creator quota/advisory lock (if used)
  → Workspace FOR UPDATE
  → validate ACTIVE + source.manage
  → insert Snapshot + entries

Pre-Snapshot createResync:
  creator quota/advisory lock (if used)
  → existing Source FOR UPDATE
  → parent Workspace FOR UPDATE
  → validate ACTIVE + source.manage
  → capture current sync_version
  → insert Snapshot + entries in SAME transaction

Existing Snapshot initial apply:
  ImportSnapshot → Workspace → create Source → deeper rows

Existing Snapshot resync/apply:
  ImportSnapshot → existing Source → Workspace → deeper rows

Upload/finalize:
  ImportSnapshot → Workspace → staging rows

Non-import existing Source mutation:
  Source → Workspace → deeper rows

Non-import new Source creation:
  Workspace → create Source
```

**Forbidden inversions:** `Workspace → ImportSnapshot`, `Workspace → existing Source`, and taking creator quota/advisory lock after DB row locks.

- [ ] **Step 1: Write two-connection pre-Snapshot race tests**

1. archive wins before `createInitial` Workspace lock → no Snapshot is committed.
2. createInitial wins Workspace lock → archive waits; snapshot commits before archive.
3. createResync locks Source → Workspace and captures `sync_version` while locked; archive-win causes no Snapshot commit.
4. prove createResync no longer reads binding/version in transaction A then inserts snapshot in transaction B.

- [ ] **Step 2: Write existing-Snapshot deadlock/race tests**

Cover initial apply, resync apply, upload/finalize, non-import Source mutation, and membership vs archive. Include explicit regression that would deadlock if any path acquires Workspace then waits for a Snapshot already held by Snapshot-first flow.

- [ ] **Step 3: Retrofit `createInitial`**

Keep creator quota serialization outermost when used. In the same UoW transaction, lock Workspace, evaluate `source.manage`, require ACTIVE, assert quota, then insert Snapshot + staging rows.

- [ ] **Step 4: Retrofit `createResync` into one transaction**

Remove the old split flow that first calls `sources.findById()` in one transaction and later `createBound()` in another. New flow under quota lock:

```text
lock Source FOR UPDATE
→ validate FOLDER_SYNC / SOURCE_MANAGED
→ lock Workspace FOR UPDATE
→ authorize + require ACTIVE
→ read source.syncVersion while locks are held
→ construct and insert Snapshot + staging rows
```

- [ ] **Step 5: Retrofit existing Snapshot paths**

Upload/finalize: Snapshot → Workspace. Apply initial: Snapshot → Workspace. Apply resync: Snapshot → Source → Workspace.

- [ ] **Step 6: Retrofit non-import Knowledge/Source mutations**

Existing Source: Source → Workspace. New Source without Snapshot: Workspace → insert.

- [ ] **Step 7: Verify**

```bash
npm run test:integration
npm run typecheck
```

Expected: all archive races complete without deadlock or post-archive mutation commit.

- [ ] **Step 8: Commit**

```bash
git add src/modules src/infrastructure/database tests/integration/phase3-concurrency.test.ts
git commit -m "fix: serialize all workspace import and content mutations"
```

---

### Task 11: Add server/admin API contracts and truthful effective-access views

**Files:**
- Create: `src/server/workspace-admin.ts`
- Create route handlers under `src/app/api/workspaces/...`
- Modify: `src/server/composition.ts`
- Extend: `tests/integration/phase3-authorization.test.ts`

```ts
export type UserAccessInspection = {
  userId: string;
  directRole: WorkspaceRole | null;
  groupAccess: "EVALUATED" | "UNKNOWN_NOT_EVALUATED";
  matchedGroups?: readonly { externalGroupId: string; role: WorkspaceRole }[];
  effectiveCapabilities?: readonly WorkspaceCapability[];
};
```

- [ ] **Step 1: Test current-caller vs other-user access inspection**

Current caller may show matched groups/effective capabilities. Other user returns direct-only + `UNKNOWN_NOT_EVALUATED`.

- [ ] **Step 2: Reuse shared trusted-caller helper**

Never accept identity/group/platform capability fields from request JSON.

- [ ] **Step 3: Implement governance routes**

Team create/rename/archive/restore, member CRUD, group mapping CRUD, audit read. No normal HTTP route for system recovery.

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

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/shell/workspace-selector.tsx`
- Create: `src/app/w/[workspaceId]/settings/page.tsx`
- Create components under `src/components/workspaces/`
- Create/extend: `tests/e2e/phase3-workspace-governance.spec.ts`

- [ ] **Step 1: Write failing E2E expectations**

`/` lands in My Space even when Team Workspaces exist; selector groups Personal/Teams; Personal hides governance controls; Team settings obey OWNER/ADMIN boundaries.

- [ ] **Step 2: Update root resolution and selector**

My Space first, Team name ascending for MVP.

- [ ] **Step 3: Build Team governance UI**

Separate Members / SSO Groups / Audit. For another user show `Group access not evaluated`, never a fabricated effective role.

- [ ] **Step 4: Verify and commit**

```bash
npm run test:e2e
npm run build
git add src/app src/components tests/e2e/phase3-workspace-governance.spec.ts
git commit -m "feat: add personal-first workspace governance ui"
```

---

### Task 13: Run full acceptance, security regression, and documentation verification

**Files:**
- Create: `docs/superpowers/verification/2026-09-14-phase-3-workspace-governance-verification.md`
- Modify docs only if implementation evidence reveals a real spec mismatch

- [ ] **Step 1: Static/unit checks**

```bash
npm run lint
npm run typecheck
npm run test:unit
```

- [ ] **Step 2: Integration checks**

```bash
npm run test:integration
```

Must include identity-link, staged migration/bootstrap, authorization, audit, and pre-/post-Snapshot concurrency suites.

- [ ] **Step 3: E2E/build**

```bash
npm run test:e2e
npm run build
```

- [ ] **Step 4: Record explicit security evidence**

```text
- production cannot silently use Local identity
- browser cannot inject identity/groups/platform capabilities
- users.id is always Hub UUIDv7
- (provider, subject) is durable account-link truth
- recycled emp_id cannot inherit an existing linked Hub account
- migration 008 can stage legacy DB; migration 009 cannot apply before bootstrap readiness
- after migration 009, role/source/type final constraints and canonical FKs are active
- every Team direct OWNER >= 1
- group cannot grant OWNER
- ADMIN cannot modify OWNER/ADMIN authority
- other-user group access is never fabricated
- createInitial/createResync cannot commit snapshots after archive wins
- createResync binding/version capture and snapshot insert occur in one transaction
- existing import lock order is Snapshot → [Source] → Workspace
- no Workspace → Snapshot or Workspace → existing Source inversion exists
- archived ordinary writes/governance fail
- system recovery is not exposed via normal HTTP/UI and is audited
- Source/Document IDs survive Phase 3 migration
- no Source/Document ACL columns were added
```

- [ ] **Step 5: Write verification report and commit**

```bash
git add docs/superpowers/verification
git commit -m "docs: verify phase 3 workspace governance"
```

---

## Self-review coverage matrix

| Spec requirement | Implementation task |
| --- | --- |
| Personal/Team one Workspace model | 1, 7, 12 |
| Fixed My Space + default entry | 7, 12 |
| Fixed roles/capabilities | 2, 6 |
| Trusted external groups/platform capability | 2, 3, 6 |
| Durable `(provider, subject)` → Hub UUID identity | 1, 3, 7 |
| Explicit legacy owner bootstrap | 4 |
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
| Full acceptance | 13 |

Plan complete. Execution should start only after this documentation PR is merged.
