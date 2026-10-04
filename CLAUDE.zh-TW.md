# CLAUDE.md

[English](CLAUDE.md) | **繁體中文**

本文件提供 Claude Code（claude.ai/code）在此 repository 工作時應遵循的指引。

## 指令

`make help` 列出所有指令。主要指令如下：

```bash
make bootstrap        # 首次使用：安裝、啟動 MariaDB、遷移、建立種子資料
make dev              # 開發伺服器：http://127.0.0.1:3000/knowledge
make verify           # 與不依賴資料庫的 CI 閘門相同：單元測試、型別、lint、建置
```

測試分為三層，所需環境不同：

```bash
make test-unit        # 不需要資料庫
make test-integration # 需要 MariaDB（make db-up）
make test-e2e         # 建立隔離資料庫、建置並執行 Playwright
make browsers         # 首次 E2E 前執行一次
```

執行單一單元測試檔案或案例：

```bash
npx vitest run --config vitest.config.ts tests/unit/<file>.test.ts
npx vitest run --config vitest.config.ts -t "<test name>"
```

`node_modules/next` 內附的 React 有一個 patch（`patches/next+15.5.25.patch`，由 `postinstall` 套用）。若導覽出現「載入完成但畫面一直沒有顯示」，可能是未套用 patch。調整 patch 或 Next 版本前，先閱讀 README 的 patch 說明；變更後清除 `.next/cache`。

CI（`.github/workflows/phase2-dev-gate.yml`）對每個送往 `main` 的 PR 執行四個 job：`unit`（包含型別檢查與 lint）、`build`、`integration`、`e2e`。`make verify` 涵蓋前兩者，不包含需要資料庫的兩個 job。

## 架構

本專案是使用 MariaDB 的 Next.js 模組化單體。分層讓 Web 應用成為多種呼叫端之一；後續階段的 MCP 與其他 API 會共用相同 application services。

```text
src/modules/<module>/     domain/  — 實體、規則、錯誤；不進行 I/O
                          ports/   — application 層需要的介面
                          application/ — use cases、協調、授權
src/infrastructure/       實作 ports 的 MariaDB adapters
src/server/               composition root 與供 Next 使用的讀取投影
src/app/                  routes 與 API handlers
src/components/           UI（參見下方設計語言契約）
```

四個模組為 `identity`、`workspaces`、`knowledge`、`sources`。

這些邊界由 `eslint.config.mjs` 的 `no-restricted-imports` 強制執行；違反時 `make lint` 會失敗：

- `src/modules/**` 不得匯入 `next`、`react`、`mariadb` 或 `infrastructure/` 下的內容。模組依賴 ports。
- `src/modules/knowledge/**` 也不得匯入 `@/modules/sources/**`。Knowledge 只能透過 `source-policy` port 存取 Sources。
- `src/components/**` 與 `src/app/**` 不得匯入 `infrastructure/` 或 `mariadb`。Web adapters 透過 composition root 呼叫 application services。

`src/server/composition.ts` 是唯一將 adapters 接到 services 的組裝點。連線池保存在 `globalThis`，因為 `next dev` 每次 HMR 都重新評估 server modules；若只用模組層 singleton，每次 reload 都會洩漏一個 pool，直到 MariaDB 連線耗盡。

### 容易違反的不變條件

下列是契約。即使測試通過，違反仍屬缺陷。

- **Scope 必須推導，不能重複儲存。** 每個 `KnowledgeSource` 屬於一個 workspace，每個文件屬於一個 source。文件不儲存 `workspace_id`；scope 來自 `Document → Source → Workspace`。
- **知道 ID 不代表獲得授權。** 持有 `workspace_id`、`source_id`、`document_id` 不授予權限。URL 參數是導覽輸入，不是授權證明。application service 必須重新檢查政策；UI selector 不是存取檢查。
  唯一 bearer grant 是**文件分享連結**（`docs/superpowers/specs/2026-09-23-document-share-link-design.md`）：由文件擁有者明確建立、不可猜測（隨機 UUIDv4，不能從 entity ID 推導）、會到期且可撤銷的 token。它不需登入，只有 `/s/:token` 經 `DocumentShareService.readShared` 接受，可讀一份文件的目前 revision，不授予搜尋、樹、歷史、MCP 或寫入權限。其他路徑不得在沒有 caller 時提供文件內容；`tests/unit/share-link-single-exception.test.ts` 強制檢查此規則。
