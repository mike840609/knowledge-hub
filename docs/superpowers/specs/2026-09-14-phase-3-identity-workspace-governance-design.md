# Knowledge Hub — Phase 3 Identity, Workspace Administration & Governance Design

| Item | Content |
| --- | --- |
| Document date | 2026-09-14 |
| Document type | Design Spec; excludes Implementation Plan |
| Status | Review requested — review findings incorporated |
| Prerequisites | Phase 0 Foundation, Phase 1 Knowledge Core & Tree, Phase 2 Knowledge Source Import & Sync, Phase 2.5 Frontend Product Baseline |
| Existing authorization constraints | `2026-09-14-resource-visibility-access-semantics-amendment.md`, `2026-09-14-phase-3-authorization-clarification.md` |
| Core decision | Personal Space is represented by `Workspace(type=PERSONAL)`; Workspace is Phase 3's sole Knowledge authorization boundary |

## 1. Goal

Phase 3 upgrades the Phase 0–2 local/mock binary WorkspaceMembership foundation into Workspace lifecycle, trusted identity mapping, fixed RBAC, enterprise group grants, auditable governance, and lifecycle-safe mutation boundaries suitable for production company multi-user environments.

Personal Workspace / My Space and Team Workspace share one canonical Knowledge chain:

```text
trusted caller
  ↓
Workspace policy
  ↓
Workspace
  ↓
KnowledgeSource
  ↓
Tree / Document / Revision
```

Phase 3 does not change Phase 0–2 Source/Document ownership, stable IDs, Tree, Revision, or import/sync identity contracts.

The product is personal-first: sign-in defaults to My Space; Team Workspace is a governed shared Knowledge scope, rather than a separate Notion-style page hierarchy.

## 2. Non-goals

Phase 3 does not implement:

- Separate `PersonalSpace` / `UserKnowledge` domains.
- Source-level or Document-level ACL.
- custom-role DSL、explicit deny、per-user deny override。
- An assignable `DISCOVERER` role.
- email invite / pending invitation workflow。
- Materialized `user ↔ external_group` membership truth in Hub.
- Rich authoring; Phase 5 adds Web create/edit.
- Agent principal、MCP transport、Agent Memory domain。
- Workspace hard delete。
- Personal → Team synchronization / move / shared Document ID。

## 3. Workspace model

### 3.1 Types

```text
Workspace
├─ PERSONAL
│   └─ single-user application Knowledge scope
└─ TEAM
    └─ governed collaborative Knowledge scope
```

Personal and Team both use:

```text
Workspace → KnowledgeSource → Tree → Document
```

Personal Workspace may have multiple `HUB`, `FILE_UPLOAD`, and `FOLDER_SYNC` Sources, including Obsidian / LLM Wiki generated folders.

### 3.2 Canonical routes

Personal / Team both reuse Phase 2.5:

```text
/w/:workspaceId/knowledge/...
/w/:workspaceId/sources/...
```

No separate `/me/...` or `/personal/...` route set is created.

## 4. Personal Workspace invariants

1. Each provisioned Hub User has exactly one Personal Workspace; provisioning must be idempotent.
2. `workspace_type = PERSONAL`。
3. Display name is fixed to `My Space`; users cannot rename it.
4. `personal_owner_user_id` is required and must refer to one existing Hub User.
5. The owner must also have `OWNER / SYSTEM_PERSONAL` membership.
6. Ordinary direct members, SSO Group mappings, and ownership transfer are forbidden.
7. User-driven archive/delete is forbidden.
8. Identity deprovisioning uses a system governance freeze, without transferring ownership or automatically deleting Knowledge.
9. Personal resources still follow ordinary Workspace authorization through `Source.workspace_id`.
10. `My Space` is only a system-managed product label; authorization must not depend on the name string.

### 4.1 Early database uniqueness

Uniqueness of `personal_owner_user_id` **must not wait until final migration 009**. Migration 008 must create it as soon as it adds nullable `personal_owner_user_id`:

