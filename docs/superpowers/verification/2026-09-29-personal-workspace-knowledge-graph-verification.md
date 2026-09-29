# Personal Workspace 知識連結與圖譜 — 驗證紀錄

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-29 |
| 對象 | [設計](../specs/2026-09-29-personal-workspace-knowledge-graph-design.md)、[計畫](../plans/2026-09-29-personal-workspace-knowledge-graph.md)：TOC、連結索引（migration 012）、wikilink／相對 `.md` 連結渲染、Backlinks、Workspace／Local graph |
| 環境 | 開發用容器；MariaDB 10.11.14（本機安裝，`127.0.0.1:3307`）；Node 22；Chromium 由環境內建的 1194 版經 shim 提供給 Playwright 1.63（shim 在 repo 之外，不屬於本變更） |
| 結論 | 全部通過。unit 617、integration 486、e2e 107、`tsc --noEmit`、`eslint .`、`next build` 皆綠。效能量測見 §3；實作過程中測試抓到的問題見 §4；未做的事見 §6；圖譜視覺重做（Linear 語彙）見 §7、標題列 chip 與 inspector 分頁記憶見 §8 |

## 1. 基準與結果

| 層 | 開工前 | 完成後 | 新增 |
| --- | --- | --- | --- |
| unit（`make test-unit`） | 427（51 檔） | **617（65 檔）** | +190 |
| integration（`make test-integration`） | 444（43 檔） | **486（46 檔）** | +42 |
| e2e（`make test-e2e`） | 91 | **107** | +16 |
| typecheck／lint／build | 乾淨 | 乾淨 | — |

開工前的 unit 427 與 integration 444 是在乾淨的 `main` 上實際跑出來的基準；e2e 的 91 是全套 107 減去本變更新增的 16 得到的（沒有另外在乾淨的 `main` 上跑一次）。**沒有任何既有測試被改成「配合新行為」**：既有的三個測試檔有被修改，其中兩處改動的是既有斷言，都是本變更刻意的契約變化，第三個只是新增一項：

- `action-registry.test.ts`：沒有任何 capability 的成員可用的動作從 `["navigate.knowledge"]` 變成 `["navigate.knowledge", "navigate.graph"]`（能讀 Knowledge 就能看它的圖，規格 §11）。
- `phase2-import-apply-perf.test.ts`：stub 補上 `links`（否則 `projectDocument` 會因缺少該 repository 而拋錯），並新增「50 份文件恰好 50 次索引寫入」的斷言（見 §4 第 2 點：這條斷言一開始沒有真正套用）。
- `share-link-single-exception.test.ts`：只新增一項（分享頁不得接觸連結 service），既有三項不變。

## 2. 各切片涵蓋

| 切片 | 主要測試 |
| --- | --- |
| 1 TOC | `heading-slug`（8）、`markdown-outline`（10）、`markdown-renderer-headings`（10，逐項比對 render 出的 `id` 與 outline 的 slug，含 CJK、重複、GFM 刪除線、setext、巢狀）、`active-heading`（7）；e2e `reading-outline` 4 案 |
| 2 索引 | `document-links-extract`（30，規格 §5 規則表逐列）、`link-resolution`（25，含 tie-break 全序與輸入順序無關）、`link-index-write-points`（2，原始碼掃描）；integration `link-index`（schema、四個寫入點、repository、過期偵測）、`link-index-reindex`（5，含與存檔競爭）、`knowledge-link-service`（19，含授權、跨 Workspace 不可區分、封存、改名） |
| 3 渲染／Backlinks | `markdown-renderer-links`（19）、`link-context`（8）、`link-graph`（19）、`action-registry`（+5）、`share-link-single-exception`（+1）；e2e `reading-links` 7 案（含標題列 chip 與 inspector 分頁記憶各一案，§8），含**真實 `/s/:token` 頁面**（無 session 的 origin）不出現 `/w/`、不出現失效連結標記 |
| 4 圖譜 | `graph-layout`（18）、`graph-model`（19）；e2e `workspace-graph` 5 案（節點與計數、Unresolved／Orphans 過濾、找尋高亮、縮放與重設、List view 精確計數、Local graph 與 depth、空狀態、命令面板、非成員 404） |

