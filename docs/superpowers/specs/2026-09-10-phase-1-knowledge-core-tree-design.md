# Knowledge Hub — Phase 1 Knowledge Core & Tree Design

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-10 |
| Phase | 1 |
| 名稱 | Knowledge Core & Tree |
| 狀態 | Approved Design |
| 前置 | Phase 0 Foundation & Architecture |
| 後續 | Phase 2 Knowledge Source Import & Sync |

## 1. Goal

Phase 1 的目標是讓 Knowledge Hub 擁有一套完整、可靠且不依賴 ingestion、Web UI 或 MCP 的 Knowledge Core。

完成後系統必須能保證：

```text
org_code
  └── KnowledgeSource
       └── Knowledge Tree
            ├── Folder
            └── Document
                 └── immutable Revisions
```

其中：

- Tree = 文件目前位於哪裡。
- Document = 文件穩定 identity。
- Revision = 文件內容版本。
- SourceEntry = 外部來源 identity 與 Hub object 的 mapping。
- Source = ownership 與來源邊界。

Document ID 不因 rename、move、archive、restore 或 revision 而改變。

## 2. Phase 1 Scope

### 2.1 In Scope

Phase 1 完成：

- KnowledgeSource core behavior。
- KnowledgeDocument lifecycle。
- Immutable KnowledgeRevision。
- Knowledge Tree。
- Folder / Document hierarchy。
- Stable Document identity。
- SourceEntry mapping contract。
- Archive / restore。
- Move / reorder。
- Revision history。
- Current revision resolution。
- Archived filtering。
- SOURCE_MANAGED / HUB_MANAGED mutation guard。
- Transactional invariants。
- Concurrency protection。
- Read-only Knowledge Browser。

### 2.2 Out of Scope

Phase 1 不做：

- Folder upload / scanning。
- Folder Sync。
- Preview / Confirm / Apply。
- Diff algorithm。
- Rename detection algorithm。
- Markdown parser。
- Rich text editor。
- Web authoring。
- Keyword search。
- Embedding / vector search。
- ACL。
- Company SSO。
- tKMS publishing。
- MCP。
- Agent Memory。

以上能力分別留在 Phase 2 之後的對應階段。

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

這會讓 Folder Sync 繞過 Knowledge invariants，因此不採用。

### 3.2 Option B — Domain Commands + Mutation Authority Separation

採用：

```text
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
Document
Revision
Tree
Lifecycle
Repositories
Transactions
```

但 SOURCE_MANAGED 不提供 `force=true`、`bypassOwnership=true` 等 escape hatch。

### 3.3 Decision

採 Option B。

Phase 2 因此形成：

```text
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
KnowledgeSource
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

Source 本身就是 Tree root，不建立 synthetic root folder。

例如：

```text
Query Master                     ← KnowledgeSource
├── Architecture                 ← Folder TreeNode
│   ├── Overview.md              ← Document TreeNode
│   └── Database.md
└── Runbooks
    └── Deployment.md
```

## 5. Schema Refinement

Phase 0 的八張核心表繼續保留。Phase 1 不重做 schema，只補必要 constraint 與 mapping。

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

## 6. Tree Invariants

### 6.1 Document TreeNode

每個 KnowledgeDocument 在 Knowledge Tree 中只能有一個 node。

因此 `knowledge_tree_nodes.document_id` 對非 NULL 值建立 uniqueness protection。

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

## 7. Tree Operations

Phase 1 提供：

```text
listTree(sourceId)

createFolder(...)
moveTreeNode(...)
reorderTreeNode(...)

archiveFolder(...)
restoreFolder(...)

getAncestors(...)
```

所有 Tree mutation 必須驗證：

- parent 存在。
- parent 是 FOLDER。
- parent ACTIVE。
- parent 與 node 位於同 Source。
- node 不可移到自己下面。
- node 不可移到 descendant。
- Document 不可跨 Source move。

因此以下操作禁止：

```text
Source A / Document X
    ↓ move
