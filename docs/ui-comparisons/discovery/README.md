# Graph／Search／Shares 操作回饋

Graph 說明 Find 在兩種模式的差異、顯示匹配數、重設篩選，列表可依標題或 links in/out 排序，手機版將 source 放在文件標題下。Search 收合進階篩選並顯示作用中條件，提供保留關鍵字的清除操作。Shares 加入直接複製、清除篩選及不同空狀態，永久撤銷改用預設聚焦 Keep 的共用確認對話框。

## 驗證

- 每個 PR 均從 main `668aa03f` 分出，互不相依。
- 完整 unit suite：1,658 tests passed。
- lint、typecheck 及 Next production build 通過。
- 瀏覽器驗證：Graph 查找及排序、搜尋 GET fallback／即時搜尋／權限隔離、分享複製 fallback／取消及永久撤銷。

## 前後截圖

Before 為 main `668aa03f`；After 為本分支。使用相同隔離資料及狀態，桌面 1280×900、手機 390×844，light theme。時間戳記及 UUID 依各次測試產生。Settings 使用固定 Team owner persona；Audit 比較資料包含兩筆 workspace rename。

### graph

| 畫面 | 修正前 | 修正後 |
|---|---|---|
| desktop | ![Before graph desktop](before/graph-desktop.png) | ![After graph desktop](after/graph-desktop.png) |
| mobile | ![Before graph mobile](before/graph-mobile.png) | ![After graph mobile](after/graph-mobile.png) |

### search

| 畫面 | 修正前 | 修正後 |
|---|---|---|
| desktop | ![Before search desktop](before/search-desktop.png) | ![After search desktop](after/search-desktop.png) |
| mobile | ![Before search mobile](before/search-mobile.png) | ![After search mobile](after/search-mobile.png) |

### shares

| 畫面 | 修正前 | 修正後 |
|---|---|---|
| desktop | ![Before shares desktop](before/shares-desktop.png) | ![After shares desktop](after/shares-desktop.png) |
| mobile | ![Before shares mobile](before/shares-mobile.png) | ![After shares mobile](after/shares-mobile.png) |