- **`org_code` 不決定存取權。** 它描述使用者屬於哪個公司組織；workspace membership 決定能開啟什麼。跨組織 membership 合法，同組織不會自動取得 membership。
- **Source ownership 決定寫入者。** `SOURCE_MANAGED`（folder sync）內容在 Hub 唯讀，透過重新同步更新；`HUB_MANAGED`（上傳、Web 建立）可編輯。Workspace 存取與 source ownership 是兩個不同問題。
- **身分、位置與內容分離。** Tree 決定位置，document ID 決定身分，revision 儲存標題、Markdown、metadata。移動或重新命名檔案不建立 revision；編輯文章標題會建立。
- **Lifecycle 只有 `ACTIVE` / `ARCHIVED`。** 沒有 hard delete。
- **Link index 是衍生資料，不決定存取。** `knowledge_link_index` 與 `knowledge_document_links` 記錄文件目前 revision 寫出的 `[[wikilinks]]` 與相對 `.md` links；目標在讀取時，於同一 Workspace 內依當前文件解析（`docs/superpowers/specs/2026-09-29-personal-workspace-knowledge-graph-design.md`）。任何插入 revision 的路徑都必須在同一 transaction 以 `repositories.links.replaceForDocument` 更新 edges；`tests/unit/link-index-write-points.test.ts` 檢查此規則。Link 不跨 Workspace 解析，分享頁 `/s/:token` 不取得任何 resolutions。
- **Rendered editor 必須原樣寫回 wikilink。** `[[x]]` 必須保留為 `wiki_link` node；若當成普通文字，會被寫成 `\[\[x]]` 而失去連結與 edges（`docs/superpowers/specs/2026-09-29-personal-daily-driver-design.md` §1.1、§4）。任何 editor、composer 或 Markdown 輸出變更，都需要執行 rendered editor 並讀取儲存後連結的測試；僅從 Markdown source view 輸入無法驗證此行為（`tests/unit/editor-wikilinks.test.ts`、`tests/e2e/zz-wikilinks-composer.spec.ts`，皆使用 `tests/fixtures/link-markdown.ts` 的 extractor cases）。`[[` 建議清單也經由相同 node 寫入並遵循此規則（`tests/unit/wikilink-suggest.test.ts`、`tests/e2e/zz-composer-autocomplete.spec.ts`）。

## 前端設計語言

`docs/superpowers/specs/frontend-design-language.md` 是持續更新、沒有日期的契約。修改 `src/components` 或 `src/app` 前必須閱讀。

`tailwind.config.ts` **取代** `fontSize`、`borderRadius`、`boxShadow`、`transitionDuration`、`transitionTimingFunction` scales，而非擴充預設值。因此 `text-sm`、`text-xs`、`rounded`、`rounded-xl`、`shadow-sm`、`duration-150` 不會產生樣式。使用契約定義的 token，例如 `text-body`、`rounded-md`、`shadow-popover`。新增 token 時須同時更新契約與 config。

所有顏色由 `src/app/globals.css` 的 CSS variables 定義，支援明暗主題。Component 不得在此層之外宣告顏色。

## 文件流程

```text
docs/superpowers/
├── roadmaps/      階段目標與里程碑
├── specs/         設計規格與架構歷史
├── plans/         實作計畫
└── verification/  實際執行的驗證證據
```

目前行為由 README「Current canonical documents」表列出的 canonical phase spec 與 implementation plan 定義。標記為 *architecture history* 的文件說明決策為何改變，不能當成疊加在 canonical docs 上的 patch。現在要做什麼，閱讀 canonical spec；歷史文件用於理解原因。

前端設計語言刻意不加日期，因為視覺契約適用所有階段。當某項契約超出原階段範圍，應提升為獨立文件並標記原文件已被取代，避免兩份同時生效。

重大設計變更先寫 spec 再寫程式；偏離既有 canonical spec 時必須記錄，不能默默變更。過去這兩個方向都曾因未察覺的 drift 而違反。
