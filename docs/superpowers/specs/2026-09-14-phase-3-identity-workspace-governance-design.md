# Knowledge Hub — Phase 3 Identity, Workspace Administration & Governance Design

| 項目 | 內容 |
| --- | --- |
| 文件日期 | 2026-09-14 |
| 文件類型 | Design Spec；不包含 Implementation Plan |
| 狀態 | Review requested — review findings incorporated |
| 前置 | Phase 0 Foundation、Phase 1 Knowledge Core & Tree、Phase 2 Knowledge Source Import & Sync、Phase 2.5 Frontend Product Baseline |
| 既有授權約束 | `2026-09-14-resource-visibility-access-semantics-amendment.md`、`2026-09-14-phase-3-authorization-clarification.md` |
| 核心決策 | Personal Space 以 `Workspace(type=PERSONAL)` 表達；Workspace 是 Phase 3 唯一 Knowledge authorization boundary |

## 1. Goal

Phase 3 把 Phase 0–2 的 local/mock binary WorkspaceMembership foundation 升級成可用於公司正式多使用者環境的 Workspace lifecycle、trusted identity mapping、fixed RBAC、enterprise group grants、auditable governance 與 lifecycle-safe mutation boundary。

Personal Workspace / My Space 與 Team Workspace 共用同一條 canonical Knowledge chain：

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

Phase 3 不改 Phase 0–2 的 Source/Document ownership、stable IDs、Tree、Revision 或 import/sync identity contract。

產品採 personal-first：登入後預設進 My Space；Team Workspace 是受治理建立的共享 Knowledge scope，不是另一套 Notion-style page hierarchy。

## 2. Non-goals

Phase 3 不做：

- 獨立 `PersonalSpace` / `UserKnowledge` domain。
- Source-level 或 Document-level ACL。
- custom-role DSL、explicit deny、per-user deny override。
- 可指派的 `DISCOVERER` role。
- email invite / pending invitation workflow。
- Hub 內 materialize `user ↔ external_group` membership truth。
- rich authoring；Phase 5 才加入 Web create/edit。
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

Personal 與 Team 都使用：

```text
Workspace → KnowledgeSource → Tree → Document
```

Personal Workspace 可以有多個 `HUB`、`FILE_UPLOAD`、`FOLDER_SYNC` Sources，也可以承接 Obsidian / LLM Wiki generated folders。

### 3.2 Canonical routes

Personal / Team 都沿用 Phase 2.5：

```text
/w/:workspaceId/knowledge/...
/w/:workspaceId/sources/...
```

不建立 `/me/...` 或 `/personal/...` 第二套 route。

## 4. Personal Workspace invariants

1. 每個 provisioned Hub User 有且只有一個 Personal Workspace；provision operation 必須 idempotent。
2. `workspace_type = PERSONAL`。
3. display name 固定為 `My Space`，不可由 user rename。
4. 必須有 `personal_owner_user_id`，且只能對應一個 existing Hub User。
5. owner 必須同時有 `OWNER / SYSTEM_PERSONAL` membership。
6. 不允許 ordinary direct member、SSO Group mapping、ownership transfer。
7. 不允許 user-driven archive/delete。
8. identity deprovisioning 走 system governance freeze；不轉移 owner、不自動刪除 Knowledge。
9. Personal resource 仍透過 `Source.workspace_id` 走一般 Workspace authorization。
10. `My Space` 只是 system-managed product label；authorization 不得靠 name 字串判斷。

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

Browser 不得提供 `owner_user_id` 來 provision 別人的 My Space，也不得提供可覆寫 Hub user ID、group 或 platform capability 的欄位。

上述 bootstrap 是所有 Human Web / API request 共用的 trusted caller establishment，不只在 `/` 執行。直接進入 Team deep link 或 API 也遵守相同順序。

Migration 必須提供可重跑的 existing-user backfill command，完成後驗證每位既有 User 恰有一個 Personal Workspace 與對應 OWNER/SYSTEM_PERSONAL membership。登入 provisioning 與 backfill 並行時仍保持 idempotent。

Existing Phase 0–2 Workspace 全部明確 backfill 為 `TEAM`；不得依 workspace name、`org_code`、row order 或 member count 猜 type。

