# Knowledge Hub — Phase 3 Workspace Product Closure Design

| Item | Content |
| --- | --- |
| Document date | 2026-09-15 |
| Document type | Design Spec amendment; excludes Implementation Plan |
| Status | Approved — implementation plan written |
| Parent spec | `docs/superpowers/specs/2026-09-14-phase-3-identity-workspace-governance-design.md` |
| Prerequisites | Phase 2.5 Frontend Product Baseline, Phase 3 Identity / Workspace Governance Tasks 1–11 |
| Purpose | Complete Phase 3 Tasks 12–14 API, UI, workflows, and release acceptance so Human Web users can fully operate and understand Workspace governance beyond its underlying implementation |

## 1. Decision summary

Phase 3 must complete product closure for Workspace governance before Phase 4.

This is neither a new phase nor Phase 3.5, and adds no Task 15. Implementation remains within the existing:

```text
Task 12 — server/admin API contracts
Task 13 — My Space / Workspace / Team governance UI
Task 14 — acceptance, security regression, rollout verification
```

Phase 3 completion advances beyond implemented RBAC / lifecycle / identity to:

> Workspace scope, roles, lifecycle, governance, and import entry points can all be operated through the product UI, with every UI behavior consistent with server-side authorization / lifecycle semantics.

Visual polish, Dashboard, and Search/Retrieval UI are outside this closure; they may be addressed in Phase 4 or later.

## 2. Goals

Phase 3 product closure MUST：

1. Make `/` enter My Space deterministically, rather than the first Team.
2. Make the Workspace selector clearly express Personal, Active Team, and Archived Team.
3. Let users with the platform capability create Teams from the selector.
4. Let empty My Space / Team enter the existing folder import flow directly.
5. Let ADMIN / OWNER complete Team governance in the product UI.
6. Help administrators correctly understand direct membership versus SSO Group access.
7. Clearly present archived Teams as read-only, without requiring mutation failure to reveal state.
8. Make frontend navigation deterministic after revoke, archive, and restore.
9. Prevent UI guesses about role/lifecycle; server returns a UI-ready capability/action model.
10. Make Task 14 verify complete Human journeys, beyond route/API existence.

## 3. Non-goals

This closure MUST NOT introduce:

- invitation / pending membership lifecycle。
- Membership creation from arbitrary `emp_id`.
- A company directory picker as a Phase 3 dependency.
- ownership transfer flow。
- self-service `Leave Team`。
- Onboarding wizard or draft Team.
- per-user last-workspace / last-page persistence。
- Full external-group membership lookup for other users.
- advanced Audit filters、export、analytics dashboard。
- Search / semantic retrieval UI。
- visual redesign、animation、advanced personalization。
- New Workspace / membership / group schema fields.

Company production SSO hookup may be completed in the company environment; Local provider + trusted test claims must first verify the same authorization semantics.

## 4. Canonical product journey

Phase 3 must support:

```text
Login
→ My Space
→ empty state / Import knowledge
→ Create Team
→ Team knowledge
→ Team Settings
→ Add existing Hub user
→ Configure SSO Group mapping
→ Inspect direct / effective access truthfully
→ Revoke direct access
→ Archive Team
→ Read archived knowledge
→ Restore Team
```

This flow is the backbone of Task 13 E2E and Task 14 Product Acceptance.

## 5. My Space default entry

Phase 3 overrides Phase 2.5's first-accessible-Workspace root resolution:

```text
/
→ establish trusted caller
→ ensurePersonalWorkspace(caller.identity.id)
→ /w/:mySpaceId/knowledge
```

Rules：

- My Space is always the default sign-in scope.
- Do not read the last Workspace.
- Do not jump to Team because the user already has Team access.
- My Space without Sources shows an empty state, without jumping to Team.
- Direct Team deep links still work; root default and deep-link authorization are separate concerns.
- My Space shows no Members, SSO Groups, rename, archive, or ownership controls.

## 6. Workspace selector

The Workspace selector switches authorization scope; it is not the authorization source of truth.

Canonical ordering：

```text
My Space
────────────
Teams
  Active Team A
  Active Team B

Archived
  Archived Team A
  Archived Team B
────────────
+ Create team
```

Ordering must be deterministic:

```text
My Space first
→ ACTIVE TEAM by name ASC, id ASC
→ ARCHIVED TEAM by name ASC, id ASC
```

Rules：

