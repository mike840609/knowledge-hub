# Phase 3 Identity, Workspace Administration & Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Phase 0–2 binary WorkspaceMembership foundation into production Workspace governance with My Space, fixed RBAC, trusted SSO group/platform claims, lifecycle-safe mutation serialization, direct + group grants, auditable governance, and Phase 2.5 administration UI without changing canonical Knowledge identity.

**Architecture:** Keep `Workspace → KnowledgeSource → Tree/Document/Revision` as the only Knowledge path. Replace identity-only caller creation with a trusted `AuthenticatedPrincipal`, resolve Workspace authorization from direct + validated group grants, and require every Workspace-scoped mutation to participate in a Workspace row `FOR UPDATE` serialization protocol so archive cannot race with content/governance writes under READ COMMITTED. Existing Source mutations preserve Source-first locking, then lock the parent Workspace before validation/write.

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
- Every Workspace-scoped mutation must hold the parent Workspace row lock before committing mutation.
- Existing Source mutations lock `Source → Workspace → deeper resource`; governance/new-source paths lock `Workspace` and must not then acquire unrelated Source locks.
- Governance mutation and audit append commit/rollback atomically.
- Production identity must not silently fall back to Local identity.
- Existing Workspace/Source/Document/Revision stable IDs and `/w/:workspaceId/...` routes remain canonical.

---

## File Structure Map

```text
src/modules/identity/domain/
  authenticated-principal.ts
  caller-context.ts
src/modules/identity/ports/
  identity-provider.ts
  company-sso-session-reader.ts
src/infrastructure/identity/
  local-identity-provider.ts
  company-sso-identity-provider.ts
src/server/
  identity-provider-factory.ts
  composition.ts
  config.ts

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

src/infrastructure/database/mariadb/
  migrations/008-phase-3-workspace-governance.ts
  repositories/workspaces.ts
  repositories/workspace-memberships.ts
  repositories/workspace-group-mappings.ts
  repositories/workspace-audit-events.ts
  repositories/index.ts
  transaction.ts

scripts/db/bootstrap-phase3-workspace-governance.ts
scripts/admin/recover-team-workspace-governance.ts

src/server/workspace-admin.ts
src/app/api/workspaces/...
src/app/page.tsx
src/components/shell/workspace-selector.tsx
src/app/w/[workspaceId]/settings/page.tsx
src/components/workspaces/...

tests/unit/phase3-workspace-capabilities.test.ts
tests/unit/phase3-identity-provider.test.ts
tests/integration/phase3-schema.test.ts
tests/integration/phase3-bootstrap.test.ts
tests/integration/phase3-authorization.test.ts
tests/integration/phase3-personal-workspace.test.ts
tests/integration/phase3-team-governance.test.ts
tests/integration/phase3-concurrency.test.ts
tests/integration/phase3-audit.test.ts
tests/e2e/phase3-workspace-governance.spec.ts
```

---

### Task 1: Add Phase 3 schema and governance domain types

**Files:**
- Create: `src/infrastructure/database/mariadb/migrations/008-phase-3-workspace-governance.ts`
- Modify: `src/infrastructure/database/mariadb/migrations/index.ts`
- Modify: `src/modules/workspaces/domain/workspace.ts`
- Modify: `src/modules/workspaces/domain/workspace-membership.ts`
- Create: `src/modules/workspaces/domain/workspace-group-mapping.ts`
- Create: `src/modules/workspaces/domain/workspace-audit-event.ts`
- Create: `tests/integration/phase3-schema.test.ts`

**Interfaces:**
- Produces `WorkspaceType`, `WorkspaceLifecycleState`, `WorkspaceRole`, `WorkspaceMembershipSource`, `WorkspaceGroupMapping`, `WorkspaceAuditEvent`.

- [ ] **Step 1: Write failing schema tests**

