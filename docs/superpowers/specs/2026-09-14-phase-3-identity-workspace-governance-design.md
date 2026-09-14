# Knowledge Hub — Phase 3 Identity, Workspace Administration & Governance Design

| 項目 | 內容 |
| --- | --- |
| 文件日期 | 2026-09-14 |
| 文件類型 | Design Spec；不包含 Implementation Plan |
| 狀態 | Review requested — brainstorming decisions incorporated |
| 前置 | Phase 0 Foundation、Phase 1 Knowledge Core & Tree、Phase 2 Knowledge Source Import & Sync、Phase 2.5 Frontend Product Baseline |
| 既有授權約束 | `2026-09-14-resource-visibility-access-semantics-amendment.md`、`2026-09-14-phase-3-authorization-clarification.md` |
| 核心決策 | Personal Space 不建立獨立 domain；以 `Workspace(type=PERSONAL)` 表達；Workspace 是 Phase 3 唯一 Knowledge authorization boundary |

## 1. Goal

Phase 3 把 Phase 0–2 的 local/mock `WorkspaceMembership` foundation 升級成可用於公司正式多使用者環境的 Workspace lifecycle、identity mapping、fixed RBAC、enterprise group grants 與 auditable governance。

Phase 3 同時正式定義 **Personal Workspace / My Space**：每位 User 有一個 system-managed personal Knowledge scope，但 Personal Space 不形成第二套 Knowledge ownership、storage、routing 或 authorization hierarchy。所有 Knowledge 仍遵循同一條 canonical chain：

```text
User / Caller
  │
  └─ effective Workspace policy
          │
          ▼
      Workspace
          │
          ▼
   KnowledgeSource
          │
          ▼
      Tree / Document / Revision
```

因此 Phase 0–2 已固定的 `Source → Workspace`、`Document → Source → Workspace`、stable Document identity、Source ownership、Tree、Revision 與 import/sync contract 都不因 Personal Space 重做。

Phase 3 的產品定位採 **personal-first**：使用者登入後預設進入 My Space；Team Workspace 是受治理建立的共享 Knowledge scope，而不是另一套任意頁面協作系統。

## 2. Non-goals

Phase 3 不做：

- 獨立 `PersonalSpace`、`UserKnowledge` 或 `user_id` scoped Document hierarchy。
- Document `private=true` 或 `user_id/workspace_id` 二選一 ownership。
- Agent principal、MCP transport、Agent Memory domain。
- rich authoring；Phase 5 才加入 Web create/edit。
- 第二套 `/me/...` / `/personal/...` canonical routes。
- Source-level override 或 Document-level ACL；需要不同權限時使用不同 Workspace。
- custom-role DSL、explicit deny、role override、per-user deny exception。
- 可指派的 `DISCOVERER` role。
- email invite、pending invitation、accept/reject、invite token workflow。
- materialized Hub user↔external-group membership truth。
- Workspace hard delete。
- Personal → Team content promotion implementation；只固定未來 promotion contract。

## 3. Workspace remains the only Knowledge container

### 3.1 Workspace types

```text
Workspace
├─ PERSONAL
│   └─ single-user application Knowledge scope
└─ TEAM
    └─ governed collaborative Knowledge scope
```

Personal 與 Team 使用相同 `Workspace → Source → Tree → Document` 模型；差異只存在 provisioning、membership、lifecycle 與 governance。

因此：

- Personal Workspace 可以有多個 `HUB`、`FILE_UPLOAD`、`FOLDER_SYNC` Source。
- Personal Workspace 可以承接 Obsidian / LLM Wiki generated folders。
- `SOURCE_MANAGED` / `HUB_MANAGED` 不因 Workspace type 改變。
- Source / Document 不新增 personal owner 欄位。
- Search、Publishing、MCP、semantic retrieval 不建立 personal-special data path。

### 3.2 Canonical routes

Personal 與 Team 都沿用 Phase 2.5：

```text
/w/:workspaceId/knowledge/...
/w/:workspaceId/sources/...
```

`PERSONAL` 是 Workspace kind，不是 synthetic Tree folder，也不是 route special case。

## 4. Personal Workspace invariants

