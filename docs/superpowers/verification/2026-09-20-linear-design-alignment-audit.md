# Linear Design Alignment — Audit Record

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-20 |
| 類型 | 稽核紀錄（定點快照，非追蹤清單） |
| 受測分支 | `claude/ui-ux-linear-alignment-uqvmj4`，HEAD `4dfdb95` |
| 相關 PR | [#42](https://github.com/mike840609/knowledge-hub/pull/42)，10 commits，69 檔案 +1254/−279 |
| 對照契約 | `docs/superpowers/specs/frontend-design-language.md`（living contract） |

## 這份文件的定位

這是一次 UI/UX 稽核的**歷史紀錄**：發現了什麼、處理了什麼、當下還剩什麼。

**未完成項目的 canonical 來源是 living contract 的「Open items」章節，不是這裡。** 這份文件的未完成欄位是稽核當下的快照，會隨時間失準；要知道「現在還有什麼沒做」請讀契約。這個分工跟 README 對 canonical spec 與 architecture history 的區分一致。

稽核起因是一次對「設計語言是否對齊 Linear 原則」的檢視。過程中發現真正的問題不只是缺少系統，而是**既有契約沒有被遵守**——Phase 2.5 §25–30 早就寫下了視覺規則，但它埋在帶日期的階段文件裡，所以既有實作與本次第一輪修改都在不知情的狀況下違反了它。契約的搬遷（finding 22）是這次的根因修復。

---

## 總覽

| 類別 | 已完成 | 未完成 | 小計 |
| --- | --- | --- | --- |
| 1. Token 系統 | 6 | 1 | 7 |
| 2. 元件系統 | 4 | 4 | 8 |
| 3. 主題與色彩 | 4 | 0 | 4 |
| 4. 互動模型 | 3 | 5 | 8 |
| 5. 版面與文件 | 3 | 4 | 7 |
| **設計發現合計** | **20** | **14** | **34** |
| 6. 驗證缺口 | — | 3 | 3 |

---

## 1. Token 系統

| # | 發現 | 狀態 | 依據 |
| --- | --- | --- | --- |
| 1 | 字級 9 種：`text-sm`/`xs`/`2xl`/`[13px]`/`[15px]`/`[11px]`/`[10px]`/`lg`/`xl`/`base` 混用。同層級標題因路徑而異——`PageHeader` 20px，14 個頁面手刻 24px | ✅ 已完成 | `601b948` |
| 2 | 圓角 5 種拼法 | ✅ 已完成 | `601b948` |
| 3 | 陰影無 elevation 系統，`sm/md/lg/xl` 各用 1–2 次 | ✅ 已完成 | `601b948` |
| 4 | 焦點兩套 idiom 並存：22 處 `focus-visible:outline` vs 54 處 `ring-2`，`knowledge-empty-state` 兩顆相鄰按鈕各用一套 | ✅ 已完成 | `601b948` |
| 5 | 硬寫顏色繞過 token：`amber-50`、`red-200`、`red-700`、三種 `bg-black/*` | ✅ 已完成 | `601b948` |
| 6 | 無 motion 系統：全庫 5 個 transition、1 個 animation，overlay 瞬間跳出；`prefers-reduced-motion` 只有 1 處照顧 | ✅ 已完成 | `a1c82a7` |
| 7 | `spacing` 是唯一未被 replace 的 scale，gap/padding 仍不受約束 | ❌ 未完成 | 契約 Open items |

**採用的手法**：`tailwind.config.ts` 中的 scale 一律**替換**而非 extend，因此 `text-[13px]`、`rounded-xl`、`shadow-sm` 編譯不出任何 CSS，`borderRadius` 不設 `DEFAULT` 所以裸 `rounded` 也不成立。這是讓規則從「靠 review 把關」變成「靠編譯器把關」的關鍵。

---

## 2. 元件系統

| # | 發現 | 狀態 | 依據 |
| --- | --- | --- | --- |
| 8 | 共用 `Button` 是 `min-h-10`(40px)，但 shell 實際控制項是 32/36px，導致 **21 處手刻** `inline-flex … rounded-md …` 而非 import | ✅ 已完成 | `287c220` |
| 9 | 只有 primary/secondary 兩個 variant，缺 ghost/danger/link | ✅ 已完成 | `287c220` |
| 10 | 破壞性操作用主色：Archive workspace／Confirm archive 以紫色 primary 呈現 | ✅ 已完成 | `287c220` |
| 11 | Badge 狀態不可掃視：success/warning/danger 共用 `bg-kh-bg-hover`，只差文字色 | ✅ 已完成 | `0a70605` |
| 12 | `search-form.tsx:22` 以 `className="m-1 min-h-9 px-4 py-1.5"` 覆寫 `<Button>` 的形狀——正是 button 系統要擋的漂移，因為不是手刻 `inline-flex` 而從 finding 8 的掃描漏掉 | ❌ 未完成 | 契約 Open items |
| 13 | `Input` 40px、`search-form` input 44px，都沒有上 Button 的 size scale，表單並排對不齊 | ❌ 未完成 | 契約 Open items |
| 14 | 選單是原生 `<details>` 手刻（`workspace-selector`、`source-sidebar`），Base UI 的 `Menu` 未使用（僅用 button/dialog/tabs）。無方向鍵導航、無 roving focus。**違反契約自己的「每個 list 可方向鍵導航」規則** | ❌ 未完成 | 契約 Open items |
| 15 | Loading 三種寫法：骨架屏、`Loading documents…`、`Searching…`；且 `knowledge-layout` 的 `DocumentRegionSkeleton` 與 `loading.tsx` 幾乎逐行重複 | ❌ 未完成 | 契約 Open items |

---

## 3. 主題與色彩

| # | 發現 | 狀態 | 依據 |
| --- | --- | --- | --- |
| 16 | **完全沒有 dark mode**：`color-scheme: light` 寫死，全庫 0 個 `dark:` | ✅ 已完成 | `26f42bf` |
| 17 | 中性色非同一色相：4 個近似灰，`--kh-reading-bg` 偏暖而其餘偏冷，且在 topbar↔nav 接縫處並置 | ✅ 已完成 | `601b948` |
| 18 | 暗色分割線過亮：border L\* **18.44** > hover 填色 L\* **15.19**，靜態結構線比互動狀態亮，階層反轉 | ✅ 已完成 | `2caef27` |
| 19 | 控制項邊框不符 WCAG 1.4.11：`Input`/`Textarea`/secondary button 的背景等同畫布，border 是唯一邊界，但暗色 **1.34:1**、亮色 **1.24:1**（需 3:1）。**兩個主題都失敗，且為既存問題** | ✅ 已完成 | `2caef27` |

**選值方法**：顏色決策以 relative luminance、L\* 與對比度計算，不靠目視。`border-strong` 對**每一種可能相鄰的表面**驗證——第一組候選在畫布上合格（3.25/3.23）但在 `subtle`/`sunken` 上失敗（2.91/2.88）。

---

## 4. 互動模型

| # | 發現 | 狀態 | 依據 |
| --- | --- | --- | --- |
| 20 | 全文搜尋頁零鍵盤導航：⌘K palette 有完整方向鍵/Enter/`aria-activedescendant`，`/search` 完全沒有——退化的那套落在結果更多、更需要鍵盤的地方 | ✅ 已完成 | `4dfdb95` |
| 21 | 捲動位置一律歸零，退回列表丟失閱讀位置 | ✅ 已完成 | `4dfdb95` |
| 22 | 搜尋結果 metadata 串成一句話無法垂直掃描（對照組 `source-list-row` 就在同 repo 且做對了） | ✅ 已完成 | `4dfdb95` |
| 23 | ⌘K 只執行搜尋，不執行動作。新增筆記／切換 archived／開啟 Details 無鍵盤路徑，也無快捷鍵總覽 | ❌ 未完成 | 契約 Open items |
| 24 | 無 toast/undo 層。回饋是會撐開版面的 `role="status"` 段落，**`aria-live` 全庫 0 處**；破壞性操作是 inline 兩段確認而非「做了再給 undo」 | ❌ 未完成 | 契約 Open items |
| 25 | 零 context menu。重新命名／封存／複製連結都要先進文件頁 | ❌ 未完成 | 契約 Open items |
| 26 | tree 展開、source 展開、filter 文字皆為 `useState`，重新整理即丟失 | ❌ 未完成 | 契約 Open items |
| 27 | **導航非瞬間**：每次點文件都是 server round trip，全 app 僅一個 `loading.tsx` 邊界。**體感差距最大、且是唯一的架構題**——需要量測後決定 prefetch/caching 策略，不是 CSS 改動 | ❌ 未完成 | 契約 Open items |

---

## 5. 版面與文件

| # | 發現 | 狀態 | 依據 |
| --- | --- | --- | --- |
| 28 | 違反既有 §26：`ui/textarea` 帶陰影（規定 normal surface 不用陰影）、panel 使用 overlay 圓角、側欄 dropdown 未用 overlay 圓角 | ✅ 已完成 | `0c8ac6a` |
| 29 | **設計契約埋在帶日期的階段文件裡**：Phase 2.5 §25–30 寫下了視覺語言、tokens、component 架構、state 策略與 domain 邊界，但沒人在 Phase 2.5 結束後讀它——**這是本次所有漂移的根因** | ✅ 已完成 | `76c3619` |
| 30 | 無 `CLAUDE.md` | ✅ 已完成 | `76c3619` |
| 31 | Settings 導航無 active state、未用既有 `ui/tabs`；容器寬度 **7 種**、頁面內距 3 種 | ❌ 未完成 | 契約 Open items |
| 32 | 空狀態／錯誤狀態僅標題加段落；knowledge 空狀態並列兩個等重 CTA | ❌ 未完成 | 契約 Open items |
| 33 | `error.tsx`/`not-found.tsx` 只覆蓋 `knowledge/[sourceId]/` 一條路由；`/search`、`/sources`、`/settings` 無邊界，也無 `global-error.tsx` | ❌ 未完成 | 契約 Open items |
| 34 | 日期格式硬寫 `en-US`（3 處） | ❌ 未完成 | 契約 Open items |

---

## 6. 驗證缺口

這些不是設計問題，是**本次交付的證據強度不足之處**，誠實記錄以免日後被誤認為已驗證。

| 項目 | 狀態 | 說明 |
| --- | --- | --- |
| 暗色主題目視檢查 | ⚠️ 部分 | 經過一次人工檢視，即是 finding 18 的來源。修正後的 code block 與表格邊框**尚未被看過**——其 `bg-subtle` 填色與新 divider 僅差 L\* 0.93，推論靠填色即足夠，但這是推論不是觀察 |
| 鍵盤導航自動化測試 | ❌ 無 | finding 20 的方向鍵行為無任何測試。e2e 通過只證明搜尋 DOM 改動未破壞既有斷言，不證明方向鍵會動 |
| UI primitive render 測試 | ❌ 無 | 316 個 unit test 無一 render component。`Button` 現有 5 variant × 3 size × icon 十餘種組合，唯一安全網是 e2e |

---

## 執行紀錄

10 個 commit，每個獨立可 review 且各自綠燈：

| Commit | 內容 |
| --- | --- |
| `601b948` | Token 化字級、圓角、elevation、焦點與中性色 ramp |
| `287c220` | 統一 button 系統 |
| `0a70605` | Badge 狀態色調 |
| `a1c82a7` | Motion 系統 |
| `83d20d3` | 載入 Inter、等寬數字 |
| `26f42bf` | Dark theme |
| `0c8ac6a` | 修正 §26 違規 |
| `76c3619` | 契約升格為 living contract；新增 CLAUDE.md |
| `2caef27` | 調暗暗色分割線；拆出 `border-strong` |
| `4dfdb95` | 搜尋頁鍵盤導航、捲動還原、可掃視列 |

CI 四個 job（`unit`／`build`／`integration`／`e2e`）在每一個 head 上皆通過。`lint`、`typecheck`、`build` 與 316 個 unit test 在每次 push 前於本地執行。

## 後續建議順序

1. **finding 12、14** — 這兩項是本次工作自己留下的漏洞（一個系統漏洞、一個契約漏洞），優先於其餘未完成項
2. **finding 15、33** — 便宜，順手
3. **finding 7、31、34** — 機械性，手法已驗證
4. **finding 23、24、25** — 改變行為，依 CLAUDE.md「substantive design changes get a spec before code」需先寫 spec
5. **finding 27** — 獨立的架構決定，建議先量測再決定範圍

完成第 1–3 組後，presentational 層面的對齊工作大致告一段落；剩餘真正影響體感的只有 finding 27。
