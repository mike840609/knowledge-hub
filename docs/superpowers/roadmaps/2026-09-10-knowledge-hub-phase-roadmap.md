# Knowledge Hub — Phase 0–9 目標與路線圖

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-10 |
| 文件定位 | 各階段目標、主要交付、完成後的能力與範圍邊界 |
| 決策依據 | 原對話「KM 各階段實作規劃 - 全部重做」與 [Phase 0 Design Spec](../specs/2026-09-10-phase-0-foundation-architecture-design.md) 的 Future Phase Interfaces |
| 目前狀態 | Phase 0 spec／plan 已完成；所有 Phase 的程式實作尚未開始 |
| 專案入口 | [README](../../../README.md) |

本路線圖整理已確認的階段方向，不將 Phase 1–9 的目標冒充已完成詳細設計。每一階段仍需自己的 design spec、implementation plan 與實際驗收證據。本文件不設定未確認的期限、投入人力或未來技術選型。

## 1. 產品目標與共同原則

建立 source-agnostic Knowledge Hub，讓不同團隊以自己的 LLM Wiki／Markdown workflow 產生知識，再由 Hub 統一保存、瀏覽、查詢及供後續 Agent 使用。HR／發布者可另外編排 Publishing Tree 並發布至 tKMS。

所有階段都必須保留下列原則：

- `org_code → KnowledgeSource → Folder / Document Tree`；每個 Source 一個 org owner，每份 Document 都有 Source。
- Source、Tree、Document、Revision 各自有清楚責任；穩定 Document ID 不依賴 path 或外部系統 ID。
- `title / markdown / knowledge metadata` 版本化，Revision immutable；hierarchy move／檔名 rename 不產生內容版本。
- Folder Sync 為 SOURCE_MANAGED，Hub 唯讀；單篇匯入與 Web 建立為 HUB_MANAGED，可建立新 revision。
- Lifecycle 僅 ACTIVE／ARCHIVED；不 hard delete，同一 entry 重現沿用原 Document ID。
- Folder Upload 直接選取整個 folder，不使用 ZIP；先 Preview、再 Confirm、最後 transactional Apply。
- Assets MVP 只存 metadata/reference；不承諾 binary storage 或圖片／附件 serving。
- 身分 contract 固定為 `{id, emp_id, name, org_code}`，外部開發使用 local/mock provider；SSO 在公司環境再補。
- MariaDB 10.11 保存 canonical Knowledge；未來搜尋索引是 derived data。
- Human Web 與 Agent 共用 application services；MCP 是接入層，Agent Memory 是獨立 domain。

## 2. 階段總覽

| Phase | 名稱 | 核心目標 | 主要接續基礎 |
| --- | --- | --- | --- |
| 0 | Foundation & Architecture | 可測試、可擴充的架構與資料基礎 | 新專案與確認的設計 |
| 1 | Knowledge Core & Tree | 完整的 Knowledge identity、revision、lifecycle 與 Tree | Phase 0 |
| 2 | Knowledge Source Import & Sync | 可靠地將來源 folder 同步為 Hub Knowledge | Phase 1 core、Phase 0 sync safety |
| 3 | Identity & Basic Governance | 最小且共用的 owner／access boundary | Phase 0 identity、Phase 1–2 資料來源 |
| 4 | Discovery & Read API | 人與 Agent 可共用的讀取／搜尋服務 | Phase 1 core、Phase 3 governance |
| 5 | Human Authoring | 人可在 Hub 上傳／建立／編輯知識 | Phase 1 revisions、Phase 3 governance |
| 6 | tKMS Publishing | 將知識重新編排並發布至外部目的地 | Core／read／governance／authoring 能力 |
| 7 | Agent & MCP Access | Agent 可依身分安全讀取 Knowledge | Phase 3 governance、Phase 4 read services |
| 8 | Semantic & Hybrid Retrieval | 語意與 keyword 結合的 retrieval | Phase 4 query boundary、穩定 revision 資料 |
| 9 | Agent Memory & Knowledge Relations | 受治理的長期記憶、知識關聯與 context | Core／governance／Agent／retrieval 基礎 |

