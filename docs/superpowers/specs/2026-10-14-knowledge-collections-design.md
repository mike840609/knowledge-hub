# Knowledge Collections — Design Specification

| Field | Value |
| --- | --- |
| Initiated | 2026-10-14 |
| Written | 2026-10-15 |
| Type | Architectural design; **review required before implementation planning** |
| Status | Approved 2026-10-15 for implementation planning; product code not authorized yet |
| Scope | Workspace-scoped, manually curated virtual collections of existing documents |
| Existing contracts | `CLAUDE.md`; Phase 3 Workspace governance; Folder Sync; Document links; Saved shares; frontend design language |

## 1. Intent, outcome, and boundaries

Knowledge Hub already has Source/Folder trees, Markdown documents, immutable revisions, document links and backlinks, personal workspaces, and opt-in Team Workspaces. Engineers and PMs still need a short, intentionally ordered **reading path** across sources (overview → requirements → design → decisions → runbook) without copying or rewriting the source materials.

**Success:** An authorized Editor can create a collection in a Workspace, add current documents from multiple sources in that same Workspace, annotate why each matters, order them, and hand teammates a Workspace URL. A Viewer can follow that reading path. Source sync continues to update the underlying documents without touching collection metadata.

A `KnowledgeCollection` is a Workspace-owned curation entity, **not** a KnowledgeSource, Folder, Markdown file, document revision, synthetic graph link, share token, or second copy of document content. It is not an additional authorization grant.

### Product choices agreed 2026-10-15

1. **Collaborative ownership:** Workspace Editors, Admins and Owners share collection maintenance; creator identity is provenance, not an exclusive ACL.
2. **Flat outline:** One ordered list; no sections, nested collections or nested folders.
3. **Item annotations:** Each reference may have a short independently authored reading note; editing it does not mutate Markdown.
4. **Unavailable items:** Keep the reference and its position when an underlying document becomes unavailable; never auto-remove or silently relink it.
5. **Archive/restore:** Any member with `document.write` may archive and restore a collection.
6. **Navigation:** A dedicated Collections entry, separate from the Source/Document tree.

A previously agreed constraint is **Workspace-based v1**: references are only to documents in the collection's own Workspace. A named link to the collection does not allow anonymous access.

### Non-goals

No cross-Workspace references, anonymous Collection shares, inclusion of Saved Shares/public bearer tokens, copied content or snapshots, pinned document revisions, AI auto-curation, semantic search, new document-specific ACL, notification workflow, multi-step review, import/export format, collection nesting, collection-level documents, or redesign of the editor.

## 2. Alternatives and selected approach

- **Selected: virtual collection metadata in MariaDB.** Explicit FK references to existing Document IDs, ordered item positions, and optional notes; resolve current revisions when opened. Works with Folder Sync and Hub-managed docs without ownership ambiguity.
- **Rejected for v1: Markdown/YAML manifest as source of truth.** Portable but would introduce path/ID reconciliation across sources, import-time conflicts, and a second write path. A future export may produce a manifest without changing ownership.
- **Rejected: copies/snapshots of documents.** Leads to stale duplicates, weakens source-managed read-only invariants, and creates another lifecycle to maintain.

## 3. Experience and routes

A Workspace navigation item `Collections` opens `/w/:workspaceId/collections`. It is distinct from the existing `SourceSidebar`/explorer tree; existing code also names some Source/Tree arrays `collections`, so new code must consistently use `KnowledgeCollection` for the domain concept.

**List:** active collections in stable `updated_at DESC, id DESC` order, with a concise name, description, available/total item counts, and creator/modified timestamps where useful. Supports an empty state and Create action for writers. Archived collections live behind an explicit Archived filter. A collection can be empty.

**Detail:** `/w/:workspaceId/collections/:collectionId` displays collection name/description, its ordered items, source captions for available documents, and each optional reading note. Document title links open the **existing** Document Reader in the same Workspace; no embedded or duplicated Markdown. An unavailable entry shows only `Unavailable document`, its position, and a generic explanation; it does not render previously observed title, source path, body excerpt, revision, or the item's note. Rechecking access on direct Reader open is mandatory.

**Editing:** writers can Create, Rename, Edit description, Add from a bounded same-Workspace document picker, Set or edit a per-item note, Remove reference, Reorder (drag-and-drop **and** keyboard up/down), Archive, Restore. Provide `Add to Collection` in the existing document action menu, filtered to collections writable in that document's Workspace. Disable unsupported actions and surface errors consistently with the existing action registry. All changes persist only after server confirmation; stale changes show Reload rather than silently overwriting.

