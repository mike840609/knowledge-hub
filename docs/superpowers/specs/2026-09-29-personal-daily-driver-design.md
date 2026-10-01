# 個人日用套件（第一批）— 設計規格

> 2026-09-30 更新：本文件當時將 Team 旗標限定於切換器；後續的 [Personal workspace rollout](2026-09-30-personal-workspace-design.md) 擴充為伺服器端 personal-only 授權。整理與封存已在主線完成；帳號收藏、草稿、匯出、版本還原與首頁的後續實作也以該 rollout 規格為準。

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-29 |
| 狀態 | 五項待拍板事項已決定（2026-09-29，見 §12）；尚未開始實作 |
| 範圍 | 讓個人 Workspace 成為每天會開的工具：修掉渲染編輯器破壞 wikilink 的缺陷（切片 0）、程式碼區塊（C）、`[[` 自動完成與從失效連結建立文件（D）、整理與封存的 web 入口（A）、⌘K 最近開過與側欄收藏的「Show all」（B.0）。收藏改存 server（B.1–B.4）**不在這一批** |
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
| D4 | 程式碼高亮用 `lowlight`（自己的 rehype 外掛，見 §5；原訂 `rehype-highlight`，C.7 改掉），在 server 端跑，只處理**有標示語言的**圍欄，不自動偵測 | 閱讀頁是 server component，高亮不進 client bundle（C.7 實測：client 的 80 個檔中沒有任何一個含 lowlight；server 端有）；自動偵測慢且常錯；shiki 約 600 KB 且是非同步介面。（原文的套件大小是 npm unpacked 的數字，不是進 bundle 的大小，這裡不再引用） |
| D5 | 語法顏色進 CSS 變數層（新增一組 `--kh-syntax-*`，亮暗各一組） | 契約：顏色只在 CSS 變數層；新增 token 要同步改契約文件 |
| D6 | 複製鈕是獨立的 client island，**不依賴 toast** | `/s/:token` 分享頁沒有 app shell，`useToast` 會丟錯 |
| D7 | `[[` 建議清單：第一次觸發時抓取整個 Workspace 的標題目錄（上限 5 000），之後在 client 端過濾排序 | 即時、一次請求、免逐鍵查詢；規模上限外退回 server 端查詢 |
| D8 | 自動完成先做渲染編輯器；Markdown 原始碼（textarea）視圖留到第二批 | textarea 需要另一套游標座標與彈窗，價值較低（切到原始碼的人本來就能手打） |
| D9 | 從失效連結建立文件：`/knowledge/new?title=…&from=<documentId>`，只在有寫入權時顯示 | 沿用既有 create flow；`from` 只用來決定「取消」回哪裡，由 ID 組出路徑，不接受任意 URL |
| D10 | 整理先做選單式「移到…」與鍵盤重排；拖曳留作後續 | 選單與鍵盤是無障礙的完整替代，也是拖曳之後仍需保留的入口 |
| D11 | 「刪除」就是**封存**，附可撤銷的 toast；不做硬刪除 | 不變式：生命週期只有 ACTIVE／ARCHIVED；動作模型：撤銷只在能保住的地方提供，而封存能還原 |
| D12 | 收藏改存 server（per-user），最近開過的維持本機。**延後到後面批次**；這批只做 B.0（不需 migration） | 收藏是使用者資料，該跟著人走；最近開過像瀏覽紀錄，本機即可。單一瀏覽器的使用者不受影響（§12-1） |
| D13 | 測試政策：任何影響編輯器的變更，必須有渲染模式的測試 | §1.1 |

## 4. 切片 0 — 編輯器認得 wikilink

### 4.1 行為

1. **解析。** Milkdown 的 remark 階段加一個外掛：走訪 `text` 節點，用 `findWikiLinks` 找出 wikilink（它已處理跳脫、程式碼、連結內的巢狀），把該範圍換成 mdast 節點 `wikiLink`（`value` 為連結在文字中的樣子，含 `[[ ]]`、跳脫已還原），前後文字節點照舊。被使用者刻意跳脫的 `\[\[x\]\]` 不會被辨識，仍是文字。**走訪本身與閱讀頁共用同一支 `replaceWikiLinks`（含「哪些節點內不算連結」的集合）**，兩邊各傳入「怎麼建替換節點」；不各抄一份，才不會讓閱讀頁、編輯器與連結索引對「什麼是連結」有不同答案。
2. **節點。** ProseMirror inline **atom** 節點 `wiki_link`，**只存一個屬性 `raw`**（括號內外的原始字串，供輸出）；`target`／`fragment`／`alias` 顯示時用 `parseWikiLinkParts(raw)` 現算，不另存（存兩份就可能不一致；spike 證實現算就夠）。
3. **輸出。** 序列化時原樣寫回 `[[raw]]`，由**自訂的 mdast 節點 `wikiLink` 與它的 to-markdown handler** 輸出，不用行內 `html` 節點——spike（§4.4）發現 `html` 節點在表格儲存格裡會寫出未跳脫的 `|`，把整列弄壞；自訂 handler 可以看 `state.stack` 在表格內把 `|` 補回 `\|`。handler 必須設在編輯器設定的 `remarkStringifyOptionsCtx.handlers`（不能放在 remark 外掛的 extension，因為 options 的 handlers 會蓋過 extension 的，已驗證）。
4. **輸入。** 打完 `]]` 時，input rule 把 `[[…]]` 轉成節點（`!` 或反斜線在前、程式碼或連結內都不轉）。貼上含 `[[…]]` 的文字，由 `transformPasted` 轉成節點。**（更正：本規格原先寫「走 Milkdown 既有的 Markdown 貼上解析」，那是錯的——編輯器沒有載入 clipboard 外掛，也沒有任何貼上處理，純文字就是以文字貼上，所以貼進來的 `[[x]]` 一樣會被跳脫寫回。貼上需要自己的處理。）** 貼上處理要看**貼到哪裡**，不能只看被貼的內容：貼進程式碼區塊的文字，到 `transformPasted` 時沒有外層的 code block，只看內容會誤轉；行內程式碼結尾的位置也不算在 code mark 之內（該 mark 不 inclusive），要看 stored marks。
5. **顯示。** 像連結的樣式（設計語言的連結色與底線，沿用既有 token，不新增），文字為 `alias ?? target`（有 fragment 時附 `› fragment`，與閱讀頁共用 `shownText`），`title` 顯示原始字串。**（更正：原文寫「⌘/Ctrl-點擊與閱讀頁一致」——做不到。跟隨連結需要文件目錄來解析，編輯器沒有；草稿本來就沒有解析。所以編輯器裡的 wikilink **任何點擊都不導覽**，點一下是選取整個節點，導覽在閱讀頁。）**
   瀏覽器實測（Chromium）：游標在連結正後方按一次 Backspace，整個連結被刪掉，Ctrl+Z 還原；點連結選取整個節點（選取底色）並留在原頁；方向鍵越過連結時，有的序列是先選取、再按一次才越過，有的序列直接越過，不同序列不同，所以**不對方向鍵的行為下斷言**。

