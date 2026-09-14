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

### 4.1 Early database uniqueness

`personal_owner_user_id` 的 uniqueness **不得等到 final migration 009 才建立**。Migration 008 一加入 nullable `personal_owner_user_id` 時，就必須同時建立：

```text
UNIQUE(personal_owner_user_id)
```

MariaDB nullable UNIQUE 允許多個 `NULL`，因此所有 legacy TEAM rows 可安全共存；但任何 Personal provisioning/backfill 從 008 起就受到 DB-level「一個 Hub User 最多一個 Personal Workspace」保護。

Application provisioning 仍需 idempotent：若 concurrent create 因 unique constraint collision，rollback/re-read winning Personal Workspace，不建立第二個 Workspace。

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

Migration 必須提供可重跑的 existing-user Personal Workspace backfill；完成後驗證每位既有 User 恰有一個 Personal Workspace 與對應 OWNER/SYSTEM_PERSONAL membership。登入 provisioning 與 backfill 並行時，008 的 owner unique constraint + application re-read 保持 idempotent。

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

Team creation 需要 platform-level `workspace.create_team`。它不是 Workspace role capability，也不能由 `org_code`、Workspace metadata 或 browser parameter 推導。

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

Phase 3 必須持久化：

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

`subject` 是 opaque provider identifier；持久化與 lookup 使用 exact UTF-8 bytes，不 trim / lowercase / Unicode-normalize。

Canonical account identity truth 是：

```text
(provider, subject) → hub_user_id
```

不是 `emp_id → hub_user_id`。

### 7.2 Runtime resolver rules

Production runtime resolver **不得**用 `emp_id` 自動 attach 到既有 Hub User。

1. 先以 `(provider, subject)` 查 identity link。
2. link 已存在 → 該 Hub UUID 是唯一 account identity；只同步允許更新的 profile fields。
3. link 不存在，且 `users.emp_id = external.emp_id` 已存在 → fail closed：`IDENTITY_LINK_REQUIRED`；若該 user 已被同 provider 另一個 subject 綁定則 `IDENTITY_LINK_CONFLICT`。
4. link 不存在且 emp_id 也不存在 → Hub 在同一 transaction 建立 new UUIDv7 User + identity link。
5. concurrent identical first-login 由 `(provider,subject)` / `emp_id` unique constraints 收斂；duplicate race 後重新讀取 winning link。
6. SSO subject、emp_id、OIDC `sub` 或其他 external identifier 永遠不得直接寫入 `users.id`。
7. 已建立的 `(provider, subject)` link 不因 emp_id 後續重新指派而改變。
8. external subject 變更或帳號合併必須走 explicit operator/account-link migration，不做 silent relink。

### 7.3 Legacy identity-link bootstrap

Phase 0–2 已存在的 Hub users 在 company production rollout 前，必須透過 **explicit trusted bootstrap mapping** 建立 identity links；不可等待「誰先用同 emp_id 登入」來 claim legacy account。

Bootstrap input 至少：

```text
provider
subject
hub_user_id
expected_emp_id
```

Rules：

- `hub_user_id` 必須 existing。
- trusted directory 的 subject/emp_id 必須與 bootstrap entry 驗證一致。
- `expected_emp_id` 僅作 operator safety assertion，不是 account-link key。
- duplicate provider+subject / provider+hub_user conflict fail closed。
- company production readiness 必須確認 rollout scope 中所有既有 human Hub users 已有 configured company provider identity link。

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

`AuthenticatedPrincipal.identity` 永遠是 Hub UserIdentity。

IdentityProvider 負責驗證登入 session、external identity、group IDs 與 server-side platform capability mapping；不得接受 browser-supplied truth。

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

Migration 008 就建立 nullable `personal_owner_user_id` + `UNIQUE(personal_owner_user_id)`；final 009 再補齊/驗證 `workspace_type NOT NULL`、FK `personal_owner_user_id/created_by/archived_by → users.id`、type/lifecycle CHECKs、PERSONAL name `My Space` 等 canonical constraints。

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

Group mapping is TEAM-only；unique `(workspace_id, external_group_id)`；role only ADMIN/EDITOR/VIEWER；opaque group ID exact-byte semantics；Hub 不保存 user↔group truth。Final schema 有 Workspace/User actor FKs。

### 8.5 `workspace_audit_events`

Audit fields include workspace, actor kind/user, event type, target type/id, payload, correlation, created_at。Final schema 有 Workspace FK、nullable actor User FK、JSON/actor CHECK；polymorphic `target_id` 不加單一 FK。Application 不提供 audit UPDATE/DELETE。

