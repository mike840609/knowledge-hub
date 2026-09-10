# Knowledge Hub — 設計審查（Critical / High）

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-10 |
| 文件定位 | 對現有設計文件的獨立審查；只列 Critical 與 High，不重寫既有決策 |
| 審查對象 | [Phase 0 Design Spec](../specs/2026-09-10-phase-0-foundation-architecture-design.md)、[Phase 0 Implementation Plan](../plans/2026-09-10-phase-0-foundation-implementation.md)、[Phase 1 Design Spec](../specs/2026-09-10-phase-1-knowledge-core-tree-design.md)、[Phase 0–9 Roadmap](../roadmaps/2026-09-10-knowledge-hub-phase-roadmap.md) |
| 審查基準 | 文件內部一致性、MariaDB 10.11 的實際行為、跨 Phase 契約是否成立、HR 知識平台的治理需求 |
| 狀態 | 審查意見；未修改任何已核准設計。每項需由設計擁有者決定接受、改寫或明確拒絕 |

本審查不評論文件品質。現有四份文件在範圍控制、ownership 邊界、交易原子性與「不把未決定當已決定」這幾點上寫得相當嚴謹，下列問題都是在那個基礎上仍會實際造成損害的缺口。

## 1. 結論摘要

| ID | 嚴重度 | 主題 | 最早爆炸的階段 | 現在修的成本 |
| --- | --- | --- | --- | --- |
| C1 | Critical | 中文內容的 keyword search 與 MariaDB 全文檢索不相容 | Phase 4 | 低（改 roadmap 前提） |
| C2 | Critical | Document `title` 的來源未定義，與「rename 不產生 revision」直接衝突 | Phase 2 | 低（補一節規則） |
| C3 | Critical | 全量 Apply 單一交易沒有規模上限；Preview→Apply 的內容保管未定 | Phase 2 | 中（要改契約） |
| C4 | Critical | Archive／Restore／Move 沒有 actor 與時間紀錄，但 archive 就是本系統的刪除 | Phase 1 | 低（現在加欄位） |
| H1 | High | Identity 是 ambient 的，read services 沒有 caller 參數 | Phase 3／7 | 低（現在改簽名） |
| H2 | High | Actor model 只能表達 `users`，Agent／System 無法作為 `created_by` | Phase 7／9 | 低 |
| H3 | High | 「誰開交易」在 Phase 0 §4.4 與 Phase 1 §15 定義不一致 | Phase 2 | 低 |
| H4 | High | 未指定 isolation level；`FOR UPDATE` 不會刷新 REPEATABLE READ snapshot | Phase 1 | 低 |
| H5 | High | Preview 的 diff 基準與 revision 的 canonical hash 不同 | Phase 2 | 低 |
| H6 | High | MariaDB 的 `JSON` 是 LONGTEXT，metadata 篩選沒有索引路徑 | Phase 4 | 中 |
| H7 | High | Archived ancestor／Source 的可見度沒有 denormalize | Phase 4／8 | 中 |
| H8 | High | 單篇上傳沒有定義歸屬的 Source | Phase 5 | 低 |
| H9 | High | `org_code` 是扁平字串，沒有階層也沒有生效期間 | Phase 3 | 中 |
| H10 | High | `CHAR(36)` 隨機 UUID 主鍵 | Phase 2 | 低（現在改） |
| H11 | High | 每個 revision 複製整份 Markdown，沒有去重與保留政策 | Phase 2 | 中 |
| H12 | High | `source_path TEXT` 無法索引，Phase 2 比對沒有索引路徑 | Phase 2 | 低 |
| H13 | High | Phase 0 缺 one-document-one-treenode 唯一約束 | Phase 1 | 低 |

C1、C2、C4、H1、H2、H4、H10、H13 建議在 T01 開工前定案，成本幾乎為零；其餘可在對應 Phase 的 design spec 內處理，但必須在 roadmap 留下明確標記。

## 2. Critical

### C1 — 中文內容的 keyword search 與 MariaDB 全文檢索不相容，Phase 4 目標目前不可達

**現況：** Roadmap Phase 4 明確承諾「先完成一般 keyword／metadata discovery，不要求 embedding、vector 或 Elasticsearch」，並把語意搜尋整段推到 Phase 8。ADR-001 同時決定 canonical datastore 為 MariaDB 10.11，且 Phase 0「不引入 Elasticsearch」。