```text
UNIQUE(personal_owner_user_id)
```

MariaDB nullable UNIQUE permits multiple `NULL` values, so legacy TEAM rows safely coexist; from 008 onward, all Personal provisioning/backfill is protected by the DB-level rule of at most one Personal Workspace per Hub User.

Application provisioning remains idempotent: if concurrent creation collides on a unique constraint, roll back and reread the winning Personal Workspace, without creating a second Workspace.

## 5. Personal provisioning and default entry

```text
trusted external claims established
  ↓
resolve Hub identity by durable external identity link
  ↓
ensurePersonalWorkspace(hubUserId)
  ├─ exists  → return existing
  └─ missing → create PERSONAL Workspace
               + OWNER/SYSTEM_PERSONAL membership
               + audit event
  ↓
build CallerContext from resolved Hub identity + trusted claims
```

The browser cannot provide `owner_user_id` to provision another person's My Space or fields overriding Hub user ID, groups, or platform capabilities.

This bootstrap establishes trusted callers for all Human Web / API requests, not just `/`. Direct Team deep links and APIs follow the same order.

Migration must provide rerunnable Personal Workspace backfill for existing users, then verify each existing User has exactly one Personal Workspace and corresponding OWNER/SYSTEM_PERSONAL membership. Concurrent login provisioning and backfill remain idempotent through 008's owner unique constraint and application reread.

Explicitly backfill every existing Phase 0–2 Workspace as `TEAM`; do not infer type from workspace name, `org_code`, row order, or member count.

Phase 3 root navigation：

```text
/
  → establish trusted caller
  → ensure My Space
  → My Space
  → first Source by deterministic name order
  → first readable Document by existing Tree order
```

Empty My Space displays an empty state without automatically switching to Team Workspace.

## 6. Team Workspace creation and ownership

Team creation requires platform-level `workspace.create_team`. It is not a Workspace role capability and cannot be derived from `org_code`, Workspace metadata, or browser parameters.

Create transaction：

```text
create TEAM Workspace
+ creator DIRECT membership = OWNER
+ append audit event
```

SSO Group mapping is optional at creation.

Team permits multiple OWNERs, with the invariant:

```text
TEAM => direct OWNER count >= 1
```

SSO Groups can never grant OWNER, so owner count includes only direct memberships.

## 7. Trusted identity contract

### 7.1 External identity and durable account linking

Company SSO identity and Hub canonical `UserIdentity` are distinct concepts. External providers/sessions cannot directly determine `users.id`.

```text
ExternalCompanyIdentity
- provider: string
- subject: string              # provider-issued stable account subject
- emp_id: string               # trusted enterprise attribute; NOT account identity truth
- name: string
- org_code: string

TrustedIdentityClaims
- externalIdentity: ExternalCompanyIdentity
- validatedExternalGroupIds: string[]
- platformCapabilities: PlatformCapability[]
- refreshedAt: Date

Hub UserIdentity
- id: UUIDv7                   # Hub-owned stable internal ID
- emp_id: string
- name: string
- org_code: string
```

Phase 3 must persist:

```text
external_identity_links
- id UUID PK
- provider
- subject_bytes
- hub_user_id UUID
- created_at
- last_seen_at

UNIQUE(provider, subject_bytes)
UNIQUE(provider, hub_user_id)
FK hub_user_id → users.id
```

`subject` is an opaque provider identifier; persistence and lookup use exact UTF-8 bytes without trimming, lowercasing, or Unicode normalization.

Canonical account identity truth is:

```text
(provider, subject) → hub_user_id
```

It is not `emp_id → hub_user_id`.

### 7.2 Runtime resolver rules

The production runtime resolver **must not** automatically attach to an existing Hub User using `emp_id`.

