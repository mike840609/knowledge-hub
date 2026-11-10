# 任務匯出設定

把用 Claude Code 或 OpenCode 完成的任務，存成 Knowledge Hub My Space 裡的任務結果。
匯出只走一個受限的 binding：它只能把任務結果加進，並讀取使用中的文件與任務結果，而且僅限你自己的 My Space；它不能改變文件。只有在你要求時（`/hub-export`）才會送出。

[English](task-export-setup.md)

## 升級須知

從這個版本起，匯出用的 token 也能讀取你的 My Space，包含其中所有使用中的文件與任務結果。先前發出的 token 不需任何動作就會取得這項能力。如果某把 token 可能已經外洩，請到設定頁輪替它。若要完全停止某把 token 的讀取，請到設定頁撤銷它；撤銷也會一併停止匯出。

## 1. 建立 binding

在 Knowledge Hub 開啟 **My Space → Tasks → Set up export**，替 binding 取個標籤（例如所在的機器），
然後建立。頁面只會顯示一次這個 binding 專用的設定指令，指令裡包含它的密鑰。請立刻複製，之後不會再顯示。

## 2. 每台機器執行一次設定指令

需要 Node.js 20.19 以上。執行頁面顯示的那一行：

```bash
npm install -g https://km.example.com/cli/knowledge-hub.tgz && knowledge-hub install-agent && knowledge-hub configure --hub-url https://km.example.com --binding-id <binding-id> --token <secret>
```

- `npm install -g` 安裝 Hub 自己提供的 `knowledge-hub` 指令，版本一定和伺服器一致。
- `install-agent` 在 `~/.claude/skills/hub-export/SKILL.md` 安裝 Claude Code Skill，並在
  `~/.config/opencode/commands/hub-export.md` 安裝指向同一份 Skill 的 OpenCode 指令。
  它不會覆寫你改過的檔案；加 `--force` 才會取代。加 `--claude` 只裝 Claude Code。
- `configure` 把 Hub URL、binding 與密鑰存在你的使用者設定目錄，只有你能讀取。它不會印出密鑰，也不會把密鑰寫進專案。不加 `--token` 時，會改在隱藏輸入提示詢問密鑰。

**請把這行指令當成密鑰。** 它帶著密鑰，所以會留在你的 shell history；執行期間，共用機器上的其他使用者也看得到它出現在行程清單。
只在你自己的機器上執行；如果這行指令曾顯示或貼到其他地方，請到設定頁輪替密鑰，舊指令就會立刻失效。

這樣就完成了：這台機器上的每個專案與 worktree 都能匯出，不必逐一設定專案。

- **另一台機器：** 在設定頁替它另建一個 binding，並在那台機器執行它的設定指令。
  不要為此輪替這個 binding 的密鑰：輪替會讓仍使用舊密鑰的機器停止運作。兩台機器都會匯出到同一個 My Space。
- **同一台機器上的第二個 binding：** 在 `configure` 與每次 `export` 加上 `--profile <name>`。
- **輪替密鑰：** 在設定頁輪替，頁面會顯示新的設定指令，執行它就會取代已存的密鑰。
  （也可以執行 `knowledge-hub configure --rotate <binding-id>`，在提示貼上該指令中 `--token` 後面的值。）

Agent 用路徑寫的 Wiki 引用，只要 My Space 裡恰好有一個已同步資料夾有該路徑，就會連到那一頁。

## 3. 匯出任務

完成任務後輸入 `/hub-export`。Agent 會寫一段任務的簡短描述，pipe 給
`knowledge-hub export --new`，並回報 URL 與 Task ID。之後要更新這筆匯出，請 Agent
更新即可；它會執行 `knowledge-hub export --task <task-id>`。

Agent 寫出的內容長這樣，完成時間由指令補上：

<!-- example-content -->
```json
{
  "agent": "claude-code",
  "status": "completed",
  "title": "修正登入重新導向迴圈",
  "summary": "Session cookie 過期時，登入頁不再導向自己。",
  "verification": { "status": "passed", "checks": ["npm test -- auth: 12 passed"] },
  "references": [
    { "type": "WIKI", "path": "architecture/auth.md" },
    { "type": "CODE_FILE", "path": "src/auth/redirect.ts" }
  ]
}
```

