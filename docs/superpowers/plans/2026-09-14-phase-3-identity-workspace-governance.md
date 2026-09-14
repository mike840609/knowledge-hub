# Phase 3 Identity, Workspace Administration & Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Phase 0–2 binary WorkspaceMembership foundation into production Workspace governance with My Space, fixed RBAC, trusted SSO group/platform claims, Hub-owned user identity resolution, lifecycle-safe mutation serialization, direct + group grants, auditable governance, and Phase 2.5 administration UI without changing canonical Knowledge identity.

**Architecture:** Keep `Workspace → KnowledgeSource → Tree/Document/Revision` as the only Knowledge path. Company SSO yields trusted external claims, then a Hub identity resolver maps trusted `emp_id` to the canonical Hub-owned UUID user before CallerContext exists. Workspace authorization resolves direct + validated group grants. Every Workspace-scoped mutation participates in a Workspace row `FOR UPDATE` serialization protocol; folder-import mutations additionally preserve the existing Snapshot-first topology as `ImportSnapshot → [bound Source] → Workspace → deeper rows`, while non-import existing Source mutations remain `Source → Workspace → deeper rows`.

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
- Company SSO external subject/employee identifiers never become `users.id` directly; canonical Hub user IDs are Hub-owned UUIDv7 values.
- Every Workspace-scoped mutation must hold the parent Workspace row lock before committing mutation.
- Folder-import mutation lock order is `ImportSnapshot → [bound Source] → Workspace → deeper resource`; never `Workspace → ImportSnapshot`.
- Non-import existing Source mutations lock `Source → Workspace → deeper resource`; governance/non-import new-source paths lock `Workspace` and must not then acquire unrelated Source/Snapshot locks.
- Governance mutation and audit append commit/rollback atomically.
- Production identity must not silently fall back to Local identity.
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
src/infrastructure/identity/
  local-identity-provider.ts
  company-sso-identity-provider.ts
src/infrastructure/database/mariadb/repositories/users.ts
src/server/
  identity-provider-factory.ts
  trusted-caller.ts
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
tests/integration/phase3-identity-resolution.test.ts
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
      (id, workspace_id, external_group_id, role, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, 'OWNER', ?, ?, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))`,
    [uuidv7(), workspaceId, Buffer.from("grp-1", "utf8"), userId, userId],
  ));
});
```

The invalid-role insert must otherwise be valid, so it fails on the role constraint rather than missing required fields.

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
       external_group_id VARBINARY(1020) NOT NULL,
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

External group IDs follow the spec's opaque-ID contract. Encode validated strings as UTF-8 bytes for storage and every lookup; decode bytes when returning DTOs. Do not trim, case-fold, or Unicode-normalize IDs. Reject empty/invalid Unicode IDs or IDs exceeding 1020 UTF-8 bytes at the provider/config and group-mapping command boundaries. Use VARBINARY so equality and uniqueness preserve case, accents, and trailing spaces independently of database collation.

Add integration cases mapping `Team-A`, `team-a`, `équipe`, `equipe`, and `Team-A ` separately. A caller carrying one ID must match only that exact grant; duplicate identical bytes in one Workspace must fail the unique constraint.

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

### Task 2: Add fixed capability bundles and trusted identity types

**Files:**
- Create: `src/modules/identity/domain/external-company-identity.ts`
- Create: `src/modules/identity/domain/trusted-identity-claims.ts`
- Create: `src/modules/identity/domain/authenticated-principal.ts`
- Modify: `src/modules/identity/domain/caller-context.ts`
- Create: `src/modules/workspaces/domain/workspace-capability.ts`
- Create: `tests/unit/phase3-workspace-capabilities.test.ts`

**Interfaces:**
- Produces `ExternalCompanyIdentity`, `TrustedIdentityClaims`, `AuthenticatedPrincipal`, `CallerContext`, `PlatformCapability`, `WorkspaceCapability`, `capabilitiesForRole()`.
- `AuthenticatedPrincipal.identity.id` is always the resolved Hub UUID, never an external SSO subject.

- [ ] **Step 1: Write failing unit tests**

