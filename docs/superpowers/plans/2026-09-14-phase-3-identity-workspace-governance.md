# Phase 3 Identity, Workspace Administration & Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Phase 0–2 binary WorkspaceMembership foundation into production Workspace governance with Personal `My Space`, fixed RBAC, direct + SSO-group grants, lifecycle enforcement, atomic audit, and the Phase 2.5 governance UI without changing canonical Knowledge identity.

**Architecture:** Keep `Workspace → KnowledgeSource → Tree/Document/Revision` as the only Knowledge ownership path. Add Phase 3 governance inside the existing `workspaces` module, use capability evaluation as the shared authorization boundary, keep external group membership in trusted `CallerContext`, and make all governance mutations + audit append run inside the existing READ COMMITTED `MariaDbUnitOfWork` transaction. Existing Knowledge/Source services continue to resolve authorization through `workspaceAccess`; they do not gain personal/team special cases.

**Tech Stack:** Next.js 15.5, React 19, TypeScript 5.7, MariaDB 10.11 native `UUID`, Vitest, Playwright, existing modular-monolith application/ports/infrastructure layout.

**Spec:** `docs/superpowers/specs/2026-09-14-phase-3-identity-workspace-governance-design.md`

## Global Constraints

- Personal Space is `Workspace(type=PERSONAL)`, not a second domain.
- Personal Workspace canonical display name is exactly `My Space` and is not user-renamable.
- Fixed assignable roles are exactly `OWNER | ADMIN | EDITOR | VIEWER`; there is no assignable `DISCOVERER` role.
- Every assignable role includes Knowledge read; discover/read remain independently modeled for 404/403 semantics.
- Team Workspace must always retain at least one **direct** OWNER.
- SSO Group mappings may grant only `ADMIN | EDITOR | VIEWER`; never OWNER.
- Effective capabilities are the union of direct membership + all matched validated group mappings; Phase 3 has no explicit deny.
- OWNER can manage OWNER/ADMIN/EDITOR/VIEWER and Team lifecycle. ADMIN can manage only EDITOR/VIEWER and `Group → EDITOR|VIEWER`.
- Workspace is the only Phase 3 Knowledge authorization boundary; do not add Source or Document ACL columns.
- Archived Team Workspace remains readable to authorized callers but blocks Source/Knowledge/governance mutations; only OWNER can restore.
- Governance mutation and audit append must commit/rollback atomically.
- `org_code`, Workspace name, route IDs, owner metadata, or raw browser-supplied groups are never authorization proof.
- Existing Workspace/Source/Document/Revision stable IDs and `/w/:workspaceId/...` routes remain canonical.
- No hard delete, invite workflow, pending user entity, custom-role DSL, personal-to-team synchronization, or Agent principal work in Phase 3.

---

## File Structure Map

Create or extend these focused units rather than growing `workspace-query-service.ts` into a governance god object:

```text
src/modules/identity/domain/caller-context.ts
  trusted identity + validated external group IDs

src/modules/workspaces/domain/
  workspace.ts                 Workspace type/lifecycle model
  workspace-membership.ts      fixed role + membership provenance
  workspace-capability.ts      role bundles + capability helpers
  workspace-group-mapping.ts   external group grant model
  workspace-audit-event.ts     append-only governance event model
  errors.ts                    governance/lifecycle errors

src/modules/workspaces/application/
  workspace-query-service.ts        accessible listing + effective access views
  workspace-authorization.ts        discover/read/capability evaluation
  personal-workspace-service.ts     idempotent My Space provisioning/freeze
  team-workspace-service.ts         create/rename/archive/restore
  workspace-membership-service.ts   direct member + group mapping governance
  platform-access-policy.ts         platform-level workspace.create_team port/implementation seam

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

src/server/
  composition.ts
  workspace-admin.ts
  knowledge-read.ts
  source-read.ts
  source-imports.ts

src/app/
  page.tsx
  w/[workspaceId]/layout.tsx
  w/[workspaceId]/settings/page.tsx
  api/workspaces/... governance route handlers

src/components/shell/workspace-selector.tsx
src/components/workspaces/workspace-admin-page.tsx
src/components/workspaces/member-table.tsx
src/components/workspaces/group-mapping-table.tsx
src/components/workspaces/audit-list.tsx

tests/unit/phase3-workspace-capabilities.test.ts
tests/unit/phase3-workspace-admin-policy.test.ts
tests/integration/phase3-schema.test.ts
tests/integration/phase3-personal-workspace.test.ts
tests/integration/phase3-authorization.test.ts
tests/integration/phase3-team-governance.test.ts
tests/integration/phase3-audit.test.ts
tests/e2e/phase3-workspace-governance.spec.ts
```

---

### Task 1: Add Phase 3 schema and fixed governance domain types

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
- Produces DB tables/columns used by all later tasks.

- [ ] **Step 1: Write the failing schema integration tests**

Create assertions that migration 008 produces the exact Phase 3 shape and that existing IDs survive migration:

```ts
it("adds Phase 3 workspace governance schema without replacing existing workspace ids", async () => {
  const workspaceId = uuidv7();
  await pool.query("INSERT INTO workspaces (id, name) VALUES (?, 'Existing')", [workspaceId]);

  await runMigrations(pool);

  const [workspace] = await pool.query<any[]>(
    "SELECT id, workspace_type, lifecycle_state, personal_owner_user_id FROM workspaces WHERE id = ?",
    [workspaceId],
  );
  expect(workspace.id).toBe(workspaceId);
  expect(workspace.workspace_type).toBe("TEAM");
  expect(workspace.lifecycle_state).toBe("ACTIVE");
  expect(workspace.personal_owner_user_id).toBeNull();
});

it("rejects OWNER in workspace_group_mappings", async () => {
  await expectDatabaseConstraintFailure(() => pool.query(
    `INSERT INTO workspace_group_mappings
      (workspace_id, external_group_id, role, created_by)
     VALUES (?, 'grp-1', 'OWNER', ?)`,
    [workspaceId, userId],
  ));
});
```

