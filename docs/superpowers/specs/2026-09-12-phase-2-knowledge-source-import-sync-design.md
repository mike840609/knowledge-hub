# Knowledge Hub — Phase 2 Knowledge Source Import & Sync Design

| Item | Content |
| --- | --- |
| Date | 2026-09-12 |
| Phase | 2 |
| Name | Knowledge Source Import & Sync |
| Status | Approved and implemented |
| Prerequisites | Phase 0 Foundation & Architecture, Phase 1 Knowledge Core & Tree |
| Next | Phase 3 Identity, Workspace Admin & Governance |

## 1. Goal

Phase 2 lets users safely import local generic Markdown folders into the existing Knowledge Hub, then resync the same `SOURCE_MANAGED` KnowledgeSource using a complete folder snapshot.

Phase 2 does not replace existing organizational wikis/external publishing platforms or implement production SSO, Workspace administration, MCP, embedding, or agent memory. It establishes the AI-native Knowledge Hub ingestion/sync foundation: the source folder is authoritative, Hub stores its canonical Knowledge projection, and humans and Agents can later consume the same Knowledge Core.

Main flow after completion:

```text
Initial import
Workspace
  ↓
Choose folder
  ↓
Scan / Upload
  ↓
Immutable staging snapshot
  ↓
Preview deterministic diff
  ↓
Confirm
  ↓
Create Source + Apply atomically

Existing Source sync
Source
  ↓
Choose full folder again
  ↓
Immutable staging snapshot (based_on_version = N)
  ↓
Preview deterministic diff
  ↓
Confirm
  ↓
Apply atomically, sync_version N → N+1
```

Phase 2's core success condition: Confirm applies only the immutable snapshot and action plan shown in Preview; every canonical Apply either fully succeeds or fully rolls back.

## 2. Scope

### 2.1 In Scope

- Generic Markdown whole-folder import。
- Existing `SOURCE_MANAGED` Source whole-folder re-sync。
- Browser folder picker + staged upload session。
- Server-authoritative path normalization、Markdown/frontmatter parsing、title resolution。
- Persistent immutable staging snapshot。
- Preview / Confirm / Apply。
- Deterministic reconciliation and diff.
- Added / Updated / Moved / Renamed / Archived / Restored / Unchanged semantics。
- Stable Document/SourceEntry/TreeNode identity preservation where safe。
- Conservative rename/move detection。
- Asset metadata/reference projection; no binary storage.
- Full transactional Apply。
- `sync_version` concurrency guard。
- SyncRun APPLIED/FAILED history where a canonical Source exists。
- Snapshot TTL / cleanup。
- Phase 0–2 local/mock Workspace membership governance。
- Unit、integration、E2E coverage。

### 2.2 Out of Scope

- File watcher / desktop daemon / background local filesystem monitor。
- Bidirectional sync。
- Hub-side editing of SOURCE_MANAGED Markdown。
- Markdown merge / conflict editor。
- Partial Apply / best-effort success。
- ZIP-only import flow。
- Empty-directory preservation。
- Binary/object storage。
- Asset revision history。
- Folder rename identity inference by subtree similarity。
- LLM-based rename/move guessing。
- Source transfer between Workspaces。
- Workspace create/rename/archive administration。
- Production roles/capabilities、Team mapping、SSO group mapping。
- Search、embedding、vector database、MCP、Agent Memory。

## 3. Architecture Decision

Phase 2 uses an ingestion orchestration layer inside Sources, rather than a separate ingestion subsystem directly manipulating Knowledge tables.

```text
Browser folder payload
      ↓
GenericMarkdownFolderAdapter
      ↓
Immutable ImportSnapshot (staging)
      ↓
Pure Reconciler
      ↓
Persisted FolderImportPlan
      ↓
Preview
      ↓ Confirm(snapshotId)
ApplyFolderImportService
      ↓
SourceUnitOfWork
      ↓
Phase 1 transaction-bound projection/mapping primitives
      ↓
Canonical Source / Entry / Tree / Document / Revision / Asset
```

### 3.1 Module boundary

Suggested structure:

```text
src/modules/sources/
├─ adapters/
│  └─ generic-markdown-folder-adapter.ts
├─ domain/
│  ├─ import-snapshot.ts
│  ├─ import-diff.ts
│  ├─ reconciliation-fingerprint.ts
│  ├─ title-resolution.ts
│  └─ path-rules.ts
├─ application/
│  ├─ create-folder-import.ts
│  ├─ upload-folder-import-entries.ts
│  ├─ finalize-folder-import.ts
│  ├─ reconcile-import-snapshot.ts
│  └─ apply-folder-import.ts
└─ ports/
   ├─ import-snapshot-repository.ts
   └─ import-snapshot-entry-repository.ts
```

### 3.2 Hard boundaries

