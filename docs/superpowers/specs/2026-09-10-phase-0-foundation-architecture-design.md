# Knowledge Hub — Phase 0 Foundation & Architecture Design

| Item | Content |
| --- | --- |
| Document date | 2026-09-10 |
| Document type | Design Spec; excludes Implementation Plan |
| Decision status | Approved Design; Workspace access-boundary correction integrated |
| Delivery status | Document complete and self-reviewed; does not imply system implementation or acceptance |
| Decision sources | [KM Phase Implementation Planning — Complete Rework](chatgpt-conversation://6a990399-5d14-83e9-8e46-8091dce556fd) and [Workspace Access Boundary Amendment](2026-09-10-workspace-access-boundary-amendment.md) |

## 1. Document Authority and Scope

This spec defines the new Knowledge Hub's Phase 0 foundation for subsequent implementation plans and phase designs. The 2026-09-10 architecture review replaced `org_code` as the upper Knowledge scope with a **Workspace access boundary**. This document integrates that correction directly and is the current Phase 0 canonical contract; implementers need not combine old org/source sections with the amendment themselves.

Phase 0 delivers a runnable, testable Next.js modular monolith foundation: technical skeleton, four core modules, minimal identity interface, Workspace access foundation, core schema, repository and transaction boundaries, domain invariants, and a minimal create/read/Workspace → Source → Tree browsing smoke flow. Full Knowledge functionality expands in Phase 1; full Folder Sync is implemented in Phase 2.

This document distinguishes three kinds of content:

- **Required Phase 0 deliverables**: skeleton, schema, domain representation, Workspace membership foundation, basic application services, security mechanisms, and tests.
- **Contracts later phases must follow**: for example, Folder Sync's Preview → Confirm → Apply; define rules now without prematurely implementing product features.
- **Consistency clarifications**: make necessary implications of confirmed rules explicit, such as title changes belonging to content versions and failure records not depending on rolled-back transactions. These are not new product features.

## 2. Goals and Non-goals

### 2.1 Goals

1. Build a source-agnostic Knowledge Hub accepting teams' different LLM Wiki/general Markdown folder sources, without binding to Obsidian or a specific generator.
2. Express the Knowledge container, sources, and browsing structure with `Workspace → KnowledgeSource → Folder / Document Tree`; retain `User.org_code` only as a company organizational identity attribute.
3. Establish a minimal access foundation with `WorkspaceMembership`, allowing cross-org collaboration without automatically granting Knowledge access within the same org.
4. Separate Source, Tree, Document identity, and Revision so path changes do not break document references.
5. Share application services across Human Web, future API, and MCP, keeping the core independent of UI and ingress protocols.
6. Protect canonical Knowledge consistency with MariaDB transactions, relational constraints, and tests.
7. External development relies only on local/mock identity, replacing the identity source with a company SSO adapter later.

### 2.2 Non-goals

Phase 0 does not implement the following:

| Item | Boundary |
| --- | --- |
| Full Folder Upload / Sync | Phase 2; Phase 0 completes only the model and security foundation |
| ZIP import | Excluded from the Folder Sync MVP; select an entire folder directly |
| Full document management and Tree product features | Phase 1; Phase 0 provides only a minimal flow to verify the foundation |
| Full single-file upload, Web authoring, and rich Markdown editor | Phase 5; Phase 0 defines editability rules and verifies minimal creation/revision behavior |
| Workspace provisioning/rename/archive/restore administration UI | Phase 3; Phase 0 creates only minimal Workspace schema, seed, and membership guard |
| Full Workspace roles/capabilities, membership administration, Team/SSO Group mapping, granular ACL | Phase 3; Phase 0 establishes only the membership foundation |
| External publishing API, Publishing Tree, and publishing flow | Phase 6 |
| MCP server / tools / transport | Phase 7 |
| Embedding, Vector DB, Elasticsearch, semantic/hybrid search | Phase 8; Phase 0 does not select the future retrieval backend |
| Agent Memory, Knowledge Relations, Context Bundles | Phase 9 |
| Company SSO integration | Added after entering the company environment; Phase 3 completes production company multi-user governance |
| Binary asset storage | Not stored in MariaDB, local filesystem, or object storage; metadata/reference only |
| Hard delete | Not provided in MVP |
| Bidirectional sync, Markdown merge, partial sync success | Not provided in MVP |
| Microservices or a separate backend service | Outside this phase's deployment model |

Do not preemptively add Refine, Outline, Redux, Tiptap, dnd-kit, Elasticsearch, or an MCP implementation. Future editor, drag-and-drop, and retrieval requirements belong to their respective phases; extension boundaries do not mean installing packages or creating empty modules now.

## 3. Technology and Overall Architecture

### 3.1 Technical Baseline

| Layer | Confirmed choice |
| --- | --- |
| Application / Web | Next.js modular monolith, React |
| Language | TypeScript |
| UI | Tailwind CSS, shadcn/ui; the original UI selection uses Base UI as the default direction |
| Canonical database | MariaDB 10.11 |
| Identity | Local / Mock Identity Provider, followed by a Company SSO adapter |
| Knowledge access scope | Workspace + WorkspaceMembership |
| Internal IDs | Application-generated UUIDv7; MariaDB native `UUID` type (16-byte storage) |

Apart from MariaDB 10.11, this spec adds no ORM, test framework, or deployment platform selection. Those are implementation details for the subsequent plan and do not change this architecture contract. All Hub internal stable entity IDs (User, Workspace, Source, SourceEntry, TreeNode, Document, Revision, Asset, SyncRun) use one UUIDv7 contract; `WorkspaceMembership` is an association using composite key `(workspace_id, user_id)`, requiring no extra UUID. Path, title, hash, or database auto-increment must not masquerade as domain identity. MariaDB 10.11 provides native `UUID`, so this baseline uses neither `CHAR(36)` nor application-maintained `BINARY(16)` byte layouts.

### 3.2 Layers and Dependencies

```text
Human Web
  │
  ▼
Next.js pages / routes / server actions
  │                         IdentityProvider
  │                              │
  └───────────┬──────────────────┘
              ▼
       Application Services
              │
       ┌──────┼──────────┐
       ▼      ▼          ▼
 Workspaces  Sources ──► Knowledge
       │      │          │
       └──────┴────┬─────┘
                   ▼
         Domain + repository ports
                   ▲
                   │ implemented by
          MariaDB infrastructure
                   │
                   ▼
              MariaDB 10.11
```

Deployment is one Next.js application, with responsibilities divided into modules and layers internally; cross-service HTTP does not split a single transaction. Domain does not depend on Next.js, React, SQL, SSO tokens, MCP, or source scanners.

The Web adapter receives requests, obtains trusted identity, creates `CallerContext`, calls application services, and presents results. Pages must not directly manipulate the ORM/database in place of application services. The UI Workspace selector represents navigation state, not authorization evidence; application services must resolve the authoritative Source → Workspace relationship before applying policy to resource operations. UI error boundaries do not roll back data; application transaction boundaries handle rollback.

MariaDB stores canonical state within the Hub. `SOURCE_MANAGED` means the external source controls updates to content and hierarchy; it does not mean Web or future Agents should bypass the Hub to read external folders directly, nor does it equal caller access policy.

## 4. Core Domain Rules

### 4.1 User, Workspace, Sources, and Tree

```text
User
├── emp_id
├── name
└── org_code                     ← company organization identity attribute

User
  └── WorkspaceMembership
          │
          ▼
      Workspace                  ← Knowledge container + basic access scope
          │
          └── KnowledgeSource
                ├── SourceEntry ─────────────────────┐
                ├── KnowledgeAsset metadata         │
                └── KnowledgeTreeNode               │
                      ├── FOLDER                    │
                      └── DOCUMENT ─────────────────┤
                                                    ▼
                                            KnowledgeDocument
                                                    │
                                                    ▼
                                            KnowledgeRevision
```

- A User may belong to multiple Workspaces; a Workspace may contain Users with different `org_code` values.
- `User.org_code` describes company organizational affiliation, not a direct Knowledge allow/deny predicate; same org does not automatically allow, and cross org does not automatically deny.
- Each Source must belong to exactly one `workspace_id`; a Workspace may have multiple Sources.
- Phase 0 does not bind Workspace to a single owner org. If future governance needs an accountable org/team, Phase 3 designs the metadata; governance metadata must not serve as an authorization shortcut.
- Each Document must belong to exactly one Source, including single uploads and Web-created documents.
- Document does not redundantly store `workspace_id`; its scope derives through `Document → Source → Workspace`.
- Folder is purely a hierarchy node; it creates no fake empty KnowledgeDocument.
- Source itself remains its logical Tree root; Workspace is not a synthetic Tree folder.
- Tree expresses location; Document expresses stable identity; Revision expresses content versions.

### 4.2 Source Type and Ownership

| `source_type` | `ownership` | Update authority and behavior |
| --- | --- | --- |
| `FOLDER_SYNC` | `SOURCE_MANAGED` | Source controls hierarchy, path, title, Markdown, and knowledge metadata; Hub is read-only, with updates through the next sync |
| `FILE_UPLOAD` | `HUB_MANAGED` | Managed by Hub after single-file import, editable with revision creation; the original file no longer continuously controls content |
| `HUB` | `HUB_MANAGED` | Web-created documents are managed by Hub, editable with revision creation |

Ownership is stored in Source; Document obtains effective ownership through `source_id`, without maintaining a potentially conflicting copy of document ownership. Workspace access and Source ownership are independent decisions: the former determines whether the caller may enter the Knowledge scope; the latter determines whether the external source or Hub controls content updates.

Application services must enforce the `SOURCE_MANAGED` read-only rule, rather than merely hiding UI buttons. Ordinary Hub edits, renames, moves, and deletes must not modify the source mirror; sync may update, archive, or restore it through controlled Knowledge application operations.

A single upload never automatically overwrites or merges a source-managed document even with the same name or content as an existing folder document. Automatic deduplication, detach/ownership conversion, and bidirectional sync are outside this spec.

### 4.3 Stable IDs and SourceEntry

`KnowledgeDocument.id` does not depend on filename, path, TreeNode ID, Workspace ID, generator ID, or external publishing system ID. Existing documents retain their IDs through rename, move, revision, and archive/restore.

`SourceEntry` stores the mapping between a source entry and Document: prefer a stable source-provided `external_id`; otherwise Hub maintains the mapping. `source_path` is only a locator, not a Document ID. Sources need not have a particular frontmatter ID, and all generators cannot be required to use one format.

This guarantees identity continuity for an entry identified as the same entry; it does not claim that path or equal hashes alone can unambiguously identify arbitrary renames/moves. Phase 2 designs matching and ambiguity handling without external IDs; Phase 0 adds no unconfirmed similarity, deduplication, or automatic merge strategies. Mapping schema and repositories must prevent duplicate allocation of an identified source identity.

### 4.4 Boundary Between Revision and Hierarchy

| Change | Update location | New Revision |
| --- | --- | --- |
| Source filename/path rename | SourceEntry locator, related hierarchy | No |
| Folder rename | Folder TreeNode name, related locator | No |
| Move or reorder | TreeNode parent / position, related locator | No |
| Document title change | KnowledgeRevision | Yes |
| Markdown change | KnowledgeRevision | Yes |
| Knowledge metadata/source frontmatter content change | KnowledgeRevision | Yes |
| Archive/restore, same content | Lifecycle/related Tree and mapping state | No |
| Content and hierarchy both change | Update each separately | Content creates a new Revision |
| Repeated input of identical content | Keep current content | No |

“Rename does not create a revision” refers to hierarchy changes to filename, path, or Folder name. Document titles are confirmed versioned content, so title changes must create revisions. A Document TreeNode's display name comes from the current revision's `title`; only Folders use their own `name`.

A Revision is immutable after creation; old content is never modified in place or overwritten. New title/Markdown/metadata state is expressed as a new revision, then Document's `current_revision_id` is updated. Content comparison must cover all three, not just Markdown while omitting title or metadata; path/parent/position are not versioned content. The implementation plan/import design specifies hash serialization and calculation.

Phase 0 does not decide SOURCE_MANAGED `title` resolution. Source filename/path does not automatically equal canonical Knowledge title; Phase 2 ingestion design must define precedence among frontmatter, Markdown heading, filename, and other candidates, missing-value fallbacks, and conflict resolution. Phase 0–1 only establish that a canonical title change is a Revision content change.

### 4.5 Lifecycle

Knowledge lifecycle has only `ACTIVE` and `ARCHIVED`. “Missing” in the conversation describes a missing source file; no `MISSING` or `DELETED` lifecycle enum is added.

Archive when a source document disappears or a Hub-managed document is deleted; retain Document, Revision, and source mapping without hard deletion. Default Tree and future search/MCP queries exclude archived documents; history and references may remain.

When the same SourceEntry reappears, restore the original Document to `ACTIVE` and retain its ID. Create a revision only if versioned content changes; otherwise only restore. Update related Tree/mapping state consistently with Document.

All canonical entities that can become `ARCHIVED` (KnowledgeSource, SourceEntry, KnowledgeTreeNode, KnowledgeDocument) must store lifecycle provenance: `updated_by`, nullable `archived_by`, nullable `archived_at`. Archive writes status and all three fields in one transaction; restore returns status to ACTIVE, sets `updated_by` to the current actor, and clears current `archived_by`/`archived_at`. These describe provenance of the current archive state and do not replace a full historical audit log; Phase 3 Governance designs append-only history for repeated archive/restore events.

Phase 0 does not define Workspace's own lifecycle. Phase 3 must explicitly design Workspace create/provision, rename, archive/restore, and administration semantics; MVP provides no Workspace hard delete.

The Phase 0–2 actor remains trusted `UserIdentity`, stored through user FKs. Do not introduce `actor_kind` or polymorphic actor references now; if Agent writes, service accounts, or system actors become requirements, design a Principal/Actor model in their corresponding phase.

### 4.6 Assets

`KnowledgeAsset` stores only source path, MIME type, content hash, and metadata/reference. Markdown may retain its original relative-path references.

The Phase 0/Phase 2 MVP does not persist images, attachment binaries, or entire uploaded folder binaries, nor require binary serving. Recording asset references does not mean Hub can display corresponding images or download attachments. Add a storage adapter when future requirements warrant it.

## 5. Domain Model and Table Boundaries

Phase 0 migrations create at least the following ten domain tables. These are confirmed logical fields and responsibilities, not complete SQL DDL; the implementation plan decides physical types, index names, and migration order.

| Table / Owner | Minimum fields | Responsibilities and constraints |
| --- | --- | --- |
| `users` / identity | `id` PK, `emp_id` UNIQUE, `name`, `org_code` | Minimal local user data; org_code is an identity attribute; referenced by creators and operation records, without storing SSO tokens |
| `workspaces` / workspaces | `id`, `name`, `created_at`, `updated_at` | Knowledge container and basic access scope; Phase 0 requires no owner org, slug, full lifecycle, or role model |
| `workspace_memberships` / workspaces | `workspace_id`, `user_id`, `created_at`; PK `(workspace_id, user_id)` | Phase 0 basic membership association; full roles/capabilities and administration belong to Phase 3 |
| `knowledge_sources` / sources | `id`, `name`, `workspace_id`, `source_type`, `ownership`, `status`, `sync_version`, `created_by`, `updated_by`, `archived_by` nullable, `archived_at` nullable, `created_at`, `updated_at` | Source definition, single Workspace scope, update authority, sync version, and current lifecycle provenance |
| `source_entries` / sources | `id`, `source_id`, `external_id` nullable, `source_path`, `entry_type`, `content_hash`, `document_id` nullable, `status`, `updated_by`, `archived_by` nullable, `archived_at` nullable, `first_seen_at`, `last_seen_at` | Source identity/locator, Document mapping, and current lifecycle provenance; Folder entries may have no Document |
| `knowledge_tree_nodes` / knowledge | `id`, `source_id`, `parent_id` nullable, `node_type`, `name`, `document_id` nullable, `position`, `status`, `updated_by`, `archived_by` nullable, `archived_at` nullable | Hierarchy within a Source and current lifecycle provenance; `node_type` is `FOLDER` or `DOCUMENT` |
| `knowledge_documents` / knowledge | `id`, `source_id`, `current_revision_id`, `status`, `created_by`, `updated_by`, `archived_by` nullable, `archived_at` nullable, `created_at`, `updated_at` | Stable document identity, current revision pointer, and current lifecycle provenance; stores no Markdown, path, or workspace_id |
| `knowledge_revisions` / knowledge | `id`, `document_id`, `revision_no`, `title`, `markdown`, `metadata`, `content_hash`, `created_by`, `created_at` | Immutable content versions and provenance |
| `knowledge_assets` / sources | `id`, `source_id`, `source_path`, `mime_type`, `content_hash`, `metadata`, `created_at` | Asset metadata/reference only; optional metadata absent from a source must not block the model |
| `sync_runs` / sources | `id`, `source_id`, `triggered_by`, `based_on_version`, `result_version`, `status`, `summary`, `started_at`, `completed_at` | Sync operation records; Phase 0 creates schema, Phase 2 connects the full flow |

All Hub internal entity ID fields above use the same UUID contract and MariaDB native `UUID`; WorkspaceMembership uses a composite association key. `knowledge_revisions.metadata` may use MariaDB JSON for non-core data such as frontmatter; important domain fields such as workspace/source/status/ownership/revision reference remain explicit relational fields. Phase 0 adds no organizations, publishing, granular ACL, vector, MCP, or memory tables.

Source, SourceEntry, TreeNode, and Document use lifecycle status `ACTIVE / ARCHIVED`. `sync_runs.status` is a separate operation-result dimension using `PREVIEWED / APPLIED / FAILED`, not an additional Knowledge lifecycle.

### 5.1 Invariants That Must Be Protected

| Invariant | Protection and acceptance requirements |
| --- | --- |
| Each Source has exactly one existing Workspace | Required FK `knowledge_sources.workspace_id` and integration test |
| No duplicate WorkspaceMembership | PK/UNIQUE `(workspace_id, user_id)`; one user may join multiple Workspaces |
| Same org does not automatically grant access / cross-org membership allows access | Application policy + integration fixtures; no org-equality shortcut |
| Each Document has exactly one existing Source | Required reference, FK, and integration test |
| Revision belongs to an existing Document | FK and integration test |
| `current_revision_id` points to a Revision of the same Document | Same-document relational constraints and repository transaction validation; checking only revision existence is insufficient |
| No duplicate revision numbers within a document | Uniqueness of `(document_id, revision_no)` and tests |
| Each Document has only one DOCUMENT node in Knowledge Tree | UNIQUE protection on non-NULL `knowledge_tree_nodes.document_id`; an integration test creating a second node must fail |
| A `DOCUMENT` TreeNode must have a Document reference | Node type/reference constraint and tests |
| A `FOLDER` TreeNode has a name and no Document reference | Node type/reference constraint and tests |
| Tree, mapping, and referenced Document have consistent Sources | Relational consistency checks and integration tests; Tree moves must not silently change document Source |
| Tree parent is in the same Source; hierarchy has no cycles | Repository/domain validation and tests |
| No duplicate mappings for an identified source identity | Source-scoped uniqueness protection and integration tests; global path/hash does not equal identity |
| Lifecycle changes retain current actor/time provenance | Update lifecycle-bearing row status and `updated_by`/`archived_by`/`archived_at` in one transaction; restore clears current archive provenance |
| Revision immutable | Domain/repository exposes no operation overwriting old versions; protect with behavioral tests |
| Failed operations leave no partial canonical state | One transaction and rollback integration test |
| Resource IDs cannot bypass Workspace policy | Read/write services resolve Workspace through authoritative relationships before access checks |

Protect relational, uniqueness, and field rules expressible by the database with constraints. Cross-row hierarchy or process rules still require domain/application validation and tests, not merely UI enforcement.

The creation transaction handles mutual references between Document and its first Revision. A temporary pointer state during creation must not be treated as a completed document commit or returned by the application; successful creation must have a current revision belonging to the same document. The plan must choose an insertion/update order compatible with MariaDB 10.11 and test it against a real DB, without assuming one FK covers every rule.

## 6. Module and Application Boundaries

```text
src/
├── app/                       # Next.js Web adapters / composition
├── components/
│   ├── ui/                    # shadcn/ui primitives
│   └── knowledge/             # Knowledge presentation
├── modules/
│   ├── identity/
│   │   ├── domain/
│   │   ├── application/
│   │   └── ports/
│   ├── workspaces/
│   │   ├── domain/
│   │   ├── application/
│   │   └── ports/
│   ├── knowledge/
│   │   ├── domain/
│   │   ├── application/
│   │   └── ports/
│   └── sources/
│       ├── domain/
│       ├── application/
│       └── ports/
└── infrastructure/
    ├── database/mariadb/
    └── identity/
```

This is a responsibility layout, not a requirement for a separate file per operation. Phase 0 creates no empty `publishing/`, `retrieval/`, `agent/`, or `memory/` modules.

### 6.1 Identity and CallerContext

Identity answers only who the current caller is; it does not own Knowledge authorization policy.

```ts
type UserIdentity = {
  id: string;
  emp_id: string;
  name: string;
  org_code: string;
};

type CallerContext = {
  identity: UserIdentity;
};

interface IdentityProvider {
  getCurrentIdentity(): Promise<UserIdentity>;
}
```

`id` is the Hub's stable internal user ID; `emp_id` is the employee number; `name` is the person's name; `org_code` is the company organizational code. `org_code` does not directly determine which Workspaces the caller may read/write. The Local / Mock Identity Provider supplies trusted `UserIdentity` without directly depending on `UserRepository` or MariaDB; the application boundary ensures the minimal `users` record is synchronized to the canonical database when executing caller-aware operations. The server supplies test identities for external development.

Web/other transport adapters obtain trusted identity through `IdentityProvider`, create `CallerContext`, and pass it as the explicit first application-service argument. Application Core does not read callers from UI payloads or depend on ambient/global request identity. CallerContext does not carry a fixed single `workspace_id`, because one caller can access multiple Workspaces.

The future company adapter validates SSO tokens and maps them to the same four fields; the application boundary then synchronizes minimal local data. Other modules do not handle token formats, SSO SDKs, or provider details. Failure to obtain identity is reported as failure; client-provided employee numbers/orgs cannot replace trusted identity. Full enterprise sign-in and governance remain later work.

### 6.1A Workspaces

The Workspaces module owns Phase 0's minimal `Workspace` / `WorkspaceMembership` domain representation, repositories, and access-policy port. It provides at least:

```text
listWorkspaces(caller)
requireMembership(caller, workspaceId)
```

Phase 0 policy is only the local/mock MVP membership guard, not completed production role/capability authorization. Phase 3 must add Workspace provisioning/lifecycle, membership administration, roles/capabilities, Team/SSO Group mapping, required granular policy, and audit on the same resource boundary.

Knowledge/Source operations must not trust an additional caller-provided workspaceId as authorization proof. Existing-resource operations resolve `Source.workspace_id` through resource relationships before calling Workspace policy.

### 6.2 Knowledge

Owns Document, Revision, Tree, and lifecycle; provides application operations callable independently of Web, for example:

```text
getDocument(caller, ...)
getCurrentRevision(caller, ...)
listTree(caller, ...)
createHubManagedDocument(caller, ...)
createRevision(caller, ...)
moveTreeNode(caller, ...)
archiveDocument(caller, ...)
restoreDocument(caller, ...)
```

These are capability boundaries, not a complete set of HTTP endpoints specified here. Phase 0 implements the minimal operations and rules needed to verify the foundation; Phase 1 completes core product behavior.

Knowledge knows nothing of Folder scanning, LLM Wiki formats, external publishing APIs, MCP protocol, Elasticsearch, or Company SSO. It reads/writes through repository ports without scattering SQL through application services.

Knowledge operations must resolve resource scope and pass Workspace access policy before evaluating Source ownership/lifecycle. They cannot trust UI claims about workspace/ownership/editability or depend backward on Sources scanning/sync implementations. Cross-module FKs express data integrity, not reverse code dependencies.

### 6.3 Sources

Owns KnowledgeSource, SourceEntry, asset metadata, and SyncRun. Phase 2's scanner, snapshot, diff, preview, and apply orchestration belong within Sources.

KnowledgeSource must store `workspace_id`; Sources resolves its Workspace but cannot treat ordinary sync/rename/move as a Workspace transfer. Source sync must first pass the target Source's Workspace policy, then update documents/revisions/Tree/lifecycle through Knowledge application operations, without bypassing Knowledge rules by modifying its tables directly. Sources manages SourceEntry and Source sync state itself.

```text
SourceSyncApplicationService
  ├── CallerContext
  ├── Workspace access policy
  ├── Knowledge application operations
  ├── SourceRepository / SourceEntry mapping
  └── SyncRun recording
       └── the same canonical-state transaction
```

### 6.4 Repository, Transaction Ports, and Isolation

MariaDB infrastructure implements Knowledge document/revision/tree repositories, Workspaces repositories/policy, and Sources repositories. Application defines transaction boundaries; repositories and Knowledge operations participating in one canonical mutation share that transaction and cannot commit independently early.

Canonical Knowledge mutation transactions uniformly use **READ COMMITTED** isolation. MariaDB UoW sets isolation before starting the transaction, then follows begin → callback → assertions → commit. Source/Document `SELECT ... FOR UPDATE` locking reads remain necessary for concurrency correctness; READ COMMITTED avoids depending on the implicit premise that the locking read must be the first transaction statement, which refactoring could easily break.

Repository boundaries isolate SQL for testing and explicit transaction management; they do not build a generic database abstraction supporting MongoDB/PostgreSQL/MariaDB simultaneously.

### 6.5 Dependency Direction

```text
Identity ──► CallerContext ──► Application Services
Workspaces ──► Workspace access policy / queries
Sources ──► Knowledge

Future:
Publishing ──► Knowledge
Retrieval  ──► Knowledge
Agent      ──► Knowledge / Retrieval
```

Knowledge does not depend backward on Sources ingestion, Publishing, MCP, or Elasticsearch. Future adapters must share document queries, current revision resolution, archive filtering, and Workspace authorization boundaries, without rewriting parallel Knowledge logic.

## 7. Transactions, Errors, and Sync Safety

### 7.1 Hub-managed Creation and Modification

Creating a basic document is an atomic READ COMMITTED operation:

```text
resolve Source → Workspace
require Workspace membership/access
SET TRANSACTION ISOLATION LEVEL READ COMMITTED
BEGIN
  lock Source / validate source policy
  create KnowledgeDocument
  create immutable KnowledgeRevision R1
  set current_revision_id = R1
  create DOCUMENT TreeNode
COMMIT
```

Any failed step rolls back everything, leaving no orphan Document, Revision, or TreeNode. Content changes also write the new Revision and update the current pointer in one transaction. Archive/restore/hierarchy operations consistently update affected canonical records and lifecycle provenance.

### 7.2 Folder Sync Contract: Implemented in Phase 2

```text
Select Workspace
  → Select Folder (not ZIP)
  → Scan / Parse, preserving relative paths
  → Build Snapshot
  → Preview
  → User Confirm
  → Create Source in selected Workspace or validate existing Source
  → Version validation + Transaction Apply
```

For the first upload, the user explicitly selects an accessible Workspace before creating a new KnowledgeSource; the folder name is only an editable default display name. Subsequent sync requires explicit selection of an existing `source_id`; its existing Source relationship determines Workspace, and sync must not accept `target_workspace_id` to perform an implicit transfer.

“First upload creates a Source” does not mean selecting a folder immediately writes Knowledge. Preview may carry proposed Source data; the first canonical Source and its knowledge data should be created at the Apply boundary after Confirm, preventing Preview from leaving partial canonical state. This clarifies the rule that Preview does not modify canonical data, without adding a new source flow.

Markdown is parsed into Knowledge; Folders express hierarchy; assets record only metadata/reference. Scanning, parsing, and snapshot preparation finish before the Apply transaction. Phase 2 parser/import design also defines SOURCE_MANAGED canonical title resolution (frontmatter/heading/filename precedence and conflicts); Phase 0 does not infer it.

Preview lists expected `NEW / UPDATED / MOVED / RENAMED / ARCHIVED / RESTORED / UNCHANGED` changes; MVP requires no complex diff editor. Restore is the lifecycle effect of the same entry reappearing; Preview must show it rather than silently creating a new document.

### 7.3 Read-only Preview and Confirmation Data

The preview contract for an existing Source includes at least:

```text
source_id
based_on_version
snapshot_hash
changes
expires_at
```

Preview creates no Revision, archives no Document, moves no Tree, modifies no SourceEntry, and does not increment `sync_version`. `PREVIEWED` operation records and temporary previews are process data; storing them does not permit canonical Knowledge modification.

`sync_preview` is a logical data contract here, not an eleventh table Phase 0 must create. A new Source with no committed version cannot borrow the existing-Source version validation flow; Phase 2 handles first creation and existing Source sync separately.

Confirm must correspond to the snapshot and changes the user saw. `snapshot_hash` binds that content; another upload cannot replace confirmed changes. Reject expired previews and require regeneration; Phase 2 designs storage, expiration values, and transport, rather than making them Phase 0 prerequisites.

### 7.4 Optimistic `sync_version`

KnowledgeSource stores `sync_version`. Preview reads the current version as `based_on_version`; Apply for an existing Source must atomically validate within the same transaction:

```text
current Source.sync_version == Preview.based_on_version
```

Only equal versions permit writes and `sync_version += 1` on successful Apply. Reject old previews if versions differ and require a new Preview; MVP does not merge. Reading the version once outside the transaction before writing is insufficient; competing Applies must not both commit successfully against the same version.

For example, A and B both preview version 12. Once B successfully applies version 13, A's Confirm must fail without overwriting B. Failure/rollback does not increment the version.

### 7.5 Atomic Apply and SyncRun

```text
require Workspace access for Source.workspace_id
SET TRANSACTION ISOLATION LEVEL READ COMMITTED
BEGIN
  validate / guard Source version
  apply confirmed creates / content changes / hierarchy changes
  apply archives / restores + lifecycle provenance
  update SourceEntry mapping and asset metadata as required
  advance Source.sync_version
  record SyncRun APPLIED with result_version
COMMIT
```

All changes succeed or fail together. If change 32 of 50 fails, the first 31 also roll back; MVP has no partial success.

`sync_runs` stores `PREVIEWED / APPLIED / FAILED`, trigger actor, source, base/result version, summary, and start/completion times. An unsuccessful run has no successful `result_version`.

If Apply fails, roll back the entire canonical-state transaction first, then store `FAILED` in a separate recording transaction. A rolled-back transaction cannot retain failure records; if recording also fails, still report Apply failure without claiming success or retaining partial Knowledge updates.

### 7.6 Idempotency

When the same folder content is synced again and all changes are `UNCHANGED`:

```text
0 new revisions
0 tree changes
0 archives
```

This is a Knowledge-state NOOP. The original conversation also confirmed that each successful Apply increments sync_version; therefore if the user still Confirms and Apply succeeds, an all-unchanged run still records the operation and increments the source version, without creating content versions. This distinguishes sync operation versions from document revisions and prevents conflicting rules.

After successful Apply, an old Preview no longer matches its based-on version; resending Confirm cannot apply it again. This does not require Phase 0 to implement a complete request-idempotency platform.

### 7.7 Error boundary

| Error scenario | Required behavior |
| --- | --- |
| Identity retrieval fails | Do not execute caller-required operations; report identity error |
| Workspace membership/access absent | Deny operation without leaking Source/Document content in that Workspace |
| Document / Source absent or invalid reference | Deny operation without leaving partial data |
| Hub attempts to modify SOURCE_MANAGED documents/hierarchy | Application denies; UI read-only behavior alone is insufficient |
| Preview expired, content mismatch, or changed Source version | Do not Apply; prompt for a new Preview |
| Domain invariant or DB constraint fails | Roll back all canonical writes in the operation |
| Sync Apply fails midway | Roll back everything, separately store FAILED, allow new Preview/Apply |
| External system fails | Do not claim MariaDB rollback can undo external side effects |

Domain/application reports semantic failures; Next.js adapters convert them to Web-appropriate results. UI shows failures with clear retry directions. This spec adds no unconfirmed HTTP status-code list or generic error framework.

### 7.8 External Side Effects

External APIs do not participate in MariaDB transactions. Future external publishing or index updates follow:

```text
local MariaDB transaction → commit
  → explicit / background external operation
  → record external result
```

Do not call external publishing in a DB transaction and claim DB rollback can undo publication. This phase establishes only the boundary, without building workers, queues, outboxes, or external adapters.

## 8. Testing Strategy

Tests are organized as Unit → Application / Domain Integration → Small E2E Smoke. Phase 0 does not require full Folder Upload Sync E2E.

### 8.1 Unit tests

Verify with pure domain inputs:

- Path rename/move/reorder creates no revision; title/Markdown/knowledge metadata changes create revisions.
- Identical versioned content creates no revision; old Revisions remain unchanged.
- SOURCE_MANAGED denies Hub editing; HUB_MANAGED allows content updates via new revisions.
- ACTIVE/ARCHIVED default visibility, archive/restore rules, and current `archived_by`/`archived_at` provenance.
- Reappearance identified as the same SourceEntry retains Document ID, creating a revision only for different content.
- Tree node type, Document reference, one-document-one-treenode, and valid hierarchy rules.
- Public application read/write contracts explicitly receive `CallerContext`, without obtaining caller from input payloads.
- Workspace access and Source ownership are separate; `org_code` is no allow/deny shortcut.

Reappearance and ownership tests may use fixtures with established mappings/source policies; Phase 0 need not implement a Folder scanner, title resolution, or rename detection engine.

### 8.2 MariaDB 10.11 integration tests

Verify repositories and transactions with real MariaDB 10.11; passing an in-memory database is no substitute:

| Test | Must demonstrate |
| --- | --- |
| Empty DB migration | Ten domain tables, native UUID fields, and required constraints can be created |
| Workspace membership | One user can join multiple Workspaces; cross-org members can access; same-org non-members are denied |
| Source Workspace scope | Sources cannot exist without valid workspace_id; resource UUIDs do not bypass Workspace policy |
| Document + Revision + TreeNode creation | Commit only if all succeed; current pointer is valid on success |
| Stepwise failure injection | Failure at any creation step leaves no orphan data |
| Revision pointer | Absent revisions or revisions of another Document cannot become current |
| Document Tree uniqueness | DB/application rejects a second DOCUMENT TreeNode for the same Document |
| Uniqueness and mapping | No duplicate allocation of revision_no within a document or an identified source identity |
| Archive/restore | History/mapping retained; related lifecycle and provenance consistent |
| READ COMMITTED + row locks | Tree/revision concurrency across two connections does not depend on an old consistent-read snapshot; verify latest committed state after Source/Document locking |
| Source version contention | At most one competing transaction with the same base version succeeds; the other leaves no writes |
| Rollback of multiple canonical writes | Cross-repository changes sharing one transaction all roll back; version does not advance |

Phase 0 transaction fixtures verify atomicity and version guards required by future Sync; Phase 2 completes end-to-end verification of full diff computation, Preview storage, Title Resolution, first folder creation, and FAILED run flows.

### 8.3 Small E2E smoke

```text
Open Knowledge Hub
  → Local identity available
  → list caller-visible Workspaces
  → select Workspace
  → select Source
  → Create / read one basic HUB_MANAGED document
  → Browse its Folder / Document tree
```

This minimal flow verifies that Web → trusted CallerContext → Workspace policy → application services → repositories → MariaDB is connected. A basic form or minimal content input suffices; the smoke flow introduces no rich editor, single-upload product flow, drag-and-drop, or search engine.

### 8.4 Additional Tests in Later Phases

Phase 1 expands core and full Tree behavior; Phase 2 verifies folder scanning, Title Resolution, mapping ambiguity, Preview/Confirm content binding, expiration, first creation, diff, complete rollback, FAILED runs, repeated-sync NOOP, and full Folder Upload E2E. Phase 3 adds production Workspace lifecycle/administration, role/capability, Team/SSO mapping, and audit tests. Later authoring, publishing, MCP, and retrieval phases each reuse these invariants.

## 9. Phase 0 Definition of Done

The following are acceptance criteria for future Phase 0 implementation; delivering this document does not mean they are complete.

| Category | All required for completion |
| --- | --- |
| Architecture | Next.js modular monolith starts; TypeScript/Tailwind/shadcn/ui baseline usable; no excluded dependencies introduced |
| Module boundaries | Clear identity/workspaces/knowledge/sources responsibilities; Domain, Application, Infrastructure layers; Web does not directly modify DB; no empty future modules |
| Identity | Four-field UserIdentity, CallerContext, and IdentityProvider contracts usable; Local provider supports external development; org_code only an identity attribute; application independent of token details |
| Workspace foundation | workspaces / workspace_memberships schema and repository/policy usable; tests establish cross-org member allow, same-org non-member deny, multi-workspace users, and direct-resource bypass prevention |
| Database | Local MariaDB 10.11 starts; migration creates ten domain tables, native UUID IDs, and required constraints from an empty DB |
| Domain representation | Workspace → Source → Tree, two ownership modes, stable Document ID, immutable Revision, SourceEntry, two-state lifecycle/provenance, and metadata-only assets all represented in schema/domain |
| Transactions | Canonical mutation uses READ COMMITTED; minimal creation, revision updates, and related lifecycle operations have correct transaction boundaries; cross-repository shared transactions usable |
| Sync foundation | Source.sync_version and SyncRun schema exist; optimistic-guard contention and rollback tests pass; full Folder Sync not required |
| Integrity | Constraints and tests establish same-document current revision, one-document-one-treenode, node type/reference, mapping uniqueness, etc.; MVP exposes no hard delete |
| Testing | This spec's Phase 0 unit, MariaDB integration, and small E2E smoke tests runnable and passing |
| Agent readiness | Non-Web callers can invoke application services through CallerContext; future MCP can reuse core/query/Workspace policy independently of pages/components; Phase 0 has no MCP implementation or Agent actor model |
| Handoff | Implementation provides verification evidence against this spec, without misreporting Phase 3 production governance or later features as completed Phase 0 work |

## 10. Future Phase Interfaces

The following reserve responsibilities and contracts, without precommitting full API signatures, protocol payloads, or future packages.

| Phase | Continuing work | Phase 0 integration points and constraints |
| --- | --- | --- |
| 1 — Knowledge Core & Tree | Full core operations, Tree, and version capabilities | Workspace/Membership foundation, Document/Revision/Tree repositories, stable UUIDv7 IDs, CallerContext, lifecycle invariants |
| 2 — Knowledge Source Import & Sync | Generic Markdown Folder adapter, scan/snapshot/mapping/diff/preview/apply, Title Resolution | Select target Workspace for new Source; Sources → Knowledge application operations; SourceEntry, asset metadata, SyncRun, source version, shared transaction; folder upload rather than ZIP; filename/path does not automatically become canonical title |
| 3 — Identity & Basic Governance | Workspace provisioning/create, rename, archive/restore, membership administration, roles/capabilities, Team/SSO Group mapping, required policy/audit, and company SSO | Four UserIdentity fields, existing CallerContext, Workspace/Membership foundation, policy port; Phase 3 does not turn org_code back into Knowledge ACL; MVP provides no Workspace hard delete |
| 4 — Discovery & Read API | Keyword/metadata search, filters, document/revision reads | Workspace-aware Knowledge query application boundary; shared current revision, archive filtering, and CallerContext |
| 5 — Human Authoring | Single upload, Web editor, and full revision flow | Workspace capability + writable HUB_MANAGED, read-only SOURCE_MANAGED; content updates create immutable revisions |
| 6 — External Publishing | Separate Publishing Tree, external mapping, and publishing flow | Reference stable Knowledge IDs/Revisions and verify the source Workspace policy; Phase 6 designs Publishing Tree scope |
| 7 — Agent & MCP Access | MCP adapter, Agent callers, and required Principal/Actor extensions | Use the same application/query services, CallerContext, and Workspace policy; arbitrary workspace_id/org_code is not authorization proof; design Principal if Agent writes are needed |
| 8 — Semantic & Hybrid Retrieval | Chunking, embedding, derived indexes, hybrid search | MariaDB Knowledge + Workspace governance remain canonical; select retrieval backend in this phase; core independent of index technology |
| 9 — Agent Memory & Knowledge Relations | Memory, relations, context, and promotion | Separate domain connects through stable document/revision references; Agent Memory scope does not automatically equal Workspace |

Phase 2 must design matching/ambiguity handling without stable external IDs, Title Resolution, parser/hash normalization, preview storage/expiration, and first/existing-source flow details. These explicitly belong to Phase 2; unconfirmed answers cannot masquerade as approved decisions here, and they do not block Phase 0 foundation acceptance.

## 11. Architecture Decision Records

The ADRs below collect accepted decisions; ADR-001–003 retain the original conversation numbers, and the rest are this document's index. The Workspace access-boundary correction is integrated into ADR-004; see ADR-018 in the Workspace amendment for detailed history.

### ADR-001 — MariaDB 10.11 as Canonical Datastore

- **Context:** Knowledge, Revision, Source, and Tree need relational consistency; near-term phases do not depend on semantic search.
- **Decision:** Use MariaDB 10.11; defer Vector/Semantic backend selection to Phase 8; search indexes must not become canonical Knowledge.
- **Consequences:** Phase 0 introduces no PostgreSQL, MongoDB, Elasticsearch, or vector infrastructure; repositories do not form a generic multi-DB platform.

### ADR-002 — Next.js Modular Monolith

- **Context:** MVP modules share core data and transactions; no service-splitting requirement exists yet.
- **Decision:** Next.js provides both Web and server application; code modules isolate domains while retaining monolithic deployment.
- **Consequences:** Thin Web adapters; UI-independent core; future consumers share application services.

### ADR-003 — Tailwind CSS + shadcn/ui

- **Context:** Knowledge Workspace needs a composable, customizable UI foundation.
- **Decision:** Use React, TypeScript, Tailwind CSS, shadcn/ui; the original selection defaults toward Base UI, with components added as needed.
- **Consequences:** Do not retain Refine/Outline architecture or preinstall Redux, Tiptap, dnd-kit, or a complete dashboard template.

### ADR-004 — Source-agnostic and Workspace/Source Boundaries (revised by ADR-018)

- **Context:** Teams use different LLM Wiki generators, and project members spanning company organizations may need shared access to the same Knowledge.
- **Decision:** Retain `User.org_code` as an identity attribute; Knowledge hierarchy uses `Workspace → KnowledgeSource → Folder / Document Tree`; WorkspaceMembership establishes basic access scope; each Source has one Workspace and every Document has a Source.
- **Consequences:** No binding to Obsidian format; same org does not automatically authorize, cross org does not automatically deny; separate Source content ownership from Workspace access; full Workspace lifecycle/roles/governance belongs to Phase 3.

### ADR-005 — Explicit Source-managed / Hub-managed Distinction

- **Context:** Simultaneous writes from external folders and Hub cause sync conflicts.
- **Decision:** FOLDER_SYNC is SOURCE_MANAGED and read-only in Hub; FILE_UPLOAD/HUB are HUB_MANAGED and can create new content versions.
- **Consequences:** No bidirectional sync/merge; single uploads do not automatically overwrite folder documents.

### ADR-006 — Separate Tree, Document, and Revision

- **Context:** File moves and content updates have different semantics; references must not change with paths.
- **Decision:** Tree owns location, Document owns stable identity, Revision stores immutable title/Markdown/metadata.
- **Consequences:** Folder is no empty document; path rename/move creates no revision, title changes do; Phase 2 determines source title resolution.

### ADR-007 — SourceEntry Stores Source Mapping

- **Context:** External sources may not provide stable IDs.
- **Decision:** Prefer external stable IDs; otherwise Hub maintains SourceEntry mapping; path is a locator.
- **Consequences:** Generators need not provide a specific frontmatter ID; Phase 2 defines the concrete fallback algorithm.

### ADR-008 — Archive-only lifecycle + current provenance

- **Context:** Missing source files may be temporary; document references and revision history must remain; archive is MVP deletion semantics and must retain current actor/time provenance.
- **Decision:** Use ACTIVE/ARCHIVED; MVP has no hard delete; same-entry reappearance restores the original Document ID; lifecycle-bearing canonical entities store `updated_by`, `archived_by`, `archived_at`.
- **Consequences:** Default queries exclude archived; restore creates revisions only for content changes; Phase 3 owns full repeated-lifecycle audit history and separately designs Workspace lifecycle.

### ADR-009 — Metadata-only assets

- **Context:** MVP needs source information for Markdown images/attachments without expanding storage infrastructure.
- **Decision:** Store metadata/reference only, without persisting binaries.
- **Consequences:** Relative paths may remain; no claim of image/attachment serving; add a storage adapter later.

### ADR-010 — Folder Upload and Mandatory Preview/Confirm

- **Context:** Sync creates, modifies, moves, or archives multiple records; selecting a folder must not immediately rewrite data.
- **Decision:** Select an entire folder directly, without ZIP; first select Workspace then create Source; subsequent sync explicitly selects existing Source; always Preview → Confirm → Apply.
- **Consequences:** Preview does not modify canonical Knowledge; Source is Tree root; sync offers no implicit Workspace transfer; Phase 0 defines the contract, Phase 2 completes import/sync.

### ADR-011 — Atomic Sync and Optimistic Source Version

- **Context:** Stale previews and midway failures can break consistency.
- **Decision:** Validate base version with sync_version; one transaction for the entire Apply; rollback everything on failure and separately record FAILED.
- **Consequences:** No partial success or merge; identical content creates no revision; successful-operation source versions and content revisions are separate counts.

### ADR-012 — Minimal Identity, CallerContext, and Future SSO Adapter

- **Context:** External MVP development cannot depend on company SSO, but read/write services need stable caller-aware contracts.
- **Decision:** UserIdentity is fixed to id, emp_id, name, org_code; use Local/Mock providers; transport creates explicit `CallerContext` as the first application-service argument; future SSO maps to the same identity contract.
- **Consequences:** Core neither parses tokens nor depends on ambient request identity; org_code is not Knowledge ACL; Workspace policy uses resource scope; Phase 3 adds production governance without major caller-signature changes.

### ADR-013 — Human and Agent Share Application Core

- **Context:** Future MCP needs the same Knowledge and consistent query/policy behavior.
- **Decision:** Knowledge is independent of Web/MCP; Sources writes into core in one direction; future Publishing/Retrieval/Agent integrate through application services and share Workspace policy.
- **Consequences:** No parallel data-access logic; Phase 0 implements no MCP, Agent actor model, or empty future modules.

### ADR-014 — External Side Effects Isolated from DB Transactions

- **Context:** MariaDB rollback cannot undo external publishing or index updates.
- **Decision:** Commit local state first, then perform explicit/background external operations and store results.
- **Consequences:** Phase 0 introduces no external publishing, index worker, queue, or outbox implementation.

### ADR-015 — UUIDv7 + MariaDB native UUID

- **Context:** `CHAR(36)` random UUID enlarges InnoDB PK/secondary-index footprint and has poorer random-key locality; before tables exist, adjustment cost is lowest.
- **Decision:** Application generates UUIDv7; MariaDB 10.11 uses native `UUID`.
- **Consequences:** All stable entity ID/FK types are consistent, without manually managing BINARY byte order or depending on a DB-side UUIDv7 function. WorkspaceMembership uses an association composite key.

### ADR-016 — READ COMMITTED canonical transactions

- **Context:** Tree/revision concurrency relies on locking reads; correctness cannot depend on implicit operation ordering around an old REPEATABLE READ consistent snapshot.
- **Decision:** Canonical Knowledge/Sources mutation UoW uses READ COMMITTED and retains Source/Document `FOR UPDATE` locks.
- **Consequences:** Tests must use two real MariaDB connections to verify the latest committed state after locking; mocks or one connection cannot substitute.

### ADR-017 — One Document, One Knowledge TreeNode

- **Context:** If stable Document identity can appear in multiple DOCUMENT TreeNodes simultaneously, move, archive, and SourceEntry mapping semantics become ambiguous.
- **Decision:** Establish UNIQUE protection on non-NULL `knowledge_tree_nodes.document_id`.
- **Consequences:** Folder NULLs remain unrestricted; Document move updates the same node rather than deleting and creating a second node.

## 12. Self-review and Decision Traceability

### 12.1 Review Results

| Review aspect | Results and completed clarifications |
| --- | --- |
| Workspace canonical truth | This spec directly uses Workspace → Source → Tree; readers need not overlay the amendment on an active org/source contract here |
| Organization responsibility | `org_code` is only User identity / governance input; same org != allow, cross org != deny |
| Workspace lifecycle owner | Phase 3 explicitly owns provisioning/create, rename, archive/restore, membership/role administration; Phase 0 builds only the foundation |
| Undecided placeholders | No blank sections awaiting content; unapproved implementation choices explicitly belong to the implementation plan or corresponding phase, without pretending they are decided |
| Old architecture conflicts | New spec uses the confirmed stack, without retaining old HRKM Refine dependencies; early PostgreSQL/Elasticsearch suggestions are not Phase 0 decisions |
| Rename and title | Explicitly distinguishes hierarchy rename from versioned title changes; SOURCE_MANAGED Title Resolution explicitly belongs to Phase 2 |
| Ownership storage | Source is the sole content-ownership authority, without a duplicate on Document; Source workspace scope and ownership are separate |
| SOURCE_MANAGED read-only | Distinguishes Hub editing from controlled sync updates; application layer enforces rules |
| Caller boundary | UserIdentity retains four fields; CallerContext explicitly passed to application services; Workspace policy validates resource scope |
| Actor model | Phase 0–2 lifecycle/created references still point to users; no premature actor_kind/polymorphic FK |
| ID storage | UUIDv7 + MariaDB native UUID; no CHAR(36) random UUID |
| Transaction isolation | Canonical mutation explicitly requires READ COMMITTED and retains Source/Document row locks |
| Tree uniqueness | one-document-one-treenode becomes a Phase 0 DB invariant early |
| Lifecycle provenance | ACTIVE/ARCHIVED retain two states; lifecycle fields store current archive actor/time; full event history belongs to Phase 3 |
| Read-only Preview and PREVIEWED records | Distinguishes canonical state from process records; first Source leaves no partial canonical data when selecting a folder |
| FAILED and rollback | FAILED records stored separately after main transaction rollback, without depending on the rolled-back transaction |
| NOOP and sync_version | NOOP means no content/Tree/archive change; successful Apply still stores a run and increments source version |
| Schema and phase scope | Ten domain tables; sync_runs schema in Phase 0, full operation flow in Phase 2; preview contract requires no extra table |
| SourceEntry identity | Does not treat path/hash as stable document IDs or claim automatic matching without IDs is solved |
| Module direction | Workspaces/Source scope and ownership-policy data are separate from dependencies on Sources ingestion implementation; Knowledge does not depend backward on the sync engine |
| Assets | Metadata/reference explicitly separate from binary serving; no implicit filesystem storage |
| Testing and DoD | Phase 0 acceptance uses domain/Workspace access/transaction fixtures and minimal smoke, without requiring full governance, authoring, or sync UI |
| Scope expansion | No new SSO, full ACL platform, ZIP, editor, publishing, MCP, search/vector, memory, queue, Agent actor model, or hard-delete implementation |

### 12.2 Decision Source Cross-reference

All references below can be checked in the original conversation and Workspace amendment linked at the top:

| Confirmed discussion | Location in this spec |
| --- | --- |
| MariaDB 10.11, Next.js modular monolith, use of shadcn | §3；ADR-001～003 |
| UUIDv7, native UUID, and transaction isolation clarification | §3.1, §6.4, §7；ADR-015～016 |
| Organization identity and Workspace access boundary, cross-org collaboration | §4.1, §5, §6.1A；ADR-004/018 |
| Read-only Folder, editable single uploads/Web creation | §4.2；ADR-005 |
| Tree/Document/Revision, SourceEntry, versioned title/Markdown/metadata | §4.3～4.4, §5；ADR-006～007, 017 |
| No hard delete, same-entry reappearance retains ID, lifecycle provenance, asset metadata only | §4.5～4.6；ADR-008～009 |
| Folder rather than ZIP, first Workspace selection/Source creation, subsequent source selection, mandatory Preview | §7.2～7.3；ADR-010 |
| Application / Module Boundary, CallerContext, Workspace policy | §6；ADR-012～013, 018 |
| Transaction / Error Boundary + Sync Safety Baseline | §7；ADR-011, 014, 016 |
| Identity reduced to four fields, external mock, company SSO added later | §6.1；ADR-012 |
| Testing Strategy + Definition of Done | §8～9 |

This delivery is the current canonical Markdown Design Spec and self-review for these decisions. The subsequent Implementation Plan should break down work and verification steps according to this spec, without equating document completion with completed Phase 0 code implementation.