1. Look up the identity link by `(provider, subject)` first.
2. Existing link → that Hub UUID is the sole account identity; synchronize only allowed profile fields.
3. No link, but `users.emp_id = external.emp_id` exists → fail closed with `IDENTITY_LINK_REQUIRED`; if the user is already linked to another subject of the same provider, use `IDENTITY_LINK_CONFLICT`.
4. No link and no emp_id → Hub creates a new UUIDv7 User + identity link in one transaction.
5. Unique constraints on `(provider,subject)` / `emp_id` converge identical concurrent first logins; reread the winning link after a duplicate race.
6. SSO subject, emp_id, OIDC `sub`, and other external identifiers must never be written directly to `users.id`.
7. An established `(provider, subject)` link does not change if emp_id is later reassigned.
8. External subject changes or account merges require explicit operator/account-link migration, without silent relinking.

### 7.3 Legacy identity-link bootstrap

Before company production rollout, existing Phase 0–2 Hub users must receive identity links through **explicit trusted bootstrap mapping**; the first person signing in with the same emp_id cannot claim a legacy account.

Bootstrap input includes at least:

```text
provider
subject
hub_user_id
expected_emp_id
```

Rules：

- `hub_user_id` must already exist.
- Verify trusted-directory subject/emp_id against the bootstrap entry.
- `expected_emp_id` is only an operator safety assertion, not an account-link key.
- duplicate provider+subject / provider+hub_user conflict fail closed。
- Company production readiness must confirm every existing human Hub user in rollout scope has an identity link for the configured company provider.

### 7.4 Authenticated principal / provider

```text
IdentityProvider.getCurrentClaims()
  → TrustedIdentityClaims

HubIdentityResolver.resolve(externalIdentity)
  → Hub UserIdentity

TrustedCaller bootstrap
  → claims
  → resolve durable identity link
  → ensure My Space
  → AuthenticatedPrincipal / CallerContext
```

`AuthenticatedPrincipal.identity` is always Hub UserIdentity.

The bootstrap syncs the Hub user row (id, emp_id, name, org_code) before it builds the caller, and marks that caller `identitySynced`. A service asked by such a caller does not sync the row again; one asked by any other caller (a script, a test, a future non-Web entry) still does, through `syncCallerIdentity`. The mark records that the row is current for this request. It grants nothing, and only the bootstrap sets it.

IdentityProvider validates sign-in sessions, external identity, group IDs, and server-side platform-capability mapping; it must not accept browser-supplied truth.

- Local/dev may use a server-configured Local provider.
- Company deployment uses Company SSO provider + server-side session reader.
- Production must not silently fall back to Local provider.
- Missing production provider/session integration makes startup/readiness fail closed.

## 8. Data model delta

### 8.1 `workspaces`

```text
workspaces
- id UUID PK
- name
- workspace_type: PERSONAL | TEAM
- personal_owner_user_id UUID NULL
- lifecycle_state: ACTIVE | ARCHIVED
- created_by UUID NULL
- created_at
- updated_at
- archived_by UUID NULL
- archived_at NULL
```

Migration 008 creates nullable `personal_owner_user_id` + `UNIQUE(personal_owner_user_id)`; final 009 completes/verifies canonical constraints including `workspace_type NOT NULL`, FK `personal_owner_user_id/created_by/archived_by → users.id`, type/lifecycle CHECKs, and PERSONAL name `My Space`.

### 8.2 `workspace_memberships`

```text
workspace_memberships
- workspace_id
- user_id
- role: OWNER | ADMIN | EDITOR | VIEWER
- membership_source: DIRECT | SYSTEM_PERSONAL
- created_by UUID NULL
- created_at
- updated_at
```

Final schema：`role NOT NULL`、`membership_source NOT NULL`、valid-role/source CHECK、Workspace/User/created_by FKs。

### 8.3 `external_identity_links`

```text
external_identity_links
- id UUID PK
- provider
- subject_bytes VARBINARY(...)
- hub_user_id UUID
- created_at
- last_seen_at
```

Unique exact `(provider, subject_bytes)` + unique `(provider, hub_user_id)` + FK Hub user。

### 8.4 `workspace_group_mappings`

