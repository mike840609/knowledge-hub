# Phase 3 Workspace Product Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Phase 3 Tasks 12–14 so My Space, Workspace switching, Team governance, revoke/archive/restore behavior, semantic errors, and release acceptance are fully operable through the product UI before Phase 4.

**Architecture:** Keep Tasks 1–11 and the canonical `Workspace → KnowledgeSource → Tree/Document/Revision` model unchanged. Task 12 exposes server-derived navigation/action models and governance HTTP contracts; Task 13 consumes those contracts in the existing Phase 2.5 shell without recreating RBAC in React; Task 14 proves role × lifecycle × direct/group behavior and separates Product Acceptance from Production Company SSO Cutover status.

**Tech Stack:** Next.js 15.5 App Router, React 19, TypeScript 5.7, MariaDB 10.11, existing Base UI + Tailwind product shell, Vitest integration tests, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-09-15-phase-3-workspace-product-closure-design.md`

**Supersedes:** Tasks 12–14 in `docs/superpowers/plans/2026-09-14-phase-3-identity-workspace-governance.md`. Tasks 1–11 of that plan remain authoritative and unchanged.

## Global Constraints

- `/` deterministically resolves to the caller's `My Space`; it never selects the first Team or persists last Workspace.
- Workspace switching always navigates to `/w/:workspaceId/knowledge` and never carries Source/Document/Settings context across scopes.
- Selector order is `My Space → ACTIVE TEAM(name ASC, id ASC) → ARCHIVED TEAM(name ASC, id ASC)`.
- `workspace.create_team` is platform-level truth; it is not reconstructed from a Workspace role.
- Add Member accepts only an existing Hub `userId`; no invitation, arbitrary emp_id grant, implicit user creation, or directory dependency is introduced.
- Full group-derived effective access is trustworthy only for the current caller in Phase 3; other users must remain `UNKNOWN_NOT_EVALUATED` when group truth is unavailable.
- Frontend presentation consumes server-derived action flags; direct API requests always reauthorize independently.
- Archived Team remains readable but ordinary content/governance mutations are blocked; only OWNER can restore.
- Group mappings persist only canonical `externalGroupId + role`; no persisted display-label field or schema migration is added.
- Phase 3 does not add self-service Leave Team, ownership transfer, onboarding wizard, Dashboard, Search/Retrieval UI, or visual redesign.
- Product Acceptance may pass with Local provider + trusted test claims; Production Company SSO Cutover is reported separately and may be `PENDING COMPANY ENVIRONMENT`.

---

## File Structure Map for Tasks 12–14

```text
src/modules/identity/ports/
  user-repository.ts                              # add existing-Hub-user lookup
src/infrastructure/database/mariadb/repositories/
  users.ts                                        # implement bounded user lookup
src/modules/workspaces/application/
  workspace-query-service.ts                      # typed nav ordering/state
src/server/
  workspace-admin.ts                              # UI-ready governance/read models
  knowledge-read.ts                               # shell consumes richer nav/action model
  http-error-response.ts                          # stable governance HTTP mapping
  composition.ts                                  # compose Task 12 services

src/app/api/
  users/route.ts
  workspaces/route.ts
  workspaces/[workspaceId]/route.ts
  workspaces/[workspaceId]/archive/route.ts
  workspaces/[workspaceId]/restore/route.ts
  workspaces/[workspaceId]/members/route.ts
  workspaces/[workspaceId]/members/[userId]/route.ts
  workspaces/[workspaceId]/groups/route.ts
  workspaces/[workspaceId]/audit/route.ts

src/components/shell/
  app-shell.tsx
  primary-nav.tsx
  topbar.tsx
  workspace-selector.tsx
src/components/workspaces/
  create-team-dialog.tsx
  archived-workspace-banner.tsx
  team-settings-nav.tsx
  team-general-settings.tsx
  team-members-settings.tsx
  team-groups-settings.tsx
  team-audit-settings.tsx
  governance-error.tsx
