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

Phase 3 的產品定位採 **personal-first**：使用者登入 Knowledge Hub 後預設進入 My Space；Team Workspace 是受治理建立的共享 Knowledge scope，而不是另一套任意頁面協作系統。

## 2. Non-goals

Phase 3 不做以下項目：

- 不建立獨立 `PersonalSpace`、`UserKnowledge` 或 `user_id` scoped Document hierarchy。
- 不在 Document 上加入 `private=true` 作為主要 privacy model。
- 不讓 Document 同時支援 `user_id` / `workspace_id` 二選一 ownership。
- 不建立 Agent principal、MCP transport 或 Agent Memory domain；這些仍分別屬 Phase 7 / Phase 9。
- 不建立 rich authoring；Phase 5 才加入 Web create/edit。
- 不重新設計 Phase 2.5 的 Workspace-scoped canonical routes。
- 不加入 Source-level override 或 Document-level ACL；需要不同權限時使用不同 Workspace，直到真實需求證明 Workspace boundary 不足。
- 不提供 custom-role DSL、explicit deny、role override 或 per-user deny exception。
- 不提供可指派的 `DISCOVERER` role。
- 不建立 email invite、pending invitation、accept/reject 或 invite token workflow。
- 不把 SSO Group membership 複製／materialize 成 Hub 的 user-group membership truth。
- 不提供 Workspace hard delete。
- 不在 Phase 3 實作 Personal → Team Knowledge promotion；Phase 3 只固定未來 promotion 的 identity boundary。

## 3. Workspace remains the only Knowledge container

### 3.1 Workspace types

Workspace 新增明確類型：

```text
Workspace
├─ PERSONAL
│   └─ single-user application Knowledge scope
└─ TEAM
    └─ governed collaborative Knowledge scope
```

Personal Workspace 與 Team Workspace 使用相同 `Workspace → Source → Tree → Document` 模型。差異只存在於 provisioning、membership、lifecycle 與 governance policy。

因此：

- Personal Workspace 可以有多個 `HUB`、`FILE_UPLOAD`、`FOLDER_SYNC` Source。
- Personal Workspace 可以承接使用者自己的 Obsidian / LLM Wiki generated folders。
- `SOURCE_MANAGED` / `HUB_MANAGED` 行為不因 Workspace type 改變。
- Source / Document 不新增 personal owner 欄位。
- Search、Publishing、MCP、semantic retrieval 等後續階段只理解 Workspace policy，不建立 personal-special data path。

### 3.2 Canonical routes

Personal 與 Team 都沿用 Phase 2.5 Workspace-scoped routes：

```text
/w/:workspaceId/knowledge/...
/w/:workspaceId/sources/...
```

不新增 `/me/knowledge`、`/personal/...` 等第二套 canonical route。`PERSONAL` 是 Workspace kind，不是 synthetic Tree folder，也不是 route special case。

## 4. Personal Workspace invariants

Phase 3 必須保證：

1. 每個 User **恰好一個可取得的 Personal Workspace**；provision operation 本身必須 idempotent。
2. Personal Workspace 必須有且只有一個 `personal_owner_user_id`。
3. `personal_owner_user_id` 必須對應既有 User。
4. Personal Workspace owner 必須同時具有 system-managed membership，role 固定為 `OWNER`。
5. Personal Workspace 不允許 ordinary direct membership 加入第二位 member。
6. Personal Workspace 不允許 SSO Group mapping。
7. Personal Workspace 不允許 ownership transfer。
8. Personal Workspace display name 固定為 `My Space`；一般 user 不允許 rename。
9. Personal Workspace 不允許一般 user archive/delete。
10. identity deprovisioning / offboarding 時只允許 system governance freeze；不自動轉移 owner、不自動刪除 Knowledge。
11. Personal Workspace authorization 仍從 resource 反查 `Source.workspace_id` 並經 Workspace policy；不能因 caller 是 owner 就跳過 canonical policy boundary。
12. Personal Workspace 是單使用者 application access scope，不代表公司 infrastructure/compliance 層的法律隱私承諾；任何未來 break-glass/compliance access 都必須是顯式 capability + audit，不得有 hidden bypass。