Also assert:
- `UNIQUE(personal_owner_user_id)` allows many TEAM NULLs but rejects two Personal rows for one user.
- PERSONAL requires `personal_owner_user_id` and `name='My Space'`.
- TEAM requires `personal_owner_user_id IS NULL`.
- membership role only allows OWNER/ADMIN/EDITOR/VIEWER.
- membership source only allows DIRECT/SYSTEM_PERSONAL.
- audit table has no mutable lifecycle columns and stores JSON payload.

- [ ] **Step 2: Run the schema test and verify it fails before migration 008 exists**

Run:

```bash
npm run test:integration -- --run tests/integration/phase3-schema.test.ts
```

Expected: FAIL because Phase 3 columns/tables are missing.

- [ ] **Step 3: Implement migration 008 with explicit backfill order**

The migration must add nullable/default-compatible columns first, backfill existing Workspace rows to TEAM, then apply final checks/indexes. Use the migration format already used in `006-phase-2-import-staging.ts`.

Core SQL shape:

```ts
export const phase3WorkspaceGovernanceMigration: Migration = {
  version: 8,
  name: "phase-3-workspace-governance",
  statements: [
    `ALTER TABLE workspaces
       ADD COLUMN workspace_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
       ADD COLUMN personal_owner_user_id UUID NULL,
       ADD COLUMN lifecycle_state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
       ADD COLUMN created_by UUID NULL,
       ADD COLUMN archived_by UUID NULL,
       ADD COLUMN archived_at DATETIME(6) NULL`,
    `UPDATE workspaces SET workspace_type = 'TEAM' WHERE workspace_type IS NULL`,
    `ALTER TABLE workspaces MODIFY workspace_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL`,
    `ALTER TABLE workspace_memberships
       ADD COLUMN role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
       ADD COLUMN membership_source VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NULL,
       ADD COLUMN created_by UUID NULL,
       ADD COLUMN updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)`,
    // Existing membership role backfill is intentionally performed by explicit bootstrap config in Task 3.
    `CREATE TABLE workspace_group_mappings (...) ENGINE=InnoDB ...`,
    `CREATE TABLE workspace_audit_events (...) ENGINE=InnoDB ...`,
  ],
};
```

Do **not** infer OWNER from first row, org_code, name, or member count. Migration 008 may temporarily leave pre-Phase-3 Team memberships with null role until Task 3's explicit bootstrap/backfill command assigns them; application startup must not enable production Phase 3 authorization until that bootstrap has completed.

- [ ] **Step 4: Update domain types to match the schema exactly**

```ts
export type WorkspaceType = "PERSONAL" | "TEAM";
export type WorkspaceLifecycleState = "ACTIVE" | "ARCHIVED";

export type Workspace = {
  id: string;
  name: string;
  workspaceType: WorkspaceType;
  personalOwnerUserId: string | null;
  lifecycleState: WorkspaceLifecycleState;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedBy: string | null;
  archivedAt: Date | null;
};
```

```ts
export type WorkspaceRole = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
export type WorkspaceMembershipSource = "DIRECT" | "SYSTEM_PERSONAL";

export type WorkspaceMembership = {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  membershipSource: WorkspaceMembershipSource;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};
```

- [ ] **Step 5: Register migration 008 and run schema tests**

Run:

```bash
npm run test:integration -- --run tests/integration/phase3-schema.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/database/mariadb/migrations src/modules/workspaces/domain tests/integration/phase3-schema.test.ts
git commit -m "feat: add phase 3 workspace governance schema"
```

---

### Task 2: Introduce fixed capability bundles and trusted external groups in CallerContext

**Files:**
- Modify: `src/modules/identity/domain/caller-context.ts`
- Create: `src/modules/workspaces/domain/workspace-capability.ts`
- Create: `tests/unit/phase3-workspace-capabilities.test.ts`

**Interfaces:**
- Produces `WorkspaceCapability` and `capabilitiesForRole(role)`.
- Extends `CallerContext.validatedExternalGroupIds: readonly string[]`.

- [ ] **Step 1: Write capability-bundle unit tests**

```ts
it("keeps OWNER and ADMIN governance authority distinct", () => {
  expect(capabilitiesForRole("OWNER")).toEqual(expect.arrayContaining([
    "workspace.rename",
    "workspace.archive",
    "workspace.restore",
    "membership.manage_owner",
    "membership.manage_admin",
    "membership.manage_basic",
    "audit.read",
  ]));

  expect(capabilitiesForRole("ADMIN")).not.toContain("workspace.archive");
  expect(capabilitiesForRole("ADMIN")).not.toContain("membership.manage_owner");
  expect(capabilitiesForRole("ADMIN")).not.toContain("membership.manage_admin");
});

it.each(["OWNER", "ADMIN", "EDITOR", "VIEWER"] as const)("%s includes document.read", (role) => {
  expect(capabilitiesForRole(role)).toContain("document.read");
});
```

- [ ] **Step 2: Implement exact capability names from the spec**

```ts
export type WorkspaceCapability =
  | "workspace.discover"
  | "source.discover"
  | "document.discover"
  | "document.read"
  | "document.write"
  | "source.manage"
  | "membership.manage_basic"
  | "membership.manage_admin"
  | "membership.manage_owner"
  | "workspace.rename"
  | "workspace.archive"
  | "workspace.restore"
  | "audit.read";
```

