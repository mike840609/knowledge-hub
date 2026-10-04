# Folder Sync 第一波：從同步到閱讀

[English](2026-10-03-folder-sync-first-wave-design.md) | **繁體中文**

狀態：使用者已確認設計；實作計畫待審閱，尚未實作。
基準：main `15c8b7786239735ece7112bb663760346b33a580`（PR #104）。

## 目標與已選定方向

依使用者提供的第一波建議，完成「匯入 folder → 找到並讀懂知識 → 檢查差異 → 安心 Apply → 回來閱讀更新」流程。
沿用既有輕量列表、compact PageHeader、design tokens 與 workspace 授權。首頁不改成大型卡片 dashboard。

第一波包括五個階段，最終交付必須涵蓋全部階段。階段可獨立驗證，但不能只完成首頁文案便宣稱第一波完成。
不重新開發搜尋、收藏、最近閱讀、圖譜或同步按鈕；使用既有能力並補齊它們之間的銜接。

使用者已明確選擇「先不用管圖片」。圖片 binary 儲存、渲染與缺漏診斷新增功能本波不做，附件 binary 服務亦留待後續。沿用現有圖片安全政策，不宣稱第一波完整支援本機圖片。

## 程式盤點

- `personal-home.tsx` 目前主 CTA 為 New note，描述 Continue writing，主要清單 Recently edited。
- 個人首頁已取得 document summaries 與 drafts，最近閱讀保存在裝置，收藏由既有帳號同步機制提供。
- `ImportPreview` 提供路徑、標籤與摘要，尚未提供正文差異。
- Apply 回傳 sourceId/resultVersion/runId，但頁面成功後導向 source detail。
- `SyncRun.summary` 保存計數與 snapshotHash/planHash；terminal staging 保留 24 小時，不能用 staging 做永久歷史。
- 列表已有正式套用時間、個別同步、進度與 Retry；表單與列表需統一狀態、取消與錯誤說明。
- 附件目前僅 metadata/hash，upload service 只接受 Markdown bytes。圖片 renderer 並未將 source-relative path 解析成已授權的資產端點。
- `PersonalService` 目前驗證 draft/favorite keys，不具 read-revision 契約。

## 方案選擇

推薦：分階段完成同一條同步到閱讀流程。先建立永久同步變更與 revision 參照，再把首頁、成功頁、歷史和 Updates 接到同一資料來源。

替代一：只改首頁和成功訊息，開發較小，但無法提供長期歷史與可信的未讀更新，不符合此次第一波要求。
替代二：一次重寫首頁、匯入及 reader，改動面過大，容易破壞現有快捷鍵、來源唯讀與授權行為，不採用。

## 一、閱讀導向的 My Space

頁面順序：Search → My folders → Continue reading → Updates → Favorites → 其他入口。

- Search 使用既有 workspace search，預設搜尋目前 My Space；不複製一套搜尋引擎。
- 主 CTA 為 Import folder。New note、drafts、organize、export 仍有清楚的次要入口。
- My folders 只顯示 Folder Sync 來源，包含名稱、最後正式同步時間、待套用／失敗／需重新授權提示與 Check for changes。
- Home 的 folder 操作沿用來源列表的 compact action，保留 hover 12°/10% 與 busy 旋轉、permission gate、folder-selection fallback。
- Recently updated 用正式套用且目前可讀的文章更新，不將本機草稿或掃描誤當同步成果。
- 同名文章在首頁、Updates 與搜尋結果顯示來源及相對路徑。
- 無來源時引導匯入；無更新時呈現平靜的空狀態，不假造示範數據。
- My folders 的待套用資訊僅來自目前使用者可讀的有效 READY preview；未讀或失效 snapshot 不應洩漏其他使用者資訊。

## 二、內容 diff 與同步防護

### 正文、標題與 metadata 差異

