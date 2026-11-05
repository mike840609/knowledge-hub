# Source Share Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A My Space owner shares one Source's whole live tree through one expiring, revocable link, with discussions, follows, saved shares and named recipients working per document as they do for folder links.

**Architecture:** `document_share_links` gains a third, mutually exclusive target (`source_id`), so every downstream table (threads, comment events, follows, saved shares, views) works unchanged. "May this document be read through this link" becomes: the link opens **and** the document is ACTIVE in that Source **and** its tree chain reaches the Source root through ACTIVE nodes. The page is `/s/:token?d=<documentId>`, drawn by the folder page generalized to a tree root.

**Tech Stack:** Next.js 15 (App Router), TypeScript, MariaDB, Vitest (unit + integration), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-05-source-share-link-design.md` — read it first; this plan argues from it.

## Global Constraints

- Every unusable link, document or thread — dead link, document outside the Source, another workspace, archived, malformed id — is `ShareLinkNotFoundError`; the page shows the one not-available state. No response distinguishes them.
- A URL document id is navigation only; reachability is re-derived on every request, never cached across requests.
- `readShared` stays the only caller-less content method and `readSharedTarget` the only narrow link judgement (`tests/unit/share-link-single-exception.test.ts` must pass unchanged).
- Expiry days `[1, 7, 30, 90]`, default 30; at most `10` active links per Source (reuse `MAX_ACTIVE_SHARE_LINKS_PER_DOCUMENT`); label ≤ 200 chars.
- One Source, never the whole My Space; every Source type (`HUB_MANAGED`, `SOURCE_MANAGED`, `FILE_UPLOAD`) can be shared; My Space only, never a Team Workspace.
- Migration is additive and forward-only; existing document and folder links keep working with no data change.
- A Source link follows the Source's identity: renaming keeps it; archiving closes it; restoring revives it unless revoked or expired.
- UI: design-language tokens only (`text-body`, `rounded-md`, `shadow-popover`, …; Tailwind default spellings compile to nothing); colours only via `globals.css` variables; no `dangerouslySetInnerHTML`, no `rehype-raw`; CSP unchanged.
- Run tests through `make` or the vitest commands in `CLAUDE.md`; bare `npm` is shadowed by an nvm function in non-interactive shells — use the absolute node/npx path if `make` is not enough, and never pipe a test run (pipes hide exit codes).

## Review Focus

1. **A Source deeper or larger than the chain check can prove** (over 1,000 nodes, or a node below the depth cap): the rail must never show a document `readShared` then refuses; the page must not 500 — pinned in Task 3 (`sharedForest` unit) and Task 9 (`?d=` hostile).
2. **A document at the Source root** (chain length one): reachable, the landing document when first, and readable with `?d=` — pinned in Task 3.
3. **A Source with no documents, or only folders**: the empty-source state, not not-available; Save and Open still work — pinned in Task 3 and Task 4.
4. **A document archived while the reader is on it, then a comment/reply/follow**: refused with `ShareLinkNotFoundError`, not a 500; the followed discussion goes dead and returns when the document is restored — pinned in Task 5.
5. **A Source renamed, archived or restored while links exist**: rename keeps the link; archive kills every URL under it; restore revives it; My shares and Saved shares show the current name only while the link opens — pinned in Task 3 and Task 7.

---

### Task 1: Schema, link target type, reachability rule

**Files:**
- Create: `src/infrastructure/database/mariadb/migrations/033-source-share-links.ts`
- Modify: `src/infrastructure/database/mariadb/migrations/index.ts` (register)
- Modify: `src/modules/knowledge/domain/document-share-link.ts`
- Modify: `src/modules/knowledge/application/internal/folder-link-reach.ts`
- Modify: `src/modules/knowledge/ports/document-share-link-repository.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/document-share-links.ts` (`mapTarget`, `insert`, new reads)
- Modify: `src/infrastructure/database/mariadb/repositories/tree.ts` (`listChain`, `listChainsByDocumentIds` select `source_id`)
- Modify: every compile error from the type change (narrow guards only; document and folder behaviour unchanged)
- Test: `tests/unit/source-share-reachability.test.ts`, `tests/integration/share-link-schema.test.ts`, `tests/integration/folder-share-read.test.ts` (add `sourceId` assertion)

**Interfaces:**
- Produces:
  - `type ShareLinkTarget = { kind: "DOCUMENT"; documentId: string } | { kind: "FOLDER"; folderNodeId: string } | { kind: "SOURCE"; sourceId: string }`
  - `type TreeChainNode = { id: string; sourceId: string; parentId: string | null; nodeType: "FOLDER" | "DOCUMENT"; status: "ACTIVE" | "ARCHIVED" }`
  - `isReachableThroughSource(chain: readonly TreeChainNode[], sourceId: string): boolean` — `chain[0]` is the document's node, then parents upward; every node ACTIVE and same Source; the last node's `parentId` is `null`; a repeated id fails.
  - `documentReachesSource(source: Pick<SourcePolicy, "id" | "status">, document: { sourceId: string; status: "ACTIVE" | "ARCHIVED" }, chain: readonly TreeChainNode[] | undefined): boolean`
  - `reachableChainForSource(repositories, source, document): Promise<TreeChainNode[] | null>` — the same reads as `reachableChain`, with the Source rule.
  - `type OpenSourceLink = { sourceId: string; name: string }`
  - Repository: `listBySource(sourceId: string): Promise<DocumentShareLink[]>` (newest first), `countActiveBySource(sourceId: string, now: Date): Promise<number>`, `listOpenSourceLinks(workspaceId: string, ownerId: string, now: Date): Promise<OpenSourceLink[]>`.
  - `assertShareLinkCreation` input `targetKind` accepts `"SOURCE"`; archived source message `"The shared source is archived."`; cap message `"A source can have at most 10 active share links."`.

- [ ] **Step 1: Write the failing unit tests** in `tests/unit/source-share-reachability.test.ts`:
  - a top-level document chain `[{ id: "d", sourceId: "s", parentId: null, nodeType: "DOCUMENT", status: "ACTIVE" }]` → `true`
  - a nested document with every ancestor ACTIVE and same Source → `true`
  - the chain never reaches a root (last `parentId` non-null, a truncated read) → `false`
  - the document node ARCHIVED, or an intermediate folder ARCHIVED → `false`
  - a node in another Source → `false`
  - empty chain → `false`
  - a repeated id cycle → `false` (the function must not trust the array to be acyclic)
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/source-share-reachability.test.ts` — Expected: FAIL (`isReachableThroughSource` not exported).
- [ ] **Step 3: Implement** the union, `TreeChainNode.sourceId`, and `isReachableThroughSource` in `document-share-link.ts`; add `documentReachesSource` and `reachableChainForSource` beside `documentReachesFolder`/`reachableChain` in `internal/folder-link-reach.ts`. Walk in order; every node must be ACTIVE, carry the link's `sourceId`, and not repeat; succeed only when a node has `parentId === null`. Update `assertShareLinkCreation`'s `targetKind` and its two messages.
- [ ] **Step 4: Migration 033** (`sourceShareLinksMigration`, name `"source-share-links"`), three statements:
  ```sql
  ALTER TABLE document_share_links DROP CONSTRAINT ck_share_links_one_target;

  ALTER TABLE document_share_links
    ADD COLUMN source_id UUID NULL AFTER folder_node_id,
    ADD CONSTRAINT fk_share_links_source FOREIGN KEY (source_id) REFERENCES knowledge_sources(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    ADD KEY idx_share_links_source (source_id, created_at);

  ALTER TABLE document_share_links
    ADD CONSTRAINT ck_share_links_one_target
    CHECK ((document_id IS NULL) + (folder_node_id IS NULL) + (source_id IS NULL) = 2);
  ```
  Extend `share-link-schema.test.ts`: the column list now includes `source_id` after `folder_node_id`; a row with only `source_id` succeeds; any two targets, or none, fail with a CHECK violation.