1. 每個 active/provisioned Hub User 有且只有一個 Personal Workspace；provision operation 必須 idempotent。
2. Personal Workspace 必須有且只有一個 `personal_owner_user_id`。
3. `personal_owner_user_id` 必須對應既有 User。
4. Personal owner 必須同時具有 `OWNER/SYSTEM_PERSONAL` membership。
5. 不允許 ordinary direct membership 加入第二位 member。
6. 不允許 SSO Group mapping。
7. 不允許 ownership transfer。
8. display name 固定為 `My Space`；一般 user 不允許 rename。
9. 不允許一般 user archive/delete。
10. identity deprovisioning/offboarding 只允許 system governance freeze；不轉移 owner、不自動刪除 Knowledge。
11. Personal resource authorization 仍反查 `Source.workspace_id` 並經 Workspace policy。
12. Personal Workspace 是 application access scope，不代表 infrastructure/compliance 的法律隱私承諾；任何未來 break-glass access 必須顯式 capability + audit。

`My Space` 是 system-managed product label；domain/authorization 永遠使用 `workspace_type=PERSONAL`，不得靠 name 字串判斷。

## 5. Personal provisioning and default entry

### 5.1 Provisioning

```text
trusted identity established
        │
        ▼
ensureUser(...)
        │
        ▼
ensurePersonalWorkspace(userId)
        │
        ├─ existing → return existing Workspace
        └─ missing  → create PERSONAL Workspace
                     + OWNER/SYSTEM_PERSONAL membership
                     + audit event
```

Browser 不得傳入 `owner_user_id` provision 別人的 My Space。

Migration/backfill 對每個既有 User 建立缺少的 Personal Workspace。Existing Phase 0–2 Workspaces 全部明確 backfill 為 `TEAM`；不得依 name、`org_code`、member count 猜 type。

### 5.2 Root navigation

Phase 3 覆寫 Phase 2.5 的「first accessible Workspace」root behavior：

```text
/
  → establish trusted caller
  → ensure My Space
  → My Space
  → first Source by deterministic name order
  → first readable Document by existing Tree order
```

若 My Space 沒有 Source/Document，顯示對應 empty state，不自動跳 Team Workspace。

## 6. Team provisioning and ownership

### 6.1 Platform create policy

Team creation 由 platform-level `workspace.create_team` 控制。它不是 Workspace role capability，也不得由 `org_code`、Workspace metadata、route/client parameter 推導。

Phase 3 的 trusted caller context 概念 shape：

```text
CallerContext
- identity: { id, emp_id, name, org_code }
- validatedExternalGroupIds: string[]
- platformCapabilities: string[]
```

`validatedExternalGroupIds` 與 `platformCapabilities` 都只能由 trusted identity/provider boundary 建立；browser/request body 不得自行注入。

`workspace.create_team` 透過獨立 `PlatformAccessPolicy` 評估：

```text
PlatformAccessPolicy.has(caller, "workspace.create_team")
```

Baseline deployment contract：

- local/dev provider 由 explicit configuration 指定 platform capability grants；
- company SSO adapter 可把明確配置的 trusted SSO group/claim 映射成 `workspace.create_team`；
- Workspace OWNER/ADMIN 身分本身不能產生 platform capability。

Create Team Workspace 時不強制綁 SSO Group。Create transaction 至少：

```text
create TEAM Workspace
+ creator DIRECT membership = OWNER
+ append audit event
```

### 6.2 Multiple owners

Team 允許多個 direct OWNER，但永遠必須：

```text
TEAM workspace => direct OWNER count >= 1
```

remove/demote OWNER 必須 transactionally 檢查。SSO Group 永遠不能 grant OWNER，所以 owner count 只計 direct memberships。

不需要 single-owner transfer workflow；先 grant 新 OWNER，再移除舊 OWNER。

## 7. Data model delta

### 7.1 `workspaces`

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

`personal_owner_user_id` 不是 Team authorization shortcut。

### 7.2 `workspace_memberships`

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

Personal system row 固定：

```text
workspace_id = personal workspace
user_id      = personal_owner_user_id
role         = OWNER
source       = SYSTEM_PERSONAL
```

該 row 不允許一般 admin 刪除/降級。Team direct memberships 使用 `DIRECT`；target user 必須已存在於 `users`。