```ts
it("backfills existing workspaces to TEAM without changing ids", async () => {
  const id = uuidv7();
  await pool.query("INSERT INTO workspaces (id, name) VALUES (?, 'Existing')", [id]);
  await runMigrations(pool);
  const [row] = await pool.query<any[]>(
    "SELECT id, workspace_type, lifecycle_state FROM workspaces WHERE id = ?",
    [id],
  );
  expect(row).toMatchObject({ id, workspace_type: "TEAM", lifecycle_state: "ACTIVE" });
});

it("rejects OWNER group mappings", async () => {
  await expectDatabaseConstraintFailure(() => pool.query(
    `INSERT INTO workspace_group_mappings
      (id, workspace_id, external_group_id, role, created_by)
     VALUES (?, ?, 'grp-1', 'OWNER', ?)`,
    [uuidv7(), workspaceId, userId],
  ));
});
```

Also assert Personal requires `personal_owner_user_id`, `name='My Space'`, unique personal owner; Team requires null personal owner; membership roles/sources are constrained; audit payload is JSON.

- [ ] **Step 2: Run integration suite; verify failure before migration exists**

```bash
npm run test:integration
```

Expected: Phase 3 schema assertions fail.

- [ ] **Step 3: Implement migration 008**

Use backward-compatible add/backfill/finalize ordering. Existing memberships may temporarily have nullable role/source until Task 4 bootstrap; production readiness must remain false until Task 4 succeeds.

```ts
export const phase3WorkspaceGovernanceMigration: Migration = {
  version: 8,
  name: "phase-3-workspace-governance",
  statements: [
    `ALTER TABLE workspaces
       ADD COLUMN workspace_type VARCHAR(16) NULL,
       ADD COLUMN personal_owner_user_id UUID NULL,
       ADD COLUMN lifecycle_state VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
       ADD COLUMN created_by UUID NULL,
       ADD COLUMN archived_by UUID NULL,
       ADD COLUMN archived_at DATETIME(6) NULL`,
    `UPDATE workspaces SET workspace_type='TEAM' WHERE workspace_type IS NULL`,
    `ALTER TABLE workspace_memberships
       ADD COLUMN role VARCHAR(16) NULL,
       ADD COLUMN membership_source VARCHAR(24) NULL,
       ADD COLUMN created_by UUID NULL,
       ADD COLUMN updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)`,
    `CREATE TABLE workspace_group_mappings (
       id UUID PRIMARY KEY,
       workspace_id UUID NOT NULL,
       external_group_id VARCHAR(255) NOT NULL,
       role VARCHAR(16) NOT NULL,
       created_by UUID NOT NULL,
       created_at DATETIME(6) NOT NULL,
       updated_by UUID NOT NULL,
       updated_at DATETIME(6) NOT NULL,
       UNIQUE KEY uq_workspace_external_group (workspace_id, external_group_id),
       CHECK (role IN ('ADMIN','EDITOR','VIEWER'))
     ) ENGINE=InnoDB`,
    `CREATE TABLE workspace_audit_events (
       id UUID PRIMARY KEY,
       workspace_id UUID NOT NULL,
       actor_kind VARCHAR(16) NOT NULL,
       actor_user_id UUID NULL,
       event_type VARCHAR(64) NOT NULL,
       target_type VARCHAR(32) NOT NULL,
       target_id UUID NOT NULL,
       payload JSON NOT NULL,
       correlation_id VARCHAR(128) NULL,
       created_at DATETIME(6) NOT NULL
     ) ENGINE=InnoDB`,
  ],
};
```

- [ ] **Step 4: Update domain types**

```ts
export type WorkspaceType = "PERSONAL" | "TEAM";
export type WorkspaceLifecycleState = "ACTIVE" | "ARCHIVED";
export type WorkspaceRole = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
export type WorkspaceMembershipSource = "DIRECT" | "SYSTEM_PERSONAL";
```

- [ ] **Step 5: Register migration and verify**

```bash
npm run test:integration
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/database/mariadb/migrations src/modules/workspaces/domain tests/integration/phase3-schema.test.ts
git commit -m "feat: add phase 3 workspace governance schema"
```

---

### Task 2: Add fixed capability bundles and AuthenticatedPrincipal

**Files:**
- Create: `src/modules/identity/domain/authenticated-principal.ts`
- Modify: `src/modules/identity/domain/caller-context.ts`
- Create: `src/modules/workspaces/domain/workspace-capability.ts`
- Create: `tests/unit/phase3-workspace-capabilities.test.ts`

