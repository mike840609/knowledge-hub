# Knowledge Hub — Phase 0–9 目標與路線圖

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-10 |
| 文件定位 | 各階段目標、主要交付、完成後能力與範圍邊界 |
| 決策依據 | 原 KM 規劃與 current Phase 0／1 canonical design；Workspace architecture history 僅保存決策演進 |
| 目前狀態 | Phase 0–2 design／implementation 已完成（Phase 0/1 由 verification evidence 證實，Phase 2 verification 文件尚未補上）；Phase 3–9 仍依各自 canonical 文件接續 |
| 專案入口 | [README](../../../README.md) |

本 roadmap 只整理已確認的階段方向；future phase 的技術選型仍需該 Phase 自己的 design spec。Phase 0 的程式驗收以 verification record 為準，其餘 Phase 文件產出不等於程式實作或驗收完成。

2026-09-10 architecture review 修正 foundation：**Organization 不再是 Knowledge access boundary；Workspace 才是 Knowledge container 與基本 access scope。** `User.org_code` 保留作 identity attribute；跨 org access 由 Workspace policy / membership 決定。此修正已直接寫入 Phase 0/1 canonical spec/plan，不需要再套用 amendment 才能得到 current truth。

## 1. 共同架構原則

- `Workspace → KnowledgeSource → Folder / Document Tree`；每個 Source 必須且只屬一個 Workspace，每份 Document 必須且只屬一個 Source。
- `User.org_code` 是公司 identity / organization attribute，不直接授權 Knowledge：same org 不自動 allow，cross org 不自動 deny。
- WorkspaceMembership 是 Phase 0 的基本 access foundation；Phase 0 不要求 Workspace 綁定單一 owning organization。
- Phase 0–2 是 local/mock membership governance MVP；**公司 production multi-user governance 以 Phase 3 完成為 deployment gate**。
- Phase 3 明確負責 Workspace provisioning/create、rename、archive/restore、membership administration、roles/capabilities、Team／SSO Group mapping、必要 granular policy/audit 與 Company SSO adapter。
- Workspace MVP 不 hard delete；若未來需要永久刪除，另行設計 retention/reference/audit semantics。
- Source 本身仍是其 Tree root；Workspace 不是 synthetic Tree folder。
- Source、Tree、Document、Revision 各自有清楚責任；stable Document ID 不依賴 path、title、Workspace 或外部系統 ID。
- Hub internal stable entity IDs 使用 application-generated UUIDv7；MariaDB 10.11 使用 native `UUID` storage。WorkspaceMembership 使用 `(workspace_id, user_id)` association key。
- `title / markdown / knowledge metadata` 版本化，Revision immutable；hierarchy move／filename rename 不產生內容版本；SOURCE_MANAGED title resolution 由 Phase 2 定義。
- Folder Sync 為 SOURCE_MANAGED 且 Hub 唯讀；單篇匯入與 Web 建立為 HUB_MANAGED。
- Knowledge lifecycle 僅 ACTIVE／ARCHIVED；不 hard delete；同一 entry 重現沿用原 Document ID。
- Public application read/write services 顯式接收可信 `CallerContext`；resource operation 必須解析 Source → Workspace 並執行 policy，不能相信 UI 傳入的 org/workspace。
- Canonical Knowledge/Sources mutation 使用 READ COMMITTED transaction，保留必要的 Source/Document row locks。
- Folder Upload 直接選整個 folder，不使用 ZIP；Preview → Confirm → transactional Apply。
- Assets MVP 只存 metadata/reference，不承諾 binary storage/serving。
- 身分 contract 固定 `{id, emp_id, name, org_code}`；local/mock provider 支援開發，公司 SSO 以 adapter 接入。
- MariaDB 保存 canonical Knowledge；搜尋索引是 derived data，不能成為 authorization truth。
- Human Web 與 Agent 共用 application services；MCP 是接入層，Agent Memory 是獨立 domain。Phase 0–2 不提前建立 Agent Principal model。

## 2. 階段總覽

