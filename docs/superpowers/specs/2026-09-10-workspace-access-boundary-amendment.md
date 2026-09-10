# Knowledge Hub — Workspace Access Boundary Architecture Amendment

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-10 |
| 文件類型 | Architecture Amendment；修正 Phase 0–1 已核准文件的 tenancy / access boundary |
| 決策狀態 | Approved architecture correction |
| 影響範圍 | Phase 0 foundation、Phase 1 read/tree、Phase 2 source import、Phase 3 governance、Phase 4+ discovery/publishing/agent scope |
| 不變範圍 | Source ownership mode、Tree、Document stable ID、Revision、SourceEntry、archive/restore、sync safety、READ COMMITTED、UUIDv7/native UUID |

## 1. Problem Statement

原 Phase 0–1 文件把 Knowledge 上層關係表示為：

```text
org_code
  └── KnowledgeSource
       └── Tree / Document
```

這可以表示「來源由哪個組織負責」，但不能正確表示企業內實際的 Knowledge collaboration：

- 同一個專案／團隊 Workspace 可能需要讓不同 `org_code` 的人共同存取。
- 同 org 不代表所有人都應自動看到同一份 Knowledge。
- 使用者的組織異動不應自動改寫 Knowledge access。
- Search、Publishing、MCP 若直接沿用 `org_code` scope，之後會需要大量跨組織例外規則。

因此本 amendment 將 **Organization identity** 與 **Knowledge collaboration/access scope** 正式拆開。

## 2. Normative Decision

新的核心模型為：

```text
User
├── emp_id
├── name
└── org_code                     ← identity / organization attribute

User
  │
  └── WorkspaceMembership
          │
          ▼
      Workspace                  ← knowledge container + basic access boundary
          │
          └── KnowledgeSource    ← Source remains its own Tree root
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

核心規則：

```text
Organization != Workspace
same org != automatically authorized
cross org != automatically denied
```

### 2.1 Responsibility Split

| Concept | 責任 | 不負責 |
| --- | --- | --- |
| `User.org_code` | SSO／HR identity attribute、顯示組織資訊、未來治理輸入 | 不直接決定可讀／可寫哪些 Knowledge |
| `Workspace` | Knowledge container、Source parent、基本 access scope | 不取代 Organization、Source 或 Tree |
| `WorkspaceMembership` | 表示 User 是否屬於某 Workspace | Phase 0 不承諾完整 role / ACL taxonomy |
| `KnowledgeSource.workspace_id` | Source 的 authoritative Workspace scope | 不等於 Source content ownership mode |
| `KnowledgeSource.ownership` | `SOURCE_MANAGED / HUB_MANAGED` 更新權來源 | 不決定 caller 是否有 Workspace access |

`org_code` 必須保留在 User identity，但不再出現在 KnowledgeSource 上作授權 ownership。

## 3. Workspace Does Not Need a Single Owning Organization

Phase 0 **不要求** Workspace 綁定單一 `owner_org_code`。

原因：Workspace 本來就是為跨組織 collaboration 引入；若 foundation 又要求每個 Workspace 有唯一 owner org，雖然不一定直接造成 ACL 問題，仍會把不必要的 Organization coupling 帶回核心 schema。

Phase 3 若實際治理需要 accountable organization，可再設計例如：

```text
governing_org_code
responsible_team_id
workspace owner role
group ownership
```

其中任何 governance metadata 都不得自動等同 membership / authorization。

## 4. Phase 0 Schema Correction

原本八張 Knowledge / Source core tables 保留，新增兩張 Workspace foundation tables；Phase 0 canonical domain schema 因此共有十張表：

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

### 4.1 `users`

維持：

```text
id UUID PK
emp_id UNIQUE
name
org_code
```

`org_code` 仍是 required identity attribute。Company SSO adapter 未來仍映射至相同 `UserIdentity` contract。

### 4.2 `workspaces`

Phase 0 最小欄位：

```text
id UUID PK
name
created_at
updated_at
```

規則：

- `id` 使用 application-generated UUIDv7 + MariaDB native `UUID`。
- `name` 不作 authorization token，也不作 stable identity。
- Phase 0 不提前加入 owner org、slug、quota、billing、enterprise hierarchy 或完整 Workspace lifecycle。
- Human-readable slug / Workspace archive 若產品流程真的需要，再由對應 Phase 設計，不把它們塞進 foundation。

### 4.3 `workspace_memberships`

Phase 0 最小欄位：

```text
workspace_id UUID FK → workspaces.id
user_id UUID FK → users.id
created_at
PRIMARY KEY (workspace_id, user_id)
INDEX (user_id, workspace_id)
```

`WorkspaceMembership` 在 Phase 0 是 association，不需要額外 stable entity ID。

Phase 0 membership 只回答：

> caller 是否位於這個 Workspace 的基本可見／可操作 scope？

完整 VIEWER / EDITOR / PUBLISHER / ADMIN、Team mapping、SSO Group mapping、membership administration 與 granular ACL 在 Phase 3 設計。

Phase 0–2 的 local/mock MVP 可以使用 membership 作 foundation guard；這不代表 production-grade mutation authorization 已完成。公司正式 rollout 前仍需 Phase 3 governance。

### 4.4 `knowledge_sources`

原：

```text
knowledge_sources.org_code
```

改為：

```text
knowledge_sources.workspace_id UUID NOT NULL
  FK → workspaces.id