- [ ] **Step 5: Switch `mapTarget`/`insert`** to handle `source_id` (source first, then folder, then document). Add `listBySource`, `countActiveBySource`, `listOpenSourceLinks`; `listOpenSourceLinks` mirrors `listOpenFolderLinks` with `JOIN knowledge_sources s ON s.id = l.source_id`. Select `source_id` in `listChain` and `listChainsByDocumentIds` and map it into `TreeChainNode`.
- [ ] **Step 6: Fix every compile error from the union.** Where a path can only meet document/folder links until a later task (`readShared`, `readSharedTarget`, `DocumentReviewService.targetScope`/`linkValid`, `named-recipients.linkOpensOnDocument`, `named-share-judgement.openNamedTarget`), add an explicit `if (link.target.kind === "SOURCE") throw new ShareLinkNotFoundError()` (or `return false`/`null`) so a Source link is refused rather than misread. `lockLinkTargetScope`, `targetPayload` and `linkOpensForOwner` get the real Source arm now.
- [ ] **Step 7: Run** `make test-unit`, `make typecheck`, then `npx vitest run --config vitest.integration.config.ts tests/integration/share-link-schema.test.ts tests/integration/folder-share-read.test.ts` — Expected: all PASS.
- [ ] **Step 8: Commit** `feat(share): source share link target and reachability rule`.