| Phase | 名稱 | 核心目標 |
| --- | --- | --- |
| 0 | Foundation & Architecture | 建立技術骨架、Workspace access foundation、canonical schema、identity 與 transaction 基礎 |
| 1 | Knowledge Core & Tree | 完整 Knowledge identity、Revision、lifecycle、Tree 與 Workspace-scoped browser |
| 2 | Knowledge Source Import & Sync | 在 Workspace 內安全匯入／更新 Markdown folder Source |
| 3 | Identity, Workspace Administration & Governance | 完成 Workspace lifecycle/admin、production role/capability、membership 與 enterprise mapping |
| 4 | Discovery & Read API | 人與 Agent 共用的 Workspace-aware query/read/keyword discovery |
| 5 | Human Authoring | Hub-managed upload/create/edit 與 conflict handling |
| 6 | tKMS Publishing | 獨立 Publishing Tree、mapping、preview/diff 與外部發布 |
| 7 | Agent & MCP Access | Agent 依相同 Workspace policy 安全讀取 Knowledge |
| 8 | Semantic & Hybrid Retrieval | Workspace-aware semantic / hybrid retrieval |
| 9 | Agent Memory & Knowledge Relations | 獨立且受治理的長期 memory、relations、context 與 promotion |

交付順序維持 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9。

## 3. Phase Details

### Phase 0 — Foundation & Architecture

**目標：** 建立後續工作可沿用的 modular monolith、Workspace access foundation、核心 schema、identity 與 transaction boundary。

主要交付：

- Next.js、React、TypeScript、Tailwind、shadcn/ui、MariaDB 10.11。
- `identity`、`workspaces`、`knowledge`、`sources` 四個 business modules。
- 十張 domain tables：`users`、`workspaces`、`workspace_memberships`、`knowledge_sources`、`source_entries`、`knowledge_tree_nodes`、`knowledge_documents`、`knowledge_revisions`、`knowledge_assets`、`sync_runs`。
- `knowledge_sources.workspace_id` 作 Source authoritative Workspace scope；`org_code` 不作 Source authorization ownership。
- Workspace Phase 0 schema保持最小：不強制 owner org、slug、roles 或完整 lifecycle。
- UUIDv7/native UUID、CallerContext、READ COMMITTED UoW、Source/Document locks、sync_version guard。
- one-document-one-TreeNode、ACTIVE/ARCHIVED provenance。
- Cross-org member allow、same-org non-member deny、direct resource ID cannot bypass membership 的 integration evidence。

**完成後：** local/mock user 可列出自己的 Workspace，在 Workspace 中透過 Source Tree 建立／讀取基本 Hub-managed Knowledge。

**範圍外：** Workspace administration、production roles、membership UI、Team/SSO Group mapping、Company SSO、完整 Folder Sync、rich authoring、publishing、MCP、semantic retrieval、Agent principal。

詳細：[Phase 0 Design](../specs/2026-09-10-phase-0-foundation-architecture-design.md)、[Phase 0 Plan](../plans/2026-09-10-phase-0-foundation-implementation.md)。

### Phase 1 — Knowledge Core & Tree

**目標：** 完整保存 stable identity + immutable content history，提供可靠的 Workspace → Source → Tree 瀏覽與 lifecycle operations。

主要交付：

- KnowledgeSource、Document、Revision、TreeNode、SourceEntry core behavior。
- SourceEntry → TreeNode stable mapping。
- stable Document UUIDv7、current revision resolution、Revision history。
- Archive/restore、archived filtering、hierarchy/content separation。
- HUB_MANAGED 與 SOURCE_MANAGED mutation authority separation。
- Workspace membership foundation 在 read/write path 一致套用。
- READ COMMITTED concurrency protection。
- read-only browser：`Workspace selector → Source selector → Tree → Document / Revision`。

**範圍外：** Workspace administration、Folder ingestion、Title Resolution、authoring UI、search、production ACL、publishing、MCP。

詳細：[Phase 1 Design](../specs/2026-09-10-phase-1-knowledge-core-tree-design.md)、[Phase 1 Plan](../plans/2026-09-10-phase-1-knowledge-core-tree-implementation.md)。

### Phase 2 — Knowledge Source Import & Sync

**目標：** 讓團隊把 generic Markdown folder 安全匯入／更新到可存取 Workspace 的 KnowledgeSource。

主要交付：

