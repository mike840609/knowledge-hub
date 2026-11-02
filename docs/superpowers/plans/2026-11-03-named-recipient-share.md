# Named-Recipient Share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A My Space owner shares a document or folder with named Hub users, permanently; only those users (signed in) can open it, discuss it and find it in their Inbox and Shares list.

**Architecture:** A named share is a `document_share_links` row with `audience = 'NAMED'`, a null `expires_at`, and a recipient table. Every place that judges "does this link open" gains a viewer id and one extra rule (`audienceAdmits`). The anonymous `/s/<token>` page never renders a NAMED share; recipients read it at a protected in-Hub route `/w/<ws>/shares/<token>`, reached through `/s/<token>/open`.

**Tech Stack:** Next.js 15 (App Router), TypeScript, MariaDB (`mariadb` driver, hand-written migrations), Vitest (unit + integration), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-03-named-recipient-share-design.md`

## Global Constraints

- `audience` is `'LINK' | 'NAMED'`; `expires_at IS NULL` exactly when `audience = 'NAMED'`.
- NAMED shares count toward `MAX_ACTIVE_SHARE_LINKS_PER_DOCUMENT` (10), for documents and folders alike.
- `MAX_NAMED_SHARE_RECIPIENTS = 50`. At least 1 recipient to create. The owner cannot be a recipient.
- Every refusal a non-recipient can observe is `ShareLinkNotFoundError` — identical to a dead link.
- Never: Workspace membership, search, tree, history, MCP, Markdown edits or revision writes for recipients.
- `src/modules/**` may not import `next`/`react`/`mariadb`/`infrastructure`; web code reaches services only via `src/server/composition.ts`.
- UI follows `docs/superpowers/specs/frontend-design-language.md` (token names such as `text-body`, `rounded-md`; no Tailwind default sizes; colours only from CSS variables).
- Test commands: unit `npx vitest run --config vitest.config.ts <file>`; integration `npx vitest run --config vitest.integration.config.ts <file>` (needs `make db-up`); e2e `npx playwright test <file>`. If bare `npx`/`npm` fails in a non-interactive shell, use `pnpm exec`; never pipe test output in a way that hides the exit code.

## Review Focus

1. **Signed-in non-recipient holding the URL** expects the exact dead-link 404 on `/s/<token>`, `/s/<token>/open`, `/w/<ws>/shares/<token>` and every `/api/share-review/*` call — pinned in Task 2 and Task 7.
2. **Recipient removed while their tab is open** expects the next read or write to fail as a dead link, and their Inbox entry to disappear — pinned in Task 4 and Task 5.
3. **Case and shape of ids in recipient requests** (upper-case UUID, duplicate ids, owner's own id, unknown user id, 51 ids) expect normalisation or a 400, never a 500 — pinned in Task 3.
4. **Folder NAMED share after a document moves out of the folder** expects the recipient to lose that document on the next request — pinned in Task 2.
5. **A NAMED share among an owner's LINK shares** expects the owner's Shares management list, the folder "shared" marker and the 10-link count to include it with "No expiry" — pinned in Task 1.

---

### Task 1: Schema, domain and repository

**Files:**
- Create: `src/infrastructure/database/mariadb/migrations/030-named-share-recipients.ts`
- Modify: `src/infrastructure/database/mariadb/migrations/index.ts` (register after `reviewCommentMentionsMigration`)
- Modify: `src/modules/knowledge/domain/document-share-link.ts`
- Modify: `src/modules/knowledge/ports/document-share-link-repository.ts`
- Modify: the MariaDB adapter implementing `DocumentShareLinkRepository` (`src/infrastructure/**/document-share-links.ts`) and the saved-shares adapter (`saved-shares.ts`)
- Test: `tests/unit/document-share-link-named.test.ts`, `tests/integration/named-share-repository.test.ts`

**Interfaces:**
- Produces:
  - `type ShareAudience = "LINK" | "NAMED"`; `DocumentShareLink` gains `audience: ShareAudience`; `expiresAt: Date | null`.
  - `MAX_NAMED_SHARE_RECIPIENTS = 50`.
  - `evaluateShareLinkValidity`: a null `expiresAt` never yields `EXPIRED`.
  - `normalizeRecipients(raw: unknown, ctx: { ownerId: string }): string[]` — lower-cased, de-duplicated UUIDs; throws `DomainError("INVALID_REQUEST")` for non-array, non-UUID, owner id, empty list, or more than 50.
  - Repository: `insertRecipients(linkId: string, userIds: readonly string[], addedBy: string, at: Date): Promise<void>`; `removeRecipient(linkId: string, userId: string): Promise<boolean>`; `isRecipient(linkId: string, userId: string): Promise<boolean>`; `listRecipients(linkId: string): Promise<Array<{ userId: string; addedAt: Date }>>`; `countRecipients(linkId: string): Promise<number>`; `listForRecipient(userId: string, limit: number): Promise<Array<{ link: DocumentShareLink; addedAt: Date; readAt: Date | null }>>`; `markRecipientRead(linkId: string, userId: string, at: Date): Promise<void>`.

- [ ] **Step 1: Write the failing unit tests** in `tests/unit/document-share-link-named.test.ts`:
  - `evaluateShareLinkValidity` with `expiresAt: null` and all else valid → `{ valid: true }`; revoked NAMED → `REVOKED`.
  - `normalizeRecipients(["A0…UPPER", "a0…upper"], { ownerId })` → one lower-cased id; `[]` → throws; `[ownerId]` → throws; 51 distinct ids → throws; `["x"]` → throws; `"id"` (not array) → throws.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/document-share-link-named.test.ts` — expect FAIL (`normalizeRecipients` not exported).
