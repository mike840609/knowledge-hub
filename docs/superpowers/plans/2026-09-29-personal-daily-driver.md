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
| 0.1 ✅ | **Spike**（2026-09-29 完成，結論在規格 §4.4）：在 jsdom 測試裡替 `createMarkdownEditor` 加一個最小的 inline 節點與 remark 外掛，確認 (a) `[[x]]` 能往返，(b) 以 mdast `html` 節點輸出時不被跳脫。結論寫回規格 §4.1（(b) 不成立就改用自訂 to-markdown handler） | `editor/wiki-link.ts`（草稿）、暫時的測試 | 暫時 | 規格 §4.1 已標明採用的輸出方式。**結果：(a) 成立；(b) 對表格內的 `\|` 不成立，改用自訂 `wikiLink` 節點與 handler；另發現 main 上的 D0b（Milkdown 的 `text` handler 對以空白結尾的文字不跳脫）** |
| 0.2 ✅ | 把 `document-links-extract.test.ts` 的 Markdown 輸入整理成共用 fixture 清單（**另加 spike 找到的三筆：表格裡的別名 `\|`、`\[\[x\]\] and ![a](/a.png)`、`[[A]] \[\[x\]\] [[B]]`**），抽取器測試改用它（行為不變） | `tests/fixtures/link-markdown.ts`、該測試檔 | 抽取器測試全部照舊通過 | 清單涵蓋：wikilink 的別名／標題／區塊 id／管線、被跳脫的、程式碼與行內程式碼、連結內巢狀、相對 `.md` 路徑、上限。**完成（`claude/wikilink-editor-slice0` 的 74e88e0）：32 筆，其中 13 筆對應原有斷言（改為斷言完整的連結，原本有幾個只比 target）、19 筆新增；單元 755 全過。變異驗證：弄壞 `findWikiLinks` 的跳脫處理，兩筆會失敗。有一筆（跳脫的 `[[` 在圖片前）對抽取器沒有約束力——抽取器的預檢需要字面的 `[[`，在解析前就回傳空——只約束編輯器，fixture 檔裡已註明** |
| 0.3 ✅ | remark 外掛：走訪 `text` 節點，用 `findWikiLinks(node, markdown)` 切出 `wikiLink` mdast 節點（值為原始字串） | `editor/remark-wikilinks.ts` | 單元：切分正確、前後文字保留、被跳脫的不切、程式碼內不切、`position` 缺失時不動作 | 純函式層完成，不依賴 DOM。**完成（`claude/wikilink-editor-slice0` 的 50a28a7）：走訪抽成 `replaceWikiLinks`（`components/knowledge/replace-wiki-links.ts`），閱讀頁的 `remarkKnowledgeLinks` 與編輯器的 `remarkWikiLinks` 共用，閱讀頁既有 19 個連結測試不改就通過；17 個新測試；變異驗證兩種（走進程式碼與連結內、丟掉連結前的文字），新舊測試都失敗。偏離：原驗收寫「`position` 缺失時不動作」，實作改為與閱讀頁一致——沒有 position 的文字節點只看它的值來判斷（`findWikiLinks` 的既有行為），兩邊不該有不同答案，測試把這一點寫死** |
| 0.4 ✅ | ProseMirror inline atom 節點 `wiki_link`：**只有屬性 `raw`**，`target`／`fragment`／`alias` 顯示時由 `parseWikiLinkParts` 現算（規格 §4.1-2）；`parseMarkdown`、`toMarkdown`（依 0.1 的結論）、`toDOM`／`parseDOM`；退格整個刪除、左右鍵整個跳過 | `editor/wiki-link.ts` | jsdom：節點往返、DOM 形狀、複製貼上（`parseDOM`）保留 `raw` | 節點單獨可用。**完成（419c916）。偏離：退格與方向鍵的行為沒有在 jsdom 測——ProseMirror 處理方向鍵時要量座標（`getClientRects`），jsdom 沒有；`contenteditable="false"` 也不被 jsdom 反映。這兩項移到 0.9 的瀏覽器測試，那裡要加一案：游標在 wikilink 後按 Backspace，實測結果寫進驗證紀錄（不預設它一次刪整個）** |
| 0.5 ✅ | input rule：打完 `]]` 把 `[[…]]` 轉成節點；貼上含 `[[…]]` 的文字走既有的 Markdown 貼上解析 | 同上 | jsdom：逐字輸入 `[[Note#H\|a]]` 得到節點；貼上得到節點；`\[\[x\]\]` 不轉換 | 手打與貼上都不再產生被跳脫的輸出。**完成（419c916，與 0.4 同一個 commit：同一個模組與測試檔）。偏離：編輯器沒有 Markdown 貼上解析（規格 §4.1-4 已更正），改用 `transformPasted`，並看貼上的位置（程式碼區塊、stored marks）；23 個測試（含 `splitWikiLinkText`）；變異驗證三種（input rule 的 `!`／反斜線 look-behind、貼上位置檢查、切分器的反斜線規則）都被抓到** |
| 0.6 ✅ | 接進 `editor-core.ts` 的**基礎**外掛清單（不放在 `extraPlugins`，任何宿主都要有），**並在編輯器設定裡呼叫 `configureWikiLinkStringify`**（`wikiLink` 與 `text` 的 handler；兩者缺一往返都會壞，規格 §4.4）。既有 `markdown-editor.test.ts` 的 `"a wikilink is escaped"` 案記錄的是缺陷本身，接線後要改成新的預期 | `editor-core.ts`、`markdown-editor.test.ts` | 既有測試全過（該案除外，已改預期） | 其他正規化行為不變。**完成（dd9477d）：該案改為兩個 `unchanged` 案（含標題與別名）；單元 933 全過、`tsc`、`eslint` 乾淨** |
| 0.7 ✅ | **往返測試**：對 0.2 的每一筆 fixture，`extractDocumentLinks(輸入)` 等於 `extractDocumentLinks(編輯器往返後)`；另加：刻意跳脫的保持跳脫、程式碼內不變、編輯周邊文字後連結不變 | `tests/unit/editor-wikilinks.test.ts` | 本身 | 全部通過；**故意把 0.6 的接線拿掉會讓它失敗**（變異驗證，記進驗證紀錄）；**分別拿掉節點與拿掉 `configureWikiLinkStringify` 各一次**，兩次都要失敗（前者讓 wikilink 被跳脫，後者讓表格別名與 D0b 兩案失敗）。**完成（15f78e3）：137 案（32 筆 fixture × 4 種檢查，加守門與 8 個寫回案）。四種變異都被抓到：拿掉節點與外掛（與既有 `markdown-editor.test.ts` 合計 186 個中 114 個失敗）、拿掉 stringify 設定（118）、只拿掉 `text` handler 的包裝（8，全是跳脫案）、只拿掉表格的 `\|` 補回（7，全是表格別名案）；還原後全過** |
| 0.8 ✅ | 顯示樣式：`.kh-wikilink` 用連結 token（不新增 token）；`title` 顯示原始字串 | `globals.css` | e2e 目視＋屬性斷言 | 亮暗模式都看得出是連結。**完成（`claude/wikilink-editor-slice0` 的 1e05c0b）：只用既有 token（連結色、`bg-kh-bg-selected`、`rounded-sm`），設計語言契約不需更新；預設游標而非文字游標。偏離：不跟隨連結（見規格 §4.1-5 的更正）。e2e 斷言底線、字重 500、顏色等於 `--kh-link` 且不等於內文色；選取時底色等於 `--kh-bg-selected`。亮暗模式：token 在兩個主題都有值，但我只在預設主題下實測，暗色沒有另外目視** |
| 0.9 ✅ | **渲染模式 e2e**（不呼叫 `showMarkdown` 來輸入）：(a) 開啟有 wikilink 的文件，在渲染模式打一個字並存檔，切到原始碼視圖仍是 `[[…]]`，目標頁 backlinks 還在；(b) 新增文件時在渲染模式打 `[[目標]]`，存檔後目標頁出現該 backlink | `tests/e2e/composer-wikilinks.spec.ts` | 本身 | 兩案在缺陷版本上會失敗、修復後通過（先在未修的 main 上跑一次確認會紅）。**完成（781ac28）：5 案（編輯有連結的文件並存檔、打 `[[…]]`、貼上、Backspace、點擊選取），沒有任何一案用 `showMarkdown`。未修的 main（87a21d4，另開 worktree）上 5 案全部失敗；另跑一個只編輯並存檔的最小版本，實測 PATCH 送出 `See \[\[Target …]] for details.`，存檔後目標頁的 backlink 區塊消失（1 → 0），是 D0 的端到端證據。修復後整套 e2e 150 全過（145＋5）。量測：靜態 JS 總量 1,820,392 → 1,823,219 bytes（+2,827，+0.16%），gzip +2,413；含編輯器的 lazy chunk 8,056 → 10,288；`/edit`、`/new` 的 First Load JS 不變，低於預期的個位數 KB。偏離與教訓：這個 spec 放哪裡、叫什麼名字有影響，見下** |
| 0.10 ✅ | 受損文件的**唯讀**報告：找出現行 revision 中符合「只有開頭被跳脫」特徵（`\[\[…]]`，結尾未跳脫）的文件，輸出 Workspace／文件 ID／標題／行號，預設 dry-run，沒有修復選項 | `scripts/db/report-escaped-wikilinks.ts`、`package.json` script、`Makefile` target | integration：種入受損、刻意跳脫、正常三種，只報第一種 | 報告數字寫進驗證紀錄；**修復不在這一批**（規格 §12-2 已決定先看數量再決定），腳本沒有寫入選項。**完成（`claude/wikilink-editor-slice0` 的 9f50cd8）：`make db-report-escaped-wikilinks`（`--json`）；偵測器 `domain/escaped-wikilinks.ts` 只看文字節點的原始碼、略過程式碼、raw HTML 與 embed；掃描在 `START TRANSACTION READ ONLY` 內，資料庫本身拒絕寫入，並讀同一份快照。35 個單元＋7 個 integration；四種變異驗證都被抓到。形狀分不出刻意跳脫與損壞（刻意跳脫的 `\[\[x\]\]` 經舊編輯器存檔後也成 `\[\[x]]`），輸出明說是候選。本機 dev 資料庫 0／145，說明不了任何真實資料；偵測器約每 KB 2.4 ms（合成輸入）。你的真實資料裡有幾份，要你自己跑一次才知道** |
| 0.11 ✅ | 文件：**composer 規格 §11.8 的「已接受的正規化」清單要刪掉「wikilink `[[X]]` → `\[\[X]]`（顯示相同，Obsidian 不再認得）」那一項——它是 #78 之前接受的，#78 讓 wikilink 進了連結索引之後就不能再接受了**；CLAUDE.md 連結索引的不變式補一句「編輯器必須無損往返 wikilink，且有渲染模式的測試」；圖譜規格 §15 指向本規格；新的驗證紀錄 `2026-09-29-personal-daily-driver-verification.md` 開頭寫切片 0 一節（測試數字、變異驗證、量測、偏離）。**圖譜驗證紀錄裡「合併後發現的缺陷與根因」那一段已在文件 PR（#79）寫好，不要重複** | 兩份既有文件加一份新文件 | — | **完成（1311c20）：CLAUDE.md 的新不變式、composer 規格「已接受的正規化」清單、圖譜規格 §15 風險項、composer 驗證紀錄的一行「已被取代」註記，以及新的驗證紀錄。指向本規格與計畫的連結，要等 #79 合併才有效** |

