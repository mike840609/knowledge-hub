# Knowledge Hub — Phase 0 Foundation Implementation Plan

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-10 |
| 主要專案 | `/Users/chuntsai/Projects/HCM-KM/` |
| 依據 | [Phase 0 Foundation & Architecture Design](../specs/2026-09-10-phase-0-foundation-architecture-design.md) |
| 文件狀態 | 實作計畫完成、自我審查完成；尚未執行程式實作 |
| 工作範圍 | Phase 0 foundation；不提前執行 Phase 1–9 的完整產品功能 |

## 1. 預期成果與起點

完成本計畫後，開發者可以啟動本地 MariaDB 10.11 與 Next.js，使用 server 提供的 Local Identity 建立可信 `CallerContext`，建立一份 HUB_MANAGED 文件、讀取內容，並透過 org → source → folder/document tree 找到同一份文件。Domain、repository 與 transaction 測試證明 UUIDv7 stable ID、immutable revision、ownership、archive／restore provenance、one-document-one-treenode 與 source version guard 的規則。

2026-09-10 檢查專案時，目錄只有 `.git/` 與 `docs/`，沒有 `package.json`、application code、migration 或測試；Git 位於 `main`，尚無 commit，`docs/` 尚未追蹤，也沒有 `.codegraph/`。因此本計畫列出的程式檔案皆為預計新增，不是假定已存在的實作。不需建立 CodeGraph index。

執行時先重新檢查 working tree；保留使用者後續新增內容。若開始程式實作，使用 `phase-0-foundation` 工作分支承接現有文件；目前無 commit 的 repository 不以 `HEAD` 或 worktree 必然存在為前提。本計畫本身不要求建立 PR、push 或部署。

### 1.1 驗收邊界

- 最小 Web flow 只需 source 選擇、基本 title／Markdown 輸入、文件讀取與可展開的 Tree。
- Revision 更新、archive／restore、hierarchy mutation 在 application 層與測試中驗證；本階段不需要完整管理 UI。
- SourceEntry、KnowledgeAsset、SyncRun 建 schema 與必要 repositories；使用 fixtures 驗證 mapping 與 transaction，不建 Folder scanner、parser、Title Resolution、diff engine 或 Sync UI。
- SOURCE_MANAGED 不接受一般 Hub 寫入；受控來源更新只保留可共用 transaction 的內部 operation 邊界。
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
| IDs | application 產生 UUIDv7；MariaDB 使用 native `UUID` type | 16-byte storage、改善 key locality；不使用 `CHAR(36)` 或 path/title/hash 產生 identity |
| Caller | transport 由可信 `IdentityProvider` 建立 `CallerContext { identity }`，顯式作為 application service 第一參數 | 不依賴 ambient/global request identity；Phase 3 可擴充 policy 而不改全部 method shape |
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
  → T06 Local identity / fixtures
  → T07 Knowledge application operations
  → T08 Source version / cross-module safety fixtures
  → T09 Minimal Web flow
  → T10 Full acceptance / handoff evidence
