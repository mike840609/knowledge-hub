# Folder Share Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A My Space owner shares a folder through one expiring, revocable link that opens the folder's live subtree, with discussions, follows and saved shares working per document as they do for document links.

**Architecture:** `document_share_links` gains a second, mutually exclusive target (`folder_node_id`), so every downstream table (threads, comment events, follows, saved shares, views) works unchanged. "May this document be read through this link" becomes one judgement — link opens **and** the document's tree chain reaches the link's folder through ACTIVE nodes — made per request in the two existing caller-less entries (`readShared`, `DocumentReviewService.linkScope`). The page is `/s/:token?d=<documentId>`.

**Tech Stack:** Next.js 15 (App Router), TypeScript, MariaDB, Vitest (unit + integration), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-29-folder-share-link-design.md` — read it first; this plan argues from it.

## Global Constraints

- Every unusable link, document or thread — dead link, document outside the folder, other workspace, archived, malformed id — is `ShareLinkNotFoundError`; the page shows the one not-available state. No response distinguishes them.
- A URL document id is navigation only; reachability is re-derived on every request, never cached across requests.
- `readShared` stays the only caller-less content method and `queryForLink` the only other caller-less entry (`tests/unit/share-link-single-exception.test.ts` must pass unchanged).
- Expiry days `[1, 7, 30, 90]`, default 30; at most `10` active links per folder (reuse `MAX_ACTIVE_SHARE_LINKS_PER_DOCUMENT`); label ≤ 200 chars.
- Migration is additive and forward-only; existing document links keep working with no data change.
- UI: design-language tokens only (`text-body`, `rounded-md`, `shadow-popover`, …; Tailwind default spellings compile to nothing); colours only via `globals.css` variables; no `dangerouslySetInnerHTML`, no `rehype-raw`; CSP unchanged.
- Run tests through `make` or the vitest commands in CLAUDE.md; bare `npm` is shadowed by an nvm function in non-interactive shells — use the absolute node/npx path if `make` is not enough, and never pipe a test run (pipes hide exit codes).

## Review Focus

1. **Malformed or repeated `?d=`** (`?d=abc`, `?d=A&d=B`, uppercase UUID): not-available page, never a 500 and never a fallback to the landing document — pinned in Task 3 (service) and Task 8 (page).
2. **Document moved out while the reader's page is open, then the reader comments or replies**: the write is refused with `ShareLinkNotFoundError` — pinned in Task 5.
3. **Siblings with equal `position`** (legacy rows): tree and landing order are stable (`position`, then `id`) — pinned in Task 3.
4. **A corrupt parent chain (cycle)**: reachability walk terminates and answers "not reachable" — pinned in Task 1.
5. **A saved folder share whose folder later becomes empty**: opening it shows the empty-folder state, not not-available — pinned in Task 3.

---

### Task 1: Schema, link target type, reachability rule

**Files:**
- Create: `src/infrastructure/database/mariadb/migrations/028-folder-share-links.ts`
- Modify: `src/infrastructure/database/mariadb/migrations/index.ts` (register)
- Modify: `src/modules/knowledge/domain/document-share-link.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/document-share-links.ts` (`mapLink`, `insert`)
- Modify: every compile error from the type change (only narrow; behaviour for document links unchanged)
- Test: `tests/unit/folder-share-reachability.test.ts`, `tests/integration/share-link-schema.test.ts`

**Interfaces:**
- Produces:
  - `type ShareLinkTarget = { kind: "DOCUMENT"; documentId: string } | { kind: "FOLDER"; folderNodeId: string }`
  - `DocumentShareLink` loses `documentId`, gains `target: ShareLinkTarget`.
  - `type TreeChainNode = { id: string; parentId: string | null; nodeType: "FOLDER" | "DOCUMENT"; status: "ACTIVE" | "ARCHIVED" }`
  - `isReachableThroughFolder(chain: readonly TreeChainNode[], folderNodeId: string): boolean` — `chain[0]` is the document's own node, then its parents upward.
  - `evaluateShareLinkValidity` input field `documentStatus` is documented as "the target's status (document, or folder node)"; no rename.

- [ ] **Step 1: Write the failing unit tests** in `tests/unit/folder-share-reachability.test.ts`:
  - direct child of the folder → `true`; grandchild through an ACTIVE subfolder → `true`
  - chain never reaches `folderNodeId` (moved out) → `false`
  - document node ARCHIVED → `false`; intermediate folder ARCHIVED → `false`; the folder itself ARCHIVED → `false`
  - `chain[0].nodeType === "FOLDER"` (asked about a folder, not a document) → `false`
  - empty chain → `false`
  - a chain whose `parentId`s form a cycle and never reach the folder → `false` (the function must not trust the array to be acyclic: stop at a repeated id)
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/folder-share-reachability.test.ts` — Expected: FAIL (`isReachableThroughFolder` not exported).
- [ ] **Step 3: Implement** `ShareLinkTarget`, `TreeChainNode`, `isReachableThroughFolder` in `document-share-link.ts`. Walk `chain` in order; every visited node must be ACTIVE; succeed when a node with `id === folderNodeId` and `nodeType === "FOLDER"` is reached at index ≥ 1; fail on a repeated id or end of chain.
- [ ] **Step 4: Migration 028** (`folderShareLinksMigration`, name `"folder-share-links"`):
  ```sql
  ALTER TABLE document_share_links MODIFY document_id UUID NULL,
    ADD COLUMN folder_node_id UUID NULL AFTER document_id,
    ADD CONSTRAINT fk_share_links_folder FOREIGN KEY (folder_node_id) REFERENCES knowledge_tree_nodes(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    ADD CONSTRAINT ck_share_links_one_target CHECK ((document_id IS NULL) <> (folder_node_id IS NULL)),
    ADD KEY idx_share_links_folder (folder_node_id, created_at)
  ```
  Add a schema test case to `share-link-schema.test.ts`: inserting a row with both targets, and with neither, each fails with a CHECK violation; a row with only `folder_node_id` succeeds.
