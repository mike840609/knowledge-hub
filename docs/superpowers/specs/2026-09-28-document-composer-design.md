# 文件編輯器（Document Composer）— 設計規格

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-28 |
| 類型 | 設計規格，供實作前審查 |
| 回應 | 對照 Linear 設計語言的 UI/UX 審查第 2 項；`frontend-design-language.md` §18 Open items 第 3 項（編輯與閱讀是兩個不同的頁面；該項由 PR #61 加入） |
| 對照契約 | `docs/superpowers/specs/frontend-design-language.md` §7（page containers）、§10（Focus and keyboard）、§15（component architecture） |
| 對照規格 | `2026-09-16-phase-5-human-authoring-design.md`（authoring API、409 conflict）、`2026-09-24-keyboard-shortcuts-design.md`（`E`、`⌘Enter`、`Esc`） |
| 狀態 | 第 1–10 節（Markdown 原始碼編輯器）已實作，驗證見 `docs/superpowers/verification/2026-09-28-document-composer-verification.md`。**第 11 節（2026-09-29 修訂：預設渲染編輯、可切換原始碼）待實作**，它取代決定 1、決定 3，以及第 6 節的預覽與快捷鍵。 |

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
| 1 | 編輯原始碼還是所見即所得 | **預設渲染編輯（Milkdown），可切換到 Markdown 原始碼**（第 11 節） | 2026-09-29 修訂。初版選原始碼，理由是所見即所得編輯器會「解析 → 內部模型 → 重新序列化」，不保證原樣（`*` 變 `-`、表格空白、不認得的語法），使用者改一個字，其餘格式也可能被改寫並記進 revision。產品決定改為與 Linear 一致的渲染編輯並**接受這個正規化**；每個 revision 不可變，改寫前的原文仍在上一個 revision，可在歷史中檢視。原始碼模式保留，作為看到實際 Markdown 的出口。 |
| 2 | 標題怎麼改 | **跟著內容走**：metadata title → 開頭 H1 → 標題欄（第 4 節） | 一份文件只有一個標題，與閱讀頁判斷條件相同。metadata 優先是為了與上傳的優先順序一致，不讓 revision 的 `title` 與它自己帶的 metadata 互相矛盾。 |
| 3 | 預覽 | ~~同一欄切換~~ **已取代**：渲染模式本身就是預覽，Preview 按鈕由「渲染 ⇄ Markdown」切換取代（第 11 節） | 原理由（不並排、不用多存 revision 來確認排版）仍成立，渲染模式直接滿足。 |
| 4 | 未存修改離開 | **分頁內暫存（sessionStorage）+ 還原**，另加 `beforeunload` | Next App Router 沒有攔截站內導航的 API，攔截式確認擋不住瀏覽器「上一頁」。暫存對所有離開方式都有效，且不產生 revision。 |
| 5 | 範圍 | **新增與編輯共用同一個編輯器** | 只改一邊，會有兩套標題規則不同的編輯器。 |
| 6 | 路由 | **保留 `/edit`、`/new`**，版面改成與閱讀頁相同 | 伺服器端的權限檢查（`edit/page.tsx:18-23`）留在門口；存檔後導航沿用 #49、#59、#60 修好的路徑；重新整理仍在編輯器。就地切換會把權限判斷搬到 client、改用 `router.refresh()`（#49 的起因），並推翻 #58 的「Edit 整頁載入」。 |
| 7 | 標題規則放哪 | **client 端共用純函式**，API 契約不變 | 「標題與 H1 一致」是 Web 編輯器的呈現慣例，不是 domain 不變量。`PATCH`／`POST` 仍收明確的 `title`，之後的 API 呼叫端（如 MCP）可以自行指定。 |

## 3. 版面與元件

編輯頁、新增頁與閱讀頁共用同一副骨架：`kh-reading-column` 內 `pt-5 pb-3` 的一行（左麵包屑、右動作），下接同欄寬 `py-6` 的內容。與閱讀頁的差別只有：