**問題：** MariaDB 的 InnoDB／MyISAM FULLTEXT 以空白與標點切詞，並且**不內建 ngram 或 MeCab full-text parser**（那是 MySQL 5.7+ 的功能，MariaDB 只留 parser plugin API 而沒有隨附實作）。中文段落沒有空白，整段會被切成單一 token，`MATCH ... AGAINST` 實際上搜不到東西。本專案所有設計文件、目標使用者與 tKMS 發布對象都是中文情境，Knowledge 內容幾乎必然以中文為主。

因此 Phase 4 只剩三條路，而三條都與已寫下的約束相牴觸：

- `LIKE '%關鍵字%'` — 對 LONGTEXT 全表掃描，`knowledge_revisions` 是本系統成長最快的表（見 H11），這條在資料量上去後會直接拖垮 canonical DB。
- 自建斷詞後寫入 shadow token 欄位 — 等於在 Phase 4 提前做 derived index，而 roadmap 把 derived index 定義在 Phase 8。
- 提前引入外部搜尋引擎 — 直接違反 Phase 4 的範圍邊界與 ADR-001 的 Consequences。

**影響：** Phase 4 的「完成後的能力：使用者能搜尋並讀取符合條件的知識」在目前技術基線下無法交付。這不是效能調校問題，是功能不成立。M2 里程碑同時受影響。

**建議：**

1. 在 roadmap Phase 4 明確寫出語言前提與可行方案，不要讓「不需要 Elasticsearch」看起來是已驗證的結論。
2. 把 Phase 4 的搜尋範圍降級為誠實可交付的部分：`title` + `metadata` + 樹狀路徑的結構化篩選（這些是短欄位，可正常索引），全文檢索標記為「需另行決策」。
3. 對全文檢索三選一並記為 ADR：(a) Phase 4 就引入 derived search index 並承認它是 derived data（與 ADR-001「索引不得成為 canonical」並不衝突）；(b) 接受 Phase 4 只做前綴／結構化搜尋，全文合併到 Phase 8；(c) 在 Hub 內做中文斷詞寫入 token 欄位，並明確定義它是 derived、可重建。
4. 若選 (a) 或 (c)，Phase 1 的 revision 寫入路徑就需要預留 index invalidation 的接點，這會回頭影響 H7。

### C2 — Document `title` 的來源未定義，與「rename 不產生 revision」直接衝突

**現況：** Phase 0 §4.4 與 Phase 1 §12 都把規則寫得很死：

```text
來源檔名／路徑 rename   → 不產生 revision
文章 title 修改         → 產生 revision
```

Phase 1 §6.3 進一步規定 DOCUMENT node 不保存第二份 title，顯示名稱一律取自 `current_revision.title`。Phase 1 §32.1 的驗收案例也直接寫死 `✓ title change creates R2`。

**問題：** 四份文件沒有任何一處定義「Folder Sync 時，`title` 從來源的哪裡取得」。同時 ADR-007 與 Phase 0 §4.3 明確要求 source-agnostic：「來源不必具有特定 frontmatter ID，也不能要求所有 generator 使用同一種格式」。一般 Markdown wiki 大量文件沒有 frontmatter `title`，實務上 title 只能取自檔名或第一個 H1。

只要 title 有「檔名 fallback」，這兩條規則就互相矛盾：

```text
docs/Notes.md  →  docs/Meeting-Notes.md

以 SourceEntry 判定：同一 entry，只是 RENAMED  → 依 §4.4 不產生 revision
以 title 判定：    title 由 Notes 變 Meeting-Notes → 依 §4.4 必須產生 revision
```

同一次來源變更同時命中「不產生 revision」與「必須產生 revision」兩條已核准規則。

**影響：** 這條規則是 Phase 2 diff 與 §7.6 idempotency 的基礎。未定義的結果是：Phase 2 會被迫臨時發明一套 title 規則，而它會反過來決定 revision 是否產生、Preview 顯示 `RENAMED` 還是 `UPDATED`、以及「相同 folder 重複同步 = 0 new revisions」是否成立。這是最便宜、也最容易被漏掉的一個定義。

**建議：** 在 Phase 1 spec 補一節 `Title Resolution`，把優先序寫死並列為 ADR：

```text
1. frontmatter.title（若存在且 trim 後非空）
2. 文件內第一個 H1（若存在）
3. 檔名去副檔名
```

並明確補上一句衝突裁決規則：**當 title 來自 fallback（2 或 3）且該次變更已被 SourceEntry 判定為 RENAME 時，仍視為內容變更並產生 revision**（或明確選擇相反方向）。無論選哪一邊，都要同步修正 Phase 0 §4.4 的表格與 Phase 1 §12、§32.1，讓三處說同一件事。

### C3 — 全量 Apply 單一交易沒有規模上限，且 Preview→Apply 的內容保管未定

