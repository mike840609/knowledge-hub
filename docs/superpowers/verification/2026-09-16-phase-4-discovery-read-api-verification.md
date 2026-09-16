# Phase 4 Discovery & Read API — Verification

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-16 |
| Spec | docs/superpowers/specs/2026-09-16-phase-4-discovery-read-api-design.md |
| Plan | docs/superpowers/plans/2026-09-16-phase-4-discovery-read-api.md |
| 受測分支 | `feat/phase-4-discovery-read-api`，起點 commit `25fa456` |
| 執行環境 | macOS、worktree `km-wt-1`、Node v24.6.0、npm 11.5.1、MariaDB 10.11.19（Docker `hcm-km-phase0-mariadb-1`，127.0.0.1:3307） |

## 指令與結果

第一輪執行（`25fa456`，未做任何修改）：

| 指令 | 結果 |
| --- | --- |
| `make verify` | PASS — unit 27 檔／215 測試、typecheck、lint、build 全部通過，exit 0 |
| `npm run test:integration` | PASS — 36 檔／365 測試，exit 0 |
| `npm run test:e2e` | **FAIL** — 33 passed／9 failed，exit 1 |

`test:e2e` 第一輪失敗的 9 個案例（`knowledge-browser.spec.ts` ×3、`phase2.5-knowledge-explorer.spec.ts` ×3、`revision-history.spec.ts` ×3）全部因為找不到標題為「Architecture」的文件而逾時。Phase 4 本身的 5 個 E2E 案例（`phase4-search.spec.ts`）在這一輪已全數通過。

**根因排查**：`scripts/db/seed.ts` 內 `seedBrowserFixtures` 原本用「`obsidianWikiSource` 的 tree 是否為空」判斷是否為全新資料庫，只有為空才建立 Architecture／Runbooks／Retired Notes 三份種子文件。Task 5 的 commit `b0dbaca` 把 Phase 4 搜尋 fixture（`searchDocument`／`searchNode`）的建立寫在同一個交易內、且早於這個空表判斷之前執行，導致在全新資料庫上該表永遠不再是空的，Architecture 等三份文件因此永遠不會被建立——這是一個真實的 fixture 排序 bug，不是環境雜訊或既有已知缺陷。

**修復**：將 `searchDocument`／`searchNode` 的建立移到「`treeCount.length === 0` 判斷與 Architecture／Runbooks／Retired 建立」之後，改為獨立的 `unitOfWork.run` 區塊（與檔案中既有的 archived-source fixture 採同一種寫法）。改動檔案：`scripts/db/seed.ts`。

修復後重跑完整 gate（同一分支，含此修復）：

| 指令 | 結果 |
| --- | --- |
| `make verify` | PASS — unit 27 檔／215 測試、typecheck、lint、build 全部通過，exit 0 |
| `npm run test:integration` | PASS — 36 檔／365 測試（含 `core.test.ts` 的「seed 跑兩次不重複」冪等測試），exit 0 |
| `npm run test:e2e` | PASS — 42 passed／0 failed，exit 0（26.2s） |

修復後三個 gate 全部通過，無任何被跳過或選擇性重跑的案例；上表的 42 個 E2E 案例即為完整的 `tests/e2e/*.spec.ts` 套件（含 Phase 4 的 5 個案例）。

## 需求對應

### 單元測試（U1–U6，不需 DB）

