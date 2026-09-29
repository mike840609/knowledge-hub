# 個人日用套件（第一批）— 實作計畫

對應規格：[`specs/2026-09-29-personal-daily-driver-design.md`](../specs/2026-09-29-personal-daily-driver-design.md)。決策編號（D1…D13）與章節（§）都指那份規格。

## 0. 怎麼用這份計畫

- **一個切片一個 PR**，順序見規格 §10。每個 PR 的尖端必須讓 unit、integration、e2e、`tsc`、`eslint`、`next build` 全綠；**每個 commit** 至少讓 unit、typecheck、lint 綠。（上一批的教訓：rebase 後中間的 commit 沒有一個是 e2e 綠的，review 時無法逐 commit 信任。）
- 每個任務列出：要動的檔案、要寫的測試、驗收。任務內的順序就是建議的 commit 順序。
- 依 CLAUDE.md：偏離規格要記錄，不要默默改。發現規格寫錯時，先改規格再改程式。
- 需要 DB 的測試：`make db-up`；e2e 之前 `make browsers` 一次。
- 慣例提醒：component 行為不寫 React 單元測試（repo 的既有裁定），純函式與編輯器邏輯寫單元測試，使用者路徑寫 e2e；e2e 找編輯器表單用 `page.locator("main form").first()`，找欄位用 `Title` 精確比對。

## 1. 切片 0 — 編輯器認得 wikilink（PR 1，視同 hotfix）

| # | 任務 | 檔案 | 測試 | 驗收 |
| --- | --- | --- | --- | --- |
| 0.1 | **Spike**：在 jsdom 測試裡替 `createMarkdownEditor` 加一個最小的 inline 節點與 remark 外掛，確認 (a) `[[x]]` 能往返，(b) 以 mdast `html` 節點輸出時不被跳脫。結論寫回規格 §4.1（(b) 不成立就改用自訂 to-markdown handler） | `editor/wiki-link.ts`（草稿）、暫時的測試 | 暫時 | 規格 §4.1 已標明採用的輸出方式 |
| 0.2 | 把 `document-links-extract.test.ts` 的 Markdown 輸入整理成共用 fixture 清單，抽取器測試改用它（行為不變） | `tests/fixtures/link-markdown.ts`、該測試檔 | 抽取器測試全部照舊通過 | 清單涵蓋：wikilink 的別名／標題／區塊 id／管線、被跳脫的、程式碼與行內程式碼、連結內巢狀、相對 `.md` 路徑、上限 |
| 0.3 | remark 外掛：走訪 `text` 節點，用 `findWikiLinks(node, markdown)` 切出 `wikiLink` mdast 節點（值為原始字串） | `editor/remark-wikilinks.ts` | 單元：切分正確、前後文字保留、被跳脫的不切、程式碼內不切、`position` 缺失時不動作 | 純函式層完成，不依賴 DOM |
| 0.4 | ProseMirror inline atom 節點 `wiki_link`：屬性 `raw`／`target`／`fragment`／`alias`；`parseMarkdown`、`toMarkdown`（依 0.1 的結論）、`toDOM`／`parseDOM`；退格整個刪除、左右鍵整個跳過 | `editor/wiki-link.ts` | jsdom：節點往返、DOM 形狀、複製貼上（`parseDOM`）保留 `raw` | 節點單獨可用 |
| 0.5 | input rule：打完 `]]` 把 `[[…]]` 轉成節點；貼上含 `[[…]]` 的文字走既有的 Markdown 貼上解析 | 同上 | jsdom：逐字輸入 `[[Note#H\|a]]` 得到節點；貼上得到節點；`\[\[x\]\]` 不轉換 | 手打與貼上都不再產生被跳脫的輸出 |
| 0.6 | 接進 `editor-core.ts` 的**基礎**外掛清單（不放在 `extraPlugins`，任何宿主都要有） | `editor-core.ts` | 既有 `markdown-editor.test.ts` 全過 | 其他正規化行為不變 |
| 0.7 | **往返測試**：對 0.2 的每一筆 fixture，`extractDocumentLinks(輸入)` 等於 `extractDocumentLinks(編輯器往返後)`；另加：刻意跳脫的保持跳脫、程式碼內不變、編輯周邊文字後連結不變 | `tests/unit/editor-wikilinks.test.ts` | 本身 | 全部通過；**故意把 0.6 的接線拿掉會讓它失敗**（變異驗證，記進驗證紀錄） |
| 0.8 | 顯示樣式：`.kh-wikilink` 用連結 token（不新增 token）；`title` 顯示原始字串 | `globals.css` | e2e 目視＋屬性斷言 | 亮暗模式都看得出是連結 |
| 0.9 | **渲染模式 e2e**（不呼叫 `showMarkdown` 來輸入）：(a) 開啟有 wikilink 的文件，在渲染模式打一個字並存檔，切到原始碼視圖仍是 `[[…]]`，目標頁 backlinks 還在；(b) 新增文件時在渲染模式打 `[[目標]]`，存檔後目標頁出現該 backlink | `tests/e2e/composer-wikilinks.spec.ts` | 本身 | 兩案在缺陷版本上會失敗、修復後通過（先在未修的 main 上跑一次確認會紅） |
| 0.10 | 受損文件的**唯讀**報告：找出現行 revision 中符合「只有開頭被跳脫」特徵（`\[\[…]]`，結尾未跳脫）的文件，輸出 Workspace／文件 ID／標題／行號，預設 dry-run，沒有修復選項 | `scripts/db/report-escaped-wikilinks.ts`、`package.json` script、`Makefile` target | integration：種入受損、刻意跳脫、正常三種，只報第一種 | 報告數字寫進驗證紀錄；修復與否交給你（規格 §12-2） |
| 0.11 | 文件：驗證紀錄記錄合併後發現的缺陷與根因；CLAUDE.md 連結索引的不變式補一句「編輯器必須無損往返 wikilink，且有渲染模式的測試」；圖譜規格 §15 指向本規格 | 三份文件 | — | — |

