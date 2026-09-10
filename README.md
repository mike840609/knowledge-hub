# Knowledge Hub

讓各團隊將自己的 LLM Wiki／Markdown folder 整合為可供人與 Agent 共用的公司知識，並在後續階段由 HR／發布者重新編排、發布至 tKMS。

Knowledge Hub 採用自建 Knowledge Core，不綁定 Obsidian、特定 Wiki generator、Refine 或 Outline。專案目錄名稱為 `HCM-KM`。

## 目前狀態

更新日期：2026-09-10。

目前專案處於**設計與實作規劃階段**：Phase 0／1 design、implementation plan 與 Phase 0–9 roadmap 已建立；程式實作依階段進行。

2026-09-10 的 architecture review 已修正 Knowledge 的上層 access boundary：`org_code` 保留為使用者公司組織屬性，但 **Workspace 才是 Knowledge container 與基本存取邊界**。不同 org 的使用者可以透過 WorkspaceMembership 共用同一 Workspace；同 org 也不代表自動取得 Workspace 內容。

Repository 的實際 application／migration／test 狀態應以目前 branch 與 verification 文件為準；spec／plan 中的啟動或測試命令是實作契約，不代表文件產出時已執行成功。

## 文件入口

| 文件 | 用途 |
| --- | --- |
| [Phase 0–9 目標與路線圖](docs/superpowers/roadmaps/2026-09-10-knowledge-hub-phase-roadmap.md) | 了解各階段目標、交付範圍與里程碑 |
| [Workspace Access Boundary Amendment](docs/superpowers/specs/2026-09-10-workspace-access-boundary-amendment.md) | **目前 tenancy / access boundary 的 authoritative correction**；定義 Organization、Workspace、Membership 與 Source 的關係 |
| [Workspace Foundation Implementation Amendment](docs/superpowers/plans/2026-09-10-workspace-foundation-implementation-amendment.md) | Phase 0／1 plan 需要增加或替換的 Workspace schema、fixture、query 與 UI 工作 |
| [Phase 0 Foundation & Architecture Design](docs/superpowers/specs/2026-09-10-phase-0-foundation-architecture-design.md) | Foundation、Knowledge/Sources schema、transaction safety、驗收條件與 ADR；access-boundary 衝突處以 Workspace Amendment 為準 |
| [Phase 0 Implementation Plan](docs/superpowers/plans/2026-09-10-phase-0-foundation-implementation.md) | Phase 0 詳細實作任務與行為驗收；Workspace 相關修正搭配 implementation amendment 閱讀 |
| [Phase 1 Knowledge Core & Tree Design](docs/superpowers/specs/2026-09-10-phase-1-knowledge-core-tree-design.md) | Knowledge identity、Revision、Tree、SourceEntry、lifecycle 與 mutation authority |
| [Phase 1 Implementation Plan](docs/superpowers/plans/2026-09-10-phase-1-knowledge-core-tree-implementation.md) | Phase 1 詳細工作、測試與 read-only browser；繼承 Workspace foundation |

閱讀順序建議：

```text
README
  → Phase Roadmap
  → Workspace Access Boundary Amendment
  → Phase 0 Design / Plan
  → Workspace Implementation Amendment
  → Phase 1 Design / Plan
```

若舊 Phase 0／1 文件中的 `org_code → KnowledgeSource`、單一 org owner、八張 Phase 0 domain tables 或 Source-only browser 描述與 Workspace Amendment 衝突，**以 Workspace Amendment 為準**；其他不衝突的詳細設計仍然有效。

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
      Workspace                  ← Knowledge + basic access boundary
          │
          └── KnowledgeSource    ← Source remains the Tree root
                ├── SourceEntry → 來源與文件／Tree 的穩定 mapping
                ├── KnowledgeAsset → metadata/reference
                └── Folder / Document Tree
                      └── KnowledgeDocument → stable ID
                            └── KnowledgeRevision → immutable content
```

### Organization 與 Workspace

`org_code` 回答「這個使用者目前屬於哪個公司組織」；Workspace 回答「這個使用者可以進入哪些知識空間」。兩者不能互相取代。

例如：

```text
Workspace: Query Master
owner_org_code: HRSD

Members:
Mike    HRSD
Alice   RD
Bob     IT
```

跨 org membership 合法；`owner_org_code` 只保存主要治理組織 metadata，不是 ACL substitute。

每個 KnowledgeSource 必須且只屬於一個 Workspace；每份 Document 必須且只屬於一個 Source。Document 不額外重複保存 `workspace_id`，而是透過 `Document → Source → Workspace` 取得 scope。

### Source ownership

| 來源方式 | Ownership | Hub 內的更新規則 |
| --- | --- | --- |
| Folder Sync | `SOURCE_MANAGED` | Hierarchy、title 與內容唯讀；透過來源再次同步更新 |
| 單篇 File Upload | `HUB_MANAGED` | 匯入後由 Hub 管理，允許編輯並建立新 revision |
| Web Create | `HUB_MANAGED` | 由 Hub 建立、編輯並保留版本 |

Workspace access 與 Source ownership 是兩個不同維度：前者決定 caller 是否能進入該 knowledge scope，後者決定內容更新權由外部來源還是 Hub 控制。

Tree 決定位置，Document ID 決定身分，Revision 保存 title／Markdown／knowledge metadata；移動或改檔名不建立內容版本，修改文章標題會建立版本。

Knowledge lifecycle 只有 `ACTIVE / ARCHIVED`，MVP 不 hard delete。同一來源 entry 重現時沿用原 Document ID。Assets 只存 metadata/reference，尚不提供 binary 儲存或附件服務。

## Access Boundary

Phase 0–2 的最小安全路徑：

```text
CallerContext
  → resolve resource Workspace
  → require WorkspaceMembership
  → apply Source ownership / lifecycle rules
  → Knowledge operation