Updated 與同時 renamed/moved+updated 的 document 可展開唯讀差異。採行級新增／刪除比較，並獨立比較標題與 metadata；單純移動可顯示前後路徑。
不變更 source-managed 文件，亦不將原始 Markdown 當 HTML 執行。

差異按文章惰性取得，不把 20,000 項 manifest 的所有正文塞進 preview JSON。每次只讀已授權 snapshot 的指定 change。
舊正文使用 plan 指定的 expected revision，新正文使用相應 staged upload key；回應必須帶 basedOnVersion 與 revision 參照。
預覽逾期或來源已變更時停用 Apply，清楚告知使用者差異只是該次掃描結果，需重新檢查。
大文件採有界的 diff 計算與輸出：最多 2,000 行或 200 KiB 的呈現，超過則顯示截斷提示與前後唯讀文字，避免無界二次方運算；不因此刪除變更。

### 選錯 folder 與大量封存

預覽顯示先前有效文件數、此次文件數、匹配文件數、archive 數與比例。
匹配採 canonical path 或既有穩定 external identity；已確認的移動不應被算成低重疊。rootName 只是提示。

以下任一條件為高風險：
- 有既有文件但此次文件數為零。
- 封存至少 5 篇且達既有有效文件 30%。
- 既有至少 5 篇、匹配率低於 20%，且有文件會被封存。

高風險 preview 顯示明確警示，要求在 Apply 前輸入來源名稱，確認這次範圍符合預期。小來源全部封存同樣需要確認。
風險與 acknowledgment 都要在伺服器驗證；不能只有前端 checkbox。確認綁定 snapshot/plan hash，不能用其他 preview 的確認套用。
一般 preview 維持原本一次 Apply，不增加通用確認框。異常門檻是第一版產品設定，可由後續使用回饋調整。

### 狀態與恢復

統一詞彙：Checking → Awaiting Apply → Synced / Failed / Folder access needed。
入口改名 Check for changes，tooltip 清楚說明只掃描、Apply 才更新。
列表與首頁提供取消；取消使用現有 AbortController 與 import cleanup，不取消已提交的 Apply。
掃描失敗顯示「尚未套用變更」與 Retry／Choose folder；Apply 失敗依交易結果或重新查詢狀態告知，不能一律宣稱沒有變更。
區分 expired preview 與 source version conflict，兩者均提供直接 Check again。Apply 網路回應丟失時用既有冪等結果恢復。

## 三、永久同步變更與成功後閱讀

新增可索引的 run-change 儲存，而不是將完整正文塞進 summary JSON。每個變更保留：

- run/source/workspace 參照與可排序鍵。
- kind、labels、前後 source path、當時標題。
- documentId、beforeRevisionId、afterRevisionId；非文件變更不假造 document 參照。

成功 Apply 在同一交易中寫入變更與正式結果；rollback 時不留下成功 Updates。重試／alreadyApplied 不建立重複事件。
歷史引用 canonical immutable revisions，可在 snapshot 清理後繼續閱讀和比较；警告保存必要 code/path 摘要，不持久化暫存憑證或 directory handles。
既有歷史不憑空回填逐篇資訊；對只有 summary 的舊 run 顯示「此紀錄沒有文章變更明細」。

成功後導向該 run 的摘要頁，顯示新增、更新、移動、封存與警告，以及：
- Read this update：進入本次新增／更新的文章清單。
- Browse this folder：現有 Knowledge explorer、指定 source。
- Back to My Space：PERSONAL 回首頁；TEAM 提供 workspace 相應入口，不假設皆有 PersonalHome。

Source history 的 APPLIED run 可開啟同一頁；文章可開啟當時 revision 與差異，不強制導向 current revision。
封存文章仍依既有 includeArchived 授權政策可讀；若文章或 revision 已真正不可讀，顯示 unavailable，不洩漏本文。

## 四、Markdown folder 閱讀契約