**Accessibility:** keyboard navigation and focus state, move-up/down accessible labels, explicit success/error feedback, narrow viewport layout, light/dark modes. Reuse the frontend design language and shared UI primitives. Update both English and zh-TW help text.

No `Share collection` control in this release. Copying its normal URL is convenient navigation **only for authorized Workspace members**; readers without membership see the existing non-disclosure behavior.

## 4. Domain and authorization invariants

Collection scope is held once on the collection as `workspace_id`. Item references hold only `collection_id` and `document_id` (not extra source/workspace IDs). The collection service resolves `Document → Source → Workspace` for the target document and checks equality to the collection scope, **within the same unit of work and on every add**. A document ID or URL is never authorization.

- **Read/list:** trusted `CallerContext` plus Workspace discover/read (including `document.read`); recheck current effective capabilities and Workspace existence/lifecycle through the existing access ports.
- **Create/update/archive/restore/add/remove/reorder:** trusted caller with `document.write` on an **ACTIVE** Workspace. Viewer has no mutation. Personal Workspace remains owner-only via existing identity policy. TEAM group grants use only validated SSO group IDs, never `org_code`.
- **Document picker/add:** candidate source and document must be ACTIVE, have a saved current revision, belong to that same Workspace, and be currently readable by caller. Reject archived, foreign-Workspace, missing, or inaccessible targets without revealing private metadata.
- **Collection detail:** resolving item information must reapply document visibility checks. A valid collection read does not imply permission to retrieve unavailable document contents. Batch checks should never return a private title from stale caches/metadata.
- **Workspace archive:** collection reads may remain visible under existing archived-Workspace read policies, but all collection writes are refused until Workspace restore. Collection archive also forbids item/metadata mutations except its own restore.
- **Direct URL:** no bearer-token or unauthenticated exception; route and API call the same application authorization service. Known Collection ID is only a selector.
- **Error disclosure:** no Workspace discover → 404; discover without read → 403 per existing Phase 3 contract. Unknown/foreign/inaccessible collection or item → generic 404; missing write privilege → 403; stale version → 409.

This feature introduces no new assignable roles, `CollectionOwner` permissions, source-managed write capability, or privileged Agent read path.

## 5. Persistence model

New schema in the **next available** MariaDB migration after the currently registered set (do not assume a numeric version remains available at implementation time). All IDs are native MariaDB UUID with application-generated UUIDv7, as used elsewhere.

### `knowledge_collections`

| Column | Contract |
| --- | --- |
| `id UUID PK` | Immutable identity |
| `workspace_id UUID NOT NULL FK → workspaces` | Ownership and access scope |
| `name VARCHAR(120) NOT NULL` | Trimmed, nonblank |
| `description TEXT NOT NULL` | Up to 2,000 Unicode characters; empty permitted |
| `version BIGINT UNSIGNED NOT NULL DEFAULT 1` | Optimistic concurrency counter |
| `status VARCHAR(16) NOT NULL` | `ACTIVE` or `ARCHIVED` |
| `created_by UUID NOT NULL FK → users` | Provenance |
| `updated_by UUID NOT NULL FK → users` | Last actor |
| `archived_by UUID NULL FK → users` | Archive actor |
| `archived_at DATETIME(6) NULL` | Archive instant |
| `created_at / updated_at DATETIME(6)` | Timestamps |

Enforce status/provenance shape, nonblank name and valid version with CHECK constraints. Index active and archived Workspace lists by `(workspace_id, status, updated_at, id)`. Archiving never physically deletes the row, and restore never creates a new ID.

### `knowledge_collection_items`

| Column | Contract |
| --- | --- |
| `id UUID PK` | Immutable item identity |
| `collection_id UUID NOT NULL FK → knowledge_collections` | Curation parent |
| `document_id UUID NOT NULL FK → knowledge_documents` | Original content reference |
| `position INT UNSIGNED NOT NULL` | Ordered among active items |
| `reading_note TEXT NOT NULL` | Plain-text note, max 500 Unicode characters |
| `added_at DATETIME(6) NOT NULL` | Added timestamp |