`My Space` 是 system-managed product label，但 authorization/domain 判斷永遠使用 `workspace_type=PERSONAL`，不得用 name 字串推導 Workspace type。

## 5. Personal Workspace provisioning and default entry

### 5.1 Provisioning

Personal Workspace 以 idempotent system operation 建立：

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

Browser 不得傳入 `owner_user_id` 來 provision 別人的 Personal Workspace。

Phase 3 migration/backfill 對每個既有 User 建立缺少的 Personal Workspace。Backfill 必須可重跑且不能產生第二個 Personal Workspace。

Existing Phase 0–2 Workspace 全部明確 backfill 為 `TEAM`；不得依 workspace name、`org_code` 或目前 member 數猜測 Workspace type。

### 5.2 Root navigation

Phase 3 覆寫 Phase 2.5 的「first accessible Workspace」root behavior。成功建立 trusted caller context 後：

```text
/
  → ensure Personal Workspace exists
  → My Space
  → first Source by deterministic name order
  → first readable Document by existing Tree order
```

若 My Space 尚無 Source / Document，進入對應 empty state，不自動跳去 Team Workspace。

## 6. Team Workspace provisioning and ownership

### 6.1 Create policy

Team Workspace creation 由 platform-level capability `workspace.create_team` 控制。這個 capability 不屬於任何既有 Workspace role，也不得從 `org_code`、Workspace name、owner metadata 或 client parameter 推導。

Create Team Workspace 時 **不強制綁 SSO Group**。Group mapping 是建立後的 optional governance action。

Create transaction 至少完成：

```text
create TEAM Workspace
+ creator direct membership = OWNER
+ append audit event
```

### 6.2 Multiple owners

Team Workspace 允許多個 direct `OWNER`，但任何時刻必須滿足：

```text
TEAM workspace => direct OWNER count >= 1
```

因此 remove/demote OWNER 必須在同一 transaction 檢查最後 OWNER invariant。SSO Group 永遠不能提供 OWNER grant，所以 owner count 只計算 direct memberships。

Team Workspace 不需要 single-owner transfer workflow；增加新的 OWNER 後再移除舊 OWNER 即可。

## 7. Workspace data model delta

### 7.1 `workspaces`

概念模型：

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

Database/application invariants：

```text
PERSONAL => personal_owner_user_id IS NOT NULL
TEAM     => personal_owner_user_id IS NULL
UNIQUE(personal_owner_user_id)
PERSONAL => name = 'My Space'
```

`personal_owner_user_id` 只表達 Personal Workspace immutable owner identity；它不是 Team Workspace authorization shortcut。

### 7.2 `workspace_memberships`

既有 `(workspace_id, user_id)` association key 保留，增加：

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

Personal system membership 固定：

```text
workspace_id = personal workspace
user_id      = personal_owner_user_id
role         = OWNER
source       = SYSTEM_PERSONAL
```

該 row 不允許一般 membership admin 刪除、降級或改 owner。

Team Workspace direct memberships 使用 `DIRECT`。Direct member 必須是已存在於 Knowledge Hub 的 `users` row；Phase 3 不建立 pending user/invite entity。

### 7.3 `workspace_group_mappings`

Group grant 使用獨立 association，不 materialize 成 `workspace_memberships`：

```text
workspace_group_mappings
- workspace_id
- external_group_id
- role: ADMIN | EDITOR | VIEWER
- created_by
- created_at
- updated_by
- updated_at
```

Rules：

- 只允許 `TEAM` Workspace。
- 同一 `(workspace_id, external_group_id)` 只有一個 mapping。
- Group mapping 永遠不能 grant `OWNER`。
- Hub 不保存 `user_id ↔ external_group_id` membership truth。