### 4.2 不變式與驗收

- **無損往返。** 抽取器的測試（`document-links-extract.test.ts`）現在把 Markdown 輸入寫在各個斷言裡，不是一份可重用的清單；切片 0 先把那些輸入整理成共用的 fixture 清單（抽取器測試與往返測試共用同一份），再對每一筆斷言：`extractDocumentLinks(markdown)` 與 `extractDocumentLinks(editor 往返後的 markdown)` 相同（排序後比較）。這樣抽取器的規則表就是編輯器的規格。
- 使用者刻意跳脫的 `\[\[x\]\]` 往返後仍是跳脫（不被誤認）。
- 程式碼區塊與行內程式碼裡的 `[[x]]` 不變。
- e2e（渲染模式）：在有 wikilink 的文件裡打一個字並存檔，原始碼視圖與 backlinks 都還在；在渲染模式打 `[[目標]]` 並存檔，目標頁出現該 backlink。

### 4.3 已受損的文件

`\[\[X]]`（只有開頭被跳脫）是 Milkdown 輸出的特徵；使用者刻意跳脫時會寫 `\[\[X\]\]`（兩邊都跳脫）。所以可以用這個特徵**偵測**已受損的文件。提供一支唯讀、預設 dry-run 的報告腳本；**修復**（每份文件一個新 revision，會進歷史）**這一批不做**：先跑報告、看到實際數量後再決定（§12-2），腳本本身沒有寫入選項。

### 4.4 Spike 結論（任務 0.1，2026-09-29）

做法：在 jsdom 裡，用 `createMarkdownEditor` 的 `extraPlugins`／`configure` 掛上一個草稿版的 remark 外掛與 `wiki_link` 節點（`findWikiLinks` 切分、只存 `raw`、自訂 `wikiLink` mdast 節點輸出），對 35 筆輸入各做兩件事：開啟後直接取 Markdown，以及在第一個文字區塊前面打一個字後取 Markdown；每筆都用 `extractDocumentLinks` 比對連結邊。

**結果。** 35 筆全部在往返後邊與輸入相同。沒有節點時（現在的 main），其中 31 筆的 wikilink 邊全部消失，1 筆（`literalBeforeImage`，見 D0b）反而多出一條不該有的邊，只有 3 筆不受影響（`insideLink`、`relative`、`starred`，本來就沒有 wikilink 邊或不在編輯範圍）。涵蓋：一般、別名、標題、別名加標題、清單、有序清單、任務清單、多個連結、中文與路徑、標題列、引用、粗體與斜體內（含粗體裡只有一個連結）、表格（含 `\|`）、`#^blockId`、含空白、embed `![[…]]`、被跳脫的、行內與圍欄程式碼、連結內的 wikilink、`[[*starred*]]`、跨行與巢狀、相鄰、行首行尾、軟斷行、硬斷行、圖片旁、實體。既有的 `markdown-editor.test.ts`（48 個測試）也仍通過——草稿在那個測試裡沒有接線，所以這只說明加入這些檔案沒有弄壞什麼，不是說接線後不會改變（見下方對計畫的影響）。

**§4.1 的兩個假設，結論：**

| 假設 | 結論 |
| --- | --- |
| (a) 節點能無損往返 `[[x]]` | 成立 |
| (b) 以 mdast `html` 節點輸出不會被跳脫 | 對大多數情況成立，**但表格裡的 `[[Note\|alias]]` 會寫成 `[[Note|alias]]`，把儲存格切開，連結邊 1 → 0**。改用自訂 `wikiLink` 節點加 handler，在 `state.stack` 含 `tableCell` 時補回 `\|`，該案通過 |