Phase 3 root navigation：

```text
/
  → establish trusted caller
  → ensure My Space
  → My Space
  → first Source by deterministic name order
  → first readable Document by existing Tree order
```

My Space 為 empty 時顯示 empty state，不自動跳 Team Workspace。

## 6. Team Workspace creation and ownership

Team creation 需要 platform-level：

```text
workspace.create_team
```

它不是 Workspace role capability，也不能由 `org_code`、Workspace metadata 或 browser parameter 推導。

Create transaction：

```text
create TEAM Workspace
+ creator DIRECT membership = OWNER
+ append audit event
```

Create 時 SSO Group mapping optional。

Team 允許 multiple OWNER，但 invariant 是：

```text
TEAM => direct OWNER count >= 1
```

SSO Group 永遠不能 grant OWNER，因此 owner count 只計 direct membership。

## 7. Trusted identity contract

### 7.1 External identity and durable account linking

Company SSO identity 與 Hub canonical `UserIdentity` 是兩個不同概念。外部 provider/session 不得直接決定 `users.id`。

```text
ExternalCompanyIdentity
- provider: string             # e.g. company-sso
- subject: string              # provider-issued stable subject
- emp_id: string               # trusted enterprise attribute, not account identity truth
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

Phase 3 必須持久化 external identity link：

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

`subject` 視為 opaque provider identifier；持久化與 lookup 使用 exact UTF-8 bytes，不 trim / lowercase / Unicode-normalize。

Canonical account-link truth 是：

```text
(provider, subject) → hub_user_id
```

不是 `emp_id → hub_user_id`。

Resolver rules：

1. 先以 `(provider, subject)` 查 `external_identity_links`。
2. 若 link 已存在，該 Hub UUID 是唯一 account identity；只能同步允許更新的 profile fields。
3. 若 link 不存在，可用 trusted `emp_id` 做 **first-link candidate matching only**，以承接既有 Phase 0–2 Hub user。
4. 若 `emp_id` 找到 existing Hub user 且該 user 在同 provider 尚無 identity link，transactionally 建立 link。
5. 若 `emp_id` 指向已被同 provider 的另一個 subject 綁定之 user，必須 fail closed (`IDENTITY_LINK_CONFLICT`)；不得把新 subject 接到舊帳號。
6. 若沒有 existing user，Hub 產生新的 UUIDv7 user + identity link，在同一 transaction 建立。
7. concurrent first login / first link 由 unique constraints 收斂；duplicate race 後 re-read winning link。
8. SSO `subject`、`emp_id`、OIDC `sub` 或其他 external identifier 永遠不得直接寫入 `users.id`。
9. `emp_id` 的重新指派不會改變 `(provider, subject)` link；新 subject 不能因碰巧拿到舊 emp_id 而繼承舊 My Space / Team membership。

若 external subject 本身變更，必須走明確 operator/account-link migration，不做 silent relink。

### 7.2 Authenticated principal

Hub identity resolution 完成後，trusted caller boundary 才建立：

```text
AuthenticatedPrincipal
- identity: Hub UserIdentity
- validatedExternalGroupIds: string[]
- platformCapabilities: PlatformCapability[]
- refreshedAt: Date
```

`CallerContext` 只能由 `AuthenticatedPrincipal` 建立。

### 7.3 Provider, resolver and provider selection

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

IdentityProvider 負責驗證登入 session、external identity、group IDs 與 server-side platform capability mapping；不得接受 browser-supplied identity/group/capability truth。

- local/dev 可使用 server-configured Local provider。
- company deployment 使用 Company SSO provider + server-side session reader。
- production 不得 silently fallback 到 Local provider。
- production provider/session integration 缺失時 startup/readiness fail closed。

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

Invariants：

```text
PERSONAL => personal_owner_user_id IS NOT NULL
TEAM     => personal_owner_user_id IS NULL
UNIQUE(personal_owner_user_id)
PERSONAL => name = 'My Space'
```

Final schema 必須有：

- `workspace_type NOT NULL`。
- FK `personal_owner_user_id`, `created_by`, `archived_by` → `users.id`（nullable columns 保留 nullable FK semantics）。
- type/lifecycle CHECK constraints。

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

Final schema 必須有 `role NOT NULL`、`membership_source NOT NULL`、valid-role/source CHECK，以及 workspace/user/created_by FKs。

### 8.3 `external_identity_links`

```text
external_identity_links
- id UUID PK
- provider VARCHAR(...)
- subject_bytes VARBINARY(...)
- hub_user_id UUID NOT NULL
- created_at
- last_seen_at
```

Rules：

- unique exact `(provider, subject_bytes)`。
- unique `(provider, hub_user_id)`。
- FK `hub_user_id → users.id`。
- provider 不由 browser 任意指定；來自 configured trusted provider。

### 8.4 `workspace_group_mappings`

```text
workspace_group_mappings
- id UUID PK
- workspace_id
- external_group_id
- role: ADMIN | EDITOR | VIEWER
- created_by
- created_at
- updated_by
- updated_at
```

Rules：

- TEAM only。
- `(workspace_id, external_group_id)` unique。
- `external_group_id` 是 opaque identifier；使用 exact UTF-8 bytes 比對，不 normalize。
- Group 不可 grant OWNER。
- Hub 不保存 user↔group membership truth。
- Final schema 必須有 FK `workspace_id → workspaces.id`、`created_by/updated_by → users.id`。

### 8.5 `workspace_audit_events`

```text
workspace_audit_events
- id UUID PK
- workspace_id UUID
- actor_kind: USER | SYSTEM
- actor_user_id UUID NULL
- event_type
- target_type: WORKSPACE | MEMBER | GROUP_MAPPING
- target_id UUID NOT NULL
- payload JSON
- correlation_id NULL
- created_at
```

Final schema 必須有 FK `workspace_id → workspaces.id`、nullable FK `actor_user_id → users.id`、JSON/actor CHECK constraints。`target_id` 保持 polymorphic UUID，不加單一 FK。

Application API 不提供 UPDATE / DELETE audit event。

## 9. Fixed roles and capability bundles

Assignable roles exactly：

| Role | Purpose |
| --- | --- |
| `OWNER` | Team 最終治理權；Personal fixed owner |
| `ADMIN` | Team 日常管理，不可建立新的 governance authority |
| `EDITOR` | Knowledge contributor / Source operator |
| `VIEWER` | Read-only Knowledge consumer |

沒有 assignable `DISCOVERER`。

Workspace-scoped capabilities 至少：

```text
workspace.discover
source.discover
document.discover
document.read
document.write
source.manage
membership.manage_basic
membership.manage_admin
membership.manage_owner
workspace.rename
workspace.archive
workspace.restore
audit.read
```

Bundle：

```text
OWNER  = all Phase 3 Workspace-scoped capabilities
ADMIN  = discover/read/write + source.manage + membership.manage_basic + audit.read
EDITOR = discover/read/write + source.manage
VIEWER = discover/read
```

`document.write` 不繞過 Source ownership guard；`SOURCE_MANAGED` 仍由 Source sync authority 控制。

## 10. OWNER / ADMIN authority

OWNER 可以 rename/archive/restore Team、管理所有 direct roles、管理 Group→ADMIN|EDITOR|VIEWER、read audit。

ADMIN 只能管理 direct EDITOR/VIEWER、Group→EDITOR|VIEWER、read audit；不可建立或移除 OWNER/ADMIN authority。

每次 direct/group grant mutation 必須在 Workspace lock 下同時檢查 persisted beforeRole 與 requested afterRole。新增只檢查 afterRole；刪除只檢查 beforeRole；更新/upsert existing row 兩者都檢查。

Final direct OWNER 不得 remove/demote；Team 永遠 `direct OWNER count >= 1`。

## 11. Authorization evaluation

```text
effective capabilities
= direct role capabilities
  UNION
  all matched validated-group role capabilities