Return immutable arrays/sets; do not expose a mutable global bundle.

- [ ] **Step 3: Extend CallerContext without trusting browser input**

```ts
export type CallerContext = {
  identity: UserIdentity;
  validatedExternalGroupIds: readonly string[];
};

export function callerFromIdentity(
  identity: UserIdentity,
  validatedExternalGroupIds: readonly string[] = [],
): CallerContext {
  return {
    identity: { ...identity },
    validatedExternalGroupIds: [...new Set(validatedExternalGroupIds)],
  };
}
```

Only identity adapters/server composition may populate these IDs. Route bodies must never accept a replacement group list.

- [ ] **Step 4: Run unit/type tests**

```bash
npm run test:unit -- --run tests/unit/phase3-workspace-capabilities.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/domain/caller-context.ts src/modules/workspaces/domain/workspace-capability.ts tests/unit/phase3-workspace-capabilities.test.ts
git commit -m "feat: define workspace capability bundles"
```

---

### Task 3: Add Phase 3 repositories, UoW wiring, and explicit Team role bootstrap

**Files:**
- Modify: `src/modules/workspaces/ports/workspace-repository.ts`
- Modify: `src/modules/workspaces/ports/workspace-membership-repository.ts`
- Create: `src/modules/workspaces/ports/workspace-group-mapping-repository.ts`
- Create: `src/modules/workspaces/ports/workspace-audit-repository.ts`
- Modify: `src/modules/workspaces/ports/unit-of-work.ts`
- Modify: `src/modules/sources/ports/unit-of-work.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/workspaces.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/workspace-memberships.ts`
- Create: `src/infrastructure/database/mariadb/repositories/workspace-group-mappings.ts`
- Create: `src/infrastructure/database/mariadb/repositories/workspace-audit-events.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/index.ts`
- Modify: `src/infrastructure/database/mariadb/transaction.ts`
- Create: `scripts/db/bootstrap-phase3-workspace-roles.ts`
- Modify: `package.json`
- Create: `tests/integration/phase3-repositories.test.ts`

**Interfaces:**
- Produces transactional repositories used by policy and governance services.
- Adds explicit `db:bootstrap-phase3` command; no heuristic role elevation.

- [ ] **Step 1: Write repository integration tests for direct + group grants and owner locking**

Test these exact repository behaviors:

```ts
const direct = await repositories.workspaceMemberships.find(workspaceId, userId);
const groups = await repositories.workspaceGroupMappings.listForWorkspaceAndExternalGroups(
  workspaceId,
  ["grp-editor", "grp-viewer"],
);
const ownerCount = await repositories.workspaceMemberships.countDirectOwnersForUpdate(workspaceId);
```

Also assert `listAccessibleForCaller(userId, externalGroups)` returns a Team workspace when the only grant is a matched group mapping.

- [ ] **Step 2: Expand ports with mutation/locking methods needed by the spec**

Use focused signatures rather than generic SQL-shaped APIs:

```ts
export interface WorkspaceMembershipRepository {
  find(workspaceId: string, userId: string): Promise<WorkspaceMembership | null>;
  listDirectForWorkspace(workspaceId: string): Promise<WorkspaceMembership[]>;
  insert(membership: WorkspaceMembership): Promise<void>;
  updateRole(workspaceId: string, userId: string, role: WorkspaceRole, updatedAt: Date): Promise<void>;
  remove(workspaceId: string, userId: string): Promise<void>;
  countDirectOwnersForUpdate(workspaceId: string): Promise<number>;
}
```

```ts
export interface WorkspaceGroupMappingRepository {
  find(workspaceId: string, externalGroupId: string): Promise<WorkspaceGroupMapping | null>;
  listForWorkspace(workspaceId: string): Promise<WorkspaceGroupMapping[]>;
  listForWorkspaceAndExternalGroups(workspaceId: string, externalGroupIds: readonly string[]): Promise<WorkspaceGroupMapping[]>;
  insert(mapping: WorkspaceGroupMapping): Promise<void>;
  updateRole(workspaceId: string, externalGroupId: string, role: Exclude<WorkspaceRole, "OWNER">, actorId: string): Promise<void>;
  remove(workspaceId: string, externalGroupId: string): Promise<void>;
}
```

```ts
export interface WorkspaceAuditRepository {
  append(event: WorkspaceAuditEvent): Promise<void>;
  listForWorkspace(workspaceId: string, limit: number, before?: Date): Promise<WorkspaceAuditEvent[]>;
}
```

- [ ] **Step 3: Implement MariaDB repositories and map all Phase 3 columns explicitly**

Avoid `SELECT *`; name fields so mapping failures are visible during schema evolution.

- [ ] **Step 4: Wire repositories into the existing transaction factory**

`createRepositories(connection)` must create one set of repositories on the same connection so governance mutations and audit append share the same DB transaction.

Update the relevant `SourceRepositories`/Workspace UoW type rather than creating a separate nested transaction abstraction.

- [ ] **Step 5: Add explicit bootstrap command for pre-Phase-3 Team membership roles**

The command must require a configuration file or environment JSON mapping exact `(workspaceId,userId) → role`; it must reject any existing Team membership omitted from the bootstrap map.

Example accepted input:

```json
{
  "memberships": [
    {"workspaceId":"019...","userId":"019...","role":"OWNER"},
    {"workspaceId":"019...","userId":"019...","role":"EDITOR"}
  ]
}
```

It must **not** infer from `org_code`, row order, names, or counts.

- [ ] **Step 6: Run repository and existing integration tests**

