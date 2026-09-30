# Knowledge Hub

讓各團隊將自己的 LLM Wiki／Markdown folder 整合為可供人與 Agent 共用的公司知識，並在後續階段由 HR／發布者重新編排、發布至 tKMS。

Knowledge Hub 採用自建 Knowledge Core，不綁定 Obsidian、特定 Wiki generator、Refine 或 Outline。專案目錄名稱為 `HCM-KM`。

## Quick Start

前置需求：Node.js 20.9–24（見 `.node-version`）、Docker（跑 MariaDB）、`make`。

```bash
make bootstrap   # npm ci + 建 .env + 啟動 MariaDB + migrate + seed
make dev         # 啟動 dev server
```

瀏覽器開啟 http://127.0.0.1:3000/，預設進入 My Space 個人首頁。Team 入口保留並反灰，標示 Coming soon。

常用指令（完整列表見 `make help`，細節對應 `package.json` scripts）：

| 指令 | 用途 |
| --- | --- |
| `make dev` / `make build` / `make start` | 開發／建置／跑 production build |
| `make db-up` / `make db-down` / `make db-logs` | 啟停／看 log（MariaDB 跑在 127.0.0.1:3307） |
| `make db-migrate` / `make db-seed` | 搬 schema／灌 fixtures（皆冪等，可重跑） |
| `make db-reindex-links` | 回填／修復文件連結索引（migration 012 之後執行一次；冪等，可在服務運行中執行） |
| `make test-unit` | Unit tests（不需 DB） |
| `make test-integration` | Integration tests（需 DB，腳本自建自清隔離 DB） |
| `make test-e2e` | E2E（需 DB＋`make browsers` 裝過一次 Chromium；腳本自建 DB、build、跑 Playwright） |
| `make verify` | 本地版 CI gate：unit＋typecheck＋lint＋build |
| `make clean` / `make db-reset` | 清建置產物／**清空 dev 資料重來** |

疑難排解：port 衝突先查 3307（DB）、3000（dev）、3101（E2E）；DB 起不來用 `make db-logs` 看； dev 資料亂掉用 `make db-reset`（會刪 volume）。

### 對 Next 內附 React 的 patch

`npm ci` 之後 `postinstall` 會跑 `patch-package`，把 `patches/next+15.5.25.patch` 套到 `node_modules/next` 內附的 React（一行修正：render 途中收到的 ping 不再被丟掉；否則同頁導覽偶爾「載入完了卻不顯示」，見 [驗證紀錄 §9](docs/superpowers/verification/2026-09-29-personal-workspace-knowledge-graph-verification.md)）。

- 用 `npm ci --ignore-scripts` 安裝會漏掉它；`tests/unit/vendored-react-ping-fix.test.ts` 會失敗並告訴你補跑 `npx patch-package`。
- 升級 Next 時，patch 檔名帶版本，舊版 patch 會讓 `patch-package` 報錯，這是刻意的：先看新版內附的 React 是否已含這個修正（那個 unit test 會自己通過），是的話直接刪 `patches/next+*.patch`；否則重做 patch，並用 `npx tsx scripts/diagnostics/router-stuck-transition.ts 100`（需要正在運行的 production build）確認。上游修正已在 Next 16.x。
- **新增或移除 patch 之後，清掉 `.next/cache` 再 build。** webpack 的持久化快取把 `node_modules` 當成不可變，不清的話 build 會沿用快取裡編譯過的舊版 React，patch 看起來「沒有生效」。CI 是乾淨 checkout，不受影響。

## 目前狀態

更新日期：2026-09-29。

