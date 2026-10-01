# Linear UI/UX 修正與驗證

基底：`origin/main` 的 `1cf8114`。實作分支：`codex/linear-uiux-remediation`。這份紀錄接續 [原始稽核](2026-10-02-linear-ui-ux-audit.md) 與 [修正設計](../specs/2026-10-02-linear-remediation-design.md)，原始稽核的版本與分數保持為歷史快照。

## 修正對照

| Finding | 結果與證據 |
| --- | --- |
| F01 分享頁捲動 | 移除全域 body 捲動鎖定，AppShell 保留自己的 viewport。Production browser 35-section 分享文章可以捲到最後一節。 |
| F02 雙側欄 | 合併為單一 288px 導覽區：Primary navigation 加 Knowledge explorer；折疊後為 48px。手機使用一個 Menu drawer。1850px viewport 的 main 起點為 288px。 |
| F03 讀寫位移與長文操作 | Composer 使用同一個 DocumentPane 與 outline 預留區。Breadcrumb 起點差小於 2px；捲到底時 Save 仍在 viewport。Save/Cancel/Markdown 與個人草稿狀態置於 sticky header。Reader 捲動後可從 topbar 執行 Edit/Share/Details；手機收進文件操作選單。 |
| F04 Home 層級與文件列 | 整理、匯出及匯出範圍移入 Home actions；New note 保持主要操作。文件列接入 action registry/menu，手機保留日期；空 Drafts/Favorites 不佔據首頁。Move 仍由 Organize documents 進入，沒有在 Home 放置無法執行的 Move action。 |
| F05 匯入控制項 | Source name 使用 Input，實際高度 32px；Choose folder 使用 Button 與隱藏 directory picker，顯示資料夾名稱／數量並允許重新選取。既有真實 import/apply E2E 通過。 |
| F06 提示對比 | Kbd、graph zoom hint 改用 muted text。單元測試確認明暗主題在 canvas/subtle/sunken 背景均達 4.5:1。 |
| F07 Palette 排序 | Recent 保持在前；空 query 的文件／資料夾操作優先於 create 和 navigation，移除目前 section 的重複導航。Typed query 保留完整匹配。Recents 失敗、空清單、非預期回覆、選取位置與鍵盤操作均有回歸測試。 |
| F08 Sources 鍵盤 | 接入與 Home/Search 共用的列表導航，保留原生 link。瀏覽器確認 ArrowDown 可將焦點移到下一列。 |
| F09 文案與診斷 | Composer 使用既有介面的英文主語系。Import message/path 在前，code/details 保留於 Technical details；audit 將已知 event/target 轉為易讀 label，未知值採 readable fallback，原始 code/ID/payload 可展開。未改動 domain diagnostic codes 或錯誤分類。 |
| F10 Responsive / touch | 桌面側欄透過 CSS 在 hydration 前決定是否可見；390px 初始 main 與 loading pane 不預留桌面 explorer。手機導覽與 explorer 合併，選文件後關閉。coarse pointer 的共用按鈕、menu、主要導覽與 tree controls 至少 40px；常用 row actions 保持可見，星號與選單觸控區不重疊。一次僅掛載一個 explorer，避免重複 filter ID。 |
| F11 大量資料 | Home 改成單一 metadata join 查詢，省去每份文件的 current-revision Markdown 讀取。真實 DB 確認 workspace 權限、scope、封存文件／來源與 includeArchived 行為。20,000 個 import changes 初次僅建立 50 列 DOM，diagnostic summary 同樣每批 50 筆，提供 Show more。這是可驗證的 query/DOM 改善，沒有宣稱 production latency 或記憶體已完成全面量測。 |
| F12 Revision 比較 | 顯示新增／移除行數、兩個版本時間、title change、line numbers 與差異上下文。LCS 上限 500,000 cells，大幅重寫退回精確 replacement block；先顯示 100 行，可展開更多。全文 Markdown 保留於 disclosure，restore 新增 revision／conflict guard 保持原行為。 |
| F13 Favorites Show all | 最新 main 已修正；保留原實作，Show all 的完整清單及 4 筆上限回歸測試通過。 |
| F14 分享重複標題 | 與 reader 採相同 opening-H1 ownership helper；分享文章只有一個 opening H1。 |
| F15 Design enforcement | 修正文檔與 Tailwind 註解：arbitrary values 仍會編譯。新增 ESLint `design/contract` 檢查 arbitrary type/radius/shadow/motion/spacing 與可見 native form fields，保留 editor/search/tree 例外與 geometry。實際 ESLint probe 驗證 literal/template classes 被阻擋、有效 geometry 可通過。Search icon clearance 改為語意 CSS class。 |
| F16 Palette 風格 | 保留 living contract 明確選定的 cool neutral 與 blue accent。這是可選的品牌方向，並非缺陷；暖灰替換沒有混入功能修正。明暗模式均檢視代表畫面。 |