畫面另以真實瀏覽器逐項目視確認（1440／1100／1500 寬；rail、展開式目錄、resolved／alias／unresolved 連結、Linked from、Links 分頁、圖譜 hover 強調、List view、local graph）。

## 3. 量測

**方法。** 在隔離資料庫中以 repository 直接寫入 2 000 份 Hub 文件、每份 10 條 `[[wikilink]]`（20 000 條邊，全部指向隨機的其他文件），呼叫 service 15 次取中位數與 p95（圖譜 8 次）。腳本不在 repo 內（一次性量測）。

| 項目 | 結果 | 規格目標（§14） |
| --- | --- | --- |
| `getDocumentLinks`（一份約有 10 條 backlink 的文件） | 中位數 **96 ms**、p95 119 ms | 「< 100 ms」——**中位數達到，p95 略超**；已把規格改為如實的數字 |
| `getDocumentLinks` ＋ 2 度 local graph | 中位數 131 ms、p95 177 ms | — |
| `getWorkspaceGraph`（上限 1000） | 中位數 133 ms（不含 layout） | — |
| `layoutGraph`，1000 節點、3000 邊的合成圖 | **約 1.0 s**（909／994／1039 ms 三次；調整 tick 數前 2.27 s） | 「< 1.5 s」 |
| 抽取一份 3.7 KB、40 條連結的文件 | 4–8 ms（其中 Markdown 解析 6.6 ms） | — |
| 抽取一份沒有 `[[`／`.md` 的文件 | **5.7 ms → 0.003 ms**（預檢後跳過解析） | — |
| import Apply 每份文件增加 | 3 個 SQL 語句（常數）；stub 斷言每份恰好一次替換 | 常數 |

**layout 的調整過程。** 第一版固定 300 tick，1000 節點 2.27 s，超出目標。在同一台機器上量了 100／150／200／300 tick 與 `theta`：時間近似與 tick 數成正比，`theta` 1.2 比預設 0.9 快約 25% 且同樣穩定。最後採「依節點數的固定 tick 數」（≤200 → 300、≤500 → 200、其餘 150）加 `theta` 1.2。**刻意不用時間預算**：那會讓畫面取決於機器當時忙不忙，破壞決定性。

**已知取捨。** 文件頁讀取是 O(Workspace 大小)，不是 O(這份文件的連結數)（規格 §14）。2 000 份文件時約 100 ms；沒有量過 20 000 份以上的 Workspace，也沒有加護欄——那個規模的 Team Workspace 上，文件頁會明顯變慢。規格 §16 記下了最佳化路徑（邊表加正規化 key 與索引）。

## 4. 實作過程中測試與檢查抓到的問題

這一節存在的理由是：下面每一項都是「看起來完成了、其實沒有」的類型，測試設計成能抓到它們才值得寫進紀錄。