**切片 0 的量測**：編輯器 chunk 的大小差（`next build` 輸出，前後對照）；預期是個位數 KB，若超過 10 KB 要說明。**實測（781ac28 的 commit 訊息與 0.9 列）：靜態 JS 總量 +2,827 bytes（+0.16%），所有 lazy chunk 合計 +2,235 bytes（256,625 → 258,860），First Load JS 不變。**

**e2e 的檔名排序會影響別的 spec（0.9 的教訓）。** 各 spec 共用一個資料庫、依檔名順序執行。0.9 的 spec 要建立互相連結的文件：放進固定的空白 workspace，會讓 `workspace-graph.spec.ts` 的「nothing is linked」失敗（第一次的失敗）；放進 My Space 且檔名排在前面，六份新文件會改變 `workspace-graph.spec.ts` 畫出來的版面，它對節點的 `hover` 就落在畫布上（「svg intercepts pointer events」，第二次的失敗）。所以檔案叫 `zz-wikilinks-composer.spec.ts`，排在最後，檔頭說明原因。**這也點出一個既有的脆弱點：`workspace-graph.spec.ts:44` 的 hover 依賴版面，文件多幾份就會壞，與這次的修改無關；沒有在這個 PR 修，列為後續。**

## 2. 切片 C — 程式碼區塊（PR 2）

