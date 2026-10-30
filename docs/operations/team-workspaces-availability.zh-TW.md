# Team workspaces：先預告、暫不開放

[English](team-workspaces-availability.md) | **繁體中文**

*2026-09-30。個人空間優先的 rollout；本文件更新了原本僅限制切換器的做法。*

## 目前狀態

`KM_TEAM_WORKSPACES_ENABLED` 預設為關閉。工作空間切換器的 Teams 區塊顯示停用的「Team workspaces · Coming soon」，不列出 Team 名稱，也不提供封存列表或建立入口。My Space 照常使用。

伺服器建立可信任 caller 時也會限制其範圍到自己的 My Space。因此直接打開 Team URL，或透過搜尋、API、匯出和治理服務使用既有 Team ID，都不會取得 Team 內容。既有 Team 的文件、成員、角色和封存狀態留在資料庫，重新開放後可恢復使用。單靠切換器反灰不足以執行這項限制，所以服務授權也必須檢查。

## 重新開放

將 `KM_TEAM_WORKSPACES_ENABLED=true` 設在伺服器環境並重啟。只有完全相同的 `true` 會開放；unset、`false`、`1`、`yes`、`TRUE` 等值都維持關閉。不需重新建置，也不修改既有資料或 membership。

## 重新開放後的 publication catch-up

Team workspaces 關閉期間，個人的儲存仍會記錄 publication 事件，但沒有東西消費它們。只把旗標打開並不夠：重啟後要執行一次 catch-up。

```bash
make db-catch-up-publications
# 或：npm run db:catch-up-publications
```

- 旗標關閉時，腳本明確輸出 `skipped`，不寫入任何資料。
- 旗標開啟時，先清空 pending 事件，再掃描**所有** publication contribution（不是只有帶事件的），否則移動、封存和 source lifecycle 變更可能被漏掉。
- 具備 `source.manage` 的 direct member 會被 reconcile。只能由本人請求判斷權限的 contributor（group-only、被移除或降級）會標成 **pending catch-up**，不會被 freeze。他們必須在旗標重新開啟後儲存或同步一次；該請求會用他們自己的 groups 判斷權限並 reconcile 文件。
- 自願離開、因權限被 freeze、以及已 unpublish 或被 admin 封存的 publication 都會保留，catch-up 不會自動恢復。
- 輸出為 `applied=<n> pending=<n> skipped=<n> failed=<n>`。有任何 contribution 失敗時 exit 1，否則 exit 0，且可安全重跑。

## Unpublish、restore 與 rename

Publication creator 或 team admin 可以 unpublish、restore、rename。Admin 以 caller 的 effective `membership.manage_basic` 判斷（OWNER/ADMIN，含 group 來源）；creator 則仍需持有 `source.manage`，且不能已離開。

- **Unpublish** 會封存整個 publication source，joiner 的文件也一起不可見。它釋放 active name 和所有 original claim，但保留文件、討論串、path reservation 和 bindings。Contributor 之後的 save 或 catch-up 不會把它還原。
- **Restore** 會重新 claim 名稱和每一個 original。若期間已有其他 active publication 取用名稱或任一 original，整個 restore 會 rollback，分別回 `PUBLICATION_NAME_TAKEN` 或 `PUBLICATION_ORIGINAL_TAKEN`，publication 維持封存。成功時會 reconcile direct contributor；group-only／被移除者維持 pending，等本人 save 或 sync；rights freeze 不會被清除。
- **Rename** 只改 publication 的 canonical name（不新增 revision）。撞到 active 名稱時回 `PUBLICATION_NAME_TAKEN`，訊息為「已有同名發佈，請取一個能說明內容的名字」。

## 驗證

- `tests/unit/team-workspaces-flag.test.ts` 驗證旗標解析；`tests/unit/personal-rollout.test.ts` 驗證 personal-only caller 的權限。
- `tests/integration/personal-workspace-rollout.test.ts` 驗證既有 Team 的導覽、直接讀寫、匯出與重新開放後資料可用性。
- `tests/e2e/team-workspaces-coming-soon.spec.ts` 驗證關閉和開啟狀態的入口，以及關閉時直接連結被拒絕。