- 右側動作是 **渲染／Markdown 切換**（`aria-pressed`，第 11 節；初版為 Preview 按鈕）、**Cancel**、**Save**，取代 Edit／Share／Details。
- 麵包屑最後一段即時顯示將存成的標題（新增頁為 `New document`，解析出標題後改為標題）。
- 內容預設是可編輯的渲染內容（第 11 節）；Markdown 模式是無邊框的 textarea。

| 單元 | 位置 | 職責 | 依賴 |
| --- | --- | --- | --- |
| `DocumentBreadcrumb` | 從 `document-header.tsx` 抽出 | 只畫麵包屑；閱讀頁與編輯器共用 | 無 |
| `documentLocation` | `src/server/document-location.ts` | 由 tree 算出 source › 資料夾路徑，不含文件本身；閱讀頁與 `/edit` 共用，各自附加標題 | explorer model |
| `resolveAuthoredTitle` | `src/lib/authored-title.ts` | 純函式，第 4 節 | `mdast-util-from-markdown`、`mdast-util-to-string` |
| draft store | `src/lib/document-draft.ts` | 純函式：讀、寫、刪，注入 `Storage`；`browserDraftStorage()` 取得分頁的 `sessionStorage` | 無 |
| `DocumentComposer` | `src/components/knowledge/document-composer.tsx` | 編輯器本體：標題欄（需要時）、編輯區（渲染／Markdown）、動作、錯誤、還原提示；`blocked` 讓另一個操作（如上傳）獨佔頁面，`footer` render prop `(state: { busy }) => ReactNode` 在 `<form>` 外渲染。存檔動作由外部傳入 | 以上各項、`MarkdownRenderer`、`useFormKeys` |
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
- `Esc`：規則不變——有修改時不做事（第 11.6 節說明兩種模式下的行為）。
- `beforeunload`：有修改時才掛上，擋關分頁。重新整理也會觸發這個提示（瀏覽器無法區分），但即使離開，暫存仍在。
- 站內導航（側欄、palette、上一頁）：不攔截，靠暫存還原。

## 6. 預覽、快捷鍵與輸入區

**預覽（已由第 11 節取代）**

渲染模式本身就是預覽，初版的 Preview 按鈕、`⌘/Ctrl ⇧ P` 與「預覽中 `Esc` 回到編輯」全部移除。下方「輸入區」的規則現在描述 **Markdown 模式**的 textarea。快捷鍵見第 11.6 節。

**輸入區（Markdown 模式）**

- 無邊框、無背景，使用閱讀頁的內文字體與字級（非等寬）。代價：表格與程式碼區塊的原始碼不對齊。
- 高度隨內容增長（`input` 時設為 `scrollHeight`），捲動的是整頁，不出現框中框捲軸。
- 進入時自動聚焦，游標在最前。
- 標題欄、textarea 與渲染編輯區**不套 `kh-focus-ring`**。文字欄位聚焦時一律符合 `:focus-visible`，外框會在整個編輯期間框住整張畫布；閃爍的游標本身就是焦點指示，而模式切換／Cancel／Save 等控制項照常套焦點環。這是設計語言 §10 單一焦點環規則的例外，須記入契約。
- `E` 從閱讀頁整頁載入 `/edit`（#58）不變。

## 7. 錯誤處理

- 伺服器錯誤沿用 `GovernanceError`，顯示在內容上方，輸入不動。
- **409 衝突**：現有「重新載入最新版本」連結指向 `/edit`；有了暫存後，重新載入會還原舊基準的稿子並再次衝突，形成迴圈。改為：先清除暫存再整頁載入，文字改為「載入最新版本（捨棄你的修改）」。按下前使用者的輸入仍在畫面上，可自行複製。
- 暫存讀寫失敗：見第 5 節，靜默略過。
- 標題解析為空：Save 停用，按鈕 `title` 說明原因。
- **存檔後的導航被丟掉**：從 `/edit` 回文件頁的 client 導航偶爾會在回應抵達後被路由器丟掉（`main` 上的舊編輯器同樣會發生，量測見 verification 紀錄）。存檔成功或確認 Cancel 後，若 3 秒內 composer 仍未卸載，改以整頁載入前往目的頁；抵達時卸載即取消。離開已經確定（已存檔或已捨棄），所以這個 fallback 永遠正確；路由器本身的原因另案追蹤。

