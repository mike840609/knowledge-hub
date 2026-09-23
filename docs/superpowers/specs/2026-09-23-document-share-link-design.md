# 文件分享連結 — 設計規格

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-23 |
| 類型 | 設計規格，供實作前審查 |
| 範圍 | My Space 單篇文件的唯讀分享連結（`/s/:token`） |
| 修改的契約 | `CLAUDE.md`「Knowing an ID is not authorization」、Phase 3 spec §13「Workspace-only authorization boundary」——見 §3 |
| 對照文件 | Phase 3 governance spec、Phase 2.5 §24.1、動作模型規格、`frontend-design-language.md` |
| 狀態 | **待審查。§12 列出需要拍板的決定；拍板前不動程式。** |

## 1. 要解決的問題

產品是 personal-first：登入預設進 My Space，大部分知識先在那裡寫成。但 My Space 被設計成單人空間——`assertPersonalMutationAllowed` 擋掉所有成員與群組操作——所以今天**沒有任何方法讓別人看到 My Space 裡的一份文件**。

現有和已規劃的出口都不對應「給同事看一下」這個需求：

| 出口 | 狀態 | 為什麼不適合這個需求 |
| --- | --- | --- |
| Team Workspace | 已實作 | 需要 `workspace.create_team`（限定 SSO group），而且是為長期協作設計的治理單位，不是臨時分享 |
| Promote（Phase 3 §18） | 只有一句規格 | 會複製出一份新文件、轉交 Team 治理；對「看一下」來說太重，而且兩份會開始分歧 |
| tKMS Publishing（Phase 6） | 未設計 | 正式、長期、經過編排的全公司發布出口 |
| Inspector 的 `Copy` | 已實作 | 複製的是 **ID**，別人拿到也打不開（動作模型規格 §2 已記錄） |

這份規格加入第四種出口：**擁有者刻意發出、有期限、可撤銷的唯讀連結**。持有連結且已登入公司 SSO 的人，可以讀到該文件的目前版本，除此之外什麼都拿不到。

三者的分工因此是：

```text
「給同事看一下我的草稿」  → 分享連結（本規格）   不複製、即時、臨時
「把這份交給團隊維護」    → Promote              複製、換治理單位
「正式發布給全公司」      → tKMS（Phase 6）      編排、長期、正式
```

## 2. 非目標

- **網際網路公開。** 沒有匿名存取，沒有「任何人」選項。HR 資料不應該有這個開關。
- **Team Workspace 的文件。** v1 只開放 My Space。理由見 §11。
- **透過連結編輯、留言。** 連結只讀。
- **指定對象的邀請**（「分享給 Alice」）。那是 Document ACL，Phase 3 §2 明列不做。
- **快照連結**（固定某個 revision）。v1 一律顯示目前版本，見 §5.3。
- **延長期限。** 要更久就建立新連結。
- **通知**（email、站內通知）。
- **API／MCP 透過 token 讀取。** 只有 `/s/:token` 頁面接受 token。
- **資料分類**（禁止分享敏感內容）。系統目前沒有分類機制，見 §10。

## 3. 契約修改

這一節是這份規格裡最需要審查的部分，因為它修改的是 `CLAUDE.md` 列為「easy to break」的不變式。依 `CLAUDE.md` 的文件流程，偏離 canonical spec 必須記錄而非默默進行。

### 3.1 為什麼這不是「知道 ID 就能看」

現有不變式的目的是：**可猜測、會出現在 URL 與 log 裡、不是為授權而產生的識別碼，不能被當成權限**。分享連結的 token 在每一個面向上都與 ID 相反：

| | Document ID | 分享連結 token |
| --- | --- | --- |
| 產生目的 | 識別 | 授權 |
| 誰決定產生 | 系統，建立文件時 | 擁有者，刻意操作 |
| 可猜測性 | UUIDv7，含時間戳，部分可推測 | 256 bit 隨機 |
| 儲存 | 明文，到處引用 | 只存 SHA-256 hash |
| 期限 | 永久 | 必填，最長 90 天 |
| 撤銷 | 不可 | 隨時 |
| 稽核 | 無 | 建立、撤銷、檢視都有紀錄 |
| 接受它的地方 | 所有 read service（搭配 membership） | **只有** `/s/:token` 的讀取路徑 |

