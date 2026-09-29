# 個人日用套件（第一批）— 設計規格

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-29 |
| 狀態 | 提案，待拍板（§12） |
| 範圍 | 讓個人 Workspace 成為每天會開的工具：修掉渲染編輯器破壞 wikilink 的缺陷（切片 0）、程式碼區塊（C）、`[[` 自動完成與從失效連結建立文件（D）、整理與封存的 web 入口（A）、收藏跟著人走（B，可延後） |
| 前置 | [知識連結與圖譜](2026-09-29-personal-workspace-knowledge-graph-design.md)（#78）、[文件 composer](2026-09-28-document-composer-design.md)（#62）、[動作模型](2026-09-21-action-model-spec.md)、[Frontend Design Language](frontend-design-language.md) |
| 實作計畫 | [`plans/2026-09-29-personal-daily-driver.md`](../plans/2026-09-29-personal-daily-driver.md) |

## 1. 現況：已查證的事實

規劃前逐項讀了原始碼。這一節存在的理由是：先前一份建議清單裡有一項寫錯了（Favorites），所以這裡每一行都附上證據位置，而不是憑印象。

| 事項 | 現況 | 證據 |
| --- | --- | --- |
| 資料夾、搬移、排序、封存、還原 | **後端完整，web 沒有入口** | `HubKnowledgeCommandService` 有 `createFolder`／`renameFolder`／`moveTreeNode`／`reorderTreeNode`／`archive*`／`restore*`（皆為單一 transaction，鎖 Source、驗證 HUB_MANAGED、防環、防跨 Source）；web 層只呼叫 `services.hub.createDocument` 與 `createRevision`（`src/app/api/`）；action registry 沒有這些動作；tree 沒有 drag |
| 新增文件的位置 | 永遠在預設 Hub Source 的最上層 | `POST /api/workspaces/:id/documents` 寫死 `parentId: null` |
| Favorites 與 Recents | **已存在，但只存在這個瀏覽器** | `use-document-shortcuts.ts` → `localStorage`（每個 Workspace 一份）；側欄有 Favorites／Recent 區塊、列上有星號、row menu 與 ⌘K 都能切換。儲存上限各 8、側欄各顯示 4；⌘K 在沒有輸入時不列出最近開過的文件 |
| 程式碼區塊 | 無語法高亮、無複製鈕 | `package.json` 沒有任何 highlighter；`ScrollablePre` 只是外框 |
| 匯出 | 沒有 | `src/app` 沒有匯出路由、`Content-Disposition` |
| 圖片 | 只允許相對路徑或同源；沒有資源儲存 | `markdown-image-policy.ts`、CSP `img-src 'self'` |
| 渲染編輯器對 `[[wikilink]]` | **會破壞它（缺陷 D0）** | 見下 |

### 1.1 缺陷 D0：渲染模式會把 `[[wikilink]]` 跳脫掉

composer 預設是渲染編輯（Milkdown）。把文件送進去、編輯一個字、再取出 Markdown：

| 輸入 | 輸出 | 連結索引 |
| --- | --- | --- |
| `See [[Target Note]] for details.` | `See \[\[Target Note]] for details. edited` | 1 條 → **0 條** |
| `[[Note\|alias]]`、`[[Note#Setup]]` | 一樣變成 `\[\[…]]` | 2 條 → **0 條** |
| `- item with [[Item Link]]` | `- item with \[\[Item Link]]` | 1 條 → **0 條** |
| `[the setup](./setup.md#local)` | 不變 | 保留 |

後果：
- 在渲染模式編輯任何有 wikilink 的文件並存檔，它的 wikilink 全部變成純文字；backlinks 與圖譜的邊隨之消失。
- 在渲染模式新增文件時直接打 `[[X]]`，儲存的是被跳脫的版本，不成連結。**目前只有切到 Markdown 原始碼才能寫出 wikilink。**
- `[text](note.md)` 這種標準 Markdown 連結不受影響。

**為什麼沒被測出來。** #62 先合併、#78 後合併，各自都正確。#78 rebase 到 #62 時，三個 e2e spec 改成用 composer 的 Markdown 原始碼視圖建文件，因此完全沒有走過渲染模式。教訓寫進 §11：任何影響編輯器的變更，都要在渲染模式下測。

