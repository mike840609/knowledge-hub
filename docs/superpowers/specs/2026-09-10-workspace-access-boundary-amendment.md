# Knowledge Hub — Workspace Access Boundary Architecture Amendment

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-10 |
| 文件類型 | Architecture Amendment；修正 Phase 0–1 已核准文件的 tenant / access boundary |
| 決策狀態 | Approved architecture correction |
| 影響範圍 | Phase 0 foundation、Phase 1 read/tree、Phase 2 source import、Phase 3 governance、Phase 4+ query/publishing/agent scope |
| 不變範圍 | Source ownership mode、Tree、Document stable ID、Revision、SourceEntry、archive/restore、sync safety、READ COMMITTED、UUIDv7/native UUID |

## 1. 為什麼需要修正

原 Phase 0–1 文件以：

```text
org_code
  └── KnowledgeSource
       └── Tree / Document
```

作為上層結構，並把每個 Source 綁定單一 `org_code` owner。這可以表示組織歸屬，但不足以表示實際企業知識協作：不同組織的人可能需要共同存取同一個專案／團隊 Knowledge，使用者的組織異動也不應自動改變 Knowledge membership。

因此本 amendment 將兩個概念拆開：

- `org_code`：公司身分／組織屬性，回答「這個人目前屬於哪個組織」。
- `Workspace`：Knowledge container 與基本 access boundary，回答「這個人可以進入哪些知識空間」。

`org_code` 保留，但不再直接作為 Source 或 Document 的授權條件。

## 2. Normative Model

新的核心關係為：

```text
User
├── emp_id
├── name
└── org_code                  ← identity / organization attribute

User
  │
  └── WorkspaceMembership
          │
          ▼
      Workspace               ← knowledge + basic access boundary
          │
          └── KnowledgeSource ← source is still the Tree root
                ├── SourceEntry
                ├── KnowledgeAsset
                └── KnowledgeTreeNode
                      ├── FOLDER
                      └── DOCUMENT
                            │
                            ▼
                    KnowledgeDocument
                            │
                            ▼
                    KnowledgeRevision
```

### 2.1 Organization 與 Workspace 的責任

| Concept | Responsibility | 不負責 |
| --- | --- | --- |
| `User.org_code` | SSO／HR identity attribute、組織資訊、治理 metadata | 不直接決定可讀哪些 Source／Document |
| `Workspace` | Knowledge container、Source parent、基本 access scope | 不取代 Source、Tree 或 Organization identity |
| `WorkspaceMembership` | 表示 User 是否屬於 Workspace | Phase 0 不承諾完整角色／ACL 系統 |
| `Workspace.owner_org_code` | accountable / governing organization metadata | 不等於唯一可存取 organization |
| `KnowledgeSource.workspace_id` | Source 所屬 Workspace | 不允許一般 Tree move 隱式跨 Workspace |

不同 `org_code` 的使用者可以同時是同一 Workspace 的 member。

例如：

```text
Workspace: Query Master
owner_org_code: HRSD

Members
├── Mike   org=HRSD
├── Alice  org=RD
└── Bob    org=IT
```

三人都可以進入 Query Master Workspace；`owner_org_code = HRSD` 只表示主要治理歸屬，不是 ACL 判斷式。

## 3. Phase 0 Schema Correction

原本八張 Knowledge / Source core tables 保留，Phase 0 foundation 新增兩張 Workspace tables；因此 Phase 0 canonical schema 現在是十張 domain tables：

```text
users
workspaces
workspace_memberships
knowledge_sources
source_entries
knowledge_tree_nodes
knowledge_documents
knowledge_revisions
knowledge_assets
sync_runs
```

### 3.1 `users`

維持：

```text
id UUID PK
emp_id UNIQUE
name
org_code
```

`org_code` 仍是 required identity attribute；SSO adapter 未來仍映射到相同 `UserIdentity` contract。

### 3.2 `workspaces`

Phase 0 最小欄位：

