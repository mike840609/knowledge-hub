# Team workspaces：先預告、暫不開放

[English](team-workspaces-availability.md) | **繁體中文**

*2026-09-30。個人空間優先的 rollout；本文件更新了原本僅限制切換器的做法。*

## 目前狀態

`KM_TEAM_WORKSPACES_ENABLED` 預設為關閉。工作空間切換器的 Teams 區塊顯示停用的「Team workspaces · Coming soon」，不列出 Team 名稱，也不提供封存列表或建立入口。My Space 照常使用。

伺服器建立可信任 caller 時也會限制其範圍到自己的 My Space。因此直接打開 Team URL，或透過搜尋、API、匯出和治理服務使用既有 Team ID，都不會取得 Team 內容。既有 Team 的文件、成員、角色和封存狀態留在資料庫，重新開放後可恢復使用。單靠切換器反灰不足以執行這項限制，所以服務授權也必須檢查。

## 重新開放

將 `KM_TEAM_WORKSPACES_ENABLED=true` 設在伺服器環境並重啟。只有完全相同的 `true` 會開放；unset、`false`、`1`、`yes`、`TRUE` 等值都維持關閉。不需重新建置，也不修改既有資料或 membership。

請照以下順序執行；第 5、6 步最容易漏掉：

1. 先備份資料庫，再部署含 publication 功能的版本。migration 皆為 additive。
2. 設定 `KM_TEAM_WORKSPACES_ENABLED=true` 並重啟。
3. 以同一個資料庫與環境執行一次 catch-up（下一節）。
4. 讀取 summary 行。`failed=<n>` 會 exit 1：先檢查失敗原因、修正後重跑；指令可安全重複執行。
5. 被標成 `pending` 的 contributor（group-only、被移除或降級、已封存 team 的 contributor）必須各自從自己的 My Space 儲存或同步一次，讓請求以本人身分判斷。結果取決於當下權限：仍持有 `source.manage` 者會被 reconcile，副本恢復更新；被移除或降級者會在此時 rights-frozen（「不再更新」），副本仍可讀但不會 reconcile。在該請求之前，副本維持「等待同步」。
6. 確認預期結果。仍持有 `source.manage` 的 group-only contributor：團隊樹不再顯示「等待同步」，且 `GET /api/publications/:id/status` 通常回 `pending: false`；若儲存的 report 仍列出待處理項目（例如原稿已在別處發佈、路徑被保留），它會維持 true。被移除或降級者：預期狀態是「不再更新」的 rights-frozen，`pending: false` 不是他們的成功條件，已儲存的 report 也可能仍有 pending 工作。

`make db-catch-up-publications` 與 `GET /api/publications/:id/status` 是維運的兩個讀取點；旗標關閉時兩者都不寫入。

## 重新開放後的 publication catch-up

Team workspaces 關閉期間，個人的儲存仍會記錄 publication 事件，但沒有東西消費它們。只把旗標打開並不夠：重啟後要執行一次 catch-up。

```bash
make db-catch-up-publications
# 或：npm run db:catch-up-publications
```

- 旗標關閉時，腳本明確輸出 `skipped`，不寫入任何資料。
- 旗標開啟時，先清空 pending 事件，再掃描**所有** publication contribution（不是只有帶事件的），否則移動、封存和 source lifecycle 變更可能被漏掉。
- 具備 `source.manage` 的 direct member 會被 reconcile。只能由本人請求判斷權限的 contributor（group-only、被移除或降級）會標成 **pending catch-up**，無 caller 的執行不會直接 freeze。他們必須在旗標重新開啟後儲存或同步一次；該請求會用他們自己的 groups 判斷。只有仍持有 `source.manage` 者會被 reconcile；被移除或降級者會在此時 freeze，副本維持可讀並標示「不再更新」。
- 自願離開、因權限被 freeze、以及已 unpublish 或被 admin 封存的 publication 都會保留，catch-up 不會自動恢復。
- 輸出為 `applied=<n> pending=<n> skipped=<n> failed=<n>`。有任何 contribution 失敗時 exit 1，否則 exit 0，且可安全重跑。

## Publication 事件保留

每一次個人 revision、移動與 lifecycle 寫入都會記錄一筆 `publication_events`，即使 `KM_TEAM_WORKSPACES_ENABLED` 關閉也一樣。這些事件是非同步消費的，因此若維運不清除，event 與 delivery 兩張表會持續成長。

```bash
make db-purge-publication-events
# 或：npm run db:purge-publication-events
# 保留窗：--days N，或 KM_PUBLICATION_RETENTION_DAYS（預設 30）
```