**為什麼不能靠調整輸出選項修。** remark 解析後，`[[x]]` 與被跳脫的 `\[\[x\]\]` 是同一個文字節點（值都是 `[[x]]`），序列化時無從區分該不該跳脫。要在解析當下就把 wikilink 認出來，所以修法是讓編輯器有一個 wikilink 節點（切片 0）。

## 2. 目標與非目標

**目標。** 個人使用者每天會做的事——寫、連結、整理、找、讀程式碼——都能在 web 上完成，且不必為了某個功能切到 Markdown 原始碼。

**非目標（本批不做，留到第二、三批）。** 圖片與截圖（需要資源儲存與新的授權面，必須先寫規格）、Mermaid、範本與 Daily note、Tags 與 frontmatter 顯示、匯出與「匯入成可編輯」、revision diff、改名時改寫連結、hover 預覽、Properties 面板、拖曳整理。

## 3. 決策摘要

| # | 決策 | 理由 |
| --- | --- | --- |
| D1 | **切片 0 先做，單獨一個 PR（視同 hotfix）** | 它是資料完整性問題，且 D 依賴它；不該與功能綁在一起等待 |
| D2 | 編輯器用專屬的 inline wikilink 節點，不靠 stringify 選項 | §1.1：解析後無法區分 |
| D3 | 解析時用既有的 `findWikiLinks(node, markdown)` 辨識，節點保存**原始字串**，序列化原樣輸出 | 抽取與渲染已共用同一支函式（圖譜規格 §5）；編輯器加入第三個消費者，三者不可能分歧 |
| D4 | 程式碼高亮用 `rehype-highlight`＋`lowlight`，在 server 端跑，只處理**有標示語言的**圍欄，不自動偵測 | 閱讀頁是 server component，client 零 JS；自動偵測慢且常錯；套件大小（npm unpacked）lowlight 約 60 KB、rehype-highlight 約 26 KB，shiki 約 600 KB 且是非同步介面 |
| D5 | 語法顏色進 CSS 變數層（新增一組 `--kh-syntax-*`，亮暗各一組） | 契約：顏色只在 CSS 變數層；新增 token 要同步改契約文件 |
| D6 | 複製鈕是獨立的 client island，**不依賴 toast** | `/s/:token` 分享頁沒有 app shell，`useToast` 會丟錯 |
| D7 | `[[` 建議清單：第一次觸發時抓取整個 Workspace 的標題目錄（上限 5 000），之後在 client 端過濾排序 | 即時、一次請求、免逐鍵查詢；規模上限外退回 server 端查詢 |
| D8 | 自動完成先做渲染編輯器；Markdown 原始碼（textarea）視圖留到第二批 | textarea 需要另一套游標座標與彈窗，價值較低（切到原始碼的人本來就能手打） |
| D9 | 從失效連結建立文件：`/knowledge/new?title=…&from=<documentId>`，只在有寫入權時顯示 | 沿用既有 create flow；`from` 只用來決定「取消」回哪裡，由 ID 組出路徑，不接受任意 URL |
| D10 | 整理先做選單式「移到…」與鍵盤重排；拖曳留作後續 | 選單與鍵盤是無障礙的完整替代，也是拖曳之後仍需保留的入口 |
| D11 | 「刪除」就是**封存**，附可撤銷的 toast；不做硬刪除 | 不變式：生命週期只有 ACTIVE／ARCHIVED；動作模型：撤銷只在能保住的地方提供，而封存能還原 |
| D12 | 收藏改存 server（per-user），最近開過的維持本機 | 收藏是使用者資料，該跟著人走；最近開過像瀏覽紀錄，本機即可 |
| D13 | 測試政策：任何影響編輯器的變更，必須有渲染模式的測試 | §1.1 |

## 4. 切片 0 — 編輯器認得 wikilink

### 4.1 行為