```

No explicit deny；沒有 Direct-vs-Group precedence。

`listAccessibleWorkspaces(caller)` 聚合 Personal system membership、Team direct membership、matching validated group mappings。

### 11.1 Effective-access inspection scope

Phase 3 只完整計算 **current caller** 的 group-derived effective access。對其他 Hub user：

- 顯示 direct membership。
- group access = `UNKNOWN_NOT_EVALUATED`。
- 不得把 unknown 當 empty group set。

若未來要查任意 user 的 group-effective access，需另設 trusted IAM directory lookup。

## 12. Discover vs read

繼承 accepted semantics：

```text
canDiscover(resource)
├─ false → 404 NOT_FOUND
└─ true
   ├─ canRead(resource) → normal response
   └─ false → 403 ACCESS_DENIED
```

四個 assignable roles 都包含 read，但底層 discover/read distinction 保留給 Search/MCP/retrieval/future policy。

## 13. Workspace-only authorization boundary

Phase 3 不做 Source/Document ACL。若一批 Knowledge 需要不同成員集合，MVP 解法是另一個 Team Workspace。

## 14. Lifecycle and mutation serialization

### 14.1 Team lifecycle

```text
ACTIVE ↔ ARCHIVED
```

只有 OWNER 可以 archive / restore。

ARCHIVED allowed：authorized read、OWNER/ADMIN audit read、OWNER restore。

ARCHIVED blocked through ordinary APIs：Source import/sync/create/mutation、Knowledge authoring/mutation、member/group mutation、rename。

### 14.2 Canonical lock protocol

任何可能 commit Workspace-scoped mutation 的 transaction，都必須在 mutation 前持有 parent Workspace row `SELECT ... FOR UPDATE`，並在取得 lock 後重新驗證 lifecycle/capability。

Import 有兩種階段：

#### Pre-Snapshot creation

Snapshot 尚不存在時不能套 Snapshot-first lock，因此：

```text
createInitial:
  acquire creator quota lock (if used)
  → lock Workspace FOR UPDATE
  → re-evaluate source.manage + ACTIVE
  → insert ImportSnapshot + staging entries

