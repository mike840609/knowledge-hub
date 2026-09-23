# 文件分享連結 — 設計規格

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-23 |
| 類型 | 設計規格，供實作前審查 |
| 範圍 | My Space 單篇文件的唯讀分享連結（`/s/:token`），持有連結即可閱讀，不需登入 |
| 修改的契約 | `CLAUDE.md`「Knowing an ID is not authorization」、Phase 3 spec §13「Workspace-only authorization boundary」——見 §3 |
| 對照文件 | Phase 3 governance spec、Phase 2.5 §24.1、動作模型規格、`frontend-design-language.md` |
| 狀態 | **已拍板（§12），已實作。** 實作計畫：`docs/superpowers/plans/2026-09-23-document-share-link.md`；驗證紀錄：`docs/superpowers/verification/2026-09-23-document-share-link-verification.md` |

## 1. 要解決的問題

產品是 personal-first：登入預設進 My Space，大部分知識先在那裡寫成。但 My Space 被設計成單人空間——`assertPersonalMutationAllowed` 擋掉所有成員與群組操作——所以今天**沒有任何方法讓別人看到 My Space 裡的一份文件**。

現有和已規劃的出口都不對應「給別人看一下」這個需求：

| 出口 | 狀態 | 為什麼不適合這個需求 |
| --- | --- | --- |
| Team Workspace | 已實作 | 需要 `workspace.create_team`（限定 SSO group），而且是為長期協作設計的治理單位，不是臨時分享 |
| Promote（Phase 3 §18） | 只有一句規格 | 會複製出一份新文件、轉交 Team 治理；對「看一下」來說太重，而且兩份會開始分歧 |
| tKMS Publishing（Phase 6） | 未設計 | 正式、長期、經過編排的全公司發布出口 |
| Inspector 的 `Copy` | 已實作 | 複製的是 **ID**，別人拿到也打不開（動作模型規格 §2 已記錄） |

這份規格加入第四種出口：**擁有者刻意發出、有期限、可撤銷的唯讀連結**。任何持有連結的人都可以讀到該文件的目前版本，**不需要登入**；除此之外什麼都拿不到。

三者的分工因此是：

```text
「給別人看一下我的文件」  → 分享連結（本規格）   不複製、即時、臨時
「把這份交給團隊維護」    → Promote              複製、換治理單位
「正式發布給全公司」      → tKMS（Phase 6）      編排、長期、正式
```

## 2. 非目標

- **Team Workspace 的文件。** v1 只開放 My Space。理由見 §11。
- **透過連結編輯、留言。** 連結只讀。
- **指定對象的邀請**（「分享給 Alice」）。那是 Document ACL，Phase 3 §2 明列不做。
- **快照連結**（固定某個 revision）。一律顯示目前版本，見 §5.3。
- **即時推送。** 擁有者更新後，檢視者重新整理頁面才會看到；不做 WebSocket／SSE 推送。
- **延長期限。** 要更久就建立新連結。
- **通知**（email、站內通知）。
- **API／MCP 透過 token 讀取。** 只有 `/s/:token` 頁面接受 token。
- **資料分類**（禁止分享敏感內容）。系統目前沒有分類機制，見 §14。

**誰拿得到內容，由網路可達性決定。** 本規格不要求登入，所以「持有連結的人」實際上等於「持有連結、而且連得到 Hub 主機的人」。Hub 只部署在內網時，範圍是公司網路；Hub 對外開放時，範圍是整個網際網路。這是部署決定，本規格不改變它，但 §15 的上線檢查清單要求明確記錄。

## 3. 契約修改

這一節是這份規格裡最需要審查的部分，因為它修改的是 `CLAUDE.md` 列為「easy to break」的不變式，而且這個例外**不需要任何身分**。依 `CLAUDE.md` 的文件流程，偏離 canonical spec 必須記錄而非默默進行。

### 3.1 為什麼這不是「知道 ID 就能看」

現有不變式的目的是：**可猜測、會出現在 URL 與 log 裡、不是為授權而產生的識別碼，不能被當成權限**。分享連結的 token 在每一個面向上都與 ID 相反：

| | Document ID | 分享連結 token |
| --- | --- | --- |
| 產生目的 | 識別 | 授權 |
| 誰決定產生 | 系統，建立文件時 | 擁有者，刻意操作 |
| 可猜測性 | UUIDv7，前 48 bit 是時間戳 | UUIDv4，122 bit 隨機 |
| 與實體的關係 | 就是實體本身的主鍵 | 獨立欄位，無法從任何實體 ID 推導 |
| 期限 | 永久 | 必填，最長 90 天 |
| 撤銷 | 不可 | 隨時 |
| 稽核 | 無 | 建立、撤銷有治理紀錄；檢視有匿名計數 |
| 接受它的地方 | 所有 read service（搭配 membership） | **只有** `/s/:token` 的讀取路徑 |

