# Knowledge Hub — Phase 3 Identity, Workspace Administration & Governance Design

| 項目 | 內容 |
| --- | --- |
| 文件日期 | 2026-09-14 |
| 文件類型 | Design Spec；不包含 Implementation Plan |
| 狀態 | Review requested — high-severity PR review gaps incorporated |
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
resolveHubIdentity(externalIdentity)
  ├─ existing emp_id → keep existing Hub UUID
  └─ first login     → create Hub UUIDv7 user
  ↓
ensurePersonalWorkspace(hubUserId)
  ├─ exists  → return existing
  └─ missing → create PERSONAL Workspace
               + OWNER/SYSTEM_PERSONAL membership
               + audit event
  ↓
build CallerContext from resolved Hub identity + trusted claims
```

Browser 不得提供 `owner_user_id` 來 provision 別人的 My Space，也不得提供可覆寫 Hub user ID 的欄位。

上述 bootstrap 是所有 Human Web / API request 共用的 trusted caller establishment，不只在 `/` 執行。必須先完成 trusted external identity → Hub identity resolution，再 provision My Space，最後才呼叫 Workspace application services；直接進入 Team deep link 或 API 也遵守相同順序。

Migration 必須提供可重跑的 existing-user backfill command，逐一呼叫相同 provisioning service；完成後驗證每位既有 User 恰有一個 Personal Workspace 與對應 OWNER/SYSTEM_PERSONAL membership。登入 provisioning 與 backfill 並行時仍保持 idempotent。

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

### 7.1 External identity vs Hub identity

Company SSO identity 與 Hub canonical `UserIdentity` 是兩個不同概念。外部 provider/session 不得直接決定 `users.id`。

```text
ExternalCompanyIdentity
- subject: string              # provider-issued stable subject when available
- emp_id: string               # trusted employee/account key used by Phase 3 resolver
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

Phase 3 baseline 使用 trusted `emp_id` resolve Hub identity，因既有 `users.emp_id` 已有 unique contract：

1. 以 `emp_id` 查 existing Hub User。
2. 若存在，保留既有 Hub UUID；只同步允許更新的 profile fields（目前 `name`、`org_code`）。
3. 若不存在，由 Hub 產生新的 UUIDv7 並 insert user。
4. concurrent first-login 若撞到 `emp_id` unique constraint，必須 re-read existing row 並回傳同一 Hub UUID，不得建立第二個 user。
5. SSO `subject`、employee number、OIDC `sub` 或其他 external identifier **都不得直接寫入 `users.id`**。

若公司未來要求以 provider subject 而非 `emp_id` 作長期 account-link truth，必須新增 explicit identity-link schema/amendment；不得偷偷把 external subject reinterpret 成 Hub UUID。

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

### 7.3 IdentityProvider and resolver

```text
IdentityProvider.getCurrentClaims()
  → TrustedIdentityClaims

HubIdentityResolver.resolve(externalIdentity)
  → Hub UserIdentity

TrustedCaller bootstrap
  → claims
  → resolve Hub identity
  → ensure My Space
  → AuthenticatedPrincipal / CallerContext
```

IdentityProvider 負責：

- 驗證登入 session / trusted company identity。
- 只輸出 validated external identity/group IDs。
- 只輸出由 server-side deployment policy 映射出的 platform capabilities。
- 每次 request 使用目前有效 session/claims；不得使用 browser body/query/header 提供的任意 identity/group/capability 值。
- 外部 IAM group 變更在下一次 trusted session/claim refresh 後生效。

HubIdentityResolver 負責 canonical Hub user mapping；Company SSO adapter 不直接產生或覆寫 Hub UUID。

### 7.4 Provider selection

- local/dev 可使用 `LocalIdentityProvider`，其 trusted claims/groups/capabilities 來自 explicit server config。
- company deployment 使用 `CompanySsoIdentityProvider`，由 server-side SSO/session reader 注入。
- production configuration 不得 silently fallback 到 Local provider。
- production provider 缺少 trusted session integration 時 startup/readiness 必須 fail closed。

Phase 3 implementation 必須包含 real transport → trusted claims → Hub identity resolution → My Space provisioning → CallerContext integration；只在 test 手工 new CallerContext 不算完成 SSO integration。

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

Direct membership target 必須是 existing Hub User。