createResync:
  acquire creator quota lock (if used)
  → lock existing Source FOR UPDATE
  → lock parent Workspace FOR UPDATE
  → re-evaluate source.manage + ACTIVE
  → capture current sync_version
  → insert ImportSnapshot + staging entries in same transaction
```

`createResync` 不得先在 transaction A 讀 Source/basedOnVersion，再在 transaction B insert snapshot；Source binding/version capture 與 snapshot creation 必須在同一 transaction 完成。

#### Existing Snapshot mutation

```text
initial apply:
  lock ImportSnapshot FOR UPDATE
  → lock Workspace FOR UPDATE
  → re-evaluate source.manage + ACTIVE
  → create Source
  → deeper writes

resync/apply:
  lock ImportSnapshot FOR UPDATE
  → lock bound Source FOR UPDATE
  → lock parent Workspace FOR UPDATE
  → re-evaluate source.manage + ACTIVE
  → deeper writes

upload/finalize/staging mutation:
  lock ImportSnapshot FOR UPDATE
  → lock Workspace FOR UPDATE
  → re-evaluate capability + ACTIVE
  → mutate staging state
```

Other paths：

```text
non-import existing Source mutation:
  Source → Workspace → deeper rows

non-import new Source creation:
  Workspace → create Source

membership/group governance:
  Workspace → grant rows → mutate + audit

archive/restore:
  Workspace → lifecycle mutation + audit
```

Lock-order invariants：

- quota/advisory lock（若使用）永遠在 DB row locks 之前取得，不可反向取得。
- Existing Snapshot flow 固定 `ImportSnapshot → [Source] → Workspace`。
- 禁止 `Workspace → ImportSnapshot`。
- Existing Source mutation 固定 `Source → Workspace`。
- 禁止 `Workspace → existing Source`。
- 一旦持有 Workspace lock，不得再取得 unrelated Snapshot/Source lock。
- archive/governance 不鎖 Source/Snapshot。

Concurrency tests 必須涵蓋 archive vs `createInitial`、`createResync`、initial apply、resync apply、upload/finalize、content mutation、membership/group mutation，並證明無 post-archive mutation commit / lock inversion deadlock。

### 14.3 Archived governance recovery

ordinary archived membership/group mutation 維持禁止。Phase 3 提供 system-only recovery service/command：可 restore Team 或 grant existing Hub User 為 direct OWNER；不可從 normal HTTP/UI 呼叫，且必須 append `TEAM_WORKSPACE_GOVERNANCE_RECOVERED` audit event。

## 15. Legacy bootstrap, staged migration and readiness

Phase 3 rollout 明確分三段：

```text
Migration 008: additive / compatibility schema
  ↓