```bash
npm run test:integration -- --run tests/integration/phase3-repositories.test.ts
npm run test:integration
npm run typecheck
```

Expected: all PASS after test fixtures are updated to create explicit membership roles.

- [ ] **Step 7: Commit**

```bash
git add src/modules/workspaces/ports src/modules/sources/ports src/infrastructure/database/mariadb scripts/db package.json tests/integration/phase3-repositories.test.ts
git commit -m "feat: add workspace governance repositories"
```

---

### Task 4: Replace binary membership checks with capability-based Workspace authorization

**Files:**
- Create: `src/modules/workspaces/application/workspace-authorization.ts`
- Modify: `src/modules/workspaces/ports/workspace-access-policy.ts`
- Modify: `src/modules/workspaces/application/workspace-query-service.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/index.ts`
- Create: `tests/integration/phase3-authorization.test.ts`
- Create: `tests/unit/phase3-workspace-admin-policy.test.ts`

**Interfaces:**
- Produces `WorkspaceAuthorizationService.evaluate(caller, workspaceId)`.
- Produces `WorkspaceAccessPolicy.requireCapability(caller, workspaceId, capability)`.
- Produces accessible Workspace views with type/lifecycle/effective grant data needed by server/UI.

- [ ] **Step 1: Write failing authorization tests for direct, group, union, 404/403, and same/cross-org rules**

```ts
it("unions direct VIEWER and group EDITOR capabilities", async () => {
  const decision = await authorization.evaluate(callerWithGroups(user, ["grp-editors"]), workspaceId);
  expect(decision.capabilities).toContain("document.write");
  expect(decision.grants).toEqual(expect.arrayContaining([
    expect.objectContaining({ source: "DIRECT", role: "VIEWER" }),
    expect.objectContaining({ source: "SSO_GROUP", role: "EDITOR", externalGroupId: "grp-editors" }),
  ]));
});

it("same org without a grant remains undiscoverable", async () => {
  await expect(workspaceAccess.requireCapability(callerSameOrgNoGrant, workspaceId, "document.read"))
    .rejects.toMatchObject({ code: "NOT_FOUND" });
});
```

Preserve the already accepted discover/read behavior: a trusted discoverability state without read must map to ACCESS_DENIED, while an unknown/undiscoverable resource maps to NOT_FOUND.

- [ ] **Step 2: Implement the authorization decision model**

```ts
export type WorkspaceGrant =
  | { source: "DIRECT"; role: WorkspaceRole }
  | { source: "SSO_GROUP"; role: Exclude<WorkspaceRole, "OWNER">; externalGroupId: string };

export type WorkspaceAuthorizationDecision = {
  workspaceId: string;
  discoverable: boolean;
  capabilities: ReadonlySet<WorkspaceCapability>;
  grants: readonly WorkspaceGrant[];
};
```

`evaluate()` must load the Workspace, direct membership, and matched mappings from trusted `caller.validatedExternalGroupIds`, then union role bundles. Do not accept workspace role/group IDs from request payloads.

- [ ] **Step 3: Replace `WorkspaceMembershipPolicy.requireMembership` with capability policy**

```ts
export interface WorkspaceAccessPolicy {
  requireDiscover(caller: CallerContext, workspaceId: string): Promise<void>;
  requireCapability(
    caller: CallerContext,
    workspaceId: string,
    capability: WorkspaceCapability,
  ): Promise<void>;
}
```

Existing Knowledge/Source call sites that only require read should use `document.read` or the narrowest appropriate capability; Source/import mutations use `source.manage`.

- [ ] **Step 4: Upgrade `WorkspaceQueryService.listWorkspaces`**

Return only accessible Workspaces from personal/direct/group grants and enough fields for selector grouping:

```ts
export type WorkspaceView = {
  id: string;
  name: string;
  workspaceType: "PERSONAL" | "TEAM";
  lifecycleState: "ACTIVE" | "ARCHIVED";
};
```

Sort PERSONAL first, then TEAM by deterministic name order.

- [ ] **Step 5: Run authorization regression tests**

```bash
npm run test:unit -- --run tests/unit/phase3-workspace-admin-policy.test.ts
npm run test:integration -- --run tests/integration/phase3-authorization.test.ts
npm run test:integration -- --run tests/integration/phase1-workspace-access.test.ts
npm run typecheck
```

Expected: PASS and existing resource-ID bypass tests remain green.

- [ ] **Step 6: Commit**

```bash
git add src/modules/workspaces src/infrastructure/database/mariadb/repositories/index.ts tests/unit/phase3-workspace-admin-policy.test.ts tests/integration/phase3-authorization.test.ts
git commit -m "feat: evaluate workspace access by capabilities"
```

---

### Task 5: Provision exactly one system-managed `My Space` per user

**Files:**
- Create: `src/modules/workspaces/application/personal-workspace-service.ts`
- Modify: `src/modules/workspaces/ports/workspace-repository.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/workspaces.ts`
- Modify: `src/modules/identity/application/get-current-identity.ts` or the nearest trusted server bootstrap caller
- Modify: `src/server/composition.ts`
- Create: `scripts/db/backfill-personal-workspaces.ts`
- Modify: `package.json`
- Create: `tests/integration/phase3-personal-workspace.test.ts`

**Interfaces:**
- Produces `ensurePersonalWorkspace(userId, actor)` idempotently.
- Produces system-only `freezePersonalWorkspace(userId, reason, correlationId?)`.

- [ ] **Step 1: Write failing personal-workspace tests**

Cover:

```ts
const first = await service.ensurePersonalWorkspace(user.id);
const second = await service.ensurePersonalWorkspace(user.id);
expect(second.id).toBe(first.id);
```

