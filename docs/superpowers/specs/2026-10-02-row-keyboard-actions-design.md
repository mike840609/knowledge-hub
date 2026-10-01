# 焦點列的單鍵動作 — 設計規格

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-10-02 |
| 類型 | 設計規格，供實作前審查 |
| 回應 | 對照 Linear 設計語言的 UI/UX 審查 C.2：列的鍵盤操作。視覺 token 與回饋原語已對齊，剩下的體感差距集中在「對焦點列直接做事」 |
| 對照契約 | `docs/superpowers/specs/frontend-design-language.md` §10（Shortcuts）、§15（One registry decides what can be done）、§18 第 5 項 |
| 對照規格 | `docs/superpowers/specs/2026-09-24-keyboard-shortcuts-design.md`（本規格修訂其 §2、§3.2、§4.4）、`2026-09-21-action-model-spec.md` |
| 狀態 | 已核可，已實作（見 `docs/superpowers/plans/2026-10-02-row-keyboard-actions.md`） |

## 1. 現況（對照 PR #96 合併後的程式碼，皆已讀程式碼確認）

- **樹已經有 WAI-ARIA tree 的鍵盤**：roving tabindex、`↑↓` 移動、`←→` 收合與跳到父層、`Enter` 開啟、`Alt+↑↓` 重排（`src/components/knowledge/knowledge-tree.tsx:368`）。缺的是「對焦點列做事」。
- **每一列已經算得出自己能做什麼**：`documentActions(item)` / `folderActions(item)` 回傳 registry 動作，右鍵選單與 `Alt+↑↓` 都用它；`onRunAction` 已能執行 move、rename、favorite（`useActionRunner`，`action-menu.tsx`）。
- **單鍵只掛在全域一處**：`QuickSearch` 的 `window` `keydown`（`quick-search.tsx:151–171`），在 palette 的動作中找 `shortcut` 相符者執行。目標永遠是正在閱讀的文件。
- **registry 只有四個快捷鍵**：`C`（`create.document`）、`E`（`document.edit`）、`⌘I`、`⌘\`。列動作大多沒有鍵。
- **樹不是單鍵的例外**：`isSingleKeyShortcut` 排除輸入框、對話框、menu、listbox，沒有排除 `[role="tree"]`。所以焦點在樹上按 `C` 現在會新增文件，按 `E` 會編輯**右邊正在讀的那份**，而不是焦點列。
- **`aria-selected` 在樹上表示「目前頁」**（與 `aria-current="page"` 同義），不是多選。
- **右鍵選單只有樹在用**（`RowContextMenu`、`RowActionsTrigger` 的呼叫者只有 `knowledge-tree.tsx`）。

## 2. 範圍

第一個切片：**對樹上的焦點列，用單鍵執行 registry 動作。** 目標由鍵盤焦點決定。

| 按鍵 | 焦點列是文件 | 焦點列是資料夾 |
| --- | --- | --- |
| `j` / `k` | 下一列／上一列（`↓` / `↑` 的別名） | 同左 |
| `E` | `document.edit` | — |
| `F` | `document.favorite` | — |
| `M` | `document.move` | `folder.move` |
| `R` | — | `folder.rename` |
| `C` | 照舊：全域 `create.document` | `folder.new-document`（在該資料夾內新增文件） |

**每個鍵只有在該列的 registry 動作可用時才執行。** `SOURCE_MANAGED`、封存、歷史版本、唯讀的列，registry 本來就不提供對應動作，按鍵沒有反應（第 4.2 節說明為什麼這樣也不會落到別份文件上）。封存不配單鍵：它有確認對話框、會讓指向它的連結失效，走選單就好。

**不在範圍內**，逐項記錄是為了不被當成遺漏：

- **多選、`x` 選取、Shift 範圍選取、批次動作列。** 需要先解決 `aria-selected` 與「目前頁」的衝突、`SOURCE_MANAGED` 與 `HUB_MANAGED` 混選時動作的可用性、批次封存斷多少連結的確認文案與 undo。Team workspace 目前關閉、個人 workspace 的批次需求未經證實，等有需求再做。
- **Personal Home 與搜尋結果的列。** 它們沒有 `treeitem` 與焦點列模型；等第二個使用者出現再把第 4 節的機制抽成共用 hook（目前只有樹一個使用者，現在抽是提早抽象）。
- **`G` 開頭的兩鍵序列、`?` 快捷鍵總覽。** 理由同 keyboard-shortcuts 規格 §2。
- **單側欄**（契約 §18 第 4 項）。它依賴這份規格決定的鍵盤模型：焦點列在哪裡、側欄樹是不是同一套按鍵。

## 3. 行為規則

1. **目標由焦點決定。** 事件來源在樹的某個 `treeitem` 內，目標就是該列；否則照舊，是正在閱讀的文件。這取代 keyboard-shortcuts 規格 §3.2 的「`E` 只作用在正在閱讀的文件」。該段寫明的重新評估條件是「列有了靠焦點才能到的動作」，本規格正是這個條件成立。
2. **registry 是唯一的可用性來源。** 樹不重寫任何條件；它只問「這一列的動作清單裡，有沒有 `shortcut` 是這個鍵的」。
3. **這仍然不是授權。** 與 `C`、`E` 現在一樣，鍵只是啟動一個 registry 動作；寫入由 application service 重新驗證。
4. **觸發條件沿用 `isSingleKeyShortcut`**（不帶 `⌘`/`Ctrl`/`Alt`、不在輸入法組字、不在輸入框／對話框／menu／listbox、不是重複事件、字母不帶 Shift）。`j`/`k` 同樣遵守，所以帶 `Alt` 的 `Alt+↑↓` 重排不受影響。
5. **選單與 Move 對話框關閉後，焦點回到那一列**，這樣鍵盤使用者能接著按下一個鍵。實作時先驗證現況是否如此；不是的話，這是本規格要補的缺陷。

## 4. 機制

### 4.1 樹自己處理

樹的 `handleKeyDown`（`knowledge-tree.tsx:368`）在方向鍵之前，對焦點列：

```text
j / k           → 等同 ArrowDown / ArrowUp
其他單鍵        → actionForKey(focusedRowActions, event)
                  找到 → preventDefault，onRunAction(action)
                  沒找到 → 不處理（第 4.2 節）