1. **layout 的決定性。** 節點依 id 排序後，同一張圖以相反順序餵入仍得到不同座標。原因是 `forceLink` 依 link 順序累加力。修正：邊也以正規順序排序並去重。（決定性測試：正序、反序、重複執行三者相等。）
2. **效能測試的斷言其實沒套用。** 我原本想在 `phase2-import-apply-perf` 加「每份文件恰一次索引寫入」的斷言，替換樣式少了一個空行而沒有生效，測試靠「沒有斷言」通過。是 lint 的 `no-unused-vars`（變數宣告了沒使用）發現的。修正後另外**暫時移除 `projectDocument` 裡的 hook，確認測試會失敗**，再還原。同樣的驗證也對 `share-link-single-exception` 新增的守門測試做過（傳 `links` 給分享頁 → 測試失敗）。
3. **Next 15 的 prefetch 陷阱。** e2e 的 local graph depth 切換約每 8 次失敗 1 次：點擊後完全沒有導覽。根因與 keyboard-shortcuts spec §9 記載的一致——指向**自己所在頁面**的 `<Link>` 會從自己 prefetch 自己，伺服器回整頁，Next 15 直接套用 prefetch 的首次使用，與點擊競爭時導覽會遺失。修正：所有指向自己所在頁面的連結 `prefetch={false}`（depth 切換、Graph／List 切換、內文 wikilink——渲染器不知道目前是哪份文件，自連結同樣會踩到）。在本機以同樣步驟重複：**修正前 7／8，修正後 30／30**。**（更正：30 次的樣本太小。之後把同一個測試重複 20 次仍出現 1 次失敗，`prefetch={false}` 去掉了一個原因、但不是全部，見 §8 第 3 點。）**
4. **e2e 檔案順序。** 我的三個 spec 在 My Space 建文件，而 `phase2.5-routing.spec.ts` 假設 E2E 使用者的 My Space 是空的；spec 在同一個資料庫依檔名順序執行，所以排在它前面就會把它弄壞（第一次全套 e2e 104／105）。`share-link.spec.ts` 本來就靠排在它後面。修正：把我的 spec 改名為 `reading-*`／`workspace-graph`，並在檔頭寫明原因。**沒有改既有測試的假設。**
5. **未解析節點沒有可存取名稱。** 圖譜中不可點的 `<g>` 只有 `<title>`，螢幕閱讀器與 `getByRole` 都看不到。修正：`role="img"` 加 `aria-label`，與可點節點的說法一致。
6. **跨文件的標題錨點。** `[[Note#Setup]]` 導覽到另一份文件後停在頂端：Next 在文件仍是 Suspense 骨架時就結束了 hash 捲動，而內容在巢狀捲動容器裡。修正：文件掛載後依網址 hash 捲到該標題（`use-scroll-to-hash`）。
7. **checkbox 的回饋。** 受控 checkbox 要等伺服器回應才會翻轉，使用起來像沒點到（Playwright 的 `check()` 也因此失敗）。修正：`useOptimistic` ＋ `useTransition`，點下去立即翻轉，伺服器回應後對齊。
8. **測試工具的預設參數。** 我的 renderer 測試 helper 用預設參數，`render(md, undefined)` 觸發預設值，「沒有 resolutions」的情境其實帶著 resolutions 在跑；兩個測試因此失敗而暴露。改為兩個明確的 helper。
9. **抽取的逸出判斷。** 同一個文字節點裡有 `\[\[x\]\]` 與真連結時，只看整個節點是否含 `[[` 會誤判。改為把原始碼去逸出並記錄遮罩，逐一判斷；對無法對齊的節點（實體、被去除的縮排）退回「來源中根本沒有字面 `[[`」的粗判斷。

## 5. 與規格的差異（都已回寫進規格）

- `getDocumentLinks` 接收 `revisionNo`，**不接收呼叫者傳入的 Markdown**（規格 §8.2）——service 自己經同一個授權檢查讀取該 revision。
- `document.backlinks` 只在 palette，不在 row menu（規格 §11）——與 `document.details` 相同的理由。
- local graph 由 `getDocumentLinks` 的 `localGraphDepth` 選項一併回傳，共用同一次目錄與邊的讀取；`getLocalGraph` 仍保留給日後的 API／MCP。
- `reindex` 的競爭語意：鎖住文件**之後**才讀取目前 revision，所以寫入的永遠是當下的目前 revision，而不是「發現過期就略過」（計畫 2.8）。
- 抽取與渲染共用 `findWikiLinks`（規格 §5）——原先各自掃描，會讓「讀者能點的連結」與「圖裡的邊」有分歧的可能。
- 圖與 backlink 建構器（`link-graph.ts`、`link-context.ts`）從切片 4 提前到切片 2，因為 service 需要。

## 6. 未做、以及需要知道的限制

