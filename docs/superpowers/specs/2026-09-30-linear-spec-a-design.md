# Linear Spec A — 質感三件套（字體／暗色／按鈕）設計規格

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-30 |
| 狀態 | 待實作（design spec，非 plan） |
| 範圍 | 字體（Inter Variable + mono）、暗色下沉 + 半透明邊框、按鈕半透明 fill + press。純 presentational，不改佈局、不改授權、不改資訊架構 |
| 前置 | [Frontend Design Language](frontend-design-language.md)（living contract）、[Linear alignment audit 2026-09-20](../../verification/2026-09-20-linear-design-alignment-audit.md)、`linear.app.md` Layer B + `redesign-skill.md`（frontend skill 路由） |
| 實作計畫 | 尚未撰寫（本 spec 拍板後再寫 `plans/2026-09-30-linear-spec-a.md`） |
| 非目標 | Spec B（Shell 結構：單/雙欄、topbar 搜尋框、頁寬）與 Spec C（密度與空態：personal-home、StatusMessage、★→Star）皆不在本批 |

## 1. 現況：已查證的事實

規劃前逐項讀了原始碼，每一行都附證據位置。

| 事項 | 現況 | 證據 |
| --- | --- | --- |
| 字體載入 | `Inter`（`next/font/google`，非 Variable 明確設定），只有 `--kh-font-sans`，無 mono 變數 | `src/app/fonts.ts:1-11`、`src/app/layout.tsx:16` |
| OpenType | 全庫無 `font-feature-settings`，Linear 的 `cv01`/`ss03` 不存在 | grep `font-feature` 全庫 0 命中；`globals.css` 無此規則 |
| Weight | 全庫只有 Tailwind 預設 `font-medium`（500）/`font-semibold`（600），Linear 簽名 weight 510/590 不存在 | `button.tsx:59` 用 `font-medium`；`document-header.tsx:100` 用 `font-semibold` |
| Mono | `font-mono` 落到 Tailwind 預設棧，無 Berkeley/Geist/JetBrains；`tabular-nums` 只有 `time/kbd` 有 | `globals.css:140-145`；`tailwind.config.ts` 無 `fontFamily` |
| 字級 tracking | 已對齊 Linear 測量值（12px 0、13px -.01em、14px -.013em、15px -.011em） | `tailwind.config.ts:32-43` |
| 暗色 canvas | `--kh-bg #131417`（L\* 約 6.3），Linear marketing `#08090a`（L\* 約 2.4）；tint 是刻意偏離（contract §7 已承認） | `globals.css:64`；contract §7「Divergence」 |
| 暗色邊框 | 實色 `#1e2127`，Linear 是 `rgba(255,255,255,0.05~0.08)` 半透明白 | `globals.css:71` |
| 按鈕 ghost | 全透明，Linear ghost 是 `rgba(255,255,255,0.02)`、subtle `0.04` | `button.tsx:8` |
| 按鈕 secondary | 實色 `bg-kh-bg` + `border-strong`，Linear 控制是半透明 fill + 細邊框 | `button.tsx:7` |
| Press 回饋 | 無 `active:scale`，只有 `transition-colors` | `button.tsx:59` |
| Motion token | `120/160ms + cubic-bezier(0.16,1,0.3,1)` 已與 Linear 一致，不需動 | `tailwind.config.ts:76-85` |
| Radius/elevation | `sm4/md6/lg8/xl12` + `popover/modal` 已對齊 Linear 階梯，不需動 | `tailwind.config.ts:47-60` |

## 2. 目標與非目標

**目標。** 在不改佈局的前提下，讓第一眼質感進入 Linear 語言：字體有 510 的收斂感與幾何 `a`、暗色是「內容從黑暗中浮現」而非深灰、按鈕有半透明材質與按壓回饋。

**非目標（明確不做）。** 淺色主題 ramp 不動（Linear 淺色本來就是次要語境）；`kh-page` 寬度不動（contract §18 item 5 的 defer 繼續有效）；雙側欄不動（Spec B）；`spacing`/`maxWidth` 取代規則不動；不新增任何 full visual framework。

## 3. 決策摘要