所以不變式不需要推翻，但需要**寫出唯一的例外**，否則下一個讀到 `CLAUDE.md` 的人會合理地認為這個功能違規。

### 3.2 `CLAUDE.md` 修改後的文字

拍板後，實作 PR 把該條改為：

> - **Knowing an ID is not authorization.** Possessing a `workspace_id`,
>   `source_id` or `document_id` grants nothing. URL parameters are navigation
>   inputs, never authorization proof, and the application service must
>   re-verify policy regardless of what the UI allowed. A UI selector is not an
>   access check.
>   The single bearer grant is a **document share link**
>   (`docs/superpowers/specs/2026-09-23-document-share-link-design.md`): an
>   unguessable (random UUIDv4, never derived from any entity ID), expiring,
>   revocable token that the document's owner issues on purpose. It requires
>   no sign-in. It is accepted by
>   exactly one read path (`/s/:token`) and grants whoever holds it the current
>   revision of one document — never search, tree, history, MCP, or any write.
>   No other code path may serve document content without a caller.

### 3.3 Phase 3 spec §13 的修改

§13 目前寫「Phase 3 不做 Source/Document ACL。需要不同成員集合就拆另一個 Team Workspace。」拍板後在其下加一段：

> **例外（2026-09-23）：** 文件分享連結是單篇、唯讀、有期限、不需登入的 bearer grant，不是 ACL——它不指定對象、不擴張任何 Workspace capability、不進入 `evaluateEffectiveCapabilities`。規則見 share link spec。

§2 non-goals 的「Source-level 或 Document-level ACL」維持不變：分享連結不是具名的 ACL entry。

## 4. 使用流程

**擁有者：**

```text
My Space 文件列 → 右鍵（或 ⋯、或 ⌘K）→「Share link…」
→ 對話框：
    說明文字：「任何持有此連結的人都能閱讀這份文件，不需要登入。
              他們會看到你之後的每一次修改，但無法編輯，也看不到 My Space 的其他內容。
              請只分享你願意被轉傳的內容。」
    標籤（選填，例如「給後端小組」）
    期限：1 天 / 7 天 / 30 天（預設）/ 90 天
    [建立連結]
→ 顯示完整連結與 [複製]。複製只在使用者自己按下時執行，不在建立請求回來後自動執行：
   等過網路往返的剪貼簿寫入，部分瀏覽器會視為沒有使用者操作而拒絕。完整連結以唯讀欄位顯示，
   剪貼簿被拒時仍可手動選取複製。
→ 對話框下半部列出這份文件所有連結：標籤、建立時間、到期時間、檢視次數、[複製]、[撤銷]
   之後任何時候打開對話框，都能再複製同一條連結
```

**檢視者：**

```text
點連結 → /s/:token（不經 SSO，不需要 Hub 帳號）
→ 單篇唯讀頁：標題、Markdown 內文、「由 <擁有者> 分享 · 最後更新 <時間> · 連結到期 <時間>」
→ 擁有者更新後，重新整理即看到新版本
→ 任何失效情況 → 統一的「連結無法使用」頁（§6.3）
```

## 5. 領域規則

### 5.1 建立

呼叫者（已登入的擁有者）必須同時滿足：

1. 文件存在，且 `status = ACTIVE`；所屬 Source `status = ACTIVE`。
2. 文件所屬 Workspace（由 `Document → Source → Workspace` 推導）`workspace_type = PERSONAL`，且 `personal_owner_user_id = caller.identity.id`。
3. Workspace `lifecycle_state = ACTIVE`。
4. 該文件目前有效（未撤銷且未到期）的連結少於 **10** 條。
5. `expiresInDays ∈ {1, 7, 30, 90}`；標籤可省略，最長 200 字元。

**所有權（`SOURCE_MANAGED` / `HUB_MANAGED`）不影響是否能分享。** 分享是閱讀，所有權回答的是「誰能寫」。依 `CLAUDE.md`，這兩個問題不能混為一談——這裡要刻意寫明它**不是**條件，免得實作者順手加上。

### 5.2 有效性（每次檢視都重新判斷）

以下全部成立，連結才有效。任一不成立就是「無法使用」，不區分原因：