Enforce `UNIQUE(collection_id, document_id)`. Order items by `position ASC, id ASC` as a deterministic tie-breaker; the service writes dense 0-based positions in one transaction and verifies exactly one entry per active document reference. Do not add a unique index on `(collection_id, position)` that breaks simple atomic swaps/reordering. `Remove` deletes **only the membership row**, never a canonical knowledge document, source, or revision; archived **documents** and **collections** are not hard-deleted. Existing immutability rules on document revisions remain untouched. Historical item membership audit is outside v1.

Database foreign keys use ON DELETE RESTRICT. Cross-Workspace equivalence cannot be guaranteed by these two tables alone: enforce it in the application transaction before creating references, while retaining existing constraints prohibiting arbitrary document moves across source/Workspace boundaries.

**Bounds:** 200 active items per collection, 50 results per collection-list page, and capped picker/search results. Validate payload lengths and counts at the service boundary and revalidate transactionally for concurrent adds; use a consistent error for limit violations.

## 6. Lifecycle, sync, and failure semantics

| Event | Required behavior |
| --- | --- |
| New document revision | Same Document ID; collection uses latest saved revision/title on subsequent reads |
| Rename/move with stable Document ID | Reference stays and caption resolves from current records |
| Source/doc archived | Keep Item ID/order; show generic Unavailable; hide note and any formerly visible document metadata |
| Source/doc restored with same ID | Reference becomes available again automatically after an authorized read |
| Sync produces a new Document ID | Old reference stays unavailable; **never** guess replacement by matching title/path/hash |
| Collection archived | Keep rows, order, notes and references; hide from active list; readers can find it using Archived filter |
| Collection restored | Same ID, metadata, and items; current document availability is reevaluated |
| Workspace archived | Collection mutations denied; read behavior follows existing Workspace archival contract |
| Lost Workspace membership | No collection discovery or read; no fallback to prior cached content |

Folder Sync must never update collection tables. `SOURCE_MANAGED` documents remain read-only in the Hub, even if members edit a Collection's curation metadata. `HUB_MANAGED` editing still creates canonical revisions through the established paths.

For documents whose IDs changed on sync, Editor may explicitly remove the unavailable item and add the newly identified document; no silent remapping. An unavailable item may be removed/reordered by an authorized Editor without reading document metadata.

### Concurrency and transaction contract

Each successful collection mutation increments `version` exactly once. Client mutations carry `expectedVersion`. Inside one Unit of Work, lock the Collection row `FOR UPDATE` (plus parent Workspace row before mutation, following existing write ordering), refresh the caller's effective Workspace grants under that lock, verify active state and expected version, then perform a validated item edit/reorder/metadata change and increment version atomically. Every reorder request contains the complete current item-ID set in desired order; reject missing/duplicate/foreign IDs as invalid. Concurrent mutations against stale version return 409 with no partial writes.

Adding a document must validate its Workspace/source/active state within the same transaction as membership insertion; avoid a time-of-check/time-of-use gap. Handle DB constraint failures as safe typed conflicts, never raw SQL errors. Do not send success before commit. Read/list uses batched joins with bounded results (not one query per item) and read-side access validation. For HTTP responses carrying user-specific content, use `Cache-Control: private, no-store` and appropriate noindex/no-referrer protections; do not persist confidential titles in shared caches.

## 7. Application interfaces and HTTP surface

Introduce `KnowledgeCollectionService` and `KnowledgeCollectionRepository` inside the current `knowledge` module and its `KnowledgeUnitOfWork`, wired by `src/server/composition.ts`. Reuse current caller identity sync, authorization policies, existing document/source repositories and error conventions; no infrastructure imports into domain/application components.

All API routes are trusted-caller-only and Workspace-scoped:

| Method | Endpoint | Operation |
| --- | --- | --- |
| GET | `/api/workspaces/:id/collections` | List (active default; explicit archived filter and cursor) |
| POST | `/api/workspaces/:id/collections` | Create with name/description |
| GET | `/api/workspaces/:id/collections/:collectionId` | Detail, current item availability/metadata |
| PATCH | `/api/workspaces/:id/collections/:collectionId` | Rename, description, archive/restore state; requires `expectedVersion` |
| POST | `/api/workspaces/:id/collections/:collectionId/items` | Add document with note; requires `expectedVersion` |
| PATCH | `/api/workspaces/:id/collections/:collectionId/items/:itemId` | Edit note; requires `expectedVersion` |
| DELETE | `/api/workspaces/:id/collections/:collectionId/items/:itemId` | Remove membership; requires `expectedVersion` |
| PUT | `/api/workspaces/:id/collections/:collectionId/items/order` | Replace complete order; requires `expectedVersion` |

