# Phase 5 Human Authoring — Verification

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-17 |
| Spec | `docs/superpowers/specs/2026-09-16-phase-5-human-authoring-design.md` |
| Plan | `docs/superpowers/plans/2026-09-16-phase-5-human-authoring.md` |
| 受測分支 | `feat/phase-5-human-authoring`，worktree `km-wt-1`，HEAD `bcfe9610fb8e99eeba9b3a9413aa4c9ccc0b0bc2` |
| 執行環境 | macOS 26.6.2、Node v24.6.0、npm 11.5.1、Playwright 1.63.0（Chromium 已安裝）、MariaDB 10.11.19（Docker `hcm-km-phase0-mariadb-1`，image `mariadb:10.11`） |

全部六個 gate 在**同一個 HEAD**（`bcfe961`）重新執行，非沿用先前任務報告的數字。原始輸出見
`.superpowers/sdd/2026-09-16-phase-5-human-authoring/task-10-report.md`。

環境雜訊：此 shell 的 bare `npm` 被 nvm 的 shell function 遮蔽，非互動環境下會回
`command not found: _nvm_load`，因此所有指令改用絕對路徑
`/Users/chuntsai/.nvm/versions/node/v24.6.0/bin/npm`。每個指令的結果都直接寫入各自的 log 檔並立刻讀出
`$?`，未經過任何會吞掉 exit code 的管線。

## 指令與結果

| 指令 | 結果 |
| --- | --- |
| `npm run test:unit` | PASS — 36 檔／**256 測試**，exit 0，Duration 1.58s |
| `npm run typecheck` | PASS — exit 0，無輸出（`tsc --noEmit` 零錯誤） |
| `npm run lint` | PASS — exit 0，`eslint .` 零錯誤零警告 |
| `npm run build` | PASS — exit 0，`next build` 成功產生 32 條路由，無警告 |
| `make db-up` | MariaDB 容器 Healthy |
| `npm run test:integration` | PASS — 38 檔／**376 測試**，exit 0，Duration 42.03s |
| `npm run test:e2e`（完整未過濾） | PASS — **46 passed／0 failed**，exit 0，29.0s |

執行前確認 `scripts/test/e2e.ts` 以 `node_modules/@playwright/test/cli.js test ...process.argv.slice(2)`
呼叫 Playwright；`npm run test:e2e` 未帶任何額外參數，因此上表 46 案例即
`tests/e2e/*.spec.ts` 的完整套件，沒有任何過濾或跳過。

**與預期數字比對**：unit 256/256、integration 376/376、e2e 46/46、typecheck／lint／build 皆 exit 0 —
六個 gate 的實測數字與預期完全一致，沒有需要追查的落差。

## 需求對應

### 單元測試（U1–U5，不需 DB）

| # | 需求來源 | 測試檔 | 案例 | 結果 |
| --- | --- | --- | --- | --- |
| U1 | §8.1 | `tests/unit/phase5-can-write.test.ts` | `canWrite derivation (spec §8.1)` › `is true for roles holding document.write`、`is false for VIEWER` | PASS |
| U2 | §6.1、§6.2 | `tests/unit/phase5-authoring-input.test.ts` | `rejects giving both title and filename`、`rejects giving neither`、`rejects a non-object body and non-string fields`；`parseUpdateDocumentInput` › `requires all three fields` | PASS |
| U3 | §6.2 | `tests/unit/phase5-authoring-input.test.ts` | `resolves the title from frontmatter when a filename is given`、`falls back to the first H1, then to the filename stem` | PASS |
| U4 | §7.2 | `tests/unit/phase5-error-mapping.test.ts` | `maps a stale-editor conflict to 409, never 500`、`maps a write against SOURCE_MANAGED content to 409`、`maps archived source and document to 409`、`maps candidate validation failures to 400`、`maps missing document and source to a non-enumerating 404` | PASS（**缺口**見下） |
| U5 | §6.4 | `tests/unit/phase5-authoring-input.test.ts` | `rejects an over-long title and an over-large markdown body` | PASS |

### 整合測試（I1–I10，需 DB）

