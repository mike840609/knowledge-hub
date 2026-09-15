# Knowledge Hub — Phase 4 Discovery & Read API Design

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-16 |
| 文件定位 | Phase 4 canonical design：Workspace-aware keyword discovery 與 read boundary |
| 決策依據 | Phase 0 ADR（MariaDB 10.11）、Phase 3 governance spec、Phase 3 product closure spec、本機實測基準 |
| 前置條件 | Phase 3 Product Acceptance PASS（product closure spec §27） |
| 專案入口 | [README](../../../README.md) |

## 1. 決策摘要

Phase 4 在既有 canonical 資料表上提供 Workspace-aware 的關鍵字搜尋與讀取邊界，交付面只有 Human Web。

```text
使用者輸入關鍵字
→ server 計算「呼叫者可讀的 Workspace 集合」
→ 單一 SQL 在該集合內對目前版本做子字串比對
→ 依標題命中數與更新時間排序
→ 回傳含 snippet 的分頁結果
```

**不新增 schema、不新增 derived index、不新增外部服務。** 這個決策由實測決定，不是沿用「搜尋一定要有索引」的慣例；理由見 §4。

## 2. 目標

- Workspace-aware 的 keyword discovery，中英混合內容都能搜。
- 搜尋結果永遠不外洩呼叫者無權閱讀的內容。
- 與 Knowledge Tree 完全一致的預設可見性（ACTIVE-only）。
- 可預測的效能上限，以及明確的升級觸發條件。

## 3. 非目標

- HTTP JSON Read API 與 MCP：Phase 7 有真實 Agent identity 時再處理。
- Embedding／vector／semantic／hybrid retrieval：Phase 8。
- 簡繁互通、同義詞、相關度評分（BM25 等）。
- metadata（frontmatter）欄位篩選：目前沒有既定 key 慣例，等真實需求出現再加。
- Source／Document ACL：Phase 3 spec §13 已定 Workspace 是唯一授權邊界。

## 4. 為什麼是 LIKE scan：bedrock 事實與實測

### 4.1 環境事實（2026-09-16 於本機 `mariadb:10.11` 容器實測）

| 事實 | 實測結果 | 影響 |
| --- | --- | --- |
| Full-text parser plugin | `information_schema.ALL_PLUGINS` 中 **沒有任何 FTPARSER**，沒有 ngram、沒有 Mroonga | InnoDB `FULLTEXT` 只能用內建 parser，中文整句會變成單一 token，`MATCH ... AGAINST` 對中文不可用 |
| `innodb_ft_min_token_size` | 3 | 短詞會被忽略 |
| `utf8mb4_bin` 下 `LIKE` | 分大小寫 | 查詢必須明確 `COLLATE utf8mb4_unicode_ci`；欄位本身維持 `utf8mb4_bin` 不變 |
| `utf8mb4_unicode_ci` 下 `LIKE` | 不分大小寫；全形「ＳＷＦＰ」可比對到 `swfp`；中文子字串可比對 | 符合中英混合需求 |
| 簡體 vs 繁體 | 「请假」**比對不到**「請假」 | 明確列為非目標，並以測試鎖住現況 |
| `LIKE ? ESCAPE '!'` | 可用 | 不依賴 `sql_mode` 的反斜線設定 |
| `LOCATE` / `SUBSTRING` | 依**字元**計算，非 byte | snippet 不會切壞中文字 |
| `SET STATEMENT max_statement_time=N FOR ...` | 可用；逾時回 **errno 1969** | 可精準捕捉逾時 |

### 4.2 效能基準

語料：20,000 份文件、276 MB Markdown、中英混合、`innodb_buffer_pool_size` = 128 MB（表大於 buffer pool）。

| 查詢 | 耗時 |
| --- | --- |
| 本文 `LIKE '%中文詞%'`（cold） | 2,272 ms |
| 本文 `LIKE '%中文詞%'`（warm） | 1,940 ms |
| 本文 `COLLATE utf8mb4_unicode_ci LIKE '%english%'` | 1,602 ms |
| 本文 `LOWER(markdown) LIKE '%english%'` | 2,501 ms |
| 標題 `COLLATE utf8mb4_unicode_ci LIKE '%中文詞%'` | 3 ms |

結論：

- **用 `COLLATE ... LIKE`，不要用 `LOWER()`**：實測快約 36%，且 `LOWER()` 無法處理全形。
- 20k 文件規模下，全本文掃描約 1.6–2.5 秒，**隨語料線性成長**。以第一年預估 20k 文件為上限，這是可接受的起點。
- 標題掃描成本可忽略。

### 4.3 與慣例的差異