- [ ] **Step 5: Switch `DocumentShareLink` to `target`**, update `mapLink`/`insert`, then fix every compile error. Where a code path can only meet document links until a later task (e.g. `readShared`, `linkScope`, `/open`, `revoke`), narrow with an explicit `if (link.target.kind !== "DOCUMENT") throw new ShareLinkNotFoundError()` so folder links are refused rather than misread; later tasks replace these guards.
- [ ] **Step 6: Run** `make test-unit` and `make typecheck` (or `make verify`), then `make test-integration` for the share suites — Expected: all PASS.
- [ ] **Step 7: Commit** `feat(share): folder share link target and reachability rule`.

### Task 2: Create, list and revoke folder links (owner service + API)

**Files:**
- Modify: `src/modules/knowledge/application/document-share-service.ts`
- Modify: `src/modules/knowledge/ports/document-share-link-repository.ts`, `src/infrastructure/database/mariadb/repositories/document-share-links.ts`
- Modify: `src/modules/knowledge/domain/document-share-link.ts` (`assertShareLinkCreation` input)
- Create: `src/app/api/tree-nodes/[nodeId]/share-links/route.ts`
- Test: `tests/integration/folder-share-link-service.test.ts`, `tests/integration/share-link-api.test.ts` (add cases)

**Interfaces:**
- Consumes: `ShareLinkTarget` (Task 1).
- Produces:
  - Repository: `listByFolder(folderNodeId: string): Promise<DocumentShareLink[]>` (newest first), `countActiveByFolder(folderNodeId: string, now: Date): Promise<number>`, `findById(id: string): Promise<DocumentShareLink | null>`.
  - `DocumentShareService.createForFolder(caller, input: { folderNodeId: string; label?: unknown; expiresInDays?: unknown }): Promise<ShareLinkView>`
  - `DocumentShareService.listForFolder(caller, folderNodeId: string): Promise<ShareLinkView[]>`
  - `DocumentShareService.revoke` accepts folder links.
  - `POST|GET /api/tree-nodes/:nodeId/share-links` — same bodies and responses as `/api/documents/:documentId/share-links`.