Source B
```

若未來需要跨 Source 搬移，必須設計明確 migration / transfer 流程，不能把一般 tree move 當 source transfer。

## 8. Tree Ordering

Phase 1 維持簡單：

```text
position INT
```

Sibling query：

```text
ORDER BY position, id
```

Phase 1 不引入：

- Fractional indexing。
- LexoRank。
- CRDT。

Move / reorder transaction 內重算受影響 sibling positions。

## 9. Tree Concurrency

Tree mutation 採 Source-level serialization。

修改 hierarchy 前：

```sql
SELECT ...
FROM knowledge_sources
WHERE id = ?
FOR UPDATE;
```

同一 Source 的 Tree mutation 因此 serial execution。

這能避免：

```text
A: folder1 → folder2
B: folder2 → folder1
```

兩個 concurrent requests 分別驗證通過，最後形成 cycle。

不同 Source 仍可平行操作。

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

Revision 建立後 immutable。

不存在：

```text
updateRevision()
```

只有：

```text
createRevision()
```

## 11. Revision Creation

流程：

```text
BEGIN

lock Document

read current revision

normalize candidate content

compare candidate content hash

if unchanged:
    return current revision

insert Revision N+1

update Document.current_revision_id

COMMIT
```

兩個 concurrent writers 不會建立相同 `revision_no`。

DB 同時保留：

```text
UNIQUE(document_id, revision_no)
```

作為資料庫層保護。

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

建議：

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

不把 Markdown formatter 或語意 normalization 放進 hash。

因此純格式差異仍可能形成不同內容；Phase 1 不做 semantic deduplication。

## 14. Document Creation

Hub-managed document：

```text
BEGIN

validate Source
validate HUB_MANAGED
validate parent

create Document

create Revision #1

create DOCUMENT TreeNode

set Document.current_revision_id

COMMIT
```

必須 atomic。

不存在 committed：

```text
Document
└── current_revision_id = null
```

的完成狀態。

## 15. Mutation Authority

這是 Phase 1 最重要的 boundary。

### 15.1 Hub Commands

```text
HubKnowledgeCommandService
```

可執行：

```text
createDocument
createRevision
createFolder
moveTreeNode
archiveDocument
restoreDocument
```

但必須：

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
projectDocument
projectRevision
projectFolder
moveProjectedNode
archiveProjectedDocument
restoreProjectedDocument
```

但必須：

```text
source.ownership == SOURCE_MANAGED
```

此 interface 為 internal application boundary，不由 Web API 直接 expose。

## 16. 禁止 Force Flag

不設計：

```ts
updateDocument({
  force: true
})
```

或：

```ts
bypassOwnership: true
```

Mutation authority 由不同 application interface 表達，避免未來 Web / Agent 誤用繞過 ownership rule。

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

## 18. Archive Document

```text
BEGIN

lock Source
lock Document

Document.status = ARCHIVED
Document TreeNode.status = ARCHIVED

linked SourceEntry.status = ARCHIVED
(if present)

COMMIT
```

Revision 不動。

## 19. Restore Document

```text
BEGIN

validate source ACTIVE
validate parent folder ACTIVE

Document.status = ACTIVE
TreeNode.status = ACTIVE

linked SourceEntry.status = ACTIVE
(if present)

COMMIT
```

Document ID 不變，current_revision_id 不變。

## 20. Folder Archive

Phase 1 不做模糊 cascade semantics。

Hub command：

```text
archiveFolder()
```

只允許 archive 沒有 ACTIVE children 的 folder。

如果仍有 children：

```text
FOLDER_NOT_EMPTY
```

Phase 2 Folder Sync 若整個 subtree 消失，會明確對 snapshot 中每個 entry 執行 batch lifecycle transition。

如此避免：

```text
archive folder
→ 偷偷 archive 300 documents
```

的隱性 side effect。

Phase 5 若需要「刪除整個 folder」UX，再另外設計 explicit cascade preview。

## 21. Source Lifecycle

Archive Source：

```text
KnowledgeSource.status = ARCHIVED
```

不 cascade 修改所有 descendants。

Read path：

```text
Source ARCHIVED
→ 整棵 Tree 預設不可見
```

Restore Source：

```text
Source ACTIVE
```

原本 child lifecycle 保留原值。

因此 Source archive 是 container visibility gate，不是大量 child lifecycle update。

## 22. Read Application Services

Phase 1 提供：

```text
listSources()

getSource(sourceId)

listTree(
  sourceId,
  includeArchived = false
)

getDocument(
  documentId,
  includeArchived = false
)

getCurrentRevision(documentId)

getRevision(documentId, revisionNo)

listRevisions(documentId)
```

