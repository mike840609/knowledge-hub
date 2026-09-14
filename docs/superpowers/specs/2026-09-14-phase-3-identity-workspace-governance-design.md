# Knowledge Hub — Phase 3 Identity, Workspace Administration & Governance Design

| 項目 | 內容 |
| --- | --- |
| 文件日期 | 2026-09-14 |
| 文件類型 | Design Spec；不包含 Implementation Plan |
| 狀態 | Review requested |
| 前置 | Phase 0 Foundation、Phase 1 Knowledge Core & Tree、Phase 2 Knowledge Source Import & Sync、Phase 2.5 Frontend Product Baseline |
| 既有授權約束 | `2026-09-14-resource-visibility-access-semantics-amendment.md`、`2026-09-14-phase-3-authorization-clarification.md` |
| 核心新增決策 | Personal Space 不建立獨立 domain；以 `Workspace(type=PERSONAL)` 表達 |

## 1. Goal

Phase 3 把 Phase 0–2 的 local/mock `WorkspaceMembership` foundation 升級成可用於公司正式多使用者環境的 Workspace lifecycle、identity mapping、roles/capabilities 與 auditable governance。

Phase 3 同時正式定義 **Personal Workspace**：每位 User 可以擁有自己的 Knowledge 空間，但 Personal Space 不形成第二套 Knowledge ownership 或 authorization hierarchy。所有 Knowledge 仍遵循同一條 canonical chain：

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

因此 Phase 0–2 已固定的 `Source → Workspace`、`Document → Source → Workspace`、stable Document identity、Source ownership、Tree、Revision 與 import/sync contract 都不需要因 Personal Space 重做。

## 2. Non-goals

Phase 3 不做以下項目：

- 不建立獨立 `PersonalSpace`、`UserKnowledge` 或 `user_id` scoped Document hierarchy。
- 不在 Document 上加入 `private=true` 作為主要 privacy model。
- 不讓 Document 同時支援 `user_id` / `workspace_id` 二選一 ownership。
- 不建立 Agent principal、MCP transport 或 Agent Memory domain；這些仍分別屬 Phase 7 / Phase 9。
- 不建立 rich authoring；Phase 5 才加入 Web create/edit。
- 不重新設計 Phase 2.5 的 Workspace-scoped product route。
- 不預設 Document-level ACL；只有 Workspace/Source policy 經真實需求證明不足時，才另行設計。
- 不提供 Workspace hard delete。

## 3. Workspace remains the only Knowledge container

### 3.1 Workspace types

Workspace 新增明確類型：

```text
Workspace
├─ PERSONAL
│   └─ single-user Knowledge scope
└─ TEAM
    └─ collaborative Knowledge scope
```

Personal Workspace 與 Team Workspace 使用相同 `Workspace → Source → Tree → Document` 模型。差異只存在於 provisioning、membership、lifecycle 與 governance policy。

這表示：

- Personal Workspace 可以建立 `HUB`、`FILE_UPLOAD`、`FOLDER_SYNC` Source。
- Personal Workspace 也可以承接使用者自己的 Obsidian/LLM Wiki generated folder。
- `SOURCE_MANAGED` / `HUB_MANAGED` 行為不因 Workspace type 改變。
- Source/Document 不新增 personal owner 欄位。
- Search、Publishing、MCP 等後續階段只需要理解 Workspace policy，不需要加入 personal-special data path。

### 3.2 UI representation

產品 UX 可以把 Personal Workspace 呈現成 **My Space / Personal**，但 URL 與 application boundary 維持原本的 Workspace-scoped 形式：

```text
/w/:workspaceId/knowledge/...
/w/:workspaceId/sources/...
```

不新增 `/me/knowledge`、`/personal/...` 這種第二套 canonical route。

Workspace selector 可以分組顯示：

```text
My Space
Team Workspaces
  ├─ Query Master
  ├─ SWFP
  └─ HRKM
```

`PERSONAL` 只是 Workspace kind，不是 synthetic Tree folder。

## 4. Personal Workspace invariants

Phase 3 必須保證以下 invariant：

1. 每個 User **最多一個** Personal Workspace。
2. Personal Workspace 必須有且只有一個 `personal_owner_user_id`。
3. `personal_owner_user_id` 必須對應既有 User。
4. Personal Workspace 的 owner 必須同時具有 system-managed Workspace membership，effective role 為 `OWNER`。
5. Personal Workspace 不允許一般邀請第二位 member。
6. Personal Workspace 不允許 SSO Group / Team mapping 加入額外成員。
7. Personal Workspace 不允許 ownership transfer。
8. Personal Workspace 不允許一般 user archive/delete；離職或 identity deprovisioning 的 retention/lifecycle 由 system governance path 處理。
9. Personal Workspace 內的 Knowledge authorization 仍從 resource 反查 `Source.workspace_id`，不能因 caller 是 owner 就跳過 policy boundary。
10. Personal Workspace 是單使用者 application access scope，不代表對公司 infrastructure/compliance 的法律隱私承諾。若未來需要 compliance/break-glass access，必須有獨立 capability、明確 audit 與產品政策；不得存在 hidden bypass。