**切片 0 的量測**：編輯器 chunk 的大小差（`next build` 輸出，前後對照）；預期是個位數 KB，若超過 10 KB 要說明。

## 2. 切片 C — 程式碼區塊（PR 2）

| # | 任務 | 檔案 | 測試 | 驗收 |
| --- | --- | --- | --- | --- |
| C.1 | 加依賴 `rehype-highlight`（與明確宣告 `lowlight`），確認 `react-markdown@10` 的 `rehypePlugins` 用法；`npm ci` 與 patch 仍正常 | `package.json`、lock | — | 乾淨 `npm ci` 通過 |
| C.2 | 設定模組：`common` 語言集加 `dockerfile`、`groovy`、`protobuf`；`detect: false`；單一區塊超過 20 KB 不高亮（以 `no-highlight` 標記，需先確認 `rehype-highlight` 確實尊重它，否則自寫一個 rehype 外掛跳過） | `src/components/knowledge/code-highlight.ts` | 單元：語言白名單、無語言不高亮、超過上限不高亮 | 行為與規格 §5 一致 |
| C.3 | 語法 token：`--kh-syntax-*` 亮暗各一組，`.hljs-*` 規則寫在顏色層；契約文件同步 | `globals.css`、`frontend-design-language.md` | 單元：解析兩組主題的色值，斷言各 token 對 `--kh-bg-subtle` 的對比 ≥ 4.5:1 | 對比守門測試通過（這條測試防止之後有人改色壞掉） |
| C.4 | `ScrollablePre` 加 `CopyCodeButton`（client island）：ghost、24px、`aria-label="Copy code"`、「Copied」1.5 秒、`aria-live="polite"`、剪貼簿被拒時顯示「Could not copy」；複製的文字由 hast 純文字取得；**不使用 `useToast`**（D6） | `markdown-renderer.tsx`、`copy-code-button.tsx` | e2e | 分享頁不丟錯 |
| C.5 | `MarkdownRenderer` 掛上 `rehypePlugins`；閱讀頁、分享頁、composer 預覽共用 | `markdown-renderer.tsx` | 單元：以 server render 渲染含 ` ```sql ` 與 `<script>` 內容的 Markdown，斷言有 token span、且內容被跳脫（沒有活的 `<script>` 元素） | 沒有 `dangerouslySetInnerHTML` |
| C.6 | e2e：閱讀頁的 ` ```sql ` 有 token；複製鈕複製出的字串與原文逐字相同（Playwright 授權剪貼簿）；`/s/:token` 分享頁的程式碼區塊可複製且無 console error | `tests/e2e/reading-code.spec.ts` | 本身 | 三案通過 |
| C.7 | 量測：文件頁 First Load JS 與 composer chunk 的大小差；1 MB Markdown（200 個程式碼區塊）的 server render 時間增量 | 驗證紀錄 | — | 數字如實記錄；若閱讀頁 client JS 增加，要說明原因（預期為 0） |