## 8. 測試

先列情境，再寫測試。

**單元（node 環境）**

- `resolveAuthoredTitle`：metadata 優先；開頭 H1；H1 帶行內格式取純文字；H1 不在開頭 → `TYPED`；只有圖片且 alt 為空的 H1 → TYPED（alt 文字會被取用，與匯入相同）；BOM 與前導空行；metadata title 為空字串或非字串 → 往下；標題欄 trim；全空 → 空結果。
- draft store（注入假 `Storage`）：有修改才寫入、改回初始值即刪除；損壞 JSON 回 `null`；版本不符回 `null`；`Storage` 丟例外時不外洩；編輯與新增 key 互不干擾。

**E2E（Playwright）**

- 以 H1 開頭：無標題欄；改 H1 時麵包屑即時更新；存檔後側欄顯示新名稱。
- 無 H1：顯示標題欄；刪掉開頭 H1 時標題欄預填原 H1。
- 帶 frontmatter title 的上傳文件：改 H1 不改名，顯示說明。
- ~~預覽~~：由第 11.9 節的模式切換案例取代。
- 暫存：輸入後從側欄離開、按 `E` 回來 → 還原提示；「捨棄」後清空。
- 暫存 + 衝突：離開期間他人存檔 → 還原後存檔得 409；「載入最新版本」後不再還原舊稿。
- 有修改時按 Cancel → 確認框。
- 新增頁：只寫 H1 即可建立，標題取自 H1。
- 既有 `phase5-authoring.spec.ts`、`keyboard-shortcuts.spec.ts` 的選擇器依新欄位名更新：欄位名稱統一為 `Title` 與 `Markdown`，新增頁不再用 `Document title`。

**手動**：見第 11.9 節（Firefox 的 `Ctrl /`、注音輸入法）。

**完成標準**：`make verify` 與 `make test-e2e` 全部通過，並補 verification 紀錄。

## 9. 不做的事

- 語法高亮（Markdown 模式）、斜線選單（渲染模式）。所見即所得與選取浮動工具列自第 11 節起納入。
- 自動存檔成 revision；跨分頁或跨裝置的草稿（localStorage／伺服器端草稿）。
- 攔截站內導航的確認框。
- 伺服器端強制「標題 = H1」。
- metadata（frontmatter）的 Web 編輯——Phase 5 spec §6.3 的決定不變。

## 10. 對其他文件的影響

- `frontend-design-language.md` §10 快捷鍵表：加入 `⌘/Ctrl /`（渲染 ⇄ Markdown）；初版曾加入的 `⌘/Ctrl ⇧ P` 與「預覽中 `Esc`」移除。焦點一節記下編輯畫布不套焦點環的例外（第 6 節）。§18 第 3 項已隨本實作關閉（該項由 PR #61 加入）。
- `2026-09-24-keyboard-shortcuts-design.md` 第 5 節（表單按鍵）：指向本規格第 6 節。
- README canonical 表：加入本規格與實作計畫。

## 11. 渲染編輯模式（2026-09-29 修訂）

產品要求編輯體驗與 Linear 一致：預設編輯排版後的內容，並可切換看實際的 Markdown。本節取代決定 1、決定 3，以及第 6 節的預覽與快捷鍵；第 4 節（標題）、第 5 節（暫存）、第 7 節（錯誤）的規則不變，因為它們都只依賴 `markdown` 字串。

### 11.1 取捨與新增依賴