所以不變式不需要推翻，但需要**寫出唯一的例外**，否則下一個讀到 `CLAUDE.md` 的人會合理地認為這個功能違規。

### 3.2 `CLAUDE.md` 修改後的文字

拍板後，實作 PR 把該條改為：

> - **Knowing an ID is not authorization.** Possessing a `workspace_id`,
>   `source_id` or `document_id` grants nothing. URL parameters are navigation
>   inputs, never authorization proof, and the application service must
>   re-verify policy regardless of what the UI allowed. A UI selector is not an
>   access check.
>   The single bearer-style grant is a **document share link**
>   (`docs/superpowers/specs/2026-09-23-document-share-link-design.md`): an
>   unguessable, expiring, revocable token that the document's owner issues on
>   purpose, stored only as a hash. It is accepted by exactly one read path
>   (`/s/:token`) and grants an authenticated company user the current revision
>   of one document — never search, tree, history, MCP, or any write.

### 3.3 Phase 3 spec §13 的修改

§13 目前寫「Phase 3 不做 Source/Document ACL。需要不同成員集合就拆另一個 Team Workspace。」拍板後在其下加一段：

> **例外（2026-09-23）：** 文件分享連結是單篇、唯讀、有期限的 bearer grant，不是 ACL——它不指定對象、不擴張任何 Workspace capability、不進入 `evaluateEffectiveCapabilities`。規則見 share link spec。

§2 non-goals 的「Source-level 或 Document-level ACL」維持不變：分享連結不是具名的 ACL entry。

## 4. 使用流程

**擁有者：**

```text
My Space 文件列 → 右鍵（或 ⋯、或 ⌘K）→「Share link…」
→ 對話框：
    說明文字：「公司內任何人只要登入並持有此連結，就能閱讀這份文件的目前版本。
              他們無法編輯，也看不到 My Space 的其他內容。你之後的修改他們也會看到。」
    標籤（選填，例如「給 HRBP 小組」）
    期限：1 天 / 7 天 / 30 天（預設）/ 90 天
    [建立連結]
→ 顯示完整連結與 [複製]。提示：「此連結只會顯示這一次。」
→ 對話框下半部列出這份文件所有連結：標籤、建立時間、到期時間、檢視人數、[撤銷]
```

**檢視者：**

```text
點連結 → 未登入則走一般 SSO 登入 → /s/:token
→ 單篇唯讀頁：標題、Markdown 內文、「由 <擁有者> 分享 · 最後更新 <時間> · 連結到期 <時間>」
→ 頁尾：「你的檢視會被記錄，分享者看得到。」
→ 任何失效情況 → 統一的「連結無法使用」頁（§6.3）
```

## 5. 領域規則

### 5.1 建立

呼叫者必須同時滿足：

1. 文件存在，且 `status = ACTIVE`；所屬 Source `status = ACTIVE`。
2. 文件所屬 Workspace（由 `Document → Source → Workspace` 推導）`workspace_type = PERSONAL`，且 `personal_owner_user_id = caller.identity.id`。
3. Workspace `lifecycle_state = ACTIVE`。
4. 該文件目前有效（未撤銷且未到期）的連結少於 **10** 條。
5. `expiresInDays ∈ {1, 7, 30, 90}`；標籤可省略，最長 200 字元。

**所有權（`SOURCE_MANAGED` / `HUB_MANAGED`）不影響是否能分享。** 分享是閱讀，所有權回答的是「誰能寫」。依 `CLAUDE.md`，這兩個問題不能混為一談——這裡要刻意寫明它**不是**條件，免得實作者順手加上。

### 5.2 有效性（每次檢視都重新判斷）

以下全部成立，連結才有效。任一不成立就是「無法使用」，不區分原因：