**Interfaces:**
- Produces `AuthenticatedPrincipal`, `CallerContext`, `PlatformCapability`, `WorkspaceCapability`, `capabilitiesForRole()`.

- [ ] **Step 1: Write failing unit tests**

```ts
it("keeps OWNER and ADMIN authority distinct", () => {
  expect(capabilitiesForRole("OWNER")).toContain("workspace.archive");
  expect(capabilitiesForRole("OWNER")).toContain("membership.manage_admin");
  expect(capabilitiesForRole("ADMIN")).not.toContain("workspace.archive");
  expect(capabilitiesForRole("ADMIN")).not.toContain("membership.manage_admin");
});

it("copies trusted principal claims into caller context", () => {
  const caller = callerFromPrincipal({
    identity,
    validatedExternalGroupIds: ["grp-a"],
    platformCapabilities: ["workspace.create_team"],
    refreshedAt: new Date("2026-09-14T00:00:00Z"),
  });
  expect(caller.validatedExternalGroupIds).toEqual(["grp-a"]);
  expect(caller.platformCapabilities).toEqual(["workspace.create_team"]);
});
```

- [ ] **Step 2: Implement principal/context types**

```ts
export type PlatformCapability = "workspace.create_team";

export type AuthenticatedPrincipal = {
  identity: UserIdentity;
  validatedExternalGroupIds: readonly string[];
  platformCapabilities: readonly PlatformCapability[];
  refreshedAt: Date;
};

export type CallerContext = AuthenticatedPrincipal;

export function callerFromPrincipal(principal: AuthenticatedPrincipal): CallerContext {
  return {
    identity: { ...principal.identity },
    validatedExternalGroupIds: [...principal.validatedExternalGroupIds],
    platformCapabilities: [...principal.platformCapabilities],
    refreshedAt: new Date(principal.refreshedAt),
  };
}
```

- [ ] **Step 3: Implement capability bundles**

Keep role bundles as code constants; do not add custom-role DB tables.

- [ ] **Step 4: Run tests**

```bash
npm run test:unit -- tests/unit/phase3-workspace-capabilities.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity src/modules/workspaces/domain tests/unit/phase3-workspace-capabilities.test.ts
git commit -m "feat: add trusted principal and workspace capabilities"
```

---

### Task 3: Complete trusted identity provider and company SSO integration

**Files:**
- Modify: `src/modules/identity/ports/identity-provider.ts`
- Create: `src/modules/identity/ports/company-sso-session-reader.ts`
- Modify: `src/infrastructure/identity/local-identity-provider.ts`
- Create: `src/infrastructure/identity/company-sso-identity-provider.ts`
- Create: `src/server/identity-provider-factory.ts`
- Modify: `src/server/config.ts`
- Modify: `src/server/composition.ts`
- Modify callers of `getCurrentIdentity` to use principal/caller helper
- Create: `tests/unit/phase3-identity-provider.test.ts`

**Interfaces:**
- `IdentityProvider.getCurrentPrincipal(): Promise<AuthenticatedPrincipal>`.
- `CompanySsoSessionReader.readCurrentSession(): Promise<TrustedCompanySession | null>`.

- [ ] **Step 1: Write failing provider tests**

```ts
it("maps only trusted company session groups and platform grants", async () => {
  const reader = fakeCompanySession({
    user: identity,
    groupIds: ["grp-team-admin", "grp-create-workspace"],
    refreshedAt: new Date("2026-09-14T01:00:00Z"),
  });
  const provider = new CompanySsoIdentityProvider(reader, {
    workspaceCreateTeamGroupIds: new Set(["grp-create-workspace"]),
  });
  const principal = await provider.getCurrentPrincipal();
  expect(principal.validatedExternalGroupIds).toEqual(["grp-team-admin", "grp-create-workspace"]);
  expect(principal.platformCapabilities).toEqual(["workspace.create_team"]);
});

it("fails closed when production company session is unavailable", async () => {
  const provider = new CompanySsoIdentityProvider(fakeCompanySession(null), policy);
  await expect(provider.getCurrentPrincipal()).rejects.toMatchObject({ code: "IDENTITY_REQUIRED" });
});
```