- 一律渲染編輯，**接受正規化**：第一次在渲染模式編輯後，整份文件由編輯器重新輸出成 Markdown，未動的部分也可能改寫（`*` → `-`、表格空白、編輯器不認得的語法）。不做「無法原樣還原時自動改用原始碼」的保護，也不在存檔前警告。
- 這是產品決定，代價是資料上可能有損：不認得的語法可能被改寫或丟失，且進到新 revision。緩解只有兩項——上一個 revision 保留原文；spike（11.8）先量出常見語法的實際行為，寫進 verification 紀錄。
- 新增依賴：`@milkdown/kit` 7.22.x（基於 ProseMirror 與 remark，與閱讀頁的 `remark-gfm` 同一系），與開發依賴 `jsdom`（round-trip 單元測試用）。**不用** `@milkdown/react`：它依賴 Crepe 的型別，而 Crepe 自帶主題 CSS，違反「顏色只能來自 `kh-*` token」；改以命令式 API 掛載。第 1–10 節「不新增套件」的限制不再適用於此範圍。

### 11.2 模式與單一來源

- `mode: "rendered" | "source"`，預設 `rendered`。Markdown 模式就是第 6 節的 textarea，行為不變。
- `markdown` 字串仍是**唯一的狀態來源**；渲染編輯器是它的一個檢視。標題規則、草稿、dirty、409、存檔都讀這個字串。
- **開啟時只解析、不回寫**：文件載入後 `markdown` 維持原字串，所以沒編輯就不 dirty，也不會因正規化而變 dirty。
- **第一次使用者編輯**（非程式性的 ProseMirror transaction）立刻標記 `touched`，此時就算 dirty（`beforeunload`、Cancel 確認即時生效），即使輸出尚未跑。
- **輸出**：渲染編輯器內容 → Markdown。Milkdown 的 listener 內建約 200ms 的 debounce，且只在文件真的改變時才輸出，`markdown` 由它更新。以下時機**強制立即輸出**（直接對編輯器取值）：存檔、切換模式、`pagehide`／`visibilitychange` 轉為 hidden、元件卸載。Cancel 不需要：它本來就是捨棄，`touched` 已讓它視為有修改而先確認。輸出後若 `markdown` 與初始值相同，`touched` 解除；若因正規化而不同，維持 dirty。
- **Markdown → 渲染**（切回渲染模式）：文字有變時，以新內容取代渲染編輯器的文件內容；此時渲染編輯器的復原紀錄被清除。文字沒變則不動。復原紀錄不跨模式。
- 存檔永遠先強制輸出，再送出 `markdown` 與由它解析出的標題。

### 11.3 標題

`resolveAuthoredTitle` 與第 4 節規則不變，輸入是 `markdown` 字串。渲染模式下麵包屑與標題欄的更新跟著**輸出**走（約 200ms 的延遲），不另外從編輯器的節點推一個近似值：那個近似會和 mdast 的取字規則不一致（只含圖片 alt 的 H1、行內格式），為了省 200ms 不值得。

- **送出的標題永遠來自強制輸出後的 `markdown` 字串**，因此與閱讀頁、匯入的規則一致。
- 標題欄（`TYPED` 時）、`METADATA` 說明、標題延續（刪掉開頭 H1 時預填）的行為不變。
- `METADATA` 且內容不以標題開頭時，渲染模式在編輯區上方顯示該標題（唯讀的 `<h1>`），與閱讀頁一致；`TYPED` 已有標題欄，不重複。

### 11.4 編輯體驗

