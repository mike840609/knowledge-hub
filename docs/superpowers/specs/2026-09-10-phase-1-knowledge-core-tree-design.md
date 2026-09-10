# Knowledge Hub — Phase 1 Knowledge Core & Tree Design

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-10 |
| Phase | 1 |
| 名稱 | Knowledge Core & Tree |
| 狀態 | Approved Design；已整合 Phase 0 Workspace foundation |
| 前置 | Phase 0 Foundation & Architecture |
| 後續 | Phase 2 Knowledge Source Import & Sync |

## 1. Goal

Phase 1 的目標是讓 Knowledge Hub 擁有一套完整、可靠且不依賴 ingestion、Web UI 或 MCP 的 Knowledge Core，同時繼承 Phase 0 已建立的 Workspace access foundation。

完成後系統必須能保證：

```text
User
  └── WorkspaceMembership
          ↓
      Workspace
          └── KnowledgeSource
               └── Knowledge Tree
                    ├── Folder
                    └── Document
                         └── immutable Revisions
```

其中：

- `User.org_code` = 公司組織 identity attribute，不直接作 Knowledge ACL。
- Workspace = Knowledge container + basic access scope。
- WorkspaceMembership = Phase 0–2 local/mock access foundation。
- Source = source scope、content ownership 與來源邊界；每個 Source 只屬一個 Workspace。
- Tree = 文件目前位於哪裡。
- Document = 文件穩定 identity。
- Revision = 文件內容版本。
- SourceEntry = 外部來源 identity 與 Hub object 的 mapping。

Document ID 不因 rename、move、archive、restore、Workspace navigation state 或 revision 而改變。Document 不重複保存 `workspace_id`；其 scope 由 `Document → Source → Workspace` 推導。

Phase 1 繼承 Phase 0 已固定的 foundation contracts：Workspace/WorkspaceMembership、`knowledge_sources.workspace_id`、application-generated UUIDv7 + MariaDB native `UUID`、顯式 `CallerContext`、canonical mutation 的 `READ COMMITTED` transaction、lifecycle current provenance，以及 one-document-one-TreeNode uniqueness。Phase 1 不重新發明這些規則，只完成完整 Knowledge behavior。

## 2. Phase 1 Scope

### 2.1 In Scope

Phase 1 完成：

- KnowledgeSource core behavior，且 Source scope 為 Workspace。
- KnowledgeDocument lifecycle。
- Immutable KnowledgeRevision。
- Knowledge Tree。
- Folder / Document hierarchy。
- Stable Document identity。
- SourceEntry mapping contract。
- Archive / restore 與目前 lifecycle provenance。
- Move / reorder。
- Revision history。
- Current revision resolution。
- Archived filtering。
- SOURCE_MANAGED / HUB_MANAGED mutation guard。
- Workspace membership foundation 在 read/write application services 的一致套用。
- Transactional invariants。
- Concurrency protection。
- Caller-aware read/write application services。
- Read-only Knowledge Browser：Workspace → Source → Tree → Document/Revision。

### 2.2 Out of Scope

Phase 1 不做：

- Folder upload / scanning。
- Folder Sync。
- Preview / Confirm / Apply。
- Diff algorithm。
- Rename detection algorithm。
- SOURCE_MANAGED Title Resolution / Markdown parser。
- Workspace provisioning/create/rename/archive/restore 管理 UI。
- Workspace roles/capabilities、membership administration、Team/SSO Group mapping、granular ACL。
- Rich text editor。
- Web authoring。
- Keyword search。
- Embedding / vector search。
- Company SSO。
- tKMS publishing。
- MCP。
- Agent actor / Principal model。
- Agent Memory。

Workspace administration 與 production governance 屬 Phase 3；Phase 1 只 consume Phase 0 membership foundation。

## 3. Architecture Decision

### 3.1 Option A — CRUD Core

直接在 Phase 0 repositories 上補：

```text
createDocument()
updateDocument()
moveNode()
archiveDocument()
```

優點是簡單，但 Phase 2 很容易演變成：

```text
Sync Service
   ↓
直接修改 Knowledge tables
```

這會讓 Folder Sync 繞過 Knowledge invariants與 Workspace policy，因此不採用。

### 3.2 Option B — Domain Commands + Mutation Authority Separation

採用：

```text
                    Workspace Access Policy
                             │
                             ▼
                    Knowledge Core
                         │
        ┌────────────────┴────────────────┐
        │                                 │
HubKnowledgeCommands             SourceProjectionCommands
        │                                 │
HUB_MANAGED                      SOURCE_MANAGED
        │                                 │
Phase 5 Web Authoring             Phase 2 Folder Sync
```

兩邊共用：

```text
CallerContext
Workspace scope/policy
Document
Revision
Tree
Lifecycle
Repositories
READ COMMITTED Transactions
```

但 SOURCE_MANAGED 不提供 `force=true`、`bypassOwnership=true` 等 escape hatch。

### 3.3 Decision

採 Option B。

Phase 2 因此形成：

```text
Authorized Workspace
 ↓
Folder
 ↓
Scanner
 ↓
Snapshot
 ↓
Diff
 ↓
SourceProjectionCommands
 ↓
Knowledge Core
```

而不是另建一套 Knowledge mutation logic。

## 4. Core Domain Model

```text
Workspace
│
└── KnowledgeSource
    │
    ├── SourceEntry
    │
    └── KnowledgeTreeNode
         │
         ├── FOLDER
         │
         └── DOCUMENT
               │
               └── KnowledgeDocument
                    │
                    ├── Revision 1
                    ├── Revision 2
                    └── Revision N ← current_revision_id
```

Source 本身就是其 Tree root，不建立 synthetic root folder；Workspace 是 Source container，不是 TreeNode。