### 8.3 `workspace_group_mappings`

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
- `external_group_id` 是 provider-issued opaque identifier：大小寫、重音與尾端空白都不得由 Hub 合併；不 trim、lowercase 或 Unicode-normalize。
- 持久化使用 `VARBINARY(1020)` 儲存原始 ID 的 UTF-8 bytes，repository 負責 string ↔ bytes 轉換。比對、查詢參數與 unique constraint 都使用相同精確 bytes；不得依賴 database default collation。
- Provider boundary 拒絕空 ID、無效 Unicode 或超過 1020 UTF-8 bytes 的 ID；server configuration 與 group mapping 管理輸入中的 IDs 遵守同一驗證與比對契約。
- 不可 grant OWNER。
- Hub 不保存 user↔group membership truth。

### 8.4 `workspace_audit_events`

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

Target semantics：

- WORKSPACE → `target_id = workspace_id`
- MEMBER → `target_id = target user_id`
- GROUP_MAPPING → `target_id = workspace_group_mappings.id`

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

OWNER 可以：

- rename TEAM。
- archive / restore TEAM。
- manage direct OWNER / ADMIN / EDITOR / VIEWER。
- manage `Group → ADMIN|EDITOR|VIEWER`。
- read audit。

ADMIN 可以：

- manage direct EDITOR / VIEWER。
- manage `Group → EDITOR|VIEWER`。
- read audit。

ADMIN 不可：

- grant/remove/demote OWNER or ADMIN。
- promote group to ADMIN。
- rename/archive/restore Workspace。

每次變更必須在 Workspace lock 下讀取 target 的現有 direct membership / group mapping，同時檢查 actor 是否可以管理 beforeRole 與 afterRole。新增只檢查 afterRole；刪除只檢查 beforeRole；更新或 upsert existing row 必須兩者都檢查。ADMIN 不得把既有 OWNER/ADMIN 降為 EDITOR/VIEWER，也不得降級或刪除 Group→ADMIN。不得以 target 的 effective role 取代正在修改之 grant 的 persisted role。

Final direct OWNER 不得被 remove/demote；此 invariant 是額外保護，不能取代上述 actor authority check。

## 11. Authorization evaluation

### 11.1 Grant sources

```text
Direct Membership
+
validated SSO Group mappings
```

### 11.2 Capability union

```text
effective capabilities
= direct role capabilities
  UNION
  all matched group-role capabilities
```

No explicit deny；沒有 Direct-vs-Group precedence。

Examples：

```text
Direct VIEWER + Group EDITOR => EDITOR capabilities
Direct ADMIN + Group VIEWER  => ADMIN capabilities
```

### 11.3 Accessible listing

`listAccessibleWorkspaces(caller)` 聚合：

- Personal SYSTEM_PERSONAL membership。
- Team direct membership。
- matching validated group mappings。

不得把 `workspace_memberships` row 當唯一 access source。

### 11.4 Effective-access inspection scope

Phase 3 **只能完整計算 current caller 的 group-derived effective access**，因為 Hub 不保存其他 user 的 external group membership truth。

因此 Team admin UI：

- current caller：可以顯示 Direct + matched groups + effective capabilities。
- other Hub user：只顯示 direct membership；group-derived access 顯示 `Unknown / not evaluated`。
- 不得把未知 group membership 當空集合，也不得宣稱移除 direct membership 後一定失去 access。

任意 user 的完整 effective-access inspection 若未來需要，必須新增 trusted IAM directory lookup design；不在 Phase 3 偷渡。

## 12. Discover vs read

繼承 accepted semantics：

```text
canDiscover(resource)
├─ false → 404 NOT_FOUND
└─ true
   ├─ canRead(resource) → normal response
   └─ false → 403 ACCESS_DENIED
```

四個 assignable roles 都包含 read，所以正常 Phase 3 membership 不會只靠 role 形成 discover-only；但底層 distinction 必須保留給 Phase 4 Search、Phase 7 MCP、Phase 8 retrieval 與 future policy。

Document title/metadata/snippet/body 預設都需要 read。

## 13. Workspace-only authorization boundary

Phase 3 不做 Source/Document ACL：

```text
Caller
  ↓
Workspace policy
  ↓
Sources
  ↓
Documents / Revisions
```

若一批 Knowledge 需要不同成員集合，MVP 解法是另一個 Team Workspace。

## 14. Lifecycle and mutation serialization

### 14.1 Team lifecycle

```text
ACTIVE ↔ ARCHIVED
```