**現況：** Phase 0 §7.5 要求整次 Apply 在單一 transaction 內完成，「50 個變更在第 32 個失敗時，前 31 個也要 rollback；MVP 沒有 partial success」。§4.6 的 version guard 是交易內第一個動作，會對 `knowledge_sources` 該列取得 X lock 並持有到 commit。Phase 1 §9 又規定**所有** Tree mutation 都要先 `SELECT ... FROM knowledge_sources WHERE id = ? FOR UPDATE`。

**問題一：交易規模沒有上限。** 文件用「50 個變更」當例子，但實際輸入是「團隊整個 Markdown folder」，沒有任何地方限制檔案數。以一個 3,000 篇的 wiki 首次匯入為例，單一交易要寫入約 3,000 筆 document、3,000 筆 revision（含 LONGTEXT 本文）、3,000+ 筆 tree node、3,000 筆 source entry，全部在同一個 InnoDB 交易內：

- `innodb_lock_wait_timeout` 預設 50 秒。同 Source 的任何其他 Tree mutation（Phase 1 §9）在整段期間全部阻塞至逾時。
- undo log 與 history list 在交易期間無法 purge；長交易同時拖累整個 instance 的 purge thread。
- 這條交易跑在 Next.js server action 內，request 生命週期與部署層的 timeout 都不受 MariaDB 控制；中途被切斷會留下需要靠 lock 逾時回收的長交易。

**問題二：Preview 到 Apply 之間，內容住在哪裡沒有定義。** §7.2 要求「掃描、解析及 snapshot 準備在 Apply 交易之前完成」，§7.3 又要求 Preview「不建立 Revision、不 archive、不修改 SourceEntry」，並把 preview 的保存方式整段推給 Phase 2。但 Apply 需要的是**完整的解析後內容**，不只是 `changes` 摘要。目前只剩兩種可能，兩種都有未評估的成本：

- Confirm 時由瀏覽器重送整個 folder — 3,000 個檔案上傳兩次；而且 Next.js App Router 的 Server Actions 預設 body 上限是 1 MB（`serverActions.bodySizeLimit`），這條路在預設設定下連 Preview 都過不了。
- 伺服器端暫存解析結果 — 這需要一張 staging 表或檔案暫存區，而 §7.3 寫著「不是 Phase 0 必須額外建立的第九張 table」，Phase 0 §2.2 又排除 binary storage。這條路可行（staging 不是 canonical state，不違反 Preview 唯讀原則），但目前沒有被承認為必要元件。

**影響：** Phase 2 是 M1 里程碑的核心，而它最關鍵的兩個工程約束（交易規模、內容保管）目前都是空的。等到 Phase 2 才發現要改「全量單一交易」這條 ADR-011 的核心決策，成本遠高於現在。

**建議：**

1. 現在就對 Source 規模定一個明確上限（檔案數與總位元組），超過即在 Preview 階段拒絕並說明。有上限的「全量原子」才是可實作的承諾。
2. 在 ADR-011 補上這個上限，並說明超過上限時的預期做法（例如要求拆分 Source），而不是把 partial success 偷渡回來。
3. 明確承認 Preview staging 是 Phase 2 的必要元件，並寫下它的性質：非 canonical、可清除、以 `snapshot_hash` 綁定、隨 `expires_at` 過期。這與「Preview 不修改 canonical Knowledge」完全相容，現在講清楚可以避免 Phase 2 誤以為被禁止。
4. 在 Phase 0 §7.5 補一句交易期間的鎖影響說明，讓 Phase 1 §9 的 source-level lock 與 Phase 2 的長交易被當成同一個問題處理。

### C4 — Archive／Restore／Move 沒有 actor 與時間紀錄，但 archive 就是本系統的刪除

**現況：** Phase 0 §5 的八張表中，只有 `knowledge_sources`、`knowledge_documents`、`knowledge_revisions` 有 `created_by`，`sync_runs` 有 `triggered_by`。`knowledge_tree_nodes` 連 `created_at`／`updated_at` 都沒有。`knowledge_documents` 有 `updated_at` 但沒有 `updated_by`。

Phase 1 §18／§19／§29.3 定義的 archive／restore 只改 `status` 欄位，沒有任何一處寫入操作者或時間。

**問題：** ADR-008 的理由是「來源缺檔可能是暫時的，文件引用與 revision history 必須保留」，所以 MVP 不 hard delete。但這代表 **archive 就是這個系統對外唯一的刪除語意**。目前的 schema 無法回答下列任何一個問題：

```text
這份文件是誰 archive 的？什麼時候？
是人手動 archive，還是某次 sync 判定來源缺檔？
這份文件從 A folder 被移到 B folder，是誰做的？
這個 Source 是誰 archive 的？
```