例如：

```text
Workspace: Query Master
└── Source: Obsidian Wiki
    ├── Architecture
    │   ├── Overview.md
    │   └── Database.md
    └── Runbooks
        └── Deployment.md
```

## 5. Schema Refinement

Phase 0 的十張 domain tables 繼續保留：原八張 Knowledge/Source tables加上 `workspaces` 與 `workspace_memberships`。所有 stable entity IDs 使用 MariaDB native `UUID`，`knowledge_sources.workspace_id` 是 Source authoritative Workspace scope，Document TreeNode uniqueness 與 lifecycle provenance 已是 foundation。Phase 1 不重做 foundation schema，只補 SourceEntry 對 TreeNode 的必要 stable mapping。

### 5.1 SourceEntry 增加 `tree_node_id`

Phase 0 的 `source_entries` 主要有：

```text
source_entries
├── source_id
├── external_id
├── source_path
├── document_id
└── ...
```

Phase 1 增加：

```text
tree_node_id nullable FK → knowledge_tree_nodes.id
```

欄位型別沿用 Phase 0 native `UUID` contract。

原因是 Folder 本身沒有 Document。

若只有：

```text
Folder SourceEntry
source_path = docs/backend
document_id = null
```

當 folder rename：

```text
docs/backend
→
docs/server
```

系統沒有穩定 reference 指向原 TreeNode。

增加 mapping 後：

```text
SourceEntry
   │
   └── tree_node_id
          ↓
     TreeNode #abc
```

path 改變但 TreeNode identity 不變。

### 5.2 SourceEntry invariants

FOLDER entry：

```text
entry_type = FOLDER
tree_node_id = required
document_id = null

tree_node.node_type = FOLDER
tree_node.source_id = source_entry.source_id
```

DOCUMENT entry：

```text
entry_type = DOCUMENT
tree_node_id = required
document_id = required

tree_node.node_type = DOCUMENT
tree_node.document_id = source_entry.document_id
```

Hub-native documents 可以沒有 SourceEntry。SourceEntry 是 source mapping，不是 Knowledge identity。

### 5.3 Phase 0 資料升級

升級分成固定 DDL、獨立資料回填、固定約束三段；001–003 與其 checksum 不變，不以清空資料作為一般升級路徑。

1. 停止 canonical writes、備份。獨立 `scripts/db/backfill-source-tree-mapping.ts` 先以 dry-run 盤點 ACTIVE／ARCHIVED entries。DOCUMENT 以 `(source_id, document_id)` 對應唯一既有 DOCUMENT node；FOLDER 由 operator 提供 JSON entry ID → existing Folder TreeNode ID 對照。驗證完整性、同 Source、型別、document 相等與 node 不重複；不猜 path/name/hash，不建立替代 node。錯配 preflight 不改資料或 schema。
2. 固定 migration `004-phase-1-tree-mapping.ts` 只新增 nullable `tree_node_id UUID`，不含環境資料。擴充 runner 的 target-version 選項，載入完整 manifest 驗證既有 ledger，但只執行到指定版本；不得截短 manifest，否則會誤判較新已套用版本為 unknown。target 低於已套用版本時清楚拒絕，不 rollback。
3. 同一獨立 script 以參數化 SQL 在一個 DML transaction 回填；輸入不進 migration manifest、statements 或 checksum。已正確回填的 row 為 NOOP；既有不一致 mapping 拒絕，不覆寫。執行與 dry-run 都重新驗證全體 mapping，失敗整次 DML rollback。
4. 固定 migration `005-phase-1-tree-mapping-constraints.ts` 收緊 `tree_node_id NOT NULL`，加 same-source FK、`UNIQUE(source_id, tree_node_id)`。DOCUMENT equality 由 `(document_id, tree_node_id)` FK → TreeNode `(document_id, id)` 保護，明確新增對應 `UNIQUE(document_id, id)` 作 referenced key；保留原 `UNIQUE(document_id)`，兩者用途不同。Folder 的 document_id=NULL 使此 FK 不檢查該組，因此 Folder entry 必須指向 FOLDER node 由 application assertion 驗證；preflight 同樣驗證所有既有 rows。entry type/document null shape 由既有 CHECK 保護。
5. Runner 在寫入 005 的 RUNNING ledger 前，執行固定的唯讀 mapping-readiness gate（非 operator 資料、非動態 statements）。不完整即退出，005 ledger 不新增，補完回填後可重跑。普通 migrate 不得自動跳過回填或直接將未就緒的 005 記 FAILED。空 DB 以同一份 004／005 manifest 執行，gate 自然通過。

預定命令（須在 Task 2 實作 CLI 支援後才能執行）：

```sh
npm run db:migrate -- --to 4
npx tsx scripts/db/backfill-source-tree-mapping.ts --mapping /path/to/verified-mapping.json --dry-run
npx tsx scripts/db/backfill-source-tree-mapping.ts --mapping /path/to/verified-mapping.json --apply
npm run db:migrate -- --to 5
```

步驟 1 在首次 DDL 前也可執行同一 dry-run；script 支援欄位尚不存在的盤點狀態。沒有 Folder entries 時提供空對照即可。backfill script 的資料交易不宣稱涵蓋 DDL；DDL 中斷沿用 FAILED/RUNNING 診斷與明確修復程序，不能盲目重跑或修改已套用 checksum。

驗收：populated 001–003 → 004 → backfill → 005、archived rows、Folder 對照、preflight 零修改、backfill rollback／重跑、005 gate 不污染 ledger、全量 migrate 重跑 checksum 相同、空 DB 與 populated DB 使用完全相同 manifest，以及 DDL 中斷診斷。所有 fixtures／seed／writers 提供 tree_node_id。