| # | 決策 | 理由 |
| --- | --- | --- |
| D1 | 字體留在 `next/font/google`，不自託管 woff2 | `global-error.tsx` 也要同字體（`fonts.ts` 註解）；自託管增加 CSP/快取面，Variable 軸由 next/font 變數處理即可 |
| D2 | 510/590 以 `fontWeight` token 進合約，不用 arbitrary `font-[510]` | contract §3 enforcement：off-scale 不編譯；510 是 Linear 簽名，值得具名 token |
| D3 | Mono 選 `Geist_Mono`（next/font/google），fallback `ui-monospace, SF Mono, Menlo` | 與 Linear 的 Berkeley Mono 同為幾何 mono；Geist 與 Inter 同家族，在 12–14px 與正文最協調；不新增依賴 |
| D4 | 暗色下沉採「近黑三階」：canvas `#08090a`、chrome `#0f1011`、elevated `#191a1b`，sunken 取 `#0b0c0e`（canvas 與 chrome 之間） | 直接取自 `linear.app.md` §2，前兩階是 Linear 原值，sunken 是為了「rails 比 canvas 深」這個既有語義做的內插（contract 要求內插需標記，見 §1a） |
| D5 | 邊框換半透明白（dark），`border-strong` 以對比度計算重定，不沿用實色 | Linear 用 luminance stepping 做 elevation；實色邊框在近黑上顯重。`border-strong` 仍需過 WCAG 1.4.11（3:1 against `bg`/`subtle`/`sunken` 三面，沿用 audit finding 19 的方法） |
| D6 | 按鈕 fill 走新 token `--kh-ghost`/`--kh-ghost-hover`，不用 `bg-white/[0.02]` 這類 arbitrary | contract §8：顏色只在變數層；arbitrary rgba 會成為第二個真相來源 |
| D7 | Press 直接做在 primitive（`buttonClasses` + `fieldClasses` 不動、`menu` rows 不動），不逐頁加 | primitive 擁有形狀（contract §15）；逐頁加 `active:scale` 是新的漂移口 |

## 4. 切片 A1 — 字體

### 4.1 行為

1. 全站正文為 Inter Variable，`font-feature-settings: "cv01", "ss03"` 全域開啟（`body` 層，一處）。
2. 預設 emphasis weight 從 500 改為 510：`Button`、`PrimaryNav` selected、`PageHeader` h1、`source-sidebar` collection 名、`quick-search` 13–14px labels。閱讀性文字（body/snippet/metadata）維持 400，強強調維持 590（取代現有 `font-semibold` 600）。
3. Mono 用於：fenced code（`.kh-editor pre`、reader code block）、`Kbd`、table 數字欄、`Timestamp` 已有的 `tabular-nums` 保留。`Kbd` 字級維持 `micro`，family 換 mono。
4. `prefers-reduced-motion` 與字體無關，不動。`antialiased` 保留。

### 4.2 Token 變更（contract + config 同改）

- `tailwind.config.ts`：`fontFamily.sans = ["var(--kh-font-sans)", ...既有 fallback]`、`fontFamily.mono = ["var(--kh-font-mono)", "ui-monospace", "SF Mono", "Menlo"]`；新增 `fontWeight: { normal: 400, medium: 510, semibold: 590 }` 並 **replace**（不 extend），使裸 `font-bold`（700）不編譯——Linear 最大 weight 即 590（`linear.app.md` §7 Don't）。
- `src/app/fonts.ts`：`Inter({ variable: "--kh-font-sans" })` 保持，新增 `Geist_Mono({ variable: "--kh-font-mono", subsets: ["latin"] })`；`layout.tsx` 同時掛兩個 variable class。
- `globals.css`：`body { font-feature-settings: "cv01", "ss03"; }`；`time, kbd` 的 `tabular-nums` 保留並擴及 `.tabular` 工具已覆蓋處（不新增 class）。

### 4.3 影響檔案清單

`fonts.ts`、`layout.tsx`（+ `global-error.tsx` 同掛 variable，contract §15 已要求同字體）、`globals.css`、`tailwind.config.ts`、所有 `font-medium`→ 新 `medium`（語義不變，值 500→510）、所有 `font-semibold`（600→590）呼叫點。後者以 codemod 批次改，plan 需列出 grep 命中數（估計 20–40 處）。

### 4.4 驗收

- `npx tsc` + `make verify` 綠；`font-bold`/`font-[510]` 出現即編譯失敗（enforcement 有效）。
- Chromium 實測：`a` 為單層（cv01）、`g` 幾何形（ss03）；DevTools computed weight 510/590。
- 無 JS 下仍為 Inter（next/font 內聯 CSS，不依賴 hydration）。

## 5. 切片 A2 — 暗色 + 邊框

### 5.1 行為

1. Dark 下：canvas 近黑，文字維持 `#f7f8f8` 系（現有 `--kh-text #e7e8ec` 已接近，保留；不換純白）。
2. Elevation 改 luminance stepping：deeper = 更暗 bg，elevated = 白不透明度逐階 `0.02→0.04→0.05` 的等效實色（維持現有用實色 token 的架構，不切換成 rgba 背景——架構不動，只換值）。
3. 邊框：`--kh-border: rgba(255,255,255,0.08)` 標準、`--kh-border-subtle`（如需）`0.05`；`--kh-border-strong` 重算至 3:1（候選起點 `rgba(255,255,255,0.28)`，以腳本實測為準，不硬寫）。
4. Light 主題：值不動（`--kh-bg #ffffff`、`--kh-border #e5e7ee` 等保留）。唯一例外是若 A1 的 mono 在 light 下對比不足，隨 `--kh-syntax-*` 一起調（已有 `syntax-colors.test.tsx` 看守）。