`created_by` 只覆蓋內容作者，不覆蓋任何 lifecycle 或 hierarchy 動作。Phase 1 §31 的 20 條 core invariants 也完全沒有提到可追溯性。

**影響：** 這是 HR 知識平台，內容包含制度、流程與人事相關文件，並且要發布到 tKMS。「誰讓這份文件從系統中消失」是這類平台的基本稽核要求。等到 Phase 3「基本治理」或更後面才補，代表所有 Phase 1／Phase 2 期間的操作都沒有紀錄，而且要回頭改 Phase 1 的每一個 command 簽名與交易邊界。現在加的成本是三個欄位加一張表。

**建議：**

1. `knowledge_documents` 與 `knowledge_tree_nodes` 補 `updated_by`、`created_at`、`updated_at`；`knowledge_sources` 補 `archived_by`／`archived_at`。
2. 更好的做法是在 Phase 0 加第九張表 `knowledge_events`（`id, source_id, document_id?, tree_node_id?, event_type, actor_id, actor_kind, occurred_at, detail JSON`），只 append，與 canonical mutation 同交易寫入。這同時解掉 H2 的 actor 問題，也給 Phase 8 一個現成的 index invalidation 來源（見 H7）。
3. 把「所有 lifecycle 與 hierarchy mutation 都必須記錄 actor」加入 Phase 1 §31 的 core invariants，讓它變成驗收條件而不是善意。
4. 若決定不做，要在 spec 明寫「Phase 1–2 期間的 archive 不可追溯」，讓這個風險是被選擇的而不是被遺漏的。

## 3. High

### H1 — Identity 是 ambient 的，read services 沒有 caller 參數，授權無法在 core 邊界強制

Phase 0 §6.1 的契約是 `getCurrentIdentity(): Promise<UserIdentity>`，沒有參數。Phase 1 §22 的所有 read services 也沒有 caller 參數：

```text
listTree(sourceId, includeArchived = false)
getDocument(documentId, includeArchived = false)
```

但 Phase 0 §6.5 與 ADR-013 的目標是「Human Web 與 Agent 共用 application services」，Phase 3 要求「Application services 共用的可信 caller context」，Phase 7 要 MCP 直接重用同一組服務。

沒有參數表示 caller 只能來自 ambient context（Next.js request scope 或 AsyncLocalStorage）。三個後果：

- MCP server、背景工作、CLI fixture 都不在 request scope 內，Phase 7 只能另外撐一套 context 注入，等於 ADR-013 想避免的「平行邏輯」。
- 型別系統無法保證每個 read 都套用了 org 邊界；漏掉一個查詢就是一個靜默的越權讀取，而且 code review 看不出來。
- Phase 1 §22 明說「Phase 4 HTTP Read API 與 Phase 7 MCP 可直接 reuse」，但這個簽名一旦被 Phase 1 的實作與測試固定下來，Phase 3 就必須修改每一個 read service 的呼叫點。

**建議：** 現在把 caller context 變成顯式的第一個參數，即使 Phase 0／1 內容只有四個欄位、還沒有任何授權判斷：

```ts
type CallerContext = { identity: UserIdentity; /* Phase 3 再加 policy */ };
listTree(ctx: CallerContext, sourceId: string, opts?: { includeArchived?: boolean }): Promise<KnowledgeTreeItem[]>
```

Phase 3 加規則時只改實作，不改所有呼叫點；Phase 7 只要能造出 `CallerContext` 就能接上。

### H2 — Actor model 只能表達 `users`，Agent 與 System 無法作為 `created_by`

`knowledge_revisions.created_by`、`knowledge_documents.created_by`、`sync_runs.triggered_by` 全部外鍵指向 `users.id`，而 `users` 的語意是「員工」（`emp_id UNIQUE`）。ADR-012 把 `UserIdentity` 鎖死在四個欄位，Phase 7 也明確要求「不預先擴張 Phase 0 的 UserIdentity 欄位」。

但 Phase 9 的核心流程是 memory → knowledge 的 promotion，Phase 2 的 sync 也是由流程而非人直接產生內容。這些寫入需要一個 `created_by`，而系統裡只有員工。可預期的結果是塞假的 `users` 資料列（`emp_id = 'SYSTEM'`、`emp_id = 'AGENT-001'`），把非人主體混進員工表——這在 HR 系統裡是特別糟的一種汙染。

