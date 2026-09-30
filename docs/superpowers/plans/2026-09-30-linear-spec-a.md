# Linear Spec A（質感三件套）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 實作 Spec A 三個切片（A1 字體、A2 暗色+邊框、A3 按鈕），讓質感進入 Linear 語言，不改佈局與授權。

**Architecture:** Token 先行：字體變數與 weight 階梯先進 `tailwind.config.ts`（replace，不 extend），暗色值只換 `globals.css` 變數，按鈕 fill 走新 `--kh-ghost*` token。每一切片獨立可驗：unit 斷言 token 與 class，`make verify` 守門，截圖做目視。

**Tech Stack:** Next.js 15 + React 19, `next/font/google` (Inter + Geist_Mono), Tailwind CSS v3, Base UI, vitest.

**Spec:** `docs/superpowers/specs/2026-09-30-linear-spec-a-design.md` — 決策編號（D1…D7）與章節（§）都指那份規格。

## Global Constraints

- 不新增 runtime 依賴（Geist_Mono 走既有 `next/font/google`）。
- Tailwind `fontSize/borderRadius/boxShadow/transitionDuration/transitionTimingFunction/padding/margin/gap/space/maxWidth` 維持 replace；本次新增 `fontWeight`（replace）與 `fontFamily`（replace），裸 `font-bold`/`font-[510]` 必須不編譯。
- 顏色只在 CSS 變數層（`globals.css`），component 不得寫 raw hex/rgba。
- Base UI 擁有互動行為；Tailwind + token 擁有外觀。
- 淺色主題值不動（Spec §5.4 例外除外）；`kh-page` 寬度不動；雙側欄不動。
- 每個 commit 至少 unit + typecheck + lint 綠；每個 task 結束 `make verify` 綠。
- 偏離 spec 先改 spec 再改程式（CLAUDE.md）。

---

### Task 1: A1 — 字體變數 + weight 階梯 + 全域 OpenType

**Files:**
- Modify: `src/app/fonts.ts`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/global-error.tsx`（若其掛字體 class，與 layout 對齊）
- Modify: `tailwind.config.ts`
- Modify: `src/app/globals.css`
- Test: `tests/unit/linear-spec-a-fonts.test.ts`（新增）

**Interfaces:**
- Consumes: 無（首任務）。
- Produces: `--kh-font-sans`/`--kh-font-mono` 變數、`font-medium`=510/`font-semibold`=590、`body` 全域 `cv01/ss03`。後續 Task 4 依賴 weight token 已生效。

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/linear-spec-a-fonts.test.ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("spec A1 font tokens", () => {
  it("exposes sans + mono variables from fonts.ts", () => {
    const src = fs.readFileSync("src/app/fonts.ts", "utf8");
    expect(src).toContain("--kh-font-sans");
    expect(src).toContain("--kh-font-mono");
    expect(src).toContain("Geist_Mono");
  });
  it("enables cv01/ss03 globally", () => {
    const css = fs.readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain('"cv01"');
    expect(css).toContain('"ss03"');
  });
  it("pins weight ladder to 400/510/590", () => {
    const cfg = fs.readFileSync("tailwind.config.ts", "utf8");
    expect(cfg).toContain("510");
    expect(cfg).toContain("590");
    expect(cfg).not.toContain("700");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/linear-spec-a-fonts.test.ts`
Expected: FAIL（`Geist_Mono`、`cv01`、`510` 皆缺）

- [ ] **Step 3: Write minimal implementation**

```ts
// src/app/fonts.ts
import { Inter, Geist_Mono } from "next/font/google";

// Inter 在 11–14px 撐住 dense UI；figures 逐處 tabular。
// global-error 取代 root layout，必須同字體。
export const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--kh-font-sans",
});

export const mono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--kh-font-mono",
});
```

```tsx
// src/app/layout.tsx（只改 html class 一行，其餘不動）
<html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
```