| # | 任務 | 檔案 | 測試 | 驗收 |
| --- | --- | --- | --- | --- |
| C.1 ✅ | 加依賴 `rehype-highlight`（與明確宣告 `lowlight`），確認 `react-markdown@10` 的 `rehypePlugins` 用法；`npm ci` 與 patch 仍正常。**安裝後先列出 `common` 實際包含的語言，以及 `dockerfile`、`groovy`、`protobuf` 是否存在**（repo 目前沒有 highlight.js，規格 §5 的清單是憑印象），與規格不符就先改規格 | `package.json`、lock | — | 乾淨 `npm ci` 通過；實際語言清單記進驗證紀錄。**完成（`claude/code-highlight-slice-c` 的 02519ee）：`common` 共 37 個，`dockerfile`／`groovy`／`protobuf` 都不在其中但都是內建語言（規格 §5 已改寫成查證結果）；`highlight.js` 列為直接依賴（`~11.11`，與 lowlight 相同範圍），因為三個語言要從 `highlight.js/lib/languages/*` 個別引入，不引 `all`；`@types/hast` 為 devDependency。**後續：`rehype-highlight` 在 C.7 移除（見 C.2、C.7）。**乾淨 `npm ci`（在 scratch 目錄）通過、`next` 的 patch 仍套用、`npm audit` 7 → 7。發現的缺口：沒有 `properties`（Spring）、`nginx`、`scala`、`gradle`；§12-5 已決定不加，只記錄** |
| C.2 ✅（C.7 改寫） | 設定模組：`common` 語言集加 `dockerfile`、`groovy`、`protobuf`；`detect: false`；單一區塊超過 20 KB 不高亮（以 `no-highlight` 標記，需先確認 `rehype-highlight` 確實尊重它，否則自寫一個 rehype 外掛跳過） | `src/components/knowledge/code-highlight.ts` | 單元：語言白名單、無語言不高亮、超過上限不高亮 | 行為與規格 §5 一致。**完成（6789b46）：`codeHighlightPlugins = [rehypeSkipLargeCode, [rehypeHighlight, {detect:false, languages}]]`；上限 `MAX_HIGHLIGHT_CHARS = 20_000`，以字元計並含 Markdown 加在結尾的換行（偏離規格的「20 KB」字面，規格已改）；`rehype-highlight` 尊重 `no-highlight`（讀其原始碼確認）；未註冊的語言只留純文字、不丟錯。27 個單元；變異驗證五種都被抓到。C.7 之後：改寫成自己的外掛（不用 `rehype-highlight`），加上整份文件預算與巢狀深度上限，39 個單元，見 C.7** |
| C.3 ✅ | 語法 token：`--kh-syntax-*` 亮暗各一組，`.hljs-*` 規則寫在顏色層；契約文件同步 | `globals.css`、`frontend-design-language.md` | 單元：解析兩組主題的色值，斷言各 token 對 `--kh-bg-subtle` 的對比 ≥ 4.5:1 | 對比守門測試通過（這條測試防止之後有人改色壞掉）。**完成（22243d2、908a857）：八個 token 亮暗各一組，最低對比亮 5.30、暗 5.62（均 ≥ 4.5）；33 個測試，含高亮器實際輸出的每個 scope 必須有顏色或在「刻意不上色」清單。這條在寫的當下抓到 `hljs-code` 沒有規則。**更大的發現：規則放在 `@layer components` 裡，編譯後被 Tailwind 整批刪掉（原始碼與所有單元測試都正常），是為了寫 e2e 去確認才發現；已移出 `@layer`，並加一條把樣式表編譯過再檢查的測試（變異驗證：包回 @layer，只有這條失敗）。變異驗證另有六種被抓到** |
| C.4 ✅ | `ScrollablePre` 加 `CopyCodeButton`（client island）：ghost、24px、`aria-label="Copy code"`、「Copied」1.5 秒、`aria-live="polite"`、剪貼簿被拒時顯示「Could not copy」；複製的文字由 hast 純文字取得；**不使用 `useToast`**（D6） | `markdown-renderer.tsx`、`copy-code-button.tsx` | e2e | 分享頁不丟錯。**完成（d8d68bd）。偏離兩處，規格 §5 已改：(1) 複製的文字在點擊時讀 `<pre>` 的 `textContent`，不由 prop 傳入（prop 會把每個區塊的程式碼在頁面資料裡再送一次；結果相同）；(2) 按鈕常駐可見而非 hover 才出現（觸控沒有 hover）。用既有的 `Button`（ghost、`sm`、`icon`），沒有覆寫尺寸；「Copied」「Could not copy」在 `aria-live="polite"` 區域，1.5 秒後消失** |
| C.5 ✅ | `MarkdownRenderer` 掛上 `rehypePlugins`；閱讀頁、分享頁共用（**composer 預覽不共用，見驗收欄**） | `markdown-renderer.tsx` | 單元：以 server render 渲染含 ` ```sql ` 與 `<script>` 內容的 Markdown，斷言有 token span、且內容被跳脫（沒有活的 `<script>` 元素） | 沒有 `dangerouslySetInnerHTML`。**完成（d8d68bd）。偏離：計畫原寫「composer 預覽共用」，與規格 §5 的範圍（composer 不高亮）自相矛盾，以規格為準——composer 載入編輯器前的替身若高亮，編輯器一到就少了顏色（閃一下），而且 composer 是 client component，lowlight 會進寫作頁的 bundle。所以拆成 `markdown-base.tsx`（原 `markdown-renderer.tsx`，多了 `rehypePlugins`／`pre` 輸入）、`markdown-renderer.tsx`（閱讀用）、`markdown-article.tsx`（composer 的替身）；分享頁的 JSX 不動，`share-link-single-exception` 釘住它不傳 `links` 的測試也不變。新增 `composer-bundle.test.ts` 讀 import 閉包守住這條界線。16 個單元；變異驗證六種都被抓到** |
| C.6 ✅ | e2e：閱讀頁的 ` ```sql ` 有 token；複製鈕複製出的字串與原文逐字相同（Playwright 授權剪貼簿）；`/s/:token` 分享頁的程式碼區塊可複製且無 console error | `tests/e2e/zz-reading-code.spec.ts` | 本身 | 三案通過。**完成（f992f57）：5 案，不是 3 案——閱讀頁的顏色（亮暗兩個主題，且等於 token 的計算值）、複製逐字相同（含縮排、空行、`<`、`&`、tab 與作者自己的結尾換行）、剪貼簿被拒與沒有剪貼簿時的說明且不丟錯、分享頁在無 cookie 的獨立 context 裡有顏色能複製且無 console／page error、composer 不上色也沒有按鈕。檔名 `zz-`，理由與 `zz-wikilinks-composer` 相同（寫在檔頭）。第一次跑失敗是資料庫沒在跑，不是測試；起來後 5 案第一次就過，所以做了變異驗證：還原成被 Tailwind 刪掉規則的 CSS、拿掉複製鈕的換行處理與 `catch`，跑出 4 紅 1 綠，紅在預期的斷言上（關鍵字畫成內文色 `rgb(29,31,36)` 而不是 token 的 `rgb(138,47,168)`；剪貼簿多一個換行；沒有「Could not copy」；分享頁沒顏色）。綠的那個是 composer 案，這兩個變異碰不到它。完整 e2e 155 全過（150＋5）** |
| C.7 ✅ | 量測：文件頁 First Load JS 與 composer chunk 的大小差；1 MB Markdown（200 個程式碼區塊）的 server render 時間增量 | 驗證紀錄 | — | 數字如實記錄；若閱讀頁 client JS 增加，要說明原因（預期為 0）。**完成（7c1e4ce、c8c2cb6）。數字在驗證紀錄。量測發現兩個問題並已修：(1) rust／swift 的巢狀區塊註解 `/*` 重複 1 萬次（20,000 字元內）會讓渲染爆堆疊、整份文件（含分享連結）渲染不出來；(2) 單區塊有上限但整份文件沒有，200 個區塊的 1 MB 文件 +4.9 s、4 MB +22.8 s（文件上限 5 MB）。`rehype-highlight` 兩者都無法限制，所以改成自己的外掛（直接用 lowlight，移除該依賴）：整份文件 100,000 字元的預算、輸出巢狀深度 50、文法丟例外則留純文字，單區塊 20,000 字元不變。重量測 +0.42 s（1 MB）、+0.5 s（4 MB），40 個語言×18 種病態輸入 0 次丟例外。未解決、已記錄：刻意構造的單一超長 token 是二次方成長，單區塊最壞約 1.9 s（見驗證紀錄），是否收緊上限留給你決定** |