已交付階段：`phase-0-foundation`（Phase 0 application、migration、fixtures 與最小 Web flow）、`phase-1-knowledge-core-tree`（PR #6，Workspace-scoped Knowledge identity、Revision、Tree 與 read-only browser）、`phase-2-source-import-sync`（PR #7，整包 Markdown folder 經 Preview → Confirm → Apply 的首次匯入與 re-sync）、Phase 2.5（PR #19，frontend product baseline）、Phase 3（PR #24，Workspace lifecycle/admin、production roles/capabilities、membership 與 enterprise identity governance）、Phase 4（PR #32，Workspace-aware keyword search 與 read API），以及 Phase 5（PR #35）：單篇 Markdown upload 與 Web create/edit 的 Hub-managed authoring，含 lazy default source、immutable Revision、stale-editor 409 conflict，以及 capability + HUB_MANAGED ownership 雙重把關。Phase 5 之後另交付 document share link（PR #52）、keyboard shortcuts（PR #58–#60），以及 Personal Workspace 的知識連結與圖譜：文件目錄（TOC）、`[[wikilink]]` 與相對 `.md` 連結、Backlinks、Workspace／Local graph（規格見下表；migration 012 之後需執行 `make db-reindex-links` 回填索引，見 [rollout](docs/operations/document-link-index-rollout.md)）。

實際檢查結果記錄於 [`docs/superpowers/verification/`](docs/superpowers/verification/)：Phase 0–5 與 share link 皆有 verification record（Phase 2/3 於 PR #51 補上）。

**Phase 6（tKMS Publishing）延後**（2026-09-28 決定）。目前優先處理 Web 介面上的待辦，清單見 [Frontend Design Language §18 Open items](docs/superpowers/specs/frontend-design-language.md)。Phase 6–9 仍只有 roadmap，尚無 canonical design / implementation plan。

2026-09-10 architecture review 已把 Workspace access-boundary correction **直接整合進 Phase 0/1 canonical spec 與 plan**：`org_code` 保留為使用者公司組織屬性，但 **Workspace 才是 Knowledge container 與基本存取邊界**。不同 org 的使用者可以透過 WorkspaceMembership 共用同一 Workspace；同 org 也不代表自動取得 Workspace 內容。

## Personal workspace rollout

個人使用功能與契約見 [Personal workspace design](docs/superpowers/specs/2026-09-30-personal-workspace-design.md)，測試結果與採用步驟見 [驗證紀錄](docs/superpowers/verification/2026-09-30-personal-workspace.md)。

- Team 預設暫停開放；`KM_TEAM_WORKSPACES_ENABLED=true` 才恢復完整 Team 導覽與存取，既有資料和 membership 不變。
- 執行 `npm run db:migrate` 套用 migration 013，新增帳號草稿與收藏儲存。migration 012 是文件連結索引。
- My Space 草稿自動保存到帳號，失敗時保留本機恢復副本；正式 Save 才建立 revision、更新分享內容。
- Home 的「Organize documents」進入既有 Knowledge 樹；可在樹上操作 Hub-managed 文件／資料夾的移動、建立、更名、封存／還原。來源同步內容仍回原始來源修改。
- 文件選單提供 Markdown 下載；Home 提供 My Space ZIP（包含封存文件的最新已存版本、metadata、目錄與 ID/path manifest；不包含草稿、版本歷史和附件 bytes）。原文連結保留，檔名附穩定 ID 避免碰撞。上限 64 MiB／9,999 份文件。
- 歷史版本可與目前版本並列比較，還原會新增 revision，並檢查編輯衝突。
- Home 提供草稿、最近編輯、最近閱讀與完整收藏；收藏跟隨帳號，一次性移轉舊的瀏覽器收藏，最近閱讀仍保留在裝置。

個人模式瀏覽器驗證：

```bash
KM_TEAM_WORKSPACES_ENABLED=false KM_E2E_PERSONAL_ONLY=true npm run test:e2e -- personal-workspace.spec.ts
```

既有 Team E2E 與 integration 測試明確使用 Team-enabled 模式；個人 rollout 測試另外驗證關閉與重新開放。

## 文件入口

### Current canonical documents