Group mapping is TEAM-only; unique `(workspace_id, external_group_id)`; roles only ADMIN/EDITOR/VIEWER; opaque group IDs use exact-byte semantics; Hub stores no user↔group truth. Final schema has Workspace/User actor FKs.

### 8.5 `workspace_audit_events`

Audit fields include workspace, actor kind/user, event type, target type/id, payload, correlation, created_at. Final schema has Workspace FK, nullable actor User FK, and JSON/actor CHECK; polymorphic `target_id` has no single FK. Application provides no audit UPDATE/DELETE.

## 9. Fixed roles and capability bundles

Assignable roles are exactly OWNER / ADMIN / EDITOR / VIEWER. No assignable DISCOVERER.

```text
OWNER  = all Phase 3 Workspace-scoped capabilities
ADMIN  = discover/read/write + source.manage + membership.manage_basic + audit.read
EDITOR = discover/read/write + source.manage
VIEWER = discover/read
```

Retain at least these capabilities: workspace/source/document discover, document read/write, source.manage, membership basic/admin/owner, workspace rename/archive/restore, audit.read.

## 10. OWNER / ADMIN authority

OWNER may rename/archive/restore Team, manage all direct roles, manage Group→ADMIN|EDITOR|VIEWER, and read audit.

ADMIN may only manage direct EDITOR/VIEWER, Group→EDITOR|VIEWER, and read audit; it cannot create/remove OWNER/ADMIN authority.

Grant mutation checks both persisted beforeRole and requested afterRole under the Workspace lock. The final direct OWNER cannot be removed/demoted; Team always has direct OWNER >= 1.

## 11. Authorization evaluation

```text
effective capabilities
= direct role capabilities
  UNION
  all matched validated-group role capabilities
```

No explicit deny; no Direct-vs-Group precedence.

`listAccessibleWorkspaces(caller)` aggregates Personal system membership, Team direct membership, and matching validated group mappings.

Phase 3 fully calculates group-derived effective access only for the current caller. Other users show only direct membership + `UNKNOWN_NOT_EVALUATED`; unknown must not be treated as an empty group set.

## 12. Discover vs read

```text
canDiscover=false → 404
canDiscover=true && canRead=false → 403
```

All four assignable roles include read; retain the underlying discover/read distinction for Search/MCP/retrieval/future policy.

## 13. Workspace-only authorization boundary

Phase 3 has no Source/Document ACL. A different member set requires another Team Workspace.

> **Exception (2026-09-23):** Document share links are single-document, read-only, expiring bearer grants without sign-in, rather than ACLs: they specify no recipient, expand no Workspace capability, and do not enter `evaluateEffectiveCapabilities`. See the [share link spec](2026-09-23-document-share-link-design.md). **Amendment (2026-10-09):** a live link permits anonymous reads of visible document-scoped review records and bounded current-revision selection fragments; new comments and replies additionally require a server-verified caller. This grants no membership, document editing, history, tree, search or MCP access. Owner moderation derives PERSONAL ownership independently of links. See the [inline review design](2026-10-09-shared-personal-document-inline-review-design.md).

## 14. Lifecycle and mutation serialization

### 14.1 Team lifecycle

ACTIVE ↔ ARCHIVED; only OWNER may archive/restore.

ARCHIVED allowed：authorized read、OWNER/ADMIN audit read、OWNER restore。

ARCHIVED blocked：Source import/sync/create/mutation、Knowledge authoring/mutation、member/group mutation、rename。

### 14.2 Canonical lock protocol

Every Workspace-scoped mutation must hold parent Workspace `FOR UPDATE` and revalidate lifecycle/capability before actual mutation.

> **Amended (2026-10-07):** content and import writers now hold the parent Workspace `LOCK IN SHARE MODE`; governance (archive/restore, rename, membership and group changes) keeps `FOR UPDATE`, so it still waits for every in-flight writer and this section's guarantees hold. `ensure-default-hub-source` stays exclusive. See the [workspace shared write lock design](2026-10-07-workspace-shared-write-lock-design.md).