### Task 2: Create, list and revoke Source links (owner service + API)

**Files:**
- Modify: `src/modules/knowledge/application/document-share-service.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/document-share-links.ts`
- Create: `src/app/api/sources/[sourceId]/share-links/route.ts`
- Test: `tests/integration/source-share-link-service.test.ts`

**Interfaces:**
- Consumes: `ShareLinkTarget` (Task 1), `lockOwnedSourceScope`, `assertShareLinkCreation`.
- Produces:
  - `DocumentShareService.createForSource(caller, input: { sourceId: string } & ShareCreateInput): Promise<ShareLinkView>`
  - `DocumentShareService.listForSource(caller, sourceId: string): Promise<ShareLinkView[]>`
  - `POST|GET /api/sources/:sourceId/share-links` — same bodies and responses as `/api/documents/:documentId/share-links`.
  - `revoke` accepts Source links; audit payloads carry `{ sourceId }`.

- [ ] **Step 1: Write failing integration tests** in `tests/integration/source-share-link-service.test.ts` (pattern of `folder-share-link-service.test.ts`, helper `mySpaceSource()`):
  - owner creates a link on an ACTIVE Source in their My Space → `ShareLinkView` with `path` `/s/<uuidv4>`, default expiry 30 days
  - works on a `HUB_MANAGED` Source and a `SOURCE_MANAGED` Source (folder-import fixture)
  - a Source in a TEAM workspace → `ShareLinkNotPersonalError`; someone else's My Space Source → `DocumentNotFoundError`; ARCHIVED Source → `DocumentArchivedError`
  - the 11th active link on one Source → `ShareLinkLimitReachedError`; an expired or revoked one does not count
  - `listForSource` returns only that Source's links with view totals; another owner's call → `DocumentNotFoundError`
  - `revoke` by owner sets `revokedAt`; by a stranger → `ShareLinkNotFoundError`; audit rows `DOCUMENT_SHARE_LINK_CREATED` / `_REVOKED` carry `payload.sourceId`
  - API: `POST /api/sources/<sourceId>/share-links` 201 with `{ link }`; non-object body → 400 `INVALID_REQUEST`
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.ts tests/integration/source-share-link-service.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** `createForSource` follows `create`: sync identity; `lockOwnedSourceScope` (Source then Workspace); `target = { kind: "SOURCE", sourceId }`; `countActiveBySource`; call `issueLink` with `targetStatus: source.status` and `sourceStatus: source.status`. `listForSource` mirrors `listForFolder` without a node-type check. `lockOwnedLink` already routes `lockLinkTargetScope`; add the Source arm there (Task 1) if not already done.
- [ ] **Step 4: Add the API route** with the same `workspaceHttp` wrapper and body parsing as the tree-node route; POST calls `createForSource`, GET calls `listForSource` and returns the review capabilities.
- [ ] **Step 5: Run** the new suite plus `share-link-service`, `folder-share-link-service` — Expected: PASS.
- [ ] **Step 6: Commit** `feat(share): create, list and revoke source share links`.

### Task 3: `readShared` for Source links

**Files:**
- Modify: `src/modules/knowledge/application/document-share-service.ts`
- Modify: `src/app/s/[token]/shared-folder-page.tsx` (`folderName` → `rootName`; folder rendering otherwise unchanged)
- Modify: `src/app/s/[token]/open/page.tsx` (`?d=` for every non-document target)
- Modify: `src/app/s/[token]/page.tsx`, `src/app/w/[workspaceId]/shares/[token]/page.tsx` (Source view is `notFound()` until Task 4)
- Test: `tests/unit/source-share-tree.test.ts`, `tests/integration/source-share-read.test.ts`, `tests/unit/shared-folder-page.test.tsx` (field rename), `tests/unit/share-link-single-exception.test.ts` (must pass unchanged)

