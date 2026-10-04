Method: dual-agent (A: /root/design_review · B: /root/detector_evidence)

# Linear UI/UX alignment — repository audit

[English](2026-10-02-linear-ui-ux-audit.md) | **繁體中文**

| 項目 | 內容 |
| --- | --- |
| 報告日期 | 2026-10-02，Asia/Taipei |
| 檢查版本 | `4bbab24` |
| 實際檢查時間 | 2026-10-01；翌日完成整理 |
| 工作範圍 | Repo UI/UX 盤點、程式核對、瀏覽器驗證與 Linear 官方設計參照 |
| 原始要求 | 完整掃描 repo，找出 UI/UX 可對齊 Linear 的部分 |
| 狀態 | 僅完成稽核；下列缺陷與改善項目尚未實作 |
| Findings | 16 項：1 P0、2 P1、12 P2、1 P3 |

實作後續見 [修正與驗證紀錄](2026-10-02-linear-remediation-verification.md)。下列狀態描述稽核與 rebase 當時的版本。

本文件是這個版本的稽核快照，不取代 `docs/superpowers/specs/frontend-design-language.md` 的 living contract，也不把建議自動升格為已核准的產品需求。

## Recheck after rebasing latest main

原始盤點基底為 `4bbab24`。2026-10-02 抓取 `origin/main` 後，這個 Codex worktree 當時處於 detached HEAD；`git rebase origin/main` 將目前 checkout 移至 `1cf8114`（沒有獨立 feature commits 需要重播），報告與 critique snapshot 已暫存保護並成功恢復。最新 main 比原始基底前進 4 個 commits；稽核檔案仍是未提交檔案，application source 沒有本地修改。

對原來 16 項逐一重讀最新程式並比對 #94/#95 的變更：**1 項已解決、3 項部分改善、12 項仍存在。** 這是 source-level recheck；沒有重跑完整路由／viewport 矩陣。

| Findings | 最新狀態 | 最新基底上的依據 |
| --- | --- | --- |
| F01 | 仍存在 | `body { overflow: hidden }` 仍全域生效；公開分享頁仍只有 `min-h-screen`，沒有 window scroll 或專用內部 scroll container。 |
| F02 | 仍存在 | 主導航與 288px explorer 仍是兩個常駐 rail；折疊主導航縮小其寬度，但尚未整合導航與 explorer。 |
| F03 | 仍存在 | Reader 保留 224px outline rail，composer 沒有相同 rail；Save/Cancel/Markdown controls 仍在一般文件流。 #92/#93 修復草稿、載入和鍵盤缺陷，沒有處理這個幾何與長文操作問題。 |
| F04 | 部分改善 | #95 將 Home 的文件列改為 `kh-interactive-row`、Lucide icon、Star button 和短日期，改善與其餘 workbench 的一致性。 Export 及完整匯出說明仍佔首頁，文件列尚無共用 action menu。 |
| F05 | 仍存在 | 匯入 Source name input 仍手刻 38px 欄位；folder picker 文案及 control 未改為專用資料夾入口。 |
| F06 | 仍存在 | Kbd 仍使用 `text-kh-text-faint`；graph 的「Scroll to zoom · drag to pan」仍用 faint。 #95 新增 Tooltip，但未更換這兩處提示的低對比文字。 |
| F07 | 部分改善 | #94 加入空 query 的近期文件並排在 action 前；若使用者沒有 recent 文件，原本重複的 Go to Knowledge 仍可能是 palette 第一個 action。 |
| F08 | 仍存在 | Sources row 是可用原生 Tab 的 Link，列表未接 `navigateListRows` 的方向鍵/Home/End 行為。 |
| F09 | 部分改善 | #95 新增 Status 並把 source sync state 轉為可讀標籤；匯入 diagnostics 仍顯示 code，Audit settings 仍顯示 raw event/target type，composer 仍有中英混用。 |
| F10 | 仍存在 | `useDesktopLayout()` 初值仍為 `true`，掛載後才讀 `matchMedia`；手機首次 render 可能短暫顯示 explorer。這是短暫布局風險，本次未重新計時。 |
| F11 | 仍存在／待量測 | Home 仍以現有 query 讀取完整來源樹與 current revisions；匯入仍可帶大量 entries 並展開整組變更。本次沒有 production-size benchmark，因此保留為量測項。 |
| F12 | 仍存在 | revision comparison 仍以兩份全文 Markdown 並排呈現，沒有 changed-line diff。 |
| F13 | 已解決 | #94 的 Favorites rail 已提供 `Show all {n}`，可開啟完整收藏清單。 |
| F14 | 仍存在 | 分享頁仍在 header 輸出 H1，再 render 原始 Markdown；相同開頭 H1 會重複。 |
| F15 | 仍存在 | 最新 Tailwind 設定仍允許 Arbitrary Values；#95 沒有新增阻擋 arbitrary sizing/type/radius utilities 的 enforcement。 |
| F16 | 仍是低優先風格選項 | neutral ramp 與 living contract 的冷藍方向未變；沒有更改配色的實作。 |