- [ ] **Step 2: Change IdentityProvider contract**

```ts
export interface IdentityProvider {
  getCurrentPrincipal(): Promise<AuthenticatedPrincipal>;
}
```

- [ ] **Step 3: Implement Local provider from server-only config**

Local groups/platform capabilities come from `server/config.ts`, never request input.

- [ ] **Step 4: Implement Company SSO adapter over trusted session reader**

```ts
export class CompanySsoIdentityProvider implements IdentityProvider {
  constructor(
    private readonly sessions: CompanySsoSessionReader,
    private readonly policy: { workspaceCreateTeamGroupIds: ReadonlySet<string> },
  ) {}

  async getCurrentPrincipal(): Promise<AuthenticatedPrincipal> {
    const session = await this.sessions.readCurrentSession();
    if (!session) throw new IdentityError("IDENTITY_REQUIRED", "Authenticated company session required.");
    const platformCapabilities = session.groupIds.some((id) => this.policy.workspaceCreateTeamGroupIds.has(id))
      ? (["workspace.create_team"] as const)
      : [];
    return {
      identity: session.user,
      validatedExternalGroupIds: [...session.groupIds],
      platformCapabilities,
      refreshedAt: session.refreshedAt,
    };
  }
}
```

The concrete `CompanySsoSessionReader` must bind to the company's server-side session middleware/SDK in deployment code; do not read arbitrary client-supplied `x-groups`/`x-capabilities` headers.

- [ ] **Step 5: Implement provider factory with production fail-closed selection**

```ts
export function createIdentityProvider(config: IdentityRuntimeConfig): IdentityProvider {
  if (config.provider === "local") {
    if (config.nodeEnv === "production") throw new Error("Local identity provider is disabled in production");
    return new LocalIdentityProvider(config.local);
  }
  return new CompanySsoIdentityProvider(config.companySessionReader, config.companyPolicy);
}
```

- [ ] **Step 6: Wire composition and replace identity-only call sites**

Each server request obtains principal once, then `callerFromPrincipal(principal)`.

- [ ] **Step 7: Verify**

```bash
npm run test:unit -- tests/unit/phase3-identity-provider.test.ts
npm run typecheck
npm run build
```

- [ ] **Step 8: Commit**

```bash
git add src/modules/identity src/infrastructure/identity src/server src/app tests/unit/phase3-identity-provider.test.ts
git commit -m "feat: integrate trusted company identity claims"
```

---

### Task 4: Implement explicit legacy governance bootstrap and readiness guard

**Files:**
- Create: `scripts/db/bootstrap-phase3-workspace-governance.ts`
- Create: `src/modules/workspaces/application/workspace-readiness.ts`
- Modify: `src/server/config.ts`
- Modify: `src/server/composition.ts`
- Create: `tests/integration/phase3-bootstrap.test.ts`

**Interfaces:**
- Bootstrap config explicitly maps legacy Team membership roles and zero-member Team owners.
- `assertPhase3WorkspaceReadiness(repositories): Promise<void>`.

- [ ] **Step 1: Write failing bootstrap tests**

```ts
it("rejects bootstrap when every member is non-owner", async () => {
  await seedTeamWithMembers([alice, bob]);
  await expect(runBootstrap([{ workspaceId, userId: alice, role: "EDITOR" }]))
    .rejects.toThrow(/direct OWNER/);
});

it("rejects zero-member Team without explicit owner assignment", async () => {
  await seedEmptyTeam(workspaceId);
  await expect(runBootstrap([])).rejects.toThrow(/owner assignment/);
});
```

Also test zero-member Team succeeds when an existing Hub User is explicitly assigned OWNER; unknown user fails.

- [ ] **Step 2: Implement explicit bootstrap input**

```ts
export type LegacyWorkspaceBootstrapEntry = {
  workspaceId: string;
  userId: string;
  role: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
};
```

For missing legacy memberships, OWNER assignment may insert a new DIRECT membership only when target user exists.

- [ ] **Step 3: Validate every Team before commit**