**建議：** 現在把 actor 與 employee 分開：`actor_id` + `actor_kind`（`USER` / `AGENT` / `SYSTEM`），`USER` 才外鍵到 `users.id`。這不擴張 `UserIdentity` 四欄位契約（那是身分解析的產物），只是承認「寫入者」比「員工」大。與 C4 建議的 `knowledge_events` 是同一組欄位，可以一起做。

### H3 — 「誰開交易」在 Phase 0 §4.4 與 Phase 1 §15 定義不一致

Phase 0 §4.4 寫得很清楚：內部 mutation functions「接受已綁定的 repositories，不自行 commit」，Sources 在自己的 UoW 內呼叫相同 mutation functions。

Phase 1 §15.2 則把同一件事包裝成一個 service：

```text
SourceKnowledgeProjectionService
  projectDocument / projectRevision / projectFolder / ...
```

Service 這個命名與 Phase 1 §29 每個操作各自標「必須 atomic」的寫法，很自然會被實作成「每個方法自己開一個交易」。若如此，Phase 2 的全量 Apply 就變成 N 個獨立交易，ADR-011 的「全部成功或全部失敗」直接失效，而且是靜默失效——單元測試每個方法都會過。

**建議：** 在 Phase 1 §15 明寫這兩個 command service 的方法**必須**接受一個已開啟的 unit of work，不得自行 begin／commit；並把「external caller 開交易」寫進 §29 的前言。同時在 Phase 1 的驗收清單加一個案例：一次交易內連續 projection，中途失敗時前面的變更全部不存在。

### H4 — 未指定 isolation level；`FOR UPDATE` 不會刷新 REPEATABLE READ 的 snapshot

Phase 1 §9 宣稱 source-level lock 可以阻止兩個各自驗證通過的 move 合成 cycle：

```text
A: folder1 → folder2
B: folder2 → folder1
```

MariaDB 預設 isolation level 是 REPEATABLE READ，而四份文件沒有任何一處指定 isolation level。在 REPEATABLE READ 下，交易的一致性快照是在**該交易第一次讀取時**建立的，之後的 `SELECT ... FOR UPDATE` 是 current read、會拿到最新資料，但**不會刷新後續非鎖定 `SELECT` 所使用的快照**。

因此若交易的執行順序是「先讀點東西 → 再鎖 Source → 用普通 SELECT 走 ancestry 驗證」，ancestry 驗證讀到的是取得鎖之前的舊快照，B 的變更看不見，兩個 move 就都會通過驗證。鎖有拿到，保證卻不成立。

**建議：** 三選一並寫進 spec，不要留給實作者猜：

1. 交易一律使用 `READ COMMITTED`（每個 statement 重新取得快照，語意最直覺）；或
2. 明訂 `SELECT ... FOR UPDATE` 必須是交易的**第一個** statement，且驗證用的讀取都在其後；或
3. 所有 hierarchy 驗證讀取一律使用鎖定讀。

同時把 H4 的驗收案例寫實：Phase 1 §32.2 的 `✓ concurrent cycle-producing moves cannot both succeed` 必須用兩條真實連線、且第二條交易在鎖之前先做一次讀取，才測得到這個 bug。

### H5 — Preview 的 diff 基準與 revision 的 canonical hash 不同，Preview 會顯示不會發生的 UPDATED

`source_entries.content_hash`（Phase 0 §5）是來源 entry 的內容雜湊；`knowledge_revisions.content_hash` 與 Phase 1 §13 定義的 canonical hash 涵蓋 `{title, markdown, metadata}`，並做 CRLF→LF 與 metadata key 遞迴排序的正規化。

兩者不是同一個東西，而文件沒有說 Phase 2 的 diff 要用哪一個。若 Preview 用檔案層 hash：

```text
frontmatter 的 key 順序調整 / YAML 縮排改變 / 行尾由 LF 變 CRLF
→ 檔案 hash 改變
→ Preview 顯示 UPDATED
→ Apply 時 canonical hash 相同
→ Phase 1 §11「if unchanged: return current revision」
→ 實際上沒有任何 revision 產生
```

使用者看到「12 篇文件將被更新」，確認後系統什麼都沒做。Preview 與 Apply 不一致，直接違反 ADR-010「Preview 必須對應使用者看過的變更」的精神，也讓 §7.6 的 idempotency（重複同步 = 0 new revisions）在真實 wiki 上不成立——很多 generator 每次輸出都會重排 frontmatter。

**建議：** 在 Phase 1 §13 明寫 `source_entries.content_hash` 與 revision canonical hash 的關係，並規定 **Preview 的 UPDATED 判定必須以 canonical hash 為準**（也就是 Preview 階段就要跑完 parse 與 normalization，這本來就是 §7.2 要求「解析在 Apply 之前完成」的必然結果）。檔案層 hash 可保留為 scan 的快速略過機制，但不得直接對應到 Preview 的變更類型。