### 7.4 `workspace_audit_events`

Phase 3 新增 append-only governance audit table。概念模型：

```text
workspace_audit_events
- id UUID PK
- workspace_id UUID
- actor_kind: USER | SYSTEM
- actor_user_id UUID NULL
- event_type
- target_type
- target_id / target_key
- payload JSON
- correlation_id NULL
- created_at
```

`actor_kind=SYSTEM` 用於 Personal provisioning、offboarding freeze 等 system governance action；此時 `actor_user_id` 可以為 NULL。一般 user-triggered mutation 必須保存 stable `actor_user_id`。

Application API 不提供 UPDATE / DELETE audit event capability。

## 8. Fixed roles and capability bundles

Phase 3 對 product/admin UI 只提供四個固定 roles：

| Role | Purpose |
| --- | --- |
| `OWNER` | Team 最終治理權；Personal owner 固定角色 |
| `ADMIN` | Team 日常管理，不可建立新的 governance authority |
| `EDITOR` | Knowledge contributor / Source operator |
| `VIEWER` | Read-only Knowledge consumer |

**不提供 `DISCOVERER` role。** Discover/read 仍是底層 policy semantics，但 Phase 3 admin UI 不允許指派 discover-only access。

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

Recommended bundle：

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

`document.write` 永遠不繞過 Source ownership rule：Phase 5 即使 caller 是 OWNER/ADMIN/EDITOR，也只能透過 authoring service 修改 `HUB_MANAGED` Knowledge；`SOURCE_MANAGED` 仍由 Source sync authority 控制。

## 9. Governance authority matrix

### 9.1 OWNER

OWNER 可以：

- rename TEAM Workspace；
- archive / restore TEAM Workspace；
- add/remove/change direct `OWNER` / `ADMIN` / `EDITOR` / `VIEWER`；
- 建立／修改／移除 `Group → ADMIN|EDITOR|VIEWER` mapping；
- read audit；
- manage Sources and Knowledge within normal ownership guards。

OWNER 仍不能移除/demote 最後一個 Team OWNER。

### 9.2 ADMIN

ADMIN 可以：

- add/remove/change direct `EDITOR` / `VIEWER`；
- 建立／修改／移除 `Group → EDITOR|VIEWER` mapping；
- read audit；
- manage Sources and Knowledge within normal ownership guards。

ADMIN 不可以：

- grant / remove / demote `OWNER`；
- grant / remove / demote `ADMIN`；
- 把 Group mapping 提升為 `ADMIN`；
- rename Workspace；
- archive / restore Workspace。

因此所有「產生或移除 governance authority」的變更都必須由 OWNER 明確執行並 audit。

### 9.3 EDITOR / VIEWER

EDITOR 不管理 memberships / groups / lifecycle。VIEWER 只讀 Knowledge。Phase 3 不提供 role self-escalation。

## 10. Authorization evaluation

### 10.1 Grant sources

Effective access 只由兩種 grant source 組成：

```text
Direct Membership
+
validated SSO Group mappings
```

Company SSO/session adapter 可以把 validated external group IDs 帶入 trusted `CallerContext`。Knowledge Hub 不定期複製整份 user-group membership，也不展開 group grants 成 direct membership rows。

### 10.2 Capability union

同一 caller 若同時有 direct membership 與一個或多個 matching group grants：

```text
effective capabilities
= direct membership capability set
  UNION
  every matched group mapping capability set
```

Phase 3 沒有 explicit deny，也沒有「Direct 優先」或「Group 優先」。例如：

```text
Direct VIEWER + Group EDITOR => effective EDITOR capabilities
Direct ADMIN + Group VIEWER  => effective ADMIN capabilities
```

UI 若移除 direct membership，不能宣稱 caller 一定失去 Workspace access；仍需根據 validated groups 重算 effective access。