只有 OWNER 可以 archive / restore。

ARCHIVED：

Allowed：

- 原本仍具有效 access 的 caller read Knowledge。
- OWNER/ADMIN read governance/audit。
- OWNER restore。

Blocked through ordinary product APIs：

- Source import/sync/create/mutation。
- Knowledge authoring/mutation。
- direct membership add/change/remove。
- SSO Group mapping add/change/remove。
- rename。

### 14.2 Required Workspace serialization lock

單純在 READ COMMITTED transaction 中讀 `lifecycle_state` 不足以防 archive/write race。

Phase 3 規定：**任何可能 commit Workspace-scoped mutation 的 transaction，都必須在實際 mutation 前持有該 Workspace row 的 `SELECT ... FOR UPDATE` lock，並在 lock 後重新驗證 lifecycle/capability。**

既有 Phase 2 folder-import 還有 `ImportSnapshot FOR UPDATE` serialization，因此 Phase 3 必須把 Snapshot 納入同一個全域 lock hierarchy；不得只描述 Source / Workspace。

Canonical lock protocol：

```text
Import snapshot flow — initial apply:
  lock ImportSnapshot FOR UPDATE
  → lock snapshot.workspaceId Workspace FOR UPDATE
  → re-evaluate capability + ACTIVE
  → create Source
  → deeper canonical/staging writes

Import snapshot flow — resync/apply existing Source:
  lock ImportSnapshot FOR UPDATE
  → lock bound Source FOR UPDATE
  → lock parent Workspace FOR UPDATE
  → re-evaluate capability + ACTIVE
  → deeper Document/Tree writes

Import snapshot flow — upload/finalize/staging mutation:
  lock ImportSnapshot FOR UPDATE
  → lock snapshot.workspaceId Workspace FOR UPDATE
  → re-evaluate capability + ACTIVE
  → mutate staging state

Non-import existing Source mutation:
  lock Source FOR UPDATE
  → lock parent Workspace FOR UPDATE
  → re-evaluate caller + lifecycle
  → lock deeper Document/Tree rows
  → mutate

Non-import new Source creation:
  lock Workspace FOR UPDATE
  → validate ACTIVE + capability
  → create Source

Membership / Group governance:
  lock Workspace FOR UPDATE
  → validate ACTIVE + actor authority
  → lock/inspect membership or mapping rows
  → mutate + audit

Archive / Restore:
  lock Workspace FOR UPDATE
  → validate actor authority/current state
  → lifecycle mutation + audit
```

Lock-order invariants：

- 任何持有 ImportSnapshot lock 且之後需要 Workspace 的 flow，順序固定為 `ImportSnapshot → [bound Source] → Workspace`。
- **禁止 `Workspace → ImportSnapshot`**；否則會和既有 Snapshot-first finalize/apply 形成 deadlock cycle。
- 既有 Source mutation 維持 Source-first；禁止 `Workspace → existing Source` 的反向 acquisition。
- 一旦 transaction 已持有 Workspace lock，不得再取得 unrelated ImportSnapshot 或 unrelated Source lock。
- governance/lifecycle path 只需要 Workspace/member/group rows，不得為了 archive 去鎖 Source 或 Snapshot。

Result：

- 如果 import/content mutation 先取得 Workspace lock，archive 等它 commit，再 archive。
- 如果 archive 先取得 Workspace lock，Snapshot/Source mutation 在取得 Workspace lock 後看到 ARCHIVED 並 rollback。
- Snapshot-first flow 即使被 archive 阻塞，也不會形成 cycle，因 archive 不反向要求 Snapshot lock。
- membership/group mutation 與 archive 同樣 serializable at Workspace row boundary。

Phase 3 tests 必須用兩個 DB connections 證明 archive vs initial import apply、archive vs resync/apply、archive vs upload/finalize，以及 archive vs membership mutation 不會產生「archive 已 commit 後仍有 mutation commit」或 lock-order deadlock。

### 14.3 Archived access-revocation tradeoff and recovery

Product decision 維持：ARCHIVED Workspace 的 ordinary member/group mutation 皆禁止；要做正常治理修改先由 OWNER restore。

為避免「所有可登入 OWNER 都不存在」時永久無法恢復，Phase 3 另外定義 **system-only governance recovery path**：