Run one query that fails if any Team has zero direct OWNER, or any membership retains null role/source.

```sql
SELECT w.id
FROM workspaces w
LEFT JOIN workspace_memberships m
  ON m.workspace_id = w.id
 AND m.role = 'OWNER'
 AND m.membership_source = 'DIRECT'
WHERE w.workspace_type = 'TEAM'
GROUP BY w.id
HAVING COUNT(m.user_id) = 0;
```

- [ ] **Step 4: Add startup/readiness guard**

Composition must not expose production Phase 3 services until readiness passes.

- [ ] **Step 5: Verify**

```bash
npm run test:integration
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add scripts/db/bootstrap-phase3-workspace-governance.ts src/modules/workspaces/application/workspace-readiness.ts src/server tests/integration/phase3-bootstrap.test.ts
git commit -m "feat: validate phase 3 workspace bootstrap readiness"
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

**Interfaces:**
- `WorkspaceRepository.lockById(id)` performs `SELECT ... FOR UPDATE`.
- Repositories expose list/count primitives needed by authorization and owner invariant.

- [ ] **Step 1: Add repository contract tests or integration assertions**

Verify two connections block on the same Workspace row lock.

- [ ] **Step 2: Add `lockById`**

```ts
async lockById(id: string): Promise<Workspace | null> {
  const rows = await this.connection.query<DbRow[]>(
    "SELECT * FROM workspaces WHERE id = ? FOR UPDATE",
    [id],
  );
  return rows[0] ? mapWorkspace(rows[0]) : null;
}
```

- [ ] **Step 3: Add membership/group/audit repository operations**

Required operations include `find`, `listForWorkspace`, `listByExternalGroupIds`, `countDirectOwners`, `insert/update/delete`, `appendAudit`.

- [ ] **Step 4: Extend MariaDbUnitOfWork repository bundle**

All governance services use the same connection/transaction as audit.

- [ ] **Step 5: Verify**

```bash
npm run test:integration
npm run typecheck
```

- [ ] **Step 6: Commit**

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

**Interfaces:**

```ts
export type EffectiveWorkspaceAccess = {
  directRole: WorkspaceRole | null;
  matchedGroupRoles: readonly WorkspaceRole[];
  capabilities: ReadonlySet<WorkspaceCapability>;
};