### 10.3 Accessible Workspace listing

`listAccessibleWorkspaces(caller)` 必須聚合：

- Personal `SYSTEM_PERSONAL` membership；
- Team direct memberships；
- matching validated SSO Group mappings。

Phase 3 之後不能再把「存在 `workspace_memberships` row」當成唯一 accessible Workspace query。

## 11. Discover vs read remains mandatory

Phase 3 繼承 accepted authorization amendment：

```text
canDiscover(resource)
├─ false → 404 NOT_FOUND
└─ true
   ├─ canRead(resource) → normal response
   └─ false → 403 ACCESS_DENIED
```

雖然 Phase 3 不提供 `DISCOVERER` role，application policy 仍必須保留 discover/read distinction，因為：

- future request-access / special policy 可能產生 discover-only state；
- Phase 4 search、Phase 7 MCP、Phase 8 retrieval 必須共用相同 non-enumeration semantics；
- arbitrary UUID guessing 永遠不能建立 discoverability。

Phase 3 的四個可指派 Workspace roles 都包含 `document.read`；因此 **正常 Phase 3 Workspace membership 不會單靠 role 產生 discover-only state**。

Protected metadata baseline 維持：

| Resource | Discoverable without read | Requires read |
| --- | --- | --- |
| Workspace | stable ID、name、workspace type、lifecycle state | governance detail not otherwise granted |
| Source | stable ID、name、source type、lifecycle state | content-derived detail / protected previews |
| Document | stable ID、resource type、lifecycle state | title、metadata、snippet、current/revision content |
| Revision | 不單獨提供 discover-only listing | revision metadata/body |

對其他 User 的 Personal Workspace，caller 沒有 trusted discoverability grant 時必須回 `404`，不能因 UUID 猜中就回 `403`。

## 12. Workspace-level authorization only

Phase 3 不實作 Source-level override 或 Document-level ACL。

```text
Caller
  ↓
Workspace policy
  ↓
Sources
  ↓
Documents / Revisions
```

若一批 Knowledge 需要不同成員集合或不同 confidentiality boundary，MVP 解法是建立另一個 Team Workspace，而不是在同一 Workspace 內疊加 ACL precedence。

未來若真實需求證明 Workspace policy 不足，必須另立 amendment，先定義 grant/restriction precedence、discover/read semantics、audit、group/direct interaction，再新增 granular policy。不得加入 ad-hoc Source/Document permission columns。

## 13. Workspace lifecycle

### 13.1 Team rename

只有 OWNER 可 rename TEAM Workspace。Workspace name 是 mutable display metadata；stable ID 不改，Source/Document identity 不改。

Personal Workspace 不支援 rename，固定顯示 `My Space`。

### 13.2 Team archive / restore

只有 OWNER 可執行 `ACTIVE ↔ ARCHIVED`。

Archived Team Workspace 是 **read-only frozen scope**：

Allowed：

- 原本仍具有效 access 的 caller 讀取既有 Knowledge；
- OWNER / ADMIN 讀 governance / audit views；
- OWNER restore。

Blocked：

- Source import / sync；
- Knowledge authoring；
- Source mutation；
- direct membership add/change/remove；
- SSO Group mapping add/change/remove；
- rename；
- 其他一般 governance mutation。

Archive/restore 產生 audit event。Lifecycle denial 與 authorization denial 分開表達；不能把 archived state 偽裝成 membership failure。

### 13.3 Personal offboarding freeze

Personal Workspace 沒有一般 user archive action。Identity deprovisioning 時由 explicit system governance path freeze/archive並 audit：

- Knowledge retained；
- ownership 不轉移；
- 不自動 delete；
- 一般 user 不可 restore；
- future retention/compliance policy 另行設計。

## 14. Membership administration

Team Workspace 支援：