- **打字轉換**：`# `～`### `、`- `、`1. `、`> `、` ``` `、`**粗體**`、`*斜體*`、`` `行內程式碼` ``。GFM：表格、任務清單。
- **快捷鍵**：`⌘/Ctrl B`、`⌘/Ctrl I`。`⌘/Ctrl K` **不綁**：它是全域搜尋（palette）的快捷鍵；連結只走浮動工具列，按下連結後工具列換成行內的網址輸入框（Enter 套用、Esc 取消）。工具列內所有按鈕必須是 `type="button"`（編輯區在 `<form>` 內，預設的 submit 會存檔），並以 `mousedown` 的 `preventDefault` 保住選取。
- **選取浮動工具列**：選取文字時出現，含粗體、斜體、連結、標題（H1／H2）、項目清單、編號清單。不含斜線選單。工具列按鈕遵守既有控制項高度階梯與焦點環，`aria-pressed` 反映目前狀態。
- **樣式與閱讀頁共用**：把 `MarkdownRenderer` 外層的 class 字串抽成共用常數，閱讀頁與編輯區同一份，避免日後漸漸不一致。
- **圖片**沿用閱讀頁的來源白名單（`markdown-image-policy.ts`），以同一個 `MarkdownImage` 做 node view；白名單外的來源不載入，顯示閱讀頁同樣的替代畫面。
- **連結**：編輯區內點擊不導航，`⌘/Ctrl`＋點擊才在新分頁開啟（同閱讀頁對外部連結的做法）。
- **輸出設定**：清單符號一律 `-`、分隔線一律 `---`（Milkdown 預設是 `*` 與 `***`，會讓專案裡多數文件在第一次編輯就整份改寫）。
- **圖片標題補丁**：Milkdown 7.22.2 解析沒有標題的圖片 `![alt](url)` 時，mdast 的 `title` 是 `null`，ProseMirror 的屬性驗證拒絕它，解析丟錯並使整份文件成為空。以一個 remark plugin 在解析前把 `null` 補成空字串（已實測解決）。這個補丁是必要的，不是最佳化。

### 11.5 載入

- 編輯器以 `next/dynamic`（`ssr: false`）延後載入，Markdown／ProseMirror 套件不進 `/edit`、`/new` 的首包。這同時解決第 1–10 節實作後留下的「預覽的 Markdown 套件提早載入」follow-up。
- 載入期間顯示閱讀頁的 `MarkdownArticle`（可在伺服器渲染）當唯讀內容，編輯器就緒後原位換成可編輯，不會閃出 textarea。欄位與 Save 的 `ready` 再加上「編輯器就緒」；就緒前 Markdown 模式的 textarea 同樣停用。
- 首次聚焦規則不變：有標題欄且為空時聚焦標題欄，否則聚焦編輯區開頭（渲染模式為文件開頭，游標在最前）。還原的草稿同樣。
- **失敗保護**：編輯器建立失敗、或解析後輸出為空但 `markdown` 非空，一律改用 Markdown 模式，顯示一行說明，且不讓那個空輸出進入 `markdown`。這是故障路徑，不是被拒絕的「無法還原時警告」——它防的是像上面圖片那樣讓整份文件靜默消失的解析失敗。
- 兩個編輯區（渲染、textarea）都保持掛載，以 `hidden` 切換可見（沿用第 6 節的做法，不在同一元素加 display 類別）。

### 11.6 快捷鍵與 Esc

| 按鍵 | 行為 |
| --- | --- |
| `⌘/Ctrl /` | 切換渲染 ⇄ Markdown（Typora 的慣例） |
| `⌘/Ctrl Enter` | 存檔（不變）。在 ProseMirror 內也生效，因為事件會冒泡到 `<form>` |
| `Esc` | 沒有修改且沒有在保存 → 離開；有修改 → 不做事。兩種模式相同 |
| `⌘/Ctrl ⇧ P` | 移除 |

- 只掛在編輯器的 `<form>` 上，擴充 `useFormKeys`，不新增全域監聽；輸入法組字中一律不觸發（`isComposing`／`keyCode 229`）。
- 移除 `⌘⇧P` 後，初版記錄的 Firefox 私密視窗風險不再適用。`⌘/Ctrl /` 沒有已知的瀏覽器保留綁定，但仍須在 Firefox 手動確認一次。

### 11.7 沿用不變

- 草稿存的是 `markdown`（強制輸出後的值），還原、`baseRevisionId`、409、清除、`beforeunload`、Cancel 確認、存檔後導航的 fallback（第 5、7 節）全部不變。
- 上傳、`blocked`／`footer`、標題來源說明、`METADATA` 優先，不變。
- 路由、伺服器端權限檢查、API 契約不變。

### 11.8 實測結果與剩下的 spike

**已實測（2026-09-29，headless jsdom，Milkdown 7.22.2 + commonmark + gfm，輸出設定如 11.4）**

| 結果 | 內容 |
| --- | --- |
| 原樣 | 標題、`-` 與有序清單、`_` 強調與 `**` 粗體、程式碼區塊（含語言）、行內程式碼、連結（含 title、無 title）、自動連結、圖片（含 alt、含 title，需上述補丁）、HTML 區塊與行內 HTML、腳註、引用、任務清單、`---`、中日韓文字 |
| 正規化 | `*` 清單 → `-`；表格分隔線 `\|---\|` → `\| - \|`；行尾兩個空格的換行 → 反斜線；setext 標題（`===`）→ `#`；多餘跳脫（`1\.` → `1.`）；wikilink `[[X]]` → `\[\[X]]`（顯示相同，Obsidian 不再認得） |
| 故障 | 沒有標題的圖片使解析丟錯、整份文件為空（已用補丁解決，並由失敗保護兜底） |

