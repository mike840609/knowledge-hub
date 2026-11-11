# 維護者指南

[English](maintainers.md) · **繁體中文**

工具鏈的版本固定與注意事項，以及 canonical 設計文件索引。安裝、設定與部署 Knowledge Hub 請見 [README](../../README.zh-TW.md)。

## 本機 pnpm

pnpm 12 是本機預設的套件管理器；`pnpm-workspace.yaml` 與 `pnpm-lock.yaml` 已提交。pnpm 無法使用時以 npm 作為備援；CI、Vercel 與部署仍一律使用 npm（`npm ci`、`package-lock.json`）。請以 `brew install pnpm`（或 `npm install -g pnpm@12`）安裝，並確認 `pnpm -v` 回報 12.x。

已提交的 `pnpm-workspace.yaml` 含三項必要設定：

```yaml
packageImportMethod: clone-or-copy
publicHoistPattern:
  - '*'
allowBuilds:
  esbuild: true
  fsevents: true
  unrs-resolver: true
```

- `packageImportMethod: clone-or-copy` 是必要的：若省略，pnpm 可能從共用 store hardlink 套件，`patch-package` 就會修改該 store，影響所有使用它的專案。下方的 `pnpm store status` 說明只在這個設定成立時有效。
- `publicHoistPattern` 對應此 repository 目前依賴的 root hoisting：它匯入 `mdast-util-to-hast`、`mdast-util-gfm` 與 `@next/eslint-plugin-next` 時並未宣告這些依賴；正式解是把這些依賴宣告進 `package.json`。
- `allowBuilds` 列出允許執行 build script 的依賴；若 pnpm 警告有 build script 被忽略（或在啟用 `strictDepBuilds` 時回報 `ERR_PNPM_IGNORED_BUILDS`），確認該套件確實需要後再加入，或執行 `pnpm approve-builds`。

若你曾在這兩個檔案被追蹤前於本機建立它們，請移除其 `.git/info/exclude` 條目，讓 Git 採用已提交的版本。

以 `pnpm install` 安裝，會執行與 npm 相同的 `patch-package` postinstall。若檔案系統支援 clone/reflink（APFS、Btrfs），worktree 之間也會共用磁碟區塊；若只能 copy，pnpm 會退回複製，節省空間會縮小。

npm 備援需要 npm layout：`rm -rf node_modules .next && npm ci`。要切回 pnpm 則執行 `rm -rf node_modules .next && pnpm install`；兩種 layout 不能互換。

**相依套件變更時**要讓兩個 lockfile 保持同步。CI、Vercel 與部署以 `package-lock.json` 解析，因此先以 `npm install --package-lock-only` 更新它，再以 `pnpm import && pnpm install` 產生 `pnpm-lock.yaml`，兩個 lockfile 一起提交。`pnpm import` 會優先採用 `package-lock.json` 記錄的版本；`patches/next+15.5.25.patch` 仍在使用時，請確認 `next` 仍解析為 15.5.25。

**不要對 `pnpm install` 加上 `--ignore-scripts`**：它會同時跳過依賴的 build scripts 與套用 Next.js patch 的 `postinstall`。若已經加了，單純重跑 `pnpm install` 會回報「Already up to date」，不會重跑根目錄的 `postinstall`；請執行 `pnpm install --force`（或 `rm -rf node_modules .next && pnpm install`）。若只要分開補跑，先 `pnpm rebuild` 補回被跳過的依賴 build，再 `pnpm exec patch-package` 還原 patch。在已套用 patch 的安裝中，`pnpm store status` 會以非零狀態回報 `next`（`ERR_PNPM_MODIFIED_DEPENDENCY`）；這是預期行為，在 `clone-or-copy` 下共用的 store 本身沒有被改動。

## Next.js patch

安裝時的 postinstall 會使用 `patch-package` 套用 [`patches/next+15.5.25.patch`](../../patches/next+15.5.25.patch)，修正 Next.js 內附 React（`19.2.0-canary-0bdb9206-20250818`）的兩個問題：

1. 頁面導覽時遺失 render ping。
2. 另一個導覽仍在載入時，若有 redirect 或其他錯誤在 render 中送達（例如「Browse documents」還在轉址時就點了另一份文件），React 的錯誤復原會把 Next 的 `Router` 只 render 一半就 commit，下一次 render 拋出 React #310（Rendered more hooks than during the previous render），整頁變成「Application error」。此修正即 [facebook/react#36911](https://github.com/facebook/react/pull/36911) 的那一個條件，套用於四個 `react-dom` client 與 profiling build。

