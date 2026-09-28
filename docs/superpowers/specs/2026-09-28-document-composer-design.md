# 文件編輯器（Document Composer）— 設計規格

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-28 |
| 類型 | 設計規格，供實作前審查 |
| 回應 | 對照 Linear 設計語言的 UI/UX 審查第 2 項；`frontend-design-language.md` §18 Open items 第 3 項（編輯與閱讀是兩個不同的頁面；該項由 PR #61 加入） |
| 對照契約 | `docs/superpowers/specs/frontend-design-language.md` §7（page containers）、§10（Focus and keyboard）、§15（component architecture） |
| 對照規格 | `2026-09-16-phase-5-human-authoring-design.md`（authoring API、409 conflict）、`2026-09-24-keyboard-shortcuts-design.md`（`E`、`⌘Enter`、`Esc`） |
| 狀態 | 已實作。驗證見 docs/superpowers/verification/2026-09-28-document-composer-verification.md。 |

## 1. 現況（實測，非引述）

對照 `main` @ `060b8eb`。

- 編輯頁 `…/[documentId]/edit` 是一張表單：「Title」輸入框、「Markdown」textarea、Save／Cancel 按鈕（`src/components/knowledge/document-editor.tsx:74-102`）。新增頁 `/knowledge/new` 是另一張相同形式的表單（`new-document-form.tsx`）。兩者都不像使用者剛才在讀的那份文件。
- 閱讀頁在 Markdown 以 `#` H1 開頭時不另外顯示標題，由 H1 擔任視覺上的標題；revision 的 `title` 仍是側欄、搜尋與麵包屑最後一段所用的名稱（`src/lib/markdown-title.ts`）。
- 標題因此有兩個來源：revision `title` 欄位，與 Markdown 開頭的 H1。表單讓兩者各自可改，改了 H1 的使用者會發現文件在其他地方的名稱沒變。
- 上傳時的標題依 frontmatter → 第一個 H1 → 檔名決定；frontmatter 會從 Markdown 拿掉、另存為 revision metadata（`src/server/authoring-input.ts:45-57`）。Web 編輯時 metadata 原封帶到新 revision（`src/app/api/documents/[documentId]/route.ts`）。
- 已有「是否有修改」的判斷（`document-editor.tsx:44`），但沒有任何離開保護：`src` 內沒有 `beforeunload`。
- `NewDocumentForm` 的 `variant: "sidebar"` 沒有任何呼叫者，是死碼。
- 沒有編輯器套件；Markdown 渲染只用 `react-markdown` + `remark-gfm`。

## 2. 決定

| # | 問題 | 決定 | 理由 |
| --- | --- | --- | --- |
| 1 | 編輯原始碼還是所見即所得 | **Markdown 原始碼** | revision 存的是 Markdown 字串。所見即所得編輯器會「解析 → 內部模型 → 重新序列化」，這個來回不保證不變（`*` 變 `_`、清單符號、表格空白），使用者改一個字，其餘格式也可能被改寫並記進 revision。原始碼編輯沒有這個損失，也不需要新套件。 |
| 2 | 標題怎麼改 | **跟著內容走**：metadata title → 開頭 H1 → 標題欄（第 4 節） | 一份文件只有一個標題，與閱讀頁判斷條件相同。metadata 優先是為了與上傳的優先順序一致，不讓 revision 的 `title` 與它自己帶的 metadata 互相矛盾。 |
| 3 | 預覽 | **同一欄切換**，不並排 | 並排會把閱讀欄切半，與閱讀頁差最多；不預覽則每次確認排版都得多存一個 revision。 |
| 4 | 未存修改離開 | **分頁內暫存（sessionStorage）+ 還原**，另加 `beforeunload` | Next App Router 沒有攔截站內導航的 API，攔截式確認擋不住瀏覽器「上一頁」。暫存對所有離開方式都有效，且不產生 revision。 |
| 5 | 範圍 | **新增與編輯共用同一個編輯器** | 只改一邊，會有兩套標題規則不同的編輯器。 |
| 6 | 路由 | **保留 `/edit`、`/new`**，版面改成與閱讀頁相同 | 伺服器端的權限檢查（`edit/page.tsx:18-23`）留在門口；存檔後導航沿用 #49、#59、#60 修好的路徑；重新整理仍在編輯器。就地切換會把權限判斷搬到 client、改用 `router.refresh()`（#49 的起因），並推翻 #58 的「Edit 整頁載入」。 |
| 7 | 標題規則放哪 | **client 端共用純函式**，API 契約不變 | 「標題與 H1 一致」是 Web 編輯器的呈現慣例，不是 domain 不變量。`PATCH`／`POST` 仍收明確的 `title`，之後的 API 呼叫端（如 MCP）可以自行指定。 |