1. The Archived section may start collapsed; expand it automatically when the current scope is an archived Team.
2. Unauthorized Workspaces never appear.
3. Show `+ Create team` only when the caller has platform capability `workspace.create_team`.
4. The selector shows no org_code, owner, or member count and does not treat role as authorization truth.

### 6.1 Workspace switching

Switching any Workspace always enters the target Workspace Knowledge root:

```text
/w/:targetWorkspaceId/knowledge
```

Do not retain the previous Workspace's Source, Document, Settings tab, or import state.

## 7. Team creation

Create Team starts at the bottom of the Workspace selector.

The dialog requires only:

```text
Team name
```

The product flow submits no member or SSO Group mapping in the Team-create request. Existing backend group governance remains a separate operation; no draft Team or partial onboarding state is introduced.

Success semantics：

```text
create TEAM Workspace
+ creator DIRECT OWNER
+ append audit
→ refresh selector
→ /w/:newTeamId/knowledge
```

## 8. Empty-state import entry

Empty Workspaces lead directly to the existing Phase 2 import flow, without an onboarding wizard.

```text
My Space empty + source.manage
→ "Import your first knowledge source"
→ /w/:workspaceId/sources/import

Active Team empty + source.manage
→ "Import knowledge"
→ /w/:workspaceId/sources/import

Active Team empty + no source.manage
→ "No knowledge sources yet"
→ no Import CTA

Archived Team empty
→ no Import CTA for any role
```

## 9. Navigation and Settings visibility

Phase 2.5 primary navigation retains Knowledge / Sources; Phase 3 adds Team Settings where applicable.

```text
Knowledge
Sources
Settings   # TEAM + canOpenSettings only
```

Rules：

- Only ADMIN / OWNER may enter Team Settings.
- EDITOR / VIEWER do not see Settings navigation.
- Server authorization still rejects EDITOR / VIEWER direct URLs; hidden navigation is no security boundary.
- My Space does not show Team Settings.
- Show Sources management entry to callers with `source.manage`; VIEWER does not see Sources management navigation that offers no actionable operations.
- Archived Teams may retain read-only Source inspection for callers with Source management capability, but all mutation actions must disappear; this is presentation behavior and does not change role capability bundles.

Recommended Team settings routes：

```text
/w/:workspaceId/settings
/w/:workspaceId/settings/members
/w/:workspaceId/settings/groups
/w/:workspaceId/settings/audit
```

## 10. UI-ready server action model

Frontend MUST NOT reconstruct policy through scattered `role === "OWNER"` checks.

Server/query layer should return UI-ready actions computed from caller capability + lifecycle, for example:

```ts
export type WorkspaceActions = {
  canImport: boolean;
  canInspectSources: boolean;
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
```

Ordinary mutation actions for archived Teams must be `false`. Separate `canInspectSources` from `canImport`: `source.manage` determines Sources inspection entry; ARCHIVED may retain inspection, but import must be false.

Frontend uses action flags for presentation; API routes still reauthorize. Action flags are not authorization tokens.

## 11. Workspace read models

The selector uses a caller-visible navigation model:

```ts
export type WorkspaceNavigationItem = {
  id: string;
  name: string;
  type: "PERSONAL" | "TEAM";
  lifecycleState: "ACTIVE" | "ARCHIVED";
};
```

`canCreateTeam` is caller/platform-level state, not duplicated on every Workspace item.

Team detail view includes at least:

```ts
export type TeamWorkspaceView = {
  id: string;
  name: string;
  lifecycleState: "ACTIVE" | "ARCHIVED";
  caller: {
    directRole: WorkspaceRole | null;
    effectiveCapabilities: readonly WorkspaceCapability[];
  };
  actions: WorkspaceActions;
  grantOptions: WorkspaceGrantOptions;
};

export type WorkspaceGrantOptions = {
  newMemberAssignableRoles: readonly WorkspaceRole[];
  newGroupAssignableRoles: readonly ("ADMIN" | "EDITOR" | "VIEWER")[];
};
```

## 12. Existing Hub user membership management

Phase 3 Add member permits selecting only existing Hub Users.

The user lookup contract returns only existing Hub users; it is not an invitation or identity provisioning API.

Membership write payload uses canonical Hub `userId`:

```ts
{
  userId: string;
  role: WorkspaceRole;
}
```

MUST NOT support arbitrary `emp_id` membership creation, browser-provided external subject linking, pending invitations, or implicit User creation.

Future company directory integration may replace the lookup source, but membership identity remains Hub `userId`.

## 13. Team member administration UI

Members uses a table/list presenting direct grants separately from group-derived truth:

```text
Name
Direct role
Group access
Actions
```

Role mutation ceiling：

```text
ADMIN
→ manage EDITOR / VIEWER only

OWNER
→ manage OWNER / ADMIN / EDITOR / VIEWER
```

Assignable role choices come from the server contract or a capability-policy-derived presentation model, without hardcoding policy again in components.

### 13.1 Creation options and existing-row options

Team Settings model must include `grantOptions`, independent of whether member/group rows currently exist:

- ACTIVE effective ADMIN: new members/groups may select only EDITOR, VIEWER.
- ACTIVE direct OWNER: new members may select OWNER, ADMIN, EDITOR, VIEWER; new groups may select ADMIN, EDITOR, VIEWER.
- ARCHIVED or lacking the relevant management capability: new-role arrays are empty; creation controls are hidden.

Add Member search results remain existing Hub user identities; after selecting a candidate, use `newMemberAssignableRoles`; new Groups use `newGroupAssignableRoles`. Existing-row `assignableRoles` only edits that row and additionally considers persisted beforeRole, the final direct OWNER, and lifecycle; do not reuse row options to initialize creation forms. Server generates all options and revalidates on writes.

### 13.2 No self-service leave

Phase 3 provides no `Leave Team`.

ADMIN / OWNER governance adds/updates/removes direct memberships; ownership transfer is also outside Phase 3.

## 14. Truthful effective-access presentation

Canonical authorization：

```text
effective capabilities
= direct capabilities
  UNION
  matched validated-group capabilities
```

Validated group claims are available for the current caller, so full matched groups / effective capabilities can be shown.

For other users, without a trusted external-group membership source in Phase 3, unknown cannot mean empty.

```ts
export type UserAccessInspection = {
  userId: string;
  directRole: WorkspaceRole | null;
  groupAccess: "EVALUATED" | "UNKNOWN_NOT_EVALUATED";
  matchedGroups?: readonly {
    externalGroupId: string;
    role: WorkspaceRole;
  }[];
  effectiveCapabilities?: readonly WorkspaceCapability[];
};
```

UI wording：

```text
Direct role: EDITOR
Group access: Not evaluated
```

Do not display an inferred `Effective role: EDITOR` when data is unknown.

## 15. Revoke semantics

Removing direct membership does not guarantee complete access revocation.

Confirmation MUST explicitly explain:

```text
Removing direct access may not fully revoke access if this user
is still granted access through an SSO group.
```

### 15.1 Current caller loses all access

If the current caller loses `workspace.discover` after mutation:

```text
Team disappears from selector
→ redirect /w/:mySpaceId/knowledge
→ one-time notice: "You no longer have access to this workspace."
```

My Space is the deterministic fallback; do not automatically jump to another Team.

### 15.2 Direct grant removed but group access remains

If a group grant still provides access:

- Caller stays in Team.
- UI immediately converges to the new effective capabilities.
- For example, when direct EDITOR is removed but group VIEWER remains, write/import controls disappear while read remains.

Frontend MUST NOT decide that the caller should leave Workspace solely because a membership row was deleted.

### 15.3 Affected-client refresh and route convergence

An administrator's post-mutation refresh does not update another user's browser. All Workspace shells (Knowledge, Sources, Settings, Import) require a shared authorization refresh mechanism:

- Refresh immediately on initial load, Workspace/route navigation, and successful mutation.
- Refresh immediately on window focus / visibility becoming visible.
- Refresh visible pages every 30 seconds; stop the timer while hidden and refresh on becoming visible.
- On API 403, 404, or lifecycle 409, refresh Workspace authorization before routing; Source/Document 404 alone does not mean the entire Workspace access is lost.

Use the caller's navigation model to obtain My Space and currently discoverable Workspaces, then obtain the current Workspace's read-safe state/capabilities/actions. This state endpoint is open to every discover-capable caller, requires no Settings management capability, and returns no member/group/audit or Knowledge content; unknown/undiscoverable Workspaces retain generic 404. Settings model itself remains ADMIN/OWNER-only.

After refresh, use this state machine:

| Fresh authorization | Current surface | Result |
| --- | --- | --- |
| No workspace.discover | Any previously loaded Workspace | Clear scope content/preview caches, remove from selector, replace to My Space, show a one-time notice |
| Still readable, but lost canOpenSettings | Settings | Replace to the same Team Knowledge root |
| Still readable, but lost canImport or Team archived | Sources/import/update/preview | Stay in the same Team; stop further upload/finalize/apply, remove mutation controls, explain read-only/permission changes; retain still-authorized preview reads |
| Current-page capability retained | Any | Refresh capabilities/actions in place |

