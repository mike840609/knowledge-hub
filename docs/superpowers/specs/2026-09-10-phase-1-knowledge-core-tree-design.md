# Knowledge Hub — Phase 1 Knowledge Core & Tree Design

**English** | [繁體中文](2026-09-10-phase-1-knowledge-core-tree-design.zh-TW.md)

| Item | Content |
| --- | --- |
| Date | 2026-09-10 |
| Phase | 1 |
| Name | Knowledge Core & Tree |
| Status | Approved Design; Phase 0 Workspace foundation integrated |
| Prerequisite | Phase 0 Foundation & Architecture |
| Next | Phase 2 Knowledge Source Import & Sync |

## 1. Goal

Phase 1 gives Knowledge Hub a complete, reliable Knowledge Core independent of ingestion, Web UI, and MCP, inheriting Phase 0's Workspace access foundation.

After completion, the system must guarantee:

```text
User
  └── WorkspaceMembership
          ↓
      Workspace
          └── KnowledgeSource
               └── Knowledge Tree
                    ├── Folder
                    └── Document
                         └── immutable Revisions
```

Where:

- `User.org_code` = company organizational identity attribute, not a direct Knowledge ACL.
- Workspace = Knowledge container + basic access scope。
- WorkspaceMembership = Phase 0–2 local/mock access foundation。
- Source = source scope, content ownership, and source boundary; each Source belongs to one Workspace.
- Tree = where the document currently resides.
- Document = stable document identity.
- Revision = document content version.
- SourceEntry = mapping between external source identity and Hub object.

Document ID does not change with rename, move, archive, restore, Workspace navigation state, or revision. Document does not redundantly store `workspace_id`; scope derives through `Document → Source → Workspace`.

Phase 1 inherits Phase 0's fixed foundation contracts: Workspace/WorkspaceMembership, `knowledge_sources.workspace_id`, application-generated UUIDv7 + MariaDB native `UUID`, explicit `CallerContext`, canonical mutation `READ COMMITTED` transactions, current lifecycle provenance, and one-document-one-TreeNode uniqueness. It completes full Knowledge behavior without reinventing those rules.

## 2. Phase 1 Scope

### 2.1 In Scope

Phase 1 completes:

- KnowledgeSource core behavior, with Workspace as Source scope.
- KnowledgeDocument lifecycle。
- Immutable KnowledgeRevision。
- Knowledge Tree。
- Folder / Document hierarchy。
- Stable Document identity。
- SourceEntry mapping contract。
- Archive / restore and current lifecycle provenance.
- Move / reorder。
- Revision history。
- Current revision resolution。
- Archived filtering。
- SOURCE_MANAGED / HUB_MANAGED mutation guard。
- Consistent Workspace membership foundation in read/write application services.
- Transactional invariants。
- Concurrency protection。
- Caller-aware read/write application services。
- Read-only Knowledge Browser：Workspace → Source → Tree → Document/Revision。

### 2.2 Out of Scope

Phase 1 does not implement:

- Folder upload / scanning。
- Folder Sync。
- Preview / Confirm / Apply。
- Diff algorithm。
- Rename detection algorithm。
- SOURCE_MANAGED Title Resolution / Markdown parser。
- Workspace provisioning/create/rename/archive/restore administration UI.
- Workspace roles/capabilities、membership administration、Team/SSO Group mapping、granular ACL。
- Rich text editor。
- Web authoring。
- Keyword search。
- Embedding / vector search。
- Company SSO。
- external publishing publishing。
- MCP。
- Agent actor / Principal model。
- Agent Memory。

Workspace administration and production governance belong to Phase 3; Phase 1 only consumes Phase 0's membership foundation.

## 3. Architecture Decision

### 3.1 Option A — CRUD Core

Add directly to Phase 0 repositories:

```text
createDocument()
updateDocument()
moveNode()
archiveDocument()
```

This is simple, but Phase 2 could easily evolve into:

```text
Sync Service
   ↓
directly modify Knowledge tables
```

This would let Folder Sync bypass Knowledge invariants and Workspace policy, so it is rejected.

### 3.2 Option B — Domain Commands + Mutation Authority Separation

Use:

```text
                    Workspace Access Policy
                             │
                             ▼
                    Knowledge Core
                         │
        ┌────────────────┴────────────────┐
        │                                 │
HubKnowledgeCommands             SourceProjectionCommands
        │                                 │
HUB_MANAGED                      SOURCE_MANAGED
        │                                 │
Phase 5 Web Authoring             Phase 2 Folder Sync
```

Both sides share:

```text
CallerContext
Workspace scope/policy
Document
Revision
Tree
Lifecycle
Repositories
READ COMMITTED Transactions
```

SOURCE_MANAGED offers no escape hatches such as `force=true` or `bypassOwnership=true`.

### 3.3 Decision

Choose Option B.

Phase 2 therefore forms:

```text
Authorized Workspace
 ↓
Folder
 ↓
Scanner
 ↓
Snapshot
 ↓
Diff
 ↓
SourceProjectionCommands
 ↓
Knowledge Core
```

Rather than building separate Knowledge mutation logic.

## 4. Core Domain Model

```text
Workspace
│
└── KnowledgeSource
    │
    ├── SourceEntry
    │
    └── KnowledgeTreeNode
         │
         ├── FOLDER
         │
         └── DOCUMENT
               │
               └── KnowledgeDocument
                    │
                    ├── Revision 1
                    ├── Revision 2
                    └── Revision N ← current_revision_id
```