```

其餘 Source contract 維持：

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

每個 Source 必須且只屬於一個 Workspace。

## 5. Access Boundary

Phase 0 建立最小安全路徑：

```text
CallerContext
   │
   ▼
resource → Source → Workspace
   │
   ▼
WorkspaceAccessPolicy
   │
   ▼
WorkspaceMembership
   │
   ▼
Source ownership / lifecycle rules
   │
   ▼
Knowledge operation
```

### 5.1 Foundation Policy

在 Phase 3 完整 governance 前：

- caller 必須具有對應 WorkspaceMembership，才能進入該 Workspace 的 foundation flow。
- caller 的 `org_code` 不作 allow / deny shortcut。
- 知道 `workspace_id`、`source_id`、`tree_node_id` 或 `document_id` 不代表取得 access。
- `listTree(caller, sourceId)` / `getDocument(caller, documentId)` 必須由 resource relationship 反查 Workspace，再做 policy check。
- UI selector / hidden button 不是 security boundary；application service 必須重新驗證。
- `SOURCE_MANAGED / HUB_MANAGED` mutation authority 規則在 Workspace access 之後繼續套用。

### 5.2 CallerContext Remains User-Centric

`UserIdentity` 與 `CallerContext` 維持：

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

不把單一 `workspace_id` 固定塞入 CallerContext，因為同一個 caller 可以同時存取多個 Workspace。

Workspace 是 **resource scope**，不是登入後唯一 tenant。

## 6. Module Boundary Correction

Phase 0 business modules 由三個調整為四個：

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
  ├── Which Workspaces can this caller access?
  └── Does this caller belong to this Workspace?

Sources
  ├── Which Workspace contains this Source?
  └── Source / SourceEntry / Sync state

Knowledge
  └── Document / Revision / Tree / lifecycle
```

建議 policy port：

```ts
interface WorkspaceAccessPolicy {
  requireMembership(
    caller: CallerContext,
    workspaceId: string
  ): Promise<void>;
}
```

Phase 3 可以替換／擴充 policy implementation 與 capability model，而不必重做所有 public Knowledge service signatures。

## 7. Workspace / Source / Tree Invariants

```text
Workspace
├── Source A
│   └── Tree A
└── Source B
    └── Tree B
```

必須成立：

1. 一個 Workspace 可以有多個 Source。
2. 一個 Source 必須且只屬於一個 Workspace。
3. Source 本身仍是該 Source 的 Tree root；Workspace 不是 synthetic Tree folder。
4. Document 透過 `Document → Source → Workspace` 推導 scope，不重複保存 `workspace_id`。
5. Tree move 仍只允許同 Source；不能用 Tree move 偷做 Source transfer。
6. Existing Source 不可在普通 sync / rename / move flow 中改變 Workspace。
7. 若未來真的需要 Source transfer，必須是 explicit migration/transfer operation，另行設計 authorization、reference 與 audit semantics。

## 8. Phase 1 Read / UI Correction

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
Query Master ▼                 ← Workspace

Source: Obsidian Wiki ▼        ← KnowledgeSource

Architecture
├── Overview
└── Database
```

Workspace selector 只顯示 `listWorkspaces(caller)` 的結果。

Phase 1 仍不提供：

- Workspace invitation / membership editor。
- Role management。
- Team / SSO Group mapping。
- Full sharing UI。

這些屬於 Phase 3 governance。

## 9. Phase 2 Import / Sync Correction

首次 Folder Import：

```text
select Workspace
  → select folder
  → propose Source name
  → scan / snapshot
  → Preview
  → Confirm
  → create Source in selected Workspace + Apply