| 文件 | 用途 |
| --- | --- |
| [Phase 0–9 目標與路線圖](docs/superpowers/roadmaps/2026-09-10-knowledge-hub-phase-roadmap.md) | 各階段目標、交付範圍與責任 |
| [Phase 0 Foundation & Architecture Design](docs/superpowers/specs/2026-09-10-phase-0-foundation-architecture-design.md) | Foundation、Workspace access、Knowledge/Source schema、transaction safety、ADR |
| [Phase 0 Implementation Plan](docs/superpowers/plans/2026-09-10-phase-0-foundation-implementation.md) | Phase 0 current implementation tasks、fixtures、acceptance cases |
| [Phase 1 Knowledge Core & Tree Design](docs/superpowers/specs/2026-09-10-phase-1-knowledge-core-tree-design.md) | Workspace-scoped Knowledge identity、Revision、Tree、SourceEntry、lifecycle |
| [Phase 1 Implementation Plan](docs/superpowers/plans/2026-09-10-phase-1-knowledge-core-tree-implementation.md) | Phase 1 current implementation tasks 與 read-only browser |
| [Phase 2 Knowledge Source Import & Sync Design](docs/superpowers/specs/2026-09-12-phase-2-knowledge-source-import-sync-design.md) | Folder import staging、immutable Preview、atomic Apply、diagnostics、limits、retention |
| [Phase 2 Implementation Plan](docs/superpowers/plans/2026-09-12-phase-2-knowledge-source-import-sync.md) | Phase 2 current implementation tasks、fixtures、acceptance cases |
| [Phase 3 Identity, Workspace Administration & Governance Design](docs/superpowers/specs/2026-09-14-phase-3-identity-workspace-governance-design.md) | Workspace lifecycle/admin、roles/capabilities、membership、Team/SSO mapping、audit |
| [Phase 3 Implementation Plan](docs/superpowers/plans/2026-09-14-phase-3-identity-workspace-governance.md) | Phase 3 governance tasks、cutover 與 acceptance cases |
| [Phase 4 Discovery & Read API Design](docs/superpowers/specs/2026-09-16-phase-4-discovery-read-api-design.md) | Workspace-aware keyword search、read API、非洩漏 candidate rules |
| [Phase 4 Implementation Plan](docs/superpowers/plans/2026-09-16-phase-4-discovery-read-api.md) | Phase 4 search/read tasks、fixtures、acceptance cases |
| [Phase 5 Human Authoring Design](docs/superpowers/specs/2026-09-16-phase-5-human-authoring-design.md) | 單篇 upload、Web create/edit、stale-editor conflict、capability + HUB_MANAGED ownership gate |
| [Phase 5 Implementation Plan](docs/superpowers/plans/2026-09-16-phase-5-human-authoring.md) | Phase 5 authoring tasks、fixtures、acceptance cases |
| [Document Share Link Design](docs/superpowers/specs/2026-09-23-document-share-link-design.md) | My Space 單篇文件的不需登入唯讀連結；CLAUDE.md「Knowing an ID is not authorization」的唯一例外 |
| [Document Share Link Implementation Plan](docs/superpowers/plans/2026-09-23-document-share-link.md) | share link tasks、測試與上線檢查清單 |
| [Action Model Design](docs/superpowers/specs/2026-09-21-action-model-spec.md) | 單一 action registry：`⌘K` palette、row context menu、空狀態引導與 toast／undo 共用的「誰能對什麼做什麼」 |
| [Keyboard Shortcuts Design](docs/superpowers/specs/2026-09-24-keyboard-shortcuts-design.md) | `C`、`E`、`/`、`⌘Enter`、`Esc` 的行為與範圍 |
| [Keyboard Shortcuts Implementation Plan](docs/superpowers/plans/2026-09-24-keyboard-shortcuts.md) | keyboard shortcuts tasks 與測試 |
| [Document Composer Design](docs/superpowers/specs/2026-09-28-document-composer-design.md) | 新增與編輯共用的文件編輯器：閱讀版面、預設渲染編輯（Milkdown）並可切換 Markdown 原始碼、標題跟著 H1、分頁內暫存 |
| [Document Composer Implementation Plan](docs/superpowers/plans/2026-09-28-document-composer.md) | composer tasks 與測試 |
| [Rendered Editing Implementation Plan](docs/superpowers/plans/2026-09-29-rendered-editing.md) | 渲染編輯（composer spec 第 11 節）的 tasks 與測試 |
| [Personal Workspace 知識連結與圖譜 Design](docs/superpowers/specs/2026-09-29-personal-workspace-knowledge-graph-design.md) | TOC 與標題錨點、`[[wikilink]]`／相對 `.md` 連結的抽取與解析、Backlinks、Workspace／Local graph；可重建的 link index（derived data，不改變任何授權不變式）；收回 Phase 2.5 對 wiki-link 解析的延後 |
| [Personal Workspace 知識連結與圖譜 Implementation Plan](docs/superpowers/plans/2026-09-29-personal-workspace-knowledge-graph.md) | 四個切片（TOC、連結索引、連結渲染與 Backlinks、圖譜）的 tasks、測試與量測 |
| [Document link index rollout](docs/operations/document-link-index-rollout.md) | migration 012 的部署順序、回填／修復腳本、回滾 |
| [Team workspaces：先預告、暫不開放](docs/operations/team-workspaces-availability.md) | `KM_TEAM_WORKSPACES_ENABLED`：Coming soon 入口、伺服器存取限制、重新開放與測試 |
| [個人日用套件（第一批）Design](docs/superpowers/specs/2026-09-29-personal-daily-driver-design.md) | *已拍板，尚未實作*。修掉渲染編輯器破壞 `[[wikilink]]` 的缺陷（切片 0）、程式碼區塊、`[[` 自動完成與從失效連結建立文件、整理與封存的 web 入口、⌘K 最近開過；收藏改存 server 延後 |
| [個人日用套件（第一批）Implementation Plan](docs/superpowers/plans/2026-09-29-personal-daily-driver.md) | 六個切片（0、C、A-1、A-2、D、B.0）的 tasks、測試與驗收；建議順序 0 → C → A-1 → A-2 → D → B.0（B.0 無依賴，可提前） |
| [Frontend Design Language](docs/superpowers/specs/frontend-design-language.md) *(living contract)* | 視覺語言、design token 契約與 enforcement、component 架構、state 策略、theme contract。**不帶日期，就地修訂**；supersedes Phase 2.5 §25–30 |

