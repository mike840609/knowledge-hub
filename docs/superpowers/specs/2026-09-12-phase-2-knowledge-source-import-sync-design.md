# Knowledge Hub — Phase 2 Knowledge Source Import & Sync Design

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-09-12 |
| Phase | 2 |
| 名稱 | Knowledge Source Import & Sync |
| 狀態 | In-chat design approved；written spec pending final review |
| 前置 | Phase 0 Foundation & Architecture、Phase 1 Knowledge Core & Tree |
| 後續 | Phase 3 Identity, Workspace Admin & Governance |

## 1. Goal

Phase 2 的目標是讓使用者可以把本機 generic Markdown folder 安全匯入既有 Knowledge Hub，並在之後以完整 folder snapshot 重新同步同一個 `SOURCE_MANAGED` KnowledgeSource。

Phase 2 不取代既有公司 Wiki/TKMS，也不做 production SSO、Workspace administration、MCP、embedding 或 agent memory。它建立的是 AI-native Knowledge Hub 的 ingestion/sync foundation：來源 folder 是 authority，Hub 保存 canonical Knowledge projection，之後人與 Agent 都可在同一份 Knowledge Core 上消費內容。

完成後的主要流程：

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

Phase 2 的核心成功條件：Preview 看見什麼，Confirm 就只能套用那一份 immutable snapshot 與 action plan；任何 canonical Apply 不是全部成功，就是全部 rollback。

## 2. Scope

### 2.1 In Scope

- Generic Markdown whole-folder import。
- Existing `SOURCE_MANAGED` Source whole-folder re-sync。
- Browser folder picker + staged upload session。
- Server-authoritative path normalization、Markdown/frontmatter parsing、title resolution。
- Persistent immutable staging snapshot。
- Preview / Confirm / Apply。
- Deterministic reconciliation 與 diff。
- Added / Updated / Moved / Renamed / Archived / Restored / Unchanged semantics。
- Stable Document/SourceEntry/TreeNode identity preservation where safe。
- Conservative rename/move detection。
- Asset metadata/reference projection；不存 binary。
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

Phase 2 採用 Sources module 內的 ingestion orchestration layer，而不是另建一套會直接操作 Knowledge tables 的 ingestion subsystem。

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

建議結構：

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

1. Scanner/parser 不寫 canonical Knowledge tables。
2. Preview 前最多只寫 staging snapshot。
3. Reconciler 必須 pure、deterministic、side-effect free。
4. Apply 不重新讀 local folder、不重新 parse upload、不重新猜 identity。
5. Apply 只能吃 persisted READY snapshot + persisted server-generated plan。
6. Apply 不繞過 Phase 1 projection/mapping/tree/revision invariants。
7. `SOURCE_MANAGED` 沒有 `force=true`、`skipOwnershipCheck` 等 escape hatch。

## 4. Import Session and Snapshot Lifecycle

### 4.1 Snapshot states

Persisted state：

```text
BUILDING
READY
APPLIED
STALE
```

`EXPIRED` 不存成 state；由 `expires_at <= NOW()` derived。

語意：

- `BUILDING`：manifest 已建立，Markdown bytes 仍在上傳或等待 finalize。
- `READY`：完整 upload、server parsing、diagnostics、reconciliation 與 action plan 已完成。可 Preview；只有 `has_blockers=false` 才可 Apply。
- `APPLIED`：此 snapshot 已成功消費一次；再次 Apply 回 idempotent success，不重跑 canonical mutation。
- `STALE`：existing Source 在 Preview 後 version 已改變；永遠不可 Apply。

### 4.2 Initial import binding

```text
workspace_id = selected Workspace
source_id = NULL
based_on_version = NULL
proposed_source_name = immutable after READY
```

Source 直到 Confirm 才建立。

### 4.3 Existing Source resync binding

Client 只提供 `source_id` route scope。Server resolve：

```text
workspace_id = Source.workspace_id
source_id = existing Source
based_on_version = Source.sync_version at snapshot creation/finalize contract
```

Normal sync 不接受 client supplied Workspace transfer。

### 4.4 Source creation timing

Initial import 採：