交付順序維持 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9。「主要接續基礎」說明技術依賴，不表示所有前一階段功能都必然是下一階段的架構依賴。

## 3. 各 Phase 目標

### Phase 0 — Foundation & Architecture

**目標：** 建立後續工作可沿用的模組化單體架構、核心 schema、身分與交易邊界。

主要交付：

- Next.js、React、TypeScript、Tailwind、shadcn/ui 與本地 MariaDB 10.11 基線。
- `identity`、`knowledge`、`sources` 三個 module，明確分離 domain／application／infrastructure。
- 八張核心表：users、knowledge_sources、source_entries、knowledge_tree_nodes、knowledge_documents、knowledge_revisions、knowledge_assets、sync_runs。
- 四欄位 Local Identity、repository／transaction ports、資料約束、source sync_version guard。
- Unit、真實 MariaDB integration 與最小 create/read/Tree smoke flow。

**完成後的能力：** 可啟動本地系統，用 local identity 建立並讀取基本 Hub-managed 文件，透過 Tree 找到它，並以測試證明 foundation 的一致性。

**範圍邊界：** 不完成 Folder Sync、rich editor、publishing、MCP、embedding 或公司 SSO；不建立未來空模組。最小 smoke flow 不等於完整 Phase 1／5 產品。

詳細文件：[Design Spec](../specs/2026-09-10-phase-0-foundation-architecture-design.md)、[Implementation Plan](../plans/2026-09-10-phase-0-foundation-implementation.md)。

### Phase 1 — Knowledge Core & Tree

**目標：** 完整保存有穩定身分與不可變內容版本的 Knowledge，提供可靠的來源樹狀瀏覽與生命週期操作。

主要交付：

- KnowledgeSource、Document、Revision、TreeNode 與 SourceEntry 的核心服務及關聯行為。
- org → Source → Folder／Document Tree；Folder 不偽裝成文章。
- Stable Document ID、current revision resolution、title／Markdown／metadata 的內容模型。
- Archive／restore、預設 archived filtering，以及 hierarchy 與 content change 的分離。

**完成後的能力：** 系統能真正保存與瀏覽知識，移動或更改來源位置後仍可用同一 Document ID 引用；版本歷史與生命週期保持一致。

**範圍邊界：** 沿用 Phase 0 基礎，不重建 identity 或 schema 架構；完整外部 folder ingestion 留在 Phase 2，完整人工作者介面留在 Phase 5。

### Phase 2 — Knowledge Source Import & Sync

**目標：** 讓各團隊透過通用 Markdown folder 匯入與更新知識，保留來源身分與 hierarchy，避免錯誤覆蓋及部分同步。

主要交付：

- 直接選取整個 folder，保留 relative paths；不使用 ZIP、不綁特定 Wiki generator。
- Generic folder adapter、scan／parse、snapshot、SourceEntry mapping 與內容比較。
- 第一次建立 Source，folder name 作可修改的預設名稱；之後明確選取既有 source_id。
- Preview 顯示新增、更新、移動、改名、archive、unchanged 與 restore 的效果；Confirm 後才 Apply。
- Preview snapshot 綁定／到期、optimistic sync_version、同交易更新 Knowledge／Tree／mapping／run，以及失敗全數 rollback。
- 來源消失時 archive；同 entry 重現恢復原 ID；相同內容重複同步不產生 revision。
- Asset metadata/reference 與 SyncRun history。

**完成後的能力：** 使用者上傳團隊的 Markdown folder，檢視變更、確認後在 Hub 瀏覽同步結果；後續更新不破壞文件引用與 revision history。

**範圍邊界：** Folder 結果在 Hub 唯讀，不做雙向同步、Markdown merge、partial success 或 binary storage。沒有 external stable ID 時的匹配／歧義規則、parser/hash 正規化與 Preview 保存方式，需在本階段詳細設計中落實，不能靠 path/hash 直接冒充文件 identity。

### Phase 3 — Identity & Basic Governance

**目標：** 在已有 Local Identity 與 org 歸屬上，落實一致的基本 caller、owner 與 access boundary。

主要交付：