export interface WorkspaceAccessPolicy {
  evaluate(caller: CallerContext, workspaceId: string): Promise<EffectiveWorkspaceAccess | null>;
  require(caller: CallerContext, workspaceId: string, capability: WorkspaceCapability): Promise<EffectiveWorkspaceAccess>;
}
```

- [ ] **Step 1: Write failing authorization tests**

Cover direct VIEWER + group EDITOR union, group-only access, no OWNER group, same-org no grant denied, cross-org grant allowed, listAccessibleWorkspaces aggregation.

- [ ] **Step 2: Implement evaluator**

Use only caller's trusted `validatedExternalGroupIds`; never query or persist user-group truth.

- [ ] **Step 3: Preserve discover/read semantics**

Undiscoverable remains 404; known-but-unreadable remains 403 even though normal Phase 3 roles all include read.

- [ ] **Step 4: Verify**

```bash
npm run test:integration
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/workspaces tests/integration/phase3-authorization.test.ts
git commit -m "feat: evaluate workspace capabilities from direct and group grants"
```

---

### Task 7: Implement idempotent My Space provisioning and system freeze

**Files:**
- Create: `src/modules/workspaces/application/personal-workspace-service.ts`
- Modify repositories as required
- Create: `tests/integration/phase3-personal-workspace.test.ts`

**Interfaces:**
- `ensurePersonalWorkspace(userId): Promise<Workspace>`.
- `freezePersonalWorkspaceSystem(userId, reason, correlationId): Promise<void>`.

- [ ] **Step 1: Write failing Personal tests**

Test repeated provisioning returns same ID, fixed name, one OWNER/SYSTEM_PERSONAL row, second member/group mapping rejected, system freeze audited.

- [ ] **Step 2: Implement provision in one transaction**

Lock/query by unique `personal_owner_user_id`; handle duplicate-race by re-read; insert Workspace + membership + audit atomically.

- [ ] **Step 3: Implement system freeze**

Use `Workspace.lockById`, set lifecycle ARCHIVED, append `PERSONAL_WORKSPACE_FROZEN`.

- [ ] **Step 4: Verify**

```bash
npm run test:integration
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/workspaces tests/integration/phase3-personal-workspace.test.ts
git commit -m "feat: provision and freeze personal workspaces"
```

---

### Task 8: Implement Team create/rename/archive/restore and system recovery

**Files:**
- Create: `src/modules/workspaces/application/platform-access-policy.ts`
- Create: `src/modules/workspaces/application/team-workspace-service.ts`
- Create: `src/modules/workspaces/application/workspace-recovery-service.ts`
- Create: `scripts/admin/recover-team-workspace-governance.ts`
- Create: `tests/integration/phase3-team-governance.test.ts`

**Interfaces:**
- Product lifecycle operations are OWNER-only except create, which needs platform capability.
- Recovery service is system-only and not exported through Workspace HTTP handlers.

- [ ] **Step 1: Write failing Team lifecycle tests**

Cover create capability, creator direct OWNER, last-owner protection, ADMIN cannot rename/archive/restore, OWNER can, archived read remains.

- [ ] **Step 2: Implement Team creation**

```ts
if (!caller.platformCapabilities.includes("workspace.create_team")) {
  throw new WorkspaceAccessDeniedError();
}
```

Create Workspace + OWNER + audit in one transaction.

- [ ] **Step 3: Implement lifecycle mutations with Workspace row lock**

Archive/restore/rename start by `workspaces.lockById(workspaceId)` then re-evaluate actor authority and state.

- [ ] **Step 4: Implement system-only recovery**

```ts
await recovery.recoverTeamGovernance({
  workspaceId,
  targetOwnerUserId,
  action: "RESTORE_AND_GRANT_OWNER",
  reason,
  correlationId,
});
```

Guard target is existing Hub User; append `TEAM_WORKSPACE_GOVERNANCE_RECOVERED` with `actor_kind=SYSTEM`. Do not expose this operation in `src/app/api/workspaces`.

- [ ] **Step 5: Verify**

```bash
npm run test:integration
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/workspaces scripts/admin/recover-team-workspace-governance.ts tests/integration/phase3-team-governance.test.ts
git commit -m "feat: add team workspace lifecycle and recovery"
```

---

### Task 9: Implement direct membership and SSO group governance

**Files:**
- Create: `src/modules/workspaces/application/workspace-membership-service.ts`
- Create: `tests/unit/phase3-workspace-admin-policy.test.ts`
- Extend: `tests/integration/phase3-team-governance.test.ts`

**Interfaces:**
- OWNER manages all roles and group ADMIN/EDITOR/VIEWER.
- ADMIN manages only EDITOR/VIEWER and group EDITOR/VIEWER.

- [ ] **Step 1: Write policy tests**

```ts
expect(canAssignRole("OWNER", "ADMIN")).toBe(true);
expect(canAssignRole("ADMIN", "ADMIN")).toBe(false);
expect(canAssignRole("ADMIN", "EDITOR")).toBe(true);
expect(canAssignGroupRole("ADMIN", "ADMIN")).toBe(false);
```

- [ ] **Step 2: Implement every governance mutation with Workspace row lock first**

```ts
return uow.run(async (repos) => {
  const workspace = await repos.workspaces.lockById(workspaceId);
  requireActiveTeam(workspace);
  const actorAccess = await policy.evaluateWithinTransaction(repos, caller, workspaceId);
  requireManageAuthority(actorAccess, requestedRole);
  // mutate membership/group
  // append audit
});
```

- [ ] **Step 3: Enforce final direct OWNER invariant**

Before OWNER removal/demotion, count direct OWNERs while Workspace lock is held; reject count <= 1.

- [ ] **Step 4: Reject all ordinary governance mutations when ARCHIVED**

Restore is handled only by Task 8 product lifecycle service; recovery only by system service.

- [ ] **Step 5: Verify**

```bash
npm run test:unit -- tests/unit/phase3-workspace-admin-policy.test.ts
npm run test:integration
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/workspaces tests/unit/phase3-workspace-admin-policy.test.ts tests/integration/phase3-team-governance.test.ts
git commit -m "feat: govern workspace members and group mappings"
```

---

### Task 10: Retrofit Workspace lifecycle locking into existing Knowledge/Source write paths

**Files:**
- Modify current Source/Knowledge command services that mutate Workspace-scoped state, including folder import create/apply/sync and HUB-managed Knowledge mutation internals
- Modify repository interfaces only where required to expose transaction-scoped Workspace lock
- Create: `tests/integration/phase3-concurrency.test.ts`

**Interfaces:**
- Existing Source mutation lock order: `Source FOR UPDATE → parent Workspace FOR UPDATE → deeper rows`.
- New Source creation: `Workspace FOR UPDATE → validate → insert Source`.

- [ ] **Step 1: Write two-connection race tests before changing code**

Case A: content transaction locks Source then Workspace first; archive on second connection blocks until content commits, then archives.

Case B: archive locks Workspace first; content transaction eventually acquires Workspace lock, re-reads ARCHIVED, and rolls back without content change.

Case C: membership mutation and archive serialize on Workspace lock; archive-win rejects membership change.

- [ ] **Step 2: Add shared transaction helper**

```ts
export async function lockActiveWorkspaceForMutation(
  repositories: SourceRepositories,
  caller: CallerContext,
  workspaceId: string,
  capability: WorkspaceCapability,
): Promise<Workspace> {
  const workspace = await repositories.workspaces.lockById(workspaceId);
  if (!workspace) throw new WorkspaceNotFoundError();
  await repositories.workspaceAccess.requireWithinTransaction(repositories, caller, workspaceId, capability);
  if (workspace.lifecycleState !== "ACTIVE") throw new WorkspaceArchivedMutationError();
  return workspace;
}
```

- [ ] **Step 3: Retrofit existing Source mutation paths without reversing Source-first locks**

For existing Source update/apply flows:

```text
resolve Source
→ lock Source FOR UPDATE
→ lock Source.workspaceId Workspace FOR UPDATE
→ re-evaluate capability + ACTIVE
→ deeper locks/write
```

Do not lock Workspace then later lock an unrelated existing Source; that would create a cycle against legacy Source-first flows.

- [ ] **Step 4: Retrofit new Source creation**

Since no Source row exists yet, lock Workspace first, validate ACTIVE + `source.manage`, then insert.

- [ ] **Step 5: Verify concurrency and regression suites**

```bash
npm run test:integration
npm run typecheck
```

Expected: all race tests and Phase 1/2 mutation tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules src/infrastructure/database tests/integration/phase3-concurrency.test.ts
git commit -m "fix: serialize workspace lifecycle with content mutations"
```