Explicit bootstrap + backfill + validation
  ↓
Migration 009: final constraints / FKs / NOT NULL
  ↓
Phase 3 production readiness enabled
```

### 15.1 Migration 008

允許 legacy compatibility：

- add `workspace_type` and membership role/source as nullable where necessary。
- create `external_identity_links`、group mappings、audit tables。
- add non-breaking indexes / columns。
- 不假裝 bootstrap 尚未完成時 schema 已 canonical。

### 15.2 Bootstrap gate

Bootstrap 必須 explicit 指定 existing Team memberships/owners；不得 heuristic elevation。

在進入 009 前驗證：

```text
for every TEAM workspace:
  direct OWNER count >= 1
  every membership has valid non-null role
  every membership has valid non-null membership_source

for every existing user required by rollout:
  canonical user row remains stable
```

零會員 legacy Workspace 必須 explicit 指定 existing Hub User 為 OWNER。

### 15.3 Migration 009 finalization

009 的 `beforeApply` / equivalent readiness check 必須 fail closed if bootstrap 未完成。009 完成：

- `workspaces.workspace_type NOT NULL` + valid CHECK。
- `workspace_memberships.role NOT NULL`。
- `workspace_memberships.membership_source NOT NULL`。
- final role/source/type/lifecycle/actor CHECKs。
- canonical FKs for Workspace/User relationships in workspaces, memberships, identity links, group mappings, audit events。

Production Phase 3 authorization/readiness 不得在 009 未 APPLIED 時啟用。

## 16. Audit

Governance events 至少：

```text
PERSONAL_WORKSPACE_PROVISIONED
PERSONAL_WORKSPACE_FROZEN
TEAM_WORKSPACE_CREATED
TEAM_WORKSPACE_RENAMED
TEAM_WORKSPACE_ARCHIVED
TEAM_WORKSPACE_RESTORED
TEAM_WORKSPACE_GOVERNANCE_RECOVERED
MEMBER_ADDED
MEMBER_ROLE_CHANGED
MEMBER_REMOVED
GROUP_MAPPING_ADDED
GROUP_MAPPING_ROLE_CHANGED
GROUP_MAPPING_REMOVED
```

Governance mutation + audit append 必須同 transaction commit/rollback。OWNER/ADMIN 可讀 Team audit；EDITOR/VIEWER 不可。

## 17. Product behavior

Workspace selector：

```text
Workspace ▼

My Space
────────────
Team Workspaces
  HRKM
  Query Master
  SWFP
```

My Space 永遠置頂；Team MVP name ascending；selector 不顯示 role/org/owner/member count。

Team administration UI 分開 Members / SSO Groups / Audit。對 current caller 可顯示完整 grant provenance；對 other user 僅顯示 direct role + `Group access not evaluated`。

Personal UI 不顯示 rename/member/group/transfer/archive/delete。

## 18. Personal → Team future promotion contract

Phase 3 不實作 content promotion，但固定未來語意：

```text
My Space Document A
  ↓ Promote
