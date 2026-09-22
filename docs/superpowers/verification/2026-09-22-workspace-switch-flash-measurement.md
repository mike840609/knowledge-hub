# Workspace-Switch Flash — Measurement

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-22 |
| 類型 | 量測紀錄（證據，不是決定） |
| 受測版本 | `measure/workspace-switch-flash` (= `main` @ `29ffcf9`，PR #48 merged) |
| 起因 | 懷疑 `AppShell key={workspaceId}`（`src/app/w/[workspaceId]/layout.tsx`）在每次切換 workspace 時造成全 shell unmount/remount + 新 shell model 的 server fetch，產生可見閃爍。待決：hover-prefetch menu items vs 保持現狀；這份量測決定它 |
| 結論 | **閃爍的主因不是 `key` remount，而是和文件導航同一件事：Suspense fallback 節流。`key` 只貢獻 0–110ms 的空白間隙；~240ms 的骨架屏hold 在兩種導航完全一樣。** |

## 方法

沿用 [2026-09-21 導航延遲量測](./2026-09-21-navigation-latency-measurement.md) 的方法，不另起爐灶：

- Production build（`make build` + `next start` 在 127.0.0.1:3100，`KM_ALLOW_LOCAL_IDENTITY_IN_PRODUCTION=true`）、真實 MariaDB（`make db-up/db-migrate/db-seed`）、單一 Chromium（Playwright MCP）。
- **內容進入 DOM 的時間**：頁面內 `MutationObserver`（`[data-document-pane]` 在新 URL 下首次出現）+ rAF 影格取樣交叉確認。兩者差距 <15ms。
- **網路時間**：`PerformanceResourceTiming` 的 `responseEnd`（RSC 回應 + 兩個 `/api/workspaces` 呼叫）。Playwright 只負責開選單與點擊，不做 locator 輪詢——工具不進結果。
- **JS 執行時間**：`longtask` PerformanceObserver。
- **影格相位**：rAF 逐幀分類 `stale（舊內容）→ blank（ neither 骨架 nor 內容）→ skeleton → new-content`，記錄每次轉換時間戳。blank vs skeleton vs stale-shell 用 computed DOM 狀態區分（`[data-document-pane]` 有無 + sr-only `Loading document*` 狀態行有無 + URL 是否已換），不是截圖目測。
- 受測轉換：workspace 選單點 `SWFP`/`Query Master` → `router.push('/w/<id>/knowledge')` → redirect 到該 workspace 預設文件（和使用者點的路徑完全一樣，選單開合也在頁面內用真實 click 走過）。
- 每個數字 n=6（workspace 切換為雙向交替：QM→SWFP→QM…；對照組為同 workspace 內 Architecture↔Runbooks 文件切換），報 p50 + max，不平均掉分布。

## 結果

### Workspace 切換（選單點 workspace → 新 workspace 文件 settled），n=6

| run | 方向 | 內容進 DOM (MO) | 資料就緒 (RSC+API 最後位元組) | 影格序列 | 長工作 |
| --- | --- | --- | --- | --- | --- |
| 1 | SWFP→QM | 395ms | 154ms | stale→skeleton@78→content@410 | 0ms |
| 2 | QM→SWFP | **27ms**（router-cache 命中，見下） | 98ms（只有 `/api/*`，無 RSC 請求） | stale→blank@17→content@30，無骨架屏 | 0ms |
| 3 | SWFP→QM | 398ms | 145ms | stale→skeleton@80→content@413 | 0ms |
| 4 | QM→SWFP | 381ms | 142ms | stale→skeleton@64→content@396 | 0ms |
| 5 | SWFP→QM | 363ms | 149ms | stale→skeleton@66→content@365 | 0ms |
| 6 | QM→SWFP | 389ms | 141ms | stale→blank@67→skeleton@81→content@399 | 0ms |

| | p50（含 run 2） | max | 新鮮 RSC 的 p50（run 2 除外） |
| --- | --- | --- | --- |
| 內容進入 DOM | **385ms** | 398ms | 389ms |
| 最後一個網路位元組 | ~143ms | 154ms | ~145ms |
| 長工作總時長 | **0ms** | 0ms | 0ms |

另有 warmup 一次（QM→SWFP，不計入 n）：內容 466ms，stale→blank@63→skeleton@173→content@473——blank 間隙 110ms 為全場最大。

伺服器單獨量（同路由、繞過瀏覽器，curl HTML GET 各 5 次中位數）：**SWFP 文件 60ms、QM 文件 58ms、`/w/<id>/knowledge` redirect hop 33ms**。瀏覽器內 RSC 鏈約 140ms（layout RSC ~50ms + 文件 RSC ~80ms + 兩次 `/api/workspaces`）。

也就是說（新鮮 RSC 的情況）：**資料在 ~145ms 到齊，主執行緒零工作，內容卻要到 ~385ms 才出現。中間 ~240ms 是純等待**（各 run 資料→內容差距：241、253、239、214、248ms——計時器特徵）。

### 對照組：同 workspace 內文件切換（Architecture↔Runbooks），n=6

| run | 內容進 DOM (MO) | 資料就緒 | 影格序列 | 長工作 |
| --- | --- | --- | --- | --- |
| 1–6 | 320 / 304 / 303 / 305 / 328 / 340ms | 77 / 84 / 79 / 78 / 85 / 126ms | 全部 stale→skeleton@~15→content，無 blank | 0ms |

p50 **313ms**，max 340ms。資料→內容差距約 ~230ms。

（前份紀錄同類導航為 383ms p50；本次對照組文件較小、資料 80ms vs 當時 130ms，hold 的長度一致，結論一致。）

## 為什麼

Workspace 切換的 ~385ms 可以拆成四段，全部有名有姓：

1. **Redirect hop（~30–60ms，多一次 RSC 往返）。** 選單點的是 `/w/<id>/knowledge`，server redirect 到預設文件。URL 在點擊後 ~60–80ms 才換，舊 shell 則在 URL 換的同時卸載。這是 workspace 切換獨有、文件導航沒有的成本。
2. **Remount 空白間隙（0–110ms，間歇）。** `key={workspaceId}` 讓舊 AppShell 整棵卸載；新 shell 的 RSC 還沒回來、fallback 還沒 commit 的那幾幀，`<main>` 是空的——rAF 取樣看到既無 `[data-document-pane]` 也無骨架屏。出現與否看時序（6 次正規 run 只抓到 1 次 14ms + warmup 110ms），不是穩定成本。
3. **資料等待（~145ms）。** layout RSC + 文件 RSC + `useWorkspaceAuthorizationRefresh` 掛載即打的兩次 `/api/workspaces`。比同 workspace 導航多約 65ms（多了 shell model 與 redirect 鏈）。
4. **骨架屏 hold（~215–250ms，穩定）。** 資料到齊後，React 照樣把 fallback 多留約 240ms 才換內容——和對照組的 ~230ms 是同一個數字，同一個機制（前份紀錄確認過的 Suspense fallback 節流）。**這一段和 `key` 無關**，拿掉 `key` 它一毫秒都不會少。

第 4 段是主因（~60%），第 1+3 段是次因，第 2 段（`key` 的直接成本）最小且不穩定。

## Router-cache 命中那次（run 2）說明了什麼

run 2（QM→SWFP，27ms）是唯一一次 App Router router cache 命中：零 RSC 請求、零骨架屏、只有 13ms 的 blank（remount 本體）就直接上內容。證明兩件事：

- **資料若已在 router cache，導航根本不走 fallback**——前份紀錄 §「唯一槓桿」寫的假設，在 workspace 切換上被實證了。
- 反過來也證明骨架屏 hold 是 fallback 出現的代價：fallback 沒出現，就沒有那 240ms。

## 這推翻／確認了什麼

- **確認**：workspace 閃爍和文件導航是同一現象（Suspense 節流），不是另一種病。前份紀錄的模型直接適用。
- **推翻**：「`key={workspaceId}` 是閃爍主因」的懷疑。`key` 的可歸因成本只有 remount 空白（0–110ms、間歇），而拿掉 `key` 要付的代價是舊 workspace 授權狀態外洩（`useWorkspaceAuthorizationRefresh` 存在的理由）——用一個不確定的小收益換一個確定的正確性風險，不划算。
- **量化 prefetch 的天花板**：hover-prefetch 選單目標（或 `router.prefetch('/w/<id>/knowledge')`）若讓每次切換都像 run 2，內容進 DOM 可從 ~385ms 降到 ~30ms（含 redirect 解析與 remount），且同時消掉骨架屏 hold——這是唯一同時去掉網路和 240ms hold 的槓桿。代價是每個可見選單項目多一次 prefetch 請求（workspace 數量小，通常 <10 個，和文件樹 prefetch 的規模完全不同）。

## 決定：留白（量測 only，本次不實作）

- **不**拿掉 `key={workspaceId}`（主因不是它）。
- **不**實作 hover-prefetch（等決定）。
- 留給下一步決定的選項：(a) 選單項目 hover-prefetch（天花板 ~30ms，成本是每次 hover 的 RSC 請求）；(b) 保持現狀（~385ms p50，0ms 長工作，無正確性風險）。(a) 沒有量過實際 prefetch 成本與命中率，這份紀錄只證明命中時的收益。

## 方法備註與限制

- 骨架屏偵測用 sr-only `Loading document*` 狀態行（含 tree 的 `Loading documents`），無法區分 document 骨架與 tree 骨架；flash 問題只關心「舊內容已走、新內容未到」，不影響結論。
- rAF 取樣解析度 ~16ms；<16ms 的 blank 會被記成 stale→skeleton 直跳，blank 欄是下限。
- Run 2 證明 router cache 會讓重訪變快；6 次 run 交替方向，QM/SWFP 雙方各有新鮮與命中樣本，分布如實保留未剔除。
- 生產 server 與 DB 在量測後保持運行（3100 + MariaDB 3307）；無 product code 變更，無 commit。

## 附錄（2026-09-22 深夜）：hover-prefetch 驗證 — 量到了，payoff 不成立，建議 revert

受測版本：`measure/workspace-switch-flash` + 未提交的 prefetch 編輯（`WorkspaceSelector`：`onMouseEnter`/`onFocus` → `router.prefetch('/w/<id>/knowledge')`，current workspace 跳過）。本節只回答前文留白的選項 (a)：prefetch 的實際成本與命中率。

### 方法差異（相對前文，其餘沿用）

- 同樣 production build（`make build` 後重啟 `next start` 在 127.0.0.1:3100，確保新 build 含 prefetch）、真實 MariaDB、單一 Chromium（Playwright MCP）。
- Playwright 只做整頁 `goto`（每次 run 前回到 My Space 文件頁，清空 router cache，確保任何命中只能來自 hover-prefetch）；**開選單／hover／click／focus 改由頁面內 synthetic 事件派發**（`mouseover` 觸發 React `onMouseEnter`、`click()`、`focus()`），因為 click 時間戳必須是 in-page `performance.now()` 才精確。Test A 另用一次真實 MCP `browser_hover` 交叉確認：同一形狀的 RSC 請求，行為一致。
- 計時仍是 in-page `MutationObserver`（`[data-document-pane]`）+ rAF 影格相位 + `PerformanceResourceTiming.responseEnd` + `longtask` observer；不用 Playwright locator 輪詢。
- 受測方向固定 My Space → SWFP（`0199f100-0000-7000-8000-000000000002`），每次 run 前整頁重載；run 3 的 settle 迴圈用 100ms 量子（run 1–2 用 8ms），content 數字一致，不影響結論。

### Test A（prefetch 會不會發）：會，零 click 即發

Fresh load（SWFP 的 RSC 計數為 0）→ 開選單 → hover SWFP → 出現 `GET /w/0199f100-0000-7000-8000-000000000002/knowledge?_rsc=…` 200，全程零 click。4 次量到的 prefetch 網路時間：**46 / 41 / 45 / 48ms**（皆為單一 RSC render of reads）。

### Test B（hover 後再點，n=3）：沒有 cache-hit 等級的 payoff

| run | prefetch 網路 | click→URL 換 | click→內容進 DOM | 骨架屏 | click 當下新增的 SWFP RSC | 長工作 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 46ms | 21ms | **404ms** | 有 | 5 | 0ms |
| 2 | 41ms | 23ms | **380ms** | 有 | 5 | — |
| 3 | 45ms | ~101ms（100ms 量子） | **403ms** | 有 | 6 | — |

對照前文未 prefetch 的 p50 **385ms**／max 398ms：內容進 DOM **沒有改善**，每次都有骨架屏。run 2 的 5 個 click-RSC 具體是文件頁 ×2、`sources`、`settings`、`new`——**唯獨 `/knowledge` 本體沒有重抓**（prefetch 的 redirect stub 被重用了），但 redirect 目標的文件／layout RSC 照抓不誤，外加同樣的 ~240ms Suspense hold。click→URL 換 21–23ms（前文 redirect hop 約 60–80ms）是 prefetch 唯一省下的部分：約一趟 RSC 往返。

結論：**prefetch 命中了，但只命中 redirect 跳板，沒命中真正的內容鏈。** 前文 run 2 的 27ms 是「整條鏈（含預設文件）都在 router cache」的結果；hover-prefetch 只預取 `/w/<id>/knowledge`（server redirect 到預設文件），預設文件的 RSC 在 hover 當下無法得知，所以每次 click 仍是新鮮 RSC + 骨架屏 hold。

### Test C（hover 不點的浪費成本）：恰好一次 RSC render

開選單 → hover SWFP → Escape 關閉選單：SWFP 的 RSC 從 0 變 **1**（48ms），URL 不變、選單已關、之後無任何追加請求（全頁 RSC 總數 11→12）。**一個 miss 的單位成本 = 一次 RSC render（~45ms server），無導航、無狀態變化。** 另確認 skip-current 規則：hover 當前的 "My Space" 項目，RSC 總數不變（0 新增）。

### 鍵盤路徑：focus 也會 prefetch

Fresh load → 開選單 → `focus()` 到 "Query Master"（`0199f100-…0001`，事先 RSC 計數 0）→ 出現其 `/knowledge?_rsc` 請求（71ms），URL 不變。`onFocus` 與 `onMouseEnter` 行為一致。Touch 無 hover，按設計退回現狀（未另做工）。

### Verdict：**revert（幾行）**

事前約定：hover→click payoff 確認則 keep，從不命中則 revert。量測結果是中間偏壞的情況，如實記錄：

- prefetch **每次都命中**（不是「從不命中」）——但命中的只是 redirect 跳板。
- 事前期待的 payoff（每次切換都像 run 2：~30ms、零 RSC、零骨架屏）**被否證**：三次 hover→click 內容進 DOM 為 404 / 380 / 403ms，全有骨架屏，click 當下仍有 5–6 個新鮮 RSC。
- 省下的只有 redirect hop 的一趟 RSC（URL 換快 ~40–60ms），相對 385ms baseline 微不足道；代價是每個 hover/miss 一次 server render（workspace 數量小，但每開一次選單都可能觸發數次）。

要讓切換真的變成 run 2，需要預取整條鏈（含預設文件）的 RSC——預設文件是哪一份要在 hover 當下得知，超出這幾行的範圍。所以建議 revert 這幾行 prefetch，回到現狀（~385ms p50、0ms 長工作、無正確性風險）。若未來有人想重做，先決條件是解決「redirect 目標不可預知」這一點，否則再量也是一樣的形狀。

本次量測狀態：生產 server（3100，含 prefetch 的 build）與 MariaDB（3307）保持運行；無 commit（prefetch 編輯仍未提交）。