- [ ] **Step 3: Implement the domain changes.** Update every TypeScript consumer of `expiresAt` the compiler flags (`toView`, `shareLinkExpiry` callers, views) to accept `null` (view shows "No expiry").
- [ ] **Step 4: Write migration 030:**
  ```sql
  ALTER TABLE document_share_links
    ADD COLUMN audience ENUM('LINK','NAMED') NOT NULL DEFAULT 'LINK',
    MODIFY expires_at DATETIME(6) NULL;
  ALTER TABLE document_share_links DROP CONSTRAINT ck_share_links_expiry;
  ALTER TABLE document_share_links ADD CONSTRAINT ck_share_links_expiry
    CHECK ((audience = 'LINK' AND expires_at > created_at) OR (audience = 'NAMED' AND expires_at IS NULL));
  CREATE TABLE document_share_link_recipients (
    share_link_id UUID NOT NULL, user_id UUID NOT NULL, added_by UUID NOT NULL,
    added_at DATETIME(6) NOT NULL, read_at DATETIME(6) NULL,
    PRIMARY KEY (share_link_id, user_id), KEY ix_recipient_user (user_id, added_at),
    FOREIGN KEY (share_link_id) REFERENCES document_share_links(id) ON DELETE RESTRICT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  ```
  (Check migration 028 for the folder change to the same CHECK; drop whichever constraint name is current.)
- [ ] **Step 5: Write the failing integration test** `tests/integration/named-share-repository.test.ts`:
  - insert a NAMED link with `expiresAt: null` → `findByToken` returns `audience: "NAMED"`, `expiresAt: null`.
  - `countActiveByDocument` / `countActiveByFolder` count it; `listOpenFolderLinks` lists a folder with only a NAMED link; owner `listForWorkspace` returns it.
  - recipients: insert two, `isRecipient` true/false, `removeRecipient` → true then false, `listForRecipient` newest first.
  - a LINK insert with `expiresAt: null` is rejected by the CHECK.
- [ ] **Step 6: Run** it — expect FAIL. Implement the adapter: read/write `audience`; every `expires_at > ?` filter becomes `(expires_at IS NULL OR expires_at > ?)` (adapter `listForWorkspace`, `listOpenFolderLinks`, both `countActive…`, saved-shares list); new recipient methods.
- [ ] **Step 7: Run** unit + integration files above, then `make test-integration` — expect PASS (existing share tests unchanged).
- [ ] **Step 8: Commit** `feat(share): named-share schema, domain and repository`.

### Task 2: The audience judgement on every read path

**Files:**
- Modify: `src/modules/knowledge/application/internal/folder-link-reach.ts`
- Modify: `src/modules/knowledge/application/document-share-service.ts`
- Modify: `src/server/share-read.ts`
- Modify: `tests/unit/share-link-single-exception.test.ts`
- Test: `tests/integration/named-share-read.test.ts`