預設 provision name 為 `My Space`。`name` 仍是 display metadata，可由 owner rename；rename 不影響 Workspace stable ID 或任何 Source/Document identity。

## 5. Personal Workspace provisioning

### 5.1 Provision timing

Personal Workspace 以 idempotent system provisioning 建立：

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
        └─ missing  → create PERSONAL Workspace + OWNER membership + audit event
```

Phase 3 implementation 可以在首次 successful sign-in 或 explicit user bootstrap 時呼叫此 operation，但必須維持同一個 idempotency contract。

不得由 browser 傳入 `owner_user_id` 來 provision 別人的 Personal Workspace。

### 5.2 Existing users

Phase 3 migration/backfill 對每個既有 User 建立缺少的 Personal Workspace。Backfill 必須可重跑且不能產生第二個 Personal Workspace。

Existing Phase 0–2 Workspace 全部視為 `TEAM`；不得依 workspace name、`org_code` 或目前 member 數量猜測它是 Personal Workspace。

## 6. Workspace data model delta

### 6.1 `workspaces`

Phase 3 在既有 Workspace stable ID 上增加治理欄位，概念模型：

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

Database constraints 必須保護：

```text
PERSONAL => personal_owner_user_id IS NOT NULL
TEAM     => personal_owner_user_id IS NULL
UNIQUE(personal_owner_user_id) WHERE semantics are represented by nullable unique value
```

MariaDB nullable UNIQUE 允許多個 `NULL`，因此 TEAM rows 不互相衝突，而同一 User 不能成為兩個 Personal Workspace 的 owner。

`personal_owner_user_id` 只表達 Personal Workspace immutable owner identity；它不是通用 Team Workspace authorization shortcut。

### 6.2 `workspace_memberships`

既有 `(workspace_id, user_id)` association key 保留，Phase 3 增加 production role / provenance：

```text
workspace_memberships
- workspace_id
- user_id
- role
- membership_source: DIRECT | SYSTEM_PERSONAL
- created_by
- created_at
- updated_at
```

SSO Group grants 不強行 materialize 成第二條相同 `(workspace_id, user_id)` membership row；Group mapping 使用獨立 mapping，authorization evaluation 合併 direct membership 與 group grants。

Personal Workspace 的 membership 固定：

```text
workspace_id = personal workspace
user_id      = personal_owner_user_id
role         = OWNER
source       = SYSTEM_PERSONAL
```

該 row 不允許一般 membership admin 刪除、降級或改 owner。

### 6.3 SSO Group mapping

Phase 3 新增概念 association：

```text
WorkspaceGroupMapping
- workspace_id
- external_group_id
- role
- created_by
- created_at
```

只允許 `TEAM` Workspace 建立 mapping。

Group mapping 代表 enterprise identity 對 Workspace role 的 grant；同一 caller 若同時有 direct membership 與一個或多個 group grants，effective capabilities 取 grants 的聯集。Phase 3 MVP 不加入 explicit deny rule，以避免 deny precedence 與 nested policy complexity。

## 7. Roles and capabilities

Roles 是 capability bundle，不是 authorization boundary 本身。

Phase 3 MVP 採固定 role bundle，避免提前建立 custom-role DSL：

| Role | Intended use |
| --- | --- |
| `OWNER` | Workspace full administration；Personal Workspace owner 固定使用 |
| `ADMIN` | Team Workspace administration without ownership semantics |
| `EDITOR` | read/write Knowledge and operate permitted Sources |
| `VIEWER` | discover + read Knowledge |
| `DISCOVERER` | discover resource identity/navigation only；不可讀 protected content |

Policy 至少能回答以下 capability questions：

```text
workspace.discover
source.discover
document.discover
document.read
document.write
source.manage
membership.manage
workspace.manage
audit.read
```

Recommended bundle：

```text
OWNER      = all Phase 3 capabilities
ADMIN      = all except immutable Personal ownership operations
EDITOR     = workspace/source/document discover + document.read/write + source.manage
VIEWER     = workspace/source/document discover + document.read
DISCOVERER = workspace/source/document discover only
```

Phase 5 authoring 之後仍需先通過 `document.write`，再驗證 Source 為 `HUB_MANAGED`；capability 不繞過 Source ownership rules。

## 8. Discover vs read is mandatory

Phase 3 繼承 2026-09-14 accepted authorization amendment：

```text
canDiscover(resource)
├─ false → 404 NOT_FOUND
└─ true
   ├─ canRead(resource) → normal response
   └─ false → 403 ACCESS_DENIED