```

規則：

- 新 Source 必須明確指定 `workspace_id`。
- folder name 仍只作 Source name 的可修改預設值。
- Source 仍是 Tree root，因此不存在把新 Source 掛到另一個 Source 任意 folder 的 `Knowledge location`。
- 更新既有 Source 時只指定 `source_id`；Workspace 由既有 Source relationship 決定。
- Sync 不提供 `target_workspace_id` override，也不偷偷 transfer Source。
- caller 必須先通過 target Workspace 的 foundation policy。

Phase 2 在 Phase 3 governance 前仍屬 local/mock MVP；正式 company mutation permission 由 Phase 3 補齊。

## 10. Phase 3 Governance Responsibility

Phase 3 不再建立 org owner boundary，而是在 Workspace foundation 上完成 production governance。

需重新設計／評估：

```text
Workspace roles / capabilities
membership administration
Company Team mapping
SSO Group → Workspace mapping
optional Source-level policy
audit events / lifecycle
accountable owner / governing organization metadata (if needed)
```

Document-level ACL **不預設一定需要**；只有當 Workspace / Source policy 無法滿足實際需求時才加入，避免把 Knowledge Hub 做成複雜 Google Drive ACL clone。

Phase 3 的 hard rule：

```text
same org != automatically authorized
cross org != automatically denied
```

Agent/service principal membership 不在 Phase 3 提前定案；Phase 7 依真實 Agent identity 模型決定 delegation 或 generalized principal。

## 11. Phase 4–9 Effects

### Phase 4 — Discovery & Read API

Discovery 可以跨多個 caller-authorized Workspaces 搜尋，也可以套單一 Workspace filter。

Retrieval path：

```text
Caller
  → authorized Workspace set
  → query / candidate retrieval
  → policy-safe result filtering
```

Derived index 若需要效率可保存 `workspace_id` metadata，但 authorization truth 仍在 canonical Workspace policy/data。不得回傳 unauthorized title / snippet 後才在 UI 隱藏。

### Phase 5 — Human Authoring

Human authoring 必須先通過 Workspace capability/policy，再套 HUB_MANAGED rules。Source ownership 與 user authorization 是兩個獨立判斷。

### Phase 6 — tKMS Publishing

本 amendment **不決定 PublishingTree 必須只屬於一個 Workspace**。

Phase 6 必須保證：

- PublishingTree 與 Knowledge Tree 分離。
- 所有被引用的 Knowledge 都必須通過 caller / publisher 的 Workspace policy。
- Phase 6 design 再決定 Publishing scope 是單 Workspace、獨立 Publishing Space，或允許聚合多個可存取 Workspace。
- 不因發布需求複製 canonical Knowledge。

這避免現在過早封死未來 HR／Publisher 跨 Workspace 編排的可能性。

### Phase 7 — Agent & MCP

Agent 經可信 identity/principal 進入同一 Workspace policy abstraction：

```text
Agent caller
  → application/query service
  → Workspace policy
  → Knowledge
```

Phase 7 再決定：

- Agent delegate human identity；或
- 將 membership generalized 成 Principal。

Phase 0 不提前建立 `actor_kind` / service-principal schema。

MCP 不接受任意 `org_code` 或 `workspace_id` 作為授權證明。

### Phase 8 — Semantic & Hybrid Retrieval

Derived index 必須支援 Workspace scope filtering；最終 authorization 不由 vector/index record 單獨決定。

### Phase 9 — Agent Memory

Agent Memory 的 scope 另行設計。Knowledge 使用 Workspace 不代表所有 memory 都應自動成為 workspace-global。

## 12. Added / Replaced Invariants

本 amendment 新增或替換：

1. `User.org_code` 是 identity attribute，不是 Knowledge authorization boundary。
2. 每個 KnowledgeSource 恰屬一個 Workspace。
3. `knowledge_sources` 不以 `org_code` 保存 authorization ownership。
4. `(workspace_id, user_id)` 唯一表示 WorkspaceMembership。
5. 跨 org membership 合法。
6. 同 org 不自動形成 membership。
7. Workspace Phase 0 不強制單一 governing/owner org。
8. Document Workspace scope 由 `Document → Source → Workspace` 推導。
9. Resource ID / UI Workspace selection 不能繞過 application policy。
10. 一般 Tree operation 不跨 Source；一般 Source/sync operation 不跨 Workspace。
11. 完整 role / Team / group / granular policy 留 Phase 3。
12. Publishing scope shape 留 Phase 6，不由 Workspace foundation 提前封死。
13. Agent principal / delegated identity 留 Phase 7，不提前污染 Phase 0 User model。

以下既有 foundation invariants **完全保留**：

- Stable Document UUIDv7 identity。
- MariaDB native UUID storage。
- Immutable Revision。
- Revision current pointer rules。
- one-document-one-TreeNode。
- SourceEntry stable mapping。
- SOURCE_MANAGED / HUB_MANAGED。
- ACTIVE / ARCHIVED、no hard delete。
- READ COMMITTED + explicit row locks。
- Preview → Confirm → Apply。
- sync_version optimistic guard。
- metadata-only assets。

## 13. Acceptance Cases Added to Phase 0 / 1

```text
✓ cross-org user with WorkspaceMembership can access Workspace Source
✓ same-org user without WorkspaceMembership cannot access Workspace Source
✓ one user can belong to multiple Workspaces
✓ changing user.org_code does not implicitly alter WorkspaceMembership
✓ Source cannot exist without a valid Workspace
✓ direct source/document UUID does not bypass Workspace policy
✓ listWorkspaces only returns caller-authorized Workspaces
✓ Source cannot be silently transferred through Tree or Sync operation
✓ Workspace selector is navigation state, not authorization evidence
```

建議 foundation fixture：

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
```