## 3. 切片 A-1 — 封存、資料夾（PR 3）

| # | 任務 | 檔案 | 測試 | 驗收 |
| --- | --- | --- | --- | --- |
| A1.1 ✅ | **擴充錯誤對應**：`TREE_NODE_NOT_FOUND` 歸入隱藏 404；`FOLDER_NOT_EMPTY`、`TREE_CYCLE`、`INVALID_PARENT`、`CROSS_SOURCE_MOVE`、`HUB_MANAGED_OPERATION_REQUIRED` 為 409（規格 §7.1） | `src/server/http-error-response.ts` | 單元：每個碼一案，含「未列入的碼仍是 500」 | 不再有任何樹錯誤變成 `INTERNAL_ERROR`。**完成（`claude/organize-archive-slice-a1` 的 9b77326）：8 個單元，六個碼各做過變異驗證。**後來發現這些 409 還得排除在 `requestWorkspaceAccessCheck` 之外，否則每次「資料夾不是空的」都會讓 shell 重新確認存取權（見 A1.8） |
| A1.2 ✅ | 輸入解析：建資料夾、重新命名資料夾、`parentId`（沿用 `normalizeFolderName` 等領域規則）；`POST documents` 接受 `parentId?` | `src/server/authoring-input.ts` | 單元：邊界值（空名稱、過長、非 UUID） | 拒絕案例都回 400。**完成（6a62100）：`parseCreateFolderInput`／`parseRenameFolderInput`／`requireRouteId`，新增 20 個單元、變異驗證六種。名稱長度上限 512（VARCHAR(512)），領域的 `normalizeFolderName` 只要求非空，所以限制放在這一層，與標題一致。`MAX_FOLDER_NAME_LENGTH` 後來搬到領域的 tree-rules，瀏覽器與伺服器說同一個數字** |
| A1.3 ✅ | 路由：`POST /workspaces/:id/folders`、`PATCH /tree-nodes/:id`（本切片只接 `{name}`）、`POST /documents/:id/archive｜restore`、`POST /tree-nodes/:id/archive｜restore`；`create document` 路由帶 `parentId` | `src/app/api/...` | integration：成功；**`SOURCE_MANAGED` 拒絕**；封存的 Source 拒絕；唯讀成員拒絕；非成員得 404；封存非空資料夾得 409；冪等（重複封存不報錯） | 每條授權軸各有一個拒絕案例。**完成（baa5786）：54 個 integration（真的資料庫與服務，直接呼叫 handler）。唯讀成員的回應是 404 而不是 403，理由見規格 §7.5；`sourceId` 必須屬於路徑上的 workspace（補了「同一人屬於兩個 workspace」一案才守得住）。變異驗證五種都被抓到** |
| A1.4 ✅ | registry：`FolderTarget`、`document.archive`／`restore`、`folder.new-document`／`new-folder`／`rename`／`archive`／`restore`、`create.folder`；可用性三軸（規格 §7.2） | `action-registry.ts` | 單元：capability × ownership × 狀態 × surface 的矩陣 | `SOURCE_MANAGED` 的列一個都不出現。**完成（261804c）：新增約 60 個單元，含兩個完整矩陣（32 格 × 2，預期值從規格寫出，不從 registry 讀回）。`ActionTarget` 多 `sourceStatus`（還原需要知道是誰被封存）；新的 `create` 表面；變異驗證八種都被抓到** |
| A1.5 ✅ | client 變更 hook：`governanceRequest` ＋ `router.refresh()` ＋ toast；封存附 **Undo**（呼叫 restore）；文件頁封存時，有 backlink 就補一句連結會失效 | `use-tree-mutations.ts` | e2e | 復原後回到原位。**完成（719245c、a143e27）。toast 多 `survivesNavigation`（撐過 3 秒內的導覽：router.push 先改網址、redirect 再換一次，路徑變兩次）；側欄刷新用 `refreshOnArrivalElsewhere`；文案集中在 `organize-messages.ts`** |
| A1.6 ✅ | 樹的介面：資料夾列加 context menu 與 `⋯`；文件列加「封存」；「顯示已封存」下改為「還原」；側欄建立入口加「新增資料夾」；空狀態文字 | `knowledge-tree.tsx`、`source-sidebar.tsx`、`action-menu.tsx` | e2e | 鍵盤可達；沿用既有 row menu 元件。**完成。資料夾的選單只掛在標題列；Create folder 是 Notes 列 `+` 旁的一顆按鈕，不是把 `+` 改成選單，避免動到既有的 `Create document` 連結與 `C`** |
| A1.7 ✅ | 在資料夾內新增文件：`/knowledge/new?folder=<treeNodeId>`，頁面把它傳給建立請求；資料夾不存在或不合法由服務拒絕 | `new/page.tsx`、`new-document-form.tsx` | e2e | 新文件出現在該資料夾。**完成。樹會展開目前文件的祖先（每份文件一次），否則新文件會藏在收合的資料夾裡** |
| A1.8 ✅ | e2e：建資料夾 → 在裡面新增文件 → 封存文件（toast 的 Undo）→ 顯示已封存並還原 → 封存非空資料夾看到說明 → `SOURCE_MANAGED` 的文件列沒有整理動作 | `tests/e2e/zz-organize.spec.ts` | 本身 | 通過。**完成（a143e27）：9 案。寫它時抓到三個實作問題：(1) 樹的 409 讓 shell 重新確認存取權，暫停所有寫入並閃出「Unable to confirm workspace」；(2) 封存開著的文件後 toast 消失（路徑變兩次）；(3) 導向清單後側欄是舊的。都已修，見驗證紀錄** |
| A1.9 ✅ | 文件：design-language §18 的封存段落改成事實並記錄對連結的影響；動作模型規格補上資料夾與封存 | 兩份規格 | — | —。**完成：design-language §15（undo 清單、toast 例外、不重新確認存取權）與 §18（封存段落改成事實）、動作模型規格 §2 更新與新的 §10、每日套件規格新的 §7.5** |