## 驗證

- TypeScript：`npm run typecheck`。
- ESLint：`npm run lint`，包含新 design contract rule。
- Unit：99 files、1,468 tests 通過。新增 diff correctness/context/large rewrite、palette context、20,000-change presentation、拒絕存取時不讀取摘要、ESLint enforcement 與 light/dark hint contrast。
- Integration：53 files、614 tests 通過；隔離 MariaDB，含新 Home summary 權限、scope 與 archive filtering 測試。
- Production build：E2E harness 執行 `next build` 成功。
- Browser 核心驗收：`linear-remediation.spec.ts` 的 8 個情境通過，涵蓋分享捲動與 title、1850px 讀寫位置／sticky Save、390px Menu／捲動後文件操作、Home、Sources keys/import field、coarse-pointer 明暗模式與初始 CSS geometry。
- 既有 browser 回歸：composer 42、authoring 8、imports 5、outline 4、recents/favorites 9、keyboard shortcuts 13、knowledge explorer 6、reading loading 5 個情境通過。使用當前狀態的成功證據；只在變更或失敗涉及的範圍重跑。
- Personal-only browser：另以 `KM_TEAM_WORKSPACES_ENABLED=false` 驗證跨瀏覽器草稿、整理／匯出／還原／收藏與關閉分頁後從 Home 續寫，2 個完整情境通過。核心與既有回歸合計 102 個不同 browser 情境，分批驗證，非一次完整 E2E suite。
- 最後 layout mechanical scan：shell、Home、composer、revision restore、imports 範圍，輸出 `[]`；`git diff --check` 通過。

初期 browser failures 分別來自舊文案／舊排序斷言、codes 已收進 disclosure、新測試誤用 Team workspace 的 personal-only 功能、Next 隱藏 flight segments 的未 scoped locator、浮點座標、Home link 的日期 metadata accessible name，以及初始 streaming fallback 的 assertion。修正對應斷言與 fixture；沒有移除產品情境。Outline helper 原本只等待 region 出現，新 composer 同樣擁有 region，因此另等待 create navigation 完成，避免讀到 `/new` 作為 document URL。

## 畫面與結構檢視

- 桌面主要路徑：導覽區在左，breadcrumb 與文件內容在中央，outline 預留區在右；primary navigation 與 explorer 以 divider 分組，不再保留雙 rail。
- 讀寫密度：沿用 reading column 與原文字 token；sticky command 區保持短而明確，文件內容捲動，外層 topbar 固定。
- 手機：導覽集中於同一左側 Menu；文件操作於頂列收成選單，常用 tree actions 的觸控區獨立。沒有 document-level 橫向 overflow。
- 極端內容：35-section 分享文與 composer、20,000-change import、1000-line diff replacement 均有適合該層級的測試。
- DOM/focus：原生 links 與共用 menu/dialog primitives 保留；Sources keys、navigation shortcuts、drawer 關閉和 rendered editor keyboard workflows 有 browser 回歸。

## 驗證界限

這次沒有宣稱完整 WCAG conformance，也未進行全路由 screen-reader 或各 viewport/theme 的笛卡兒矩陣。Audit labels 採 source review；Company SSO 的獨立 browser servers 沒有在此次啟動，治理與授權由完整 integration suite 驗證。

初始窄版測試停用 JavaScript，用來檢查 CSS 幾何；Next streaming reader 此時留在 loading fallback，不代表 JavaScript-free 完整閱讀已支援。

Home 仍會列出工作區所有 metadata；Personal service 的既有逐項權限查詢、import payload 大小、scroll 到多次 Show more 後的 DOM 上限，以及真實 production P95 latency 未在此擴大重構或建立 benchmark。Revision 的大幅重寫 fallback 精確呈現內容，但可能比最小 diff 顯示更多 changed lines。

實作驗證完成時，變更維持於本地工作分支，尚未提交／推送。測試使用可丟棄資料庫；harness 完成後移除 DB 並停止 server。

## 獨立 review 後續

見 [independent code review](2026-10-02-linear-remediation-review.md)：確認並修正手機 explorer menu 的 stacking／pointer blocking regression，新增 2 個 browser scenarios，包含一般及 context menu、dialog focus／Escape／送出。原有 102 個情境是 initial implementation 的分批驗證紀錄，不代表 review 前已覆蓋這兩個新情境。