- [ ] **Step 1: Write failing integration tests** (`folder-share-link-service.test.ts`, pattern of `share-link-service.test.ts`):
  - owner creates a link on an ACTIVE folder in their My Space → `ShareLinkView` with `path` `/s/<uuidv4>`, expiry default 30 days
  - a `DOCUMENT` node id → `ValidationError`; a folder in a TEAM workspace → `ShareLinkNotPersonalError`; someone else's My Space folder → `DocumentNotFoundError`; ARCHIVED folder → `DocumentArchivedError`; ARCHIVED source → `SourceArchivedError`
  - the 11th active link on one folder → `ShareLinkLimitReachedError`; an expired or revoked one does not count
  - works on a `SOURCE_MANAGED` folder (folder-import fixture)
  - `listForFolder` returns only that folder's links with view totals
  - `revoke` by owner sets `revokedAt`; by a stranger → `ShareLinkNotFoundError`; audit rows `DOCUMENT_SHARE_LINK_CREATED` / `_REVOKED` carry `payload.folderNodeId`
  - API: `POST /api/tree-nodes/<nodeId>/share-links` 201 with `{ link }`; non-object body → 400 `INVALID_REQUEST`
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.ts tests/integration/folder-share-link-service.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** `createForFolder` follows `create`: sync identity; route the node (`tree.findById`), lock its Source (`sourcePolicy.lockById`), then `workspaceAccess`/workspace as `lockOwnedScope` does, lock the node (`tree.lockById`); require `nodeType === "FOLDER"`; call `assertShareLinkCreation` with `documentStatus: node.status`. Extract the shared part of `lockOwnedScope` rather than copying it. `revoke` resolves the owned scope from whichever target the link has.
- [ ] **Step 4: Run** the new and existing share integration suites — Expected: PASS.
- [ ] **Step 5: Commit** `feat(share): create, list and revoke folder share links`.

### Task 3: `readShared` for folder links

**Files:**
- Modify: `src/modules/knowledge/application/document-share-service.ts`
- Modify: `src/modules/knowledge/ports/tree-repository.ts`, its MariaDB implementation (`listChain`)
- Modify: `src/server/share-read.ts`
- Modify: `CLAUDE.md` (share-link invariant, per spec §Documentation)
- Test: `tests/integration/folder-share-read.test.ts`, `tests/unit/share-link-single-exception.test.ts` (must pass unchanged)

**Interfaces:**
- Consumes: `isReachableThroughFolder`, `TreeChainNode` (Task 1); `createForFolder` (Task 2, in tests).
- Produces:
  - `TreeRepository.listChain(nodeId: string): Promise<TreeChainNode[]>` — the node then its ancestors upward (recursive CTE on `parent_id`, depth-capped at 256; raised to 1000 after PR review — see `MAX_CHAIN_LENGTH` in `tree.ts`).
  - `readShared(token: string, options?: { documentId?: string; recordView?: boolean }): Promise<SharedView>`
  - `type SharedView = ({ kind: "DOCUMENT" } & SharedDocumentView) | SharedFolderView`
  - `type SharedFolderView = { kind: "FOLDER"; folderName: string; tree: SharedTreeNode[]; document: SharedFolderDocument | null; sharedByName: string; expiresAt: Date }`
  - `type SharedTreeNode = { id: string; parentId: string | null; kind: "FOLDER" | "DOCUMENT"; name: string; documentId: string | null; pageIcon: string | null }` — ordered depth-first by `position`, then `id`; `parentId` of the shared folder's direct children is `null`.
  - `type SharedFolderDocument = SharedDocumentView & { documentId: string; path: { id: string; name: string }[]; links: SharedResolvedLink[] }` — `path` is the folders from the shared folder down to the document's parent.
  - `type SharedResolvedLink = { lookupKey: string; documentId: string; title: string }` — only links whose target is reachable through this link.
  - `share-read.ts`: `getShared(token: string, documentId?: string): Promise<SharedView | null>` (cached per request) replaces `getSharedDocument`; `isSharedAvailable(token, documentId?)` replaces `isSharedDocumentAvailable`.