```text
id UUID PK
name
slug
owner_org_code
created_by
created_at
updated_at
```

規則：

- `id` 使用 application-generated UUIDv7 + MariaDB native `UUID`。
- `slug` 為 Hub 內穩定 human-readable selector，必須唯一；不是 authorization token。
- `owner_org_code` 保存主要治理組織 metadata，可修改；修改不自動新增／移除 membership。
- Phase 0 不提前設計 Workspace archive、quota、billing 或企業 hierarchy。

### 3.3 `workspace_memberships`

Phase 0 最小欄位：

```text
id UUID PK
workspace_id FK
user_id FK
created_by FK users.id
created_at
```

必要 constraint：

```text
UNIQUE(workspace_id, user_id)
```

Phase 0 membership 只回答「caller 是否可進入 Workspace」。完整 VIEWER / EDITOR / PUBLISHER / ADMIN 等 role semantics、Team／SSO Group mapping 與 granular ACL 在 Phase 3 設計。

Phase 0–2 不使用 `org_code == workspace.owner_org_code` 取代 membership lookup。

### 3.4 `knowledge_sources`

移除 authorization ownership 欄位：

```diff
 knowledge_sources
- org_code
+ workspace_id UUID NOT NULL FK → workspaces.id
```

保留原欄位：

```text
id
name
source_type
ownership
status
sync_version
created_by / updated_by / archived_by / archived_at
created_at / updated_at
```

其中 `ownership` 仍然只表示：

```text
SOURCE_MANAGED
HUB_MANAGED
```

它與 Workspace access 是兩個不同維度，不得混用。

## 4. Access Boundary

Phase 0 建立最小安全邊界：

```text
CallerContext
   │
   ▼
resolve WorkspaceMembership
   │
   ▼
Workspace
   │
   ▼
KnowledgeSource
   │
   ▼
Tree / Document
```

### 4.1 最小 Phase 0–2 policy

在完整 Phase 3 governance 前：

- caller 必須存在對應 `WorkspaceMembership`，才可進入該 Workspace 的 read/write application flow。
- caller 的 `org_code` 與 `Workspace.owner_org_code` 不需要相同。
- 知道 `workspace_id`、`source_id` 或 `document_id` 不代表取得存取權。
- application service 必須由 source/document 反查 Workspace 並驗證 membership；不能只依賴 UI Workspace selector。
- `SOURCE_MANAGED / HUB_MANAGED` mutation authority 規則仍照原 Phase 0–1 design 執行。
- Phase 0 的 membership 是 foundation guard，不冒充最終企業 ACL；Phase 3 再增加 role、group、team 或 resource-level policy。

### 4.2 CallerContext

`UserIdentity` 不變：

```ts
type UserIdentity = {
  id: string;
  emp_id: string;
  name: string;
  org_code: string;
};

type CallerContext = {
  identity: UserIdentity;
};
```

不要把 `workspace_id` 固定塞進 `CallerContext`，因為同一個 caller 可以同時存取多個 Workspace。Workspace 是每個 operation 的 resource scope，不是登入後唯一 tenant。

例如：

```text
listWorkspaces(caller)
listSources(caller, workspaceId)
listTree(caller, sourceId)
getDocument(caller, documentId)
```

`listTree` / `getDocument` 等 service 仍必須由 resource relationship 找回 Workspace，再做 membership check；不能信任 caller 額外宣稱的 workspace。

## 5. Module Boundary Correction

Phase 0 從三個 business module 調整為四個：

```text
src/modules/
├── identity/
├── workspaces/
├── knowledge/
└── sources/
```

責任：

```text
Identity
  └── Who is the caller?

Workspaces
  ├── Which Workspaces exist?
  └── Is this user a member?

Sources
  ├── Which Workspace owns this Source?
  └── Source / SourceEntry / Sync state

Knowledge
  └── Document / Revision / Tree / lifecycle
```

Dependency direction：

```text
Identity ───────► CallerContext
                     │
Workspaces ──────────┤
                     ▼
              Application Services
                ▲             ▲
                │             │
             Sources ─────► Knowledge
```