| # | 測試檔 | 案例 | 結果 |
| --- | --- | --- | --- |
| U1 | `tests/unit/phase4-search-query.test.ts` | `parseSearchQuery`：一般詞、全形空白分詞、重複去重、超過 5 詞、單詞超長、空字串／純空白 | PASS |
| U2 | `tests/unit/phase4-search-query.test.ts` | `toLikePattern`：跳脫 `!`／`%`／`_`；`100%` 不變成萬用字元 | PASS |
| U3 | `tests/unit/phase4-search-capability.test.ts` | 「discover-vs-read tripwire」：無角色可 discover 而不能 read | PASS |
| U4 | `tests/unit/phase4-search-query.test.ts` | `highlightSnippet`：命中標示、不分大小寫、無命中不標 | PASS |
| U5 | `tests/unit/phase4-search-authorization.test.ts`（`excludes a discover-only Workspace from the workspaceIds handed to the repository`） | 授權集合過濾：以假 `KnowledgeUnitOfWork`／`WorkspaceUnitOfWork` 驅動真正的 `KnowledgeSearchService.search`，`evaluateWorkspaceCapabilities` mock 成回傳 discover-only（無 `document.read`）與可讀兩種集合，斷言傳給 `repositories.search.search` 的 `workspaceIds` 排除前者 | PASS（先前記錄誤指向 `tests/integration/phase4-search-service.test.ts:76`：該測試的 `outsider` fixture 無任何成員資格，`accessible` 清單本身即為空，`readableWorkspaces` 的迴圈從未執行，把它換成 `return [...candidateIds]` 該測試仍會通過，並未鎖住 §5.2 的過濾邏輯。已驗證新測試在還原該替換後會失敗，替換回原始碼後恢復通過） |
| U6 | `tests/unit/phase4-search-capability.test.ts` | `canSearch` 推導：具 `document.read` 為 true、discover-only 為 false、封存 Team 仍為 true | PASS |

### 整合測試（I1–I12，需 DB）

| # | 測試檔 | 案例 | 結果 |
| --- | --- | --- | --- |
| I1 | `tests/integration/phase4-search-service.test.ts` | `never leaks content of unreadable workspaces in an all-scope search` | PASS |
| I2 | `tests/integration/phase4-search-service.test.ts` | `hides a non-member's workspace behind a non-enumerating not-found` | PASS |
| I3 | `tests/integration/phase4-search-service.test.ts` | `includes workspaces granted through a validated SSO group mapping` | PASS |
| I4 | `tests/integration/phase4-search-repository.test.ts` | `matches mixed Chinese/English content case- and width-insensitively` | PASS |
| I5 | `tests/integration/phase4-search-repository.test.ts` | `requires every term to match either the title or the body` | PASS |
| I6 | `tests/integration/phase4-search-repository.test.ts` | `hides a document archived together with its tree node unless includeArchived is set` / `hides documents under an archived source unless includeArchived is set` | PASS |
| I7 | `tests/integration/phase4-search-service.test.ts` | `keeps an archived Team searchable when scoped to it, but out of all-scope by default` | PASS |
| I8 | `tests/integration/phase4-search-repository.test.ts` | `searches only the current revision` | PASS |
| I9 | `tests/integration/phase4-search-repository.test.ts` | `treats an out-of-scope source filter exactly like a missing one` | PASS |
| I10 | `tests/integration/phase4-search-repository.test.ts` | `ranks title hits above body-only hits and returns correct snippet and attribution fields` | PASS |
| I11 | `tests/integration/phase4-search-repository.test.ts`（`applies limit and offset for pagination`）＋ `tests/integration/phase4-search-service.test.ts`（`reports hasNext using one extra row beyond the page size`） | 分頁：21 筆判斷有無下一頁、limit/offset | PASS（**缺口**：`page` 上限 50、offset 980 的邊界本身沒有專屬測試案例；程式碼中 `SEARCH_MAX_PAGE = 50` 的 clamp 邏輯目前只靠程式碼審查覆蓋，未被任何自動化測試鎖住） |
| I12 | `tests/integration/phase4-search-repository.test.ts` | `treats wildcard characters in the query as literal text` | PASS |

### E2E（E1–E5）

| # | 測試檔／案例 | 結果 |
| --- | --- | --- |
| E1 | `tests/e2e/phase4-search.spec.ts` › `finds a mixed Chinese/English document and opens it` | PASS |
| E2 | `tests/e2e/phase4-search.spec.ts` › `never returns content from a workspace without membership` | PASS |
| E3 | `tests/e2e/phase4-search.spec.ts` › `keeps archived mode on result links` | PASS |
| E4 | `tests/e2e/phase4-search.spec.ts` › `shows an empty state when nothing matches` | PASS |
| E5 | `tests/e2e/phase4-search.spec.ts` › `returns 404 for a workspace the caller cannot access` | PASS（僅涵蓋可達的一半：非成員直接輸入網址得到 404） |