```ts
// tailwind.config.ts：在 theme 頂層新增（與 fontSize 同級，replace 語義）
fontFamily: {
  sans: ["var(--kh-font-sans)", "ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
  mono: ["var(--kh-font-mono)", "ui-monospace", "SF Mono", "Menlo", "monospace"],
},
fontWeight: {
  normal: "400",
  medium: "510",
  semibold: "590",
},
```

```css
/* src/app/globals.css：body 規則內加一行 */
body {
  font-feature-settings: "cv01", "ss03";
}
```

`global-error.tsx`：若其有 `className={inter.variable}`，改為與 layout 相同的雙變數串；若無掛字體，不動。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.ts tests/unit/linear-spec-a-fonts.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck + lint this task's files**

Run: `npx tsc --noEmit && npx eslint src/app/fonts.ts src/app/layout.tsx src/app/global-error.tsx tailwind.config.ts tests/unit/linear-spec-a-fonts.test.ts`
Expected: PASS（`font-bold` 若仍存在於 src 會是下一步的事，不在此擋）

- [ ] **Step 6: Commit**

```bash
git add src/app/fonts.ts src/app/layout.tsx src/app/global-error.tsx tailwind.config.ts src/app/globals.css tests/unit/linear-spec-a-fonts.test.ts
git commit -m "feat(spec-a): inter variable + geist mono + 510/590 ladder + cv01/ss03"
```

### Task 2: A1 — weight 呼叫點收斂（500→510、600→590）

**Files:**
- Modify: 所有 `font-medium`/`font-semibold` 呼叫點（語義不變，只換值；grep 盤點，估計 20–40 處）
- Modify: `src/components/ui/kbd.tsx`（family 換 mono，字級不動）

**Interfaces:**
- Consumes: Task 1 的 weight token。
- Produces: 全庫無 `font-bold`、`font-extrabold`、`font-[5xx]`、`font-[6xx]`；`Kbd` 用 mono。Task 4 依賴按鈕 weight 已為 510。

- [ ] **Step 1: 盤點（不改程式，只列清單）**

Run: `rg -n "font-(bold|extrabold|black)|font-\[5|font-\[6" src --no-heading`
Expected: 若有命中，逐條記入 commit message；`font-medium`/`font-semibold` 本身不需改（值已由 token 承載）。

- [ ] **Step 2: 消滅 700+ 與 arbitrary weight**

將上一步命中的每一處改為 `font-semibold`（強強調）或 `font-medium`（一般強調）；`font-[510]`/`font-[590]` 改為具名 token。`Kbd` 改為：

```tsx
<kbd className={`rounded-sm bg-kh-bg-subtle px-1 font-mono text-micro text-kh-text-faint ${className}`}>
```

- [ ] **Step 3: Verify**

Run: `rg -n "font-(bold|extrabold|black)|font-\[5|font-\[6" src --no-heading`
Expected: 無輸出。另跑：`npx vitest run --config vitest.config.ts tests/unit/linear-spec-a-fonts.test.ts tests/unit/ui-primitives.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(spec-a): converge weights to 510/590, kbd to mono"
```

### Task 3: A2 — 暗色下沉 + 半透明邊框（含對比守門）

**Files:**
- Modify: `src/app/globals.css`（`:root[data-theme="dark"]` 區塊）
- Test: 擴充 `tests/unit/linear-spec-a-fonts.test.ts`（或新增 `tests/unit/linear-spec-a-contrast.test.ts`）：斷言 dark `border` 為半透明白、canvas 為近黑、`border-strong` 三面 ≥3:1

**Interfaces:**
- Consumes: 無（獨立於 Task 1/2，可並行；但同 PR 內排在字體後以便截圖一次比對）。
- Produces: 近黑 dark ramp + 半透明白邊框。Task 5 截圖依賴本 task 已合併。

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/linear-spec-a-contrast.test.ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";

function darkBlock(): string {
  const css = fs.readFileSync("src/app/globals.css", "utf8");
  const start = css.indexOf(':root[data-theme="dark"]');
  return css.slice(start, css.indexOf("}", css.indexOf("--kh-shadow-modal", start)) + 1);
}