## 4. 切片 A-2 — 移動與重排（PR 4）

| # | 任務 | 檔案 | 測試 | 驗收 |
| --- | --- | --- | --- | --- |
| A2.1 ✅ | `PATCH /tree-nodes/:id` 接 `{parentId, position}`（`moveTreeNode`／`reorderTreeNode`），輸入解析 | 路由、`authoring-input.ts` | integration：搬進資料夾與搬回最上層；搬進自己的子孫得 409；跨 Source 得 409；封存的節點得 400；重排 | 錯誤碼都經 A1.1 的對應 **完成（6510eca）。三種形狀（改名／移動／重排）一次一件；省略 position＝最後；位置是含已封存節點的同層索引，另有一個對真服務跑隨機 60 步的測試（第一版的亂數低位元會交替，沒有偵測力，靠變異驗證抓到）** |
| A2.2 ✅ | 「移到…」對話框：列出該 Source 的 ACTIVE 資料夾樹與「最上層」，排除自己與子孫，可鍵盤操作；沿用分享對話框的對話框元件 | `move-dialog.tsx` | e2e | 選取後放在目標資料夾最後 **完成。原生 radio 群組；目前位置標 Current 且不可選；沒有搜尋欄；Undo 移回原資料夾的原位置；目的資料夾會被展開** |
| A2.3 ✅ | registry：`document.move`、`folder.move`；palette 對目前開啟的文件提供「Move document…」「Archive document」 | `action-registry.ts`、palette | 單元：可用性矩陣 | — **完成。標籤是 `Move document…`／`Move folder…`；palette 的「Archive document」A-1 已加，這裡只多 Move** |
| A2.4 ✅ | 鍵盤重排：樹上聚焦一列後 `Alt+↑`／`Alt+↓`（呼叫 `reorderTreeNode`），移動後焦點留在該列，`aria-live` 回報位置；在 macOS 與 Windows 的 Chromium 實測，不行就換鍵並回寫規格 | `knowledge-tree.tsx` | e2e | 與既有快捷鍵及樹的方向鍵不衝突 **完成，除了 macOS／Windows 沒有實測。只作用在選單有 Move 的列；請求進行中保留最後一個鍵；aria-live 不是 role=status** |
| A2.5 ✅ | e2e：移動文件進出資料夾、對話框排除子孫、重排、鍵盤重排 | `tests/e2e/zz-organize-move.spec.ts`（`zz-` 的理由同 zz-organize）；另有 jsdom 的 `knowledge-tree-reorder.test.tsx` | 本身 | 通過 **完成：e2e 13 案、jsdom 14 案** |

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