## 3. 版面與元件

編輯頁、新增頁與閱讀頁共用同一副骨架：`kh-reading-column` 內 `pt-5 pb-3` 的一行（左麵包屑、右動作），下接同欄寬 `py-6` 的內容。與閱讀頁的差別只有：

- 右側動作是 **Preview**（切換，`aria-pressed`）、**Cancel**、**Save**，取代 Edit／Share／Details。
- 麵包屑最後一段即時顯示將存成的標題（新增頁為 `New document`，解析出標題後改為標題）。
- 內容是無邊框的 textarea，而不是渲染後的文章。

| 單元 | 位置 | 職責 | 依賴 |
| --- | --- | --- | --- |
| `DocumentBreadcrumb` | 從 `document-header.tsx` 抽出 | 只畫麵包屑；閱讀頁與編輯器共用 | 無 |
| `documentLocation` | `src/server/document-location.ts` | 由 tree 算出 source › 資料夾路徑，不含文件本身；閱讀頁與 `/edit` 共用，各自附加標題 | explorer model |
| `resolveAuthoredTitle` | `src/lib/authored-title.ts` | 純函式，第 4 節 | `mdast-util-from-markdown`、`mdast-util-to-string` |
| draft store | `src/lib/document-draft.ts` | 純函式：讀、寫、刪，注入 `Storage`；`browserDraftStorage()` 取得分頁的 `sessionStorage` | 無 |
| `DocumentComposer` | `src/components/knowledge/document-composer.tsx` | 編輯器本體：標題欄（需要時）、textarea、預覽、動作、錯誤、還原提示；`blocked` 讓另一個操作（如上傳）獨佔頁面，`footer` render prop `(state: { busy }) => ReactNode` 在 `<form>` 外渲染。存檔動作由外部傳入 | 以上各項、`MarkdownRenderer`、`useFormKeys` |
| `DocumentEditor`、`NewDocumentForm` | 既有檔案 | 變成薄包裝：組好 composer 的初始值，呼叫 `PATCH` 或 `POST` | `DocumentComposer` |

實作時把 `useDraft` 併入 draft store：三個呼叫不需要一個 hook。

- `NewDocumentForm` 的 `sidebar` 變體移除。上傳檔案功能留在新增頁；新增頁把 `DocumentComposer` 的 `blocked` 接上傳狀態、`footer` 放上傳按鈕，使打字新增與上傳互斥（沿用舊表單的行為）。
- 不變：路由、伺服器端權限檢查、API 契約、存檔後的導航（`refreshOnArrival` + `router.push`）、閱讀頁行為。
- `/edit` 的 page 需要多傳 `location`（`documentLocation(...)`，source 與資料夾、不含文件本身）與 `metadataTitle`（取自 current revision 的 metadata）；composer 在其後附加解析出的標題。

## 4. 標題規則

`resolveAuthoredTitle({ metadataTitle, markdown, typedTitle })` 回傳 `{ title, source }`，依序：

1. `metadataTitle` 是非空字串（trim 後）→ `source: "METADATA"`。只會出現在帶 frontmatter title 上傳的文件。
2. `markdownOpensWithHeading(markdown)` 成立，且開頭那個 H1 以 mdast `toString` 取出、trim 後非空 → `source: "H1"`。文字取法與匯入相同，所以 `# **季度** 目標` 得到 `季度 目標`。
3. 否則 → `typedTitle.trim()`，`source: "TYPED"`。

判斷「開頭」而非匯入用的「第一個 H1」：編輯器要與閱讀頁顯示的是同一個標題，閱讀頁看的是開頭。

畫面規則：