### H6 — MariaDB 的 `JSON` 是 LONGTEXT，Phase 4 的 metadata 篩選沒有索引路徑

Phase 0 §5 選擇「`knowledge_revisions.metadata` 可使用 MariaDB JSON 欄位保存 frontmatter」。與 MySQL 不同，**MariaDB 的 `JSON` 只是 `LONGTEXT` 的別名加上 `json_valid()` CHECK**，沒有二進位表示、沒有 JSON path 索引、每次讀取都要重新解析全文。

Roadmap Phase 4 的交付項目包含「Keyword／metadata search 與條件篩選」。在目前 schema 下，`WHERE JSON_EXTRACT(metadata, '$.category') = ?` 只能全表掃描 `knowledge_revisions`——而這正好是本系統最大、成長最快的表。

**建議：** 決定 metadata 的查詢契約，並寫進 Phase 1 spec：

- 若 metadata 僅供顯示與 provenance，明寫「metadata 不可查詢」，並把 Phase 4 的「metadata 篩選」從 roadmap 移除或降級。
- 若需要查詢，現在就定義做法：對已知欄位建 generated column + index，或另建 `knowledge_revision_metadata(revision_id, key, value)` 的 KV 表與交易同寫。兩者都需要在 Phase 1 的 revision 寫入路徑留接點，Phase 4 才補會很痛。

### H7 — Archived ancestor 與 Source 的可見度沒有 denormalize

Phase 1 §21 明確規定 Source archive 是 visibility gate，不 cascade 修改 descendants：`Source ARCHIVED → 整棵 Tree 預設不可見`，但每個 child 的 `status` 維持原值。Phase 0 T07 同時要求預設讀取「亦不列 archived 祖先底下節點」。

也就是說，一份文件是否可見，不是它自己 `status` 欄位能決定的，必須沿著 tree 往上走到 Source。目前沒有 materialized path、沒有 `root_source_status` 之類的 denormalize 欄位，`knowledge_documents` 上也沒有 `org_code`。三個後果：

- 每次 `getDocument` 都要做一次祖先遞迴才能決定可見性，而不是一次索引查詢。
- Phase 4 的搜尋結果過濾同理，等於每筆命中都要補一次祖先查詢。
- Phase 8 的 derived index 抓不到失效事件：archive 一個 Source 會改變 N 篇文件的可見性，但那 N 列完全沒有被 UPDATE，任何以資料列變更為基礎的增量索引都偵測不到，索引會持續回傳已不可見的文件——包含未來 MCP 給 Agent 的結果。

**建議：** 兩個方向擇一並記為 ADR：

1. 在 `knowledge_documents` denormalize `source_id` 已有的情況下再加 `org_code` 與 `effective_status`（隨 Source／ancestor 變更於同交易內更新），讓可見性成為單列可判定；或
2. 保留遞迴判定，但明確要求所有 Source／folder 的 lifecycle 變更寫入 C4 建議的 `knowledge_events`，並由 Phase 8 以事件而非資料列變更驅動重新索引。

無論選哪個，都應在 Phase 1 §30「Default Archived Filtering」補一句：archived 過濾必須涵蓋祖先與 Source，且此規則對 Phase 4 搜尋與 Phase 7 MCP 同樣具強制力。

### H8 — 單篇上傳沒有定義歸屬的 Source

Phase 0 §4.1 規定「每份 Document 必須且只屬於一個 Source，包括單篇上傳與 Web 建立的文件」，§4.2 定義 `FILE_UPLOAD` 與 `HUB` 兩種 source type，兩者 ownership 都是 `HUB_MANAGED`、行為完全相同。

但沒有任何一處說明：使用者在 Phase 5 上傳一份 FAQ 時，這份文件進到**哪一個** Source？三種可能各有問題，而文件沒有選：

- 每次上傳建立一個新 Source → Phase 1 §24 的 Source selector 與 Phase 4 的 Source 篩選會被幾百個單篇 Source 淹沒。
- 每個 org 一個隱含的 `FILE_UPLOAD` Source → 那它由誰建立、`created_by` 是誰、可否 archive，全部未定義。
- 由使用者選一個既有 HUB Source → 那 `FILE_UPLOAD` 這個 type 就沒有存在必要。

**建議：** 在 Phase 1 或 Phase 5 spec 定義 Hub-managed Source 的生命週期（誰建、怎麼命名、預設有幾個），並重新檢視 `FILE_UPLOAD` 與 `HUB` 是否應該合併為單一 type。既然 ownership 與行為完全相同，多一個 enum 值只是多一個要維護的 CHECK 組合。