1. Scanner/parser writes no canonical Knowledge tables.
2. Before Preview, write at most a staging snapshot.
3. Reconciler must be pure, deterministic, and side-effect-free.
4. Apply does not reread local folders, reparse uploads, or re-guess identity.
5. Apply accepts only persisted READY snapshots + persisted server-generated plans.
6. Apply does not bypass Phase 1 projection/mapping/tree/revision invariants.
7. `SOURCE_MANAGED` has no escape hatches such as `force=true` or `skipOwnershipCheck`.

## 4. Import Session and Snapshot Lifecycle

### 4.1 Snapshot states

Persisted state：

```text
BUILDING
READY
APPLIED
STALE
```

`EXPIRED` is not a stored state; derive it from `expires_at <= NOW()`.

Semantics:

- `BUILDING`: manifest created; Markdown bytes still uploading or awaiting finalize.
- `READY`: full upload, server parsing, diagnostics, reconciliation, and action plan complete. Preview is available; Apply requires `has_blockers=false`.
- `APPLIED`: snapshot successfully consumed once; another Apply returns idempotent success without repeating canonical mutation.
- `STALE`: existing Source version changed after Preview; can never Apply.

### 4.2 Initial import binding

```text
workspace_id = selected Workspace
source_id = NULL
based_on_version = NULL
proposed_source_name = immutable after READY
```

Source is created only on Confirm.

### 4.3 Existing Source resync binding

Client supplies only `source_id` route scope. Server resolves:

```text
workspace_id = Source.workspace_id
source_id = existing Source
based_on_version = Source.sync_version at snapshot creation/finalize contract
```

`based_on_version` is captured at snapshot creation while holding the Source
`lockById`; finalize re-locks the Source and fail-fasts with
`SOURCE_VERSION_CONFLICT` (details `{snapshotVersion, currentVersion}`) on any
mismatch before loading canonical state, so a drifted plan is never built or
persisted. Apply's version compare remains the final gate for races between
finalize and apply.

Normal sync accepts no client-supplied Workspace transfer.

### 4.4 Source creation timing

Initial import uses:

> Create Source only on Confirm; Create Source + all canonical Apply + first APPLIED SyncRun + snapshot consumption share one canonical transaction.

If any step fails, Source does not exist; no empty Source remains.

## 5. Browser Upload and Generic Adapter

### 5.1 Folder selection

MVP uses browser folder selection (`webkitdirectory` / equivalent supported directory selection). Client obtains relative paths, but they are untrusted input; server performs authoritative normalization.

First Import UI:

```text
Workspace (selected)
Source name (default from root folder, editable before Preview)
Folder
→ Scan & Preview
```

Resync UI：

```text
Workspace (readonly, derived from Source)
Source (readonly)
Current sync version
Folder
→ Scan & Preview
```

### 5.2 Staged upload

Use staged sessions rather than one huge multipart request:

```text
create BUILDING snapshot + manifest rows
→ upload Markdown files in bounded batches
→ finalize
→ READY
```

Phase 2 uploads no asset binaries, only metadata/reference fingerprints.

### 5.3 Markdown bytes and UTF-8 authority

Markdown uploads must send raw `File` bytes (for example, bounded `multipart/form-data` batches), not merely decoded JSON strings. The server must validate original bytes using fatal UTF-8 decoding.

Flow:

```text
browser File bytes
→ server validates request/batch limits
→ fatal UTF-8 decode (UTF-8 / UTF-8 BOM only)
→ valid text stored temporarily in staging
```

UTF-8 BOM may be removed. Invalid UTF-8 is blocking `INVALID_MARKDOWN_ENCODING`. Do not automatically guess Big5, Shift-JIS, or UTF-16.

### 5.4 Asset transport

Phase 2 assets send only:

```text
relativePath
SHA-256 reported by browser
size
MIME hint
lastModified
```

These fields are source-provided metadata, not trusted binary integrity/security proof. Future binary persistence requires server-side hashing and MIME detection.

## 6. Path Normalization and Ignore Rules

### 6.1 Canonical source path

Server normalizes locators to POSIX relative paths:

- `\` → `/`。
- remove `.` segments。
- reject absolute paths。
- reject `..` / root escape。
- reject NUL/control characters (`U+0000–U+001F`, `U+007F`)。
- No Unicode NFC/NFD rewriting.
- case-sensitive comparison。
- Path is only a locator, never Document ID.
- normalized path collision = blocking `PATH_COLLISION`。

Canonical `source_entries.source_path` is currently not a DB unique key; Phase 2 reconciliation preflight must detect existing duplicate canonical source paths. If two current mappings in one Source occupy the same normalized path, treat it as a blocking/integrity conflict rather than choosing arbitrarily.

### 6.2 Ignore rules

Always ignore:

```text
.git/**
.obsidian/**
node_modules/**
.DS_Store
Thumbs.db
any hidden path segment (.xxx)
```

Client may prefilter to reduce transfer, but server reevaluates.

The browser client prefilters every ignored path above (2026-10-07): it does not descend into ignored folders and never reads, hashes, counts or uploads an ignored file, so a folder holding `node_modules` or a large `.git` beside its notes stays within the manifest limits. The server is unchanged: it accepts a manifest that still lists ignored paths, counts them toward the limits, and drops them at finalize. Its check that a manifest omits the source's excluded paths applies only the source's own rules, never this ignore list.

### 6.3 Symlink policy

Do not follow file/directory symlinks. Skip recognizable symlinks with `SYMLINK_SKIPPED` warning. Selection root is the security boundary.

### 6.4 Empty directories

Do not materialize empty directories. Derive Folder nodes deterministically only from actually included Document/Asset paths.

## 7. Markdown Parsing and Canonical Content

### 7.1 Markdown extensions

Classify `.md`, `.markdown` as Documents case-insensitively; path identity itself remains case-sensitive.

Other regular files enter Asset metadata projection.

### 7.2 Frontmatter

Use a safe, mature YAML/frontmatter parser; forbid unsafe constructors, custom executable tags, and filesystem includes.

Frontmatter root must be a JSON-compatible map/object. Malformed YAML = blocking `INVALID_FRONTMATTER`; non-object root = blocking `FRONTMATTER_NOT_OBJECT`.

### 7.3 Canonical storage

Separate frontmatter and body:

```text
frontmatter → Revision.metadata
body        → Revision.markdown
resolved title → Revision.title
```

`Revision.markdown` stores no YAML frontmatter serialization, preventing YAML key ordering/formatting-only changes from appearing as Markdown body changes.

Retain the `title` metadata key in metadata; canonical title is a separate field.

### 7.4 Title resolution

Precedence:

```text
valid frontmatter.title
→ first valid Markdown H1
→ filename stem
```

Rules:

- `frontmatter.title` must be a nonempty string; invalid/empty produces only a warning and fallback.
- Detect H1 through Markdown AST rather than regex, so `#` inside fenced code is not a heading.
- Different frontmatter title and H1: frontmatter wins, with nonblocking `TITLE_CONFLICT` warning.
- Filename fallback only trims, without prettification.
- filename fallback empty = blocking。

## 8. Fingerprints

Phase 2 explicitly maintains two fingerprints with different responsibilities.

### 8.1 Revision content fingerprint

Reuse Phase 1 canonical revision equality:

```text
hash(title + markdown body + canonical metadata)
```

Determines whether to create a new Revision.

### 8.2 Reconciliation fingerprint

Phase 2 also calculates:

```text
hash(markdown body + canonical metadata)
```

Deliberately excludes resolved title.

If title comes from filename fallback, `foo.md → bar.md` changes canonical title but leaves body/metadata unchanged; stable Document identity should still be conservatively recognized, then Apply creates a new title Revision.

Compute reconciliation fingerprint from current Revision markdown + metadata on demand; MVP needs no new canonical DB column.

## 9. Identity Reconciliation

Document matching has four fixed passes:

```text
1. external_id exact match
2. normalized source_path exact match
3. unique unmatched reconciliationFingerprint + DOCUMENT type
4. otherwise new Document
```

Generic Markdown adapter does not automatically treat frontmatter `id`, `uuid`, or `slug` as external_id; they remain metadata. Generic adapter external_id is null. Adapter contract reserves optional external IDs for future documented source-specific adapters.

### 9.1 Conservative matching

Fingerprint fallback reuses identity only with exactly one unmatched candidate.

0 candidate → ADDED。

2+ candidates → no guessing: new path ADDED; all unmatched old entries eventually ARCHIVED based on snapshot absence; add `AMBIGUOUS_IDENTITY` warning.

No filename similarity, edit distance, subtree guessing, or LLM guessing.

**Amendment (2026-10-07): a rename hint, not a match.** A file renamed or moved *and* edited in one sync matches nothing, so it is ADDED and its old entry ARCHIVED, losing share links and history. When an ADDED document without its own `knowledge_id` has the same file name, or else the same title, as a document this preview archives, it carries a `POSSIBLE_RENAME` WARNING naming the old path. The warning tells the user to add the old `knowledge_id` when there is one, or otherwise to rename or move in one sync and edit in the next. It never changes the match. It is skipped where `AMBIGUOUS_IDENTITY` already explains the outcome.

### 9.2 Identity conflict

If a future adapter provides stable external IDs, but:

```text
external ID → Document A
same incoming path → Document B
```

This is a contract contradiction rather than ambiguity: blocking `IDENTITY_CONFLICT`.

Duplicate external_id in one snapshot is also blocking.

## 10. Diff Model

Internal diff uses a compositional model rather than a giant mutually exclusive enum:

```text
identity: NEW | EXISTING_ACTIVE | EXISTING_ARCHIVED
pathChanged
parentChanged
filenameChanged
contentChanged
```

Derive UI labels from these states:

- ADDED
- UPDATED
- MOVED
- RENAMED
- ARCHIVED
- RESTORED
- UNCHANGED

A Document may be `MOVED + RENAMED + UPDATED` simultaneously; summary counters may overlap, with a separate distinct affected-document count.

### 10.1 Revision semantics

- Path-only move/rename itself creates no Revision.
- Create a Revision only if resolved title / markdown / metadata canonical content changes.
- Filename rename changes resolved title if using filename fallback, producing `RENAMED + UPDATED` and a Revision.
- UNCHANGED creates no Revision.

### 10.2 Archive / restore

Missing active Document：

```text
SourceEntry → ARCHIVED
Document    → ARCHIVED
TreeNode    → ARCHIVED
```

Archive creates no Revision.

Archived entry reappears and matches successfully: reuse SourceEntry ID / Document ID / TreeNode ID. Same content only restores; changed content = restore + new Revision.

## 11. Folder Reconciliation

Generic folder identity uses only normalized folder path, without guessing rename/move across paths.

Snapshot derives required folders from included entries. For example:

```text
platform/k8s/ingress.md
platform/db/mysql.md
```

required folders：

```text
platform
platform/k8s
platform/db
```

Rules:

- same active path → reuse folder mapping。
- same archived path → restore。
- required missing path → create。
- existing no longer required → archive bottom-up。

For `docs/k8s/ → platform/k8s/`, folder preview is old Archived + new Added; descendant Documents matching by fingerprint may retain identity and show MOVED.

No subtree similarity / descendant-overlap inference.

## 12. Asset Model

Phase 2 defines `knowledge_assets` as current source-reference projection, not an immutable knowledge-history entity.

Rules:

- same path + same hash/metadata → unchanged。
- same path + changed hash/metadata → update current projection。
- new path → insert。
- missing path → remove current projection。
- Same hash + different path → remove old + add new; no inferred rename.

Phase 2 creates no Asset Revision, SourceEntry, TreeNode, or archive lifecycle.

## 13. Snapshot Persistence

Add staging migration `006-phase-2-import-staging`.

### 13.1 `source_import_snapshots`

Suggested fields:

```text
id UUID PK
workspace_id UUID NOT NULL
source_id UUID NULL
based_on_version INT UNSIGNED NULL
created_by UUID NOT NULL
root_name VARCHAR(...)
proposed_source_name VARCHAR(...) NULL
adapter_type VARCHAR(...)
adapter_version VARCHAR(...)
plan_version VARCHAR(...)
state BUILDING | READY | APPLIED | STALE
manifest_hash CHAR(64)
snapshot_hash CHAR(64) NULL
plan_hash CHAR(64) NULL
has_blockers BOOLEAN NOT NULL
summary JSON NULL
plan JSON NULL
created_at DATETIME(6)
finalized_at DATETIME(6) NULL
expires_at DATETIME(6)
applied_at DATETIME(6) NULL
stale_at DATETIME(6) NULL
result_source_id UUID NULL
result_version INT UNSIGNED NULL
```

DB CHECK constraints protect initial-vs-resync shape, state/result shape, and JSON validity.

### 13.2 `source_import_snapshot_entries`

One table holds manifest + upload staging + parsed READY payload:

```text
id UUID PK
snapshot_id UUID NOT NULL
upload_key VARCHAR(...) NOT NULL
client_relative_path TEXT NOT NULL
source_path TEXT NULL
source_path_hash CHAR(64) NULL
entry_type DOCUMENT | ASSET
upload_status PENDING | RECEIVED
declared_size BIGINT UNSIGNED
source_file_hash CHAR(64) NULL
raw_markdown LONGTEXT NULL
resolved_title TEXT NULL
title_source FRONTMATTER | H1 | FILENAME NULL
markdown LONGTEXT NULL
metadata JSON NULL
revision_content_hash CHAR(64) NULL
reconciliation_fingerprint CHAR(64) NULL
mime_type VARCHAR(...) NULL
asset_content_hash CHAR(64) NULL
asset_size BIGINT UNSIGNED NULL
asset_last_modified DATETIME(6) NULL
diagnostics JSON NOT NULL
preview_change JSON NULL
```

After Finalize completes canonical parsed fields and plan, set `raw_markdown = NULL` before transitioning READY to reduce staging storage.

### 13.3 Staging indexes

At least:

```text
snapshots:
  (created_by, state)
  (source_id, created_at)
  (workspace_id, created_at)
  (state, expires_at)

entries:
  UNIQUE(snapshot_id, upload_key)
  UNIQUE(snapshot_id, source_path_hash)
  INDEX(snapshot_id, upload_status)
```

`source_path_hash = SHA-256(normalized source_path)` establishes bounded uniqueness for long TEXT paths; application still compares actual paths and treats extreme hash collisions as integrity failures.

### 13.4 FK and deletion

```text
snapshot.workspace_id → workspaces.id
snapshot.source_id → knowledge_sources.id nullable
snapshot.created_by → users.id
snapshot.result_source_id → knowledge_sources.id nullable
entry.snapshot_id → snapshot.id ON DELETE CASCADE
```

Snapshots/entries are staging and may be physically deleted by TTL; canonical Knowledge no-hard-delete lifecycle does not apply.

## 14. Asset Schema Refinement

Add `007-phase-2-asset-projection`:

```text
knowledge_assets.source_path_hash CHAR(64) NOT NULL
knowledge_assets.updated_at DATETIME(6) NOT NULL
UNIQUE(source_id, source_path_hash)
```

Asset repository supports current-projection upsert/update/remove.

No new asset status/revision/history.

## 15. Snapshot Hash and Persisted Action Plan

READY snapshots store server-generated `FolderImportPlan` JSON and `plan_hash`.

### 15.1 Snapshot hash

Calculate a deterministic digest for each canonicalized staging entry, then sort by normalized relative path. Snapshot hash covers at least:

```text
adapter type/version
target binding
normalized paths
entry types
external IDs
revision content fingerprints
reconciliation fingerprints
asset metadata hashes
resolved title / canonical metadata inputs needed for Apply
```

Browser upload order must not affect hashes.

### 15.2 Action plan

Reconciler outputs a domain plan, not SQL:

```text
FolderImportPlan
  sourceBinding
  folders: create / restore / archive
  documents: create / restore / move / revise / archive
  assets: upsert / remove
  summary
```

The plan contains no pregenerated canonical UUIDs. Generate canonical UUIDv7 only when actually creating an entity in Apply transactions.

Document create/revise content references staging entries through `uploadKey`, without embedding full Markdown; store full text only once in `source_import_snapshot_entries.markdown`, otherwise snapshots within §19 limits would exceed `max_allowed_packet` and hard-fail finalize. Apply reads by key and verifies `contentHash` in the same transaction before execution; missing/mismatching content is an integrity failure.

`plan_version` permits future plan-schema evolution.

Apply does not reconcile again; it validates snapshot/plan hashes and executes the persisted plan.

## 16. Apply Transaction

One Confirm = one whole-source transaction = `sync_version +1 exactly once` = one APPLIED SyncRun.

Do not call Phase 1 `applyKnownEntry()` per entry: that known-entry API advances version/run per operation. Phase 2 reuses only its underlying transaction-bound projection/mapping primitives.

### 16.1 Existing Source apply order

```text
BEGIN READ COMMITTED
1. lock snapshot
2. require owner / READY / not expired / no blockers
3. lock Source
4. require Workspace membership
5. require ACTIVE + SOURCE_MANAGED
6. compare current sync_version == based_on_version
7. execute persisted action plan
8. advance Source sync_version once
9. insert one APPLIED SyncRun
10. snapshot READY → APPLIED, save result source/version
COMMIT
```

Canonical action execution deterministic order：

```text
restore folders top-down
create folders top-down
create documents
restore documents
move/rename existing nodes
create changed revisions
update SourceEntry locators/hashes
upsert assets
archive missing documents
remove stale asset references
archive obsolete folders bottom-up
normalize sibling positions
```

### 16.2 Initial import

```text
BEGIN
lock READY snapshot
revalidate Workspace membership
create Source(FOLDER_SYNC, SOURCE_MANAGED, sync_version=0)
materialize folders/documents/revisions/source entries/assets
advance sync_version 0 → 1
insert APPLIED SyncRun(based_on_version=0, result_version=1)
snapshot READY → APPLIED
COMMIT
```

After any failure rollback, Source does not exist.

### 16.3 No-op sync

Successful Confirm, even when all content is UNCHANGED, still:

```text
sync_version N → N+1
one APPLIED SyncRun
summary.changed = false
```

`sync_version` represents the authoritative full-source snapshot application epoch, not Document revision count.

## 17. Concurrency and Version Conflict

MariaDB continues using `READ COMMITTED`; no upgrade to SERIALIZABLE or Redis/distributed locks.

Concurrency relies on:

```text
snapshot row lock
Source row lock
sync_version optimistic token
```

All Phase 2 Applies use lock order snapshot → Source → Workspace.

### 17.1 Two previews

A/B both have based_on=7. A succeeds first → Source=8. B acquires Source lock and finds 8 != 7.

Version conflict is an expected business outcome; do not throw inside UoW causing complete rollback. Within the transaction:

```text
snapshot READY → STALE
insert FAILED SyncRun(failureCode=SOURCE_VERSION_CONFLICT)
COMMIT
```

After commit, HTTP layer maps to `409 SOURCE_VERSION_CONFLICT`.

B's canonical Knowledge is unchanged.

### 17.2 Double Apply

Concurrent Applies of the same snapshot first compete for its row lock. The first transitions READY→APPLIED; the second acquires the lock, sees APPLIED, and returns idempotent success:

```text
alreadyApplied=true
sourceId
resultVersion
```

No second SyncRun, version increment, or Revision.

### 17.3 Unexpected failure

Unexpected DB/invariant failure: roll back the whole canonical transaction.

- Existing Source: snapshot stays READY; a separate transaction may write FAILED SyncRun after rollback; retrying the same snapshot is allowed.
- Initial import: because Source does not exist and `sync_runs.source_id NOT NULL`, create no phantom FAILED SyncRun; snapshot stays READY for retry/operational diagnostics.
- Deadlock / lock wait timeout maps to `IMPORT_APPLY_RETRYABLE`; MVP has no domain-level automatic multiple retries.

## 18. Authorization and Security

### 18.1 Caller authority

All actor identity comes from trusted `CallerContext`; clients cannot specify `created_by`, `triggered_by`, actor, membership, or ownership.

Initial import requires caller membership in the target Workspace.

Resync: server resolves Source → Workspace, then checks membership, ACTIVE, SOURCE_MANAGED.

Apply revalidates membership; Preview is no authorization cache.

### 18.2 Snapshot privacy

Snapshot is a creator-private temporary resource. All GET/upload/finalize/apply require:

```text
snapshot.created_by == caller.identity.id
and caller still has Workspace access
```

Others cannot read another person's staging Markdown even in the same Workspace. Unauthorized/unknown resources use non-enumerating not-found semantics externally.

### 18.3 Parser/network safety

- no eval / unsafe YAML constructors / custom executable tags。
- Parser follows no `file://`, HTTP links, Markdown image URLs, or includes.
- Phase 2 ingestion makes no outbound requests and reads no server-local paths.
- Markdown/raw HTML retains source content; rendering layer handles safe rendering/sanitization. Store faithfully, render safely.
- Source paths enter only parameterized SQL; no SQL concatenation, shell passing, or local filesystem writes.

### 18.4 Logging

Operational logs never print raw Markdown/frontmatter bodies; record only metadata such as snapshot/source/workspace/actor IDs, counts, state, failure code, duration.

## 19. Limits and Retention

Default application limits：

```text
max manifest entries          20,000
max normalized path           2 KiB UTF-8
max one Markdown file         5 MiB
max total Markdown            256 MiB
max parsed metadata/document  256 KiB
max upload batch              20 files / 10 MiB
max BUILDING snapshots/user   3
max READY snapshots/user      10
```

These are configurable application limits, not core domain semantics.

Retention：

```text
BUILDING: 2 hours
READY: 30 minutes from finalized_at
STALE: 24 hours
APPLIED: 24 hours
```

Cleanup physically deletes staging snapshots in bounded batches; entries cascade-delete. Canonical Source/Document/Revision/SyncRun remain unaffected.

Cleanup runs without an operator while imports keep happening (2026-10-07): starting an import (initial or resync) begins a background sweep after the session is created, at most once per 10 minutes per server process and never two at once in one process; it never delays or fails that request. Staging left by the last imports on an idle instance stays until the next import or a run of `scripts/db/cleanup-import-snapshots.ts`, which remains for on-demand cleanup.

Cleanup and Apply both use short row-lock/conditional-delete semantics to avoid races.

## 20. API Contract

### 20.1 Initial session

```http
POST /api/workspaces/:workspaceId/source-imports
```

Includes source name, root name, manifest. Server creates a BUILDING snapshot.

### 20.2 Existing-source session

```http
POST /api/sources/:sourceId/source-imports
```

Server resolves workspace and based_on_version; client supplies no authoritative workspace/version.

### 20.3 Upload entries

```http
POST /api/source-imports/:snapshotId/entries
Content-Type: multipart/form-data
```

Bounded batches of raw File bytes. Retrying `uploadKey + same payload hash` is idempotent; same uploadKey with different bytes = `UPLOAD_ENTRY_CONFLICT`.

### 20.4 Finalize

```http
POST /api/source-imports/:snapshotId/finalize
```

Complete manifest completeness, path normalization, ignore rules, UTF-8 decoding, Markdown/frontmatter parsing, title resolution, fingerprints, diagnostics, reconciliation, and plan/hash persistence, then BUILDING→READY.

Blocking diagnostics may still produce READY + `has_blockers=true` so users see problems; Apply is forbidden.

### 20.5 Preview

```http
GET /api/source-imports/:snapshotId
```

Return target metadata, expiry, summary, changes, diagnostics.

### 20.6 Apply

```http
POST /api/source-imports/:snapshotId/apply
```

Request does not resend folder/workspace/source/diff/version. Server uses only the bound immutable snapshot + plan.

### 20.7 Error envelope

```json
{
  "error": {
    "code": "SOURCE_VERSION_CONFLICT",
    "message": "The source changed after this preview was created.",
    "details": {
      "snapshotVersion": 7,
      "currentVersion": 8
    }
  }
}
```

UI branches on machine-readable `code`, without parsing messages.

Main codes:

```text
IMPORT_SNAPSHOT_NOT_FOUND
IMPORT_SNAPSHOT_EXPIRED
IMPORT_SNAPSHOT_NOT_READY
IMPORT_SNAPSHOT_STALE
IMPORT_SNAPSHOT_NOT_BUILDING
IMPORT_SNAPSHOT_INVALID
IMPORT_SNAPSHOT_BLOCKED
UPLOAD_ENTRY_CONFLICT
UPLOAD_ENTRY_NOT_FOUND
UPLOAD_SIZE_MISMATCH
UPLOAD_INCOMPLETE
INVALID_UPLOAD_BATCH
IMPORT_BUILDING_QUOTA_EXCEEDED
IMPORT_READY_QUOTA_EXCEEDED
IMPORT_LIMIT_EXCEEDED
INVALID_IMPORT_MANIFEST
INVALID_ASSET_MANIFEST
INVALID_SOURCE_PATH
PATH_COLLISION
SOURCE_PATH_TYPE_CONFLICT
CANONICAL_SOURCE_PATH_CONFLICT
INVALID_FOLDER_NAME
INVALID_MARKDOWN_ENCODING
INVALID_FRONTMATTER
FRONTMATTER_NOT_OBJECT
INVALID_TITLE
TITLE_TOO_LONG
METADATA_TOO_LARGE
IDENTITY_CONFLICT
SOURCE_VERSION_CONFLICT
SOURCE_IMPORT_NOT_ALLOWED
IMPORT_SOURCE_NOT_FOUND
IMPORT_PLAN_VERSION_UNSUPPORTED
IMPORT_PLAN_BINDING_MISMATCH
IMPORT_PLAN_PARENT_MISSING
IMPORT_PLAN_ENTRY_MISSING
IMPORT_PLAN_NODE_MISSING
IMPORT_PLAN_PARENT_MISMATCH
IMPORT_VERSION_ADVANCE_FAILED
IMPORT_APPLY_RETRYABLE
IMPORT_APPLY_FAILED
```

The codes above were verified verbatim against shipped source (`src/modules/sources/` + `src/server/http-error-response.ts` +
`src/app/api/`): `SOURCE_IMPORT_NOT_ALLOWED` replaces the earlier draft's `SOURCE_NOT_ACTIVE` /
`SOURCE_NOT_SOURCE_MANAGED` (merged into one code; old names do not exist in source);
`IMPORT_BUILDING_QUOTA_EXCEEDED` / `IMPORT_READY_QUOTA_EXCEEDED` replace the earlier draft's
`IMPORT_SESSION_LIMIT` (old name absent from source); READY blocker/diagnostic codes
（`IMPORT_SNAPSHOT_BLOCKED`、`SOURCE_PATH_TYPE_CONFLICT`、
`CANONICAL_SOURCE_PATH_CONFLICT`、`TITLE_TOO_LONG`、`METADATA_TOO_LARGE`、
`INVALID_FOLDER_NAME`、`IMPORT_PLAN_*`、`UPLOAD_*`、`INVALID_*_MANIFEST`、
`IMPORT_LIMIT_EXCEEDED`) expose machine-readable codes through the 400-preserving branch,
for direct UI branching.

## 21. Preview UX

Keep Human flow simple:

```text
Choose folder
→ Uploading / analyzing
→ Review changes
→ Fix blockers OR Apply
→ Done
```

Preview header shows Workspace, Source/New Source, based-on version, expiry.

Summary shows Documents/Folders/Assets changes and warning/blocking counts.

Change list defaults to affected entries, filterable by Added/Updated/Moved/Renamed/Archived/Warnings/All.

Warnings do not block Apply; blocking errors disable it.

Fix SOURCE_MANAGED blockers in the source folder and create a new Preview; do not edit canonical source content within Hub Preview.

Version-conflict UI clearly shows stale preview and requires reselecting folder / generating a fresh preview; Phase 2 has no Force Apply.

Snapshot DB persistence permits refreshing/closing/reopening Preview URLs while not cleaned up and caller remains authorized.

## 22. SyncRun Semantics

Preview writes no `sync_runs`. Retain `sync_runs.source_id NOT NULL`; create no phantom Source for first Preview.

Canonical history：

- successful Initial Import：APPLIED SyncRun，based=0/result=1。
- successful resync：APPLIED SyncRun，based=N/result=N+1。
- Successful no-op resync: still APPLIED, version +1, `changed=false`.
- existing-source version conflict：FAILED SyncRun，result_version=null。
- Existing-source unexpected Apply failure: a separate transaction may record FAILED run after rollback.
- Failed initial-import transaction: no Source, thus no canonical FAILED SyncRun.

SyncRun summary stores snapshot ID/hash, counts, failure code; canonical history remains understandable after snapshot TTL deletion.

## 23. Tree Ordering

Folder sync does not use browser upload order.

Sibling ordering deterministic：

```text
folders first
documents second
within each group: case-sensitive name/path ascending
```

After Apply, use Phase 1 contiguous-position rules.

Phase 2 does not support frontmatter.order / custom ordering.

## 24. Repository and Transaction Ports

Add:

```text
ImportSnapshotRepository
ImportSnapshotEntryRepository
```

Add to existing `SourceRepositories` / `SourceUnitOfWork` transaction context so Apply can lock snapshot + Source and mutate canonical Knowledge + SyncRun + snapshot state in one MariaDB transaction.

Create no second transaction framework.

Phase 1 `bindSourceProjection()`, SourceEntry mapping primitives, tree validation, and revision comparison remain canonical mutation authorities.

## 25. Testing Strategy

### 25.1 Pure unit tests

Path / ignore / UTF-8 / frontmatter / title resolution / Markdown AST headings / fingerprints / reconciler / folders / assets all extensively use pure unit tests.

Key fingerprint test: filename-derived title changes revision fingerprint after rename, while reconciliation fingerprint stays unchanged.

Key reconciler tests: UNCHANGED, UPDATED, MOVED, RENAMED, MOVED+UPDATED, ARCHIVED, RESTORED, RESTORED+UPDATED, ambiguous identity, external-id/path conflict, deterministic repeated output.

### 25.2 Integration tests

Test with existing isolated MariaDB + migrations:

- BUILDING→READY snapshot lifecycle。
- upload retry idempotency。
- blockers/warnings。
- initial import creates Source only at Confirm。
- first successful version = 1。
- whole sync version advances exactly once regardless of entry count。
- no-op sync still version +1 / APPLIED run changed=false。
- Unchanged documents create no Revision.
- full rollback fault injection at folder/document/revision/asset/run checkpoints。
- version conflict commits STALE + FAILED run with no Knowledge mutation。
- double Apply idempotency。
- archive/restore same stable IDs。
- authorization removal after Preview。
- cross-user snapshot isolation。
- cleanup does not touch canonical entities。

### 25.3 E2E

At least:

1. First Import happy path：Workspace → folder → Preview → Apply → Source Tree/Document visible。
2. Resync fixture v1→v2: Preview/Apply Added, Updated, Moved, Archived, etc. semantics.
3. Blocking malformed-frontmatter Preview：error visible、Apply disabled。
4. Stale Preview/version conflict: show source changed; no force apply.

### 25.4 Fixtures

```text
tests/fixtures/import/
├─ basic-v1/
├─ basic-v2/
├─ malformed-frontmatter/
├─ title-resolution/
├─ duplicate-content/
└─ assets/
```

Unsafe paths have no fixture directory: they are rejected by server-side path
normalization and pinned by parser unit tests (`normalizeImportPath` rejects
`../`, absolute, control-character, and empty paths), so no snapshot-level
fixture is needed.

### 25.5 Performance acceptance

Provide a smoke fixture of at least 1,000 Markdown files; Finalize/Reconcile must not OOM, time out, or exhibit obvious O(n²) matching.

Reconciler should build lookup maps:

```text
externalId → entry
path → entry
fingerprint → candidate[]
```

Main matching approaches O(n).

## 26. Acceptance Criteria

Before Phase 2 merge, require:

- Accessible Workspaces can create persistent immutable Preview from an entire folder.
- Preview shows Added / Updated / Moved / Renamed / Archived / Restored / Unchanged, assets, diagnostics.
- Warnings permit Apply; any blocker forbids it.
- First Import creates SOURCE_MANAGED Source only in the Confirm transaction.
- Existing sync accepts only source scope, deriving Workspace server-side, without Source transfer.
- One Confirm is one canonical transaction, single SyncRun, single `sync_version +1`.
- Confirmed no-op sync also increments version +1 with `changed=false`.
- UNCHANGED Document creates no Revision.
- Path-only move/rename creates no Revision unless resolved canonical title changes as a result.
- Archive/reappearance with safe matching reuses stable SourceEntry/Document/TreeNode IDs.
- Ambiguous rename does not guess identity.
- Folder rename has no subtree identity guessing.
- Assets store only current metadata/reference, without binary/revision history.
- Failed Apply leaves no partial canonical state.
- Version conflict makes snapshots STALE; no force apply.
- Double Apply repeats no mutation/version/run.
- Snapshots are creator-private; Apply revalidates Workspace membership.
- Snapshots allow TTL physical cleanup without damaging canonical history.
- All unit/integration/E2E pass.

## 27. Implementation Slicing

After written design approval, the implementation plan expands in dependency order:

```text
Slice 1  domain primitives: path/title/parser/fingerprints/reconciler
Slice 2  migrations 006/007 + staging/asset repositories
Slice 3  BUILDING session + raw-byte batch upload + finalize
Slice 4  persisted reconciliation/action plan
Slice 5  transactional whole-snapshot Apply orchestrator
Slice 6  HTTP APIs + error mapping
Slice 7  Import/Preview UI integrated into /knowledge
Slice 8  cleanup + operational limits
Slice 9  E2E / performance / regression hardening
```

Superpowers `writing-plans` produces detailed file-by-file, test-first steps after final spec approval; this document does not prematurely begin implementation.

## 28. Final Design Invariants

Phase 2 must ultimately be describable by these statements:

```text
Source folder is authority.
Preview is immutable staging truth.
Reconciliation is deterministic and conservative.
Apply never re-guesses identity.
One Confirm = one atomic Source transaction.
One successful Confirm = sync_version +1 exactly once.
Stable knowledge identity is preserved only when evidence is safe.
Warnings may proceed; blockers never partially apply.
Authorization is re-checked at mutation time.
Staging can disappear; canonical Knowledge history cannot.
```

These invariants guide Phase 2 implementation/review and later Phase 3+ evolution.