- **規格 §16 的後續項目全部未做**：從失效連結建立文件、編輯時 `[[` 自動完成、Tags、Favorites／Recents、Unlinked mentions、Backlinks 查詢最佳化、改名時改寫連結、hover 預覽、Daily notes、Properties 面板。
- **folder-sync 相對 `.md` 連結沒有 e2e 的匯入流程**——由 integration 覆蓋（`managedDocument` 走與匯入器相同的 projection，含相對路徑解析與 backlinks）。
- **文件頁讀取的規模上限**（§3 已述）：沒有量過 20 000 份文件以上，沒有護欄。
- **wikilink 語法的已知邊界**（規格 §15，均有測試記錄）：被強調語法切成多個文字節點的 `[[*x*]]` 不會被辨識；GFM 表格內的別名需寫成 `\|`。
- **主導覽中指向自己所在頁面的項目**（Knowledge、Sources、Graph）仍會 prefetch 自己。這是既有的模式、本變更沒有動；上面第 3 點的機制對它們同樣成立，但沒有觀察到實際的導覽遺失。
- **本機 e2e 的環境筆記**：`npm run test:e2e` 會在同一個 repo 目錄 `next build`，會覆寫正在運行的 `.next`；同時跑著 dev／production server 的人會看到 chunk 不一致。

## 7. 圖譜視覺重做（對齊 Linear 語彙）

**範圍。** 只動呈現：`layoutGraph`、`GraphCanvas`、`GraphExplorer`、`GraphList` 與純函式 `selectVisibleLabels`。資料模型、授權、URL 參數、可存取名稱、元件對外的 props 都沒有變。設計依據是 repo 自己的[設計語言契約](../specs/frontend-design-language.md)，規格 §10.2–§10.3 已回寫。

**重做前的問題**（在 90 個節點、209 條連結的示範資料上，1440×900 目視）：

| 問題 | 原因 |
| --- | --- |
| 沒有連結的節點散在畫面四周，把整張圖拉大、相連的部分縮小 | 孤點也丟進 `forceCenter`，位置與圖無關 |
| 90 個節點一個標籤都沒有 | 標籤規則是「≤ 80 個全顯示，否則只顯示 hover 的」——剛好超過一點就整張沒有 |
| 節點太重、中心節點半徑 12 | 全部節點深灰、半徑 4–12 |
| 工具列的 Graph／List 是自製分段控制、且用了 `shadow-popover`；畫布容器用 `bg-kh-bg-raised`；List 有雙層框 | 沒有用 `ui/tab.ts`，也沒讀契約的表面與陰影規則 |

**重做後。** 孤點成為畫面下方的「Not linked · N」貨架；標籤由 `selectVisibleLabels` 依目前縮放挑選（示範資料 90 個節點：首屏 100% 有 41 個標籤，含貨架上的 7 個；按兩次 Zoom in 到約 169% 為 67 個——實際以 DOM 中的 `<text>` 計數，不是目測）；節點靜止為中性灰、強調色只給被強調者；邊併成一條 path；tooltip 是唯一有陰影的元素；工具列改用共用 tab 外觀。亮色、暗色、hover、List、local graph、找尋高亮＋未解析節點皆逐張目視確認。

**測試。** unit +18（`graph-layout` 11 → 18：貨架在相連部分之下、不拉寬繪圖、格線對齊、只有孤點時外框仍容納、與輸入順序無關、60 個孤點寬度 ≤ 700、`nodeRadius` 下限與上限；`graph-model` 8 → 19：`estimateLabelWidth`（拉丁／CJK／混合）、`selectVisibleLabels`（不重疊、放大時變多、上限、**強制的標籤永遠顯示且不受上限限制**、加權者優先、輸入順序無關））。e2e 沒有新增案例，改了一處斷言並新增兩項：找尋高亮的淡化 class 由 `opacity-30` 改為 `opacity-25`（這是刻意的視覺變更）、貨架標題存在、hover 節點會出現含標題與 `1 in` 的 tooltip。1000 節點、3000 邊的 layout 量測 0.82–0.89 s（重做前 0.91–1.04 s）；差異在同一台機器上量測雜訊的範圍內，不宣稱變快，只確認**沒有變慢**、仍在規格 §14 的 1.5 s 內。