**Interfaces:**
- Consumes: `isReachableThroughSource`, `TreeChainNode` (Task 1); `createForSource` (Task 2, in tests).
- Produces:
  - `type SharedTreeView = { kind: "FOLDER" | "SOURCE"; rootName: string; tree: SharedTreeNode[]; document: SharedFolderDocument | null; sharedByName: string; expiresAt: Date | null }`
  - `type SharedFolderView = SharedTreeView & { kind: "FOLDER" }` — alias so existing folder tests keep compiling.
  - `type SharedView = (({ kind: "DOCUMENT" } & SharedDocumentView) | SharedTreeView) & { audience: ShareAudience; linkId?: string }`
  - `type SharedTargetView = ({ kind: "DOCUMENT"; documentId: string } | { kind: "FOLDER" | "SOURCE"; documentId: string | null }) & { audience: ShareAudience }`
  - `sharedForest(nodes: readonly TreeViewNode[], maxDepth: number): SharedTreeNode[]` — exported for the unit test; depth-first, `parentId` of top-level nodes is `null`, archived subtrees omitted, nodes deeper than `maxDepth` omitted.
  - `readSharedSource(...)` internal; `readSharedTarget` Source branch.
- [ ] **Step 1: Write the failing unit test** in `tests/unit/source-share-tree.test.ts`:
  - top-level documents and folders come out depth-first in `position`, then `id` order; top-level `parentId` is `null`
  - an archived folder and its children are absent
  - a chain deeper than `maxDepth` is absent, including its descendants
  - a document with an archived document row or no current revision is absent
- [ ] **Step 2: Write the failing integration tests** in `tests/integration/source-share-read.test.ts` (pattern of `folder-share-read.test.ts`):
  - Source with `Welcome` (top level), `Engineering/{Dev setup, Code review}`, `FAQ` (top level): no `documentId` → `document` is `Welcome`; `tree` lists all ACTIVE nodes in order, no Markdown anywhere in `tree`
  - `?d=` of a top-level document → that document, empty `path`; `?d=` of a deep document → that document, `path` `[Engineering]`
  - `?d=` outside the Source / another Workspace / ARCHIVED / random UUID / malformed → `ShareLinkNotFoundError` (no fallback)
  - document link + any `documentId` (even its own) → `ShareLinkNotFoundError`; document link without one → unchanged `{ kind: "DOCUMENT", … }`
  - live: add a document after creating the link → appears; archive it → gone and unreadable by id
  - empty Source, and a Source with only folders → `document: null`, `tree` without documents, no error
  - rename the Source → the link still opens and `rootName` is the new name; archive the Source → `ShareLinkNotFoundError`; restore → opens again
  - `links`: `[[Code review]]` (in the Source) → present; `[[Outside note]]` (exists outside) → absent; `[[Nothing]]` → absent
  - each call with `recordView` default counts one view
- [ ] **Step 3: Run** both files — Expected: FAIL.
- [ ] **Step 4: Implement `sharedForest` and the Source branch of `readShared`.** Load the Source through `sourcePolicy.findById`; judge with `requireOpenLink`; read `tree.listBySource`; build the forest with the same depth cap `listSubtree` uses (top-level node = depth 0, cap `MAX_CHAIN_LENGTH - 2`; define one exported constant and comment why). Landing is the first `DOCUMENT` in the forest; `documentId` wins when reachable, else `ShareLinkNotFoundError`. Re-prove the document with `reachableChainForSource` (never trust the in-memory tree for authorization), read its current revision, and keep only wikilink resolutions whose target is in the forest's document set. Define `SharedTreeView` with `rootName` and update `SharedFolderPage` to read `rootName` (folder rendering otherwise unchanged). Drop the Task 1 Source guard in `readShared`.
- [ ] **Step 5: Implement the Source branch of `readSharedTarget`** and change `/s/:token/open` to append `?d=` when `target.kind !== "DOCUMENT"`. `readSharedTarget` must still read no Markdown, revisions, users, catalog or view count.
- [ ] **Step 6: Make the pages refuse a Source view for now.** In `/s/[token]/page.tsx` and `/w/[workspaceId]/shares/[token]/page.tsx`, `if (shared.kind === "SOURCE") notFound();` before the folder branch; Task 4 removes it. Update both `sharedTitle` helpers to return `shared.document?.title ?? shared.rootName` for a tree view.
- [ ] **Step 7: Run** the two new files, `tests/unit/share-link-single-exception.test.ts`, `tests/unit/share-read-pass-through.test.ts`, `make typecheck` — Expected: PASS.
- [ ] **Step 8: Commit** `feat(share): read a source's live tree through its share link`.

