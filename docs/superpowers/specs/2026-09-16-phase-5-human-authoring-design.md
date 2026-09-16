# Knowledge Hub — Phase 5 Human Authoring Design

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-16 |
| 文件定位 | Phase 5 canonical design：HUB_MANAGED Knowledge 的 Web 建立／編輯與單篇 Markdown upload |
| 決策依據 | Phase 1 已落地的 Hub command 路徑、Phase 3 capability model、Phase 2 title resolution、Phase 4 交付面慣例 |
| 前置條件 | Phase 4 Discovery & Read API 已合併至 `main`（commit `5ee5816`） |
| 專案入口 | [README](../../../README.md) |

## 1. 決策摘要

Phase 5 是**交付層 phase**，不是 domain phase。

roadmap Phase 5 列出的四條主要交付裡，有三條的規則在 Phase 1 就已經實作並被測試鎖住。本 Phase 不重寫它們，只是把它們接到 HTTP 與 UI 上。

```text
使用者在文件頁按 Edit
→ 既有的 createRevision(caller, { documentId, expectedCurrentRevisionId, title, markdown })
→ 既有的 capability + HUB_MANAGED guard
→ 既有的 immutable Revision 寫入
```

**不新增 schema、不新增 migration、不新增 domain 規則、不新增 port。** 新增的只有：一個 Source provisioning 規則、兩條 HTTP 路由、一個編輯頁。

## 2. 目標

- 使用者可以在 Web 上建立與編輯 HUB_MANAGED 文件，變更保存為 immutable Revision。
- 使用者可以上傳單篇 `.md`，title 解析行為與 folder import 完全一致。
- 兩人同時編輯時，後送出者得到明確的衝突提示，不覆蓋對方的內容。
- SOURCE_MANAGED 內容在 UI 上不出現編輯入口，直接打 API 也被擋。

## 3. 非目標

- Markdown merge、三方合併、自動解衝突：roadmap Phase 5「範圍外」已明列。
- metadata（frontmatter）編輯介面：目前沒有既定 key 慣例，與 Phase 4 spec §3 的判斷一致，等真實需求出現再加。
- 樹狀操作 UI（新增資料夾、改名、移動、封存／還原）：application 方法已存在，但不在 roadmap Phase 5 交付清單內。
- 多個 Hub Source 的手動建立與命名：見 §5 的升級路徑。
- ownership conversion（SOURCE_MANAGED ↔ HUB_MANAGED）、雙向 sync：roadmap 範圍外。
- 富文字編輯器、即時預覽、自動儲存。

## 4. 既有基礎盤點

這一節是本 Phase 範圍判斷的依據，每一列都經程式碼確認。

| roadmap 交付 | 既有實作 | 位置 |
| --- | --- | --- |
| 單篇 Markdown upload | `parseGenericMarkdownText`（frontmatter + 第一個 H1）與 `resolveImportTitle`（FRONTMATTER → H1 → FILENAME 優先序）皆已匯出 | `src/modules/sources/adapters/generic-markdown-folder-adapter.ts:86`、`src/modules/sources/domain/import-title.ts:6` |
| Web create／edit | `createDocument` 與 `createRevision`，各自在單一 READ COMMITTED transaction 內完成 | `src/modules/knowledge/application/internal/create-document.ts:26`、`internal/create-revision.ts:32` |
| 變更建立 immutable Revision | `fingerprintRevisionContent` → N+1 insert → `setCurrentRevision`；內容未變則回 `changed: false` 且不產生新版本 | `internal/create-revision.ts:51-63` |
| stale-editor conflict | `expectedCurrentRevisionId` 與鎖定後的 current revision 不符即丟 `RevisionConflictError` | `internal/create-revision.ts:50` |
| 先過 Workspace capability，再驗 HUB_MANAGED ownership | `lockWorkspaceForMutation(…, "content-write")` 檢查 `document.write`；`source.ownership !== "HUB_MANAGED"` 丟 `SourceReadOnlyError` | `src/modules/workspaces/application/workspace-mutation-guard.ts:57`、`internal/create-revision.ts:43` |
| SOURCE_MANAGED read-only guard | 四條 Hub 寫入路徑都有同一組 ACTIVE + HUB_MANAGED 檢查 | `internal/create-document.ts:34-35` 等 |
| My Space 可寫 | `assertPersonalMutationAllowed` 對 `content-write` 直接放行，只凍結治理操作 | `src/modules/workspaces/application/personal-workspace-service.ts:38` |

