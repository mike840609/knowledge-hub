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

## 目前範圍

應用目前提供個人工作空間（Home、Inbox（視窗夠寬時選取討論在列表旁）、草稿、收藏、最近文件）、folder 匯入與同步、搜尋與 command palette、wikilinks 與反向連結、知識圖譜、渲染編輯與 Markdown 原始碼編輯、版本歷史、分享與討論、已儲存的分享、匯出、Copy for Agent，以及需開啟的 Team workspace 介面。

已知限制列於 [README](../../README.zh-TW.md#目前限制與未來方向)。特別是附件只存 metadata、搜尋以關鍵字為主、Team workspace 仍需開啟，且討論寫入由 `KM_REVIEW_WRITES_ENABLED` 另外控制。