### Task 4: The shared Source page

**Files:**
- Modify: `src/app/s/[token]/page.tsx` (render `SharedTreeView`; `sharedTitle`)
- Modify: `src/app/s/[token]/shared-folder-page.tsx` (prop `shared: SharedTreeView`; `rootName`/`kind`)
- Modify: `src/components/knowledge/shared-folder-tree.tsx` (`rootName`, `rootKind`; Database icon and "Empty source")
- Modify: `src/app/w/[workspaceId]/shares/[token]/page.tsx` (same page; remove the Task 3 guard)
- Test: `tests/unit/shared-folder-page.test.tsx` (extend), `tests/unit/shared-folder-tree.test.tsx` (extend)

**Interfaces:**
- Consumes: `SharedTreeView`, `SharedTreeNode` (Task 3).
- Produces:
  - `SharedFolderPage({ token, shared, platformEntry, signInHref, pagePath }: { …; shared: SharedTreeView })` — the folder page generalized; the file name may stay.
  - `SharedFolderTree({ token, nodes, currentDocumentId, rootName, rootKind, pagePath })`.
  - `sharedTitle(shared: SharedView): string` returns `shared.document?.title ?? shared.rootName` for a tree view, `shared.title` for a document.
- [ ] **Step 1: Write the failing unit tests.**
  - a SOURCE view with a document renders the Source name in the breadcrumb and tree header, and a `Database` icon (not `Folder`)
  - a SOURCE view with no document renders "This source has no documents yet."
  - a FOLDER view keeps "This folder has no documents yet." and the `Folder` icon
  - a Source tree with multiple top-level roots renders them all, and the current document's path is expanded
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/shared-folder-page.test.tsx tests/unit/shared-folder-tree.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Generalize the page and tree** per the Interfaces block. Nothing else changes: the review panel, Save, Open, footer, phone disclosure and in-tree link base path are shared. The empty page uses the Source name as its heading and the Source copy.
- [ ] **Step 4: Update both page routes** to pass `shared` and to title a Source page by the document, else the Source name. Remove the Task 3 `notFound()` guards.
- [ ] **Step 5: Run** the unit tests, `make typecheck`, `make lint` — Expected: PASS. Start `make dev`, open a Source link, check the tree, a top-level document, a deep document, the phone width (390px) disclosure, and dark mode by eye.
- [ ] **Step 6: Commit** `feat(share): shared source page with tree and in-source links`.

### Task 5: Discussions and follows through a Source link

**Files:**
- Modify: `src/modules/knowledge/application/document-review-service.ts`
- Modify: `src/modules/knowledge/application/named-recipients.ts`
- Test: `tests/integration/source-share-review.test.ts`

**Interfaces:**
- Consumes: `isReachableThroughSource`, `listChain`, `repositories.shareLinks.findById` (Tasks 1–3).
- Produces:
  - `targetScope` Source branch: load the Source and the named document, require same Source, pre-check reachability before locking, re-check under the Source lock, judge the link with the Source's status.
  - `linkValid(r, link, documentId, viewerId)`: `FOLDER` and `SOURCE` both require the document reachable.
  - `folderDocument` becomes "non-document target" (`{ documentId }` for `FOLDER` and `SOURCE`).
  - `folderLinkDocuments` becomes `treeLinkDocuments`: one link judgement, then a batched per-document reachability check; for a Source, the batch is keyed by the target Source id and uses `documentReachesSource`.
  - `mentionLinksForOwner` also lists `shareLinks.listBySource(document.sourceId)`.
  - `named-recipients.linkOpensOnDocument` gains the Source branch.