describe("spec A2 dark ramp + borders", () => {
  it("canvas is near-black", () => {
    expect(darkBlock()).toContain("--kh-bg: #08090a");
  });
  it("borders are translucent white, not solid", () => {
    const block = darkBlock();
    expect(block).toContain("rgba(255, 255, 255, 0.08)");
    expect(block).not.toContain("--kh-border: #");
  });
});
```

對比度 ≥3:1 的完整斷言（`border-strong` vs `bg`/`subtle`/`sunken`）比照 `tests/unit/syntax-colors.test.tsx` 的解析手法，在 Step 3 實作後補入本檔（先以 L\* 排序斷言：`border` 亮度 < `hover` 亮度，防 finding 18 反轉）。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/linear-spec-a-contrast.test.ts`
Expected: FAIL（現值 `#131417`、`#1e2127`）

- [ ] **Step 3: Write minimal implementation**

```css
:root[data-theme="dark"] {
  --kh-bg: #08090a;
  --kh-bg-raised: #0f1011;
  --kh-bg-sunken: #0b0c0e;
  --kh-bg-subtle: #191a1b;
  --kh-bg-hover: #1e2025;
  --kh-bg-hover-strong: #2b2e35;
  --kh-bg-selected: #23253d;
  --kh-border: rgba(255, 255, 255, 0.08);
  --kh-border-strong: rgba(255, 255, 255, 0.28); /* 起點，以對比腳本定稿 */
  /* text / primary / status / syntax / shadow 形狀不動，只隨 canvas 重對 alpha（見 spec §5.2） */
}
```

`--kh-border-strong` 定稿方法：用與 2026-09-20 audit 同款的 relative-luminance 腳本，對 `bg`/`subtle`/`sunken` 三面逐一驗 ≥3:1；若 `0.28` 任一面未過，以 `0.02` 步進上調至通過，步進數字記進驗證紀錄。以腳本輸出為準改值，不憑目視。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.ts tests/unit/linear-spec-a-contrast.test.ts`
Expected: PASS（若 `border-strong` 調過 alpha，同步更新本檔期望值）

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css tests/unit/linear-spec-a-contrast.test.ts
git commit -m "feat(spec-a): near-black dark ramp + translucent borders"
```

### Task 4: A3 — 按鈕 ghost token + press

**Files:**
- Modify: `src/app/globals.css`（新增 `--kh-ghost`/`--kh-ghost-hover`，亮暗各一組）
- Modify: `src/components/ui/button.tsx`
- Modify: `tests/unit/ui-primitives.test.tsx`（補 2 case，不另開檔）

**Interfaces:**
- Consumes: Task 1 的 weight token（按鈕 `font-medium` 即 510）。
- Produces: ghost/subtle 半透明材質 + 全 primitive press。Task 5 截圖依賴本 task。

- [ ] **Step 1: Write the failing test**

```tsx
it("gives ghost a translucent fill, not transparent", () => {
  expect(buttonClasses({ variant: "ghost" })).toContain("bg-kh-ghost");
  expect(buttonClasses({ variant: "ghost" })).not.toContain("bg-transparent");
});

it("presses with scale on every non-link variant", () => {
  for (const variant of ["primary", "secondary", "ghost", "danger"] as const) {
    expect(buttonClasses({ variant })).toContain("active:scale-[0.98]");
  }
});
```