- 只有 `source === "TYPED"` 時顯示標題欄：大字、無邊框，位於 textarea 上方，`aria-label="Title"`。
- `METADATA` 時，麵包屑下方一行 caption：「標題來自上傳檔案的 frontmatter」，讓使用者知道改 H1 不會改名。
- 來源由 `H1` 轉為 `TYPED`（使用者刪掉開頭 H1）時，標題欄預填剛才的 H1 文字，名稱不會突然變空。
- 解析結果為空 → Save 停用（與現況相同，由 `useFormKeys` 經 submit 按鈕的 `disabled` 一併擋住 `⌘Enter`）。
- 送出時 `title` 一律是解析結果，長度上限仍由伺服器的 `MAX_TITLE_LENGTH` 把關。

## 5. 暫存與還原

**儲存**

- key：編輯 `kh:draft:edit:<documentId>`；新增 `kh:draft:new:<workspaceId>`。
- 值：`{ v: 1, title, markdown, baseRevisionId }`（新增無 `baseRevisionId`）。`title` 存的是標題欄輸入值，不是解析結果。
- 內容與初始值不同就寫入，改回初始值就刪除。
- 所有存取都包 try/catch；配額不足、無痕模式、JSON 損壞、版本不符都視為「沒有稿子」，不顯示錯誤、不影響編輯。

**還原**

- hydration 之後讀取（伺服器端沒有 `sessionStorage`；表單本來就等 hydration 才可用）。
- 欄位與 Save 要等還原檢查跑完（`restoreChecked`）才啟用：hydration 一旦提交就開放輸入，會讓打字落在 sessionStorage 讀取完成前的空檔，被稍後才到的還原內容蓋掉。
- 有稿子 → 還原，內容上方顯示「已還原未存的修改 · 捨棄」。
- 稿子的 `baseRevisionId` 不是目前的 current revision → 照樣還原，但 `expectedCurrentRevisionId` 用稿子的基準版本，提示改為「這份文件在你離開後被更新過」。存檔會走既有的 409 衝突流程，不會默默覆蓋別人的修改。

**清除**：存檔成功、Cancel、按「捨棄」。

**離開**

- Cancel：有修改時先 `window.confirm("Discard changes?")`（新增頁現況即如此，編輯頁補上）；確認後清除暫存並離開。
- `Esc`：規則不變——有修改時不做事（預覽中另見第 6 節）。
- `beforeunload`：有修改時才掛上，擋關分頁。重新整理也會觸發這個提示（瀏覽器無法區分），但即使離開，暫存仍在。
- 站內導航（側欄、palette、上一頁）：不攔截，靠暫存還原。

## 6. 預覽、快捷鍵與輸入區

**預覽**

- 預覽用閱讀頁同一個 `MarkdownRenderer`，外層與 `DocumentViewer` 相同的 `<article>` 樣式；圖片政策（`markdown-image-policy.ts`）相同。
- `source === "TYPED"` 時預覽上方顯示與閱讀頁相同的 `<h1>`；`H1` 時由 Markdown 自己顯示。
- textarea 在預覽時**只加 `hidden`，不卸載**，保留瀏覽器原生的復原紀錄與游標位置。
- 切到預覽時焦點移到預覽區（`tabIndex={-1}`）；切回編輯時焦點回到 textarea 原游標位置。
- 預覽中可存檔，`⌘Enter` 照常有效。

**快捷鍵**（只掛在編輯器的 `<form>` 上，擴充 `useFormKeys`，不新增全域監聽）

| 按鍵 | 行為 |
| --- | --- |
| `⌘/Ctrl ⇧ P` | 切換預覽 |
| `⌘/Ctrl Enter` | 存檔（不變） |
| `Esc` | 預覽中 → 回到編輯；編輯中且無修改 → 離開；有修改 → 不做事 |

`⌘/Ctrl ⇧ P` 與 GitHub Markdown 編輯器相同。已知風險：Firefox 的 `Ctrl ⇧ P` 是開私密視窗，可能屬於網頁無法攔截的保留快捷鍵。實作時先在 Firefox 實測；攔不住就換一組按鍵，並回寫本節與 verification 紀錄。

2026-09-29：尚未在 Firefox 實測（見 verification 紀錄）。

**輸入區**