And verify:
- exactly one PERSONAL Workspace per owner;
- exact name `My Space`;
- exactly one `OWNER/SYSTEM_PERSONAL` membership;
- normal direct member insert/mapping/rename/archive path rejects PERSONAL;
- system freeze marks lifecycle ARCHIVED and appends `PERSONAL_WORKSPACE_FROZEN`;
- no ownership transfer or user restore API exists.

- [ ] **Step 2: Implement idempotent provisioning in one transaction**

Use the DB uniqueness constraint as the final race guard. The service sequence is:

```ts
await uow.run(async (repos) => {
  const existing = await repos.workspaces.findPersonalByOwner(userId);
  if (existing) return existing;

  const workspace = makePersonalWorkspace(userId, uuidv7());
  await repos.workspaces.insert(workspace);
  await repos.workspaceMemberships.insert(makeSystemPersonalOwnerMembership(workspace.id, userId));
  await repos.workspaceAudit.append(personalProvisionedEvent(workspace.id, userId));
  return workspace;
});
```

On a concurrent unique-owner race, reload and return the existing Personal Workspace rather than creating a second one.

- [ ] **Step 3: Ensure trusted user bootstrap provisions My Space**

After `users.upsertIdentity(caller.identity)` succeeds in the trusted identity/bootstrap path, call `ensurePersonalWorkspace(caller.identity.id)` exactly once per request/session bootstrap. Do not let browser code pass an owner user ID.

- [ ] **Step 4: Add rerunnable existing-user backfill command**

`npm run db:backfill-personal-workspaces` must enumerate existing users and call the same idempotent service. Re-running it produces no new Personal Workspace IDs.

- [ ] **Step 5: Run tests**

```bash
npm run test:integration -- --run tests/integration/phase3-personal-workspace.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/workspaces/application/personal-workspace-service.ts src/modules/workspaces/ports src/infrastructure/database/mariadb/repositories/workspaces.ts src/modules/identity src/server/composition.ts scripts/db package.json tests/integration/phase3-personal-workspace.test.ts
git commit -m "feat: provision system managed my space"
```

---

### Task 6: Implement Team Workspace create/rename/archive/restore with platform policy and atomic audit

**Files:**
- Create: `src/modules/workspaces/application/platform-access-policy.ts`
- Create: `src/modules/workspaces/application/team-workspace-service.ts`
- Modify: `src/modules/workspaces/domain/errors.ts`
- Modify: `src/server/composition.ts`
- Create: `tests/integration/phase3-team-governance.test.ts`

**Interfaces:**
- Produces `PlatformAccessPolicy.require(caller, "workspace.create_team")`.
- Produces `TeamWorkspaceService.createTeam`, `renameTeam`, `archiveTeam`, `restoreTeam`.

- [ ] **Step 1: Write failing lifecycle and platform-policy tests**

```ts
await expect(service.createTeam(unprivilegedCaller, { name: "HRKM" }))
  .rejects.toMatchObject({ code: "ACCESS_DENIED" });

const workspace = await service.createTeam(privilegedCaller, { name: "HRKM" });
expect(await memberships.find(workspace.id, privilegedCaller.identity.id))
  .toMatchObject({ role: "OWNER", membershipSource: "DIRECT" });
```

Also verify ADMIN cannot rename/archive/restore; OWNER can; archived lifecycle is retained on read; audit row exists in same committed transaction.

- [ ] **Step 2: Implement an explicit deployment-owned platform policy**

For local/dev, configuration may enumerate employee IDs allowed to create Team Workspaces. Keep it behind the interface:

```ts
export type PlatformCapability = "workspace.create_team";

export interface PlatformAccessPolicy {
  require(caller: CallerContext, capability: PlatformCapability): Promise<void>;
}
```

Do not derive this from Workspace roles or `org_code`.

- [ ] **Step 3: Implement Team create transaction**

```ts
await platformPolicy.require(caller, "workspace.create_team");
return uow.run(async (repos) => {
  const workspace = createTeamWorkspace(input.name, caller.identity.id);
  await repos.workspaces.insert(workspace);
  await repos.workspaceMemberships.insert({
    workspaceId: workspace.id,
    userId: caller.identity.id,
    role: "OWNER",
    membershipSource: "DIRECT",
    createdBy: caller.identity.id,
    createdAt: now,
    updatedAt: now,
  });
  await repos.workspaceAudit.append(teamWorkspaceCreatedEvent(workspace, caller.identity.id));
  return workspace;
});
```

- [ ] **Step 4: Implement OWNER-only rename/archive/restore**

Before mutation, call `workspaceAccess.requireCapability` with the exact capability. Reject PERSONAL type. On archive set lifecycle/provenance; on restore clear archived provenance. Append typed before/after audit payload inside the same transaction.

- [ ] **Step 5: Run lifecycle tests**

```bash
npm run test:integration -- --run tests/integration/phase3-team-governance.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/workspaces/application src/modules/workspaces/domain/errors.ts src/server/composition.ts tests/integration/phase3-team-governance.test.ts
git commit -m "feat: add team workspace lifecycle governance"
```

---

### Task 7: Implement direct membership and SSO Group administration with OWNER/ADMIN authority rules

**Files:**
- Create: `src/modules/workspaces/application/workspace-membership-service.ts`
- Modify: `src/modules/workspaces/domain/errors.ts`
- Extend: `tests/integration/phase3-team-governance.test.ts`
- Extend: `tests/integration/phase3-audit.test.ts`

**Interfaces:**
- Produces member/group commands and effective access inspection.

- [ ] **Step 1: Write failing authority-matrix tests**