- add existing Hub user as direct member；
- change direct member role；
- remove direct member；
- add/change/remove SSO Group mapping；
- inspect effective access / grant provenance。

Rules：

- direct membership target 必須是既有 Hub User；
- Phase 3 不做 invite flow；
- Personal Workspace 不進入一般 membership administration；
- same org 不自動 allow；cross org 不自動 deny；
- role mutation 必須遵循 OWNER / ADMIN authority matrix；
- remove/demote final Team OWNER 必須 transactionally rejected；
- archived Workspace 禁止 membership/group mutation。

## 15. Company SSO adapter

Company SSO adapter 把可信 external identity 映射成既有 User identity contract，並可附帶 validated external groups：

```text
identity = {id, emp_id, name, org_code}
validatedExternalGroupIds = [...]
```

SSO claims 本身不直接決定 Knowledge access。External group 只有在命中 `workspace_group_mappings` 後才產生 grant。

不得寫：

```text
if caller.org_code == workspace.owner_org_code => allow
```

也不得因 external group name 與 Workspace name 相同就自動 allow。

## 16. Audit

### 16.1 Scope

Phase 3 audit 只記 governance events，不要求 audit every read、search query、document revision 或 Agent retrieval。

至少涵蓋：

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

OWNER grant/remove 可以由 `MEMBER_ADDED` / `MEMBER_ROLE_CHANGED` / `MEMBER_REMOVED` 的 typed before/after payload 明確表示，不需要建立第二份重複 event truth；implementation 若選擇額外 typed OWNER event，也必須保持 single mutation → deterministic audit semantics。

### 16.2 Atomicity

Governance mutation 與 audit append 必須在同一 transaction：

```text
BEGIN
  mutate workspace/membership/group mapping
  append audit event
COMMIT
```

不得出現 mutation 成功但 audit 缺失的 committed state。

### 16.3 Audit read

OWNER / ADMIN 可讀 Team Workspace governance audit。EDITOR / VIEWER 不具 `audit.read`。

Audit event 對 application 是 append-only；retention/export/compliance 由未來 platform governance 定義。

## 17. Product behavior

Phase 2.5 shell 不重做，只擴充 Workspace selector 與 Team administration surface。

### 17.1 Workspace selector

Selector 依 Workspace type 分區：

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

- `My Space` 永遠置頂；
- Team Workspaces MVP 依 name deterministic ascending；
- selector 不顯示 role、org_code、owner、member count 或 permission detail；
- selector 只是 navigation，不是 authorization proof。

### 17.2 Team administration UI

Direct Members 與 SSO Group Mappings 分開管理：

```text
Members
  Alice  OWNER
  Bob    ADMIN
  Mike   VIEWER

SSO Groups
  HRKM-Team      EDITOR
  HRKM-Readers   VIEWER
```

Effective Access 是 computed view，不是 persisted truth。查看 user access 時應顯示 grant provenance，例如：

```text
Mike
  Direct: VIEWER
  Group: HRKM-Team → EDITOR
  Effective: EDITOR capabilities
```

刪除 direct membership 時，如果 caller 仍可能從 group 取得 access，UI 不得誤導顯示「will lose access」。

### 17.3 Personal administration UI

Personal Workspace 不顯示：

- rename；
- invite / member management；
- SSO Group mapping；
- ownership transfer；
- user archive/delete。

Personal Workspace 仍可以像 Team 一樣管理多個 Sources，並透過正常 `/w/:workspaceId/...` routes 瀏覽 Knowledge。

## 18. Personal → Team promotion boundary for later phases

Phase 3 不實作 content promotion，但固定未來語意：

```text
My Space Document A
       │
       │ Share / Promote (future Phase 5+)
       ▼
Team Workspace Document B
```

Rules：

- B 是新的 Team-owned stable Document identity；
- A 保留在 My Space；
- 不 move A；
- 不共享 Document ID；
- 不建立 automatic sync；
- MVP 不建立 lineage dependency；
- Promote 完成後 A/B 各自獨立演進。