### 5.2 Token 變更（初值，plan 以實測腳本定稿）

```text
dark:
  --kh-bg:         #08090a   (was #131417)
  --kh-bg-raised:  #0f1011   (was #191a1e)
  --kh-bg-sunken:  #0b0c0e   (was #0e0f12, 內插)
  --kh-bg-subtle:  #191a1b   (was #1d1f24)
  --kh-bg-hover:   #1e2025   (was #24262c, 跟隨加深)
  --kh-bg-selected:#23253d   (保留，accent 選中態不動)
  --kh-border:     rgba(255,255,255,0.08) (was #1e2127)
  --kh-border-strong: 待測（was #6a6d73；起點 rgba(255,255,255,0.28)）
  shadow popover/modal: 加深沿用現有形狀，alpha 上調一檔（腳本對照截圖定）
```

`--kh-bg-hover-strong`、`--kh-highlight`、`--kh-overlay` 隨 canvas 加深重新對一次（overlay 維持 `rgb(0 0 0/0.55)` 或略降，以 dialog 隔離感為準）。

### 5.3 驗收

- 沿用 audit 方法：`border` 必須 **低於** hover fill 的 L\*（finding 18 的反轉不再犯）；`border-strong` 對 `bg`/`subtle`/`sunken` 三面皆 ≥3:1（finding 19 的方法）。
- 明暗雙主題截圖比對（沿用 audit §6 的「接真實 DB 跑起來比對」）：document 頁、knowledge tree、⌘K、sources 表。
- `text-faint` 仍只用於可忽略 marks（contract §8），加深後重跑 4.5:1 斷言（`text`/`secondary`/`muted`）與 3:1（`faint`）。

## 6. 切片 A3 — 按鈕

### 6.1 行為

1. `ghost`：`--kh-ghost` fill（dark `rgba(255,255,255,0.02)`、light `rgba(23,25,32,0.03)`），hover 升一檔（dark `0.05`、light `0.06`），文字 `text-muted → hover:text`。
2. `secondary`：fill 改 `--kh-ghost-hover` 等效 + `border`（decorative）取代 `border-strong`——secondary 按鈕的背景不再等同 canvas，其 border 回歸裝飾線，`border-strong` 留給 fields（contract §6 的 job 規則）。
3. `primary`/`danger`/`link` 語義不動，僅 weight 500→510、加 press。
4. 全 primitive press：`active:scale-[0.98]` + `transition-[background-color,transform]`（duration 沿用 120ms token，不新增）。

### 6.2 影響檔案清單

`globals.css`（新增 `--kh-ghost*` 亮暗各一組）、`button.tsx`（`variantClasses` + `buttonClasses` 基底串）、`tests/unit/ui-primitives.test.tsx`（補 ghost fill 斷言：ghost 與 transparent 不相等；press class 存在）。

### 6.3 驗收

- `ui-primitives.test.tsx` 綠且新增 2 case（ghost fill、press）。
- 鍵盤 focus ring 不變（`.kh-focus-ring` 唯一拼法，`no-restricted-syntax` 繼續看守）。
- `search-form` 覆寫 audit（finding 12 的迴歸）：grep `buttonClasses.*className` 含 `h-`/`px-`/`py-` 者必須為零（該 case 曾漏網，contract §15 已記）。

## 7. Contract 修訂點（與 code 同 PR）

1. §4 表：`fontWeight` 新增 `medium 510 / semibold 590` 列；`fontFamily` 新增 mono 行。
2. §7：dark ramp 值更新 + sunken 內插標記；tint/divergence 段落改寫（tint 移除，改記「2026-09-30 起跟隨參考為 achromatic，accent 承載全部色彩」）。
3. §6：`secondary` 按鈕 border 從 `border-strong` 改 `border` 的 job 說明；`--kh-ghost` 用途一句。
4. §9：全域 `cv01/ss03` 一句 + `font-bold` 不編譯一句。

## 8. 風險與不做

- `next/font` Variable 在 CI 需連字體 CDN（既有 Inter 已如此，無新增風險）；若離線 build，沿用既有 fallback。
- 近黑 canvas 會放大現有「暖灰殘留」：`--kh-bg-hover-strong #e4e7ec` 等 light 值不受影響，dark 的 `--kh-bg-hover-strong #2b2e35` 需重對，否則 rails hover 發灰。
- 本批不碰 `fontSize` 階梯、不碰 `maxWidth`、不碰 sidebar 結構——看到不順手也不修（Spec B/C 的事）。

## 9. 驗收總閘

- `make verify`（unit + typecheck + lint + build）綠。
- 對比度腳本：`border-strong` 三面 ≥3:1；`text/*` 按 contract §8 門檻。
- 真機截圖（亮/暗 × document/tree/⌘K/sources）：與本 spec §5.2 初值或 plan 定稿值一致，無純白 `#ffffff` 正文、無實色暗邊框、無 700 weight。