## 6. Tree Invariants

### 6.1 Document TreeNode

每個 KnowledgeDocument 在 Knowledge Tree 中只能有一個 node。

此 invariant 已提升為 Phase 0 foundation：`knowledge_tree_nodes.document_id` 對非 NULL 值建立 uniqueness protection。Phase 1 必須保留並驗證此 constraint，不應另建第二套 migration 或僅以 application validation 取代 DB protection。

Document move 是：

```text
UPDATE tree_node.parent_id
```

而不是刪除舊 node 再建立新 node，因此 Document TreeNode identity 也保持穩定。

### 6.2 Folder TreeNode

Folder：

```text
document_id = null
name = required
```

Folder 自己保存 name。

### 6.3 Document display name

DOCUMENT node 不保存第二份 title truth。

顯示時：

```text
TreeNode
 ↓
Document.current_revision_id
 ↓
KnowledgeRevision.title
```

因此：

```text
Folder rename
→ Tree change

Article title rename
→ Revision change
```

不會產生兩份 title 不一致。

`knowledge_tree_nodes.name` 的有效規則：

```text
FOLDER → required
DOCUMENT → null
```

SOURCE_MANAGED 文件的 canonical title 如何從 frontmatter、Markdown heading 或 filename 解析，仍屬 Phase 2 ingestion design。Phase 1 只保證 canonical title 一旦改變就建立新 Revision，filename/path rename 本身不建立 revision。

## 7. Tree Operations

Phase 1 提供 caller-aware operations：

```text
listTree(caller, sourceId)

createFolder(caller, ...)
moveTreeNode(caller, ...)
reorderTreeNode(caller, ...)

archiveFolder(caller, ...)
restoreFolder(caller, ...)

getAncestors(caller, ...)
```

所有 Tree operation 必須驗證：

- caller 來自可信 `CallerContext`。
- Source 存在並解析出 authoritative `workspace_id`。
- caller 通過該 Workspace 的 foundation access policy。
- parent 存在。
- parent 是 FOLDER。
- parent ACTIVE。
- parent 與 node 位於同 Source。
- node 不可移到自己下面。
- node 不可移到 descendant。
- Document 不可跨 Source move。
- Tree operation 不可改變 Source 的 Workspace。

因此以下操作禁止：

```text
Source A / Document X
    ↓ move
Source B
```

以及：

```text
Source A @ Workspace X
    ↓ ordinary move/sync
Workspace Y
```

若未來需要跨 Source 或跨 Workspace 搬移，必須設計明確 migration / transfer 流程，不能把一般 tree move 當 source transfer。

## 8. Tree Ordering

Phase 1 維持簡單：

```text
position INT
```

Sibling query：

```text
ORDER BY position, id
```

Phase 1 不引入 Fractional indexing、LexoRank 或 CRDT。Move / reorder transaction 內重算受影響 sibling positions。

## 9. Tree Concurrency

Tree mutation 採 Source-level serialization，且 canonical mutation UoW 繼承 Phase 0 的 **READ COMMITTED** isolation。

在 READ COMMITTED UoW 內解析 Source 後先取得 Source lock，再以同 connection 的 WorkspaceAccessPolicy 完成 access check，最後驗證 hierarchy 並寫入：

```sql
SELECT ...
FROM knowledge_sources
WHERE id = ?
FOR UPDATE;
```

同一 Source 的 Tree mutation 因此 serial execution。READ COMMITTED 避免後續 ancestry/plain read 依賴較早建立的 REPEATABLE READ consistent snapshot；`FOR UPDATE` row lock 仍不可省略。

這能避免：

```text
A: folder1 → folder2
B: folder2 → folder1
```

兩個 concurrent requests 分別驗證通過，最後形成 cycle。不同 Source 仍可平行操作。先 lock 後 membership check 沿用 Phase 0；代價是未授權 caller 也可能短暫持有 Source lock。檢查與失敗 rollback 必須立即完成，不在其中等待外部 I/O；Source lock 不等於 membership lock，也不宣稱解決未來 membership revocation concurrency。

## 10. Revision Model

Revision 保存：

```text
id
document_id
revision_no
title
markdown
metadata
content_hash
created_by
created_at
```

Revision 建立後 immutable。`created_by` 在 Phase 0–2 仍指向可信 User identity；Phase 1 不提前改成 `actor_kind + actor_id` polymorphic model。若未來 Agent 被允許寫入 canonical Knowledge，再由對應 phase 設計 Principal/Actor model。

不存在 `updateRevision()`；只有 `createRevision()`。

## 11. Revision Creation

流程：

```text
SET TRANSACTION ISOLATION LEVEL READ COMMITTED
BEGIN
resolve Document → Source → Workspace on this connection
lock Source
require transaction-scoped Workspace access
validate Source ownership/ACTIVE and Document ACTIVE
lock Document
validate expectedCurrentRevisionId
read current revision
normalize candidate content
compare canonical payloads using §13.1 compatibility rule

if unchanged:
    return current revision

insert Revision N+1
update Document.current_revision_id

COMMIT
```

兩個 concurrent writers 不會建立相同 `revision_no`。DB 同時保留 `UNIQUE(document_id, revision_no)` 作為資料庫層保護。

## 12. Revision Content Boundary

以下屬於版本內容：

```text
title
markdown
metadata
```

以下不屬於版本內容：

```text
path
filename
parent folder
position
source locator
workspace navigation state
archive status
```

| Change | New Revision |
| --- | ---: |
| Markdown | Yes |
| title | Yes |
| metadata | Yes |
| filename | No |
| folder rename | No |
| document move | No |
| reorder | No |
| archive | No |
| restore | No |