未來若需要 provenance relation，必須以獨立 relation design 加入，不能把 cross-workspace sync 偷渡進 Document ownership。

## 19. Interaction with later phases

### Phase 4 — Discovery

Search 可以 filter single Workspace 或跨 caller-authorized Workspaces，包含 My Space。Authorization 仍以 Workspace policy filtering 為 canonical truth，不洩漏 unauthorized protected metadata。

### Phase 5 — Human Authoring

My Space 與 Team Workspace 都是合法 `HUB_MANAGED` authoring targets。`document.write` 仍需配合 Source ownership guard。Personal → Team promotion 若在 Phase 5 實作，必須遵守第 18 節的 independent-copy contract。

### Phase 6 — Publishing

Personal Knowledge 不因 `PERSONAL` 自動禁止 publishing；Phase 6 必須另外定義 publishing governance 並驗證 caller 對每個被引用 Workspace Knowledge 的權限。

### Phase 7 — Agent / MCP

若 Agent delegate human identity，My Space 與 Team Workspace 透過同一 Workspace policy 被讀取；不得新增 `mcp_personal_space` special path。

### Phase 8 — Semantic / Hybrid Retrieval

Derived index 可以使用 Workspace scope filtering，但不能成為 authorization truth。

### Phase 9 — Agent Memory

My Space 是 personal Knowledge scope，不等於 Agent Memory Store。Agent Memory 保持 independent governed domain。

## 20. Migration strategy

Implementation migration order：

1. `workspaces` 增加 type/lifecycle/personal owner governance columns，以 backward-compatible nullable/default strategy 上線。
2. Existing Workspaces 明確 backfill 為 `TEAM`；不使用名稱/組織/member count heuristic。
3. `workspace_memberships` 增加 fixed role/provenance fields；production bootstrap roles 由 explicit configuration/admin bootstrap 決定。
4. 建立 `workspace_group_mappings` 與 `workspace_audit_events`。
5. 對每個既有 User idempotently provision `My Space` + `OWNER/SYSTEM_PERSONAL` membership。
6. 啟用 Personal owner uniqueness / type invariants 與 role/group constraints。
7. application authorization 從 binary membership guard 切換成 capability evaluation；accessible listing 同步切換到 personal + direct + group grants 聚合。
8. `/` default entry 改為 My Space；Workspace selector 改為 Personal / Team grouping。
9. 移除只適用 local/mock governance 的 deployment assumptions。

Local/dev seed 可以明確指定 Team bootstrap owners/admins；production migration 不允許從 `org_code`、workspace name、row order 或 member count heuristic elevation。

## 21. Required tests

### Personal Workspace

- repeated provision for same user → same Workspace ID；
- one user cannot own two Personal Workspaces；
- Personal Workspace name is fixed `My Space`；rename rejected；
- exactly one owner system membership；
- direct second-member add rejected；
- SSO Group mapping rejected；
- ownership transfer rejected；
- ordinary user archive/delete rejected；
- system offboarding freeze retains Knowledge and emits audit；
- owner browses/imports/syncs through ordinary Workspace routes；
- other user guessing Personal Workspace/resource UUID gets `404` unless a future trusted discoverability policy says otherwise；
- `/` resolves My Space before Team Workspace。

### Roles / governance authority

- Team create requires platform `workspace.create_team`；Workspace role alone cannot grant it；
- creator becomes direct OWNER；
- multiple direct OWNERs allowed；
- removing/demoting final OWNER rejected transactionally；
- OWNER can grant/revoke OWNER/ADMIN/EDITOR/VIEWER within invariants；
- ADMIN can manage EDITOR/VIEWER only；
- ADMIN cannot create/remove ADMIN or OWNER；
- ADMIN cannot rename/archive/restore Team Workspace；
- OWNER can rename/archive/restore Team Workspace；
- SSO Group mapping cannot grant OWNER；
- ADMIN cannot create/upgrade Group → ADMIN；OWNER can。