## 3. 切片 A-1 — 封存、資料夾（PR 3）

| # | 任務 | 檔案 | 測試 | 驗收 |
| --- | --- | --- | --- | --- |
| A1.1 | **擴充錯誤對應**：`TREE_NODE_NOT_FOUND` 歸入隱藏 404；`FOLDER_NOT_EMPTY`、`TREE_CYCLE`、`INVALID_PARENT`、`CROSS_SOURCE_MOVE`、`HUB_MANAGED_OPERATION_REQUIRED` 為 409（規格 §7.1） | `src/server/http-error-response.ts` | 單元：每個碼一案，含「未列入的碼仍是 500」 | 不再有任何樹錯誤變成 `INTERNAL_ERROR` |
| A1.2 | 輸入解析：建資料夾、重新命名資料夾、`parentId`（沿用 `normalizeFolderName` 等領域規則）；`POST documents` 接受 `parentId?` | `src/server/authoring-input.ts` | 單元：邊界值（空名稱、過長、非 UUID） | 拒絕案例都回 400 |
| A1.3 | 路由：`POST /workspaces/:id/folders`、`PATCH /tree-nodes/:id`（本切片只接 `{name}`）、`POST /documents/:id/archive｜restore`、`POST /tree-nodes/:id/archive｜restore`；`create document` 路由帶 `parentId` | `src/app/api/...` | integration：成功；**`SOURCE_MANAGED` 拒絕**；封存的 Source 拒絕；唯讀成員拒絕；非成員得 404；封存非空資料夾得 409；冪等（重複封存不報錯） | 每條授權軸各有一個拒絕案例 |
| A1.4 | registry：`FolderTarget`、`document.archive`／`restore`、`folder.new-document`／`new-folder`／`rename`／`archive`／`restore`、`create.folder`；可用性三軸（規格 §7.2） | `action-registry.ts` | 單元：capability × ownership × 狀態 × surface 的矩陣 | `SOURCE_MANAGED` 的列一個都不出現 |
| A1.5 | client 變更 hook：`governanceRequest` ＋ `router.refresh()` ＋ toast；封存附**復原**（呼叫 restore）；文件頁封存時，有 backlink 就補一句連結會失效 | `use-tree-mutations.ts` | e2e | 復原後回到原位 |
| A1.6 | 樹的介面：資料夾列加 context menu 與 `⋯`；文件列加「封存」；「顯示已封存」下改為「還原」；側欄建立入口加「新增資料夾」；空狀態文字 | `knowledge-tree.tsx`、`source-sidebar.tsx`、`action-menu.tsx` | e2e | 鍵盤可達；沿用既有 row menu 元件 |
| A1.7 | 在資料夾內新增文件：`/knowledge/new?folder=<treeNodeId>`，頁面把它傳給建立請求；資料夾不存在或不合法由服務拒絕 | `new/page.tsx`、`new-document-form.tsx` | e2e | 新文件出現在該資料夾 |
| A1.8 | e2e：建資料夾 → 在裡面新增文件 → 封存文件（toast 復原）→ 顯示已封存並還原 → 封存非空資料夾看到中文說明 → `SOURCE_MANAGED` 的文件列沒有整理動作 | `tests/e2e/organize.spec.ts` | 本身 | 通過 |
| A1.9 | 文件：design-language §18 的封存段落改成事實並記錄對連結的影響；動作模型規格補上資料夾與封存 | 兩份規格 | — | — |