推薦執行／閱讀順序：

```text
README
  → Phase Roadmap
  → Phase 0 Design
  → Phase 0 Implementation Plan
  → Phase 1 Design
  → Phase 1 Implementation Plan
  → Phase 2 Design
  → Phase 2 Implementation Plan
  → Phase 3 Design
  → Phase 3 Implementation Plan
  → Phase 4 Design
  → Phase 4 Implementation Plan
  → Phase 5 Design
  → Phase 5 Implementation Plan
```

### Architecture history

以下文件只保存 2026-09-10 從 org-scoped model 改成 Workspace model 的決策理由與 migration history，**不是第二套 active contract，也不再覆蓋 canonical spec/plan**：

- [Workspace Access Boundary Architecture History](docs/superpowers/specs/2026-09-10-workspace-access-boundary-amendment.md)
- [Workspace Foundation Implementation History](docs/superpowers/plans/2026-09-10-workspace-foundation-implementation-amendment.md)

若實作者或 Agent 要知道「現在應該怎麼做」，直接讀 canonical Phase spec/plan；history 文件只用來回答「為什麼改成這樣」。

## 核心模型

```text
User
├── emp_id
├── name
└── org_code                     ← identity / organization attribute

User
  └── WorkspaceMembership
          │
          ▼
      Workspace                  ← knowledge + basic access boundary
          │
          └── KnowledgeSource    ← Source remains the Tree root
                ├── SourceEntry → source-to-Tree/Document stable mapping
                ├── KnowledgeAsset → metadata/reference
                └── Folder / Document Tree
                      └── KnowledgeDocument → stable ID
                            └── KnowledgeRevision → immutable content
```

### Organization != Workspace

`org_code` 回答「使用者目前屬於哪個公司組織」；Workspace 回答「使用者可以進入哪些知識空間」。

```text
Workspace: Query Master

Members:
Mike    org=HRSD
Alice   org=RD
Bob     org=IT
```

跨 org membership 合法；同 org 不自動形成 membership。Phase 0 不要求 Workspace 綁定單一 owning organization。若未來治理需要 accountable org/team，Phase 3 再設計 metadata，且不得把治理 metadata 當 authorization shortcut。