#### Pre-Snapshot creation

```text
createInitial:
  creator quota/advisory lock (if used)
  → Workspace FOR UPDATE
  → authorize source.manage + require ACTIVE
  → insert ImportSnapshot + staging entries

createResync:
  creator quota/advisory lock (if used)
  → existing Source FOR UPDATE
  → parent Workspace FOR UPDATE
  → authorize source.manage + require ACTIVE
  → capture source.sync_version
  → insert ImportSnapshot + staging entries in SAME transaction
```

`createResync` must not read Source/basedOnVersion in transaction A and insert the snapshot in transaction B.

#### Existing Snapshot mutation

```text
initial apply: Snapshot → Workspace → create Source → deeper writes
resync/apply: Snapshot → Source → Workspace → deeper writes
upload/finalize: Snapshot → Workspace → staging writes
```

Other paths：

```text
non-import existing Source: Source → Workspace → deeper rows
non-import new Source: Workspace → create Source
membership/group governance: Workspace → grant rows → mutate + audit
archive/restore: Workspace → lifecycle mutation + audit
```

Lock invariants: quota/advisory locks always precede DB row locks; no Workspace→Snapshot or Workspace→existing Source; after holding Workspace, do not lock unrelated Snapshot/Source; archive/governance does not lock Source/Snapshot.

Concurrency tests must cover archive versus createInitial/createResync/initial apply/resync apply/upload/finalize/content/member-group mutation, proving no post-archive mutation commit or lock-inversion deadlock.

### 14.3 Archived governance recovery

Ordinary membership/group mutation remains forbidden when archived. System-only recovery may restore Team or grant direct OWNER to an existing Hub User; normal HTTP/UI does not expose it, and audit is required.

## 15. Legacy bootstrap, staged migration and readiness

### 15.1 Populated-production rollout requires write quiescence

Phase 3's staged migration is not an online mixed-version migration. For a populated production database, the MVP deployment contract is:

```text
enter maintenance / canonical-write quiescence
  ↓
apply Migration 008
  ↓
run governance bootstrap
run trusted legacy identity-link bootstrap
run Personal Workspace backfill
  ↓
apply Migration 009
  ↓
deploy/enable Phase-3-compatible application
  ↓
exit maintenance / resume canonical writes
```

Quiescence must begin **before 008** and last until **009 is complete and Phase-3-compatible writers are ready**. During this period:

- Old applications must not write canonical tables, covering at least `users`, `workspaces`, `workspace_memberships`, and all paths creating/changing Workspace governance state.
- If deployment cannot isolate writes precisely, use full application write maintenance mode; read-only traffic may remain.
- Only migrations and explicit Phase 3 bootstrap/backfill/recovery scripts may perform controlled writes.
- Read-only validation in `beforeApply` **is not** a write fence; legacy apps cannot be assumed to respect the schema-migration advisory lock either, so neither replaces quiescence.
- A rollout that lets Phase 0–2 writers keep creating Workspace/Membership after bootstrap and then directly applies 009 is unsupported.

This continues the existing populated-migration safety model: stop canonical writes during cutover until the final constraint migration finishes.

### 15.2 Migration 008

008 is an additive/compatibility schema:

- add `workspace_type` / lifecycle governance columns。
- add nullable membership `role` / `membership_source` where needed。
- Add nullable `personal_owner_user_id` **and immediately create `UNIQUE(personal_owner_user_id)`**.
- create identity links / group mappings / audit tables and safe indexes/FKs。
- Do not treat 008 as the final canonical schema.

### 15.3 Bootstrap gates

Before 009, governance bootstrap verifies direct OWNER >= 1 for every Team and valid non-null membership role/source; explicitly assign an existing Hub User OWNER to zero-member Teams.

Before production enablement, company identity bootstrap creates trusted `(provider, subject) → hub_user_id` links for every existing human Hub User in rollout scope. Runtime does not claim legacy users by emp_id.