## 4. 切片 A-2 — 移動與重排（PR 4）

| # | 任務 | 檔案 | 測試 | 驗收 |
| --- | --- | --- | --- | --- |
| A2.1 | `PATCH /tree-nodes/:id` 接 `{parentId, position}`（`moveTreeNode`／`reorderTreeNode`），輸入解析 | 路由、`authoring-input.ts` | integration：搬進資料夾與搬回最上層；搬進自己的子孫得 409；跨 Source 得 409；封存的節點得 400；重排 | 錯誤碼都經 A1.1 的對應 |
| A2.2 | 「移到…」對話框：列出該 Source 的 ACTIVE 資料夾樹與「最上層」，排除自己與子孫，可鍵盤操作；沿用分享對話框的對話框元件 | `move-dialog.tsx` | e2e | 選取後放在目標資料夾最後 |
| A2.3 | registry：`document.move`、`folder.move`；palette 對目前開啟的文件提供「Move document…」「Archive document」 | `action-registry.ts`、palette | 單元：可用性矩陣 | — |
| A2.4 | 鍵盤重排：樹上聚焦一列後 `Alt+↑`／`Alt+↓`（呼叫 `reorderTreeNode`），移動後焦點留在該列，`aria-live` 回報位置；在 macOS 與 Windows 的 Chromium 實測，不行就換鍵並回寫規格 | `knowledge-tree.tsx` | e2e | 與既有快捷鍵及樹的方向鍵不衝突 |
| A2.5 | e2e：移動文件進出資料夾、對話框排除子孫、重排、鍵盤重排 | `tests/e2e/organize-move.spec.ts` | 本身 | 通過 |

## 5. 切片 D — 自動完成與從失效連結建立文件（PR 5，依賴切片 0）