| # | 需求來源 | 測試檔 | 案例 | 結果 |
| --- | --- | --- | --- | --- |
| I1 | §5.1 | `tests/integration/phase5-default-hub-source.test.ts` | `creates a Notes source on first use` | PASS |
| I2 | §5.3 | `tests/integration/phase5-default-hub-source.test.ts` | `is idempotent: a second call reuses the same source`、`creates exactly one source under concurrent first writes` | PASS |
| I3 | §4 | `tests/integration/phase5-authoring-service.test.ts` | `creates revision 1 in the lazily provisioned source`、`creates revision 2 on edit and leaves revision 1 untouched` | PASS |
| I4 | §4 | `tests/integration/phase5-authoring-service.test.ts` | `does not create a revision when the content is unchanged` | PASS |
| I5 | §4 | `tests/integration/phase5-authoring-service.test.ts` | `rejects a stale editor and keeps the winner's content` | PASS |
| I6 | §7.1 | `tests/integration/phase5-authoring-service.test.ts` | `refuses a VIEWER on both create and edit` | PASS |
| I7 | §4 | `tests/integration/phase5-authoring-service.test.ts` | `refuses edits to SOURCE_MANAGED content` | PASS |
| I8 | §6.3 | `tests/integration/phase5-authoring-service.test.ts` | `preserves existing metadata across an edit` | PASS |
| I9 | §5.4 | 無獨立整合案例——見下方「已知偏離」 | — | 由 I1–I8 的共用路徑涵蓋 |
| I10 | §6.2 | 移至單元層——見下方「已知偏離」，對應 U3 | — | 由 U3 涵蓋 |

`tests/integration/phase5-default-hub-source.test.ts` 另有 `refuses a caller without document.write`
一案（4 測試中的第 4 個），是 I6（§7.1 VIEWER 被拒）在 provisioning 層的對應覆蓋，非 spec §9.2 編號項目，
但同屬 §7.1 要求。

### E2E（E1–E4）

| # | 測試 | 實際案例（`tests/e2e/phase5-authoring.spec.ts`） | 結果 |
| --- | --- | --- | --- |
| E1 | 建立新文件 → 出現在 Tree → 內容正確 | `creates the first document in a workspace with no sources` | PASS |
| E2 | 編輯既有 HUB_MANAGED 文件 → 版本歷史出現兩版 | `edits a hub-managed document and records a second revision` | PASS |
| E3 | SOURCE_MANAGED 文件看不到 Edit，顯示 Read only | `never shows Edit on source-managed content` | PASS |
| E4 | 上傳 `.md` → title 取自 frontmatter | `uploads a markdown file and takes its title from frontmatter` | PASS |

### Fixture（§9.4）

E2E 需要的「完全沒有 Hub Source 的 Workspace」由 `seedBrowserFixtures` 中獨立的 `unitOfWork.run` 區塊建立，
寫在既有「是否為全新資料庫」空表判斷之後（吸取 Phase 4 verification 記錄的教訓）；`test:e2e` 全綠代表這條
fixture 排序在本次執行中正確運作，未重現 Phase 4 曾出現的 fixture 排序 bug。

### 驗收條件（§10）

| 條件 | 對應 | 狀態 |
| --- | --- | --- |
| 建立與編輯都產生 immutable Revision，內容未變不產生新版本 | I3、I4 | PASS |
| 兩人同時編輯，後送出者得到 409 且不覆蓋對方內容 | I5 | PASS |
| VIEWER 與 SOURCE_MANAGED 的寫入一律被拒，UI 上也沒有入口 | I6、I7、E3 | PASS |
| 既有 metadata 不因編輯而遺失 | I8 | PASS |
| 單篇 upload 的 title 解析與 folder import 一致 | I10（U3）、E4 | PASS |
| §9 所有測試案例通過 | 上表全部 | PASS |
| `make verify`、`npm run test:integration`、`npm run test:e2e` 三個 gate 全綠 | 見「指令與結果」 | PASS（本記錄以 `test:unit`／`typecheck`／`lint`／`build` 四個獨立指令取代 `make verify` 逐一重跑，結果等價） |

## 已知偏離（刻意）