> Source 只在 Confirm 時建立，而且 Create Source + all canonical Apply + first APPLIED SyncRun + snapshot consumption 在同一 canonical transaction。

若任何一步失敗，Source 不存在，不留下 empty Source。

## 5. Browser Upload and Generic Adapter

### 5.1 Folder selection

MVP 使用 browser folder selection (`webkitdirectory` / equivalent browser-supported directory selection)。Client 取得 relative paths，但 relative path 僅是 untrusted input；server 做 authoritative normalization。

首次 Import UI：

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

採 staged session，不採單一巨大 multipart request：

```text
create BUILDING snapshot + manifest rows
→ upload Markdown files in bounded batches
→ finalize
→ READY
```

Asset binary Phase 2 不上傳；只傳 metadata/reference fingerprint。

### 5.3 Markdown bytes and UTF-8 authority

Markdown upload 必須傳 raw `File` bytes（例如 bounded `multipart/form-data` batches），不能只傳已解碼 JSON string。理由是 server 必須能用 fatal UTF-8 decoding 驗證原始 bytes。

流程：

```text
browser File bytes
→ server validates request/batch limits
→ fatal UTF-8 decode (UTF-8 / UTF-8 BOM only)
→ valid text stored temporarily in staging
```

UTF-8 BOM 可移除。Invalid UTF-8 是 blocking `INVALID_MARKDOWN_ENCODING`。不自動猜 Big5、Shift-JIS、UTF-16。

### 5.4 Asset transport

Asset Phase 2 只傳：

```text
relativePath
SHA-256 reported by browser
size
MIME hint
lastModified
```

這些欄位是 source-provided metadata，不是 trusted binary integrity/security proof。未來真的保存 binary 時必須 server-side hash 與 MIME detection。

## 6. Path Normalization and Ignore Rules

### 6.1 Canonical source path

Server 將 locator normalization 成 POSIX relative path：