### 7.3 `workspace_group_mappings`

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

- 只允許 TEAM。
- `(workspace_id, external_group_id)` unique。
- 永遠不能 grant OWNER。
- Hub 不保存 user↔external-group membership truth。

### 7.4 `workspace_audit_events`

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

Target semantics 固定：

- WORKSPACE event：`target_id = workspace_id`。
- MEMBER event：`target_id = target user_id`。
- GROUP_MAPPING event：`target_id = workspace_group_mappings.id`；external group id / before-after role 放 typed payload。

`actor_kind=SYSTEM` 用於 Personal provision/offboarding freeze，`actor_user_id=NULL`；user-triggered mutation 必須保存 stable actor user ID。

Application API 不提供 audit UPDATE / DELETE。

## 8. Fixed roles and capability bundles

Product/admin UI 只提供：

| Role | Purpose |
| --- | --- |
| `OWNER` | Team 最終治理權；Personal owner 固定角色 |
| `ADMIN` | Team 日常管理，不可建立新的 governance authority |
| `EDITOR` | Knowledge contributor / Source operator |
| `VIEWER` | Read-only Knowledge consumer |

**不提供 `DISCOVERER` role。** Discover/read 仍是底層 policy semantics。

Workspace-scoped policy 至少能回答：

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
OWNER
= all Workspace-scoped Phase 3 capabilities

ADMIN
= discover/read/write
+ source.manage
+ membership.manage_basic
+ audit.read

EDITOR
= workspace/source/document discover
+ document.read/write
+ source.manage

VIEWER
= workspace/source/document discover
+ document.read
```

`document.write` 不繞過 Source ownership：即使 OWNER/ADMIN/EDITOR，future authoring 仍只能修改 `HUB_MANAGED`；`SOURCE_MANAGED` 由 sync authority 控制。

## 9. Governance authority matrix

### 9.1 OWNER

OWNER 可以：

- rename TEAM；
- archive / restore TEAM；
- add/remove/change direct OWNER / ADMIN / EDITOR / VIEWER；
- add/change/remove `Group → ADMIN|EDITOR|VIEWER`；
- read audit；
- manage Sources/Knowledge within normal ownership guards。

不能移除/demote 最後一個 Team OWNER。

### 9.2 ADMIN

ADMIN 可以：

- add/remove/change direct EDITOR / VIEWER；
- add/change/remove `Group → EDITOR|VIEWER`；
- read audit；
- manage Sources/Knowledge within normal ownership guards。

ADMIN 不可以：

- grant/remove/demote OWNER；
- grant/remove/demote ADMIN；
- 把 Group mapping 提升為 ADMIN；
- rename Workspace；
- archive / restore Workspace。

所有「產生或移除 governance authority」的變更都由 OWNER 明確執行並 audit。

### 9.3 EDITOR / VIEWER

EDITOR 不管理 membership/group/lifecycle；VIEWER 只讀。沒有 self-escalation。

## 10. Authorization evaluation

### 10.1 Grant sources

Effective Workspace access 只由：

```text
Direct Membership
+
validated SSO Group mappings
```

SSO/session adapter 把 validated group IDs 放入 trusted CallerContext。Hub 不週期性複製 user-group membership，也不展開 group grants 成 direct rows。外部 IAM group 變更在下一次 trusted identity/session refresh 後反映。

### 10.2 Capability union

```text
effective capabilities
= direct membership capability set
  UNION
  every matched group mapping capability set
```

沒有 explicit deny、Direct precedence 或 Group precedence。

Examples：

```text
Direct VIEWER + Group EDITOR => EDITOR capabilities
Direct ADMIN + Group VIEWER  => ADMIN capabilities
```

移除 direct membership 不代表一定失去 access；必須重算 matching group grants。

### 10.3 Accessible Workspace listing

`listAccessibleWorkspaces(caller)` 聚合：

- Personal SYSTEM_PERSONAL membership；
- Team direct memberships；
- matching validated group mappings。

不得再把「有 `workspace_memberships` row」當唯一 accessible query。

## 11. Discover vs read remains mandatory

繼承 accepted authorization amendment：

```text
canDiscover(resource)
├─ false → 404 NOT_FOUND
└─ true
   ├─ canRead(resource) → normal response
   └─ false → 403 ACCESS_DENIED