src/components/knowledge/
  knowledge-empty-state.tsx

src/app/
  page.tsx
  w/[workspaceId]/layout.tsx
  w/[workspaceId]/settings/page.tsx
  w/[workspaceId]/settings/members/page.tsx
  w/[workspaceId]/settings/groups/page.tsx
  w/[workspaceId]/settings/audit/page.tsx

tests/integration/
  phase3-workspace-admin-api.test.ts
tests/e2e/
  phase3-workspace-governance.spec.ts

docs/superpowers/verification/
  2026-09-15-phase-3-workspace-governance-verification.md
```

---

### Task 12: Expose UI-ready Workspace governance contracts and APIs

**Files:**
- Modify: `src/modules/identity/ports/user-repository.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/users.ts`
- Modify: `src/modules/workspaces/application/workspace-query-service.ts`
- Create: `src/server/workspace-admin.ts`
- Modify: `src/server/knowledge-read.ts`
- Modify: `src/server/http-error-response.ts`
- Modify: `src/server/composition.ts`
- Create: `src/app/api/users/route.ts`
- Create: `src/app/api/workspaces/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/archive/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/restore/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/members/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/members/[userId]/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/groups/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/audit/route.ts`
- Create: `tests/integration/phase3-workspace-admin-api.test.ts`

**Interfaces:**
- Consumes: `establishTrustedCaller()`, `WorkspaceQueryService`, `TeamWorkspaceService`, `TeamGovernanceService`, `evaluateWorkspaceCapabilities()`, fixed role/capability bundles, repositories from Tasks 1–11.
- Produces: `WorkspaceNavigationModel`, `TeamWorkspaceView`, `MemberAdminView`, `UserAccessInspection`, `WorkspaceActions`, bounded Hub-user search, governance route handlers, and stable HTTP error bodies consumed by Task 13.

- [ ] **Step 1: Write failing integration tests for navigation truth, action derivation, and user lookup**

Add cases to `tests/integration/phase3-workspace-admin-api.test.ts` that establish callers with direct/group grants and assert the public server contracts:

```ts
it("orders My Space, active teams, then archived teams deterministically", async () => {
  const model = await workspaceAdmin.navigation(ownerCaller);
  expect(model.items.map((item) => [item.type, item.lifecycleState, item.name])).toEqual([
    ["PERSONAL", "ACTIVE", "My Space"],
    ["TEAM", "ACTIVE", "Alpha"],
    ["TEAM", "ACTIVE", "Alpha"],
    ["TEAM", "ARCHIVED", "Legacy"],
  ]);
  expect(model.items[1]!.id < model.items[2]!.id).toBe(true);
});

it("returns lifecycle-aware actions instead of asking the UI to infer roles", async () => {
  const active = await workspaceAdmin.teamView(ownerCaller, activeTeamId);
  expect(active.actions).toMatchObject({ canArchive: true, canRestore: false, canManageOwners: true });

  const archived = await workspaceAdmin.teamView(ownerCaller, archivedTeamId);
  expect(archived.actions).toMatchObject({
    canImport: false,
    canRename: false,
    canArchive: false,
    canManageBasicMembers: false,
    canManageBasicGroups: false,
    canRestore: true,
  });
});