1. `token` 存在。
2. `revoked_at IS NULL`。
3. `expires_at > now`。
4. 文件 `status = ACTIVE`。
5. 文件所屬 Source `status = ACTIVE`。
6. 文件所屬 Workspace `lifecycle_state = ACTIVE`。
7. **連結建立者仍有該文件的讀取權**：以建立者的 **direct membership** 重新評估 `document.read`。對 PERSONAL 而言就是 `OWNER / SYSTEM_PERSONAL` 那一列仍存在。

檢視者的身分**不在**條件裡：不呼叫 `establishTrustedCaller`，也不讀取 SSO session。

第 7 條只看 direct role，因為 group grant 依賴當次 session 的 validated group IDs，檢視時拿不到建立者的 session。v1 只有 PERSONAL，沒有差別；這條限制是 Team 延後的原因之一（§11）。

有效性判斷寫成 `modules/knowledge/domain` 裡的純函式，不含 I/O，讓每一條都能單獨被單元測試鎖住。

### 5.3 顯示目前版本（已拍板）

連結永遠解析到文件的 `current_revision`：擁有者每次儲存產生新的 revision 後，檢視者下一次載入就看到新內容。

- 這是刻意的：對方看到的應該是擁有者「現在」的版本，修正錯字後不該還看到舊的錯誤內容。
- 不做快取：§6.4 的 `Cache-Control: no-store` 保證重新整理一定重新讀取。
- 不做即時推送：見 §2。
- **代價**：擁有者之後寫進去的所有內容，持有連結的人都看得到。對話框的說明文字明講這一點（§4）。
- **不暴露 revision 歷史**：頁面只顯示 current revision 的標題與 Markdown，不顯示 revision 清單、metadata、`createdBy`、source 名稱或 tree 位置。

### 5.4 撤銷

- 只有建立者可以撤銷。
- 撤銷是最終的：`revoked_at` 一旦寫入就不清除。
- 依動作模型規格 §6：無法 undo 且後果重大（會讓別人手上的連結失效）→ 使用兩段式行內確認，而不是先做再給 undo。

### 5.5 沒有 hard delete

符合 lifecycle 不變式：連結列與檢視計數永不刪除。過期、撤銷只是狀態。

## 6. 讀取路徑

### 6.1 唯一的入口

```text
GET /s/:token   （server component，不在 /w/ layout 之下）
  → 不呼叫 establishTrustedCaller          ← 刻意：檢視者可以是任何人
  → shareLinks.readShared(token)
       ├─ 格式不是 UUID → 直接視為無效，不查 DB
       ├─ 以 token 查 unique index
       ├─ 讀 link、document、source、workspace、建立者的 direct membership
       ├─ 套用 §5.2 純函式
       ├─ 累加檢視計數（§7.2）   ← 另一個 transaction；失敗只記 log，照常顯示內容（A5）
       └─ 回傳 { title, markdown, sharedByName, updatedAt, expiresAt }
  → 任何錯誤 → §6.3 的統一頁面，HTTP 404
```

`readShared` **沒有 caller 參數**，也不呼叫 `workspaceAccess.requireMembership`。這正是它存在的原因，也因此它必須是整個 codebase 裡**唯一**不經 caller 就回傳文件內容的方法。完成判準（§13）要求用測試斷言這一點。

**組裝要求：** `/s/:token` 取得 `DocumentShareService` 的路徑不能經過 identity provider 的建構或 production readiness 檢查。現有的 `applicationServices()` 在 `company-sso` 模式下缺少 session reader 時會在建構階段就丟錯（`identity-provider-factory.ts`），所以 composition root 要提供一個只組裝 unit of work 與分享服務的獨立入口。E2E 以沒有設定 SSO session reader 的伺服器（`phase3UnconfiguredOrigin()`）開啟連結來證明這一點。

**部署要求：** 公司 SSO 在應用程式之前的 gateway／reverse proxy 必須放行兩個 prefix，而且**只**放行這兩個：

- `/s/*`：分享頁本身。
- `/_next/static/*`：Next.js 的建置產物（CSS、JS chunk、字型）。分享頁的樣式、字型和時間戳在瀏覽器端的換算都靠它們；只放行 `/s/*` 會讓匿名讀者拿到沒有樣式的頁面。這個 prefix 只有建置時產生的靜態檔案，不含任何使用者資料。

放行範圍寫錯（例如放行 `/s` 開頭的所有路徑、整個 `/_next`，或整個 `/api`）會讓其他頁面也不需登入；應用程式內的每條其他路由仍會呼叫 `establishTrustedCaller`，但不應該把這當成唯一防線。

### 6.2 不擴散到其他讀取面

分享連結不授予任何 Workspace capability，所以下列行為**不需要改程式**就成立，但每一條都要有測試斷言：

