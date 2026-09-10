# Knowledge Hub — Phase 0 Foundation & Architecture Design

| 項目 | 內容 |
| --- | --- |
| 文件日期 | 2026-09-10 |
| 文件類型 | Design Spec；不包含 Implementation Plan |
| 決策狀態 | Approved Design；已整合 Workspace access-boundary correction |
| 交付狀態 | 文件完成並經自我審查；不代表系統已實作或通過驗收 |
| 決策來源 | [KM 各階段實作規劃 - 全部重做](chatgpt-conversation://6a990399-5d14-83e9-8e46-8091dce556fd) 與 [Workspace Access Boundary Amendment](2026-09-10-workspace-access-boundary-amendment.md) |

## 1. 文件效力與範圍

本規格定義新版 Knowledge Hub 的 Phase 0 foundation，供後續實作計畫與各階段設計引用。2026-09-10 architecture review 已把原本以 `org_code` 作 Knowledge 上層 scope 的設計修正為 **Workspace access boundary**；本文件已直接整合該修正，因此本文是 Phase 0 current canonical contract，不需要由實作者自行把舊 org/source 段落與 amendment 拼接。

Phase 0 交付可啟動、可測試的 Next.js modular monolith 基礎：技術骨架、四個核心模組、最小身分介面、Workspace access foundation、核心 schema、repository 與 transaction 邊界、domain invariants，以及最小建立／讀取／Workspace → Source → Tree 瀏覽 smoke flow。完整 Knowledge 功能在 Phase 1 展開，完整 Folder Sync 在 Phase 2 實作。

本文件區分三種內容：

- **Phase 0 必須交付**：骨架、schema、domain representation、Workspace membership foundation、基礎 application services、安全機制與測試。
- **後續階段必須遵守的契約**：例如 Folder Sync 的 Preview → Confirm → Apply；現在定義規則，不提前完成產品功能。
- **一致性釐清**：把已確認規則的必要含義寫清楚，例如文章標題修改屬於內容版本，以及失敗紀錄不能依賴已回滾的交易。這些不是新增產品功能。

## 2. 目標與非目標

### 2.1 目標

1. 建立 source-agnostic Knowledge Hub，接受各團隊不同 LLM Wiki／一般 Markdown folder 來源，不綁定 Obsidian 或特定 generator。
2. 以 `Workspace → KnowledgeSource → Folder / Document Tree` 表達 Knowledge container、來源與瀏覽結構；`User.org_code` 只保留為公司 organization identity attribute。
3. 以 `WorkspaceMembership` 建立最小 access foundation，使跨 org collaboration 合法、同 org 不自動取得 Knowledge access。
4. 分離 Source、Tree、Document identity 與 Revision，確保路徑改變不破壞文件引用。
5. 讓 Human Web、未來 API 與 MCP 共用 application services，核心不依賴 UI 或接入協定。
6. 以 MariaDB transaction、關聯約束與測試保護 canonical Knowledge 的一致性。
7. 外部開發只依賴 local/mock identity，未來以公司 SSO adapter 替換身分來源。

### 2.2 非目標

Phase 0 不實作以下項目：

| 項目 | 邊界 |
| --- | --- |
| 完整 Folder Upload / Sync | Phase 2；Phase 0 只完成模型與安全基礎 |
| ZIP 匯入 | 已排除於 Folder Sync MVP；使用直接選取整個 folder |
| 完整文件管理與 Tree 產品功能 | Phase 1；Phase 0 僅提供驗證 foundation 的最小流程 |
| 完整單篇上傳、Web authoring 與 rich Markdown editor | Phase 5；Phase 0 定義可編輯規則並驗證最小建立／revision 行為 |
| Workspace provisioning／rename／archive／restore 管理 UI | Phase 3；Phase 0 只建立最小 Workspace schema、seed 與 membership guard |
| 完整 Workspace roles/capabilities、membership administration、Team/SSO Group mapping、granular ACL | Phase 3；Phase 0 只建立 membership foundation |
| tKMS API、Publishing Tree 與發布流程 | Phase 6 |
| MCP server / tools / transport | Phase 7 |
| Embedding、Vector DB、Elasticsearch、語意／混合搜尋 | Phase 8；Phase 0 不選定未來 retrieval backend |
| Agent Memory、Knowledge Relations、Context Bundles | Phase 9 |
| 公司 SSO 整合 | 進入公司環境後補；正式 company multi-user governance 由 Phase 3 完成 |
| Binary asset storage | 不保存至 MariaDB、local filesystem 或 object storage；只存 metadata/reference |
| Hard delete | MVP 不提供 |
| 雙向同步、Markdown merge、partial sync success | MVP 不提供 |
| 微服務或獨立後端服務 | 不屬於本階段部署模型 |

不得預先加入 Refine、Outline、Redux、Tiptap、dnd-kit、Elasticsearch 或 MCP implementation。未來編輯器、拖曳與 retrieval 的需求由對應階段處理；擴充邊界不等於現在安裝套件或建立空模組。

## 3. 技術與整體架構

### 3.1 技術基線

| 層次 | 已確認選擇 |
| --- | --- |
| Application / Web | Next.js modular monolith、React |
| 語言 | TypeScript |
| UI | Tailwind CSS、shadcn/ui；原 UI 選型以 Base UI 為預設方向 |
| Canonical database | MariaDB 10.11 |
| 身分 | Local / Mock Identity Provider，後續 Company SSO adapter |
| Knowledge access scope | Workspace + WorkspaceMembership |
| Internal IDs | Application 產生 UUIDv7；MariaDB 使用 native `UUID` type（16-byte storage） |

除 MariaDB 10.11 外，本規格不新增 ORM、測試框架或部署平台選型；這些屬於後續 implementation plan 的落地細節，不改變本文件的架構契約。所有 Hub 內部 stable entity IDs（User、Workspace、Source、SourceEntry、TreeNode、Document、Revision、Asset、SyncRun）採同一 UUIDv7 contract；`WorkspaceMembership` 是 association，使用 `(workspace_id, user_id)` composite key，不要求額外 UUID。不得使用 path、title、hash 或 database auto-increment 冒充 domain identity。MariaDB 10.11 已提供 native `UUID` type，因此本基線不使用 `CHAR(36)`，也不要求 application 手動維護 `BINARY(16)` byte layout。

### 3.2 分層與依賴

```text
Human Web
  │
  ▼
Next.js pages / routes / server actions
  │                         IdentityProvider
  │                              │
  └───────────┬──────────────────┘
              ▼
       Application Services
              │
       ┌──────┼──────────┐
       ▼      ▼          ▼
 Workspaces  Sources ──► Knowledge
       │      │          │
       └──────┴────┬─────┘
                   ▼
         Domain + repository ports
                   ▲
                   │ implemented by
          MariaDB infrastructure
                   │
                   ▼
              MariaDB 10.11
```

部署上是一個 Next.js application；程式內以 module 與 layer 分工，不透過跨服務 HTTP 切開同一個 transaction。Domain 不依賴 Next.js、React、SQL、SSO token、MCP 或來源掃描程式。

Web adapter 負責接收請求、取得可信 identity、建立 `CallerContext`、呼叫 application service 與呈現結果。不得在頁面直接操作 ORM／資料庫來取代 application service。UI 的 Workspace selector 只代表 navigation state，不是 authorization evidence；resource operation 必須由 application service 反查 authoritative Source → Workspace relationship 再執行 policy。UI error boundary 不負責資料回滾；回滾由 application transaction 邊界處理。

MariaDB 是 Hub 內 canonical state 的儲存位置。`SOURCE_MANAGED` 表示外部來源控制內容與 hierarchy 的更新權；它不表示 Web 或未來 Agent 應繞過 Hub 直接讀取外部 folder，也不等於 caller 的 access policy。

## 4. 核心 Domain 規則

### 4.1 User、Workspace、來源與樹

```text
User
├── emp_id
├── name
└── org_code                     ← company organization identity attribute

User
  └── WorkspaceMembership
          │
          ▼
      Workspace                  ← Knowledge container + basic access scope
          │
          └── KnowledgeSource
                ├── SourceEntry ─────────────────────┐
                ├── KnowledgeAsset metadata         │
                └── KnowledgeTreeNode               │
                      ├── FOLDER                    │
                      └── DOCUMENT ─────────────────┤
                                                    ▼
                                            KnowledgeDocument
                                                    │
                                                    ▼
                                            KnowledgeRevision
```

- 一個 User 可以屬於多個 Workspace；一個 Workspace 可以包含不同 `org_code` 的 User。
- `User.org_code` 描述公司組織歸屬，不直接作 Knowledge allow/deny predicate；same org 不自動 allow，cross org 不自動 deny。
- 每個 Source 必須且只屬於一個 `workspace_id`；一個 Workspace 可以有多個 Source。
- Phase 0 不要求 Workspace 綁定單一 owner org。若未來治理需要 accountable org/team，Phase 3 再設計 metadata，且不得把治理 metadata 當 authorization shortcut。
- 每份 Document 必須且只屬於一個 Source，包括單篇上傳與 Web 建立的文件。
- Document 不重複保存 `workspace_id`；其 scope 由 `Document → Source → Workspace` 推導。
- Folder 是純 hierarchy node，不建立假的空白 KnowledgeDocument。
- Source 本身仍是該 Source 的 logical Tree root；Workspace 不是 synthetic Tree folder。
- Tree 表達位置；Document 表達穩定身分；Revision 表達內容版本。

### 4.2 Source type 與 ownership

| `source_type` | `ownership` | 更新權與行為 |
| --- | --- | --- |
| `FOLDER_SYNC` | `SOURCE_MANAGED` | 來源控制 hierarchy、path、title、Markdown 與 knowledge metadata；Hub 唯讀，更新透過下一次同步 |
| `FILE_UPLOAD` | `HUB_MANAGED` | 單篇匯入後由 Hub 管理，可編輯並建立 revision；原檔不再持續控制內容 |
| `HUB` | `HUB_MANAGED` | Web 建立的文件由 Hub 管理，可編輯並建立 revision |

Ownership 儲存在 Source，Document 透過 `source_id` 取得有效 ownership，不另維護一份可能互相衝突的 document ownership。Workspace access 與 Source ownership 是兩個獨立判斷：前者回答 caller 能否進入該 Knowledge scope，後者回答內容由外部來源或 Hub 控制更新。

`SOURCE_MANAGED` 的唯讀規則必須在 application service 強制執行，不能只隱藏 UI 按鈕。一般 Hub 編輯、rename、move 或刪除操作不得修改來源鏡像；同步流程可以透過受控的 Knowledge application operations 更新、archive 或 restore。

單篇上傳即使和既有 folder 文件同名或內容相同，也不自動覆蓋或合併 source-managed 文件。自動去重、detach／ownership conversion 與雙向同步不屬於本規格。

### 4.3 穩定 ID 與 SourceEntry

`KnowledgeDocument.id` 不依賴檔名、path、TreeNode ID、Workspace ID、generator ID 或外部發布系統 ID。既有文件在 rename、move、revision、archive／restore 後保留原 ID。

`SourceEntry` 保存來源 entry 與 Document 的 mapping：來源有 stable `external_id` 時優先使用；沒有時由 Hub 維護 mapping。`source_path` 只是 locator，不能直接作為 Document ID。來源不必具有特定 frontmatter ID，也不能要求所有 generator 使用同一種格式。

此規則保證「已識別為同一 entry」的身分延續，不宣稱僅憑 path 或相同 hash 就能無歧義辨認任意 rename／move。缺少 external ID 時的匹配演算法與歧義處理由 Phase 2 設計；Phase 0 不新增未經確認的相似度、去重或自動合併策略。Mapping schema 與 repository 必須能防止同一已識別來源 identity 被重複配置。

### 4.4 Revision 與 hierarchy 的分界

| 變更 | 更新位置 | 新 Revision |
| --- | --- | --- |
| 來源檔名／路徑 rename | SourceEntry locator、相關 hierarchy | 否 |
| Folder rename | Folder TreeNode name、相關 locator | 否 |
| Move 或 reorder | TreeNode parent / position、相關 locator | 否 |
| 文章 title 修改 | KnowledgeRevision | 是 |
| Markdown 修改 | KnowledgeRevision | 是 |
| Knowledge metadata／來源 frontmatter 內容修改 | KnowledgeRevision | 是 |
| Archive／restore，內容相同 | lifecycle／相關 Tree 與 mapping 狀態 | 否 |
| 內容與 hierarchy 同時改變 | 各自更新 | 內容產生新 Revision |
| 完全相同內容重複輸入 | 保留目前內容 | 否 |

「Rename 不產生 revision」指檔名、路徑或 Folder 名稱的 hierarchy 變更；文章標題屬於已確認的版本化內容，修改標題必須產生 revision。Document TreeNode 的顯示名稱取自 current revision 的 `title`，Folder 才使用自己的 `name`。

Revision 建立後 immutable，不原地修改或覆寫舊內容。新的 title／Markdown／metadata 狀態以新 revision 表達，再更新 Document 的 `current_revision_id`。內容比較必須涵蓋三者，不能只比較 Markdown 而漏掉標題或 metadata；path／parent／position 不列入版本內容。Hash 的序列化與計算實作由 implementation plan／匯入設計落地。

SOURCE_MANAGED 的 `title` resolution 不在 Phase 0 決定。來源 filename/path 不自動等於 canonical Knowledge title；Phase 2 ingestion design 必須明確定義 frontmatter、Markdown heading、filename 等候選來源的優先序、缺值 fallback 與衝突裁決。Phase 0–1 只定義「一旦 canonical title 改變，就屬於 Revision content change」。

### 4.5 Lifecycle

Knowledge lifecycle 只有 `ACTIVE` 與 `ARCHIVED`。對話中的「missing」描述來源缺檔，不新增 `MISSING` 或 `DELETED` lifecycle enum。

來源文件消失或 Hub-managed 文件被刪除時採 archive；保留 Document、Revision 與來源 mapping，不 hard delete。預設 Tree 與未來搜尋／MCP query 排除 archived 文件；歷史與引用仍可保留。

同一 SourceEntry 再次出現時，恢復原 Document 為 `ACTIVE` 並沿用 Document ID。若版本內容改變才新增 revision；內容相同只 restore。相關 Tree／mapping 狀態與 Document 必須一致更新。

所有可進入 `ARCHIVED` 的 canonical entity（KnowledgeSource、SourceEntry、KnowledgeTreeNode、KnowledgeDocument）必須保存 lifecycle provenance：`updated_by`、`archived_by nullable`、`archived_at nullable`。Archive 時同交易寫入 status、`updated_by`、`archived_by`、`archived_at`；restore 時 status 回到 ACTIVE、`updated_by` 更新為本次 actor，並清空目前狀態的 `archived_by`／`archived_at`。這些欄位描述「目前 archive 狀態」的 provenance，不取代完整歷史 audit log；多次 archive/restore 的 append-only audit history 留給 Phase 3 Governance 設計。

Workspace 自身的 lifecycle 不在 Phase 0 定義。Phase 3 必須明確設計 Workspace create/provision、rename、archive/restore 與 administration semantics；MVP 不提供 Workspace hard delete。

Phase 0–2 的 actor 仍是可信 `UserIdentity`，欄位透過 user FK 保存。現在不引入 `actor_kind` 或 polymorphic actor reference；Agent write、service account 或 system actor 若日後成為需求，再在其對應 phase 設計 Principal/Actor model。

### 4.6 Assets

`KnowledgeAsset` 只保存來源 path、MIME type、content hash 與 metadata/reference。Markdown 可保留原本的相對路徑引用。

Phase 0／Phase 2 MVP 不持久保存圖片、附件 binary 或整份上傳 folder binary，也不要求提供 binary serving。記錄資產參照不代表 Hub 已能顯示對應圖片或下載附件。未來有需求才新增 storage adapter。

## 5. Domain Model 與 Table Boundaries

Phase 0 migration 至少建立以下十張 domain tables。以下是已確認的邏輯欄位與責任，不是完整 SQL DDL；實體型別、索引名稱與 migration 順序由 implementation plan 決定。

| Table / Owner | 最小欄位 | 責任與限制 |
| --- | --- | --- |
| `users` / identity | `id` PK、`emp_id` UNIQUE、`name`、`org_code` | 最小本地使用者資料；org_code 為 identity attribute；供建立者與操作紀錄引用，不保存 SSO token |
| `workspaces` / workspaces | `id`、`name`、`created_at`、`updated_at` | Knowledge container 與 basic access scope；Phase 0 不強制 owner org、slug、完整 lifecycle 或 role model |
| `workspace_memberships` / workspaces | `workspace_id`、`user_id`、`created_at`；PK `(workspace_id, user_id)` | Phase 0 basic membership association；完整 roles/capabilities 與 administration 留 Phase 3 |
| `knowledge_sources` / sources | `id`、`name`、`workspace_id`、`source_type`、`ownership`、`status`、`sync_version`、`created_by`、`updated_by`、`archived_by` nullable、`archived_at` nullable、`created_at`、`updated_at` | Source 定義、單一 Workspace scope、更新權、同步版本與目前 lifecycle provenance |
| `source_entries` / sources | `id`、`source_id`、`external_id` nullable、`source_path`、`entry_type`、`content_hash`、`document_id` nullable、`status`、`updated_by`、`archived_by` nullable、`archived_at` nullable、`first_seen_at`、`last_seen_at` | 來源 identity／locator、Document mapping 與目前 lifecycle provenance；Folder entry 可沒有 Document |
| `knowledge_tree_nodes` / knowledge | `id`、`source_id`、`parent_id` nullable、`node_type`、`name`、`document_id` nullable、`position`、`status`、`updated_by`、`archived_by` nullable、`archived_at` nullable | Source 內 hierarchy 與目前 lifecycle provenance；`node_type` 為 `FOLDER` 或 `DOCUMENT` |
| `knowledge_documents` / knowledge | `id`、`source_id`、`current_revision_id`、`status`、`created_by`、`updated_by`、`archived_by` nullable、`archived_at` nullable、`created_at`、`updated_at` | 穩定文件身分、current revision pointer 與目前 lifecycle provenance；不存 Markdown、path 或 workspace_id |
| `knowledge_revisions` / knowledge | `id`、`document_id`、`revision_no`、`title`、`markdown`、`metadata`、`content_hash`、`created_by`、`created_at` | 不可變內容版本與 provenance |
| `knowledge_assets` / sources | `id`、`source_id`、`source_path`、`mime_type`、`content_hash`、`metadata`、`created_at` | 僅資產 metadata/reference；來源未提供的可選 metadata 不應阻塞模型 |
| `sync_runs` / sources | `id`、`source_id`、`triggered_by`、`based_on_version`、`result_version`、`status`、`summary`、`started_at`、`completed_at` | 同步操作紀錄；Phase 0 建 schema，Phase 2 接完整流程 |

所有上表 Hub internal entity ID 欄位使用相同 UUID contract，MariaDB 欄位型別使用 native `UUID`；WorkspaceMembership 使用 composite association key。`knowledge_revisions.metadata` 可使用 MariaDB JSON 欄位保存 frontmatter 等非核心資料；workspace/source/status/ownership/revision reference 等重要 domain 欄位維持明確關聯欄位。Phase 0 不新增 organizations、publishing、granular ACL、vector、MCP 或 memory tables。

Source、SourceEntry、TreeNode 與 Document 的 lifecycle status 採 `ACTIVE / ARCHIVED`。`sync_runs.status` 是另一個操作結果維度，採 `PREVIEWED / APPLIED / FAILED`，不表示新增 Knowledge lifecycle。

### 5.1 必須保護的 invariants

| Invariant | 保護方式與驗收要求 |
| --- | --- |
| 每個 Source 恰有一個既有 Workspace | `knowledge_sources.workspace_id` 必填 FK 與 integration test |
| WorkspaceMembership 不重複 | PK/UNIQUE `(workspace_id, user_id)`；同 user 可加入多個 Workspace |
| same org 不自動 access / cross org membership 可 access | application policy + integration fixtures；不得以 org equality shortcut |
| 每個 Document 恰有一個既有 Source | 必填 reference、外鍵與 integration test |
| Revision 必須屬於既有 Document | 外鍵與 integration test |
| `current_revision_id` 必須指向同一 Document 的 Revision | 同文件關聯約束與 repository transaction 驗證；僅驗證 revision 存在並不足夠 |
| 同文件 revision 編號不可重複 | `(document_id, revision_no)` 唯一性與測試 |
| 每個 Document 在 Knowledge Tree 只有一個 DOCUMENT node | `knowledge_tree_nodes.document_id` 對非 NULL 值建立 UNIQUE protection；integration test 嘗試建立第二個 node 必須失敗 |
| `DOCUMENT` TreeNode 必須有 Document reference | node type／reference constraint 與測試 |
| `FOLDER` TreeNode 有 name 且沒有 Document reference | node type／reference constraint 與測試 |
| Tree、mapping 與被引用 Document 的 Source 一致 | 關聯一致性檢查及 integration test；不可用 Tree move 暗中改變文件 Source |
| Tree parent 在同一 Source，hierarchy 不形成循環 | repository／domain validation 與測試 |
| 同一已識別來源 identity 不產生重複 mapping | Source 範圍內唯一性保護與 integration test；不以全域 path/hash 等同 identity |
| Lifecycle 變更可追溯目前 actor/time | lifecycle-bearing row 的 status 與 `updated_by`／`archived_by`／`archived_at` 在同 transaction 更新；restore 清空目前 archive provenance |
| Revision immutable | Domain／repository 不提供覆寫舊版本操作；以行為測試保護 |
| 操作失敗不留下部分 canonical state | 同一 transaction 與 rollback integration test |
| Resource ID 不能繞過 Workspace policy | read/write service 必須從 authoritative relationship 反查 Workspace 再做 access check |

資料庫可表達的關聯／唯一性／欄位規則應以 constraint 保護；跨資料列的 hierarchy 或流程規則仍需要 domain／application 驗證及測試，不能只依賴 UI。

Document 與第一個 Revision 的相互引用由建立交易處理。建立中的暫時 pointer 狀態不能被當成已完成文件提交或由 application 回傳；成功建立後必須存在同文件 current revision。實作計畫需選用符合 MariaDB 10.11 的插入／更新順序並以真實 DB 測試，不假定僅靠單一外鍵能涵蓋全部規則。

## 6. Module 與 Application Boundaries

```text
src/
├── app/                       # Next.js Web adapters / composition
├── components/
│   ├── ui/                    # shadcn/ui primitives
│   └── knowledge/             # Knowledge presentation
├── modules/
│   ├── identity/
│   │   ├── domain/
│   │   ├── application/
│   │   └── ports/
│   ├── workspaces/
│   │   ├── domain/
│   │   ├── application/
│   │   └── ports/
│   ├── knowledge/
│   │   ├── domain/
│   │   ├── application/
│   │   └── ports/
│   └── sources/
│       ├── domain/
│       ├── application/
│       └── ports/
└── infrastructure/
    ├── database/mariadb/
    └── identity/
```

這是責任布局，不要求每項操作各自建立一個檔案。Phase 0 不建立空的 `publishing/`、`retrieval/`、`agent/` 或 `memory/` module。

### 6.1 Identity 與 CallerContext

Identity 只負責「目前呼叫者是誰」，不承擔 Knowledge 授權政策。

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

interface IdentityProvider {
  getCurrentIdentity(): Promise<UserIdentity>;
}
```

`id` 為 Hub 內部穩定使用者 ID；`emp_id` 為員工工號；`name` 為姓名；`org_code` 為公司組織代碼。`org_code` 不直接回答 caller 可以讀寫哪些 Workspace。Local provider 建立／更新最小 `users` 資料，外部開發由 server 提供測試身分。

Web／其他 transport adapter 透過 `IdentityProvider` 取得可信 identity 後建立 `CallerContext`，再把它作為 application service 的顯式第一參數。Application Core 不從 UI payload 讀 caller，也不依賴 ambient/global request identity。CallerContext 不固定攜帶單一 `workspace_id`，因為同一 caller 可以存取多個 Workspace。

未來公司 adapter 驗證 SSO token 後映射為相同四欄位並同步本地最小資料。其餘 module 不接觸 token 格式、SSO SDK 或 provider 細節。身分無法取得時回報失敗，不以客戶端傳入的工號／org 取代可信身分。完整企業登入與治理仍是後續工作。

### 6.1A Workspaces

Workspaces module 負責 Phase 0 的最小 `Workspace` / `WorkspaceMembership` domain representation、repository 與 access-policy port。至少提供：

```text
listWorkspaces(caller)
requireMembership(caller, workspaceId)
```

Phase 0 policy 只表示 local/mock MVP 的 membership guard，不宣稱已完成 production role/capability authorization。Phase 3 必須在相同 resource boundary 上補 Workspace provisioning/lifecycle、membership administration、roles/capabilities、Team/SSO Group mapping、必要的 granular policy 與 audit。

Knowledge/Source operation 不應相信 caller 額外提供的 workspaceId 作授權證明。對既有 resource 的操作由 resource relationship 解析 `Source.workspace_id` 再呼叫 Workspace policy。

### 6.2 Knowledge

負責 Document、Revision、Tree 與 lifecycle；提供可獨立於 Web 呼叫的 application operations，例如：

```text
getDocument(caller, ...)
getCurrentRevision(caller, ...)
listTree(caller, ...)
createHubManagedDocument(caller, ...)
createRevision(caller, ...)
moveTreeNode(caller, ...)
archiveDocument(caller, ...)
restoreDocument(caller, ...)
```

這些是能力邊界，不是本文件指定的完整 HTTP endpoints。Phase 0 實作驗證 foundation 所需的最小操作與規則，Phase 1 再完成核心產品行為。

Knowledge 不知道 Folder 如何掃描、LLM Wiki 格式、tKMS API、MCP protocol、Elasticsearch 或 Company SSO。它透過 repository ports 讀寫資料，不把 SQL 散布於 application services。

Knowledge operation 必須在 resource scope 解析後通過 Workspace access policy，再判斷 Source ownership/lifecycle。不能信任 UI 自行宣稱 workspace/ownership/editability，也不能因此反向依賴 Sources 的掃描／同步實作。跨模組外鍵是資料完整性關係，不代表反向程式依賴。

### 6.3 Sources

負責 KnowledgeSource、SourceEntry、asset metadata 與 SyncRun。後續 Phase 2 的 scanner、snapshot、diff、preview 與 apply orchestration 放在 Sources 邊界內。

KnowledgeSource 必須保存 `workspace_id`；Sources 負責解析 Source 所屬 Workspace，但不得把普通 sync/rename/move 當成 Workspace transfer。Source sync 必須先通過 target Source 所屬 Workspace policy，再經 Knowledge application operations 更新文件／revision／Tree／lifecycle，不能直接繞過 Knowledge 規則修改其資料表。Sources 自己管理 SourceEntry 與 Source 同步狀態。

```text
SourceSyncApplicationService
  ├── CallerContext
  ├── Workspace access policy
  ├── Knowledge application operations
  ├── SourceRepository / SourceEntry mapping
  └── SyncRun recording
       └── 同一個 canonical-state transaction
```

### 6.4 Repository、transaction ports 與 isolation

Knowledge 的 document／revision／tree repositories、Workspaces repositories/policy，以及 Sources repositories，由 MariaDB infrastructure 實作。Application 決定交易邊界；參與同一次 canonical mutation 的 repositories 與 Knowledge operations 共用該交易，不能各自提前 commit。

Canonical Knowledge mutation transaction 統一使用 **READ COMMITTED** isolation。MariaDB UoW 必須在 transaction 開始前設定本次 transaction isolation，之後才進入 begin → callback → assertions → commit。Source／Document 的 `SELECT ... FOR UPDATE` locking read 仍是 concurrency correctness 的必要部分；READ COMMITTED 的選擇避免依賴「locking read 一定必須是 transaction 第一個 statement」這種容易被 refactor 破壞的隱性前提。

Repository boundary 用於隔離 SQL、便於測試與清楚管理 transaction；不建立同時支援 MongoDB／PostgreSQL／MariaDB 的通用資料庫抽象。

### 6.5 依賴方向

```text
Identity ──► CallerContext ──► Application Services
Workspaces ──► Workspace access policy / queries
Sources ──► Knowledge

未來：
Publishing ──► Knowledge
Retrieval  ──► Knowledge
Agent      ──► Knowledge / Retrieval
```

Knowledge 不反向依賴 Sources ingestion、Publishing、MCP 或 Elasticsearch。未來 adapter 必須共用文件查詢、current revision resolution、archive filtering 與 Workspace 授權邊界，不重寫平行的一套 Knowledge 邏輯。

## 7. Transactions、Errors 與 Sync Safety

### 7.1 Hub-managed 建立與修改

建立基本文件是一個 READ COMMITTED atomic operation：

```text
resolve Source → Workspace
require Workspace membership/access
SET TRANSACTION ISOLATION LEVEL READ COMMITTED
BEGIN
  lock Source / validate source policy
  create KnowledgeDocument
  create immutable KnowledgeRevision R1
  set current_revision_id = R1
  create DOCUMENT TreeNode
COMMIT
```

任一步失敗全部 rollback，不留下孤兒 Document、Revision 或 TreeNode。內容修改時，新 Revision 的寫入與 current pointer 更新也在同一 transaction。Archive／restore／hierarchy 操作對其涉及的 canonical records 與 lifecycle provenance 一致更新。

### 7.2 Folder Sync 契約：Phase 2 實作

```text
Select Workspace
  → Select Folder（不是 ZIP）
  → Scan / Parse，保留 relative paths
  → Build Snapshot
  → Preview
  → User Confirm
  → Create Source in selected Workspace or validate existing Source
  → Version validation + Transaction Apply
```

第一次上傳由使用者明確選擇一個可存取 Workspace，再建立新的 KnowledgeSource；folder 名稱只作預設顯示名稱，可修改。後續同步必須由使用者明確選擇既有 `source_id`，Workspace 由既有 Source relationship 決定，不得透過 sync 另外提供 `target_workspace_id` 偷做 transfer。

「第一次上傳建立 Source」不代表選完 folder 立即寫入 Knowledge。Preview 可攜帶擬建立的 Source 資料；第一份正式 Source 與其知識資料應在 Confirm 後的 Apply 邊界建立，避免 Preview 留下半套 canonical state。這是 Preview 不修改正式資料原則的一致性釐清，不增加新來源流程。

Markdown 解析成 Knowledge；Folder 表達 hierarchy；assets 僅記 metadata/reference。掃描、解析及 snapshot 準備在 Apply 交易之前完成。SOURCE_MANAGED 的 canonical title resolution（frontmatter／heading／filename 的優先序與衝突）也在 Phase 2 parser/import design 中定義，不由 Phase 0 推定。

Preview 列出預計 `NEW / UPDATED / MOVED / RENAMED / ARCHIVED / RESTORED / UNCHANGED` 變更，MVP 不要求複雜 diff editor。Restore 是同一 entry 重現的 lifecycle 效果，Preview 必須顯示此效果，不默默建立新文件。

### 7.3 Preview 唯讀與確認資料

既有 Source 的 preview contract 至少包含：

```text
source_id
based_on_version
snapshot_hash
changes
expires_at
```

Preview 不建立 Revision、不 archive Document、不 move Tree、不修改 SourceEntry，也不增加 `sync_version`。`PREVIEWED` 操作紀錄與暫存 preview 是流程資料；保存這些不代表允許修改 canonical Knowledge。

`sync_preview` 在此是邏輯資料契約，不是 Phase 0 必須額外建立的第十一張 table。新 Source 尚無已提交版本時，不能冒用既有 Source 的 version 驗證流程；Phase 2 分別處理首次建立與既有 Source 同步。

Confirm 必須對應使用者看過的 snapshot 與 changes。`snapshot_hash` 表達該內容綁定；不能以另一份上傳內容替換已確認的變更。Preview 過期即拒絕並要求重新產生；保存方式、有效期限數值與傳輸機制在 Phase 2 設計，不是 Phase 0 的功能前置依賴。

### 7.4 Optimistic `sync_version`

KnowledgeSource 保存 `sync_version`。Preview 讀取目前版本為 `based_on_version`；既有 Source Apply 時必須在同一交易內原子驗證：

```text
current Source.sync_version == Preview.based_on_version
```

相等才可寫入並在成功 Apply 時令 `sync_version += 1`。若版本不同，拒絕舊 Preview，要求重新 Preview；MVP 不 merge。僅在交易外讀一次版本再開始寫入並不足夠，必須讓競爭的 Apply 無法同時以相同版本成功提交。

例如 A 與 B 都預覽 version 12，B 成功套用成 13 後，A 的 Confirm 必須失敗且不覆蓋 B 的結果。失敗／rollback 不增加版本。

### 7.5 Atomic Apply 與 SyncRun

```text
require Workspace access for Source.workspace_id
SET TRANSACTION ISOLATION LEVEL READ COMMITTED
BEGIN
  validate / guard Source version
  apply confirmed creates / content changes / hierarchy changes
  apply archives / restores + lifecycle provenance
  update SourceEntry mapping and asset metadata as required
  advance Source.sync_version
  record SyncRun APPLIED with result_version
COMMIT
```

所有變更一起成功或一起失敗。50 個變更在第 32 個失敗時，前 31 個也要 rollback；MVP 沒有 partial success。

`sync_runs` 保存 `PREVIEWED / APPLIED / FAILED` 狀態，以及觸發者、來源、base/result version、摘要、開始／完成時間。尚未成功套用的 run 沒有成功的 `result_version`。

若 Apply 失敗，先 rollback 整個 canonical-state transaction，再以獨立紀錄交易保存 `FAILED`。不能期待同一個被 rollback 的交易留下失敗紀錄；若紀錄本身也失敗，仍必須回報 Apply 失敗，不得宣告成功或保留部分 Knowledge 更新。

### 7.6 Idempotency

相同 folder 內容再次同步且全部 `UNCHANGED` 時：

```text
0 new revisions
0 tree changes
0 archives
```

這是 Knowledge state 的 NOOP。原對話同時確認「每次成功 Apply 增加 sync_version」；因此若使用者仍 Confirm 並成功 Apply，全為 unchanged 的 run 仍保存操作紀錄並遞增來源版本，不能因此新增內容版本。這區分同步操作版本與文章 revision，避免兩項規則衝突。

舊 Preview 在成功 Apply 後不再符合 based-on version；重送 Confirm 不能重複套用。這不等於 Phase 0 額外實作完整 request-idempotency 平台。

### 7.7 Error boundary

| 錯誤情境 | 必須行為 |
| --- | --- |
| 身分取得失敗 | 不執行需要呼叫者的操作；回報身分錯誤 |
| Workspace membership/access 不成立 | 拒絕操作，不洩漏該 Workspace 下 Source/Document 內容 |
| Document / Source 不存在或 reference 不合法 | 拒絕操作，不留下部分資料 |
| Hub 嘗試修改 SOURCE_MANAGED 文件／hierarchy | Application 拒絕；不能只依賴 UI 唯讀 |
| Preview 過期、內容不符或 Source version 已變 | 不 Apply；提示重新 Preview |
| Domain invariant 或 DB constraint 失敗 | 回滾該操作的全部 canonical writes |
| Sync Apply 中途失敗 | 全部 rollback，另存 FAILED，允許重新 Preview／Apply |
| 外部系統失敗 | 不假裝 MariaDB rollback 可以撤回外部副作用 |

Domain／application 回報有語意的失敗，Next.js adapter 轉成適合 Web 的結果；UI 能顯示失敗並保留明確的重試方向。本 spec 不新增未確認的 HTTP status code 清單或通用錯誤框架。

### 7.8 外部副作用

外部 API 不參與 MariaDB transaction。未來 tKMS 或索引更新遵循：

```text
local MariaDB transaction → commit
  → explicit / background external operation
  → record external result
```

不能在 DB transaction 中呼叫 tKMS，然後聲稱 DB rollback 可以撤回發布。本階段只確立邊界，不建置 worker、queue、outbox 或外部 adapter。

## 8. Testing Strategy

測試分為 Unit → Application / Domain Integration → Small E2E Smoke。Phase 0 不要求完整 Folder Upload Sync E2E。

### 8.1 Unit tests

使用純 domain 輸入驗證：

- Path rename／move／reorder 不產生 revision；title／Markdown／knowledge metadata 修改會產生 revision。
- 相同版本內容不產生 revision；舊 Revision 不被修改。
- SOURCE_MANAGED 拒絕 Hub 編輯；HUB_MANAGED 允許以新 revision 更新內容。
- ACTIVE／ARCHIVED 的預設可見性與 archive／restore 規則，以及目前 `archived_by`／`archived_at` provenance。
- 已識別為同一 SourceEntry 的重現沿用 Document ID，內容不同才新增 revision。
- Tree node type、Document reference、one-document-one-treenode 與有效 hierarchy 規則。
- Public application read/write contract 顯式接收 `CallerContext`，不從 input payload 取得 caller。
- Workspace access 與 Source ownership 分離；`org_code` 不作 allow/deny shortcut。

重現與 ownership 測試可用已建立 mapping／source policy 的 fixtures；不要求 Phase 0 寫出 Folder scanner、title resolution 或 rename detection engine。

### 8.2 MariaDB 10.11 integration tests

使用真實 MariaDB 10.11 驗證 repository 與 transaction，不以記憶體資料庫通過代替：

| 測試 | 必須證明 |
| --- | --- |
| 空 DB migration | 十張 domain tables、native UUID 欄位與必要約束可以建立 |
| Workspace membership | 同 user 可加入多 Workspace；cross-org member 可存取；same-org non-member 被拒絕 |
| Source Workspace scope | Source 無有效 workspace_id 不能存在；resource UUID 不繞過 Workspace policy |
| Document + Revision + TreeNode 建立 | 全部成功才提交，成功時 current pointer 合法 |
| 逐步注入失敗 | 建立流程任一步失敗均不留孤兒資料 |
| Revision pointer | 不存在或屬於其他 Document 的 revision 無法成為 current |
| Document Tree uniqueness | 同一 Document 的第二個 DOCUMENT TreeNode 被 DB/application 拒絕 |
| 唯一性與 mapping | 同文件 revision_no、同一已識別來源 identity 不會重複配置 |
| Archive／restore | history／mapping 保留，相關 lifecycle 與 provenance 一致 |
| READ COMMITTED + row locks | 兩連線下的 Tree/revision concurrency 不依賴舊 consistent-read snapshot；Source／Document lock 後驗證最新 committed state |
| Source version 競爭 | 兩個相同 base version 的競爭交易最多一個成功，另一個不留 writes |
| 多項 canonical writes 的回滾 | 共用 transaction 的跨 repository 變更全部回滾；version 不前進 |

Phase 0 以 transaction fixtures 驗證未來 Sync 所依賴的原子性與 version guard；完整差異計算、Preview 儲存、Title Resolution、首次 folder 建立與 FAILED run 流程的端到端驗證在 Phase 2 完成。

### 8.3 Small E2E smoke

```text
Open Knowledge Hub
  → Local identity available
  → list caller-visible Workspaces
  → select Workspace
  → select Source
  → Create / read one basic HUB_MANAGED document
  → Browse its Folder / Document tree
```

這個最小流程驗證 Web → trusted CallerContext → Workspace policy → application services → repositories → MariaDB 確實接通。基本表單或最小內容輸入已足夠，不為 smoke flow 引入 rich editor、單篇上傳產品流程、drag and drop 或搜尋引擎。

### 8.4 後續階段追加測試

Phase 1 擴充核心與完整 Tree 行為；Phase 2 驗證 folder scanning、Title Resolution、mapping 歧義、Preview／Confirm 內容綁定、到期、首次建立、diff、全量 rollback、FAILED run、重複同步 NOOP 與完整 Folder Upload E2E。Phase 3 補 production Workspace lifecycle/administration、role/capability、Team/SSO mapping 與 audit tests。後續 authoring、publishing、MCP 與 retrieval 各自沿用本階段 invariants。

## 9. Phase 0 Definition of Done

以下是未來 Phase 0 implementation 的驗收條件；本文件交付不代表這些項目已完成。

| 類別 | 全部滿足才算完成 |
| --- | --- |
| Architecture | Next.js modular monolith 可啟動；TypeScript／Tailwind／shadcn/ui 基線可用；不引入排除依賴 |
| Module boundaries | identity／workspaces／knowledge／sources 責任明確；Domain、Application、Infrastructure 分層；Web 不直接改 DB；不建未來空模組 |
| Identity | 四欄位 UserIdentity、CallerContext 與 IdentityProvider contract 可用；Local provider 支援外部開發；org_code 只作 identity attribute；application 不依賴 token 細節 |
| Workspace foundation | workspaces / workspace_memberships schema 與 repository/policy 可用；cross-org member allow、same-org non-member deny、multi-workspace user 與 direct-resource bypass 測試成立 |
| Database | Local MariaDB 10.11 可啟動；migration 可從空 DB 建出十張 domain tables、native UUID IDs 與必要約束 |
| Domain representation | Workspace → Source → Tree、兩種 ownership、stable Document ID、immutable Revision、SourceEntry、兩態 lifecycle／provenance 與 metadata-only assets 都有 schema／domain 表達 |
| Transactions | canonical mutation 使用 READ COMMITTED；最小建立、revision 更新與相關 lifecycle 操作有正確交易邊界；跨 repository 共用 transaction 可用 |
| Sync foundation | Source.sync_version 與 SyncRun schema 存在；optimistic guard 的競爭與 rollback 測試通過；未要求完整 Folder Sync |
| Integrity | 同文件 current revision、one-document-one-treenode、node type/reference、mapping 唯一性等約束與測試成立；MVP 不暴露 hard delete |
| Testing | 本規格 Phase 0 unit、MariaDB integration 與 small E2E smoke 可執行且通過 |
| Agent readiness | Application services 可由非 Web caller 透過 CallerContext 呼叫；日後 MCP 可重用 core/query/Workspace policy 而不依賴 page/component；Phase 0 沒有 MCP implementation 或 Agent actor model |
| Handoff | 實作結果可對照本 spec 提供驗證證據，沒有把 Phase 3 production governance 或後續功能誤報為 Phase 0 已完成 |

## 10. Future Phase Interfaces

以下保留責任與契約，不預先承諾完整 API 簽名、protocol payload 或未來套件。

| Phase | 延續的工作 | Phase 0 提供的接點與限制 |
| --- | --- | --- |
| 1 — Knowledge Core & Tree | 完整核心操作、Tree 與版本能力 | Workspace/Membership foundation、Document／Revision／Tree repositories、stable UUIDv7 IDs、CallerContext、lifecycle invariants |
| 2 — Knowledge Source Import & Sync | Generic Markdown Folder adapter、scan／snapshot／mapping／diff／preview／apply、Title Resolution | Select target Workspace for new Source；Sources → Knowledge application operations；SourceEntry、assets metadata、SyncRun、source version 與共用 transaction；folder upload 非 ZIP；filename/path 不自動冒充 canonical title |
| 3 — Identity & Basic Governance | Workspace provisioning/create、rename、archive/restore、membership administration、roles/capabilities、Team/SSO Group mapping、必要 policy/audit 與公司 SSO | UserIdentity 四欄位、既有 CallerContext、Workspace/Membership foundation 與 policy port；Phase 3 不重新把 org_code 變成 Knowledge ACL；MVP 不提供 Workspace hard delete |
| 4 — Discovery & Read API | Keyword／metadata search、filter、document／revision read | Workspace-aware Knowledge query application boundary；current revision、archive filtering 與 CallerContext 共用 |
| 5 — Human Authoring | 單篇 upload、Web editor 與完整 revision 流程 | Workspace capability + HUB_MANAGED 可寫、SOURCE_MANAGED 唯讀；內容更新產生 immutable revision |
| 6 — tKMS Publishing | 獨立 Publishing Tree、外部 mapping 與發布流程 | 引用穩定 Knowledge ID／Revision並驗證來源 Workspace policy；Publishing Tree scope 由 Phase 6 設計 |
| 7 — Agent & MCP Access | MCP adapter、Agent caller 與必要 Principal/Actor 擴充 | 透過同一 application/query services、CallerContext 與 Workspace policy；不接受任意 workspace_id/org_code 當授權證明；若需要 Agent write 再設計 Principal |
| 8 — Semantic & Hybrid Retrieval | Chunking、embedding、derived indexes、hybrid search | MariaDB Knowledge + Workspace governance 仍為 canonical；retrieval backend 於此階段選型，核心不依賴索引技術 |
| 9 — Agent Memory & Knowledge Relations | Memory、relations、context 與 promotion | 獨立 domain 透過穩定文件／revision reference 連接；Agent Memory scope 不自動等同 Workspace |

Phase 2 必須在自己的設計中落實無 stable external ID 的匹配／歧義處理、Title Resolution、parser／hash 正規化、preview 儲存與有效期限、首次來源與既有來源的流程細節。這些是明確屬於 Phase 2 的設計責任，不以未確認答案冒充本次已核准決策，也不阻塞 Phase 0 foundation 的驗收。

## 11. Architecture Decision Records

以下 ADR 均彙整已接受決策；ADR-001～003 保留原對話編號，其餘為本文件整理索引。Workspace access-boundary correction 已直接整合到 ADR-004；詳細變更歷史可見 Workspace amendment 的 ADR-018。

### ADR-001 — MariaDB 10.11 為 canonical datastore

- **Context：** Knowledge、Revision、Source 與 Tree 需要關聯一致性；近期階段不依賴語意搜尋。
- **Decision：** 使用 MariaDB 10.11；Vector／Semantic backend 延至 Phase 8 選型，搜尋索引不得成為 canonical Knowledge。
- **Consequences：** Phase 0 不引入 PostgreSQL、MongoDB、Elasticsearch 或 vector infrastructure；repository 不做多 DB 通用平台。

### ADR-002 — Next.js Modular Monolith

- **Context：** MVP 模組共享核心資料與 transaction，尚無拆服務需求。
- **Decision：** Next.js 同時提供 Web 與 server application；以程式模組隔離 domain，維持單體部署。
- **Consequences：** Web adapter 薄化，core 不依賴 UI；未來 consumers 共用 application services。

### ADR-003 — Tailwind CSS + shadcn/ui

- **Context：** Knowledge Workspace 需要可組合與可客製的 UI 基礎。
- **Decision：** 使用 React、TypeScript、Tailwind CSS、shadcn/ui；原選型以 Base UI 為預設方向，元件按需加入。
- **Consequences：** 不延續 Refine／Outline 架構，不預裝 Redux、Tiptap、dnd-kit 或整套 dashboard template。

### ADR-004 — Source-agnostic 與 Workspace/Source 邊界（revised by ADR-018）

- **Context：** 不同團隊使用不同 LLM Wiki generator，且跨公司組織的專案成員可能需要共同存取同一批 Knowledge。
- **Decision：** `User.org_code` 保留為 identity attribute；Knowledge hierarchy 使用 `Workspace → KnowledgeSource → Folder / Document Tree`；WorkspaceMembership 建立 basic access scope；每 Source 單一 Workspace，每 Document 都有 Source。
- **Consequences：** 不綁 Obsidian 格式；same org 不自動授權、cross org 不自動拒絕；Source content ownership 與 Workspace access 分離；完整 Workspace lifecycle/roles/governance 留 Phase 3。

### ADR-005 — 明確區分 Source-managed 與 Hub-managed

- **Context：** 外部 folder 與 Hub 同時可寫會形成同步衝突。
- **Decision：** FOLDER_SYNC 為 SOURCE_MANAGED 且 Hub 唯讀；FILE_UPLOAD／HUB 為 HUB_MANAGED，可建立新內容版本。
- **Consequences：** 不做雙向同步／merge；單篇上傳不自動覆蓋 folder 文件。

### ADR-006 — Tree、Document、Revision 分離

- **Context：** 檔案移動與內容更新有不同語意，引用不能隨 path 改變。
- **Decision：** Tree 管位置、Document 管 stable identity、Revision 保存 immutable title／Markdown／metadata。
- **Consequences：** Folder 不是空文件；path rename／move 不產生 revision，title 修改會產生 revision；來源 title 如何解析由 Phase 2 決定。

### ADR-007 — SourceEntry 保存來源 mapping

- **Context：** 外部來源未必提供 stable ID。
- **Decision：** 優先使用外部 stable ID；否則由 Hub 維護 SourceEntry mapping；path 是 locator。
- **Consequences：** 不要求 generator 提供指定 frontmatter ID；具體 fallback 演算法由 Phase 2 定義。

### ADR-008 — Archive-only lifecycle + current provenance

- **Context：** 來源缺檔可能是暫時的，文件引用與 revision history 必須保留；archive 是 MVP 的刪除語意，必須可追溯目前 actor/time。
- **Decision：** 使用 ACTIVE／ARCHIVED；MVP 不 hard delete；同 entry 重現恢復原 Document ID；lifecycle-bearing canonical entity 保存 `updated_by`、`archived_by`、`archived_at`。
- **Consequences：** 預設查詢排除 archived；restore 只有內容改變才建立 revision；完整多次 lifecycle audit history留 Phase 3。Workspace lifecycle 另由 Phase 3 明確設計。

### ADR-009 — Metadata-only assets

- **Context：** MVP 需要保留 Markdown 圖片／附件的來源資訊，但不擴張 storage 建置。
- **Decision：** 僅存 metadata/reference，不持久保存 binary。
- **Consequences：** 相對路徑可保留；不宣稱已提供圖片／附件服務，storage adapter 後續再加。

### ADR-010 — Folder Upload 與強制 Preview／Confirm

- **Context：** 同步會新增、修改、搬移或 archive 多筆資料，不能選完 folder 就直接改寫。
- **Decision：** 直接選取整個 folder，不用 ZIP；首次先選 Workspace 再建立 Source，後續明確選既有 Source；一律 Preview → Confirm → Apply。
- **Consequences：** Preview 不改 canonical Knowledge；Source 是 Tree root；sync 不提供隱式 Workspace transfer；Phase 0 定契約，Phase 2 完成匯入／同步。

### ADR-011 — Atomic Sync 與 Optimistic Source Version

- **Context：** 舊 Preview 及中途失敗可能破壞一致性。
- **Decision：** 以 sync_version 驗證 base version；整次 Apply 在單一 transaction；失敗全部 rollback，另記 FAILED。
- **Consequences：** 不 partial success、不 merge；相同內容不新增 revision；成功操作的 source version 與內容 revision 是不同計數。

### ADR-012 — 最小 Identity、CallerContext 與未來 SSO Adapter

- **Context：** 外部 MVP 開發不能依賴公司 SSO 環境，但 read/write service 需要穩定 caller-aware contract。
- **Decision：** UserIdentity 固定為 id、emp_id、name、org_code；使用 Local／Mock provider；transport 建立顯式 `CallerContext` 並作為 application service 第一參數；未來 SSO 映射至同一 identity contract。
- **Consequences：** Core 不解析 token，也不依賴 ambient request identity；org_code 不作 Knowledge ACL；Workspace policy 使用 resource scope；Phase 3 增加 production governance 而不大改 caller signature。

### ADR-013 — Human 與 Agent 共用 Application Core

- **Context：** 未來 MCP 需要取得同一份 Knowledge 與一致的 query／policy 行為。
- **Decision：** Knowledge 不依賴 Web／MCP；Sources 單向寫入 core，未來 Publishing／Retrieval／Agent 經 application services 接入並共用 Workspace policy。
- **Consequences：** 不建立平行資料存取邏輯；Phase 0 不實作 MCP、Agent actor model 或未來空模組。

### ADR-014 — 外部副作用隔離於 DB Transaction

- **Context：** MariaDB rollback 無法撤回外部發布或索引更新。
- **Decision：** 先提交 local state，再執行 explicit／background 外部操作並保存結果。
- **Consequences：** Phase 0 不引入 tKMS、index worker、queue 或 outbox implementation。

### ADR-015 — UUIDv7 + MariaDB native UUID

- **Context：** `CHAR(36)` random UUID 會放大 InnoDB PK/secondary-index footprint，且 random key locality 較差；目前尚未建表，調整成本最低。
- **Decision：** Application 產生 UUIDv7；MariaDB 10.11 使用 native `UUID` type。
- **Consequences：** 所有 stable entity ID/FK 型別一致，不手動管理 BINARY byte order，也不依賴 DB-side UUIDv7 function。WorkspaceMembership 為 association composite key。

### ADR-016 — READ COMMITTED canonical transactions

- **Context：** Tree/revision concurrency 依賴 locking reads，不能讓 correctness 建立在 REPEATABLE READ 舊 consistent snapshot 的隱性操作順序上。
- **Decision：** canonical Knowledge/Sources mutation UoW 使用 READ COMMITTED，並保留 Source/Document `FOR UPDATE` locks。
- **Consequences：** tests 必須用兩條真實 MariaDB connection 驗證 lock 後讀到最新 committed state；不能以 mock 或單連線替代。

### ADR-017 — One Document, One Knowledge TreeNode

- **Context：** Stable Document identity 若可同時出現在多個 DOCUMENT TreeNode，move、archive 與 SourceEntry mapping 語意會不唯一。
- **Decision：** `knowledge_tree_nodes.document_id` 對非 NULL 值建立 UNIQUE protection。
- **Consequences：** Folder 的 NULL 不受限制；Document move 更新同一 node，不刪除再建立第二個 node。

## 12. Self-review 與決策追溯

### 12.1 審查結果

| 審查面向 | 結果與已完成釐清 |
| --- | --- |
| Workspace canonical truth | 本 spec 已直接使用 Workspace → Source → Tree；不再要求讀者以 amendment 覆蓋本文 active org/source contract |
| Organization responsibility | `org_code` 僅是 User identity / governance input；same org != allow，cross org != deny |
| Workspace lifecycle owner | Phase 3 明確負責 provisioning/create、rename、archive/restore、membership/role administration；Phase 0 只建 foundation |
| 未定占位內容 | 無空白待填段落；未核准的實作選型明確交由 implementation plan 或相應 Phase，未偽裝成已決策 |
| 舊架構矛盾 | 新規格採已確認 stack，不沿用舊 HRKM Refine 依賴；早期 PostgreSQL／Elasticsearch 建議不列為 Phase 0 決策 |
| Rename 與 title | 明確區分 hierarchy rename 與版本化 title 修改；SOURCE_MANAGED Title Resolution 明確交由 Phase 2 |
| Ownership 儲存 | Source 為 content ownership 單一來源，Document 不重複保存；Source workspace scope 與 ownership 分離 |
| SOURCE_MANAGED 唯讀 | 區分 Hub 編輯與受控同步更新，application 層執行規則 |
| Caller boundary | UserIdentity 保持四欄位；CallerContext 顯式傳入 application service，Workspace policy 依 resource scope 驗證 |
| Actor model | Phase 0–2 lifecycle/created refs 仍指向 user；不提前引入 actor_kind/polymorphic FK |
| ID storage | UUIDv7 + MariaDB native UUID；不使用 CHAR(36) random UUID |
| Transaction isolation | Canonical mutation 明訂 READ COMMITTED，並保留 Source/Document row lock |
| Tree uniqueness | one-document-one-treenode 提前成為 Phase 0 DB invariant |
| Lifecycle provenance | ACTIVE/ARCHIVED 保持兩態；目前 archive actor/time 以 lifecycle fields 保存，完整 event history 留 Phase 3 |
| Preview 唯讀與 PREVIEWED 紀錄 | 區分 canonical state 與流程紀錄；首次 Source 不在選 folder 時留下半套正式資料 |
| FAILED 與 rollback | FAILED 紀錄在主交易回滾後另存，不依靠被回滾交易 |
| NOOP 與 sync_version | NOOP 指內容／Tree／archive 無變更；成功 Apply 仍保存 run 並遞增來源版本 |
| Schema 與階段範圍 | 十張 domain tables；sync_runs schema 在 Phase 0，完整操作流程在 Phase 2；preview contract 不強制新增 table |
| SourceEntry 身分 | 不把 path/hash 當作穩定文件 ID，不宣稱無 ID 的自動匹配已解決 |
| Module direction | Workspaces/Source scope、ownership policy 資料與 Sources ingestion 實作依賴分開，Knowledge 不反向依賴同步引擎 |
| Assets | metadata/reference 與 binary serving 明確分開，不暗中引入 filesystem storage |
| 測試與 DoD | Phase 0 以 domain／Workspace access／transaction fixtures 與最小 smoke 驗收，不要求完整 governance、authoring 或 sync UI |
| 範圍擴張 | 沒有新增 SSO、完整 ACL 平台、ZIP、editor、publishing、MCP、search/vector、memory、queue、Agent actor model 或 hard delete implementation |

### 12.2 決策來源對照

以下對照均可在文件開頭連結的原對話與 Workspace amendment 查閱：

| 已確認討論 | 本規格位置 |
| --- | --- |
| MariaDB 10.11、Next.js modular monolith、使用 shadcn | §3；ADR-001～003 |
| UUIDv7、native UUID 與 transaction isolation clarification | §3.1、§6.4、§7；ADR-015～016 |
| Organization identity 與 Workspace access boundary、cross-org collaboration | §4.1、§5、§6.1A；ADR-004/018 |
| Folder 唯讀、單篇上傳／Web 建立可編輯 | §4.2；ADR-005 |
| Tree／Document／Revision、SourceEntry、title／Markdown／metadata 版本化 | §4.3～4.4、§5；ADR-006～007、017 |
| 不 hard delete、同 entry 重現沿用 ID、lifecycle provenance、只保存 asset metadata | §4.5～4.6；ADR-008～009 |
| Folder 非 ZIP、首次選 Workspace/建立 Source、後續選 source、強制 Preview | §7.2～7.3；ADR-010 |
| Application / Module Boundary、CallerContext、Workspace policy | §6；ADR-012～013、018 |
| Transaction / Error Boundary + Sync Safety Baseline | §7；ADR-011、014、016 |
| Identity 精簡為四欄位、外部 mock、公司後補 SSO | §6.1；ADR-012 |
| Testing Strategy + Definition of Done | §8～9 |

本次完成的是上述決策的 current canonical Markdown Design Spec 與 self-review。後續 Implementation Plan 應依本規格拆解工作與驗證步驟，不把文件完成等同 Phase 0 程式實作完成。