- [ ] **Step 1: Write failing integration tests** (`folder-share-read.test.ts`):
  - folder with `Welcome`, `Engineering/{Dev setup, Code review}`, `FAQ`: no `documentId` → `document` is the first depth-first document; `tree` lists all ACTIVE nodes in order, no Markdown anywhere in `tree`
  - two siblings with equal `position` → ordered by `id`, same order on every call
  - `documentId` of a reachable deep document → that document, with `path` `[Engineering]`
  - `documentId` outside the folder / in another workspace / ARCHIVED / random UUID / not a UUID → `ShareLinkNotFoundError` (no fallback)
  - document link + any `documentId` (even its own) → `ShareLinkNotFoundError`; document link without one → unchanged `{ kind: "DOCUMENT", … }`
  - live: add a document after creating the link → appears; move one out → gone and unreadable by id
  - empty folder (all documents moved out) → `document: null`, `tree: []`, no error
  - revoked / expired / folder ARCHIVED / owner lost the workspace → `ShareLinkNotFoundError`
  - `links`: `[[Code review]]` (in folder) → present; `[[Outside note]]` (exists outside) → absent; `[[Nothing]]` → absent
  - each call with `recordView` default counts one view
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.ts tests/integration/folder-share-read.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement `listChain`** with `WITH RECURSIVE` from `nodeId` up through `parent_id`, returning `id, parent_id, node_type, status`, ordered from the node upward, `LIMIT 256` (raised to 1000 after PR review; the folder subtree is bounded to match).
- [ ] **Step 4: Implement the folder branch of `readShared`.** Folder validity uses `evaluateShareLinkValidity` with the folder node's status and its Source/Workspace. Tree: `tree.listBySource(folder.sourceId)` filtered to ACTIVE descendants of the folder (build children map, DFS from the folder). For the requested or landing document, confirm with `listChain(documentNode.id)` + `isReachableThroughFolder` (do not trust the in-memory tree for the authorization decision). Links: `links.loadCatalog(workspaceId)` + `buildLinkResolver` + `extractDocumentLinks(revision.markdown)` as `KnowledgeLinkServiceImpl.getDocumentLinks` does, keeping only `RESOLVED` targets whose id is a document in the reachable tree. Drop the Task 1 guard.
- [ ] **Step 5: Update `share-read.ts`** and its callers (`/s/[token]/page.tsx` keeps rendering document links exactly as before; folder rendering is Task 4 — until then a folder view may render `notFound()`).
- [ ] **Step 6: Amend `CLAUDE.md`'s share-link invariant**: a share link targets a document **or a My Space folder**; a folder link grants read of the documents currently under it, re-derived per request; the URL's document id (`?d=`) is navigation only; a folder page resolves links only to documents under that folder.
- [ ] **Step 7: Run** the integration suite above, `tests/unit/share-link-single-exception.test.ts`, `tests/unit/share-read-pass-through.test.ts` — Expected: PASS.
- [ ] **Step 8: Commit** `feat(share): read a folder's live subtree through its share link`.

### Task 4: The shared folder page

**Files:**
- Modify: `src/app/s/[token]/page.tsx` (branch on `kind`; read `searchParams.d`)
- Create: `src/components/knowledge/shared-folder-tree.tsx` (client: rail + phone disclosure)
- Modify: `src/components/knowledge/markdown-renderer.tsx`, `src/components/knowledge/markdown-base.tsx` (`unresolvedAsText`)
- Modify: `src/app/s/[token]/open/page.tsx`, `src/server/share-platform-destination.ts` callers
- Modify: `src/lib/auth-paths.ts` (`SHARED_RETURN`), `src/app/page.tsx` (returnTo regex)
- Modify: `src/app/s/[token]/not-found.tsx` only if copy must cover folders (it must not say which)
- Test: `tests/unit/auth-paths.test.ts` (add or extend), `tests/unit/markdown-renderer-shared-folder-links.test.tsx`

**Interfaces:**
- Consumes: `getShared`, `isSharedAvailable`, `SharedFolderView` (Task 3).
- Produces:
  - `MarkdownRenderer({ markdown, links, afterTitle, unresolvedAsText }: { …; unresolvedAsText?: boolean })` — with `unresolvedAsText`, a link missing from `links` or `UNRESOLVED` renders as `<span>{children}</span>`, exactly as with no `links` at all.
  - `SharedFolderTree({ token, nodes, currentDocumentId, folderName }: { token: string; nodes: SharedTreeNode[]; currentDocumentId: string | null; folderName: string })`
  - URLs: `/s/:token?d=<documentId>`; "Open" → `/s/:token/open?d=<documentId>`.