- 持有連結的人，若也是 Hub 使用者，其搜尋（Phase 4）不會出現這份文件。
- 其 Workspace selector 不會出現分享者的 My Space。
- 以同一個 document ID 打 `/w/:workspaceId/knowledge/...` 或 `/api/documents/:id` 仍然得到 404。
- 未來的 MCP（Phase 7）與 retrieval（Phase 8）只會繼承 Workspace policy，不會碰到分享連結。

### 6.3 失效頁面

所有失效情況——token 不存在、撤銷、過期、文件封存、擁有者失去存取權——顯示同一頁面、回傳同一狀態碼（404），文字涵蓋所有可能：

```text
這個連結無法使用
它可能已過期、已被撤銷，或從未存在。如果你需要這份文件，請聯絡分享者。
```

沿用 Phase 2.5 §24.1「不洩漏資源是否存在」的原則。對匿名存取而言這更重要：不能讓任何人藉由回應差異，分辨一條連結是「曾經有效」還是「從未存在」。

### 6.4 回應標頭

`next.config.ts` 為 `/s/:path*` 追加：

| Header | 值 | 原因 |
| --- | --- | --- |
| `Referrer-Policy` | `no-referrer` | 內文裡的外部連結被點擊時，token 不能經由 `Referer` 洩漏給外站 |
| `Cache-Control` | `private, no-store` | 撤銷後不能再由任何快取送出內容；擁有者更新後重新整理一定拿到新版本（§5.3） |
| `X-Robots-Tag` | `noindex, nofollow` | 防止搜尋引擎或內部爬蟲收錄 |
| `Content-Security-Policy` | `img-src 'self'; frame-ancestors 'none'` | 匿名頁面不能被別的網站嵌入 iframe，且保留全站的圖片限制 |

`markdown-image-policy` 照常套用。CSP 必須是**一個** header 同時帶兩個 directive：Next.js 對同一個 key 只保留最後一條符合的規則，所以 `/s/*` 若只設 `frame-ancestors`，會把全站的 `img-src 'self'`（Issue #20）蓋掉，而這正好是唯一不需登入的頁面。E2E 斷言完整的 header 值。

### 6.5 頁面本身

- 單欄閱讀頁，重用既有的 `MarkdownRenderer`。不掛 app shell、tree、workspace selector、inspector。
- **不放任何進入 Hub 的連結。** 檢視者多半沒有 Hub 帳號，連回 `/` 只會把他帶到 SSO 登入頁。
- 不輸出 Open Graph／Twitter card 的 meta tag：聊天工具的連結預覽不應該拿到內文摘要（見 §14 第 3 點）。`<title>` 仍是文件標題。
- 內文裡的相對連結、Hub 內部連結，對檢視者會是 404——這是正確行為，不做改寫。
- 樣式依 `frontend-design-language.md`：只用契約列出的 token，顏色只來自 `globals.css` 的 CSS 變數。

## 7. 資料模型

新增 migration `011-document-share-links`。

### 7.1 `document_share_links`