## 13. Content Hash

Phase 1 固定 hash contract，避免 Phase 2 自行發明。

```text
SHA-256(
  "knowledge-revision:v1\0" +
  canonical-json({
    title,
    markdown,
    metadata
  })
)
```

Normalization：

```text
title
→ trim
→ non-empty

markdown
→ CRLF → LF
→ 其他 whitespace 不修改

metadata
→ JSON object
→ recursively sort keys
```

不把 Markdown formatter 或語意 normalization 放進 hash。因此純格式差異仍可能形成不同內容；Phase 1 不做 semantic deduplication。

### 13.1 舊 Revision 與 hash 相容

Phase 0 的 `contentFingerprint` 是未加前綴的 SHA-256；title 與 Markdown 原樣保存。Phase 1 不重寫歷史 revision 的內容、hash、ID 或 revision number，也不直接用舊 stored hash 與新 hash 判定變更。

更新時先在 Document lock 內驗證 expected current revision，candidate 使用嚴格 normalization（trim 後 title 必須非空）；stored revision 使用獨立 comparison normalization：trim title、CRLF→LF、排序 metadata，但不對舊 title 施加 non-empty 驗證。比較兩者 canonical payload。相同即回傳原 revision（包含其原 stored hash），不寫 revision，也不偷偷更新顯示內容。不同才建立採新 hash contract 的 N+1。舊 whitespace-only title 是 Phase 0 合法資料：read/history 保留原樣；stored comparison payload 的 title 可為空字串，因此能與合法 candidate 比較並形成新 revision，不得讓舊資料無法被修正。

SourceEntry.content_hash 不作跨版本 NOOP 或 identity 判斷依據；既有值保留，受控同步成功後才更新成 candidate 的新 fingerprint。Phase 2 比較內容沿用此 core comparator，不以不同 hash 演算法造成假變更。

驗收必須用 Phase 0 encoder 建立 fixture：一般相同內容、title 外側空白、CRLF、metadata key order 均能正確 NOOP；真正內容修改產生 N+1；舊 whitespace-only title 可讀且可修正；歷史 rows byte-stable。

## 14. Document Creation

Hub-managed document：

```text
validate trusted CallerContext
SET TRANSACTION ISOLATION LEVEL READ COMMITTED
BEGIN
resolve and lock Source → Workspace
require transaction-scoped Workspace access
validate Source ACTIVE + HUB_MANAGED
validate parent
create Document with UUIDv7 ID
create Revision #1
create DOCUMENT TreeNode
set Document.current_revision_id
COMMIT
```

必須 atomic。不存在 committed `Document.current_revision_id = null` 的完成狀態。

## 15. Mutation Authority

這是 Phase 1 最重要的 boundary。Public application services 都顯式接收 `CallerContext`；caller 不可由 command payload、form、query、org_code、workspace selector 或 `force` flag 指定。

所有 Hub/Source mutation 都先完成：

```text
resource/source
  → Source.workspace_id
  → Workspace access policy
  → Source ownership/lifecycle authority
```

### 15.1 Hub Commands

```text
HubKnowledgeCommandService
```

可執行：

```text
createDocument(caller, input)
createRevision(caller, input)
createFolder(caller, input)
moveTreeNode(caller, input)
archiveDocument(caller, documentId)
restoreDocument(caller, documentId)
```

但必須同時滿足 Workspace access，且：

```text
source.ownership == HUB_MANAGED
```

### 15.2 Source Projection Commands

提供給未來 Phase 2：

```text
SourceKnowledgeProjectionService
```

可執行：

```text
projectDocument(caller, input)
projectRevision(caller, input)
projectFolder(caller, input)
moveProjectedNode(caller, input)
archiveProjectedDocument(caller, documentId)
restoreProjectedDocument(caller, documentId)
```

但必須同時滿足 Source Workspace access，且：

```text
source.ownership == SOURCE_MANAGED
```

此 interface 為 internal application boundary，不由 Web API 直接 expose。Phase 2 orchestration 傳入的是已由可信 transport/application boundary 建立的 CallerContext，不是 source folder 自帶的 actor identity。

### 15.3 Transaction-scoped projection

Sources orchestration 擁有整次 Apply 的 SourceUnitOfWork。於同一 connection 取得 Source lock、解析 Workspace 並通過 transaction-scoped WorkspaceAccessPolicy 後，建立綁定該 transaction 的 projection commands；commands 不另開 UoW、不 commit、不接受 Web 傳入 repository 或 authority token。每次 command 的 resource 必須屬於已授權 Source，並重新驗證 ownership/lifecycle。

Document／Folder projection 與 SourceEntry mapping 在同交易建立，sourceEntryId 可以預先配置但不是已存在 mapping 的要求。回傳前 mapping 必須完整，不能留下半成品 committed entry。同一 Apply 的所有 projection、mapping、assets、sync_version 與 APPLIED run 一起 commit／rollback；FAILED run 在 rollback 後另存。Phase 1 以多筆 transaction fixture 驗證，完整 sync 產品流程仍屬 Phase 2。

Source projection 同時提供 renameProjectedFolder、archiveProjectedFolder、restoreProjectedFolder；Folder archive 採無 ACTIVE children 規則，Phase 2 可在同交易由葉至根 archive。restore 由祖先至子節點恢復，驗證完整 ACTIVE ancestry。Folder mapping 與 TreeNode lifecycle/provenance 同交易更新。

## 16. 禁止 Force Flag

不設計：

```ts
updateDocument({ force: true })
```

或：

```ts
bypassOwnership: true
```

Mutation authority 由不同 application interface 表達，避免未來 Web / Agent 誤用繞過 ownership rule。也不得接受 `workspaceId`/`org_code` 作為「已授權」證明。

