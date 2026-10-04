# 動作模型 — 設計規格

[English](2026-09-21-action-model-spec.md) | **繁體中文**

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-21 |
| 類型 | 設計規格，供實作前審查 |
| 回應 | 契約 Open items 1（`⌘K`）、2（toast／undo）、3（空狀態與錯誤狀態的引導）、4（context menu） |
| 對照契約 | `docs/superpowers/specs/frontend-design-language.md` |
| 狀態 | **已拍板並實作。第 8 節記錄三項決定與其結果。** |

## 1. 為什麼這四條要寫成同一份規格

它們是同一個缺口的四個出口。`⌘K` command palette、列上的 context menu、空狀態裡的「我在這裡能做什麼」、以及動作完成後的 toast，都需要同一份清單：**誰、在什麼情境、能對什麼做什麼**。分開寫，這份清單會被設計四次，而且只會靠運氣彼此一致。

這個產品沒有這份清單。每個動作都綁在剛好顯示它的那個畫面上——編輯在文件標頭的按鈕、匯入在空狀態的按鈕、封存在設定面板——沒有任何東西能把它們列舉出來。

## 2. 現況（實測，非引述）

對照 `main` @ `7275641`。之所以要重新實測，是因為四條裡有三條對產品的描述有誤，照著它們寫規格會把錯誤繼承下去。

**UI 可觸及的 mutation，全部如下：**

```text
Knowledge   建立文件              POST   /api/workspaces/:id/documents
            編輯文件              PATCH  /api/documents/:id
Sources     套用匯入預覽          POST   /api/source-imports/:id/apply
Workspace   封存／還原            POST   /api/workspaces/:id/archive|restore
            重新命名              PATCH  /api/workspaces/:id
Members     新增／改角色／移除     …/members
Groups      新增／改角色／移除     …/groups
僅存本機     收藏文件、最近瀏覽紀錄（localStorage）
```

**對 Open item 4 的更正。** 它寫著「重新命名、封存、複製連結都要先進文件頁」。

- 重新命名文件：**屬實**，就是編輯器裡的標題欄位。
- **封存文件並不存在。** UI 沒有，API 也沒有——document 路由只有 POST 與 PATCH。文件會變成 `ARCHIVED` 只能透過 source 重新同步，沒有任何人為入口。（**2026-09-30 更新：** 服務層一直有 `archiveDocument`／`restoreDocument` 與資料夾版本，缺的只是 web 入口；這條寫「API 也沒有」指的是 HTTP 路由。個人日用套件切片 A-1 補上了入口，見 §10。）
- **複製連結並不存在。** Inspector 那顆 `Copy` 按鈕複製的是文件或 source 的 **ID**，那是支援用途，不是分享用途。

**對 Open item 1 的更正。** `⌘K` 並非「只會執行搜尋」——它已經是一個 palette：搜尋文件、方向鍵移動、`aria-activedescendant`、Enter 開啟結果。它缺的是**文件以外的東西**。

## 3. 決定要不要做這件事的關鍵發現

寬鬆地數一下 palette 今天能放什麼：

```text
導航     Knowledge · Sources · Settings · 切換 workspace · 開啟文件
建立     Add to Notes · Import knowledge
文件     Edit · Open details · 收藏 · 顯示已封存
工作區   封存 · 還原 · Settings 各分頁
```

約十四項，**其中多數是導航**。參考產品的 palette 之所以有價值，是因為那個產品有上百個命令；我們的會是一個「快速前往某處」的工具，外加四件能做的事。

這仍然有價值——「快速前往」本來就是 palette 最主要的用途——但應該誠實命名，而不是包裝成對等。**Command palette 不會生出 command。** 如果目標是「讀者不必四處翻找就能動作」，那前置問題是**這個產品應該擁有哪些動作**，而那是產品決定，不是 UI 決定。

第 8 節把這個問題排在最前面。

## 4. 模型