- [ ] **Step 1: Write failing unit tests.**
  - `auth-paths`: `SHARED_RETURN` accepts `/s/<t>`, `/s/<t>/open`, `/s/<t>?d=<uuid>`, `/s/<t>/open?d=<uuid>`; rejects `/s/<t>?d=x`, `/s/<t>?d=<uuid>&e=1`, `/s/<t>/d/<uuid>`, `/s/<t>?d=<uuid>#x`. `SHARED_READ` is unchanged (path only). Same accept/reject table for the `src/app/page.tsx` check (extract the regex to `auth-paths.ts` and import it there so there is one copy).
  - renderer: with `links={{ [key("WIKI","In")]: { status: "RESOLVED", basePath: "/s/t?d=1", title: "In", ambiguousWith: 0 } }}` and `unresolvedAsText`, `[[In]]` is an `<a href="/s/t?d=1">`, and `[[Out]]` and `[Out](../out.md)` render identical markup to each other and to the no-`links` case (no dashed class, no title attribute, no "No document titled" text).
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/auth-paths.test.ts tests/unit/markdown-renderer-shared-folder-links.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** the regex change and `unresolvedAsText` in `MarkdownAnchor`. Resolved targets on folder pages carry no `documentId` (so `DocumentLink` takes the plain `Link` branch: no hover preview) and `ambiguousWith: 0`.
- [ ] **Step 4: Implement the page.** `searchParams.d`: a single string that is a UUID, else treat the request as not-available (`notFound()`); an array → `notFound()`. Folder view layout per spec §4 and the brainstorming mockup: pinned bar (brand, breadcrumb `folderName / …path`, Comments, Save, Open), `SharedFolderTree` as a left rail (≥ `sm`) or a disclosure button in the bar (< `sm`), the existing reading column (title, byline, outline, article). Folders on the current document's path start expanded; tree items are `<Link href="/s/:token?d=…">` with `aria-current="page"` on the current one; folders are `<button aria-expanded>`. Empty folder: the reading column says `This folder has no documents yet.`. `generateMetadata`: document title, else folder name; no Open Graph; `robots: noindex, nofollow`. Pass `links` built from `SharedResolvedLink[]` and `unresolvedAsText`.
- [ ] **Step 5: `/open?d=`**: validate `d` as a UUID; if it is reachable (`isSharedAvailable(token, d)`), pass it to `sharePlatformDestination`, else the landing document. On a document link any `d` is `notFound()`; without `d` it behaves exactly as today.
- [ ] **Step 6: Run** the unit tests, `make typecheck`, `make lint` — Expected: PASS. Start `make dev`, open a folder link, check the tree, a deep document, the phone width (390px) disclosure, and dark mode by eye.
- [ ] **Step 7: Commit** `feat(share): shared folder page with tree and in-folder links`.

### Task 5: Discussions and follows through a folder link

**Files:**
- Modify: `src/modules/knowledge/application/document-review-service.ts`
- Modify: `src/modules/knowledge/domain/document-review.ts` (`CreateReviewThreadInput`, `ReplyReviewInput` gain `documentId?: string`)
- Modify: every `src/app/api/share-review/**/route.ts` (forward optional `documentId`)
- Modify: `src/components/knowledge/shared-review-panel.tsx` (prop `documentId?: string`, sent on every request; local-storage keys include it)
- Modify: `src/app/s/[token]/page.tsx` (pass `documentId` for folder pages)
- Test: `tests/integration/folder-share-review.test.ts`

**Interfaces:**
- Consumes: `isReachableThroughFolder`, `listChain`, `repositories.shareLinks.findById` (Tasks 1–3).
- Produces:
  - `linkScope(r, token, lock, documentId?: string)` — document link: `documentId` must be `undefined`; folder link: required, UUID, reachable; returns `{ document, source, workspace, link }` as today.
  - `queryForLink(caller: CallerContext | null, token: string, documentId?: string)`
  - `followForLink`, `markSeenForLink` inputs and every link write input gain `documentId?: string`, passed to `linkScope`.
  - `linkValid(r, link, documentId)`: folder link → opens **and** `documentId` reachable.

