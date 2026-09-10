# Knowledge Hub — Workspace Foundation Implementation Amendment

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-10 |
| 依據 | [Workspace Access Boundary Architecture Amendment](../specs/2026-09-10-workspace-access-boundary-amendment.md) |
| 目的 | 修正 Phase 0 / Phase 1 implementation plans 中以 `org_code` 作 Knowledge access boundary 的假設 |
| 範圍 | 文件／計畫修正；不代表程式已實作或驗收通過 |

## 1. 執行原則

原 Phase 0 / Phase 1 implementation plans 的大部分內容繼續有效。本 amendment 只修改 tenancy / access scope、schema、fixtures、query boundary 與 browser flow。

保留：

- application-generated UUIDv7 + MariaDB native UUID。
- READ COMMITTED canonical transactions。
- Source / Document row locks。
- stable Document ID。
- immutable Revision。
- SourceEntry mapping。
- one-document-one-TreeNode。
- SOURCE_MANAGED / HUB_MANAGED mutation authority。
- ACTIVE / ARCHIVED lifecycle。
- Preview → Confirm → Apply / sync_version safety。

新增：

```text
Workspace
WorkspaceMembership
KnowledgeSource.workspace_id
Workspace access policy
Workspace selector
```

Phase 0–2 的 membership guard 是 local/mock MVP foundation；完整 company mutation authorization 在 Phase 3 完成。

## 2. Phase 0 Task Corrections

### T01 — Application Skeleton

保留原工作，但 business modules 改為：

```text
src/modules/
├── identity/
├── workspaces/
├── knowledge/
└── sources/
```

Import direction：

- `identity` 不依賴 business modules。
- `workspaces` 不依賴 Knowledge ingestion implementation。
- `knowledge` 不 import Web / SSO / Workspace UI implementation；需要 access 時走 policy port。
- `sources` 可以引用 Workspace scope contract 與 Knowledge application operations。

### T02 — MariaDB / Migration Runner

原計畫不變。

### T03 — Core Schema

原本八張 Knowledge / Source core tables 保留，新增：

```text
workspaces
workspace_memberships
```

Phase 0 domain tables：

```text
users
workspaces
workspace_memberships
knowledge_sources
knowledge_documents
knowledge_revisions
knowledge_tree_nodes
source_entries
knowledge_assets
sync_runs
```

Migration 順序建議：

```text
users
→ workspaces
→ workspace_memberships
→ knowledge_sources
→ knowledge_documents
→ knowledge_revisions
→ knowledge_tree_nodes
→ source_entries
→ knowledge_assets
→ sync_runs
```

`workspaces`：

```text
id UUID PK
name VARCHAR(512) NOT NULL
created_at DATETIME(6) NOT NULL
updated_at DATETIME(6) NOT NULL
```

Phase 0 不要求 `owner_org_code`、slug、role、Workspace archive 或企業 hierarchy。

`workspace_memberships`：

```text
workspace_id UUID NOT NULL FK → workspaces.id
user_id UUID NOT NULL FK → users.id
created_at DATETIME(6) NOT NULL
PRIMARY KEY (workspace_id, user_id)
INDEX (user_id, workspace_id)
```

Membership 是 association，Phase 0 不需要獨立 UUID。

`knowledge_sources`：

```diff
- org_code VARCHAR(128) NOT NULL
+ workspace_id UUID NOT NULL
```

並加入：

```text
FK knowledge_sources.workspace_id → workspaces.id
```

原本 Source `source_type / ownership / status / sync_version / lifecycle provenance` 全部保留。

Schema tests 新增：

```text
✓ Source without valid Workspace rejected
✓ duplicate (workspace,user) membership rejected
✓ same user may belong to multiple Workspaces
✓ cross-org users may share one Workspace
```

原本所有 current revision、Tree、SourceEntry、lifecycle、UUID constraints tests 繼續執行。

### T04 — Domain Models / Ports

新增：

```text
src/modules/workspaces/domain/workspace.ts
src/modules/workspaces/domain/workspace-membership.ts
src/modules/workspaces/ports/workspace-repository.ts
src/modules/workspaces/ports/workspace-membership-repository.ts
src/modules/workspaces/ports/workspace-access-policy.ts
src/modules/workspaces/application/workspace-query-service.ts
```

Foundation policy：

```ts
interface WorkspaceAccessPolicy {
  requireMembership(
    caller: CallerContext,
    workspaceId: string
  ): Promise<void>;
}
```

此 interface 只代表 Phase 0 foundation。Phase 3 可替換為 capability-aware policy，不需要改所有 public Knowledge service 的 caller signature。

Source policy / view 至少提供：

```text
source.id
source.workspace_id
source.ownership
source.status
```

禁止新增：

```text
caller.identity.org_code == source.org_code
```

之類 authorization shortcut。

### T05 — Repositories / Transactions

新增 Workspace / Membership repositories。

Resource-specific application flow：

