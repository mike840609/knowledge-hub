# Vercel + Layerbase 部署

[English](vercel-layerbase.md) | **繁體中文**

這是單人操作的部署路徑：應用程式跑在 Vercel，資料庫使用
[Layerbase](https://layerbase.com) MariaDB 10.11，身分仍是伺服器設定的單一 local user。這不是多人或公司 SSO 部署；那部分請看主要 README。

Preview deployment 由 `scripts/vercel-ignore.mjs` 關閉：它們沒有資料庫憑證，若部署成功也會在每個頁面失敗。

## 1. 建立資料庫

1. 登入 <https://layerbase.com>，建立 **MariaDB 10.11** 資料庫（免費方案即可）。
   Layerbase 的共享方案**沒有 region 可選**：資料庫固定放在美國東岸 Ashburn, Virginia。只有 dedicated server 能選地區，而且只有美國或巴西。專案的 `vercel.json` 使用 `iad1`，讓 function 緊鄰資料庫；不要改成離 US East 很遠的 region。
2. 打開資料庫的 **Connect** 對話框，複製兩種連線字串：
   - **Pooled** — 執行時使用（`KM_DB_URL`）。
   - **Direct** — 把 Pooled 關掉（`KM_DB_MIGRATE_URL`，也是 probe 的備援）。
3. 必須使用 TLS。兩個字串都是 `mysql://...`；應用程式預設會驗證憑證。

免費方案的限制：5 GB 儲存、20 條並行連線，且閒置時會休眠。休眠後第一次連線可能需要約 30 秒喚醒。付費方案提供 always-on pool 與更多連線。

## 2. 建立並連結 Vercel project

```sh
vercel login
vercel link          # 或在 Vercel dashboard 匯入 mike840609/knowledge-hub
```

- Framework preset：**Next.js**。Root directory：repository 根目錄。Production branch：`main`。
- Project → Settings → General → **Node.js Version**：選 **22.x** 或 **24.x**。`package.json` 的 `engines.node` 維持 `>=20.19.0 <25`，由平台設定決定實際版本。
- Preview deployment 由 `vercel.json` 的 `ignoreCommand` 跳過；不需要 preview 環境變數。

## 3. 設定 Production 環境變數

使用 Vercel dashboard（Project → Settings → Environment Variables）或
`vercel env add <NAME> production`。全部只設在 **Production** scope。

執行時：

| 變數 | 值 |
| --- | --- |
| `KM_DB_URL` | Layerbase **pooled** URL（若第 4 步判定需要，才改用 direct） |
| `KM_DB_SSL` | `verify` |
| `KM_DB_POOL_SIZE` | `2` |
| `KM_DB_CONNECT_TIMEOUT_MS` | `30000` |
| `KM_DB_ACQUIRE_TIMEOUT_MS` | `35000` |
| `KM_IMPORT_MAX_UPLOAD_BATCH_BYTES` | `4194304` |
| `KM_IMPORT_MAX_MARKDOWN_FILE_BYTES` | `3670016` |
| `KM_IDENTITY_PROVIDER` | `local` |
| `KM_LOCAL_IDENTITY_ENABLED` | `true` |
| `KM_ALLOW_LOCAL_IDENTITY_IN_PRODUCTION` | `true` — 僅限單人操作；切勿用於共用部署 |
| `KM_LOCAL_ID` / `KM_LOCAL_EMP_ID` / `KM_LOCAL_NAME` / `KM_LOCAL_ORG_CODE` | 與本機 `.env` 相同的值 |
| `KM_TEAM_WORKSPACES_ENABLED` | `false` |
| `KM_REVIEW_WRITES_ENABLED` | `true`（需要 `KM_PUBLIC_ORIGIN`） |
| `KM_PUBLIC_ORIGIN` | `https://<正式網域>` |
| `KM_SITE_PASSWORD` | 選用；公開網址強烈建議設定。Edge middleware 在 build time 讀取：設定後要重新部署，並確認 `/` 回 401。 |

Build-only：

| 變數 | 值 |
| --- | --- |
| `KM_DB_MIGRATE_URL` | Layerbase **direct** URL |
| `KM_MIGRATE_ON_BUILD` | 選用；設 `0` 可跳過 migration |

站台密碼不是登入系統。設定後，除了 `/s/*`、`/api/share-review/*`、`/api/health` 之外，所有頁面與 API 都需要密碼；分享連結對收件者仍可公開開啟。

## 4. 先驗證連線，再信任 pooler

```sh
KM_DB_URL="<pooled URL>" npm run db:probe
```

每一行都必須是 `PASS`：server 版本、`READ-COMMITTED`、`+00:00`、`GET_LOCK` 取得、lock holder 是同一個連線、release，以及新連線仍有相同 session 值。

若任何 session 檢查失敗，代表 Layerbase pooler 沒有保留 session state。把執行時的 `KM_DB_URL` 改成 **direct** URL（不用改程式），並記錄原因。`KM_DB_MIGRATE_URL` 一律保持 direct。

## 5. 選擇資料路徑

### 全新資料庫

```sh
KM_DB_URL="<direct URL>" npm run db:migrate
KM_DB_URL="<direct URL>" npm run db:seed
```

seed 是 idempotent，會建立 local user、personal workspace、示範 fixtures 與 Getting Started tree。

### 複製本機資料庫

兩邊都是 MariaDB 10.11，dump 可直接還原。只有在**本機資料庫的 migration 版本與要部署的 commit 相同**時才複製資料：dump 會帶 `schema_migrations`，migration runner 會拒絕未知版本或 checksum 不符。

```sh
docker compose up -d --wait
docker compose exec -T mariadb mysqldump -uroot -phcm_km_root \
  --single-transaction --routines --triggers hcm_km_dev > "${TMPDIR:-/tmp}/km-local.sql"

mysql --ssl-mode=REQUIRED -h <host> -P <port> -u <user> -p <database> < "${TMPDIR:-/tmp}/km-local.sql"
```

dump 請放在 repository 之外：它包含整份本機知識庫；`.vercelignore` 與 `.gitignore` 也已排除 `*.sql` 作為第二道防線。dump 後不要再跑 `db:seed`。Vercel 的 `KM_LOCAL_*` 要與 dump 中的使用者相同，否則 workspace membership 會指向不同使用者。

## 6. 部署

```sh
vercel --prod
```

或 push `main`（若已接上 GitHub integration）。Build log 應該先出現 `next build`，再出現 `applying database migrations`。migration 失敗會讓部署失敗，前一個部署會繼續服務。因此 migration 應保持 expand-only。

## 7. Smoke tests

```sh
curl -fsS https://<domain>/api/health      # {"ok":true}
```

接著在瀏覽器：

1. 開 `/`，進入 My Space。
2. 建立文件、編輯、儲存。
3. 在無痕視窗開分享連結；**不應該**要求站台密碼。
4. 從分享頁送出 review reply（需要 `KM_PUBLIC_ORIGIN`）。
5. 匯入一個小資料夾（遠低於 4 MiB）。
6. 資料庫閒置後再請求 `/api/health`；第一次可能花約 30 秒。先 503、重試後成功是正常的冷啟動形狀。

## 8. 疑難排解

| 症狀 | 原因 / 處理 |
| --- | --- |
| 所有請求 503 / timeout | 免費資料庫正在喚醒。重試；升級到 always-on 方案可消除。 |
| `no more connections allowed` | 方案的連線上限到了。把 `KM_DB_POOL_SIZE` 降到 1，或升級方案。 |
| TLS 驗證錯誤 | 確認 host。只有在確認端點無法提供公開憑證時才用 `KM_DB_SSL=trust`。 |
| Migration ledger `FAILED` | migration 中斷。明確修復 schema，只清掉該筆 ledger row；切勿修改 checksum。 |
| 資料夾匯入 413 | 請求超過 4.5 MB。每個 Markdown 檔要小於 `KM_IMPORT_MAX_MARKDOWN_FILE_BYTES`（此範本為 3,670,016 bytes）；client 會在上傳前擋下。若 manifest 本身過大，調低 `KM_IMPORT_MAX_MANIFEST_ENTRIES`。 |
| 匯出或超大文件失敗 | Vercel 回應上限 4.5 MB；匯出目前是 buffered。未來可改成 streaming。 |
| Preview deployment 顯示 skipped | 正常。只有 production build 會執行。 |

Vercel Hobby 方案僅限非商業用途。此部署為個人使用；商業用途請升級方案。