**已知偏離（刻意，非缺口）**：spec §9.3 E5 前半句「`canSearch === false` 時導覽隱藏 Search」在現行角色模型下不可達——四個可指派角色（OWNER/ADMIN/EDITOR/VIEWER）都含 `document.read`，因此無法建立 `canSearch === false` 的 fixture 來驗證導覽隱藏。這段推導邏輯改由 U6（`tests/unit/phase4-search-capability.test.ts`）在純函式層級鎖住；E2E 只驗證「非成員 404」這個可達且屬於實際 security boundary 的部分。

## 效能基準

語料建置方法：拋棄式資料庫 `scratch_phase4_bench`，單一表 `bench_docs(id INT PK, title VARCHAR(512), markdown LONGTEXT)`，`title`／`markdown` 皆為 `CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`、InnoDB；以 `SELECT seq FROM seq_1_to_20000` 產生 20,000 列，`markdown` 為 `REPEAT(CONCAT('人資系統請假流程說明 Employee Leave Policy ', seq, ' 公司規範與簽核 '), 180)`，每第 200 列額外附加一個稀有標記字串。實測語料大小（`SUM(OCTET_LENGTH(title)+OCTET_LENGTH(markdown))`）為 **277.1 MB**，`innodb_buffer_pool_size` 為 **128 MB**（`134217728` bytes），與 spec §4.2 的測試環境一致。跑完即以 `DROP DATABASE scratch_phase4_bench;` 刪除，並以 `SHOW DATABASES` 二次確認資料庫已不存在（未寫入 dev／test 資料庫）。

| 查詢 | 本次實測 | spec §4.2 基準 | 說明 |
| --- | --- | --- | --- |
| 本文 LIKE（cold） | 778.99 ms | 2,272 ms | `markdown LIKE '%人資系統%'`（bin collation，中文子字串比對） |
| 本文 LIKE（warm，同查詢再跑一次） | 812.81 ms | 1,940 ms | 同上，緊接著再執行一次 |
| 本文 COLLATE utf8mb4_unicode_ci LIKE（English） | 836.24 ms | 1,602 ms | `markdown COLLATE utf8mb4_unicode_ci LIKE '%Employee%'` |
| 本文 LOWER(markdown) LIKE | 1,285.42 ms | 2,501 ms | `LOWER(markdown) LIKE '%employee%'` |
| 標題 COLLATE utf8mb4_unicode_ci LIKE | 2.48 ms | 3 ms | `title COLLATE utf8mb4_unicode_ci LIKE '%請假%'` |

本次實測全文掃描耗時普遍比 spec §4.2 基準快（約 3 成到 6 成），標題掃描則與基準幾乎一致（2.48 ms vs 3 ms）。這是機器負載與硬體差異造成的資訊性落差，不是失敗——本次執行機器當下沒有其他負載與此前 §4.2 量測環境不同，屬預期範圍。結論不變：全文掃描與語料量成線性關係，`COLLATE ... LIKE` 仍明顯快於 `LOWER()`（本次快約 35%，基準約 36%，兩次量測方向一致）。

升級觸發條件（spec §10）：**production 搜尋 p95 超過 1 秒**。觸發後依序評估：先縮小掃描範圍，再考慮 derived n-gram 索引表，最後才是外部搜尋引擎；外部引擎選型留給 Phase 8（Phase 0 ADR）。在觸發前不建立 derived index。

**基準的已知限制**：