## 17. Lifecycle

Lifecycle 僅有：

```text
ACTIVE
ARCHIVED
```

沒有：

```text
DELETED
MISSING
TRASHED
```

Phase 1 延續 Phase 0 的 current lifecycle provenance：Source、SourceEntry、TreeNode、Document 的 lifecycle transition 同交易維護 `updated_by`、`archived_by`、`archived_at`。這些欄位不提供完整多次 archive/restore event history；完整 append-only audit 留 Phase 3。

Workspace lifecycle 不在 Phase 1 實作；Phase 3 明確負責 Workspace provision/create、rename、archive/restore 與 administration semantics。Workspace MVP 不 hard delete。

## 18. Archive Document

```text
SET TRANSACTION ISOLATION LEVEL READ COMMITTED
BEGIN
resolve Document → Source → Workspace
lock Source
require transaction-scoped Workspace access
lock Document

Document.status = ARCHIVED
Document.updated_by = caller.identity.id
Document.archived_by = caller.identity.id
Document.archived_at = now

Document TreeNode.status = ARCHIVED
TreeNode.updated_by / archived_by / archived_at = caller / now

linked SourceEntry.status = ARCHIVED
linked SourceEntry.updated_by / archived_by / archived_at = caller / now
(if present)

COMMIT
```

Revision 不動。

## 19. Restore Document

```text
SET TRANSACTION ISOLATION LEVEL READ COMMITTED
BEGIN
resolve Document → Source → Workspace
lock Source
require transaction-scoped Workspace access
lock Document
validate source ACTIVE
validate parent folder ACTIVE

Document.status = ACTIVE
Document.updated_by = caller.identity.id
Document.archived_by = null
Document.archived_at = null

TreeNode.status = ACTIVE
TreeNode.updated_by = caller.identity.id
TreeNode.archived_by = null
TreeNode.archived_at = null

linked SourceEntry.status = ACTIVE
linked SourceEntry.updated_by = caller.identity.id
linked SourceEntry.archived_by = null
linked SourceEntry.archived_at = null
(if present)

COMMIT
```

Document ID 不變，current_revision_id 不變。

## 20. Folder Archive

Phase 1 不做模糊 cascade semantics。

Hub command：

```text
archiveFolder(caller, treeNodeId)
```

先由 TreeNode → Source → Workspace 做 access check，只允許 archive 沒有 ACTIVE children 的 folder。成功時該 Folder TreeNode 同交易更新 status 與 lifecycle provenance。

如果仍有 children：

```text
FOLDER_NOT_EMPTY
```

Phase 2 Folder Sync 若整個 subtree 消失，會明確對 snapshot 中每個 entry 執行 batch lifecycle transition。Phase 5 若需要「刪除整個 folder」UX，再另外設計 explicit cascade preview。

## 21. Source Lifecycle

Source lifecycle operation 先由 `Source.workspace_id` 執行 Workspace access check。

Archive Source：

```text
KnowledgeSource.status = ARCHIVED
KnowledgeSource.updated_by = caller.identity.id
KnowledgeSource.archived_by = caller.identity.id
KnowledgeSource.archived_at = now
```

不 cascade 修改所有 descendants。

Read path：

```text
Source ARCHIVED
→ 整棵 Tree 預設不可見
```

Restore Source：

```text
KnowledgeSource.status = ACTIVE
KnowledgeSource.updated_by = caller.identity.id
KnowledgeSource.archived_by = null
KnowledgeSource.archived_at = null
```

原本 child lifecycle 保留原值。因此 Source archive 是 container visibility gate，不是大量 child lifecycle update，也不是 Workspace lifecycle。

Source lifecycle 由 Sources application service 提供 `archiveSource(caller, sourceId)`／`restoreSource(caller, sourceId)`，適用兩種 ownership；這是 container 操作，不允許藉此改寫 SOURCE_MANAGED 內容。同 transaction 的 Workspace policy 與 Source lock 為必要條件。此階段沒有 Source lifecycle Web controls。

## 22. Read Application Services

Phase 1 提供顯式 caller-aware read contract。

Workspace query：

```text
listWorkspaces(caller)
```

只回 caller 可見 Workspace。

Knowledge query：

```text
listSources(
  caller,
  workspaceId,
  includeArchived = false
)

getSource(
  caller,
  sourceId,
  includeArchived = false
)

listTree(
  caller,
  sourceId,
  includeArchived = false
)

getDocument(
  caller,
  documentId,
  includeArchived = false
)

getCurrentRevision(caller, documentId, includeArchived = false)
getRevision(caller, documentId, revisionNo, includeArchived = false)
listRevisions(caller, documentId, includeArchived = false)
getAncestors(caller, nodeId, includeArchived = false)
```

`listSources` 的 workspaceId 是 query scope；server 必須驗證 caller access。`getSource / listTree / getDocument / revision reads` 不把 client 額外提供的 workspaceId 當 proof，而是從 resource relationship 解析 Workspace 再做 policy check。

Phase 1 尚未實作 production roles/capabilities，但 Workspace membership foundation 已是 application contract 的必要檢查；Phase 3 在相同 resource/policy boundary 上補 production governance。

這些 application services不依賴 React、HTTP、MCP 或 scanner，也不從 ambient/global request state自行取得 caller。Phase 4 HTTP Read API 與 Phase 7 MCP 可直接 reuse。

### 22.1 Missing／archived query contract