- 不暴露在 normal Workspace HTTP/UI。
- 只能由 deployment/operator-controlled server command/service invoke。
- 可執行最小 recovery：restore archived Team，或 grant existing Hub User 為 direct OWNER。
- 必須 append `TEAM_WORKSPACE_GOVERNANCE_RECOVERED` audit event，`actor_kind=SYSTEM`，payload 記錄 operator correlation/reason。
- 不得作為日常 membership administration shortcut。

## 15. Legacy bootstrap and readiness

Phase 3 migration 可以暫時留下 legacy membership role/provenance 未 backfill，但 production authorization 不得在 bootstrap incomplete 時啟用。

Bootstrap input 必須 explicit 指定 existing Team memberships/owners；不得用 heuristic elevation。

在 bootstrap transaction commit 前，必須驗證：

```text
for every TEAM workspace:
  direct OWNER count >= 1
  every membership has non-null valid role
  every membership has non-null valid membership_source
```

零會員 legacy Workspace 也必須透過 explicit bootstrap owner assignment 指定 existing Hub User；不能因「沒有 membership rows」而漏過 owner invariant。

Startup/readiness 必須 fail closed when：

- 任一 Team owner count = 0。
- 任一 legacy membership role/provenance 未完成。
- production identity provider 尚未 configured/available。

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

Governance mutation + audit append 必須同 transaction commit/rollback。

OWNER/ADMIN 可讀 Team audit；EDITOR/VIEWER 不可。

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

Rules：

- My Space 永遠置頂。
- Team MVP name ascending。
- selector 不顯示 role/org/owner/member count。

Team administration UI 分開：

```text
Members
SSO Groups
Audit
```

Members 與 Group mappings 不 flatten 成同一份 persisted list。

對 current caller 可顯示完整 grant provenance；對 other user 僅顯示 direct role + `Group access not evaluated`。

Personal UI 不顯示 rename/member/group/transfer/archive/delete。

## 18. Personal → Team future promotion contract

Phase 3 不實作 content promotion，但固定未來語意：

```text
My Space Document A
  ↓ Promote
Team Document B
```

- B 是 new Team-owned Document ID。
- A 保留。
- 不 move、不 sync、不共享 ID。
- MVP 不建立 lineage dependency。

## 19. Migration strategy

1. Add Phase 3 schema columns/tables with backward-compatible nullable/default strategy。
2. Backfill existing Workspaces explicitly to TEAM。
3. Apply explicit legacy membership/owner bootstrap；validate every Team has direct OWNER >= 1。
4. Create group mapping/audit persistence。
5. Provision each existing User one My Space + OWNER/SYSTEM_PERSONAL membership。
6. Enable final constraints/readiness guard。
7. Upgrade identity transport from identity-only to trusted external claims；resolve trusted `emp_id` to Hub-owned UUIDv7 identity before building CallerContext；production provider injection remains fail-closed。
8. Replace binary membership policy with capability evaluation over direct + validated group grants。
9. Add Workspace row serialization lock to every Workspace-scoped mutation path；folder-import paths additionally obey `ImportSnapshot → [Source] → Workspace` while non-import existing Source mutations remain `Source → Workspace`。
10. Change `/` to My Space and group selector Personal/Team。
11. Add Team governance UI/API and system-only recovery command/service。

## 20. Required tests

### Personal

- repeated / concurrent provision → same Workspace ID。
- existing-user backfill 可重跑，完成後每位既有 User 恰有一個 My Space + OWNER/SYSTEM_PERSONAL row。
- 首次 SSO 登入、直接 Team deep link 與 API request 都先 resolve/create Hub user，再 provision My Space；不依賴造訪 `/`。
- one user cannot own two Personal Workspaces。
- My Space rename/direct second member/group mapping/ownership transfer/user archive rejected。
- system freeze retains Knowledge and emits audit。
- `/` resolves My Space first。

### Identity / SSO

- IdentityProvider returns trusted external claims, not an external ID masquerading as Hub `users.id`。
- existing trusted `emp_id` resolves to the same existing Hub UUID even if profile name/org changes。
- first login for a new `emp_id` creates one Hub UUIDv7 user；concurrent first logins converge on that same row/UUID。
- SSO subject / OIDC `sub` / employee number is never written directly into `users.id`。
- resolved `AuthenticatedPrincipal.identity.id` is a Hub UUID and is the only user ID used by memberships/audit/domain FKs。
- `callerFromPrincipal` cannot be built from browser-supplied arbitrary groups/capabilities。
- Local provider only uses server config。
- company provider maps trusted session claims and refresh semantics。
- production startup fails closed if company provider/session integration missing；no silent Local fallback。