```ts
it("keeps OWNER and ADMIN authority distinct", () => {
  expect(capabilitiesForRole("OWNER")).toContain("workspace.archive");
  expect(capabilitiesForRole("OWNER")).toContain("membership.manage_admin");
  expect(capabilitiesForRole("ADMIN")).not.toContain("workspace.archive");
  expect(capabilitiesForRole("ADMIN")).not.toContain("membership.manage_admin");
});

it("copies resolved Hub identity and trusted claims into caller context", () => {
  const caller = callerFromPrincipal({
    identity: hubIdentity,
    validatedExternalGroupIds: ["grp-a"],
    platformCapabilities: ["workspace.create_team"],
    refreshedAt: new Date("2026-09-14T00:00:00Z"),
  });
  expect(caller.identity.id).toBe(hubIdentity.id);
  expect(caller.validatedExternalGroupIds).toEqual(["grp-a"]);
  expect(caller.platformCapabilities).toEqual(["workspace.create_team"]);
});
```

- [ ] **Step 2: Implement identity/principal/context types**

```ts
export type PlatformCapability = "workspace.create_team";

export type ExternalCompanyIdentity = {
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
  identity: UserIdentity; // canonical Hub UUID identity
  validatedExternalGroupIds: readonly string[];
  platformCapabilities: readonly PlatformCapability[];
  refreshedAt: Date;
};

export type CallerContext = AuthenticatedPrincipal;
```

`callerFromPrincipal()` copies only an already-resolved `AuthenticatedPrincipal`. It must not accept external identity input directly.

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
git commit -m "feat: add trusted identity types and workspace capabilities"
```

---

### Task 3: Complete company SSO claims and Hub identity resolution

**Files:**
- Modify: `src/modules/identity/ports/identity-provider.ts`
- Create: `src/modules/identity/ports/company-sso-session-reader.ts`
- Modify: `src/modules/identity/ports/user-repository.ts`
- Create: `src/modules/identity/application/hub-identity-resolver.ts`
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
- `HubIdentityResolver.resolve(externalIdentity: ExternalCompanyIdentity): Promise<UserIdentity>`.

Phase 3 baseline account-link key is trusted `emp_id`, because the existing Hub schema already makes `users.emp_id` unique. External `subject` is retained as trusted claim context but is not written into `users.id`. If subject-based linking becomes required, design an explicit identity-link table later rather than reinterpreting the Hub UUID column.

- [ ] **Step 1: Write failing provider and resolver tests**

Provider tests:

```ts
it("maps trusted company session to external claims and platform grants", async () => {
  const reader = fakeCompanySession({
    externalIdentity: { subject: "oidc-sub-123", emp_id: "E123", name: "Alice", org_code: "ENG" },
    groupIds: ["grp-team-admin", "grp-create-workspace"],
    refreshedAt: new Date("2026-09-14T01:00:00Z"),
  });
  const provider = new CompanySsoIdentityProvider(reader, {
    workspaceCreateTeamGroupIds: new Set(["grp-create-workspace"]),
  });
  const claims = await provider.getCurrentClaims();
  expect(claims.externalIdentity.subject).toBe("oidc-sub-123");
  expect(claims.validatedExternalGroupIds).toEqual(["grp-team-admin", "grp-create-workspace"]);
  expect(claims.platformCapabilities).toEqual(["workspace.create_team"]);
});
```

Resolver integration tests must prove:

```text
existing emp_id -> same existing Hub UUID
profile name/org update -> Hub UUID unchanged
new emp_id -> UUIDv7 generated by Hub
concurrent first login for same emp_id -> one row / one UUID
external subject is never used as users.id
```

Also keep the fail-closed provider test when production company session is unavailable.

- [ ] **Step 2: Change IdentityProvider contract to return trusted external claims**

```ts
export interface IdentityProvider {
  getCurrentClaims(): Promise<TrustedIdentityClaims>;
}
```

The provider authenticates external identity; it does **not** decide canonical Hub user IDs.

- [ ] **Step 3: Implement HubIdentityResolver against the existing users table**

Add repository primitives that do not require a caller-supplied Hub ID:

```ts
findByEmpId(empId: string): Promise<UserIdentity | null>;
insert(identity: UserIdentity): Promise<void>;
updateProfile(userId: string, profile: { name: string; org_code: string }): Promise<void>;
```

Resolver algorithm:

```ts
async resolve(external: ExternalCompanyIdentity): Promise<UserIdentity> {
  return this.uow.run(async (repos) => {
    const existing = await repos.users.findByEmpId(external.emp_id);
    if (existing) {
      await repos.users.updateProfile(existing.id, { name: external.name, org_code: external.org_code });
      return { ...existing, name: external.name, org_code: external.org_code };
    }

    const candidate: UserIdentity = {
      id: uuidv7(),
      emp_id: external.emp_id,
      name: external.name,
      org_code: external.org_code,
    };
    try {
      await repos.users.insert(candidate);
      return candidate;
    } catch (error) {
      if (!isDuplicateEmpId(error)) throw error;
      const winner = await repos.users.findByEmpId(external.emp_id);
      if (!winner) throw error;
      return winner;
    }
  });
}
```

The exact duplicate-key helper may live in infrastructure, but concurrency behavior is part of the contract. Never use `external.subject`, `emp_id`, or OIDC `sub` as the UUID column value.

- [ ] **Step 4: Implement Local and Company providers from server-only trusted config/session**

Company provider validates session/external identity/group IDs and maps configured group IDs to platform capabilities. Local provider may derive equivalent trusted claims from explicit server config for dev/test. Neither provider accepts browser-supplied groups/capabilities.

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

- [ ] **Step 6: Wire composition without building CallerContext yet**

Composition provides `IdentityProvider` + `HubIdentityResolver`. Request bootstrap in Task 7 will compose claims → resolved Hub user → Personal Workspace → `AuthenticatedPrincipal`/CallerContext.

- [ ] **Step 7: Verify**

```bash
npm run test:unit -- tests/unit/phase3-identity-provider.test.ts
npm run test:integration -- --run tests/integration/phase3-identity-resolution.test.ts
npm run typecheck
npm run build
```

- [ ] **Step 8: Commit**

```bash
git add src/modules/identity src/infrastructure/identity src/infrastructure/database/mariadb/repositories/users.ts src/server tests/unit/phase3-identity-provider.test.ts tests/integration/phase3-identity-resolution.test.ts
git commit -m "feat: resolve trusted company identity to hub users"
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