`getSource`、`getDocument`、`getCurrentRevision`、`getRevision` 與 `getAncestors` 採非 nullable 回傳：不存在或被預設 archived filtering 隱藏時，分別拋 SOURCE_NOT_FOUND、DOCUMENT_NOT_FOUND、REVISION_NOT_FOUND 或 TREE_NODE_NOT_FOUND。revision lookup 先驗證 Document 存在且可見，Document 不可見回 DOCUMENT_NOT_FOUND；Document 可見但指定 revision 不存在才回 REVISION_NOT_FOUND。listRevisions 對不可見 Document 同樣拋 DOCUMENT_NOT_FOUND，其他合法空集合回 []。已存在但無 Workspace membership 的資源仍由 WorkspaceAccessDeniedError 拒絕。

Browser adapter 明確將 not-found codes 轉成 Next `notFound()`，不再依靠 `if (!view)`；access denial 沿用不洩漏內容的既有處理，不能把所有例外都吞成 404。Core 不 import Next。此變更須同步更新 Phase 0 null assertions、view shape 及所有 query consumers。

## 23. Tree Read Model

UI 不直接拿 DB rows。

Application 組成：

```ts
type KnowledgeTreeItem =
  | {
      type: "folder";
      id: string;
      parentId: string | null;
      label: string;
      position: number;
      status: "ACTIVE" | "ARCHIVED";
    }
  | {
      type: "document";
      id: string;
      parentId: string | null;
      documentId: string;
      label: string;
      currentRevisionId: string;
      position: number;
      status: "ACTIVE" | "ARCHIVED";
    };
```

Document：`label = current revision title`；Folder：`label = TreeNode.name`。所有 ID 在 application surface 以標準 UUID string 表達；storage layer 使用 MariaDB native `UUID`。

## 24. Phase 1 Minimal UI

Phase 1 提供 read-only Knowledge Browser：

```text
┌───────────────────────────────────────────────────────┐
│ Workspace: Query Master ▼                             │
│ Source: Obsidian Wiki ▼                               │
├─────────────────┬─────────────────────────────────────┤
│ Architecture    │ Database Architecture               │
│ ├ Overview      │                                     │
│ ├ Database ◀    │ markdown rendered content           │
│                 │                                     │
│ Runbooks        │ Revision: #4                        │
│ └ Deployment    │ Updated: ...                        │
└─────────────────┴─────────────────────────────────────┘
```

支援：

- Workspace selector，只顯示 caller-authorized Workspace。
- Source selector，只顯示目前 Workspace 下的可見 Sources。
- Folder tree。
- Document viewer。
- Revision history。
- Archived toggle。

不支援：

- Workspace create/rename/archive/member management。
- Edit。
- Upload。
- Drag & Drop。
- Delete。
- Sync。

這讓 Phase 1 可以實際驗證 Knowledge Core 與 Workspace-scoped read path，但不提前做 Phase 3/5。

### 24.1 Phase 0 smoke flow 銜接

Phase 1 正式 Browser 移除 Phase 0 create form 與其 Web mutation action，application 建立文件能力保留給測試與未來 authoring。Phase 0 原 E2E 不原封不動保留：改以 application fixture 建立文件，驗證 stable URL、reload 與 Tree navigation；caller spoofing 由 application／可信 identity adapter 測試保留，並驗證 Browser 無 mutation controls／入口。

Task 1 執行原 Phase 0 baseline；Phase 1 最終驗收保留其 domain/access/transaction guarantees，使用更新後的唯讀 E2E。不可同時要求原建立表單 E2E 通過與 Browser 沒有建立表單。

## 25. SourceEntry Core

Phase 1 完成 mapping primitives：

```text
createSourceEntryMapping()
getSourceEntry()
resolveByExternalId()
updateSourceLocator()
archiveSourceEntry()
restoreSourceEntry()
```

但不做：

```text
matchUnknownEntry()
detectRename()
detectMove()
resolveCanonicalTitle()
```

這些屬於 Phase 2。

## 26. `external_id` Rule

若來源提供 stable external ID：

```text
UNIQUE(source_id, external_id)
```

`external_id = NULL` 可以有多筆。

`source_path` 仍只是 locator：

```text
external_id → identity hint
source_path → current location
content_hash → content comparison
Document.id → Hub identity
```

任何一個都不能互相冒充。

## 27. Error Model

Phase 1 統一 domain / application errors。至少：

```text
WORKSPACE_NOT_FOUND
WORKSPACE_ACCESS_DENIED
SOURCE_NOT_FOUND
DOCUMENT_NOT_FOUND
REVISION_NOT_FOUND
TREE_NODE_NOT_FOUND

SOURCE_ARCHIVED
DOCUMENT_ARCHIVED

SOURCE_MANAGED_READ_ONLY
HUB_MANAGED_OPERATION_REQUIRED

INVALID_PARENT
CROSS_SOURCE_MOVE
TREE_CYCLE
FOLDER_NOT_EMPTY

REVISION_CONFLICT
SOURCE_ENTRY_CONFLICT
INVALID_SOURCE_MAPPING

INVALID_TITLE
INVALID_METADATA
```

UI / HTTP adapter 再自行 mapping presentation / status code。Core 不回 transport-specific HTTP status、toast message 或 SQL driver error。

錯誤遷移由 plan Task 1 統一負責：完整路徑為 `src/modules/knowledge/domain/errors.ts`、`src/modules/workspaces/domain/errors.ts`、`src/shared/domain/errors.ts`。保留 DomainError、WorkspaceAccessDeniedError 的責任邊界；新 semantic codes 不代表把 source sync VERSION_CONFLICT 改成 revision conflict。

## 28. Revision Concurrency

Phase 5 未來編輯時需要避免 lost update，因此 Phase 1 command contract 預留：

```text
createRevision(caller, {
  documentId,
  expectedCurrentRevisionId,
  title,
  markdown,
  metadata
})
```