## 9. Fixed roles and capability bundles

Assignable roles exactly：OWNER / ADMIN / EDITOR / VIEWER。沒有 assignable DISCOVERER。

```text
OWNER  = all Phase 3 Workspace-scoped capabilities
ADMIN  = discover/read/write + source.manage + membership.manage_basic + audit.read
EDITOR = discover/read/write + source.manage
VIEWER = discover/read
```

至少保留 capabilities：workspace/source/document discover、document read/write、source.manage、membership basic/admin/owner、workspace rename/archive/restore、audit.read。

## 10. OWNER / ADMIN authority

OWNER 可 rename/archive/restore Team、管理所有 direct roles、管理 Group→ADMIN|EDITOR|VIEWER、read audit。

ADMIN 只可管理 direct EDITOR/VIEWER、Group→EDITOR|VIEWER、read audit；不可建立/移除 OWNER/ADMIN authority。

Grant mutation 在 Workspace lock 下同時檢查 persisted beforeRole 與 requested afterRole。Final direct OWNER 不得 remove/demote；Team 永遠 direct OWNER >= 1。

## 11. Authorization evaluation

```text
effective capabilities
= direct role capabilities
  UNION
  all matched validated-group role capabilities
```

No explicit deny；無 Direct-vs-Group precedence。

`listAccessibleWorkspaces(caller)` 聚合 Personal system membership、Team direct membership、matching validated group mappings。

Phase 3 只完整計算 current caller 的 group-derived effective access。其他 user 只顯示 direct membership + `UNKNOWN_NOT_EVALUATED`；不得把 unknown 當 empty group set。

## 12. Discover vs read

```text
canDiscover=false → 404
canDiscover=true && canRead=false → 403
```

四個 assignable roles 都含 read；底層 discover/read distinction 保留給 Search/MCP/retrieval/future policy。

## 13. Workspace-only authorization boundary

Phase 3 不做 Source/Document ACL。需要不同成員集合就拆另一個 Team Workspace。

## 14. Lifecycle and mutation serialization

### 14.1 Team lifecycle

ACTIVE ↔ ARCHIVED；只有 OWNER archive/restore。

ARCHIVED allowed：authorized read、OWNER/ADMIN audit read、OWNER restore。

ARCHIVED blocked：Source import/sync/create/mutation、Knowledge authoring/mutation、member/group mutation、rename。

### 14.2 Canonical lock protocol

所有 Workspace-scoped mutation 必須在實際 mutation 前持有 parent Workspace `FOR UPDATE` 並重新驗證 lifecycle/capability。

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

`createResync` 禁止 transaction A 讀 Source/basedOnVersion、transaction B 再 insert snapshot。

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

Lock invariants：quota/advisory lock 永遠先於 DB row lock；禁止 Workspace→Snapshot；禁止 Workspace→existing Source；持有 Workspace 後不可再鎖 unrelated Snapshot/Source；archive/governance 不鎖 Source/Snapshot。

Concurrency tests 必須涵蓋 archive vs createInitial/createResync/initial apply/resync apply/upload/finalize/content/member-group mutation，證明無 post-archive mutation commit 或 lock inversion deadlock。

### 14.3 Archived governance recovery

ordinary archived membership/group mutation 維持禁止。system-only recovery 可 restore Team 或 grant existing Hub User direct OWNER；normal HTTP/UI 不暴露，必須 audit。

## 15. Legacy bootstrap, staged migration and readiness

### 15.1 Populated-production rollout requires write quiescence

Phase 3 的 staged migration 不是 online mixed-version migration。對 populated production database，MVP deployment contract 是：

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

Quiescence 必須在 **008 前** 開始，並持續到 **009 完成且 Phase-3-compatible writer 已 ready**。此期間：

- 禁止舊版 application 對 canonical tables 寫入，至少涵蓋 `users`、`workspaces`、`workspace_memberships` 以及任何會建立/改變 Workspace governance state 的 path。
- 若部署操作上無法精確隔離，採 full application write maintenance mode；read-only traffic 可保留。
- 只允許 migration、explicit Phase 3 bootstrap/backfill/recovery scripts 執行受控寫入。
- `beforeApply` 的 read-only validation **不是** write fence；schema migration advisory lock 也不能假設 legacy app 會遵守，因此不能用它們取代 quiescence。
- 不支援「bootstrap 完成後仍讓 Phase 0–2 writer 繼續新增 Workspace/Membership，再直接套 009」的 rollout。

這延續既有 populated migration 的 safety model：cutover 期間停止 canonical writes，直到 final constraint migration 完成。