因此 Phase 5 的實際缺口只有三個：

1. `src/app/api/` 底下**沒有任何 knowledge 寫入路由**。
2. `src/components/` 底下**沒有任何 authoring 元件**。
3. **HUB_MANAGED Source 沒有任何建立管道**：`repositories.sources.insert` 的呼叫者只有 folder import 的 apply（`apply-folder-import.ts:163`）與 `scripts/db/seed.ts`。使用者在 UI 上無法開一個 Hub Source，所以「新文件放哪」必須由本 Phase 解掉。

## 5. 預設 Hub Source lazy provisioning

### 5.1 規則

每個 Workspace 有一個名為 `Notes` 的預設 Hub Source，在**第一次建立文件時** lazy 建立：

```text
POST /api/workspaces/{id}/documents
→ ensureDefaultHubSource(caller, workspaceId)   ← transaction 1
→ createDocument(caller, { sourceId, parentId: null, title, markdown, metadata: {} })   ← transaction 2
```

`ensureDefaultHubSource` 的內容：鎖 Workspace row → 在該 Workspace 內找 `sourceType = "HUB"`、`status = "ACTIVE"` 且 `name = "Notes"` 的 Source → 找到就回其 id，沒有就以 `uuidv7()` 建立後回傳。

模組歸屬：`src/modules/sources/application/ensure-default-hub-source.ts`，跑在 `SourceUnitOfWork` 上。`SourceRepositories` 已經是 `KnowledgeRepositories & { sources, workspaces, workspaceMemberships, groupMappings, … }`（`src/modules/sources/ports/unit-of-work.ts:16`），`sources.insert` 與 `lockWorkspaceForMutation` 所需的 repositories 全都拿得到，**不需要任何 port 變更**。Source 的建立留在 sources 模組，knowledge 模組不會長出建立 Source 的能力。

### 5.2 為什麼是獨立 transaction

現行全域鎖序是 `Snapshot → Source → Workspace → deeper`（`workspace-mutation-guard.ts:22`）。建立新 Source 時沒有 Source 可鎖，必須反過來先鎖 Workspace。

拆成獨立 transaction 後，provisioning 只持有 Workspace 鎖、`createDocument` 照舊先鎖 Source 再鎖 Workspace，兩者不會同時持有兩個鎖，因此不構成 deadlock 環，也不必修改四條既有寫入路徑。代價是兩次 round trip 與「Source 建了但文件建立失敗」會留下一個空 Source——一個空的 `Notes` Source 沒有副作用，下次建立會重用它，不需要補償交易。

### 5.3 併發

兩個請求同時對同一個 Workspace 建立第一篇文件時，`lockWorkspaceForMutation` 的 Workspace row lock 序列化兩者：先到者建立，後到者在拿到鎖後讀到已存在的 `Notes` 並重用。不依賴唯一鍵，因為 `knowledge_sources` 沒有 `(workspace_id, name)` 唯一約束，本 Phase 也不新增。

### 5.4 授權動詞

provisioning 使用 `"content-write"`（要求 `document.write`），不是 `"source-import"`（要求 `source.manage`）。理由：使用者的動作是撰寫文件，Source 建立只是附帶結果，授權判斷應對齊使用者實際意圖。現行角色模型下 EDITOR 以上同時具備兩者，所以這個選擇目前不可觀測；明確寫下是為了未來拆分角色時不會誤判。

### 5.5 升級路徑

需要多個 Hub Source 分類時，再於 Sources 頁加「New Hub source」建立流程，與既有的「Import folder」對稱；`ensureDefaultHubSource` 屆時退化為「沒有任何 Hub Source 時的預設值」。本 Phase 不預先建立這條路徑。

## 6. HTTP 交付面

### 6.1 兩條路由

沿用 `workspaceHttp` + `requestFields`（`src/server/workspace-http.ts`）：

| 路由 | body | 行為 |
| --- | --- | --- |
| `POST /api/workspaces/[workspaceId]/documents` | `{ title, markdown }` | `ensureDefaultHubSource` → `createDocument`，回 `{ documentId, sourceId }` |
| `POST /api/workspaces/[workspaceId]/documents` | `{ filename, markdown }` | 單篇 upload：`parseGenericMarkdownText` + `resolveImportTitle` 得 title，其餘同上 |
| `PATCH /api/documents/[documentId]` | `{ title, markdown, expectedCurrentRevisionId }` | `createRevision`，回 `{ revisionId, revisionNo, changed }` |