Personal backfill idempotently creates missing My Space + OWNER/SYSTEM_PERSONAL memberships under 008's unique owner constraint.

After all bootstrap/backfill completes, enter 009 while maintaining write quiescence.

### 15.4 Migration 009

009 `beforeApply`/equivalent fails closed if DB governance bootstrap is incomplete. 009 finalizes workspace_type NOT NULL, membership role/source NOT NULL, role/source/type/lifecycle CHECKs, and canonical Workspace/User FKs (workspaces/memberships/identity links/group mappings/audit).

Maintain application write quiescence throughout the 009 gate and DDL execution; migration runner `beforeApply` is only read validation, and DDL statements are not a shared transaction fence with legacy writers.

Production application readiness additionally verifies configured company provider/session and completed identity-link bootstrap for legacy users in configured company rollout scope. Do not enable production Phase 3 authorization until 009 is APPLIED and identity-link readiness is complete.

## 16. Audit

At least: PERSONAL_WORKSPACE_PROVISIONED/FROZEN, TEAM_WORKSPACE_CREATED/RENAMED/ARCHIVED/RESTORED/GOVERNANCE_RECOVERED, MEMBER_ADDED/ROLE_CHANGED/REMOVED, GROUP_MAPPING_ADDED/ROLE_CHANGED/REMOVED.

Governance mutation + audit share one transaction. OWNER/ADMIN may read Team audit.

## 17. Product behavior

Workspace selector: My Space always first, Team names ascending; no role/org/owner/member count displayed.

Team admin UI has Members / SSO Groups / Audit. Current caller may display full grant provenance; other users show only direct role + `Group access not evaluated`. Personal UI shows no governance controls.

## 18. Personal → Team future promotion contract

My Space Document A → Promote → new Team Document B; retain A; B gets a new ID; no move, sync, shared ID, or lineage dependency.

## 19. Production cutover strategy

This section describes production cutover **after implementation is complete**. The following must already be implemented and tested before maintenance begins:

- Phase-3-compatible Workspace / membership / Personal / Team writers。
- Source / Knowledge / import canonical locking retrofit。
- Personal Workspace backfill tooling。
- Company SSO provider、durable identity-link resolver、capability authorization。
- Team governance API/UI and system-only recovery implementation.

Production cutover order:

1. Enter canonical-write quiescence / maintenance mode before 008。
2. Apply migration 008; nullable UNIQUE on `personal_owner_user_id` takes effect here.
3. Backfill existing Workspaces explicitly TEAM。
4. Run explicit Team role/owner bootstrap。
5. Run explicit trusted legacy identity-link bootstrap; runtime cannot claim existing users by emp_id.
6. Provision/backfill existing users' My Space + OWNER/SYSTEM_PERSONAL; 008's unique constraint converges concurrent duplicates.
7. While writes remain quiesced, apply migration 009 final constraints/FKs。
8. Pass production readiness：009 applied + company provider configured + identity-link rollout complete + Phase-3-compatible application/writers ready。
9. Switch traffic / enable trusted Company SSO → identity-link resolver → CallerContext + capability-union authorization on the Phase-3-compatible deployment。
10. Verify the Phase-3-compatible deployment is the only canonical application writer。
11. Exit maintenance / resume canonical writes。

Canonical locking, writer retrofit, and API/UI implementation **must not** be deferred into this cutover window; they are implementation prerequisites before production cutover.

## 20. Required tests / verification evidence

### Identity / SSO

- existing `(provider,subject)` resolves same Hub UUID。
- external IDs never become `users.id`。
- runtime subject with existing emp_id but no link fails `IDENTITY_LINK_REQUIRED`；does not auto-attach。
- different subject using recycled emp_id cannot inherit already-linked account。
- explicit bootstrap can link trusted provider subject to exact existing Hub user after validating expected emp_id。
- new subject + unused emp_id creates UUIDv7 user + link atomically。
- concurrent identical first-login converges on one user/link。
- production readiness fails if required legacy links missing。