(a) 本基準建立的是單一表 `bench_docs(id, title, markdown)` 語料，量測的是裸 `LIKE` 掃描。實際上線的查詢並非如此——它是一個五表 join（`knowledge_documents` → `knowledge_revisions` → `knowledge_tree_nodes` → `knowledge_sources` → `workspaces`），帶 `workspace_id IN (...)`、三個 status 條件、逐 term 的 `LIKE` 配對、查詢內的 `LOCATE`/`SUBSTRING`，以及對計算欄位 `title_hits` 的 filesort（見 `src/infrastructure/database/mariadb/repositories/knowledge-search.ts:63-80`）。因此上表數字是實際成本的**下界**，不是對已上線查詢的量測。spec §10 的「production p95 超過 1 秒」觸發條件即建立在這份證據之上，故第一次 production p95 量測才應被視為真正的校準點。此限制源自 spec §4.2 訂定的基準方法，Task 6 被要求依樣重現以求可比較——這是基準方法的既有限制，不是本次基準執行的缺陷。

(b) p95 警訊也可能來自本文件記錄的升級路徑未涵蓋的原因：`src/modules/knowledge/application/knowledge-search-service.ts` 中的 `readableWorkspaces`（約第 89-100 行）對每個候選 workspace 個別呼叫 `evaluateWorkspaceCapabilities`，而每次呼叫都會發出兩次查詢（`workspaceMemberships.find` 與 `groupMappings.listByWorkspace`），且是在已執行過的 `listWorkspaces`之外額外疊加。若呼叫者身處 30 個 workspace，掃描開始前大約要付出 60 次序列化的資料庫往返。收到 p95 警訊時，應先檢查往返次數，再假設瓶頸是掃描本身。

## 前置條件狀態

Phase 3 Product Acceptance：**PASS**，記錄於 `docs/superpowers/verification/2026-09-15-phase-3-workspace-governance-verification.md`（該檔案位於分支 `docs/phase-3-product-acceptance`，非本分支；引用其路徑與狀態，未合併或 cherry-pick 至本分支）。

## 修改的檔案

本節記錄**本驗收記錄產出當下**（commit `a50e2b5`）的變更，以及其後因審查而追加的修正。

驗收當下：

- `scripts/db/seed.ts`：修復 Phase 4 搜尋 fixture 建立順序，避免搶在「是否為全新資料庫」的空表判斷之前寫入 `obsidianWikiSource` 的 tree，導致 Architecture／Runbooks／Retired Notes 種子文件永遠不被建立。
- `docs/superpowers/verification/2026-09-16-phase-4-discovery-read-api-verification.md`：本驗收記錄（新增）。

驗收後、依整支分支審查追加（commit `c2ea863`）：

- `src/app/w/[workspaceId]/search/page.tsx`、`src/lib/search-params.ts`、`tests/unit/phase4-search-params.test.ts`：重複查詢參數（`?q=a&q=b`）會讓 `searchParams` 交付陣列而造成 500；於路由邊界正規化並放寬型別宣告。
- 本記錄的效能基準章節：補記基準只測單表 `LIKE`、非實際上線的五表 JOIN，數字為下限。

驗收後、依設計符合性審查追加（commits `a73f3a6`、`1565c94`、`8e91643`）：

- `tests/unit/phase4-search-authorization.test.ts`（新增）：鎖住 §5.2 `scope=all` 的 `document.read` 過濾（U5）。
- `tests/unit/phase4-search-repository-timeout.test.ts`、`tests/unit/phase4-search-read.test.ts`（新增）：補上 §6.6 逾時路徑的兩端覆蓋（errno 1969 轉譯、非逾時錯誤原樣傳遞、`timedOut` 狀態）。
- `src/server/search-read.ts`：還原 §7.1 指定的授權 try/catch。
- `src/components/search/search-form.tsx`、`src/components/search/search-results.tsx`：依 §7.3 讓 Source 篩選只在單一 Workspace 範圍顯示，並從全範圍分頁連結移除失效的 `source` 參數。

## 已知缺口

- I11 的 `page` 上限 50（offset 980）邊界沒有專屬自動化測試，僅由程式碼審查覆蓋。
- E5 前半句（`canSearch === false` 時導覽隱藏）在現行角色模型下不可達，已在上方「已知偏離」註記，非本次新增缺口。