it("searches only existing Hub users and returns Hub UUID ids", async () => {
  const results = await workspaceAdmin.searchUsers(ownerCaller, "Alice", 20);
  expect(results).toEqual([{ id: alice.id, name: alice.name, empId: alice.emp_id }]);
});
```

Also cover `canCreateTeam`, Personal no-governance actions, ADMIN vs OWNER ceilings, current-caller evaluated group access, and other-user `UNKNOWN_NOT_EVALUATED`.

- [ ] **Step 2: Run the new integration file and confirm RED**

```bash
npm run test:integration -- --run tests/integration/phase3-workspace-admin-api.test.ts
```

Expected: fail because Task 12 UI-ready server contracts and user search do not exist yet.

- [ ] **Step 3: Add exact read-model types and lifecycle-aware action derivation**

Create `src/server/workspace-admin.ts` with these exported contracts:

```ts
export type WorkspaceActions = {
  canImport: boolean;
  canOpenSettings: boolean;
  canRename: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canManageBasicMembers: boolean;
  canManageAdminMembers: boolean;
  canManageOwners: boolean;
  canManageBasicGroups: boolean;
  canManageAdminGroups: boolean;
  canReadAudit: boolean;
};

export type WorkspaceNavigationItem = {
  id: string;
  name: string;
  type: "PERSONAL" | "TEAM";
  lifecycleState: "ACTIVE" | "ARCHIVED";
};

export type WorkspaceNavigationModel = {
  canCreateTeam: boolean;
  items: readonly WorkspaceNavigationItem[];
};

export type UserAccessInspection = {
  userId: string;
  directRole: WorkspaceRole | null;
  groupAccess: "EVALUATED" | "UNKNOWN_NOT_EVALUATED";
  matchedGroups?: readonly { externalGroupId: string; role: WorkspaceRole }[];
  effectiveCapabilities?: readonly WorkspaceCapability[];
};