```sql
CREATE TABLE document_share_links (
  id           UUID        NOT NULL,
  document_id  UUID        NOT NULL,
  token        UUID        NOT NULL,   -- UUIDv4，見 §8
  label        VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  created_by   UUID        NOT NULL,
  created_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expires_at   DATETIME(6) NOT NULL,
  revoked_by   UUID        NULL,
  revoked_at   DATETIME(6) NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_share_links_token UNIQUE (token),
  CONSTRAINT fk_share_links_document  FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_share_links_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_share_links_revoked_by FOREIGN KEY (revoked_by) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_share_links_expiry  CHECK (expires_at > created_at),
  CONSTRAINT ck_share_links_revoked CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  KEY idx_share_links_document (document_id, created_at)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**刻意不存 `workspace_id` 或 `source_id`。** 依「Scope is derived, never stored twice」，範圍一律從 `Document → Source → Workspace` 推導。存一份副本只會製造兩者不一致的可能。

### 7.2 `document_share_link_views`

檢視者是匿名的，所以只記錄**次數**，不記錄是誰：

```sql
CREATE TABLE document_share_link_views (
  share_link_id   UUID        NOT NULL,
  view_date       DATE        NOT NULL,   -- UTC
  first_viewed_at DATETIME(6) NOT NULL,
  last_viewed_at  DATETIME(6) NOT NULL,
  view_count      INT UNSIGNED NOT NULL,
  PRIMARY KEY (share_link_id, view_date),
  CONSTRAINT fk_share_views_link FOREIGN KEY (share_link_id) REFERENCES document_share_links(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

每次檢視執行 `INSERT … ON DUPLICATE KEY UPDATE last_viewed_at = …, view_count = view_count + 1`。

**不記錄 IP、User-Agent 或任何可識別檢視者的資料。** 那些是個人資料，保存它們需要另一套保存期限與存取規則；而且在匿名、可轉傳的前提下，它們也無法可靠地回答「誰看過」。擁有者從計數得到的是「這條連結有沒有被用、用得多頻繁」，這足以決定要不要撤銷。

**為什麼不寫進 `workspace_audit_events`：** 那張表記錄的是治理 mutation，一次操作一列，由 Team 的 OWNER/ADMIN 在 Audit 頁閱讀。檢視是高頻的讀取事件，逐筆寫入會淹沒治理紀錄，而且 My Space 本來就沒有 Audit 頁（Phase 3 §17）。

### 7.3 治理事件

建立與撤銷**仍然**寫入 `workspace_audit_events`，並與 mutation 同一個 transaction（Phase 3 §16 的原子性要求）：

| `event_type` | `target_type` | `target_id` | `payload` |
| --- | --- | --- | --- |
| `DOCUMENT_SHARE_LINK_CREATED` | `DOCUMENT_SHARE_LINK` | link id | `{ documentId, expiresAt, label }` |
| `DOCUMENT_SHARE_LINK_REVOKED` | `DOCUMENT_SHARE_LINK` | link id | `{ documentId }` |

`workspace_id` 在寫入當下推導。payload 絕不包含 token：audit 的讀者不一定是連結的擁有者，不能藉此取得可用的連結。

## 8. Token

- 產生：`crypto.randomUUID()`（UUIDv4，122 bit 隨機），URL 為 `/s/<token>`。
- **不可以用 codebase 慣用的 `uuidv7()`。** 連結本身的主鍵 `id` 仍然用 UUIDv7，但 token 不行，原因依嚴重程度：
  1. **同一毫秒內是連號的。** `src/shared/ids/uuidv7.ts` 為了單調遞增，同一毫秒內把上一個值的隨機部分加 1。`create` 在同一個 transaction 裡依序產生連結 `id`、token、audit 事件 `id`，三者實測為 `…d31e`、`…d31f`、`…d320`——看得到連結 ID（撤銷 API 的 URL、access log）或 audit 事件 ID 的人，就能算出 token。同一個 Node 程序裡，不同使用者在同一毫秒建立的連結也會相鄰。
  2. 前 48 bit 是時間戳，會洩漏連結的建立時間，隨機部分最多約 74 bit。
  3. token 與系統裡所有 ID 長得一樣，容易被當成一般 ID 寫進 log 或 payload。

  UUIDv4 的代價只有 index 插入區域性較差，這張表的規模可以忽略。實作須加一個測試：連續建立兩條連結，斷言兩個 token 之差不是 1，且 token 的 version 欄位為 4。
- 儲存：明文存在 `token` 欄位（MariaDB native `UUID`），unique index 查詢。
- 擁有者隨時可以從對話框再複製同一條連結。
- 產生由新的 port（`ShareTokenIssuer`）提供，domain 與 application 層不直接依賴 `node:crypto`，測試可注入固定值。

不需登入的前提下，token 是**唯一**的防線，所以不接受擁有者自訂 slug，也不接受縮短。

**為什麼明文保存而不是只存 hash：** 只存 hash 時，擁有者建立連結後就再也複製不到它，要再分享只能建立新連結——這與「打開分享對話框、按複製」的預期不符。明文保存的代價是「能讀資料庫的人能拿到可用的連結」；但能讀資料庫的人本來就讀得到所有文件內容，多出來的只是「還能透過連結看到之後的更新」，而這由期限與撤銷限制。為此引入 hash 或密鑰管理不划算（決定 A3）。

每份文件最多 10 條有效連結的上限仍保留：分享給不同對象時用不同連結，可以個別撤銷、個別看檢視次數。

## 9. 應用層與 HTTP

### 9.1 放在哪個模組

放在 `knowledge` 模組。分享連結是「讀取一份文件」的另一種授權方式，而 `KnowledgeRepositories` 已經帶有 `workspaces`、`workspaceMemberships`、`sourcePolicy`，可以在不跨越 lint 邊界的情況下完成 §5 的所有檢查。不新增第五個模組。

```text
src/modules/knowledge/domain/document-share-link.ts          實體、§5.1 / §5.2 純函式、錯誤
src/modules/knowledge/ports/document-share-link-repository.ts
src/modules/knowledge/ports/share-token-issuer.ts
src/modules/knowledge/application/document-share-service.ts   create / list / revoke / readShared
src/infrastructure/database/mariadb/repositories/document-share-links.ts
src/infrastructure/database/mariadb/migrations/011-document-share-links.ts
src/server/share-read.ts                                      /s/:token 的 read projection
src/server/composition.ts                                     wiring
```

### 9.2 Service 介面

```ts
interface DocumentShareService {
  create(caller, { documentId, label?, expiresInDays }): Promise<ShareLinkView>;   // 含 path
  list(caller, documentId): Promise<ShareLinkView[]>;   // 含 path 與每日檢視計數
  revoke(caller, linkId): Promise<void>;
  readShared(token): Promise<SharedDocumentView>;       // 沒有 caller：唯一不經 membership 的內容讀取
}
```

`create`、`list`、`revoke` 都需要已登入的 caller，並走 §5.1 的條件 2（必須是 My Space 擁有者），不接受任何由 client 傳入的 workspace ID。

`readShared` 刻意不接受 `CallerContext`：即使檢視者碰巧已登入，也不能讓他的身分影響結果，否則同一條連結對不同人會有不同行為，測試與推理都會變複雜。

### 9.3 鎖定順序

建立與撤銷遵循 Phase 3 §14.2 的「non-import existing Source」路徑：

```text
Source FOR UPDATE → Workspace FOR UPDATE → 重新驗證 §5.1 → insert/update link + audit
```

與 resync（Source → Workspace）同序，不會造成 lock inversion。`readShared` 不取 row lock：它是讀取，而 §5.2 每次都重新判斷，文件在檢視後一瞬間被封存，下一次檢視自然失效。

### 9.4 路由

| 方法 | 路徑 | 需要登入 | 回應 |
| --- | --- | --- | --- |
| `POST` | `/api/documents/:documentId/share-links` | 是 | `201 { link }`，`link.path` 為 `/s/<token>` |
| `GET` | `/api/documents/:documentId/share-links` | 是 | `200 { links }`，每條都含 `path` |
| `POST` | `/api/share-links/:linkId/revoke` | 是 | `204` |
| `GET` | `/s/:token` | **否** | 頁面；失效一律 404 |

API 回傳路徑而不是完整 URL：伺服器在 reverse proxy 後面看到的 `Host` 不一定是使用者看到的網址，而且 `Host` 可由請求偽造。完整連結由瀏覽器以 `window.location.origin` 組成。

撤銷用 `POST …/revoke` 而不是 `DELETE`：沒有 hard delete，路由不該暗示有。

錯誤對應沿用 `http-error-response.ts`：文件不存在或呼叫者無權 → 404；非 PERSONAL、文件已封存、超過 10 條上限 → 409 並附明確原因。

## 10. UI

### 10.1 動作登錄

依動作模型規格，所有出口都從 `action-registry.ts` 讀取。新增：

```ts
{
  id: "document.share",
  label: "Share link…",
  group: "document",
  icon: "share",
  keywords: ["link", "share", "copy link", target.label],
  surfaces: ["palette", "row"],
  effect: { kind: "command", command: "document.open-share", documentId, sourceId },
}
```

在三個軸上的可用性（動作模型規格 §4.1）：

1. **工作區能力**：`workspaceType === "PERSONAL"` 且 `confirmed`。
2. **Source 所有權**：**不看**。見 §5.1 最後一段。
3. **目標狀態**：`status === "ACTIVE"` 且 `revision === "CURRENT"`。在歷史版本上提供分享，會讓人以為分享的是那個版本。`status` 同時反映文件所屬 source 的狀態：source 封存時，裡面仍是 ACTIVE 的文件也視為 ARCHIVED，因為建立會被 §5.1 第 1 條拒絕。

`available()` 決定顯示什麼，service 決定發生什麼：§13 要求分別斷言兩者。

文件頁標頭也提供同一個動作（從 registry 取），與 Edit 並列。標頭只放圖標，`aria-label` 與 tooltip 仍是「Share link…」：標頭沒有 Copy link 可以混淆，點下去只會開啟對話框，建立連結前對話框會說明後果。圖標用 `Share2` 而不是鏈結，因為 Copy link 已經用了鏈結圖標，兩者在右鍵選單裡並列。文件往下捲、標頭離開畫面後，頂端固定的 topbar 也在 Details 左邊提供同一個圖標；是否顯示仍由文件頁向 registry 取得，topbar 不自行判斷。

### 10.2 用詞

標籤是「Share link…」，不是「Share」。「Share」在其他產品裡通常包含邀請特定人、給予編輯權；這裡只做一件事，就是產生一條唯讀連結。刪節號表示會先開對話框。

對話框的說明文字（§4）必須明寫「不需要登入」與「會看到你之後的修改」這兩點。這是擁有者做決定時唯一看得到的風險說明，不能為了簡潔而省略。

### 10.3 回饋

- 建立成功：結果本身（連結 + 複製按鈕）就顯示在對話框裡，不另外跳 toast——同動作模型規格 §6「會導航到結果本身的操作不給 toast」的精神。
- 撤銷成功：toast，不提供 undo（§5.4）。
- 失敗：錯誤留在對話框的控制項旁。

## 11. Team Workspace 為什麼延後

不是做不到，而是有三個問題 v1 不應該順便決定：

1. **治理繞道。** Team 的成員集合由 OWNER/ADMIN 管理。任何 EDITOR 都能把 Team 文件以不需登入的連結送出去，等於繞過整套治理。需要一個由 OWNER 控制的 Workspace 設定（例如 `shareLinksAllowed`），以及「誰能建立」的規則（`document.write`？ADMIN 以上？）。
2. **建立者的授權無法離線評估。** §5.2 第 7 條只能看 direct role。在 Team 裡，靠 SSO group 取得存取權的建立者，檢視時無法重新評估——要嘛只允許有 direct role 的人建立，要嘛接受「group 被移除後連結仍有效直到過期」。
3. **稽核可見性。** Team 的 OWNER/ADMIN 應該能在 Audit 頁看到並撤銷成員發出的連結，那是新的治理權限。

這三點應該是一份獨立規格，在 v1 的使用資料出來之後再寫（決定 A6）。

### 11.1 第二階段的起點（未拍板）

以下是寫 Team 規格時的建議起點，**不是**本規格的決定，第二階段的規格必須重新審查每一條：

| 問題 | 建議 |
| --- | --- |
| Team 能不能用 | OWNER 在 Team 設定中開關，預設關閉 |
| 誰能建立 | 具 **direct role** 且有 `document.write` 的成員（EDITOR 以上）；只靠 SSO group 取得權限者不能建立（對應上方第 2 點） |
| 誰能撤銷 | 建立者本人，以及該 Team 的 OWNER／ADMIN |
| 誰看得到連結清單 | OWNER／ADMIN 看全部，其他人只看自己建立的 |
| 稽核 | 建立與撤銷事件出現在 Team 的 Audit 頁 |
| 自動失效 | 建立者被移出 Team 或失去讀取權時，其連結即失效（§5.2 第 7 條已涵蓋） |

本規格的資料模型不需要為此預留欄位：連結不存 scope，Team 的開關屬於 `workspaces` 表，建立者與撤銷者已有欄位。

## 12. 決定

所有決定均已拍板，沒有待決事項。

### 已拍板（2026-09-23）

| # | 決定 | 內容 |
| --- | --- | --- |
| A0 | 使用對象 | 一般開發者的知識分享，不是專為特定敏感資料領域設計；因此不設全域開關，檢視計數是統計用途而非稽核 |
| A1 | 檢視不需登入 | 持有連結即可閱讀；`/s/:token` 不經 SSO、不需要 Hub 帳號。影響見 §2 最後一段、§6.1 部署要求、§7.2、§14 |
| A2 | 顯示目前版本 | 擁有者更新後，檢視者重新整理即看到新版本；不做快照、不做即時推送（§5.3） |
| A3 | Token 形式 | 隨機 UUIDv4，明文保存於獨立的 unique 欄位；擁有者可隨時再複製（§8） |
| A4 | 期限 | 1 / 7 / 30 / 90 天，必填，預設 30 天 |
| A5 | 檢視計數寫入失敗 | fail open：在獨立的 transaction 寫入，失敗只記 log（不含 token），照常顯示內容 |
| A6 | 分階段 | 第一階段只做 My Space；Team 在第一階段上線、有使用資料後另寫規格（§11） |

## 13. 完成判準

**領域（單元測試，無 DB）**

- §5.2 的每一條條件各有一個「只有這條不成立 → 無效」的案例。
- §5.1 的每一條條件各有一個拒絕案例；`SOURCE_MANAGED` 文件**可以**建立分享。
- `action-registry`：PERSONAL + ACTIVE + CURRENT 才出現 `document.share`；TEAM、ARCHIVED、HISTORICAL、`confirmed = false` 都不出現。

**整合（MariaDB）**

- 非擁有者、Team 文件、封存文件、第 11 條連結：`create` 被拒，且沒有寫入任何 link 或 audit 列。
- `create` 與 `DOCUMENT_SHARE_LINK_CREATED` 在同一 transaction：模擬 audit 寫入失敗時，link 也不存在。
- token 是 UUIDv4（version 欄位為 4），且不等於同一列的 `id` 或 `document_id`；audit payload 不含 token。
- 格式不是 UUID 的 `/s/:token` 回傳失效頁，且不發出任何 DB 查詢。
- 撤銷後、到期後、文件經 resync 變成 ARCHIVED 後、Source 封存後，`readShared` 一律失敗。
- 模擬檢視計數寫入失敗：`readShared` 仍回傳內容。
- 擁有者建立新 revision 後，`readShared` 回傳新的內容。
- 同一天檢視三次 → 一列，`view_count = 3`；表中沒有任何可識別檢視者的欄位。
- 並行：resync apply 與 `create` 同時執行不會死結。

**不擴散（整合或 e2e）**

- 另一位 Hub 使用者持有有效連結時：搜尋不到該文件、selector 沒有分享者的 My Space、`/w/.../knowledge/...` 與 `/api/documents/:id` 都是 404。
- 以程式掃描斷言：除了 `readShared`，knowledge 模組中所有回傳 revision 內容的 public 方法都接受 `CallerContext` 並經過 `requireMembership`（或既有的 `requireVisibleDocument`）。
- 除了 `/s/*`，所有頁面與 API 在沒有 session 時都失敗（以 e2e 的無 session browser context 抽查各類路由）。

**E2E（Playwright）**

- 擁有者右鍵 → Share link… → 建立 → 在**沒有任何 session 的 browser context** 開啟連結 → 看到內容與「由 X 分享」。
- 擁有者編輯文件 → 匿名檢視者重新整理 → 看到新內容。
- 擁有者撤銷（含兩段式確認）→ 匿名檢視者重新整理 → 統一的失效頁，HTTP 404。
- `/s/*` 回應帶有 §6.4 的四個 header，且頁面沒有 Open Graph meta tag。

## 14. 已知限制

1. **任何拿到連結的人都能看，包括已離職的人。** 不需登入代表 Hub 無法區分檢視者，SSO 的離職處理也擋不住他們。擁有者離職時，他發出的連結同樣存活到過期。必填期限（A4）與擁有者隨時撤銷，是本規格對這一點的緩解。
2. **轉寄沒有邊界。** 連結可以被轉到公司外；能不能打開只取決於網路可達性（§2）。檢視計數能讓擁有者發現「次數比預期多」，但無法得知是誰。
3. **聊天工具的連結預覽會抓取頁面。** 貼到 Slack／Teams 時，對方伺服器會先抓一次頁面來產生預覽：`<title>`（文件標題）會出現在聊天室裡，而且算一次檢視。§6.5 不輸出 Open Graph tag，所以內文摘要不會出現在預覽裡，但標題會。
4. **token 在 URL 裡。** 會出現在瀏覽器歷史紀錄，也可能出現在反向代理的 access log。部署時應遮罩 `/s/` 路徑。
5. **沒有資料分類。** 系統無法得知一份文件是否含敏感資料，也就無法禁止分享它。若之後引入分類，分享連結是第一個應該接上的地方。
6. **相對連結與圖片對檢視者無效。** Assets 目前只存 metadata，Hub 內部連結檢視者也打不開。
7. **沒有速率限制。** 122 bit 隨機的 token 無法被暴力猜中，但匿名端點仍可能被大量請求。速率限制放在 gateway 層（§15），不在應用程式內實作。

## 15. 拍板後要同步修改的文件與設定

**文件**——實作 PR 必須在同一個 PR 內完成，避免規格與契約分開漂移：

- `CLAUDE.md`：§3.2 的文字。
- Phase 3 spec §13：§3.3 的例外段落。
- `README.md` 的 canonical documents 表：加入本規格與對應的 implementation plan。
- `frontend-design-language.md`：如果 `share` 圖示或閱讀頁需要新的 token，依契約規定一併修改。

**上線檢查清單**——不在程式範圍內，但上線前必須逐項確認並記錄在 `docs/superpowers/verification/`：

- [ ] SSO gateway 只對 `/s/*` 與 `/_next/static/*` 放行，其餘路徑仍強制登入（附設定片段，§6.1）。
- [ ] 記錄 Hub 主機的網路可達範圍（內網／對外）；對外時，分享連結等同網際網路公開。
- [ ] Reverse proxy 的 access log 遮罩 `/s/` 之後的 token。
- [ ] Gateway 對 `/s/*` 設定速率限制。
- [ ] 資安單位知悉此功能提供不需登入的讀取路徑。