- [ ] **Step 1: Write the failing integration tests** in `tests/integration/source-share-review.test.ts` (pattern of `folder-share-review.test.ts`):
  - signed-in reader creates a thread through a Source link on a deep document → thread has `originShareLinkId` = the Source link; owner gets a `share_comment_events` row naming that document; reader auto-follows
  - `queryForLink(null, token, documentId)` returns that document's visible threads only
  - `documentId` omitted on a Source link, or outside the Source → `ShareLinkNotFoundError`; any `documentId` on a document link → `ShareLinkNotFoundError`
  - a `threadId` belonging to another document in the same Source, passed with this `documentId` → `ShareLinkNotFoundError`
  - document archived after the reader loaded it: create, reply, follow, seen all → `ShareLinkNotFoundError`
  - follower Inbox and `listFollowedDiscussions`: entry available while the document is in the Source; `linkAvailable: false` naming nothing after archive; available again after restore
  - `unfollowOwn` works with the link dead
  - `mentionLinksForOwner` lists the Source link for a document in that Source
  - existing document-link and folder-link review suites pass unchanged
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.ts tests/integration/source-share-review.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the Source arms in `targetScope`, `linkValid`, `discussionHrefs`, `treeLinkDocuments`, `mentionLinksForOwner` and `linkOpensOnDocument`. Drop the Task 1 Source guards in this service. The lock order stays link → Source → Workspace; the pre-lock reachability check keeps a document outside the Source from being locked.
- [ ] **Step 4: Run** the new suite plus `document-review-service`, `document-review-sync`, `share-comment-notify`, `review-reply-follow`, `folder-share-review` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(share): discussions and follows through source links`.

### Task 6: Named Source links and Inbox

**Files:**
- Modify: `src/modules/knowledge/application/internal/named-share-judgement.ts`
- Modify: `src/modules/knowledge/domain/share-comment-event.ts` (`targetKind` adds `SOURCE`)
- Modify: `src/components/knowledge/mention-autocomplete.tsx` (`(whole source)` label)
- Modify: `src/modules/knowledge/application/document-review-service.ts` (proposal `targetKind` already comes from the link)
- Test: `tests/integration/source-share-named.test.ts`, `tests/unit/named-share-judgement.test.ts` (extend)

**Interfaces:**
- Consumes: Source links (Task 2), Source reads (Task 3), review (Task 5).
- Produces:
  - `type NamedShareTarget = { documentId: string } | { folderName: string } | { sourceName: string }`
  - `openNamedTarget` Source branch: a live NAMED Source link returns `{ sourceName }`
  - `namedShareTitle` returns `sourceName` for that target
  - `targetKind?: "DOCUMENT" | "FOLDER" | "SOURCE"` on `ShareCommentNotificationView`
- [ ] **Step 1: Write the failing tests.**
  - a NAMED Source link appears in `listNamedForRecipient` / "Shared with you" with the Source name and the Hub reader href `/w/:ws/shares/:token`
  - the recipient's Inbox `SHARED_WITH_YOU` entry names the Source; the owner's proposal/mention entry carries `targetKind: "SOURCE"`
  - a mention of a non-recipient on a NAMED Source link creates a PENDING proposal; approving it opens the Source reader
  - a revoked/expired/archived Source leaves no named entry and names nothing
  - unit: `namedShareTitle` for `{ sourceName }`; `openNamedTarget` for a dead Source returns null
- [ ] **Step 2: Run** the tests — Expected: FAIL.
- [ ] **Step 3: Implement** the Source branch in `openNamedTarget`, `namedShareTitle`, the `targetKind` type and the mention label. `listNamedForRecipient` already goes through them; no new list query.
- [ ] **Step 4: Run** the new suite plus `named-share-*`, `share-comment-notify` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(share): named source links and Inbox entries`.

### Task 7: Saved shares, My shares list and Source rows

**Files:**
- Modify: `src/infrastructure/database/mariadb/repositories/saved-shares.ts` (`findSnapshotByToken`, `list`)
- Modify: `src/infrastructure/database/mariadb/repositories/document-share-links.ts` (`listForWorkspace`)
- Modify: `src/modules/knowledge/domain/share-management.ts`, `src/modules/knowledge/domain/saved-share.ts`
- Modify: `src/components/knowledge/share-management-view.tsx`, `src/components/knowledge/saved-shares-view.tsx`
- Test: `tests/integration/source-share-lists.test.ts`

**Interfaces:**
- Consumes: Source links (Task 2), Source reads (Task 3), Source-origin comment events (Task 5).
- Produces:
  - `ManagedShareLink` gains `kind: "SOURCE"` with `documentId: null`, `folderNodeId: null`, and the base `sourceId` as the target Source.
  - `SavedShareView.kind` gains `"SOURCE"`.
  - `listForWorkspace` selects `l.source_id AS target_source_id`; `title` is `COALESCE(r.title, f.name, s.name)`; status is `COALESCE(d.status, f.status, s.status)`; source is `COALESCE(d.source_id, f.source_id, l.source_id)`.