```text
resource ID
→ resolve Source
→ resolve Source.workspace_id
→ WorkspaceAccessPolicy
→ existing ownership / lifecycle / transaction rules
```

`getDocument` 不要求 client 同時傳一個 workspaceId 來證明 scope；Document → Source → Workspace 關係才是 authoritative source。

Membership lookup 不取代 canonical mutation transaction。既有 READ COMMITTED、Source/Document `FOR UPDATE`、same-connection UoW 全部保留。

### T06 — Local Identity / Fixtures

`UserIdentity` 不變：

```text
{id, emp_id, name, org_code}
```

Development seed：

```text
Local User
Workspace: Local Knowledge
Membership: Local User → Local Knowledge
HUB_MANAGED Source in Local Knowledge
Folder
```

Integration fixture 至少：

```text
User A: org HRSD
User B: org RD
User C: org IT

Workspace X
Workspace Y

Memberships:
A → X
B → X
B → Y
C → none

Sources:
X → Hub Source X
X → Folder Source X
Y → Hub Source Y
```

驗證：

```text
A can access X
B can access X although B.org_code != A.org_code
B can access X and Y
C cannot access X/Y even when C knows resource UUIDs
```

另測更新 `User.org_code` 不自動改 WorkspaceMembership。

### T07 — Knowledge Application Operations

所有 public operations 維持：

```text
caller: CallerContext
```

作第一參數。

Create Hub-managed Document：

```text
sourceId
→ load Source
→ require Workspace membership
→ validate HUB_MANAGED
→ existing atomic Document / Revision / Tree create
```

Read Document：

```text
getDocument(caller, documentId)
→ Document.source_id
→ Source.workspace_id
→ require Workspace policy
→ archived filtering
→ return
```

Tree：

```text
listTree(caller, sourceId)
→ Source.workspace_id
→ require Workspace policy
→ existing Tree query
```

Source-owned mutation 也必須先通過 Workspace policy；不能只因為走 internal SourceProjection service 就跳過 caller scope。

### T08 — Sync Safety Foundation

既有 source-version、mapping、rollback、concurrency tests 全部保留。

增加：

```text
Source → workspace_id → Workspace policy
```

Foundation fixture 必須證明 unauthorized caller 無法進入 source projection flow。

Phase 2 在 Phase 3 前仍是 local/mock MVP；這裡不要提前發明 production role model。

### T09 — Minimal Web Flow

原：

```text
org → Source → Tree
```

改：

```text
Workspace selector
→ Source selector
→ Folder / Document Tree
→ Document viewer
```

Workspace selector：

- 來源為 `listWorkspaces(caller)`。
- 只顯示 caller 可見 Workspace。
- 切換 Workspace 後重新查詢該 Workspace Sources。
- 不作 security evidence；server/application 每次 resource operation 仍重新驗證。

Phase 0 / 1 Web 不提供：

```text
Invite member
Edit role
Map SSO group
Manage team
```

這些留 Phase 3。

### T10 — Verification / Handoff

Phase 0 verification 新增：

```text
schema includes workspaces + workspace_memberships
KnowledgeSource requires workspace_id
cross-org member allowed
same-org/non-member denied
one user can list multiple Workspaces
org_code update does not rewrite membership
resource UUID cannot bypass Workspace policy
Workspace selector only lists caller-visible Workspaces
```

Phase 3 handoff：

```text
Workspace foundation
→ role / capability model
→ membership administration
→ Team / SSO Group mapping
→ optional Source-level policy
→ audit history
→ optional accountable org/team metadata
```

Agent/service principal mapping 不提前放進 Phase 3；Phase 7 再依實際 Agent identity 決定。

## 3. Phase 0 Acceptance Matrix Additions

在原 A01–A23 後追加：

| ID | Scenario | Expected |
| --- | --- | --- |
| A24 | 建立 Source 未提供有效 `workspace_id` | FK/application 拒絕 |
| A25 | User A 沒有 Workspace X membership，但 org 與 X 其他成員相同 | read/write 拒絕 |
| A26 | User B org 不同但有 Workspace X membership | foundation access 通過 |
| A27 | User B 同時是 Workspace X / Y member | `listWorkspaces` 回傳 X/Y |
| A28 | User C 知道 X 的 Source/Document UUID 但不是 member | application 拒絕且不洩漏內容 |
| A29 | User `org_code` 改變 | User ID / WorkspaceMembership 不自動改變 |
| A30 | 重複建立同 `(workspace,user)` membership | DB constraint 拒絕 |
| A31 | UI 傳入未授權 Workspace/Source ID | server/application 重新驗證並拒絕 |

## 4. Phase 1 Plan Corrections

Phase 1 原 implementation plan 的 Revision、Tree、mapping、lifecycle、concurrency、mutation-authority 工作全部保留。

### 4.1 Global Constraints

新增：