- [ ] **Step 1: Write failing integration tests** (`folder-share-review.test.ts`):
  - signed-in reader creates a thread through a folder link on a deep document → thread has `originShareLinkId` = folder link; owner gets a `share_comment_events` row naming that document; reader auto-follows
  - `queryForLink(null, token, documentId)` returns that document's visible threads only
  - `documentId` omitted on a folder link, or outside the folder → `ShareLinkNotFoundError`; any `documentId` on a document link → `ShareLinkNotFoundError`
  - a `threadId` belonging to another document in the same folder, passed with this `documentId` → `ShareLinkNotFoundError`
  - document moved out after the reader loaded it: create, reply, follow, seen all → `ShareLinkNotFoundError`
  - follower Inbox (`listUnreadForOwner`'s follow entries) and `listFollowedDiscussions`: entry available while the document is in the folder; `linkAvailable: false` naming nothing after it moves out; available again when moved back
  - `unfollowOwn` works with the link dead
  - existing document-link review suites pass unchanged
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.ts tests/integration/folder-share-review.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** in `linkScope`; `followedThreads` loads each follow's link with `shareLinks.findById(follow.shareLinkId)` (memoised per link id) and judges it with `linkValid(r, link, thread.documentId)` (memoised per link+document). Drop the Task 1 guards in this service.
- [ ] **Step 4: Wire routes and the panel.** Every share-review route reads an optional `documentId` field alongside `token` and passes it through; the panel sends `documentId` when given.
- [ ] **Step 5: Run** the new suite plus `document-review-service`, `document-review-sync`, `share-comment-notify`, `review-reply-follow` integration suites — Expected: PASS.
- [ ] **Step 6: Commit** `feat(share): discussions and follows through folder links`.

### Task 6: Saved shares, My shares list and unread badge

**Files:**
- Modify: `src/infrastructure/database/mariadb/repositories/saved-shares.ts` (`findSnapshotByToken`, `list`)
- Modify: `src/infrastructure/database/mariadb/repositories/document-share-links.ts` (`listForWorkspace`)
- Modify: `src/infrastructure/database/mariadb/repositories/share-comment-events.ts` (`listUnreadCountsByRecipient`)
- Modify: `src/modules/knowledge/domain/share-management.ts`, `src/modules/knowledge/domain/saved-share.ts`, matching ports
- Modify: `src/components/knowledge/share-management-view.tsx`, `src/components/knowledge/saved-shares-view.tsx`
- Test: `tests/integration/folder-share-lists.test.ts`

**Interfaces:**
- Consumes: folder links (Task 2), folder reads (Task 3), folder-origin comment events (Task 5).
- Produces:
  - `ManagedShareLink` gains `kind: "DOCUMENT" | "FOLDER"`; `documentId: string | null`; `folderNodeId: string | null`; `title` is the folder name for folder rows.
  - `SavedShareView` gains `kind: "DOCUMENT" | "FOLDER"`.
  - `ShareDocumentUnreadCount` gains `shareLinkId: string | null` (set for folder-link rows, grouped by `origin_share_link_id`; document rows unchanged).

- [ ] **Step 1: Write failing integration tests** (`folder-share-lists.test.ts`):
  - save a folder link → saved title = folder name; renaming the folder later shows the new name while the link opens, the saved name once it dies; search by either name finds it; status `unavailable`/`expired` after revoke/expiry
  - My shares lists the folder link with `kind: "FOLDER"`, folder name, `active`; revoked/expired/`unavailable` (folder archived) states; search by folder name and by label
  - two comments through a folder link on two different documents → one unread count row for that link with `unreadCount: 2`; a document's own link count is unaffected
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.ts tests/integration/folder-share-lists.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement the SQL folder branch** with the same shape in all three queries: `LEFT JOIN knowledge_documents d ON d.id = l.document_id`, `LEFT JOIN knowledge_tree_nodes f ON f.id = l.folder_node_id AND f.node_type = 'FOLDER'`, `s ON s.id = COALESCE(d.source_id, f.source_id)`, status `COALESCE(d.status, f.status)`, title `COALESCE(r.title, f.name)`; availability for folder rows requires `f.id IS NOT NULL`. Keep every predicate inside the single statement (the snapshot must stay one consistent read).
- [ ] **Step 4: Views.** Folder rows show a folder icon (lucide `Folder`, `aria-hidden`, with "Folder" in the row's accessible name); a folder row's title links to `/w/:workspaceId/knowledge/:sourceId`; its "N new" badge reads the `shareLinkId` row; its view-count tooltip says `Documents opened through this link`.
- [ ] **Step 5: Run** the new suite plus `saved-share-service`, `saved-share-api`, `share-management` — Expected: PASS.
- [ ] **Step 6: Commit** `feat(share): folder links in saved shares and My shares`.

### Task 7: Owner entry point and reminders

**Files:**
- Modify: `src/components/actions/action-registry.ts` (`folder.share`), `src/components/actions/action-menu.tsx`
- Modify: `src/components/knowledge/share-link-dialog.tsx` (folder mode; "Also visible through" line)
- Modify: `src/components/knowledge/knowledge-tree.tsx` (shared-folder marker)
- Modify: `src/modules/knowledge/application/document-share-service.ts` (`list` result, `listOpenFolderLinks`)
- Modify: `src/app/api/documents/[documentId]/share-links/route.ts` (GET returns `viaFolders`)
- Create: `src/app/api/workspaces/[workspaceId]/shared-folders/route.ts`
- Test: `tests/integration/folder-share-reminders.test.ts`, `tests/unit/action-registry*.test.ts` (extend the existing registry test)

**Interfaces:**
- Consumes: `createForFolder`, `listForFolder` (Task 2), `listChain` (Task 3).
- Produces:
  - `requestShare(target: { documentId: string } | { folderNodeId: string }): void` — event detail carries the same shape.
  - `DocumentShareService.listOpenFolderLinks(caller, workspaceId: string): Promise<{ folderNodeId: string; name: string }[]>` — owner of that My Space only; folders with ≥ 1 open link.
  - `DocumentShareService.foldersSharingDocument(caller, documentId: string): Promise<{ folderNodeId: string; name: string }[]>` — ancestors of the document (via `listChain`) that are in `listOpenFolderLinks`.
  - `GET /api/workspaces/:workspaceId/shared-folders` → `{ folders }`; `GET /api/documents/:id/share-links` adds `viaFolders`.

- [ ] **Step 1: Write failing tests.**
  - registry: a PERSONAL workspace ACTIVE folder (either ownership, read-only capability included) offers `folder.share` labelled `Share link…`; a TEAM workspace folder and an ARCHIVED folder do not
  - integration: `listOpenFolderLinks` lists a folder with an open link; drops it after revoke and after expiry; another user's call → not found error
  - integration: `foldersSharingDocument` names the shared ancestor for a document inside, nothing for a document outside, nothing after the document moves out
- [ ] **Step 2: Run** the two test files — Expected: FAIL.
- [ ] **Step 3: Implement** services and routes. `folder.share` sits outside the existing `can.canWrite && HUB_MANAGED` folder block (sharing is reading; gate on `workspaceType === "PERSONAL"`, `confirmed`, folder `ACTIVE`, source `ACTIVE`); add `"folder.share"` to `ActionId` and `FolderCommand`. Its effect is `{ kind: "folder-command", command: "folder.share", … }` dispatched to `requestShare({ folderNodeId })`; the dialog in folder mode loads `/api/tree-nodes/:nodeId/share-links` and titles itself with the folder name.
- [ ] **Step 4: Reminders UI.** The tree fetches `shared-folders` once per workspace load (and after a create/revoke in the dialog) and shows a share icon on those folders with `aria-label="Shared"` (tokens only). The document dialog, when `viaFolders` is non-empty, shows `Also visible through the shared folder {name}` per folder, each a button that switches the dialog to that folder's links. Neither blocks any action; moving a document is unchanged.
- [ ] **Step 5: Run** the tests, `make lint`, `make typecheck` — Expected: PASS.
- [ ] **Step 6: Commit** `feat(share): share a folder from the tree and remind the owner what it exposes`.

### Task 8: End-to-end and documentation

**Files:**
- Create: `tests/e2e/zz-folder-share.spec.ts`
- Modify: `README.md` (and `README.zh-TW.md` if it carries the same table) — canonical documents table gets the spec
- Test: the e2e spec

- [ ] **Step 1: Write the e2e spec** (pattern of `share-link.spec.ts`, `saved-shares.spec.ts`):
  - owner shares a folder from the tree menu, copies the link; the folder now shows the shared marker
  - anonymous visitor opens it: first document shown; expands a subfolder, opens a deep document (URL has `?d=`); clicks an in-folder `[[link]]` and lands on it; an out-of-folder `[[link]]` is plain text with no title attribute
  - hostile: `?d=` of a document outside the folder, of another workspace's document, `?d=junk` → same not-available page as an unknown token
  - signed-in reader comments on a deep document, saves the folder; Saved shares shows it with the folder icon
  - owner sees the comment in Inbox and the "N new" on the folder row in My shares; the document's Share dialog says `Also visible through the shared folder …`
  - owner revokes → `/s/:token` and `/s/:token?d=…` both not-available
  - 390px viewport: tree hidden behind the bar button, opens and navigates
- [ ] **Step 2: Run** `make test-e2e` — Expected: PASS (if a heading-link reading test flakes, rerun once before investigating; it is a known flake).
- [ ] **Step 3: Update README's canonical documents table** with `docs/superpowers/specs/2026-10-29-folder-share-link-design.md`.
- [ ] **Step 4: Run** `make verify` — Expected: PASS.
- [ ] **Step 5: Commit** `test(share): folder share end to end; docs`.
