# MVP：Folder scope、搜尋篩選與 Copy for Agent

[English](2026-10-04-mvp-discovery-agent-design.md) | **繁體中文**

使用者指示：實作三項建議的 MVP additions；範圍已在對話核准，在該工作階段執行。不包含圖片、editor 變更、外部模型呼叫、deployment 或 main merge。

## Folder scope

最多 50 個精確 root-relative paths／directory prefixes，不支援 glob 或 traversal。永遠排除 .git／.obsidian。首次 import 與 resync 都提供規則 editor。Source 保存最後成功 Apply 的 rules；browser drafts 只作 migration／recovery input。Client 在 scanning 前載入 authoritative rules 與 syncVersion；server version check 阻止用 stale rules 掃描並套用至較新 source。Snapshot 保存 proposed／previous rules 與 excluded-file count，納入 integrity hash；Preview 顯示變更與受影響 archives。Apply 在與內容、version advancement 相同 transaction 保存 proposed rules；取消／失敗不保存。既有沒有 scope 的 previews 保留舊 integrity hashes，不覆蓋 source rules。Browser-local rules 以 migration candidate 提供，不能默默取代已保存 source rules。所有 endpoints 要求 trusted caller 與 workspace access。Counts 描述 client scan，並非 server 證實的 filesystem inventory。

## 搜尋

在既有 keyword search 增加可選 root-relative path prefix、from／to date、relevance／newest／oldest 排序。不輸入 keyword 也可使用 filters。Path 於 segment boundaries 匹配檔案或 descendants，SQL LIKE 特殊字元必須 escape。Folder-source paths 來自 SourceEntry。內容 update time 使用目前 revision creation time，因此僅移動不改變 date matches。Dates 為含首尾的 calendar dates，使用 browser 提供的明確 UTC offset；無 JavaScript 時以 UTC 為 fallback。無效 date／path／range／offset／sort inputs 必須顯示錯誤。Pagination URLs 保留所有 filters。維持 workspace read checks 與 SQL time／row limits。

## Copy for Agent

提供 My Space 頁面列出 active saved documents，支援 search、multi-select，reader 也提供單一文件入口。手動選取 1–20 份文件，request 從目前已儲存 revisions 建立有上限的 Markdown bundle。包含 source name／path、document ID、revision ID／number、update instant、指向固定版本的 original links。含 metadata 上限為 256 KiB；超限拒絕，不可默默截斷。於單一 unit of work 讀取 current revisions，逐份檢查 workspace policy 與 active placement。要求選定 PERSONAL workspace，且每份 document 都屬於該 workspace。不提供 share-token 捷徑。回傳 private／no-store JSON。Preview 為唯讀純文字；Copy 只將已檢視的 generated text 寫入 clipboard，提供可選取的 fallback 與明確 errors。重新選取後清除先前 output。不自動擴展 related documents，不估計 tokens、不保存 bundles、不呼叫 AI。

## 驗證

Unit：rules、hashes、date boundaries／invalid inputs、SQL escaping／ordering、bundle bounds／authorization、client scope scanning。Integration：首次／resync Apply、rollback、stale-scope conflict、scoped search／date／path、bundle reads。Browser：首次 import exclusions → Preview → Apply → 新裝置 resync；filtered pagination；multi-selection → bundle preview → clipboard／fallback。執行 unit、typecheck、lint、build 與受影響 DB／browser suites，記錄實際限制。