- **Authoring UI 元件沒有單元測試**：`document-editor.tsx`、`new-document-form.tsx`，以及
  header／page 的改動皆無 component-level 單元測試。`vitest.config.ts` 設定
  `environment: "node"`，本 repo 未安裝 jsdom，而 spec 的 Global Constraints 禁止新增依賴，因此元件渲染
  無法在單元層測試。其行為改由 `tests/e2e/phase5-authoring.spec.ts` 涵蓋。
- **允許建立空白 markdown 內容的文件**：只填 title 的建立流程會送出 `{ title, markdown: "" }`，這是刻意
  允許的行為，非缺陷。
- **兩個既有 E2E spec 因 Phase 5 刻意改變行為而更新**：
  - `phase2.5-knowledge-explorer.spec.ts` 原本預期「Read only」badge 一律顯示；commit `d88f95d` 讓它改為
    依 ownership 條件顯示（之前即使文件可編輯也會誤顯示，該次修改是讓它變得誠實）。
  - `phase3-workspace-governance.spec.ts` 原本預期空狀態下沒有 file input；commit `318f177` 刻意新增了
    upload 控制項。
  兩者皆已確認是過時的呈現層期望，不是授權邊界的回歸；governance suite 中真正檢查授權邊界的斷言未被
  改動。
- **I9（My Space 可建立與編輯）沒有獨立整合案例**：`assertPersonalMutationAllowed`
  （`src/modules/workspaces/application/personal-workspace-service.ts:38`）對 `content-write` 直接
  return，與 Team workspace 走完全相同的路徑，`tests/integration/phase5-authoring-service.test.ts` 的既有
  案例已涵蓋該共用路徑。
- **I10（單篇 upload 的三種 title 來源）在單元層而非整合層**：title resolution
  （`resolveImportTitle`）是純函式，打 DB 測試不會增加任何覆蓋，因此放在
  `tests/unit/phase5-authoring-input.test.ts`（對應 U3）。E2E 另有一個 frontmatter 案例
  （`tests/e2e/phase5-authoring.spec.ts` 的 `uploads a markdown file and takes its title from frontmatter`）。

## 已知缺口（未阻塞，仍應記錄）

- `tests/unit/phase5-error-mapping.test.ts` 沒有明確以 `InvalidMetadataError` 具名斷言 400；目前只靠
  `INVALID_TITLE` 與 `INVALID_METADATA` 共用同一份狀態碼清單（`src/server/http-error-response.ts`）
  間接覆蓋，未被單獨案例鎖住。
- `src/server/http-error-response.ts` 的 doc comment 對兩個 not-found 清單引用的行號已過時。
- `src/modules/sources/application/ensure-default-hub-source.ts` 以
  `listByWorkspaceId` 整表掃描再於記憶體中過濾——若某 Workspace 累積大量 Source，每次 authoring 呼叫都是
  O(n)；與 spec 的「不做 migration」立場一致，非本次新增缺陷。
- `tests/unit/phase5-update-route.test.ts` 的 400 案例只斷言狀態碼，未如其對應的
  `tests/unit/phase5-create-route.test.ts` 案例一併斷言 `body.error.code`。
- `src/app/api/documents/[documentId]/route.ts` 對 `canonicalizeJsonObject` 包住已存 metadata 的原因沒有
  行內註解（已確認這是型別窄化、可證明冪等的 no-op，非邏輯缺陷）。
- `DocumentHeader` 的 `editHref` 是必填 prop，沒有預設值。
- `new-document-form.tsx`：`busy` 狀態是在 `create()` 內部、`await file.text()` 之後才設置，理論上在這段
  await 期間快速重選第二個檔案可能觸發並行的建立呼叫；Cancel 只清除 `open` 不清除 `title`；按鈕文字寫
  「Upload .md」但 `accept` 同時允許 `.md` 與 `.markdown`。
- 測試輸出中持續出現一則與本分支無關的既有警告：`The CJS build of Vite's Node API is deprecated`。

## 修改的檔案

本次驗收記錄產出當下的變更：

- `docs/superpowers/verification/2026-09-16-phase-5-human-authoring-verification.md`：本驗收記錄（新增）。
- `.superpowers/sdd/2026-09-16-phase-5-human-authoring/task-10-report.md`：本次六個 gate 的原始輸出（新增，任務產出物，非驗收記錄本體）。

未變更任何原始碼、測試、或 spec 檔案。