慣例做法是直接引入搜尋引擎或自建 n-gram 索引。在這個規模下，索引買到的是還用不到的速度，代價是每條寫入路徑都要維護、而且會有 derived data 與 canonical data 不一致的風險。Phase 0 ADR 也把 retrieval backend 選型留到 Phase 8。因此 Phase 4 選擇不建索引，改為明訂升級觸發條件（§10）。

## 5. 搜尋範圍與授權

### 5.1 核心規則

**比對即閱讀。** 一筆命中等於告訴呼叫者「這份文件含有這個詞」，因此搜尋只在具備 `document.read` 的 Workspace 內比對。只能 discover 不能 read 的 Workspace 不產生任何命中、筆數或名稱。

這是 Phase 3 authorization clarification 要求「Phase 4 search 必須沿用同一套 discover/read 區分」的具體落實。

### 5.2 授權集合計算

route 與 query string 裡的 ID 一律只是導覽範圍，不是授權證明。

- `scope=workspace`：以 `requireWorkspaceRead(caller, workspaceId)` 授權。
- `scope=all`：取 `WorkspaceQueryService.listWorkspaces(caller)`（已含 PERSONAL 擁有者驗證、group mapping 聯集與 My Space 置頂排序），逐一 `evaluateWorkspaceCapabilities` 後只保留具 `document.read` 者。

**不另外抽 `listAccessibleWorkspaces`**：Phase 3 product closure 已把聚合邏輯集中在 `listWorkspaces`，搜尋直接重用，避免與 `WorkspaceAdminService.navigation` 疊床架屋。

### 5.3 授權失敗的呈現

沿用 Phase 3 product closure 落地後的既有慣例（`src/server/workspace-settings-read.ts`）：

```text
WORKSPACE_NOT_FOUND / WORKSPACE_ACCESS_DENIED / INSUFFICIENT_WORKSPACE_CAPABILITY
→ notFound()
```

不新增 403 專用畫面。四個可指派角色目前都含 `document.read`，「可 discover 不可 read」在現行角色模型下不可達；底層區分仍以 §5.1 與 §9.1 的警報測試保留。

### 5.4 Source 篩選

`sourceId` 在 SQL 內與授權 Workspace 清單一起過濾。授權範圍外的 Source 回傳 0 筆，與不存在的 Source 完全相同，因此無法用這個參數探測 Source 是否存在。

### 5.5 封存語意

預設可見性與 Knowledge Tree 完全一致：`knowledge_tree_nodes`、`knowledge_documents`、`knowledge_sources` 三者都必須是 ACTIVE。

| 情境 | 預設 | `archived=1` |
| --- | --- | --- |
| ARCHIVED Source／Document／Tree node | 排除 | 納入 |
| ARCHIVED Team Workspace（`scope=all`） | 排除 | 納入 |
| ARCHIVED Team Workspace（`scope=workspace` 明確指定） | 可搜尋 | 可搜尋 |

明確指定已封存 Team 仍可搜尋，因為 Phase 3 spec §14.1 允許已封存 Team 的授權閱讀；此時頁面沿用既有的 archived workspace banner。Workspace 的封存狀態直接讀 `WorkspaceNavigationItem.lifecycleState`，不需額外查詢。

### 5.6 比對對象

只比對每份 Document 的**目前版本**（`current_revision_id`）的標題與 Markdown 本文。歷史版本永不進入搜尋。

## 6. 查詢語意與 SQL

### 6.1 查詢解析（純函式，不碰 DB）

`parseSearchQuery` 位於 `src/modules/knowledge/domain/search-query.ts`：

- 依空白切詞；JavaScript 的 `\s` 已包含全形空白 U+3000。
- 重複詞去重。
- 上限：`q` 200 字元、5 個詞、單詞 64 字元；超過即截斷或拒絕。
- 多詞為 **AND**：每個詞都必須出現在標題或本文。
- 不支援布林運算子與引號片語。
- 跳脫 `!`、`%`、`_`（前置 `!`），SQL 使用 `ESCAPE '!'`。
- 空查詢或純空白不打 DB。

### 6.2 SQL

`MariaDbKnowledgeSearchRepository` 只下一個查詢。授權 Workspace 清單為空時直接回傳空結果，不送 SQL。

```sql
SET STATEMENT max_statement_time=5 FOR
SELECT d.id AS document_id, d.source_id, s.workspace_id, r.title,
       s.name AS source_name, w.name AS workspace_name, d.status, d.updated_at,
       CASE WHEN LOCATE(?, r.markdown COLLATE utf8mb4_unicode_ci) > 0
            THEN SUBSTRING(r.markdown,
                           GREATEST(LOCATE(?, r.markdown COLLATE utf8mb4_unicode_ci) - 60, 1), 160)
            ELSE SUBSTRING(r.markdown, 1, 160) END AS snippet,
       ((r.title COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!') /* 每個詞一項 */) AS title_hits
FROM knowledge_documents d
JOIN knowledge_revisions r  ON r.id = d.current_revision_id
JOIN knowledge_tree_nodes n ON n.document_id = d.id
JOIN knowledge_sources s    ON s.id = d.source_id
JOIN workspaces w           ON w.id = s.workspace_id
WHERE s.workspace_id IN (?, ...)
  AND (? = 1 OR (d.status = 'ACTIVE' AND s.status = 'ACTIVE' AND n.status = 'ACTIVE'))
  AND (? = 1 OR d.source_id = ?)
  AND (r.title    COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!'
    OR r.markdown COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!')   /* 每個詞重複一組 */
ORDER BY title_hits DESC, d.updated_at DESC, d.id ASC
LIMIT ? OFFSET ?
```