由單一模組持有這份清單。其他任何地方都不得自行列舉動作。

```ts
type ActionId = "document.edit" | "document.favourite" | "knowledge.create" | …

type Action = {
  id: ActionId;
  label: string;                  // 祈使句：「Edit document」
  group: "navigate" | "create" | "document" | "workspace";
  shortcut?: string;              // aria-keyshortcuts 的拼法
  /** 允許出現的地方。列選單取 `row`，palette 取 `palette`。 */
  surfaces: readonly ("palette" | "row" | "empty")[];
  /** 依「呼叫者能做什麼」與「目標是什麼」決定是否提供。
   *  絕不是安全判斷 —— 見 4.2。 */
  available: (context: ActionContext) => boolean;
  run: (context: ActionContext) => void | Promise<ActionResult>;
};
```

### 4.1 可用性有三個軸，不是一個

UI 目前只讀 `access.actions.*`，也就是工作區能力那一軸。單靠它不夠，而把幾個軸混為一談正是 `CLAUDE.md` 點名的錯誤：

1. **工作區能力** —— `canWrite`、`canImport`、`canOpenSettings`……
2. **Source 所有權** —— `SOURCE_MANAGED` 的內容在 Hub 裡是唯讀的，呼叫者能力再大也一樣。「Workspace access and source ownership are separate questions and must not be conflated.」
3. **目標狀態** —— 已封存的工作區提供的是「還原」，不是「封存」。

### 4.2 Registry 不是授權

在這裡明講，因為 palette 特別容易讓人誤以為相反：

> 持有 `workspace_id`、`source_id` 或 `document_id` 不授予任何權限。URL 參數是導航輸入，永遠不是授權證明；不論 UI 允許了什麼，application service 都必須重新驗證政策。

`available()` 決定**顯示什麼**，service 決定**發生什麼**。一個在 palette 裡被藏起來的動作，伺服器一樣必須拒絕。這份規格不新增任何信任呼叫者自述的端點。

## 5. 三個出口

**Palette（`⌘K`）。** 保留現有的搜尋行為，在搜尋結果之上新增動作區。輸入同時過濾兩者。動作依 §4 的 `group` 分組；查詢為空時顯示動作與最近項目，而不是一片空白。

**列選單。** 沿用既有的 `ui/menu` primitive，由列上的 `⋯` 按鈕開啟，**並且**支援在列上按右鍵。只做右鍵會讓鍵盤與觸控使用者拿不到這些動作，而 §10 在要求方向鍵導航的同一句話裡就禁止了這件事。

**空狀態。** Open item 3 要的是引導而非光禿禿的標題。Registry 直接回答它：空狀態列出 `surfaces` 含 `empty` 且在此處可用的動作——那正是讀者當下在問的問題。這也順帶拿掉目前空狀態必須硬寫兩顆按鈕的地方。

## 6. 回饋：toast 與 undo

現況是一段 `role="status"` 的文字，出現時會把版面推開。（§18 第 2 條曾寫「全庫沒有 `aria-live`」，那是錯的——`role="status"` 本身帶有隱含的 `aria-live="polite"`。缺的是這一層，不是播報。）

**已實作。** 單一 toast 區域（`components/ui/toast.tsx`），由 app shell 掛載，`role="status"`、`aria-live="polite"`，固定在角落因而不擠壓任何版面，一次只顯示一則，下一次導航時關閉。區域本身**永遠存在**，不論有沒有訊息：一個與內容同時插入的 live region 不保證會被播報。

**只有在逆向操作已經真實存在時，才提供 undo。** 一個無法還原前一個狀態的「Undo」是謊話，而這個 codebase 沒有 soft-delete 可以倚賴。實作後的完整清單：

