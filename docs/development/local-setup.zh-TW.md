# 本機設定與驗證

[English](local-setup.md) | **繁體中文**

Knowledge Hub 使用 Node.js `>=20.19.0 <25`、npm、Docker 與 MariaDB 10.11 Compose 服務。Repository 在 [`.node-version`](../../.node-version) 固定 Node.js `24.19.0`。

## 啟動本機環境

最快的方式是：

```sh
make bootstrap
make dev
```

`make bootstrap` 會安裝依賴、必要時從 `.env.example` 建立 `.env`、啟動 MariaDB、執行 migration 並載入開發 fixtures。`make dev` 會在 `http://127.0.0.1:3000/` 啟動應用。

不使用 `make` 時：

```sh
cp .env.example .env
npm ci
docker compose up -d --wait mariadb
npm run db:migrate
npm run db:seed
npm run dev
```

Compose 服務只對 `127.0.0.1:3307` 開放。開發資料庫為 `hcm_km_dev`；範例憑證僅供本機開發，不得作為正式環境憑證。

## 本機身分與 fixtures

只有設定 `KM_LOCAL_IDENTITY_ENABLED=true` 才會啟用本機身分，身分取自四個 `KM_LOCAL_*` 變數。它是伺服器設定，不是登入表單，因此瀏覽器無法選擇其他人。

第一次請求時，本機使用者會取得個人工作空間 **My Space**，內含預設的 **Notes** source。Seed 另外建立 **Local Knowledge** workspace，內有 `Local Hub` HUB_MANAGED source 與 `Getting Started` 資料夾。知識存取依 Workspace membership 檢查；`org_code` 是身分屬性，本身不授予存取權。

若要在本機試第二個人，請在另一個終端機執行 `make dev-reviewer`。它會以 **Local Reviewer** 身分在 port 3001 啟動同一個應用，連到同一個資料庫。分享與討論流程見[在本機試兩個人的流程](two-person-demo.zh-TW.md)。

匯入頁的 **Try with a sample wiki** 會透過一般的 Preview → Apply 流程匯入內附的英文或繁體中文範例。這是在全新工作空間快速建立互連文件的方式。

## 檢查

```sh
make verify
make test-integration
make browsers
npm run test:e2e:smoke
npm run test:e2e:smoke:personal
```

`make verify` 執行 unit tests、TypeScript、lint 與 production build。`make test-integration` 建立名為 `hcm_km_test_*` 的資料庫、執行 migration 與實際 MariaDB 整合測試，最後只刪除自己建立的資料庫。`make test-e2e` 使用 `hcm_km_e2e_*` 執行相同隔離流程，建置 production server、在隔離的本機 port 啟動、執行 Chromium，然後移除測試資料庫。兩者皆不沿用開發資料庫。

完整 E2E 預設開啟 Team；另以個人模式檢查預設 rollout：

```sh
npm run test:e2e
KM_E2E_PERSONAL_ONLY=true npm run test:e2e -- personal-workspace.spec.ts
```

其他維護檢查：

```sh
make guide-screenshots
make test-mermaid-assumptions
```

`make guide-screenshots` 會從全新帳號與 sample wiki 重新產生站內使用者手冊的已提交圖片。`make test-mermaid-assumptions` 會在 Chromium 檢查 reader 對 Mermaid 的假設；變更 Mermaid 版本前後都要執行。

Migration runner 只向前執行。失敗或未知的 ledger row 是硬性錯誤；調查已記錄的診斷後，重建可拋棄資料庫或明確修復該 migration。

測試 runner 自行管理測試模式與所需伺服器，不沿用 `.env` 的 Team 預設值。報告輸出至 `playwright-report/e2e-runs/<suite>/<UUID>/` 與 `test-results/`，不提交至 Git。會產生比較截圖的 spec 也會寫到 `test-results/ui-comparisons/`；`docs/ui-comparisons/` 下已追蹤的 before／after 證據只在 `KM_UPDATE_UI_COMPARISONS=1` 時重寫。覆蓋範圍見 [E2E coverage matrix](../../docs/superpowers/verification/2026-10-02-e2e-coverage-matrix.md)。

## Make 指令

| 指令 | 用途 |
| --- | --- |
| `make dev` | 啟動本機開發伺服器 |
| `make dev-reviewer` | 以另一個本機使用者在 port 3001 啟動第二台伺服器，用來試[兩個人的流程](two-person-demo.zh-TW.md) |
| `make build`／`make start` | 建置／執行 production build（需身分整合） |
| `make db-up`／`make db-down`／`make db-logs` | 啟動、停止與查看資料庫 logs；`db-down` 保留 volume |
| `make db-migrate`／`make db-seed` | 更新 schema／載入開發 fixtures |
| `make db-reindex-links` | 回填或修復衍生文件連結索引 |
| `make test-unit` | 不需資料庫的單元測試 |
| `make test-integration` | 資料庫整合測試；runner 建立與清除隔離資料庫 |
| `make browsers` | 首次安裝 E2E 使用的 Chromium |
| `make test-e2e` | 建立隔離資料庫、production build 並執行瀏覽器測試 |
| `make guide-screenshots` | 從 sample wiki 重新產生站內手冊截圖 |
| `make test-mermaid-assumptions` | 在 Chromium 檢查 reader 對 Mermaid 的假設；變更版本前後都要跑 |
| `make verify` | Unit tests、TypeScript、lint 與 build |
| `make help` | 完整 make 指令列表 |

## 目前範圍

應用目前提供個人工作空間（Home、Inbox（視窗夠寬時選取討論在列表旁）、草稿、收藏、最近文件）、folder 匯入與同步、搜尋與 command palette、wikilinks 與反向連結、知識圖譜、渲染編輯與 Markdown 原始碼編輯、版本歷史、分享與討論、已儲存的分享、匯出、Copy for Agent，以及需開啟的 Team workspace 介面。

已知限制列於 [README](../../README.zh-TW.md#目前限制與未來方向)。特別是附件只存 metadata、搜尋以關鍵字為主、Team workspace 仍需開啟，且討論寫入由 `KM_REVIEW_WRITES_ENABLED` 另外控制。