**spike 順帶發現一個 main 上就有的缺陷（D0b，與節點無關）。** Milkdown 的 `text` handler 對「以空白結尾、且不含 `*`、`_`、`\`」的文字直接原樣回傳，完全不跳脫。所以在**沒有**這個節點的 main 上，`\[\[lit\]\] and ![a](/a.png)` 往返成 `[[lit]] and ![a](/a.png)`：刻意跳脫（不是連結）的文字變成了連結（邊 0 → 1）。有了 wikilink 節點會更常碰到（連結前的文字常以空白結尾）：`\[\[lit\]\] and [[Real]]` 同樣會讓 `lit` 變成連結。處理：`configureWikiLinkStringify` 也包了 `text` handler，只對「含 `[[` 且以空白結尾」的文字改走 `safe`（跳脫後把結尾空白補回），其餘照舊，把改動範圍限制在 wikilink 上。驗證：`\[\[lit\]\] and ![a](/a.png)` 與 `[[A]] \[\[lit\]\] [[B]]` 都維持原樣。

**沒有證明的部分（留給後續任務，不要當成已完成）：**
- ProseMirror 層的互動：退格整個刪除節點、方向鍵跳過、複製貼上（`parseDOM`／`toDOM`）、input rule（任務 0.4、0.5）。
- 顯示與樣式、`title`、亮暗模式（0.8）。
- 真正的瀏覽器與 composer 存檔流程（0.9 的渲染模式 e2e）。
- 編輯器 chunk 的大小差（切片 0 的量測）。

**對計畫的影響：**
- 0.4：節點只有 `raw` 一個屬性。
- 0.6：接進 `editor-core.ts` 時要同時做兩件事——把 remark 外掛與節點放進基礎外掛清單，**以及**在編輯器設定裡呼叫 `configureWikiLinkStringify`（`wikiLink` 與 `text` 的 handler）。兩者缺一，往返都會壞。
- 既有 `markdown-editor.test.ts` 的 `"a wikilink is escaped"` 案（`see [[Other Page]] here` → `see \[\[Other Page]] here`）記錄的正是缺陷本身；接線後它會變，要改成新的預期，並在 0.7 的變異驗證裡確認拿掉接線它會回到舊值。
- 0.2 的共用 fixture 加入：表格裡的別名（`\|`）、`\[\[x\]\] and ![a](/a.png)`、`[[A]] \[\[x\]\] [[B]]`。

## 5. 切片 C — 程式碼區塊

- **管線。** `MarkdownRenderer` 加一個 rehype 外掛（`code-highlight.ts`），直接用 lowlight 為有語言標示的圍欄上色；只處理有語言、且語言有註冊的圍欄，不猜語言（沒有語言的區塊維持純文字）；語言集為 lowlight 的 `common`，加上 `dockerfile`、`groovy`、`protobuf`，其餘留待需要時再加；已決定不再額外加語言，§12-5。輸出是 hast→React 元素，不經 `innerHTML`。**偏離（C.7 記錄）：** 原本寫的是套用 `rehype-highlight`。C.7 量測時發現它給不了下面三條限制，而其中一條是會讓整頁渲染失敗的缺陷，所以把它做的事直接寫出來、移除該依賴。
- **限制。** 上色的成本要有上限，不然一個貼進來的日誌或壓縮過的 bundle 就決定一頁要多久。都以字元計（高亮走的是字元；區塊的字數含 Markdown 加在結尾的那個換行），超過的區塊維持純文字，其後的區塊各自判斷，都不是錯誤：
  - **單一區塊 20,000 字元。**
  - **整份文件 100,000 字元的預算**，依序花用，「試過」就算花掉（包括後來因深度被拒的）。單一區塊有上限、整份文件沒有時，200 個區塊的 1 MB 文件閱讀渲染 +4.9 s，4 MB 文件 +22.8 s（文件上限是 5 MB，`MAX_MARKDOWN_BYTES`），每次載入都是，而分享頁前面沒有登入。有預算後分別是 +0.42 s 與 +0.5 s。
  - **輸出巢狀深度 50。** rust、swift 的區塊註解會巢狀，`/*` 重複 1 萬次（在 20,000 字元內）會產生 1 萬層 `<span>`；渲染它會爆堆疊，整份文件（包括分享連結）都渲染不出來。實測 3,000 層丟例外、5,000 層卻不丟，取決於引擎暖機程度，所以上限要遠低於任何一個數字；真實程式碼的輸出是個位數層。
  - 文法丟例外也是留純文字。
- **成本的實測（C.7）。** 真實程式碼每 KB 約 5 ms：20 KB 的 runbook（10 個區塊）+86 ms，20,000 字元的 C 資料表、INI、SQL、Python 各約 100 ms。**不是線性的部分：** 刻意構造的單一超長 token 是二次方成長，`ini` 的連續數字 5,000 字元 122 ms、10,000 字元 488 ms、19,999 字元約 1.9 s；所以 20,000 字元的上限把單一區塊的最壞情況限制在約 2 s，整份文件最多約 5 個這樣的區塊（預算 100,000）。要收緊是改一個常數：上限 10,000 字元則單一區塊最壞約 0.5 s。這是 §12 沒有問過的取捨，記在這裡。
- **語言集（C.1 查證，lowlight 3.3.0／highlight.js 11.11.2）。** `common` 共 37 個：`arduino bash c cpp csharp css diff go graphql ini java javascript json kotlin less lua makefile markdown objectivec perl php php-template plaintext python python-repl r ruby rust scss shell sql swift typescript vbnet wasm xml yaml`。`dockerfile`、`groovy`、`protobuf` **都不在 `common` 內**，但都在 `all`（192 個）裡，且都是內建語言、不需要另裝；加入後別名 `docker`、`proto` 也可用（`yml`、`sh`、`zsh`、`js`、`ts`、`py`、`kt`、`md`、`toml`、`jsonc` 等原本就是 `common` 內語言的別名）。從 `highlight.js/lib/languages/*` 個別引入，不引 `all`（會把 192 個語言都打進 bundle），所以 `highlight.js` 要列為直接依賴（版本範圍與 lowlight 相同的 `~11.11`，避免裝出兩份）。**這份語言集對本專案的技術棧有兩個缺口：** 沒有 `properties`（Spring Boot 的 `application.properties`；highlight.js 有這個語言，只是不在 `common`；`ini` 在 `common` 內、`toml` 是它的別名，但那是另一個語法）與 `nginx`、`scala`、`gradle`。ClickHouse 的 SQL 走 `sql`（highlight.js 沒有 clickhouse 語言）。§12-5 的決定是不額外加，這裡只記錄；要加是一行的事。
- **顏色。** `globals.css` 新增 `--kh-syntax-{keyword,string,number,comment,function,type,variable,meta}`，亮暗各一組，對比至少 4.5:1（在 `bg-subtle` 上量測）；`.hljs-*` 的規則寫在該檔（顏色層）。契約文件同步新增這組 token。**規則必須寫在 `@layer` 之外**：Tailwind 會刪掉 `@layer` 裡「`src` 內沒有任何地方寫出該 class 名」的規則，而 `hljs-*` 是 highlight.js 渲染時才產生的（實測：放在 `@layer components` 裡，編譯後一條規則都不剩、頁面沒有顏色，但原始碼與單元測試看起來完全正常）。所以測試要把樣式表編譯過再檢查。
- **複製。** `ScrollablePre` 右上角一顆 ghost icon button（24px），`aria-label="Copy code"`，點擊後圖示變成勾、旁邊出現「Copied」1.5 秒（寫在 `aria-live="polite"` 的區域，讓螢幕閱讀器讀到）；複製的是**原始程式碼**，不含高亮的 span，也不含 Markdown 加在區塊結尾的那個換行（作者自己的結尾換行保留）。剪貼簿被拒絕、或頁面不是安全環境（沒有 `navigator.clipboard`）時顯示「Could not copy」，不丟錯。分享頁同樣可用（D6）。**偏離（C.4 記錄）：** 原文寫「由 hast 的純文字取得」；實作改成點擊時讀 `<pre>` 的 `textContent`——結果相同（span 裡的文字就是原文），但不必把每個區塊的程式碼經由 prop 在頁面資料裡再送一次。按鈕放在 `<pre>` 之外、不捲動的外框裡，長行捲動時它不動；常駐可見（不是 hover 才出現，觸控裝置沒有 hover）。
- **範圍。** 閱讀頁與分享頁。composer 渲染編輯器裡的程式碼區塊維持不高亮（ProseMirror 的裝飾層是另一件事，列入第二批）。**composer 載入編輯器前的替身也維持不高亮、沒有複製鈕**——它要長得像它替身的編輯器，而且 composer 是 client component，lowlight 不該送到寫作頁。所以渲染器分兩層：`MarkdownBase`（產品的排版，沒有這兩樣）給 composer 的 `MarkdownArticle`，`MarkdownRenderer`（`MarkdownBase` 加高亮與複製鈕）給閱讀頁與分享頁；`tests/unit/composer-bundle.test.ts` 讀 import 的閉包，守住 composer 那一側碰不到高亮模組。**偏離：** 計畫 C.5 原寫「閱讀頁、分享頁、composer 預覽共用」，與這裡的範圍自相矛盾；以這裡為準。
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

### 6.3 D 的實作記錄（2026-09-30）

只寫實作時決定、或與上面寫的不一樣的地方。

**清單的資料與排序**

- **`link-targets` 的回應**是 `{workspaceId, targets: [{documentId, sourceId, sourceName, title, editedAt}], truncated}`：比上面寫的多 `editedAt`（「最近更新」的依據）與 `truncated`（超過 5,000 份時標示）。授權是「這個 Workspace 的成員」，與 `getWorkspaceGraph` 相同；非成員與不存在的 workspace 是同一個隱藏的 404。它只有標題，沒有任何內文（測試斷言內文不出現在回應）。WHERE 與 `loadCatalog` 逐字相同（Source、Document、TreeNode 三個都 ACTIVE），並且有測試斷言兩者的文件集合一致，所以「清單裡有的＝連結會解析到的」；只封存文件列、或只封存樹節點，各有一案（變異驗證時發現只有「兩個一起封存」的案例分不出兩個條件各自的作用）。
- **排序**在「前綴 > 包含 > 最近更新」之前多一層「與查詢完全相同」：打 `Kubernetes` 時，剛好叫 Kubernetes 的文件不該被較新的 `Kubernetes upgrade notes` 擠到後面。各層內依最近編輯，再依標題與 ID 決定，同樣的輸入永遠同樣的順序。空查詢＝全部依最近編輯。
- **比對比解析寬一點。** 比對用 `normalizeLinkKey` 再加 NFKC，所以全形字母與數字（中文輸入法常常自己打出來）找得到一般的；解析本身仍不折全形（`[[Ｋube]]` 不會解析到 `Kube`）。這樣是安全的，因為選取寫進去的是文件自己的標題，不是打的字。
- **寫成 `[[標題]]` 不會解析回自己的標題，就不列出**：`|`、`#`（被讀成別名與標題）、`/`（路徑，Hub 文件沒有路徑）、`.md` 結尾（副檔名被解析器忽略）、會把文字切斷的 Markdown 語法（`*`、反引號、`<`…）。判斷**不是字元清單**，是真的丟給抽取器與解析器：寫出 `[[標題]]`，要抽出恰好一條、沒有 fragment 與別名、並且在只有這份文件的目錄裡解析到自己（`isWritableAsWikiLink`，`domain/wiki-link-title.ts`）。少了這一步，選取會寫出一條指去別處、或哪也不去的連結，與「選到的就是會解析到的」矛盾。
- **同名的多份都列**，以 Source 名稱區分；選取寫成 `[[標題]]`，去向由解析器的既有規則決定。資料裡有 `sameTitle`（還有幾份同名），目前介面沒有用它。
- **超過 5,000 份時**清單是最近編輯的 5,000 份，沒有命中時說 `No match among the 5,000 most recently edited documents.`，不假裝找過整個 Workspace。**沒有做「上限外退回 server 端查詢」**；量測見驗證紀錄。
- **編輯既有文件時，這份文件不列給自己**（規格沒寫：連到自己沒有用，而「最近更新」會讓它永遠排第一）。

**觸發、鍵與無障礙**

- **觸發比上面多三條：** `[[` 前是 `!`（嵌入）不觸發；`|` 或 `#` 出現就關（名稱已選定，接下來是別名或標題，文件清單補不了）；查詢超過 100 字元不觸發（那是接在 `[[` 後的一段文字，不是在找名稱）。
- **鍵**：↑/↓（環狀）、Enter／Tab 選、Esc 關。它們要在編輯器自己的 keymap 之前攔到（否則 Enter 先拆清單項、Tab 先縮排），所以掛在編輯器的 `handleKeyDown`（包住 composer 原本的 ⌘Enter），不是外掛自己的 keymap。輸入法組字中的按鍵（`isComposing` 或 keyCode 229）不是清單的；帶 ⌘／Ctrl／Alt 的（⌘Enter 是存檔）與 Shift+Enter／Shift+方向鍵也不是。**清單沒有結果或還在載入時，Enter／Tab 是編輯器的，不吞。** Esc 關閉時 `stopPropagation`（composer 的 Esc 會離開頁面），之後同一個 `[[` 不再開，直到游標離開又回來、或出現新的 `[[`。
- **選取是獨立的一步 undo**（`closeHistory`）：Undo 回到打的字，不是回到整段輸入之前。
- **無障礙。** 清單開著時編輯器元素成為 `role="combobox"`（`aria-expanded`、`aria-controls`、`aria-activedescendant`、`aria-haspopup="listbox"`），關閉時還原原本的屬性。「N 個建議」**不是**上面寫的 `role="status"`：頁面的 `role="status"` 是 toast 區，e2e 與整頁的 `getByRole("status")` 都靠它是唯一，所以清單用自己的 `aria-live="polite"`。沒有結果時 `aria-expanded="false"`、不指向不存在的列。
- **定位。** 清單放在 `document.body` 上、`position: fixed`，由游標座標決定：從 `[[` 的位置起、在那一行下方；下方放不下而上方較寬時放上方；兩邊都放不下時清單捲動，不蓋住那一行（e2e 在 330px 高的視窗抓到第一版蓋住那一行，已修）。不用 floating-ui（不是直接依賴）。
- **取得清單。** 第一次要用才抓（打普通文字不發請求，有 e2e 案例），此後至多每 60 秒；抓失敗時清單顯示 `Couldn't load suggestions. You can still type the link out.`，打字不受影響，之後至少 5 秒才再試；抓過一次的清單在刷新失敗時繼續用。走 `governanceRequest`，所以 403／404 會觸發既有的存取重新確認。

**從失效連結建立（6.2）**

- **「有可寫的 Hub Source」在實作裡收斂成「有寫入權」。** 新文件一律由建立服務走 `ensureDefaultHubSource`，沒有 Hub Source 時建立一個，所以 `canWrite` 就是唯一要問的（包括從 SOURCE_MANAGED 文件裡的失效連結建立，新文件放在 Notes）。
- **只提供給 wikilink。** 相對 `.md` 路徑指的是 source 裡的位置，在 Hub 建立的文件佔不到那個位置。標題是 `titleForNewDocument`：連結寫的名稱去掉副檔名，並且要通過與建議清單同一個「解析回自己」的檢查（`[[a/b]]` 沒有任何標題能讓它解析，就不提供）。
- **入口有四處：** 閱讀頁（失效連結變成真的 `<a>`，仍是虛線、仍標示「沒有對應文件」）、inspector 的 Unresolved 列（`Create`）、圖譜的失效節點（畫布上是連結，卡片說 `Click to create`；清單視圖有 `Create`）。閱讀頁與 inspector 帶 `from`；圖譜不帶（多份文件可能寫同一個名稱）。沒有寫入權的人看到的和原本一樣（有 e2e，用唯讀成員的身分）。
- **`new` 頁的 `title` 不合建立規則（空、超過 512 字元、有換行）就整個略過，不是截短**：截短的標題不再讓原本的連結解析。`from` 先驗是 UUID，再問查詢服務——必須是**這個 workspace 內、這個人讀得到的**文件才用，而且只是決定 Cancel 回哪裡；`javascript:`、外部網址、別的 workspace 的文件、不存在的 ID 都會落回原本的清單（各有測試）。URL 參數仍只是導覽輸入，建立本身由既有的建立服務授權。
- **有標題起頭的新文件有自己的草稿**：草稿的 key 多了標題，否則先前留下的空白新文件草稿會蓋掉連結給的標題，或反過來。
- **既有 e2e 有三處因此要改，都是預期的後果：** `reading-links` 的兩案（缺失連結對可寫的人現在是通往表單的連結，`title` 多一句 `Create it.`，也有 link role）與 `workspace-graph` 的 ghost 節點（可寫時是 link，名稱是 `… (unresolved; opens the form to create it), …`）。

**沒有做：** 清單裡提示同名；`[[Title#` 之後補標題、`[[Title|` 之後補別名；`![[` 嵌入；限定 Source 的補全（`[[Source/…`）。

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
- 「移到…」是對話框，列出該 Source 內的 ACTIVE 資料夾樹與「最上層」，排除自己與自己的子孫；放在最後一位（append）。（實作見 §7.6。）
- **鍵盤重排。** 樹上聚焦一列後 `Alt+↑`／`Alt+↓` 在同層上下移動（呼叫 `reorderTreeNode`），並以 `aria-live` 回報新位置。與既有快捷鍵（C、E、/、⌘Enter、Esc、⌘I）及樹的方向鍵不衝突，實作時以瀏覽器實測確認。
- **封存的回饋。** 封存後出現 toast `Archived “X”.` 附 **Undo**（呼叫 restore；動作模型：撤銷只在能保住的地方提供，這裡能）。若目前正開著被封存的文件，導向該 Source 的清單。封存會讓指向它的連結變成失效（解析只看 ACTIVE 文件）——文件頁的封存動作在有 backlink 時，toast 補一句 `N documents link here; those links will stop working.`（N＝1 時用單數）。
- 變更後 `router.refresh()`；側欄是共用 layout，沿用既有的刷新慣例（`refresh-on-arrival` 的時序規則）。

### 7.4 文件更正

design-language §18 寫「封存文件從來不存在」。服務層一直有、是 web 沒有入口，這一批補上入口後要把該段改成事實（並記錄封存對連結的影響）。

### 7.5 A-1 的實作記錄（2026-09-30）

與上面的設計相同之處不再重複；下面是實作時決定、或與上面寫的不一樣的地方。

- **API 的細節。** `POST /workspaces/:id/folders` 的 `sourceId` 可省略（預設 Notes source）；給了就必須屬於**路徑上的這個 workspace**，否則 404——同一個人在兩個 workspace 都能寫時，服務不會擋下錯放，只有這個比對會。`parentId` 省略或 null 都是最上層。`POST /documents/:id/archive` 回 `{backlinks}`：封存前有多少文件連到它（讀不到則 null，不影響封存），讓提示能說出連結失效的份數。路徑上的 ID 先驗格式（400），不讓壞掉的 UUID 進資料庫變成 500。
- **唯讀成員被拒絕的回應是 404，不是 403。** 內容寫入者沿用 Phase 1 的契約：沒有 `document.write` 就是 `WorkspaceAccessDeniedError`（隱藏的 404），既有的文件寫入也一樣。整理動作沒有另起一套。UI 不會對唯讀成員顯示這些動作，所以這只是直接呼叫 API 時的樣子。
- **文案語言。** 全英文：選單、對話框標題與按鈕，加上 toast、對話框說明與錯誤說明（2026-09-30 決定；本節原本寫的是 toast 與錯誤說明用中文，與 composer 的「已還原未存的修改。」同一個模式，實作後改掉）。引號用 typographic `“ ”`，標題本身含直引號時才分得出邊界。全部集中在 `organize-messages.ts`（與對話框自己的兩句說明），要換語言只改那裡。toast 的按鈕標籤是 `Undo`。composer 與上傳編碼錯誤那幾句舊的中文沒有動。
- **建立入口。** 側欄的 Notes 列多一顆 Create folder 按鈕（在 `+` 旁），不是把 `+` 改成選單——既有的 `Create document` 連結與 `C` 快捷鍵不動。存在與否由 registry 的 `create` 表面決定。空的 workspace 顯示空狀態、沒有側欄，所以第一份文件之前只有 palette 能建資料夾；這是原本就有的行為（第一件事是寫文件），沒有為它另開入口。
- **資料夾的選單只掛在標題列。** 資料夾列本身是 treeitem 且包著子項，選單若掛在整個 `li`，對子項的右鍵會冒泡成資料夾的選單。`⋯` 可用鍵盤到達（Tab 或聚焦後 Enter）。
- **樹會展開目前文件的祖先資料夾**（每份文件一次），否則在資料夾內新增的文件會藏在收合的資料夾裡；之後收合是使用者的選擇，會保留。
- **封存正開著的文件**：導向該 source 的清單（它會再 redirect 到第一份文件或空狀態），toast 撐過這些導覽，復原則回到原文件與原位置（封存不動位置，所以還原後在原處）。側欄的刷新用新的 `refreshOnArrivalElsewhere`，因為目的地是 redirect，事先說不出路徑。
- **`/knowledge/new?folder=<id>`。** 不是 ID 的被忽略；是 ID 但寫不進去（不存在、已封存、在別的 source）的照樣交給建立請求，由服務用白話拒絕（`INVALID_PARENT`：目標資料夾已不存在，或已被封存）。標題列多一段資料夾名稱，只是說明。
- **不在這個 PR：** 「移到…」、鍵盤重排、palette 的 Move（A-2）；資料夾名稱唯一性（資料庫沒有這條約束，同層可以有同名資料夾——與檔案系統不同，這是既有的資料模型）。
- **重新命名資料夾的 Undo 是改回舊名**；新增資料夾沒有 Undo。

### 7.6 A-2 的實作記錄（2026-09-30）

同樣只寫實作時決定、或與上面寫的不一樣的地方。

- **`PATCH /api/tree-nodes/:id` 的三種形狀，一次只做一件事。** `{name}` 改名；`{parentId, position?}` 移到資料夾，`parentId: null` 是最上層，省略 `position` 是放在最後；只有 `{position}` 是在原本的同層裡換位置。「有沒有 `parentId` 這個鍵」與「它是不是 null」是兩回事（null 是一個地方，沒有鍵是沒有說），所以是用鍵在不在來分，不是用值。名稱與位置一起給是 400，不做一半。省略位置的「最後」是 `APPEND_POSITION`（安全整數上限），靠的是放置本來就把過大的索引夾到最後（`placeNodeAtIndex`），服務沒有改。
- **位置是同層「所有」節點的索引，包括已封存的。** 樹預設不畫已封存的節點，所以「往下一格」不能是「畫面上的索引＋1」：中間若隔著一個看不見的已封存節點，就會落在鄰居的錯誤那一側。要的位置是**鄰居自己的儲存位置**（`reorderStep`）——放在那個索引，就在鄰居的另一側，不論中間隱藏了幾個。這依賴 Hub 管理的同層位置是連續的（每次建立與移動都會重新編號），所以測試是拿真的服務跑（隱藏 B、E 的六份文件，隨機 60 步，每步後比對畫面上看得到的順序），不是只測純函式。
- **移動不動連結。** 不產生 revision，索引不動；Hub 文件沒有 `sourcePath`，相對路徑連結對它本來就沒有意義，wikilink 靠標題解析，位置不是解析的依據。所以移動不需要像封存那樣提示「N 份文件的連結會失效」。
- **對話框是一組原生 radio。** 「最上層」與 ACTIVE 資料夾依樹的順序縮排列出；自己與自己的子孫不列出（純函式 `moveDestinations`，已封存的資料夾與其底下也不列，因為服務要求祖先鏈一路 ACTIVE）；目前所在的位置標「Current」且不可選（要放最後請用 Alt+↓）。方向鍵在 radio 群組裡原生可用，Enter 由 fieldset 明說送出（不是每個瀏覽器都讓 radio 的 Enter 送出表單）。**沒有搜尋欄**：資料夾很多時要捲動，這是刻意不做的，見下。
- **標籤是 `Move document…`／`Move folder…`，不是 §7.3 寫的「移到…」。** registry 的標籤要能單獨成句（palette 一列沒有上下文），選單裡的其他項也是「動詞＋名詞」（Edit document、Archive document）。palette 只給目前開著的文件，資料夾沒有 palette 項。§7.3 與計畫寫 A-2 要把「Archive document」加進 palette——A-1 已經加了，這裡只多 Move。
- **Undo 是移回原資料夾的原位置**（PATCH 帶舊的 `parentId` 與舊的 `position`）。重排沒有 Undo toast：一步的反向是反方向的一步，每按一次鍵就出一個 toast 會蓋住樹。
- **移進資料夾後，那個資料夾會被展開**（`kh:reveal-folder` 事件，有那個資料夾的那棵樹回應），否則移進去的東西會藏在讀者收合的資料夾裡。這是 A-1「樹會展開目前文件的祖先」的同一個想法。
- **Alt+↑/↓ 只作用在選單裡有 Move 的列。** 判斷用的是該列自己的 registry 動作（`document.move`／`folder.move`），所以唯讀成員、SOURCE_MANAGED 的列、已封存的列都不會動，而且那時不 `preventDefault`，鍵留給別人。其他修飾鍵組合（Alt+Shift、Ctrl+Alt、⌘+Alt）不算重排。篩選中不動並用 aria-live 說「Clear the filter to reorder.」——篩過的樹裡，旁邊那列不是它真正的鄰居。已在最上或最下會說「already first／last」，不送請求。
- **請求進行中按的鍵保留最後一個。** 送出後到新的樹送到之前，樹是要被換掉的，照它算下一步會算錯；所以只記住最後按的那個方向，新的樹到了再照新的樹算。按住不放＝一個來回一步，放開就停；先下後上是走一步再走回來，不是第二下被吃掉。逾時（3 秒）放棄。
- **焦點與報位置。** 移動後把焦點放回該列（Chromium 移動有焦點的節點時焦點其實還在；別的瀏覽器不一定，所以明說，單元測試模擬「焦點被丟掉」的瀏覽器來驗證）；位置以 `aria-live="polite"` 的區域報（「Moved “B” up. Position 1 of 3.」），每則重新掛上，同樣的話說兩次也聽得到兩次。**不是 `role="status"`**：toast 層是頁面唯一的 status，多一個會讓每個「找頁面上的 status」的查詢變成不明確（既有的 e2e 就有這樣寫的）。
- **沒有在 macOS 與 Windows 實測 Alt+↑/↓**（計畫 A2.4 要求）。沒有那兩種環境；Chromium on Linux 通過。Option/Alt+上下在樹（非可編輯區）沒有瀏覽器預設行為，沒發現衝突，但這是推論不是實測。
- **不在這個 PR：** 拖放；對話框裡的搜尋；重排的 Undo。

## 8. 切片 B — 最近開過與收藏

**狀態（2026-09-30）：B.0 已完成（§8.1）；收藏改存 server 由 [個人工作空間（#86）](2026-09-30-personal-workspace-design.md) 用 `personal_items` 做掉了**，下面原本的設計（`knowledge_document_favorites`、`/api/favorites`）不會照寫，留著是為了看得出當初的想法與差別。

- **資料（原設計，已由 #86 取代）。** migration 013：`knowledge_document_favorites(user_id, document_id, created_at)`，主鍵 `(user_id, document_id)`。**不存 workspace_id**（不變式：範圍由 Document → Source → Workspace 推導）；讀取時 join 並套用讀取政策，失去存取權的文件自然消失。實際上 #86 的 migration 013 是通用的 `personal_items`（草稿與收藏同一張表，`favorite:<documentId>` 一列一份，附版本與刪除墓碑）。
- **API（原設計，已取代）。** 實際是 `/api/workspaces/:id/personal`。
- **遷移（已由 #86 做到）。** 第一次載入時把瀏覽器的收藏合併上去，不覆蓋遠端已刪除的項目（`favorite-sync.ts`）。
- **最近開過維持本機**（D12）：只有「哪些文件、什麼順序」存在 `kh:document-shortcuts:<workspace>`，最多 8 筆；這一點沒有改。

### 8.1 B.0 的實作記錄（2026-09-30）

兩個小改，都不需要 migration：

1. **⌘K 沒有輸入時列出最近開過的文件。** 列在空白 palette 的最前面，標題「Recent」，最多 8 筆，排除正在讀的那份；一打字就換成搜尋結果，清空又回來。沒有任何最近開過時，palette 與之前完全一樣。
2. **側欄「Favorites」預設列出最新加的 4 筆，其餘在「Show all N」裡。** 超過 4 筆時多一列「Show all N」，開啟一個 Menu（現成的 `ui/menu`，旁邊是「Document display options」用的同一個元件）列出**全部**收藏；每一項是真的連結（`<a role="menuitem" href>`，可 ⌘-click 另開），方向鍵、Esc 與焦點歸還由元件處理，關閉後焦點回到「Show all」。4 筆以內不出現這一列。

**偏離與理由（做了兩個版本）。** 計畫原寫「不再只顯示 4 筆」。第一版做成全部列出、超過 `max-h-72`（18 rem）在清單內捲動，並宣稱「不把下面的樹擠出畫面」——量過版面後這句不成立：1280 寬、10 筆以上收藏時，樹從側欄頂端算 366px 才開始；視窗高 720px（側欄約 604px）時不捲動只看得到約 238px 的樹，600px 時約 118px；而且清單內外有兩層捲動（游標在清單上滾輪不會捲外層）。所以改成 4 筆加「Show all N」：這一節的高度與收藏數無關（e2e 斷言小於 240px），沒有內層捲動。第一版拿掉 4 筆上限的理由——「加了星號卻看不到就找不到」——由那一列（帶總數）承接。

**這個做法的代價（已知）：** 第 5 筆以後要多點一次；面板裡的列沒有星號按鈕，要取消星號得從前 4 筆、樹的那一列或文件頁；面板沒有搜尋。

**偏離「純 client」（計畫 B.0 原文）。** 最近開過的**清單**仍只存本機，但顯示用的**標題**不存本機，而是每次開 palette 時向 `GET /api/workspaces/:id/recent-documents?ids=a,b,c` 現查。理由：本機只存 ID，是因為標題會過期——文件改名後 palette 會顯示舊名字；文件被封存，或使用者失去存取權之後，一個存在瀏覽器裡的標題會繼續顯示它本來不該再被看到的字。伺服器現查解決這三件事，代價是 palette 開啟時多一次很小的請求（最多 8 個 ID，沒有內文）。

這個路由遵守「知道 ID 不等於授權」：

- **成員資格先於一切。** 先過 `listSources`（非成員得到與「workspace 不存在」同一個隱藏 404），再逐一以 `getDocument` 由服務重新檢查讀取政策；讀不到的（封存、不存在、格式錯誤、失去存取權）**靜默略過**，不回錯誤，也就不洩漏它們是否存在。
- **只回這個 workspace 的。** 帶別的 workspace 的文件 ID 進來，會被略過（範圍由 Document → Source → Workspace 推導，不信任呼叫者說它屬於哪裡）。
- **只回 `documentId`、`sourceId`、現在的 `title`、`sourceName`。** 沒有內文、沒有 revision。`Cache-Control: private, no-store`。
- **順序照請求。** 排序是 client 的責任（本機的最近順序）；伺服器不重排，也不補上請求之外的文件。ID 清單上限 8（`MAX_RECENT_DOCUMENTS`），格式不對的（不是 UUID）與重複的先被 `parseDocumentIdList` 丟掉。
- 失敗（網路、5xx）就當作沒有最近開過，palette 退回原樣，不顯示錯誤。

**最近開過排在最前面**是一個使用者看得到的決定，需要被知道：預設的 Enter 列因此變成「前一份文件」，而不是「Go to …」的第一個地方。這是 ⌘K 當「在最近兩份文件之間切換」用時想要的；代價是沒有輸入時 Enter 不再是導覽。**沒有任何最近開過時，第一列仍是導覽**（有 e2e 與 action-registry 的單元測試釘著）。要改回「導覽在前」是把 `recentRows` 移到 `rows` 後面的一行，`activeIndex` 的調整不受影響。

**沒有做：** 收藏不受 8 筆限制，但側欄上仍沒有排序、分組或搜尋（新加的在最上面）；palette 只列最近開過，沒有列收藏（收藏在側欄、在首頁）。

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
| 6 | 切片 B.0 | ⌘K 最近開過；側欄收藏全顯示（純 client、無 migration） | S | —（與其他切片無依賴，可插在任何位置出貨）。B.1–B.4（server 化）延後，不在這一批 |

\* 大小是我的估計，以「改動的檔案與需要新設計的部分」為準：S＝一個 PR、不需新決策；M＝一個 PR 但有多個介面與測試層；L＝需要拆成多個 PR。沒有換算成時間，因為我沒有這個專案的速度基準。

為什麼是這個順序：切片 0 不能等；C 最小、日用價值立即可見，適合在 0 之後快速出貨；A 是最大的缺口，拆成兩個 PR 讓 review 可行；D 依賴 0，且放在 A 之後可以讓資料夾出現後的建立流程一起考慮。

## 11. 測試與驗證策略

- **渲染模式必測（D13）。** 這次缺陷的根因是測試繞過了預設路徑。凡是動到編輯器、composer、或影響 Markdown 內容的變更，e2e 必須有一案走渲染模式（不呼叫 `showMarkdown`）。
- **抽取器的規則表就是編輯器的規格。** 切片 0 把抽取器測試的 Markdown 輸入整理成共用 fixture 清單，往返測試用同一份，兩邊不會各說各話。
- **每個切片自帶**：單元（純函式與 registry 可用性）、integration（新 API 與服務授權，含 `SOURCE_MANAGED`、封存 Source、唯讀成員的拒絕案例）、e2e（使用者路徑）、`tsc`／`eslint`／`build`。
- **驗證紀錄。** 完成後寫 `docs/superpowers/verification/2026-09-29-personal-daily-driver-verification.md`，含實測數字，並如實記錄失敗與偏離規格之處。
- **效能。** `link-targets` 在 2 000 與 5 000 份文件的 Workspace 上量測回應時間與 payload；語法高亮量測 1 MB Markdown（含 200 個程式碼區塊）的渲染時間增量。
  - **實測（切片 D，2026-09-30，同一台機器與同一個行程，沒有 HTTP）：** `link-targets` 2 000 份 p50 15.9 ms、payload 406 KiB（gzip 53 KiB）；5 000 份 p50 42.5 ms、payload 1 016 KiB（gzip 132 KiB）；前端每次按鍵的排序 5 000 份 p50 ≤ 1.8 ms。沒有超出預期，「上限外退回 server 端查詢」維持不做。詳見驗證紀錄。

## 12. 已決定的事項與風險

**已決定（2026-09-29）**

| # | 問題 | 決定 | 對計畫的影響 |
| --- | --- | --- | --- |
| 1 | 切片 B 要不要放進第一批 | **延後**，只先做 B.0（⌘K 最近開過、側欄收藏全顯示） | B.1–B.4（migration 013、API、client 同步、rollout）移出這一批 |
| 2 | 已受損的文件要不要修復 | **先跑唯讀報告，看數量再決定** | 任務 0.10 只交報告；這一批沒有寫入或修復的程式碼 |
| 3 | 封存的名稱 | **維持「封存」** | 選單、toast、說明都用「封存／還原」；不加「刪除」字樣 |
| 4 | 拖曳整理 | **這一批不做**，先出「移到…」與 `Alt+↑/↓` | A-2 不含拖放；拖曳之後再視使用情況決定 |
| 5 | 程式碼語言集 | **用預設**（`common` 加 `dockerfile`、`groovy`、`protobuf`），不額外加 | 見 §5 的提醒：`common` 的實際內容在 C.1 查證，不符就改這份規格 |

**已決定（2026-09-30）**

| # | 問題 | 決定 | 對計畫的影響 |
| --- | --- | --- | --- |
| 6 | Team workspace 要不要現在開放 | **不開放，先預告**：在前端把工作空間切換擋掉，選單顯示一列停用的「Team workspaces · Coming soon」，之後才開放 | 旗標 `KM_TEAM_WORKSPACES_ENABLED`（預設關，只認 `true`）；**只是切換器提供什麼，不是存取控制**——直接開連結與 API 都不變，見 [operations 文件](../../operations/team-workspaces-availability.md)。整理與封存（§7）在 Team 裡的行為沒有因此改變 |

**風險**

- Milkdown 7.22 的自訂節點與 remark 外掛 API 我只讀過現有程式碼、沒有實作過；切片 0 的第一個任務是一個小 spike（節點＋往返），失敗就在這裡發現，不會拖到後面。
- 輸出用行內 `html` 節點是假設（§4.1）；不成立時改用自訂 handler，範圍不變。
- 渲染編輯器的其他正規化（`*`→`-`、表格空白等）是 #62 已接受的取捨；切片 0 只保證連結語法不被破壞，不改變那個取捨。
- 鍵盤重排的 `Alt+↑/↓` 需要在 macOS 與 Windows 的瀏覽器實測；不行就換一組鍵，不影響其餘設計。
- 封存會讓連結失效是設計上的後果（解析只看 ACTIVE），不是缺陷，但要讓使用者事先知道（§7.3 的 toast）。
