# 鍵盤快捷鍵 — 設計規格

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-24 |
| 類型 | 設計規格，供實作前審查 |
| 回應 | 對照 Linear 設計語言的 UI/UX 審查第 1 項：鍵盤操作是目前體感差距最大的地方 |
| 對照契約 | `docs/superpowers/specs/frontend-design-language.md` §10（Focus and keyboard）、§15（One registry decides what can be done） |
| 對照規格 | `docs/superpowers/specs/2026-09-21-action-model-spec.md`（`Action.shortcut` 欄位的由來） |
| 狀態 | 設計已逐段確認，待審閱後進入實作計畫 |

## 1. 現況（實測，非引述）

對照 `main` @ `43fc857`。

**快捷鍵全站只有兩個，各自在元件裡掛 `window` 監聽：**

```text
⌘K / Ctrl K   打開 palette        src/components/search/quick-search.tsx:112–120
⌘I / Ctrl I   打開 Details 面板    src/components/knowledge/document-inspector.tsx:276–286
```

**registry 已經有 `Action.shortcut` 欄位，但沒有人讀。** 欄位寫明是 `aria-keyshortcuts` 的拼法（`src/components/actions/action-registry.ts:74`），全部動作中只有 `document.details` 填了 `"Meta+I Control+I"`。palette 的列（`quick-search.tsx` 約 245–258 行）只畫圖示與標籤，不畫快捷鍵；右鍵選單也不畫。一個讀者沒有任何管道發現 `⌘I` 存在，除非把滑鼠停在 Details 按鈕上讀 tooltip。

**表單沒有鍵盤存檔或取消。** 編輯文件（`src/components/knowledge/document-editor.tsx`）與新增文件（`src/components/knowledge/new-document-form.tsx`）都是 `onSubmit` 加 Save／Cancel 按鈕。新增表單的 Cancel 在已輸入內容時會跳出原生 `window.confirm("Discard this draft?")`（`new-document-form.tsx:81`，僅 `variant="empty"`）。

**`canSearch` 等於「能讀文件」。** `src/server/workspace-admin.ts:47`：`canSearch: has("document.read")`。這決定了快捷鍵可以掛在 QuickSearch 裡（第 3 節）。

## 2. 範圍

五個快捷鍵，加上在 palette 與按鈕 tooltip 上顯示它們。

| 按鍵 | 作用 | 生效位置 |
| --- | --- | --- |
| `C` | Add to Notes（`create.document`） | 任何頁面，registry 提供 `create.document` 時 |
| `E` | Edit document（`document.edit`） | 正在閱讀的文件，registry 提供 `document.edit` 時 |
| `/` | 打開 palette（與 `⌘K` 同一個） | 任何頁面 |
| `⌘Enter` / `Ctrl Enter` | 儲存 | 編輯文件、新增文件兩個表單內 |
| `Esc` | 取消（內容沒改過時） | 同上 |

**不在範圍內**，逐項記錄是為了不被當成遺漏：

- `?` 快捷鍵總覽對話框。palette 已經在每列顯示快捷鍵，五個鍵不需要另一張表。
- `G` 開頭的兩鍵導覽序列（`G K`、`G S`…）。需要按鍵序列的計時與狀態，等快捷鍵多到單鍵不夠用再說。
- `E` 作用在鍵盤焦點所在的列。決定是只作用在正在閱讀的文件（第 3.2 節）。

## 3. 全域單鍵：`C`、`E`、`/`

### 3.1 掛在哪裡

在 QuickSearch 既有的 `keydown` 監聽裡擴充，不新增元件或 hook。

QuickSearch 已經具備這層需要的三樣東西：以 `actionsFor("palette", …)` 算好的可用動作（含正在閱讀的文件作為 target）、執行動作的 `useActionRunner`、以及 `⌘K` 的 `window` 監聽。另起一層就得把「可用動作」再算一次，或抽出共用 hook 讓兩邊讀，兩者都比多寫一個分支重。

