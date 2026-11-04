# 任務匯出設定

把用 Claude Code 或 OpenCode 完成的任務，存成 Knowledge Hub My Space 裡的任務結果。
匯出只走一個受限的 binding：它只能把任務結果加進你自己 My Space 的一個資料夾同步
Source；只有在你要求時（`/hub-export`）才會送出。

[English](task-export-setup.md)

## 1. 安裝指令

需要 Node.js 20.19 以上。在 Hub repository 的 checkout 中：

```bash
cd tools/knowledge-hub
npm pack                       # 產生 knowledge-hub-<version>.tgz
npm install -g ./knowledge-hub-*.tgz
knowledge-hub help
```

這個 tarball 沒有任何相依套件；可以複製到另一台機器，用同樣方式安裝。

## 2. 建立 binding

在 Knowledge Hub 開啟 **My Space → Tasks → Set up export**，選擇任務結果所屬的資料夾
同步 Source，建立 binding。頁面只會顯示一次密鑰，並附上這個 binding 專用的
`configure` 指令。請立刻複製密鑰，之後不會再顯示。

## 3. 設定每個專案

在專案根目錄執行頁面顯示的指令，然後在隱藏輸入提示貼上密鑰：

```bash
knowledge-hub configure --hub-url https://km.example.com --binding-id <binding-id>
```

密鑰不會出現在命令列上。它以 binding 為單位存在你的使用者設定目錄，只有你能讀取；
第二個使用同一 binding 的專案不會再詢問。

- **Git worktree 與其他 checkout：** 用
  `knowledge-hub configure --from <已設定專案的路徑>` 沿用已設定的專案。
- **同一專案兩個 binding：** 在 `configure` 與每次 `export` 加上 `--profile <name>`。
- **輪替密鑰：** 先在設定頁輪替，再執行
  `knowledge-hub configure --rotate <binding-id>` 貼上新密鑰。所有使用該 binding 的
  專案都會一起更新。

## 4. 安裝 `/hub-export` 指令

```bash
knowledge-hub install-agent              # Claude Code 與 OpenCode
knowledge-hub install-agent --claude     # 只裝 Claude Code
```

這會在 `~/.claude/skills/hub-export/SKILL.md` 安裝 Claude Code Skill，並在
`~/.config/opencode/commands/hub-export.md` 安裝指向同一份 Skill 的 OpenCode 指令。
它不會覆寫你改過的檔案；加 `--force` 才會取代。

## 5. 匯出任務

完成任務後輸入 `/hub-export`。Agent 會寫一段任務的簡短描述，pipe 給
`knowledge-hub export --new`，並回報 URL 與 Task ID。之後要更新這筆匯出，請 Agent
更新即可；它會執行 `knowledge-hub export --task <task-id>`。

Agent 寫出的內容長這樣：

<!-- example-content -->
```json
{
  "agent": "claude-code",
  "status": "completed",
  "title": "修正登入重新導向迴圈",
  "summary": "Session cookie 過期時，登入頁不再導向自己。",
  "completedAt": "2026-11-04T10:00:00+08:00",
  "verification": { "status": "passed", "checks": ["npm test -- auth: 12 passed"] },
  "references": [
    { "type": "WIKI", "path": "architecture/auth.md" },
    { "type": "CODE_FILE", "path": "src/auth/redirect.ts" }
  ]
}
```

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
| 403 | binding 的 Source 或 My Space 已不接受寫入 | 4 |
| 409 | `TASK_ARCHIVED`（先還原再 `--retry`）、`REVISION_CONFLICT`、`REVISION_OUT_OF_ORDER` | 4 |
| 413 / 422 | 超過 64 KiB／不符內容契約 | 4 |
| 5xx、逾時 | 沒有可信的回應 | 3（`--retry`） |