- Phase 1 繼承 Phase 0 Workspace / Membership foundation。
- `KnowledgeSource.workspace_id` 是 Source scope truth。
- `User.org_code` 不作 Source access predicate。
- Query / command 先通過 Workspace policy，再套 ownership/lifecycle invariants。

原文「Phase 0 eight-table schema」讀為：

```text
八張原 Knowledge/Source core tables
+
workspaces
+
workspace_memberships
```

### 4.2 Query Interfaces

新增：

```ts
interface WorkspaceQueryService {
  listWorkspaces(
    caller: CallerContext
  ): Promise<WorkspaceView[]>;
}
```

調整：

```ts
interface KnowledgeQueryService {
  listSources(
    caller: CallerContext,
    workspaceId: string,
    input?: { includeArchived?: boolean }
  ): Promise<SourceView[]>;

  getSource(caller: CallerContext, sourceId: string, ...): Promise<SourceView>;
  listTree(caller: CallerContext, sourceId: string, ...): Promise<KnowledgeTreeItem[]>;
  getDocument(caller: CallerContext, documentId: string, ...): Promise<DocumentView>;
}
```

`getSource / listTree / getDocument` 必須從 resource relationship 解析 Workspace；caller 不需要也不能用額外 workspaceId 作 authorization proof。

### 4.3 Browser

Phase 1 browser：

```text
Workspace selector
→ Source selector
→ Tree
→ Document / Revision
```

E2E 增加：

```text
✓ switch between two authorized Workspaces
✓ cross-org member can browse shared Workspace
✓ non-member Workspace absent from selector
✓ direct URL to unauthorized Document rejected without content leak
```

Phase 1 仍不實作 membership editor / roles。

## 5. Phase 2 Planning Input

首次 Folder Import：

```text
workspaceId
folder snapshot
proposed Source name
```

完整 flow：

```text
Select Workspace
→ Select Folder
→ Scan / Parse
→ Preview
→ Confirm
→ Create Source(workspace_id) + Apply
```

Existing Source Update：

```text
sourceId
folder snapshot
```

不提供：

```text
sourceId + targetWorkspaceId override
```

Sync 不是 Source transfer。

Phase 2 UI 不提供 arbitrary `Knowledge location` 把一個 Source 掛進另一 Source Tree。

## 6. Phase 3 Planning Input

Phase 3 以 WorkspaceMembership foundation 為起點，設計 production governance。

重新評估：

```text
Workspace roles / capabilities
membership administration
Company Team mapping
SSO Group mapping
optional Source-level overrides
optional Document-level ACL only if proven necessary
audit events
accountable owner / governing organization metadata if required
```

Document-level ACL 與 single governing org 都不是 foundation mandatory requirement。

## 7. Phase 4–9 Implementation Constraints

- **Phase 4 Search:** Query candidate set 必須限於 caller-authorized Workspace；不可先洩漏 unauthorized snippet 再於 UI 隱藏。
- **Phase 5 Authoring:** 先 Workspace capability，再驗證 HUB_MANAGED ownership。
- **Phase 6 Publishing:** 每個引用的 Knowledge 都驗證其 Workspace access；PublishingTree 本身是否單 Workspace 或可跨 Workspace 聚合由 Phase 6 design 決定。
- **Phase 7 MCP:** reuse Workspace policy abstraction；Agent delegation vs Principal membership 本階段才決定。
- **Phase 8 Retrieval:** derived index 可帶 `workspace_id` filter metadata，但 canonical policy 仍是 authorization truth。
- **Phase 9 Memory:** memory scope 獨立設計，不直接等同 Knowledge Workspace scope。

## 8. Verification Checklist

文件 review：

- [ ] README / roadmap 使用 `Workspace → Source → Tree` 作主模型。
- [ ] `User.org_code` 保留，但沒有被定義成 Knowledge ACL。
- [ ] `knowledge_sources.workspace_id` 是 Source scope truth。
- [ ] Phase 0 增加 `workspaces` / `workspace_memberships`。
- [ ] Workspace foundation 不強制 `owner_org_code`。
- [ ] Browser 為 Workspace → Source → Tree。
- [ ] Folder Import 選 Workspace，但 existing Source sync 不可改 Workspace。
- [ ] Phase 3 沒被提前做成完整 ACL platform。
- [ ] Phase 6 Publishing scope 沒有被 foundation 提前鎖死。
- [ ] Phase 7 Agent Principal 沒有被 Phase 0/3 提前設計。

實作 review：

- [ ] 沒有 code 使用 `caller.identity.org_code === source.org_code` 作 authorization。
- [ ] cross-org member allow 有 integration test。
- [ ] same-org non-member deny 有 integration test。
- [ ] direct resource lookup 會反查 Workspace 做 policy check。
- [ ] UI selection 不是 authorization evidence。
- [ ] 原 Revision / Tree / Sync concurrency tests 仍全部執行。

這份 amendment 與原 Phase 0 / Phase 1 plans 一起閱讀；tenancy/access scope 衝突時，以 Architecture Amendment 與本 implementation amendment 為準。