QuickSearch 只在 `confirmed && canSearch` 時啟用（`quick-search.tsx:55`）。`canSearch` 就是 `document.read`，連讀都不行的人本來就不能新增或編輯，所以快捷鍵跟著它關閉不會拿走任何人的能力。`confirmed` 為 false 時 registry 本來就不提供會 mutate 的動作，兩者一致。

### 3.2 綁定規則

- registry：`create.document` 加 `shortcut: "C"`，`document.edit` 加 `shortcut: "E"`。
- 按 `C` 或 `E`：在 palette 的可用動作中找 `shortcut` 相符者，找到就用 `useActionRunner` 執行，找不到就不做事、也不 `preventDefault`。
- **`E` 的可用條件完全由 registry 決定。** `document.edit` 只在三軸同時成立時出現：`canWrite && confirmed`、`HUB_MANAGED`、`ACTIVE` 且為目前版本（`action-registry.ts` 的 `document.edit` 區塊）。快捷鍵不重寫這組條件，所以 `SOURCE_MANAGED`、封存、歷史版本上按 `E` 什麼都不會發生。
- **`E` 只作用在正在閱讀的文件**，也就是 palette 的 target：`topbar.pathname === pathname` 時的 `topbar.target`。不在文件頁時沒有 target，`document.edit` 不存在，`E` 不做事。
- 按 `/`：打開 palette，並 `preventDefault`，避免 `/` 被打進剛獲得焦點的輸入框。
- `⌘K` 與 `⌘I` 行為不變。

**這仍然不是授權。** registry 決定的是顯示與快捷鍵是否觸發；`C` 與 `E` 最終都只是導航到 `/knowledge/new` 與 `/edit`，寫入時由 application service 重新驗證，與按鈕路徑相同。

### 3.3 觸發條件

單鍵快捷鍵只在以下**全部**成立時觸發。判斷抽成純函式 `isSingleKeyShortcut(event)`，放在 `src/lib/shortcut-keys.ts`，理由見第 6 節。

1. 沒按 `⌘`、`Ctrl`、`Alt`。
2. **不在輸入法組字中**（`event.isComposing`）。中文使用者以注音、拼音組字時，打的字母與 `/` 不能被當成快捷鍵。
3. 事件目標不在可輸入的元素內：`input`、`textarea`、`select`、`contenteditable`（不含 `contenteditable="false"`）。
4. 事件目標不在對話框或選單內：`[role="dialog"]`、`[role="menu"]`、`[role="listbox"]`。palette 本身是對話框，所以 palette 開著時單鍵不會觸發。
5. 不是長按產生的重複事件（`event.repeat`）。
6. 字母鍵不帶 Shift；`/` 允許 Shift。

比對用 `event.key`（轉小寫），不用 `event.code`：前者是使用者看到的字，非 QWERTY 配置也對得上。`/` 允許 Shift，是因為德文等配置要按 Shift+7 才打得出 `/`，此時 `event.key` 仍是 `"/"`。

## 4. 顯示快捷鍵

### 4.1 palette

有 `shortcut` 的列在右側顯示按鍵：Add to Notes 顯示 `C`，Edit document 顯示 `E`，Open details 顯示 `⌘I`。

顯示文字由 `shortcut` 欄位推導：取第一組（空白分隔），`Meta` 轉 `⌘`、`Control` 轉 `Ctrl`，`+` 去掉。`"Meta+I Control+I"` 顯示為 `⌘I`，`"E"` 顯示為 `E`。沿用介面上既有的寫法（`⌘K`、`⌘/Ctrl I`），不做平台偵測。轉換函式與第 3.3 節的判斷放在同一個檔案。

`shortcut` 欄位因此是唯一來源：同一個值決定綁定、`aria-keyshortcuts` 與畫面上的字，三者不會不同步。