Any Workspace deep link never successfully loaded still returns generic 404; fallback must not reveal existence. Temporary network errors/5xx are not revocation: show retry state and suspend mutation controls while permissions cannot be confirmed. Use abort or request generation to prevent stale responses overriding new authorization/a switched Workspace; clear timers on unmount.

With a healthy network, affected visible pages should converge after the next 30-second poll completes. This is a UI freshness budget, not an authorization grace period; APIs validate every request immediately. E2E must verify this using separate administrator and affected-user browser contexts.

## 16. SSO Group administration

Phase 3 does not depend on a company directory picker.

Canonical mutation payload retains existing schema fields:

```ts
{
  externalGroupId: string;
  role: "ADMIN" | "EDITOR" | "VIEWER";
}
```

Rules：

- `externalGroupId` is the sole authorization key.
- Phase 3 adds no persisted display-label field.
- Friendly UI labels can only be non-authoritative presentation; they cannot become grant identity or require schema migration.
- ADMIN may create/update Group → EDITOR / VIEWER.
- OWNER may create/update Group → ADMIN / EDITOR / VIEWER.
- Groups can never grant OWNER.

Future directory search pickers replace only input UX and still submit canonical `externalGroupId`.

## 17. Audit UI

Audit is a governance evidence surface, rather than an analytics dashboard.

Phase 3 provides at least newest-first ordering, pagination/Load more, actor, event summary, target, timestamp, and relevant before/after role/state details.

ADMIN / OWNER may read Team audit.

Phase 3 has no advanced filters, export, or charting.

## 18. Team lifecycle UI

### 18.1 Active Team archive

Archive is an OWNER-only danger action:

```text
Settings
→ General
→ Danger zone
→ Archive workspace
```

Confirmation MUST explain that Knowledge is retained and readable, imports/content mutation stop, Workspace administration mutation stops, and OWNER can restore.

After successful archive, remain in the same Team without jumping to My Space.

### 18.2 Archived Team presentation

Archived Team displays a persistent banner:

```text
Archived workspace
This workspace is read-only. Existing knowledge remains available.
```

OWNER additionally sees `Restore workspace`.

| Surface | ADMIN | OWNER |
| --- | --- | --- |
| Knowledge | read | read |
| Sources | read-only / no mutation | read-only / no mutation |
| General | status only | status + Restore |
| Members | read-only | read-only |
| SSO Groups | read-only | read-only |
| Audit | read | read |
| Rename | no | no |
| Member/group mutation | no | no |
| Restore | no | yes |

VIEWER / EDITOR still read Knowledge according to read capability, without a governance surface.

Archived is lifecycle state, not another role.

### 18.3 Restore

Successful restore preserves Workspace ID, Source/Document IDs, memberships, and group mappings; ordinary mutations resume according to effective capabilities.

### 18.4 Existing Knowledge / Sources / Import retrofit

Existing pages must use the same server action model, beyond hiding primary navigation:

- `/w/:workspaceId/knowledge` directly renders Knowledge empty state, removing the existing redirect to Sources when no Source exists.
- Sources list's Import folder and Source detail's Update from folder must both display according to Workspace actions.
- Source updates additionally require existing `isFolderSyncable(source)`; Workspace import capability does not mean every Source can be updated.
- Import/create/update direct URLs must validate current capabilities/lifecycle server-side; VIEWER/ARCHIVED must not render submittable forms.
- `FolderImportForm` and snapshot preview/apply footer receive server-derived mutation allowance; Apply still also checks existing snapshot state, expiry, blockers, and other restrictions.
- Permission/lifecycle changes use §15.3's refresh/convergence mechanism; creator-private snapshots and discover/read error semantics remain.

## 19. Team Settings information architecture

Only ADMIN / OWNER may enter Team Settings:

```text
General
Members
SSO Groups
Audit
```

### General

OWNER may rename Team, inspect lifecycle, archive Active Team, and restore Archived Team.

ADMIN only inspects Team name / lifecycle; unauthorized rename/archive/restore controls are hidden.

### Members

- list direct membership。
- separate direct role from effective/group state。
- add existing Hub user。
- mutate/remove direct role subject to actor ceiling。

### SSO Groups

- list mapping。
- manually enter canonical externalGroupId。
- role selection subject to actor ceiling。

### Audit

- read-only governance event history。