1. `token_hash` 存在。
2. `revoked_at IS NULL`。
3. `expires_at > now`。
4. 文件 `status = ACTIVE`。
5. 文件所屬 Source `status = ACTIVE`。
6. 文件所屬 Workspace `lifecycle_state = ACTIVE`。
7. **連結建立者仍有該文件的讀取權**：以建立者的 **direct membership** 重新評估 `document.read`。對 PERSONAL 而言就是 `OWNER / SYSTEM_PERSONAL` 那一列仍存在。
8. 檢視者已通過 `establishTrustedCaller`（公司 SSO）。

第 7 條只看 direct role，因為 group grant 依賴當次 session 的 validated group IDs，檢視時拿不到建立者的 session。v1 只有 PERSONAL，沒有差別；這條限制是 Team 延後的原因之一（§11）。

有效性判斷寫成 `modules/knowledge/domain` 裡的純函式，不含 I/O，讓每一條都能單獨被單元測試鎖住。

### 5.3 顯示目前版本，不是快照

連結永遠解析到文件的 `current_revision`。

- **符合預期**：Google Docs 式分享的心智模型就是「對方看到的是我現在的版本」。快照連結會讓擁有者修正錯字後，對方仍看到舊的錯誤內容。
- **代價**：擁有者之後寫進去的東西對方也看得到。對話框的說明文字明講這一點（§4）。
- **不暴露 revision 歷史**：頁面只顯示 current revision 的標題與 Markdown，不顯示 revision 清單、metadata、`createdBy`、source 名稱或 tree 位置。

### 5.4 撤銷

- 只有建立者可以撤銷。
- 撤銷是最終的：`revoked_at` 一旦寫入就不清除。
- 依動作模型規格 §6：無法 undo 且後果重大（會讓別人手上的連結失效）→ 使用兩段式行內確認，而不是先做再給 undo。

### 5.5 沒有 hard delete

符合 lifecycle 不變式：連結列與檢視紀錄永不刪除。過期、撤銷只是狀態。

## 6. 讀取路徑

### 6.1 唯一的入口

```text
GET /s/:token   （server component，不在 /w/ layout 之下）
  → establishTrustedCaller()                    ← 檢視者必須是公司 SSO 使用者
  → shareLinks.readShared(caller, token)
       ├─ hash = SHA-256(token)
       ├─ 讀 link、document、source、workspace、建立者的 direct membership
       ├─ 套用 §5.2 純函式
       ├─ 記錄檢視（§7.2）       ← 失敗則整個請求失敗（fail closed）
       └─ 回傳 { title, markdown, sharedByName, updatedAt, expiresAt }
  → 任何錯誤 → §6.3 的統一頁面，HTTP 404
```

`readShared` **不呼叫** `workspaceAccess.requireMembership`，這正是它存在的原因；也因此它必須是整個 codebase 裡**唯一**不經 membership 就回傳文件內容的方法。完成判準（§13）要求用測試斷言這一點。

### 6.2 不擴散到其他讀取面

分享連結不授予任何 Workspace capability，所以下列行為**不需要改程式**就成立，但每一條都要有測試斷言：

- 檢視者的搜尋（Phase 4）不會出現這份文件。
- 檢視者的 Workspace selector 不會出現分享者的 My Space。
- 檢視者用同一個 document ID 打 `/w/:workspaceId/knowledge/...` 或 `/api/documents/:id` 仍然得到 404。
- 未來的 MCP（Phase 7）與 retrieval（Phase 8）只會繼承 Workspace policy，不會碰到分享連結。

### 6.3 失效頁面

所有失效情況——token 不存在、撤銷、過期、文件封存、擁有者失去存取權——顯示同一頁面、回傳同一狀態碼（404），文字涵蓋所有可能：

```text
這個連結無法使用
它可能已過期、已被撤銷，或從未存在。如果你需要這份文件，請聯絡分享者。
```

沿用 Phase 2.5 §24.1「不洩漏資源是否存在」的原則。這裡洩漏的風險本來就低（能打出有效 token 的人本來就持有它），但統一處理可以少一條需要維護的分支。

### 6.4 回應標頭

`next.config.ts` 為 `/s/:path*` 追加：