這些 application services：

- 不依賴 React。
- 不依賴 HTTP。
- 不依賴 MCP。
- 不依賴 scanner。

Phase 4 HTTP Read API 與 Phase 7 MCP 可直接 reuse。

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

Document：

```text
label = current revision title
```

Folder：

```text
label = TreeNode.name
```

## 24. Phase 1 Minimal UI

Phase 1 可以提供一個 read-only Knowledge Browser。

```text
┌─────────────────────────────────────────────┐
│ Source: Query Master                        │
├───────────────┬─────────────────────────────┤
│ Architecture  │ Database Architecture       │
│ ├ Overview    │                             │
│ ├ Database ◀  │ markdown rendered content   │
│               │                             │
│ Runbooks      │ Revision: #4                │
│ └ Deployment  │ Updated: ...                │
└───────────────┴─────────────────────────────┘
```

支援：

- Source selector。
- Folder tree。
- Document viewer。
- Revision history。
- Archived toggle。

不支援：

- Edit。
- Upload。
- Drag & Drop。
- Delete。
- Sync。

這讓 Phase 1 可以實際驗證 Knowledge Core，但不提前做 Phase 5。

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

Phase 1 統一 domain / application errors。

至少：

```text
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

UI / HTTP adapter 再自行 mapping presentation / status code。

Core 不回 transport-specific 的 HTTP status 或 toast message。

## 28. Revision Concurrency

Phase 5 未來編輯時需要避免 lost update，因此 Phase 1 command contract 預留：

```text
createRevision({
  documentId,
  expectedCurrentRevisionId,
  title,
  markdown,
  metadata
})
```

如果：

```text
expectedCurrentRevisionId
!=
actualCurrentRevisionId
```

回：

```text
REVISION_CONFLICT
```

這是 Core correctness，不是 Phase 5 UI feature；Phase 2 sync 也能 reuse。

## 29. Transaction Boundaries

以下操作必須 atomic。

### 29.1 Create Document

```text
Document
Revision
TreeNode
current revision pointer
```

### 29.2 Create Revision

```text
Revision
current revision pointer
```

### 29.3 Archive / Restore

```text
Document
TreeNode
SourceEntry
```

### 29.4 Tree Move

```text
source lock
node
affected sibling positions
```

任何失敗：

```text
ROLLBACK ALL
```

## 30. Default Archived Filtering

預設：

```text
includeArchived = false
```

適用：

```text
listSources
listTree
getDocument
```

Historical explicit lookup 可以：

```text
includeArchived = true
```

未來 Search、MCP 與 Agent 都必須沿用相同 default。

## 31. Core Invariants

Phase 1 完成後必須保證：

1. Document 永遠屬於一個 Source。
2. Document ID 不受 hierarchy 變更影響。
3. Revision immutable。
4. current revision 一定屬於該 Document。
5. Revision number 單調增加且唯一。
6. 相同內容不建立 duplicate revision。
7. 一個 Document 只有一個 Knowledge TreeNode。
8. Folder 不建立 fake Document。
9. Document node title 來自 current Revision。
10. Tree parent 必須同 Source。
11. Tree 不可形成 cycle。
12. Document 不可跨 Source move。
13. SOURCE_MANAGED 不接受 Hub mutation。
14. Source mutation 不可由 public `force` bypass。
15. Archive 不 hard delete。
16. Restore 沿用原 Document ID。
17. SourceEntry mapping 不因 path rename 自動換 identity。
18. Tree / Document / SourceEntry lifecycle transactionally consistent。
19. Canonical mutation 不散落 SQL。
20. Web / future MCP 共用相同 application services。

## 32. Acceptance Tests

Phase 1 至少覆蓋以下核心 scenario。

### 32.1 Revision

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

### 32.2 Tree

```text
✓ folder can contain folder
✓ folder can contain document
✓ document cannot be parent
✓ cross-source parent rejected
✓ node cannot move below itself
✓ node cannot move below descendant
✓ document move keeps Document ID
✓ document move keeps Revision
✓ reorder keeps Revision
✓ concurrent cycle-producing moves cannot both succeed
```

### 32.3 Lifecycle

```text
✓ archive keeps revision history
✓ archive hides document by default
✓ restore keeps Document ID
✓ restore keeps current Revision
✓ document/tree/source-entry status remain consistent
✓ non-empty folder cannot be implicitly archived
✓ archived Source hidden by default
```

### 32.4 Ownership

```text
✓ Hub command works for HUB_MANAGED
✓ Hub command rejects SOURCE_MANAGED
✓ source projection works for SOURCE_MANAGED
✓ source projection rejects HUB_MANAGED
✓ no force/bypass path exists
```

### 32.5 Mapping

```text
✓ Folder SourceEntry maps to stable TreeNode
✓ Document SourceEntry maps to same-source Document/TreeNode
✓ changing source_path keeps mapping identity
✓ duplicate external identity rejected
```

## 33. Phase 2 Handoff Contract

Phase 1 完成後，Phase 2 不再決定：

- Document 如何產生 revision。
- Archive 如何執行。
- Restore 如何執行。
- Tree move 如何執行。
- Ownership 如何限制。
- Document identity 如何保存。
- Duplicate revision 如何避免。

Phase 2 只負責：

```text
Folder
 ↓