### 6.2 upload 不另開路由

瀏覽器以 `<input type="file" accept=".md,.markdown">` 讀成字串後送同一條 JSON 路由，帶 `filename` 就走 title resolution，帶 `title` 就直接用。不收 multipart、不加解析依賴。

`title` 與 `filename` 互斥：兩者皆給或皆不給都回 `INVALID_REQUEST`。

### 6.3 requestFields 零變更

四個欄位（`title`／`filename`／`markdown`／`expectedCurrentRevisionId`）都是 string，`requestFields` 現行只支援 string 欄位的限制剛好不構成阻礙。`metadata` 不開放編輯（§3），一律以 `{}` 傳入；既有文件的 metadata 在編輯時**原樣保留**——`createRevision` 的呼叫端先讀出 current revision 的 metadata 再原樣回填，避免編輯一次就清空 folder import 帶進來的 frontmatter。

### 6.4 上限

`title` 512 字元、`markdown` 5 MiB，與 `KM_IMPORT_MAX_MARKDOWN_FILE_BYTES` 的預設值一致，超過回 `INVALID_REQUEST`。

## 7. 授權與錯誤映射

### 7.1 授權

完全沿用，不新增授權概念。寫入一律經 `lockWorkspaceForMutation(…, "content-write")` → `document.write`；VIEWER 不具備。route 與 body 裡的 ID 只是導覽範圍，不是授權證明。

### 7.2 錯誤映射必須擴充

`toWorkspaceErrorResponse`（`src/server/http-error-response.ts:61`）目前以三份 code 清單決定狀態碼，**未列出的 DomainError 一律落到 500**。Phase 5 的兩個關鍵錯誤都不在清單內，所以這不是「沿用既有映射」就能成立的：

| code | 現況 | 本 Phase 要求 |
| --- | --- | --- |
| `REVISION_CONFLICT` | 500 | **409** — stale-editor 衝突是使用者可修正的狀態，不是伺服器錯誤 |
| `SOURCE_MANAGED_READ_ONLY` | 500 | **409** — 對 SOURCE_MANAGED 內容寫入 |
| `INVALID_TITLE`／`INVALID_METADATA` | 500 | **400** |
| `DOCUMENT_NOT_FOUND`／`SOURCE_NOT_FOUND` | 500 | **404**（非列舉語意，與既有 `HIDDEN_NOT_FOUND` 一致） |
| `SOURCE_ARCHIVED`／`DOCUMENT_ARCHIVED` | 500 | **409** |
| `WORKSPACE_ACCESS_DENIED` | 404 | 維持 404 — 沿用既有非列舉慣例；UI 本來就不對 VIEWER 顯示編輯入口 |

## 8. UI

### 8.1 actions

`WorkspaceActions` 增加 `canWrite: has("document.write")`，與 `canSearch` 同一套模式（`src/server/workspace-admin.ts:46`）。導覽／按鈕的顯示與否不是 security boundary，server 端仍獨立授權（Phase 4 spec §7.4 同一原則）。

### 8.2 編輯頁

新頁 `/w/[workspaceId]/knowledge/[sourceId]/[documentId]/edit`，元件 `src/components/knowledge/document-editor.tsx`：

- title 用既有 `ui/input.tsx`，markdown 用既有 `ui/textarea.tsx`，**不引入編輯器依賴**。
- 表單持有載入當下的 `expectedCurrentRevisionId`。
- Save → `PATCH`，成功後導回文件頁並 `router.refresh()`；Cancel → 直接導回。
- `changed: false`（內容未變）不視為錯誤，行為與成功相同。

### 8.3 入口

- 文件頁已同時載入 `explorer`（`SourceView` 帶 `ownership`）與 `shell`（帶 `access.actions`），見 `src/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/page.tsx:77-78`，因此 Edit 按鈕不需要新的 read model。
- 顯示條件：`canWrite && source.ownership === "HUB_MANAGED" && status === "ACTIVE" && 非歷史版本檢視`。
- `DocumentHeader` 目前寫死 `<Badge variant="outline">Read only</Badge>`（`document-header.tsx:72`），改為依 ownership 呈現：SOURCE_MANAGED 保留 Read only，HUB_MANAGED 不顯示該 badge 並顯示 Edit。
- Knowledge 頁加 `New document` 與 `Upload .md`，沿用 Sources 頁 `Import folder` 的按鈕樣式與 `kh-*` token。