Cover the full spec matrix:

```ts
await expect(admin.addDirectMember(workspaceId, targetUserId, "ADMIN"))
  .rejects.toMatchObject({ code: "WORKSPACE_ROLE_GRANT_DENIED" });

await owner.addDirectMember(workspaceId, targetUserId, "ADMIN");
expect(await memberships.find(workspaceId, targetUserId)).toMatchObject({ role: "ADMIN" });

await expect(admin.upsertGroupMapping(workspaceId, "grp", "ADMIN"))
  .rejects.toMatchObject({ code: "WORKSPACE_ROLE_GRANT_DENIED" });
```

Also verify:
- Group OWNER rejected even for OWNER caller.
- ADMIN may manage EDITOR/VIEWER direct + group grants.
- Personal Workspace rejects all normal membership/group operations.
- Direct target must already exist in `users`.
- Archived Workspace rejects all membership/group mutations.

- [ ] **Step 2: Implement final-direct-OWNER protection under row lock**

For any removal/demotion of a direct OWNER:

```ts
const ownerCount = await repos.workspaceMemberships.countDirectOwnersForUpdate(workspaceId);
if (current.role === "OWNER" && nextRole !== "OWNER" && ownerCount <= 1) {
  throw new LastWorkspaceOwnerError();
}
```

Run this check and the mutation in the same transaction. Group ADMINs never count toward the direct OWNER invariant.

- [ ] **Step 3: Implement role-grant authority centrally**

Do not duplicate role comparison conditionals in route handlers. Use helpers such as:

```ts
function assertCanManageTargetRole(
  actorCapabilities: ReadonlySet<WorkspaceCapability>,
  targetRole: WorkspaceRole,
): void {
  if (targetRole === "OWNER") requireCapability(actorCapabilities, "membership.manage_owner");
  else if (targetRole === "ADMIN") requireCapability(actorCapabilities, "membership.manage_admin");
  else requireCapability(actorCapabilities, "membership.manage_basic");
}
```

- [ ] **Step 4: Append deterministic audit events for every mutation**

Membership payload example:

```json
{
  "userId": "019...",
  "beforeRole": "VIEWER",
  "afterRole": "EDITOR"
}
```

Group payload example:

```json
{
  "externalGroupId": "HRKM-Team",
  "beforeRole": null,
  "afterRole": "EDITOR"
}
```

- [ ] **Step 5: Add effective access inspection API at application layer**

Return direct grant + matched groups + effective capabilities; never persist `effective_role`.

- [ ] **Step 6: Run governance tests**

```bash
npm run test:integration -- --run tests/integration/phase3-team-governance.test.ts
npm run test:integration -- --run tests/integration/phase3-audit.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/workspaces/application/workspace-membership-service.ts src/modules/workspaces/domain/errors.ts tests/integration/phase3-team-governance.test.ts tests/integration/phase3-audit.test.ts
git commit -m "feat: govern workspace members and group grants"
```

---

### Task 8: Enforce archived-state and capability checks through existing Knowledge/Source/import services

**Files:**
- Modify: `src/modules/knowledge/application/hub-knowledge-command-service.ts`
- Modify: `src/modules/knowledge/application/knowledge-query-service.ts`
- Modify: `src/modules/sources/application/source-version-guard.ts`
- Modify: Phase 2 import application services under `src/modules/sources/application/`
- Modify: `src/server/knowledge-read.ts`
- Modify: `src/server/source-read.ts`
- Modify: `src/server/source-imports.ts`
- Extend: `tests/integration/phase1-workspace-access.test.ts`
- Create: `tests/integration/phase3-lifecycle-enforcement.test.ts`

**Interfaces:**
- Existing read/write services reuse `WorkspaceAccessPolicy`; they do not implement RBAC themselves.

- [ ] **Step 1: Write lifecycle-enforcement tests before changing services**

Verify an archived Team Workspace:
- still permits `document.read` for authorized callers;
- rejects Folder Import create/upload/finalize/apply;
- rejects Source mutation;
- rejects HUB_MANAGED Knowledge mutation;
- does not turn lifecycle errors into 404 membership failures.

- [ ] **Step 2: Add a shared mutation-state guard**

Create one helper in the workspaces module:

```ts
export function assertWorkspaceAllowsMutation(workspace: Workspace): void {
  if (workspace.lifecycleState === "ARCHIVED") throw new WorkspaceArchivedError();
}
```

Call it after authorization and before mutating Source/Knowledge state. Reads intentionally skip this guard.

- [ ] **Step 3: Replace remaining binary membership calls with narrow capabilities**

Examples:

```ts
await workspaceAccess.requireCapability(caller, workspaceId, "document.read");
await workspaceAccess.requireCapability(caller, workspaceId, "document.write");
await workspaceAccess.requireCapability(caller, workspaceId, "source.manage");
```

Do not infer authorization from the route workspace ID; resolve Source → Workspace as the existing services already do.

- [ ] **Step 4: Preserve SOURCE_MANAGED/HUB_MANAGED ownership guards**

Capability authorization happens first; ownership authority still decides whether a particular content mutation is legal. Add regression tests proving OWNER cannot bypass SOURCE_MANAGED read-only semantics.

- [ ] **Step 5: Run Phase 1/2 regressions plus new lifecycle tests**

```bash
npm run test:integration -- --run tests/integration/phase3-lifecycle-enforcement.test.ts
npm run test:integration -- --run tests/integration/phase1-workspace-access.test.ts
npm run test:integration -- --run tests/integration/phase2-import-apply.test.ts
npm run test:integration
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/knowledge src/modules/sources src/server tests/integration
git commit -m "feat: enforce phase 3 workspace policy on knowledge writes"
```