| 動作 | 可 undo | 原因 |
| --- | --- | --- |
| 封存／還原工作區 | **是** —— 互為逆向 | 兩個端點都已存在 |
| 重新命名工作區 | **是** —— 改回舊名 | 舊名在送出前就先捕捉起來 |
| 新增成員／群組 | **是** —— 移除 | 逆向端點已存在 |
| 變更成員／群組角色 | **是** —— 改回去 | 先前的角色是已知的 |
| 移除成員／群組 | **是** —— 重新授權 | 見下方那一段：逆向呼叫不是鏡像 |
| 編輯文件 | **否** | 會產生一個新 revision；「還原」是再產生一個 revision，那是功能，不是 undo |
| 套用匯入 | **否** | 規格本身的規則：沒有 force apply，也沒有回滾 |

**逆向呼叫不一定是正向呼叫的鏡像。** 還原一筆被移除的授權要走 **add** 端點，不是 PATCH——`changeDirectMemberRole` 與 `changeGroupMappingRole` 在目標已不存在時會直接拒絕。而且它是一筆**新的**授權，稽核紀錄會如實這樣記載。`GrantRowActions` 因此收三個 callback 而不是一個 `url`：一個 `url` 只能猜第三個。e2e 斷言的是 undo 之後的**狀態**，不是 toast 文字——那是唯一能讓這個差別浮出來的寫法。

**訊息依「讀者是否必須處理它」分流。** 失敗留在控制項旁邊（`GovernanceError`，能把欄位標成 invalid）；成功只是回報，所以進 toast。**會導航到結果本身的操作兩者都不給**——儲存文件會落在儲存後的文件上，再疊一個 toast 是噪音。

兩段式的行內確認**只保留在**無法 undo 且後果重大的地方。凡是能 undo 的，就先做、再給 undo。封存工作區與移除授權原本都有確認步驟，現在都沒有了——在可逆的動作前面問兩次不會買到安全，只會訓練讀者把真正重要的那幾次也一起點掉。

## 7. 這份規格刻意不決定的事

**文件封存是 domain 改動，不是 UI 功能。** 要加它，意味著一個端點、一個生命週期轉換、一條「Hub 封存了一份 `SOURCE_MANAGED` 文件、下次同步卻不同意」時該怎麼辦的規則，以及一筆稽核紀錄。它動到的是 knowledge 模組，不是 `components/`。這裡不處理；若要做，它該是自己的一份規格。

Registry 的設計讓它日後只是新增一個項目，而不是重新設計。

## 8. 決定（2026-09-22 拍板）

1. **值得做。** 即使第 3 節的清點結果是「多數為導航」，仍然做。導航本來就是 palette 最主要的用途。但「這是個導航工具」這件事被寫進契約 §18 成為一條明確的 open item，而不是靠加入不做事的項目來假裝它是別的東西。
2. **文件封存維持現狀，不新增。** 因此 Open item 4 的前提（「封存、複製連結被放錯位置」）是錯的——那兩件事從未存在——契約已改寫。Registry 的設計讓它日後只是新增一個項目。
3. **支援右鍵。** 但右鍵**不是唯一入口**：每一列同時帶一顆 `⋯` 觸發鈕，顯示完全相同的項目。只做右鍵會讓鍵盤與觸控使用者拿不到這些動作，而 §10 在要求方向鍵導航的同一句話裡就禁止了這件事。實作用的是 Base UI 的 `ContextMenu`，長按（觸控）因此也能開啟。

### 實作後才發現、值得記下的兩件事

**`⋯` 是浮動的，不佔欄位。** 第一版讓它像收藏星號一樣佔一個控制格，結果側欄裡每一個標題都被重新截斷——為了一顆多數時間看不見的按鈕。改成絕對定位浮在列自己的背景上之後，版面與改動前完全一致。連帶的規則：列在 `focus-within` 時也要上底色，否則鍵盤聚焦時浮動按鈕下面沒有背景。

**`document.details` 只出現在 palette，不出現在列選單。** Inspector 描述的是「正在開啟的那份文件」，掛在別的列上會承諾一個它顯示不出來的面板。

