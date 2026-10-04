# 個人工作空間交付

[English](2026-09-30-personal-workspace.md) | **繁體中文**

- [x] Team 開放門檻：可信 caller 範圍、授權與導覽；停用 Coming soon 入口；關閉／開啟邊界測試。
- [x] 持久草稿：耐久且限於帳戶的儲存與復原 UI、明確的儲存狀態／失敗；瀏覽器復原與衝突測試。
- [x] 文件整理：重用遠端主線的 Knowledge 樹控制與授權路由；Home 連到樹。既有所有權、位置及封存／還原測試涵蓋本批。
- [x] Markdown 匯出：canonical serializer 及需驗證身分的單篇／批次下載；路徑、metadata 與授權測試。
- [x] Revision 還原：使用 optimistic check 建立新 revision 的操作及歷史 UI；不可變歷史／衝突測試。
- [x] 個人首頁與收藏：持久帳戶資料、最近開過／草稿／收藏入口與導覽；帳戶隔離及瀏覽器持久性測試。
- [x] 執行 unit／typecheck／lint／build 及相關 integration／browser 流程。記錄實際結果與限制，更新 canonical 文件。

實作已獲授權；依序執行，不設核准檢查點。未要求部署或合併。

已在隔離的 `codex/personal-workspace` 分支完成，並 rebase 到 `origin/main` 的 `00df011`（遠端沒有 `master` 分支）；見[驗證紀錄](../verification/2026-09-30-personal-workspace.md)。主要 checkout 及其本機修改保持完整。