### Task 7: Implement trusted caller bootstrap, idempotent My Space provisioning, and system freeze

**Files:**
- Create: `src/modules/workspaces/application/personal-workspace-service.ts`
- Modify repositories as required
- Create: `src/server/trusted-caller.ts`
- Modify Human Web / API caller establishment and `src/server/composition.ts`
- Create: `scripts/db/backfill-personal-workspaces.ts`
- Modify: `package.json`
- Create: `tests/integration/phase3-personal-workspace.test.ts`

**Interfaces:**
- `ensurePersonalWorkspace(userId): Promise<Workspace>`.
- `freezePersonalWorkspaceSystem(userId, reason, correlationId): Promise<void>`.
- Shared request bootstrap: trusted claims → `HubIdentityResolver` → ensure Personal Workspace → `AuthenticatedPrincipal` → CallerContext.
- `npm run db:backfill-personal-workspaces`: rerunnable existing-user backfill, using the same provisioning service.

- [ ] **Step 1: Write failing Personal/trusted-caller tests**

Test repeated/concurrent provisioning returns same ID, fixed name, one OWNER/SYSTEM_PERSONAL row, second member/group mapping rejected, system freeze audited.

Also test:

- first company login resolves/creates Hub user by trusted `emp_id` before creating its Personal membership;
- external SSO subject never appears in membership/audit `user_id` fields;
- backfill all existing Hub users, then repeat with no new Workspace IDs or duplicate provision audit events;
- direct Team URL and API requests provision My Space without visiting `/`;
- login provisioning racing with backfill still produces one Personal Workspace per Hub user.

- [ ] **Step 2: Implement provision in one transaction**

Lock/query by unique `personal_owner_user_id`; handle duplicate-race by re-read; insert Workspace + membership + audit atomically.

- [ ] **Step 3: Implement system freeze**

Use `Workspace.lockById`, set lifecycle ARCHIVED, append `PERSONAL_WORKSPACE_FROZEN`.

- [ ] **Step 4: Wire the shared trusted caller bootstrap**

