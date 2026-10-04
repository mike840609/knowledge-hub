# Knowledge Hub — Workspace Access Boundary Architecture History

**English** | [繁體中文](2026-09-10-workspace-access-boundary-amendment.zh-TW.md)

| Item | Content |
| --- | --- |
| Date | 2026-09-10 |
| Document type | Architecture history / decision record |
| Status | **Historical record — not an active overlay** |
| Current truth | [Phase 0 Design](2026-09-10-phase-0-foundation-architecture-design.md), [Phase 1 Design](2026-09-10-phase-1-knowledge-core-tree-design.md), [Roadmap](../roadmaps/2026-09-10-knowledge-hub-phase-roadmap.md) |

> **Important:** The Workspace correction has been integrated directly into the Phase 0/1 canonical specs/plans. Implementers and agents must not treat this document as a patch to overlay on the current spec or use it to override canonical documents. It only explains why the org-scoped model became the Workspace model.

## 1. Decision Background

The early design coupled company organizational affiliation too tightly to Knowledge access scope. It could not naturally express projects spanning departments or organizations, and could cause “same org” to be mistaken for “automatically has the same Knowledge permissions.”

The architecture review therefore separated two concepts:

```text
Organization identity
!=
Knowledge collaboration/access scope
```

Current canonical model:

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

Core decisions:

- `User.org_code` remains an SSO/HR identity attribute and an input to future governance.
- Workspace is the Knowledge collaboration/access scope.
- Cross-org Workspace membership is valid.
- Same-org users do not automatically receive Workspace access.
- A KnowledgeSource must belong to exactly one Workspace.
- Document scope is derived through `Document → Source → Workspace`; `workspace_id` is not stored redundantly.
- A Source remains its own Tree root; a Workspace is not a synthetic folder.
- Workspace access and `SOURCE_MANAGED / HUB_MANAGED` content ownership are separate concepts.

## 2. Phase 0 Foundation Decision

Phase 0 therefore adds:

```text
workspaces
workspace_memberships
```

The current Phase 0 canonical schema contains ten domain tables and expresses Source scope through `knowledge_sources.workspace_id`.

Phase 0 keeps Workspace minimal:

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

Phase 0 does not require a Workspace to have a single owning organization. If governance requires an accountable org/team, Phase 3 may add governance metadata, but that metadata must not directly equal authorization.

Phase 0–2 membership is only a local/mock MVP foundation. Phase 3 must complete production multi-user governance for the company.

## 3. Authorization Boundary Decision

Current resource path:

```text
CallerContext
  → resolve resource Source / Workspace
  → Workspace policy
  → Source ownership / lifecycle rules
  → Knowledge operation
```

Key security principles:

- `org_code` is not a shortcut for Knowledge allow/deny decisions.
- Knowing a Workspace/Source/Document UUID does not grant access.
- The UI Workspace selector is navigation state, not security evidence.
- Operations on existing resources resolve Workspace through authoritative relationships.
- Search/derived indexes must not become the authorization source of truth.

## 4. Phase Responsibility Consequences

### Phase 0

Establish the Workspace/Membership schema, repository/policy foundation, local fixtures, and basic evidence that cross-org members are allowed and same-org non-members are denied.

### Phase 1

The Knowledge Browser uses:

```text
Workspace selector
→ Source selector
→ Tree
→ Document / Revision
```

Knowledge/Tree/Revision operations all inherit the Workspace access foundation.

### Phase 2

The first Folder Import explicitly selects a target Workspace before creating a Source. Updates to an existing Source derive scope from its own `workspace_id`. Ordinary sync does not transfer Sources.

### Phase 3

Phase 3 owns the Workspace production lifecycle / governance and explicitly covers:

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

The Workspace MVP does not hard delete. If hard deletion is needed later, retention, stable references, and audit semantics require a separate design.

### Phase 4+

Search, Authoring, Publishing, MCP, and Semantic Retrieval must all reuse the Workspace policy boundary. The foundation does not decide whether a Publishing Tree belongs to only one Workspace; Phase 6 designs that. Phase 7 designs agent delegation versus a generalized Principal.

## 5. Decisions That Did Not Change

The Workspace correction does not overturn:

- application-generated UUIDv7 + MariaDB native UUID。
- Stable Document ID。
- Immutable Revision。
- Revision current pointer rules。
- SourceEntry stable mapping。
- Source as Tree root。
- one-document-one-TreeNode。
- `SOURCE_MANAGED / HUB_MANAGED`。
- Knowledge `ACTIVE / ARCHIVED`, no hard delete。
- READ COMMITTED + explicit row locks。
- Preview → Confirm → Apply。
- `sync_version` optimistic guard。
- metadata-only assets。

## 6. ADR-018 — Workspace Is the Knowledge Access Boundary

- **Context:** company organizational identity cannot fully represent cross-org Knowledge collaboration/access.
- **Decision:** retain `User.org_code` as an identity attribute; add Workspace + WorkspaceMembership; KnowledgeSource belongs to Workspace; basic access follows Workspace policy rather than org equality.
- **Consequences:** Phase 0 adds the Workspace foundation; the Phase 1 browser has a Workspace selector; Phase 2 import selects a target Workspace; Phase 3 owns Workspace lifecycle/admin and production governance; later Search/Publishing/MCP reuse the same Workspace policy.

## 7. Current Documentation Rule

Read current implementation decisions **only from canonical documents**:

```text
README
→ Roadmap
→ Phase 0 Design / Plan
→ Phase 1 Design / Plan
```

This history record may be cited to explain the background of ADR-018, but must not serve as a second source of truth for schema, API, or phase scope. If the architecture changes again, update the canonical spec/plan first, then record a new decision history.
