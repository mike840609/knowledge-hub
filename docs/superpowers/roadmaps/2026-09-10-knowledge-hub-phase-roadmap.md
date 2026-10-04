# Knowledge Hub — Phase 0–9 Goals and Roadmap

| Item | Details |
| --- | --- |
| Date | 2026-09-10 |
| Document purpose | Goals, primary deliverables, resulting capabilities, and scope boundaries for each phase |
| Decision basis | Original KM planning and current Phase 0/1 canonical designs; Workspace architecture history preserves decision evolution only |
| Current status | Phase 0–5 implementation complete with verification evidence; Phase 6 deferred (2026-09-28); Phase 6–9 remain roadmap only |
| Project entry point | [README](../../../README.md) |

This roadmap organizes confirmed phase directions only; technology choices for future phases still require each phase's own design spec. Phase 0 implementation acceptance follows the verification record; documentation produced for other phases does not establish completed implementation or acceptance.

The 2026-09-10 architecture review corrected the foundation: **Organization is no longer the Knowledge access boundary; Workspace is the Knowledge container and basic access scope.** `User.org_code` remains an identity attribute; cross-org access is determined by Workspace policy/membership. This correction is directly incorporated into the Phase 0/1 canonical specs/plans, so no additional amendment is needed to obtain current truth.

## 1. Shared architecture principles

- `Workspace → KnowledgeSource → Folder / Document Tree`; each Source belongs to exactly one Workspace, and each Document to exactly one Source.
- `User.org_code` is an enterprise identity/organization attribute and does not directly authorize Knowledge: same org does not automatically allow, and cross org does not automatically deny.
- WorkspaceMembership is Phase 0's basic access foundation; Phase 0 does not require binding a Workspace to one owning organization.
- Phase 0–2 are a local/mock membership-governance MVP; **Phase 3 completion is the deployment gate for production multi-user governance**.
- Phase 3 explicitly owns Workspace provisioning/create, rename, archive/restore, membership administration, roles/capabilities, Team/SSO Group mapping, necessary granular policy/audit, and the enterprise SSO adapter.
- Workspace MVP has no hard deletion; future permanent deletion requires separate retention/reference/audit semantics.
- A Source remains its own Tree root; Workspace is not a synthetic Tree folder.
- Source, Tree, Document, and Revision have distinct responsibilities; stable Document IDs do not depend on path, title, Workspace, or external-system IDs.
- Hub internal stable entity IDs use application-generated UUIDv7; MariaDB 10.11 uses native `UUID` storage. WorkspaceMembership uses the `(workspace_id, user_id)` association key.
- `title / markdown / knowledge metadata` are versioned and Revisions immutable; hierarchy moves/filename renames do not produce content versions; Phase 2 defines SOURCE_MANAGED title resolution.
- Folder Sync is SOURCE_MANAGED and read-only in Hub; single-document imports and Web creation are HUB_MANAGED.
- Knowledge lifecycle is ACTIVE/ARCHIVED only, without hard deletion; reappearing entries reuse their original Document ID.
- Public application read/write services explicitly receive trusted `CallerContext`; resource operations resolve Source → Workspace and enforce policy, without trusting UI-provided org/workspace.
- Canonical Knowledge/Sources mutations use READ COMMITTED transactions, retaining necessary Source/Document row locks.
- Folder Upload directly selects an entire folder without ZIP; Preview → Confirm → transactional Apply.
- Assets MVP stores metadata/references only and does not promise binary storage/serving.
- Identity contract is fixed at `{id, emp_id, name, org_code}`; local/mock providers support development, and enterprise SSO connects through an adapter.
- MariaDB stores canonical Knowledge; search indexes are derived data and cannot become authorization truth.
- Human Web and Agent share application services; MCP is an access layer and Agent Memory an independent domain. Phase 0–2 do not prematurely create an Agent Principal model.

## 2. Phase overview

| Phase | Name | Core goal |
| --- | --- | --- |
| 0 | Foundation & Architecture | Establish technical structure, Workspace access foundation, canonical schema, identity, and transaction foundations |
| 1 | Knowledge Core & Tree | Complete Knowledge identity, Revision, lifecycle, Tree, and Workspace-scoped browser |
| 2 | Knowledge Source Import & Sync | Safely import/update Markdown folder Sources within a Workspace |
| 3 | Identity, Workspace Administration & Governance | Complete Workspace lifecycle/admin, production roles/capabilities, membership, and enterprise mapping |
| 4 | Discovery & Read API | Shared Workspace-aware query/read/keyword discovery for humans and Agents |
| 5 | Human Authoring | Hub-managed upload/create/edit and conflict handling |
| 6 | External Publishing | Independent Publishing Tree, mapping, preview/diff, and external publishing |
| 7 | Agent & MCP Access | Agents safely read Knowledge under the same Workspace policy |
| 8 | Semantic & Hybrid Retrieval | Workspace-aware semantic / hybrid retrieval |
| 9 | Agent Memory & Knowledge Relations | Independent, governed long-term memory, relations, context, and promotion |