```

有效狀態可以是：

```text
Workspace discover  ✅
Source discover     ✅
Document discover   ✅
Document read       ❌
```

因此：

- arbitrary UUID guessing 不建立 discoverability；
- route 中的 Workspace/Source ID 只是 navigation context；
- workspace name、owner metadata、`org_code` 都不是 authorization proof；
- `DISCOVERER` 可以支援 request-access UX，但 protected body、revision content、snippet 與未明確分類為 discoverable 的 metadata 必須隱藏；
- Phase 4 search、Phase 7 MCP、Phase 8 retrieval 必須 reuse 同一 distinction。

對其他 User 的 Personal Workspace，caller 沒有 trusted discoverability grant 時必須回 `404`，不能因為 UUID 猜中就回 `403`。

## 9. Team Workspace governance

### 9.1 Create

只有具公司允許的 Workspace provisioning capability 的 caller 可以建立 Team Workspace。

Create transaction 至少完成：

```text
create TEAM Workspace
+ create initial OWNER membership
+ append audit event
```

不得建立沒有任何 production administrator 的 Team Workspace。

### 9.2 Rename

`workspace.manage` 可以 rename Team Workspace。Workspace name 是 mutable display metadata；stable ID 不改變，Source/Document references 不改變。

### 9.3 Archive / restore

Team Workspace 支援 `ACTIVE ↔ ARCHIVED`，不 hard delete。

Archived Workspace：

- 對原本可 discover/read 的 caller 仍可瀏覽既有 Knowledge；
- 一般 Knowledge/Source mutations 禁止；
- restore 需要 `workspace.manage`；
- archive/restore 必須產生 audit event；
- lifecycle denial 與 authorization denial 分開表達，不能把 archived state 偽裝成 membership failure。

Personal Workspace 不提供一般 user archive action。若 identity offboarding 需要凍結 Personal Workspace，由 system governance path 明確處理並 audit。

## 10. Membership administration

Team Workspace 支援：

- add direct member；
- change direct member role；
- remove direct member；
- add/remove SSO Group mapping；
- effective access 重新計算。

Rules：

- caller 必須具有 `membership.manage`；
- 不能移除最後一個可執行 `workspace.manage` 的 Team administrator；
- same org 不自動建立 membership；
- cross org 不自動拒絕 membership；
- Company Team / SSO Group mapping 是 grant source，不是新的 Knowledge container；
- Personal Workspace 不進入一般 membership administration flow。

## 11. Source-level and Document-level overrides

Phase 3 policy engine 邊界必須允許未來 Source-level override，但 MVP 只有真實需求證明 Workspace role 不足時才實作。

如果 Phase 3 implementation 加入 Source override，必須：

- 由 `Source → Workspace` 先建立 Workspace discoverability；
- override 不能把任意 caller 直接變成 Workspace member；
- override 行為必須明確是 grant 或 restriction，不能靠模糊 precedence；
- 所有變更 audit。

Document-level ACL 暫不加入。若 Workspace + optional Source policy 已能滿足需求，就維持 YAGNI。

## 12. Company SSO adapter

Company SSO adapter 只負責把可信 external identity 映射成既有 User identity contract：

```text
{id, emp_id, name, org_code}
```

SSO claim 本身不直接決定 Knowledge access。

Authorization input 可以包含 validated external groups，但 group 必須經 `WorkspaceGroupMapping` 轉成 Workspace role/capabilities。不得寫：

```text
if caller.org_code == workspace.owner_org_code => allow
```

也不得因 external group name 與 Workspace name 相同就自動 allow。

## 13. Audit

Phase 3 新增 append-only governance audit events，至少涵蓋：

- Personal Workspace provision；
- Team Workspace create；
- rename；
- archive / restore；
- direct membership add / role change / remove；
- SSO Group mapping add / role change / remove；
- system Personal Workspace lifecycle action；
- future compliance/break-glass action if ever introduced。

Audit event 至少需要：

```text
actor
operation
resource type/id
before/after summary or typed payload
timestamp
request/correlation id when available
```

Phase 3 不要求 audit every read；security-sensitive reads 若有公司 compliance requirement 再另行定義。

## 14. Product behavior

Phase 2.5 shell 不重做，只在 Workspace selector / admin surface 擴充：

```text
Workspace selector
├─ My Space
└─ Team Workspaces
```

Personal Workspace：

- 可瀏覽 Knowledge / Sources；
- 可執行 owner capability 允許的 Source import/sync；
- 不顯示 invite members / SSO mapping；
- 不顯示 ownership transfer；
- 不顯示 user archive/delete。

Team Workspace：

- 顯示 role/capability 允許的 administration UI；
- unauthorized actions 不只靠 hide button，application service 必須重新 authorization。

Known-but-unreadable resource 顯示 Access denied / request-access UX；undiscoverable 顯示 Not found；unexpected failure 才進 generic error boundary。

## 15. Interaction with later phases

### Phase 4 — Discovery

Search 可以：

- filter single Workspace；
- search across caller-authorized Workspaces；
- 包含 Personal Workspace；
- 不洩漏 unreadable content/snippet。

### Phase 5 — Human Authoring

Personal Workspace 是合法 HUB_MANAGED authoring target。`document.write` 仍需配合 Source ownership guard。

### Phase 6 — Publishing

Personal Workspace 的 Knowledge 不因「personal」自動禁止 publishing。Publishing policy 仍需在 Phase 6 明確驗證 caller 對被引用 Knowledge 的權限及 publishing-specific governance。

### Phase 7 — Agent / MCP

若 Agent delegate human identity，Personal Workspace 可透過完全相同 Workspace policy 被讀取；不建立 `mcp_personal_space` 特例。

### Phase 9 — Agent Memory

Personal Workspace 是 Knowledge scope，不等於 Agent Memory store。Phase 9 仍維持 independent Memory domain，可引用或 promote 到 Personal/Team Workspace Knowledge，但不把所有 personal Knowledge 自動視為 Agent long-term memory。

## 16. Migration strategy

Phase 3 implementation migration order：

1. `workspaces` 增加 type/lifecycle/personal owner governance columns，以 backward-compatible nullable/default strategy 上線。
2. Existing Workspaces 明確 backfill 為 `TEAM`。
3. Membership schema 加 role/provenance；production bootstrap role 不從 `org_code`、workspace name 或 row order 推測。
4. 建立 SSO Group mapping / audit tables。
5. 對每個既有 User idempotently provision Personal Workspace + `OWNER/SYSTEM_PERSONAL` membership。
6. 啟用 database constraints / unique owner invariant。
7. application authorization 從 binary membership guard 切換成 production policy evaluation。
8. 移除任何只適用 local/mock governance 的 deployment assumption。

Local/dev seed 可以明確指定 bootstrap roles；公司 production migration 必須由 explicit configuration / admin bootstrap / SSO mapping 提供初始 admin，不允許 heuristic elevation。

## 17. Required tests

Phase 3 至少需要下列 evidence：

### Personal Workspace

- same user repeated provision → same Workspace ID；
- one user cannot own two Personal Workspaces；
- Personal Workspace has exactly owner system membership；
- direct invitation to Personal Workspace rejected；
- SSO Group mapping to Personal Workspace rejected；
- other user guessing Personal Workspace/resource UUID → `404`；
- owner can browse/import/sync through normal Workspace path；
- Personal Workspace route uses `/w/:workspaceId/...` and does not require special endpoint。

### Authorization

- `DISCOVERER`: document exists is discoverable but body read returns `403`；
- undiscoverable resource returns `404`；
- Viewer can read but cannot write/manage；
- Editor can write HUB_MANAGED Knowledge but cannot manage membership；
- Source ownership guard still blocks ordinary writes to SOURCE_MANAGED content；
- route Workspace mismatch cannot establish authorization；
- same-org non-member remains denied；
- cross-org valid grant remains allowed。

### Governance

- Team Workspace create always establishes administrator；
- cannot remove last administrator；
- archive blocks mutations but preserves permitted read behavior；
- restore requires workspace manage capability；
- membership/group/lifecycle changes emit audit events；
- existing Phase 0–2 Source/Document stable IDs survive migration unchanged。

## 18. Acceptance criteria

Phase 3 design is satisfied when implementation can demonstrate all of the following without changing Phase 0–2 canonical Knowledge identity:

1. Every User has an idempotently provisioned Personal Workspace represented as `Workspace(type=PERSONAL)`.
2. Personal Workspace is single-user at the application authorization layer and cannot receive ordinary members or group mappings.
3. Team Workspace supports production lifecycle, roles, direct membership and enterprise group grants.
4. `discover` and `read` are independently evaluable and preserve `404` vs `403` semantics.
5. Human Web reuses the existing Workspace-scoped shell/routes for both Personal and Team Workspace.
6. Company SSO maps trusted identity/groups into the Workspace policy model without using `org_code` as authorization truth.
7. Governance changes are auditable.
8. Phase 4–9 can reuse the same Workspace policy boundary without introducing a parallel personal-Knowledge model.

## 19. Architectural decision summary

```text
Do:
User
  ├─ PERSONAL Workspace
  │     └─ Sources / Knowledge
  └─ TEAM Workspaces
        └─ Sources / Knowledge

Do not:
User ── PersonalKnowledge
Workspace ── TeamKnowledge
```

The system deliberately keeps **one Knowledge container abstraction: Workspace**. Personal Space is a product/governance specialization of Workspace, not a second storage, routing, search, publishing, or MCP architecture.