Knowledge 不 import Workspace UI 或 SSO implementation；需要 access 判斷時透過 application/port 取得 Workspace membership decision。

## 6. Source 與 Workspace Rules

- 一個 Workspace 可以有多個 Source。
- 一個 Source 必須且只屬於一個 Workspace。
- Source 本身仍是該 Source Tree 的 root；**Workspace 不是 synthetic Tree folder**。
- Tree move 只能在同 Source 內進行，原本禁止跨 Source move 的 invariant 不變。
- Source 不能透過普通 rename/move 改變 Workspace。未來若需要 transfer Source 到另一 Workspace，必須設計明確 transfer/migration operation。
- Document 透過 Source 間接屬於 Workspace，不另重複保存 `workspace_id`，避免多份 scope truth。

因此：

```text
Workspace
├── Source A
│   └── Tree A
└── Source B
    └── Tree B
```

而不是：

```text
Workspace Tree
└── Source inserted as arbitrary child folder
```

## 7. Phase 1 UI / Read Contract Correction

Phase 1 read-only Knowledge Browser 改為：

```text
Workspace selector
  ↓
Source selector
  ↓
Folder / Document Tree
  ↓
Document / Revision viewer
```

例如：

```text
Query Master ▼                    ← Workspace

Source: Obsidian Wiki ▼           ← KnowledgeSource

Architecture
├── Overview
└── Database
```

Workspace selector 顯示 `listWorkspaces(caller)` 的結果，不顯示 caller 無 membership 的 Workspace。

Phase 1 仍不新增完整 Workspace management UI、invitation、roles 或 sharing UI；這些屬於 Phase 3 governance。

## 8. Phase 2 Import / Sync Correction

首次 Folder Import：

```text
select Workspace
  → select folder
  → propose new Source name
  → scan / snapshot
  → Preview
  → Confirm
  → create Source in selected Workspace + Apply
```

規則：

- 新 Source 必須明確指定 `workspace_id`。
- folder name 仍只作 Source name 的可修改預設值。
- Source 仍是 Tree root，因此不新增「任意 Knowledge location」來把 Source 掛到另一 Source 的 folder 下。
- 更新既有 Source 時，由 `source_id` 決定 Workspace；UI 不允許同步時順便換 Workspace。
- 若 caller 對 target Workspace 沒有 membership，Preview/Create Source 都必須拒絕。

## 9. Phase 3 Governance Responsibility

Phase 3 不再負責「第一次建立 org owner boundary」，而是在已存在的 Workspace membership foundation 上增加企業治理能力。

Phase 3 重新定義為：

```text
Identity resolution
      │
      ▼
Workspace membership
      │
      ├── roles / capabilities
      ├── Team / SSO group mapping
      ├── membership management
      ├── optional source/document policy
      └── audit history
```

本 amendment 不提前決定最終 role taxonomy。Phase 3 design 必須重新評估是否需要 VIEWER / EDITOR / PUBLISHER / ADMIN、Source-level override、Document-level ACL，以及企業 group synchronization。

重要 invariant：

```text
same org != automatically authorized
cross org != automatically denied
```

## 10. Phase 4–9 Effects

### Phase 4 — Discovery / Read API

Search / query 必須先以 caller 可存取 Workspace 作 scope，再搜尋 Source / Document。Search index 是 derived data，也必須能保存或解析 `workspace_id` filtering；不能因使用 search engine 而繞過 membership policy。

### Phase 5 — Human Authoring

新建 HUB_MANAGED Source / Document 必須位於 caller 可存取 Workspace。Authoring permission 的細粒度規則由 Phase 3 policy 決定。

### Phase 6 — tKMS Publishing

Publishing configuration / Publishing Tree 應屬於 Workspace scope，引用該 Workspace 可存取的 Knowledge。Publisher role / capability 由 Phase 3/6 詳細設計，不由 `org_code` 判斷。

### Phase 7 — Agent / MCP