Delivery order remains 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9.

**2026-09-28: Phase 6 deferred.** Web-interface backlog comes first ([Frontend Design Language §18](../specs/frontend-design-language.md)). This decision only defers Phase 6, without changing dependency order: starting Phase 7 before Phase 6 later requires a separate decision and rationale in this document. Before resuming Phase 6, obtain external publishing API specifications and a test environment; these are currently absent from the repo.

**2026-09-29: Personal Workspace knowledge links and graph (outside Phase 0–9 numbering).** While Phase 6 is deferred, fill My Space's missing personal-knowledge-workspace capabilities: TOC, `[[wikilink]]`, Backlinks, and relationship graph ([design](../specs/2026-09-29-personal-workspace-knowledge-graph-design.md)). This retracts Phase 2.5 §3's deferral of “Internal wiki-link resolution,” implementing only the wikilink subset (no embeds or callouts). **Relationship to Phase 9:** this handles *explicit human-authored links*, with a derived index rebuildable as a whole; these are neither Agent-derived relations nor Phase 9's patch layer. Phase 9 may later use this index as input without depending on it. It **does not change** phase dependencies or authorization invariants.

## 3. Phase Details

### Phase 0 — Foundation & Architecture

**Goal:** establish a modular monolith, Workspace access foundation, core schema, identity, and transaction boundaries reusable by later work.

Primary deliverables:

- Next.js、React、TypeScript、Tailwind、shadcn/ui、MariaDB 10.11。
- `identity`, `workspaces`, `knowledge`, and `sources`: four business modules.
- Ten domain tables: `users`, `workspaces`, `workspace_memberships`, `knowledge_sources`, `source_entries`, `knowledge_tree_nodes`, `knowledge_documents`, `knowledge_revisions`, `knowledge_assets`, `sync_runs`.
- `knowledge_sources.workspace_id` is the Source's authoritative Workspace scope; `org_code` is not Source authorization ownership.
- Phase 0 Workspace schema remains minimal: no mandatory owner org, slug, roles, or complete lifecycle.
- UUIDv7/native UUID、CallerContext、READ COMMITTED UoW、Source/Document locks、sync_version guard。
- one-document-one-TreeNode、ACTIVE/ARCHIVED provenance。
- Integration evidence for cross-org member allow, same-org nonmember deny, and direct resource IDs being unable to bypass membership.

**Resulting capability:** local/mock users can list their Workspaces and create/read basic Hub-managed Knowledge through the Source Tree within a Workspace.

**Out of scope:** Workspace administration, production roles, membership UI, Team/SSO Group mapping, enterprise SSO, complete Folder Sync, rich authoring, publishing, MCP, semantic retrieval, and Agent principal.

Details: [Phase 0 Design](../specs/2026-09-10-phase-0-foundation-architecture-design.md), [Phase 0 Plan](../plans/2026-09-10-phase-0-foundation-implementation.md).

### Phase 1 — Knowledge Core & Tree

**Goal:** preserve complete stable identity + immutable content history, providing reliable Workspace → Source → Tree browsing and lifecycle operations.

Primary deliverables:

- KnowledgeSource、Document、Revision、TreeNode、SourceEntry core behavior。
- SourceEntry → TreeNode stable mapping。
- stable Document UUIDv7、current revision resolution、Revision history。
- Archive/restore、archived filtering、hierarchy/content separation。
- Separation of HUB_MANAGED and SOURCE_MANAGED mutation authority.
- Workspace membership foundation applied consistently across read/write paths.
- READ COMMITTED concurrency protection。
- read-only browser：`Workspace selector → Source selector → Tree → Document / Revision`。

**Out of scope:** Workspace administration, Folder ingestion, Title Resolution, authoring UI, search, production ACL, publishing, and MCP.

Details: [Phase 1 Design](../specs/2026-09-10-phase-1-knowledge-core-tree-design.md), [Phase 1 Plan](../plans/2026-09-10-phase-1-knowledge-core-tree-implementation.md).

### Phase 2 — Knowledge Source Import & Sync

**Goal:** enable teams to safely import/update generic Markdown folders into KnowledgeSources in accessible Workspaces.

Primary deliverables:

- Initial import: Select Workspace → Select Folder → Scan/Parse → Preview → Confirm → Create Source + Apply.
- Generic folder adapter、snapshot、SourceEntry mapping、diff。
- Title Resolution: frontmatter/Markdown heading/filename precedence, fallback, and conflict rules.
- New Sources explicitly specify `workspace_id`; folder name is only an editable default source name.
- Updating existing Sources specifies only `source_id`; Workspace follows Source relationships, and sync cannot transfer Sources.
- Preview shows Added/Updated/Moved/Renamed/Archived/Restored/Unchanged.
- snapshot binding/expiry、sync_version、transactional Apply、full rollback、SyncRun history。
- missing entry archive、reappearance restore same ID、unchanged no new Revision。

**Out of scope:** Workspace creation/admin, bidirectional sync, Markdown merge, partial success, binary storage, arbitrary Knowledge location, and Source transfer.

Phase 2 remains a local/mock governance MVP; production multi-user write authorization is completed in Phase 3.

### Phase 3 — Identity, Workspace Administration & Basic Governance

**Goal:** upgrade Phase 0's WorkspaceMembership foundation to Workspace lifecycle and production governance suitable for a formal enterprise multi-user environment.

Primary deliverables:

- **Workspace provisioning / create**: define who may create Workspaces, initial administrators/membership, and required audit.
- **Workspace rename**: names may change while stable Workspace IDs remain; rename does not affect Source/Document identity.
- **Workspace archive / restore**: define archived-Workspace visibility/access/mutation semantics; MVP does not hard-delete Workspaces.
- Workspace administration UI / application services。
- Workspace roles / capabilities。
- Membership administration/lifecycle。
- Enterprise Team mapping。
- SSO Group → Workspace mapping。
- Optional Source-level override。
- Add Document-level ACL only when Workspace/Source policy cannot meet real requirements.
- Audit events / lifecycle history。
- Add accountable owner/team/org metadata if governance requires it; this metadata must not become an authorization shortcut.
- Enterprise SSO adapter maps into existing UserIdentity.

**Hard rules：** same org != allow；cross org != deny；Workspace ID/name/owner metadata != authorization proof。

**One Phase 3 completion criterion:** formal multi-user read/write rollout no longer relies on Phase 0–2 binary membership mock semantics, instead using production roles/capabilities and enterprise identity mapping.

Agent/service-principal membership is not prematurely finalized here; Phase 7 chooses delegation or a generalized Principal based on real Agent identity.

### Phase 4 — Discovery & Read API

**Goal:** establish a Workspace-aware read/query boundary shared by humans and Agents.

Primary deliverables:

- Workspace/Source/Tree/Document/Revision query services。
- Keyword/metadata search and filters.
- Search may span caller-authorized Workspaces or filter one Workspace.
- Candidate retrieval must not leak unauthorized titles/snippets.
- This phase's design evaluates MariaDB native capabilities or an independent search engine for the search backend; the roadmap makes no advance choice.

Embedding/vector/semantic-hybrid remains Phase 8 by default; bringing it forward requires a separate ADR.

### Phase 5 — Human Authoring

**Goal:** let users directly maintain HUB_MANAGED Knowledge.

Primary deliverables:

- Single-document Markdown upload and Web create/edit.
- Changes to title/Markdown/metadata create immutable Revisions.
- stale-editor conflict handling。
- Pass Workspace capability checks first, then validate HUB_MANAGED ownership.
- SOURCE_MANAGED retains read-only application guards.

**Out of scope:** automatic folder-source overwrites, ownership conversion, and bidirectional sync.

### Phase 6 — External Publishing

**Goal:** let HR/Publishers arrange and publish through a structure distinct from the Knowledge Tree to an external publishing system.

Primary deliverables:

- Independent Publishing Tree referencing stable Document/Revision。
- external publishing platform Space/Page mapping。
- publishing preview/diff、publish/sync、result history、retry。
- Separate local DB transactions from external side effects.
- Verify every referenced Knowledge resource through Workspace policy.

**Important open question:** do not prematurely bind the Publishing Tree's own scope to a single Workspace in the foundation. Phase 6 design chooses single-Workspace publishing, independent Publishing Space, or allowing Publishers to aggregate Knowledge from multiple accessible Workspaces.

Knowledge Tree != Publishing Tree; the external publishing platform does not determine canonical identity.

### Phase 7 — Agent & MCP Access

**Goal:** Agents reuse the same Knowledge/query/policy boundary through MCP.

Primary deliverables:

- MCP adapter/server。
- trusted Agent identity / caller mapping。
- Minimal search/get Knowledge capabilities.
- Workspace policy、revision resolution、archived filtering reuse。

This phase decides whether Agents delegate human identity or membership generalizes to Principal. MCP does not accept arbitrary `org_code` / `workspace_id` as authorization proof.

### Phase 8 — Semantic & Hybrid Retrieval