### 4.2 `Kbd` primitive

新增 `src/components/ui/kbd.tsx`。palette 的列與頂欄搜尋按鈕上現有的 `⌘K` 都改用它。

圓角照契約 §5 用 `sm`（inline chrome：`kbd`、inline code、badge）。現有的 `⌘K` 寫的是 `rounded-md`（`quick-search.tsx:193`），是對契約的偏離，這次一併修正。

### 4.3 按鈕 tooltip 與 `aria-keyshortcuts`

| 按鈕 | 位置 | `title` | `aria-keyshortcuts` |
| --- | --- | --- | --- |
| Edit | `document-header.tsx` | `Edit (E)` | `E` |
| `+`（Add to Notes） | `source-sidebar.tsx:115` | `Add to Notes (C)` | `C` |
| Quick search | `quick-search.tsx` | `Quick search (⌘K or /)` | `Meta+K Control+K /` |

### 4.4 右鍵選單不顯示

右鍵選單操作的是被點的那一列，`E` 操作的是正在閱讀的文件。在每一列的 Edit document 旁標 `E`，除了正在閱讀的那一列之外都是錯的：在別列的選單裡看到 `E`、按下去，編輯到的是另一份文件。選單裡其他動作（開新分頁、複製連結、收藏）沒有快捷鍵，所以選單上不會有任何提示。

若日後改為「`E` 作用在焦點所在的列」，屆時選單的提示就是正確的，再加上。

## 5. 表單：`⌘Enter` 與 `Esc`

### 5.1 掛在哪裡

編輯文件與新增文件兩個表單，共用 `src/components/knowledge/use-form-keys.ts`。回傳一個掛在 `<form>` 上的 `onKeyDown`：焦點在表單內才生效，不掛全域監聽，因此不會與 palette 或選單衝突（palette 以 portal 渲染在表單之外，事件不會冒泡進表單）。

### 5.2 `⌘Enter` / `Ctrl Enter`：儲存

- 在標題欄與內文框內都生效。
- 找到表單的 `button[type="submit"]`，**只在它沒有 disabled 時**呼叫 `form.requestSubmit(button)`。`requestSubmit()` 不帶參數時不理會按鈕的 disabled 狀態，所以一定要檢查按鈕，也因此不需要另寫一套條件：未 hydrate、儲存中、存取權確認中、標題空白，按鈕上已經有。
- 輸入法組字中不觸發。

### 5.3 `Esc`：取消

- **內容沒改過**：等同按 Cancel。
- **內容改過**：什麼都不做。要離開只能按 Cancel 按鈕，所以 `Esc` 永遠不會丟掉草稿。
- 輸入法組字中不觸發：中文輸入法以 `Esc` 取消組字。
- 儲存中不觸發（Cancel 按鈕此時也是 disabled）。

「改過」的定義：

| 表單 | 改過 |
| --- | --- |
| 編輯文件 | `title !== initialTitle` 或 `markdown !== initialMarkdown` |
| 新增文件 | `title` 或 `markdown` 非空（與現有 Cancel 的判斷相同） |

「等同按 Cancel」照各表單既有的 Cancel 行為：編輯文件回到文件頁；新增文件 `variant="empty"` 回到 Knowledge，其他 variant 收起表單。內容沒改過，所以新增表單 Cancel 的原生確認本來就不會出現。

**考慮過並否決的做法：**「改過時按兩次 `Esc` 才離開」。它需要一個「已按過一次」的狀態、一行提示、以及「再打字就重置」的規則，換來的只是少按一次 Cancel；而一次誤觸兩下 `Esc` 仍然會丟掉草稿。`Esc` 從不丟草稿更簡單，也更安全。新增表單 Cancel 上的原生 `confirm` 因此維持原樣：丟草稿的唯一入口仍是 Cancel，它的確認不受這份規格影響。

### 5.4 按鈕 tooltip