### H9 — `org_code` 是扁平字串，沒有階層也沒有生效期間

`users.org_code` 與 `knowledge_sources.org_code` 都是 `VARCHAR(128)` 的單一值，Phase 0 §4.1 說它是「歸屬／治理邊界」。

HR 場景有兩個結構性事實，目前的模型都表達不了：

- **組織是樹狀的。** 「處長要看得到底下所有課的知識」在扁平字串上無法表達，Phase 3 的存取判斷只能做字串相等比對，或臨時發明前綴規則。
- **組織會改組，人也會調動。** `users.org_code` 只有現值，沒有生效期間。Source 的 `org_code` 若被改寫，過去的治理歸屬就消失了；`knowledge_events`（若採納 C4）之外沒有任何地方留下「這份知識在被建立時屬於哪個組織」。

Phase 3 的範圍邊界寫著「不把同 org 視為當然擁有所有文件權限」，方向正確，但沒有承認扁平 `org_code` 本身就不足以承載後續規則。

**建議：** 現在不需要做完整的組織主檔，但應在 Phase 0／1 spec 加一段「org_code 的已知限制」，明列：扁平無階層、無生效期間、改組時的行為未定義；並把「組織階層解析」列為 Phase 3 的必要設計項目而非可選項。若已知會接公司 HR 主檔，`org_code` 的長度與格式應該現在就對齊那份主檔，而不是自訂 128。

### H10 — `CHAR(36)` 隨機 UUID 主鍵

Implementation plan §2 選擇「server 以 UUID 產生，資料庫使用一致的 `CHAR(36)` ASCII binary collation」。若是 UUIDv4，這在 InnoDB 上有兩個已知代價，而 Phase 2 的批次匯入正好是最糟的使用情境：

- **隨機插入順序造成 B+ tree page split。** 一次寫入數千列 document／revision／tree node，每列都落在隨機位置，寫入放大與 buffer pool 汙染都遠高於順序主鍵。
- **36 位元組的主鍵會被複製進每一個 secondary index。** `knowledge_tree_nodes` 上有 `(source_id, parent_id)`、`(source_id, document_id)`、`document_id` 等多個索引，每個都額外背 36 bytes/列。改用 `BINARY(16)` 可省約 55%，改用時間有序的 UUIDv7／ULID 可同時解掉插入順序問題。

Plan 已經寫下「不使用路徑、title 或 content hash 產生 Document identity」，這點完全正確，這裡要改的只是**編碼與排序性**，不是 identity 語意。

**建議：** 在 T01／T03 定案前改為時間有序 ID（UUIDv7 或 ULID），儲存為 `BINARY(16)`，在 repository 邊界做編解碼。這是純實作選擇，不影響任何已核准的 domain 決策，但過了 T03 之後再改就是全表 migration。

### H11 — 每個 revision 複製整份 Markdown，沒有去重與保留政策

`knowledge_revisions` 每一列都存完整 `markdown LONGTEXT`。依 Phase 0 §4.4，只改 `title` 或只改 `metadata` 都會產生新 revision——連同整份本文再複製一次。加上 ADR-008 的「MVP 不 hard delete」，`knowledge_revisions` 是唯一單調成長且永不縮減的表。

以 3,000 篇、平均 20 KB、每篇一年 20 個版本估算就是約 1.2 GB 純本文，而每次 folder sync 只要 generator 重排了 frontmatter（見 H5）就可能整批產生新版本。這同時放大 C1 的 `LIKE` 掃描成本。

**建議：** 現在不必實作，但要在 spec 明確承認並選一個方向：

- 內容與版本分離：`revision_contents(content_hash PK, markdown)`，`knowledge_revisions` 只存 `content_hash`。相同本文的 title-only 變更不再複製本文，且與 Phase 1 §13 已定義的 hash 契約完全相容。
- 或明寫「MVP 接受完整複製」，並在 roadmap 標記保留政策為後續必要工作。

第一個方向現在做幾乎沒有額外成本，事後做則需要搬移全部歷史資料。

### H12 — `source_path TEXT` 無法索引，Phase 2 的比對沒有索引路徑

Implementation plan §4.2 選擇 `source_path` 為 `TEXT`。同一節又說「`source_path` 保存 locator，但不做全域 identity／content-hash 唯一鍵」——方向正確，但 Phase 2 在沒有 `external_id` 時**必須以 path 查詢既有 SourceEntry**（ADR-007：「path 是 locator」）。`TEXT` 欄位不指定前綴長度就無法建索引，於是每次比對只能全表掃描或把整個 Source 的 entries 全載入記憶體。