## 4. 搜尋與讀取 My Space

同一把 token 也能讀取你的 My Space，包含其中所有使用中的文件與任務結果。當你要求時，
Agent 會用這些指令（`/hub-search` 與 `/hub-read`）。它們只讀取，不會改變文件。

- `knowledge-hub search <words>` 搜尋使用中的文件。加上 `--tasks` 則改為搜尋你的任務結果。
  每筆結果會印出 ID、路徑（沒有路徑時為 `-`）、標題，以及縮排的摘要；`No results.`
  是正常結果，結束碼仍是 0。
- `knowledge-hub read <path-or-id>` 以來源路徑或文件 ID 印出一篇文件目前的 Markdown。
  `knowledge-hub read --task <task-result-id>` 則以 JSON 印出一筆任務結果。
- `knowledge-hub status` 只讀取這台機器的本機設定。它不連線、不印出密鑰；結束碼 0
  表示 binding 與它的 token 都存在。

範例：

```bash
knowledge-hub search "login redirect"
knowledge-hub read architecture/auth.md
knowledge-hub status
```

同一台機器上的第二個 binding，請在任一指令加上 `--profile <name>`。

搜尋或讀取沒有成功時，結束碼的意義和匯出相同：

| 結束碼 | 意義 | 該做什麼 |
|---|---|---|
| 0 | 完成；搜尋沒有結果也會明說 | 不用做任何事 |
| 2 | 本機用法錯誤，或這台機器尚未設定 | 修正指令，或執行它印出的 `configure` 指令 |
| 3 | 沒有可信的回應（網路、逾時、轉址、伺服器錯誤、任務搜尋未啟用） | 稍後再要求同樣的搜尋或讀取 |
| 4 | 需要你的動作（token 被拒、路徑對到多篇文件、內容過大、找不到） | 照印出的下一步做 |

## 匯出沒有成功時

每次匯出在送出前都會先存在本機，指令也會印出下一步。結束碼代表下一步的種類：

| 結束碼 | 意義 | 該做什麼 |
|---|---|---|
| 0 | 已存進 Knowledge Hub | 不用做任何事 |
| 2 | 在本機被拒絕，沒有送出任何東西 | 修正內容，或先重試列出的匯出 |
| 3 | 沒有可信的回應（網路、逾時、伺服器錯誤） | 稍後執行 `knowledge-hub export --retry <task-id>` |
| 4 | 需要你的動作（密鑰已輪替、任務已封存、revision 被拒） | 照印出的下一步做 |

- 沒有得到回應的匯出**可能已經存進去了**。用 `knowledge-hub export --retry <task-id>`
  重試：Hub 能辨識完全相同的重送，所以重試不會產生第二份。
- 只要有較早的匯出尚未確認，`--new` 就會被拒並列出它。請先重試它。
- `knowledge-hub export --discard <task-id>` 只在本機放棄一筆未確認的匯出，不會從
  Knowledge Hub 刪除任何東西；如果它可能已經存進去，請優先用 `--retry`。

## Knowledge Hub 的回應

`POST /api/task-results/ingest` 只接受放在專用 header 的匯出密鑰；瀏覽器 session 或
`Authorization` header 在這裡一律不被接受。

| HTTP | 意義 | CLI 結束碼 |
|---|---|---|
| 201 / 200 | 新 revision 已儲存／完全相同的重送 | 0 |
| 401 | 密鑰不明、已輪替或已撤銷 | 4（`configure --rotate`，或 `--discard`） |
| 403 | binding 所屬的 My Space 已不接受寫入 | 4 |
| 409 | `TASK_ARCHIVED`（先還原再 `--retry`）、`REVISION_CONFLICT`、`REVISION_OUT_OF_ORDER` | 4 |
| 413 / 422 | 超過 64 KiB／不符內容契約 | 4 |
| 5xx、逾時 | 沒有可信的回應 | 3（`--retry`） |
