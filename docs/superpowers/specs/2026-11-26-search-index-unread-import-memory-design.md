# Search Index, Unread Preservation, and Import Memory Optimization — Design Spec

| Item | Details |
| --- | --- |
| Date | 2026-11-26 |
| Scope | Search query/index optimization, reversible unread-notification preservation, and folder-import memory reduction |
| Amends | `2026-10-29-review-mentions-design.md`, `2026-11-03-named-recipient-share-design.md` |
| Status | Approved for implementation |

## 1. Intent and Why

Three bottlenecks and edge-case defects were identified in the current architecture:

1. **Search performance and missing lookup indexes:**
   - `MariaDbKnowledgeSearchRepository.search` (`src/infrastructure/database/mariadb/repositories/knowledge-search.ts`) evaluates `LOCATE(?, r.markdown COLLATE utf8mb4_unicode_ci)` three times per row plus `CHAR_LENGTH(r.markdown)` and `SUBSTRING(r.markdown, ...)` on `LONGTEXT` for every matching candidate row in the workspace *before* sorting and applying `LIMIT ? OFFSET ?`.
   - `source_entries` has no prefix index on `(source_id, source_path)` for path-filtered searches (`EXISTS (SELECT 1 FROM source_entries e WHERE e.document_id = d.id AND e.source_id = d.source_id AND (e.source_path = ? OR e.source_path LIKE ? ESCAPE '!'))`) or `findBySourcePath`.
   - `task_export_bindings` has no composite index on `(workspace_id, owner_user_id)` for `buildTaskSearchSql`'s `WHERE b.workspace_id = ? AND b.owner_user_id = ?`.
   - `document_share_link_recipients` has `ix_recipient_user (user_id, added_at)` without `read_at`, unlike `review_comment_mentions` (`ix_mention_inbox (mentioned_user_id, read_at, created_at)`), causing unread polls (`WHERE r.user_id = ? AND r.read_at IS NULL ORDER BY r.added_at DESC`) to scan past already-read rows.
   - `AgentContextService.build` (`src/modules/knowledge/application/agent-context-service.ts`) calls `r.tree.listBySource(document.sourceId)` inside the per-document loop without caching by `sourceId`.

2. **Unread state lost on reversible unreachability (`ponytail:` items):**
   - `DocumentReviewService.unreadMentions` (`src/modules/knowledge/application/document-review-service.ts:567`) and `judgeNamedShares` (`src/modules/knowledge/application/internal/named-share-judgement.ts:36`) mark every currently non-live ("dead") unread mention or named share as read (`markRead` / `markRecipientRead`) on the first Inbox poll so dead rows cannot fill the `FOLLOW_LIMIT` (100) window and hide older live unread items.
   - Because reversible conditions (a comment or thread hidden by the owner, a document moved out of a shared folder, or a document/folder/source temporarily archived) are treated identically to irreversible conditions (link revoked or expired, comment deleted, or target row missing), restoring a hidden comment/thread, moving a document back into a shared folder, or restoring an archived document permanently loses the recipient's unread mark.

3. **Import memory peak during Finalize and Apply:**
   - `hashReadyImportSnapshot` (`src/modules/sources/domain/import-integrity.ts`) serializes every entry (including up to 256 MiB of `markdown`) into `orderedEntries`, and then runs `stableStringify` over the entire array at once — allocating a second JSON-escaped copy of every entry and one contiguous multi-hundred-megabyte string before hashing.
   - `FinalizeFolderImportService.finalizePrepare` (`src/modules/sources/application/finalize-folder-import.ts`) retains `entry.staged.rawMarkdown` in memory across all entries even after `parseGenericMarkdownText` has produced `parsed.markdown`.
   - `ApplyFolderImportService.linksBeforeLocking` (`src/modules/sources/application/apply-folder-import.ts`) loads and parses Markdown links for *every* `DOCUMENT` entry in the snapshot, even when `snapshot.plan` only creates or revises a few documents (or none), and holds an intermediate `bodies: string[]` array of all Markdown strings in memory.

## 2. Goals and Non-Goals

### Goals
- Add migration `036-search-and-unread-indexes.ts` with additive indexes on `source_entries (source_id, source_path(255))`, `task_export_bindings (workspace_id, owner_user_id)`, and `document_share_link_recipients (user_id, read_at, added_at)`.
- Defer `LONGTEXT` snippet extraction (`LOCATE`, `CHAR_LENGTH`, `SUBSTRING`) in `MariaDbKnowledgeSearchRepository.search` to the outer projection after `ORDER BY ... LIMIT ? OFFSET ?`, and cache `tree.listBySource` per `sourceId` in `AgentContextService.build`.
- Preserve `read_at IS NULL` for temporarily unreachable unread mentions and named shares while paging past them in batches of `limit` (`FOLLOW_LIMIT`), and continue marking permanently dead unread rows (`revoked`, `expired`, `deleted`, or missing target/comment/thread/link) as read on the first poll.
- Reduce peak memory in `hashReadyImportSnapshot`, `FinalizeFolderImportService.finalizePrepare`, and `ApplyFolderImportService.linksBeforeLocking` while keeping snapshot hashes, plan hashes, and link extraction byte-for-byte identical.

