# E2E 加速設計草案

目標：縮短日常回饋與完整回歸耗時，保留真實瀏覽器、身份與授權邊界的驗證。基於 PR #99 的 runner；原先完整回歸紀錄為 219 passed、2 skipped，總耗時 454.82 秒，其中 readiness＋browser 為 399.16 秒。原始暫存 log 已不存在，不以歷史單次案例時間作為目前排名。

## 選擇與取捨

採分階段方案：先加入明確 smoke 分組及覆蓋盤點，再減少已證明重複的瀏覽器排列組合與前置 UI 操作，最後隔離資料並評估並行。單純提高 worker 會破壞共享資料假設；直接大量刪除案例沒有足夠覆蓋證據。

## 第一階段：快速回饋與盤點

- 增加 `test:e2e:smoke` 與 `test:e2e:smoke:personal` 指令。既有 `test:e2e` 維持完整回歸，CI 的完整 gate 不換成 smoke。
- 在既有案例加入 Playwright tags，以穩定標記選取，不以標題字串作為清單。Team smoke 涵蓋工作區入口、渲染編輯器 hydration、建立／保存、SSO 防偽與授權，以及匿名分享／撤銷。Personal smoke 涵蓋關閉 Team、跨瀏覽器草稿、保存、整理、匯出與收藏，以及新草稿關閉分頁後恢复。
- 不將所有編輯器測試都標成 smoke；保存競爭、鍵盤、焦點等案例仍保留在完整 E2E。
- 建立覆蓋矩陣，每個移除候選必須列出原本 E2E 斷言、替代測試、它會攔截的缺陷，以及必須保留的瀏覽器代表案例。
- 持久化 Playwright JSON 與 runner 分段時間至 ignored test artifacts，完整 suite 與 smoke 分開記錄。報告保留 passed／failed／skipped，無測試不能視為通過。

目前盤點：`authored-title.test.ts` 覆蓋標題優先序等純規則；`document-composer.spec.ts` 的 H1 案例還驗證欄位消失、警告、編輯互動，不能僅因同名單元測試存在就刪除。`organize-api.test.ts` 已覆蓋 route、授權與資料寫入；`zz-organize.spec.ts` 還有 toast、選單、Undo，需保留相應 UI 證據。

## 第二階段：縮短案例本身

- 逐項閱讀第一階段矩陣後，僅移除替代測試已完整覆蓋、且沒有額外瀏覽器行為的 E2E 規則排列組合。需要時先補缺少的 unit／integration assertion，觀察其失敗與修正後通過。
- 整理操作的準備資料改走既有 API fixture；例如測試「非空資料夾不能封存」時，用 API 建資料夾與文件，仍透過 UI 封存並驗證拒絕、toast 和保留資料。建立資料夾／文件本身的 UI 驗證保留在代表案例。
- 不用固定 sleep、重試、降低斷言或增加 timeout 掩蓋失敗；不跳過必要 production build。

## 第三階段：隔離與並行

- 先找出共享 My Space、圖譜 layout、固定標題／source／membership 等假設，使 spec 使用自己的使用者／workspace 或獨立 database，確認單跑與不同執行順序一致。
- 瀏覽器依賴的身份伺服器、DB、port 與 build output 必須按執行單元隔離；僅將 Playwright worker 從 1 改成 4 不能達成隔離。
- 從 2 個執行單元量測，再評估 4 個；只有通過隔離與完整回歸驗證才啟用預設並行。CI shards 可使用獨立 job 的 checkout／DB／ports；本機並行不得互相覆寫 `.next`。

## 驗收與交付

1. 第一階段完成後，兩種 smoke 都實際執行且無意外 skipped，完整回歸仍涵蓋既有完整集合。
2. 每個移層候選有明確對應覆蓋；不以減少測試總數為目標。
3. API fixture 加速前後，受測 UI 行為與斷言維持一致。
4. 隔離後至少驗證不同順序與重複執行；完整回歸沒有新增失敗。
5. 報告各模式的準備、build、browser、cleanup、total，區分冷／暖建置；不預先保證加速比例。
6. 各階段獨立提交與 review，先交付可用 smoke，再逐步推進。不得自行以 smoke 取代 CI 完整檢查。

目前僅完成設計草案與初步盤點，尚未修改測試、CI 或 runner。設計核准後再寫出具體 implementation plan，列出首批標記案例、覆蓋盤點與驗證指令供審閱。