- [ ] **Step 1: Write failing integration tests** in `tests/integration/source-share-lists.test.ts`:
  - save a Source link → saved title = Source name; rename the Source later → the list shows the new name while the link opens, the saved name once it dies; search by either name finds it; status `unavailable`/`expired` after revoke/expiry
  - My shares lists the Source link with `kind: "SOURCE"`, Source name, `active`; revoked/expired/`unavailable` (Source archived) states; search by Source name and by label
  - two comments through a Source link on two different documents → one unread count row for that link; a document's own link count is unaffected
  - a Source row's metadata does not repeat the title as `sourceName` (assert the view fields, not the markup)
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.ts tests/integration/source-share-lists.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement the SQL Source branch** in both repositories, with the same shape in each query. Keep every predicate inside the single statement so the saved-share snapshot stays one consistent read. Map `target_source_id` to `kind: "SOURCE"` before the folder/document checks.
- [ ] **Step 4: Update the views.** A Source row uses a lucide `Database` icon with a screen-reader "Source" prefix, links its title to `/w/:workspaceId/knowledge/:sourceId` in My shares, and uses the same icon in Saved shares. Its "N new" badge reads the `unreadByLink` row (comments made through that link), not a per-document row. Revoke copy and the "restoring … may reactivate" notice say "source". The view-count tooltip stays "Documents opened through this link". The Source row's metadata line omits the duplicate `sourceName`. The Saved shares "Shared with you" copy becomes "Documents, folders and sources shared with you by name."
- [ ] **Step 5: Run** the new suite plus `saved-share-service`, `saved-share-api`, `share-management`, `folder-share-lists` — Expected: PASS.
- [ ] **Step 6: Commit** `feat(share): source links in saved shares and My shares`.

### Task 8: Owner entry point and reminders

**Files:**
- Modify: `src/components/actions/action-menu.tsx` (`ShareTarget` union, `targetKey`, `linksUrl`, `parseTarget`)
- Modify: `src/components/knowledge/share-link-dialog.tsx` (Source mode, copy, `viaSources`)
- Create: `src/components/sources/source-share-action.tsx`
- Modify: `src/components/sources/source-list-row.tsx`, `src/components/sources/source-detail.tsx`
- Modify: `src/app/w/[workspaceId]/sources/layout.tsx` (mount `ShareLinkDialogHost`)
- Modify: `src/components/knowledge/source-sidebar.tsx` (Source share action + shared marker)
- Modify: `src/components/knowledge/shared-folders.ts` (`useSharedTargets` returns both id sets)
- Modify: `src/modules/knowledge/application/document-share-service.ts` (`containersSharingDocument`, `listOpenShareTargets`)
- Modify: `src/app/api/documents/[documentId]/share-links/route.ts` (add `viaSources`)
- Modify: `src/app/api/workspaces/[workspaceId]/shared-folders/route.ts` (add `sources`)
- Test: `tests/integration/source-share-reminders.test.ts`, `tests/unit/share-reminders-ui.test.tsx` (update the hook), `tests/unit/source-sidebar-lazy.test.tsx` (update the mock)

**Interfaces:**
- Consumes: `createForSource`, `listForSource` (Task 2), `listChain` (Task 3), `listOpenSourceLinks` (Task 1).
- Produces:
  - `type ShareTarget = { documentId: string } | { folderNodeId: string; name?: string } | { sourceId: string; name?: string }`
  - `requestShare(target: ShareTarget): void` — the event detail carries the same shape.
  - `SourceShareAction({ workspaceId, sourceId, sourceName, status })` — renders nothing unless the caller owns the My Space and the Source is ACTIVE; dispatches `requestShare({ sourceId, name: sourceName })`.
  - `DocumentShareService.listOpenShareTargets(caller, workspaceId): Promise<{ folders: OpenFolderLink[]; sources: OpenSourceLink[] }>` — new; keep `listOpenFolderLinks` as its folder-only wrapper.
  - `DocumentShareService.containersSharingDocument(caller, documentId): Promise<{ folders: OpenFolderLink[]; sources: OpenSourceLink[] }>` — new; keep `foldersSharingDocument` as a wrapper returning `.folders` so existing callers and tests keep working.
  - `GET /api/workspaces/:workspaceId/shared-folders` → `{ folders, sources }`; `GET /api/documents/:id/share-links` adds `viaSources`.
  - `useSharedTargets(workspaceId, enabled): { folderIds: ReadonlySet<string>; sourceIds: ReadonlySet<string> }`
