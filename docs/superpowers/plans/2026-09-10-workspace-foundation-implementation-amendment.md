# Knowledge Hub — Workspace Foundation Implementation Amendment

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-10 |
| 依據 | [Workspace Access Boundary Architecture Amendment](../specs/2026-09-10-workspace-access-boundary-amendment.md) |
| 目的 | 修正 Phase 0 / Phase 1 implementation plans 中以 org_code 作 Knowledge access boundary 的假設 |
| 範圍 | 文件／計畫修正；不代表程式已實作 |

## 1. 執行原則

原 Phase 0 / Phase 1 implementation plans 的大部分工作維持有效。本 amendment 只修改 tenancy / access scope、schema、fixture 與 browser/query flow。

保留：

- application-generated UUIDv7 + MariaDB native UUID。
- READ COMMITTED canonical transactions。
- Source/Document row locks。
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
Workspace membership guard
Workspace selector
```

## 2. Phase 0 Task Corrections

### T01 — Application Skeleton

保留原內容，但 module restriction / project map 改為四個 business modules：

```text
src/modules/
├── identity/
├── workspaces/
├── knowledge/
└── sources/
```

加入 lint/import direction：

- identity 不依賴 business modules。
- workspaces 不依賴 Knowledge ingestion implementation。
- knowledge 只透過 access/policy port 使用 Workspace decision，不 import Web/SSO implementation。
- sources 可引用 Workspace scope contract 與 Knowledge application operations。

### T02 — MariaDB / Migration Runner

原計畫不變。

### T03 — Core Schema

原本八張 Knowledge/Source tables 全部保留，新增：

```text
workspaces
workspace_memberships
```

Migration 順序改為：

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

`knowledge_sources`：

```diff
- org_code VARCHAR(128) NOT NULL
+ workspace_id UUID NOT NULL
```

必要 FK：

```text
knowledge_sources.workspace_id
  → workspaces.id
```

`workspaces` 最小 schema：

```text
id UUID PK
name VARCHAR(512) NOT NULL
slug VARCHAR(255) NOT NULL UNIQUE
owner_org_code VARCHAR(128) NOT NULL
created_by UUID NOT NULL FK users.id
created_at DATETIME(6) NOT NULL
updated_at DATETIME(6) NOT NULL
```

`workspace_memberships` 最小 schema：

```text
id UUID PK
workspace_id UUID NOT NULL FK workspaces.id
user_id UUID NOT NULL FK users.id
created_by UUID NOT NULL FK users.id
created_at DATETIME(6) NOT NULL
UNIQUE(workspace_id, user_id)
```

Phase 0 不新增 role enum。完整角色／Team／SSO group mapping 留 Phase 3。

Schema integration tests 新增：

```text
✓ Source without Workspace rejected
✓ duplicate Workspace slug rejected
✓ duplicate (workspace,user) membership rejected
✓ cross-org user membership allowed
✓ Workspace owner_org_code does not restrict membership FK
```

原本「兩個 org／source fixtures」改為 cross-org Workspace fixtures。

### T04 — Domain Models / Ports

新增：

```text
src/modules/workspaces/domain/workspace.ts
src/modules/workspaces/domain/workspace-membership.ts
src/modules/workspaces/ports/workspace-repository.ts
src/modules/workspaces/ports/workspace-membership-repository.ts
src/modules/workspaces/application/workspace-query-service.ts
src/modules/workspaces/ports/workspace-access-policy.ts
```

最小 access contract：

```ts
interface WorkspaceAccessPolicy {
  requireMembership(caller: CallerContext, workspaceId: string): Promise<void>;
}
```

Phase 0 不在此 interface 定義 VIEWER / EDITOR / ADMIN 等完整 role semantics。

Source policy port 改為可取得：

```text
source.id
source.workspace_id
source.ownership
source.status
```

不再使用 `source.org_code` 作 access decision。

### T05 — Repositories / Transactions

新增 Workspace repositories，並讓 Source lookup 可以在同一 operation 中取得 `workspace_id`。

Public Knowledge / Sources application service 在進行 resource-specific operation 前：

```text
resource
→ Source
→ Workspace
→ requireMembership(caller, workspaceId)
```

Membership read 本身可以是 ordinary read；canonical mutation 仍沿用原 READ COMMITTED UoW / row locks。Membership policy 不是 UI-only guard。

### T06 — Local Identity / Fixtures

`UserIdentity` 維持：

```text
{id, emp_id, name, org_code}
```

Development seed 改為至少建立：

```text
Local User
Workspace: Local Knowledge
Membership: Local User → Local Knowledge
HUB_MANAGED Source in Local Knowledge
Folder
```

Integration fixture：

```text
User A: org HRSD
User B: org RD
User C: org IT

Workspace X: owner_org_code = HRSD
Workspace Y: owner_org_code = RD

Memberships:
A → X
B → X
B → Y