export type MemberAdminView = {
  user: { id: string; name: string; empId: string };
  access: UserAccessInspection;
  assignableRoles: readonly WorkspaceRole[];
  canRemoveDirectAccess: boolean;
};
```

Use one helper to derive presentation actions from already-evaluated capabilities plus Workspace type/lifecycle. Do not inspect `role === "OWNER"` inside React components.

- [ ] **Step 4: Extend repository/query interfaces for bounded existing-user lookup and rich Workspace navigation**

Change `UserRepository` to add:

```ts
searchExisting(query: string, limit: number): Promise<UserIdentity[]>;
```

Implement in MariaDB using a bounded `name` / `emp_id` lookup, `ORDER BY name ASC, id ASC`, and a hard server-side maximum of 50. It must never create users or resolve external subjects.

Extend `WorkspaceView` to carry `type` and `lifecycleState`, and update `WorkspaceQueryService.listWorkspaces()` ordering to:

```ts
PERSONAL first
ACTIVE TEAM by name ASC, id ASC
ARCHIVED TEAM by name ASC, id ASC
```

Assert the PERSONAL item belongs to the caller's system membership; do not identify My Space by display-name string.

- [ ] **Step 5: Implement `WorkspaceAdminService` methods on trusted server data**

Expose focused methods rather than a generic command endpoint:

```ts
navigation(caller: CallerContext): Promise<WorkspaceNavigationModel>;
teamView(caller: CallerContext, workspaceId: string): Promise<TeamWorkspaceView>;
searchUsers(caller: CallerContext, query: string, limit: number): Promise<HubUserLookup[]>;
listMembers(caller: CallerContext, workspaceId: string): Promise<MemberAdminView[]>;
listGroups(caller: CallerContext, workspaceId: string): Promise<GroupAdminView[]>;
listAudit(caller: CallerContext, workspaceId: string, cursor?: string): Promise<AuditPage>;
```

For `listMembers`, evaluate complete group-derived access only when `member.user.id === caller.identity.id`; all other rows return `UNKNOWN_NOT_EVALUATED` unless a future trusted directory source exists.

- [ ] **Step 6: Write failing route-level tests for mutation ceilings, lifecycle rules, and semantic errors**

Add tests that call the route adapters or HTTP test harness directly:

```ts
expect(await archiveAs(adminCaller, teamId)).toMatchObject({ status: 403 });
expect(await removeLastOwner(ownerCaller, teamId, ownerId)).toMatchObject({
  status: 409,
  body: { error: { code: "LAST_DIRECT_OWNER" } },
});
expect(await addMember(ownerCaller, archivedTeamId, viewer.id, "VIEWER")).toMatchObject({
  status: 409,
  body: { error: { code: "WORKSPACE_ARCHIVED" } },
});
expect(await inspectOtherUser(ownerCaller, teamId, viewer.id)).toMatchObject({
  groupAccess: "UNKNOWN_NOT_EVALUATED",
});
```

Also prove there is no HTTP recovery route and that member creation accepts `userId`, not emp_id.

- [ ] **Step 7: Add explicit governance HTTP routes that always establish a trusted caller**

Implement these route responsibilities:

```text
GET/POST   /api/workspaces
GET/PATCH  /api/workspaces/:workspaceId
POST       /api/workspaces/:workspaceId/archive
POST       /api/workspaces/:workspaceId/restore
GET/POST   /api/workspaces/:workspaceId/members
PATCH/DELETE /api/workspaces/:workspaceId/members/:userId
GET/POST/PATCH/DELETE /api/workspaces/:workspaceId/groups
GET        /api/workspaces/:workspaceId/audit
GET        /api/users?query=...&limit=...
```

For group PATCH/DELETE, pass `externalGroupId` in the JSON body instead of creating a dynamic path segment for an opaque external identifier. Every route calls `establishTrustedCaller()` and then an application/server service; no browser-supplied identity, groups, platform capabilities, or actor role are accepted.

- [ ] **Step 8: Extend the existing HTTP error mapper with stable governance semantics**

Keep the existing non-enumerating 404 behavior and add a workspace governance mapper in `src/server/http-error-response.ts`. Required mapping:

```text
WORKSPACE_NOT_FOUND / undiscoverable access -> 404 { code: NOT_FOUND }
INSUFFICIENT_WORKSPACE_CAPABILITY           -> 403
WORKSPACE_ARCHIVED                          -> 409
LAST_DIRECT_OWNER                           -> 409
MEMBER_ALREADY_EXISTS                       -> 409
GROUP_MAPPING_ALREADY_EXISTS                -> 409
MEMBER_NOT_FOUND                            -> 400 or 404 only when enumeration is safe within an already-authorized Team admin surface
INVALID_ROLE_ASSIGNMENT                     -> 400
unknown                                      -> 500 INTERNAL_ERROR
```

Response shape remains:

```ts
{ error: { code: string; message: string; field?: string } }
```

Do not make the client parse `error.message` to decide behavior.

- [ ] **Step 9: Reuse the richer navigation/action model in shell server reads**

Update `src/server/knowledge-read.ts` so `WorkspaceShellModel` contains navigation items plus current Workspace action/state needed by Task 13. Do not duplicate Workspace ordering or capability derivation in the shell adapter.

- [ ] **Step 10: Run Task 12 verification**

```bash
npm run test:integration -- --run tests/integration/phase3-workspace-admin-api.test.ts tests/integration/phase3-authorization.test.ts tests/integration/phase3-team-governance.test.ts tests/integration/phase3-audit.test.ts
npm run typecheck
npm run build
```

Expected: all PASS.

- [ ] **Step 11: Commit Task 12**

```bash
git add src/modules/identity/ports/user-repository.ts \
  src/infrastructure/database/mariadb/repositories/users.ts \
  src/modules/workspaces/application/workspace-query-service.ts \
  src/server src/app/api tests/integration/phase3-workspace-admin-api.test.ts