**Interfaces:**
- Consumes: Task 1 repository `isRecipient`.
- Produces:
  - `audienceAdmits(repositories: KnowledgeRepositories, link: DocumentShareLink, viewerId: string | null): Promise<boolean>` in `folder-link-reach.ts` — `true` for LINK; for NAMED, `viewerId !== null && (viewerId === link.createdBy || await isRecipient(link.id, viewerId))` (ids compared lower-case).
  - `openShareLinkTarget(repositories, link, target, now, viewerId: string | null)` — returns null when `audienceAdmits` is false.
  - `readShared(token, { documentId?, recordView?, viewerId?: string | null })`, `readSharedTarget(token, { documentId?, viewerId?: string | null })`; both return `SharedView`/`SharedTargetView` plus `audience: ShareAudience`.
  - `src/server/share-read.ts`: `getSharedForViewer(token: string, viewerId: string, documentId?: string): Promise<SharedView | null>` and `sharedOpenTarget(token, requested?, viewerId?: string)`; remain the only web-layer callers of these two entries.

- [ ] **Step 1: Write the failing integration test** `tests/integration/named-share-read.test.ts`, one case per row of the spec's authorization table, for a document NAMED share and a folder NAMED share:
  - `readShared(token)` (no viewer) → `ShareLinkNotFoundError`; `readSharedTarget(token)` → same.
  - viewer = non-recipient → `ShareLinkNotFoundError` from both.
  - viewer = recipient → document view with `audience: "NAMED"`; viewer = owner → same.
  - folder share: recipient reads a document under it; after moving that document out of the folder (existing tree move helper), the same call → `ShareLinkNotFoundError`.
  - recipient removed → `ShareLinkNotFoundError`; link revoked → same.
  - LINK share: `readShared(token)` with no viewer still works (regression).
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.ts tests/integration/named-share-read.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** `audienceAdmits`, the `viewerId` parameter, and pass it through `requireOpenLink`/`readSharedFolder`. Every existing `openShareLinkTarget` caller passes the viewer it has, or `null`.
- [ ] **Step 4: Update `share-link-single-exception.test.ts`** so the three exceptions (`readShared`, `readSharedTarget`, `queryForLink`) are still the only caller-less content entries, and `src/server/share-read.ts` stays their only web-layer caller. Run it — expect PASS.
- [ ] **Step 5: Run** the integration file, `tests/integration/share-link-service.test.ts`, `tests/integration/folder-share-read.test.ts` — expect PASS.
- [ ] **Step 6: Commit** `feat(share): judge named audience on share reads`.

### Task 3: Owner management — create, recipients, revoke

**Files:**
- Modify: `src/modules/knowledge/application/document-share-service.ts`
- Modify: `src/app/api/documents/[documentId]/share-links/route.ts`, `src/app/api/tree-nodes/[nodeId]/share-links/route.ts`
- Create: `src/app/api/share-links/[linkId]/recipients/route.ts` (GET, POST), `src/app/api/share-links/[linkId]/recipients/[userId]/route.ts` (DELETE), `src/app/api/share-recipients/candidates/route.ts` (GET)
- Test: `tests/integration/named-share-management.test.ts`

**Interfaces:**
- Consumes: Task 1 domain + repository.
- Produces:
  - `create(caller, { documentId, label?, expiresInDays?, recipients? })` and `createForFolder(caller, { folderNodeId, label?, expiresInDays?, recipients? })`: when `recipients` is present the link is NAMED (`expiresAt: null`, `expiresInDays` must be absent else `INVALID_REQUEST`); recipients normalised by `normalizeRecipients` and each must exist in `users` (else `INVALID_REQUEST`).
  - `listRecipients(caller, linkId): Promise<Array<{ userId, name, nameEn, empId, addedAt }>>`; `addRecipients(caller, linkId, userIds: unknown): Promise<void>` (already-present ids ignored; total cap 50); `removeRecipient(caller, linkId, userId): Promise<void>`. Owner of the link only, else `ShareLinkNotFoundError`; LINK links refuse with `INVALID_REQUEST`; revoked links refuse.
  - `searchRecipientCandidates(caller, query: string): Promise<{ candidates: Array<{ id, name, nameEn, empId }> }>` — `users.searchExisting`, excludes the caller, `MENTION_LIMIT` results, empty query → `[]`.
  - `ShareLinkView` gains `audience` and `recipientCount: number | null`.
  - Audit events: `DOCUMENT_SHARE_LINK_CREATED` payload gains `audience` and `recipientIds`; new `DOCUMENT_SHARE_RECIPIENT_ADDED` / `DOCUMENT_SHARE_RECIPIENT_REMOVED` (payload `{ userId }`).
  - HTTP: POST body adds `recipients?: string[]`; recipients POST body `{ userIds: string[] }`; candidates `?query=`. All via `workspaceHttp` (trusted caller).