**Goal:** add semantic/hybrid retrieval to Phase 4 discovery.

Primary deliverables:

- revision chunking/embedding/derived index。
- Workspace-aware candidate filtering/ranking。
- async index update/rebuild consistency。
- retrieval backend selection。

MariaDB Knowledge + Workspace governance remain canonical truth; derived indexes do not independently determine authorization.

### Phase 9 — Agent Memory & Knowledge Relations

**Goal:** establish governed Agent Memory outside canonical Knowledge.

Primary deliverables:

- independent Memory Store。
- Knowledge relations / Context Bundles / consolidation。
- Memory → Knowledge promotion + human governance。
- stable Document/Revision references。
- explicit memory scope design。

Knowledge using Workspace does not make Agent Memory automatically workspace-global.

## 4. Milestones

| Milestone | Phase | Demo |
| --- | --- | --- |
| M1 — Source Knowledge Flow | 0–2 | Workspace → Markdown Folder → Preview/Confirm → Source → Tree/Document；local/mock governance |
| M2 — Human Knowledge Work | 3–5 | Workspace administration + production governance → Discovery → Upload/Web Authoring |
| M3 — Publishing | 6 | Independent Publishing Tree → external publishing platform |
| M4 — Agent Knowledge & Memory | 7–9 | MCP → Hybrid Retrieval → Governed Agent Memory |

M1 is a functional MVP and **does not establish completed production multi-user governance**. Phase 3 is the production-governance deployment gate.

## 5. Document status

| Scope | Design | Plan | Implementation / Verification |
| --- | --- | --- | --- |
| Phase 0 | [current canonical](../specs/2026-09-10-phase-0-foundation-architecture-design.md) | [current canonical](../plans/2026-09-10-phase-0-foundation-implementation.md) | Complete; see [verification](../verification/2026-09-10-phase-0-foundation-verification.md) |
| Phase 1 | [current canonical](../specs/2026-09-10-phase-1-knowledge-core-tree-design.md) | [current canonical](../plans/2026-09-10-phase-1-knowledge-core-tree-implementation.md) | Complete; see [verification](../verification/2026-09-11-phase-1-knowledge-core-tree-verification.md) |
| Workspace architecture change | [history record](../specs/2026-09-10-workspace-access-boundary-amendment.md) | [history record](../plans/2026-09-10-workspace-foundation-implementation-amendment.md) | Integrated into Phase 0/1 canonical docs |
| Phase 2 | [current canonical](../specs/2026-09-12-phase-2-knowledge-source-import-sync-design.md) | [current canonical](../plans/2026-09-12-phase-2-knowledge-source-import-sync.md) | Complete (PR #7); see [verification](../verification/2026-09-22-phase-2-import-sync-verification.md) |
| Phase 3 | [current canonical](../specs/2026-09-14-phase-3-identity-workspace-governance-design.md) | [current canonical](../plans/2026-09-14-phase-3-identity-workspace-governance.md) | Complete (PR #24); see [governance cutover](../../operations/phase3-workspace-governance-cutover.md) and [verification](../verification/2026-09-22-phase-3-governance-verification.md) |
| Phase 4 | [current canonical](../specs/2026-09-16-phase-4-discovery-read-api-design.md) | [current canonical](../plans/2026-09-16-phase-4-discovery-read-api.md) | Complete (PR #32); see [verification](../verification/2026-09-16-phase-4-discovery-read-api-verification.md) |
| Phase 5 | [current canonical](../specs/2026-09-16-phase-5-human-authoring-design.md) | [current canonical](../plans/2026-09-16-phase-5-human-authoring.md) | Complete (PR #35); see [verification](../verification/2026-09-16-phase-5-human-authoring-verification.md) |
| Phase 6 | roadmap only | — | Deferred (2026-09-28), see §2 |
| Personal Workspace knowledge links and graph | [current canonical](../specs/2026-09-29-personal-workspace-knowledge-graph-design.md) | [current canonical](../plans/2026-09-29-personal-workspace-knowledge-graph.md) | Implemented (TOC, link index, Backlinks, graph); see [verification](../verification/2026-09-29-personal-workspace-knowledge-graph-verification.md); operations in [rollout](../../operations/document-link-index-rollout.md) |
| Phase 7–9 | roadmap only | Not yet completed per phase | Not yet complete |

Detailed phase designs live in `docs/superpowers/specs/`, implementation plans in `docs/superpowers/plans/`, and actual testing/acceptance evidence in `docs/superpowers/verification/`.

When updating the roadmap, also check canonical specs/plans to prevent divergent Workspace access, Source ownership, lifecycle, phase scope, or technical baselines. History records preserve decision evolution, rather than serving as the current implementation's patch layer.