git commit -m "feat: expose phase 3 workspace product contracts"
```

---

### Task 13: Make My Space/Workspace governance fully operable in the existing product shell

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/w/[workspaceId]/layout.tsx`
- Modify: `src/components/shell/app-shell.tsx`
- Modify: `src/components/shell/primary-nav.tsx`
- Modify: `src/components/shell/topbar.tsx`
- Modify: `src/components/shell/workspace-selector.tsx`
- Create: `src/components/workspaces/create-team-dialog.tsx`
- Create: `src/components/workspaces/archived-workspace-banner.tsx`
- Create: `src/components/workspaces/team-settings-nav.tsx`
- Create: `src/components/workspaces/team-general-settings.tsx`
- Create: `src/components/workspaces/team-members-settings.tsx`
- Create: `src/components/workspaces/team-groups-settings.tsx`
- Create: `src/components/workspaces/team-audit-settings.tsx`
- Create: `src/components/workspaces/governance-error.tsx`
- Create/modify: `src/components/knowledge/knowledge-empty-state.tsx`
- Create: `src/app/w/[workspaceId]/settings/page.tsx`
- Create: `src/app/w/[workspaceId]/settings/members/page.tsx`
- Create: `src/app/w/[workspaceId]/settings/groups/page.tsx`
- Create: `src/app/w/[workspaceId]/settings/audit/page.tsx`
- Create/modify: `tests/e2e/phase3-workspace-governance.spec.ts`

**Interfaces:**
- Consumes: Task 12 `WorkspaceNavigationModel`, `TeamWorkspaceView`, member/group/audit contracts, `WorkspaceActions`, stable error codes, and existing Phase 2 folder import routes.
- Produces: deterministic My Space entry, grouped selector, Create Team flow, capability-driven nav/empty states, Team Settings, revoke fallback, archived read-only UX, and the full Phase 3 Playwright journey used by Task 14.

- [ ] **Step 1: Write the failing Playwright journey for root/selector/create/import visibility**

Start `tests/e2e/phase3-workspace-governance.spec.ts` with explicit expectations:

```ts
test("root enters My Space and selector groups active/archived teams", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/w\/[^/]+\/knowledge/);
  await expect(page.getByRole("button", { name: /My Space/ })).toBeVisible();

  await page.getByRole("button", { name: /My Space/ }).click();
  await expect(page.getByText("Teams")).toBeVisible();
  await expect(page.getByText("Archived")).toBeVisible();
});

test("empty writable My Space offers the existing import flow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Import your first knowledge source" })).toHaveAttribute(
    "href",
    /\/sources\/import$/,
  );
});
```

Add a caller without `workspace.create_team` and assert `Create team` is absent.

- [ ] **Step 2: Run E2E and confirm RED**

```bash
npm run test:e2e -- tests/e2e/phase3-workspace-governance.spec.ts
```

Expected: fail on My Space root resolution/grouped selector/settings flows.

- [ ] **Step 3: Make `/` resolve only to My Space**

Update `src/app/page.tsx` to use trusted caller bootstrap + Personal Workspace identity and redirect only to:

```ts
redirect(`/w/${mySpace.id}/knowledge`);
```

Do not select the first accessible Workspace/Source/Document and do not persist last Workspace.

- [ ] **Step 4: Replace the native Workspace `<select>` with a grouped scope switcher**

`src/components/shell/workspace-selector.tsx` must render Task 12 ordering exactly:

```text
My Space
Teams
  active items
Archived
  archived items
Create team
```

Switch handler is always:

```ts
router.push(`/w/${targetWorkspaceId}/knowledge`);
```

`Create team` is rendered only from `navigation.canCreateTeam`; the component never infers it from current Workspace role. Archived section starts collapsed except when the current Workspace is archived.

- [ ] **Step 5: Add Create Team as a single atomic dialog**

`create-team-dialog.tsx` collects only `name`, POSTs `/api/workspaces`, refreshes navigation, then routes to `/w/:newId/knowledge`.

Do not add member/group wizard steps. Display field errors inline from `error.field`; display duplicate/conflict/general semantic errors in the dialog body.

- [ ] **Step 6: Make primary navigation capability/lifecycle-aware without rebuilding policy**

Update `primary-nav.tsx` / `app-shell.tsx` to consume server action flags:

