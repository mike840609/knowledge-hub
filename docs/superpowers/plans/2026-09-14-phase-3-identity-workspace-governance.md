# Phase 3 Identity, Workspace Administration & Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Phase 0–2 binary WorkspaceMembership foundation into production Workspace governance with My Space, fixed RBAC, trusted Company SSO claims, durable external identity linking to Hub-owned UUID users, lifecycle-safe mutation serialization, direct + group grants, auditable governance, and Phase 2.5 administration UI without changing canonical Knowledge identity.

**Architecture:** Keep `Workspace → KnowledgeSource → Tree/Document/Revision` as the only Knowledge path. Company SSO yields trusted external claims. A durable `(provider, subject) → hub_user_id` identity link resolves those claims to a Hub-owned UUIDv7 user before CallerContext exists. Legacy Hub users are explicitly linked during rollout; production runtime never uses `emp_id` to claim an existing account. Workspace authorization is the union of direct + validated group grants. Database rollout is staged as migration 008 additive schema → explicit bootstrap → migration 009 final constraints/readiness. Import creation before a Snapshot exists uses `Workspace` or `Source → Workspace`; once a Snapshot exists, import mutation uses `ImportSnapshot → [Source] → Workspace`.

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
- Rollout order is `008 additive → governance + identity bootstrap → 009 final constraints → production readiness`.
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

Cover existing Workspace IDs, nullable bootstrap fields, exact-byte external IDs, identity-link unique keys, group OWNER rejection, and orphan protection on new tables.

- [ ] **Step 2: Run integration tests and confirm red state**

```bash
npm run test:integration
```

- [ ] **Step 3: Implement migration 008**

Add Workspace type/lifecycle columns and membership role/source columns with compatibility nullability. Backfill existing Workspaces explicitly to TEAM.

Create:

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