- 首次 import：Select Workspace → Select Folder → Scan/Parse → Preview → Confirm → Create Source + Apply。
- Generic folder adapter、snapshot、SourceEntry mapping、diff。
- Title Resolution：frontmatter／Markdown heading／filename 的優先序、fallback、conflict rules。
- 新 Source 明確指定 `workspace_id`；folder name 只是可修改 default source name。
- 更新既有 Source 只指定 `source_id`；Workspace 由 Source relationship 決定，sync 不允許 Source transfer。
- Preview 顯示 Added/Updated/Moved/Renamed/Archived/Restored/Unchanged。
- snapshot binding/expiry、sync_version、transactional Apply、full rollback、SyncRun history。
- missing entry archive、reappearance restore same ID、unchanged no new Revision。

**範圍外：** Workspace creation/admin、雙向 sync、Markdown merge、partial success、binary storage、arbitrary Knowledge location、Source transfer。

Phase 2 仍是 local/mock governance MVP；company production multi-user write authorization 在 Phase 3 完成。

### Phase 3 — Identity, Workspace Administration & Basic Governance

**目標：** 把 Phase 0 WorkspaceMembership foundation 升級成可用於公司正式多使用者環境的 Workspace lifecycle 與 production governance。

主要交付：

- **Workspace provisioning / create**：定義誰可以建立 Workspace、建立時的初始管理者／membership 與必要 audit。
- **Workspace rename**：name 可變但 Workspace stable ID 不變；rename 不影響 Source/Document identity。
- **Workspace archive / restore**：定義 archived Workspace 的 visibility/access/mutation semantics；MVP 不 hard delete Workspace。
- Workspace administration UI / application services。
- Workspace roles / capabilities。
- Membership administration/lifecycle。
- Company Team mapping。
- SSO Group → Workspace mapping。
- Optional Source-level override。
- Document-level ACL 僅在 Workspace/Source policy 無法滿足真實需求時加入。
- Audit events / lifecycle history。
- 若有治理需求，再加入 accountable owner/team/org metadata；該 metadata 不得成為 authorization shortcut。
- Company SSO adapter 映射到既有 UserIdentity。

**Hard rules：** same org != allow；cross org != deny；Workspace ID/name/owner metadata != authorization proof。

**Phase 3 完成條件之一：** 公司正式 multi-user read/write rollout 不再依賴 Phase 0–2 的 binary membership mock semantics，而是由 production roles/capabilities 與 enterprise identity mapping 控制。

Agent/service principal membership 不在此階段提前定案；Phase 7 根據真實 Agent identity 決定 delegation 或 generalized Principal。

### Phase 4 — Discovery & Read API

**目標：** 建立人與 Agent 可共用的 Workspace-aware read/query boundary。

主要交付：

- Workspace/Source/Tree/Document/Revision query services。
- Keyword/metadata search 與 filters。
- Search 可跨 caller-authorized Workspaces，也可 filter 單一 Workspace。
- Candidate retrieval 不得洩漏 unauthorized title/snippet。
- Search backend 在本 Phase design 評估 MariaDB native capability 或 independent search engine；roadmap 不預先決定。

Embedding/vector/semantic-hybrid 原則上仍屬 Phase 8；若要提前需另立 ADR。

### Phase 5 — Human Authoring

**目標：** 讓使用者直接維護 HUB_MANAGED Knowledge。

主要交付：

- 單篇 Markdown upload、Web create/edit。
- title/Markdown/metadata 變更建立 immutable Revision。
- stale-editor conflict handling。
- 先通過 Workspace capability，再驗證 HUB_MANAGED ownership。
- SOURCE_MANAGED 維持 read-only application guard。

**範圍外：** 自動覆蓋 folder source、ownership conversion、雙向 sync。

### Phase 6 — tKMS Publishing

**目標：** 讓 HR／Publisher 用不同於 Knowledge Tree 的結構編排並發布至 tKMS。

主要交付：

- Independent Publishing Tree referencing stable Document/Revision。
- tKMS Space/Page mapping。
- publishing preview/diff、publish/sync、result history、retry。
- local DB transaction 與外部 side effect 分離。
- 每個被引用的 Knowledge resource 必須經 Workspace policy 驗證。