Validate document UUIDs, trimmed name, note length, duplicate document, field allow-list, order permutation, pagination and query parameters. Reject unauthorized or invalid candidate IDs before persistence. Every update response includes the **new version** for the next edit; stale conflict UI reloads current state. New creation returns ID and version. No content bodies or history are returned in Collection list/detail; individual Reader endpoints remain authoritative.

### Domain/API error mapping

- Invalid inputs/length/order permutation → `400` with field-safe detail.
- Missing trusted session → existing identity `401` or configured identity `503` behavior; do not silently fall back to local user.
- Existing Workspace read/write capability denial → existing 403/404 split.
- Foreign/inaccessible collection, document or item → `404` with non-disclosing message.
- Duplicate active document or version mismatch → `409` (with machine-readable conflict reason, no private row data).
- Collection/item cap exceeded → `422` with user-actionable limit description.
- Database/unavailable service → `5xx` and retry; do not translate outages into empty collections.

This design does not change anonymous `/s/:token`, `saved_document_shares`, `Copy for Agent`, graph resolution, or existing document share token authorization.

## 8. Design boundaries and delivery plan

Keep v1 a single feature slice inside the existing modular monolith:

- **Domain:** collection entities, lifecycle, order/limits, typed error rules.
- **Ports/application:** repository and service; transaction, authorization, document resolution.
- **Infrastructure:** additive MariaDB migration and repository; batched read projection.
- **Server:** composition wiring; private HTTP adapters; Workspace-scoped navigation model.
- **UI:** Collections list/detail, create/edit, picker, per-item note, ordering; independent Sidebar entry and document action-menu command.
- **Docs:** English and zh-TW help; no changes to existing import/source guidance beyond the Collections explanation.

Do not introduce a new standalone module, general-purpose ACL engine, search index, full audit pipeline, or external framework for this feature.

## 9. Verification and acceptance

**Unit tests**: name/note bounds, flat ordering, idempotency/duplicate behavior, version increments and stale conflicts, lifecycle rules, Workspace capability gating, generic unavailability placeholders, no accidental Markdown mutation, no additional anonymous read entry, and validation of hostile note text as inert/plain text.

**MariaDB integration** (distinct owner/editor/viewer/outsider identities and at least two Workspaces with multiple Sources): create/list/read, Editor modifies another Editor's collection, Viewer may read but cannot write, foreign-workspace document cannot be added, archived target retains a placeholder and returns on restore, new Document ID remains unlinked, collection archive/restore preserves order, source-managed content untouched, two concurrent writes yield exactly one successful version transition, and rollback on invalid reorder leaves zero partial changes.

**E2E** (trusted persona origins): My Space creation → add from two Sources → annotate → keyboard reorder → refresh → open Reader; Team Editor/Viewer behavior with feature flag; archived/unavailable rows; direct URL and API denial; narrow viewport and keyboard use. Production corporate SSO remains a deployment prerequisite and is not implemented here.

**Acceptance criteria**:
1. A Viewer opens one Workspace-scoped collection and sees an intentionally ordered reading path without any duplicated document content.
2. An Editor can curate any collection in an ACTIVE Workspace, regardless of original creator; Viewer cannot.
3. Updating the underlying saved document shows current information; no collection write is triggered by Folder Sync.
4. Archival, permission loss, and sync ID changes cannot disclose stale metadata or silently point to a different document.
5. Overlapping edits cannot silently overwrite another user's order/notes; server returns a conflict and persists one atomic state.
6. No anonymous collection sharing, cross-Workspace references, document ACLs or new source-of-truth path are introduced.

## 10. Review and handoff

The six user-facing choices and this written technical specification were **approved by the user on 2026-10-15**. `superpowers:writing-plans` may now produce a separate implementation plan. Obtain the user's plan review and execution-method approval before touching product code.

References: `CLAUDE.md` (scope, authorization, source ownership, revisions), `src/modules/workspaces/domain/workspace-capability.ts`, `src/modules/knowledge/ports/unit-of-work.ts`, `src/modules/knowledge/application/internal/require-visible-document.ts`, `docs/superpowers/specs/2026-10-12-saved-shares-design.md`, `docs/superpowers/specs/frontend-design-language.md`.