## 20. API error contract and UI presentation

Governance API must provide stable semantic error codes; frontend does not parse human-readable backend messages.

```ts
export type ApiError = {
  code: string;
  message: string;
  field?: string;
};
```

Without the platform capability, Create Team retains `TEAM_CREATION_DENIED` and returns 403. Trim create/rename names first; length must be 1–200. Invalid names use dedicated `INVALID_WORKSPACE_NAME`, returning 400 with `field: "name"` for inline form messages. Do not classify all other lifecycle errors as name errors or infer error types from message text.

If platform capability is lost after the Create dialog opens, retain the dialog on rejected submission, show a permission message, and refresh navigation/actions; disable further submission when `canCreateTeam` is false. HTTP tests verify status/code/field for missing create capability, blank names, and overlong names; invalid creation produces no Workspace, owner membership, or audit event. Rename shares name validation; UI tests cover capability revocation after the dialog opens.

Minimum semantic errors：

```text
WORKSPACE_ARCHIVED
LAST_DIRECT_OWNER
INSUFFICIENT_WORKSPACE_CAPABILITY
TEAM_CREATION_DENIED
INVALID_WORKSPACE_NAME
MEMBER_NOT_FOUND
MEMBER_ALREADY_EXISTS
GROUP_MAPPING_ALREADY_EXISTS
INVALID_ROLE_ASSIGNMENT
WORKSPACE_NOT_FOUND
```

Presentation policy：

```text
field/form validation → inline
row/invariant conflict → row or dialog inline
workspace/global lifecycle state → banner
successful mutation → toast
undiscoverable resource → generic 404
```

404 behavior MUST preserve existing discover-vs-read non-disclosure semantics。

## 21. Role × lifecycle acceptance matrix

### 21.1 ACTIVE Team

| Capability / UI | VIEWER | EDITOR | ADMIN | OWNER |
| --- | ---: | ---: | ---: | ---: |
| Read Knowledge | yes | yes | yes | yes |
| Import / update Source | no | yes | yes | yes |
| Team Settings | no | no | yes | yes |
| Manage VIEWER / EDITOR | no | no | yes | yes |
| Manage ADMIN | no | no | no | yes |
| Manage OWNER | no | no | no | yes |
| Read Audit | no | no | yes | yes |
| Group → VIEWER / EDITOR | no | no | yes | yes |
| Group → ADMIN | no | no | no | yes |
| Rename | no | no | no | yes |
| Archive | no | no | no | yes |

### 21.2 ARCHIVED Team

| Capability / UI | VIEWER | EDITOR | ADMIN | OWNER |
| --- | ---: | ---: | ---: | ---: |
| Read Knowledge | yes | yes | yes | yes |
| Import / update | no | no | no | no |
| Content write | no | no | no | no |
| Member/group mutation | no | no | no | no |
| Rename | no | no | no | no |
| Read Audit | no | no | yes | yes |
| Restore | no | no | no | yes |

## 22. Direct + Group acceptance matrix

Verify at least:

| Direct role | Matched group role | Effective result |
| --- | --- | --- |
| none | none | no access |
| VIEWER | none | VIEWER capabilities |
| EDITOR | none | EDITOR capabilities |
| none | VIEWER | VIEWER capabilities |
| VIEWER | EDITOR | EDITOR capability union |
| EDITOR | VIEWER | EDITOR capability union |
| ADMIN | EDITOR | ADMIN capability union |
| VIEWER | ADMIN | ADMIN capability union |
| OWNER | ADMIN | OWNER capability union |

Group cannot grant OWNER。

## 23. UI + API dual enforcement

Hidden UI controls are not authorization.

Every important operation needs two verification layers:

```text
UI
→ no capability => action absent

API
→ direct call still reauthorizes and rejects
```

Examples：

```text
ADMIN archive
UI: action absent
API: rejected

EDITOR settings
UI: nav absent
Direct route/API: rejected

Archived OWNER add member
UI: action absent
API: WORKSPACE_ARCHIVED
```

## 24. Task 13 end-to-end product journey

Playwright covers at least:

1. Login → `/` → My Space; empty My Space does not jump to Team.
2. My Space empty state → existing folder import flow。
3. Workspace selector → Create Team; creator is OWNER.
4. Empty Team → import flow。
5. Add existing Hub user as VIEWER。
6. Change member VIEWER → EDITOR。
7. Add SSO Group → EDITOR。
8. Verify OWNER / ADMIN / EDITOR / VIEWER navigation/action differences.
9. Remove direct access; fall back to My Space on total access loss; stay in Team if group access remains.
10. Archive Team; Knowledge remains readable, ordinary mutations disappear.
11. OWNER Restore; mutation capability resumes.
12. Audit shows these governance events.
13. My Space has no Team governance UI throughout.

