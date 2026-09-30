# Team workspaces：先預告、暫不開放

*2026-09-30。決定：先在前端把切換擋掉，之後才開放，讓使用者知道未來會有這個功能，但現在還不能用。*

## 現在是什麼狀態

Team workspace 的功能都在（成員與角色、SSO 群組對應、稽核、封存），但**工作空間切換器不帶任何人進去**：選單的 Teams 區塊只有一列停用的「Team workspaces · Coming soon」，沒有各個 team 的名字、沒有「Archived」子選單、沒有「Create team」。My Space 照常。

## 怎麼開放

設 `KM_TEAM_WORKSPACES_ENABLED=true`（見 `.env.example`）。**只有 `true` 這個字會開**：unset、`false`、`1`、`yes`、`TRUE`、前後有空白，全都是關的，免得有人手滑打了個沒人想到的值就把還沒開放的東西開了。

- 每個請求都會讀，所以是改設定並重啟，不必重新 build。
- 預設關。開發時要看 Team 的畫面，在自己的 `.env` 設 `true`。
- 值進了 `GET /api/workspaces` 回傳的導覽模型（`teamsOpen`），切換器讀它；沒有另外的設定入口。

## 這不是存取控制

這個旗標決定的是**切換器提供什麼**，僅此而已。沒有改變、也沒有取代任何授權：

- 直接開 `/w/<team-id>/…` 的連結、書籤，仍然打得開；已經在某個 team 裡的人，切換器仍顯示他所在 team 的名字，並讓他回 My Space。
- API 不受影響。成員與角色、群組對應、`workspace.create_team` 平台權限、封存後的 `WORKSPACE_ARCHIVED`，都跟旗標無關（旗標開或關，服務的判斷相同；整合測試檢查了兩種狀態下導覽模型列出同樣的 workspace 與同樣的 `canCreateTeam`）。
- 沒有隱藏 team 內的畫面（設定、成員、稽核），也沒有把已經在 team 裡的人踢出去。

如果之後決定「真的不讓人進」，那是另一件事：要在 server 端判斷（路由與服務），並先寫規格。這份文件描述的只是前端的預告。

## 怎麼測

- 單元：`tests/unit/team-workspaces-flag.test.ts`——嚴格解析（只有 `true`）。
- 整合：`tests/integration/phase3-workspace-admin-api.test.ts`——導覽模型依環境回報 `teamsOpen`，且兩種狀態下列的 workspace 相同。
- 瀏覽器：`tests/e2e/team-workspaces-coming-soon.spec.ts`。E2E 的其他 server 都開著 Team（`scripts/test/e2e.ts` 設 `KM_TEAM_WORKSPACES_ENABLED=true`，因為 Team 相關與切換器選單的 spec 需要它）；`playwright.config.ts` 另外起一個同 build、同資料庫、旗標關掉的 server，這個 spec 在那裡看「Coming soon」，並用開著的 server 當對照，確認「選單裡沒有 Query Master」是旗標造成的，不是選單本來就沒有。