1. **解析。** Milkdown 的 remark 階段加一個外掛：走訪 `text` 節點，用 `findWikiLinks` 找出 wikilink（它已處理跳脫、程式碼、連結內的巢狀），把該範圍換成 mdast 節點 `wikiLink`（`value` 為括號內的原始字串），前後文字節點照舊。被使用者刻意跳脫的 `\[\[x\]\]` 不會被辨識，仍是文字。
2. **節點。** ProseMirror inline **atom** 節點 `wiki_link`，屬性 `raw`（原始字串，供輸出）與由 `parseWikiLinkParts` 得到的 `target`／`fragment`／`alias`（供顯示）。
3. **輸出。** 序列化時原樣寫回 `[[raw]]`。實作以 mdast 的行內 `html` 節點輸出（該節點不做跳脫）；切片 0 的第一個任務是驗證這一點，不成立就改用自訂的 to-markdown handler。
4. **輸入。** 打完 `]]` 時，input rule 把 `[[…]]` 轉成節點；貼上含 `[[…]]` 的文字，走 Milkdown 既有的 Markdown 貼上解析，自動經過同一個外掛。
5. **顯示。** 像連結的樣式（設計語言的連結色與底線），文字為 `alias ?? target`（有 fragment 時附 `› fragment`），`title` 顯示原始字串；⌘/Ctrl-點擊的行為與閱讀頁一致，一般點擊不導覽（編輯器對連結的既有規則）。

### 4.2 不變式與驗收

- **無損往返。** 抽取器的測試（`document-links-extract.test.ts`）現在把 Markdown 輸入寫在各個斷言裡，不是一份可重用的清單；切片 0 先把那些輸入整理成共用的 fixture 清單（抽取器測試與往返測試共用同一份），再對每一筆斷言：`extractDocumentLinks(markdown)` 與 `extractDocumentLinks(editor 往返後的 markdown)` 相同（排序後比較）。這樣抽取器的規則表就是編輯器的規格。
- 使用者刻意跳脫的 `\[\[x\]\]` 往返後仍是跳脫（不被誤認）。
- 程式碼區塊與行內程式碼裡的 `[[x]]` 不變。
- e2e（渲染模式）：在有 wikilink 的文件裡打一個字並存檔，原始碼視圖與 backlinks 都還在；在渲染模式打 `[[目標]]` 並存檔，目標頁出現該 backlink。

### 4.3 已受損的文件

`\[\[X]]`（只有開頭被跳脫）是 Milkdown 輸出的特徵；使用者刻意跳脫時會寫 `\[\[X\]\]`（兩邊都跳脫）。所以可以用這個特徵**偵測**已受損的文件。提供一支唯讀、預設 dry-run 的報告腳本；**修復**（每份文件一個新 revision，會進歷史）只在你確認範圍後才做，列為待拍板（§12）。

## 5. 切片 C — 程式碼區塊