相對 Markdown links 與 wikilinks 使用既有解析與穩定 Document ID；補上同名、子資料夾、移動及 unresolved cases 的驗收。

本波閱讀品質聚焦 Markdown 文字、標題與 metadata、相對文章連結、wikilinks、同名文章辨識及來源路徑。圖片沿用既有行為，驗收報告清楚列出尚未支援的部分。

## 五、Updates 與來源健康

### Updates

以正式 APPLIED run 分組，可按來源及未讀篩選；顯示新增／更新計數、文章、來源、路徑與時間。
文件變更依 revision 判斷更新。移動或封存不自動算成新的閱讀內容，仍可在 run summary 中查看。

新增帳號層級 read-revision 契約，綁定 user/workspace/document；伺服器驗證該 revision 屬於此可讀文件。
在 current reader 正文成功顯示後記錄目前 revision 已讀；歷史 reader 只記錄當時 revision，不將 current revision 讀掉。
採文件內 revision 序號或等價穩定排序，而非依時間猜測順序：讀過新版時，較舊事件也已讀；新版更新後重新顯示未讀。
另一個裝置／tab 的較舊讀取不得倒退閱讀進度。收藏 API 不改用途；最近閱讀跨裝置同步仍屬後續範圍。
Home 顯示最近 3 批，每批最多 5 篇；完整 Updates 頁採 cursor 分頁（20 批），避免首頁載入全部歷史。

### 來源健康

來源 detail 提供 Health 入口，彙整目前文件的 unresolved links 與最新有效匯入警告。
每項可開啟對應文章，顯示原因及相對路徑；健康診斷不應阻擋正常閱讀，也不自動修改來源。
清單分頁，使用可批次查詢的現有 link 與匯入警告資料；避免每次首頁逐篇解析全部 Markdown。
所有資料透過現有來源與 workspace 權限；僅展示當前使用者可讀的文件。

## 交付順序與回歸界線

1. 永久 run-change/read-revision 資料契約、migration 與授權讀取。
2. diff、高風險確認、準確狀態、取消／恢復與同步結果頁。
3. Home/My folders/Updates 接上正式資料。
4. 來源健康與 Markdown 文字／內部連結閱讀契約驗收。
5. 完整回歸與前後截圖。

保留 source-managed 唯讀、workspace permission gates、keyboard navigation、收藏／草稿、Team source 流程與 Apply 原子性。
本波不加入自動背景同步、CLI、MCP、AI Chat、Collections、路徑／日期搜尋新篩選或分享管理新頁面；圖片與附件 binary 支援另行開發。

## 驗證與截图

- Domain/unit：diff metadata、risk threshold/empty folder/stable moves、狀態與取消、read-revision monotonicity、來源路徑解析。
- 真實 MariaDB integration：Apply rollback/idempotency、持久變更在 staging cleanup 後存在、history revision、read marker 授權、risk acknowledgment 伺服器強制。
- E2E：初次匯入→成功摘要→閱讀→再次掃描→diff→高風險拒絕／確認→Apply→Updates 未讀→閱讀後已讀；同名文章與相對文章連結案例。
- 完整 unit/integration、相關 Team 與 Personal E2E、typecheck/lint/production build；正式報告列出已跑範圍及任何未解決失敗。
- 前後比較固定基準 main `15c8b77`、同一組示範資料、1440px light viewport、相同瀏覽器與語系；不把 demo fixtures 寫入使用者資料。
- 至少截 Home、預覽正文 diff／高風險警示、Apply 成功摘要、Updates、來源健康與文章閱讀頁。新頁面標示「修改前無此頁面」，與原流程最接近的畫面比較。
- 可補 hover／取消錄影；截圖不作為功能驗證的替代。

驗收完成：使用者能匯入自己的 folder，找到並讀懂文章，再次檢查時知道差異且能避開誤封存，正式套用後知道有哪些新知識可讀，並能在 staging 清理後回看同步歷史。
