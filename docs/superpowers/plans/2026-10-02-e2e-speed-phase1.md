# E2E Smoke 與覆蓋盤點 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供可實際執行的 Team／Personal smoke，保存每次執行的測試與階段結果，完成逐項覆蓋盤點，作為後續案例精簡與隔離的依據。

**Architecture:** 在現有案例加入 Playwright tags，沿用 PR #99 的模式與服務選擇。以獨立 reporter 產生測試結果 JSON，runner 另存階段計時；每次使用唯一 artifact 目錄。第一階段不改共享資料架構，不以 smoke 取代完整 CI gate。

**Tech Stack:** Node.js 24.19.0、TypeScript、Next.js 15.5.25、現有 Playwright／Vitest、MariaDB 10.11；不增加套件。

**Spec:** `docs/superpowers/specs/2026-10-02-e2e-speed-design.md`（已核准設計的 repository 副本）

## Global Constraints

- 保留真實瀏覽器、身份與授權邊界驗證；不跳過必要 production build。
- 不用固定 sleep、重試、降低斷言或增加 timeout 掩蓋失敗。
- 既有 `test:e2e` 與 CI 完整 gate 保留；worker 仍為 1。
- 無測試不能視為通過；passed／failed／flaky／skipped 分開計數。
- 不以減少測試總數為目標；刪除候選需有具體替代覆蓋。
- 使用目前 cloud 的隔離 checkout；不建立新 Git worktree。
- 不在 artifact 儲存 process environment、憑證、完整 HTTP headers 或 response bodies。
- 本計畫只交付設計第一階段。第二階段依覆蓋矩陣選定候選，第三階段依共享資料盤點決定隔離接口；各自另寫具體計畫，不能以模糊後續任務視為完成。

## Review Focus

1. Tag 拼錯或 grep 無匹配：discovery 必須失敗，不能建立綠色空報告。（Task 1、2）
2. Personal `.env` 混入 Team smoke：Team／Personal 使用 runner 已定義的明確模式。（Task 1）
3. 身份服務沒有啟動而測試被 skip：smoke 最終必須零 skipped，標記的 security cases 必須執行。（Task 1、2）
4. Build、測試或 cleanup 失敗：報告仍產生，原本失敗不能因成功寫檔被覆蓋。（Task 2）
5. 不同執行覆寫報告／CI 遺失成功結果：唯一 run directory，artifact 上傳使用 always。（Task 2、3）

---

### Task 1: 穩定的 smoke 選取

**Files:**
- Modify: `package.json`, `tests/e2e/phase2.5-routing.spec.ts`, `tests/e2e/document-composer.spec.ts`, `tests/e2e/phase3-identity-harness.spec.ts`, `tests/e2e/share-link.spec.ts`, `tests/e2e/personal-workspace.spec.ts`, `README.md`
- Create: `tests/unit/e2e-smoke-selection.test.ts`

**Interfaces:**
- Consumes: Playwright test details `{ tag: string | string[] }`、現有 `e2eTeamWorkspacesEnabled(environment)`、`requiredE2eServices(sources)`。
- Produces: `npm run test:e2e:smoke`、`npm run test:e2e:smoke:personal`；tags `@smoke-team`、`@smoke-personal`。
- Team script：`KM_E2E_SUITE=team-smoke tsx scripts/test/e2e.ts --grep @smoke-team`。
- Personal script：`KM_E2E_SUITE=personal-smoke KM_E2E_PERSONAL_ONLY=true tsx scripts/test/e2e.ts --grep @smoke-personal`。

- [ ] **Step 1: 新增 discovery 回歸測試。** 使用 Node child process 呼叫現有 Playwright CLI `test --list --reporter=json --grep <tag>`，停用 discovery 的所有 server flags，解析 JSON suites/test tags。這是讀取真實 catalog，不 mock 選取。
  - Team 精確選出下列 8 個案例；其餘同檔案案例不可因 describe tagging 被選進來。
  - Personal 精確選出 root routing＋personal-workspace 的 2 個案例，共 3 個。
  - 不存在的 `@smoke-missing` 必須 exit nonzero，或可被 runner 的零案例檢查拒絕。
  - 原本完整 discovery 的所有 test identities 不變（先記錄 catalog，在新增 tags 後比較）。