### Non-Goals
- Changing external search engine backends or introducing vector embeddings (remains Phase 8).
- Changing authorization rules or share-link validity semantics.
- Changing the digest format of `hashReadyImportSnapshot` or `hashImportPlan`.

## 3. Approaches Considered

### 3.1 Search query optimization
- **Approach A (Selected): Deferred snippet projection in SQL + additive B-Tree indexes + per-source tree cache in `AgentContextService`.**
  - Filter, rank (`title_hits`), sort, and apply `LIMIT ? OFFSET ?` in an inner derived table (`matched`) that selects only document/source/workspace metadata and `d.current_revision_id`. Join `knowledge_revisions` in the outer query for the at-most `LIMIT` rows to compute `anchor_at`, `markdown_length`, and `snippet`.
  - Preserves 100% compatibility with `utf8mb4_unicode_ci` case/width insensitivity, CJK substring matching, and escaped `%`/`_` literals.
- **Approach B: MariaDB `FULLTEXT` index replacement.**
  - Rejected because MariaDB InnoDB `FULLTEXT` tokenizes on word boundaries without an `ngram` parser by default, which breaks arbitrary CJK substring queries (e.g. `"請假"` inside `"請假流程"`) and punctuation literals (`"100%"`) pinned by existing Phase 4 tests.

### 3.2 Unread preservation on reversible unreachability
- **Approach A (Selected): Classify dead rows into permanently dead vs. temporarily unreachable, mark only permanently dead rows read, and page past temporarily unreachable rows with `offset`.**
  - A named share is **permanently dead** when the link is revoked (`link.revokedAt !== null`), expired (`link.expiresAt !== null && link.expiresAt.getTime() <= now.getTime()`), or its target row (`document`, `folder` tree node, or `source`) does not exist. It is **temporarily unreachable** when the target exists and the link is active, but the target (or its source/workspace/ancestor chain, or recipient membership) is currently archived or does not admit the viewer.
  - A mention is **permanently dead** when the comment, thread, or link row is missing, the comment was deleted (`comment.deletedAt !== null`), the thread was retracted (`isRetractedThread(comments)`), the link is revoked or expired, or the thread's document row does not exist. It is **temporarily unreachable** when the comment or thread has `visibility === "HIDDEN"`, or the link is active and the document exists but `linkValid` is currently false (e.g. document/folder/source archived, document moved out of the shared folder, or viewer not currently a recipient of a `NAMED` link).
  - `listUnreadForRecipient(userId, limit, offset?)` and `listUnreadByRecipient(userId, limit, offset?)` accept an optional `offset = 0`. When scanning unread rows, permanently dead rows are marked read in the DB; temporarily unreachable rows are left unread (`read_at IS NULL`) and skipped by advancing `offset` by the number of unconsumed unread rows in the batch until `limit` live rows are collected or the unread table is exhausted.
- **Approach B: Never mark any dead row read.**
  - Rejected because revoked/expired links and deleted comments can never become live again; marking permanently dead rows read on first poll avoids re-evaluating them on every future poll and preserves the existing contract for revoked links (`tests/integration/named-share-inbox.test.ts`).

### 3.3 Import memory reduction
- **Approach A (Selected): Incremental SHA-256 hashing + immediate `rawMarkdown` release + plan-scoped link extraction.**
  - In `hashReadyImportSnapshot`: sort entries by `sourcePath` first, computing `stableStringify(hashableEntry(entry))` during sorting only for tie-breaking when two entries share the same `sourcePath`. Then feed the exact canonical JSON tokens into `createHash("sha256")` one entry at a time so the full serialized array and concatenated JSON string are never materialized simultaneously.
  - In `FinalizeFolderImportService.finalizePrepare`: null out `entry.staged.rawMarkdown` immediately after `parseGenericMarkdownText` extracts `parsed.markdown`.
  - In `ApplyFolderImportService.linksBeforeLocking`: collect only the `uploadKey`s (and any inline legacy `markdown`) referenced by `snapshot.plan.documents.create` and `snapshot.plan.documents.revise`, skip `listBySnapshotId` entirely when no documents are created or revised, and populate `byHash` directly without an intermediate `bodies: string[]` array.

## 4. Detailed Design

### 4.1 Migration 036 (`src/infrastructure/database/mariadb/migrations/036-search-and-unread-indexes.ts`)
- Version: `36`, name: `"search-and-unread-indexes"`.
- Statements:
  1. `CREATE INDEX idx_entries_source_path ON source_entries (source_id, source_path(255))`
  2. `CREATE INDEX idx_task_bindings_workspace_owner ON task_export_bindings (workspace_id, owner_user_id)`
  3. `CREATE INDEX idx_recipient_user_unread ON document_share_link_recipients (user_id, read_at, added_at, share_link_id)`

