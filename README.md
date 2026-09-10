# Knowledge Hub

讓各團隊將自己的 LLM Wiki／Markdown folder 整合為可供人與 Agent 共用的組織知識，並在後續階段由 HR／發布者重新編排、發布至 tKMS。

Knowledge Hub 採用自建 Knowledge Core，不綁定 Obsidian、特定 Wiki generator、Refine 或 Outline。專案目錄名稱為 `HCM-KM`。

## 目前狀態

更新日期：2026-09-10。

目前專案處於**設計與實作規劃階段**：Phase 0 設計規格、實作計畫，以及 Phase 0–9 路線圖已建立；程式實作尚未開始。

Repository 目前沒有 `package.json`、應用程式骨架、資料庫 migration 或可執行測試。實作計畫內的啟動／測試命令是後續要建立的介面，不代表現在已可執行。

## 文件入口

| 文件 | 用途 |
| --- | --- |
| [Phase 0–9 目標與路線圖](docs/superpowers/roadmaps/2026-09-10-knowledge-hub-phase-roadmap.md) | 了解各階段要達成什麼、交付範圍與里程碑 |
| [Phase 0 Foundation & Architecture Design](docs/superpowers/specs/2026-09-10-phase-0-foundation-architecture-design.md) | 已確認架構、領域模型、交易安全、驗收條件與 ADR |
| [Phase 0 Implementation Plan](docs/superpowers/plans/2026-09-10-phase-0-foundation-implementation.md) | 10 個實作任務、21 個行為驗收案例與執行依賴 |

閱讀順序建議：路線圖 → Phase 0 設計規格 → Phase 0 實作計畫。下一個執行起點是實作計畫的 **T01：建立 Next.js 與工具骨架**。

## 核心模型

```text
Organization (org_code)
  └── KnowledgeSource
        ├── SourceEntry → 來源與文件的穩定 mapping
        ├── KnowledgeAsset → metadata/reference
        └── Folder / Document Tree
              └── KnowledgeDocument → stable ID
                    └── KnowledgeRevision → immutable content
```

| 來源方式 | Ownership | Hub 內的更新規則 |
| --- | --- | --- |
| Folder Sync | `SOURCE_MANAGED` | Hierarchy、title 與內容唯讀；透過來源再次同步更新 |
| 單篇 File Upload | `HUB_MANAGED` | 匯入後由 Hub 管理，允許編輯並建立新 revision |
| Web Create | `HUB_MANAGED` | 由 Hub 建立、編輯並保留版本 |

每個 Source 只有一個 `org_code` owner，每份 Document 都屬於 Source。Tree 決定位置，Document ID 決定身分，Revision 保存 title／Markdown／knowledge metadata；移動或改檔名不建立內容版本，修改文章標題會建立版本。

Knowledge lifecycle 只有 `ACTIVE / ARCHIVED`，MVP 不 hard delete。同一來源 entry 重現時沿用原 Document ID。Assets 只存 metadata/reference，尚不提供 binary 儲存或附件服務。

## Phase 概覽

以下列出目標，不代表已實作；詳細範圍與完成結果請見[路線圖](docs/superpowers/roadmaps/2026-09-10-knowledge-hub-phase-roadmap.md)。

| Phase | 名稱 | 目標 |
| --- | --- | --- |
| 0 | Foundation & Architecture | 建立技術骨架、核心模型、identity contract、交易與測試基礎 |
| 1 | Knowledge Core & Tree | 完整保存與瀏覽有穩定 ID、版本及生命週期的知識 |
| 2 | Knowledge Source Import & Sync | 整個 folder 上傳，經 Preview → Confirm → Apply 安全同步 |
| 3 | Identity & Basic Governance | 落實最小 caller／org／access boundary，保留公司 SSO 接點 |
| 4 | Discovery & Read API | 提供共用查詢服務、keyword search 與條件篩選 |
| 5 | Human Authoring | 完成單篇上傳與 Web 編輯，維持來源 ownership 與 revision 規則 |
| 6 | tKMS Publishing | 以獨立 Publishing Tree 編排、映射並發布至 tKMS |
| 7 | Agent & MCP Access | 讓 Agent 經 MCP 使用相同 Knowledge 與存取規則 |
| 8 | Semantic & Hybrid Retrieval | 在 canonical Knowledge 之外加入衍生索引與語意／混合搜尋 |
| 9 | Agent Memory & Knowledge Relations | 建立獨立 Agent Memory、關聯、context 與受治理的知識提升流程 |

## 技術方向

以下是已選定的 Phase 0 基線，尚未安裝或實作。

| 層次 | 選擇 |
| --- | --- |
| Application | Next.js modular monolith、React、TypeScript |
| UI | Tailwind CSS、shadcn/ui，Base UI 方向 |
| Canonical database | MariaDB 10.11 |
| Modules | `identity`、`knowledge`、`sources` |
| Identity | Local／Mock provider；固定 `{id, emp_id, name, org_code}`；公司環境後補 SSO adapter |

實作計畫另選用 npm、MariaDB 官方 Node.js connector、明確 SQL migrations、Vitest 與 Playwright。實際套件版本由 T01 解析並鎖定。

Web 與未來 MCP／其他 API 共用 application services。Knowledge Core 不依賴頁面元件、來源 scanner 或外部系統。完整 Folder Sync 在 Phase 2；富文字編輯器、發布、MCP、embedding 與 Agent Memory 各自在對應階段加入。

## 文件與工作流程

主要專案資料夾為 `/Users/chuntsai/Projects/HCM-KM/`。文件依類型存放：

```text
README.md
docs/superpowers/
├── roadmaps/      # 各 Phase 目標與里程碑
├── specs/         # 各 Phase 已確認的設計規格
└── plans/         # 各 Phase 實作任務與驗證方式
```

實際執行驗收後，將結果放入 `docs/superpowers/verification/`；目前尚無驗收紀錄。各 Phase 的詳細 spec／plan 依進度產出，不以路線圖取代完整設計。

設計決策以對應 Phase 的確認規格為準；implementation plan 說明如何落地，roadmap 說明階段目標，README 提供入口。若修改目標或實作狀態，應同步更新相關文件；舊 HRKM 的 Refine CMS 依賴清單不作為新版基線。

程式實作完成並通過驗收後，再補上實際可執行的環境設定、啟動命令與測試結果。