### Personal Workspace / schema

- migration 008 creates nullable unique `personal_owner_user_id` before Personal provisioning/backfill begins。
- two concurrent Personal provisions for same user converge to one Workspace and one SYSTEM_PERSONAL membership。
- Personal backfill is rerunnable and cannot create a second My Space。
- 008 applies to legacy DB。
- 009 refuses before governance bootstrap。
- after 009 null/invalid role/source/type rejected at DB level。
- canonical FKs reject orphan identity/group/audit rows。

### Rollout safety

- documented production runbook enters write quiescence before 008 and resumes only after 009 + Phase-3-compatible writer readiness。
- bootstrap/backfill scripts are the only allowed canonical writers during cutover。
- negative migration test: a synthetic legacy Workspace/Membership row written after bootstrap with NULL Phase 3 fields makes 009 readiness fail rather than silently finalize。
- verification report records the maintenance/write-fence procedure; migration lock/beforeApply is not claimed to provide application write fencing。

### Authorization / governance

- roles exactly OWNER/ADMIN/EDITOR/VIEWER。
- Group max ADMIN。
- ADMIN cannot mutate OWNER/ADMIN authority。
- direct+group capability union。
- other-user group state never fabricated。
- Team direct OWNER >= 1。

### Concurrency

- createInitial: quota→Workspace→snapshot serializes with archive。
- createResync: quota→Source→Workspace→snapshot single transaction；binding/version captured under lock。
- archive win prevents pre-Snapshot creation commit。
- existing import paths Snapshot→[Source]→Workspace。
- no Workspace→Snapshot or Workspace→existing Source inversion。
- governance vs archive serializes。

### Audit

- every governance mutation atomically appends audit。
- audit failure rolls back mutation。
- no audit update/delete API。

## 21. Acceptance criteria

1. Every User exactly one system-managed My Space。
2. Migration 008 protects one-My-Space-per-user with nullable unique `personal_owner_user_id` before provisioning/backfill can run。
3. `/` enters My Space；Personal/Team reuse Workspace routes。
4. Team creation requires trusted platform capability and creates direct OWNER。
5. Team direct OWNER >= 1。
6. Roles exactly OWNER/ADMIN/EDITOR/VIEWER。
7. OWNER/ADMIN authority follows spec。
8. Direct + validated Group capabilities union；no deny。
9. Hub does not materialize user↔group truth.
10. Other-user group-effective access never fabricated。
11. Durable company account identity is `(provider,subject)→Hub UUID`; runtime never uses emp_id to claim an existing account；legacy links are explicitly bootstrapped。
12. Workspace is only Phase 3 Knowledge ACL boundary。
13. All pre-/post-Snapshot import, Source/Knowledge, governance mutations follow lock protocol。
14. Archived Team read-only；system-only recovery audited。
15. Governance mutation + audit atomic。
16. Populated rollout holds canonical-write quiescence from before 008 through 009 and Phase-3-compatible writer readiness。
17. 009 finalizes nullable bootstrap fields/CHECK/FKs；production readiness also requires identity-link bootstrap completeness。
18. Existing Workspace/Source/Document/Revision IDs/routes unchanged。

## 22. Architectural summary

```text
Trusted company session
  ├─ provider + subject
  ├─ emp_id/profile
  ├─ validated groups
  └─ platform capabilities
          ↓
external_identity_links
(provider,subject) → Hub UUIDv7
          ↓
AuthenticatedPrincipal / CallerContext
          ↓
Workspace authorization
= direct grants ∪ validated group grants
          ↓
Mutation serialization
  pre-snapshot initial: Workspace → Snapshot
  pre-snapshot resync: Source → Workspace → Snapshot
  existing import: Snapshot → [Source] → Workspace
  other existing Source: Source → Workspace
          ↓
Sources / Knowledge
```

The system keeps one Knowledge container abstraction: **Workspace**. Personal Space is a Workspace governance specialization, not a second storage/search/MCP architecture.