Source itself is its Tree root, with no synthetic root folder; Workspace is a Source container, not a TreeNode.

For example:

```text
Workspace: Query Master
└── Source: Obsidian Wiki
    ├── Architecture
    │   ├── Overview.md
    │   └── Database.md
    └── Runbooks
        └── Deployment.md
```

## 5. Schema Refinement

Retain Phase 0's ten domain tables: the original eight Knowledge/Source tables plus `workspaces` and `workspace_memberships`. All stable entity IDs use MariaDB native `UUID`; `knowledge_sources.workspace_id` is the authoritative Source Workspace scope; Document TreeNode uniqueness and lifecycle provenance are already foundation contracts. Phase 1 does not redo foundation schema, adding only necessary stable SourceEntry-to-TreeNode mapping.

### 5.1 Add `tree_node_id` to SourceEntry

Phase 0 `source_entries` mainly contains:

```text
source_entries
├── source_id
├── external_id
├── source_path
├── document_id
└── ...
```

Phase 1 adds:

```text
tree_node_id nullable FK → knowledge_tree_nodes.id
```

The field type follows Phase 0's native `UUID` contract.

A Folder itself has no Document.

With only:

```text
Folder SourceEntry
source_path = docs/backend
document_id = null
```

When a folder is renamed:

```text
docs/backend
→
docs/server
```

The system has no stable reference to the original TreeNode.

After adding the mapping:

```text
SourceEntry
   │
   └── tree_node_id
          ↓
     TreeNode #abc
```

Path changes but TreeNode identity stays unchanged.

### 5.2 SourceEntry invariants

FOLDER entry：

```text
entry_type = FOLDER
tree_node_id = required
document_id = null

tree_node.node_type = FOLDER
tree_node.source_id = source_entry.source_id
```

DOCUMENT entry：

```text
entry_type = DOCUMENT
tree_node_id = required
document_id = required

tree_node.node_type = DOCUMENT
tree_node.document_id = source_entry.document_id
```

Hub-native documents may have no SourceEntry. SourceEntry is source mapping, not Knowledge identity.

### 5.3 Phase 0 Data Upgrade

Upgrade has three stages: fixed DDL, separate data backfill, fixed constraints. 001–003 and their checksums remain unchanged; clearing data is not the normal upgrade path.