先加入 `tests/unit/ui-primitives.test.tsx` 的 `buttonClasses` describe 內。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/ui-primitives.test.tsx`
Expected: FAIL（現值 `bg-transparent`，無 `active:scale`）

- [ ] **Step 3: Write minimal implementation**

```css
/* globals.css :root（light） */
--kh-ghost: rgba(23, 25, 32, 0.03);
--kh-ghost-hover: rgba(23, 25, 32, 0.06);
/* :root[data-theme="dark"] */
--kh-ghost: rgba(255, 255, 255, 0.02);
--kh-ghost-hover: rgba(255, 255, 255, 0.05);
```

```ts
// tailwind.config.ts extend.colors 新增（與 kh-bg 同層）
"kh-ghost": "var(--kh-ghost)",
"kh-ghost-hover": "var(--kh-ghost-hover)",
```

```ts
// button.tsx variantClasses
ghost: "border-transparent bg-kh-ghost text-kh-text-muted hover:bg-kh-ghost-hover hover:text-kh-text",
secondary: "border-kh-border bg-kh-ghost text-kh-text hover:bg-kh-ghost-hover",
```

```ts
// buttonClasses 基底串：transition-colors → transition-[background-color,transform]，加 active:scale-[0.98]
return `kh-focus-ring inline-flex shrink-0 items-center justify-center rounded-md border font-medium transition-[background-color,transform] duration-120 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ${shape} ${variantClasses[variant]} ${className}`;
```

`primary`/`danger`/`link` 語義不動。既有 finding-12 迴歸守門同檔補一案：

```tsx
it("has no shape overrides smuggled via className in src", () => {
  const src = fs.readFileSync("src/components/search/search-form.tsx", "utf8");
  expect(src).not.toMatch(/buttonClasses\([^)]*className[^)]*(h-|px-|py-|min-h-)/);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.ts tests/unit/ui-primitives.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css tailwind.config.ts src/components/ui/button.tsx tests/unit/ui-primitives.test.tsx
git commit -m "feat(spec-a): ghost tokens + button press"
```

### Task 5: Contract 修訂 + 全量驗證

**Files:**
- Modify: `docs/superpowers/specs/frontend-design-language.md`（§4/§6/§7/§9 四處，與 code 同 PR）
- Create: `docs/superpowers/verification/2026-09-30-linear-spec-a-verification.md`（新檔，一節記數字）

**Interfaces:**
- Consumes: Task 1–4 全部。
- Produces: 合約與實作一致；驗證紀錄含數字。本 task 無後續。

- [ ] **Step 1: Contract 四處修訂（與 code 同 PR，不另開）**

1. §4 表：`fontWeight` 新增 `medium 510 / semibold 590` 列；`fontFamily` 新增 mono 行。
2. §6：`secondary` 按鈕 border 從 `border-strong` 改 `border` 的 job 說明；`--kh-ghost` 用途一句。
3. §7：dark ramp 值更新 + sunken 內插標記；tint/divergence 段落改寫為 achromatic。
4. §9：全域 `cv01/ss03` 一句 + `font-bold` 不編譯一句。

- [ ] **Step 2: 全量驗證**

Run: `make verify`
Expected: PASS（unit + typecheck + lint + build）

Run: `rg -n "font-(bold|extrabold|black)|font-\[5|font-\[6|#ffffff.*text|bg-transparent.*ghost" src --no-heading`
Expected: 無輸出（weight 收斂、無純白正文、ghost 已換 token）

- [ ] **Step 3: 真機截圖比對（接真實 DB，亮/暗 × document / tree / ⌘K / sources）**

參照 2026-09-20 audit §6 方法：`make db-up` 後跑 dev，明暗各截四頁。斷言目視：無純白正文、無實色暗邊框、無 700 weight、`a` 為單層、`g` 幾何形、按鈕 hover 有 fill 變化、press 有縮放。數字（`border-strong` 定稿 alpha、步進次數）寫進驗證紀錄。

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/frontend-design-language.md docs/superpowers/verification/2026-09-30-linear-spec-a-verification.md
git commit -m "docs(spec-a): contract amendments + verification record"
```

## Self-Review

- Spec coverage: D1→Task 1（next/font 留任）；D2→Task 1（weight replace）；D3→Task 1（Geist_Mono）；D4→Task 3（三階值+sunken 內插）；D5→Task 3（半透明邊框+3:1 腳本）；D6→Task 4（ghost token）；D7→Task 4（primitive press）。§4.4/§5.3/§6.3 驗收各有 task；§7 contract 修訂為 Task 5；§9 總閘為 Task 5 Step 2–3。無缺口。
- Placeholder scan: 無 TBD/TODO/「適當處理」；每步含實際程式碼與指令；無「同 Task N」轉述。
- Type consistency: `buttonClasses` 簽名不變；`controlHeight` 不動；`font-medium` 語義不變（值換 token 承載）；`global-error` 只對齊 variable class，不改 props。