## 9. 若決定進行，完成的判準

- 由單一模組列舉動作；沒有任何出口持有自己的清單。
- 每個動作都在 §4.1 的三個軸上說明其可用性。
- 這項工作新增的端點都不信任客戶端的自述，各自重新驗證。
- Toast 區域不擠壓任何版面；每一個提供出去的 undo，都有測試斷言它**還原了狀態**，而不是斷言 toast 出現過。
- 對呼叫者不可用的動作，既不出現在 palette，**也**被伺服器拒絕——兩者分別斷言。

## 10. 後續（2026-09-30）：封存、資料夾，與它們需要 registry 多帶的東西

§8-2 決定「文件封存維持現狀，不新增」，並說 registry 的設計讓它日後只是新增一個項目。日後到了：個人日用套件切片 A-1（[規格 §7](2026-09-29-personal-daily-driver-design.md)）。結果與那句話大致相符——是新增項目——但有三個地方 registry 得多帶東西：

- **`ActionTarget.sourceStatus`。** 原本的 `status` 是「有效狀態」（文件與 source 都是 ACTIVE 才是 ACTIVE），因為已封存 source 裡的文件什麼都不能改。但「還原」需要知道是誰被封存：文件自己被封存而 source 在用，可以還原；source 被封存，服務會拒絕，得先還原 source。所以兩者分開帶。
- **`FolderTarget`** 與 `ActionContext.folder`：資料夾列有自己的目標，可用性同樣三軸（能寫且已確認、HUB_MANAGED、狀態，外加所在 source 的狀態）。資料夾動作只在 row，不在 palette——palette 描述的是正在讀的那份文件，沒有資料夾可指。
- **兩種新效果。** `create-folder`（要一個名稱）與 `folder-command`（重新命名、封存、還原）；文件的封存與還原走既有的 `command`，多帶一個 `label` 給訊息用。

**A-2 再多一種效果與兩個項目（2026-09-30）。** `move`（要一個地方）：`document.move`「Move document…」在 row 與 palette，`folder.move`「Move folder…」只在 row。可用性同封存的三軸，再加所在 source 必須是 ACTIVE（source 被封存時服務會拒絕任何內容變更，移動也是）；放在 Archive 之前，Archive 仍是選單的最後一項。效果帶的是 `sourceId`、標題與「哪個節點」——文件用 `documentId`（palette 手上只有它），資料夾用樹節點 ID——由對話框自己在樹裡找位置。**在樹上按 Alt+↑/↓ 重排不是 registry 的動作**（沒有選單項、沒有 palette 項）：它是鍵盤對同一個「可以移動」的回答，所以樹用該列自己的 registry 動作裡有沒有 Move 來決定要不要理這個鍵。

**undo 的清單（§6）多三列：** 封存／還原文件、封存／還原資料夾（互為逆向；文件保有所有 revision 與位置，ARCHIVED 是生命週期而不是刪除）、重新命名資料夾（改回舊名）。**新增資料夾不能 undo**——最接近的反向是封存它，那不是同一件事。

**toast「下一次導航時關閉」有了一個例外。** 封存正開著的文件會把讀者送到清單，Undo 得在那裡等著。toast 可以自己聲明「我的動作會導航」，撐過之後 3 秒內的導覽（複數：一次 push 可以是好幾次，路由器先把網址改成推去的路由，那個路由再 redirect）。寫 e2e 時才發現只撐過一次是不夠的。

**一個副作用：** `requestWorkspaceAccessCheck` 對所有 409 都重新確認存取權，重新確認期間所有寫入動作暫停、還閃出「Unable to confirm workspace」。「資料夾不是空的」這類拒絕說的是內容而不是權限，所以 `FOLDER_NOT_EMPTY`、`INVALID_PARENT`、`TREE_CYCLE`、`CROSS_SOURCE_MOVE` 與 `REVISION_CONFLICT` 一樣被排除。