每個 KnowledgeSource 必須且只屬於一個 Workspace；每份 Document 必須且只屬於一個 Source。Document 不重複保存 `workspace_id`，而是透過 `Document → Source → Workspace` 取得 scope。

### Workspace access 與 Source ownership

| 來源方式 | Ownership | Hub 內的更新規則 |
| --- | --- | --- |
| Folder Sync | `SOURCE_MANAGED` | Hierarchy、title 與內容唯讀；透過來源再次同步更新 |
| 單篇 File Upload | `HUB_MANAGED` | 匯入後由 Hub 管理，允許編輯並建立新 revision |
| Web Create | `HUB_MANAGED` | 由 Hub 建立、編輯並保留版本 |

Workspace access 決定 caller 是否能進入 Knowledge scope；Source ownership 決定內容更新權由外部來源或 Hub 控制。兩者不得混用。

Tree 決定位置，Document ID 決定身分，Revision 保存 title／Markdown／knowledge metadata；移動或改檔名不建立內容版本，修改文章標題會建立版本。

Knowledge lifecycle 只有 `ACTIVE / ARCHIVED`，MVP 不 hard delete。同一來源 entry 重現時沿用原 Document ID。Assets 只存 metadata/reference，尚不提供 binary 儲存或附件服務。

## Access Boundary

Phase 0–2 foundation flow：

```text
CallerContext
  → resolve resource Source / Workspace
  → Workspace access policy / membership
  → Source ownership + lifecycle rules
  → Knowledge operation
```

重要規則：

- `User.org_code` 不直接決定 Knowledge allow / deny。
- 知道 `workspace_id`、`source_id` 或 `document_id` 不代表有權存取。
- UI selector 不是 authorization；application service 必須重新驗證 policy。
- Phase 0–2 membership 是 local/mock MVP foundation，不冒充 production-grade ACL。
- **Company production multi-user governance 以 Phase 3 完成為 deployment gate。**
- Phase 3 同時負責 Workspace provisioning/create、rename、archive/restore、membership administration、roles/capabilities、Team／SSO Group mapping、必要 policy/audit 與 Company SSO adapter。

## Phase 概覽

| Phase | 名稱 | 目標 |
| --- | --- | --- |
| 0 | Foundation & Architecture | 建立技術骨架、Workspace access foundation、核心模型、identity contract、交易與測試基礎 |
| 1 | Knowledge Core & Tree | 完整保存與瀏覽 stable ID、Revision、lifecycle；Workspace → Source → Tree |
| 2 | Knowledge Source Import & Sync | 在選定 Workspace 建立／更新 Source，folder 經 Preview → Confirm → Apply 安全同步 |
| 3 | Identity & Basic Governance | Workspace lifecycle/admin、production roles/capabilities、membership、企業 group/team mapping 與治理 |
| 4 | Discovery & Read API | 提供 Workspace-aware 共用 query/read、keyword search 與 filter |
| 5 | Human Authoring | 單篇上傳與 Web 編輯，維持 Workspace policy、Source ownership 與 Revision 規則 |
| 6 | tKMS Publishing | 建立獨立 Publishing Tree 與 tKMS mapping；Publishing scope 由 Phase 6 design 決定 |
| 7 | Agent & MCP Access | Agent 經 MCP 使用相同 Workspace policy、Knowledge 與 read services |
| 8 | Semantic & Hybrid Retrieval | 衍生索引、Workspace-aware semantic / hybrid retrieval |
| 9 | Agent Memory & Knowledge Relations | 獨立 Agent Memory、relations、context 與受治理的 promotion |

## 技術方向

| 層次 | 選擇 |
| --- | --- |
| Application | Next.js modular monolith、React、TypeScript |
| UI | Tailwind CSS、shadcn/ui，Base UI 方向 |
| Canonical database | MariaDB 10.11 |
| Modules | `identity`、`workspaces`、`knowledge`、`sources` |
| Identity | Local／Mock provider；固定 `{id, emp_id, name, org_code}`；公司環境後補 SSO adapter |
| Knowledge scope | Workspace + WorkspaceMembership；Source 必須屬於 Workspace |