- Application services 共用的可信 caller context 與基本存取檢查。
- org_code owner boundary、必要的操作來源／操作者引用。
- 身分解析與 Knowledge 授權責任分離。
- 保留 Company SSO adapter 替換 local provider 的契約；仍為 id、emp_id、name、org_code 四欄位。

**完成後的能力：** Web 與未來 Agent 都能沿用相同的基本存取規則；替換身分來源不必修改 Knowledge Core。

**範圍邊界：** 不重建公司登入平台，不把同 org 視為當然擁有所有文件權限。外部 MVP 不以公司 SSO 可用為前提；完整 Team membership、複雜 ACL、跨 org 分享、企業 mapping 與進階 audit 由後續需求再展開。

### Phase 4 — Discovery & Read API

**目標：** 讓已保存的知識容易被查找，建立人與 Agent 可共用的讀取入口。

主要交付：

- Knowledge query／read application services。
- Keyword／metadata search 與條件篩選。
- Source／Tree query、Document read、current／指定 revision read。
- 查詢路徑共用 caller context、存取判斷與 archived filtering。

**完成後的能力：** 使用者能搜尋並讀取符合條件的知識；未來 MCP 可直接接上相同服務，不另寫 SQL 或一套文件查詢規則。

**範圍邊界：** 先完成一般 keyword／metadata discovery，不要求 embedding、vector 或 Elasticsearch。外部 HTTP API 的細節由本階段設計，核心介面不依賴特定 transport。

### Phase 5 — Human Authoring

**目標：** 讓人可以直接在 Hub 補充與修訂知識，同時維持來源 ownership 與不可變 revision。

主要交付：

- 單篇文件上傳、Web 建立及編輯流程。
- HUB_MANAGED 的 title／Markdown／metadata 編輯與 revision 保存。
- SOURCE_MANAGED 的唯讀呈現與 application guard。
- 作者操作所需的內容輸入介面及編輯衝突處理。

**完成後的能力：** 使用者不依賴外部 Wiki，也能在 Hub 維護 FAQ、meeting notes 或手動文件；已同步 folder 不會被 Web 修改破壞。

**範圍邊界：** 單篇 upload 是一次性匯入，不自動覆蓋同名的 folder 文件。Editor 技術在需求清楚時選擇，Phase 0 不預裝 Tiptap；不因此引入雙向同步或 source ownership 自動轉換。

### Phase 6 — tKMS Publishing

**目標：** 讓 HR／發布者依外部發佈需求重新編排 Knowledge，發布至 tKMS。

主要交付：

- 獨立 Publishing Tree，引用穩定 Document／Revision。
- tKMS Space／Page mapping 與編排操作。
- Publishing preview／diff、發布／同步、結果紀錄與 retry 流程。
- tKMS adapter，local transaction 與外部副作用分離。

**完成後的能力：** 同一份 Knowledge 可以用不同於來源 Tree 的結構發布，並追蹤外部結果；不需複製一套 canonical Knowledge。

**範圍邊界：** Knowledge Tree 不等於 Publishing Tree；tKMS 是目的地，不決定 Knowledge identity 或 current revision。拖曳技術在本階段需要時再加入；DB rollback 不被視為可以撤回外部 API 副作用。

### Phase 7 — Agent & MCP Access

**目標：** 讓 Agent 經 MCP 使用與人相同的 Knowledge Core 與 read services。

主要交付：

- MCP adapter／server 與可信 Agent caller context 的接入。
- 以 search/get knowledge 為核心的最小讀取能力。
- 重用基本存取政策、revision resolution、archived filtering 與來源資訊。

**完成後的能力：** Agent 可以查找與讀取授權的組織知識，引用穩定文件／版本，而不必直接查 DB 或依賴 Web UI。

**範圍邊界：** MCP 不另建 Knowledge datastore，不繞過治理，也不在此階段順帶實作 Agent Memory。具體 Agent credential／protocol payload 在本階段定義，不預先擴張 Phase 0 的 UserIdentity 欄位。

### Phase 8 — Semantic & Hybrid Retrieval

**目標：** 在既有 discovery 基礎上加入語意搜尋，結合 keyword 與 semantic retrieval。

主要交付：

