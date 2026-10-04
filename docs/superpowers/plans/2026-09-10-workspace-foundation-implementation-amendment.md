# Knowledge Hub — Workspace Foundation Implementation History

| Item | Content |
| --- | --- |
| Date | 2026-09-10 |
| Document type | Implementation change history |
| Status | **Historical record — not an executable implementation plan** |
| Current plans | [Phase 0 Plan](2026-09-10-phase-0-foundation-implementation.md), [Phase 1 Plan](2026-09-10-phase-1-knowledge-core-tree-implementation.md) |

> **Important:** Workspace foundation changes have been integrated directly into the current Phase 0/1 implementation plans. This document no longer supplies task overrides to apply; agents should execute the current Phase plan directly.

## 1. Why the Plans Changed

Architecture review separated Knowledge access scope from company organization identity, establishing:

```text
User
→ WorkspaceMembership
→ Workspace
→ KnowledgeSource
→ Tree / Document
```

`User.org_code` remains, but serves only as identity / governance input, not directly as the Knowledge ACL.

## 2. Phase 0 Implementation Delta Recorded

This change required Phase 0 to add or adjust:

- Add the `workspaces` module.
- Add the `workspaces` and `workspace_memberships` tables.
- `KnowledgeSource` uses `workspace_id` as the authoritative Source scope.
- The local seed establishes User → WorkspaceMembership → Workspace → Source.
- Add cross-org member allow, same-org non-member deny, and multi-Workspace caller fixtures.
- Direct Source/Document UUID lookup must resolve Workspace policy again.
- Add a Workspace selector to the minimal Web flow.
- The Workspace selector is not authorization evidence.
- Expand the Phase 0 canonical domain baseline from the original Knowledge/Source core tables to ten domain tables.

These changes are already present in the current [Phase 0 Implementation Plan](2026-09-10-phase-0-foundation-implementation.md). **Do not use this history to create a duplicate set of migrations/modules/tasks.**

## 3. Phase 1 Implementation Delta Recorded

This change required Phase 1 to:

- Inherit the Phase 0 Workspace/Membership foundation.
- Perform query/command access checks through resource → Source → Workspace.
- `WorkspaceQueryService.listWorkspaces(caller)` supplies selector data.
- `KnowledgeQueryService.listSources(caller, workspaceId, ...)` uses Workspace as the query scope.
- Resource-specific reads do not accept an additional workspaceId as authorization proof.
- Change the browser to `Workspace → Source → Tree → Document / Revision`.
- Add E2E cases for cross-org members, same-org non-members, multi-Workspace callers, and direct unauthorized URLs.
- Ordinary Tree/Sync operations must not silently transfer a Source to another Workspace.

These changes are already present in the current [Phase 1 Implementation Plan](2026-09-10-phase-1-knowledge-core-tree-implementation.md).

## 4. Workspace Lifecycle Responsibility Added

A subsequent architecture review found that, because Workspace is now a first-class domain, an explicit Phase owner must own its lifecycle; otherwise Phase 2 assumes Workspaces exist without a formal provisioning path.

The current roadmap and Phase 0 / Phase 1 handoffs therefore consistently assign **Phase 3** responsibility for:

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

Rules:

- Phase 0 builds only the minimal Workspace/Membership schema, seed, and query/policy foundation.
- Phase 1 only consumes the Workspace access foundation and supplies the selector/browser.
- Phase 2 only lets a new Source choose its target Workspace; it does not build Workspace administration features.
- The Workspace MVP does not hard delete.
- If accountable org/team metadata is needed, Phase 3 governance designs it; it is not an authorization shortcut.
- Company production multi-user governance requires completion of Phase 3.

## 5. What Did Not Change

This plan correction did not change:

- UUIDv7 + MariaDB native UUID.
- READ COMMITTED canonical transactions.
- Source/Document row locks.
- stable Document identity.
- immutable Revision.
- SourceEntry mapping.
- one-document-one-TreeNode.
- `SOURCE_MANAGED / HUB_MANAGED` mutation authority.
- Knowledge `ACTIVE / ARCHIVED` lifecycle.
- Preview → Confirm → Apply / `sync_version` safety.
- Phase 2 Title Resolution responsibility.

## 6. Execution Rule for Agents

When an agent implements Phase 0 or Phase 1:

```text
1. Read current Phase Design
2. Read current Phase Implementation Plan
3. Execute that plan
4. Use verification evidence before claiming completion
```

Do not combine:

```text
current plan
+ this history as patch
+ old plan assumptions
```

This history file exists only to trace why Workspace work was added to the plans and which responsibilities were later assigned to Phase 3; it must not generate additional implementation tasks.