```

重要規則：

- `User.org_code == Workspace.owner_org_code` **不代表自動授權**。
- `User.org_code != Workspace.owner_org_code` **不代表自動拒絕**。
- 知道 `workspace_id`、`source_id` 或 `document_id` 不代表有權存取。
- UI selector 不是 authorization；application service 必須重新驗證 membership／policy。
- Phase 3 在這個 foundation 上加入 role、Team／SSO Group mapping、必要的 granular policy 與 audit；不重新改回 org-based ACL。

## Phase 概覽

以下列出目標，不代表已實作；詳細範圍與完成結果請見[路線圖](docs/superpowers/roadmaps/2026-09-10-knowledge-hub-phase-roadmap.md)。

| Phase | 名稱 | 目標 |
| --- | --- | --- |
| 0 | Foundation & Architecture | 建立技術骨架、Workspace access foundation、核心模型、identity contract、交易與測試基礎 |
| 1 | Knowledge Core & Tree | 完整保存與瀏覽有穩定 ID、版本及生命週期的知識；Workspace → Source → Tree |
| 2 | Knowledge Source Import & Sync | 在選定 Workspace 建立／更新 Source，整個 folder 經 Preview → Confirm → Apply 安全同步 |
| 3 | Identity & Basic Governance | 在 WorkspaceMembership foundation 上加入角色、企業 group/team mapping 與必要治理 |
| 4 | Discovery & Read API | 提供 Workspace-scoped 共用查詢服務、keyword search 與條件篩選 |
| 5 | Human Authoring | 完成單篇上傳與 Web 編輯，維持 Workspace access、Source ownership 與 revision 規則 |
| 6 | tKMS Publishing | 以 Workspace-scoped 獨立 Publishing Tree 編排、映射並發布至 tKMS |
| 7 | Agent & MCP Access | 讓 Agent 經 MCP 使用相同 Workspace policy、Knowledge 與 read services |
| 8 | Semantic & Hybrid Retrieval | 在 canonical Knowledge 之外加入衍生索引與 Workspace-aware 語意／混合搜尋 |
| 9 | Agent Memory & Knowledge Relations | 建立獨立 Agent Memory、關聯、context 與受治理的知識提升流程 |

## 技術方向

以下是已選定的 Phase 0 基線；實際落地狀態由 implementation / verification 文件確認。

| 層次 | 選擇 |
| --- | --- |
| Application | Next.js modular monolith、React、TypeScript |
| UI | Tailwind CSS、shadcn/ui，Base UI 方向 |
| Canonical database | MariaDB 10.11 |
| Modules | `identity`、`workspaces`、`knowledge`、`sources` |
| Identity | Local／Mock provider；固定 `{id, emp_id, name, org_code}`；公司環境後補 SSO adapter |
| Knowledge scope | Workspace + WorkspaceMembership；Source 必須屬於 Workspace |

Phase 0 canonical domain schema 現在包含十張表：原八張 Knowledge／Source tables，加上 `workspaces` 與 `workspace_memberships`。所有 internal entity IDs 依既有契約採 application-generated UUIDv7 + MariaDB native UUID。

Web 與未來 MCP／其他 API 共用 application services。Knowledge Core 不依賴頁面元件、來源 scanner 或外部系統。完整 Folder Sync 在 Phase 2；完整 governance 在 Phase 3；搜尋、富文字編輯器、發布、MCP、embedding 與 Agent Memory 各自在對應階段加入。

## 前端操作模型

Human Web 採 Workspace-first shell，但 Source 仍是 Tree root：

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

更新既有 Source 時由 Source 本身決定 Workspace；同步流程不能順便把 Source 移到另一個 Workspace。Folder Source 仍是 source-managed/read-only；Phase 5 才提供完整 Hub-managed authoring。

## 文件與工作流程

主要專案資料夾為 `/Users/chuntsai/Projects/HCM-KM/`。文件依類型存放：

```text
README.md
docs/superpowers/
├── roadmaps/      # 各 Phase 目標與里程碑
├── specs/         # 各 Phase 已確認的設計規格與 architecture amendments
├── plans/         # 各 Phase 實作任務、implementation amendments 與驗證方式
└── verification/  # 實際執行後的驗收證據
```

設計決策以對應 Phase 的確認規格與後續 normative amendment 為準；implementation plan 說明如何落地，roadmap 說明階段目標，README 提供入口。若 amendment 明確列出 superseded clauses，不應再以舊 clause 作為實作依據。

程式實作完成並通過驗收後，再更新 verification 與 README 的實際可執行環境設定、啟動命令與測試結果。