1. Stop canonical writes and back up. Separate `scripts/db/backfill-source-tree-mapping.ts` first inventories ACTIVE/ARCHIVED entries in dry-run mode. DOCUMENT maps `(source_id, document_id)` to the unique existing DOCUMENT node; for FOLDER, the operator supplies a JSON entry ID → existing Folder TreeNode ID mapping. Verify completeness, same Source, types, document equality, and no duplicate nodes; do not guess from path/name/hash or create replacement nodes. A mismatched preflight changes neither data nor schema.
2. Fixed migration `004-phase-1-tree-mapping.ts` only adds nullable `tree_node_id UUID`, containing no environment data. Extend the runner with target-version support: load the full manifest to validate the existing ledger, but execute only through the target. Do not truncate the manifest, which would misclassify newer applied versions as unknown. Clearly reject targets below applied versions without rollback.
3. The same separate script backfills through parameterized SQL in one DML transaction; input does not enter the migration manifest, statements, or checksum. Correctly backfilled rows are NOOP; reject inconsistent existing mappings without overwriting. Both execution and dry-run revalidate all mappings; failure rolls back the entire DML transaction.
4. Fixed migration `005-phase-1-tree-mapping-constraints.ts` tightens `tree_node_id NOT NULL`, adding same-source FK and `UNIQUE(source_id, tree_node_id)`. DOCUMENT equality is protected by `(document_id, tree_node_id)` FK → TreeNode `(document_id, id)`, explicitly adding `UNIQUE(document_id, id)` as the referenced key; retain original `UNIQUE(document_id)` because the two serve different purposes. Folder document_id=NULL skips this FK tuple check, so application assertions verify Folder entries point to FOLDER nodes; preflight also checks every existing row. Existing CHECK protects entry type/document null shape.
5. Add an optional `beforeApply` hook to the Migration type (fixed code receiving a read-only query contract on the runner's same connection). 005 installs a mapping-readiness hook, called within the migration lock before writing RUNNING ledger. Checksum still hashes only statements; the hook accepts no operator input, writes no data, and creates no dynamic manifest. Execute a fixed read-only mapping-readiness gate (neither operator data nor dynamic statements). If incomplete, exit without adding 005 ledger; rerun after backfill. Ordinary migrate cannot skip backfill automatically or mark unready 005 FAILED. Empty DB uses the same 004/005 manifest and naturally passes the gate.

Planned commands (runnable only after Task 2 implements CLI support):

```sh
npm run db:migrate -- --to 4
npx tsx scripts/db/backfill-source-tree-mapping.ts --mapping /path/to/verified-mapping.json --dry-run
npx tsx scripts/db/backfill-source-tree-mapping.ts --mapping /path/to/verified-mapping.json --apply
npm run db:migrate -- --to 5
```


If populated DB still has entries to backfill, argument-free `npm run db:migrate` completes 004, then safely stops at the 005 gate; 004 stays APPLIED and 005 creates no ledger row. This is an expected recoverable stop: backfill and rerun, without repairing checksum or ledger. With no pending entries it passes directly. Tests must cover this argument-free path.

Step 1 may run the same dry-run before first DDL; the script supports inventory before the field exists. Supply an empty mapping if there are no Folder entries. The backfill data transaction does not cover DDL; interrupted DDL follows FAILED/RUNNING diagnostics and explicit repair procedures, without blind reruns or changes to applied checksums.

Acceptance: populated 001–003 → 004 → backfill → 005, archived rows, Folder mappings, zero-change preflight, backfill rollback/rerun, 005 gate leaves ledger untouched, full-migrate reruns retain checksums, identical manifests for empty/populated DB, and interrupted-DDL diagnostics. All fixtures/seed/writers supply tree_node_id.

## 6. Tree Invariants

### 6.1 Document TreeNode

Each KnowledgeDocument has only one node in Knowledge Tree.

This invariant is now Phase 0 foundation: uniqueness protection on non-NULL `knowledge_tree_nodes.document_id`. Phase 1 must retain and verify it, without a second migration scheme or application-only validation replacing DB protection.

Document move is:

```text
UPDATE tree_node.parent_id
```

Rather than deleting the old node and creating a new one, so Document TreeNode identity also remains stable.

### 6.2 Folder TreeNode

Folder：

```text
document_id = null
name = required
```

Folder stores its own name.

### 6.3 Document display name

DOCUMENT nodes store no second title truth.

When displaying:

```text
TreeNode
 ↓
Document.current_revision_id
 ↓
KnowledgeRevision.title
```

Therefore:

```text
Folder rename
→ Tree change

Article title rename
→ Revision change
```

There are no two inconsistent title copies.

Valid rules for `knowledge_tree_nodes.name`:

```text
FOLDER → required
DOCUMENT → null
```

Phase 2 ingestion design still owns canonical title resolution from frontmatter, Markdown heading, or filename for SOURCE_MANAGED documents. Phase 1 only guarantees a canonical title change creates a new Revision; filename/path rename itself creates none.

## 7. Tree Operations

Phase 1 provides caller-aware operations:

```text
listTree(caller, sourceId)

createFolder(caller, ...)
moveTreeNode(caller, ...)
reorderTreeNode(caller, ...)

archiveFolder(caller, ...)
restoreFolder(caller, ...)

getAncestors(caller, ...)
```

Every Tree operation must verify:

- Caller comes from trusted `CallerContext`.
- Source exists and resolves authoritative `workspace_id`.
- Caller passes that Workspace's foundation access policy.
- Parent exists.
- Parent is FOLDER.
- parent ACTIVE。
- Parent and node are in the same Source.
- Node cannot move beneath itself.
- Node cannot move to a descendant.
- Document cannot move across Sources.
- Tree operations cannot change Source's Workspace.

The following operations are therefore forbidden:

```text
Source A / Document X
    ↓ move
Source B
```

And:

```text
Source A @ Workspace X
    ↓ ordinary move/sync
Workspace Y
```

Future cross-Source or cross-Workspace moves require explicit migration / transfer flows; ordinary tree moves cannot act as source transfers.

## 8. Tree Ordering

Phase 1 keeps it simple:

```text
position INT
```

Sibling query：

```text
ORDER BY position, id
```

Phase 1 introduces no Fractional indexing, LexoRank, or CRDT. Recompute affected sibling positions within move/reorder transactions.

## 9. Tree Concurrency

Tree mutations use Source-level serialization, and canonical mutation UoW inherits Phase 0's **READ COMMITTED** isolation.

Within READ COMMITTED UoW, resolve Source and acquire its lock first, perform access checks through WorkspaceAccessPolicy on the same connection, then validate hierarchy and write:

```sql
SELECT ...
FROM knowledge_sources
WHERE id = ?
FOR UPDATE;
```

Tree mutations of the same Source thus execute serially. READ COMMITTED prevents later ancestry/plain reads from depending on an earlier REPEATABLE READ consistent snapshot; `FOR UPDATE` row locks remain mandatory.

This prevents:

```text
A: folder1 → folder2
B: folder2 → folder1
```

Two concurrent requests independently passing validation and eventually forming a cycle. Different Sources may still operate concurrently. Lock-before-membership-check follows Phase 0; an unauthorized caller may briefly hold a Source lock as a tradeoff. Complete checks and failure rollback immediately without waiting for external I/O; Source lock is not membership lock and does not claim to solve future membership-revocation concurrency.

## 10. Revision Model

Revision stores:

```text
id
document_id
revision_no
title
markdown
metadata
content_hash
created_by
created_at
```

Revision is immutable after creation. Phase 0–2 `created_by` still points to trusted User identity; Phase 1 does not prematurely change it to polymorphic `actor_kind + actor_id`. If future Agents may write canonical Knowledge, the corresponding phase designs Principal/Actor.

There is no `updateRevision()`, only `createRevision()`.

## 11. Revision Creation

Flow:

```text
SET TRANSACTION ISOLATION LEVEL READ COMMITTED
BEGIN
resolve Document → Source → Workspace on this connection
lock Source
require transaction-scoped Workspace access
validate Source ownership/ACTIVE and Document ACTIVE
lock Document
validate expectedCurrentRevisionId
read current revision
normalize candidate content
compare canonical payloads using §13.1 compatibility rule

if unchanged:
    return current revision

insert Revision N+1
update Document.current_revision_id

COMMIT
```

Two concurrent writers do not create the same `revision_no`. DB also retains `UNIQUE(document_id, revision_no)` as database-level protection.

## 12. Revision Content Boundary

The following are versioned content:

```text
title
markdown
metadata
```

The following are not versioned content:

```text
path
filename
parent folder
position
source locator
workspace navigation state
archive status
```

| Change | New Revision |
| --- | ---: |
| Markdown | Yes |
| title | Yes |
| metadata | Yes |
| filename | No |
| folder rename | No |
| document move | No |
| reorder | No |
| archive | No |
| restore | No |

## 13. Content Hash

Phase 1 fixes the hash contract so Phase 2 does not invent its own.

```text
SHA-256(
  "knowledge-revision:v1\0" +
  canonical-json({
    title,
    markdown,
    metadata
  })
)
```

Normalization：

```text
title
→ trim
→ non-empty

markdown
→ CRLF → LF
→ leave other whitespace unchanged

metadata
→ JSON object
→ recursively sort keys
```

Do not include Markdown formatting or semantic normalization in hashing. Pure formatting differences may therefore yield different content; Phase 1 does no semantic deduplication.

### 13.1 Legacy Revision and Hash Compatibility

Phase 0 `contentFingerprint` is unprefixed SHA-256; title and Markdown are stored unchanged. Phase 1 rewrites no historical revision content, hash, ID, or revision number, and does not compare old stored hashes directly to new hashes to detect changes.

On updates, validate expected current revision within the Document lock first. Candidates use strict normalization (trimmed title must be nonempty); stored revisions use separate comparison normalization: trim title, CRLF→LF, sort metadata, but do not require old titles to be nonempty. Compare canonical payloads. Equal payloads return the original revision (including original stored hash), without writing a revision or silently changing displayed content. Different payloads create N+1 with the new hash contract. Legacy whitespace-only titles are valid Phase 0 data: reads/history preserve them unchanged; comparison payload titles may be empty, allowing comparison with valid candidates and new revision creation. Legacy data must remain correctable.

SourceEntry.content_hash is not a cross-version NOOP or identity criterion; retain existing values until successful controlled sync updates them to the candidate's new fingerprint. Phase 2 reuses this core content comparator, preventing different hash algorithms from causing false changes.

Acceptance fixtures must use the Phase 0 encoder: ordinary identical content, outer title whitespace, CRLF, and metadata key order correctly produce NOOP; actual content changes create N+1; old whitespace-only titles remain readable/correctable; historical rows are byte-stable.

## 14. Document Creation

Hub-managed document：

```text
validate trusted CallerContext
SET TRANSACTION ISOLATION LEVEL READ COMMITTED
BEGIN
resolve and lock Source → Workspace
require transaction-scoped Workspace access
validate Source ACTIVE + HUB_MANAGED
validate parent
create Document with UUIDv7 ID
create Revision #1
create DOCUMENT TreeNode
set Document.current_revision_id
COMMIT
```

Must be atomic. No completed committed state has `Document.current_revision_id = null`.

## 15. Mutation Authority

This is Phase 1's most important boundary. Public application services explicitly receive `CallerContext`; callers cannot be specified by command payload, form, query, org_code, Workspace selector, or `force` flag.

Every Hub/Source mutation first completes:

```text
resource/source
  → Source.workspace_id
  → Workspace access policy
  → Source ownership/lifecycle authority
```

### 15.1 Hub Commands

```text
HubKnowledgeCommandService
```

May execute:

```text
createDocument(caller, input)
createRevision(caller, input)
createFolder(caller, input)
moveTreeNode(caller, input)
archiveDocument(caller, documentId)
restoreDocument(caller, documentId)
```

But must also satisfy Workspace access, and:

```text
source.ownership == HUB_MANAGED
```

### 15.2 Source Projection Commands

Provided for future Phase 2:

```text
SourceKnowledgeProjectionService
```

May execute:

```text
projectDocument(caller, input)
projectRevision(caller, input)
projectFolder(caller, input)
moveProjectedNode(caller, input)
archiveProjectedDocument(caller, documentId)
restoreProjectedDocument(caller, documentId)
```

But must also satisfy Source Workspace access, and:

```text
source.ownership == SOURCE_MANAGED
```

This interface is an internal application boundary, not directly exposed through Web APIs. Phase 2 orchestration passes CallerContext established by a trusted transport/application boundary, not actor identity supplied by a source folder.

### 15.3 Transaction-scoped projection

Sources orchestration owns SourceUnitOfWork for the entire Apply. After acquiring Source lock, resolving Workspace, and passing transaction-scoped WorkspaceAccessPolicy on the same connection, it creates projection commands bound to that transaction. Commands open no separate UoW, do not commit, and accept no Web-provided repository or authority token. Every command resource must belong to the authorized Source and revalidate ownership/lifecycle.

Create Document/Folder projections and SourceEntry mappings in one transaction; sourceEntryId may be preallocated without requiring an existing mapping. Mappings must be complete before return, leaving no partially committed entry. All projections, mappings, assets, sync_version, and APPLIED run in one Apply commit/roll back together; store FAILED run separately after rollback. Phase 1 verifies this with multi-record transaction fixtures; full sync product flow remains Phase 2.

Source projection also provides renameProjectedFolder, archiveProjectedFolder, and restoreProjectedFolder. Folder archive requires no ACTIVE children; Phase 2 may archive leaf-to-root within one transaction. Restore proceeds ancestor-to-child, validating full ACTIVE ancestry. Folder mapping and TreeNode lifecycle/provenance update in one transaction.

## 16. Force Flags Forbidden

Do not design:

```ts
updateDocument({ force: true })
```

Or:

```ts
bypassOwnership: true
```

Different application interfaces express mutation authority, preventing future Web / Agent misuse that bypasses ownership rules. `workspaceId`/`org_code` must not be accepted as proof of authorization either.

## 17. Lifecycle

Lifecycle has only:

```text
ACTIVE
ARCHIVED
```

There is no:

```text
DELETED
MISSING
TRASHED
```

Phase 1 continues Phase 0's current lifecycle provenance: Source, SourceEntry, TreeNode, and Document transitions maintain `updated_by`, `archived_by`, `archived_at` in one transaction. These fields do not provide complete repeated archive/restore event history; full append-only audit belongs to Phase 3.

Phase 1 does not implement Workspace lifecycle; Phase 3 explicitly owns Workspace provision/create, rename, archive/restore, and administration semantics. Workspace MVP has no hard delete.

## 18. Archive Document

```text
SET TRANSACTION ISOLATION LEVEL READ COMMITTED
BEGIN
resolve Document → Source → Workspace
lock Source
require transaction-scoped Workspace access
lock Document

Document.status = ARCHIVED
Document.updated_by = caller.identity.id
Document.archived_by = caller.identity.id
Document.archived_at = now

Document TreeNode.status = ARCHIVED
TreeNode.updated_by / archived_by / archived_at = caller / now

linked SourceEntry.status = ARCHIVED
linked SourceEntry.updated_by / archived_by / archived_at = caller / now
(if present)

COMMIT
```

Revision is unchanged.

## 19. Restore Document

```text
SET TRANSACTION ISOLATION LEVEL READ COMMITTED
BEGIN
resolve Document → Source → Workspace
lock Source
require transaction-scoped Workspace access
lock Document
validate source ACTIVE
validate parent folder ACTIVE

Document.status = ACTIVE
Document.updated_by = caller.identity.id
Document.archived_by = null
Document.archived_at = null

TreeNode.status = ACTIVE
TreeNode.updated_by = caller.identity.id
TreeNode.archived_by = null
TreeNode.archived_at = null

linked SourceEntry.status = ACTIVE
linked SourceEntry.updated_by = caller.identity.id
linked SourceEntry.archived_by = null
linked SourceEntry.archived_at = null
(if present)

COMMIT
```

Document ID and current_revision_id remain unchanged.

## 20. Folder Archive

Phase 1 has no ambiguous cascade semantics.

Hub command：

```text
archiveFolder(caller, treeNodeId)
```

First check access via TreeNode → Source → Workspace; archive only folders without ACTIVE children. On success, update Folder TreeNode status and lifecycle provenance in the same transaction.

If children remain:

```text
FOLDER_NOT_EMPTY
```

If an entire subtree disappears, Phase 2 Folder Sync explicitly performs batch lifecycle transitions for each snapshot entry. If Phase 5 needs delete-entire-folder UX, separately design an explicit cascade preview.

## 21. Source Lifecycle

Source lifecycle operations first check Workspace access through `Source.workspace_id`.

Archive Source：

```text
KnowledgeSource.status = ARCHIVED
KnowledgeSource.updated_by = caller.identity.id
KnowledgeSource.archived_by = caller.identity.id
KnowledgeSource.archived_at = now
```

Do not cascade changes to all descendants.

Read path：

```text
Source ARCHIVED
→ the entire Tree is hidden by default
```

Restore Source：

```text
KnowledgeSource.status = ACTIVE
KnowledgeSource.updated_by = caller.identity.id
KnowledgeSource.archived_by = null
KnowledgeSource.archived_at = null
```

Child lifecycle retains its original value. Source archive is thus a container visibility gate, not a bulk child lifecycle update or Workspace lifecycle.

Sources application service provides `archiveSource(caller, sourceId)`/`restoreSource(caller, sourceId)` for both ownership modes; these container operations cannot rewrite SOURCE_MANAGED content. Workspace policy and Source lock in the same transaction are required. This phase has no Source lifecycle Web controls.

## 22. Read Application Services

Phase 1 provides explicit caller-aware read contracts.

Workspace query：

```text
listWorkspaces(caller)
```

Return only caller-visible Workspaces.

Knowledge query：

```text
listSources(
  caller,
  workspaceId,
  includeArchived = false
)

getSource(
  caller,
  sourceId,
  includeArchived = false
)

listTree(
  caller,
  sourceId,
  includeArchived = false
)

getDocument(
  caller,
  documentId,
  includeArchived = false
)

getCurrentRevision(caller, documentId, includeArchived = false)
getRevision(caller, documentId, revisionNo, includeArchived = false)
listRevisions(caller, documentId, includeArchived = false)
getAncestors(caller, nodeId, includeArchived = false)
```

`listSources` workspaceId is query scope; server must validate caller access. `getSource / listTree / getDocument / revision reads` do not treat additional client-provided workspaceId as proof; they resolve Workspace from resource relationships before policy checks.

Phase 1 has no production roles/capabilities yet, but Workspace membership foundation is already a required application-contract check; Phase 3 adds production governance on the same resource/policy boundary.

These application services depend on neither React, HTTP, MCP, nor scanners, and do not obtain callers from ambient/global request state. Phase 4 HTTP Read API and Phase 7 MCP may reuse them directly.

KnowledgeQueryService uniformly provides Source listing with required workspaceId + includeArchived. Task 8 migrates all SourceApplicationService.listSources consumers (including Knowledge page) and removes the old application method; repository adds a workspace-scoped archive-aware query, with any retained active-only helper delegating to that same implementation. No two public listing paths with different semantics may remain.

### 22.1 Missing／archived query contract

`getSource`, `getDocument`, `getCurrentRevision`, `getRevision`, and `getAncestors` return non-nullable values: absent resources or resources hidden by default archive filtering throw SOURCE_NOT_FOUND, DOCUMENT_NOT_FOUND, REVISION_NOT_FOUND, or TREE_NODE_NOT_FOUND respectively. Revision lookup first checks Document existence/visibility: invisible Document returns DOCUMENT_NOT_FOUND; only visible Document with absent specified revision returns REVISION_NOT_FOUND. listRevisions also throws DOCUMENT_NOT_FOUND for invisible Documents; other valid empty sets return []. Existing resources without Workspace membership remain denied with WorkspaceAccessDeniedError.

Browser adapter explicitly maps not-found codes to Next `notFound()`, no longer relying on `if (!view)`; access denial retains existing non-leaking handling, without swallowing every exception as 404. Core does not import Next. Update Phase 0 null assertions, view shapes, and all query consumers together.

## 23. Tree Read Model

UI does not receive DB rows directly.

Application assembles:

```ts
type KnowledgeTreeItem =
  | {
      type: "folder";
      id: string;
      parentId: string | null;
      label: string;
      position: number;
      status: "ACTIVE" | "ARCHIVED";
    }
  | {
      type: "document";
      id: string;
      parentId: string | null;
      documentId: string;
      label: string;
      currentRevisionId: string;
      position: number;
      status: "ACTIVE" | "ARCHIVED";
    };
```

Document: `label = current revision title`; Folder: `label = TreeNode.name`. Application surfaces represent all IDs as standard UUID strings; storage uses MariaDB native `UUID`.

## 24. Phase 1 Minimal UI

Phase 1 provides a read-only Knowledge Browser:

```text
┌───────────────────────────────────────────────────────┐
│ Workspace: Query Master ▼                             │
│ Source: Obsidian Wiki ▼                               │
├─────────────────┬─────────────────────────────────────┤
│ Architecture    │ Database Architecture               │
│ ├ Overview      │                                     │
│ ├ Database ◀    │ markdown rendered content           │
│                 │                                     │
│ Runbooks        │ Revision: #4                        │
│ └ Deployment    │ Updated: ...                        │
└─────────────────┴─────────────────────────────────────┘
```

Supports:

- Workspace selector showing only caller-authorized Workspaces.
- Source selector showing only visible Sources in the current Workspace.
- Folder tree。
- Document viewer。
- Revision history。
- Archived toggle。

Does not support:

- Workspace create/rename/archive/member management。
- Edit。
- Upload。
- Drag & Drop。
- Delete。
- Sync。

This lets Phase 1 verify Knowledge Core and Workspace-scoped reads without prematurely implementing Phase 3/5.

### 24.1 Phase 0 Smoke Flow Transition

The Phase 1 Browser removes Phase 0's create form and Web mutation action; application document creation remains for tests and future authoring. Update original Phase 0 E2E rather than retaining it unchanged: create documents through application fixtures and verify stable URLs, reload, and Tree navigation; retain caller-spoofing coverage through application/trusted-identity adapter tests and verify Browser has no mutation controls/entry points.

Task 1 runs the original Phase 0 baseline; final Phase 1 acceptance retains its domain/access/transaction guarantees through updated read-only E2E. Do not simultaneously require original create-form E2E to pass and Browser to have no create form.

## 25. SourceEntry Core

Phase 1 completes mapping primitives:

```text
createSourceEntryMapping()
getSourceEntry()
resolveByExternalId()
updateSourceLocator()
archiveSourceEntry()
restoreSourceEntry()
```

But does not implement:

```text
matchUnknownEntry()
detectRename()
detectMove()
resolveCanonicalTitle()
```

These belong to Phase 2.

## 26. `external_id` Rule

If the source provides stable external IDs:

```text
UNIQUE(source_id, external_id)
```

Multiple rows may have `external_id = NULL`.

`source_path` remains only a locator:

```text
external_id → identity hint
source_path → current location
content_hash → content comparison
Document.id → Hub identity
```

None may masquerade as another.

## 27. Error Model

Phase 1 unifies domain / application errors, including at least:

```text
WORKSPACE_NOT_FOUND
WORKSPACE_ACCESS_DENIED
SOURCE_NOT_FOUND
DOCUMENT_NOT_FOUND
REVISION_NOT_FOUND
TREE_NODE_NOT_FOUND

SOURCE_ARCHIVED
DOCUMENT_ARCHIVED

SOURCE_MANAGED_READ_ONLY
HUB_MANAGED_OPERATION_REQUIRED

INVALID_PARENT
CROSS_SOURCE_MOVE
TREE_CYCLE
FOLDER_NOT_EMPTY

REVISION_CONFLICT
SOURCE_ENTRY_CONFLICT
INVALID_SOURCE_MAPPING

INVALID_TITLE
INVALID_METADATA
```

UI / HTTP adapters map presentation/status codes themselves. Core returns no transport-specific HTTP status, toast message, or SQL driver error.

Plan Task 1 centrally owns error migration: full paths are `src/modules/knowledge/domain/errors.ts`, `src/modules/workspaces/domain/errors.ts`, `src/shared/domain/errors.ts`. Preserve DomainError/WorkspaceAccessDeniedError responsibility boundaries; new semantic codes do not turn source-sync VERSION_CONFLICT into revision conflict.

## 28. Revision Concurrency

Future Phase 5 editing must avoid lost updates, so Phase 1 command contracts reserve:

```text
createRevision(caller, {
  documentId,
  expectedCurrentRevisionId,
  title,
  markdown,
  metadata
})
```

If `expectedCurrentRevisionId != actualCurrentRevisionId`, return `REVISION_CONFLICT`. This is Core correctness rather than a Phase 5 UI feature; Phase 2 sync may reuse it.

## 29. Transaction Boundaries

The following operations must be atomic under **READ COMMITTED**; all participating repositories and WorkspaceAccessPolicy use one MariaDB connection. Resolve authoritative scope and check membership after BEGIN; no preflight outside the transaction replaces this check. Validate Workspace access against authoritative resource scope before mutation execution; UI state does not replace policy.

### 29.1 Create Document

```text
Workspace access
Document
Revision
TreeNode
current revision pointer
```

### 29.2 Create Revision

```text
Workspace access
Revision
current revision pointer
```

### 29.3 Archive / Restore

```text
Workspace access
Document
TreeNode
SourceEntry
lifecycle provenance
```

### 29.4 Tree Move

```text
Workspace access
source lock
node
affected sibling positions
```

Any failed canonical mutation: `ROLLBACK ALL`. READ COMMITTED does not replace Source/Document locking reads; together they form Phase 1's concurrency contract.

## 30. Default Archived Filtering

Default `includeArchived = false` applies to `listSources`, `listTree`, `getDocument`. Revision reads and getAncestors likewise exclude archived scope by default; explicit historical lookup may use `includeArchived = true` but cannot bypass Workspace access.

Future Search, MCP, and Agents must reuse the same defaults and enter application query boundaries through CallerContext + Workspace policy.

## 31. Core Invariants

After Phase 1, guarantee:

1. Each Source always belongs to one Workspace.
2. `User.org_code` is no Knowledge authorization shortcut.
3. Cross-org WorkspaceMembership is valid; same-org non-members have no automatic access.
4. Resource IDs / UI Workspace selection cannot bypass Workspace policy.
5. Document always belongs to one Source; Workspace scope derives from Source.
6. Document ID is stable UUIDv7 identity, unaffected by hierarchy changes.
7. Revision immutable。
8. Current revision always belongs to that Document.
9. Revision numbers increase monotonically and are unique.
10. Identical content creates no duplicate revision.
11. One Document has one Knowledge TreeNode, protected by DB uniqueness since Phase 0.
12. Folder creates no fake Document.
13. Document node title comes from current Revision.
14. Tree parent must be in the same Source.
15. Tree cannot form cycles.
16. Document cannot move across Sources.
17. Ordinary Tree/Sync operations cannot change Source Workspace.
18. SOURCE_MANAGED accepts no Hub mutations.
19. Public `force` cannot bypass Source mutation rules.
20. Archive does not hard delete; current archive actor/time is traceable.
21. Restore retains original Document ID and clears current archive provenance.
22. SourceEntry mapping does not automatically change identity on path rename.
23. Tree / Document / SourceEntry lifecycle transactionally consistent。
24. Canonical mutations use READ COMMITTED + explicit row locks, without scattered SQL.
25. Public read/write services explicitly receive CallerContext.
26. Web / future MCP share application services + Workspace policy.
27. Phase 1 does not prematurely build Workspace administration, production role models, or Agent actor_kind / Principal models.

## 32. Acceptance Tests

Phase 1 covers at least the following core scenarios.

### 32.1 Workspace / Caller

```text
✓ listWorkspaces only returns caller memberships
✓ cross-org user with membership can browse shared Workspace
✓ same-org non-member cannot browse Workspace
✓ one caller can switch between multiple authorized Workspaces
✓ direct source/document UUID does not bypass Workspace policy
✓ caller cannot be overridden by input payload
✓ UI workspace selection is not authorization evidence
```

### 32.2 Revision

```text
✓ create document creates R1
✓ markdown change creates R2
✓ title change creates R2
✓ metadata change creates R2
✓ identical content creates no revision
✓ hierarchy move creates no revision
✓ concurrent revisions cannot share revision_no
✓ stale expectedCurrentRevisionId rejected
✓ old revision remains unchanged
```

### 32.3 Tree

```text
✓ folder can contain folder
✓ folder can contain document
✓ document cannot be parent
✓ second TreeNode for same Document rejected
✓ cross-source parent rejected
✓ node cannot move below itself
✓ node cannot move below descendant
✓ document move keeps Document ID
✓ document move keeps Revision
✓ reorder keeps Revision
✓ concurrent cycle-producing moves cannot both succeed
✓ lock waiter validates against latest committed state under READ COMMITTED
```

### 32.4 Lifecycle

```text
✓ archive keeps revision history
✓ archive hides document by default
✓ archive stores current actor/time provenance
✓ restore clears current archive provenance
✓ restore keeps Document ID
✓ restore keeps current Revision
✓ document/tree/source-entry status remain consistent
✓ non-empty folder cannot be implicitly archived
✓ archived Source hidden by default
```

### 32.5 Ownership / Mutation Authority

```text
✓ Hub command works for HUB_MANAGED after Workspace access
✓ Hub command rejects SOURCE_MANAGED
✓ source projection works for SOURCE_MANAGED after Workspace access
✓ source projection rejects HUB_MANAGED
✓ no force/bypass path exists
```

### 32.6 Mapping

```text
✓ Folder SourceEntry maps to stable TreeNode
✓ Document SourceEntry maps to same-source Document/TreeNode
✓ changing source_path keeps mapping identity
✓ duplicate external identity rejected
✓ filename/path does not implicitly redefine canonical title
```

## 33. Phase 2 Handoff Contract

After Phase 1, Phase 2 no longer decides:

- How Workspace access foundation enters application boundaries.
- How Documents create revisions.
- How Archive/Restore executes and retains current provenance.
- How Tree moves execute.
- How Source content ownership restricts operations.
- How CallerContext enters application boundaries.
- How Document identity is preserved.
- How duplicate revisions are prevented.

Phase 2 owns only:

```text
Select authorized Workspace for new Source
 ↓
Folder
 ↓
Scan
 ↓
Parse + Title Resolution
 ↓
Snapshot
 ↓
Match SourceEntry
 ↓
Diff
 ↓
Preview
 ↓
Confirm
 ↓
Create Source(workspace_id) + Source Projection Commands
```

Updates to existing Sources specify only `source_id`; Source relationships determine Workspace, and sync offers no target Workspace override.

Phase 2 decides what changed in the source and how source content parses into canonical candidates; Phase 1 decides how those changes safely become Knowledge within authorized Workspace scope.

## 34. Definition of Done

Phase 1 completion requires all the following flows to work, beyond merely seeing the Tree UI:

```text
CallerContext
 ↓
Authorized Workspace
 ↓
Source
 ↓
Create
 ↓
Document stable UUIDv7 identity
 ↓
Revision history
 ↓
Move / rename
 ↓
same Document ID
 ↓
Archive + actor/time provenance
 ↓
hidden by default
 ↓
Restore
 ↓
same Document ID + same history
```

SOURCE_MANAGED must also have a formal, safe internal mutation boundary sufficient for Phase 2 integration. Phase 1 does not claim completed company production governance; production multi-user governance requires Phase 3.

## 35. ADR Summary

### ADR-P1-01 — Source as Tree Root

KnowledgeSource itself is Tree root, without a synthetic folder; Workspace is a Source container, not a Tree node.

### ADR-P1-02 — One Document, One TreeNode

Each Document has one Document TreeNode in Knowledge Tree; this uniqueness is Phase 0 foundation, retained and verified in Phase 1.

### ADR-P1-03 — Revision Title Is Canonical

Document node label comes from current Revision title, without copying title to Tree; SOURCE_MANAGED title resolution belongs to Phase 2.

### ADR-P1-04 — Stable Folder Mapping

Add `SourceEntry.tree_node_id` for stable Folder-entry mapping.

### ADR-P1-05 — Mutation Authority Separation

Hub mutations and Source projections use different application interfaces without bypass flags; both first pass Workspace policy.

### ADR-P1-06 — Source-level Tree Lock + READ COMMITTED

Tree mutations use Phase 0 READ COMMITTED UoW + Source-level DB locks to prevent concurrent hierarchy corruption.

### ADR-P1-07 — Revision Concurrency

Revision mutations use Document-level locks plus optimistic expected revision.

### ADR-P1-08 — Revision Hash Boundary

Revision hash covers only title, Markdown, metadata.

### ADR-P1-09 — Explicit Folder Lifecycle

Folder archive has no implicit cascade; caller explicitly describes bulk lifecycle; current archive provenance is stored with transitions.

### ADR-P1-10 — Source Archive as Visibility Gate

Source archive is a visibility gate, without cascading changes to all Knowledge records.

### ADR-P1-11 — CallerContext + Workspace Scope Are Explicit

Public Knowledge read/write services take CallerContext as explicit first argument; resources resolve access scope through Source → Workspace; Phase 3 adds production governance at this policy boundary.

### ADR-P1-12 — No Premature Agent Actor Model

Phase 0–2 provenance still references user identity; Phase 1 adds no `actor_kind`. If Agent writes become required, the corresponding Agent/Authoring phase designs Principal/Actor.

## 36. Final Architecture

```text
                         Identity
                            │
                            ▼
                    CallerContext
                            │
                            ▼
                    Workspaces Module
              ┌─────────────┴──────────────┐
              │                            │
       listWorkspaces()            WorkspaceAccessPolicy
                                           │
                                           ▼
                                  Application Services
                                           │
                       ┌───────────────────┴────────────────────┐
                       │                                        │
            HubKnowledgeCommandService            SourceKnowledgeProjectionService
                 HUB_MANAGED                            SOURCE_MANAGED
                       │                                        │
                       └───────────────────┬────────────────────┘
                                           ▼
                                   Knowledge Domain
                          ┌──────────────┼───────────────┐
                          │              │               │
                       Document       Revision          Tree
                          │              │               │
                          └──────────────┼───────────────┘
                                         │
                              Lifecycle + Provenance
                                         │
                                         ▼
                                 Repository Ports
                                         │
                                         ▼
                           READ COMMITTED MariaDB 10.11
                               native UUID storage

Workspace
 └─ KnowledgeSource
      ├─ SourceEntry
      └─ future Phase 2 Sync
              │
              └──────────► SourceKnowledgeProjectionService
```

This is Phase 1's formal architecture boundary. Phase 2 scanners, Title Resolution, snapshots, matching, diff, preview, and apply orchestration must build on it, without directly modifying canonical Knowledge tables. Phase 3 adds Workspace provisioning/lifecycle, roles/capabilities, membership administration, and enterprise mapping; `org_code` need not reenter the Knowledge access boundary.