- **管線。** `MarkdownRenderer` 加 `rehype-highlight`（`detect: false`，只處理有語言標示的圍欄；語言集為 lowlight 的 `common`，加上 `dockerfile`、`groovy`、`protobuf`，其餘留待需要時再加）。單一區塊超過 20 KB 不高亮（避免病態輸入拖慢渲染）。輸出是 hast→React 元素，不經 `innerHTML`。
- **顏色。** `globals.css` 新增 `--kh-syntax-{keyword,string,number,comment,function,type,variable,meta}`，亮暗各一組，對比至少 4.5:1（在 `bg-subtle` 上量測）；`.hljs-*` 的規則寫在該檔（顏色層）。契約文件同步新增這組 token。
- **複製。** `ScrollablePre` 右上角一顆 ghost icon button（24px），`aria-label="Copy code"`，點擊後圖示與文字變成「Copied」1.5 秒，`aria-live="polite"`；複製的是**原始程式碼**（由 hast 的純文字取得，不含高亮的 span）。剪貼簿被拒絕時顯示「Could not copy」，不丟錯。分享頁同樣可用（D6）。
- **範圍。** 閱讀頁與分享頁。composer 渲染編輯器裡的程式碼區塊維持不高亮（ProseMirror 的裝飾層是另一件事，列入第二批）。
- **驗收。** 單元：語言白名單、無語言不高亮、超過上限不高亮、`<script>` 之類內容被跳脫；e2e：` ```sql ` 區塊有 token span、複製鈕複製出的文字與原文逐字相同、分享頁沒有 console error。

## 6. 切片 D — `[[` 自動完成與從失效連結建立文件

### 6.1 自動完成（渲染編輯器）

- **觸發。** 游標前面是 `[[` 加上不含 `]`、換行的查詢字串，且不在程式碼區塊／行內程式碼內、`[[` 前不是反斜線。
- **資料。** 第一次觸發時 `GET /api/workspaces/:id/link-targets`（回傳 `[{documentId, sourceId, title, sourceName}]`，只含**這個 Workspace 內、呼叫者讀得到的 ACTIVE 文件**（沿用連結解析的 `loadCatalog`，它只取 Source、Document、TreeNode 都是 ACTIVE 的文件——所以建議清單與「會解析到哪裡」一致；`sourceName` 另外補），上限 5 000，`Cache-Control: private, no-store`），此後至多每 60 秒更新。過濾與排序在 client：標題前綴命中 > 包含 > 最近更新；正規化用與解析器相同的 `normalizeLinkKey`（`link-resolution.ts`），所以「選到的就是會解析到的」。
- **選擇。** 上下鍵移動、Enter／Tab 選取、Esc 關閉；選取時把 `[[查詢` 換成 wikilink 節點（標題完全相同的多份文件，選取後仍是 `[[標題]]`，由解析器的既有規則決定去向，並在清單裡以 Source 名稱區分）。沒有命中時清單只顯示「沒有符合的文件」，**不**在此建立文件（那是 6.2）。
- **無障礙。** 清單是 `role="listbox"`，項目 `role="option"`；編輯器元素在開啟時設 `aria-expanded`、`aria-controls`、`aria-activedescendant`；開啟時讀螢幕閱讀器的 `role="status"` 說明「N 個建議」。

### 6.2 從失效連結建立文件

- 閱讀頁的失效連結（現在是虛線底線的 `<span>`）在**有寫入權**且 Workspace 有可寫的 Hub Source 時改為連結，指向 `/w/:ws/knowledge/new?title=<目標>&from=<目前文件 id>`；沒有寫入權則維持原樣。inspector 的 Unresolved 區塊與圖譜頁的失效節點同樣提供這個入口。
- `new` 頁讀 `title` 作為 `initialTitle`（上限 512 字元，複用既有驗證）；`from` 必須是 UUID 且屬於同一個 Workspace 才使用，用來把「取消」導回原文件。伺服端仍由建立服務逐項授權——**URL 參數只是導覽輸入**。
- 建立後照既有流程進入新文件；原文件的連結由讀取時解析自動變成有效，不需要任何寫入。

## 7. 切片 A — 整理與封存

### 7.1 API（新）

沿用既有慣例（`workspaceHttp` 包裝、`POST …/archive` 形狀如 `/api/workspaces/:id/archive`）：

| 路由 | 動作 |
| --- | --- |
| `POST /api/workspaces/:wid/folders` `{sourceId?, parentId, name}` | `createFolder`；省略 `sourceId` 時與建文件相同，以 `ensureDefaultHubSource` 解析 |
| `PATCH /api/tree-nodes/:id` `{name}` 或 `{parentId, position}` | 前者 `renameFolder`，後者 `moveTreeNode`／`reorderTreeNode` |
| `POST /api/documents/:id/archive`、`…/restore` | `archiveDocument`／`restoreDocument`（冪等，服務已是） |
| `POST /api/tree-nodes/:id/archive`、`…/restore` | 資料夾的封存與還原 |
| `POST /api/workspaces/:wid/documents` 加 `parentId?` | 新增文件可放進資料夾（服務已支援 `parentId`） |

**錯誤對應要擴充，這是這個切片的第一個任務。** `toWorkspaceErrorResponse`（`src/server/http-error-response.ts`）只認得一份錯誤碼清單，而樹與資料夾的錯誤碼 `TREE_NODE_NOT_FOUND`、`FOLDER_NOT_EMPTY`、`TREE_CYCLE`、`INVALID_PARENT`、`CROSS_SOURCE_MOVE`、`HUB_MANAGED_OPERATION_REQUIRED` 都不在裡面（已查證：清單中出現次數為 0），一旦 web 層呼叫這些服務，它們會變成 500 `INTERNAL_ERROR`。擴充如下，並為每一個碼加單元測試：`TREE_NODE_NOT_FOUND` 歸入「隱藏的 404」（不證實 ID 是否存在）；`FOLDER_NOT_EMPTY`、`TREE_CYCLE`、`INVALID_PARENT`、`CROSS_SOURCE_MOVE`、`HUB_MANAGED_OPERATION_REQUIRED` 為 409。UI 依錯誤碼用中文說明下一步（例如封存非空資料夾：「先移走或封存裡面的文件」）。

### 7.2 動作與可用性

registry 新增（型別 `ActionTarget` 之外加 `FolderTarget`）：`document.move`、`document.archive`、`document.restore`、`folder.new-document`、`folder.new-folder`、`folder.rename`、`folder.move`、`folder.archive`、`folder.restore`、`create.folder`。可用性沿用三軸（動作模型 §4）：

1. Workspace capability：`canWrite` 且 `confirmed`；
2. Source ownership：`HUB_MANAGED`（`SOURCE_MANAGED` 內容永遠唯讀）；
3. 目標狀態：來源 ACTIVE；封存動作只給 ACTIVE 的目標，還原只給 ARCHIVED 的。

**registry 只決定「顯示什麼」，服務決定「發生什麼」**——上面每個 API 都由服務重新驗證（不變式：知道 ID 不等於授權）。

### 7.3 介面

- 文件列：row menu 多「移到…」「封存」（在「顯示已封存」下改為「還原」）。資料夾列：現在沒有任何選單，補上 context menu 與 `⋯`：「在這裡新增文件」「新增資料夾」「重新命名」「移到…」「封存／還原」。側欄標題列的建立入口多「新增資料夾」。palette 對**目前開啟的文件**提供「Move document…」「Archive document」。
- 「移到…」是對話框，列出該 Source 內的 ACTIVE 資料夾樹與「最上層」，排除自己與自己的子孫；放在最後一位（append）。
- **鍵盤重排。** 樹上聚焦一列後 `Alt+↑`／`Alt+↓` 在同層上下移動（呼叫 `reorderTreeNode`），並以 `aria-live` 回報新位置。與既有快捷鍵（C、E、/、⌘Enter、Esc、⌘I）及樹的方向鍵不衝突，實作時以瀏覽器實測確認。
- **封存的回饋。** 封存後出現 toast「已封存『X』」附**復原**（呼叫 restore；動作模型：撤銷只在能保住的地方提供，這裡能）。若目前正開著被封存的文件，導向該 Source 的清單。封存會讓指向它的連結變成失效（解析只看 ACTIVE 文件）——文件頁的封存動作在有 backlink 時，toast 補一句「N 份文件連到這裡，它們的連結會變成失效」。
- 變更後 `router.refresh()`；側欄是共用 layout，沿用既有的刷新慣例（`refresh-on-arrival` 的時序規則）。

### 7.4 文件更正

design-language §18 寫「封存文件從來不存在」。服務層一直有、是 web 沒有入口，這一批補上入口後要把該段改成事實（並記錄封存對連結的影響）。

## 8. 切片 B — 收藏跟著人走（可延後）

- **資料。** migration 013：`knowledge_document_favorites(user_id, document_id, created_at)`，主鍵 `(user_id, document_id)`。**不存 workspace_id**（不變式：範圍由 Document → Source → Workspace 推導）；讀取時 join 並套用讀取政策，失去存取權的文件自然消失。
- **API。** `GET /api/favorites?workspaceId=`、`PUT`／`DELETE /api/documents/:id/favorite`；服務用既有的 `requireVisibleDocument`。
- **遷移。** 第一次載入時，把該 Workspace 的 localStorage 收藏合併進 server 再清掉本機那份，使用者不會弄丟星號。
- **同批小改（不需要 migration，可獨立先做）：** ⌘K 沒有輸入時列出最近開過的文件；側欄的收藏不再只顯示 4 筆。
- **為什麼可延後。** 只用一個瀏覽器的人完全不受影響；它解的是跨裝置。

## 9. 授權與不變式檢查

| 不變式 | 這批怎麼守 |
| --- | --- |
| 範圍是推導出來的，不存兩次 | 收藏表不存 workspace_id；tree 操作用既有 Source 路由 |
| 知道 ID 不等於授權 | 所有新 API 由服務重新驗證；`new?title=&from=` 的 `from` 只影響導覽；registry 隱藏不等於授權 |
| Source ownership 決定誰能寫 | 整理與封存只對 `HUB_MANAGED`；`SOURCE_MANAGED` 的列不出現這些動作 |
| 連結索引是衍生資料、不決定存取 | `link-targets` 只回呼叫者讀得到的文件，且不跨 Workspace；建議清單不成為存取證明 |
| 分享頁不得有任何 Workspace 解析 | 程式碼複製鈕在分享頁可用，但不引入任何 Workspace 資料；`/s/:token` 沒有編輯器，不受切片 0、D 影響 |
| 生命週期只有 ACTIVE／ARCHIVED | 沒有硬刪除；封存可還原 |
| 每個寫入 revision 的路徑要同 transaction 更新連結邊 | 這批沒有新增寫入 revision 的路徑；切片 0 保證**編輯器產生的 Markdown** 不會弄丟邊 |

## 10. 交付順序與 PR 切法

| 順序 | PR | 內容 | 大小* | 依賴 |
| --- | --- | --- | --- | --- |
| 1 | 切片 0 | wikilink 節點、往返測試、渲染模式 e2e、（唯讀）受損文件報告腳本 | M | — |
| 2 | 切片 C | 高亮、語法 token、複製鈕 | S | — |
| 3 | 切片 A-1 | 封存／還原（文件與資料夾）、新增資料夾、重新命名資料夾、資料夾內新增文件 | M | — |
| 4 | 切片 A-2 | 「移到…」對話框、鍵盤重排、palette 動作 | M | A-1 |
| 5 | 切片 D | 建議清單端點、自動完成、從失效連結建立文件 | M | 切片 0 |
| 6 | 切片 B | 收藏 server 化；⌘K 最近開過 | M | —（可延後） |

\* 大小是我的估計，以「改動的檔案與需要新設計的部分」為準：S＝一個 PR、不需新決策；M＝一個 PR 但有多個介面與測試層；L＝需要拆成多個 PR。沒有換算成時間，因為我沒有這個專案的速度基準。

為什麼是這個順序：切片 0 不能等；C 最小、日用價值立即可見，適合在 0 之後快速出貨；A 是最大的缺口，拆成兩個 PR 讓 review 可行；D 依賴 0，且放在 A 之後可以讓資料夾出現後的建立流程一起考慮。

## 11. 測試與驗證策略

- **渲染模式必測（D13）。** 這次缺陷的根因是測試繞過了預設路徑。凡是動到編輯器、composer、或影響 Markdown 內容的變更，e2e 必須有一案走渲染模式（不呼叫 `showMarkdown`）。
- **抽取器的規則表就是編輯器的規格。** 切片 0 把抽取器測試的 Markdown 輸入整理成共用 fixture 清單，往返測試用同一份，兩邊不會各說各話。
- **每個切片自帶**：單元（純函式與 registry 可用性）、integration（新 API 與服務授權，含 `SOURCE_MANAGED`、封存 Source、唯讀成員的拒絕案例）、e2e（使用者路徑）、`tsc`／`eslint`／`build`。
- **驗證紀錄。** 完成後寫 `docs/superpowers/verification/2026-09-29-personal-daily-driver-verification.md`，含實測數字，並如實記錄失敗與偏離規格之處。
- **效能。** `link-targets` 在 2 000 與 5 000 份文件的 Workspace 上量測回應時間與 payload；語法高亮量測 1 MB Markdown（含 200 個程式碼區塊）的渲染時間增量。

## 12. 待拍板與風險

**待你決定**

1. **切片 B 要不要放進第一批？** 我的建議是延後：單一瀏覽器的使用者不受影響；⌘K 最近開過那個小改可以先做。
2. **已受損的文件要不要修復？** 報告腳本會列出候選；修復每份文件都會多一個 revision。我的建議是先看報告的數量再決定。
3. **封存的名稱。** 我用「封存」（與資料模型與現有的「Show archived」一致）；若你想讓使用者感覺是「刪除」，可以加一句說明而不改名稱。
4. **拖曳整理**要不要排進這一批？我的建議是先出選單與鍵盤版，拖曳等你實際用過再決定。
5. **程式碼語言集。** 預設是 lowlight `common`（含 sql、yaml、java、python、bash、json、xml、kotlin…）加 `dockerfile`、`groovy`、`protobuf`；你的日常若還有別的（例如 hcl、scala）現在說。

**風險**

- Milkdown 7.22 的自訂節點與 remark 外掛 API 我只讀過現有程式碼、沒有實作過；切片 0 的第一個任務是一個小 spike（節點＋往返），失敗就在這裡發現，不會拖到後面。
- 輸出用行內 `html` 節點是假設（§4.1）；不成立時改用自訂 handler，範圍不變。
- 渲染編輯器的其他正規化（`*`→`-`、表格空白等）是 #62 已接受的取捨；切片 0 只保證連結語法不被破壞，不改變那個取捨。
- 鍵盤重排的 `Alt+↑/↓` 需要在 macOS 與 Windows 的瀏覽器實測；不行就換一組鍵，不影響其餘設計。
- 封存會讓連結失效是設計上的後果（解析只看 ACTIVE），不是缺陷，但要讓使用者事先知道（§7.3 的 toast）。
