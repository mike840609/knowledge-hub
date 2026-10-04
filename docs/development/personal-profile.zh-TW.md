# 個人統計儀表板

[English](personal-profile.md) | **繁體中文**

個人工作空間導覽在 `/w/{workspaceId}/profile` 提供 `Insights`。Home 顯示四個核心計數的精簡列與 View all insights 連結，仍作為閱讀與匯入入口。詳細統計放在 Insights，以標題與期間選擇器開頭，不重複身分 header 或 Home 的四個計數。Team 工作空間與其他使用者的 Personal 工作空間都無法存取這些統計及其明細頁。

## 計數定義

- Articles：active source 中已發布的文件；排除草稿與封存。
- Synced folders：active Folder Sync sources，包含空資料夾。
- Favorites：目前使用者在 active 已發布文章中的收藏。
- Unread updates：不重複的 active synced documents，其目前 revision 的永久 Added／Updated journal event 比使用者的已讀 revision 更新。單純移動與沒有 journal entry 的舊匯入不產生未讀事件。
- Personal notes：Hub-managed 已發布文件，包含 Markdown uploads。
- Archived：已發布且封存、或屬於封存 source 的文件，每份只計一次。
- Recent changes：在過去 7 天或 30 × 24 小時內，依已套用同步的 Added／Updated／Archived label 計算不重複文件。分類可能重疊；這是歷史事件，不是文件目前狀態的計數。
- Sync outcomes：每個 active folder 最近一次已完成的 Applied／Failed attempt。Previewed runs 不取代完成結果。
- Awaiting Apply：目前使用者尚未過期、ready、沒有 blocker 的 previews。既有 source 必須仍為 active，且符合 preview 的 source version；也包含首次匯入 preview。

分布顯示最大的三個資料夾，加上其他資料夾的合計與最後成功同步時間。明細頁使用 UUID keyset pagination，每頁 50 篇文章或來源，顯示目前已存文件。缺少永久 change records 的舊同步會明確標示。

每次 repository response 使用一個 SQL statement，讓合計、分布與分頁項目在並行同步時共用 InnoDB read view。查詢只讀 metadata 與 journal records，不讀整份 Markdown。無需 migration 或新增依賴。

## 驗證

`tests/integration/personal-profile.test.ts` 涵蓋 owner 隔離、Team 拒絕、計數定義、source 封存、未讀 revisions、私人與過期 previews、legacy journals、分頁與並行寫入。

`tests/e2e/personal-profile.spec.ts` 涵蓋真實匯入、收藏、閱讀更新並透過導覽返回、明細、期間選擇、重新整理、偏好、亮色／暗色／行動版及 Team 存取拒絕。設定 `KM_PROFILE_SCREENSHOTS` 可將桌面與行動版截圖寫入指定目錄。