### 8.4 衝突呈現

409 `REVISION_CONFLICT` 顯示「這份文件已被其他人更新」，附「重新載入最新版本」連結。**不自動覆蓋、不自動合併、不保留使用者草稿到伺服器**；使用者的輸入留在表單內，由使用者自行取捨。

## 9. 測試計畫

### 9.1 單元測試（不需 DB）

| # | 需求來源 | 測試 |
| --- | --- | --- |
| U1 | §8.1 | `deriveWorkspaceActions`：具 `document.write` 時 `canWrite` 為 true，VIEWER 為 false |
| U2 | §6.1、§6.2 | body 驗證：缺欄位、非字串、`title` 與 `filename` 同時給、兩者都不給 |
| U3 | §6.2 | `filename` 分支：frontmatter title 優先於 H1，皆無則用檔名去副檔名 |
| U4 | §7.2 | `toWorkspaceErrorResponse`：`REVISION_CONFLICT` → 409、`SOURCE_MANAGED_READ_ONLY` → 409、`INVALID_TITLE` → 400、`DOCUMENT_NOT_FOUND` → 404 |
| U5 | §6.4 | 上限：`title` 超過 512、`markdown` 超過 5 MiB 回 `INVALID_REQUEST` |

### 9.2 整合測試（需 DB）

| # | 需求來源 | 測試 |
| --- | --- | --- |
| I1 | §5.1 | 空 Workspace 建立第一篇文件：自動產生 `Notes` Source，文件掛在其 root |
| I2 | §5.3 | `ensureDefaultHubSource` 冪等：連呼兩次回同一個 sourceId，`knowledge_sources` 只增加一列 |
| I3 | §4 | 建立產生 revision 1；編輯產生 revision 2，且 revision 1 內容不變 |
| I4 | §4 | **內容未變不產生新版本**：以相同 title/markdown 再送一次，`changed: false` 且版本數不變 |
| I5 | §4 | stale `expectedCurrentRevisionId` → `REVISION_CONFLICT`，且文件的 current revision 未被覆蓋 |
| I6 | §7.1 | VIEWER 建立與編輯皆被拒 |
| I7 | §4 | SOURCE_MANAGED 文件的編輯被拒（`SOURCE_MANAGED_READ_ONLY`） |
| I8 | §6.3 | metadata 保留：對一份帶 frontmatter metadata 的文件編輯後，新 revision 的 metadata 與舊版相同 |
| I9 | §5.4 | My Space（PERSONAL workspace）可建立與編輯 |
| I10 | §6.2 | 單篇 upload：frontmatter title、H1、檔名三種來源各產生預期 title |

### 9.3 E2E（Playwright）

| # | 測試 |
| --- | --- |
| E1 | 在 Workspace 建立新文件 → 出現在 Tree → 開啟後內容正確 |
| E2 | 編輯既有 HUB_MANAGED 文件 → 版本歷史出現兩版 |
| E3 | SOURCE_MANAGED 文件頁看不到 Edit 按鈕，且顯示 Read only |
| E4 | 上傳一份 `.md` → title 取自 frontmatter |

### 9.4 Fixture

重用 seed 既有的 HUB_MANAGED 與 SOURCE_MANAGED Source。E2E 需要一個**完全沒有 Hub Source 的 Workspace** 來覆蓋 I1 的 lazy provisioning 路徑；依 Phase 4 verification 記錄的教訓，新 fixture 必須加在 `seedBrowserFixtures` 既有的「是否為全新資料庫」空表判斷**之後**，以獨立 `unitOfWork.run` 區塊寫入。

## 10. 驗收條件

- 建立與編輯都產生 immutable Revision，內容未變不產生新版本（I3、I4）。
- 兩人同時編輯，後送出者得到 409 且不覆蓋對方內容（I5）。
- VIEWER 與 SOURCE_MANAGED 的寫入一律被拒，UI 上也沒有入口（I6、I7、E3）。
- 既有 metadata 不因編輯而遺失（I8）。
- 單篇 upload 的 title 解析與 folder import 一致（I10、E4）。
- §9 所有測試案例通過；`make verify`、`npm run test:integration`、`npm run test:e2e` 三個 gate 全綠。
