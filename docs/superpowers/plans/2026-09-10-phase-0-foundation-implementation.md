# Knowledge Hub — Phase 0 Foundation Implementation Plan

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-10 |
| 主要專案 | `/Users/chuntsai/Projects/HCM-KM/` |
| 依據 | [Phase 0 Foundation & Architecture Design](../specs/2026-09-10-phase-0-foundation-architecture-design.md) |
| 文件狀態 | Approved implementation plan；已整合 Workspace access-boundary correction；尚未宣稱程式驗收完成 |
| 工作範圍 | Phase 0 foundation；不提前執行 Phase 1–9 的完整產品功能 |

## 1. 預期成果與起點

完成本計畫後，開發者可以啟動本地 MariaDB 10.11 與 Next.js，使用 server 提供的 Local Identity 建立可信 `CallerContext`，列出 caller 可存取的 Workspace，在 Workspace 內選擇 Source，建立一份 HUB_MANAGED 文件、讀取內容，並透過 `Workspace → Source → Folder/Document Tree` 找到同一份文件。Domain、repository 與 transaction 測試必須證明 UUIDv7 stable ID、Workspace membership foundation、immutable revision、Source ownership、archive／restore provenance、one-document-one-treenode 與 source version guard 的規則。

本計畫以目前 canonical design 為準：`User.org_code` 是公司組織 identity attribute；Knowledge access 不以 org equality 判斷。每個 KnowledgeSource 必須屬於一個 Workspace，跨 org User 可透過 WorkspaceMembership 共用同一 Workspace，同 org non-member 不自動取得 access。

執行時先重新檢查 working tree；保留使用者後續新增內容。若開始程式實作，使用 Phase 0 implementation branch/worktree 承接現有文件。本計畫本身不要求直接部署公司 production；Phase 0–2 的 Workspace membership guard 是 local/mock MVP foundation，正式公司 multi-user governance 由 Phase 3 完成。

### 1.1 驗收邊界

- 最小 Web flow 需要 Workspace selector、Source selector、基本 title／Markdown 輸入、文件讀取與可展開的 Tree。
- Workspace selector 只顯示 `listWorkspaces(caller)` 結果；UI 選擇不是 authorization evidence，resource operation 仍由 application 反查 Source → Workspace 做 policy check。
- Revision 更新、archive／restore、hierarchy mutation 在 application 層與測試中驗證；本階段不需要完整管理 UI。
- SourceEntry、KnowledgeAsset、SyncRun 建 schema 與必要 repositories；使用 fixtures 驗證 mapping 與 transaction，不建 Folder scanner、parser、Title Resolution、diff engine 或 Sync UI。
- SOURCE_MANAGED 不接受一般 Hub 寫入；受控來源更新只保留可共用 transaction 的內部 operation 邊界。
- Workspace provisioning/rename/archive/restore UI、roles/capabilities、membership administration、Team/SSO Group mapping 與 granular ACL 不在 Phase 0；Phase 3 負責。
- Phase 0–2 actor 仍為 `UserIdentity`；不加入 `actor_kind`、Agent Principal、service account 或 polymorphic actor FK。
- 不加入 Refine、Outline、Redux、Tiptap、dnd-kit、Elasticsearch、MCP、Vector／Embedding、tKMS、binary storage、queue／outbox、hard delete 或企業 SSO。

## 2. 本計畫採用的實作選擇

以下是 design spec 授權留給 implementation plan 的落地選擇，不改寫既有產品決策。

| 項目 | 選擇 | 原因與界線 |
| --- | --- | --- |
| Web runtime | Next.js App Router、Node.js runtime | DB connector 留在 server；不使用 Edge runtime 存取 MariaDB |
| Package manager | npm，提交 `package-lock.json` | 單一套件管理工具，讓安裝可重現 |
| Runtime pin | T01 選定符合 Next.js／Vitest engines 的受支援 Node LTS，寫入 `.node-version` 與 `package.json` engines | 開始實作時解析實際版本，不把浮動 latest 當成可重現版本 |
| Frontend | TypeScript strict、Tailwind、shadcn/ui Base UI | 只加入實際使用的 Button／Input／Textarea／Label 等元件 |
| DB access | 官方 `mariadb` Node.js connector、parameterized SQL | 清楚控制複合外鍵、row locks 與 connection transaction；本階段不引入 ORM |
| Migration | 排序的 TypeScript migration modules，內含明確 SQL statement arrays；`tsx` runner | 不以分號切 SQL，也不宣稱 DDL 可以整批 rollback |
| Local DB | Docker Compose 的 `mariadb:10.11`；執行時記錄實際 patch／image digest | dev、integration、E2E 各有獨立 database；只對 localhost 暴露 |
| Tests | Vitest：unit／真實 DB integration；Playwright：Chromium smoke | Unit 不啟動 Next.js；E2E 驗證實際 Web adapter |
| IDs | application 產生 UUIDv7；MariaDB 使用 native `UUID` type | Stable entities 使用一致 UUID contract；WorkspaceMembership 用 composite association key |
| Caller | transport 由可信 `IdentityProvider` 建立 `CallerContext { identity }`，顯式作為 application service 第一參數 | CallerContext 不固定攜帶單一 workspace；同一 caller 可存取多 Workspace |
| Workspace access | Phase 0 以 WorkspaceMembership 實作 basic membership guard | same org != allow、cross org != deny；production roles/capabilities 留 Phase 3 |
| Transaction isolation | canonical Knowledge/Sources mutation 統一 `READ COMMITTED`，搭配 Source/Document `FOR UPDATE` | 不依賴 REPEATABLE READ 舊 snapshot 或「locking read 必須第一句」的脆弱順序 |
| Lifecycle provenance | lifecycle-bearing canonical rows保存 `updated_by`、`archived_by`、`archived_at` | 可追溯目前 archive actor/time；完整 append-only history 留 Phase 3 |
| Content fingerprint | SHA-256 over deterministic serialization of `{title, markdown, metadata}` | 包含三個版本欄位，排除 hierarchy；不新增 fuzzy matching |
| Version counter | `INT UNSIGNED`，`sync_version` 從 0 開始；溢位拒絕、不回繞 | Phase 0 使用可安全表達的 JS integer；成功 Apply fixture 才遞增 |
| Lifecycle / enums | 字串欄位加 CHECK | ACTIVE／ARCHIVED 與 SyncRun 三態分開；source type／ownership 組合受約束 |
| UI content | 以 React escaped text 顯示 Markdown 原文 | 足以完成 create/read smoke；不需 rich editor、HTML renderer 或外部圖片服務 |