Team 標記清單：
1. `phase2.5-routing.spec.ts`: `root resolves deterministically into My Space`（兩種 tag）。
2. `document-composer.spec.ts`: `the rendered editor mounts without hydration or page errors`。
3. `document-composer.spec.ts`: `typing Markdown syntax writes a heading and a list, and Create saves it`。
4. `document-composer.spec.ts`: `⌘Enter saves from inside the rendered editor`。
5. `phase3-identity-harness.spec.ts`: `ordinary production entry cannot enable a fixture reader with environment variables`。
6. `phase3-identity-harness.spec.ts`: `server persona controls Team creation; browser claims cannot elevate a noncreator`。
7. `phase3-identity-harness.spec.ts`: `real grant changes propagate between independent fixed server sessions`。
8. `share-link.spec.ts`: `owner shares, an anonymous reader follows the edits, and revoking ends it`。

Personal 的兩個案例維持既有 title，兩者都加 `@smoke-personal`，不改既有 assertion。

- [ ] **Step 2: 執行 `npm run test:unit -- tests/unit/e2e-smoke-selection.test.ts`。** 先確認因 tags 尚未存在而失敗。
- [ ] **Step 3: 加入精確案例 tags、兩個 npm scripts 與 README。** `test:e2e` 不改為 grep；Personal 模式沿用 runner，不變更 product `.env`。
- [ ] **Step 4: 重跑 discovery 回歸測試。** 精確選取通過，完整 catalog 不變；再實際跑兩個 smoke，分別 8／3 個執行且零 skipped。
- [ ] **Step 5: 提交。** `git add package.json README.md tests/e2e tests/unit/e2e-smoke-selection.test.ts && git commit -m "test(e2e): add Team and personal smoke selections"`。只 stage 本 task 修改的檔案。

### Task 2: 持久化可比較的結果

**Files:**
- Create: `scripts/test/e2e-report.ts`, `scripts/test/e2e-json-reporter.ts`, `tests/unit/e2e-report.test.ts`
- Modify: `scripts/test/e2e.ts`, `playwright.config.ts`

**Interfaces:**
- `E2eStage = { name: string; durationMs: number; status: "passed" | "failed" }`。
- `E2eCounts = { passed: number; failed: number; flaky: number; skipped: number }`。
- `E2eRunReport = { version: 1; runId: string; suite: string; mode: "Team-enabled" | "personal-only"; startedAt: string; durationMs: number; status: "passed" | "failed" | "cancelled"; stages: E2eStage[]; counts: E2eCounts | null; error: string | null }`。
- `writeE2eRunReport(directory: string, report: E2eRunReport): Promise<void>`：寫 `runner.json`；不抄 process.env。
- Reporter 使用 Playwright `Reporter.onEnd` 與 suite catalog，寫 `tests.json`，只保存 file/title/status/duration/retry 及計數；不序列化 config、environment、附件 body、stdout／stderr。
- Runner 在每次開始產生 `playwright-report/e2e-runs/<suite>/<UUID>/`，透過 `KM_E2E_RUN_REPORT_DIR` 傳給 reporter。套件已有 ignored `playwright-report/`，不使用會被 Playwright 啟動時清理的 `test-results/` 放 runner 報告。
- `KM_E2E_SUITE` 未設定時為 `full`；個人模式未使用 smoke 指令則為 `personal`；suite label 限制安全字元，不允许目錄穿越。

- [ ] **Step 1: 新增報告測試。** 在 tmp directory 執行真實寫入並讀回 JSON，確認所有 outcome 計數分開、duration 單位為 ms、兩個 UUID run 不互相覆寫、沒有 environment 欄位。
  - 模擬 build 失敗：counts=null、failed stage、error 存在。
  - 模擬 browser 失敗與 cleanup 成功：仍為 failed。
  - 模擬原始失敗加 cleanup 失敗：兩者保留，不能用 cleanup 成功／失敗覆蓋原始結果。
  - 模擬 cancel：仍写 cancelled 報告。
  - 零 tests 與 smoke skipped：不能標成 passed。
  - 用真實 Playwright fixture run 的 reporter callbacks 验证 JSON count 與 exit status；fixture 放在 tmp，不能被正式 E2E catalog 收集。
- [ ] **Step 2: 執行 `npm run test:unit -- tests/unit/e2e-report.test.ts`，確認新接口未實作時失敗。**
- [ ] **Step 3: 實作 reporter、報告 writer 與 runner integration。** 現有分段 `timed` 追加 stage 資料；finally 在 cleanup 後寫報告，保留原始 error 和 nonzero exit。config 在正常執行保留 list reporter 並加新 reporter；discovery 的 JSON reporter 仍由既有 CLI 明確選定，不能混入文字。
- [ ] **Step 4: 重跑測試及 smoke。** runner 報告與 reporter 計數一致；失敗 fixture 仍 exit nonzero；成功 smoke 零 skipped。報告列出當次 artifact 路徑，檔案未進 Git。
- [ ] **Step 5: 提交。** `git add scripts/test/e2e.ts scripts/test/e2e-report.ts scripts/test/e2e-json-reporter.ts playwright.config.ts tests/unit/e2e-report.test.ts && git commit -m "test(e2e): persist run timings and outcomes"`。

