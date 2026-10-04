# 個人工作空間推出設計

[English](2026-09-30-personal-workspace-design.md) | **繁體中文**

已核准方向：保留 Team 入口，但停用並標示 Coming soon。先交付持久草稿、文件整理與 Markdown 匯出，再提供 revision 還原、個人首頁與帳號同步收藏。

## 契約

- Runtime 預設 personal-only。`KM_TEAM_WORKSPACES_ENABLED=true` 恢復 Team 可用性，不改變儲存的 workspace lifecycle 或 memberships。Server 建立的 caller scope 限制 discovery、讀寫、搜尋與 governance。停用的 UI 入口只是說明，不是授權。
- 草稿與已發布 revisions、分享連結分開。關閉分頁仍保存，顯示儲存失敗，保留 base revision 防止衝突。依登入帳號與 workspace 隔離。儲存或明確丟棄後移除草稿；不可默默覆蓋較新的遠端草稿。
- 整理功能提供既有 Hub commands：folder、move、archive、restore。Source-managed imports 維持唯讀；不提供 hard delete、跨 source 移動或 lifecycle 捷徑。
- 匯出只讀取有權存取的內容。單一 Markdown 與 workspace ZIP 保留 metadata、階層，使用安全且唯一的路徑，排除草稿與 credentials。Binary attachments 不在既有內容模型內。
- 還原舊 revision 透過 optimistic concurrency 建立新 revision，保留所有歷史。
- 個人首頁提供繼續閱讀／最近文件、草稿、收藏。收藏依帳號保存，每次存取文件都重新授權。
- 保留 primary checkout 未提交變更；實作使用獨立 worktree。

## 實作選擇

- Migration 013 的 `personal_items` 保存草稿與收藏，以登入 user、workspace、item 為鍵。Compare-and-set versions 與 deletion tombstones 防止 stale writes。每個 personal workspace 一個新筆記草稿 slot，每個 document 一個編輯草稿 slot。Migration 012 是 remote mainline 的 document link index。
- 草稿復原優先保留尚未同步的本機文字；server version 分歧時停止遠端寫入。丟棄衝突只移除 recovery copy。Team-on 保留舊的 tab-local 草稿行為。
- 整理使用 remote mainline 既有 Knowledge tree、folder dialogs、move dialog、archive／restore 控制與鍵盤重新排序。Home 連至該 tree；folder 有 active children 時拒絕 archive。不要求拖放。
- ZIP 包含 archived documents 與每份文件最新已儲存 revision，使用 stable-ID suffixes 與 manifest。Markdown links 原樣保留；不含 binary attachments 與 revision history。上限為 64 MiB、9,999 份文件。
- History comparison 並排顯示選定 revision 與目前 revision 的 Markdown。還原相同內容遵循既有 no-op revision 契約。
- 收藏是帳號層的 per-document records；browser 收藏只遷移一次，不能覆蓋遠端刪除。最近閱讀仍為 device-local；Home 另列 server-derived 最近編輯。

## 驗收

Team-off 同時阻擋直接 API／page access、建立與跨 workspace 搜尋；Team-on 保留既有 governance。關閉並重開草稿、復原內容，在 storage／save failure 與 revision conflict 時不丟失文字。建立 folder、移動筆記、archive 與 restore，拒絕 source-managed mutations。匯出並檢查 Markdown／ZIP paths 與 metadata，排除無權存取文件。還原 revision 不改變舊 revisions。同帳號在新 browser context 保留收藏，帳號間隔離。