Save 與 Create document 顯示 `title="Save (⌘Enter)"`／`"Create document (⌘Enter)"`，Cancel 顯示 `title="Cancel (Esc)"`。

## 6. 測試

### 6.1 Unit

`src/lib/shortcut-keys.ts` 是純函式，以事件形狀的物件測試，不需要 DOM。這組條件最容易默默出錯，所以直接測，而不是只靠 e2e 間接碰到。

- `isSingleKeyShortcut`：每一條觸發條件各至少一個反例（`metaKey`、`ctrlKey`、`altKey`、`isComposing`、目標為 `input`／`textarea`／`select`／`contenteditable`、目標在 `[role="dialog"]` 內、`repeat`、Shift 加字母），以及正例（單純 `c`、`e`、`/`、Shift 加 `/`）。目標以 `closest()` 判斷，測試用最小的假物件提供 `closest`。
- 顯示轉換：`"E"` → `E`、`"Meta+I Control+I"` → `⌘I`、`"Meta+K Control+K /"` → `⌘K`。
- registry：`create.document` 帶 `shortcut: "C"`、`document.edit` 帶 `shortcut: "E"`；`SOURCE_MANAGED`、`ARCHIVED`、`HISTORICAL` 三種 target 都沒有帶 `E` 的動作。

### 6.2 E2E

新增 `tests/e2e/keyboard-shortcuts.spec.ts`：

- Knowledge 頁按 `C`，到 `/knowledge/new`。
- 在文件樹篩選框輸入 `c`：網址不變，篩選框內容為 `c`。
- `HUB_MANAGED` 文件頁按 `E`，到 `/edit`；`SOURCE_MANAGED` 文件頁按 `E`，網址不變。
- 按 `/`：palette 打開，查詢框為空（`/` 沒被打進去），Add to Notes 列顯示 `C`。
- 編輯頁：改標題後按 `⌘Enter`，回到文件頁且標題為新值。
- 編輯頁：沒改內容按 `Esc`，回到文件頁。
- 編輯頁：改過內容按 `Esc`，仍在 `/edit` 且內容保留。

輸入法組字無法在 Playwright 中可靠模擬，由 6.1 的 `isComposing` 反例覆蓋。

## 7. 契約修訂

§10（Focus and keyboard）新增一段，記錄：

- 單鍵快捷鍵的觸發條件（第 3.3 節），以及它們由 `isSingleKeyShortcut` 統一判斷。
- `Action.shortcut` 是綁定、`aria-keyshortcuts` 與顯示文字的唯一來源；新增快捷鍵就是在 registry 上填這個欄位。
- 右鍵選單不顯示快捷鍵的理由（第 4.4 節）。
- 表單內 `Esc` 從不丟草稿（第 5.3 節）。

§5 不需修改：`kbd` 用 `sm` 本來就是契約的規定，這次只是讓實作符合。

## 8. 影響的檔案

```text
新增  src/lib/shortcut-keys.ts
新增  src/components/ui/kbd.tsx
新增  src/components/knowledge/use-form-keys.ts
新增  tests/unit/shortcut-keys.test.ts
新增  tests/e2e/keyboard-shortcuts.spec.ts
修改  src/components/actions/action-registry.ts      C、E 的 shortcut
修改  src/components/search/quick-search.tsx         /、C、E 綁定；列上的 Kbd；按鈕 tooltip
修改  src/components/knowledge/document-header.tsx   Edit 的 title 與 aria-keyshortcuts
修改  src/components/knowledge/source-sidebar.tsx    + 的 title 與 aria-keyshortcuts
修改  src/components/knowledge/document-editor.tsx   use-form-keys；按鈕 tooltip
修改  src/components/knowledge/new-document-form.tsx use-form-keys；按鈕 tooltip
修改  tests/unit/action-registry.test.ts              shortcut 斷言
修改  docs/superpowers/specs/frontend-design-language.md  §10
```