```

雖然沒有 assignable DISCOVERER role，policy 仍保留 distinction，供 future request-access/special policy、Phase 4 search、Phase 7 MCP、Phase 8 retrieval 共用。Arbitrary UUID guessing 永遠不能建立 discoverability。

四個 Phase 3 roles 都包含 `document.read`，所以正常 membership 不會單靠 role 產生 discover-only state。

Protected metadata baseline：

| Resource | Discoverable without read | Requires read |
| --- | --- | --- |
| Workspace | stable ID、name、workspace type、lifecycle state | governance detail not otherwise granted |
| Source | stable ID、name、source type、lifecycle state | content-derived detail / previews |
| Document | stable ID、resource type、lifecycle state | title、metadata、snippet、current/revision content |
| Revision | 不提供 discover-only listing | revision metadata/body |

其他 User 猜中 Personal Workspace/resource UUID，沒有 trusted discoverability grant 時回 `404`。

## 12. Workspace-level authorization only

Phase 3 不實作 Source-level override 或 Document-level ACL：

```text
Caller
  ↓
Workspace policy
  ↓
Sources
  ↓
Documents / Revisions
```

不同 confidentiality/member boundary 使用另一個 Team Workspace。未來 granular ACL 必須另立 amendment 先定義 precedence、discover/read、audit、group/direct interaction；不得加入 ad-hoc permission columns。

## 13. Workspace lifecycle

### 13.1 Team rename

只有 OWNER 可 rename TEAM。Stable ID 與 Knowledge identity 不變。

Personal 固定 `My Space`，不支援 rename。

### 13.2 Team archive / restore

只有 OWNER 可執行 `ACTIVE ↔ ARCHIVED`。

Archived Team = **read-only frozen scope**。

Allowed：

- 原本仍具 effective access 的 caller read existing Knowledge；
- OWNER / ADMIN read governance/audit；
- OWNER restore。

Blocked：

- import / sync；
- authoring / Source mutation；
- direct membership mutation；
- group mapping mutation；
- rename；
- other ordinary governance mutations。

Archive/restore audit 必須與 mutation atomic。Lifecycle denial 與 authorization denial 分開表達。

### 13.3 Personal offboarding freeze

Personal 沒有 user archive。Identity deprovisioning 走 explicit system governance freeze/archive + audit：Knowledge retained、owner 不轉移、不 auto-delete、一般 user 不可 restore。Retention/compliance 另行設計。

## 14. Membership administration

Team 支援：

- add existing Hub user as direct member；
- change direct role；
- remove direct member；
- add/change/remove SSO Group mapping；
- inspect effective access + grant provenance。

Rules：

- target 必須是既有 Hub User；不做 invite flow。
- Personal 不進一般 membership administration。
- same org != allow；cross org != deny。
- role mutation遵守 OWNER/ADMIN matrix。
- final OWNER remove/demote transactionally rejected。
- archived Workspace 禁止 membership/group mutation。

## 15. Company SSO adapter

Trusted company adapter 提供：

```text
identity = {id, emp_id, name, org_code}
validatedExternalGroupIds = [...]
platformCapabilities = [...]
```

SSO claims 不直接決定 Workspace access；external group 必須命中 `workspace_group_mappings` 才產生 Workspace grant。Platform capability mapping 則只進 `PlatformAccessPolicy`，不 materialize 成 Workspace membership。

不得：

```text
if caller.org_code == workspace.owner_org_code => allow
```

不得因 external group name 與 Workspace name 相同自動 allow。

## 16. Audit

### 16.1 Scope

至少：

```text
PERSONAL_WORKSPACE_PROVISIONED
PERSONAL_WORKSPACE_FROZEN
TEAM_WORKSPACE_CREATED
TEAM_WORKSPACE_RENAMED
TEAM_WORKSPACE_ARCHIVED
TEAM_WORKSPACE_RESTORED
MEMBER_ADDED
MEMBER_ROLE_CHANGED
MEMBER_REMOVED
GROUP_MAPPING_ADDED
GROUP_MAPPING_ROLE_CHANGED
GROUP_MAPPING_REMOVED
```

OWNER grant/remove 由 membership event 的 typed before/after payload 表達；不建立第二份重複 truth。

Phase 3 不 audit every read/search/document revision/Agent retrieval。

### 16.2 Atomicity

```text
BEGIN
  mutate workspace/membership/group
  append audit