| # | 任務 | 檔案 | 測試 | 驗收 |
| --- | --- | --- | --- | --- |
| D.1 | `KnowledgeLinkService.listLinkTargets(caller, workspaceId)`：沿用 `loadCatalog`（ACTIVE 限定）＋補 `sourceName`＋更新時間，上限 5 000；授權與 `getDocumentLinks` 相同 | 服務、埠、repository | integration：只含 ACTIVE、只含這個 Workspace、封存的不出現、非成員得 404、超過上限被截斷並標示 | 不跨 Workspace |
| D.2 | `GET /api/workspaces/:id/link-targets`，`Cache-Control: private, no-store` | 路由 | integration | — |
| D.3 | 純函式 `rankSuggestions(targets, query)`：前綴 > 包含 > 最近更新；正規化用 `normalizeLinkKey`；空查詢回最近更新 | `link-suggestions.ts` | 單元：排序、同名、CJK、全形、空查詢 | 「選到的就是會解析到的」有測試（用解析器驗證） |
| D.4 | ProseMirror 外掛：觸發偵測（`[[`＋不含 `]`／換行；不在程式碼內；前面不是反斜線）、`role="listbox"` 彈窗、上下／Enter／Tab／Esc、選取時把範圍換成 `wiki_link` 節點；`aria-expanded`／`aria-controls`／`aria-activedescendant` | `editor/wikilink-suggest.ts` | jsdom：觸發偵測的正反案例、選取後的文件內容、Esc 不改文件 | 與切片 0 的節點相容 |
| D.5 | 接進 `RenderedEditor`（需要 `workspaceId`）；目錄第一次觸發時抓取，之後至多每 60 秒更新；抓取失敗時彈窗顯示「無法載入建議」而不是靜默 | `rendered-editor.tsx`、`document-composer.tsx` | e2e | 失敗時可繼續正常打字 |
| D.6 | 閱讀頁失效連結改為連結（有寫入權且有可寫 Hub Source 時）：`RenderedLinks` 帶 `create` 資訊；inspector 的 Unresolved 與圖譜的失效節點同樣提供入口 | `markdown-renderer.tsx`、`rendered-links.ts`、`document-links-panel.tsx`、`graph-*` | e2e | 沒有寫入權時維持原樣 |
| D.7 | `new` 頁讀 `title`（沿用長度驗證）與 `from`（UUID 且同 Workspace 才使用，僅決定「取消」回哪裡） | `new/page.tsx`、`new-document-form.tsx` | 單元：`from` 驗證；e2e | 惡意 `from` 不造成導覽到別處 |
| D.8 | e2e：渲染模式打 `[[Kub` → 清單出現 → Enter → 存檔 → 目標頁有 backlink；失效連結 → 建立 → 回到原文件時連結已有效 | `tests/e2e/composer-autocomplete.spec.ts` | 本身 | 通過；不使用 `showMarkdown` 輸入 |
| D.9 | 量測：`link-targets` 在 2 000 與 5 000 份文件時的回應時間與 payload | 驗證紀錄 | — | 數字寫進規格 §11；超出預期就把「上限外退回 server 端查詢」提前做 |

## 6. 切片 B — 收藏跟著人走（PR 6，可延後）

| # | 任務 | 檔案 | 測試 | 驗收 |
| --- | --- | --- | --- | --- |
| B.0 | **可先獨立做、不需 migration**：⌘K 沒有輸入時列出最近開過的文件；側欄收藏不再只顯示 4 筆 | `quick-search.tsx`、`source-sidebar.tsx` | e2e | 純 client |
| B.1 | migration 013 `knowledge_document_favorites(user_id, document_id, created_at)`，主鍵 `(user_id, document_id)`，不存 workspace_id；repository、埠、服務（`requireVisibleDocument`） | `migrations/013-…`、repository、服務 | integration：失去存取權的文件不出現；不同使用者互不可見；重複收藏冪等 | 不變式：範圍由 Document → Source → Workspace 推導 |
| B.2 | 路由：`GET /api/favorites?workspaceId=`、`PUT`／`DELETE /api/documents/:id/favorite` | 路由 | integration | — |
| B.3 | client：收藏改由 server 提供；第一次載入把 localStorage 收藏合併進 server 再清除本機那份；最近開過維持本機 | `use-document-shortcuts.ts` 等 | e2e：另一個瀏覽器 context 看得到同一批收藏 | 不遺失既有星號 |
| B.4 | rollout 文件：migration 順序與回滾 | `docs/operations/` | — | — |

## 7. 完成一個切片時要做的事

1. `make verify`、`make test-integration`、`make test-e2e` 全綠；`git status` 乾淨。
2. 對「沒有動到的行為」跑一次既有 e2e（尤其是 composer 與 authoring 的 spec），確認沒有被連帶破壞。
3. 驗證紀錄 `docs/superpowers/verification/2026-09-29-personal-daily-driver-verification.md` 新增該切片一節：測試數字、量測、**故意弄壞來確認測試會失敗的變異驗證**、以及失敗與偏離規格之處。
4. 有動到規格的地方，先改規格。
5. PR 說明列出：這個切片改變了什麼使用者看得到的行為、需要 reviewer 特別看的地方、還沒做的事。