```text
Knowledge: all readable callers
Sources: active caller with canImport/source.manage; archived management-capable callers may inspect read-only Sources without mutation controls
Settings: TEAM + actions.canOpenSettings only
```

My Space never shows Team Settings. EDITOR/VIEWER never get Team Settings. Direct settings URLs still perform server authorization in the route page.

- [ ] **Step 7: Implement deterministic empty states and archived banner**

`knowledge-empty-state.tsx` renders:

```text
PERSONAL + canImport -> Import your first knowledge source
ACTIVE TEAM + canImport -> Import knowledge
ACTIVE TEAM + !canImport -> No knowledge sources yet
ARCHIVED -> no import CTA
```

`archived-workspace-banner.tsx` renders persistent read-only copy. OWNER receives `Restore workspace` only when `actions.canRestore` is true.

- [ ] **Step 8: Add server-authorized Team Settings routes and General page**

Each settings page loads Task 12 `TeamWorkspaceView` server-side. If `canOpenSettings` is false, preserve discover/non-disclosure semantics instead of rendering a client-only forbidden page.

General page behavior:

```text
ADMIN + ACTIVE   -> Team name/state read-only
OWNER + ACTIVE   -> rename + Archive danger action
ADMIN + ARCHIVED -> state read-only
OWNER + ARCHIVED -> state + Restore
```

Archive succeeds in place, refreshes data, and leaves the caller on the same Team. Archived General never exposes rename.

- [ ] **Step 9: Implement Members UI with direct/effective truth separated**

Members table columns:

```text
Name | Direct role | Group access | Actions
```

Add Member searches `/api/users` and submits canonical `userId + role`. Role choices come from `MemberAdminView.assignableRoles`; do not hardcode OWNER/ADMIN ceilings in the component.

For other users with unknown group state render exactly `Group access not evaluated`. Remove confirmation includes:

```text
Removing direct access may not fully revoke access if this user is still granted access through an SSO group.
```

After mutation, refetch authorization. If the current caller no longer has `workspace.discover`, redirect to `/w/:mySpaceId/knowledge` with a one-time notice. If group access remains, stay in Team and let refreshed action flags remove write/import/admin controls.

- [ ] **Step 10: Implement SSO Groups and Audit surfaces**

Groups page manually collects canonical `externalGroupId` and a server-allowed role. Do not persist or require display labels. ADMIN role choices max at EDITOR/VIEWER; OWNER may include ADMIN; options come from the server model.

Audit page is read-only, newest-first, with Load more/cursor pagination, actor, event summary, target, timestamp, and relevant before/after details. Do not add filters/export/charts.

- [ ] **Step 11: Map semantic errors to inline/row/banner/toast presentation**

Centralize Task 13 error presentation in `governance-error.tsx` or equivalent helper:

```text
field + validation code -> form inline
LAST_DIRECT_OWNER -> row/dialog inline
WORKSPACE_ARCHIVED -> persistent/read-only banner + refresh
INSUFFICIENT_WORKSPACE_CAPABILITY -> remove stale action and refresh authorization
successful mutation -> toast/status notice
NOT_FOUND -> generic not-found surface without resource disclosure
```

Never branch on human-readable `message` text.

- [ ] **Step 12: Complete role × lifecycle and revoke E2E coverage**

Extend the Playwright file to cover:

```text
OWNER: full settings, rename/archive/restore, all role governance
ADMIN: settings + basic member/group + audit; no rename/archive/OWNER/ADMIN grant
EDITOR: Knowledge/Source mutation; no Settings
VIEWER: Knowledge read; no Sources management/Settings
ARCHIVED: all ordinary mutations absent; Knowledge readable; OWNER restore only
revoke no remaining access: selector removal + My Space fallback
revoke but group VIEWER remains: stays Team, read remains, write controls disappear
My Space: never exposes member/group/archive/rename controls
```

Also run at least one direct API attempt for a hidden action in the E2E setup or leave it to Task 14 integration dual-enforcement assertions; UI hiding alone is never the proof.