最新 main 上值得先處理的仍是 F01 分享頁捲動 blocker；再來是 F02/F03 的 shell 和讀寫體驗。F04/F07/F09/F13 則已受 #94/#95 影響，後續工作應從表中的剩餘部分開始，不重做已合併內容。

## 結論與設計判斷

Knowledge Hub 已有成熟的 Linear 方向基礎。下一輪最有價值的是統一導航結構、頁面操作位置與列表互動，讓閱讀、編輯、搜尋和整理能連續進行。繼續逐個調字級或圓角的效益較小。

設計具有產品辨識度：文件樹、來源管理、wikilink、backlinks、TOC 與圖譜形成知識工作台，而非可隨意套用到其他產品的 dashboard。主要問題是新功能尚未完全回到同一套介面：Personal Home、匯入表單、Sources detail 和版本比較各自出現不同的列表、標頭或資訊層級。

Linear 2026-03-12 的更新強調跨流程的 headers/navigation/view controls 一致，導航退到較低的視覺權重，讓工作內容保持焦點。這是本次的參照方向；並未登入 Linear app 進行逐像素量測，也未把 marketing site 的 CSS 當成 product UI 的精確規格。[Linear UI refresh](https://linear.app/changelog/2026-03-12-ui-refresh)、[A calmer interface for a product in motion](https://linear.app/now/behind-the-latest-design-refresh)

## 檢查範圍與證據限制

- 盤點 `src/app`、`src/components` 的 117 個 TSX/CSS 檔案，並檢查相關 hooks、action registry、UI primitives、Tailwind/CSS tokens、路由、讀取模型、既有 specs 與 E2E coverage。
- 涵蓋 shell/workspace selector、Personal Home、文件樹、reader/editor、TOC/inspector/history、搜尋與 command palette、graph/list、Sources/detail、匯入/preview、Settings/general/members/groups/audit、分享與錯誤/空狀態。
- A 與 B 分別使用獨立的新瀏覽器 tab。A 在未看到 detector output 的情況下完成設計評估，才讓 B 的結果進入彙整。
- 瀏覽器實看包含 1850 × 873 與 1280 × 720 的桌面，以及 390 × 844 的手機 viewport；桌面/手機有 light/dark 代表頁面檢查，並非每條路由都跑過所有尺寸與主題的矩陣。
- 使用現有 MariaDB service 中另外建立的隔離 E2E database，以及 `127.0.0.1:3201` 的暫用 dev server。Team 模式為檢查管理頁面暫時開啟；正式預設仍是 Team coming soon。測試文件與分享連結皆只存在於隔離 DB。
- 暫用 server 已停止，隔離 DB 已移除，瀏覽器 viewport/theme 已還原。Next dev 自動改寫的 `next-env.d.ts` 已還原。
- 沒有執行完整 screen-reader session、所有失敗分支、匯入 Apply、20,000-row benchmark 或 production latency benchmark。因此大資料量與效能項目是有程式依據的風險／量測建議，不能宣稱已重現性能故障。
- 沒有更動 application source、提交 commit 或建立 PR。本次交付是稽核文件與 critique snapshot。

## 已經做得好的部分

1. **視覺系統有共同語言。** Semantic light/dark tokens、Inter、1.5px Lucide icon stroke、24/32/40px control ladder、共用 focus/menu/tab、克制的 surface 和 separator 都已存在。來源：`src/app/globals.css`、`tailwind.config.ts`、`src/components/ui/control.ts`、`src/components/ui/field.ts`。
2. **主要操作機制已經成立。** Action registry 供 palette、row menu 與其他入口共用，已有快捷鍵、context menu、toast/undo、搜尋方向鍵導航、捲動還原、持久化草稿與帳號收藏。不能沿用 9/20 舊報告將這些再列為「缺少」。
3. **知識閱讀有完整結構。** Reader 的目錄、backlinks、details/history inspector、wikilink 解析與 graph list alternative 都有產品用途；SOURCE_MANAGED 的唯讀政策、revision conflict、import blocker/stale guard 與 share-link 的界限應持續保留。

## 前五項優先工作

### F01 — P0：公開分享長文章無法正常捲動

**證據：已在瀏覽器重現。** `src/app/globals.css:119` 的 body 規則在 `:127` 設定 `overflow: hidden`。`src/app/s/[token]/page.tsx:30` 的 `main` 只有 `min-h-screen`，沒有固定 viewport 高度與內部 scroll container，也未包在 AppShell。

使用 30-section 測試文章，1280 × 720 viewport 中 body 高度為 3774px、最後一個 heading 底部為 3670px。滾輪向下三頁後，`window.scrollY` 與 `document.scrollingElement.scrollTop` 都仍是 0，後段內容留在畫面外。

**影響：** 分享的閱讀流程在長文時被阻斷。P0 是對這條流程的局部 blocker，不代表整個 app 無法使用。

**建議：** 將 viewport scroll lock 限定在 AppShell，讓公開閱讀頁使用正常 document scrolling；或在分享頁建立明確的 viewport-height scroll container。保留 AppShell 的內部 pane scrolling。

**驗收：** 桌面滾輪、鍵盤與手機觸控能到達長文最後一段；一般文件 reader、tree 與 inspector 的捲動方式不受影響。

**適合流程：** `/impeccable harden`。

### F02 — P1：雙側欄與跨頁 header 缺少一致的空間分工

**證據：source + desktop visual。** `src/components/shell/app-shell.tsx:88` 的 primary nav 為 `w-40`（160px），`src/components/knowledge/source-sidebar.tsx:141` 的 explorer 為 `lg:w-72`（288px）。展開時兩者合計 448px，約為 1280px viewport 的 35%。Topbar 又分別保留相應的欄位：`src/components/shell/topbar.tsx:30`、`:47`。

共用 `PageHeader` 已採緊湊的 location/title/action row，但 Sources detail 在 `src/components/sources/source-detail.tsx:24` 仍另寫大標題 header；文件的 contextual actions 則在內文 header，捲出畫面後只有 title/Details 部分轉移到 Topbar。

**影響：** 左側結構占用大量閱讀空間，跨頁切換時需重新辨識標頭、導航與操作位置。

**建議：** 以一個左側導航區整合 workspace、主導覽、favorites/recent、document tree；保留來源分組與必要的折疊方式。定義共用的 location bar 與 view/action bar，固定 Search、Create、Share、Details 的位置。若先採漸進版本，至少把 sparse primary nav 與 explorer 的折疊策略協調起來。

這是 repo 原本 living contract §18 已承認的未完成項。單一側欄是本產品的設計提案，不是聲稱 Linear 所有頁面都只有一個 pane。

**驗收：** 1280px reader 有可用的內容寬度；閱讀/搜尋/首頁/來源頁的導航與 action placement 可預測；手機維持 drawer 而非縮小桌面 rail。

**適合流程：** `/impeccable layout`，shell 變更先寫 spec。

### F03 — P1：閱讀與編輯的幾何不一致，長文操作會離開畫面

**證據：source + browser。** Reader 用 `src/components/knowledge/document-pane.tsx:29` 的 224px outline rail，而 composer 在 `src/components/knowledge/document-composer.tsx:501`、`:536` 直接置中 reading column。A 在 1850px 寬畫面觀察到 reader → editor 的內容起點約向右移 118px。

Composer 的 Save/Cancel/Markdown controls 在一般 document flow，沒有 sticky action bar。以長文捲動三頁，內部 scroller 的 `scrollTop` 為 2160px，Save button top 為 -2092px。

**影響：** 切換編輯會打斷視覺位置；長文或手機使用者需回頂部操作。草稿自動保存與正式建立 revision 又有不同語意，狀態應在同一個可見位置呈現。

**建議：** Reader/composer 共用同一套 pane geometry；把保存狀態、Save、Cancel 和 Markdown mode 放在固定的 contextual action bar。明確區分「草稿已同步」與「已儲存正式版本」，保留現有 revision/conflict/draft 契約。

**驗收：** 寬螢幕讀寫切換保持內容起點穩定；長文任何位置都能點 Save；`⌘Enter`、Esc、Markdown toggle、草稿恢復仍符合現有行為。

**適合流程：** `/impeccable layout`、`/impeccable clarify`。

### F04 — P2：Personal Home 的列表和操作層級尚未融入 workbench

**證據：source + desktop/mobile visual。** `src/components/knowledge/personal-home.tsx:15` 的列使用藍色 link、常駐底線、文字字元 `★/☆`；其他列主要用 `kh-interactive-row` 與 Lucide Star。Home 缺少相同的 row action menu/hover treatment。`:23`、`:24` 在首屏常駐 Organize、Export ZIP 及完整匯出範圍說明。

390px 手機畫面中，完整日期時間與 favorite control 占用列的空間，較長的文件標題遭到截斷。空的 Drafts/Favorites section 仍帶一段說明，累積較多首屏高度。

**影響：** 日常入口看起來像一張導出與文件連結清單；頻繁的「繼續寫／繼續讀」和少用的 ZIP 匯出有接近的視覺重量。

**建議：** 建立共用 DocumentRow（icon/title/metadata/row actions），用相對時間或手機第二行 metadata；主區優先「繼續寫作／最近讀過／收藏」，Export 收入 overflow menu，匯出範圍說明在使用者打開匯出時呈現。New note 維持唯一 primary CTA。

**驗收：** Home 與 search/tree 的收藏、選單、focus/hover 風格一致；手機保留有意義的標題長度；日常任務先於低頻管理工作。

**適合流程：** `/impeccable distill`、`/impeccable polish`。

### F05 — P2：匯入表單繞過共用 control primitives

**證據：source + browser style measurement。** `src/components/imports/folder-import-form.tsx:252`、`:254` 手刻 Source name input；實測高 38px、border 為 `#e5e7ee`，與既有 24/32/40px ladder 不符。共用 Input 用的是 `src/components/ui/field.ts:12` 的 `border-strong`。此手刻邊界在白底的對比為 1.236:1。

`:268` 的 folder input 在檢查瀏覽器中顯示原生「Choose File / No file chosen」，與選擇整個資料夾的任務不一致。實際 `webkitdirectory` 屬性在 client ref 才加入。

**影響：** 表單高度、可辨識邊界及任務文案與 app 的其他頁面不一致。這是元件採用缺口，並非需要新增另一套 design system。

**建議：** Source name 改用既有 Input；folder picker 用可及的共享 trigger，清楚顯示 Choose folder、已選資料夾名稱與檔案數，再進入 Preview。

**驗收：** 表單控制項上同一 height ladder；操作 label 與 picker 功能一致；保留原生檔案選擇器與 keyboard accessibility。

**適合流程：** `/impeccable polish`、`/impeccable clarify`。

## 其餘完整 backlog

| ID / 優先級 | 發現與程式依據 | 建議與完成判斷 |
| --- | --- | --- |
| F06 / P2 | `src/components/ui/kbd.tsx:9`、`src/components/knowledge/graph-canvas.tsx:382` 使用 faint text。Light Kbd 3.509:1、graph hint 3.761:1；dark tokens 計算分別 3.876:1、4.330:1。 | 提供具足夠對比的 hint token；操作提示是有意義的小字，應達普通文字 4.5:1。保留較低視覺權重，但不以不可讀換取「安靜」。 |
| F07 / P2 | `src/components/search/quick-search.tsx:99`、`:254` 將 action matches 排在 results 前。Team reader 空 query 實看 17 options（6 navigation、3 create/import、8 document actions），初選是已所在頁面的 Go to Knowledge。 | 空 query 優先 recent/contextual actions，降低重複導航，使用者到達文件後能更快執行 edit/share/move 等已存在的操作。保留分組、搜尋與鍵盤功能；不是刪除有效命令，也不是宣稱沒有 recent docs。 |
| F08 / P2 | `src/components/sources/source-list.tsx:15`、`source-list-row.tsx:31` 只有 native link tab stops，未接與 Search/Home 相同的方向鍵 helper。 | Sources 等工作列表統一 ArrowUp/Down/Home/End 與 Enter，保留原生 Tab、modified click。這是便利性落差，不是說列表完全無法用鍵盤。Row focus 若未來成為 action target，再評估 E／批次操作；不增加假 action。 |
| F09 / P2 | `folder-import-form.tsx:212`、`import-sticky-footer.tsx:133`、`import-warning-summary.tsx:28`、`import-change-group.tsx:70` 直接顯示 diagnostic codes；`workspaces/audit-settings.tsx:35` 顯示 raw eventType/targetType；composer `:530` 起混用中英文字。 | 建立 user-facing label/copy mapping；第一層說「發生什麼＋下一步」，codes/IDs 保留在 Technical details。先訂主語系與 fallback，不預設整個 app 必須改為中文。 |
| F10 / P2 | `src/components/knowledge/knowledge-layout.tsx:17` 的 desktop state 初值 true；手機第一個 render 短暫顯示 `source-sidebar.tsx:141` 的 w-full explorer，hydration 後才改為 Browse。Topbar/reader actions 實測多為 32px，backlink 24px。 | 用 CSS 預先決定窄版的可見版面，避免 explorer 擋住初始內容；coarse pointer 增加實際 hit area，metadata/工具列應有手機重排。Transient 在 dev 重現，尚未量測 production duration；32px 不是自動違反 24px AA target minimum。 |
| F11 / P2 | `src/app/w/[workspaceId]/home/page.tsx:13` 起讀取所有 source/tree，再逐篇讀 current revision，UI 在 `personal-home.tsx:28` 只先顯示 12 篇 recent edits；`imports/import-preview.tsx:89` 支援 20,000 manifest entries，expanded `import-change-group.tsx:44` 一次 map 完整 changes。 | 以接近日常規模的資料量測 Home/preview。先調整查詢只取需要的資料、漸進揭露 diagnostics，再依結果採 pagination/windowing。不要從小 seed 或 Next dev compilation 延遲斷言 production 很慢，也不要以平行 query 繞過授權。 |
| F12 / P2 | `src/components/knowledge/revision-restore.tsx:21`、`:22` 是兩份全文 Markdown 並排，沒有 changed-line highlighting。 | 保留 raw Markdown 比較，補變更摘要或 line diff、版本時間、受影響內容，讓還原前可判斷差異；窄版使用可切換/上下排列。保持還原新增 revision 與 conflict check，不改成覆寫歷史。 |
| F13 / P2 | `src/components/knowledge/source-sidebar.tsx:75`、`:76` 將 Favorites/Recent 各截為 4 筆，沒有對應總數／Show all。完整收藏雖可在 Home 找到，但 rail 入口沒有說明剩餘項目。 | 有更多項目時顯示 Show all 或展開更多；讓收藏清單的顯示上限可理解。不要把已有的帳號收藏誤報為僅存在本機。 |
| F14 / P2 | `src/app/s/[token]/page.tsx:33` 輸出 title H1，`:47` 又直接 render Markdown；正文開頭同一 H1 時，分享頁實看標題連續出現兩次。 | 公開 reader 使用與 app reader 相同的 title ownership 邏輯；metadata title 與正文首 heading 一致時避免重複大標題。驗收含 H1/no H1/frontmatter title 等情況，並保持共享頁不解析 Hub scope links。 |
| F15 / P2 | Design contract §3、`tailwind.config.ts` 註解稱 arbitrary off-scale type/radius 不編譯；`tests/unit/design-tokens.test.ts` 只測 config shape，ESLint 主要擋 focus 拼法。實際用現有 Tailwind compile probe，`text-[13px]`、`rounded-[10px]`、`p-[30px]` 都生成 CSS。`rounded-xl` 亦是當前有效 token。 | 更正 enforcement 的描述；對未核准 arbitrary 值與 shared primitive bypass 補 lint／靜態檢查，保留必要 geometry 例外。替換 scale 能阻止未命名的普通 utility，不能宣稱會封鎖全部 arbitrary values。 |
| F16 / P3 | `src/app/globals.css:15` 起保持 cool/blue neutral ramp；living contract §7 已記載此 tint 是有意識的差異。 | 若要更接近 Linear 2026 的低飽和暖灰，可另做 light/dark token 比較稿再決定；這是風格選擇，優先度低於導航／互動與對比缺陷，不必抹掉 Knowledge Hub 的主色。 |

F06 的 threshold 依 [W3C Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)。顏色計算讀 CSS token／實際 computed style，沒有用截圖中 anti-aliasing 的像素估算。Dark ratio 是 source 計算；代表頁有暗色目視，但未做每個提示位置的暗色 browser measurement。

F07/F08 的參照是 Linear 既有 [Search](https://linear.app/docs/search)、[Select issues](https://linear.app/docs/select-issues) 的 context/keyboard 工作方式。F16 的暖灰方向來自 [Linear design refresh](https://linear.app/now/behind-the-latest-design-refresh)。本產品不必複製 Linear 的 issue status、assignee 或 board 模型。

## 啟發式設計健康度

這是 A 的獨立設計判斷，並非自動化測試分數。每項 0–4，4 代表非常完善；Operate/Read surface 的十項皆適用。

| Nielsen heuristic | 分數 | 主要依據 |
| --- | --- | --- |
| 系統狀態可見 | 3 | loading、toast、draft status 已有；長文時 contextual Save/status 不持續可見 |
| 與使用者語言一致 | 2 | import diagnostic codes、Source ownership/enum、部分混合語系 |
| 控制與自由 | 3 | 草稿、undo、restore 已有；公開長文捲動受阻、部分操作需回頂部 |
| 一致性與標準 | 2 | double rail、Home rows、import fields、Sources header/keys 有差異 |
| 錯誤預防 | 3 | revision conflict、capability/ownership、stale/blocker guard、share revoke 皆有契約 |
| 辨識優於記憶 | 3 | menus、palette、tree/outline 可辨識；context actions ranking 與低對比 hints 可提升 |
| 使用效率與彈性 | 3 | 快捷鍵、搜尋導航、最近項目已存在；部分工作列表尚未一致 |
| 簡潔與視覺層級 | 3 | restrained tokens 有效；double rails、Home export copy、管理頁資訊層級待收斂 |
| 錯誤辨識與恢復 | 2 | draft/revision recovery 有保留工作；匯入 code 與部分訊息仍偏技術語言 |
| 說明與引導 | 2 | 空狀態及部分 hint 有說明；術語、操作提示、任務進階說明尚不一致 |
| **合計** | **26/40** | **可用基礎成立，仍有值得優先改善的流程與一致性差距** |

## 認知負荷與情緒旅程

- **首頁：** primary New note 之外，Organize、Export 及完整 export scope 說明先於工作內容。三個入口不是數量超標，但任務頻率與首屏視覺重量不相稱。
- **Command palette：** 實看 17 options，已有分組與搜尋，因此不以「超過四項」直接判定失敗。問題是目前位置的重複導航在首選，而文件相關動作需要往下找。
- **Import preview：** Summary 同時呈現多種 document/folder/asset categories，diagnostics 又有全域與逐檔兩處。優先將會阻斷 Apply 的問題與具體處理方式放在第一層，其餘逐層展開。
- **閱讀到編輯：** 同一文章的水平起點改變，加上 Save 隨捲動離開畫面，造成「進入寫作後失去控制位置」的低谷。固定 action/status row 可改善完成感，不需要裝飾動畫。
- **分享完成後：** 長文讀者無法下捲會直接破壞分享的最後體驗。先修 F01，再精修公開頁 typography/title。

## Persona red flags

| 使用者 | 主流程與具體問題 |
| --- | --- |
| Alex，重度鍵盤使用者 | Reader → editor 時內容位置改變；Sources 列表不提供與 Search 相同的方向鍵路徑；palette 優先項是重複導航。保留已存在的快捷鍵，再統一 row focus/context。 |
| Sam，低視力／可及性依賴使用者 | Kbd/graph 操作 hints 對比不足，手刻 import field 邊界很淡，公開長文章不能正常下捲。本次未跑完整 VoiceOver，不將 DOM semantics 當成 screen-reader 全面驗收。 |
| Casey，手機使用者 | Home 的完整時間戳擠掉標題，Menu/Browse/Details 分成多個入口，32px 密集 action 需要更好的 touch hit area；初始 explorer 在 hydration 前短暫占滿內容。已存在 drawers 與 draft persistence，應保留。 |

## Detector 結果與誤報

只執行一次：

```sh
node /Users/chuntsai/.codex/skills/impeccable/scripts/detect.mjs --json src/app src/components
```

Exit code 2，2 warnings／2 種規則，人工核對後 **0 個可採納的 detector issues**：

| Rule | 位置 | 判定 |
| --- | --- | --- |
| `broken-image` | `src/app/globals.css:165` | CSS 註解中的 ProseMirror separator img 說明；不是實際 broken image |
| `side-tab` | `src/components/knowledge/markdown-prose.ts:7` | 中性的 Markdown blockquote border-left；不是側邊彩色 accent card |

掃描器沒有抓到 F01、F03、F05/F06 等實際互動／對比／元件採用問題，所以不能將 clean detector 當成 UI/UX 已驗收。

Browser evaluate 僅支援 read-only，無法進行 detector script injection。因此沒有 live overlay、overlay console findings 或 detector live server；採用實際頁面截圖、AX/DOM 與 computed-style 量測作為瀏覽器證據。

## 建議落地順序

1. **先修已確認缺陷：** F01 分享長文捲動、F05 匯入欄位採用、F06 hint contrast、F14 重複分享標題。這批可獨立驗收，適合小 PR。
2. **再整理日常介面：** F04 Home DocumentRow/action hierarchy、F07 palette ranking、F08 list navigation、F09 copy/labels、F13 favorites Show all。
3. **另立 shell/editor spec：** F02 unified navigation/header 與 F03 stable geometry/sticky actions；F10 responsive layout 一起驗證。不要在機械 polish PR 偷換整個 shell。
4. **證據驅動的後續：** F11 大資料量 query/presentation 量測、F12 revision diff、F15 enforcement 修正；F16 色彩比較稿最後再做。

## 後續設計決策

- Personal Home 的主要任務應先服務繼續寫作，還是完整文件整理？本次建議以最近工作為先，整理仍從清楚入口進入。
- 合併左側導航後，Knowledge/Graph/Sources 應共用同一個文件 explorer，還是僅 Knowledge 展開？這需要 shell spec 定義，不能由單一頁面的 CSS 決定。
- 主語系與日期顯示如何決定？先建立 policy，再改個別 copy，避免混用。

## 再驗證重點

實作時按變更範圍補驗證，不必對整個 repo 重跑無關測試。F01 用真的長文與 scroll interaction；F03 用讀寫起點、長文 Save、草稿與 rendered wikilink round trip；F05/F06 用實際 compiled control styles/contrast；F02/F10 用桌面/手機、鍵盤、focus、drawers 與 mounted navigation 的完整流程。效能只用 production build 與可代表日常資料量的 fixture 判斷。