### 15.2 Migration 008

008 是 additive/compatibility schema：

- add `workspace_type` / lifecycle governance columns。
- add nullable membership `role` / `membership_source` where needed。
- add nullable `personal_owner_user_id` **並立即建立 `UNIQUE(personal_owner_user_id)`**。
- create identity links / group mappings / audit tables and safe indexes/FKs。
- 不把 008 當 canonical final schema。

### 15.3 Bootstrap gates

Governance bootstrap 在 009 前驗證每個 Team direct OWNER >= 1、membership role/source 全部有效非 null；零會員 Team explicit 指定 existing Hub User OWNER。

Company identity bootstrap 在 production enable 前，對 rollout scope 中每個既有 human Hub User 建立 trusted `(provider, subject) → hub_user_id` link。Runtime 不負責以 emp_id claim legacy user。

Personal backfill 在 008 unique owner constraint 保護下 idempotently 建立缺少的 My Space + OWNER/SYSTEM_PERSONAL membership。

所有 bootstrap/backfill 完成後，在仍維持 write quiescence 的狀態進入 009。

### 15.4 Migration 009

009 `beforeApply`/equivalent fail closed when DB governance bootstrap 未完成。009 finalize：workspace_type NOT NULL、membership role/source NOT NULL、role/source/type/lifecycle CHECK、canonical Workspace/User FKs（workspaces/memberships/identity links/group mappings/audit）。

009 gate 與 DDL 執行期間仍必須保持 application write quiescence；因 migration runner 的 `beforeApply` 僅是 read validation、DDL statement 也不是與 legacy writer 的 shared transaction fence。

Production application readiness additionally verifies company provider/session configured，以及 configured company rollout scope 的 legacy users 已完成 identity-link bootstrap。009 未 APPLIED 或 identity-link readiness 未完成，都不得啟用 production Phase 3 authorization。

## 16. Audit

至少：PERSONAL_WORKSPACE_PROVISIONED/FROZEN、TEAM_WORKSPACE_CREATED/RENAMED/ARCHIVED/RESTORED/GOVERNANCE_RECOVERED、MEMBER_ADDED/ROLE_CHANGED/REMOVED、GROUP_MAPPING_ADDED/ROLE_CHANGED/REMOVED。

Governance mutation + audit 同 transaction。OWNER/ADMIN 可讀 Team audit。

## 17. Product behavior

Workspace selector：My Space 永遠置頂，Team name ascending；不顯示 role/org/owner/member count。

Team admin UI 分 Members / SSO Groups / Audit。Current caller 可顯示完整 grant provenance；other user 僅 direct role + `Group access not evaluated`。Personal UI 不顯示 governance controls。

## 18. Personal → Team future promotion contract

My Space Document A → Promote → new Team Document B；A 保留；B 新 ID；不 move、不 sync、不共享 ID、不建 lineage dependency。

## 19. Production cutover strategy

本節只描述 **implementation 已完成之後** 的 production cutover。下列項目在進入 maintenance 前就必須已完成並通過測試：

- Phase-3-compatible Workspace / membership / Personal / Team writers。
- Source / Knowledge / import canonical locking retrofit。
- Personal Workspace backfill tooling。
- Company SSO provider、durable identity-link resolver、capability authorization。
- Team governance API/UI 與 system-only recovery implementation。

Production cutover 順序：

1. Enter canonical-write quiescence / maintenance mode before 008。
2. Apply migration 008；其中 `personal_owner_user_id` nullable UNIQUE 從此生效。
3. Backfill existing Workspaces explicitly TEAM。
4. Run explicit Team role/owner bootstrap。
5. Run explicit trusted legacy identity-link bootstrap；禁止 runtime 用 emp_id claim existing user。
6. Provision/backfill existing users My Space + OWNER/SYSTEM_PERSONAL；concurrent duplicate 由 008 unique constraint 收斂。
7. While writes remain quiesced, apply migration 009 final constraints/FKs。
8. Pass production readiness：009 applied + company provider configured + identity-link rollout complete + Phase-3-compatible application/writers ready。
9. Switch traffic / enable trusted Company SSO → identity-link resolver → CallerContext + capability-union authorization on the Phase-3-compatible deployment。
10. Verify the Phase-3-compatible deployment is the only canonical application writer。
11. Exit maintenance / resume canonical writes。

Canonical locking、writer retrofit、API/UI implementation **不得**放在上述 cutover window 內才進行；它們是進入 production cutover 前的 implementation prerequisite。

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
9. Hub 不 materialize user↔group truth。
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