```text
IdentityProvider.getCurrentClaims()
→ HubIdentityResolver.resolve(claims.externalIdentity)
→ ensurePersonalWorkspace(hubIdentity.id)
→ AuthenticatedPrincipal {
     identity: hubIdentity,
     validatedExternalGroupIds: claims.validatedExternalGroupIds,
     platformCapabilities: claims.platformCapabilities,
     refreshedAt: claims.refreshedAt
   }
→ callerFromPrincipal(...)
```

Every Human Web/API entry point uses this helper. Do not let individual routes re-resolve external identity, accept a client-provided Hub user id, or rely on `/` navigation for provisioning.

Add `db:backfill-personal-workspaces` to package.json. Enumerate all existing Hub users and invoke the same idempotent Personal provisioning service. Before completed Phase 3 rollout, verify every existing Hub user has exactly one PERSONAL Workspace and OWNER/SYSTEM_PERSONAL membership.

- [ ] **Step 5: Verify**

```bash
npm run test:integration
```

- [ ] **Step 6: Commit**

```bash
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
  const actorAccess = await policy.evaluateWithinTransaction(repos, caller, workspaceId);
  requireDiscoverableWorkspace(actorAccess); // preserve non-enumeration before type/lifecycle errors
  requireActiveTeam(workspace);
  const currentGrant = await loadTargetGrant(repos, workspaceId, target);
  if (currentGrant) requireManageAuthority(actorAccess, currentGrant.role);
  if (requestedRole !== null) requireManageAuthority(actorAccess, requestedRole);
  // requestedRole=null means removal; upsert checks the existing role too
  // mutate membership/group
  // append audit
});
```

For direct membership and group mappings, authority is checked against the persisted grant being changed, not the target user's effective capabilities. Add checks against both beforeRole and afterRole for updates, only afterRole for inserts, and only beforeRole for removals. Never interpret a low requestedRole as permission to demote a privileged grant.

Add negative tests for ADMIN demoting another ADMIN, demoting an OWNER while a second OWNER exists, and downgrading/removing a Group ADMIN mapping (including upsert). Prove these failures leave both grants and audit unchanged. OWNER may perform these transitions subject to the final-owner invariant.

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

### Task 10: Retrofit canonical lock hierarchy into existing Knowledge/Source/import write paths

**Files:**
- Modify current Source/Knowledge command services that mutate Workspace-scoped state
- Modify Phase 2 folder-import upload/finalize/apply flows that currently lock ImportSnapshot
- Modify repository interfaces only where required to expose transaction-scoped Workspace lock
- Create: `tests/integration/phase3-concurrency.test.ts`

**Interfaces:**

```text
Folder import initial apply:
  ImportSnapshot → Workspace → create Source → deeper rows

Folder import resync/apply:
  ImportSnapshot → existing Source → Workspace → deeper rows

Folder import upload/finalize:
  ImportSnapshot → Workspace → staging rows

Non-import existing Source mutation:
  Source → Workspace → deeper rows

Non-import new Source creation:
  Workspace → create Source
```

**Forbidden inversions:** `Workspace → ImportSnapshot` and `Workspace → existing Source`.

- [ ] **Step 1: Write two-connection race/deadlock tests before changing code**

Cover all of these:

1. Initial import apply locks Snapshot, then waits for/locks Workspace; archive never asks for Snapshot and therefore cannot form a cycle.
2. Resync/apply locks Snapshot → Source → Workspace; archive-win causes apply to re-read ARCHIVED and roll back.
3. Upload/finalize locks Snapshot → Workspace; archive-win rejects staging mutation.
4. Non-import Source mutation keeps Source → Workspace.
5. Membership mutation and archive serialize on Workspace lock.
6. Add an explicit regression test that would deadlock if any path acquires Workspace and then waits for a Snapshot already held by a Snapshot-first flow; the implemented paths must complete without lock timeout/deadlock.

- [ ] **Step 2: Add shared Workspace validation helper**

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

This helper acquires only Workspace; the caller is responsible for entering it in the correct outer lock order.

- [ ] **Step 3: Retrofit Phase 2 ImportSnapshot mutation paths first**

Initial apply:

```text
lock ImportSnapshot FOR UPDATE
→ validate snapshot creator/state/binding
→ lock Workspace FOR UPDATE
→ re-evaluate source.manage + ACTIVE
→ insert Source
→ execute plan
```