請勿跳過 install scripts。若 npm 安裝時用了 `--ignore-scripts`，請執行 `npm ci`；若 pnpm 安裝時用了，請執行 `pnpm install --force`（單純重跑 `pnpm install` 不會在已是最新的目錄重跑根目錄 `postinstall`）。若只要還原 patch，pnpm layout 使用 `pnpm exec patch-package`，npm layout 使用 `npx patch-package`。

第二個修正已對照 #36911 的上游 diff；[vercel/next.js#95368](https://github.com/vercel/next.js/pull/95368) 將它帶進 Next canary（React `ec0fca31-20260701`）。這兩個 PR 引用的 issue（vercel/next.js#63121、#78396，facebook/react#33580）只讀過摘要，未在此重現。`next/dist/compiled/react-dom-experimental` 的 experimental React 未修補：只有在 `next.config.ts` 啟用 experimental React 功能時才會載入，本專案沒有啟用。

升級 Next.js 時請確認此 patch 是否仍需要：[`vendored-react-ping-fix.test.ts`](../../tests/unit/vendored-react-ping-fix.test.ts) 檢查內附原始碼中的兩個修正，在 Next 內附的 React 已含這些修正時，不靠 patch 也會通過；[`router-redirect-during-navigation.spec.ts`](../../tests/e2e/router-redirect-during-navigation.spec.ts) 在瀏覽器中重現這個崩潰，證據見[驗證紀錄](../../docs/superpowers/verification/2026-10-06-react-310-redirect-recovery-verification.md)。更新或移除後清掉 `.next/cache` 再 build。

## Mermaid 版本

`mermaid` 固定在 `~12.2.0`。Reader 只繪製清單中的 diagram 類型，並限制 diagram 自身文字可設定的 config keys，另有一套 sanitiser 設定（[`mermaid-queue.ts`](../../src/components/knowledge/mermaid-queue.ts)）；這三項都是因為該版本在瀏覽器中的實際行為才存在。變更版本前與變更後都要執行：

```bash
make test-mermaid-assumptions
```

[`scripts/test/mermaid-assumptions.mjs`](../../scripts/test/mermaid-assumptions.mjs) 會在 Chromium 中以敵意文字排版清單中的每種 diagram，並套用 production policy 的 fetch directives；假設不再成立時會以非零狀態結束。它不屬於 `make verify` 或 CI。[規格](../../docs/superpowers/specs/2026-10-13-reader-mermaid-design.md)說明每個假設保護什麼。

## 目前的 canonical 文件

這些文件定義核心契約與實作計畫；後續專項規格記錄新增功能，附日期的驗證紀錄描述當時的執行證據。