Agent 經可信 identity / principal 進入相同 Workspace access boundary：

```text
Agent caller
  → application service
  → Workspace policy
  → Knowledge
```

MCP 不接受任意 `org_code` 或 `workspace_id` 參數作為授權證明。

### Phase 8 — Semantic / Hybrid Retrieval

Derived index 必須攜帶足以做 Workspace scope filtering 的 metadata；authorization truth 仍在 canonical policy/data，不在 vector index。

### Phase 9 — Agent Memory

Agent Memory 的可見範圍需在 Phase 9 另行設計；不能因 Knowledge 已使用 Workspace 就自動假設所有 memory 都是 workspace-global。

## 11. Invariants Added / Replaced

本 amendment 新增或替換下列 foundation invariants：

1. `User.org_code` 是 identity attribute，不是 Knowledge authorization boundary。
2. 每個 KnowledgeSource 恰屬於一個 Workspace。
3. Source 不直接保存 authorization `org_code` ownership。
4. 每個 `(workspace_id, user_id)` 最多一筆 WorkspaceMembership。
5. 跨 org membership 合法。
6. `Workspace.owner_org_code` 不可作為 membership substitute。
7. Document 的 Workspace scope 由 `Document → Source → Workspace` 推導，不重複保存。
8. Caller 知道 resource ID 不代表有權讀寫；public application services 必須驗證 Workspace membership/policy。
9. 一般 Tree move 不跨 Source；一般 Source operation 不跨 Workspace。
10. 完整 role / Team / group / granular ACL 留 Phase 3，但 Phase 0 不再以 org equality 當 fallback ACL。

原本 stable IDs、Revision immutability、one-document-one-TreeNode、SourceEntry mapping、ACTIVE/ARCHIVED、SOURCE_MANAGED/HUB_MANAGED、READ COMMITTED、row locks、Preview/Confirm/Apply、sync_version 等 invariants 全部維持。

## 12. Acceptance Cases

Phase 0/1 foundation 必須增加：

```text
✓ same-org user without WorkspaceMembership cannot access Workspace Source
✓ cross-org user with WorkspaceMembership can access Workspace Source
✓ user can be member of multiple Workspaces
✓ changing user.org_code does not silently add/remove WorkspaceMembership
✓ changing Workspace.owner_org_code does not change memberships
✓ Source requires a valid Workspace
✓ Source cannot be created in a Workspace the caller cannot access
✓ Document read resolves Source → Workspace before access decision
✓ arbitrary workspaceId/sourceId from UI does not bypass membership check
✓ listWorkspaces only returns caller-visible Workspaces
✓ Source cannot be silently moved to another Workspace through Tree operation
```

Phase 0 local/E2E fixture 至少需要：

```text
User A: org HRSD
User B: org RD
Workspace X: owner_org HRSD
Workspace Y: owner_org RD

Memberships:
A → X
B → X
B → Y
```

用此 fixture 同時證明 cross-org allow 與 non-member deny。

## 13. Supersession / Precedence

本 amendment 是 Phase 0–1 access-boundary 的 normative correction。若以下既有文件與本 amendment 衝突，以本 amendment 為準；其他未衝突內容繼續有效。

### Phase 0 Design Spec

`docs/superpowers/specs/2026-09-10-phase-0-foundation-architecture-design.md`

被取代的內容包括：

- §2.1 中 `org_code → KnowledgeSource → Tree`。
- §2.2 中把跨組織分享整體留到未來、Phase 0 僅保留 org 邊界的描述。
- §3.1 internal ID entity list（需加入 Workspace；Membership 若有 ID 也使用相同 contract）。
- §4.1 Organization / Source ownership model。
- §5 八張表 / `knowledge_sources.org_code` / 「每 Source 一個 org owner」。
- §5.1 對 Source org owner 的 invariant。
- §6 module map 與 source policy scope（新增 Workspaces boundary）。
- §8–10 中所有 org → source smoke / DoD / Phase 3 handoff 描述。
- ADR-004。
- §12 對 Organization → Sources 的 decision trace。