| Header | 值 | 原因 |
| --- | --- | --- |
| `Referrer-Policy` | `no-referrer` | 內文裡的外部連結被點擊時，token 不能經由 `Referer` 洩漏給外站 |
| `Cache-Control` | `private, no-store` | 撤銷後不能再由任何快取送出內容 |
| `X-Robots-Tag` | `noindex, nofollow` | 防止內部搜尋爬蟲收錄 |

既有的 `img-src 'self'` CSP 與 `markdown-image-policy` 照常套用。

### 6.5 頁面本身

- 單欄閱讀頁，重用既有的 `MarkdownRenderer`。不掛 app shell、tree、workspace selector、inspector。
- 頁首提供一個回到 `/` 的連結（檢視者自己的 My Space）。
- 內文裡的相對連結、Hub 內部連結，對檢視者會是 404——這是正確行為，不做改寫。
- 樣式依 `frontend-design-language.md`：只用契約列出的 token，顏色只來自 `globals.css` 的 CSS 變數。

## 7. 資料模型

新增 migration `011-document-share-links`。

### 7.1 `document_share_links`

```sql
CREATE TABLE document_share_links (
  id           UUID        NOT NULL,
  document_id  UUID        NOT NULL,
  token_hash   BINARY(32)  NOT NULL,
  label        VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  created_by   UUID        NOT NULL,
  created_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expires_at   DATETIME(6) NOT NULL,
  revoked_by   UUID        NULL,
  revoked_at   DATETIME(6) NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_share_links_token_hash UNIQUE (token_hash),
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

```sql
CREATE TABLE document_share_link_views (
  share_link_id   UUID        NOT NULL,
  viewer_user_id  UUID        NOT NULL,
  view_date       DATE        NOT NULL,   -- UTC
  first_viewed_at DATETIME(6) NOT NULL,
  last_viewed_at  DATETIME(6) NOT NULL,
  view_count      INT UNSIGNED NOT NULL,
  PRIMARY KEY (share_link_id, viewer_user_id, view_date),
  CONSTRAINT fk_share_views_link   FOREIGN KEY (share_link_id)  REFERENCES document_share_links(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_share_views_viewer FOREIGN KEY (viewer_user_id) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

每次檢視執行 `INSERT … ON DUPLICATE KEY UPDATE last_viewed_at = …, view_count = view_count + 1`。

**為什麼不寫進 `workspace_audit_events`：** 那張表記錄的是治理 mutation，一次操作一列，由 Team 的 OWNER/ADMIN 在 Audit 頁閱讀。檢視是高頻的讀取事件，逐筆寫入會淹沒治理紀錄，而且 My Space 本來就沒有 Audit 頁（Phase 3 §17）。以「連結 × 檢視者 × 日」彙總，資料量有上限，也足夠回答擁有者真正想知道的「誰看過、最近一次是什麼時候」。

### 7.3 治理事件

建立與撤銷**仍然**寫入 `workspace_audit_events`，並與 mutation 同一個 transaction（Phase 3 §16 的原子性要求）：

| `event_type` | `target_type` | `target_id` | `payload` |
| --- | --- | --- | --- |
| `DOCUMENT_SHARE_LINK_CREATED` | `DOCUMENT_SHARE_LINK` | link id | `{ documentId, expiresAt, label }` |
| `DOCUMENT_SHARE_LINK_REVOKED` | `DOCUMENT_SHARE_LINK` | link id | `{ documentId }` |

`workspace_id` 在寫入當下推導。payload 絕不包含 token 或 token hash。

## 8. Token

- 產生：32 bytes CSPRNG，base64url 編碼（43 字元），URL 為 `/s/<token>`。
- 儲存：只存 `SHA-256(token)`。token 是 256 bit 隨機值，不需要 slow hash。
- 查詢：以 hash 走 unique index，不逐一比對。
- **token 明文只在建立的 HTTP 回應中出現一次**，之後任何 API 都無法取回。
- 產生與 hash 由新的 port（`ShareTokenIssuer`）提供，domain 與 application 層不直接依賴 `node:crypto`，測試可注入固定值。

只存 hash 的直接後果是擁有者**無法事後再複製同一條連結**。這是 §12 的決定 D1；本規格的緩解方式是允許每份文件最多 10 條有效連結並附標籤——要再分享給別人，就建立新的一條，舊連結不受影響。

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
  create(caller, { documentId, label?, expiresInDays }): Promise<{ link: ShareLinkView; token: string }>;
  list(caller, documentId): Promise<ShareLinkView[]>;          // 含彙總後的檢視者清單，不含 token
  revoke(caller, linkId): Promise<void>;
  readShared(caller, token): Promise<SharedDocumentView>;      // 唯一不經 membership 的內容讀取
}
```

`create`、`list`、`revoke` 都走 §5.1 的條件 2（呼叫者必須是 My Space 擁有者），不接受任何由 client 傳入的 workspace ID。

### 9.3 鎖定順序

建立與撤銷遵循 Phase 3 §14.2 的「non-import existing Source」路徑：

```text
Source FOR UPDATE → Workspace FOR UPDATE → 重新驗證 §5.1 → insert/update link + audit
```

與 resync（Source → Workspace）同序，不會造成 lock inversion。`readShared` 不取 row lock：它是讀取，而 §5.2 每次都重新判斷，文件在檢視後一瞬間被封存，下一次檢視自然失效。

### 9.4 路由

| 方法 | 路徑 | 回應 |
| --- | --- | --- |
| `POST` | `/api/documents/:documentId/share-links` | `201 { link, url }`，`url` 只出現這一次 |
| `GET` | `/api/documents/:documentId/share-links` | `200 { links }` |
| `POST` | `/api/share-links/:linkId/revoke` | `204` |
| `GET` | `/s/:token` | 頁面；失效一律 404 |

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
3. **目標狀態**：`status === "ACTIVE"` 且 `revision === "CURRENT"`。在歷史版本上提供分享，會讓人以為分享的是那個版本。

`available()` 決定顯示什麼，service 決定發生什麼：§13 要求分別斷言兩者。

文件頁標頭也提供同一個動作（從 registry 取），與 Edit 並列。

### 10.2 用詞

標籤是「Share link…」，不是「Share」。「Share」在其他產品裡通常包含邀請特定人、給予編輯權；這裡只做一件事，就是產生一條唯讀連結。刪節號表示會先開對話框。

### 10.3 回饋

- 建立成功：結果本身（連結 + 複製按鈕）就顯示在對話框裡，不另外跳 toast——同動作模型規格 §6「會導航到結果本身的操作不給 toast」的精神。
- 撤銷成功：toast，不提供 undo（§5.4）。
- 失敗：錯誤留在對話框的控制項旁。

## 11. Team Workspace 為什麼延後

不是做不到，而是有三個問題 v1 不應該順便決定：

1. **治理繞道。** Team 的成員集合由 OWNER/ADMIN 管理。任何 EDITOR 都能把 Team 文件分享給非成員，等於繞過那套治理。需要一個由 OWNER 控制的 Workspace 設定（例如 `shareLinksAllowed`），以及「誰能建立」的規則（`document.write`？ADMIN 以上？）。
2. **建立者的授權無法離線評估。** §5.2 第 7 條只能看 direct role。在 Team 裡，靠 SSO group 取得存取權的建立者，檢視時無法重新評估——要嘛只允許有 direct role 的人建立，要嘛接受「group 被移除後連結仍有效直到過期」。
3. **稽核可見性。** Team 的 OWNER/ADMIN 應該能在 Audit 頁看到並撤銷成員發出的連結，那是新的治理權限。

這三點應該是一份獨立規格，在 v1 的使用資料出來之後再寫。

## 12. 待拍板的決定

| # | 決定 | 本規格的建議 | 替代方案 |
| --- | --- | --- | --- |
| D1 | token 只存 hash，事後無法再複製 | **採用**，以多條連結 + 標籤緩解 | 以伺服器金鑰加密保存，可重新複製；代價是金鑰管理與輪替 |
| D2 | 期限選項與上限 | **1 / 7 / 30 / 90 天，預設 30，必填** | 允許「永不過期」——不建議，見 §14 第 1 點 |
| D3 | 擁有者能看到檢視者的姓名 | **可以**，檢視頁明示「你的檢視會被記錄」 | 只顯示人數；對 HR 情境較保守，但失去偵測性控制 |
| D4 | 檢視紀錄粒度 | **連結 × 檢視者 × UTC 日** | 逐筆紀錄；更精細，但資料量無上限 |
| D5 | 檢視紀錄寫入失敗時 | **fail closed**（不顯示內容） | fail open；可用性較好，但會有未被記錄的檢視 |

## 13. 完成判準

**領域（單元測試，無 DB）**

- §5.2 的每一條條件各有一個「只有這條不成立 → 無效」的案例。
- §5.1 的每一條條件各有一個拒絕案例；`SOURCE_MANAGED` 文件**可以**建立分享。
- `action-registry`：PERSONAL + ACTIVE + CURRENT 才出現 `document.share`；TEAM、ARCHIVED、HISTORICAL、`confirmed = false` 都不出現。

**整合（MariaDB）**

- 非擁有者、Team 文件、封存文件、第 11 條連結：`create` 被拒，且沒有寫入任何 link 或 audit 列。
- `create` 與 `DOCUMENT_SHARE_LINK_CREATED` 在同一 transaction：模擬 audit 寫入失敗時，link 也不存在。
- 資料庫裡找不到 token 明文；audit payload 不含 token 或 hash。
- 撤銷後、到期後、文件經 resync 變成 ARCHIVED 後、Source 封存後，`readShared` 一律失敗。
- 同一檢視者同一天檢視三次 → 一列，`view_count = 3`。
- 並行：resync apply 與 `create` 同時執行不會死結。

**不擴散（整合或 e2e）**

- 檢視者持有有效連結時：搜尋不到該文件、selector 沒有分享者的 My Space、`/w/.../knowledge/...` 與 `/api/documents/:id` 都是 404。
- 以程式掃描斷言：除了 `readShared`，knowledge 模組中所有回傳 revision 內容的 public 方法都呼叫 `requireMembership`（或既有的 `requireVisibleDocument`）。

**E2E（Playwright）**

- 擁有者右鍵 → Share link… → 建立 → 以另一位使用者開啟連結 → 看到內容與「由 X 分享」。
- 擁有者編輯文件 → 檢視者重新整理 → 看到新內容。
- 擁有者撤銷（含兩段式確認）→ 檢視者重新整理 → 統一的失效頁，HTTP 404。
- `/s/*` 回應帶有 §6.4 的三個 header。

## 14. 已知限制

1. **Hub 沒有使用者生命週期。** 離職的擁有者無法登入，但 Hub 不知道他離職，他發出的連結會存活到過期為止。這是 D2 堅持必填期限、上限 90 天的主要原因。離職的**檢視者**會被 SSO 擋下，不受此影響。
2. **無法阻止公司內部轉寄。** 限定 SSO 擋得住公司外的人，擋不住同事之間轉傳。檢視紀錄（D3）是事後偵測，不是事前防止。
3. **token 在 URL 裡。** 會出現在瀏覽器歷史紀錄，也可能出現在反向代理的 access log。部署時應遮罩 `/s/` 路徑；這是部署設定，不在本規格的程式範圍內，但要列入上線檢查清單。
4. **沒有資料分類。** 系統無法得知一份文件是否含敏感 HR 資料，也就無法禁止分享它。若之後引入分類，分享連結是第一個應該接上的地方。
5. **相對連結與圖片對檢視者無效。** Assets 目前只存 metadata，Hub 內部連結檢視者也打不開。

## 15. 拍板後要同步修改的文件

實作 PR 必須在同一個 PR 內完成，避免規格與契約分開漂移：

- `CLAUDE.md`：§3.2 的文字。
- Phase 3 spec §13：§3.3 的例外段落。
- `README.md` 的 canonical documents 表：加入本規格與對應的 implementation plan。
- `frontend-design-language.md`：如果 `share` 圖示或閱讀頁需要新的 token，依契約規定一併修改。