如果 `expectedCurrentRevisionId != actualCurrentRevisionId`，回 `REVISION_CONFLICT`。這是 Core correctness，不是 Phase 5 UI feature；Phase 2 sync 也能 reuse。

## 29. Transaction Boundaries

以下操作必須在 **READ COMMITTED** 下 atomic；所有參與的 repository 與 WorkspaceAccessPolicy 使用同一 MariaDB connection；BEGIN 後解析 authoritative scope 並檢查 membership，任何 transaction 外的 preflight 都不能取代此檢查。Workspace access 必須在 mutation execution 前依 authoritative resource scope 驗證；UI state 不取代 policy。

### 29.1 Create Document

```text
Workspace access
Document
Revision
TreeNode
current revision pointer
```

### 29.2 Create Revision

```text
Workspace access
Revision
current revision pointer
```

### 29.3 Archive / Restore

```text
Workspace access
Document
TreeNode
SourceEntry
lifecycle provenance
```

### 29.4 Tree Move

```text
Workspace access
source lock
node
affected sibling positions
```

任何 canonical mutation 失敗：`ROLLBACK ALL`。READ COMMITTED 不取代 Source/Document locking read；兩者共同構成 Phase 1 concurrency contract。

## 30. Default Archived Filtering

預設 `includeArchived = false`，適用 `listSources`、`listTree`、`getDocument`。Revision reads 與 getAncestors 同樣預設排除 archived scope；Historical explicit lookup 可以 `includeArchived = true`，但仍不得繞過 Workspace access。

未來 Search、MCP 與 Agent 都必須沿用相同 default，並透過 CallerContext + Workspace policy 進入 application query boundary。

## 31. Core Invariants

Phase 1 完成後必須保證：

1. 每個 Source 永遠屬於一個 Workspace。
2. `User.org_code` 不作 Knowledge authorization shortcut。
3. Cross-org WorkspaceMembership 合法；same-org non-member 不自動 access。
4. Resource ID / UI Workspace selection 不能繞過 Workspace policy。
5. Document 永遠屬於一個 Source，workspace scope 由 Source 推導。
6. Document ID 為 UUIDv7 stable identity，不受 hierarchy 變更影響。
7. Revision immutable。
8. current revision 一定屬於該 Document。
9. Revision number 單調增加且唯一。
10. 相同內容不建立 duplicate revision。
11. 一個 Document 只有一個 Knowledge TreeNode，DB uniqueness 已從 Phase 0 保護。
12. Folder 不建立 fake Document。
13. Document node title 來自 current Revision。
14. Tree parent 必須同 Source。
15. Tree 不可形成 cycle。
16. Document 不可跨 Source move。
17. 普通 Tree/Sync operation 不可改變 Source Workspace。
18. SOURCE_MANAGED 不接受 Hub mutation。
19. Source mutation 不可由 public `force` bypass。
20. Archive 不 hard delete，且目前 archive actor/time 可追溯。
21. Restore 沿用原 Document ID 並清除目前 archive provenance。
22. SourceEntry mapping 不因 path rename 自動換 identity。
23. Tree / Document / SourceEntry lifecycle transactionally consistent。
24. Canonical mutation 使用 READ COMMITTED + explicit row locks，不散落 SQL。
25. Public read/write services 顯式接收 CallerContext。
26. Web / future MCP 共用相同 application services + Workspace policy。
27. Phase 1 不提前建立 Workspace administration、production role model 或 Agent actor_kind / Principal model。

## 32. Acceptance Tests

Phase 1 至少覆蓋以下核心 scenario。

### 32.1 Workspace / Caller

```text
✓ listWorkspaces only returns caller memberships
✓ cross-org user with membership can browse shared Workspace
✓ same-org non-member cannot browse Workspace
✓ one caller can switch between multiple authorized Workspaces
✓ direct source/document UUID does not bypass Workspace policy
✓ caller cannot be overridden by input payload
✓ UI workspace selection is not authorization evidence
```

### 32.2 Revision

```text
✓ create document creates R1
✓ markdown change creates R2
✓ title change creates R2
✓ metadata change creates R2
✓ identical content creates no revision
✓ hierarchy move creates no revision
✓ concurrent revisions cannot share revision_no
✓ stale expectedCurrentRevisionId rejected
✓ old revision remains unchanged
```

### 32.3 Tree

```text
✓ folder can contain folder
✓ folder can contain document
✓ document cannot be parent
✓ second TreeNode for same Document rejected
✓ cross-source parent rejected
✓ node cannot move below itself
✓ node cannot move below descendant
✓ document move keeps Document ID
✓ document move keeps Revision
✓ reorder keeps Revision
✓ concurrent cycle-producing moves cannot both succeed
✓ lock waiter validates against latest committed state under READ COMMITTED
```

### 32.4 Lifecycle

```text
✓ archive keeps revision history
✓ archive hides document by default
✓ archive stores current actor/time provenance
✓ restore clears current archive provenance
✓ restore keeps Document ID
✓ restore keeps current Revision
✓ document/tree/source-entry status remain consistent
✓ non-empty folder cannot be implicitly archived
✓ archived Source hidden by default
```

### 32.5 Ownership / Mutation Authority

```text
✓ Hub command works for HUB_MANAGED after Workspace access
✓ Hub command rejects SOURCE_MANAGED
✓ source projection works for SOURCE_MANAGED after Workspace access
✓ source projection rejects HUB_MANAGED
✓ no force/bypass path exists
```

### 32.6 Mapping

```text
✓ Folder SourceEntry maps to stable TreeNode
✓ Document SourceEntry maps to same-source Document/TreeNode
✓ changing source_path keeps mapping identity
✓ duplicate external identity rejected
✓ filename/path does not implicitly redefine canonical title
```