Scan
 ↓
Parse
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
Source Projection Commands
```

也就是：

> Phase 2 決定「這次來源發生什麼改變」，Phase 1 決定「這些改變如何安全地成為 Knowledge」。

## 34. Definition of Done

Phase 1 完成的判斷不是「Tree UI 看得到」，而是以下流程全部成立：

```text
Create
 ↓
Document stable identity
 ↓
Revision history
 ↓
Move / rename
 ↓
same Document ID
 ↓
Archive
 ↓
hidden by default
 ↓
Restore
 ↓
same Document ID + same history
```

並且 SOURCE_MANAGED 已經存在正式、安全的 internal mutation boundary，足以讓 Phase 2 接入。

## 35. ADR Summary

### ADR-P1-01 — Source as Tree Root

KnowledgeSource 本身作為 Tree root，不建立 synthetic folder。

### ADR-P1-02 — One Document, One TreeNode

每個 Document 在 Knowledge Tree 中只有一個 Document TreeNode。

### ADR-P1-03 — Revision Title Is Canonical

Document node label 來自 current Revision title，不複製 title 到 Tree。

### ADR-P1-04 — Stable Folder Mapping

增加 `SourceEntry.tree_node_id`，建立 Folder entry 的穩定 mapping。

### ADR-P1-05 — Mutation Authority Separation

Hub mutation 與 Source projection 使用不同 application interfaces，不提供 bypass flag。

### ADR-P1-06 — Source-level Tree Lock

Tree mutation 使用 Source-level database lock 防止 concurrent hierarchy corruption。

### ADR-P1-07 — Revision Concurrency

Revision mutation 使用 Document-level lock 加 optimistic expected revision。

### ADR-P1-08 — Revision Hash Boundary

Revision hash 只涵蓋 title、Markdown、metadata。

### ADR-P1-09 — Explicit Folder Lifecycle

Folder archive 不隱式 cascade；bulk lifecycle 由 caller 明確描述。

### ADR-P1-10 — Source Archive as Visibility Gate

Source archive 是 visibility gate，不 cascade 修改全部 Knowledge records。

## 36. Final Architecture

```text
                         Identity
                            │
                            ▼
                  Application Services
                            │
            ┌───────────────┴────────────────┐
            │                                │
 HubKnowledgeCommandService       SourceKnowledgeProjectionService
      HUB_MANAGED                    SOURCE_MANAGED
            │                                │
            └───────────────┬────────────────┘
                            ▼
                    Knowledge Domain
             ┌──────────────┼───────────────┐
             │              │               │
          Document       Revision          Tree
             │              │               │
             └──────────────┼───────────────┘
                            │
                        Lifecycle
                            │
                            ▼
                    Repository Ports
                            │
                            ▼
                       MariaDB 10.11


Sources Module
 ├─ KnowledgeSource
 ├─ SourceEntry
 └─ future Phase 2 Sync
         │
         └──────────► SourceKnowledgeProjectionService
```

這是 Phase 1 的正式 architecture boundary。Phase 2 的 scanner、snapshot、matching、diff、preview 與 apply orchestration 必須建立在這個 boundary 之上，而不是直接修改 canonical Knowledge tables。
