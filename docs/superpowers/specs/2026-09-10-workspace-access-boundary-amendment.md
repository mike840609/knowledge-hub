# Knowledge Hub — Workspace Access Boundary Architecture History

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-10 |
| 文件類型 | Architecture history / decision record |
| 狀態 | **Historical record — not an active overlay** |
| Current truth | [Phase 0 Design](2026-09-10-phase-0-foundation-architecture-design.md)、[Phase 1 Design](2026-09-10-phase-1-knowledge-core-tree-design.md)、[Roadmap](../roadmaps/2026-09-10-knowledge-hub-phase-roadmap.md) |

> **重要：** Workspace correction 已直接整合到 Phase 0/1 canonical spec/plan。實作者與 Agent 不應把本文件當成要疊加到 current spec 上的 patch，也不應以本文件覆蓋 canonical documents。本文件只回答「為什麼從 org-scoped model 改成 Workspace model」。

## 1. Decision Background

早期設計將公司組織歸屬與 Knowledge access scope 綁得太緊，無法自然表達跨部門／跨組織專案合作，也可能讓「同 org」被誤解成「自動有相同 Knowledge 權限」。

Architecture review 因此拆開兩個概念：

```text
Organization identity
!=
Knowledge collaboration/access scope
```

Current canonical model：

```text
User
├── emp_id
├── name
└── org_code                     ← company identity attribute

User
  └── WorkspaceMembership
          │
          ▼
      Workspace                  ← Knowledge container + basic access boundary
          │
          └── KnowledgeSource    ← Source remains its own Tree root
                └── Tree / Document / Revision
```

核心決策：

- `User.org_code` 保留作 SSO/HR identity 與未來 governance input。
- Workspace 是 Knowledge collaboration/access scope。
- Cross-org Workspace membership 合法。
- Same-org user 不自動取得 Workspace access。
- KnowledgeSource 必須且只屬於一個 Workspace。
- Document scope 由 `Document → Source → Workspace` 推導，不重複保存 `workspace_id`。
- Source 仍是自己的 Tree root；Workspace 不是 synthetic folder。
- Workspace access 與 `SOURCE_MANAGED / HUB_MANAGED` content ownership 是不同概念。

## 2. Phase 0 Foundation Decision

Phase 0 因此加入：

```text
workspaces
workspace_memberships
```

Current Phase 0 canonical schema 共十張 domain tables，並以 `knowledge_sources.workspace_id` 表達 Source scope。

Workspace Phase 0 保持最小：

```text
Workspace
├── id UUID
├── name
├── created_at
└── updated_at

WorkspaceMembership
├── workspace_id
├── user_id
└── created_at
```

Phase 0 不強制 Workspace 有單一 owning organization。若治理上需要 accountable org/team，Phase 3 可以加入 governance metadata，但該 metadata 不得直接等同 authorization。

Phase 0–2 membership 只是 local/mock MVP foundation。Company production multi-user governance 需由 Phase 3 完成。

## 3. Authorization Boundary Decision

Current resource path：

```text
CallerContext
  → resolve resource Source / Workspace
  → Workspace policy
  → Source ownership / lifecycle rules
  → Knowledge operation
```

重要安全原則：

- `org_code` 不作 Knowledge allow/deny shortcut。
- 知道 Workspace/Source/Document UUID 不代表取得 access。
- UI Workspace selector 是 navigation state，不是 security evidence。
- Existing resource operation 由 authoritative relation 反查 Workspace。
- Search/derived index 不得成為 authorization truth。

## 4. Phase Responsibility Consequences

### Phase 0

建立 Workspace/Membership schema、repository/policy foundation、local fixtures，以及 cross-org member allow / same-org non-member deny 的基本證據。

### Phase 1

Knowledge Browser 採：

```text
Workspace selector
→ Source selector
→ Tree
→ Document / Revision
```

Knowledge/Tree/Revision operations 都繼承 Workspace access foundation。

### Phase 2

第一次 Folder Import 明確選 target Workspace，再建立 Source；更新既有 Source 時由 Source 自己的 `workspace_id` 決定 scope。普通 sync 不負責 Source transfer。

### Phase 3

Phase 3 是 Workspace production lifecycle / governance 的 owner，明確負責：

```text
Workspace provisioning / create
Workspace rename
Workspace archive / restore
Workspace administration
membership administration / lifecycle
roles / capabilities
Company Team mapping
SSO Group mapping
optional Source-level policy
production audit
Company SSO adapter
optional accountable owner/team/org metadata
```

Workspace MVP 不 hard delete。若未來需要 hard delete，必須另行設計 retention、stable references 與 audit semantics。

### Phase 4+

Search、Authoring、Publishing、MCP、Semantic Retrieval 都必須沿用 Workspace policy boundary。Publishing Tree 是否只屬於單一 Workspace不在 foundation 決定；Phase 6 設計。Agent delegation vs generalized Principal 在 Phase 7 設計。

## 5. Decisions That Did Not Change

Workspace correction 沒有推翻：

- application-generated UUIDv7 + MariaDB native UUID。
- Stable Document ID。
- Immutable Revision。
- Revision current pointer rules。
- SourceEntry stable mapping。
- Source as Tree root。
- one-document-one-TreeNode。
- `SOURCE_MANAGED / HUB_MANAGED`。
- Knowledge `ACTIVE / ARCHIVED`、no hard delete。
- READ COMMITTED + explicit row locks。
- Preview → Confirm → Apply。
- `sync_version` optimistic guard。
- metadata-only assets。

## 6. ADR-018 — Workspace Is the Knowledge Access Boundary

- **Context:** company organization identity 無法完整表示跨組織 Knowledge collaboration/access。
- **Decision:** 保留 `User.org_code` 作 identity attribute；新增 Workspace + WorkspaceMembership；KnowledgeSource 屬於 Workspace；基本 access 依 Workspace policy，而非 org equality。
- **Consequences:** Phase 0 增加 Workspace foundation；Phase 1 browser 有 Workspace selector；Phase 2 import 選 target Workspace；Phase 3 擁有 Workspace lifecycle/admin 與 production governance；後續 Search/Publishing/MCP reuse 相同 Workspace policy。

## 7. Current Documentation Rule

Current implementation decisions **只從 canonical documents 讀取**：

```text
README
→ Roadmap
→ Phase 0 Design / Plan
→ Phase 1 Design / Plan
```

本 history record 可以被引用來解釋 ADR-018 的背景，但不得作為第二套 schema、API 或 phase-scope truth。若未來架構再次修改，應先更新 canonical spec/plan，再另留新的 decision history。