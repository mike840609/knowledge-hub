# 個人日用套件（第一批）— 驗證紀錄

對應[設計規格](../specs/2026-09-29-personal-daily-driver-design.md)與[實作計畫](../plans/2026-09-29-personal-daily-driver.md)。每個切片完成時在這裡加一節：測試數字、量測、**故意弄壞來確認測試會失敗的變異驗證**、如實記錄的失敗與偏離。

目前有切片 0、切片 C 與切片 A-1。

## 切片 0 — 編輯器認得 wikilink

**修的是什麼。** composer 預設的渲染編輯器（Milkdown）把 `[[X]]` 寫成 `\[\[X]]`，那不是連結。在渲染模式編輯並存檔一份有 wikilink 的文件，它的連結索引由 1 變 0，backlinks 與圖譜的邊隨之消失；在渲染模式打 `[[X]]` 也存不成連結。`[text](note.md)` 不受影響。

**分支**：`claude/wikilink-editor-slice0`，從 `main`（`87a21d4`）開出。

| 任務 | commit | 內容 |
| --- | --- | --- |
| 0.2 | `74e88e0` | 抽取器的規則表改成共用 fixture 清單 `tests/fixtures/link-markdown.ts`（32 筆，13 筆對應原有斷言，19 筆新增） |
| 0.3 | `50a28a7` | remark 外掛；閱讀頁與編輯器共用同一支 `replaceWikiLinks` |
| 0.4、0.5 | `419c916` | `wiki_link` 節點、打 `]]` 的 input rule、貼上處理、寫回的 handler |
| 0.6 | `dd9477d` | 接進 `editor-core.ts` |
| 0.7 | `15f78e3` | 往返測試，137 案 |
| 0.8 | `1e05c0b` | 顯示樣式 |
| 0.9 | `781ac28` | 5 個渲染模式的瀏覽器測試 |
| 0.10 | `9f50cd8` | 受損文件的唯讀報告 |
| 0.11 | （本 commit） | 文件 |

### 結果

| 檢查 | 開始前（main） | 現在 |
| --- | --- | --- |
| 單元測試 | 735（#78 rebase 之後的紀錄） | **968** 全過 |
| integration | 486 | **493** 全過 |
| e2e | 145 | **150** 全過 |
| `tsc --noEmit`、`eslint .` | 乾淨 | 乾淨 |
| `next build` | 成功 | 成功 |

單元多出的 233 個是：抽取器改成資料驅動後的 +20、remark 外掛 17、節點 23、`markdown-editor.test.ts` 的 wikilink 案 +1（一個「被跳脫」的案改成兩個「原樣」的案）、往返 137、受損報告的偵測器 35。integration 多出的 7 個是報告腳本的測試。e2e 多出的 5 個是 `zz-wikilinks-composer.spec.ts`。

### 在未修的 main 上會紅（任務 0.9 的要求）

我另開 `main`（`87a21d4`）的 git worktree，把新的 e2e spec 複製進去跑：**5 個全部失敗**。失敗在節點斷言上（main 上沒有那種節點），所以另外跑一個只做「編輯並存檔」的最小版本，看缺陷本身：

- 存檔送出的 PATCH：`"Intro line. (edited)\n\nSee \\[\\[Target mune44f9]] for details.\n"`，也就是 `\[\[…]]`。
- 存檔之後，目標文件頁的 backlink 區塊**消失**（存檔前是 "Linked from 1 document"）。

這是 D0 在真實 app、真實資料庫上的端到端證據。

### 變異驗證

每個守門都刻意弄壞一次，確認測試會失敗，還原後再確認全過（還原用 `cmp` 與原檔逐位元比對）。

| 弄壞的東西 | 抓到它的測試 |
| --- | --- |
| 共用的走訪：走進程式碼與連結內（拿掉略過集合） | 2（新 1、閱讀頁既有 1） |
| 共用的走訪：丟掉連結前的文字 | 7（新 5、閱讀頁既有 2） |
| input rule 不擋 `!`／反斜線 | 2 |
| 貼上不看貼到哪裡 | 2（程式碼區塊、行內程式碼） |
| 切分器不看反斜線 | 1 |
| 編輯器沒有節點與 remark 外掛 | 114（往返測試與既有 `markdown-editor.test.ts` 合計 186 個中） |
| 編輯器沒有套用 stringify 設定 | 118 |
| 只拿掉 `text` handler 的包裝 | 8（都是跳脫案） |
| 只拿掉表格的 `\|` 補回 | 7（都是表格別名案） |
| 報告：掃描不是唯讀 | 1 |
| 報告：連 `\[\[x\]]` 這種半跳脫也算 | 單元 1、integration 1 |
| 報告：看所有 revision 而不只現行 | 1 |
| 報告：只讀第一批 | 1 |

**這張表裡有一次我自己的疏漏。** 「報告：半跳脫也算」第一次我用 `sed` 改，沒有真的改到（行內容沒變），卻看到「全部通過」——那次結果沒有意義。發現後用精確的字串替換重做，單元測試抓到，但 integration 沒抓到：integration 的「刻意跳脫」文件用的是 `\[\[literal\]\]`，那個形式不論有沒有那條規則都不會被比對。我在該文件加進一個 `\[\[half\]]`，重跑後 integration 也抓到了。

### 量測

| 項目 | main | 分支 |
| --- | --- | --- |
| 靜態 JS 總量（`.next/static/chunks`，78 個檔） | 1,820,392 bytes | 1,823,219 bytes（+2,827，+0.16%） |
| 同上，gzip（串接後壓縮） | 546,799 | 549,212（+2,413） |
| lazy chunk 合計（`<id>.<hash>.js`） | 256,625 | 258,860（+2,235） |
| 含 `editor-core` 的那個 chunk | 8,056 raw／3,487 gzip | 10,288 raw／4,429 gzip |
| `/edit` 的 First Load JS | 170 kB | 169 kB |
| `/new` | 171 kB | 170 kB |
| 文件頁 | 191 kB | 190 kB |

預期是個位數 KB，實測 +2.8 KB。First Load JS 在兩個方向都差 1 kB，沒有增加；我沒有追查為什麼少了 1 kB，那應該是 chunk 分組的差異，不是節省，請不要把它當成好處。

受損文件偵測器（`findEscapedWikiLinks`）的成本：在合成文件上量，約每 KB 2.4 ms，大致線性（1.2 KB 為 3.8 ms、5 KB 為 12 ms、20 KB 為 54 ms、100 KB 為 292 ms，都是每份含大量受損連結的情況）。它只對「SQL 預篩選說含有 `\[\[`」的文件執行。**這是合成輸入的量測，不是真實資料的量測。** 本機的 dev 資料庫有 145 份文件，報告顯示 0 份；`hcm_km_big` 只有 90 份很小的文件，不是大規模測試，我沒有真正的大資料集可量。

### 實作過程中測試與檢查抓到的問題