Create group mappings and audit events. Add safe FKs on new tables immediately; migration 009 will finalize remaining canonical constraints on altered legacy tables.

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
  identity: UserIdentity; // Hub UUID user only
  validatedExternalGroupIds: readonly string[];
  platformCapabilities: readonly PlatformCapability[];
  refreshedAt: Date;
};
```

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

```ts
async resolve(external: ExternalCompanyIdentity): Promise<UserIdentity> {
  return retryUniqueRace(async () => uow.run(async (repos) => {
    const link = await repos.identityLinks.findByProviderSubject(external.provider, external.subject);
    if (link) {
      const user = await repos.users.findById(link.hubUserId);
      if (!user) throw new IdentityIntegrityError();
      if (user.emp_id !== external.emp_id) throw new IdentityReconciliationRequiredError();
      await repos.users.updateProfile(user.id, { name: external.name, org_code: external.org_code });
      await repos.identityLinks.touch(link.id);
      return { ...user, name: external.name, org_code: external.org_code };
    }

    const existingByEmp = await repos.users.findByEmpId(external.emp_id);
    if (existingByEmp) {
      const existingProviderLink = await repos.identityLinks.findByProviderUser(external.provider, existingByEmp.id);
      if (existingProviderLink) throw new IdentityLinkConflictError();
      throw new IdentityLinkRequiredError();
    }

    const user = { id: uuidv7(), emp_id: external.emp_id, name: external.name, org_code: external.org_code };
    await repos.users.insert(user);
    await repos.identityLinks.insert({
      id: uuidv7(), provider: external.provider, subject: external.subject, hubUserId: user.id,
    });
    return user;
  }));
}
```

Runtime never claims an existing user by emp_id.

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

### Task 4: Bootstrap legacy governance + identity links, then finalize migration 009

**Files:**
- Create: `scripts/db/bootstrap-phase3-workspace-governance.ts`
- Create: `scripts/db/bootstrap-phase3-identity-links.ts`
- Create: `src/modules/workspaces/application/workspace-readiness.ts`
- Create: `src/infrastructure/database/mariadb/migrations/009-phase-3-workspace-governance-finalize.ts`
- Modify: `src/infrastructure/database/mariadb/migrations/index.ts`
- Modify: `scripts/db/migrate.ts` help/runbook if useful
- Modify: `src/server/config.ts`
- Modify: `src/server/composition.ts`
- Create: `tests/integration/phase3-bootstrap.test.ts`
- Extend: `tests/integration/phase3-schema.test.ts`
- Extend: `tests/integration/phase3-identity-resolution.test.ts`

- [ ] **Step 1: Write governance bootstrap tests**

All-EDITOR Team fails, zero-member Team needs explicit owner, unknown owner fails, successful explicit owner bootstrap works.

- [ ] **Step 2: Implement explicit governance bootstrap**

Every Team ends with direct OWNER >= 1; no heuristic elevation.

- [ ] **Step 3: Write legacy identity-link bootstrap tests**

Bootstrap input:

```ts
export type LegacyIdentityLinkBootstrapEntry = {
  provider: string;
  subject: string;
  hubUserId: string;
  expectedEmpId: string;
};
```

Prove:

```text
- target Hub user must exist
- expectedEmpId must match target user as safety assertion
- duplicate provider+subject fails
- same provider cannot map two subjects to one Hub user
- bootstrap creates exact subject->hub UUID link without changing hub UUID
- runtime can resolve immediately after bootstrap
- runtime cannot claim an unlinked legacy user by emp_id
```

Input must originate from trusted operator/directory export, not browser request.

- [ ] **Step 4: Implement identity-link bootstrap**

Insert link rows transactionally after validating existing Hub user and expected emp_id. Do not create new users in this bootstrap; new users are runtime-created from new trusted subjects.

- [ ] **Step 5: Add migration 009 gate tests**

```bash
npm run db:migrate -- --to 8
```

Before governance bootstrap, 009 fails without APPLIED ledger row. After governance bootstrap, 009 applies.

- [ ] **Step 6: Implement migration 009**

`beforeApply` validates Team owner + membership completeness. DDL finalizes Workspace type and membership role/source NOT NULL, CHECKs, and canonical FKs. New-table FKs are verified/present. Polymorphic audit `target_id` remains without a single FK.

- [ ] **Step 7: Add production application readiness**

Production Phase 3 requires:

```text
- migration 009 APPLIED
- company provider/session configured
- all configured legacy human users in rollout scope have expected company-provider identity links
```

Identity-link completeness belongs to application readiness because rollout scope/provider configuration is deployment-specific, not a pure DB migration invariant.

- [ ] **Step 8: Verify staged rollout**

```bash
npm run db:migrate -- --to 8
npx tsx scripts/db/bootstrap-phase3-workspace-governance.ts --config /path/to/governance.json
npx tsx scripts/db/bootstrap-phase3-identity-links.ts --config /path/to/identity-links.json
npm run db:migrate -- --to 9
npm run test:integration
npm run typecheck
```

- [ ] **Step 9: Commit**

```bash
git add scripts/db src/infrastructure/database/mariadb/migrations src/modules/workspaces/application/workspace-readiness.ts src/server tests/integration
git commit -m "feat: bootstrap and finalize phase 3 governance"
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

- [ ] **Step 1: Test repeated/concurrent provisioning, fixed name, one SYSTEM_PERSONAL owner, deep-link/API bootstrap, and rerunnable existing-user backfill**
- [ ] **Step 2: Ensure a missing legacy identity link fails before Personal provisioning; runtime never creates My Space under the wrong legacy Hub UUID by emp_id matching**
- [ ] **Step 3: Implement Personal provisioning transaction and system freeze**
- [ ] **Step 4: Wire one shared server helper; no route accepts caller identity/groups/capabilities**
- [ ] **Step 5: Verify and commit**

```bash
npm run test:integration
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

### Task 13: Run full acceptance, security regression, and documentation verification

**Files:** `docs/superpowers/verification/2026-09-14-phase-3-workspace-governance-verification.md`

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

Must include identity-link runtime/bootstrap, staged migration, authorization, audit, and pre-/post-Snapshot concurrency suites.

- [ ] **Step 3: E2E/build**

```bash
npm run test:e2e
npm run build
```

- [ ] **Step 4: Record explicit security evidence**

```text
- production cannot silently use Local identity
- users.id is always Hub UUIDv7
- (provider,subject) is durable account-link truth
- runtime missing link + existing emp_id fails; no legacy auto-attach
- legacy identity links are explicit bootstrap inputs from trusted operator/directory data
- recycled emp_id cannot inherit existing Hub account
- 008 stages legacy DB; 009 refuses before governance bootstrap
- after 009 final role/source/type constraints and canonical FKs are active
- application readiness requires legacy identity-link rollout completeness
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
| Durable `(provider,subject)` → Hub UUID runtime identity | 1, 3, 7 |
| Explicit legacy identity-link bootstrap | 4 |
| Explicit legacy Team owner bootstrap | 4 |
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
