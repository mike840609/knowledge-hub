# Knowledge Hub — Phase 3 Identity, Workspace Administration & Governance Design

| 項目 | 內容 |
| --- | --- |
| 文件日期 | 2026-09-14 |
| 文件類型 | Design Spec；不包含 Implementation Plan |
| 狀態 | Review requested — PR review gaps incorporated |
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
trusted principal established
  ↓
ensureUser(...)
  ↓
ensurePersonalWorkspace(userId)
  ├─ exists  → return existing
  └─ missing → create PERSONAL Workspace
               + OWNER/SYSTEM_PERSONAL membership
               + audit event
```

Browser 不得提供 `owner_user_id` 來 provision 別人的 My Space。

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

### 7.1 Authenticated principal

Phase 3 不再讓 application transport 只拿 `UserIdentity`。Trusted identity boundary 必須產生完整 principal：

```text
AuthenticatedPrincipal
- identity: { id, emp_id, name, org_code }
- validatedExternalGroupIds: string[]
- platformCapabilities: PlatformCapability[]
- refreshedAt: Date
```

`CallerContext` 只能由 `AuthenticatedPrincipal` 建立。

### 7.2 IdentityProvider

```text
IdentityProvider.getCurrentPrincipal()
  → AuthenticatedPrincipal
```

Provider 負責：

- 驗證登入 session / trusted company identity。
- 只輸出已驗證 external group IDs。
- 只輸出由 server-side deployment policy 映射出的 platform capabilities。
- 每次 request 使用目前有效 session/claims；不得使用 browser body/query/header 提供的任意 group/capability 值。
- 外部 IAM group 變更在下一次 trusted session/claim refresh 後生效。

### 7.3 Provider selection

- local/dev 可使用 `LocalIdentityProvider`，其 groups/capabilities 來自 explicit server config。
- company deployment 使用 `CompanySsoIdentityProvider`，由 server-side SSO/session reader 注入。
- production configuration 不得 silently fallback 到 Local provider。
- production provider 缺少 trusted session integration 時 startup/readiness 必須 fail closed。

Phase 3 implementation 必須包含這條 real transport → trusted principal → CallerContext integration；只在 test 手工 new CallerContext 不算完成 SSO integration。

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

Final direct OWNER 不得被 remove/demote。

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

Lock protocol：

```text
Existing Source mutation:
  lock Source FOR UPDATE
  → lock parent Workspace FOR UPDATE
  → re-evaluate caller + lifecycle
  → lock deeper Document/Tree rows
  → mutate

New Source creation:
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

Existing Source flows keep their established Source-first serialization. Once a transaction has acquired Workspace lock, it must not acquire another unrelated Source lock. Governance/lifecycle paths must not lock Source rows. This prevents lock-order cycles with existing Phase 1/2 Source serialization.

Result：

- 如果 content mutation 先取得 Workspace lock，archive 等它 commit，再 archive。
- 如果 archive 先取得 Workspace lock，content mutation 之後看到 ARCHIVED 並 rollback。
- membership/group mutation 與 archive 同樣 serializable at Workspace row boundary。

Phase 3 tests 必須用兩個 DB connections 證明 archive vs import/write，以及 archive vs membership mutation 不會產生「archive 已 commit 後仍有 mutation commit」的狀態。

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
7. Upgrade IdentityProvider from identity-only to trusted principal + production provider injection。
8. Replace binary membership policy with capability evaluation over direct + validated group grants。
9. Add Workspace row serialization lock to every Workspace-scoped mutation path while preserving Source-first order for existing Source mutation flows。
10. Change `/` to My Space and group selector Personal/Team。
11. Add Team governance UI/API and system-only recovery command/service。

## 20. Required tests

### Personal

- repeated provision → same Workspace ID。
- one user cannot own two Personal Workspaces。
- My Space rename/direct second member/group mapping/ownership transfer/user archive rejected。
- system freeze retains Knowledge and emits audit。
- `/` resolves My Space first。

### Identity / SSO

- `IdentityProvider` returns trusted principal including validated groups + platform capabilities。
- `callerFromPrincipal` cannot be built from browser-supplied arbitrary groups/capabilities。
- Local provider only uses server config。
- company provider maps trusted session claims and refresh semantics。
- production startup fails closed if company provider/session integration missing；no silent Local fallback。

### Authorization

- fixed roles exactly OWNER/ADMIN/EDITOR/VIEWER。
- group max ADMIN；never OWNER。
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

- active content write vs archive serializes at Workspace row lock。
- archive wins → content write rolls back on ARCHIVED。
- content write wins → archive waits and commits after content transaction。
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
10. Company identity path produces trusted principal with validated groups/platform capabilities and production does not silently use Local identity。
11. Workspace remains the only Phase 3 Knowledge ACL boundary。
12. Every Workspace-scoped mutation participates in the Workspace row serialization protocol, preventing archive/write/governance races under READ COMMITTED。
13. Archived Team remains read-only; ordinary governance is frozen; system-only audited recovery exists for stranded governance。
14. Governance mutations and audit append are atomic。
15. Existing Workspace/Source/Document/Revision IDs and canonical routes remain unchanged。

## 22. Architectural summary

```text
AuthenticatedPrincipal
  ├─ identity
  ├─ validatedExternalGroupIds
  └─ platformCapabilities
          ↓
      CallerContext
          ↓
Workspace authorization
= direct grants ∪ validated group grants
          ↓
Workspace row serialization for mutations
          ↓
Sources / Knowledge
```

The system keeps one Knowledge container abstraction: **Workspace**. Personal Space is a Workspace governance specialization, not a second storage/search/MCP architecture.