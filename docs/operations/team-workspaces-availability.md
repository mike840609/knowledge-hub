# Team workspaces：先預告、暫不開放

*2026-09-30。個人空間優先的 rollout；本文件更新了原本僅限制切換器的做法。*

## 目前狀態

`KM_TEAM_WORKSPACES_ENABLED` 預設為關閉。工作空間切換器的 Teams 區塊顯示停用的「Team workspaces · Coming soon」，不列出 Team 名稱，也不提供封存列表或建立入口。My Space 照常使用。

伺服器建立可信任 caller 時也會限制其範圍到自己的 My Space。因此直接打開 Team URL，或透過搜尋、API、匯出和治理服務使用既有 Team ID，都不會取得 Team 內容。既有 Team 的文件、成員、角色和封存狀態留在資料庫，重新開放後可恢復使用。單靠切換器反灰不足以執行這項限制，所以服務授權也必須檢查。

## 重新開放

將 `KM_TEAM_WORKSPACES_ENABLED=true` 設在伺服器環境並重啟。只有完全相同的 `true` 會開放；unset、`false`、`1`、`yes`、`TRUE` 等值都維持關閉。不需重新建置，也不修改既有資料或 membership。

## 驗證

- `tests/unit/team-workspaces-flag.test.ts` 驗證旗標解析；`tests/unit/personal-rollout.test.ts` 驗證 personal-only caller 的權限。
- `tests/integration/personal-workspace-rollout.test.ts` 驗證既有 Team 的導覽、直接讀寫、匯出與重新開放後資料可用性。
- `tests/e2e/team-workspaces-coming-soon.spec.ts` 驗證關閉和開啟狀態的入口，以及關閉時直接連結被拒絕。