Team Document B
```

B 是 new Team-owned Document ID；A 保留；不 move、不 sync、不共享 ID；MVP 不建立 lineage dependency。

## 19. Migration / rollout strategy

1. Apply migration 008 additive schema。
2. Backfill existing Workspaces explicitly to TEAM。
3. Run explicit legacy role/owner bootstrap；every Team direct OWNER >= 1。
4. Establish durable external identity links during first trusted login / controlled bootstrap；external subject never becomes `users.id`。
5. Provision each existing User one My Space + OWNER/SYSTEM_PERSONAL membership。
6. Apply migration 009 final NOT NULL/CHECK/FK constraints；readiness requires 009 APPLIED。
7. Enable trusted Company SSO → identity-link resolution → CallerContext path。
8. Replace binary membership policy with direct + validated group capability evaluation。
9. Retrofit all Workspace mutations to canonical lock protocol, including `createInitial/createResync`。
10. Change `/` to My Space and group selector Personal/Team。
11. Add Team governance UI/API and system-only recovery command/service。

## 20. Required tests

### Identity / SSO

- `(provider, subject)` resolves to same Hub UUID across requests。
- external subject/emp_id/OIDC sub never becomes `users.id`。
- first trusted login can link an existing legacy Hub user by emp_id only when no conflicting same-provider link exists。
- recycled emp_id with a different subject cannot inherit an already-linked Hub user；returns `IDENTITY_LINK_CONFLICT`。
- new subject + new user creates UUIDv7 user + link atomically。
- concurrent first-link converges on one link/user。
- production provider/session missing → fail closed。

### Personal / Team / authorization

- repeated/concurrent My Space provision → same ID。
- every Team direct OWNER >= 1。
- roles exactly OWNER/ADMIN/EDITOR/VIEWER。
- Group max ADMIN；never OWNER。
- ADMIN cannot manage OWNER/ADMIN grants。
- direct + group capabilities union。
- current caller group-effective access is truthful；other user returns unknown group state。
- 404 vs 403 semantics preserved。

### Schema / bootstrap

- migration 008 can apply to legacy schema without requiring completed role bootstrap。
- migration 009 refuses to apply while any Team has zero direct OWNER or any membership role/source is null/invalid。
- after 009, invalid/null role/source/type writes fail at DB level。
- required Workspace/User FKs reject orphan group/audit/identity-link rows。

### Concurrency / lifecycle

- `createInitial`: quota(if any) → Workspace → snapshot insert serializes with archive。
- `createResync`: quota(if any) → Source → Workspace → snapshot insert captures binding/version transactionally。
- no pre-Snapshot create path writes snapshot after archive wins。
- initial apply uses Snapshot → Workspace。
- resync apply uses Snapshot → Source → Workspace。
- upload/finalize uses Snapshot → Workspace。
- no `Workspace → Snapshot` or `Workspace → existing Source` inversion。
- membership/group mutation vs archive serializes on Workspace。

### Audit

- every governance mutation atomically appends audit。
- audit failure rolls back mutation。
- application exposes no audit update/delete。

## 21. Acceptance criteria

Phase 3 is complete when：

1. Every User has exactly one system-managed `Workspace(type=PERSONAL, name='My Space')`。
2. `/` enters My Space；Personal/Team reuse existing Workspace routes。
3. Team creation requires trusted `workspace.create_team` and creates direct OWNER。
4. Team always has direct OWNER >= 1。
5. Fixed roles exactly OWNER/ADMIN/EDITOR/VIEWER；no assignable DISCOVERER。
6. OWNER/ADMIN authority follows this spec。
7. Direct + validated group grants union capabilities；no explicit deny。
8. Hub does not materialize external user-group membership truth。
9. Other-user group access is never fabricated。
10. Company account identity is durably linked by `(provider, subject) → Hub UUID`; recycled emp_id cannot inherit an old Hub account。
11. Workspace remains the only Phase 3 Knowledge ACL boundary。
12. All pre-Snapshot and existing-Snapshot import mutations plus Source/Knowledge/governance mutations follow the canonical lock protocol。
13. Archived Team remains read-only; ordinary governance frozen; system-only audited recovery exists。
14. Governance mutation + audit are atomic。
15. Migration 009 finalizes nullable bootstrap fields and canonical FKs before production readiness。
16. Existing Workspace/Source/Document/Revision IDs and canonical routes remain unchanged。

## 22. Architectural summary

```text
Trusted company session
  ├─ provider + subject
  ├─ emp_id / profile
  ├─ validatedExternalGroupIds
  └─ platformCapabilities
          ↓
external_identity_links
(provider, subject) → Hub UUIDv7 user
          ↓
AuthenticatedPrincipal / CallerContext
          ↓
Workspace authorization
= direct grants ∪ validated group grants
          ↓
Mutation serialization
  pre-snapshot initial: Workspace → insert Snapshot
  pre-snapshot resync: Source → Workspace → insert Snapshot
  existing import: Snapshot → [Source] → Workspace
  other existing Source: Source → Workspace
          ↓
Sources / Knowledge
```

The system keeps one Knowledge container abstraction: **Workspace**. Personal Space is a Workspace governance specialization, not a second storage/search/MCP architecture.
