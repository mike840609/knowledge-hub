# 個人日用套件（第一批）— 驗證紀錄

對應[設計規格](../specs/2026-09-29-personal-daily-driver-design.md)與[實作計畫](../plans/2026-09-29-personal-daily-driver.md)。每個切片完成時在這裡加一節：測試數字、量測、**故意弄壞來確認測試會失敗的變異驗證**、如實記錄的失敗與偏離。

目前只有切片 0。

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
