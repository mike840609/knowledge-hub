# Sources／Settings 資訊呈現

Sources 提供 Needs attention 篩選與注意事項優先、名稱、最近成功同步排序；等待 Apply 的下一步更明確，Import scope 顯示排除數量與儲存時機。Settings 使用 Active／Archived 標籤，新增成員／群組表單可收合，清单更緊湊且說明直接與 SSO 權限差異。Audit 使用時間序列及依事件目標分類的已載入事件篩選，技術詳情維持可展開。手機版成員／群組改成直向資訊列，完整保留角色與操作按鈕。

## 驗證

- 每個 PR 均從 main `668aa03f` 分出，互不相依。
- 完整 unit suite：1,658 tests passed。
- lint、typecheck 及 Next production build 通過。
- 瀏覽器驗證：來源狀態與成功同步時間、pending preview 跳轉、團隊管理／角色上限／權限撤銷／archived races、目錄匯入、桌面與手機版。

## 前後截圖

Before 為 main `668aa03f`；After 為本分支。使用相同隔離資料及狀態，桌面 1280×900、手機 390×844，light theme。時間戳記及 UUID 依各次測試產生。Settings 使用固定 Team owner persona；Audit 比較資料包含兩筆 workspace rename。

### sources

| 畫面 | 修正前 | 修正後 |
|---|---|---|
| desktop | ![Before sources desktop](before/sources-desktop.png) | ![After sources desktop](after/sources-desktop.png) |
| mobile | ![Before sources mobile](before/sources-mobile.png) | ![After sources mobile](after/sources-mobile.png) |

### sources-import

| 畫面 | 修正前 | 修正後 |
|---|---|---|
| desktop | ![Before sources-import desktop](before/sources-import-desktop.png) | ![After sources-import desktop](after/sources-import-desktop.png) |
| mobile | ![Before sources-import mobile](before/sources-import-mobile.png) | ![After sources-import mobile](after/sources-import-mobile.png) |

### settings-general

| 畫面 | 修正前 | 修正後 |
|---|---|---|
| desktop | ![Before settings-general desktop](before/settings-general-desktop.png) | ![After settings-general desktop](after/settings-general-desktop.png) |
| mobile | ![Before settings-general mobile](before/settings-general-mobile.png) | ![After settings-general mobile](after/settings-general-mobile.png) |

### settings-members

| 畫面 | 修正前 | 修正後 |
|---|---|---|
| desktop | ![Before settings-members desktop](before/settings-members-desktop.png) | ![After settings-members desktop](after/settings-members-desktop.png) |
| mobile | ![Before settings-members mobile](before/settings-members-mobile.png) | ![After settings-members mobile](after/settings-members-mobile.png) |

### settings-groups

| 畫面 | 修正前 | 修正後 |
|---|---|---|
| desktop | ![Before settings-groups desktop](before/settings-groups-desktop.png) | ![After settings-groups desktop](after/settings-groups-desktop.png) |
| mobile | ![Before settings-groups mobile](before/settings-groups-mobile.png) | ![After settings-groups mobile](after/settings-groups-mobile.png) |

### settings-audit

| 畫面 | 修正前 | 修正後 |
|---|---|---|
| desktop | ![Before settings-audit desktop](before/settings-audit-desktop.png) | ![After settings-audit desktop](after/settings-audit-desktop.png) |
| mobile | ![Before settings-audit mobile](before/settings-audit-mobile.png) | ![After settings-audit mobile](after/settings-audit-mobile.png) |