1. **spike：** 用 mdast 的 `html` 節點輸出，表格裡的 `[[Note\|alias]]` 會寫成 `[[Note|alias]]`，把儲存格切開，邊 1 → 0。改用自訂節點與 handler。
2. **main 上就有的另一個缺陷（D0b）：** Milkdown 的 `text` handler 對「以空白結尾、不含 `*`、`_`、`\`」的文字完全不跳脫，所以刻意跳脫的 `\[\[lit\]\] and ![a](/a.png)` 在 main 上就會變成真連結。我只處理了含 `[[` 的情形，其他 Markdown 字元的同類行為沒有動。
3. **貼上進程式碼區塊被轉成連結（我的錯）：** `transformPasted` 只看被貼的內容，而貼進程式碼區塊的文字到那裡時沒有外層的 code block。單元測試抓到。改成看貼上的位置。行內程式碼的結尾不在 code mark 之內（該 mark 不 inclusive），要看 stored marks；這個也是測試抓到的。
4. **jsdom 的限制：** 沒有 `ClipboardEvent`、不反映 `contentEditable`、處理方向鍵要量座標（沒有 `getClientRects`）。前兩個在測試裡補，方向鍵行為移到瀏覽器測試。
5. **e2e 的檔名排序連續弄壞兩個 graph 測試（我的錯）：** 第一版把互相連結的文件建在固定的空白 workspace，弄壞 `workspace-graph.spec.ts` 的「nothing is linked」。第二版改放 My Space、檔名排在前面，六份新文件改變了圖譜版面，`workspace-graph.spec.ts:44` 對節點的 `hover` 就落在畫布上（「svg intercepts pointer events」）。解法是檔名 `zz-…` 讓它最後跑，檔頭寫明原因。
6. **受損偵測器：** 我原本略過連結內的文字，測試的輸入其實不是連結（第一個未跳脫的 `]` 就結束了連結文字）；老編輯器在連結文字裡兩邊都會跳脫，所以那個形式根本不會出現，那段是死程式碼，已刪除。另外，兩個「刻意跳脫」的既有 fixture 讓偵測器找到的比我預期的多——不是偵測器錯，是**形狀本身分不出刻意跳脫與損壞**：刻意跳脫的 `\[\[x\]\]` 經舊編輯器存檔後也成了 `\[\[x]]`。測試改成把這個事實寫死，而不是假裝能分辨。
7. **我自己寫錯的數字：** 早先的規格草稿裡有兩個沒量的數字（「26 筆」「14 筆」），實測是 31 筆與 48 個測試，在 commit 前更正；計畫裡的 lazy chunk 增量一度寫成 2,232，實際是 2,235，已更正。

### 與規格的偏離（都已回寫進規格與計畫）

- 貼上：編輯器沒有 Markdown 貼上解析，規格原先說貼上會經過它，是錯的（規格 §4.1-4）。
- 點擊：規格原先說 ⌘/Ctrl-點擊可跟隨連結，做不到，因為編輯器沒有文件目錄來解析；任何點擊都只選取節點（規格 §4.1-5）。
- 抽取器、閱讀頁與編輯器共用一支走訪；沒有 `position` 的文字節點只看值，與閱讀頁一致（計畫 0.3）。
- 方向鍵：**沒有下斷言**。實測（Chromium）不同序列的行為不同：有的序列先選取連結、再按一次才越過，有的直接越過。Backspace 則是穩定的：游標在連結正後方按一次，整個連結被刪，Ctrl+Z 還原。

### 沒有做、或沒有證明的

- **已經受損的既有文件沒有修復。** 這是決定（先看報告再說），報告腳本已就緒：`make db-report-escaped-wikilinks`。**我不知道你的真實資料裡有幾份**，本機資料庫的 0 份說明不了什麼。報告列出的是候選，不是結論。
- 只在 Chromium 實測。Firefox、Safari 沒有跑。編輯器新增了一個含 look-behind 的 regex（`(?<![!\\])…`）；連結抽取器在 #78 就已經有一個。據我所知 Safari 16.4 之前不支援這種語法，但這是我的一般知識，**我沒有驗證**，也不知道專案支援哪些瀏覽器，請確認。
- 暗色模式：token 兩個主題都有值，但我只在預設主題下實測，沒有另外目視。
- 選取連結後直接打字會取代它（可 Ctrl+Z 還原）。這是 ProseMirror 對可選取原子節點的一般行為，沒有處理，要不要處理請你決定。
- 既有的脆弱點，與這次修改無關、沒有動：`workspace-graph.spec.ts:44` 的 hover 依賴圖譜版面；CI 上 `row-actions.spec.ts:74` 在 #79 失敗過一次，同一段程式碼重跑後通過，原因未確認。

### 重現

```bash
make verify                                              # unit + typecheck + lint + build
make test-integration                                    # 需要 MariaDB
make browsers && make test-e2e                           # 全部 e2e，含 zz-wikilinks-composer
make db-report-escaped-wikilinks                         # 唯讀：哪些文件可能被舊編輯器弄壞
npx vitest run --config vitest.config.ts tests/unit/editor-wikilinks.test.ts
```

## 切片 C — 程式碼區塊

**做了什麼。** 閱讀頁與分享頁的圍欄程式碼有語法顏色，每個區塊有複製鈕。composer 的渲染編輯器與它載入前的替身維持原樣（不上色、沒有按鈕）。

**分支**：`claude/code-highlight-slice-c`，從 `main`（`7d2697e`）開出。

| 任務 | commit | 內容 |
| --- | --- | --- |
| C.1 | `02519ee` | 依賴與實測的語言集寫回規格 |
| C.2 | `6789b46` | 高亮設定模組（第一版，用 `rehype-highlight`；C.7 改寫） |
| C.3 | `22243d2`、`908a857` | 八個語法 token 與對比守門測試；規則被 Tailwind 刪掉的修正 |
| C.4、C.5 | `d8d68bd` | 渲染器拆成 `MarkdownBase`／`MarkdownRenderer`／`MarkdownArticle`，複製鈕 |
| （文件） | `35bfc39` | 規格與計畫回寫 C.1–C.5 |
| C.6 | `f992f57` | e2e，5 案 |
| C.7 | `7c1e4ce` | 自己的高亮外掛：整份文件預算、巢狀深度上限；移除 `rehype-highlight` |
| （小修） | `c8c2cb6` | 複製鈕不列印 |

### 結果

| 檢查 | 開始前（main） | 現在 |
| --- | --- | --- |
| 單元測試 | 968 | **1057** 全過 |
| e2e | 150 | **155** 全過（`npm run test:e2e`，4.3 分鐘） |
| integration | 493 | **沒有在本機重跑**：這個切片沒有動任何資料庫相關的程式碼；CI 會跑 |
| `tsc --noEmit`、`eslint` | 乾淨 | 乾淨 |
| `next build` | 成功 | 成功 |

單元多出的 89 個：高亮模組 39、語法顏色 33、閱讀渲染器的程式碼區塊 14、composer 的 bundle 守門 3。

### 在缺陷版本上會紅（C.6 的要求）

e2e 的 5 案第一次就全過，所以我把它們對著故意弄壞的版本跑：**還原成規則被 Tailwind 刪掉的 CSS**（就是 `d8d68bd` 的樣子），並**拿掉複製鈕的結尾換行處理與 `catch`**。跑出 4 紅 1 綠，紅在預期的地方：

| 案 | 失敗的斷言 |
| --- | --- |
| 閱讀頁的顏色 | 關鍵字畫成內文色 `rgb(29, 31, 36)`，不是 token 的 `rgb(138, 47, 168)` |
| 複製逐字相同 | 剪貼簿多了一個換行 |
| 剪貼簿被拒 | 沒有出現「Could not copy」 |
| 分享頁 | 關鍵字顏色等於內文色 |
| composer 不上色 | **綠**——這兩個變異碰不到它。這一案寫的是「應該是這樣」，它抓不到「替身閃一下顏色」這種退步；那一條靠單元的 `composer-bundle` 守門（讀 import）與規格，沒有瀏覽器測試 |

### 變異驗證

每個守門都刻意弄壞一次，確認測試會失敗，還原後再確認全過（還原用 `cmp` 與原檔逐位元比對）。

| 弄壞的東西 | 抓到它的測試 |
| --- | --- |
| 拿掉單區塊上限 | 2 |
| 上限差一（`<=` 改 `<`） | 1 |
| 語言集拿掉 `dockerfile` | 3 |
| 偵測語言（`detect: true`，第一版外掛） | 2 |
| 超過上限後把其後所有區塊也標成純文字（第一版外掛） | 1 |
| 拿掉整份文件預算 | 4 |
| 被深度拒絕的區塊不算花掉預算 | 1 |
| 拿掉深度檢查 | 4（含 rust、swift 的崩潰案） |
| 拿掉文法例外的 `try/catch` | 1 |
| 忽略 `no-highlight` | 1 |
| 淡色的註解（對比不足） | 1 |
| 暗色主題少一個 token | 5 |
| 規則裡寫死顏色 | 2 |
| 關鍵字規則改用別的 token | 1 |
| 兩個 token 同色 | 1 |
| 拿掉 `built_in` 的規則 | 1 |
| **把規則包回 `@layer`（被 Tailwind 刪掉）** | **只有 1（編譯後樣式表的那條）**，其餘 32 條都過 |
| 閱讀渲染器不掛高亮外掛／不掛複製鈕／按鈕不畫／按鈕畫在 `<pre>` 裡 | 1／2／2／2 |
| composer 的替身碰到閱讀渲染器／`MarkdownBase` 引入高亮模組 | 各 2 |
| 拿掉 `print:hidden` | 1 |

**這張表裡的疏漏：** 「偵測語言」那一條第一次沒有套用（樣式在註解裡也出現一次，前置檢查擋下了），重做後才抓到。

### 量測

同一台機器、同一個方法，`main`（`7d2697e`）在 git worktree 另外 build 一次當基準。

| 項目 | main | 分支 |
| --- | --- | --- |
| 靜態 JS 總量（`.next/static/chunks`，兩邊都是 78 個檔） | 1,823,118 bytes | 1,827,782（+4,664，+0.26%） |
| 同上，gzip（串接後壓縮） | 549,055 | 550,407（+1,352） |
| 文件頁的 client JS（`app-build-manifest` 列的檔） | 607,044 raw／184,413 gzip | 608,304（+1,260）／184,430（+17） |
| `/edit` | 561,701／167,257 | 561,845（+144）／167,191（−66） |
| `/new` | 562,923／167,721 | 563,068（+145）／167,641（−80） |
| 分享頁 `/s/:token` | 366,965／107,751（6 個檔） | 379,893（+12,928，+3.5%）／112,260（+4,509）（7 個檔） |
| First Load JS，build 輸出 | 文件頁 191、`/edit` 170、`/new` 171、分享頁 109 kB | 190、169、170、**114** kB |
| client 端含 lowlight／`hljs-`／`registerLanguage` 的檔 | 0／80 | **0／80** |
| server 端含它們的檔 | 0／103 | 1／103 |

**這些數字怎麼讀。**

- **高亮沒有進任何 client bundle**：80 個 client 檔一個都沒有，server 端剛好一個。這是 `MarkdownBase`／`MarkdownRenderer` 分兩層的目的。
- **閱讀頁 client JS 增加 +1.26 KB raw（gzip +17 B）**——計畫預期是 0，原因是複製鈕是 client island。gzip 幾乎沒變，因為按鈕所需的元件在頁面上本來就有。
- **composer 的兩個頁面 +144／+145 bytes raw**：我沒有查是什麼；量級只有百來 bytes，高亮不在其中（上一列已證明 client 端沒有 lowlight）。
- **分享頁 +12.9 KB raw、First Load +5 kB**：它原本沒有任何互動元件，複製鈕第一次讓它載入按鈕元件與其依賴。我沒有逐一查是哪些模組。這是這個切片對讀者最大的 client 成本。
- **First Load 的 ±1 kB 差**（190／169／170 對 191／170／171，shared 103 → 102）與切片 0 的紀錄同一種現象：chunk 分組的差異，不是節省；請不要把它當成好處。

### 渲染成本（server，實測）

`renderToStaticMarkup` 對照 `MarkdownBase`（不上色）與 `MarkdownRenderer`（上色）；中位數。文件是把平台語言的範例重複成指定大小的區塊，**是合成輸入，不是真實文件**。

| 文件 | 不上色 | 上色 | 增量 | 沒有預算與深度上限時的增量 |
| --- | --- | --- | --- | --- |
| 20 KB runbook（10 個區塊） | 33 ms | 119 ms | +86 ms | 沒有量（沒有超過預算，應該相同） |
| 1 MB（200 個 5,000 字元的區塊） | 1,488 ms | 1,911 ms | **+422 ms** | +4,876 ms |
| 4 MB（200 個 19,999 字元的區塊） | 5,848 ms | 6,353 ms | **+505 ms** | +22,783 ms |

真實程式碼每 KB 約 5 ms：20,000 字元的 C 資料表 113 ms、INI 102 ms、SQL 102 ms、Python 98 ms。

**病態輸入。** 40 個語言 × 18 種輸入（重複的引號、反斜線、`/*`、`<`、括號、`$(`、數字…）各 19,999 字元：**0 次丟例外**（修之前 2 次：rust、swift 的 `/*`）；最壞的單一區塊 **1,892 ms（`ini`，連續數字）**，其次 arduino 1,670、cpp 1,542、c 1,490、csharp 1,387 ms。這不是線性的：`ini` 連續數字 2,500 字元 38 ms、5,000 字元 122 ms、10,000 字元 488 ms，每加倍約 ×4。所以單區塊 20,000 字元的上限把最壞情況限制在約 2 s，而整份文件的預算 100,000 字元允許最多約 5 個這樣的區塊——**我估計最壞約 10 s，是由單一區塊的量測推算的，沒有端到端量過**。要收緊是改 `MAX_HIGHLIGHT_CHARS`：10,000 字元則單一區塊最壞約 0.5 s。20,000 是規格 §5 你定的數字，我沒有改它；真實程式碼在那個大小很便宜（約 100 ms），成本只在刻意構造的輸入上。

### 實作過程中測試與檢查抓到的問題

1. **規則被 Tailwind 刪掉（我的錯，最重要的一個）。** 語法顏色規則寫在 `@layer components` 裡。Tailwind 會刪掉 `@layer` 裡「`src` 內沒有任何地方寫出該 class 名」的規則，而 `hljs-*` 是 highlight.js 渲染時才產生的：編譯後的 CSS 一條 `.hljs-*` 規則都沒有，`--kh-syntax-*` 只剩定義。頁面上程式碼沒有顏色，但原始碼與當時所有單元測試（讀原始 CSS）都正常。是為了寫 e2e 去確認規則有沒有出現在編譯結果才發現的。移出 `@layer`（沿用 `.kh-select` 已有的作法），並加一條把樣式表用 repo 自己的 Tailwind 設定編譯後再檢查的測試。
2. **`hljs-code` 沒有規則。** 「高亮器輸出的每個 scope 必須有顏色或在刻意不上色的清單」這條測試在寫的當下就抓到：markdown 圍欄裡的行內程式碼會產生它。
3. **rust、swift 的巢狀註解讓整頁渲染失敗（量測時發現）。** `/*` 重複 1 萬次 → 1 萬層 `<span>` → `RangeError: Maximum call stack size exceeded`。3,000 層會丟、5,000 層卻不丟（取決於 JIT 暖機），所以不能用「大概不會遇到」。`rehype-highlight` 會遞迴進它剛產生的結果，所以無法給它加限制，改成自己的外掛。
4. **整份文件沒有總量上限（量測時發現）。** 見上表；文件上限是 5 MB，沒有預算的最壞情況是 +28 s 等級。
5. **壞文法的測試第一版測錯了東西（我的錯）。** 我用一個註冊時就丟例外的文法，但 highlight.js 在註冊時自己吞掉並印 `console.error`，`registered()` 為 false，外掛根本沒走到 `try/catch`——那條路徑其實沒被測到。stderr 裡多出的 `Error: boom` 讓我發現。改用「註冊成功、第一次使用才丟 `SyntaxError`」的文法（無效的正規式）。
6. **e2e 第一次跑失敗是資料庫沒在跑**（容器重啟後 MariaDB 沒有起來），不是測試。
7. **兩處我自己測試寫錯：** raw HTML 被轉成文字，`onclick` 這個字當然會出現在文字裡（該斷言的是元素與屬性）；`<pre>` 有 class。
8. **計畫 C.5 自相矛盾：** 原寫「composer 預覽共用」，與規格 §5 的範圍（composer 不高亮）衝突。以規格為準。
9. **規格 D4 的「client 零 JS」不成立：** 複製鈕是 client island。已改寫。

### 與規格的偏離（都已回寫進規格與計畫）

- 不用 `rehype-highlight`，改成自己的 rehype 外掛，直接用 lowlight（規格 D4、§5；上面第 3、4 點）。
- 新增整份文件 100,000 字元的預算與巢狀深度 50 的上限（規格 §5「限制」）。這兩個是我加的，不是你決定的；不影響一般文件，只影響極端輸入。
- 單區塊上限以字元計，含 Markdown 加在結尾的換行（規格原寫「20 KB」）。
- 複製的文字在點擊時讀 `<pre>` 的 `textContent`，不由 prop 傳入（規格原寫「由 hast 取得」）；按鈕常駐可見而非 hover 才出現。
- 渲染器分成 `MarkdownBase`（composer 用，沒有高亮與按鈕）與 `MarkdownRenderer`（閱讀用），composer 的替身不上色（計畫 C.5 原寫共用）。
- 語言集實測與規格的印象不同：`common` 共 37 個，`dockerfile`／`groovy`／`protobuf` 不在其中；缺 `properties`（Spring）、`nginx`、`scala`、`gradle`，§12-5 決定不加，只記錄。

### 沒有證明的部分

- **暗色主題只驗證了顏色，沒有目視。** e2e 確認暗色下關鍵字的計算色等於暗色 token 且不同於亮色，對比 ≥ 4.5:1 是算出來的；我沒有看過實際畫面。
- **只在 Chromium 測過**，複製在 Safari／Firefox 沒有測。沒有剪貼簿的環境（非安全內容）用 stub 模擬，沒有用真的 http 部署測。
- **螢幕閱讀器沒有實測。** `aria-live="polite"` 區域與按鈕的名稱有斷言，但沒有用真正的螢幕閱讀器聽過。
- **列印只驗證了 class 有輸出**（Tailwind 編譯結果與單元斷言），沒有看過列印預覽。
- **渲染成本是合成輸入。** 我沒有真實的大文件可量；最壞情況的 ~10 s 是推算。
- **`row-actions.spec.ts:74` 的間歇性失敗與這個切片無關**，這次完整 e2e 它剛好過了；它的診斷與提議的修法記在 #79 的留言。

## 切片 A-1 — 整理與封存：資料夾、封存與還原、在資料夾內新增文件

**做了什麼。** 樹上的資料夾與文件列有了選單（右鍵與 `⋯`）：新增資料夾、重新命名、封存與還原（文件與資料夾，附 Undo）、在資料夾內新增文件。這些命令服務層早就有，這個切片補的是 HTTP 路由、registry 的項目與 web 入口。移動與重排（「移到…」、`Alt+↑/↓`）是 A-2。

**分支**：`claude/organize-archive-slice-a1`，從 `main`（`2190e77`，切片 C 之後）開出。

| 任務 | commit | 內容 |
| --- | --- | --- |
| A1.1 | `9b77326` | 樹與資料夾的錯誤碼有了狀態（不再是 500） |
| A1.2 | `6a62100` | 解析建立／重新命名資料夾與文件的 `parentId` |
| A1.3 | `baa5786` | 路由與 54 個 integration |
| A1.4 | `261804c` | registry：文件封存／還原、資料夾動作、Create folder |
| A1.5–A1.7 | `719245c` | client 端動作、資料夾選單、名稱對話框、`?folder=` |
| A1.8 | `a143e27` | e2e 9 案，以及它抓到的三個實作問題的修正 |
| A1.9 | （本 commit） | 文件與驗證紀錄 |

### 結果

| 檢查 | 開始前（main） | 現在 |
| --- | --- | --- |
| 單元測試 | 1057 | **1198** 全過 |
| integration（`npm run test:integration`，本機） | 493 | **547** 全過（+54，`organize-api.test.ts`） |
| e2e（完整，`npm run test:e2e`，4.9 分鐘） | 155 | **164** 全過（+9，`zz-organize.spec.ts`） |
| `tsc --noEmit`、`eslint` | 乾淨 | 乾淨 |
| `next build` | 成功 | 成功 |

單元多出的 141 個：錯誤對應 8、輸入解析 20、registry 83（其中兩個各 32 格的完整矩陣）、訊息 18、存取重新確認 12。

### 變異驗證

每個守門都刻意弄壞一次，確認測試會失敗，還原後再確認全過（還原用 `cmp`）。

| 弄壞的東西 | 抓到它的測試 |
| --- | --- |
| 六個錯誤碼各自從對應清單拿掉 | 各 1 |
| ID／parentId 不驗、名稱不正規化、沒有長度上限、長度在去空白前計、路徑 ID 不驗 | 1／4／4／2／1／1 |
| 路由：不比對 sourceId 屬於哪個 workspace | 1（**第一版測試沒抓到**：呼叫者不是那個 workspace 的成員時，服務本來就回 404；補了「同一人屬於兩個 workspace」一案才守得住） |
| 路由：忽略 parentId（資料夾、文件各一） | 5／4 |
| 路由：封存回的 backlink 數恆為 0、已封存的 source 被藏成 404、不驗 workspace ID | 各 1 |
| registry：略過擁有者（文件、資料夾各一）、還原不看 source 狀態、資料夾動作略過 source 狀態、rename 進 palette、Create folder 進空狀態、連結帶封存後綴、Archive 排到最前 | 5／3／2／2／1／2／1／1 |
| 訊息：連結數提示恆顯示、名稱不 trim、長度差一、預設吞掉伺服器訊息、非空說明沒有下一步 | 各 1–2 |
| 存取重新確認：六個碼各自從排除清單拿掉、拿掉提早 return | 各 1／6 |
| e2e：封存開著的文件時不導覽 | 第 4 案 |
| e2e：`document.archive` 不看擁有者 | 第 9 案 |
| e2e：樹的 409 觸發存取重新確認 | 第 7、8 案（**第一版斷言沒有偵測力**：見下） |

### 寫 e2e 時抓到的實作問題（我的錯，都已修）

1. **樹的 409 讓 shell 暫停。** `requestWorkspaceAccessCheck` 對所有 409 都重新確認存取權；確認期間所有寫入動作暫停，還閃出「Unable to confirm workspace」。「資料夾不是空的」是這個切片最常見的拒絕，等於每次都閃。這些碼說的是內容不是權限，與 `REVISION_CONFLICT` 同類，排除。**第一版 e2e 斷言「Unable to confirm workspace 不存在」沒有偵測力**——重新確認很快就成功，閃爍在斷言前已結束；把它拿掉時第 7、8 案照樣綠。改成監聽 `kh:workspace-access-check` 事件並斷言次數為 0，才會紅。
2. **封存開著的文件後，Undo 的 toast 消失。** 我以為 `router.push` 只讓路徑變一次；用暫時的除錯 spec 每 250 ms 記網址與 toast，看到路徑變了**兩次**：先改成清單（`/knowledge/:source`），伺服器的 redirect 再換成第一份文件。「只撐過一次導覽」的實作只擋住第一次。改成撐過 toast 自己動作之後 3 秒內的導覽。
3. **導向清單後側欄是舊的。** 目的地是 redirect，`refreshOnArrival` 要的路徑對不上。新增 `refreshOnArrivalElsewhere`（離開這個路徑後的第一個到達點就刷新），並讓知識 layout 也掛 `useRefreshOnArrival`（最後一份文件被封存後的空狀態頁沒有文件面板）。

### 其他過程中的錯誤

- **唯讀成員的回應我預期 403，實際是 404。** 寫入路徑沿用 Phase 1 的契約（沒有 `document.write` 就是 `WorkspaceAccessDeniedError`，隱藏的 404），既有的文件寫入也一樣。我改測試斷言「被拒絕且沒有寫入」，原因寫在檔頭與規格 §7.5。
- **`&&` 串起來的指令沒有因 `tsc` 失敗而停下**，一個型別錯誤的 commit 進去了；發現後併回尚未推送的 commit。
- **e2e 單跑時我的 spec 假設 My Space 已有文件**（整個套件裡前面的 spec 會先建）；工作空間是空的時沒有側欄。每案先建一份文件，不依賴前面的 spec。
- **本機 MariaDB 在容器重啟後掛掉**，重啟過兩次（不是測試問題）。

### 量測

Next 的 build 輸出（有 ±1 kB 的分組誤差，見切片 0 的紀錄）：

| 頁面 | 切片 C 之後 | A-1 |
| --- | --- | --- |
| 文件頁 First Load JS | 190 kB | **194 kB**（+4） |
| `/edit`、`/new` | 169、170 kB | 170、171 kB |
| 圖譜、分享頁 | 119、114 kB | 119、114 kB（不變） |

+4 kB 是知識 layout 現在帶著資料夾名稱對話框與 `use-tree-mutations`；layout 是所有知識頁共用的 client 元件，所以文件頁付這個成本。我沒有查它的組成。

### 與規格的偏離（都已回寫進規格 §7.5 與計畫）

- 唯讀成員的回應是 404，不是 403（見上）。
- 建立資料夾的入口是 Notes 列 `+` 旁的一顆按鈕，不是把 `+` 改成選單；空的 workspace 沒有側欄，所以第一份文件之前只有 palette 能建資料夾。
- 文案：規格原本寫 toast 與錯誤說明用中文；2026-09-30 依你的決定全部改英文（選單、對話框、toast、錯誤說明一致），集中在 `organize-messages.ts`。composer 與上傳編碼錯誤那幾句舊的中文沒有動。
- toast 多了一個 `survivesNavigation`；`GovernanceError` 對樹的碼改用白話說明。
- 樹會展開目前文件的祖先資料夾（規格沒寫，為了在資料夾內新增的文件看得到）。

### 沒有證明的部分

- **視覺沒有目視。** 已封存的列（`Archived` 標示、次要文字色）、資料夾標題列的 hover 與 `⋯`、對話框在亮暗兩個主題下的樣子，都只由 e2e 的屬性斷言涵蓋，我沒有看過畫面。
- **資料夾的鍵盤操作只驗了 `⋯` 按鈕**（聚焦後 Enter）。資料夾列本身是 treeitem 而選單掛在標題列，所以聚焦在資料夾列上按 ContextMenu 鍵／Shift+F10 不會開它的選單——鍵盤入口是 `⋯`。觸控長按沒有測。
- **兩個分頁的競爭只驗了一種**：新增文件頁開著時資料夾被封存（`zz-organize` 第 8 案）。其他順序（兩個分頁同時封存同一份文件）靠服務的冪等，integration 有測，瀏覽器沒有。
- **文件還原被拒絕（父資料夾已封存）**在瀏覽器裡沒有 e2e；integration 與 `organizeFailure` 的單元測試各涵蓋一半。
- **只在 Chromium 測過。**
- **效能沒有量**：資料夾很多、樹很大的時候，`buildKnowledgeTree` 與展開祖先的 effect 的成本。
- 螢幕閱讀器沒有實測；`aria-live` 區域是既有的 toast 區域。

## 切片 A-2 — 移動與重排：「移到…」對話框、palette 的 Move document…、Alt+↑/↓

**做了什麼。** 樹上的文件與資料夾列的選單多了「Move document…」「Move folder…」，打開對話框，列出該來源的資料夾與最上層，選一個就放在那裡的最後；palette 對目前開著的文件也有「Move document…」；樹上聚焦一列按 Alt+↑／Alt+↓，在同層上下移一格。服務層（`moveTreeNode`、`reorderTreeNode`）早就有；這個切片補的是 `PATCH /api/tree-nodes/:id` 的移動與重排形狀、registry 的項目與 web 入口。

**分支**：`claude/organize-move-slice-a2`，從 `main`（`7aedcd4`，A-1 與 #83 之後）開出。

| 任務 | commit | 內容 |
| --- | --- | --- |
| A2.1 | `6510eca` | PATCH 的三種形狀與 27 個 integration |
| A2.2–A2.4 | `e0239a2` | registry、對話框、樹上的 Alt+↑/↓、jsdom 與 e2e |
| A2.5 | `28d95d8` | 文件與驗證紀錄 |
| — | （本 commit） | 與 folder sync 的混合情境測試（integration 6 案） |

### 結果

| 檢查 | 開始前（main） | 現在 |
| --- | --- | --- |
| 單元測試 | 1198 | **1276** 全過 |
| integration（`npm run test:integration`，本機） | 547 | **580** 全過（+33：`organize-api.test.ts` +27，`sync-and-organize.test.ts` +6） |
| e2e（完整，`npm run test:e2e`，5.6 分鐘） | 164 | **177** 全過（+13，`zz-organize-move.spec.ts`） |
| `tsc --noEmit`、`eslint` | 乾淨 | 乾淨 |
| `next build` | 成功 | 成功 |

單元多出的 78 個：registry +37（其中一個 32 格矩陣）、body 解析 +14、樹的重排（jsdom）14、`moveDestinations`／`reorderStep` 10、訊息 +3。

### 變異驗證

每個守門都刻意弄壞一次，確認測試會失敗，還原後再確認全過（還原用 `cmp`）。

| 弄壞的東西 | 抓到它的測試 |
| --- | --- |
| 路由：移動忽略 `parentId`、移動忽略 `position`、重排忽略 `position`、改名改了名字（對照） | 9／3／2／1（integration） |
| body 解析：null 的 parent 不算移動、預設放最前而不是最後、名稱與位置可同時給、位置允許 -1 | 1／2／1／1 |
| `reorderStep` 要鄰居在畫面上的索引而不是它的儲存位置 | 1（對真服務的隨機測試；**第一版沒抓到**，見下） |
| registry：document.move 不看來源狀態、不看擁有者、不進 palette；folder.move 進了 palette | 1／3／1／1 |
| 樹：拿掉「該列有 Move 才理這個鍵」、拿掉篩選中不動、拿掉請求中保留最後一鍵、接受其他修飾鍵、拿掉焦點放回、方向反了 | 各 1／1／1／1／1／5（jsdom） |
| e2e：不展開目的資料夾、篩選中仍重排、請求中的鍵被丟掉 | 各 1 |

### 寫的時候抓到的問題（我的錯，都已修）

1. **對真服務的隨機測試第一版沒有偵測力。** 我用的亂數是線性同餘產生器取 `% 4` 與 `% 2`，低位元會交替，四份文件只走了幾種固定的步。把 `reorderStep` 改成要畫面上的索引（會落在隱藏節點的錯誤一側），測試照樣過。換成 mulberry32、步數 40→60，並斷言至少有 30 步是真的移動（不是撞牆），改壞後才紅。**只有變異驗證抓到它**；沒做的話，這個測試看起來是「已證明隱藏的已封存節點不會讓順序錯」，實際什麼也沒證明。
2. **e2e 點隱藏的 radio 沒有反應。** 我用 `check({ force: true })` 點 `sr-only` 的 input，它在對話框左上角（label 沒有 `relative`，絕對定位是相對於對話框），那個座標點到的是別的東西；十二案裡十案「剛好」過、兩案不過。改成 label 加 `relative`，測試點 label 的文字，跟讀者一樣。
3. **我原本的 aria-live 區域用了 `role="status"`，會讓既有的 e2e 出現 strict mode 違規。** 先 grep 了 `getByRole("status")`（`row-actions.spec.ts:142` 在有樹的頁面上，頁面全域找 status），改成 `aria-live="polite"` 不帶 role。這一個是跑之前查出來的，不是被測試抓到的。
4. **請求進行中按的鍵一開始是直接丟掉。** 想到先下後上快速按，第二下被吃掉，列會停在往下一格，跟使用者要的「走回來」相反。改成保留最後一個，新的樹到了再照新的樹算。對應的 e2e 用同一個 tick 內 dispatch 兩個 keydown（否則第二下可能等到第一步完成才到，改壞了也會過）。
5. **`&&` 串起來的指令沒有因 `eslint` 失敗而停下**，一個 lint 錯誤（測試裡沒用到的 `_prefetch`）的 commit 進去了；發現後併回尚未推送的 commit。跟 A-1 是同一個錯，這次仍然犯了。
6. **jsdom 沒有 `CSS.escape`**，我在放回焦點時用它組選擇器。改成走訪 `[data-node-id]` 比對 dataset，不必轉義任何 ID 也不依賴這個 API。
7. **第一次改壞 e2e 用的變異不是 lint 乾淨的**（移掉一段留下沒用到的變數），`next build` 的 lint 步驟先失敗，我看到的是「什麼都沒輸出」。改成 `void x`。

### 一個沒被證明有必要的東西

**放回焦點的程式碼，在 Chromium 上不需要。** 我把它拿掉、寫了探測用的 e2e：往下移的那一步，被移動的節點會收到兩次 `focusout`，但事後的 `document.activeElement` 仍是那一列。也就是 Chromium 自己把焦點還回去（或根本沒失去）。所以完整 e2e 拿掉那段程式碼照樣全過，**e2e 分辨不出有沒有它**。它留在程式碼裡，是因為別的瀏覽器移動有焦點的節點時不一定保留焦點；單元測試（jsdom）用「先 `blur()` 再重畫」模擬那種瀏覽器，拿掉它會紅。這個保護在 Firefox 與 Safari 上沒有實測過。

### 與 folder sync 的混合情境（`tests/integration/sync-and-organize.test.ts`，6 案）

問題是「Hub 這邊整理（A-1、A-2），會不會弄壞 folder sync」。答案來自程式碼：sync 的寫入端都要求 `SOURCE_MANAGED`，Hub 的都要求 `HUB_MANAGED`，來源的擁有者建立後不會變。這個測試把它從外面證明一次，用真的服務與真的資料庫，兩個方向：

- Hub 整理兩輪（建資料夾與文件、移進資料夾、移到最上層最前面、改名、資料夾移進資料夾、文件封存又還原、資料夾封存）之後，同步來源的 `knowledge_sources`、樹、文件、revision、link index、`source_entries`、`sync_runs` **每一列逐欄相同**（含時間與 `updated_by`）。
- 對同步來源套用兩次有變動的 sync（改內容、刪檔、新增、搬移、檔案換位置回來）之後，Hub 的 Notes 同樣逐列不變。
- Hub 對同步節點的 rename、移動、重排、封存、還原、在裡面新增資料夾或文件、把 Hub 節點移進同步資料夾，全部被拒絕，兩邊的列都不變，之後的 sync 仍照常套用。
- 同一串 sync（v1→v2→v3）有 Hub 夾在中間與沒有，最後同步來源給讀者看的樣子（樹、entries、每份文件的 revision 數、版本）相同。
- 唯一的間接影響是讀取時的：同步文件裡的 `[[Hub note]]` 在 Hub 文件被封存期間變成未解析，還原就回來；同步來源那邊什麼都沒被寫。

**變異驗證。**

| 弄壞的東西 | 結果 |
| --- | --- |
| 擁有者守門關掉（`requireOwnedSource`） | 「被拒絕」那案紅 |
| 讀一個來源的樹時改成讀整個 workspace 的（跨來源污染） | 三個「逐列不變」與「有沒有 Hub 夾在中間」的案紅（**第一版只有兩個紅**，見下） |
| `assertActiveFolderAncestry` 不比對父節點的來源；`moveTreeNode` 不擋 `CrossSourceMoveError` | **沒有紅**，因為資料庫的外鍵 `fk_tree_parent_same_source (source_id, parent_id)` 獨立擋住了（測試看到的仍是 409 且沒有寫入）。這是等價變異，不是缺口：程式碼與資料庫各守一次，我只證明了結果 |

**第一版的測試沒有偵測力，兩處，都靠變異驗證抓到：**

1. 「Hub 整理不動同步來源」原本不會被跨來源污染的變異弄紅。我把一個節點移到最上層最前面、又移回最後，跨來源的重新編號先把同步來源的位置推開、後一步又推回原位，逐列比對看到的是原樣。改成移到最前面就留在那裡。
2. 我另外寫了一案「每個來源的同層各自從 0 起算」，改壞後照樣過，它什麼也沒證明，刪了。

另外，最上層的節點在同一個 workspace 內以 ID（時間排序的 uuidv7）決定同位置的先後，所以測試的 `world()` 先建兩個 Hub 最上層節點，再做 sync：反過來（sync 的節點比較舊）污染會被藏起來。

**沒有證明的部分。**

- **完整 integration 跑過一次在 `knowledge-link-service.test.ts` 的「says how much of the index can be trusted」失敗（106 秒）**，之後連跑兩次全過（580/580）。那個測試只用自己的 workspace，不依賴全域狀態，我沒有找到原因，懷疑是 MariaDB 剛重啟後的環境因素，但這是猜測。
- 同步走的是匯入服務（`create`／`upload`／`finalize`／`apply`），資料是記憶體裡的位元組，不是瀏覽器選資料夾上傳。
- **兩邊同時發生**（Hub 在 sync 套用的那一瞬間整理）沒有測。兩邊都先鎖來源（`FOR UPDATE`）再鎖 workspace，不會交錯，但那是我讀程式碼的結論，不是跑出來的。
- 只驗了 `FOLDER_SYNC` 這一種同步來源。

### 量測

Next 的 build 輸出（有 ±1 kB 的分組誤差，見切片 0 的紀錄；每次 `test:e2e` 建兩次，兩次差 1 kB）：

| 頁面 | A-1 之後 | A-2 |
| --- | --- | --- |
| 文件頁 First Load JS | 194 kB | **194–195 kB** |
| `/edit`、`/new` | 170、171 kB | 171–172 kB |
| 圖譜、分享頁 | 119、114 kB | 119–120、114–115 kB |

在誤差內。`MoveDialogHost` 進了知識 layout，所以所有知識頁付這個成本；我沒有查它的組成。

### 與規格的偏離（都已回寫進規格 §7.6 與計畫）

- 標籤是 `Move document…`／`Move folder…`，不是「移到…」。
- palette 的「Archive document」A-1 已經加了；A-2 只多 Move。
- 重排沒有 Undo toast，用 aria-live 報位置。
- 對話框沒有搜尋欄。
- **沒有在 macOS 與 Windows 實測 Alt+↑/↓**（計畫 A2.4 要求）。

### 沒有證明的部分

- **視覺沒有目視。** 對話框（縮排、Current 標示、選取與焦點的樣子、捲動）在亮暗兩個主題下都只由 e2e 的屬性斷言涵蓋，我沒有看過畫面。`has-[:checked]`、`has-[:focus-visible]` 這幾個 Tailwind 變體有沒有編出對的 CSS，只從「測試能選到、按得到」間接知道，我沒有讀編出來的樣式表。
- **macOS 與 Windows 的 Alt+↑/↓。** 見上。
- **Firefox、Safari。** 只在 Chromium 測過；放回焦點的保護在那兩個上沒驗證。
- **螢幕閱讀器沒有實測**；aria-live 的內容、每則重新掛上是否真的讓同樣的話讀兩次，都是照規格寫的，沒有聽過。
- **很大的樹。** 對話框是 `max-h-72` 捲動，沒有量過幾百個資料夾的樣子；每次重排要走訪一次 `[data-node-id]`。
- **位置連續的假設**只由「Hub 管理的同層在每次建立與移動後被重新編號」這個事實與那個隨機測試撐著；若某條路徑（例如未來的匯入到 Hub 來源）留下空洞，`reorderStep` 會有偏差，畫面上的順序可能差一格。服務端夾住過大的索引，所以不會壞，只會不準。
- **兩個分頁的競爭。** 對話框開著時目的資料夾被封存有 e2e；兩個分頁同時重排同一同層沒有測，靠服務的鎖與「請求進行中保留最後一鍵」是同一個分頁內的事。
- **重排失敗的樣子**只有 jsdom 測了「不報位置、不放回焦點」；瀏覽器裡「失敗時 toast 說話」沒有 e2e。


## 切片 D — `[[` 自動完成與從失效連結建立文件

分支 `claude/wikilink-autocomplete-slice-d`，三個提交：清單的資料與排序（`1689ba7`）、渲染編輯器裡的清單（`7c72ad3`）、從失效連結建立（`36688e5`）。設計與偏離見規格 §6.3。

### 結果

| 層 | 新增 | 結果 |
| --- | --- | --- |
| 單元 | 98 案（`link-suggestions` 21、`wikilink-suggest` 49、`create-from-link` 14、`document-links-panel-create` 3，另在 `markdown-renderer-links`、`phase5-authoring-input`、`document-draft`、`graph-model` 各加案） | 全套 90 檔 **1377/1377** |
| integration | `listLinkTargets` 6、`link-targets-api` 8、`new-document-from-link` 4 | 全套 51 檔 **599/599** |
| e2e | `zz-composer-autocomplete` 9、`zz-create-from-link` 5（含唯讀成員與編輯者兩個身分）；改了 3 處既有斷言（見下） | 全套 **195/195**（6.8 分鐘），沒有 flaky、沒有跳過 |
| `tsc`、`eslint`、`next build` | — | 乾淨；每次 `test:e2e` 的 build 兩次都過 |

**合併時的全套數字**（併入 #86／#87 之後，#88 合併前最後一次）：單元 1409、integration 603、e2e 199。上表是分支上、併入之前的數字。

**不走 `showMarkdown` 的證明。** 自動完成的 jsdom 測試與 e2e 都在渲染編輯器裡打字，選取後用抽取器讀**存出去的 Markdown** 有哪些連結（`savedLinks`），並且讓文件走一次 `replaceMarkdown` 往返後逐字相同——CLAUDE.md 的不變式（編輯器必須把 wikilink 寫回原樣）對這條新的寫入路徑成立。

### 變異驗證

每個都是改一處、跑對應的測試、看有沒有紅；存活的逐一處理：

- **`listLinkTargets`／路由／repository（12 個）**：存活 1 個——把 `d.status = 'ACTIVE'` 拿掉。原本「封存」的案例是兩邊一起封存（文件列與樹節點），分不出各自的條件；補了「只封存文件列」的案例後被殺。
- **`rankSuggestions`／觸發偵測／`isWritableAsWikiLink`（19 個）**：存活 2 個，都是等價的——空查詢時放哪一層（只有一層）、寫得成連結的檢查裡多出的「沒有 fragment 與別名」（另一個條件已經蓋住）。
- **外掛與清單 DOM（約 40 個）**：第一輪存活 11 個。逐個看：`keyCode 229` 與 `isComposing` 在同一個測試裡連按，第一個按鍵就已經讓後面不成立（拆成兩個案例）；「Esc 之後同一個位置」的測試偵測不到 `dismissed` 沒被清掉（位置經過 mapping 會移動；改成「游標離開再回來會重開」）；Shift+Enter 沒有案例；⌘Enter 的案例在 jsdom 用 `metaKey`，而 ProseMirror 的 `Mod` 在那裡是 Ctrl（改用 Ctrl，才偵測得到 composer 原本的處理被丟掉）；三種監聽沒移除（改成計每個 `addEventListener` 有沒有對應的 `removeEventListener`）；「有選取範圍就不觸發」的測試選的範圍起點在 `[[` 之前，所以拿掉那個條件也一樣過（改成選最後一個字）；選取後游標沒移動的那行，與列上 `mousedown` 的 `preventDefault`（清單本身已經擋了），其實都是多餘的（映射本來就把游標放在新節點之後），刪掉。**最後剩兩個沒有可觀察差別的**：唯讀時鍵處理裡與 `sync` 重複的防衛，以及卸載時沒清的 `listeners` 集合（只是記憶體，沒有行為）。
- **從失效連結建立（29 個）**：存活 4 個。三個被新測試殺掉——`link.kind !== "WIKI"` 與圖譜節點的 PATH 判斷（我的測試只用了含 `/` 的路徑，而 `gone.md` 單獨是個合法的標題）；`renderedLinksFrom` 沒有測試（讀者測試都是手寫 `RenderedLinks`，繞過了它）。剩一個等價的：`titleForNewDocument` 的 512 字元上限，抽取器本來就不抽超過 512 的目標，所以那行是明說用意的重複。

**側欄的「4 筆加 Show all」（見下一節）：**

- **e2e 9 個變異體：7 個被殺，2 個存活——兩個都是真的測試缺口，不是等價：** 「剛好 4 筆就出現 Show all」（`>` 寫成 `>=`）與「Show all 的數字寫成藏起來的筆數而不是總數」。我的 e2e 用 My Space，帳號裡的收藏會累積（#86 起依帳號同步），湊不出「剛好 4 筆」，數字又只用 regex 比對。Team workspace 的種子來源湊不到 5 份文件，在共用資料庫裡新增文件又會牽動其他 spec。
- **修法：把判斷抽成純函式 `favoritesInPlace`**，邊界用單元測試釘死（0、3、4、5、10 筆；數字是總數；順序；不改輸入）。**輔助函式 6 個變異體 6/6 被殺**（限制 4→5、4→3、`>=`、隱藏數、取最舊的四筆、改動輸入），先前存活的兩個也在內。e2e 保留整合層的檢查。

### 側欄收藏：做了兩個版本，第一版的說法站不住

**第一版**把全部收藏列出來、超過 `max-h-72`（18 rem）在清單內捲動，PR 說明與規格都寫「不把樹擠出畫面」。**那句話沒有量過，量過之後是錯的**：1280 寬、10 筆以上收藏，樹從側欄頂端算 366px 才開始；視窗高 720px（側欄 604px）時不捲動只看得到約 238px 的樹，600px 時約 118px；清單內外還有兩層捲動，游標在清單上滾輪不會捲外層。是使用者問「收藏超過四筆不會擠到其他項目嗎」才去量的。

**第二版（現在）**：預設列出最新加的 4 筆，超過 4 筆時多一列「Show all N」，開啟現成 `ui/menu` 的 Menu 列出全部，每一項是真的連結（`<a role="menuitem" href>`）。使用者提的做法；Menu 當連結用沒有問題（先試 `render={<Link/>}`，e2e 斷言了 `href`，沒有退回就地展開的備案）。

- **量測（720px 高、10 筆以上收藏）：這一節固定 206px**，與收藏數無關（同一個帳號累積到 20、30 筆時仍是 206px）；第一版是 288px 的清單加標題。
- **看過畫面：** 亮色與暗色（暗色用 `data-theme="dark"`，不是 `emulateMedia`——我第一次用 `emulateMedia` 截的「暗色」其實還是亮色，發現後才改）、720px 高、4 列加「Show all 20」、面板在右側、目前這份高亮、來源名稱在右。面板第一版寬 `w-72`，很長的標題截太多，改成 `w-96`（並限制不超出視窗）。
- **代價：** 第 5 筆以後要多點一次；面板裡的列沒有星號按鈕，要取消星號得從前 4 筆、樹的那一列或文件頁；面板沒有搜尋。

### 寫的時候測試與檢查抓到的問題（我的錯，都已修）

- **`row-actions.spec.ts:75` 紅了，是 B.0 造成的競態；我第一個診斷只對了一半，第一個修法沒有修好。** 測試開 palette、確認第一列被選中、按 ↓、期待第 2 列被選中；單獨跑與 29 案一起跑都過，完整套件裡連續兩次紅（先前的完整跑與 CI 都過，是運氣）。
  - **第一個診斷（對了一半）：**「最近開過」的回應在 ↓ 之後才到，我的程式把使用者已選的那一列保持在原列（往下挪），第 2 列就不是被選中的。這是真的——trace 裡那個請求只花約 17ms，窗口很小。**修法：** listbox 加 `aria-busy`（回應還沒回來時為 true，**在開啟的那一次 render 就是真的**，不靠 effect），共用的 `openPalette` fixture 等它結束；新的 e2e 用 `page.route` 把回應延遲 1.5 秒，斷言載入中是 busy、使用者已選的那一列在回應到達後仍是被選中的那一列。**但加了這個修法後，完整套件裡同一案還是紅。**
  - **真正的原因（看失敗當下的快照：第 2 列是「Open graph」這個動作列，所以列表在 ↓ 之後又變了）：** 這個測試的工作空間裡「正在讀的文件」要等頁面 topbar 的 effect 註冊（`reading`），在那之前它是 `undefined`；最近開過把「正在讀的那份」也列出來，等 `reading` 知道了那一列又消失，選取跟著往上挪回第 1 列。`aria-busy` 擋不住——那時 ID 清單已經變了、請求早已結算。**修法：** 目前文件的 ID 本來就在 URL 裡、第一次 render 就知道，新函式 `documentIdInPath(pathname)` 同步取出它，與 `reading` 一起當排除項，「正在讀的那份」從頭到尾不會出現。（不能用 `isUuid`：`uuidv7.ts` 會 import `node:crypto`，進了 client bundle 會出事；用本地的格式比對，反正這只是把一份文件從清單拿掉，不授權任何事。）
  - 我第一版 e2e 的斷言假設最近開過只有 2 列（單獨跑時成立；與其他測試一起跑時前面的測試已經建過文件，`goto("/")` 會多落在一份舊文件），改成比對「選中的是同一列的文字」。

- **矮視窗裡清單蓋住游標那一行**（e2e 抓到）。第一版只決定放上或放下，清單比兩邊的空間都高時就疊在那行字上。現在兩邊都放不下時清單自己捲動（`max-height` 依剩下的空間）。
- **e2e 的 `getByRole("textbox")` 在清單開著時找不到編輯器**——因為它此時是 `combobox`。這是設計上的後果，測試改用 `aria-label` 找。
- **快速打字讓選取與之前的輸入併成同一步 undo**（jsdom 抓到）；加 `closeHistory`，選取是獨立一步。
- **Enter 在沒有結果時被編輯器自己的 keymap 處理**（拆段落），所以「沒有吞」不能用 `defaultPrevented` 判斷，改看文件。
- **兩個 lint／型別錯誤**：測試裡的 `!` 接在 `?.` 後；測試的 `index` 形狀與 `LinkIndexState` 不符（我先寫了猜的欄位）。
- **既有 e2e 三處預期會變：** `reading-links` 兩案（可寫者看到的失效連結現在是通往表單的連結）、`workspace-graph` 的 ghost 節點（可寫時是 link）。其中**「重新命名後舊名稱失效」那一案第一次全跑時，用舊斷言（失效連結不是 link）居然過了**，第二次（同一份程式）才紅。我沒有找到原因：頁面在那一刻的伺服器渲染應該已經有建立連結。可能的解釋是那一次 `getWorkspaceShellModel` 暫時回 null（此時 `canWrite` 未知，頁面就不提供建立入口——這是優雅降級，不是錯），但這是猜測。新斷言（連結指向表單、不指向被改名的文件）在之後的每一輪都過。
- **圖譜畫布上的失效節點 `hover()` 被 `svg` 攔截**：`<a>` 的方框包含標籤（不吃指標），方框中心在圓外。改成對節點自己的圓操作（`workspace-graph.spec.ts` 已有同一個提醒）。

### 量測（D.9）

`scripts/diagnostics/measure-link-targets.ts`：在拋棄式資料庫建一個 workspace、灌 N 份 Hub 文件（標題是英文與中文混合，平均約 35 字元），量 `listLinkTargets`（即 `GET …/link-targets` 執行的東西）、送出的大小、`rankSuggestions` 每次按鍵的成本。

| | 2,000 份 | 5,000 份 |
| --- | --- | --- |
| `listLinkTargets` 第一次 | 24.5 ms | 39.5 ms |
| `listLinkTargets` 暖的，30 次 | p50 15.9、p95 27.1 ms | p50 42.5、p95 53.2 ms |
| payload（原始／gzip） | 405.6／52.6 KiB | 1,015.6／132.2 KiB |
| 前端 `JSON.parse` | 1.4 ms | 3.3 ms |
| `rankSuggestions` 每次按鍵（暖的） | p50 0.2–0.5、p95 ≤ 1.0 ms | p50 0.9–1.8、p95 ≤ 2.3 ms |
| `rankSuggestions` 第一次（要先算每份的比對鍵） | 4–24 ms | 13–27 ms |

執行計畫在兩個尺寸都相同：`idx_sources_workspace_status` → 每份文件用 `uq_documents_source_id`，再 PRIMARY 與 `uq_tree_one_document`；`Using temporary; Using filesort` 出現在排序（依 revision 時間），5,000 份時整個查詢 40 多毫秒。

**結論：超出預期的地方沒有**，所以**沒有把「上限外退回 server 端查詢」提前做**。按鍵成本在毫秒等級；第一次打 `[[` 要等的是一次 40–50 ms 的查詢加上傳輸。上限 5,000 是一份 1 MB 的原始 JSON（gzip 後 132 KiB），單獨看就是該有上限的理由。

### 沒有證明的部分

- **真的中文輸入法。** `isComposing` 與 keyCode 229 只用合成的鍵盤事件測過（jsdom）；Playwright 沒有驅動輸入法的方法，所以「用注音／倉頡打到一半按 Enter」在瀏覽器裡是否真的不選清單，我沒有驗證。這是使用者最可能遇到的情況，所以放在第一位。
- **螢幕閱讀器沒有實測。** 在 `contenteditable` 上動態設 `role="combobox"`、`aria-activedescendant`，與一個 `aria-live="polite"` 的區域，都是照 ARIA 的模式寫的，屬性有 e2e 斷言，但沒有聽過。
- **只在 Chromium 測過。** Firefox、Safari 沒有；`coordsAtPos` 與 `position: fixed` 在那兩個上應該一樣，沒有驗證。
- **視覺只看過一列的亮暗截圖。** 多列、很長的標題（截斷）、放在游標上方時的樣子，e2e 只斷言了位置與顏色，我沒有看過畫面。
- **定位在捲動容器內的跟隨**（頁面或編輯器捲動時清單跟著游標）：加了捲動與 resize 的監聽，沒有 e2e。
- **量測是在同一台機器、同一個行程裡**：沒有 HTTP、代理或壓縮的成本，資料庫在本機，標題是合成的。灌 5,000 份走建立服務，花了 237 秒。gzip 的數字是我用 `zlib` 算的，不是量到的線上位元組數。
- **`sameTitle` 有資料、介面沒有用。** 兩份同標題的文件在清單裡只靠 Source 名稱區分。
- **成員看得到整個 workspace 的標題。** 與圖譜相同的授權（成員即可），這是規格寫的；唯讀成員也能取得清單，這也是（他們本來就讀得到這些文件）。若之後有更細的讀取範圍，`link-targets` 要跟著改。
- **同時兩個分頁、清單顯示中文件被封存**：清單最多 60 秒是舊的，選到剛被封存的文件會寫出一條會失效的連結（解析只看 ACTIVE）。沒有測，也沒有處理；封存本來就會讓連結失效，這是同一件事。

## 切片 B.0 — ⌘K 最近開過、側欄收藏預設 4 筆加「Show all」

分支 `claude/b0-recents-favorites`（已併入 #89 之後的 main）。設計與偏離見規格 §8.1。

### 結果

| 層 | 新增 | 結果 |
| --- | --- | --- |
| 單元 | `parseDocumentIdList`（`phase5-authoring-input`）、`recentDocumentIds`、`favoritesInPlace`（`document-shortcuts`） | 全套 95 檔 **1436/1436**（含 `documentIdInPath` 的 5 案：文件頁與其下的頁、非文件頁、不是 ID 的段、整段或不取與大小寫、不被別處的 ID 騙到；輔助函式變異體 5/5 被殺，其中兩個原本存活的由補的案例殺掉） |
| integration | `recent-documents-api` 10 案：順序與形狀、`no-store`、不含內文、用現在的標題、封存／不存在／格式錯誤的略過、別的 workspace 的略過、唯讀成員可讀、非成員與不存在的 workspace 同一個 404、壞 ID 400、上限 8、空清單 | 全套 53 檔 **613/613** |
| e2e | `zz-recents-favorites` 9 案：最近開過的順序與排除目前這份、Enter 去前一份、封存後消失、打字時讓位且清空後回來、回應提到沒被要求的文件時不顯示、取不到清單時退回原樣、沒有任何最近開過時第一列是導覽、**回應晚到時列表標示載入中，且使用者已選的那一列保持被選中**；側欄：最新 4 筆在原位且這一節不高於 240px、「Show all」列出全部且每項是連結、Esc 還焦點、重新整理後還在，以及 2 筆時沒有「Show all」（Team workspace，收藏只存本機） | 單檔 9/9；上一版（全顯示）的 7 案在 4 個 worker × 12 輪下 84/84 |
| `tsc`、`eslint`、`next build` | — | 乾淨 |

### 變異驗證

**server 端（`recent-documents.ts`、路由、`parseDocumentIdList`、`recentDocumentIds`，12 個）：12/12 被殺。** 包括：不檢查是別的 workspace、不先檢查成員資格、錯誤沒被吞掉、排序被改、路由不驗 workspace ID、路由忽略 `ids`、不驗 UUID、不去重、不設上限、沒排除正在讀的、重複沒去掉。

**palette（e2e，11 個有效變異體）：7 個被殺，4 個存活，存活的都是等價的：**

- 被殺：最近開過排在動作之後（渲染順序與索引不一致）、沒排除正在讀的、請求不帶 `ids`、第一列的 `activeIndex` 位移錯誤、回應提到沒被要求的文件也顯示、打字時最近開過還在（**兩個 guard 一起拿掉**才會被殺）、沒有「Recent」標題。
- 存活而等價：打字時的 guard 有兩處（`recentRows` 與抓取的 effect），各自拿掉一處沒有可觀察的差別——是刻意的重複防衛，兩個一起拿掉才被殺；失敗時 `setRecents([])`（顯示時已經與最新的 ID 取交集，留下的舊回應只會是還被要求的文件）；`!response.ok` 的檢查（`{}` 沒有 `hits`，`.map` 丟錯後被 `catch` 接住，結果相同）。
- **我的腳本有一次誤判：** 「沒有 Recent 標題」的變異體第一次不是 lint 乾淨的（多了沒用到的 `position`），build 失敗，腳本把「沒有輸出」當成存活。改成 `position === -1` 重跑才被殺。之後腳本遇到沒輸出會標成無效，不再算存活。

### 寫的時候測試與檢查抓到的問題（我的錯，都已修）

- **e2e 的 `read()` 沒有做到它註解寫的事。** 它只等到樹的那一列出現就去開下一份，而「記為最近開過」是側欄的 effect，在那之後才跑；下一份文件的 `goto` 若先到，這一份就沒被記下。完整 e2e 第二次紅在這裡（`Beta` 不在清單裡），重現是把單一案在 6 個 worker 下跑 30 輪，**失敗 2 次**；加診斷後在 8 個 worker 下 60 輪看到 1 次 `recent` 缺了最後一份。修法：`read()` 改成輪詢 `localStorage`，直到這份真的在 `recent` 的最前面。
- **產品上的一個小缺陷，由同一批失敗的追蹤檔看出來：** 請求序列是 `[b,a,X]`（已排除這一份）→ `[c,b,a,X]`（含這一份）→ `[b,a,X]`——頁面還沒說出自己是哪份文件時，`reading` 短暫是未知，那一次含目前這份的請求，比後面較新的請求更早回來，就把**已經該排除的那份**顯示出來；滿載時單一請求要 3.2 秒，於是那個畫面停了好幾秒。修法：顯示時只留下與「目前要的 ID 清單」的交集，舊問題的回應再晚到也不會把不要的文件放回來。新的 e2e 用 `page.route` 回一個提到三份文件的回應，斷言被排除的那份不會出現。
- **收藏的計數斷言依賴帳號裡沒有別的星號**，而收藏現在是依帳號同步到 server（#86）。序列執行（`workers: 1`）時沒事，並行重複時別輪的星號會混進來（`Expected: 1 / Received: 35`）。改成只數帶這個測試專屬 stamp 的連結。
- **伺服器滿載時斷言逾時**：server-bound 的斷言沒有用 `ROUND_TRIP`（15 秒），在 8 個 worker × 20 輪（100 個並行的測試）時約三成逾時，其中大部分是 `Test timeout of 30000ms`、建立文件與 `goto` 逾時，是飽和，不是邏輯。補上 `ROUND_TRIP` 後 4 個 worker × 12 輪 84/84。**8 個 worker × 20 輪我沒有再試到通過**，這個數字不是我的驗收標準，只是留著說明壓力測試的極限在哪。

### 完整 e2e 的紀錄（誠實版）

併入 #89 之後，完整 `npm run test:e2e`（序列執行）跑了四次，**沒有一次是乾淨全綠**：

1. 208 過／1 紅／2 跳過：`zz-organize`「come back from Show archived」（右鍵封存後那一列 15 秒沒消失）。隔離重跑整個檔案 9/9、該案單獨重複 12 輪 12/12，**沒有重現，也沒有留下追蹤檔**（被後面的重跑清掉）。
2. 208 過／1 紅／2 跳過：我自己新增的最近開過那案（上面的 `read()` 競態），**已修**。`zz-organize` 這次全過。
3. 209 過／2 紅／2 跳過：`zz-organize` 另外兩案（「say how many other documents' links stop working」：toast 沒出現；「a folder that still holds something…」：base-ui 的 inert 遮罩攔截了選單項目的點擊，`element is outside of the viewport`）。

4. 側欄改成「4 筆加 Show all」之後：213 過／4 紅／2 跳過，**4 案全在 `zz-organize*`**：`zz-organize-move`「Alt+↑ and Alt+↓ say why they do nothing while the tree is filtered」（深度相等不符）、`zz-organize`「come back from Show archived」（同第 1 次）、「say how many other documents' links stop working」（同第 3 次）、「a folder that still holds something…」（同第 3 次，`outside of the viewport`）。其中三案前面出現過；這條分支上四次完整跑裡，`zz-organize*` 共紅過 4 個不同的案（沒有一案每次都紅）。

**（這段是當時的推測，已被下面「後來找了」取代）追蹤檔看到的事（第 4 次，兩案）：封存的 `POST /api/documents/:id/archive` 回 200**——伺服器確實封存了，但畫面沒有跟上：那一列 15 秒沒消失，或「N documents link here」的 toast 沒出現。也就是變更成功之後，前端沒有刷新或沒有跑完後續處理；不是伺服器錯誤。這與 #87 修的「背景刷新丟掉 router transition」（#63、#64）是同一個區域，**我沒有證明是同一個原因**，也沒有去查。如果這是真的使用者會遇到的事（封存成功、列還在直到重新整理），它比一個不穩的 e2e 更值得另外查。

四次紅的都在 `zz-organize` 右鍵／選單的流程，而且**都不是我這次改到的程式**（B.0 只動 palette 的抓取與側欄收藏的清單）。失敗當下的頁面快照裡帳號沒有任何收藏，所以不是側欄長高造成的版面位移。**基準線：** 在乾淨的 `origin/main`（dff2043，沒有 B.0）上跑同一套完整 e2e，一次：203 過／1 紅／2 跳過，紅的是 `zz-organize`「are made inside a folder, archived with an Undo…」——`locator.click` 逾時，`element is outside of the viewport`，與第 3 次的第二案是同一種症狀。所以**這類 `zz-organize` 選單流程的間歇失敗在沒有 B.0 的 main 上也會發生**；這是 1 次樣本，不是失敗率。原因我沒有找。

**CI 上的證據（PR #94 開了之後）：** CI 的 `e2e` 在這個 PR 的第一次 run 紅了一案：`zz-organize-move.spec.ts:136`（對資料夾列按右鍵後 `Move folder…` 30 秒沒出現；215 過／1 紅）。**`main` 自己的 push CI 也紅在同一案**：#90 合併後那次（`zz-organize-move.spec.ts:109` 與 `:136`，207 過／2 紅），#89 合併後那次紅在 `row-actions.spec.ts:133`（Copy link）；兩次的 `unit`／`build`／`integration` 都綠。所以這類選單流程的 e2e 在沒有 B.0 的 main 上、在 CI 上，也是間歇紅的。要重跑 CI 需要有權限的人（我的整合帳號回 403）。

**最後一次完整 e2e（含 `documentIdInPath` 之後；工作樹裡帶著下面那一行 `openKnowledge` 修法）：217 過／1 紅／2 跳過。** 紅的是 `archived-source-active-doc.spec.ts:56`（`goto` 之後立刻點「Document display options」，選單沒開）——這是完整套件的第 2 個測試，伺服器剛冷啟動；單獨重複 10 輪 10/10，同樣是「點擊落在 hydrate 之前」的類型，我沒有動它。`row-actions:75` 與 `zz-organize*` 這次都過。

**後來找了，這個「間歇」其實是資料量相依，不是隨機。** 在 `zz-organize*` 之前先用 API 在 My Space 塞 200 份文件（完整套件跑到那裡時，前面的 spec 也塞了很多），這兩個檔案 22 案裡 **8 案紅**，正是完整套件裡「間歇」紅的那幾案（`move:109`、`:136`、`organize:164`、`:198`、`:223`、`:245`）；隔離跑（樹很短）21/21 全過。機制（用 `Element.prototype.scrollTop` 的 setter 與 `focus` 包 stack trace 抓到）：

1. `page.goto` 一回來測試就 `hover` 資料夾列（把 200 多列的樹捲到底）並按 `⋯`，**此時 React 還沒 hydrate 完**。
2. hydrate 完成後，`KnowledgeTree` **第一次掛載**，「把選中那一列捲進可視範圍」的 effect 初次執行，**把樹捲回頂端**（`nav.scrollTop` 從 6364 變成 36）。React 同時把 hydrate 前捕捉的點擊重播，選單這才打開，但觸發按鈕已在 y=6942、選單在畫面外（`element is outside of the viewport`）。
3. 我最先猜的是那個 effect 在樹刷新時重跑（依賴 `roots`），試了「每個選擇只做一次」的守衛，**結果沒有改善**——因為是新掛載的實例（ref 是空的）。我先還原了。所以這不是 app 在刷新時亂捲，是測試沒等 hydration。

**修法（一行）：** `tests/e2e/fixtures/organize.ts` 的 `openKnowledge` 改成 `page.goto(..., { waitUntil: "networkidle" })`——repo 裡 `phase2.5-knowledge-explorer.spec.ts` 已經有同樣的慣例（註解「Wait for hydration」）。**效果：** 長樹情境 8/22 紅 → 修法之後再跑 3 次完整的長樹情境，分別 1、1、0 案紅（紅的都是下面沒解決的 `move:71`）；完整 e2e 兩次，其中一次 217 過／0 紅（這條分支第一次完整全綠），另一次的唯一一紅是上面那個 B.0 造成的 `row-actions:75`（`zz-organize*` 全過）。樣本很小，不是失敗率。

**沒有解決的：** 長樹情境下 `zz-organize-move.spec.ts:71`（Move 對話框裡「目前所在資料夾」那個選項應該是 Current／disabled，卻是 enabled）在修法之後仍然約 3/5 次紅。trace 裡沒有任何搬移請求，文件確實沒被動過；對話框用 `collections` 算出來的目前位置不是它在 DOM 裡所在的資料夾。**原因我沒找到**；它在 CI 與完整套件裡還沒出現過，只在我塞 200 份文件的壓力情境裡。

**這個修法 `main` 已經有了**：我在調查時，#93 恰好合併（`openKnowledge` 同樣改成 `waitUntil: "networkidle"`，註解的診斷與我相同——hydration 之後的 reveal 把捲動容器移走，長樹下右鍵會落在別列——還多等「目前這一列在畫面內」），所以我先前準備提出的 patch 作廢，沒有併進這個 PR，併入 main 之後也沒有衝突。上面的數字是我自己那一行修法的結果，不是 #93 的。

### 沒有證明的部分

- **`zz-organize` 間歇失敗的原因與失敗率。** **已找到主要原因**（上面：測試沒等 hydration，長樹下才踩得到），修法是一行 fixture，**還沒併進這個 PR**；仍有一案（`move:71`）在壓力情境下沒解釋。這條分支沒有一次完整 e2e 是乾淨全綠，這是事實；其餘檔案在三次完整跑裡沒有別的失敗（扣掉我自己那案，已修並以並行重複驗證）。
- **「Show all」面板沒有搜尋、也沒有星號按鈕**：一百個星號會是一個很長的捲動清單（面板上限 24 rem 或 60vh）；沒有量過、也沒有為此設計過。側欄上仍沒有排序或分組。
- **最近開過只存本機**：換瀏覽器看不到（規格 D12 的決定，沒有改）。
- **palette 開啟時多一次請求**：本機量過的回應時間在滿載時曾到 3.2 秒，但那是 8 個並行瀏覽器；單人使用沒有量。
- **視覺檢查只做了一部分。** 看過側欄的 Show all 面板（亮、暗，720px 高）；**沒有看過** palette 的「Recent」標題與兩行的列（只斷言了文字與順序）、Team workspace 的側欄、窄視窗（抽屜）裡面板的位置、很長的標題以外的情況，也只在 Chromium。