**這一輪抓到的問題。**

1. **標籤測試的期望寫錯。** 我原本斷言「到達上限就停止」，但強制的標籤算在上限內；實際需要的規則是「強制的永遠顯示」。改寫測試並補了一條「不會丟掉強制標籤」的測試——這是行為決定，不是遷就實作。
2. **一次全套 e2e 103／105。**（a）`reading-links` 的改名案例：`getByLabel("Title")` 命中兩個元素，其中一個是 disabled。這就是 `phase5-authoring` 裡記載的「重複 DOM」既有現象（路由轉換後留下一份隱藏的表單）；那三個既有 spec 都用 `page.locator("main form").first()`，只有我這一個沒有。**是我的測試沒有照慣例**，已改為同樣的寫法，而不是加重試。（b）`revision-history` 的「選取歷史 revision」在 5 秒內沒有導覽到 `revision=1`。這是既有測試、與本變更沒有共用任何被修改的檔案；單獨重跑兩個 spec 8／8 通過、再重跑全套 105／105 通過。**沒有找到根因**，我把它記為一次在全套負載下出現、沒有再重現的失敗，而不是「已修正」。如果它再出現，優先懷疑的是與 §4 第 3 點同類的 prefetch 競爭（該案例點的是 Inspector 內指向自己所在頁面的連結）。
3. **`pkill -f` 殺掉自己。** 用 `pkill -f "next start"` 停掉示範用 server 時，指令列本身含有該字串，連我自己的 shell 一起殺了（exit 144）。改為以 `ss` 找出監聽 3000 的 PID 再終止。純屬工具操作，沒有影響程式碼，但留在這裡因為它讓一次 rebuild 看起來像失敗。

**沒有做、也需要知道的。**

- **視覺以目視驗證，沒有像素比對的回歸測試。** e2e 只斷言結構與可存取名稱；顏色與位置的正確性靠 token 契約（顏色只在 CSS 變數層）與逐張目視。
- **標籤位置是估計。** `estimateLabelWidth` 不量字型，字寬以 0.58em／1em 估計、寧寬勿窄；極窄的等寬字型下標籤會比需要的稀疏，不會重疊。
- **tooltip 會蓋住鄰近節點。** 它固定在節點上方（靠近上緣時改到下方），hover 密集區時會遮住相鄰標籤；它不吃 pointer events，所以不會擋住操作。

## 8. 標題列的連結 chip 與 Inspector 分頁記憶

**決定與理由**見規格 §11.1：Local graph 留在 inspector 的 Links 分頁、不固定在右上角，補強的是入口。實作：`link-summary.ts`（`summariseLinks`，純函式）、`inspector-tab-memory.ts`（`resolveInspectorTab`＋受保護的 `localStorage` 讀寫）、`document-header.tsx`（chip）、`document-inspector.tsx`（分頁選擇與請求）。

**測試。** unit +9：`summariseLinks`（backlink 優先且用總數不是列表長度、只往外連時退回 outgoing、未解析不算、無連結／只有未解析／讀取失敗時為 `null`）、`resolveInspectorTab`（預設 Details、記住的分頁、剛提出的請求優先、這份文件沒有的分頁會落到下一個選項、儲存了不是分頁的東西時忽略）。e2e +2（`reading-links`）：chip（沒連結時不出現、只往外連時「1 outgoing link」、有 backlink 時「1 backlink」並開到 Links、**一個請求只回應一次**）、分頁記憶（重新整理後仍在、換到下一份文件仍在、明確的請求仍壓過記住的）。