T01 應在選定版本後鎖定依賴，不要求目前先安裝套件。Next.js 官方提供 TypeScript、App Router、Tailwind 的建立路徑；lint 使用 ESLint CLI，不能只依賴 build 代替 lint。[Next.js installation](https://nextjs.org/docs/app/getting-started/installation)

shadcn 元件依官方 Next.js 安裝流程加入既有 application，保留 Base UI 選型，不以 dashboard template 取代本專案結構。[shadcn/ui Next.js](https://ui.shadcn.com/docs/installation/next)

## 3. 實作順序與交付單位

```text
T01 Application skeleton
  → T02 Local DB / migration infrastructure
  → T03 Core schema / constraints
  → T04 Domain rules / ports
  → T05 MariaDB repositories / transaction implementation
  → T06 Local identity / Workspace fixtures
  → T07 Knowledge application operations
  → T08 Source version / cross-module safety fixtures
  → T09 Minimal Web flow
  → T10 Full acceptance / handoff evidence
```

順序採單一執行流程，不要求平行代理或每個小步驟都 commit。T04 的純 domain 工作不依賴 DB 完成，但 T07 以前必須把 schema、repository、Workspace access 與交易整合起來。

| Task | 完成後可檢查的交付 | 對應 Design Spec |
| --- | --- | --- |
| T01 | 可 build 的 Next.js 骨架與測試／lint scripts | §3、§6、§9 |
| T02 | 可啟動的 MariaDB、可重跑的 migration 管理 | §5、§8.2 |
| T03 | 十張 domain tables、native UUID 與 referential／unique／CHECK constraints | §5、§5.1 |
| T04 | Identity/Workspace/Knowledge/Source domain models、CallerContext、ports 與 unit tests | §4、§6、§8.1 |
| T05 | SQL repositories、Workspace policy、READ COMMITTED same-connection transaction 與 rollback tests | §6.4、§7.1 |
| T06 | 四欄位 Local Identity、Workspace/Membership seed 與 cross-org fixtures | §6.1、§6.1A |
| T07 | caller-aware create／read／update／lifecycle／hierarchy 最小 application operations | §4、§6.2、§7.1 |
| T08 | Mapping／reappearance／optimistic version／跨 repository 原子性與 Workspace guard 證據 | §7.4～7.6、§8.2 |
| T09 | Workspace → Source → Tree 最小 Web flow 與 smoke E2E | §8.3 |
| T10 | 全部驗收結果與 Phase 1／2／3 接手說明 | §9～10 |

## 4. 必須先落實的資料與交易細節

### 4.1 十張 domain tables 與 migration ledger

Domain tables：

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

Migration runner 另建 `schema_migrations` 作為工具 ledger，保存版本、checksum、執行狀態與時間。這不是第十一個產品 domain table，也不能拿來存 Preview 或 audit 功能。Migrations 採 forward-only；開發中的失敗在專用 disposable DB 重建驗證，既有非測試 DB 只採明確修復步驟。

全部 domain tables 使用 InnoDB。Stable entity ID/FK 欄位統一使用 MariaDB native `UUID` type；application 端產生 UUIDv7。WorkspaceMembership 使用 `(workspace_id, user_id)` composite key。文字內容使用 utf8mb4；時間統一 UTC、`DATETIME(6)`；revision Markdown 用 LONGTEXT；knowledge metadata 用 JSON。

### 4.2 關聯、唯一性與 lifecycle provenance

| 規則 | 計畫實作方式 |
| --- | --- |
| Workspace membership | `workspace_memberships.workspace_id` → Workspace、`user_id` → User；PK `(workspace_id,user_id)`；同 user 可加入多 Workspace |
| Source Workspace scope | `knowledge_sources.workspace_id` NOT NULL FK → workspaces.id；Source 不保存 `org_code` 作 access ownership |
| Source content ownership | `source_type` + `ownership` CHECK 限定合法三種來源組合；與 Workspace access 分開 |
| Revision 歸屬 | `knowledge_revisions.document_id` → Document；UNIQUE `(document_id, revision_no)`，revision_no 從 1 起 |
| 操作者 reference | Source／Document／Revision 的 created_by、lifecycle-bearing row 的 updated_by/archived_by 與 SyncRun.triggered_by 指向 users.id；Phase 0 不引入 polymorphic actor |
| Current revision 歸屬同一文件 | Revision 增加 UNIQUE `(document_id, id)`；Document 的 `(id, current_revision_id)` 複合 FK 指向它 |
| 同 Source reference | Document 增加 UNIQUE `(source_id, id)`；Tree／SourceEntry 的 `(source_id, document_id)` 指向此 key |
| One Document → One TreeNode | `knowledge_tree_nodes.document_id` 對非 NULL 值 UNIQUE；Folder 的 NULL 不受限制 |
| Tree parent 同 Source | Tree 增加 UNIQUE `(source_id, id)`；`(source_id, parent_id)` 自引用，null 表示 Source 根層 |
| Tree node type | FOLDER：非空 name 且 document_id 為 null；DOCUMENT：document_id 非 null，名稱由 revision title 取得 |
| 已有 external identity | SourceEntry UNIQUE `(source_id, external_id)`；external_id 為可空且區分大小寫的 opaque value，非空值不可為空字串 |
| 無 external identity 的 mapping | SourceEntry 自身 stable `id` 為 Hub mapping key；UNIQUE `(source_id, document_id)` 避免同文件被重複 mapping，folder 的 null document_id 不受此限制 |
| Lifecycle provenance | Source／Entry／TreeNode／Document 保存 `updated_by`、`archived_by nullable`、`archived_at nullable`；archive/restore 與 status 同交易更新 |
| Revision immutability | Repository 僅提供 insert/read，沒有 update/delete revision 方法；application 測試確認舊版本完全不變 |

SourceEntry 的 nullable external ID 不保證能識別所有新輸入；Phase 0 只防止已識別 identity 重複配置。不同 external IDs 即使內容相同也可存在；相同文字不能觸發合併。`source_path` 保存 locator，但不做全域 identity／content-hash 唯一鍵。Folder／Document entry 使用相應 `entry_type`；asset metadata 留在 `knowledge_assets`。

本計畫選擇欄位長度：users 的 `org_code`／`emp_id` 為 `VARCHAR(128)`，name／title 為 `VARCHAR(512)`，external_id 為 `VARCHAR(512)`、utf8mb4 binary collation，source_path 為 TEXT。`org_code` 不存在於 `knowledge_sources`。入口遇到超長值應回報 validation failure，不截斷識別值。

SOURCE_MANAGED canonical title 的來源優先序不在 Phase 0 設計：filename/path 不自動等於 Knowledge title；Phase 2 必須定義 frontmatter、Markdown heading、filename 等候選來源的 Title Resolution 與衝突裁決。

FK 採限制性刪除／更新行為，不配置刪除整串 revision 的 cascade。核心資料沒有公開 hard-delete repository operation；測試資料庫的隔離清理不屬於產品 hard delete。

MariaDB 提供 FK、UNIQUE 與 CHECK 約束；DDL 使用明確且在整個 schema 唯一的 constraint 名稱。nullable 關聯與跨列條件仍須搭配 application 驗證。[MariaDB constraints](https://mariadb.com/docs/server/reference/sql-statements/data-definition/constraint)、[Foreign keys](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/optimization-and-indexes/foreign-keys)

### 4.3 Document／Revision 循環外鍵

Migration 先建立 Document（`current_revision_id` nullable）、再建立 Revision，最後加上同文件 current-revision FK。建立流程在同一交易依序：

```text
insert Document with temporary null current_revision_id
insert Revision R1
set Document.current_revision_id = R1
insert DOCUMENT TreeNode
assert created Document has a valid current revision
commit
```

這是 physical insertion 順序，不修改 domain 的完成條件。Composite FK 防止「指向另一份文件的 revision」；nullable bootstrap 本身無法在 SQL 層禁止所有未完成列被 commit，因此 Document repository 不對 Web 暴露獨立 create，application create operation／transaction pre-commit assertion 必須保證完成後才回傳。要分別測試外鍵保護與 application 完整性，不能把兩者宣稱為單一 DB constraint 已全面解決。

### 4.4 Transaction composition、CallerContext 與 Workspace access

Knowledge 在自己的 ports 定義 `KnowledgeUnitOfWork.run(work)`，callback 取得該交易綁定的 document／revision／tree repositories 與可信 Source view/policy；Sources 的 transaction port 可在此基礎加入 SourceEntry／asset／SyncRun／source-version repositories。Workspace access policy 是獨立 foundation boundary，不由 UI 或 Sources scanner 決定。

MariaDB infrastructure 每次 canonical mutation UoW 必須先設定本次 transaction 為 `READ COMMITTED`，再取得同一條 connection 上的 begin → callback → assertions → commit；失敗 rollback；finally release。所有 transaction-bound repository 都綁同一 connection，不能改用 `pool.query()` 跳出交易。官方 connector 提供相應 connection transaction methods。[MariaDB Node.js Promise API](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/connector-nodejs-promise-api)

`CallerContext` 固定由 transport/server boundary 以可信 `IdentityProvider` 建立：

```ts
type CallerContext = {
  identity: UserIdentity;
};
```

Public Workspace/Knowledge/Sources application service 都把 `caller` 作為顯式第一參數。對 existing Source/Document/Tree resource 的操作，application 必須從 authoritative relationship 取得 `workspace_id` 再做 membership/policy check；client 額外傳入 workspaceId 不能作授權 proof。Internal mutation functions 接受已解析的 trusted execution context／repositories，不自行從 request/global state 取 identity，也不自行 commit。

Phase 0 foundation port 至少可表達：

```ts
interface WorkspaceAccessPolicy {
  requireMembership(caller: CallerContext, workspaceId: string): Promise<void>;
}
```

完整 role/capability policy 在 Phase 3 設計；Phase 0 不以 `caller.identity.org_code === source.org_code` 或類似 shortcut 取代 membership。

Source policy/view 至少查 `source.id`、`source.workspace_id`、ownership、status。Composition root 位於 `src/server/`，負責注入實作。

### 4.5 Hierarchy、revision 與併發

Phase 0 mutation 先解析 Source 所屬 Workspace 並通過 foundation access，再以 Source row 為 serialization boundary，按 Document ID 固定順序取得必要 row locks。Tree move 在持有 Source lock 時驗證 parent 同 Source、parent 為 Folder、非自己或後代，防止兩個各自看似合法的 move 合併成 cycle。

Canonical mutation 使用 READ COMMITTED，因此 source/document locking read 後的後續讀取不依賴較早建立的 REPEATABLE READ consistent snapshot。仍必須明確取得 Source/Document `FOR UPDATE` lock；READ COMMITTED 不是 row lock 的替代品。

一般 Hub 內容更新在鎖內讀取 current revision、比較內容、分配下一個 revision_no 並插入。這避免重複編號／部分 pointer 更新；不等於已提供 Phase 5 的多使用者 stale-editor conflict UX。

Source row lock 不自動增加 sync_version。僅受控的成功 source Apply 操作會遞增，其他 Hub-managed 更新不冒充同步。

### 4.6 Source version guard

既有 Source 的 guard 在 caller 通過該 Source Workspace access 後，以條件 UPDATE 保護預覽的 base version：

```sql
UPDATE knowledge_sources
SET sync_version = sync_version + 1
WHERE id = ?
  AND sync_version = ?
  AND source_type = 'FOLDER_SYNC'
  AND ownership = 'SOURCE_MANAGED'
  AND status = 'ACTIVE';
```

影響列數必須為 1，否則整個 callback 不得進行 Knowledge writes，回報找不到來源／不可同步／版本已變的對應錯誤。Version increment、Knowledge writes、mapping 與 APPLIED record 都在同一 READ COMMITTED transaction；後續失敗時版本也 rollback。需要來源 lock 的內部 operation 可使用此交易已取得的 lock。

這是 foundation primitive 與 integration fixture；Phase 0 不暴露 Confirm API、不建 Preview storage、不掃描 folder。全 unchanged 的成功 Apply fixture 只遞增 source version／記 run，不新增 revision 或變動 Tree。FAILED 紀錄的獨立交易存活性可用 fixture 驗證，完整錯誤流程交由 Phase 2。

## 5. 執行任務

### T01 — 建立 Next.js 與工具骨架

**依賴：** 無。**交付：** 可以安裝、typecheck、lint 與 build 的最小 application。

預計新增：`package.json`、`package-lock.json`、`.node-version`、`tsconfig.json`、`next.config.ts`、`eslint.config.mjs`、`postcss.config.mjs`、`components.json`、`.gitignore`、`src/app/layout.tsx`、`src/app/page.tsx`、`src/app/globals.css`、`vitest.config.ts`、`vitest.integration.config.ts`。

工作：

1. 檢查工作目錄與文件，進入工作分支；不要在已有 `docs/` 的 root 直接用會清空／覆寫目錄的 scaffold 指令。
2. 依官方流程建立 App Router、strict TypeScript、Tailwind；若工具要求空目錄，使用暫存骨架並只搬入確認過的必要檔案，不覆寫既有文件。
3. 選定 Node LTS 與相容依賴，鎖定實際版本；加入官方 mariadb driver、Vitest、Playwright、tsx 與必要 lint tooling；加入 application-side UUIDv7 generator，禁止以 DB random UUID 或 `Math.random()` 產生 domain ID。
4. 建立 script contracts：`dev`、`build`、`start`、`lint`、`typecheck`、`test:unit`、`test:integration`、`test:e2e`、`db:migrate`、`db:seed`。DB/E2E scripts 可在對應任務接線，但不得以空成功 script 冒充通過。
5. ESLint 限制 module domain/application 引入 React／Next.js／database infrastructure；限制 Knowledge 引入 Sources implementation，限制 UI 直接 import mariadb repositories。`src/server/` 為 composition root 的允許位置。

驗證：`npm run typecheck`、`npm run lint`、`npm run build`；未使用 DB 的空 shell 不應要求本地 DB 可連線。確認 dependency manifest 沒有已排除套件或未來空模組。

### T02 — Local MariaDB 與 migration runner

**依賴：** T01。**交付：** 可啟動 DB、管理版本與隔離測試的工具。

預計新增：`compose.yaml`、`.env.example`、`scripts/db/migrate.ts`、`scripts/db/test-database.ts`、`scripts/test/integration.ts`、`src/infrastructure/database/mariadb/config.ts`、`pool.ts`、`migrations/`、`tests/integration/migration-runner.test.ts`。

工作：

1. Compose 設置 MariaDB 10.11、healthcheck、dev volume 與 localhost port；README 使用 `docker compose up -d --wait`。T02 不建立 application container 或部署平台。
2. 使用 `KM_DB_*`、`KM_TEST_DB_*` 與獨立 E2E env 設定，`.env.example` 只提供本地示例；實際密碼不提交。測試工具拒絕拿 dev DB 當 reset target。
3. Runner 建 ledger、按順序執行 migration 的 SQL arrays，記錄 checksum；已完成版本不重跑，checksum 不符或有未完成版本則停止並顯示診斷，不自動忽略錯誤。
4. Migration 連線取得專用互斥 lock，避免兩個 runner 同時套 schema；runner 結束釋放。每個 module 只在全部 SQL 成功後標完成。
5. DDL 失敗可能留下部分 schema，不用包一層 transaction 假裝可以整批還原。測試 runner 的失敗診斷與乾淨 test DB 的重建方式。

DDL 會造成 implicit commit，所以 canonical-state rollback 的測試不能夾帶 migration／TRUNCATE 等 DDL。[MariaDB implicit commit](https://mariadb.com/docs/server/reference/sql-statements/transactions/sql-statements-that-cause-an-implicit-commit)

驗證：啟動 DB，確認 server version 為 10.11.x；runner 在新 test DB 建 ledger；重跑不重複執行；失敗與 checksum mismatch 回傳非零 exit status。所有 test reset 只處理本次產生且名稱受限制的 test databases。

### T03 — 建立核心 schema 與 constraints

**依賴：** T02。**交付：** design spec 十張 domain tables、native UUID、Workspace scope、lifecycle provenance 與 SQL 保護／schema tests。

預計新增：`src/infrastructure/database/mariadb/migrations/001-core.ts`、`002-current-revision.ts`、`tests/integration/schema.test.ts`。

工作：

1. 依序建立 users → workspaces → workspace_memberships → sources → documents → revisions → tree／entries／assets／runs；所有 stable entity ID/FK 使用 MariaDB native `UUID`；第二個 migration 補上 current-revision 複合 FK。
2. Workspace 最小欄位：`id UUID PK`、`name`、`created_at`、`updated_at`；Phase 0 不加入 owner_org_code、slug、role、Workspace lifecycle。
3. WorkspaceMembership：`workspace_id` FK、`user_id` FK、`created_at`、PK `(workspace_id,user_id)`，並加 user→workspace 查詢索引。
4. `knowledge_sources.workspace_id UUID NOT NULL` FK → workspaces.id；不建立 `knowledge_sources.org_code`。Source sync_version 預設 0，Document／Tree／Entry／Source lifecycle 僅 ACTIVE／ARCHIVED。
5. SyncRun 允許 PREVIEWED／FAILED 的 `result_version` 為 null；APPLIED 必須有完成時間與有效 result version；不加入額外 Knowledge lifecycle。
6. 為 Source tree、current document lookup、source entry external identity、Workspace membership lookup 與 revision history加必要索引，不預建 full-text/vector index。
7. 依 §4.2 加上複合 FK、CHECK、UNIQUE；特別加入 `UNIQUE(knowledge_tree_nodes.document_id)` 的非 NULL protection。
8. `updated_by`／`archived_by` 指向 users.id；ACTIVE row 的 `archived_by`／`archived_at` 必須為 null，ARCHIVED row 必須有對應 archive provenance。

驗證：從空 DB 完整 migration；建立不同 org users 共用 Workspace 的 fixture；invalid workspace Source、duplicate membership、錯誤 source reference、錯誤 current revision、重複 revision_no／external identity、同 Document 第二個 TreeNode、FOLDER 帶 document_id、DOCUMENT 無 reference 均失敗。相同 external_id 可在不同 Source 出現；多筆 null external_id 可存在；asset table 沒有 binary storage 欄位。

### T04 — Domain models、CallerContext、Workspace policy 與 ports

**依賴：** T01；schema 欄位以 T03 為準。**交付：** 純 domain tests 與可注入 dependencies 的介面。

預計新增：

```text
src/modules/identity/domain/user-identity.ts
src/modules/identity/application/caller-context.ts
src/modules/identity/ports/identity-provider.ts
src/modules/identity/ports/user-repository.ts
src/modules/workspaces/domain/workspace.ts
src/modules/workspaces/domain/workspace-membership.ts
src/modules/workspaces/ports/workspace-repository.ts
src/modules/workspaces/ports/workspace-membership-repository.ts
src/modules/workspaces/ports/workspace-access-policy.ts
src/modules/workspaces/application/workspace-query-service.ts
src/modules/knowledge/domain/{document,revision,tree-node,content,lifecycle,errors}.ts
src/modules/knowledge/ports/{document-repository,revision-repository,tree-repository,source-policy,unit-of-work}.ts
src/modules/sources/domain/{source,source-entry,asset,sync-run}.ts
src/modules/sources/ports/{source-repository,entry-repository,asset-repository,sync-run-repository,unit-of-work}.ts
tests/unit/{content,ownership,lifecycle,tree,source-mapping,caller-context,workspace-access}.test.ts
```

工作：

1. UserIdentity 精確四個 string 欄位；CallerContext 精確為 `{ identity: UserIdentity }`；`org_code` 是 identity attribute，不直接作 Workspace allow/deny。
2. 定義 Workspace/Membership model 與 `WorkspaceAccessPolicy.requireMembership(caller, workspaceId)` foundation port；`WorkspaceQueryService.listWorkspaces(caller)` 只回 caller memberships。
3. Source model 使用 `workspace_id` + source type/ownership；source type 與 ownership 透過 domain validation 限制合法組合。禁止 `source.org_code` authorization shortcut。
4. 定義 title／Markdown／JSON metadata 的 canonical input。Metadata object keys 遞迴排序，array 保持順序；拒絕 undefined／NaN 等非 JSON 值。字串原樣保存，不 trim 正文或偷偷改換行。Object key 順序不同不應形成新 revision。
5. 比較 canonical representation 決定是否變更，再產生內容 hash；metadata 與 title 不能被漏掉。UUIDv7 generator 與 clock 可注入供測試，不影響 domain identity 定義。
6. 定義同文件更新、rename／move、archive／restore、lifecycle provenance 與已知 mapping reappearance 的規則；不知道 external identity 時不猜同一文件；不知道 SOURCE_MANAGED title rule 時不從 filename/path 猜 title。
7. 以少量 domain/application error 類型表達 validation、not found、workspace access denied、source read-only、version conflict、integrity failure；不把 SQL driver error 輸出給 UI。
8. 定義 §4.4 的 UoW 與 ports；public application ports 顯式接收 CallerContext，不建立 database-neutral 巨型 repository framework。

驗證：unit tests 涵蓋 cross-org membership allow、same-org non-member deny、multi-workspace membership、org_code change 不重寫 membership，以及 title-only、metadata-only、body-only、identical input、metadata key-order、path-only、restore、archive provenance。SOURCE_MANAGED 的 Hub mutations 被拒絕。CallerContext 不允許從 command/query payload 覆寫 identity。

### T05 — Repositories、Workspace access 與 READ COMMITTED 同連線 transaction

**依賴：** T03、T04。**交付：** 真實 DB 的資料存取、access guard、atomicity、isolation 與錯誤轉換。

預計新增：`src/infrastructure/database/mariadb/transaction.ts`、`repositories/{users,workspaces,workspace-memberships,sources,documents,revisions,tree,entries,assets,sync-runs,source-policy}.ts`、`tests/integration/{repositories,transactions,workspace-access}.test.ts`。

工作：

1. 所有 writes 使用 parameterized SQL；在 repository 邊界轉換 JSON／UTC time／nullable values，驗證 counter 為合法 integer；UUID column 對外仍以標準 UUID string 表達。
2. 實作 Workspace/Membership repositories 與 foundation policy；cross-org member allow、same-org non-member deny。直接知道 workspace/source/document UUID 不代表 access。
3. 實作一條 connection 綁定一組 repositories 的 UoW；每次 canonical mutation 在 begin 前設定 `READ COMMITTED`；所有 callback promise 必須 await，callback 失敗 rollback，connection 用完 release。
4. 實作 source lock、document lock、read／insert revision、set-current、Tree 更新與必要 mapping/run 操作。Source view 包含 workspace_id/ownership/status。
5. SQL duplicate／foreign-key／CHECK failures 轉為穩定 application error；保留 server-side diagnostic，但不記錄完整 Markdown、密碼或 token。
6. 建立流程的 pre-commit assertions 驗證本次建立文件有合法 current revision，且 Document 只有一個 DOCUMENT TreeNode。Repository 的 revision API 不提供 overwrite／delete。

驗證：真實 DB 逐點注入失敗；每次用另一條連線確認無孤兒資料。另以兩條 connection 驗證 READ COMMITTED + `FOR UPDATE`。新增 direct-resource lookup 測試，證明 non-member 不能藉已知 Source/Document UUID 取得資料。

### T06 — Local Identity、Workspace/Membership 與可重複使用 fixtures

**依賴：** T05。**交付：** 固定四欄位身分、可信 caller、最小 Workspace 資料與非 Web 測試入口。

預計新增：`src/modules/identity/application/get-current-identity.ts`、`src/infrastructure/identity/local-identity-provider.ts`、`src/server/composition.ts`、`src/server/config.ts`、`scripts/db/seed.ts`、`tests/unit/local-identity.test.ts`、`tests/integration/identity.test.ts`、`tests/fixtures/knowledge.ts`。

工作：

1. Local provider 從 server-only 設定取得固定測試身分，回傳 `{id, emp_id, name, org_code}`。缺少欄位／未啟用 local mode 即明確失敗，不接受 query、form 或 header 任意提供 identity。
2. Server/transport adapter 以 Local Identity 建立 `CallerContext { identity }` 後傳入 application service；domain/application 不直接 import request-specific identity provider。
3. `users` 以 UUIDv7 stable id／unique emp_id 對齊，更新 name／org 不重建 id，也不自動增刪 WorkspaceMembership。
4. 用明確 `KM_LOCAL_IDENTITY_ENABLED` 配置啟用本機示範與 E2E；沒有 Company SSO 的版本不當公司 production identity。
5. Development seed 建 Local User、Workspace `Local Knowledge`、Membership `Local User → Local Knowledge`、一個 HUB_MANAGED Source 與一個 Folder；seed 使用固定合法 UUID 值確保重跑不複製資料。
6. Integration fixtures 至少：User A(org HRSD)、B(org RD)、C(org IT)；Workspace X/Y；A→X、B→X、B→Y、C→none；X 有 Hub/Folder Source，Y 有 Hub Source。驗證 A sees X、B sees X/Y、C 知道 UUID 仍不得 access。
7. `src/server/composition.ts` 注入 identity、Workspace query/policy、UoW 與 repositories；只有 server adapters import 此檔，domain 不 import composition。

驗證：provider 四欄位、CallerContext 建立、缺少設定失敗、工號碰撞拒絕、使用者更新保留 id；seed 執行兩次不增加重複 Workspace/Membership/Source/Folder。偽造前端 emp_id／org_code 不影響實際 caller。

### T07 — Knowledge Application Operations

**依賴：** T05、T06。**交付：** 可被 Web 與非 Web caller 重用的最小核心行為。

預計新增：`src/modules/knowledge/application/{queries,commands,mutations}.ts`、`tests/integration/{knowledge-application,knowledge-lifecycle,knowledge-tree,workspace-access}.test.ts`。

工作：

1. Public application operations 以 `caller: CallerContext` 作第一參數；`createHubManagedDocument(caller, input)` 由 sourceId load Source → 解析 `workspace_id` → require Workspace membership → 驗證 HUB_MANAGED Source／parent，再執行原子建立流程。
2. `getDocument(caller, ...)`／`getCurrentRevision(caller, ...)`／`listTree(caller, ...)` 由 resource relationship 反查 Workspace，先做 access check，再處理 archived filtering；不相信額外 workspaceId 作 proof。
3. `createRevision(caller, input)`：先做 Workspace access + HUB_MANAGED/ACTIVE validation，再鎖 Document、比較內容；有變更才 insert next revision + update pointer。
4. `archiveDocument`／`restoreDocument`：Hub-managed 的一般操作與受控來源內部操作分開；先做 Workspace access，再維護 Document/Tree/SourceEntry lifecycle provenance。
5. 最小 `moveTreeNode`／`renameFolder`／`reorderNode`：同 Source 內驗證，SOURCE_MANAGED 的一般 Hub 操作拒絕；操作不改 Document ID、Revision 或 Workspace。
6. 受控來源使用的內部 Knowledge mutation由 Sources caller 在已通過 Source Workspace access 後呼叫；Knowledge 不 import matching 實作。
7. 核心 command/query 不 import Next.js；不存在 UI 傳入 caller、org_code、workspace proof、actor_kind、isSync 或 ownership mode 的 bypass path。

驗證：除既有 stable ID/revision/tree/lifecycle cases 外，加入 cross-org member 可以操作其被允許的 foundation scope、same-org non-member 拒絕、direct document URL/UUID 不繞過 policy。

### T08 — SourceEntry 與 Sync Safety Foundation

**依賴：** T07。**交付：** 未來同步依賴的 concurrency／mapping／rollback／Workspace guard 保證。

預計新增：`src/modules/sources/application/source-version-guard.ts`、`tests/integration/{source-version,source-mapping,cross-module-atomicity,workspace-access}.test.ts`、`tests/fixtures/source-operations.ts`。

工作：

1. Sources application guard先 load Source → resolve `workspace_id` → require Workspace membership，再經 source-repository port 呼叫 §4.6 condition-update；SQL 放在 MariaDB repository。
2. 使用已解析且已知 mapping 的 fixture，在交易中執行 Document／Revision／Tree 更新、SourceEntry lifecycle provenance／asset metadata 寫入、source version 遞增與 APPLIED run 保存。
3. 用兩條獨立 DB connection 與測試 barrier 同時以 base version N 嘗試 Apply fixture；不可用同一 connection 模擬 concurrency。
4. 驗證 rollback、FAILED 獨立紀錄、reappearance、all-unchanged semantics 與舊 Preview version invalidation。
5. Unauthorized caller 不得進入 source projection flow，即使知道 sourceId；Workspace access failure 不產生 Knowledge/SyncRun writes。

完整 scanner／Preview／Confirm route 仍在 Phase 2。

### T09 — 最小 Web Flow 與 E2E

**依賴：** T07、T08。**交付：** 可由人操作的 foundation 與一條完整 smoke flow。

預計新增：

```text
src/app/knowledge/page.tsx
src/app/knowledge/[documentId]/page.tsx
src/app/knowledge/actions.ts
src/app/knowledge/error.tsx
src/app/knowledge/not-found.tsx
src/components/knowledge/{workspace-selector,source-selector,knowledge-tree,create-document-form,document-viewer}.tsx
src/components/ui/{button,input,textarea,label}.tsx
playwright.config.ts
scripts/test/e2e.ts
tests/e2e/knowledge-smoke.spec.ts
```

工作：

1. Knowledge 畫面顯示當前 Local Identity、Workspace selector → Source selector → Folder／Document Tree，以及 Hub Source 的基本新增表單。
2. Workspace selector 只來自 `listWorkspaces(caller)`；切換後重新查該 Workspace Sources。未知/未授權 Workspace 不顯示且 direct URL/server action 仍重新驗證。
3. Form 只收 source／parent／title／Markdown 等內容欄位；server action 以 IdentityProvider 建 CallerContext 後呼叫 application service，不能把 UI 顯示的 workspace/org/ownership 當安全檢查。
4. Create 成功後由 adapter 導航到 stable UUID document URL；重新整理仍讀到同一文件與 current revision。
5. Viewer 顯示 title、Markdown 原文、current revision、Source ownership 與 provenance；相對資產路徑只當文字。
6. Error／not-found 不顯示 SQL／stack trace；unauthorized resource 不洩漏 title/snippet。
7. E2E runner 使用專用 DB／port；不重用使用者 dev server。

驗證流程：

```text
open Knowledge Hub → see configured Local Identity
  → list caller-visible Workspaces
  → select Workspace
  → select Source / expand Folder
  → create document
  → stable document URL
  → reload → same ID/title/content
  → navigate through Tree → same document
```

另驗證：cross-org authorized fixture 可瀏覽；non-member Workspace 不在 selector；直接造訪 unauthorized Document 被拒絕且不洩漏內容。

### T10 — 驗收與交接

**依賴：** T01–T09。**交付：** 可重現的啟動說明、檢查結果與 Phase 0 完成證據。

預計新增／更新：`README.md`、`docs/development/local-setup.md`、`docs/superpowers/verification/2026-09-10-phase-0-foundation-verification.md`。Verification 檔案只在實際執行時建立，不能預填通過結果。

工作：

1. 寫清楚 runtime／dependency lock、UUIDv7、Docker、env、migration、Workspace membership foundation、READ COMMITTED UoW、seed、啟動、測試與 test DB 清理方式。
2. 按 §6 執行驗收命令；每次 failed check 附修復與重跑結果，不以完成文件或 build 成功代替 DB concurrency／E2E 證據。
3. 核對 modules import direction、CallerContext、Source→Workspace policy resolution、transaction connection/isolation、SOURCE_MANAGED guards、current pointer、one-document-one-treenode 與 archive filtering/provenance。
4. 核對 manifest／資料表／路由沒有引入排除依賴或 Phase 3 Workspace administration、Folder Sync、SSO、publishing、search/vector、MCP、memory、Agent actor model、binary storage、hard delete 功能。
5. Verification 記錄各命令、執行日期、版本、通過／失敗、剩餘限制。若 DB 或 browser 環境無法跑，列明未驗證項目並保持 Phase 0 未完成。
6. 交接 Phase 1／2／3：Phase 1 繼承 Workspace foundation；Phase 2 new Source import 選 Workspace、existing Source sync 不 transfer；Phase 3 負責 Workspace provisioning/lifecycle 與 production governance。

## 6. 命令契約與測試隔離

以下命令是 T01–T09 應實作的 script contracts；不得將清單視為本次已跑過測試。

### 6.1 本地啟動

```sh
npm ci
docker compose up -d --wait
npm run db:migrate
npm run db:seed
npm run dev
```

首次 skeleton 建立依賴時使用 `npm install` 產生 lockfile，之後以 `npm ci` 重現。`dev` 與 E2E server 預設只綁 localhost；沒有配置 Company SSO/Phase 3 governance 的版本不當作公司正式 multi-user 入口。

### 6.2 驗收命令

```sh
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
```

| Script | 實際行為與通過條件 |
| --- | --- |
| `typecheck` | TypeScript no-emit 檢查；Next route types 如需生成由 script 自行準備 |
| `lint` | ESLint CLI 與 module import restrictions，零錯誤 |
| `test:unit` | Vitest run，包含 Workspace access／ownership／content／lifecycle／CallerContext／Tree；不連 DB |
| `test:integration` | 專用空 DB、migration、Vitest integration suites；缺 DB 或 migration 失敗即失敗 |
| `build` | Next production build；不需要 build 時查詢本地使用者或 Knowledge |
| `test:e2e` | 使用 build 輸出與專用 DB／port 啟動 server，Playwright smoke；結束清理自己的資源 |

Integration suite 以獨立 test DB 隔離，預設各 suite 順序執行；需要 race 的 case 在同一 suite 主動建立兩條 connection。不要將所有 case 包在 test-wide rollback 交易中，否則看不到真實 commit visibility，也測不到跨連線 concurrency。

Test DB 名稱採受限制的 `hcm_km_test_...`／`hcm_km_e2e_...`，runner 同時檢查其為本次產生的 database。Reset/drop 不得指向 dev DB；不能以全域關閉 FK checks 讓失敗測試通過。

## 7. 行為驗收矩陣

| ID | 情境 | 必須觀察到的結果 | 主要任務 |
| --- | --- | --- | --- |
| A01 | 新 test DB migration，重跑 migration | 十張 domain tables＋工具 ledger 建立；stable entity ID 使用 native UUID；重跑無重複 schema | T02–T03 |
| A02 | R1 指向文件 A，嘗試設為文件 B 的 current | DB 拒絕，B pointer 保持原值 | T03 |
| A03 | Document／Revision／Tree 建立任一步失敗 | 無孤兒文件／revision／tree；成功的 create 才回傳 ID | T05、T07 |
| A04 | title／Markdown／metadata 分別改變 | 各產生新 revision，原 revision 不變 | T04、T07 |
| A05 | metadata key 順序改變或完全相同輸入 | current revision／revision count 不變 | T04、T07 |
| A06 | filename／Folder rename、move、reorder | stable Document ID 與 revision 不變；filename 不自動改 canonical title | T04、T07、T08 |
| A07 | Hub 試圖修改 SOURCE_MANAGED | service 拒絕且 DB 無變更；不能靠 UI flag 繞過 | T07 |
| A08 | Archive 後讀 Tree，再 restore | 預設 Tree 不列 archived；history／ID 保留；archive actor/time 可讀；restore 後正常出現且目前 archive provenance 清空 | T03、T07 |
| A09 | 同一已識別 SourceEntry 重新出現 | 原 ID；相同內容無新 revision，改內容才新增 | T08 |
| A10 | 同 Source 重複 external identity | UNIQUE 拒絕；不同 Source 同 external_id 可以存在 | T03、T08 |
| A11 | 同內容但不同來源 identity | 不自動合併；hash 不當 identity | T04、T08 |
| A12 | 同一 Document 建第二個 DOCUMENT TreeNode | DB/application 拒絕，原 node 不變 | T03、T07 |
| A13 | 兩條 connection 同 base version 競爭 | 最多一次成功；loser 無 Knowledge／version writes | T08 |
| A14 | READ COMMITTED lock wait 後重新讀 | 等待者取得 lock 後依最新 committed state 驗證 | T05、T08 |
| A15 | Source Apply fixture 寫一半失敗 | Knowledge／Tree／Entry／asset／provenance／version／APPLIED 全 rollback | T08 |
| A16 | 主交易失敗後保存 FAILED | FAILED 獨立存活；沒有 result_version；Knowledge 仍回滾 | T08 |
| A17 | All-unchanged 成功 Apply fixture | 只增加 source version／run，revision／Tree／archive 不變 | T08 |
| A18 | 對 archived 或不同 Source parent 操作 | 拒絕無效結構；不偷偷 reparent／改 Source | T07 |
| A19 | concurrent moves 可能合成 cycle | Source lock 與 ancestry validation 阻止非法結果 | T07 |
| A20 | Local identity + 偽造前端 emp_id／org | server 建立的 CallerContext 仍使用設定的可信測試身分 | T06 |
| A21 | 頁面建立後重新整理／Tree 導航 | 同一 stable URL／Document ID／current revision | T09 |
| A22 | 直接 non-Web 呼叫 application | 以 CallerContext + Workspace policy 呼叫，不需 React／Next runtime | T07、T10 |
| A23 | Asset metadata 寫入與讀取 | 保存 path／metadata，沒有 binary storage／serving | T03、T05 |
| A24 | 建立 Source 未提供有效 `workspace_id` | FK/application 拒絕 | T03、T07 |
| A25 | User A 與 Workspace X member 同 org，但 A 自己不是 member | read/write 拒絕 | T05、T07 |
| A26 | User B org 不同但具有 Workspace X membership | foundation access 通過 | T05、T07 |
| A27 | User B 同時為 Workspace X/Y member | `listWorkspaces(caller)` 回 X/Y | T04、T06、T09 |
| A28 | User C 知道 Source/Document UUID 但不是 member | 拒絕且不洩漏 Knowledge 內容 | T05、T07、T09 |
| A29 | User `org_code` 改變 | User ID 與 WorkspaceMembership 不自動改變 | T06 |
| A30 | 重複建立 `(workspace_id,user_id)` membership | DB constraint 拒絕 | T03 |
| A31 | UI 傳入未授權 Workspace/Source ID | server/application 重新驗證並拒絕 | T07、T09 |

## 8. 完成檢核與後續責任

以下 checkbox 在程式實作完成並有證據後才勾選；本計畫交付時全部維持未完成。

- [ ] T01：技術骨架、版本鎖定、UUIDv7 generator、lint/typecheck/build 可用。
- [ ] T02：Local MariaDB 10.11、migration runner、隔離測試 DB 可用。
- [ ] T03：十張 domain tables、Workspace/Membership、native UUID、lifecycle provenance、one-document-one-treenode、複合 FK／CHECK／UNIQUE 經真實 DB 驗證。
- [ ] T04：Domain models／CallerContext／Workspace policy／ports 與核心規則 unit tests 通過。
- [ ] T05：Repositories、Workspace access 與 READ COMMITTED 共用 connection transaction／rollback 通過。
- [ ] T06：Local identity 四欄位、Workspace/Membership seed 與 cross-org fixtures 可用，無前端身分信任捷徑。
- [ ] T07：最小 caller-aware application create/read/revision/lifecycle/hierarchy 行為通過。
- [ ] T08：Mapping／reappearance／source version race／atomicity／Workspace guard 通過。
- [ ] T09：Workspace → Source → Tree 最小 Web flow 與 Chromium smoke 通過。
- [ ] T10：驗收紀錄完整、scope／dependency review 通過。

| 後續階段 | 本次交付接點 | 仍留在後續階段的工作 |
| --- | --- | --- |
| Phase 1 | Workspace/Membership foundation、Knowledge models、repositories、CallerContext、commands／queries、Tree invariants | 完整 Knowledge／Tree 產品能力與 read-only browser |
| Phase 2 | Workspace-scoped Sources、SourceEntry／asset／SyncRun repositories、version guard、Sources UoW、內部 Knowledge mutations | Select Workspace for new Source、Folder 非 ZIP 上傳、掃描／解析、Title Resolution、matching／歧義、diff、Preview/Confirm/Apply；existing Source sync 不 transfer Workspace |
| Phase 3 | UserIdentity、CallerContext、Workspace/Membership foundation、current lifecycle provenance | **Workspace provisioning/create、rename、archive/restore**；membership administration；roles/capabilities；Team/SSO Group mapping；production policy/audit；Company SSO；MVP 不 hard delete Workspace |
| Phase 4–9 | UI-independent application core、stable IDs/revisions、Workspace-aware boundary | Discovery、authoring、publishing、MCP、semantic retrieval、memory／relations；Agent write 若真的需要才建立 Principal/Actor model |

Phase 0 的內部源更新 fixtures 不保證任意 folder rename 可被識別，也不決定來源 title；Phase 2 必須在既有契約下定義 matching、Title Resolution 與 Preview 的產品規則。Phase 0 的 revision row locks 不代表完整作者衝突處理已完成。資產 metadata 不代表附件可存取。

## 9. 本計畫自我審查

| 面向 | 審查結論 |
| --- | --- |
| 對齊 canonical design | 本 plan 直接使用 Workspace → Source → Tree；不保留舊 knowledge_sources.org_code / org→source 執行指令 |
| Schema | 十張 domain tables；workspaces/workspace_memberships 是 foundation，Source 使用 workspace_id |
| 實際專案起點 | 實作前需重新檢查 branch/worktree；檔案清單是計畫，不冒充已存在實作 |
| IDs | UUIDv7 由 application 產生，MariaDB 10.11 使用 native UUID；Membership 用 composite key |
| Caller boundary | CallerContext 是 public service 顯式第一參數；identity 由 transport/provider 建立，不從 payload 或 ambient state 取得 |
| Workspace boundary | org_code 僅 identity；cross-org member allow、same-org non-member deny；direct resource ID 不繞過 policy |
| Workspace lifecycle owner | Phase 3 明確負責 provision/create、rename、archive/restore 與 administration；Phase 0 不提前做管理 UI |
| Actor model | Phase 0–2 繼續使用 user FK；不提前導入 actor_kind，Agent write 留給實際需求 phase |
| Isolation | Canonical mutation UoW 明訂 READ COMMITTED 並保留 Source/Document FOR UPDATE；concurrency test 使用兩條 connection |
| Lifecycle provenance | archive/restore 同步更新 status 與 actor/time；完整 append-only audit 歷史留 Phase 3 |
| Tree uniqueness | one-document-one-treenode 在 T03 是 DB invariant |
| DDL／DML rollback | Migration 失敗採診斷／隔離重建，Knowledge 原子性測試不混入 DDL |
| Module direction | identity/workspaces/knowledge/sources 分工；Knowledge 不反向依賴 scanner/sync implementation |
| Source ownership | Workspace access 與 SOURCE_MANAGED/HUB_MANAGED content authority 分離 |
| SourceEntry ambiguity / Title | 不以 path/hash 唯一鍵或 filename title 假裝解決來源辨識；matching 與 Title Resolution 明確交 Phase 2 |
| Sync scope | 僅 version guard、repositories 與 atomicity fixture；沒有建 scanner／Preview／Confirm／Apply 產品入口 |
| Identity／governance | Company production multi-user write access 需 Phase 3；Phase 0–2 只作 local/mock MVP foundation |
| E2E 前提 | 專用 DB、seed、build server 與 port；不重用 dev server，清理目標受限制 |
| 測試可信度 | DB／browser 不可用不算通過；concurrency 使用兩條真實連線；沒有預填 verification 結果 |
| 範圍控制 | 沒有預裝後續 editor／drag／search／MCP／publishing／memory、Agent actor model 或 binary storage |

本文件是 Phase 0 current implementation plan。Workspace amendment 保留架構變更歷史，但執行者不需要靠 amendment 修補本 plan 的舊 org/source 指令；開始實作時從 T01 依本文件與 current Phase 0 design 執行。
