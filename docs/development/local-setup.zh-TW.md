# 本機設定與驗證

[English](local-setup.md) | **繁體中文**

Phase 0 使用 Node.js `>=20.19.0 <25`、npm、Docker 與 MariaDB 10.11 Compose 服務。驗證時的 runtime 是 Node.js `v24.19.0`；資料庫回報 MariaDB `10.11.19-MariaDB`。

## 啟動本機環境

```sh
cp .env.example .env
npm ci
docker compose up -d --wait
npm run db:migrate
npm run db:seed
npm run dev
```

Compose 服務只對 `127.0.0.1:3307` 開放。開發資料庫為 `hcm_km_dev`；範例憑證僅供本機開發，不得作為正式環境憑證。只有設定 `KM_LOCAL_IDENTITY_ENABLED=true` 才會啟用本機身分，身分取自四個 `KM_LOCAL_*` 變數，不能以表單欄位取代。

Seed 會建立 `Local Knowledge` Workspace、設定的本機使用者之 membership、HUB_MANAGED source，以及 `Getting Started` 資料夾。知識存取依 Workspace membership 檢查；`org_code` 是身分屬性，本身不授予存取權。

## 檢查

```sh
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
```

`test:integration` 建立名為 `hcm_km_test_*` 的資料庫、執行 migration 與實際 MariaDB 整合測試，最後只刪除自己建立的資料庫。`test:e2e` 使用 `hcm_km_e2e_*` 執行相同隔離流程，建置 production server、在隔離的本機 port 啟動、執行 Chromium，然後移除測試資料庫。兩者皆不沿用開發資料庫。整合測試涵蓋跨組織 Workspace 成員、同組織非成員、直接 resource UUID 檢查、雙連線版本競態與 rollback。

Migration runner 只向前執行。失敗或未知的 ledger row 是硬性錯誤；調查已記錄的診斷後，重建可拋棄資料庫或明確修復該 migration。

## 範圍

Phase 0 提供 Workspace／Membership 存取基礎、穩定的 Document／Revision／Tree core、Local Identity、SourceEntry version guard、僅 metadata 的 assets，以及最小的 Workspace → Source → Tree Web flow。資料夾掃描、Preview／Confirm／Apply UI、企業 SSO 與正式治理、publishing、搜尋、MCP、embeddings、memory、binary storage 與 hard delete 屬於後續階段。