### 4.2 Deferred Snippet Projection (`src/infrastructure/database/mariadb/repositories/knowledge-search.ts`)
- Inner derived query `matched` joins `knowledge_documents d`, `knowledge_revisions r`, `knowledge_tree_nodes n`, `knowledge_sources s`, `workspaces w`, applies all `WHERE` predicates, computes `(${titleHits}) AS title_hits` and `LOCATE(?, r.markdown COLLATE utf8mb4_unicode_ci) AS anchor_at` only in the outer query after `ORDER BY ${order} LIMIT ? OFFSET ?`.
- Outer query joins `knowledge_revisions body_r ON body_r.id = matched.current_revision_id` for the at-most `LIMIT` rows, computes `anchor_at`, `CHAR_LENGTH(body_r.markdown) AS markdown_length`, and `snippet`, preserving the exact order of `matched`.

### 4.3 Reversible Unread Preservation (`named-share-judgement.ts` & `document-review-service.ts`)
- `DocumentShareLinkRepository.listUnreadForRecipient(userId: string, limit: number, offset?: number): Promise<ReceivedShareLink[]>`
- `ReviewMentionRepository.listUnreadByRecipient(userId: string, limit: number, offset?: number): Promise<ReviewMention[]>`
- `judgeNamedShares(r, userId, limit, now, unreadOnly = false)`:
  - When `unreadOnly` is `true`, loops with `offset = 0` and collects `live` items up to `limit`:
    - Fetches a page of unread rows via `r.shareLinks.listUnreadForRecipient(userId, limit, offset)`.
    - For each row, determines `{ target, permanentDead }`:
      - If `!isActiveShareLink(link, now)` (revoked or expired) or the target row (`document`, `folder` node with `nodeType === "FOLDER"`, or `source`) does not exist in its repository, `permanentDead = true`.
      - Otherwise, if `openShareLinkTarget` returns `null` (e.g. target, source, or workspace is `ARCHIVED`, or viewer is not admitted), `permanentDead = false` (temporarily unreachable).
    - Marks only `permanentDead` rows read via `r.shareLinks.markRecipientRead(link.id, userId, now)`.
    - Appends live rows (`target !== null`) to `live`.
    - Advances `offset` by the number of non-permanently-dead rows in the batch (since permanently dead rows were marked read and drop out of `read_at IS NULL`). Stops when the batch had fewer than `limit` rows or `live.length >= limit`.
- `DocumentReviewService.unreadMentions(r, userId)`:
  - Loops with `offset = 0` and collects `live` mentions up to `FOLLOW_LIMIT`:
    - Fetches `unread = await r.reviewMentions.listUnreadByRecipient(userId, FOLLOW_LIMIT, offset)`.
    - Judges each mention with `{ live, permanentDead }`:
      - `permanentDead = true` if `!found` (comment missing), `!thread` (thread missing), `comment.deletedAt !== null`, `isRetractedThread(comments)`, `!link` (share link missing), `!isActiveShareLink(link, now)` (link revoked or expired), or the thread's document row does not exist (`!(await r.documents.findById(thread.documentId))`).
      - `permanentDead = false` (temporarily unreachable) if `thread.visibility === "HIDDEN"`, `comment.visibility === "HIDDEN"`, or `linkValid` returns `false` while the link is active and the document exists (e.g. document/folder/source archived, document moved out of shared folder, or user not currently a recipient).
    - Marks only `permanentDead` mentions read via `r.reviewMentions.markRead(userId, mention.commentId, this.clock())`.
    - Appends live mentions to `live`, advances `offset` by the number of non-permanently-dead rows in the batch, and stops when `unread.length < FOLLOW_LIMIT` or `live.length >= FOLLOW_LIMIT`.

### 4.4 Import Memory Reduction (`import-integrity.ts`, `finalize-folder-import.ts`, `apply-folder-import.ts`)
- `hashReadyImportSnapshot`:
  - Sorts a shallow copy of `entries` by `sourcePath` using `compareImportText`, lazily computing and caching `stableStringify(hashableEntry(entry))` only for entries that tie on `sourcePath`.
  - Streams the canonical top-level JSON structure into `createHash("sha256")` entry by entry, producing the identical SHA-256 hex digest as `sha256(stableStringify(...))`.
- `FinalizeFolderImportService.finalizePrepare`:
  - Sets `(entry.staged as { rawMarkdown: string | null }).rawMarkdown = null` immediately after `parseGenericMarkdownText` completes for that entry.
- `ApplyFolderImportService.linksBeforeLocking`:
  - Reads `snapshot.plan` and collects referenced `uploadKey`s from `snapshot.plan.documents.create` and `snapshot.plan.documents.revise` (plus any inline legacy `markdown`).
  - If there are no `create` or `revise` actions, returns `(markdown) => extractDocumentLinks(markdown)` without querying `importSnapshotEntries`.
  - Otherwise queries `listBySnapshotId(snapshotId)` and populates `byHash` only for entries whose `uploadKey` is in the needed set, releasing each entry as it iterates.