```

`focusedRowActions` 是 `documentActions(item)` 或 `folderActions(item)`，與右鍵選單同一份。不新增狀態，不把焦點目標上提到 context（那會讓焦點進出對話框、輸入框的邊界變多）。

「事件加動作清單找出相符動作」抽成 `src/lib/shortcut-keys.ts` 的純函式 `actionForKey(actions, event)`，`QuickSearch` 與樹共用，以免兩處各寫一份比對規則。它只處理不帶修飾鍵的單鍵，用 `event.key` 小寫比對。

### 4.2 樹只接管它宣告過的鍵

全域監聽與樹會看到同一個事件。規則必須同時滿足兩件事：

- 在 `SOURCE_MANAGED` 的列上按 `E`，**不能**落到全域去編輯右邊正在讀的另一份文件。
- 在文件列上按 `C`，**必須**仍然新增文件，因為這是今天的行為，不能因為焦點在樹上就失效。

可用性是「動作清單裡有沒有」，所以「這個鍵屬於樹、但此列不可用」與「這個鍵與樹無關」無法從清單分辨。解法是把列動作的鍵宣告成靜態資料，放在 `action-registry.ts`：

```ts
/** The key each row action takes. An action reads its `shortcut` from here, so there is still one source. */
export const rowShortcuts = {
  "document.edit": "E", "document.favorite": "F", "document.move": "M",
  "folder.new-document": "C", "folder.move": "M", "folder.rename": "R",
} as const;
export function claimedRowKeys(kind: "document" | "folder"): ReadonlySet<string>;
```

- 動作定義的 `shortcut` 改成讀 `rowShortcuts`（`document.edit` 目前直接寫字面值 `"E"`，一併改過來），所以「綁定、`aria-keyshortcuts`、顯示文字」仍只有一個來源。
- 樹對焦點列：鍵在 `claimedRowKeys(該列種類)` 裡，就**接管**：可用則執行，不可用則什麼都不做（並 `preventDefault`，避免全域再處理）。不在裡面，不碰，交給全域。
- `QuickSearch` 的單鍵分支：事件已被處理（`event.defaultPrevented`）就略過。`/` 的分支在更前面，不受影響，所以 `/` 在樹內仍能開 palette。

結果：文件列按 `C` 照舊新增文件；資料夾列按 `C` 在該資料夾內新增；唯讀列按 `E` 無事發生。

### 4.3 `shortcut` 是掛在 Action 上，不分表面

`document.favorite` 與 `document.move` 同時列在 palette 與列的選單（`surfaces: ["palette", "row"]`）。給它們配鍵後，**沒有焦點列時**（例如在文件頁），按 `F` 會收藏正在閱讀的那份，按 `M` 開那份的 Move 對話框，與今天的 `E` 完全一致。這是刻意的，也是對外可見的行為變更，寫在這裡而不是留給實作時發現。

## 5. 顯示

- **palette**：有 `shortcut` 的列已經顯示 Kbd，`F`、`M` 會自動出現。
- **右鍵／`⋯` 選單**：顯示該動作的 Kbd。keyboard-shortcuts 規格 §4.4 與契約 §10 原本不顯示，理由是「列的 Edit 旁邊寫 `E`，但 `E` 編輯的是另一份文件，每一列都在說謊」。目標改由焦點決定後，焦點在那一列時那個鍵確實是在做那件事，理由消失。選單只有樹在用，所以不會在沒有綁定這些鍵的表面上顯示不存在的提示。右鍵會先讓該列取得焦點（它是 `tabindex="-1"` 的元素，滑鼠按下即取得焦點），因此提示與行為一致；實作時以 e2e 確認。
- **焦點環**：樹列已有 `kh-focus-ring`，焦點列本來就看得出來，不新增樣式。「目前頁」維持 `aria-current="page"` 加中性選取底色（契約 §8），與焦點環是兩個獨立的訊號。

## 6. 測試

### 6.1 Unit

- `actionForKey`：相符、不相符、大小寫、帶修飾鍵不比對、`"Meta+I Control+I"` 這種帶修飾鍵的 `shortcut` 不會被單鍵比對到。
- registry：
  - `rowShortcuts` 的鍵在**同一種目標**內不重複：文件為 `E`、`F`、`M`；資料夾為 `C`、`M`、`R`。`C` 在兩種目標與全域 `create.document` 上意義不同，所以不能做全域唯一檢查。
  - 每個帶 `rowShortcuts` 鍵的動作，其 `shortcut` 等於該表的值（單一來源）。
  - 唯讀的目標（`SOURCE_MANAGED`、`ARCHIVED`、`HISTORICAL`）取得的動作清單裡沒有 `document.edit`，但 `claimedRowKeys("document")` 仍含 `E`。

### 6.2 E2E（`tests/e2e/zz-row-keyboard-actions.spec.ts`）

- 焦點在樹的列 A，正在讀文件 B：按 `E` 進的是 A 的編輯頁，不是 B 的。
- 焦點在 `SOURCE_MANAGED` 的列上按 `E`：網址不變（沒有落到正在讀的那份）。
- 文件列按 `C`：仍到 `/knowledge/new`。資料夾列按 `C`：在該資料夾內新增。
- 文件列按 `F`：收藏，選單隨之顯示 Remove from favorites。`M`：開 Move 對話框，關閉後焦點回到那一列。資料夾列按 `R`：開重新命名。
- `j`/`k` 與方向鍵移動到同一列；帶 `Alt` 的 `Alt+↓` 仍是重排，不被 `j`/`k` 規則吃掉。
- 沒有焦點列時（在文件頁正文）按 `F`：收藏正在讀的那份。
- 在樹的篩選框內輸入 `e`、`f`、`m`、`r`、`c`、`j`、`k`：網址不變、篩選框內容正確（輸入框內不觸發）。
- 在 palette 開著、Move 對話框開著、選單開著時按這些鍵：不觸發。
- 右鍵一個唯讀列：選單裡沒有 Edit，也就沒有 `E` 提示；右鍵一個可編輯列：選單中 Edit 旁顯示 `E`。

輸入法組字無法在 Playwright 中可靠模擬，由 `isSingleKeyShortcut` 既有的 `isComposing` 反例覆蓋。

### 6.3 既有測試不得退步

`tests/e2e/keyboard-shortcuts.spec.ts` 的 `C`、`E`、`/` 案例與 `row-actions.spec.ts` 全部維持通過。

## 7. 契約修訂

| 位置 | 修訂 |
| --- | --- |
| 契約 §10 Shortcuts | 「Single keys are bound in the palette … on the document being read」改為：目標是焦點所在的樹列，沒有焦點列時才是正在閱讀的文件；樹只接管 `rowShortcuts` 宣告過的鍵。刪去「The row menu shows no hints」整句與理由，改為選單顯示其動作的鍵。補一句：`j`/`k` 是方向鍵的別名。 |
| 契約 §18 第 5 項 | 「`E` acts only on the document being read, not on the focused row … revisit if rows gain actions a reader reaches by focus」：條件已成立，移除這一半，保留「List pages sit in `kh-page`」那一半。 |
| keyboard-shortcuts 規格 §2、§3.2、§4.4 | 不改寫歷史，在文件開頭的「狀態」加一行：「`E` 的目標與右鍵選單顯示鍵的決定，已被 `2026-10-02-row-keyboard-actions-design.md` 取代」。 |
| README「Current canonical documents」表 | 加入本規格與其實作計畫。 |

## 8. 影響的檔案

```text
新增  tests/e2e/zz-row-keyboard-actions.spec.ts
修改  src/lib/shortcut-keys.ts                       actionForKey
修改  src/components/actions/action-registry.ts      rowShortcuts、claimedRowKeys；F、M、R、C 的 shortcut
修改  src/components/actions/action-menu.tsx         選單項目顯示 Kbd
修改  src/components/knowledge/knowledge-tree.tsx    handleKeyDown：j/k 與焦點列單鍵
修改  src/components/search/quick-search.tsx         單鍵分支略過已處理事件；改用 actionForKey
修改  tests/unit/shortcut-keys.test.ts               actionForKey
修改  tests/unit/action-registry.test.ts             rowShortcuts 斷言
修改  docs/superpowers/specs/frontend-design-language.md  §10、§18
修改  docs/superpowers/specs/2026-09-24-keyboard-shortcuts-design.md  狀態行
```

## 9. 未驗證的假設與風險

**關於 Linear（來自對產品的了解，不是量測；契約 §1a 只量過行銷網站）：**

1. 焦點列與「目前開著的那頁」在 Linear 是否在視覺上區分，沒有確認。本規格沿用既有的雙訊號（焦點環加中性選取底色）。
2. 按 `F`、`M` 這類鍵時，Linear 是作用在焦點列還是游標懸停的列，沒有確認。本規格只用鍵盤焦點；沒有「懸停列」概念，避免滑鼠位置影響鍵盤目標。
3. Linear 的具體按鍵配置（哪個動作配哪個字母）沒有逐一核對；這裡的字母是以記憶性（Edit、Favorite、Move、Rename、Create）選的。

**實作風險：**

- 第 3 節第 5 點（選單與對話框關閉後焦點回到該列）的現況未驗證，可能需要補。
- 第 4.3 節的行為變更（文件頁按 `F`／`M` 作用在正在讀的那份）會讓原本沒有這些鍵的使用者在無意間按到就觸發。`F` 可逆（再按一次取消收藏）；`M` 只開對話框，不會直接移動。兩者都不是破壞性動作，這是選這兩個鍵而不選封存的原因之一。

**實作時的發現（e2e 驗證了上面標為未驗證的部分）：**

- 關閉 Move 對話框後，焦點回到該列（已驗證，不需要補正式程式）。
- 在未取得焦點的列上按右鍵，選單關閉後，鍵盤作用的目標就是那一列（已驗證）。
- 「選單開著時按鍵不作用」是由 Base UI 在開啟的選單內消耗按鍵所保證，不是由我們的守衛；測試把這個範圍固定下來。
- 以 portal 渲染的對話框／palette，其事件目標沒有 treeitem 祖先，樹自己的守衛在那裡不相關；把鍵擋在外面的是頁面監聽器的 `isSingleKeyShortcut`。