**建議：** 加一個 `source_path_hash BINARY(32)`（SHA-256 of normalized path）並建 `UNIQUE (source_id, source_path_hash)` 於 ACTIVE entry 上，或改用有長度上限的 `VARCHAR` 並建前綴索引。同時明訂 path 的正規化規則（分隔符、大小寫、Unicode NFC），否則 macOS 與 Linux 產生的同一份 folder 會被判定為不同 entry——這對「各團隊自己跑 LLM wiki」的情境是會實際發生的。

### H13 — Phase 0 缺 one-document-one-treenode 唯一約束；Phase 1 又回頭改 Phase 0 的表

兩個相關的小裂縫：

- Phase 1 §6.1 與 §31 invariant 7 要求「每個 Document 在 Knowledge Tree 中只能有一個 node」，並說明 `knowledge_tree_nodes.document_id` 要對非 NULL 值建立唯一性保護。但 **Phase 0 §5.1 的 invariant 表沒有這一條**，implementation plan §4.2 也沒有列這個 UNIQUE。Phase 0 的 T03 因此會建出一個允許同一 Document 掛兩個 TreeNode 的 schema，而 Phase 0 的 DoD 會判定通過。
- Phase 1 §5 說「Phase 1 不重做 schema」，但 §5.1 隨即為 `source_entries` 增加 `tree_node_id`。這與 Phase 0 §5「八張核心表」與 DoD「migration 可從空 DB 建出八張核心表與必要約束」的定案語氣不一致。

第二點還帶出一個未寫下的約束：`source_entries` 同時持有 `source_id`、`tree_node_id`、`document_id` 三個引用，§5.2 要求 `tree_node.document_id = source_entry.document_id`。這需要在 `knowledge_tree_nodes` 上加 `UNIQUE (id, document_id)` 才能用複合外鍵保護（`document_id` 為 NULL 時 InnoDB 的 MATCH SIMPLE 語意會自動略過檢查，folder entry 不受影響），目前沒有寫。

**建議：** 把這兩條約束一併移進 Phase 0 的 §5.1 invariant 表與 plan §4.2，讓 T03 一次建到位；並在 Phase 1 §5 改寫為「Phase 1 沿用 Phase 0 schema，並補上以下已納入 Phase 0 migration 的約束」，避免出現兩個版本的「核心 schema」。

## 4. 建議處理順序

**開工前（T01 之前，成本接近零）：** C2、C4、H1、H2、H4、H10、H13。這七項全部是定義與欄位層級的決定，一旦 T03 建表或 Phase 1 固定 service 簽名，成本就跳一個級距。

**Phase 0 spec 修訂：** C1（改 roadmap Phase 4 的前提）、C3（補 Source 規模上限與 staging 的定位）、H3（明訂交易擁有者）、H6、H11、H12。

**列入對應 Phase 的設計責任並在 roadmap 標記：** H5（Phase 2）、H7（Phase 4／8）、H8（Phase 5）、H9（Phase 3）。

## 5. 審查中確認沒有問題的部分

以下項目經檢查後認為設計正確，列出以免後續被誤改：

- **§4.6 的 version guard 寫法是正確的。** 條件式 `UPDATE ... WHERE sync_version = ?` 在 InnoDB 下是 current read：競爭交易會先卡在列鎖上，取得鎖後重新讀取最新已提交版本並重新評估 `WHERE`，因此 `affectedRows` 會是 0。這確實能保證「最多一個成功」，不需要額外的 `SELECT ... FOR UPDATE`。
- **Document／Revision 的循環外鍵處理正確。** InnoDB 對複合外鍵採 MATCH SIMPLE 語意（任一欄為 NULL 即略過檢查），所以 `current_revision_id = NULL` 的 bootstrap 列可以通過 `(id, current_revision_id)` 複合外鍵；plan §4.3 也正確地指出這代表 SQL 層無法單獨禁止未完成列被提交，必須靠 application 的 pre-commit assertion 補上。這段的推理沒有問題。
- **FAILED 紀錄另開交易保存**（§7.5）、**DDL 隱式提交不得混入原子性測試**（plan T02）、**外部副作用不參與 DB 交易**（ADR-014）三處都正確，是實務上很常被寫錯的地方。
- **禁止 `force` / `bypassOwnership` flag，改以不同 application interface 表達 mutation authority**（Phase 1 §15–16）是好的設計，比旗標更難被誤用。
- **Phase 1 §28 的 `expectedCurrentRevisionId`** 在 Phase 1 就定義而不是留給 Phase 5，方向正確。