`knowledge_tree_nodes` 以 `uq_tree_one_document` 保證每份 Document 最多一個節點，因此 JOIN 不會放大列數。

### 6.3 排序

1. 標題命中的詞數（多者在前）
2. `d.updated_at`（新者在前）
3. `d.id`（保證順序固定）

### 6.4 Snippet

- 以**第一個查詢詞**為錨點：該詞命中本文時，自其前 60 字起取 160 字。
- 第一個詞未命中本文者（含只命中標題的情況）取本文前 160 字。
- 以純文字呈現，不渲染 Markdown。
- 命中詞以 `<mark>` 標示，JS 端不分大小寫比對。**已知限制：** JS 端不做全形轉換，全形命中可能不會被標示。

### 6.5 分頁

- 每頁 20 筆，實際取 21 筆判斷是否有下一頁。
- `page` 上限 50（第 50 頁的 OFFSET 為 980）。
- **不計算總筆數**：`COUNT` 等於再掃一次語料，會讓回應時間加倍。

### 6.6 逾時

以 `max_statement_time=5` 包住查詢。逾時（errno 1969）在搜尋 repository 內就地轉為 `SearchTimeoutError`，頁面顯示「搜尋逾時，請縮小範圍」。不修改共用的 `mapDatabaseError`（該函式目前回傳 import 專用錯誤）。

## 7. 模組配線與 UI

### 7.1 新檔案

| 檔案 | 責任 |
| --- | --- |
| `src/modules/knowledge/domain/search-query.ts` | `parseSearchQuery`、跳脫、highlight 切段；純函式 |
| `src/modules/knowledge/ports/knowledge-search-repository.ts` | 搜尋 port |
| `src/modules/knowledge/application/knowledge-search-service.ts` | 解析 → 授權集合 → repository → 組結果 |
| `src/infrastructure/database/mariadb/repositories/knowledge-search.ts` | §6.2 的 SQL |
| `src/server/search-read.ts` | 頁面 read model，沿用 `workspace-settings-read.ts` 的 try/catch + `notFound()` |
| `src/app/w/[workspaceId]/search/page.tsx` | 搜尋頁 |
| `src/components/search/search-form.tsx` 等 | 表單與結果列 |

### 7.2 既有檔案改動

- `src/modules/knowledge/ports/unit-of-work.ts`：`KnowledgeRepositories` 增加 `search`；`repositories/index.ts` 一併接上。
- `src/server/composition.ts`：`buildApplicationServices` 回傳值增加 `search`。
- `src/server/workspace-admin.ts`：`WorkspaceActions` 增加 `canSearch`，`deriveWorkspaceActions` 以 `has("document.read")` 推導。
- `src/components/shell/primary-nav.tsx`：依 `access.actions.canSearch` 顯示 Search 項目（lucide `Search` icon），與 Sources／Settings 同一套模式。

### 7.3 頁面行為

路由：`/w/[workspaceId]/search?q=&scope=workspace|all&source=&archived=1&page=`

- **表單用 GET**：沒有 JavaScript 也能用，網址可直接分享。
- **欄位**：關鍵字、範圍（本 Workspace／全部）、Source（僅單一 Workspace 範圍顯示）、顯示封存。
- **結果列**：標題連往 `/w/{workspaceId}/knowledge/{sourceId}/{documentId}`；封存模式保留 `includeArchived=true`。標題下方為 Workspace · Source、兩行 snippet、更新時間。
- **狀態**：未輸入、查無結果、逾時、輸入過長各有對應畫面。
- **分頁**：上一頁／下一頁連結，保留既有查詢參數。
- 樣式沿用 `SourceListRow` 的 `kh-*` token、hover 與 focus ring。

### 7.4 導覽可見性

依 product closure spec §9：導覽顯示與否由 server 產生的 actions 決定；隱藏導覽**不是** security boundary，直接輸入網址仍由 server 授權擋下。

## 8. 錯誤處理

| 情境 | 行為 |
| --- | --- |
| 無法 discover 的 Workspace | `notFound()` |
| 可 discover 不可 read | `notFound()`（§5.3） |
| 查詢逾時（errno 1969） | `SearchTimeoutError` → 逾時畫面，非 500 |
| 空查詢／純空白 | 不打 DB，顯示初始狀態 |
| `q` 超過 200 字元 | 不打 DB，顯示過長提示 |