驗證：

```text
A sees X
B sees X + Y despite different org from A
C cannot read X/Y even if C knows resource UUID
```

## 14. Supersession / Precedence

本 amendment 是 Phase 0–1 tenancy/access boundary 的 normative correction。

若下列文件與本 amendment 衝突，以本 amendment 為準；不衝突的內容繼續有效。

### Phase 0 Design Spec

`docs/superpowers/specs/2026-09-10-phase-0-foundation-architecture-design.md`

取代：

- `org_code → KnowledgeSource → Tree` hierarchy。
- 每 Source 單一 org owner invariant。
- `knowledge_sources.org_code` schema。
- 八張 Phase 0 domain tables 的總數描述（改為原八張 + Workspace 兩張）。
- 三 business modules（改為四個，新增 `workspaces`）。
- org → source smoke / DoD / governance handoff。
- ADR-004 的 org/source access-boundary 部分。

保留其他 Phase 0 transaction、identity contract、Knowledge/Sources、sync safety、lifecycle、UUID 等決策。

### Phase 0 Implementation Plan

`docs/superpowers/plans/2026-09-10-phase-0-foundation-implementation.md`

依 implementation amendment 校正 T03/T04/T05/T06/T07/T09/T10、fixtures 與 acceptance matrix；其他工作維持。

### Phase 1 Design Spec

`docs/superpowers/specs/2026-09-10-phase-1-knowledge-core-tree-design.md`

校正：

```diff
-org_code → KnowledgeSource → Tree
+Workspace → KnowledgeSource → Tree
```

以及 browser：

```diff
-Source selector → Tree
+Workspace selector → Source selector → Tree
```

Source as Tree Root、SourceEntry→TreeNode、Revision、lifecycle、concurrency、mutation authority 均不變。

### Phase 1 Implementation Plan

`docs/superpowers/plans/2026-09-10-phase-1-knowledge-core-tree-implementation.md`

「Phase 0 eight-table schema」改讀為「原八張 Knowledge/Source core tables + 兩張 Workspace foundation tables」；query/browser 繼承 Workspace policy。

## 15. ADR-018 — Workspace Is the Knowledge Access Boundary

- **Context:** `org_code` 能表示人的公司歸屬，但不能正確表示跨組織專案／團隊 Knowledge collaboration。
- **Decision:** 保留 `User.org_code` 作 identity attribute；新增 Workspace + WorkspaceMembership；KnowledgeSource 屬於 Workspace；基本 access 依 Workspace policy，而非 org equality。
- **Consequences:** Phase 0 增加 Workspace foundation；Phase 1 browser 正式有 Workspace selector；Phase 2 import 選 target Workspace；Phase 3 補 production governance；Search、Publishing、MCP 都必須尊重相同 Workspace authorization boundary。

ADR-018 取代原 ADR-004 的 `org_code → Source` access/ownership boundary。ADR-004 的 source-agnostic、每 Document 都有 Source 等不衝突原則仍有效。

## 16. Self-review

| 檢查 | 結果 |
| --- | --- |
| 是否刪掉 `org_code` | 否；仍保留在 UserIdentity |
| 是否讓 org 決定 Knowledge access | 否 |
| 是否允許跨 org collaboration | 是；透過 Workspace policy/membership |
| 是否要求 Workspace 單一 owner org | 否；治理 ownership 留 Phase 3 依需求設計 |
| 是否以 Workspace 取代 Source | 否；Source 仍是 Tree root |
| 是否重複保存 Document.workspace_id | 否；由 Source 推導 |
| 是否提前做完整 ACL | 否；Phase 0 只有 foundation membership guard |
| 是否改變 Tree / Revision / Sync 核心 | 否 |
| 是否讓 UI 成為 authorization truth | 否 |
| 是否把 Publishing 綁死單 Workspace | 否；Phase 6 再決定 publishing scope |
| 是否提前設計 Agent Principal | 否；Phase 7 再決定 |

這份 amendment 的目的不是重做 Knowledge Core，而是修正 Knowledge Core 上層的 **tenancy / collaboration / authorization boundary**。