- [ ] **Step 13: Run Task 13 verification**

```bash
npm run test:e2e -- tests/e2e/phase3-workspace-governance.spec.ts
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 14: Commit Task 13**

```bash
git add src/app src/components tests/e2e/phase3-workspace-governance.spec.ts
git commit -m "feat: close phase 3 workspace governance ui"
```

---

### Task 14: Prove Phase 3 Product Acceptance and preserve all backend security/cutover gates

**Files:**
- Extend: `tests/integration/phase3-workspace-admin-api.test.ts`
- Extend: `tests/integration/phase3-authorization.test.ts`
- Extend: `tests/integration/phase3-concurrency.test.ts`
- Extend: `tests/e2e/phase3-workspace-governance.spec.ts`
- Create: `docs/superpowers/verification/2026-09-15-phase-3-workspace-governance-verification.md`
- Verify only, do not weaken: `docs/operations/phase3-workspace-governance-cutover.md`

**Interfaces:**
- Consumes: all Phase 3 Tasks 1–13.
- Produces: a reproducible release-gate report with `Phase 3 Product Acceptance` and `Production Company SSO Cutover` as independent statuses. Phase 4 may start only when Product Acceptance is PASS.

- [ ] **Step 1: Add an explicit role × lifecycle acceptance table to integration tests**

Table-drive these expected capabilities/UI actions against server contracts:

```ts
const activeExpected = {
  VIEWER: { read: true, import: false, settings: false, audit: false, archive: false },
  EDITOR: { read: true, import: true, settings: false, audit: false, archive: false },
  ADMIN:  { read: true, import: true, settings: true,  audit: true,  archive: false },
  OWNER:  { read: true, import: true, settings: true,  audit: true,  archive: true },
} as const;

const archivedExpected = {
  VIEWER: { read: true, import: false, settings: false, restore: false },
  EDITOR: { read: true, import: false, settings: false, restore: false },
  ADMIN:  { read: true, import: false, settings: true,  restore: false },
  OWNER:  { read: true, import: false, settings: true,  restore: true },
} as const;
```

For archived ADMIN/OWNER, Settings are read/audit surfaces only; member/group/rename mutation action flags must be false.

- [ ] **Step 2: Add direct + group union and revoke matrix cases**

Cover at minimum:

```text
none + none -> no access
VIEWER + none -> VIEWER
EDITOR + none -> EDITOR
none + VIEWER -> VIEWER
VIEWER + EDITOR -> EDITOR capability union
EDITOR + VIEWER -> EDITOR capability union
ADMIN + EDITOR -> ADMIN capability union
VIEWER + ADMIN -> ADMIN capability union
OWNER + ADMIN -> OWNER capability union
```

Then explicitly test:

```text
remove direct EDITOR + no groups -> no workspace.discover
remove direct EDITOR + group VIEWER -> read remains, write/source.manage disappear
```

- [ ] **Step 3: Add UI/API dual-enforcement regression cases**

Prove every key hidden action is also denied directly at the server/API layer:

```text
ADMIN archive -> 403
EDITOR settings/member mutation -> 403/404 according to discover semantics
VIEWER source mutation -> denied
ARCHIVED OWNER add member -> 409 WORKSPACE_ARCHIVED
ARCHIVED OWNER rename -> 409 WORKSPACE_ARCHIVED
last direct OWNER demote/remove -> 409 LAST_DIRECT_OWNER
unknown/unauthorized Workspace -> non-enumerating 404
```

- [ ] **Step 4: Re-run unchanged identity/schema/migration/concurrency hard gates**

Run the full existing suites; do not replace them with UI tests:

```bash
npm run test:unit
npm run test:integration
```

The green run must still include durable `(provider,subject) → Hub UUID`, no runtime emp_id auto-attach, no Local fallback in production, 008/009 staged readiness, Personal uniqueness, Team direct OWNER invariant, atomic audit, and all canonical lock-order/archive race tests.

- [ ] **Step 5: Run full E2E/build/static release gate**

```bash
npm run lint
npm run typecheck
npm run test:e2e
npm run build
```

Expected: PASS.

- [ ] **Step 6: Write the verification report with two independent status blocks**

Create `docs/superpowers/verification/2026-09-15-phase-3-workspace-governance-verification.md` with this exact top-level structure:

```markdown
# Phase 3 Workspace Governance Verification