---

### Task 11: Add server/admin API contracts and truthful effective-access views

**Files:**
- Create: `src/server/workspace-admin.ts`
- Create route handlers under `src/app/api/workspaces/...`
- Modify: `src/server/composition.ts`
- Extend: `tests/integration/phase3-authorization.test.ts`

**Interfaces:**

```ts
export type UserAccessInspection = {
  userId: string;
  directRole: WorkspaceRole | null;
  groupAccess: "EVALUATED" | "UNKNOWN_NOT_EVALUATED";
  matchedGroups?: readonly { externalGroupId: string; role: WorkspaceRole }[];
  effectiveCapabilities?: readonly WorkspaceCapability[];
};
```

- [ ] **Step 1: Write failing access-inspection tests**

Current caller returns `groupAccess="EVALUATED"` with matched groups/effective capabilities. Another user returns direct role plus `UNKNOWN_NOT_EVALUATED`, with no fabricated matched groups/effective set.

- [ ] **Step 2: Implement trusted caller server helper once**

Every route obtains `AuthenticatedPrincipal` from provider, builds caller server-side, then calls application service. Never accept group/platform capability fields from request JSON.

- [ ] **Step 3: Implement governance route handlers**

Handlers cover Team create/rename/archive/restore, direct member CRUD, group mapping CRUD, audit read. Do not create HTTP handler for system recovery.