| 領域 | 設計 | 計畫 | 範圍 |
| --- | --- | --- | --- |
| 基礎與架構 | [規格](../../docs/superpowers/specs/2026-09-10-phase-0-foundation-architecture-design.md) | [計畫](../../docs/superpowers/plans/2026-09-10-phase-0-foundation-implementation.md) | 模組邊界、schema、transactions、工作空間存取。 |
| 知識核心與樹 | [規格](../../docs/superpowers/specs/2026-09-10-phase-1-knowledge-core-tree-design.md) | [計畫](../../docs/superpowers/plans/2026-09-10-phase-1-knowledge-core-tree-implementation.md) | 文件身分、版本、樹位置與生命週期。 |
| Folder 匯入與同步 | [規格](../../docs/superpowers/specs/2026-09-12-phase-2-knowledge-source-import-sync-design.md) | [計畫](../../docs/superpowers/plans/2026-09-12-phase-2-knowledge-source-import-sync.md) | 暫存、預覽、原子套用與來源所有權。 |
| 身分與工作空間治理 | [規格](../../docs/superpowers/specs/2026-09-14-phase-3-identity-workspace-governance-design.md) | [計畫](../../docs/superpowers/plans/2026-09-14-phase-3-identity-workspace-governance.md) | 角色、能力、成員資格、SSO 與切換。 |
| 探索與讀取 API | [規格](../../docs/superpowers/specs/2026-09-16-phase-4-discovery-read-api-design.md) | [計畫](../../docs/superpowers/plans/2026-09-16-phase-4-discovery-read-api.md) | 授權搜尋與有界文件讀取。 |
| 人工撰寫 | [規格](../../docs/superpowers/specs/2026-09-16-phase-5-human-authoring-design.md) | [計畫](../../docs/superpowers/plans/2026-09-16-phase-5-human-authoring.md) | 上傳、建立、編輯與版本衝突。 |
| 文件分享 | [規格](../../docs/superpowers/specs/2026-09-23-document-share-link-design.md) | [計畫](../../docs/superpowers/plans/2026-09-23-document-share-link.md) | 可到期、可撤銷的單篇文件讀取。 |
| 文件評論 | [規格](../../docs/superpowers/specs/2026-10-09-shared-personal-document-inline-review-design.md) | [計畫](../../docs/superpowers/plans/2026-10-09-shared-personal-document-inline-review.md) | 有效連結可免登入閱讀評論、登入後留言、擁有者管理與同步錨點；公司環境另行驗證後啟用。 |
| 擁有者的留言側欄 | [規格](../../docs/superpowers/specs/2026-10-12-owner-comments-rail-design.md) | — | 擁有者的留言顯示在對應段落右側、取代大綱的位置；文件區太窄時改用抽屜。 |
| 留言錨點與擁有者討論 | [規格](../../docs/superpowers/specs/2026-10-13-review-anchors-and-owner-threads-design.md) | — | 可在表格儲存格與程式碼留言；無法留言的選取會說明原因；擁有者可發起討論；callout、task list 或 footnote 不再停用留言。 |
| 已儲存的分享 | [規格](../../docs/superpowers/specs/2026-10-12-saved-shares-design.md) | [計畫](../../docs/superpowers/plans/2026-10-12-saved-shares.md) | 保存別人分享的文章連結，可跨裝置使用；與最愛分開，閱讀權限仍由原分享連結控制。 |
| 資料夾分享 | [規格](../../docs/superpowers/specs/2026-10-29-folder-share-link-design.md) | [計畫](../../docs/superpowers/plans/2026-10-29-folder-share-link.md) | 以單一可到期、可撤銷的連結分享個人空間資料夾的即時內容：閱讀頁旁有目錄樹，資料夾內的連結可跟隨，其餘顯示為文字；評論、儲存與擁有者收件匣的行為與文件連結相同。 |
| 來源分享 | [規格](../../docs/superpowers/specs/2026-11-05-source-share-link-design.md) | [計畫](../../docs/superpowers/plans/2026-11-05-source-share-link.md) | 分享個人空間中單一來源的即時文件樹，不公開來源設定、歷史或資產。 |
| 指定人員分享 | [規格](../../docs/superpowers/specs/2026-11-03-named-recipient-share-design.md) | — | 具名對象的分享連結：只有擁有者列出的已登入人員能開啟，在 Hub 內閱讀而非 `/s/:token`，永不過期，授權範圍不超過一般連結。 |
| 追蹤中的討論 | [規格](../../docs/superpowers/specs/2026-10-23-followed-discussions-tab-design.md) | [計畫](../../docs/superpowers/plans/2026-10-23-followed-discussions-tab.md) | Shares → Discussions 列出讀者追蹤的討論；沒有有效連結時仍可取消自己的追蹤。 |
| 閱讀頁 callout | [規格](../../docs/superpowers/specs/2026-10-12-reader-callouts-design.md) | — | `> [!NOTE]` 與 GitHub 另外四種類型在閱讀頁和分享頁顯示成 callout；儲存的 Markdown 不變。 |
| 閱讀頁 HTML 子集 | [規格](../../docs/superpowers/specs/2026-10-12-reader-html-subset-design.md) | — | 閱讀頁和分享頁認得七個不帶屬性的 HTML 標籤；其餘照原樣顯示成文字，使用者寫的 HTML 一律不直接輸出。 |
| Content-Security-Policy | [規格](../../docs/superpowers/specs/2026-10-12-content-security-policy-design.md) | — | 每個頁面的 script 都要帶該次回應的 nonce 才能執行；不允許 inline script 與事件處理器。 |
| 閱讀頁 Mermaid | [規格](../../docs/superpowers/specs/2026-10-13-reader-mermaid-design.md) | [計畫](../../docs/superpowers/plans/2026-10-13-reader-mermaid.md) | `mermaid` 區塊在閱讀頁和分享頁畫成圖片，永不當成 markup；無法繪製時保留為程式碼並說明原因。 |
| 編輯器的閱讀樣式提示 | [規格](../../docs/superpowers/specs/2026-10-12-editor-reader-hints-design.md) | — | 編輯器以 decoration 提示 callout 與行內 HTML 子集的樣子；標記保留，儲存的 Markdown 不變。 |
| 文件樹按需載入 | [規格](../../docs/superpowers/specs/2026-10-24-lazy-source-trees-design.md) | [計畫](../../docs/superpowers/plans/2026-10-24-lazy-source-trees.md) | 初始載入目前來源，其餘展開時讀取；支援重試，並與移動對話框共用資料。 |
| 文件編輯器 | [規格](../../docs/superpowers/specs/2026-09-28-document-composer-design.md) | [計畫](../../docs/superpowers/plans/2026-09-28-document-composer.md) | 渲染編輯與 Markdown 原始碼模式。 |
| 行內編輯 | [規格](../../docs/superpowers/specs/2026-10-16-inline-editing.md) | — | 在閱讀頁直接編輯，搭配 autosave 與段落討論；checkpoint 歷史是後續政策。 |
| 知識連結與圖譜 | [規格](../../docs/superpowers/specs/2026-09-29-personal-workspace-knowledge-graph-design.md) | [計畫](../../docs/superpowers/plans/2026-09-29-personal-workspace-knowledge-graph.md) | Wikilinks、反向連結、標題錨點與衍生圖譜資料。 |
| 個人日用功能 | [規格](../../docs/superpowers/specs/2026-09-29-personal-daily-driver-design.md) | [計畫](../../docs/superpowers/plans/2026-09-29-personal-daily-driver.md) | Wikilink 保留、自動完成、程式碼區塊與整理。 |
| 個人工作空間推出 | [規格](../../docs/superpowers/specs/2026-09-30-personal-workspace-design.md) | [計畫](../../docs/superpowers/plans/2026-09-30-personal-workspace.md) | 帳號草稿、收藏、版本還原與匯出。 |
| 任務知識匯出 | [規格](../../docs/superpowers/specs/2026-11-04-task-knowledge-export-design.md) | [計畫](../../docs/superpowers/plans/2026-11-04-task-knowledge-export.md) | 在 Claude Code 或 OpenCode 輸入 `/hub-export`，經由一個受限、可撤銷的 binding 把完成的任務存進 My Space；手動、冪等、不用 MCP。設定：[任務匯出設定](../../docs/task-export-setup.zh-TW.md)。 |
| Agent 讀取 | [規格](../../docs/superpowers/specs/2026-11-10-agent-read-access-design.md) | [計畫](../../docs/superpowers/plans/2026-11-10-agent-read-access.md) | `/hub-search` 與 `/hub-read` 用同一把匯出 token 讀取 My Space 中使用者使用中的文件與過去的任務結果；唯讀、僅限一個 My Space、不用 MCP。 |
| Home 續接 | [規格](../../docs/superpowers/specs/2026-10-19-home-continue-design.md) | [計畫](../../docs/superpowers/plans/2026-10-19-home-continue.md) | Home 上的草稿、最近文件與收藏。 |
| 探索與 Copy for Agent | [規格](../../docs/superpowers/specs/2026-10-04-mvp-discovery-agent-design.md) | [計畫](../../docs/superpowers/plans/2026-10-04-mvp-discovery-agent.md) | Folder 範圍、搜尋篩選與經檢視的 Markdown bundles。 |
| 範例知識庫與匯入指南 | [規格](../../docs/superpowers/specs/2026-10-06-sample-wiki-import-guide-design.md) | [計畫](../../docs/superpowers/plans/2026-10-06-sample-wiki-import-guide.md) | 內附雙語範例知識庫，以及顯示即時限制的站內匯入指南。 |
| 檢索優先版型 | [規格](../../docs/superpowers/specs/2026-10-28-retrieval-first-shell-design.md) | — | 1024–1279px 時文件瀏覽器改為抽屜；Favorites 與 Recent 預設展開；搜尋仍是主要入口。 |
| Google demo login | [規格](../../docs/superpowers/specs/2026-10-25-google-login-design.md) | [計畫](../../docs/superpowers/plans/2026-10-25-google-login.md) | 公開 demo 的額外 Google provider。 |
| Vercel + Layerbase 部署 | [規格](../../docs/superpowers/specs/2026-10-24-vercel-layerbase-deployment-design.md) | [計畫](../../docs/superpowers/plans/2026-10-24-vercel-layerbase-deployment.md) | 單人操作部署，使用站台密碼與 build-time migrations。 |
| 來源重新命名 | [規格](../../docs/superpowers/specs/2026-10-26-source-rename-design.md) | [計畫](../../docs/superpowers/plans/2026-10-26-source-rename.md) | 只改來源顯示名稱，不改變資料夾身分。 |
| Inbox 分割檢視 | [規格](../../docs/superpowers/specs/2026-10-29-inbox-split-view-design.md) | — | 視窗達 75rem 時，列表與選取的討論並排；較窄時維持列表。 |
| 使用者 account | [規格](../../docs/superpowers/specs/2026-10-29-users-account-design.md) | [計畫](../../docs/superpowers/plans/2026-10-29-users-account.md) | 儲存 Company SSO 的 account 與選填英文名稱，供未來的 mention autocomplete 使用。 |