- 只刪除「已被消費、早於保留窗，且所有 delivery 都已處理」的事件；先用 `FK … ON DELETE RESTRICT` 安全順序刪除其已處理的 delivery，再刪事件。
- 未被消費的事件、仍有 pending delivery 的事件，以及被保留事件的所有 delivery 都不會刪除，因此落後的 publication 仍可被偵測。
- 此工作不看 Team 功能旗標（旗標關閉時仍會記錄事件），分批且可重複執行，適合排成每週工作。
- 輸出為 `Publication retention: deleted events=<n> deliveries=<n> cutoff=<iso>`。

## catch-up 後的 contributor 狀態

Contributor 的狀態決定維運要期待什麼、以及由什麼解除：

| 狀態 | 團隊中的樣子 | 解除方式 |
| --- | --- | --- |
| Active | 文件會從該 contributor 的原稿更新。 | — |
| Pending catch-up（「等待同步」） | 副本仍可閱讀，但落後。catch-up 無法在不取得本人請求的情況下判斷其權限。 | 該 contributor 下一次儲存或同步。持有 `source.manage` 時會 reconcile 當下原稿、位置與生命週期（不只單一 revision）；沒有權限時改為 rights-frozen。 |
| Rights-frozen（「不再更新」） | 文件仍可讀並加註；其他人不能更新。 | 同一位 contributor 之後成功的儲存或同步。 |
| Left（「不再更新」） | 文件仍可讀且凍結；contribution 記錄為自願離開。 | 只有該 contributor 明確按「繼續更新」；一般儲存與 catch-up 都不會恢復。 |

`pending` 不是 freeze，freeze 也不是 leave。catch-up 會保留這三種狀態，也會保留 admin 封存與已 unpublish 的 publication，且不會隱含地還原其中任何一種。

## 已知限制

- Folder Sync source 的 root 沒有 tree node。匯入會把文件直接放在 source 之下，因此 My Space 只對 synced source 內的資料夾提供「發佈到團隊」，不對 source root 本身提供。發佈整個 synced source 屬於設計後續；服務端仍接受任何傳入的自有 folder node。

## Unpublish、restore 與 rename

Publication creator 或 team admin 可以 unpublish、restore、rename。Admin 以 caller 的 effective `membership.manage_basic` 判斷（OWNER/ADMIN，含 group 來源）；creator 則仍需持有 `source.manage`，且不能已離開。

- **Unpublish** 會封存整個 publication source，joiner 的文件也一起不可見。它釋放 active name 和所有 original claim，但保留文件、討論串、path reservation 和 bindings。Contributor 之後的 save 或 catch-up 不會把它還原。
- **Restore** 會重新 claim 名稱和每一個 original。若期間已有其他 active publication 取用名稱或任一 original，整個 restore 會 rollback，分別回 `PUBLICATION_NAME_TAKEN` 或 `PUBLICATION_ORIGINAL_TAKEN`，publication 維持封存。成功時會 reconcile direct contributor；group-only／被移除者維持 pending，等本人 save 或 sync；rights freeze 不會被清除。
- **Rename** 只改 publication 的 canonical name（不新增 revision）。撞到 active 名稱時回 `PUBLICATION_NAME_TAKEN`，訊息為「已有同名發佈，請取一個能說明內容的名字」。

實務上：

- 這些指令位於團隊樹中 publication 項目的選單。「取消發佈／封存」會先要求確認，因為它同時封存 joiner 的文件。
- Unpublish 之後，contributor 儲存或同步原稿仍會照常更新 My Space，但**絕不會讓 publication 復活**。要帶回來，永遠只能由 admin 或 publication creator 明確 restore。
- Restore 是全有全無。若期間 active 名稱或任一個 original 已被取用，整個 transaction 會 rollback，publication 維持封存，不會只還原一半。請先解除衝突（封存或改名佔用的 publication）再 restore。
- Restore 只會 reconcile 那些不需要本人 caller 就能判斷權限的 contributor。group-only 或被移除的 contributor 副本會維持「等待同步」，直到本人儲存或同步；rights freeze 與自願離開不會被 restore 清除。

## 驗證

- `tests/unit/team-workspaces-flag.test.ts` 驗證旗標解析；`tests/unit/personal-rollout.test.ts` 驗證 personal-only caller 的權限。
- `tests/integration/personal-workspace-rollout.test.ts` 驗證既有 Team 的導覽、直接讀寫、匯出與重新開放後資料可用性。
- `tests/e2e/team-workspaces-coming-soon.spec.ts` 驗證關閉和開啟狀態的入口，以及關閉時直接連結被拒絕。
- `tests/e2e/zz-team-publishing.spec.ts`（`@smoke-team`）以固定的可信任 persona 走完發佈→閱讀與留言→建立者儲存→加入但不覆寫→重新接回→移除→取消發佈。證據與實際 gate 指令見 [2026-10-31 驗證紀錄](../superpowers/verification/2026-10-31-team-space-publishing.md)。