**重要未定項：** Publishing Tree 自身 scope 不在 foundation 提前綁死成單一 Workspace。Phase 6 design 再決定 single-Workspace publishing、independent Publishing Space，或允許 publisher 聚合多個有權存取 Workspace 的 Knowledge。

Knowledge Tree != Publishing Tree；tKMS 不決定 canonical identity。

### Phase 7 — Agent & MCP Access

**目標：** Agent 透過 MCP reuse 相同 Knowledge/query/policy boundary。

主要交付：

- MCP adapter/server。
- trusted Agent identity / caller mapping。
- search/get Knowledge 最小能力。
- Workspace policy、revision resolution、archived filtering reuse。

本 Phase 再決定 Agent 是 delegate human identity，或把 membership generalize 成 Principal。MCP 不接受任意 `org_code` / `workspace_id` 作 authorization proof。

### Phase 8 — Semantic & Hybrid Retrieval

**目標：** 在 Phase 4 discovery 上增加 semantic / hybrid retrieval。

主要交付：

- revision chunking/embedding/derived index。
- Workspace-aware candidate filtering/ranking。
- async index update/rebuild consistency。
- retrieval backend selection。

MariaDB Knowledge + Workspace governance 仍是 canonical truth；derived index 不單獨決定 authorization。

### Phase 9 — Agent Memory & Knowledge Relations

**目標：** 在 canonical Knowledge 之外建立 governed Agent Memory。

主要交付：

- independent Memory Store。
- Knowledge relations / Context Bundles / consolidation。
- Memory → Knowledge promotion + human governance。
- stable Document/Revision references。
- explicit memory scope design。

Knowledge 使用 Workspace 不代表 Agent Memory 自動 workspace-global。

## 4. Milestones

| Milestone | Phase | Demo |
| --- | --- | --- |
| M1 — Source Knowledge Flow | 0–2 | Workspace → Markdown Folder → Preview/Confirm → Source → Tree/Document；local/mock governance |
| M2 — Human Knowledge Work | 3–5 | Workspace administration + production governance → Discovery → Upload/Web Authoring |
| M3 — Publishing | 6 | Independent Publishing Tree → tKMS |
| M4 — Agent Knowledge & Memory | 7–9 | MCP → Hybrid Retrieval → Governed Agent Memory |

M1 是 functional MVP，**不代表公司正式 multi-user governance 已完成**。Phase 3 是 production governance deployment gate。

## 5. 文件狀態

| 範圍 | Design | Plan | Implementation / Verification |
| --- | --- | --- | --- |
| Phase 0 | [current canonical](../specs/2026-09-10-phase-0-foundation-architecture-design.md) | [current canonical](../plans/2026-09-10-phase-0-foundation-implementation.md) | 已完成；結果見 [verification](../verification/2026-09-10-phase-0-foundation-verification.md) |
| Phase 1 | [current canonical](../specs/2026-09-10-phase-1-knowledge-core-tree-design.md) | [current canonical](../plans/2026-09-10-phase-1-knowledge-core-tree-implementation.md) | 已完成；結果見 [verification](../verification/2026-09-11-phase-1-knowledge-core-tree-verification.md) |
| Workspace architecture change | [history record](../specs/2026-09-10-workspace-access-boundary-amendment.md) | [history record](../plans/2026-09-10-workspace-foundation-implementation-amendment.md) | 已整合到 Phase 0/1 canonical docs |
| Phase 2 | [current canonical](../specs/2026-09-12-phase-2-knowledge-source-import-sync-design.md) | [current canonical](../plans/2026-09-12-phase-2-knowledge-source-import-sync.md) | 已完成（PR #7）；verification 文件尚未補上 |
| Phase 3–9 | roadmap only | 尚未逐 Phase 完成 | 尚未完成 |

各 Phase 詳細 design 存 `docs/superpowers/specs/`，implementation plan 存 `docs/superpowers/plans/`，實際測試與驗收證據存 `docs/superpowers/verification/`。

更新 roadmap 時需同步檢查 canonical spec/plan，避免兩套不同的 Workspace access、Source ownership、lifecycle、phase scope 或技術基線。History records 保存決策演進，不作為 current implementation patch layer。