---

### Task 9: Expose governance application services through server adapters and HTTP error mapping

**Files:**
- Create: `src/server/workspace-admin.ts`
- Modify: `src/server/http-error-response.ts`
- Modify: `src/server/composition.ts`
- Create: `src/app/api/workspaces/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/members/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/members/[userId]/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/groups/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/groups/[externalGroupId]/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/audit/route.ts`
- Create: `tests/integration/phase3-http-governance.test.ts`

**Interfaces:**
- HTTP layer parses input and maps application errors only; all authorization stays in application services.

- [ ] **Step 1: Write API-level integration tests for server-controlled identity and stable machine-readable errors**

Test that request bodies containing fake `role`, `org_code`, or `validatedExternalGroupIds` cannot alter caller authorization. The only group set comes from the trusted identity adapter/session.

- [ ] **Step 2: Define narrow request DTOs**

Examples:

```ts
type CreateTeamWorkspaceRequest = { name: string };
type AddDirectMemberRequest = { userId: string; role: WorkspaceRole };
type UpsertGroupMappingRequest = { externalGroupId: string; role: "ADMIN" | "EDITOR" | "VIEWER" };
```

No caller ID, owner ID, org code, or external group membership list belongs in these bodies.

- [ ] **Step 3: Map governance domain errors to deterministic HTTP envelopes**

Add codes such as:

```text
WORKSPACE_ARCHIVED          -> 409
WORKSPACE_ROLE_GRANT_DENIED -> 403
WORKSPACE_LAST_OWNER        -> 409
WORKSPACE_TYPE_FORBIDDEN    -> 409
WORKSPACE_NOT_FOUND         -> 404
ACCESS_DENIED               -> 403
```

Preserve the accepted non-enumeration rules for undiscoverable resources.

- [ ] **Step 4: Build `workspace-admin.ts` as the route-facing façade**

It obtains current CallerContext, calls application services, and returns serializable views. Do not call repositories directly from route handlers.

- [ ] **Step 5: Run HTTP tests**

```bash
npm run test:integration -- --run tests/integration/phase3-http-governance.test.ts
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server src/app/api/workspaces tests/integration/phase3-http-governance.test.ts
git commit -m "feat: expose workspace governance api"
```

---

### Task 10: Make `/` Personal-first and group the Workspace selector without adding a second route model

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/shell/workspace-selector.tsx`
- Modify: `src/server/knowledge-read.ts`
- Modify: shell-model types used by `src/components/shell/app-shell.tsx`
- Create/extend unit/component tests under `tests/unit/`
- Extend: `tests/e2e/phase3-workspace-governance.spec.ts`

**Interfaces:**
- `/` always chooses the caller's Personal Workspace first.
- Selector remains `/w/:workspaceId/...` navigation for both Personal and Team.

- [ ] **Step 1: Write failing navigation tests**

Assert:
- when caller has My Space + Team Workspaces, `/` resolves My Space even if a Team sorts earlier alphabetically;
- My Space renders once at the top;
- Team options are name-ascending;
- selecting either type navigates to `/w/<id>/knowledge`;
- selector does not display roles/member counts/org metadata.

- [ ] **Step 2: Change root resolution to explicit Personal-first lookup**

Replace the current loop over `listWorkspaces()` with:

```ts
const workspaces = await services.workspaces.listWorkspaces(caller);
const personal = workspaces.find((workspace) => workspace.workspaceType === "PERSONAL");
if (!personal) throw new Error("Personal Workspace provisioning invariant violated");

const target = await getDefaultKnowledgeTarget(personal.id);
if (target) redirect(`/w/${personal.id}/knowledge/${target.sourceId}/${target.documentId}`);
redirect(`/w/${personal.id}/knowledge`);
```

Do not introduce `/me/...` routes.

- [ ] **Step 3: Group the native selector using `<optgroup>`**

```tsx
<select ...>
  <optgroup label="Personal">
    <option value={personal.id}>My Space</option>
  </optgroup>
  <optgroup label="Team Workspaces">
    {teams.map((workspace) => (
      <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
    ))}
  </optgroup>
</select>
```

If a later UI primitive replaces native `<select>`, preserve these same grouping/accessibility semantics.

- [ ] **Step 4: Run UI/unit/e2e navigation tests**

```bash
npm run test:unit
npm run test:e2e -- --grep "workspace selector|My Space"
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx src/components/shell src/server/knowledge-read.ts tests/unit tests/e2e/phase3-workspace-governance.spec.ts
git commit -m "feat: make my space the default workspace"
```

---

### Task 11: Add Team Workspace administration UI with grant provenance and capability-gated actions

**Files:**
- Create: `src/app/w/[workspaceId]/settings/page.tsx`
- Create: `src/components/workspaces/workspace-admin-page.tsx`
- Create: `src/components/workspaces/member-table.tsx`
- Create: `src/components/workspaces/group-mapping-table.tsx`
- Create: `src/components/workspaces/audit-list.tsx`
- Modify: `src/components/shell/app-shell.tsx` or primary-nav source to show Settings only when appropriate
- Create/extend: `tests/e2e/phase3-workspace-governance.spec.ts`

**Interfaces:**
- Team admin surface consumes server-provided capabilities/effective access, never derives authority from role labels in the browser.
- Personal Workspace has no governance controls.

- [ ] **Step 1: Write e2e tests for OWNER, ADMIN, VIEWER, and Personal UI states**

OWNER must see:
- rename/archive/restore where lifecycle permits;
- member role options OWNER/ADMIN/EDITOR/VIEWER;
- group role options ADMIN/EDITOR/VIEWER;
- audit list.

ADMIN must see:
- member EDITOR/VIEWER management;
- group EDITOR/VIEWER management;
- audit list;
- no OWNER/ADMIN grant controls;
- no rename/archive/restore.

VIEWER/EDITOR must not receive governance mutation controls.

Personal Workspace must not show Settings actions for rename/member/group/archive/delete.

- [ ] **Step 2: Build the page around two distinct grant sections**

Render:

```text
Members
  Alice   OWNER
  Bob     ADMIN
  Mike    VIEWER