Phase 0 canonical domain schema 包含十張表：原 Knowledge／Source core tables，加上 `workspaces` 與 `workspace_memberships`。Workspace Phase 0 schema保持最小，不強制 owner org、slug、完整 lifecycle 或 role model。

Web 與未來 MCP／其他 API 共用 application services。完整 Folder Sync 在 Phase 2；production governance 與 Workspace administration 在 Phase 3；搜尋、authoring、publishing、MCP、embedding 與 Agent Memory 各自在對應階段加入。

## Human Web 操作模型

```text
Workspace selector
  → Source selector
  → Folder / Document Tree
  → Document / Revision viewer
```

Phase 2 首次 Folder Import：

```text
Select Workspace
  → Select Folder
  → Source name
  → Preview
  → Confirm
  → Create Source + Apply
```

更新既有 Source 時由 Source 本身決定 Workspace；Sync 不得順便 transfer Source。Folder Source 仍是 source-managed/read-only；Hub-managed authoring（單篇 upload、Web create/edit）由 Phase 5 提供（PR #35）。

## Folder Import & Sync（Phase 2）

```text
Select Workspace/Source
  → Select Folder
  → Scan & Upload (staged batches)
  → Preview (immutable staged diff)
  → Confirm
  → Atomic Apply (single transaction, sync_version +1, one SyncRun)
```

- **Source folder is authority**：`SOURCE_MANAGED` 的 hierarchy、title 與內容唯讀，只能透過來源 folder 再次同步更新；Hub Preview 永遠不編輯來源內容，發現問題請回來源 folder 修正後重新產生 Preview。
- **Preview 是 immutable staging truth**：Confirm 只會套用該 snapshot persist 的 `FolderImportPlan`，Apply 不重新讀取本機 folder、不重新 parse、不重新猜 identity。
- **Warning 可 Apply，Blocker 不可 Apply**：例如 `TITLE_CONFLICT` 只警告；`INVALID_FRONTMATTER`、`PATH_COLLISION`、`IDENTITY_CONFLICT` 等 blocking diagnostics 會 disable Confirm。
- **Assets 只存 metadata/reference**：不存 binary bytes、無 revision/history；same path + changed hash 直接更新 current projection，rename 不做 hash 推測。
- **Version conflict 沒有 Force Apply**：Preview 的 `based_on_version` 若已落後，Apply 回 409 `SOURCE_VERSION_CONFLICT`，該 snapshot 轉 STALE，請重新選 folder 產生新的 Preview。
- **Resource limits**（`KM_IMPORT_*` 環境變數可覆寫，預設值見 `.env.example`）：

| 變數 | 預設 |
| --- | --- |
| `KM_IMPORT_MAX_MANIFEST_ENTRIES` | 20,000 |
| `KM_IMPORT_MAX_PATH_BYTES` | 2 KiB |
| `KM_IMPORT_MAX_MARKDOWN_FILE_BYTES` | 5 MiB |
| `KM_IMPORT_MAX_MARKDOWN_TOTAL_BYTES` | 256 MiB |
| `KM_IMPORT_MAX_METADATA_BYTES` | 256 KiB |
| `KM_IMPORT_MAX_UPLOAD_BATCH_FILES` / `KM_IMPORT_MAX_UPLOAD_BATCH_BYTES` | 20 / 10 MiB |
| `KM_IMPORT_MAX_BUILDING_PER_USER` / `KM_IMPORT_MAX_READY_PER_USER` | 3 / 10 |

- **Staging retention 與 cleanup**：BUILDING 2 小時、READY 自 finalize 起 30 分鐘、STALE/APPLIED 24 小時；過期 staging 只刪 snapshot/entries，不動 canonical Knowledge history：

```bash
npx tsx scripts/db/cleanup-import-snapshots.ts
```

## 文件與工作流程

```text
README.md
docs/superpowers/
├── roadmaps/      # Phase 目標與里程碑
├── specs/         # Current design specs + architecture history
├── plans/         # Current implementation plans + implementation history
└── verification/  # 實際執行後的 fresh evidence
```

**Current behavior 以對應 Phase canonical spec + implementation plan 為準。** Architecture history 用來保存決策演進，不作為需要套用在 canonical 文件上的 patch layer。