## 33. Phase 2 Handoff Contract

Phase 1 完成後，Phase 2 不再決定：

- Workspace access foundation 如何進入 application boundary。
- Document 如何產生 revision。
- Archive/Restore 如何執行與保存 current provenance。
- Tree move 如何執行。
- Source content ownership 如何限制。
- CallerContext 如何進入 application boundary。
- Document identity 如何保存。
- Duplicate revision 如何避免。

Phase 2 只負責：

```text
Select authorized Workspace for new Source
 ↓
Folder
 ↓
Scan
 ↓
Parse + Title Resolution
 ↓
Snapshot
 ↓
Match SourceEntry
 ↓
Diff
 ↓
Preview
 ↓
Confirm
 ↓
Create Source(workspace_id) + Source Projection Commands
```

更新既有 Source 時只指定 `source_id`；Workspace 從 Source relationship 決定，sync 不提供 target Workspace override。

也就是：Phase 2 決定「這次來源發生什麼改變、來源內容如何解析成 canonical candidate」，Phase 1 決定「這些改變如何在授權 Workspace scope 下安全地成為 Knowledge」。

## 34. Definition of Done

Phase 1 完成的判斷不是「Tree UI 看得到」，而是以下流程全部成立：

```text
CallerContext
 ↓
Authorized Workspace
 ↓
Source
 ↓
Create
 ↓
Document stable UUIDv7 identity
 ↓
Revision history
 ↓
Move / rename
 ↓
same Document ID
 ↓
Archive + actor/time provenance
 ↓
hidden by default
 ↓
Restore
 ↓
same Document ID + same history
```

並且 SOURCE_MANAGED 已存在正式、安全的 internal mutation boundary，足以讓 Phase 2 接入。Phase 1 不聲稱公司 production governance 已完成；正式 multi-user governance 需要 Phase 3。

## 35. ADR Summary

### ADR-P1-01 — Source as Tree Root

KnowledgeSource 本身作為 Tree root，不建立 synthetic folder；Workspace 是 Source container，不是 Tree node。

### ADR-P1-02 — One Document, One TreeNode

每個 Document 在 Knowledge Tree 中只有一個 Document TreeNode；此 uniqueness 已提升為 Phase 0 foundation，Phase 1 保留並驗證。

### ADR-P1-03 — Revision Title Is Canonical

Document node label 來自 current Revision title，不複製 title 到 Tree；SOURCE_MANAGED title resolution 留給 Phase 2。

### ADR-P1-04 — Stable Folder Mapping

增加 `SourceEntry.tree_node_id`，建立 Folder entry 的穩定 mapping。

### ADR-P1-05 — Mutation Authority Separation

Hub mutation 與 Source projection 使用不同 application interfaces，不提供 bypass flag；兩者都必須先通過 Workspace policy。

### ADR-P1-06 — Source-level Tree Lock + READ COMMITTED

Tree mutation 使用 Phase 0 READ COMMITTED UoW + Source-level database lock 防止 concurrent hierarchy corruption。

### ADR-P1-07 — Revision Concurrency

Revision mutation使用 Document-level lock 加 optimistic expected revision。

### ADR-P1-08 — Revision Hash Boundary

Revision hash 只涵蓋 title、Markdown、metadata。

### ADR-P1-09 — Explicit Folder Lifecycle

Folder archive 不隱式 cascade；bulk lifecycle 由 caller 明確描述；current archive provenance 同 transition 保存。

### ADR-P1-10 — Source Archive as Visibility Gate

Source archive 是 visibility gate，不 cascade 修改全部 Knowledge records。

### ADR-P1-11 — CallerContext + Workspace Scope Are Explicit

Public Knowledge read/write services 以 CallerContext 作顯式第一參數，resource 透過 Source → Workspace 解析 access scope；Phase 3 在此 policy boundary 補 production governance。

### ADR-P1-12 — No Premature Agent Actor Model

Phase 0–2 provenance 仍引用 user identity；Phase 1 不引入 `actor_kind`。Agent write 若成為需求，由 Agent/Authoring 對應 phase 設計 Principal/Actor。

## 36. Final Architecture

```text
                         Identity
                            │
                            ▼
                    CallerContext
                            │
                            ▼
                    Workspaces Module
              ┌─────────────┴──────────────┐
              │                            │
       listWorkspaces()            WorkspaceAccessPolicy
                                           │
                                           ▼
                                  Application Services
                                           │
                       ┌───────────────────┴────────────────────┐
                       │                                        │
            HubKnowledgeCommandService            SourceKnowledgeProjectionService
                 HUB_MANAGED                            SOURCE_MANAGED
                       │                                        │
                       └───────────────────┬────────────────────┘
                                           ▼
                                   Knowledge Domain
                          ┌──────────────┼───────────────┐
                          │              │               │
                       Document       Revision          Tree
                          │              │               │
                          └──────────────┼───────────────┘
                                         │
                              Lifecycle + Provenance
                                         │
                                         ▼
                                 Repository Ports
                                         │
                                         ▼
                           READ COMMITTED MariaDB 10.11
                               native UUID storage

Workspace
 └─ KnowledgeSource
      ├─ SourceEntry
      └─ future Phase 2 Sync
              │
              └──────────► SourceKnowledgeProjectionService
```

這是 Phase 1 的正式 architecture boundary。Phase 2 的 scanner、Title Resolution、snapshot、matching、diff、preview 與 apply orchestration 必須建立在這個 boundary 之上，而不是直接修改 canonical Knowledge tables。Phase 3 再補 Workspace provisioning/lifecycle、roles/capabilities、membership administration 與 enterprise mapping；不需要把 `org_code` 重新拉回 Knowledge access boundary。