**變異驗證。** 兩個新測試各自暫時破壞被測行為，確認會失敗、再還原：（A）移除「inspector 關閉時清掉請求」→ chip 測試在「選了 History 之後不會被送回 Links」的斷言失敗；（B）讓 `rememberedInspectorTab()` 永遠回 `null` → 兩個測試都在該檢查 History 仍被記住的斷言失敗（chip 測試的最後一步、記憶測試的重新整理後）。還原後全套通過。

**這一輪抓到的問題。**

1. **過期的請求會蓋過讀者的選擇。** 第一版沒有清掉 `requestedTab`：用 chip 開 Links、改選 History、關閉，再按 Details，會被送回 Links，因為 `InspectorTabs` 重新掛載時仍看得到那個舊請求。變異驗證 A 證明測試抓得到這件事；修正是 inspector 關閉時把請求清掉。這是「分頁記憶」與「請求」兩個功能各自正確、合在一起才出錯的類型。
2. **又一個沒照慣例的 `getByLabel`。** 全套 e2e 第一次有 `reading-outline` 的「歷史 revision 的目錄」案例失敗：`getByLabel("Markdown")` 命中兩個 textarea（既有的「重複 DOM」現象，phase5-authoring 已記載，`page.locator("main form").first()` 是既有慣例）。這是繼 `reading-links` 的改名案例（§7）之後**我的第二個沒照慣例的 spec**；這次把我所有 spec 掃了一遍，剩下的編輯器操作都已用同樣的寫法。
3. **不是這個變更造成、也沒有解決的失敗：`workspace-graph` 的「local graph 切換深度」偶爾失敗。** 全套 e2e 中出現一次：點了「2 links」後網址一直沒有變成 `graph=2`。為了判斷是不是這個變更造成，**把該測試單獨重複 20 次，分別在有／沒有本變更的 `document-header`／`document-inspector` 下各跑一次：兩者都是 19／20 通過、1 次失敗**——所以在已經推上去的 commit（`e7f452a`）上就存在。trace 顯示 `?graph=2` 的 RSC 請求有送出、也回了 200，但 router 沒有套用它；沒有伺服器端的錯誤。**根因沒有找到。** 這修正了我在 §4 第 3 點的說法：那裡「修正後 30／30」是樣本太小，`prefetch={false}` 確實去掉了一個原因（修正前約 1／8），但沒有去掉全部——剩下的約 5% 是另一個原因，或同一個機制的另一條路。使用者可見的後果是：偶爾點深度切換沒有反應。**我沒有用重試遮蓋它，測試保持原樣。** 下一步建議：在 `<Link>` 的 `onClick` 記錄 router 的狀態，並檢查點擊當下是否有仍在進行中的 `router.refresh()`／導覽（`refreshOnArrival` 與 sidebar 的 prefetch 是首先要排除的）。
4. **兩次全套 e2e 的另一個既有失敗**：上一輪（§7 第 2 點）的 `revision-history`「選取歷史 revision」偶發失敗，這一輪沒有再出現。仍然沒有根因，仍然記為「一次在全套負載下出現、沒有再重現」。

**沒有做、也需要知道的。**

- **chip 只在文件頁的標題列，不在捲動後的 sticky 頂欄。** 頂欄已有 Details 按鈕，那個按鈕會開在記住的分頁上。
- **記憶是每個瀏覽器的。** 換一台裝置就回到 Details；沒有存到伺服器，也沒有打算存（規格 §11.1）。
- **「Details」按鈕不再保證開在 Details 分頁。** 這是刻意的（規格 §11.1「副作用」），但會讓依賴「按了 Details 就是 Details 分頁」的測試或文件說明出錯；repo 內現有的測試都用全新的瀏覽器 context，沒有受影響。

## 9. 重現

```bash
make db-up && make db-migrate && make db-reindex-links   # 既有資料庫：migration 012 後回填索引
make verify                                             # unit + typecheck + lint + build
make test-integration                                   # 需要 MariaDB
make browsers && make test-e2e                          # 全部 e2e；只跑一個 spec：npm run test:e2e -- tests/e2e/workspace-graph.spec.ts
```