Sources:
X → Hub Source X
X → Folder Source X
Y → Hub Source Y
```

必須驗證：

```text
A can access X
B can access X despite different org
B can access Y
C cannot access X/Y despite knowing IDs
```

### T07 — Knowledge Application Operations

所有 public operations 維持 `caller` 顯式第一參數。

Create Hub-managed Document：

```text
sourceId
→ load Source
→ require Workspace membership
→ validate HUB_MANAGED
→ existing create/revision/tree transaction
```

Read：

```text
getDocument(caller, documentId)
→ Document.source_id
→ Source.workspace_id
→ require membership
→ return document
```

Tree：

```text
listTree(caller, sourceId)
→ Source.workspace_id
→ require membership
→ existing archived filtering / tree query
```

禁止 client 透過額外傳入 `org_code`、`workspace_member=true` 或 `workspaceId` 自行宣告授權。

### T08 — Sync Safety

原 transaction/version/mapping 測試維持。

增加前置：

```text
Source → workspace_id → membership authorization
```

Phase 2 source projection caller 必須有 target Source Workspace 的允許能力；Phase 0 fixture 先以 membership guard 驗證 foundation，完整 authoring/sync capability 由 Phase 3 policy 再細化。

### T09 — Minimal Web Flow

原本：

```text
org → Source → Tree
```

改為：

```text
Workspace selector
→ Source selector
→ Folder / Document Tree
→ Document viewer
```

Phase 0 / 1 Web 不提供：

- Workspace invitation。
- Role editor。
- Team mapping。
- SSO group management。

Workspace selector 只顯示 `listWorkspaces(caller)` 可見的 Workspace。

Create form 的 source options 必須限於目前 Workspace；server action 仍重新做 application access check，不能因 option 已經 filter 就省略 authorization。

### T10 — Verification / Handoff

Phase 0 verification 新增 Workspace foundation 證據：

```text
schema includes workspaces + workspace_memberships
Source belongs to Workspace
cross-org member allowed
non-member denied
Workspace selector only lists caller Workspaces
org change does not imply membership change
resource ID cannot bypass membership guard
```

Phase 3 handoff 改成：

```text
Workspace membership foundation
→ roles / capabilities
→ Team / SSO group mapping
→ membership administration
→ optional source/document ACL
→ append-only audit
```

## 3. Revised Phase 0 Acceptance Matrix Additions

在原 A01–A23 後追加：

| ID | Scenario | Expected |
| --- | --- | --- |
| A24 | 建立 Source 未提供有效 workspace_id | FK/application 拒絕 |
| A25 | User A 與 Workspace X owner_org 相同但沒有 membership | read/write 拒絕 |
| A26 | User B org 不同但有 Workspace X membership | 可通過 Phase 0 membership guard |
| A27 | User B 同時是 Workspace X/Y member | `listWorkspaces` 同時回傳 X/Y |
| A28 | User C 知道 X 的 source/document UUID 但不是 member | application service 拒絕且不洩漏內容 |
| A29 | User org_code 改變 | User ID / WorkspaceMembership 不自動改變 |
| A30 | Workspace.owner_org_code 改變 | memberships 不自動改變 |
| A31 | UI 傳入未授權 workspace/source ID | server/application 重新驗證並拒絕 |

## 4. Phase 1 Plan Corrections

Phase 1 原計畫絕大多數不變。

### Global Constraints

新增：

- Phase 1 繼承 Phase 0 Workspace / Membership foundation。
- `KnowledgeSource.workspace_id` 是 Source scope truth。
- `User.org_code` 不作 Source access predicate。
- Query / command 先通過 Workspace membership/policy，再套 ownership/lifecycle invariants。

原本「Phase 0 eight-table schema」文字應理解為八張 Knowledge/Source core tables；Phase 0 同時已有兩張 Workspace foundation tables。

### Shared Interfaces

Knowledge query 建議調整為：

```ts
interface WorkspaceQueryService {
  listWorkspaces(caller: CallerContext): Promise<WorkspaceView[]>;
}

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

`getSource/listTree/getDocument` 不需要 caller 再傳 workspaceId 來證明 access；resource relationship 是 authoritative scope。

### Browser

Phase 1 browser 改為：

```text
Workspace selector
  → Source selector
  → Tree
  → Document / Revision
```

新增 E2E：

```text
✓ switch between two authorized Workspaces
✓ cross-org membership visible
✓ non-member Workspace absent
✓ direct URL to unauthorized document rejected
```

## 5. Phase 2 Plan Input

未來 Phase 2 design / plan 必須使用：

首次 Import：

```text
workspaceId
folder snapshot
proposed source name
```

Existing Source Update：

```text
sourceId
folder snapshot
```

不提供：

```text
existing source + target workspaceId override
```

因為既有 Source 的 Workspace 由 DB 關係決定；同步不是 Source transfer。

## 6. Phase 3 Planning Input

Phase 3 必須以現有 membership foundation 為起點，不重新改回 org-based ACL。

至少重新評估：

```text
Workspace roles
Source-level overrides
Document-level overrides
Company Team mapping
SSO group mapping
Membership lifecycle
Publisher capability
Agent/service principal mapping
Audit events
```

不要求每一項都進 Phase 3 MVP；Phase 3 design 應依實際治理需求 YAGNI。

## 7. Verification Checklist for This Amendment

文件／實作 review 必須確認：

- [ ] 沒有新的 code 使用 `caller.identity.org_code === source.org_code` 作授權。
- [ ] `knowledge_sources` 的 scope truth 是 `workspace_id`。
- [ ] `User.org_code` 仍存在並由 identity provider 提供。
- [ ] cross-org Workspace membership 有 integration test。
- [ ] same-org non-member deny 有 integration test。
- [ ] direct resource lookup 會反查 Workspace 做 policy check。
- [ ] Browser 有 Workspace selector，Source 仍是 Tree root。
- [ ] Folder Import 不提供任意 Knowledge location。
- [ ] Phase 3 沒被提前做成完整 ACL 平台。

這份 amendment 與原 Phase 0 / Phase 1 plans 一起閱讀；若 tenancy/access scope 有衝突，以 Architecture Amendment 與本 implementation amendment 為準。