## Phase 3 Product Acceptance
Status: PASS | FAIL

## Production Company SSO Cutover
Status: PASS | PENDING COMPANY ENVIRONMENT | FAIL

## Test Evidence
- lint
- typecheck
- unit
- integration
- e2e
- build

## Product Journey Evidence
- My Space default
- import
- Team create
- member/group governance
- revoke semantics
- archive/read-only/restore
- audit

## Security / Data Integrity Evidence
- identity linking
- migration 008/009
- owner/group invariants
- UI/API dual enforcement
- lock-order/concurrency
- no Source/Document ACL drift
```

If Company SSO cannot be exercised outside the company environment, write `PENDING COMPANY ENVIRONMENT`; do not mark it PASS and do not mark Product Acceptance FAIL solely for that reason.

- [ ] **Step 7: Verify the populated-production cutover runbook was not weakened**

Confirm `docs/operations/phase3-workspace-governance-cutover.md` still requires:

```text
write quiescence before 008
→ governance + identity bootstrap
→ Personal backfill
→ 009
→ Phase-3-compatible deployment/readiness
→ switch traffic
→ resume writes
```

Migration advisory lock / `beforeApply` must not be described as an application write fence.

- [ ] **Step 8: Commit Task 14 evidence**

```bash
git add tests docs/superpowers/verification docs/operations/phase3-workspace-governance-cutover.md
git commit -m "docs: verify phase 3 product closure"
```

---

## Self-review Coverage Matrix

| Closure requirement | Implementation location |
| --- | --- |
| My Space deterministic `/` | Task 13 Steps 1–3 |
| grouped selector + stable ordering | Task 12 Steps 1–4; Task 13 Step 4 |
| platform-gated Create Team | Task 12 action model/routes; Task 13 Step 5 |
| capability-driven empty-state import | Task 13 Step 7 |
| ADMIN/OWNER-only Settings | Task 12 action model; Task 13 Steps 6, 8 |
| existing-Hub-user membership only | Task 12 Steps 1, 4, 7; Task 13 Step 9 |
| truthful current/other group access | Task 12 Steps 1, 3, 5; Task 13 Step 9 |
| direct revoke vs effective access | Task 13 Step 9; Task 14 Step 2 |
| manual canonical externalGroupId | Task 13 Step 10 |
| archive/read-only/restore | Task 12 Steps 3, 6–8; Task 13 Steps 7–8; Task 14 Steps 1, 3 |
| semantic error presentation | Task 12 Step 8; Task 13 Step 11 |
| UI + API dual enforcement | Task 14 Step 3 |
| complete Human product journey | Task 13 Step 12 |
| existing identity/migration/concurrency hard gates retained | Task 14 Step 4 |
| Product Acceptance separate from Company SSO cutover | Task 14 Step 6 |
| no new Phase 3.5 / Task 15 / schema field | Global Constraints + all tasks |

## Plan Self-review

- Spec coverage: every approved closure section maps to Task 12, 13, or 14 above.
- Placeholder scan: no TBD/TODO/"similar to" implementation gaps remain.
- Type consistency: `WorkspaceActions`, `WorkspaceNavigationModel`, `UserAccessInspection`, and `MemberAdminView` are defined in Task 12 and consumed unchanged by Task 13/14.
- Scope: Tasks 1–11 are untouched; this file is the authoritative replacement plan for old Tasks 12–14 only.