SSO Groups
  HRKM-Team      EDITOR
  HRKM-Readers   VIEWER
```

Do not flatten derived group users into the Members table.

- [ ] **Step 3: Add effective-access provenance view**

For a selected Hub user, request the application computed view and render for example:

```text
Direct: VIEWER
Group: HRKM-Team → EDITOR
Effective capabilities: document.read, document.write, source.manage, ...
```

When removing a direct membership, use copy equivalent to:

```text
Remove direct access? This user may still retain access through SSO group mappings.
```

Do not claim the user will lose access unless the server-computed effective result proves that.

- [ ] **Step 4: Handle ARCHIVED Team Workspace as read-only governance UI**

Show lifecycle state and allow OWNER restore. Disable/hide mutation controls for membership/group/rename while preserving audit read for OWNER/ADMIN.

- [ ] **Step 5: Run e2e and accessibility-focused checks**

```bash
npm run test:e2e -- --grep "workspace governance"
npm run lint
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/w/[workspaceId]/settings src/components/workspaces src/components/shell tests/e2e/phase3-workspace-governance.spec.ts
git commit -m "feat: add workspace governance ui"
```

---

### Task 12: Prove audit atomicity, migration compatibility, and full Phase 3 acceptance

**Files:**
- Create: `tests/integration/phase3-audit.test.ts`
- Create/extend: `tests/integration/phase3-migration-compatibility.test.ts`
- Extend: `tests/e2e/phase3-workspace-governance.spec.ts`
- Create: `docs/superpowers/verification/2026-09-14-phase-3-workspace-governance-verification.md`
- Modify: `README.md`
- Modify: `docs/superpowers/roadmaps/2026-09-10-knowledge-hub-phase-roadmap.md`

**Interfaces:**
- Produces verification evidence required before marking Phase 3 complete.

- [ ] **Step 1: Add fault-injection coverage for governance audit atomicity**

Inject audit append failure after a membership/lifecycle mutation has been issued but before commit, then assert both are absent after rollback:

```ts
await expect(service.addDirectMember(ownerCaller, workspaceId, userId, "VIEWER"))
  .rejects.toThrow("injected audit failure");

expect(await memberships.find(workspaceId, userId)).toBeNull();
expect(await audit.listForWorkspace(workspaceId, 100)).not.toEqual(
  expect.arrayContaining([expect.objectContaining({ eventType: "MEMBER_ADDED" })]),
);
```

Also prove mutation failure cannot leave an audit event committed.

- [ ] **Step 2: Add migration compatibility evidence**

Start from a database containing Phase 0–2 Team Workspace/Source/Document/Revision rows, run migration/bootstrap/backfill, then assert every existing stable ID is unchanged and all legacy Workspaces are TEAM.

- [ ] **Step 3: Run the complete acceptance matrix**

Run exactly:

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
npm run typecheck
npm run lint
npm run build
```

Record actual file/test counts and command exit results in the verification document; do not pre-fill counts before running.

- [ ] **Step 4: Verify every spec acceptance criterion is backed by a named test**

In the verification document, map each of the 15 acceptance criteria from the Phase 3 spec to one or more test names. Missing evidence is a release blocker.

- [ ] **Step 5: Update project status docs only after the full gate passes**

Update README/roadmap from “Phase 3 design” to “Phase 3 implemented/verified” only if every command in Step 3 passed on the same branch tip.

- [ ] **Step 6: Commit verification evidence**

```bash
git add tests docs/superpowers/verification README.md docs/superpowers/roadmaps/2026-09-10-knowledge-hub-phase-roadmap.md
git commit -m "docs: verify phase 3 workspace governance"
```

---

## Recommended Review / Merge Slices

Keep implementation reviewable by landing the tasks in this dependency order:

```text
1  Schema/domain
2  Capability model + CallerContext
3  Repositories/bootstrap
4  Authorization evaluation
5  Personal provisioning
6  Team lifecycle
7  Member/group governance
8  Existing Knowledge/Source enforcement
9  Server/API
10 Default navigation/selector
11 Governance UI
12 Verification/docs
```

Tasks 1–8 establish the production governance boundary and are the security-critical core. Tasks 9–11 expose that core to the Human Web. Task 12 is the release gate; do not mark Phase 3 complete based only on UI success.

## Plan Self-Review Result

- **Spec coverage:** All Phase 3 acceptance criteria are assigned to Tasks 1–12, including Personal provisioning/freeze, fixed roles, direct-owner invariant, group union, Workspace-only ACL, archived read-only semantics, discover/read behavior, audit atomicity, selector grouping, and stable-ID migration compatibility.
- **Scope:** One integrated subsystem; schema, policy, lifecycle, membership, audit, and UI all depend on the same Workspace governance contract, so a single ordered plan is preferable to independent specs.
- **Type consistency:** `WorkspaceRole`, `WorkspaceCapability`, `CallerContext.validatedExternalGroupIds`, repository names, and service names are defined before their downstream use.
- **YAGNI check:** No invite system, custom roles, Source/Document ACL, group-membership mirror table, personal/team sync, Agent principal, or hard delete is introduced.