## 6. 切片 B — 最近開過與收藏（PR 6）

**這一批只做 B.0**（規格 §12-1 已決定）。**B.1–B.4 延後，不在這一批**，任務保留在下面供之後排程。B.0 與其他切片無依賴，可插在任何位置出貨。

| # | 任務 | 檔案 | 測試 | 驗收 |
| --- | --- | --- | --- | --- |
| B.0 | **本批要做；不需 migration**：⌘K 沒有輸入時列出最近開過的文件；側欄收藏不再只顯示 4 筆 | `quick-search.tsx`、`source-sidebar.tsx` | e2e | 純 client |
| B.1（延後） | migration 013 `knowledge_document_favorites(user_id, document_id, created_at)`，主鍵 `(user_id, document_id)`，不存 workspace_id；repository、埠、服務（`requireVisibleDocument`） | `migrations/013-…`、repository、服務 | integration：失去存取權的文件不出現；不同使用者互不可見；重複收藏冪等 | 不變式：範圍由 Document → Source → Workspace 推導 |
| B.2（延後） | 路由：`GET /api/favorites?workspaceId=`、`PUT`／`DELETE /api/documents/:id/favorite` | 路由 | integration | — |
| B.3（延後） | client：收藏改由 server 提供；第一次載入把 localStorage 收藏合併進 server 再清除本機那份；最近開過維持本機 | `use-document-shortcuts.ts` 等 | e2e：另一個瀏覽器 context 看得到同一批收藏 | 不遺失既有星號 |
| B.4（延後） | rollout 文件：migration 順序與回滾 | `docs/operations/` | — | — |

## 7. 完成一個切片時要做的事

1. `make verify`、`make test-integration`、`make test-e2e` 全綠；`git status` 乾淨。
2. 對「沒有動到的行為」跑一次既有 e2e（尤其是 composer 與 authoring 的 spec），確認沒有被連帶破壞。
3. 驗證紀錄 `docs/superpowers/verification/2026-09-29-personal-daily-driver-verification.md` 新增該切片一節：測試數字、量測、**故意弄壞來確認測試會失敗的變異驗證**、以及失敗與偏離規格之處。
4. 有動到規格的地方，先改規格。
5. PR 說明列出：這個切片改變了什麼使用者看得到的行為、需要 reviewer 特別看的地方、還沒做的事。