- `_斜體_` 緊貼中日韓文字時，CommonMark 本來就不視為強調（閱讀頁同樣顯示底線）；編輯器輸出時只跳脫可能被當成結尾的底線（`與_斜體\_，`），顯示不變。
- round-trip 可以在專案的 vitest 內執行：檔頭加 `// @vitest-environment jsdom`，並安裝 `jsdom`。

**尚待瀏覽器 spike（實作計畫的第一個 task，通過才繼續）**

1. 在 Next 15 + React 19 下以 `ssr: false` 掛載，hydration 無警告；StrictMode 的重複 effect 不會建出兩個編輯器。
2. 浮動工具列（Milkdown 的 tooltip plugin + floating-ui）在真實版面上定位正確，不被閱讀欄裁切。
3. 量測新增的 bundle 大小，並確認只在 `/edit`、`/new` 載入。

若掛載或工具列不可行，**停止並回報**，不硬做；此時保留的是本 PR 已完成的 Markdown 原始碼編輯器。

其他風險：**輸入法**（注音等組字中，打字轉換不得誤觸發）無法自動化，須手動驗證；無障礙（編輯區的角色與名稱、工具列的鍵盤操作）須在 e2e 內檢查。

### 11.9 測試

**單元（vitest，`jsdom` 環境）**：11.8 表格的 round-trip 語料，把每個案例的「輸入 → 輸出」固定為斷言，讓正規化行為有文件也有回歸保護；圖片標題補丁；圖片白名單外的來源在 DOM 中 `src` 為空；「使用者編輯」偵測（建立與整份取代不觸發、輸入才觸發）；失敗保護的判斷函式。

**E2E**

- 打開文件預設是渲染；沒編輯直接離開不 dirty、不出 `beforeunload`。
- 打字轉換：`# ` 變標題、`- ` 變清單；`**x**` 變粗體。
- 選取文字出現浮動工具列，按粗體後切到 Markdown 模式看到 `**…**`。
- 在 Markdown 模式改字，切回渲染看到變更；切換不遺失未存內容。
- 標題跟著渲染模式的 H1 變；存檔的標題與閱讀頁一致。
- 草稿：在渲染模式編輯後離開、回來，還原提示出現且內容一致；409 流程不變。
- 圖片白名單外的來源在編輯區不載入。
- `⌘/Ctrl /` 切換；`⌘/Ctrl Enter` 在渲染模式存檔。
- 既有測試改寫：凡用 `getByLabel("Markdown").fill(...)` 直接填 Markdown 的，改為先切到 Markdown 模式（共用 helper），或改用打字。

**手動**（記入 verification）：Firefox 的 `Ctrl /`；注音輸入法在渲染模式的組字與打字轉換；一份真實的匯入文件（含表格與程式碼）開啟、編輯、存檔前後的差異。

### 11.10 完成標準

- 瀏覽器 spike 通過，並把 bundle 量測寫進 verification。
- `make verify` 與 `make test-e2e` 全部通過；`document-composer.spec.ts` 整個檔案重複 15 次無失敗。
- 設計語言 §10（快捷鍵、焦點環例外涵蓋渲染編輯區）與 README 更新。