- [ ] **Step 1: Write the failing integration tests:** create NAMED doc share and folder share; owner in recipients → 400-class `DomainError`; unknown user id → `INVALID_REQUEST`; `expiresInDays` with recipients → `INVALID_REQUEST`; 51 recipients → refused; add (duplicate ignored, upper-case id normalised) / remove / list by owner; a non-owner calling list/add/remove → `ShareLinkNotFoundError`; add to a LINK link → `INVALID_REQUEST`; revoke a NAMED share → `readShared` with recipient viewer refuses; audit events written; the 11th active link (any mix of LINK/NAMED) → `ShareLinkLimitReachedError`; candidates exclude caller.
- [ ] **Step 2: Run** — expect FAIL. **Step 3: Implement** service methods, then routes.
- [ ] **Step 4: Run** the file and `tests/integration/share-management.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `feat(share): create and manage named-share recipients`.

### Task 4: Discussions, mentions, follows and saving

**Files:**
- Modify: `src/modules/knowledge/application/document-review-service.ts`
- Modify: `src/modules/knowledge/application/saved-share-service.ts`
- Modify: the `/api/share-review/*` route handlers only if they do not already pass the caller to every service call
- Test: `tests/integration/named-share-review.test.ts`

**Interfaces:**
- Consumes: Task 2 `audienceAdmits`.
- Produces (private signature changes inside `DocumentReviewService`):
  - `linkScope(r, token, lock, documentId, viewerId: string | null)`, `targetScope(r, link, documentId, lock, viewerId)`, `opens(r, scope, link, targetStatus, viewerId)`, `linkValid(r, link, documentId, viewerId)`, `folderLinkDocuments(r, link, documentIds, viewerId)`. `opens` returns false when `audienceAdmits` is false.
  - Every public entry passes its caller's id (`queryForLink`: `caller?.identity.id ?? null`). Inbox/follow/mention judgements pass the Inbox reader's `userId`.
  - `searchMentionCandidates` with a NAMED token: candidates restricted to recipients (owner is never offered, as today).
  - Comment/reply write through a NAMED link: every mentioned id must be a recipient or the owner, else `DomainError("MENTION_NOT_RECIPIENT")`.
  - `mentionLinksForOwner(caller, { documentId, mentionedUserIds?: string[] })`: a NAMED link is listed only when every given id is a recipient of it; owner write with a NAMED link and a non-recipient mention → `MENTION_NOT_RECIPIENT`.
  - `SavedShareService.save` on a NAMED link → `ShareLinkNotFoundError`.

- [ ] **Step 1: Write the failing integration tests:**
  - recipient: `queryForLink` returns threads; non-recipient caller and null caller → `ShareLinkNotFoundError`; recipient writes a thread and a reply.
  - recipient mentions another recipient → stored; mentions a non-recipient → `MENTION_NOT_RECIPIENT`, nothing stored.
  - candidates for NAMED token with query matching a non-recipient → not returned.
  - owner `mentionLinksForOwner` with a non-recipient id → NAMED link absent; with a recipient id → present.
  - recipient follows a thread; owner replies; recipient's `listUnreadForOwner` has the follow entry; recipient removed → entry names nothing (`linkAvailable: false`) and a write by them → `ShareLinkNotFoundError`; their earlier comment still listed to the owner.
  - `savedShares.save` on a NAMED token by a recipient → `ShareLinkNotFoundError`.
- [ ] **Step 2: Run** — expect FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** the file plus `make test-integration` — expect PASS.
- [ ] **Step 5: Commit** `feat(share): named audience in discussions, mentions and saves`.

### Task 5: Inbox "shared with you" entries

**Files:**
- Modify: `src/modules/knowledge/application/document-review-service.ts` (`listUnreadForOwner`, `countUnreadForOwner`, `listActivityForOwner`, `markEventRead`)
- Modify: `src/modules/knowledge/domain/share-comment-event.ts` (notification kind union) and the Inbox components that switch on `kind` (`src/components/knowledge/inbox-activity-view.tsx`, `inbox-discussion.tsx` as needed)
- Test: `tests/integration/named-share-inbox.test.ts`, `tests/unit/inbox-shared-with-you.test.tsx`

**Interfaces:**
- Consumes: Task 1 `listForRecipient`, `markRecipientRead`; Task 2 `audienceAdmits`/`openShareLinkTarget`.
- Produces: notification kind `"SHARED_WITH_YOU"`; id `` `${SHARED_PREFIX}${linkId}` `` with `SHARED_PREFIX = "shared:"`; fields `documentTitle` (document title, or folder name), `authorName` (owner's name), `createdAt = addedAt`, `readAt`, `linkAvailable`, `href = /w/<readerPersonalWs>/shares/<token>`. Judged per request; not open → `linkAvailable: false` with empty title/author (as a dead mention). Counted in the badge while unread and live. `markEventRead(caller, "shared:<linkId>")` sets `read_at`. Opening the in-Hub reader also marks it read (Task 7 calls `markRecipientRead`).
- Removal deletes the row, so the entry disappears entirely (stronger than "names nothing"; record in spec deviations, Task 9). Re-adding inserts a fresh unread row.

- [ ] **Step 1: Write failing tests:** integration — add A → A's unread list has one `SHARED_WITH_YOU` with title and owner name, badge +1; mark read → badge −1; revoke → entry present with `linkAvailable: false`, badge 0; remove A → entry gone; re-add → new unread entry. Unit — the Inbox row for `SHARED_WITH_YOU` renders "<owner> shared 《<title>》 with you" and links to `href`; a dead one renders the existing unavailable state.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(inbox): shared-with-you entries for named shares`.

### Task 6: Shares → "Shared with you" list

**Files:**
- Modify: `src/modules/knowledge/application/saved-share-service.ts` (add method) or `document-share-service.ts` — put it in `SavedShareService`
- Modify: `src/components/knowledge/saved-shares-view.tsx`, `src/app/w/[workspaceId]/shares/page.tsx`
- Test: `tests/integration/named-share-recipient-list.test.ts`, `tests/unit/saved-shares-view-named.test.tsx`

**Interfaces:**
- Consumes: Task 1 `listForRecipient`; Task 2 judgement.
- Produces: `SavedShareService.listNamedForRecipient(caller: CallerContext, workspaceId: string): Promise<Array<{ linkId, title, sharedByName, addedAt, href }>>` — the caller's own personal workspace only; up to 100 newest; only links that open now; folder entries titled by folder name.
- UI decision (plan's call): a "Shared with you" section above the saved list on the Saved tab, not merged rows — saved shares keep paging/search unchanged. Save button stays hidden for NAMED (the reader page never shows it).

- [ ] **Step 1: Failing tests:** integration — two NAMED shares for A, one revoked → one returned; another user's workspace id → refused as today's `personal()` refuses. Unit — section renders titles linking to `href`; hidden when empty.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(shares): list named shares for their recipients`.

### Task 7: Routes — anonymous page, `/open`, in-Hub reader

**Files:**
- Modify: `src/app/s/[token]/not-found.tsx` (add `OpenInHubHint`)
- Create: `src/components/knowledge/open-in-hub-hint.tsx` (client; reads `usePathname()`, links to `<path>/open`)
- Modify: `src/app/s/[token]/open/page.tsx`
- Create: `src/app/w/[workspaceId]/shares/[token]/page.tsx`
- Test: `tests/e2e/zz-named-share.spec.ts` (routing cases), `tests/unit/open-in-hub-hint.test.tsx`

**Interfaces:**
- Consumes: Task 2 `getSharedForViewer`, `sharedOpenTarget(token, requested, viewerId)`; Task 5 `markRecipientRead`; existing `SharedReading`, `SharedReviewPanel`, `SharedFolderPage` components.
- Produces:
  - `/s/<token>`: unchanged code path; NAMED tokens already 404 because `readShared` refuses without a viewer. The not-found page shows, for every token, the neutral line "如果這是分享給你的，請在 Hub 中開啟" linking to `/s/<token>/open` (`?d=` preserved).
  - `/s/<token>/open`: first `sharedOpenTarget(token, requested)` caller-less (LINK path unchanged). If null: `establishTrustedCaller()`, retry with `viewerId`; still null → `notFound()`. A NAMED target redirects to `/w/<personalWorkspace.id>/shares/<token>` (`?d=<documentId>` for folders). Deviation to record (Task 9): a dead LINK token now reaches sign-in before its 404 when the caller is not yet signed in.
  - `/w/[workspaceId]/shares/[token]`: `establishTrustedCaller()`; if `workspaceId !== personalWorkspace.id` redirect to the caller's own; `getSharedForViewer` → null → `notFound()`; renders the same reading + review panel as `/s/<token>` (no Save button, no sign-in prompt); marks the recipient row read. `generateMetadata` uses the title only after the viewer check passes.

- [ ] **Step 1: Failing tests:** unit — hint renders link `/s/abc/open` for pathname `/s/abc`. e2e — (a) anonymous GET `/s/<named>` returns 404 with the same `<title>` as a random token; (b) recipient visiting `/s/<named>/open` lands on `/w/<ws>/shares/<named>` and sees the title; (c) signed-in non-recipient on `/open` and on `/w/<ws>/shares/<named>` gets 404; (d) a LINK share still opens anonymously on `/s/<token>`.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(share): in-Hub reader and open route for named shares`.

### Task 8: Share dialog and owner list UI

**Files:**
- Modify: `src/components/knowledge/share-link-dialog.tsx`
- Create: `src/components/knowledge/recipient-picker.tsx`
- Modify: `src/components/knowledge/share-management-view.tsx`
- Test: `tests/unit/recipient-picker.test.tsx`, `tests/unit/share-link-dialog-named.test.tsx`

**Interfaces:**
- Consumes: Task 3 HTTP endpoints; `ShareLinkView.audience`, `recipientCount`.
- Produces:
  - `RecipientPicker({ value: Recipient[], onChange(next: Recipient[]), disabled? })` where `Recipient = { id, name, nameEn, empId }`. Debounced search against `/api/share-recipients/candidates?query=` (reuse `DEBOUNCE_MS` from `mention-autocomplete.tsx`), option text `name · empId · nameEn`, chips with remove buttons, keyboard: ↑/↓/Enter/Escape, `role="combobox"`/`listbox` semantics.
  - Dialog: a mode switch "連結（有期限）" / "指定人員（永久）". NAMED mode hides expiry, requires ≥1 recipient, posts `recipients`. Each NAMED link row shows "No expiry", recipient count, a "Manage people" panel (list, add via picker, remove) and copies `/s/<token>/open`.
  - Management view: NAMED rows show "No expiry" and recipient count.

- [ ] **Step 1: Failing unit tests:** picker — typing calls the endpoint once after debounce, selecting adds a chip, duplicate selection ignored, remove chip, Enter on highlighted option selects; dialog — NAMED mode hides expiry, create disabled with 0 recipients, POST body contains `recipients` ids and no `expiresInDays`, copy button text is the `/open` URL.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(share): pick named recipients in the share dialog`.

### Task 9: End-to-end, docs and contracts

**Files:**
- Modify: `tests/e2e/zz-named-share.spec.ts` (full flow)
- Modify: `CLAUDE.md` (share-link invariant paragraph)
- Modify: `docs/superpowers/specs/2026-10-29-folder-share-link-design.md` (add "Amended by `2026-11-03-named-recipient-share-design.md`")
- Modify: `docs/superpowers/specs/2026-11-03-named-recipient-share-design.md` (append "Deviations recorded during planning")
- Modify: README "Current canonical documents" table if it lists share specs

- [ ] **Step 1: e2e full flow** (spec success scenario): owner O creates NAMED share on D for A and B → A's Inbox shows "O shared 《D》 with you" → A opens, comments, mention list offers B only → O removes A → A's reload is 404 and Inbox entry gone; A's comment still visible to O.
- [ ] **Step 2: Docs.** CLAUDE.md: add that a share link has an audience; a NAMED link opens only for a signed-in recipient or its owner, is never read caller-less, is read in the Hub at `/w/<ws>/shares/<token>`, and grants nothing beyond what a link grants. Spec deviations: (1) a removed recipient's "shared with you" entry disappears rather than naming nothing; (2) a dead LINK token on `/open` may reach sign-in before its 404; (3) "Shared with you" is its own section, not merged rows.
- [ ] **Step 3: Run** `make verify` and `make test-integration` and `make test-e2e` — all PASS.
- [ ] **Step 4: Commit** `docs(share): record named-share contract and deviations`.