- 無邊框、無背景，使用閱讀頁的內文字體與字級（非等寬）。代價：表格與程式碼區塊的原始碼不對齊。
- 高度隨內容增長（`input` 時設為 `scrollHeight`），捲動的是整頁，不出現框中框捲軸。
- 進入時自動聚焦，游標在最前。
- 標題欄與 textarea **不套 `kh-focus-ring`**。文字欄位聚焦時一律符合 `:focus-visible`，外框會在整個編輯期間框住整張畫布；閃爍的游標本身就是焦點指示，而 Preview／Cancel／Save 等控制項照常套焦點環。這是設計語言 §10 單一焦點環規則的例外，須記入契約。
- `E` 從閱讀頁整頁載入 `/edit`（#58）不變。

## 7. 錯誤處理

- 伺服器錯誤沿用 `GovernanceError`，顯示在內容上方，輸入不動。
- **409 衝突**：現有「重新載入最新版本」連結指向 `/edit`；有了暫存後，重新載入會還原舊基準的稿子並再次衝突，形成迴圈。改為：先清除暫存再整頁載入，文字改為「載入最新版本（捨棄你的修改）」。按下前使用者的輸入仍在畫面上，可自行複製。
- 暫存讀寫失敗：見第 5 節，靜默略過。
- 標題解析為空：Save 停用，按鈕 `title` 說明原因。

## 8. 測試

先列情境，再寫測試。

**單元（node 環境）**

- `resolveAuthoredTitle`：metadata 優先；開頭 H1；H1 帶行內格式取純文字；H1 不在開頭 → `TYPED`；只有圖片且 alt 為空的 H1 → TYPED（alt 文字會被取用，與匯入相同）；BOM 與前導空行；metadata title 為空字串或非字串 → 往下；標題欄 trim；全空 → 空結果。
- draft store（注入假 `Storage`）：有修改才寫入、改回初始值即刪除；損壞 JSON 回 `null`；版本不符回 `null`；`Storage` 丟例外時不外洩；編輯與新增 key 互不干擾。

**E2E（Playwright）**

- 以 H1 開頭：無標題欄；改 H1 時麵包屑即時更新；存檔後側欄顯示新名稱。
- 無 H1：顯示標題欄；刪掉開頭 H1 時標題欄預填原 H1。
- 帶 frontmatter title 的上傳文件：改 H1 不改名，顯示說明。
- 預覽：按鈕與快捷鍵皆可切換；切回後內容與游標仍在；預覽中 `Esc` 回編輯；預覽中 `⌘Enter` 存檔。
- 暫存：輸入後從側欄離開、按 `E` 回來 → 還原提示；「捨棄」後清空。
- 暫存 + 衝突：離開期間他人存檔 → 還原後存檔得 409；「載入最新版本」後不再還原舊稿。
- 有修改時按 Cancel → 確認框。
- 新增頁：只寫 H1 即可建立，標題取自 H1。
- 既有 `phase5-authoring.spec.ts`、`keyboard-shortcuts.spec.ts` 的選擇器依新欄位名更新：欄位名稱統一為 `Title` 與 `Markdown`，新增頁不再用 `Document title`。

**手動**：Firefox 上 `Ctrl ⇧ P` 的結果，記入 verification。

**完成標準**：`make verify` 與 `make test-e2e` 全部通過，並補 verification 紀錄。

## 9. 不做的事

- 所見即所得、語法高亮、工具列、斜線指令。
- 自動存檔成 revision；跨分頁或跨裝置的草稿（localStorage／伺服器端草稿）。
- 攔截站內導航的確認框。
- 伺服器端強制「標題 = H1」。
- metadata（frontmatter）的 Web 編輯——Phase 5 spec §6.3 的決定不變。

## 10. 對其他文件的影響

- `frontend-design-language.md` §10 快捷鍵表：加入 `⌘/Ctrl ⇧ P`，並記下 `Esc` 在預覽中的行為。焦點一節記下編輯畫布不套焦點環的例外（第 6 節）。§18 第 3 項於實作合併後關閉。
- `2026-09-24-keyboard-shortcuts-design.md` 第 5 節（表單按鍵）：指向本規格第 6 節。
- README canonical 表：加入本規格與實作計畫。