- [ ] **Step 1: Write the failing integration tests** in `tests/integration/source-share-reminders.test.ts`:
  - `listOpenShareTargets` lists a Source with an open link; drops it after revoke and after expiry; another user's call → not found
  - `containersSharingDocument` names the Source for a top-level and a deep document in it; names nothing for a document outside; names nothing after the Source is archived; returns after restore
  - the workspace route returns `{ folders, sources }`; the document route returns `viaSources` only for a document in an open Source link
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.ts tests/integration/source-share-reminders.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the service and routes. `listOpenShareTargets` calls the two repository reads; `containersSharingDocument` reuses the existing ancestor walk and adds the document's Source when it has an open link. Keep `listOpenFolderLinks` and `foldersSharingDocument` as thin wrappers so existing callers and tests keep working. Keep the document route's "list first, then via" order so a stranger never gets the reminder.
- [ ] **Step 4: Implement the Source entry points.**
  - `ShareTarget` Source arm; `linksUrl` → `/api/sources/:sourceId/share-links`; dialog title "Share source <name>"; LINK/NAMED copy from spec §9; revoke toast says "source".
  - `SourceShareAction` in the Sources list row and `SourceDetail` header; mount `ShareLinkDialogHost` in the Sources layout.
  - Knowledge sidebar: a Source header action under the same owner/ACTIVE condition, dispatching `requestShare({ sourceId, name })`.
- [ ] **Step 5: Implement the reminders.**
  - `useSharedTargets` replaces `useSharedFolderIds`; `knowledge-tree` keeps its folder marker prop. The sidebar marks a Source with a Share2 icon and `aria-label="Shared"` when `sourceIds` has it.
  - Sources list and `SourceDetail` show the same marker through a small client component (the parent may be a server component).
  - Document dialog: `viaSources` renders "Also visible through the shared source <name>", retargeting the dialog to that Source.
- [ ] **Step 6: Run** the integration test, `tests/integration/folder-share-reminders.test.ts`, the two updated unit tests, `make lint`, `make typecheck` — Expected: PASS. Open the Sources page and the sidebar, share a Source, confirm the marker and the dialog.
- [ ] **Step 7: Commit** `feat(share): share a source from Sources and the sidebar; remind the owner`.

### Task 9: End-to-end and documentation

**Files:**
- Create: `tests/e2e/zz-source-share.spec.ts`
- Modify: `CLAUDE.md` (share-link invariant)
- Modify: `README.md` (canonical documents table) and `README.zh-TW.md` if it carries the same table
- Test: the e2e spec

- [ ] **Step 1: Write the e2e spec** (pattern of `share-link.spec.ts`, `saved-shares.spec.ts`, `zz-folder-share.spec.ts`):
  - owner shares a Source from the Sources page and from the sidebar; copies the link; both surfaces show the shared marker
  - anonymous visitor opens it: first document shown; expands a subfolder, opens a deep document (URL has `?d=`); clicks an in-Source `[[link]]` and lands on it; an out-of-Source `[[link]]` is plain text with no title attribute
  - hostile: `?d=` of a document outside the Source, of another workspace's document, `?d=junk` → same not-available page as an unknown token
  - signed-in reader comments on a deep document, saves the Source; Saved shares shows it with the database icon
  - owner sees the comment in Inbox and the "N new" on the Source row in My shares; the document's Share dialog says "Also visible through the shared source …"
  - owner renames the Source → the link still opens; archives it → `/s/:token` and `/s/:token?d=…` both not-available; restores it → opens again
  - owner revokes → every URL under the token is not-available
  - 390px viewport: tree hidden behind the bar button, opens and navigates
- [ ] **Step 2: Run** `make test-e2e` — Expected: PASS (if a heading-link reading test flakes, rerun once before investigating; it is a known flake).
- [ ] **Step 3: Update `CLAUDE.md`'s share-link invariant**: a share link targets a document, a My Space folder **or a My Space Source**; a Source link grants read of the documents currently in it, re-derived per request; `?d=` is navigation only; a Source page resolves links only to documents in that Source.
- [ ] **Step 4: Update README's canonical documents table** with `docs/superpowers/specs/2026-11-05-source-share-link-design.md`; update the zh-TW table if present.
- [ ] **Step 5: Run** `make verify` — Expected: PASS.
- [ ] **Step 6: Commit** `test(share): source share end to end; docs`.