- [ ] **Step 4: Implement truthful access-inspection DTO**

Only compare requested userId to `caller.identity.id` to decide whether current trusted groups may be evaluated.

- [ ] **Step 5: Verify**

```bash
npm run test:integration
npm run typecheck
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/server src/app/api tests/integration/phase3-authorization.test.ts
git commit -m "feat: expose workspace governance server contracts"
```

---

### Task 12: Make My Space the default and add grouped Workspace/admin UI

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/shell/workspace-selector.tsx`
- Create: `src/app/w/[workspaceId]/settings/page.tsx`
- Create: `src/components/workspaces/workspace-admin-page.tsx`
- Create: `src/components/workspaces/member-table.tsx`
- Create: `src/components/workspaces/group-mapping-table.tsx`
- Create: `src/components/workspaces/audit-list.tsx`
- Create/extend: `tests/e2e/phase3-workspace-governance.spec.ts`

- [ ] **Step 1: Write failing E2E expectations**

Verify `/` lands in My Space even when Team Workspaces exist; selector groups My Space separately; Personal settings hide governance controls; Team settings obey OWNER/ADMIN authority.

- [ ] **Step 2: Update root resolution**

Call Personal provisioning after trusted caller establishment, then resolve default Knowledge target inside My Space only.

- [ ] **Step 3: Group selector**

Render optgroups or equivalent accessible UI:

```tsx
<optgroup label="Personal">
  <option value={mySpace.id}>My Space</option>
</optgroup>
<optgroup label="Team Workspaces">
  {teams.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
</optgroup>
```

- [ ] **Step 4: Build Team governance UI**

Keep Members, SSO Groups, Audit separate. For another user show `Group access not evaluated`; do not show a false effective role.

- [ ] **Step 5: Verify**

```bash
npm run test:e2e
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/app src/components tests/e2e/phase3-workspace-governance.spec.ts
git commit -m "feat: add personal-first workspace governance ui"
```

---

### Task 13: Run full acceptance, security regression, and documentation verification

**Files:**
- Create: `docs/superpowers/verification/2026-09-14-phase-3-workspace-governance-verification.md`
- Modify docs only if implementation evidence reveals a real spec mismatch

- [ ] **Step 1: Run all static/unit checks**

```bash
npm run lint
npm run typecheck
npm run test:unit
```

Expected: PASS.

- [ ] **Step 2: Run all integration tests**

```bash
npm run test:integration
```

Expected: PASS, including bootstrap, SSO/provider, owner invariant, audit, direct+group union, and archive concurrency races.

- [ ] **Step 3: Run E2E and production build**

```bash
npm run test:e2e
npm run build
```

Expected: PASS.

- [ ] **Step 4: Verify security invariants explicitly**

Record evidence that:

```text
- production cannot silently use Local identity
- browser cannot inject groups/platform capabilities
- every Team has direct OWNER >= 1
- group cannot grant OWNER
- ADMIN cannot create governance authority
- other-user group access is never fabricated
- archive and content/governance writes serialize on Workspace row
- archived ordinary writes/governance fail
- system recovery is not exposed via normal HTTP/UI and is audited
- Source/Document IDs survive Phase 3 migration
- no Source/Document ACL columns were added
```

- [ ] **Step 5: Write verification report**

Include command outputs/summary, migration/bootstrap evidence, two-connection race evidence, provider selection evidence, and final acceptance checklist.

- [ ] **Step 6: Commit**

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
| Company SSO transport integration | 3 |
| Explicit legacy owner bootstrap/readiness | 4 |
| Direct + group capability union | 6 |
| OWNER/ADMIN governance | 8, 9 |
| Team direct OWNER >= 1 | 4, 9 |
| Workspace-only ACL | 6, 10 |
| Archive/read-only semantics | 8, 9, 10 |
| Archive/write concurrency serialization | 5, 10 |
| System-only stranded governance recovery | 8 |
| Atomic audit | 5, 7, 8, 9 |
| Truthful effective-access inspection | 11, 12 |
| Grouped selector / admin UI | 12 |
| Full acceptance | 13 |

Plan complete. Execution should start only after this documentation PR is merged.