```

順序採單一執行流程，不要求平行代理或每個小步驟都 commit。T04 的純 domain 工作不依賴 DB 完成，但 T07 以前必須把 schema、repository 與交易整合起來。

| Task | 完成後可檢查的交付 | 對應 Design Spec |
| --- | --- | --- |
| T01 | 可 build 的 Next.js 骨架與測試／lint scripts | §3、§6、§9 |
| T02 | 可啟動的 MariaDB、可重跑的 migration 管理 | §5、§8.2 |
| T03 | 八張核心表、native UUID 與 referential／unique／CHECK constraints | §5、§5.1 |
| T04 | Domain models、CallerContext、純規則、ports 與 unit tests | §4、§6、§8.1 |
| T05 | SQL repositories、READ COMMITTED same-connection transaction 與 rollback tests | §6.4、§7.1 |
| T06 | 四欄位 Local Identity、可重複使用的 development fixtures | §6.1 |
| T07 | 建立／讀取／更新／lifecycle／hierarchy 最小 application operations | §4、§6.2、§7.1 |
| T08 | Mapping／reappearance／optimistic version／跨 repository 原子性證據 | §7.4～7.6、§8.2 |
| T09 | 可實際操作的最小 Web flow 與 smoke E2E | §8.3 |
| T10 | 全部驗收結果與 Phase 1／2 接手說明 | §9～10 |

## 4. 必須先落實的資料與交易細節

### 4.1 八張核心表與 migration ledger

核心表維持 design spec 的 `users`、`knowledge_sources`、`source_entries`、`knowledge_tree_nodes`、`knowledge_documents`、`knowledge_revisions`、`knowledge_assets`、`sync_runs`。

Migration runner 另建 `schema_migrations` 作為工具 ledger，保存版本、checksum、執行狀態與時間。這不是第九個產品 domain，也不能拿來存 Preview 或 audit 功能。Migrations 採 forward-only；開發中的失敗在專用 disposable DB 重建驗證，既有非測試 DB 只採明確修復步驟。

全部核心表使用 InnoDB。跨表 ID 欄位統一使用 MariaDB native `UUID` type；application 端產生 UUIDv7。文字內容使用 utf8mb4；時間統一 UTC、`DATETIME(6)`；revision Markdown 用 LONGTEXT；knowledge metadata 用 JSON。

### 4.2 關聯、唯一性與 lifecycle provenance

| 規則 | 計畫實作方式 |
| --- | --- |
| Source ownership | `source_id` FK；`org_code` 必填且非空；CHECK 限定三種 source type／ownership 組合 |
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

本計畫選擇欄位長度：org_code／emp_id 為 `VARCHAR(128)`，name／title 為 `VARCHAR(512)`，external_id 為 `VARCHAR(512)`、utf8mb4 binary collation，source_path 為 TEXT。這些是 Phase 0 storage/input 邊界，不代表已定義 Phase 2 的外部檔案相容範圍；入口遇到超長值應回報 validation failure，不截斷識別值。

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

### 4.4 Transaction composition 與 CallerContext

Knowledge 在自己的 ports 定義 `KnowledgeUnitOfWork.run(work)`，callback 只取得該交易綁定的 document／revision／tree repositories 與 read-only source policy port。Sources 的 transaction port 可在此基礎加入 SourceEntry／asset／SyncRun／source-version repositories；Sources 依賴 Knowledge 的方向不反轉。

MariaDB infrastructure 每次 canonical mutation UoW 必須先設定本次 transaction 為 `READ COMMITTED`，再取得同一條 connection 上的 begin → callback → assertions → commit；失敗 rollback；finally release。所有 transaction-bound repository 都綁同一 connection，不能改用 `pool.query()` 跳出交易。官方 connector 提供相應 connection transaction methods。[MariaDB Node.js Promise API](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/connector-nodejs-promise-api)

`CallerContext` 固定由 transport/server boundary 以可信 `IdentityProvider` 建立：

```ts
type CallerContext = {
  identity: UserIdentity;
};
```

Public Knowledge/Sources application service 都把 `caller` 作為顯式第一參數。Internal mutation functions 接受已解析的 trusted execution context／repositories，不自行從 request/global state 取 identity，也不自行 commit。後續 Sources orchestration 可在自己的 UoW 呼叫相同 mutation functions。不能使用 UI 傳入的 `isSync`／ownership flag 繞過唯讀限制；受控來源操作不 export 成 Web Server Action。

Source policy port 的 adapter 只查 Source 歸屬、ownership、status；Knowledge 不 import Sources scanner／sync 實作。Composition root 位於 `src/server/`，負責注入實作，不建立第四個業務模組。

### 4.5 Hierarchy、revision 與併發

Phase 0 mutation 以 Source row 為 serialization boundary，再按 Document ID 固定順序取得必要 row locks。Tree move 在持有 Source lock 時驗證 parent 同 Source、parent 為 Folder、非自己或後代，防止兩個各自看似合法的 move 合併成 cycle。

Canonical mutation 使用 READ COMMITTED，因此 source/document locking read 後的後續讀取不依賴較早建立的 REPEATABLE READ consistent snapshot。仍必須明確取得 Source/Document `FOR UPDATE` lock；READ COMMITTED 不是 row lock 的替代品。

一般 Hub 內容更新在鎖內讀取 current revision、比較內容、分配下一個 revision_no 並插入。這避免重複編號／部分 pointer 更新；不等於已提供 Phase 5 的多使用者 stale-editor conflict UX。

Source row lock 不自動增加 sync_version。僅受控的成功 source Apply 操作會遞增，其他 Hub-managed 更新不冒充同步。

### 4.6 Source version guard

既有 Source 的 guard 先以條件 UPDATE 保護預覽的 base version：

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
4. 建立下列 script contracts：`dev`、`build`、`start`、`lint`、`typecheck`、`test:unit`、`test:integration`、`test:e2e`、`db:migrate`、`db:seed`。DB/E2E scripts 可在對應任務接線，但不得以空成功 script 冒充通過。
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

**依賴：** T02。**交付：** design spec 八張核心表、native UUID、lifecycle provenance 與 §4 的 SQL 保護／schema tests。

預計新增：`src/infrastructure/database/mariadb/migrations/001-core.ts`、`002-current-revision.ts`、`tests/integration/schema.test.ts`。

工作：

1. 依序建立 users → sources → documents → revisions → tree／entries／assets／runs；所有 internal ID/FK 使用 MariaDB native `UUID`；第二個 migration 補上 current-revision 複合 FK。
2. 完整保存 spec 最小欄位；Source sync_version 預設 0，Document／Tree／Entry／Source lifecycle 僅 ACTIVE／ARCHIVED；Source／Entry／Tree／Document 加 `updated_by`、`archived_by nullable`、`archived_at nullable`。
3. SyncRun 允許 PREVIEWED／FAILED 的 `result_version` 為 null；APPLIED 必須有完成時間與有效 result version；不加入額外 Knowledge lifecycle。
4. 為 Source tree、current document lookup、source entry external identity 與 revision history 加必要索引，不預建 full-text/vector index。
5. 依 §4.2 加上複合 FK、CHECK、UNIQUE；特別加入 `UNIQUE(knowledge_tree_nodes.document_id)` 的非 NULL protection，直接嘗試第二個 Document TreeNode 必須失敗。
6. `updated_by`／`archived_by` 指向 users.id；ACTIVE row 的 `archived_by`／`archived_at` 必須為 null，ARCHIVED row 必須有對應 archive provenance（跨欄位規則若 CHECK 可表達就由 DB 保護，否則 application + integration test 保護）。

驗證：從空 DB 完整 migration；兩個 org／source fixtures；錯誤 source reference、錯誤 current revision、重複 revision_no／external identity、同 Document 第二個 TreeNode、FOLDER 帶 document_id、DOCUMENT 無 reference 均失敗。相同 external_id 可在不同 Source 出現；多筆 null external_id 可存在；asset table 沒有 binary storage 欄位。

### T04 — Domain models、CallerContext、規則與 ports

**依賴：** T01；schema 欄位以 T03 為準。**交付：** 純 domain tests 與可注入 dependencies 的介面。

預計新增：

```text
src/modules/identity/domain/user-identity.ts
src/modules/identity/application/caller-context.ts
src/modules/identity/ports/identity-provider.ts
src/modules/identity/ports/user-repository.ts
src/modules/knowledge/domain/{document,revision,tree-node,content,lifecycle,errors}.ts
src/modules/knowledge/ports/{document-repository,revision-repository,tree-repository,source-policy,unit-of-work}.ts
src/modules/sources/domain/{source,source-entry,asset,sync-run}.ts
src/modules/sources/ports/{source-repository,entry-repository,asset-repository,sync-run-repository,unit-of-work}.ts
tests/unit/{content,ownership,lifecycle,tree,source-mapping,caller-context}.test.ts
```

工作：

1. UserIdentity 精確四個 string 欄位；CallerContext 精確為 `{ identity: UserIdentity }`；source type 與 ownership 透過 domain validation 限制合法組合。
2. 定義 title／Markdown／JSON metadata 的 canonical input。Metadata object keys 遞迴排序，array 保持順序；拒絕 undefined／NaN 等非 JSON 值。字串原樣保存，不 trim 正文或偷偷改換行。Object key 順序不同不應形成新 revision。
3. 比較 canonical representation 決定是否變更，再產生內容 hash；metadata 與 title 不能被漏掉。UUIDv7 generator 與 clock 可注入供測試，不影響 domain identity 定義。
4. 定義同文件更新、rename／move、archive／restore、lifecycle provenance 與已知 mapping reappearance 的規則；不知道 external identity 時不猜同一文件；不知道 SOURCE_MANAGED title rule 時不從 filename/path 猜 title。
5. 以少量 domain error 類型表達 validation、not found、source read-only、version conflict、integrity failure；不把 SQL driver error 輸出給 UI。
6. 定義 §4.4 的 UoW 與 ports；public application ports 顯式接收 CallerContext，不建立 database-neutral 巨型 repository framework。

驗證：unit tests 涵蓋 title-only、metadata-only、body-only、identical input、metadata key-order、path-only、restore-same-content、restore-changed-content、archive provenance；SOURCE_MANAGED 的 Hub mutations 被拒絕。CallerContext 不允許從 command/query payload 覆寫 identity。Vitest 只測 domain/application 行為，Next server components 的真正互動留給 Playwright。[Vitest guide](https://vitest.dev/guide/)

### T05 — Repositories 與 READ COMMITTED 同連線 transaction

**依賴：** T03、T04。**交付：** 真實 DB 的資料存取、atomicity、isolation 與錯誤轉換。

預計新增：`src/infrastructure/database/mariadb/transaction.ts`、`repositories/{users,sources,documents,revisions,tree,entries,assets,sync-runs,source-policy}.ts`、`tests/integration/{repositories,transactions}.test.ts`。

工作：

1. 所有 writes 使用 parameterized SQL；在 repository 邊界轉換 JSON／UTC time／nullable values，驗證 counter 為合法 integer；UUID column 對外仍以標準 UUID string 表達，不讓 domain 處理 storage encoding。
2. 實作一條 connection 綁定一組 repositories 的 UoW；每次 canonical mutation 在 begin 前設定 `READ COMMITTED`；所有 callback promise 必須 await，callback 失敗 rollback，connection 用完 release。
3. 實作 source lock、document lock、read／insert revision、set-current、Tree 更新與必要 mapping/run 操作。Source policy 由 DB adapter 提供，不經由 Sources module 反向呼叫。
4. SQL duplicate／foreign-key／CHECK failures 轉為穩定的 application error；保留 server-side diagnostic，但不記錄完整 Markdown、密碼或 token。
5. 建立流程的 pre-commit assertions 驗證本次建立文件有合法 current revision，且 Document 只有一個 DOCUMENT TreeNode。Repository 的 revision API 不提供 overwrite／delete。

驗證：真實 DB 逐點注入失敗（Document、Revision、pointer、Tree 完成後、commit 前）；每次用另一條連線確認無孤兒資料。另以兩條 connection 驗證 READ COMMITTED + `FOR UPDATE` 在 lock wait 後使用最新 committed state，而不是舊 consistent snapshot；成功時四者一致可讀，connection 釋放後下一次操作可正常使用。

### T06 — Local Identity、CallerContext 與可重複使用的 fixtures

**依賴：** T05。**交付：** 固定四欄位身分、可信 caller、最小本地資料與非 Web 測試入口。

預計新增：`src/modules/identity/application/get-current-identity.ts`、`src/infrastructure/identity/local-identity-provider.ts`、`src/server/composition.ts`、`src/server/config.ts`、`scripts/db/seed.ts`、`tests/unit/local-identity.test.ts`、`tests/integration/identity.test.ts`、`tests/fixtures/knowledge.ts`。

工作：

1. Local provider 從 server-only 設定取得固定測試身分，回傳 `{id, emp_id, name, org_code}`。缺少欄位／未啟用 local mode 即明確失敗，不接受 query、form 或 header 任意提供 identity。
2. Server/transport adapter 以 Local Identity 建立 `CallerContext { identity }` 後傳入 application service；domain/application 不直接 import request-specific identity provider。
3. `users` 以 UUIDv7 stable id／unique emp_id 對齊，更新 name／org 不重建 id；發現 id 與 emp_id 分別對到不同使用者時拒絕，不合併兩筆身分。未來 SSO provider 可替換，不預建 SSO SDK 或 token parser。
4. 用明確 `KM_LOCAL_IDENTITY_ENABLED` 配置啟用本機示範與 E2E；`NODE_ENV=production` 的本地 build smoke 可明確啟用 local mode，但文件清楚標示其非企業登入。Server composition 在 local provider 以外尚無可用 adapter 時回報未配置，不默默降級。
5. Development seed 建一個本地使用者、一個 HUB_MANAGED Source、一個 Folder；seed 使用固定合法 UUID 值確保重跑不複製資料，且不覆蓋使用者建立的文件。
6. Integration fixtures 另準備兩個 org、兩個 Hub Source、一個 SOURCE_MANAGED Source、已識別 SourceEntry、ACTIVE／ARCHIVED 文件與 lifecycle provenance；不放入正式 DB，不使用真實公司身分。
7. `src/server/composition.ts` 注入 identity、UoW 與 repositories；只有 server adapters import 此檔，domain 不 import composition。

驗證：provider 四欄位、CallerContext 建立、缺少設定失敗、工號碰撞拒絕、使用者更新保留 id；seed 執行兩次不增加重複 Source／Folder。偽造前端 emp_id／org_code 不影響實際 caller。這不測試或宣稱完整 ACL／跨組織分享已完成。

### T07 — Knowledge Application Operations

**依賴：** T05、T06。**交付：** 可被 Web 與非 Web caller 重用的最小核心行為。

預計新增：`src/modules/knowledge/application/{queries,commands,mutations}.ts`、`tests/integration/{knowledge-application,knowledge-lifecycle,knowledge-tree}.test.ts`。

工作：

1. Public application operations 以 `caller: CallerContext` 作第一參數；`createHubManagedDocument(caller, input)` 驗證有效 Hub-managed Source／parent，執行 §4.3 原子建立流程，回傳 UUIDv7 stable Document ID。
2. `getDocument(caller, ...)`／`getCurrentRevision(caller, ...)`／`listTree(caller, ...)`：讀同文件 current revision；Tree DOCUMENT 名稱取 current title，Folder 取 name；預設不列 archived Source／node／Document，亦不列 archived 祖先底下節點。預設 document read 不將 archived 當有效文件回傳；明確的歷史讀取模式供內部測試驗證資料仍保留。
3. `createRevision(caller, input)`：鎖內比較 title／Markdown／metadata；有變更才 insert next revision + update pointer；相同輸入回傳既有 revision。舊內容與作者／建立時間不變。
4. `archiveDocument(caller, ...)`／`restoreDocument(caller, ...)`：Hub-managed 的一般操作與受控來源內部操作分開；Knowledge 更新 Document 與其關聯 Tree，並同交易保存 `updated_by`／`archived_by`／`archived_at`；保留全部 revision history。有 SourceEntry 的來源操作由 Sources caller 在同一 UoW 更新 mapping lifecycle provenance。Restore 需有有效 parent；不暗中 reparent 或 restore 整棵 archived folder。
5. 最小 `moveTreeNode(caller, ...)`／`renameFolder(caller, ...)`／`reorderNode(caller, ...)`：同 Source 內依 §4.5 驗證，SOURCE_MANAGED 的一般 Hub 操作拒絕；操作不改 Document ID 或 revision。Document title 修改仍走 createRevision，沒有另存 Tree document name。
6. 受控來源使用的內部 Knowledge mutation 接受已解析 CallerContext／Document ID／正規化內容與可信 execution scope；由 Sources caller／fixture 先解析已知 SourceEntry mapping，再呼叫它。可 archive／restore／改內容並沿用 Document ID，Knowledge 不 import SourceEntry 型別或 matching 實作。
7. 核心 command/query 不 import Next.js；Web revalidation／redirect 留在 adapter。不存在 UI 傳入 caller、actor_kind、isSync 或 ownership mode 的 bypass path。

驗證：透過 application service 而不是 page 呼叫建立、讀取、相同內容重送、title-only 更新、metadata-only 更新、move／rename、archive／restore。讀出 DB 證明 ID 穩定、one-document-one-treenode、舊 revision 未變、current pointer 正確、lifecycle actor/time 正確；SOURCE_MANAGED 所有 Hub mutation 都被拒絕且無寫入。新增兩個 concurrent move 的 cycle case 與同文件 simultaneous revision allocation case。

完成界線：不建立全文搜尋、完整歷史瀏覽 UI、權限角色管理、完整 authoring、Title Resolution 或檔案 upload UI。

### T08 — SourceEntry 與 Sync Safety Foundation

**依賴：** T07。**交付：** 未來同步依賴的 concurrency／mapping／rollback 保證。

預計新增：`src/modules/sources/application/source-version-guard.ts`、`tests/integration/{source-version,source-mapping,cross-module-atomicity}.test.ts`、`tests/fixtures/source-operations.ts`。

工作：

1. Sources application guard 經 source-repository port 呼叫 §4.6 的 condition-update；SQL 放在 MariaDB repository。實作 Sources READ COMMITTED transaction port，讓 source repositories 與 Knowledge mutations 共用 connection。
2. 使用已解析且已知 mapping 的 fixture，在交易中執行 Document／Revision／Tree 更新、SourceEntry lifecycle provenance／asset metadata 寫入、source version 遞增與 APPLIED run 保存。不新增正式 `syncFolder()` engine 或 Preview／Confirm route。
3. 用兩條獨立 DB connection 與測試 barrier 同時以 base version N 嘗試 Apply fixture；不可用同一 connection 模擬 concurrency，也不可只 mock affectedRows。
4. 在第一個交易持有來源 row lock 時啟動競爭者，釋放第一個後觀察另一個 version mismatch；另測第一個 rollback 後另一個可用未變的版本成功。
5. 選擇 Knowledge write、entry update、asset metadata write 與 APPLIED record 前等失敗點，驗證所有 canonical changes／provenance／版本／成功紀錄都回滾。
6. 主交易失敗後，用獨立 transaction 保存 FAILED fixture；從另一連線確認它存活且沒有成功 result_version。FAILED 紀錄自身失敗仍回傳 failure，不製造成功結果。完整 Phase 2 記錄流程不在此建立。
7. 同一已識別 entry 缺檔後重現：恢復原 ID，相同內容不增 revision、不同內容只加一版。External identity collision 拒絕；同內容、不同 identity 可並存。
8. All-unchanged fixture 成功時只寫 run／version；記錄前後 revision、Tree、archive counts 不變。從 N 成功變成 N+1 後，舊 N 不可再次套用。

驗證：上述 integration tests 使用 MariaDB 10.11 真實 commits、READ COMMITTED、獨立連線與有期限的 barrier。任一 suite 缺 DB 不可 silent skip 後算驗收通過。測試不依賴實際 folder、ZIP、Title Resolution、binary files 或外部 API。

### T09 — 最小 Web Flow 與 E2E

**依賴：** T07、T08。**交付：** 可由人操作的 foundation 與一條完整 smoke flow。

預計新增：

```text
src/app/knowledge/page.tsx
src/app/knowledge/[documentId]/page.tsx
src/app/knowledge/actions.ts
src/app/knowledge/error.tsx
src/app/knowledge/not-found.tsx
src/components/knowledge/{knowledge-tree,create-document-form,document-viewer}.tsx
src/components/ui/{button,input,textarea,label}.tsx
playwright.config.ts
scripts/test/e2e.ts
tests/e2e/knowledge-smoke.spec.ts
```

工作：

1. 首頁提供入口；Knowledge 畫面顯示當前 Local Identity、org → Source → Folder／Document tree，以及 Hub Source 的基本新增表單。Folder 展開／收合使用可鍵盤操作的標準 controls，Document 用連結選取。
2. Form 只收 source／parent／title／Markdown 等內容欄位；server action 以 IdentityProvider 建立 CallerContext 後呼叫 application service，不能把 UI 顯示的 readonly、ownership、emp_id 或 org 當安全檢查。
3. Create 成功後由 adapter 更新畫面／導航到 stable UUID document URL；重新整理仍讀到同一文件與 current revision。Identity／DB read 在 request 階段執行，不在 build 靜態擷取本地資料，也不共享快取 caller-specific data。
4. Viewer 顯示 title、Markdown 原文、current revision 與 Source ownership。遇到來源相對資產路徑只當文字，不嘗試讀取 local filesystem 或假設 attachment service 已存在。
5. Error／not-found 由 Next adapter 顯示簡單、可理解的結果；使用者輸入錯誤保留可修正表單，未知 DB 錯誤不顯示 SQL／stack trace。UI error boundary 不代替 transaction rollback。
6. E2E runner 建立本次專用 DB、migration／seed，啟動隔離 port 的 build server、執行 Chromium smoke，finally 停止 server／清理專用 DB；不重用使用者手動啟動的 dev server。

Playwright 可透過 `webServer` 管理測試 server 並設定 readiness 與環境；本計畫設定 `reuseExistingServer: false`，避免 smoke 意外操作 dev DB。[Playwright web server](https://playwright.dev/docs/test-webserver)

驗證流程：

```text
open Knowledge Hub → see configured Local Identity
  → adapter builds trusted CallerContext
  → expand Source / Folder
  → create document with unique title and Markdown
  → reach stable document URL and read content
  → reload → same ID / title / content
  → navigate through Tree → same document