- 依 revision 內容進行 chunking、embedding 與 derived indexing。
- 語意及混合查詢、ranking 與 filter 的組合。
- 非同步索引更新、重建與 canonical Knowledge 的一致性處理。
- 在本階段選擇適用的 retrieval backend。

**完成後的能力：** 人與 Agent 可以用語意找到相關知識，沿用既有 query boundary，而不是重新整合另一套文件服務。

**範圍邊界：** MariaDB Knowledge 仍是 canonical source；索引失效或重建不改變 Document ID、Revision、Source 或授權資料。此路線圖不預先指定 Elasticsearch、MariaDB Vector 或其他向量引擎。

### Phase 9 — Agent Memory & Knowledge Relations

**目標：** 在正式 Knowledge 之外建立受治理的 Agent 記憶與關聯，使經驗與組織知識能連接、整理與重用。

主要交付：

- 獨立 Agent Memory Store，保存觀察、經驗、決策等內容。
- Knowledge relations、Context Bundles 與 memory consolidation。
- Memory → Knowledge 的 promotion 流程與必要的人員審核。
- 穩定 Document／Revision references 與來源追溯。

**完成後的能力：** Agent 的長期工作經驗可被整理與關聯，經治理後有機會成為正式知識，而非每次任務都重新開始。

**範圍邊界：** Agent Memory 不自動等於公司正式 Knowledge；具體 memory schema、relation types 與 promotion 規則在此階段設計，不提前塞進 Phase 0 的 knowledge_documents。

## 4. 里程碑

| 里程碑 | 階段 | 可以展示的結果 |
| --- | --- | --- |
| M1：第一個可用的來源知識流程 | Phase 0–2 | 團隊 Markdown folder → Preview／Confirm → Hub Knowledge → Tree／Document |
| M2：人可查找與維護知識 | Phase 3–5 | 基本治理＋Discovery＋單篇上傳／Web authoring |
| M3：外部發布 | Phase 6 | Knowledge 重新編排為 Publishing Tree 並發布到 tKMS |
| M4：Agent 使用與記憶 | Phase 7–9 | MCP read access → semantic/hybrid retrieval → governed Agent Memory／relations |

M1 使用 local/mock identity 驗證產品流程，不表示公司正式 SSO 與治理已完成。每個里程碑只在其相關實作與驗收完成後標記完成，不以文件產出取代功能驗收。

## 5. 文件進度與存放位置

| Phase | 目標文件 | 詳細 Design Spec | Implementation Plan | 實作／驗收 |
| --- | --- | --- | --- | --- |
| 0 | 本路線圖 | [已完成](../specs/2026-09-10-phase-0-foundation-architecture-design.md) | [已完成](../plans/2026-09-10-phase-0-foundation-implementation.md) | 尚未開始 |
| 1 | 本路線圖 | 尚未產出 | 尚未產出 | 尚未開始 |
| 2 | 本路線圖 | 尚未產出 | 尚未產出 | 尚未開始 |
| 3 | 本路線圖 | 尚未產出 | 尚未產出 | 尚未開始 |
| 4 | 本路線圖 | 尚未產出 | 尚未產出 | 尚未開始 |
| 5 | 本路線圖 | 尚未產出 | 尚未產出 | 尚未開始 |
| 6 | 本路線圖 | 尚未產出 | 尚未產出 | 尚未開始 |
| 7 | 本路線圖 | 尚未產出 | 尚未產出 | 尚未開始 |
| 8 | 本路線圖 | 尚未產出 | 尚未產出 | 尚未開始 |
| 9 | 本路線圖 | 尚未產出 | 尚未產出 | 尚未開始 |

各階段詳細設計確認後保存於 `docs/superpowers/specs/`，實作計畫保存於 `docs/superpowers/plans/`；實際測試與驗收證據產生後保存於 `docs/superpowers/verification/`。本目標路線圖放在 `docs/superpowers/roadmaps/`，由專案 README 統一導引。

更新 roadmap 時需同步檢查對應 spec／plan，避免兩套不同的 ownership、lifecycle、phase scope 或技術基線。路線圖列出的 future goals 不推翻已確認的 Phase 0 design。