### 24.1 Trusted multi-user HTTP test harness

The Local provider originally supplies neither company groups nor `workspace.create_team`; do not assume the existing fixed Local E2E user can complete the entire journey.

Task 12 creates a test-only server identity fixture for Task 13 Playwright:

1. All persona servers share one disposable E2E MariaDB database; each Next process receives a fixed server-owned identity/claims fixture at startup and uses a separate port. Browser contexts bind to their persona server; headers/query/body cannot arbitrarily specify identity or role.
2. Fixtures include at least callers with/without `workspace.create_team`, direct OWNER/ADMIN/EDITOR/VIEWER, group-only ADMIN/EDITOR, and direct EDITOR + group VIEWER; controlled seed/bootstrap creates Hub users, identity links, My Space, and grants.
3. Test server bootstrap/entry point must be separate from normal production entry. Normal startup loads no fixture provider and offers no HTTP persona-switch route; environment variables alone cannot switch normal production to test identity.
4. Test bootstrap may inject a fixed claims reader into existing `buildApplicationServices`/reader registration; each browser request still passes real trusted bootstrap, readiness, API/application authorization, and DB transactions, without mocking API success or fabricating frontend action flags.
5. OWNER context changes grants through real governance API/UI; affected personas retain the same server-validated group claims and verify refresh/routing in their own browser contexts, rather than changing a role on the same page.
6. Retain original production-build Local smoke/E2E; new identity-fixture tests cannot replace normal-entry build, fail-closed, or no-Local-fallback regression checks.

Shut down fixture servers and delete the disposable database after tests. First use HTTP smoke to prove authorized callers can Create Team, unauthorized callers are denied, and browser input cannot override personas; then run the full journey. Company production hookup remains separately pending.

## 25. Task 14 release gate

Phase 3 Product Acceptance must all PASS:

```text
Task 12 governance/server contracts
Task 13 Workspace + Settings UI
My Space default entry
Workspace selector ordering/grouping
role × lifecycle UI behavior
direct + group capability union
truthful other-user group state
revoke fallback semantics
archive / read-only / restore semantics
UI + API dual enforcement
semantic error presentation
audit correctness
existing migration / identity security regressions
existing lock-order / concurrency regressions
lint / typecheck / unit / integration / e2e / build
```

Existing Phase 3 backend hard gates remain unchanged, especially production no-Local-fallback, Hub-owned UUIDv7, durable `(provider,subject)` identity, 008/009 staged safety, Personal uniqueness, direct OWNER invariant, atomic audit, canonical lock order, archive serialization, and no Source/Document ACL.

## 26. Product Acceptance vs Production SSO Cutover

Verification reports must separate:

```text
Phase 3 Product Acceptance
PASS | FAIL

Production Company SSO Cutover
PASS | PENDING COMPANY ENVIRONMENT | FAIL
```

Local provider + trusted test claims can make Product Acceptance PASS if identity/group/platform-capability semantics match the production contract.

If Company SSO production hookup cannot yet run in the company environment, mark it `PENDING COMPANY ENVIRONMENT`; it does not block Phase 4 product development, but production cutover cannot be claimed verified.

The populated-production migration/write-quiescence contract still follows the parent Phase 3 spec, unchanged by this amendment.

## 27. Phase 3 → Phase 4 hard gate

Product definition of Phase 3 completion:

```text
A trusted caller can:

enter My Space
→ import knowledge
→ create Team
→ manage access
→ observe truthful direct/effective-access state
→ revoke access
→ archive
→ continue reading archived knowledge
→ restore

while every visible product action is backed by the same
server-side authorization and lifecycle rules.
```

Begin Phase 4 Search / Retrieval / Knowledge Discovery implementation only after Product Acceptance PASS.

Production Company SSO Cutover may be marked separately pending, but pending cannot mean verified.

## 28. Implementation planning handoff

Approved. Authoritative implementation plan:

`docs/superpowers/plans/2026-09-15-phase-3-workspace-product-closure.md`

That plan replaces Tasks 12–14 of the existing Phase 3 plan, without adding Phase 3.5 or Task 15. Tasks 1–11 retain their established identity, migration, repository, lock-order, and cutover sequencing.