```

再用既有 fixture 確認 SOURCE_MANAGED 顯示唯讀、archived 不出現在預設 Tree，以及一般建立失敗可見錯誤。完整 SOURCE_MANAGED mutation 拒絕已由 T07 覆蓋，無需為每個 service operation 新建管理畫面。

### T10 — 驗收與交接

**依賴：** T01–T09。**交付：** 可重現的啟動說明、檢查結果與 Phase 0 完成證據。

預計新增／更新：`README.md`、`docs/development/local-setup.md`、`docs/superpowers/verification/2026-09-10-phase-0-foundation-verification.md`。Verification 檔案只在實際執行時建立，不能預填通過結果。

工作：

1. 寫清楚 runtime／dependency lock、UUIDv7、Docker、env、migration、READ COMMITTED UoW、seed、啟動、測試與 test DB 清理方式；記錄實際 MariaDB 10.11 patch／image。
2. 按 §6 執行驗收命令；每次 failed check 附修復與重跑結果，不以完成文件或 build 成功代替 DB concurrency／E2E 證據。
3. 核對 modules 的 import direction、CallerContext 顯式傳入、transaction connection/isolation、SOURCE_MANAGED guards、current pointer、one-document-one-treenode 與 archive filtering/provenance，確認 non-Web integration caller 直接使用 application services。
4. 核對 manifest／資料表／路由沒有引入排除依賴或 Folder Sync、Title Resolution、SSO、publishing、search/vector、MCP、memory、Agent actor model、binary storage、hard delete 功能。
5. Verification 記錄各命令、執行日期、版本、通過／失敗、剩餘限制。若 DB 或 browser 環境無法跑，列明未驗證項目並保持 Phase 0 未完成。
6. 交接 Phase 1／2：現有 ports、CallerContext、transaction 使用方式、source policy 接點、已知 mapping 的用法與後續功能邊界。不要提前部署或實作 Phase 2。

## 6. 命令契約與測試隔離

以下命令是 T01–T09 應實作的 script contracts，現在專案尚無可執行的 package scripts。不得將下列清單視為本次已跑過測試。

### 6.1 本地啟動

在主要專案 root 執行；先依 README 建立本地 env：

```sh
npm ci
docker compose up -d --wait
npm run db:migrate
npm run db:seed
npm run dev
```

首次 skeleton 建立依賴時使用 `npm install` 產生 lockfile，之後以 `npm ci` 重現。`dev` 與 E2E server 預設只綁 localhost；沒有配置 Company SSO 的版本不當作公司正式入口。

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
| `typecheck` | TypeScript no-emit 檢查；Next route types 如需生成由 script 自行準備，不能依賴開發者曾先啟動 dev server |
| `lint` | ESLint CLI 與 module import restrictions，零錯誤 |
| `test:unit` | Vitest run，包含 ownership／content／lifecycle／CallerContext／Tree；不連 DB |
| `test:integration` | 準備專用空 DB、migration、Vitest integration suites；缺 DB 或 migration 失敗即失敗；結束釋放 connection／清理本次 DB |
| `build` | Next production build；不需要在 build 時查詢本地使用者或 Knowledge |
| `test:e2e` | 使用 build 輸出與專用 DB／port 啟動 server，Playwright smoke；結束清理自己的資源 |

Integration suite 以獨立 test DB 隔離，預設各 suite 順序執行；需要 race 的 case 在同一 suite 主動建立兩條 connection。不要將所有 case 包在 test-wide rollback 交易中，否則看不到真實 commit visibility，也測不到跨連線 concurrency。

Test DB 名稱採受限制的 `hcm_km_test_...`／`hcm_km_e2e_...`，runner 同時檢查其為本次產生的 database。Reset/drop 不得指向 dev DB；不能以全域關閉 FK checks 讓失敗測試通過。

## 7. 行為驗收矩陣

| ID | 情境 | 必須觀察到的結果 | 主要任務 |
| --- | --- | --- | --- |
| A01 | 新 test DB migration，重跑 migration | 核心八表＋工具 ledger 建立；ID 使用 native UUID；重跑無重複 schema | T02–T03 |
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
| A14 | READ COMMITTED lock wait 後重新讀 | 等待者取得 lock 後依最新 committed state 驗證，不依賴舊 RR snapshot | T05、T08 |
| A15 | Source Apply fixture 寫一半失敗 | Knowledge／Tree／Entry／asset／provenance／version／APPLIED 全 rollback | T08 |
| A16 | 主交易失敗後保存 FAILED | FAILED 獨立存活；沒有 result_version；Knowledge 仍回滾 | T08 |
| A17 | All-unchanged 成功 Apply fixture | 只增加 source version／run，revision／Tree／archive 不變 | T08 |
| A18 | 對 archived 或不同 Source parent 操作 | 拒絕無效結構；不偷偷 reparent／改 Source | T07 |
| A19 | concurrent moves 可能合成 cycle | Source lock 與 ancestry validation 阻止非法結果 | T07 |
| A20 | Local identity + 偽造前端 emp_id／org | server 建立的 CallerContext 仍使用設定的四欄位可信測試身分 | T06 |
| A21 | 頁面建立後重新整理／Tree 導航 | 同一 stable URL／Document ID／current revision | T09 |
| A22 | 直接 non-Web 呼叫 application | 以 CallerContext 呼叫，不需 React／Next runtime 就可完成 core/query integration test | T07、T10 |
| A23 | Asset metadata 寫入與讀取 | 保存 path／metadata，沒有 binary storage／serving | T03、T05 |

## 8. 完成檢核與後續責任

以下 checkbox 在程式實作完成並有證據後才勾選；本計畫交付時全部維持未完成。

- [ ] T01：技術骨架、版本鎖定、UUIDv7 generator、lint/typecheck/build 可用。
- [ ] T02：Local MariaDB 10.11、migration runner、隔離測試 DB 可用。
- [ ] T03：八張核心表、native UUID、lifecycle provenance、one-document-one-treenode、複合 FK／CHECK／UNIQUE 經真實 DB 驗證。
- [ ] T04：Domain models／CallerContext／ports 與核心規則 unit tests 通過。
- [ ] T05：Repositories 與 READ COMMITTED 共用 connection transaction／rollback 通過。
- [ ] T06：Local identity 四欄位、CallerContext 與 seed 可用，無前端身分信任捷徑。
- [ ] T07：最小 application create/read/revision/lifecycle/hierarchy 行為通過。
- [ ] T08：Mapping／reappearance／source version race／atomicity 通過。
- [ ] T09：最小 Web flow 與 Chromium smoke 通過。
- [ ] T10：驗收紀錄完整、scope／dependency review 通過。

| 後續階段 | 本次交付接點 | 仍留在後續階段的工作 |
| --- | --- | --- |
| Phase 1 | Knowledge models、repositories、CallerContext、commands／queries、Tree invariants | 完整 Knowledge／Tree 產品能力與管理 UI |
| Phase 2 | SourceEntry／asset／SyncRun repositories、version guard、Sources UoW、內部 Knowledge mutations | Folder 非 ZIP 上傳、掃描／解析、Title Resolution、缺 ID matching／歧義、diff、Preview storage／期限／snapshot binding、首次 Source 建立與完整 Confirm／Apply 流程 |
| Phase 3 | 四欄位 IdentityProvider、既有 CallerContext、Source org owner、lifecycle current provenance | 真正授權政策／分享／完整 audit history／公司 SSO；不能把 Phase 0 local fixture visibility 當企業 ACL |
| Phase 4–9 | UI-independent application core、stable IDs／revisions、清楚 consumer boundary | Discovery、authoring、publishing、MCP、semantic retrieval、memory／relations；Agent write 若真的需要才建立 Principal/Actor model |

Phase 0 的內部源更新 fixtures 不保證任意 folder rename 可被識別，也不決定來源 title；Phase 2 必須在既有契約下定義 matching、Title Resolution 與 Preview 的產品規則。Phase 0 的 revision row locks 不代表完整作者衝突處理已完成。資產 metadata 不代表附件可存取。

## 9. 本計畫自我審查

| 面向 | 審查結論 |
| --- | --- |
| 對齊 design spec | 每個 task 對照已確認章節；八張核心表、最小 identity/CallerContext、ownership、revision、Tree uniqueness、lifecycle provenance 與交易規則均有工作及驗證 |
| 實際專案起點 | 已確認無 application code；檔案清單是預計新增，不引用不存在的既有符號 |
| 實作細節 | DB driver、migration、testing、UoW、constraint、source guard 有具體選擇；套件實際版號在 T01 解析並鎖定 |
| IDs | UUIDv7 由 application 產生，MariaDB 10.11 使用 native UUID；不保留 CHAR(36) 舊選擇 |
| Caller boundary | CallerContext 是 public service 顯式第一參數；identity 由 transport/provider 建立，不從 payload 或 ambient state 取得 |
| Actor model | Phase 0–2 繼續使用 user FK；不提前導入 actor_kind，Agent write 留給實際需求 phase |
| Isolation | Canonical mutation UoW 明訂 READ COMMITTED 並保留 Source/Document FOR UPDATE；concurrency test 使用兩條 connection |
| Lifecycle provenance | archive/restore 同步更新 status 與 actor/time；完整 append-only audit 歷史留 Phase 3 |
| Tree uniqueness | one-document-one-treenode 在 T03 直接成為 DB invariant，不等 Phase 1 才修 |
| 循環 FK | 暫時 nullable bootstrap 與完整 domain 狀態分開；不假稱 FK 可禁止所有不完整 commit |
| DDL／DML rollback | Migration 失敗採診斷／隔離重建，Knowledge 原子性測試不混入 DDL |
| Module direction | Knowledge 的 source-policy port 由 infrastructure 注入；Sources 共用內部 mutation，沒有反向 scanner 依賴 |
| Mapping ownership | SourceEntry 的解析與 lifecycle 寫入由 Sources 在同一 UoW 負責；Knowledge 只收穩定 Document reference 與內容 |
| SourceEntry ambiguity / Title | 不以 path/hash 唯一鍵或 filename title 假裝解決來源辨識；matching 與 Title Resolution 明確交 Phase 2 |
| Sync scope | 僅 version guard、repositories 與 atomicity fixture；沒有建 scanner／Preview／Confirm／Apply 產品入口 |
| Identity／governance | 四欄位不擴張；CallerContext 只建立 contract；完整 policy、SSO、audit history 仍屬後續治理 |
| E2E 前提 | 專用 DB、seed、build server 與 port；不重用 dev server，清理目標受限制 |
| 測試可信度 | DB／browser 不可用不算通過；concurrency 使用兩條真實連線；沒有預填 verification 結果 |
| 範圍控制 | 沒有預裝後續 editor／drag／search／MCP／publishing／memory、Agent actor model 或 binary storage |

本次僅產出本 implementation plan，未安裝依賴、建立 schema、執行 application tests 或部署。下一次執行計畫從 T01 開始，以 §7／§8 的證據判定 Phase 0 是否完成。