- `\` → `/`。
- remove `.` segments。
- reject absolute paths。
- reject `..` / root escape。
- reject NUL/control characters (`U+0000–U+001F`, `U+007F`)。
- 不做 Unicode NFC/NFD rewrite。
- case-sensitive comparison。
- path 只作 locator，永遠不是 Document ID。
- normalized path collision = blocking `PATH_COLLISION`。

Canonical `source_entries.source_path` 目前不是 DB unique key；Phase 2 必須在 reconciliation preflight 檢測 existing canonical duplicate source paths。如果同一 Source 出現兩個 current mappings 佔用同一 normalized path，視為 blocking/integrity conflict，而不是任意挑一筆。

### 6.2 Ignore rules

固定忽略：

```text
.git/**
.obsidian/**
node_modules/**
.DS_Store
Thumbs.db
any hidden path segment (.xxx)
```

Client 可先 filter 減少傳輸，但 server 仍重新判斷。

### 6.3 Symlink policy

不 follow file/directory symlink。遇到可辨識 symlink 時 skip + `SYMLINK_SKIPPED` warning。Selection root 是 security boundary。

### 6.4 Empty directories

Pure empty directories 不 materialize。Folder nodes 只由實際 included Document/Asset path deterministic derive。

## 7. Markdown Parsing and Canonical Content

### 7.1 Markdown extensions

`.md`、`.markdown` case-insensitive classification 為 Document；path identity 本身仍 case-sensitive。

其他 regular files進 Asset metadata projection。

### 7.2 Frontmatter

使用安全、成熟的 YAML/frontmatter parser；禁止 unsafe constructors/custom executable tags/filesystem includes。

Frontmatter root 必須是 JSON-compatible map/object。Malformed YAML = blocking `INVALID_FRONTMATTER`；non-object root = blocking `FRONTMATTER_NOT_OBJECT`。

### 7.3 Canonical storage

Frontmatter 與 body 分開：

```text
frontmatter → Revision.metadata
body        → Revision.markdown
resolved title → Revision.title
```

`Revision.markdown` 不保存 YAML frontmatter serialization。這避免 YAML key ordering / formatting-only change 被誤判成 Markdown body change。

`title` metadata key仍保留在 metadata；canonical title 是獨立欄位。

### 7.4 Title resolution

優先順序：

```text
valid frontmatter.title
→ first valid Markdown H1
→ filename stem
```

規則：

- `frontmatter.title` 必須是 non-empty string；invalid/empty 只 warning 並 fallback。
- H1 必須由 Markdown AST 判斷，不用 regex，因此 fenced code 裡的 `#` 不算 heading。
- frontmatter title 與 H1 不同：frontmatter wins，`TITLE_CONFLICT` warning，不 blocking。
- filename fallback 只 trim，不做 prettification。
- filename fallback empty = blocking。

## 8. Fingerprints

Phase 2 明確維持兩種 fingerprint，責任不同。

### 8.1 Revision content fingerprint

沿用 Phase 1 canonical revision equality：

```text
hash(title + markdown body + canonical metadata)
```

決定是否建立新 Revision。

### 8.2 Reconciliation fingerprint

Phase 2 另外計算：

```text
hash(markdown body + canonical metadata)
```

刻意排除 resolved title。

理由：若 title 來自 filename fallback，`foo.md → bar.md` 會讓 canonical title 改變，但 body/metadata 未變；這時仍應能 conservative 地辨識 stable Document identity，再於 Apply 建立新的 title Revision。

Reconciliation fingerprint 可從 current Revision 的 markdown + metadata即時計算；MVP 不必新增 canonical DB column。

## 9. Identity Reconciliation

Document matching 固定四個 pass：

```text
1. external_id exact match
2. normalized source_path exact match
3. unique unmatched reconciliationFingerprint + DOCUMENT type
4. otherwise new Document
```

Generic Markdown adapter 不把 frontmatter `id`、`uuid`、`slug` 自動當 external_id；它們仍只是 metadata。Generic adapter 的 external_id 為 null。Adapter contract保留 optional external ID 給未來 documented source-specific adapters。

### 9.1 Conservative matching

Fingerprint fallback 必須 exactly one unmatched candidate 才 reuse identity。

0 candidate → ADDED。

2+ candidates → 不猜：new path ADDED；所有 unmatched old entries 依 snapshot absence 最後 ARCHIVED；加 `AMBIGUOUS_IDENTITY` warning。

不做 filename similarity、edit distance、subtree guessing、LLM guessing。

### 9.2 Identity conflict

若未來 adapter 提供 stable external ID，但：

```text
external ID → Document A
same incoming path → Document B
```

這不是 ambiguity，而是 contract contradiction，blocking `IDENTITY_CONFLICT`。

Duplicate external_id in same snapshot同樣 blocking。

## 10. Diff Model

內部 diff 不用 mutually-exclusive giant enum；採 compositional model：

```text
identity: NEW | EXISTING_ACTIVE | EXISTING_ARCHIVED
pathChanged
parentChanged
filenameChanged
contentChanged
```

UI labels由上述狀態 derive：

- ADDED
- UPDATED
- MOVED
- RENAMED
- ARCHIVED
- RESTORED
- UNCHANGED

一個 Document 可同時 `MOVED + RENAMED + UPDATED`；summary counters可重疊，另提供 distinct affected-document count。

### 10.1 Revision semantics

- path-only move/rename本身不建立 Revision。
- resolved title / markdown / metadata 任一 canonical content 改變才建立 Revision。
- filename rename如果 title 使用 filename fallback，resolved title 會改，因此是 `RENAMED + UPDATED` 並建立 Revision。
- UNCHANGED 不建立 Revision。

### 10.2 Archive / restore

Missing active Document：

```text
SourceEntry → ARCHIVED
Document    → ARCHIVED
TreeNode    → ARCHIVED
```

Archive不建立 Revision。

Archived entry reappears並成功 match：reuse same SourceEntry ID / Document ID / TreeNode ID。Same content只 restore；changed content = restore + new Revision。

## 11. Folder Reconciliation

Generic folder identity只用 normalized folder path，不跨 path 猜 rename/move。

Snapshot從 included entries derive required folder set。例如：

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

規則：

- same active path → reuse folder mapping。
- same archived path → restore。
- required missing path → create。
- existing no longer required → archive bottom-up。

若 `docs/k8s/ → platform/k8s/`，folder preview 是 old Archived + new Added；其 descendant Document若能透過 fingerprint match，可保留 Document identity並顯示 MOVED。

不做 subtree similarity / descendant overlap inference。

## 12. Asset Model

Phase 2 定義 `knowledge_assets` 為 current source reference projection，不是 immutable knowledge history entity。

規則：

- same path + same hash/metadata → unchanged。
- same path + changed hash/metadata → update current projection。
- new path → insert。
- missing path → remove current projection。
- same hash + different path → old remove + new add；不推測 rename。

Phase 2 不建立 Asset Revision、SourceEntry、TreeNode 或 archive lifecycle。

## 13. Snapshot Persistence

新增 staging migration `006-phase-2-import-staging`。

### 13.1 `source_import_snapshots`

建議欄位：

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

DB CHECK constraints要保護 initial-vs-resync shape、state/result shape與 JSON validity。

### 13.2 `source_import_snapshot_entries`

同一 table 承擔 manifest + upload staging + parsed READY payload：

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

Finalize完成 canonical parsed fields與 plan後，在 transition READY前把 `raw_markdown = NULL`，降低 staging storage。

### 13.3 Staging indexes

至少：

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

`source_path_hash = SHA-256(normalized source_path)` 用來在長 TEXT path 上建立 bounded uniqueness；application仍比較實際 path，極端 hash collision視為 integrity failure。

### 13.4 FK and deletion

```text
snapshot.workspace_id → workspaces.id
snapshot.source_id → knowledge_sources.id nullable
snapshot.created_by → users.id
snapshot.result_source_id → knowledge_sources.id nullable
entry.snapshot_id → snapshot.id ON DELETE CASCADE
```

Snapshot/entries 是 staging，可 TTL physical delete；這不套用 canonical Knowledge no-hard-delete lifecycle。

## 14. Asset Schema Refinement

新增 `007-phase-2-asset-projection`：

```text
knowledge_assets.source_path_hash CHAR(64) NOT NULL
knowledge_assets.updated_at DATETIME(6) NOT NULL
UNIQUE(source_id, source_path_hash)
```

Asset repository支援 current projection upsert/update/remove。

不新增 asset status/revision/history。

## 15. Snapshot Hash and Persisted Action Plan

READY snapshot 保存 server-generated `FolderImportPlan` JSON 與 `plan_hash`。

### 15.1 Snapshot hash

對每個 canonicalized staging entry計算 deterministic digest，再依 normalized relative path排序。Snapshot hash至少涵蓋：

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

Browser upload order不得影響 hash。

### 15.2 Action plan

Reconciler輸出 domain plan，不輸出 SQL：

```text
FolderImportPlan
  sourceBinding
  folders: create / restore / archive
  documents: create / restore / move / revise / archive
  assets: upsert / remove
  summary
```

Plan本身不包含預先生成的 canonical UUID。Canonical UUIDv7只在 Apply transaction真正 create entity 時生成。

`plan_version` 允許未來 plan schema演進。

Apply不重新 reconcile；它驗證 snapshot/plan hash後執行 persisted plan。

## 16. Apply Transaction

一次 Confirm = 一次 whole-source transaction = `sync_version +1 exactly once` = 一筆 APPLIED SyncRun。

不能逐 entry 呼叫 Phase 1 `applyKnownEntry()`，因為該 API 是 Phase 1 known-entry operation，會 per-operation advance version/run。Phase 2只 reuse它下層 transaction-bound projection/mapping primitives。

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

任何 failure rollback後 Source不存在。

### 16.3 No-op sync

成功 Confirm即使所有 content都 UNCHANGED，仍：

```text
sync_version N → N+1
one APPLIED SyncRun
summary.changed = false
```

`sync_version` 表示 authoritative full-source snapshot application epoch，不是 Document revision count。

## 17. Concurrency and Version Conflict

MariaDB繼續使用 `READ COMMITTED`；不升 SERIALIZABLE、不引入 Redis/distributed lock。

Concurrency靠：

```text
snapshot row lock
Source row lock
sync_version optimistic token
```

所有 Phase 2 Apply統一 lock order：snapshot → Source。

### 17.1 Two previews

A/B 都 based_on=7。A先成功 → Source=8。B取得 Source lock後發現 8 != 7。

Version conflict是 expected business outcome，不在 UoW裡直接 throw導致全部 rollback；transaction內：

```text
snapshot READY → STALE
insert FAILED SyncRun(failureCode=SOURCE_VERSION_CONFLICT)
COMMIT
```

HTTP layer commit後映射為 `409 SOURCE_VERSION_CONFLICT`。

B的 canonical Knowledge不變。

### 17.2 Double Apply

同 snapshot並行 Apply時先競爭 snapshot row lock。第一個 READY→APPLIED；第二個取得 lock後看到 APPLIED，回 idempotent success：

```text
alreadyApplied=true
sourceId
resultVersion
```

不建立第二筆 SyncRun、不再增 version、不再建 Revision。

### 17.3 Unexpected failure

Unexpected DB/invariant failure：整個 canonical transaction rollback。

- Existing Source：snapshot維持 READY；可在 rollback後用 separate transaction寫 FAILED SyncRun；retry同 snapshot允許。
- Initial import：因 Source不存在且 `sync_runs.source_id NOT NULL`，不建立 phantom FAILED SyncRun；snapshot維持 READY，供 retry/operational diagnostics。
- Deadlock / lock wait timeout映射 `IMPORT_APPLY_RETRYABLE`；MVP不做 domain-level automatic multi-retry。

## 18. Authorization and Security

### 18.1 Caller authority

所有 actor identity來自 trusted `CallerContext`，client不能指定 `created_by`、`triggered_by`、actor、membership或ownership。

Initial import需要 caller是 target Workspace member。

Resync：server resolve Source → Workspace，再檢查 membership、ACTIVE、SOURCE_MANAGED。

Apply再次驗證 membership；Preview不是 authorization cache。

### 18.2 Snapshot privacy

Snapshot是 creator-private temporary resource。所有 GET/upload/finalize/apply都要求：

```text
snapshot.created_by == caller.identity.id
and caller still has Workspace access
```

其他人即使同 Workspace也不能讀另一人的 staging Markdown。Unauthorized/unknown resource對外用 non-enumerating not-found semantics。

### 18.3 Parser/network safety

- no eval / unsafe YAML constructors / custom executable tags。
- parser不 follow `file://`、HTTP links、Markdown image URLs、includes。
- Phase 2 ingestion不發 outbound request，不讀 server local file path。
- Markdown/raw HTML保存 source content；rendering layer負責 safe rendering/sanitization。Store faithfully, render safely。
- source path只進 parameterized SQL；不拼 SQL、不傳 shell、不寫本機 filesystem。

### 18.4 Logging

Operational logs不印 raw Markdown/frontmatter body。只記 snapshot/source/workspace/actor IDs、counts、state、failure code、duration等 metadata。

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

這些是 configurable application limits，不是核心 domain semantics。

Retention：

```text
BUILDING: 2 hours
READY: 30 minutes from finalized_at
STALE: 24 hours
APPLIED: 24 hours
```

Cleanup bounded batch physical-delete staging snapshots；entries cascade delete。Canonical Source/Document/Revision/SyncRun不受影響。

Cleanup與Apply都使用 short row-lock/conditional-delete semantics避免 race。

## 20. API Contract

### 20.1 Initial session

```http
POST /api/workspaces/:workspaceId/source-imports
```

包含 source name、root name、manifest。Server建立 BUILDING snapshot。

### 20.2 Existing-source session

```http
POST /api/sources/:sourceId/source-imports
```

Server resolve workspace與 based_on_version；client不提供 authoritative workspace/version。

### 20.3 Upload entries

```http
POST /api/source-imports/:snapshotId/entries
Content-Type: multipart/form-data
```

Bounded batch raw File bytes。`uploadKey + same payload hash` retry idempotent；同 uploadKey不同 bytes = `UPLOAD_ENTRY_CONFLICT`。

### 20.4 Finalize

```http
POST /api/source-imports/:snapshotId/finalize
```

完成 manifest completeness、path normalization、ignore、UTF-8 decode、Markdown/frontmatter parse、title resolution、fingerprints、diagnostics、reconciliation、plan/hash persistence，然後 BUILDING→READY。

Blocking diagnostics仍可 READY + `has_blockers=true`，讓使用者看到問題；只是不能 Apply。

### 20.5 Preview

```http
GET /api/source-imports/:snapshotId
```

返回 target metadata、expiry、summary、changes、diagnostics。

### 20.6 Apply

```http
POST /api/source-imports/:snapshotId/apply
```

Request不重傳 folder/workspace/source/diff/version。Server只使用 bound immutable snapshot + plan。

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

UI依 machine-readable `code` 判斷，不 parse message。

主要 codes：

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

上述 codes 均已對 shipped source 逐字驗證（`src/modules/sources/` + `src/server/http-error-response.ts` +
`src/app/api/`）：`SOURCE_IMPORT_NOT_ALLOWED` 取代本節舊草稿的 `SOURCE_NOT_ACTIVE` /
`SOURCE_NOT_SOURCE_MANAGED`（兩者合併為單一 code，舊名在 source 中不存在）；
`IMPORT_BUILDING_QUOTA_EXCEEDED` / `IMPORT_READY_QUOTA_EXCEEDED` 取代舊草稿的
`IMPORT_SESSION_LIMIT`（舊名在 source 中不存在）；READY blocker/diagnostic codes
（`IMPORT_SNAPSHOT_BLOCKED`、`SOURCE_PATH_TYPE_CONFLICT`、
`CANONICAL_SOURCE_PATH_CONFLICT`、`TITLE_TOO_LONG`、`METADATA_TOO_LARGE`、
`INVALID_FOLDER_NAME`、`IMPORT_PLAN_*`、`UPLOAD_*`、`INVALID_*_MANIFEST`、
`IMPORT_LIMIT_EXCEEDED`）沿 400-preserving branch 透出 machine-readable code，
供 UI 直接分支。

## 21. Preview UX

Human flow保持簡單：

```text
Choose folder
→ Uploading / analyzing
→ Review changes
→ Fix blockers OR Apply
→ Done
```

Preview header顯示 Workspace、Source/New Source、based-on version、expiry。

Summary顯示 Documents/Folders/Assets changes，以及 warning/blocking counts。

Change list預設只顯示 affected entries，可 filter Added/Updated/Moved/Renamed/Archived/Warnings/All。

Warnings不阻塞 Apply；blocking errors disable Apply。

SOURCE_MANAGED blocker修正方式是回來源 folder修正並重新建立 Preview，不在 Hub Preview裡編輯 canonical source content。

Version conflict UI清楚顯示 stale preview並要求重新選 folder / generate fresh preview；Phase 2無 Force Apply。

Snapshot DB persistence允許 refresh/close/reopen Preview URL，只要尚未 cleanup且 caller仍有權限。

## 22. SyncRun Semantics

Preview不寫 `sync_runs`。現有 `sync_runs.source_id NOT NULL` 維持，不為首次 Preview建立 phantom Source。

Canonical history：

- successful Initial Import：APPLIED SyncRun，based=0/result=1。
- successful resync：APPLIED SyncRun，based=N/result=N+1。
- successful no-op resync：同樣 APPLIED，version +1，`changed=false`。
- existing-source version conflict：FAILED SyncRun，result_version=null。
- existing-source unexpected Apply failure：rollback後可 separate transaction記 FAILED run。
- initial-import failed transaction：無 Source，因此無 canonical FAILED SyncRun。

SyncRun summary保存 snapshot ID/hash、counts與 failure code；snapshot TTL刪除後 canonical history仍可理解。

## 23. Tree Ordering

Folder sync不使用 browser upload order。

Sibling ordering deterministic：

```text
folders first
documents second
within each group: case-sensitive name/path ascending
```

套用後使用 Phase 1 contiguous position rules。

Phase 2不支援 frontmatter.order / custom ordering。

## 24. Repository and Transaction Ports

新增：

```text
ImportSnapshotRepository
ImportSnapshotEntryRepository
```

並加入既有 `SourceRepositories` / `SourceUnitOfWork` transaction context，使 Apply 能在同一 MariaDB transaction lock snapshot + Source + mutate canonical Knowledge + SyncRun + snapshot state。

不建立第二套 transaction framework。

Phase 1 `bindSourceProjection()`、SourceEntry mapping primitives、tree validation與revision comparison繼續是 canonical mutation authority。

## 25. Testing Strategy

### 25.1 Pure unit tests

Path / ignore / UTF-8 / frontmatter / title resolution / Markdown AST heading / fingerprints / reconciler / folders / assets全部大量使用 pure unit tests。

重要 fingerprint test：filename-derived title在 rename後讓 revision fingerprint改變，但 reconciliation fingerprint保持不變。

重要 reconciler tests：UNCHANGED、UPDATED、MOVED、RENAMED、MOVED+UPDATED、ARCHIVED、RESTORED、RESTORED+UPDATED、ambiguous identity、external-id/path conflict、deterministic repeated output。

### 25.2 Integration tests

使用現有 isolated MariaDB + migrations測：

- BUILDING→READY snapshot lifecycle。
- upload retry idempotency。
- blockers/warnings。
- initial import creates Source only at Confirm。
- first successful version = 1。
- whole sync version advances exactly once regardless of entry count。
- no-op sync still version +1 / APPLIED run changed=false。
- unchanged docs不新增 Revision。
- full rollback fault injection at folder/document/revision/asset/run checkpoints。
- version conflict commits STALE + FAILED run with no Knowledge mutation。
- double Apply idempotency。
- archive/restore same stable IDs。
- authorization removal after Preview。
- cross-user snapshot isolation。
- cleanup does not touch canonical entities。

### 25.3 E2E

至少：

1. First Import happy path：Workspace → folder → Preview → Apply → Source Tree/Document visible。
2. Resync fixture v1→v2：Preview/Apply Added、Updated、Moved、Archived等語意。
3. Blocking malformed-frontmatter Preview：error visible、Apply disabled。
4. Stale Preview/version conflict：顯示 source changed、不可 force apply。

### 25.4 Fixtures

```text
tests/fixtures/import/
├─ basic-v1/
├─ basic-v2/
├─ malformed-frontmatter/
├─ title-resolution/
├─ duplicate-content/
├─ assets/
└─ unsafe-path-manifest/
```

### 25.5 Performance acceptance

至少有 1,000 Markdown files smoke fixture，Finalize/Reconcile不得 OOM、timeout或明顯 O(n²) matching。

Reconciler應建立 lookup maps：

```text
externalId → entry
path → entry
fingerprint → candidate[]
```

主要 matching接近 O(n)。

## 26. Acceptance Criteria

Phase 2 merge前必須滿足：

- Accessible Workspace可整個 folder建立 persistent immutable Preview。
- Preview能顯示 Added / Updated / Moved / Renamed / Archived / Restored / Unchanged、assets與diagnostics。
- Warning可 Apply；任何 blocker不可 Apply。
- First Import只在 Confirm transaction建立 SOURCE_MANAGED Source。
- Existing sync只接受 source scope，Workspace server-side derive，不能 transfer Source。
- 一次 Confirm是單一 canonical transaction、single SyncRun、single `sync_version +1`。
- No-op confirmed sync同樣 version +1，`changed=false`。
- UNCHANGED Document不建 Revision。
- path-only move/rename不建 Revision，除非 resolved canonical title因此改變。
- Archive/reappearance安全 match時 reuse stable SourceEntry/Document/TreeNode IDs。
- Ambiguous rename不猜 identity。
- Folder rename不做 subtree identity guessing。
- Asset只保存 current metadata/reference，不保存 binary/revision history。
- Failed Apply不留下 partial canonical state。
- Version conflict使 snapshot STALE，不可 force apply。
- Double Apply不重複 mutation/version/run。
- Snapshot creator-private且Apply重新驗證 Workspace membership。
- Snapshot可 TTL physical cleanup而不傷 canonical history。
- Unit/integration/E2E全部通過。

## 27. Implementation Slicing

Written design approved後，implementation plan按依賴順序細化：

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

詳細 file-by-file、test-first implementation steps由 Superpowers `writing-plans` 在本 spec 最終核准後產生；本文件不提前進入 implementation。

## 28. Final Design Invariants

Phase 2 最終必須能用以下幾條話描述：

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

這些 invariant 是 Phase 2 實作、review 與後續 Phase 3+ 演進時的判斷基準。