Resync/apply:

```text
lock ImportSnapshot FOR UPDATE
→ lock bound Source FOR UPDATE
→ verify Source/Workspace binding
→ lock parent Workspace FOR UPDATE
→ re-evaluate source.manage + ACTIVE
→ execute plan
```

Upload/finalize/staging mutation:

```text
lock ImportSnapshot FOR UPDATE
→ lock snapshot.workspaceId Workspace FOR UPDATE
→ re-evaluate capability + ACTIVE
→ mutate staging rows
```

Do not introduce any helper that locks Workspace before loading/locking the ImportSnapshot for these flows.

- [ ] **Step 4: Retrofit non-import existing Source mutation paths**

```text
resolve Source
→ lock Source FOR UPDATE
→ lock Source.workspaceId Workspace FOR UPDATE
→ re-evaluate capability + ACTIVE
→ deeper locks/write
```

Do not lock Workspace then later lock an existing Source.

- [ ] **Step 5: Retrofit non-import new Source creation**

When no ImportSnapshot/Source row exists, lock Workspace first, validate ACTIVE + `source.manage`, then insert.

- [ ] **Step 6: Verify concurrency and regression suites**

```bash
npm run test:integration
npm run typecheck
```

Expected: all Snapshot/Source/Workspace race tests and Phase 1/2 mutation tests pass without deadlock or post-archive mutation commit.

- [ ] **Step 7: Commit**

```bash
git add src/modules src/infrastructure/database tests/integration/phase3-concurrency.test.ts
git commit -m "fix: serialize workspace lifecycle without import lock inversion"
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

Every route reuses Task 7’s shared trusted caller bootstrap: trusted claims → Hub identity resolution → ensurePersonalWorkspace → CallerContext. Never accept identity/group/platform capability fields from request JSON.

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

Reuse Task 7’s shared bootstrap, then resolve the default Knowledge target inside its provisioned My Space only. Root navigation must not be the sole provisioning entry point.

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

Expected: PASS, including Hub identity resolution, bootstrap, SSO/provider, owner invariant, audit, direct+group union, and Snapshot/Source/Workspace archive concurrency races.

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
- browser cannot inject identity/groups/platform capabilities
- external SSO subject/employee identifiers never become users.id directly
- existing emp_id resolves to stable existing Hub UUID
- concurrent first login for one emp_id creates exactly one Hub UUID user
- every existing user is backfilled with one My Space; first-login/deep-link/API bootstrap also provisions it
- external group ID matching and uniqueness use exact UTF-8 bytes
- every Team has direct OWNER >= 1
- group cannot grant OWNER
- ADMIN cannot create governance authority or demote/remove existing OWNER/ADMIN grants
- other-user group access is never fabricated
- import lock order is ImportSnapshot → [Source] → Workspace; no Workspace → ImportSnapshot inversion exists
- non-import existing Source lock order remains Source → Workspace
- archive and content/import/governance writes serialize on Workspace row
- archived ordinary writes/governance fail
- system recovery is not exposed via normal HTTP/UI and is audited
- Source/Document IDs survive Phase 3 migration
- no Source/Document ACL columns were added
```

- [ ] **Step 5: Write verification report**

Include command outputs/summary, Hub identity resolution evidence, migration/bootstrap evidence, two-connection race/deadlock evidence, provider selection evidence, and final acceptance checklist.

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
| Company SSO transport + Hub UUID resolution | 3, 7 |
| Explicit legacy owner bootstrap/readiness | 4 |
| Direct + group capability union | 6 |
| OWNER/ADMIN governance | 8, 9 |
| Team direct OWNER >= 1 | 4, 9 |
| Workspace-only ACL | 6, 10 |
| Archive/read-only semantics | 8, 9, 10 |
| Snapshot/Source/Workspace lock hierarchy | 5, 10 |
| Archive/write concurrency serialization | 5, 10 |
| System-only stranded governance recovery | 8 |
| Atomic audit | 5, 7, 8, 9 |
| Truthful effective-access inspection | 11, 12 |
| Grouped selector / admin UI | 12 |
| Full acceptance | 13 |

Plan complete. Execution should start only after this documentation PR is merged.