## 9. 測試計畫

### 9.1 單元測試（不需 DB）

| # | 需求來源 | 測試 |
| --- | --- | --- |
| U1 | §6.1 | `parseSearchQuery`：一般詞、全形空白分詞、重複去重、超過 5 詞、單詞超長、空字串、純空白 |
| U2 | §6.1 | 跳脫：`%`／`_`／`!` 被跳脫；內容含 `100%` 時搜 `100%` 不變成萬用字元 |
| U3 | §5.1、§5.3 | **權限警報**：任一角色若具 `document.discover` 而無 `document.read` 即失敗，強制同批改用 `requireWorkspaceRead` |
| U4 | §6.4 | highlight：命中標示、不分大小寫、無命中不標 |
| U5 | §5.2 | 授權集合過濾：以假 repository 確認 discover-only Workspace 被排除 |
| U6 | §7.2、§7.4 | `deriveWorkspaceActions`：缺 `document.read` 時 `canSearch` 為 false（純函式；vitest 環境為 `node`，不渲染 React） |

### 9.2 整合測試 `tests/integration/phase4-search.test.ts`（需 DB）

| # | 需求來源 | 測試 |
| --- | --- | --- |
| I1 | §5.2 | 跨 Workspace 只回傳呼叫者可讀的內容 |
| I2 | §5.1 | 非成員搜不到，關鍵字再精確也一樣 |
| I3 | §5.2 | 透過 SSO group mapping 取得權限的 Workspace 可被搜到 |
| I4 | §4.1 | 中英混合：「請假」可搜；`swfp`／`SWFP` 不分大小寫；全形「ＳＷＦＰ」可搜；簡體「请假」**搜不到**（鎖住現況） |
| I5 | §6.1 | AND 語意：兩詞分別在標題與本文算命中；缺一詞不命中 |
| I6 | §5.5 | 封存預設：Source／Document／Tree node 三種封存預設都不出現，`archived=1` 才出現 |
| I7 | §5.5 | 已封存 Team：明確指定可搜；`scope=all` 預設不含 |
| I8 | §5.6 | 只搜目前版本：舊版內容搜不到，新版搜得到 |
| I9 | §5.4 | 授權範圍外的 `sourceId` 回 0 筆，與不存在的 ID 一致 |
| I10 | §6.3 | 排序：標題命中優先，其後依更新時間與 id |
| I11 | §6.5 | 分頁：21 筆判斷有無下一頁、`page` 上限 |
| I12 | §6.1 | 萬用字元注入：內容含 `100%` 時搜 `100%` 只命中該筆 |

### 9.3 E2E（Playwright）

| # | 測試 |
| --- | --- |
| E1 | 從側邊導覽進入 Search，輸入中文關鍵字，看到結果並點進文件 |
| E2 | 結果永不含無成員資格 Workspace 的 `restricted-secret-body-9f31` |
| E3 | 封存切換，連結保留 `includeArchived=true` |
| E4 | 查無結果的空狀態 |
| E5 | 非成員直接輸入搜尋網址得到 404（§7.4：隱藏導覽不是 security boundary）。`canSearch` 為 false 的推導由 U6 覆蓋；四個可指派角色都含 `document.read`，因此「導覽隱藏 Search」在現行角色模型下不可達，無法以 E2E 驗證 |

### 9.4 Fixture

在 `scripts/db/seed.ts` 的 Query Master 內新增一份中英混合文件（例如標題「請假流程 SWFP Leave Policy」），常數依既有慣例鏡射到 E2E spec（Playwright 無法解析 `@/` alias）。

## 10. 效能驗收與升級觸發條件

- 以 §4.2 的實測數字為基準寫入 verification 記錄。
- **升級觸發條件：** production 搜尋 p95 超過 1 秒。
- 觸發後的升級方向依序評估：先縮小掃描範圍（例如把本文比對限制在必要欄位或加上前置過濾），再考慮 derived n-gram 索引表，最後才是外部搜尋引擎。外部引擎的選型仍依 Phase 0 ADR 留給 Phase 8。
- 在觸發前不建立 derived index，避免引入需要跨寫入路徑維護的一致性負擔。

## 11. 驗收條件

- 搜尋結果永不包含呼叫者無 `document.read` 的內容（I1、I2、E2）。
- 預設可見性與 Knowledge Tree 一致（I6）。
- 中英混合、全形、大小寫行為符合 §4.1（I4）。
- 逾時回傳逾時畫面而非 500（§6.6）。
- §9 所有測試案例通過。
- Phase 3 Product Acceptance 為 PASS 之後才開始實作（product closure spec §27）。