COMMIT
```

Audit append failure 必須使 governance mutation rollback。

### 16.3 Audit read

OWNER / ADMIN 可讀 Team audit；EDITOR / VIEWER 不具 `audit.read`。Application 只 append/read；retention/export/compliance 後續設計。

## 17. Product behavior

### 17.1 Workspace selector

```text
Workspace ▼

My Space

────────────
Team Workspaces
  HRKM
  Query Master
  SWFP
```

Rules：My Space 永遠置頂；Team MVP name ascending；不顯示 role/org/owner/member count/permissions；selector 只是 navigation。

### 17.2 Team administration

Direct Members 與 SSO Groups 分開：

```text
Members
  Alice  OWNER
  Bob    ADMIN
  Mike   VIEWER

SSO Groups
  HRKM-Team      EDITOR
  HRKM-Readers   VIEWER
```

Effective Access 是 computed view，不 persisted：

```text
Mike
  Direct: VIEWER
  Group: HRKM-Team → EDITOR
  Effective: EDITOR capabilities
```

刪除 direct grant 時，如果 group 仍可能提供 access，UI 不得宣稱「will lose access」。

### 17.3 Personal UI

My Space 不顯示 rename、member/invite、group mapping、ownership transfer、user archive/delete。仍可管理多個 Sources，沿用 normal Workspace routes。

## 18. Personal → Team promotion boundary for later phases

Phase 3 不實作 promotion，但未來 contract 固定：

```text
My Space Document A
       │
       │ Share / Promote
       ▼