### Task 3: 可審查的覆蓋矩陣與 CI artifacts

**Files:**
- Create: `docs/superpowers/verification/2026-10-02-e2e-coverage-matrix.md`
- Modify: `.github/workflows/phase2-dev-gate.yml`, `README.md`

**Interfaces:**
- 每列：E2E file／精確 case title、受測行為、unit／integration 的 file／case、瀏覽器專屬 assertion、判定（保留／移層候選／僅加速準備）、會使替代測試失敗的缺陷、必要補測。
- CI 保留既有完整 `npm run test:e2e`，只將 artifact 上傳改成 `if: always()`，包含 `test-results/` 和 `playwright-report/e2e-runs/`；沒有 result 時不偽裝通過。

- [ ] **Step 1: 逐項讀取首批候選。** `document-composer.spec.ts` 的標題／保存／Markdown 轉換案例，對照 `authored-title.test.ts`、`composer-output.test.ts`、`markdown-editor.test.ts`；`zz-organize.spec.ts` 對照 `organize-api.test.ts`、`organize-messages.test.ts`。有 UI assertion 的案例不能判為純重複。
- [ ] **Step 2: 寫矩陣。** 每個 proposed deletion 都必须有精確替代 assertion；無候選達標就記錄「本批沒有可直接刪除案例」，不能勉強刪減。至少列出 H1／frontmatter、非空 folder archive、archive Undo、rename／移動 refusal 的區別。
- [ ] **Step 3: 更新 CI artifact upload 與 README。** 確認 CI 仍執行完整 gate，不把「上傳成功」當成「測試成功」。
- [ ] **Step 4: 執行 `npm run test:unit && npm run typecheck && npm run lint`，检查 diff。** 矩陣為證據盤點，沒有 E2E deletion；package-lock 不受純 script 修改影響。
- [ ] **Step 5: 提交。** `git add docs/superpowers/verification/2026-10-02-e2e-coverage-matrix.md .github/workflows/phase2-dev-gate.yml README.md && git commit -m "docs(e2e): map coverage and retain CI run artifacts"`。

### Task 4: 完整驗證、效能比較與下一階段接口

**Files:**
- Create: `docs/superpowers/verification/2026-10-02-e2e-smoke.md`

**Interfaces:**
- 消費 Tasks 1–3 的命令與 artifacts，輸出可追溯的測量結果與下一階段具體候選。

- [ ] **Step 1: 取得當前完整 baseline。** 現有歷史 454.82 秒僅作参考；執行一次完整模式，保留 stage/results JSON。記錄當前 SHA、Node／Playwright、CPU、冷／暖 build；不得並行跑另一份 build 覆寫 `.next`。
- [ ] **Step 2: 順序執行 `npm run test:e2e:smoke` 與 `npm run test:e2e:smoke:personal`。** 各跑兩次，保留個別 timing，不預設加速百分比。
- [ ] **Step 3: 檢查 outcomes。** Full 預期沿用當前集合與既有模式 skips；Team smoke 8、Personal smoke 3，皆零 failed／flaky／skipped。新增 tests 以當前 catalog identities 為準，不能只比總數。
- [ ] **Step 4: 寫驗證紀錄並請獨立 reviewer 審查。** 回答日常 smoke 省了多少、build 是否主導 smoke、哪些 spec 耗時最高、哪些值得改 API setup。报告慢不代表案例可刪除。
- [ ] **Step 5: 寫出下一階段的輸入清單。** 以覆蓋矩陣選定可改 API 準備的 case；以共享 My Space／graph／fixed identity 的具體 references 決定 spec isolation 或獨立 job shards。第二／三階段另寫實作計畫，不在本階段直接提高 workers。
- [ ] **Step 6: 提交驗證紀錄。** `git add docs/superpowers/verification/2026-10-02-e2e-smoke.md && git commit -m "docs(e2e): record smoke and full regression measurements"`。

## Self-review

本計畫涵蓋已核准設計第一階段；後續移層、API setup、資料隔離與並行保留為依盤點結果制定的後續計畫，不算已交付。沒有預先刪除含 UI 行為的案例，沒有降低完整 CI gate。Smoke 清單精確、結果格式及目錄明確，五項 Review Focus 都有對應測試與驗證。
