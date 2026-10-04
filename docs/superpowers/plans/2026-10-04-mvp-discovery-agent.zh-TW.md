# MVP Discovery 與 Agent 實作計畫

[English](2026-10-04-mvp-discovery-agent.md) | **繁體中文**

> **供 agentic workers 使用：** 使用 superpowers:executing-plans 在目前 session 依序實作。使用者已要求執行。

**目標：** 可靠的來源範圍、精確探索，以及有界限的手動 Agent 上下文。
**架構：** 擴充 source／snapshot 契約與既有搜尋服務，新增一個經授權的 knowledge 讀取 use case。使用既有 MariaDB unit of work 及精簡 design tokens。
**技術棧：** Next.js、TypeScript、React、MariaDB、Vitest、Playwright。
**規格：** ../specs/2026-10-04-mvp-discovery-agent-design.md

## 全域限制

不修改編輯器／圖片，不發出外部 AI 請求，不部署或合併 main。保留 source-managed 所有權、不可變 revisions、workspace policy、Preview／Apply 原子性及所有既有限制。

## 審查重點

- 跨裝置規則與過期版本不能默默擴大範圍。
- 排除已匯入筆記時，仍須以封存狀態可見。
- SQL wildcard 的字面字元及相鄰資料夾名稱不能擴大路徑比對。
- 包含端點的日期範圍涵蓋所選 UTC offset 下的首尾兩個日曆日期。
- 跨 workspace、已封存及過大的 context 選取不得回傳部分內容。

### 任務 1：來源範圍

檔案：source／snapshot domain 與 repositories、migration 015、create／apply services、import scope read service、import form／settings／preview、client scanner。
- [x] 為 scope 持久化／hash、首次匯入排除與過期版本撰寫 unit 及 integration assertions；執行 RED。
- [x] 實作來源規則、不可變 snapshot scope、受 guard 保護的 Apply 持久化及授權 GET settings。
- [x] 將表單及 Sync now 接到 authoritative settings；在 Preview 顯示擬議變更／數量。
- [x] 執行受影響測試並 commit。

### 任務 2：搜尋

檔案：search-filters domain、search input／criteria／repository、web projection／page／form／pagination。
- [x] 為嚴格 path／date／offset validation 及 SQL parameterization 撰寫 assertions；執行 RED。
- [x] 在既有 query 實作包含端點的日期界限、字面 path prefixes 及決定性排序。
- [x] 接上欄位、無效輸入回饋、僅使用篩選條件的搜尋及 URL 分頁。
- [x] 執行限定範圍的搜尋測試並 commit。

### 任務 3：Agent 上下文

檔案：knowledge context domain／application、composition／API、personal context page／selector／navigation 及 reader entry。
- [x] 為 policy、workspace binding、archived placements、duplicate IDs、20 份文件及 256-KiB 上限撰寫測試；執行 RED。
- [x] 實作單一 transaction 的 current-revision bundle reads 及 private endpoint。
- [x] 新增多選頁面、唯讀預覽、clipboard／fallback 及變更時清除的行為。
- [x] 執行 unit／integration／browser 流程並 commit。

### 任務 4：驗證

- [x] 執行完整 unit／typecheck／lint／build 及受影響 integration／browser suites；記錄瀏覽器環境阻擋。
- [x] 對照規格審查最終 diff，記錄驗證及實際限制。
- [x] 保留可審查 feature branch；不合併 main 或部署。

## 2026-10-04 記錄的驗證

- 完整 unit：129 個檔案的 1,651 個測試通過，包括 DOM 選取／預覽／clipboard fallback 與 timezone navigation 回歸。
- 完整 MariaDB integration：62 個檔案的 643 個測試通過，包括 Apply rollback／規則持久化、過期 settings、字面 path／date 邊界及 context workspace／archived selection checks。
- Typecheck、ESLint 與 production build 通過。
- 全新且獨立的整個分支審查發現兩個 P2 問題（可選 browser preferences 阻擋 source settings，以及過期 timezone state）及 implicit migration。皆已修復並有回歸覆蓋。未發現重大授權或 atomic Apply 缺陷。
- 曾對 built app 及隔離 MariaDB 嘗試執行兩個 browser tests。因本環境拒絕建立 Unix socket（Chrome process singleton），瀏覽器在頁面執行前啟動失敗。端到端仍未驗證；DOM tests 涵蓋 context interactions。既有 folder reading browser test 已更新為僅在 Apply 時持久化規則。
- 未合併 main 或部署。Schema migration 015 隨分支交付，開放前必須透過既有 migration workflow 執行。
- 測試 fixture 修正：SQL timestamp literals 曾繼承 server session zone。Date boundary fixtures 現使用 bound UTC Date values，與 repository 行為一致。