Team Workspace Document B
```

B 是新的 Team-owned stable Document ID；A 留在 My Space；不 move、不共享 ID、不 auto-sync、MVP 不建立 lineage dependency。A/B promotion 後獨立演進。未來 provenance relation 必須另行設計，不得偷渡 cross-workspace sync。

## 19. Interaction with later phases

- **Phase 4:** Search single/cross authorized Workspaces，包含 My Space；Workspace policy 是 canonical auth truth。
- **Phase 5:** My Space/Team 都可作 HUB_MANAGED authoring target；promotion 若實作必須遵守 independent-copy contract。
- **Phase 6:** Personal Knowledge 不因 PERSONAL 自動禁止 publishing；Publishing 自己定 governance。
- **Phase 7:** Agent delegated human identity reuse 同一 Workspace policy；不建 `mcp_personal_space`。
- **Phase 8:** Derived index 可帶 Workspace scope，但不能成為 auth truth。
- **Phase 9:** My Space != Agent Memory Store；Memory 保持 independent governed domain。

## 20. Migration strategy

1. `workspaces` 增加 type/lifecycle/personal owner governance columns，以 backward-compatible nullable/default strategy 上線。
2. Existing Workspaces 明確 backfill TEAM；不使用 name/org/member heuristic。
3. `workspace_memberships` 增加 fixed role/provenance；bootstrap roles 由 explicit configuration/admin bootstrap 決定。
4. 建立 `workspace_group_mappings`、`workspace_audit_events`。
5. 每個既有 User idempotently provision My Space + OWNER/SYSTEM_PERSONAL。
6. 啟用 personal owner uniqueness/type、role/group constraints。
7. authorization 從 binary membership 改 capability evaluation；accessible listing 改 personal + direct + group aggregation。
8. `/` default 改 My Space；selector 改 Personal/Team grouping。
9. 移除 local/mock governance assumptions。

Local/dev seed 明確指定 Team bootstrap owners/admins 和 platform capability grants；production 不允許 heuristic elevation。

## 21. Required tests

### Personal

- repeated provision → same Workspace ID；one user cannot own two Personal Workspaces。
- name fixed My Space；rename rejected。
- exactly one OWNER/SYSTEM_PERSONAL membership。
- second direct member / group mapping / transfer / ordinary archive-delete rejected。
- system offboarding freeze retains Knowledge + audit。
- normal Workspace routes support browse/import/sync。
- other user UUID guess → 404 absent trusted discoverability。
- `/` enters My Space before Team。

### Roles / governance

- Team create requires trusted `workspace.create_team` platform capability；Workspace role alone cannot grant it。
- browser cannot inject platform capability or validated group IDs。
- creator becomes direct OWNER；multiple OWNER allowed；zero-OWNER transition rejected transactionally。
- OWNER manages all four direct roles；ADMIN manages EDITOR/VIEWER only。
- ADMIN cannot create/remove OWNER/ADMIN or rename/archive/restore。
- OWNER can rename/archive/restore。
- Group cannot grant OWNER；ADMIN cannot create/upgrade Group→ADMIN；OWNER can。

### Authorization / groups

- Viewer reads only；Editor can permitted Knowledge/Source writes but not membership。
- SOURCE_MANAGED write guard remains authoritative。
- direct VIEWER + group EDITOR yields union；direct removal preserves access if group grant remains。
- group-only grant appears in accessible list。
- Hub has no materialized user↔external-group truth；external IAM change is reflected on trusted session refresh。
- same-org non-member denied；cross-org valid grant allowed。
- route mismatch/UUID guessing cannot establish auth/discoverability。
- discover/read keeps 404 vs 403 although no DISCOVERER role is assignable。

### Lifecycle

- archived Team preserves authorized read。
- archived Team blocks import/sync/authoring/source/member/group/rename mutation。
- only OWNER restores；lifecycle denial != authorization denial。

### Audit

- Personal provision/freeze emit SYSTEM audit。
- Team create/rename/archive/restore emit audit。
- membership/group role changes emit deterministic before/after payload。
- audit target_id semantics match WORKSPACE/MEMBER/GROUP_MAPPING definitions。
- rollback removes corresponding audit；audit failure prevents mutation commit。
- OWNER/ADMIN can read；EDITOR/VIEWER cannot；no application update/delete。

### Migration / compatibility

- existing Workspaces become TEAM without stable ID change。
- Source/Document/Revision IDs unchanged。
- Workspace-scoped routes remain canonical。
- designed backfills/provisioning are rerunnable/idempotent。

## 22. Acceptance criteria

1. Every active/provisioned User gets exactly one idempotent `Workspace(type=PERSONAL, name='My Space')`.
2. `/` enters My Space and Personal/Team reuse existing Workspace routes.
3. Personal is single-user/system-managed：no ordinary members、group mappings、rename、transfer、user archive/delete。
4. Team creation requires trusted platform `workspace.create_team` and creates a direct OWNER.
5. Team supports multiple OWNERs but cannot commit zero direct OWNERs.
6. Roles are exactly OWNER / ADMIN / EDITOR / VIEWER；no assignable DISCOVERER。
7. OWNER/ADMIN authority follows §9。
8. Direct + validated group grants are independent and capability-unioned without deny。
9. Group cannot grant OWNER；Hub does not materialize external user-group truth。
10. Workspace is the only Phase 3 Knowledge authorization boundary；no Source/Document ACL baseline。
11. Archived Team is read-only；only OWNER restore。
12. Discover/read preserves 404 vs 403 semantics。
13. Governance mutations are atomically auditable with deterministic target identity。
14. Workspace selector groups My Space separately from Team Workspaces。
15. Platform capability/group inputs originate only from trusted identity/provider boundaries。
16. Phase 4–9 can reuse the same Workspace policy without parallel personal Knowledge architecture。

## 23. Architectural decision summary

```text
User
  ├─ PERSONAL Workspace: My Space
  │     ├─ Source A
  │     ├─ Source B
  │     └─ Knowledge
  │
  └─ TEAM Workspaces
        ├─ direct memberships
        ├─ SSO Group mappings
        └─ Sources / Knowledge

Effective Team access
= direct grants ∪ validated group grants

Authorization boundary
= Workspace

Platform create authority
= trusted PlatformAccessPolicy(workspace.create_team)
```

Do not build:

```text
User ── PersonalKnowledge
Workspace ── TeamKnowledge
Workspace → Source ACL → Document ACL
SSO Group membership copied into Hub as a second IAM truth
Browser-provided platform capability / validated group claims
```

The system deliberately keeps **one Knowledge container abstraction: Workspace**. Personal Space is a product/governance specialization of Workspace, not a second storage, routing, search, publishing or MCP architecture.