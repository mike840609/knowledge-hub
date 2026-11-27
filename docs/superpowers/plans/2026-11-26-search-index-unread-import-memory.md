# Search Index, Unread Preservation, and Import Memory Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize search query projection and lookup indexes, preserve unread notification state across reversible archive/hide/move transitions, and reduce peak memory during folder import finalization and apply.

**Architecture:** Additive MariaDB migration `036` adds three missing composite/prefix indexes (`source_entries`, `task_export_bindings`, `document_share_link_recipients`), while `MariaDbKnowledgeSearchRepository.search` defers `LONGTEXT` snippet extraction until after `ORDER BY ... LIMIT ? OFFSET ?` and `AgentContextService.build` caches source trees per `sourceId`. Unread evaluation in `judgeNamedShares` and `DocumentReviewService.unreadMentions` distinguishes permanently dead items (marked read on first poll) from temporarily unreachable items (left unread and paged past via `offset`). Import integrity hashing streams entry JSON into SHA-256 without materializing a multi-hundred-megabyte concatenated string, `finalizePrepare` frees `rawMarkdown` immediately after parsing each entry, and `linksBeforeLocking` only parses links for documents created or revised by the plan.

**Tech Stack:** TypeScript, Next.js 15, MariaDB 10.11, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-26-search-index-unread-import-memory-design.md`

## Global Constraints

- Follow `eslint.config.mjs` architectural boundaries: `src/modules/**` must not import `next`, `react`, `mariadb`, or `infrastructure/`.
- Migration version must be `36` (`036-search-and-unread-indexes.ts`) and registered in `src/infrastructure/database/mariadb/migrations/index.ts` in strictly increasing order (`tests/unit/migration-versions.test.ts`).
- `MariaDbKnowledgeSearchRepository.search` must keep `SET STATEMENT max_statement_time=5 FOR`, preserve `r.created_at ASC` / `r.created_at DESC` / `title_hits DESC` ordering, preserve `utf8mb4_unicode_ci` case- and width-insensitive matching, and return identical `KnowledgeSearchRow` shapes.
- `hashReadyImportSnapshot` must produce the exact same SHA-256 hex digest as `sha256(stableStringify(...))` for all inputs, including when `snapshot.importScope` is defined or omitted and when entries collide on `sourcePath` or have `sourcePath === null`.
- Permanently dead unread shares/mentions (revoked link, expired link, deleted comment, retracted thread, or missing target/comment/thread/link row) must still be marked read on the first unread poll; temporarily unreachable unread shares/mentions (archived document/folder/source/workspace, hidden comment/thread, document moved out of shared folder, or non-recipient on a `NAMED` link) must keep `read_at IS NULL` and be paged past so they cannot hide older live unread items.

## Review Focus

- Search queries with `terms: []` (filter-only search by `path`, `sourceId`, or date range) must still project snippets and preserve sort order without redundant `LOCATE` calls on unreturned rows.
- Unread named shares or mentions where more than `limit` (`FOLLOW_LIMIT = 100`) newest unread items are temporarily unreachable (e.g. archived or hidden) must still page past them via `offset` and return older live unread items without an infinite loop when permanently dead and temporarily unreachable items are mixed in the same batch.
- `hashReadyImportSnapshot` with `snapshot.importScope` present vs. `undefined`, and with multiple entries having `sourcePath: null` or identical `sourcePath`, must match the canonical JSON key order (`adapterType`, `adapterVersion`, `entries`, optional `importScope`, `planVersion`, `sourceBinding`) byte-for-byte.
- `ApplyFolderImportService.linksBeforeLocking` when `snapshot.plan` has only move/archive/restore actions (`create: []`, `revise: []`) must skip `listBySnapshotId` and still return a working fallback `(markdown) => extractDocumentLinks(markdown)`.
- `AgentContextService.build` with multiple documents in the same source must call `r.tree.listBySource(sourceId)` only once per distinct `sourceId` per `assemble` pass.

---

### Task 1: Search Performance & Index Optimization (Migration 036, Deferred Snippet Projection, and Agent Context Source-Tree Caching)

**Files:**
- Create: `src/infrastructure/database/mariadb/migrations/036-search-and-unread-indexes.ts`
- Modify: `src/infrastructure/database/mariadb/migrations/index.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/knowledge-search.ts`
- Modify: `src/modules/knowledge/application/agent-context-service.ts`
- Test: `tests/unit/search-and-unread-indexes-migration.test.ts`

**Interfaces:**
- Produces:
  - `searchAndUnreadIndexesMigration: Migration` (`version: 36`, `name: "search-and-unread-indexes"`) in `src/infrastructure/database/mariadb/migrations/036-search-and-unread-indexes.ts`
  - Deferred snippet projection SQL in `MariaDbKnowledgeSearchRepository.search(criteria: KnowledgeSearchCriteria): Promise<KnowledgeSearchRow[]>`
  - Per-source tree cache in `AgentContextService.build`

- [ ] **Step 1: Write the failing unit tests in `tests/unit/search-and-unread-indexes-migration.test.ts`**

Test:
1. `migrations` contains `version: 36, name: "search-and-unread-indexes"` with `idx_entries_source_path`, `idx_task_bindings_workspace_owner`, and `idx_recipient_user_unread`.
2. `MariaDbKnowledgeSearchRepository.search` uses a deferred outer join on `knowledge_revisions` after `LIMIT ? OFFSET ?` so `SUBSTRING` and `CHAR_LENGTH` are computed once in the outer projection, while keeping `r.created_at` ordering in the inner candidate query.
3. `AgentContextService.build` with two documents in the same `sourceId` calls `tree.listBySource` once for that `sourceId` instead of once per document.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/search-and-unread-indexes-migration.test.ts`
Expected: FAIL because migration 036 does not exist yet, `knowledge-search.ts` computes `LOCATE` three times in the flat query, and `AgentContextService.build` calls `tree.listBySource` on every document iteration.

- [ ] **Step 3: Implement migration 036, deferred snippet SQL in `knowledge-search.ts`, and per-source tree cache in `agent-context-service.ts`**

1. Create `src/infrastructure/database/mariadb/migrations/036-search-and-unread-indexes.ts` with `version: 36`, `name: "search-and-unread-indexes"`, and the three `CREATE INDEX` statements from Spec §4.1; register it in `src/infrastructure/database/mariadb/migrations/index.ts`.
2. In `src/infrastructure/database/mariadb/repositories/knowledge-search.ts`, keep `SET STATEMENT max_statement_time=${SEARCH_TIMEOUT_SECONDS} FOR`, build the inner subquery `matched` with `d.id AS document_id, d.source_id AS source_id, d.current_revision_id AS current_revision_id, s.workspace_id AS workspace_id, r.title AS title, d.page_icon AS page_icon, s.name AS source_name, w.name AS workspace_name, d.status AS status, r.created_at AS updated_at, (${titleHits}) AS title_hits` and `ORDER BY ${order} LIMIT ? OFFSET ?`, and in the outer query `JOIN knowledge_revisions body_r ON body_r.id = matched.current_revision_id` to compute `LOCATE(?, body_r.markdown COLLATE utf8mb4_unicode_ci) AS anchor_at`, `CHAR_LENGTH(body_r.markdown) AS markdown_length`, and `snippet`. Preserve exact result ordering and parameter order.
3. In `src/modules/knowledge/application/agent-context-service.ts`, cache `r.tree.listBySource(document.sourceId)` in a `Map<string, Awaited<ReturnType<typeof r.tree.listBySource>>>()` inside `assemble` so multiple documents from the same source reuse the loaded tree.

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/search-and-unread-indexes-migration.test.ts tests/unit/migration-versions.test.ts tests/unit/mvp-search-filters.test.ts tests/unit/phase4-search-repository-timeout.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/database/mariadb/migrations/036-search-and-unread-indexes.ts src/infrastructure/database/mariadb/migrations/index.ts src/infrastructure/database/mariadb/repositories/knowledge-search.ts src/modules/knowledge/application/agent-context-service.ts tests/unit/search-and-unread-indexes-migration.test.ts
git commit -m "perf(search): add lookup indexes, defer snippet projection, and cache context source trees"
```

---

### Task 2: Reversible Unread-Status Preservation for Named Shares and Review Mentions

**Files:**
- Modify: `src/modules/knowledge/ports/document-share-link-repository.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/document-share-links.ts`
- Modify: `src/modules/knowledge/ports/review-mention-repository.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/review-mentions.ts`
- Modify: `src/modules/knowledge/application/internal/named-share-judgement.ts`
- Modify: `src/modules/knowledge/application/document-review-service.ts`
- Modify: `docs/superpowers/specs/2026-10-29-review-mentions-design.md`
- Modify: `docs/superpowers/specs/2026-11-03-named-recipient-share-design.md`
- Modify: `tests/unit/named-share-judgement.test.ts`
- Create: `tests/unit/unread-mentions-preservation.test.ts`
- Modify: `tests/integration/review-mentions.test.ts`
- Modify: `tests/integration/named-share-inbox.test.ts`

**Interfaces:**
- Produces:
  - `DocumentShareLinkRepository.listUnreadForRecipient(userId: string, limit: number, offset?: number): Promise<ReceivedShareLink[]>`
  - `ReviewMentionRepository.listUnreadByRecipient(userId: string, limit: number, offset?: number): Promise<ReviewMention[]>`
  - Updated `judgeNamedShares(r, userId, limit, now, unreadOnly)` in `src/modules/knowledge/application/internal/named-share-judgement.ts`
  - Updated `DocumentReviewService.unreadMentions(r, userId)` in `src/modules/knowledge/application/document-review-service.ts`

- [ ] **Step 1: Write failing unit tests in `tests/unit/named-share-judgement.test.ts` and `tests/unit/unread-mentions-preservation.test.ts`**

Test:
1. In `tests/unit/named-share-judgement.test.ts`:
   - A permanently dead unread share (missing target row or revoked/expired link) is marked read via `markRecipientRead`.
   - A temporarily unreachable unread share (target document/folder/source exists and link is active, but target or source is `ARCHIVED`) is NOT marked read (`markRecipientRead` not called), is excluded from `judgeNamedShares(..., true)`, is paged past via `offset` so an older live unread share in the next page is still returned, and returns unread once the target becomes `ACTIVE` again.
2. In `tests/unit/unread-mentions-preservation.test.ts`:
   - A permanently dead unread mention (deleted comment, retracted thread, revoked/expired link, or missing comment/thread/link/document) is marked read via `reviewMentions.markRead`.
   - A temporarily unreachable unread mention (comment or thread with `visibility === "HIDDEN"`, or document temporarily archived or moved out of a shared folder) is NOT marked read, is paged past via `offset` so an older live unread mention is still returned, and reappears as unread when visibility/placement is restored.

- [ ] **Step 2: Run the unit tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/named-share-judgement.test.ts tests/unit/unread-mentions-preservation.test.ts`
Expected: FAIL because `judgeNamedShares` and `unreadMentions` currently mark all dead items read regardless of whether the unreachability is reversible.

- [ ] **Step 3: Implement offset pagination and permanent-vs-temporary classification in repositories, `named-share-judgement.ts`, and `document-review-service.ts`**

1. Add optional `offset = 0` to `listUnreadForRecipient(userId: string, limit: number, offset?: number)` in `src/modules/knowledge/ports/document-share-link-repository.ts` and `src/infrastructure/database/mariadb/repositories/document-share-links.ts` (`LIMIT ? OFFSET ?` when `offset > 0`, keeping `LIMIT ?` when `offset === 0`).
2. Add optional `offset = 0` to `listUnreadByRecipient(userId: string, limit: number, offset?: number)` in `src/modules/knowledge/ports/review-mention-repository.ts` and `src/infrastructure/database/mariadb/repositories/review-mentions.ts` (`LIMIT ? OFFSET ?` when `offset > 0`, keeping `LIMIT ?` when `offset === 0`).
3. In `src/modules/knowledge/application/internal/named-share-judgement.ts`:
   - Classify each unread row: if `!isActiveShareLink(link, now)` or the target row (`document`, `folder` with `nodeType === "FOLDER"`, or `source`) does not exist, it is permanently dead (`markRecipientRead`); if the target row exists and link is active but `openShareLinkTarget` returns `null`, it is temporarily unreachable (do not mark read).
   - Page with `offset` (advancing `offset` by `temporaryDeadCount + liveInBatchCount`) until `live.length >= limit` or `rows.length < limit`, returning `live.slice(0, limit)`.
   - Remove the resolved `ponytail: a document archived and restored loses its share's unread mark` comment.
4. In `src/modules/knowledge/application/document-review-service.ts`:
   - In `unreadMentions`, page through `r.reviewMentions.listUnreadByRecipient(userId, FOLLOW_LIMIT, offset)`:
     - Mark as read only permanently dead mentions (missing comment, missing thread, `comment.deletedAt !== null`, `isRetractedThread(comments)`, missing link, `!isActiveShareLink(link, this.clock())`, or missing document row `!(await r.documents.findById(thread.documentId))`).
     - Leave temporarily unreachable mentions (`thread.visibility === "HIDDEN"`, `comment.visibility === "HIDDEN"`, or `linkValid` returning `false` on an active link and existing document) unread, advancing `offset` past them and collecting up to `FOLLOW_LIMIT` live mentions.
   - Remove the resolved `ponytail: a thread the owner hides then restores, or a document moved out of a shared folder and back, loses its unread mark` comment.
5. Update `tests/integration/review-mentions.test.ts` (test at line 392: verify a deleted comment or revoked link marks the mention read, while a hidden-then-restored comment preserves its unread mark and cannot hide an older live mention) and `tests/integration/named-share-inbox.test.ts` (add test that archiving and restoring a document preserves the named share's unread mark), plus record the amendment in `docs/superpowers/specs/2026-10-29-review-mentions-design.md` and `docs/superpowers/specs/2026-11-03-named-recipient-share-design.md`.

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/named-share-judgement.test.ts tests/unit/unread-mentions-preservation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/knowledge/ports/document-share-link-repository.ts src/infrastructure/database/mariadb/repositories/document-share-links.ts src/modules/knowledge/ports/review-mention-repository.ts src/infrastructure/database/mariadb/repositories/review-mentions.ts src/modules/knowledge/application/internal/named-share-judgement.ts src/modules/knowledge/application/document-review-service.ts docs/superpowers/specs/2026-10-29-review-mentions-design.md docs/superpowers/specs/2026-11-03-named-recipient-share-design.md tests/unit/named-share-judgement.test.ts tests/unit/unread-mentions-preservation.test.ts tests/integration/review-mentions.test.ts tests/integration/named-share-inbox.test.ts
git commit -m "fix(inbox): preserve unread state for temporarily unreachable mentions and named shares"
```

---

### Task 3: Folder Import Memory Optimization (Streaming Snapshot Hash, Raw-Markdown Release, and Plan-Scoped Link Pre-extraction)

**Files:**
- Modify: `src/modules/sources/domain/import-integrity.ts`
- Modify: `src/modules/sources/application/finalize-folder-import.ts`
- Modify: `src/modules/sources/application/apply-folder-import.ts`
- Create: `tests/unit/import-memory-optimizations.test.ts`

**Interfaces:**
- Produces:
  - Streaming `hashReadyImportSnapshot(snapshot, entries): string` in `src/modules/sources/domain/import-integrity.ts`
  - Immediate `rawMarkdown` release in `FinalizeFolderImportService.finalizePrepare` (`src/modules/sources/application/finalize-folder-import.ts`)
  - Plan-scoped `ApplyFolderImportService.linksBeforeLocking` (`src/modules/sources/application/apply-folder-import.ts`)

- [ ] **Step 1: Write failing unit tests in `tests/unit/import-memory-optimizations.test.ts`**

Test:
1. `hashReadyImportSnapshot` produces the exact same SHA-256 hex digest as a reference `sha256(stableStringify(...))` implementation across:
   - snapshots with and without `importScope`;
   - entries with unique `sourcePath`, colliding `sourcePath`, and `sourcePath: null`.
2. `FinalizeFolderImportService.finalize` nulls out `rawMarkdown` on staged entries during `finalizePrepare` so the in-memory staged entry objects no longer retain `rawMarkdown` once parsed.
3. `ApplyFolderImportService.apply`:
   - When `snapshot.plan` has `documents.create: []` and `documents.revise: []` (e.g. move/archive-only plan), `linksBeforeLocking` does NOT call `importSnapshotEntries.listBySnapshotId` before the Apply transaction, calling `listBySnapshotId` only once inside the transaction for integrity verification.
   - When `snapshot.plan` creates or revises 1 document out of many staged entries, `linksBeforeLocking` only parses links for the referenced `uploadKey` and does not parse unchanged entries.

- [ ] **Step 2: Run the unit test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/import-memory-optimizations.test.ts`
Expected: FAIL because `FinalizeFolderImportService` retains `rawMarkdown` on staged entries and `ApplyFolderImportService.linksBeforeLocking` always calls `listBySnapshotId` and parses every document entry.

- [ ] **Step 3: Implement streaming `hashReadyImportSnapshot`, `rawMarkdown` release in `finalize-folder-import.ts`, and plan-scoped `linksBeforeLocking` in `apply-folder-import.ts`**

1. In `src/modules/sources/domain/import-integrity.ts`:
   - Sort a shallow copy of `entries` by `sourcePath` (`null` last, then `compareImportText(left.sourcePath, right.sourcePath)`), lazily computing and caching `stableStringify(hashableEntry(entry))` in a `WeakMap<ImportSnapshotEntry, string>()` only when `left.sourcePath === right.sourcePath`.
   - Stream the canonical JSON tokens into `createHash("sha256")` in exact alphabetical key order:
     - `{"adapterType":` + `stableStringify(snapshot.adapterType)`
     - `,"adapterVersion":` + `stableStringify(snapshot.adapterVersion)`
     - `,"entries":[` + for each sorted entry (comma-separated) `JSON.stringify(cachedOrComputeSerialized(entry))` + `]`
     - if `snapshot.importScope !== undefined`: `,"importScope":` + `stableStringify(snapshot.importScope)`
     - `,"planVersion":` + `stableStringify(snapshot.planVersion)`
     - `,"sourceBinding":` + `stableStringify( snapshot.sourceBinding )`
     - `}`
2. In `src/modules/sources/application/finalize-folder-import.ts`:
   - Inside the `for (const entry of kept.sort(...))` loop, immediately after reading `entry.staged.rawMarkdown` into `parseGenericMarkdownText`, clear `(entry.staged as { rawMarkdown: string | null }).rawMarkdown = null`.
3. In `src/modules/sources/application/apply-folder-import.ts`:
   - In `linksBeforeLocking(caller, snapshotId)`, read `snapshot = await repositories.importSnapshots.findById(snapshotId)`.
   - If `!snapshot || snapshot.createdBy !== caller.identity.id || snapshot.state !== "READY" || !snapshot.plan`, return `(markdown) => extractDocumentLinks(markdown)`.
   - Collect `neededUploadKeys = new Set<string>()` and inline legacy markdown strings from `snapshot.plan.documents.create` and `snapshot.plan.documents.revise`.
   - If `neededUploadKeys.size === 0` and there are no inline markdown strings, skip `repositories.importSnapshotEntries.listBySnapshotId(snapshotId)` in `linksBeforeLocking`.
   - Otherwise, load entries and populate `byHash.set(hash(entry.markdown), extractDocumentLinks(entry.markdown))` directly inside the loop only for entries where `neededUploadKeys.has(entry.uploadKey)`.

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/import-memory-optimizations.test.ts tests/unit/phase2-import-integrity.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/sources/domain/import-integrity.ts src/modules/sources/application/finalize-folder-import.ts src/modules/sources/application/apply-folder-import.ts tests/unit/import-memory-optimizations.test.ts
git commit -m "perf(imports): stream snapshot hashing, release staged rawMarkdown, and scope link pre-parsing"
```
