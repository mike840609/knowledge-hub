# Knowledge Hub — Workspace Foundation Implementation History

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-10 |
| 文件類型 | Implementation change history |
| 狀態 | **Historical record — not an executable implementation plan** |
| Current plans | [Phase 0 Plan](2026-09-10-phase-0-foundation-implementation.md)、[Phase 1 Plan](2026-09-10-phase-1-knowledge-core-tree-implementation.md) |

> **重要：** Workspace foundation changes 已直接整合進 Phase 0/1 current implementation plans。本文件不再提供需要套用的 task override；Agent 執行工作時應直接使用 current Phase plan。

## 1. Why the Plans Changed

Architecture review 把 Knowledge access scope 從 company organization identity 拆出，建立：

```text
User
→ WorkspaceMembership
→ Workspace
→ KnowledgeSource
→ Tree / Document
```

`User.org_code` 繼續存在，但只作 identity / governance input，不直接作 Knowledge ACL。

## 2. Phase 0 Implementation Delta Recorded

這次變更曾要求 Phase 0 增加或調整：

- 新增 `workspaces` module。
- 新增 `workspaces`、`workspace_memberships` tables。
- `KnowledgeSource` 使用 `workspace_id` 作 authoritative Source scope。
- Local seed 建立 User → WorkspaceMembership → Workspace → Source。
- 加入 cross-org member allow、same-org non-member deny、multi-Workspace caller fixtures。
- Direct Source/Document UUID lookup 必須重新解析 Workspace policy。
- Minimal Web flow 增加 Workspace selector。
- Workspace selector 不是 authorization evidence。
- Phase 0 canonical domain baseline 由原 Knowledge/Source core tables擴充成十張 domain tables。

上述內容已存在 current [Phase 0 Implementation Plan](2026-09-10-phase-0-foundation-implementation.md)，**不得再依本 history 重複建立第二套 migration/module/task**。

## 3. Phase 1 Implementation Delta Recorded

這次變更曾要求 Phase 1：

- 繼承 Phase 0 Workspace/Membership foundation。
- Query/command 由 resource → Source → Workspace 做 access check。
- `WorkspaceQueryService.listWorkspaces(caller)` 提供 selector data。
- `KnowledgeQueryService.listSources(caller, workspaceId, ...)` 使用 Workspace 作 query scope。
- Resource-specific reads 不接受額外 workspaceId 作 authorization proof。
- Browser 改為 `Workspace → Source → Tree → Document / Revision`。
- E2E 增加 cross-org member、same-org non-member、multi-Workspace 與 direct unauthorized URL cases。
- 普通 Tree/Sync operation 不可偷偷 transfer Source 到另一 Workspace。

上述內容已存在 current [Phase 1 Implementation Plan](2026-09-10-phase-1-knowledge-core-tree-implementation.md)。

## 4. Workspace Lifecycle Responsibility Added

Architecture review 後又發現：既然 Workspace 已是 first-class domain，就必須有明確 Phase owner 負責 lifecycle；否則 Phase 2 會假設 Workspace 已存在，卻沒有正式 provisioning path。

因此 current roadmap / Phase 0 / Phase 1 handoff 已統一指定 **Phase 3** 負責：

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
```

規則：

- Phase 0 只建最小 Workspace/Membership schema、seed、query/policy foundation。
- Phase 1 只 consume Workspace access foundation並提供 selector/browser。
- Phase 2 只讓 new Source 選 target Workspace；不建立 Workspace admin feature。
- Workspace MVP 不 hard delete。
- accountable org/team metadata 如果需要，由 Phase 3 governance 設計，但不是 authorization shortcut。
- Company production multi-user governance 需 Phase 3 完成。

## 5. What Did Not Change

本次 plan correction 沒有改變：

- UUIDv7 + MariaDB native UUID。
- READ COMMITTED canonical transactions。
- Source/Document row locks。
- stable Document identity。
- immutable Revision。
- SourceEntry mapping。
- one-document-one-TreeNode。
- `SOURCE_MANAGED / HUB_MANAGED` mutation authority。
- Knowledge `ACTIVE / ARCHIVED` lifecycle。
- Preview → Confirm → Apply / `sync_version` safety。
- Phase 2 Title Resolution responsibility。

## 6. Execution Rule for Agents

Agent 要實作 Phase 0 或 Phase 1 時：

```text
1. Read current Phase Design
2. Read current Phase Implementation Plan
3. Execute that plan
4. Use verification evidence before claiming completion
```

不要：

```text
current plan
+ this history as patch
+ old plan assumptions
```

這個 history file 只用於追查「為什麼 Workspace work 被加入 plan」與「哪些責任後來交給 Phase 3」，不應產生任何額外 implementation task。