### Authorization / groups

- Viewer reads but cannot write/manage；
- Editor can use permitted Knowledge/Source write operations but cannot manage membership；
- Source ownership guard still blocks ordinary writes to SOURCE_MANAGED content；
- direct VIEWER + group EDITOR yields union with EDITOR capabilities；
- direct removal does not remove access if valid group grant remains；
- group-only grant appears in accessible Workspace listing；
- Hub has no materialized user↔external-group membership truth；
- same-org non-member remains denied；cross-org valid grant remains allowed；
- route Workspace mismatch cannot establish authorization；
- arbitrary UUID guessing cannot establish discoverability；
- discover/read policy still preserves `404` vs `403` semantics even though no `DISCOVERER` role is assignable。

### Lifecycle

- archived Team Workspace preserves authorized read；
- archived Team Workspace blocks import/sync/authoring/source mutation；
- archived Team Workspace blocks membership/group/rename mutation；
- only OWNER restores；
- lifecycle denial remains distinct from authorization denial。

### Audit

- Personal provision/freeze emit system audit events；
- Team create/rename/archive/restore emit audit；
- membership/group role changes emit before/after audit payload；
- mutation rollback also rolls back its audit event；
- audit append failure prevents governance mutation commit；
- OWNER/ADMIN can read audit；EDITOR/VIEWER cannot；
- application exposes no audit update/delete operation。

### Migration / compatibility

- existing Phase 0–2 Workspaces become TEAM without changing stable IDs；
- existing Source/Document/Revision stable IDs remain unchanged；
- existing Workspace-scoped routes remain canonical；
- migration/backfill is idempotent where designed to be rerunnable。

## 22. Acceptance criteria

Phase 3 is complete when implementation demonstrates all of the following without changing Phase 0–2 canonical Knowledge identity:

1. Every User receives exactly one idempotently provisioned `Workspace(type=PERSONAL, name='My Space')`.
2. `/` enters My Space and the Human Web reuses existing Workspace-scoped routes for Personal and Team Knowledge.
3. Personal Workspace remains single-user/system-managed and cannot receive ordinary members, group mappings, rename, transfer or user-driven archive/delete.
4. Team Workspace creation is protected by explicit platform `workspace.create_team` and always establishes at least one direct OWNER.
5. Team Workspace supports multiple OWNERs but can never commit a zero-OWNER state.
6. Fixed roles are exactly OWNER / ADMIN / EDITOR / VIEWER; no assignable DISCOVERER role exists.
7. OWNER vs ADMIN governance authority follows the explicit matrix in this spec.
8. Direct membership and validated SSO Group mapping are independent grant sources whose capabilities are unioned without explicit deny.
9. SSO Group mappings cannot grant OWNER and Knowledge Hub does not materialize external user-group membership truth.
10. Workspace is the only Phase 3 Knowledge authorization boundary; there is no Source/Document ACL baseline.
11. Archived Team Workspace is read-only and only OWNER can restore it.
12. Discover/read semantics preserve `404` vs `403` behavior even though normal Phase 3 roles all include read.
13. Governance mutations are atomically auditable through append-only audit events.
14. Workspace selector groups My Space separately from Team Workspaces while remaining navigation-only.
15. Phase 4–9 can reuse the same Workspace policy boundary without introducing parallel personal-Knowledge storage or authorization models.

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
```

Do not build:

```text
User ── PersonalKnowledge
Workspace ── TeamKnowledge

or

Workspace → Source ACL → Document ACL

or

SSO Group membership copied into Hub as a second IAM truth
```

The system deliberately keeps **one Knowledge container abstraction: Workspace**. Personal Space is a product/governance specialization of Workspace, not a second storage, routing, search, publishing or MCP architecture.