其餘 Phase 0 決策維持有效。

### Phase 0 Implementation Plan

`docs/superpowers/plans/2026-09-10-phase-0-foundation-implementation.md`

需要依本 amendment 校正：

- T03 schema：八張 Knowledge/Source tables + 兩張 Workspace tables。
- T04 ports/domain：新增 Workspace / Membership ports 與 membership policy lookup。
- T06 fixtures：從「兩 org / source」改成「cross-org workspace membership」fixture。
- T07 queries/commands：resource access 先驗證 Workspace membership。
- T09 Web：加入 Workspace selector，再選 Source。
- acceptance matrix：加入 §12 cases。
- Phase 3 handoff：由 org owner policy 改為 Workspace role/group/granular governance。

其他 transaction、revision、Tree、sync safety 工作維持有效。

### Phase 1 Design Spec

`docs/superpowers/specs/2026-09-10-phase-1-knowledge-core-tree-design.md`

校正：

```diff
-org_code → KnowledgeSource → Tree
+Workspace → KnowledgeSource → Tree
```

以及 Phase 1 browser 由 `Source selector` 改為 `Workspace selector → Source selector`。Source as Tree Root、SourceEntry→TreeNode、Revision、lifecycle、concurrency、mutation authority 等設計不變。

### Phase 1 Implementation Plan

`docs/superpowers/plans/2026-09-10-phase-1-knowledge-core-tree-implementation.md`

若文字提到「Phase 0 eight-table schema」，其意義改為「八張 Knowledge/Source core tables」，並額外繼承兩張 Workspace foundation tables。Phase 1 query/browser 必須沿用 Workspace membership guard；不在 Phase 1 建完整 role management。

## 14. ADR-018 — Workspace Is the Knowledge Access Boundary

- **Context:** `org_code` 能表示人的組織歸屬，但不能正確表示跨組織專案知識分享；把 Source 綁死在 org 會迫使後續加入大量跨 org 例外。
- **Decision:** 保留 `User.org_code` 作 identity attribute；新增 Workspace 與 WorkspaceMembership；KnowledgeSource 必須屬於 Workspace；基本 access 依 membership/policy，而非 org equality。
- **Consequences:** Phase 0 schema 新增 Workspace foundation；Phase 1 browser 正式具有 Workspace selector；Phase 2 import 指定 target Workspace；Phase 3 在 membership foundation 上增加 role/team/group/granular governance；Search、Publishing、MCP 皆沿用同一 Workspace scope。

ADR-018 **取代原 Phase 0 ADR-004 的 access/ownership boundary 部分**。ADR-004 的「source-agnostic、每 Document 都有 Source」精神仍保留，但 `org_code → Source` 關係不再有效。

## 15. Self-review

| 檢查 | 結果 |
| --- | --- |
| 是否刪除 org_code | 否；仍是 User identity / governance metadata |
| 是否以 Workspace 取代 Source | 否；Source 仍是 Tree root 與 ownership mode boundary |
| 是否提前做完整 ACL | 否；Phase 0 只建立 membership foundation，Phase 3 擴充 |
| 是否允許跨 org | 是；由 membership/policy 決定 |
| 是否讓同 org 自動取得權限 | 否 |
| 是否重複保存 Document.workspace_id | 否；由 Source 推導 |
| 是否改變 Revision / Tree / Sync 核心 | 否 |
| 是否影響 UUID / transaction contract | 僅新增 Workspace IDs；既有 UUIDv7/native UUID 與 READ COMMITTED contract 不變 |
| 是否讓 UI 成為授權來源 | 否；application service 必須重新驗證 resource Workspace |
| 是否為 Phase 7 Agent 建第二套 ACL | 否；Agent reuse 相同 Workspace policy |

這份 amendment 的目的不是重做 Knowledge Core，而是把 Knowledge Core 的**上層 tenancy / collaboration boundary** 從 Organization 修正為 Workspace。