### Authorization

- fixed roles exactly OWNER/ADMIN/EDITOR/VIEWER。
- group max ADMIN；never OWNER。
- ADMIN 不可降級其他 ADMIN、非最後一位 OWNER，或降級/刪除 Group→ADMIN；update/upsert/remove 都驗證 existing role。
- group IDs 大小寫、重音、尾端空白不同時不互相命中 grant，且可各自建立 mapping；相同 bytes duplicate 被拒絕。
- direct + group capabilities union。
- group-only access appears in accessible listing。
- current caller can inspect matched group grants。
- inspecting another user does not fabricate group membership and returns direct-only + unknown group state。
- same-org non-member denied；cross-org valid grant allowed。
- 404 vs 403 discover/read semantics preserved。

### Legacy bootstrap

- all-EDITOR bootstrap fails owner invariant。
- zero-member Team without explicit owner assignment fails。
- explicit owner assignment for zero-member Team succeeds only for existing Hub User。
- readiness fails when any Team has zero direct OWNER or null role/provenance。

### Concurrency / lifecycle

- initial import apply uses `ImportSnapshot → Workspace` and serializes with archive without deadlock。
- resync/import apply uses `ImportSnapshot → Source → Workspace` and serializes with archive without deadlock。
- upload/finalize staging mutation uses `ImportSnapshot → Workspace` and aborts after archive wins。
- non-import active content write vs archive serializes at Workspace row lock。
- archive wins → content/import write rolls back on ARCHIVED。
- content/import write wins → archive waits and commits after mutation transaction。
- no Phase 3 path acquires `Workspace → ImportSnapshot` or `Workspace → existing Source`。
- membership/group mutation vs archive has same guarantee。
- archived ordinary governance/write mutations rejected。
- OWNER restore works。
- system recovery is not exposed through ordinary Workspace API and emits audit。

### Audit

- every governance mutation atomically appends audit。
- audit failure rolls back mutation。
- application exposes no audit update/delete。

## 21. Acceptance criteria

Phase 3 is complete when：

1. Every User has exactly one system-managed `Workspace(type=PERSONAL, name='My Space')`。
2. `/` enters My Space；Personal/Team reuse existing Workspace routes。
3. Team creation requires trusted `workspace.create_team` platform capability and creates direct OWNER。
4. Team always has at least one direct OWNER, including after legacy bootstrap。
5. Fixed roles are exactly OWNER/ADMIN/EDITOR/VIEWER；no assignable DISCOVERER。
6. OWNER/ADMIN authority follows this spec。
7. Direct membership + validated SSO Group mappings union capabilities；no explicit deny。
8. Hub does not materialize external user-group membership truth。
9. Full group-derived effective access is only computed for current trusted caller；other-user inspection never fabricates group state。
10. Company identity path resolves trusted external identity to a Hub-owned stable UUID before CallerContext；external SSO identifiers never become `users.id` directly，and production never silently uses Local identity。
11. Workspace remains the only Phase 3 Knowledge ACL boundary。
12. Every Workspace-scoped mutation participates in the Workspace row serialization protocol；folder-import mutation additionally follows `ImportSnapshot → [Source] → Workspace`, preventing archive races and Snapshot/Workspace lock inversion under READ COMMITTED。
13. Archived Team remains read-only; ordinary governance is frozen; system-only audited recovery exists for stranded governance。
14. Governance mutations and audit append are atomic。
15. Existing Workspace/Source/Document/Revision IDs and canonical routes remain unchanged。

## 22. Architectural summary

```text
Trusted external session/claims
  ├─ external identity (subject / emp_id / profile)
  ├─ validatedExternalGroupIds
  └─ platformCapabilities
          ↓
HubIdentityResolver
  └─ trusted emp_id → existing/new Hub UUIDv7 UserIdentity
          ↓
AuthenticatedPrincipal
          ↓
CallerContext
          ↓
Workspace authorization
= direct grants ∪ validated group grants
          ↓
Canonical mutation locks
  import: ImportSnapshot → [Source] → Workspace
  other existing Source mutation: Source → Workspace
          ↓
Sources / Knowledge
```

The system keeps one Knowledge container abstraction: **Workspace**. Personal Space is a Workspace governance specialization, not a second storage/search/MCP architecture.