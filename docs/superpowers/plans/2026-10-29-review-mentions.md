# `@` Mentions in Discussions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Writers in a discussion can `@` any signed-in Hub user (matched on `name` / `emp_id` / `name_en`); the person gets a MENTION entry in their Inbox carrying the discussion's share link, and follows the discussion.

**Architecture:** One new table `review_comment_mentions` written inside the existing comment unit of work in `DocumentReviewService`; mention Inbox entries are derived per request against link validity and comment visibility, beside the existing OWNER / FOLLOW kinds. Candidate search reuses `users.searchExisting` behind a new review-scoped route that requires the same scope as writing a comment.

**Tech Stack:** Next.js 15 route handlers, TypeScript, MariaDB (`mariadb` driver), Vitest (unit + integration), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-29-review-mentions-design.md`

## Global Constraints

- At most **10** mentions per comment; more → `DomainError("INVALID_REQUEST", …)`, whole write refused.
- Candidate search returns at most **10** rows; empty/whitespace query → `[]`; query sliced to 200 chars (as `searchUsers`).
- Excerpt length is the existing `EXCERPT_LIMIT` (80).
- Inbox mention ids are `mention:<commentId>`; follow ids stay `follow:<threadId>`.
- At most `FOLLOW_LIMIT` (100) mention entries, first Activity page only, not cursor-paged (recorded deviation).
- Dead-entry copy is the FOLLOW one: title "A shared discussion", line "This link is no longer available."
- Migrations are additive and forward-only; `share_comment_events.mentioned_user_id` is left NULL and untouched.
- Module boundaries per `eslint.config.mjs`: `src/modules/**` imports no `next`/`react`/`mariadb`/`infrastructure`.
- Tailwind uses the contract tokens (`text-body-sm`, `text-caption`, `rounded-md`, `shadow-popover` …), never Tailwind defaults; colours only via `kh-*` variables.
- Every new entry takes a `CallerContext`; `tests/unit/share-link-single-exception.test.ts` must pass unchanged.

## Review Focus

1. **Writer mentions someone, then the owner hides or the writer deletes that comment** → the mentioned person's entry names nothing and is not counted unread. (Test in Task 5.)
2. **Mentioned person already follows the thread through a link that has since been revoked** → follow moves to the carried link, `seen_at` kept, later replies reach them. (Test in Task 2 + Task 4.)
3. **A reader mentions the document owner, or themselves** → no mention row, no follow row, write succeeds. (Test in Task 3.)
4. **Idempotent retry of a create/reply that carried mentions** → exactly one mention row per person, no second follow change. (Test in Task 4.)
5. **Lower/upper-case English name** (`ming` vs `Ming Chen` in a `utf8mb4_bin` column) → matched. (Test in Task 1.)

---

### Task 1: Shared user search matches `name_en`

**Files:**
- Modify: `src/infrastructure/database/mariadb/repositories/users.ts:35-42`
- Modify: `src/modules/identity/ports/user-repository.ts:4`
- Modify: `src/server/workspace-admin.ts:101-107` (+ `HubUserLookup` type where declared)
- Test: `tests/integration/users-account.test.ts`

**Interfaces:**
- Produces: `UserRepository.searchExisting(query: string, limit: number): Promise<Array<UserIdentity & { nameEn: string | null }>>`; `HubUserLookup = { id: string; name: string; empId: string; nameEn: string | null }`.

- [ ] **Step 1: Write failing integration tests** in `users-account.test.ts`:
  - `searchExisting matches name_en case-insensitively`: insert user `{name:"陳小明", emp_id:"E1234"}` with `nameEn "Ming Chen"`; `searchExisting("ming", 10)` and `searchExisting("CHEN", 10)` each return that user with `nameEn === "Ming Chen"`.
  - `searchExisting still matches name and emp_id`: `"小明"` and `"E12"` return the user.
  - `searchExisting returns nameEn null when absent`.
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.ts tests/integration/users-account.test.ts` — Expected: the three new cases FAIL.
- [ ] **Step 3: Implement.** SQL adds `name_en` to the SELECT and `OR (name_en IS NOT NULL AND LOCATE(LOWER(?), LOWER(name_en)) > 0)`; map `name_en` to `nameEn`. `searchUsers` returns `nameEn`. Other `mapUser` callers unchanged.
- [ ] **Step 4: Run** the same command plus `make test-unit` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(identity): user search matches the English name`.

### Task 2: Mentions table, repository, and the mention follow

**Files:**
- Create: `src/infrastructure/database/mariadb/migrations/029-review-comment-mentions.ts`
- Modify: `src/infrastructure/database/mariadb/migrations/index.ts`
- Create: `src/modules/knowledge/domain/review-mention.ts`
- Create: `src/modules/knowledge/ports/review-mention-repository.ts`
- Create: `src/infrastructure/database/mariadb/repositories/review-mentions.ts`
- Modify: `src/modules/knowledge/ports/review-follow-repository.ts`, `src/infrastructure/database/mariadb/repositories/review-follows.ts`
- Modify: `src/modules/knowledge/ports/unit-of-work.ts` (add `reviewMentions`), the MariaDB unit-of-work wiring that builds `KnowledgeRepositories`, and any in-memory fake of `KnowledgeRepositories` used by unit tests
- Test: `tests/integration/review-mentions.test.ts` (new), `tests/integration/document-review-schema.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // domain/review-mention.ts
  export type ReviewMention = { commentId: string; mentionedUserId: string; shareLinkId: string; createdAt: Date; readAt: Date | null };
  // ports/review-mention-repository.ts — every method keyed by the user it acts for
  export interface ReviewMentionRepository {
    insertMany(rows: ReviewMention[]): Promise<void>;
    listRecentByRecipient(userId: string, limit: number): Promise<ReviewMention[]>;   // newest first
    listUnreadByRecipient(userId: string): Promise<ReviewMention[]>;                  // unread rows only (judged live by the service)
    mentionedCommentIds(userId: string, commentIds: readonly string[]): Promise<Set<string>>;
    markRead(userId: string, commentId: string, at: Date): Promise<void>;
    markAllRead(userId: string, at: Date): Promise<void>;
    markThreadRead(userId: string, threadId: string, at: Date): Promise<void>;        // joins document_review_comments
  }
  // ReviewFollowRepository addition
  followForMention(input: { threadId: string; userId: string; shareLinkId: string; at: Date; currentLinkValid: (shareLinkId: string) => Promise<boolean> }): Promise<void>;
  ```
- `KnowledgeRepositories.reviewMentions: ReviewMentionRepository`.

- [ ] **Step 1: Write failing tests.**
  - Schema test: migration 029 creates `review_comment_mentions` with PK `(comment_id, mentioned_user_id)`, key `ix_mention_inbox (mentioned_user_id, read_at, created_at)`, FKs to comments/users/share links, `ON DELETE RESTRICT`.
  - `review-mentions.test.ts` repository cases: `insertMany` then `listRecentByRecipient` returns only that user's rows newest first; `markRead` touches only the caller's row; `markAllRead` only the caller's; `markThreadRead` only rows whose comment is in that thread; `mentionedCommentIds` returns the intersection.
  - `followForMention`: (a) no row → inserted `following=1, seen_at=at`; (b) `following=0` → `following=1, seen_at=at, share_link_id=new`; (c) following with valid link → row unchanged (same `seen_at`, same link); (d) following with `currentLinkValid` returning false → `share_link_id=new`, `seen_at` unchanged.
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.ts tests/integration/review-mentions.test.ts tests/integration/document-review-schema.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** migration (version 29, name `review-comment-mentions`, `ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`, style of 024), repository, `followForMention` (read the row first with `SELECT … FOR UPDATE`, then branch; the `currentLinkValid` callback keeps link judgement in the service), UoW wiring.
- [ ] **Step 4: Run** the same command — Expected: PASS. Then `make test-unit` (fakes still compile).
- [ ] **Step 5: Commit** `feat(review): mentions table and the mention follow`.

### Task 3: Mention rules in the domain

**Files:**
- Modify: `src/modules/knowledge/domain/review-mention.ts`
- Modify: `src/modules/knowledge/domain/review-follow.ts:18-28`
- Test: `tests/unit/review-mention.test.ts` (new), `tests/unit/review-follow.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MENTION_LIMIT = 10;
  export const MENTION_PREFIX = "mention:";
  /** Validated, de-duplicated mention targets; the writer and the Workspace owner dropped. Throws DomainError INVALID_REQUEST. */
  export function normalizeMentions(raw: unknown, ctx: { writerId: string; ownerId: string | null }): string[];
  ```
  `summarizeFollowedThread` gains optional `excludeCommentIds?: ReadonlySet<string>`; excluded comments count neither toward `unread` nor as `latestReply`.

- [ ] **Step 1: Write failing unit tests:**
  - `undefined` → `[]`; `[]` → `[]`.
  - `["a","a",b]` (valid UUIDs) → `[a,b]`.
  - writer id and owner id are dropped; result may be empty.
  - 11 distinct UUIDs → throws `INVALID_REQUEST`; exactly 10 → OK.
  - non-array, non-string element, non-UUID string → throws `INVALID_REQUEST`.
  - `summarizeFollowedThread` with a reply in `excludeCommentIds` → `unread` 0 and `latestReply` is the previous reply (or null).
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/review-mention.test.ts tests/unit/review-follow.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** using `isUuid` from `@/shared/ids/uuidv7`. Unknown-but-well-formed ids are checked in Task 4 (needs the DB).
- [ ] **Step 4: Run** same — Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): mention rules`.

### Task 4: Writing a mention (service + write routes)

**Files:**
- Modify: `src/modules/knowledge/application/document-review-service.ts` (`creation`, `create`, `reply`, `createForLink`, `createForOwner`, `replyForLink`, `replyForOwner`; new private `mentionOnWrite`)
- Modify: `src/modules/knowledge/domain/document-review.ts` (`CreateReviewThreadInput`, `CreateOwnerReviewThreadInput`, `ReplyReviewInput` gain `mentions?: unknown`; owner inputs also `mentionLinkId?: unknown`)
- Modify: `src/app/api/share-review/threads/[threadId]/replies/route.ts`, `src/app/api/documents/[documentId]/review-threads/[threadId]/replies/route.ts`, `src/app/api/documents/[documentId]/review-threads/route.ts` (pass `mentions` / `mentionLinkId` through; `share-review/threads/route.ts` already passes the whole body)
- Test: `tests/integration/review-mentions.test.ts`

**Interfaces:**
- Consumes: `normalizeMentions`, `ReviewMentionRepository.insertMany`, `ReviewFollowRepository.followForMention`, private `linkValid`.
- Produces: `private async mentionOnWrite(r, caller, s, carriedLinkId: string | null, comment: ReviewComment, mentions: string[]): Promise<void>`, called right after `followOnWrite` in both `create` and `reply`.

- [ ] **Step 1: Write failing integration tests** (`describe("writing a mention")`), using the fixtures of `review-reply-follow.test.ts`:
  - reader R creates on a live link with `mentions:[B]` → one row `(comment, B, link)`, B follows the thread with that link.
  - reply with `mentions:[B, C]` → two rows.
  - `mentions:[owner, R]` → no rows, no follow for owner, write succeeds.
  - unknown well-formed UUID → `INVALID_REQUEST`, and no comment row exists afterwards.
  - 11 mentions → `INVALID_REQUEST`, no comment.
  - owner `createForOwner` with `mentions:[B]` and no `mentionLinkId` → `INVALID_REQUEST`; with a revoked link's id → `INVALID_REQUEST`; with another document's link id → `INVALID_REQUEST`; with a live link of this document → row carries that link.
  - idempotent replay of the same create (same key, same body, same mentions) → still one row; same key with different mentions → `IDEMPOTENCY_KEY_REUSED`.
  - B already follows via a revoked link → after mention, B's follow carries the new link with the old `seen_at`.
  - edit (`editForLink`) leaves mention rows unchanged.
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.ts tests/integration/review-mentions.test.ts` — Expected: new cases FAIL.
- [ ] **Step 3: Implement.**
  - `normalizeMentions(input.mentions, { writerId: caller.identity.id, ownerId: s.workspace.personalOwnerUserId })` before any write.
  - Request hash: include `mentions` (sorted) **only when non-empty**, so existing hashes for mention-free requests are unchanged.
  - Unknown ids: `r.users.findByIds(ids)` length must equal `ids.length`.
  - Carried link: link writes use `s.link.id`; owner writes require `mentionLinkId` when the list is non-empty, a link with `documentId === s.document.id` from `r.shareLinks.listByDocument`, and `linkValid(r, link) === true`.
  - Insert rows with `createdAt = comment.createdAt`, then `followForMention` per person with `currentLinkValid` = lookup + `linkValid`.
  - Routes: read `mentions` (array) and `mentionLinkId` (string) from `reviewBody(request)` alongside the existing fields; absent → `undefined`.
- [ ] **Step 4: Run** the same command and `tests/integration/review-reply-follow.test.ts tests/integration/share-comment-notify.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): mentions on create and reply`.

### Task 5: Mentions in the Inbox (service read paths)

**Files:**
- Modify: `src/modules/knowledge/application/document-review-service.ts` (`listUnreadForOwner`, `countUnreadForOwner`, `listActivityForOwner`, `markEventRead`, `markAllActivityRead`, `markSeenForLink`, `followedThreads`; new private `mentionViews`)
- Modify: `src/modules/knowledge/domain/share-comment-event.ts` (`kind` adds `"MENTION"`)
- Test: `tests/integration/review-mentions.test.ts`, `tests/unit/review-notifications-routes.test.ts`

**Interfaces:**
- Produces: `ShareCommentNotificationView.kind?: "OWNER" | "FOLLOW" | "MENTION"`. A MENTION view: `id = "mention:" + commentId`, `workspaceId/documentId/sourceId = ""`, `token` and `linkAvailable` as FOLLOW, `documentTitle`, `authorName`, `excerpt`, `createdAt = mention.createdAt`, `readAt = mention.readAt`. Dead: `linkAvailable:false`, empty title/author/excerpt, no token, `readAt` set to `createdAt` so it is never unread.

- [ ] **Step 1: Write failing integration tests** (`describe("mentions in the Inbox")`):
  - B's `listUnreadForOwner` lists one MENTION with token, title, author R, excerpt; C's does not.
  - revoke the link → B's entry is dead (no title/author/excerpt/token) and `countUnreadForOwner` drops by 1.
  - owner hides the comment → same as dead-or-absent: not counted, names nothing.
  - R deletes the comment → same.
  - B already followed the thread before; R's mention reply appears once (MENTION) and not again as a FOLLOW unread.
  - `markEventRead(B, "mention:"+commentId)` → read; `markEventRead(C, same)` changes nothing for B.
  - `markAllActivityRead(B)` → all B's mentions read.
  - `markSeenForLink(B, {token, threadId})` → B's mentions in that thread read.
  - `listActivityForOwner(B)` first page includes MENTION entries (read and unread); with a `before` cursor it includes none.
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.ts tests/integration/review-mentions.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `mentionViews(r, userId)` from `listRecentByRecipient(userId, FOLLOW_LIMIT)`, judging each row with the cached `linkValid` (as `followedThreads` caches per link) and the `notificationViews` visibility rules (thread HIDDEN, retracted, comment deleted/HIDDEN → dead). `followedThreads` passes `excludeCommentIds` from `mentionedCommentIds`. Count = owner + follows + live unread mentions.
- [ ] **Step 4: Run** same plus `tests/unit/review-notifications-routes.test.ts` — Expected: PASS (route test: `mark-read` accepts `eventId: "mention:<uuid>"`).
- [ ] **Step 5: Commit** `feat(review): mentions reach the Inbox`.

### Task 6: Candidate search route and the invariant

**Files:**
- Modify: `src/modules/knowledge/application/document-review-service.ts` (new `searchMentionCandidates`)
- Create: `src/app/api/review-mentions/candidates/route.ts`
- Modify: `CLAUDE.md` (share-link invariant: add the mention path, spec § Authorization wording)
- Test: `tests/integration/review-mentions.test.ts`, `tests/unit/share-link-single-exception.test.ts` (must pass unchanged)

**Interfaces:**
- Produces:
  ```ts
  searchMentionCandidates(caller: CallerContext, input: { query: string; token?: string; documentId?: string }): Promise<{ candidates: Array<{ id: string; name: string; nameEn: string | null; empId: string }> }>;
  ```
  `GET /api/review-mentions/candidates?query=&token=` or `&documentId=`, through `reviewHttp` (trusted caller). Exactly one of `token`/`documentId`, else `INVALID_REQUEST`.

- [ ] **Step 1: Write failing tests:**
  - live token + signed-in caller → candidates (≤10) incl. `nameEn`.
  - revoked/unknown token → `ShareLinkNotFoundError` (404), no rows.
  - `documentId` by owner → candidates; by non-owner → not found.
  - empty query → `[]`.
  - both or neither of token/documentId → `INVALID_REQUEST`.
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.ts tests/integration/review-mentions.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**: `linkScope(r, token, false)` or `ownerScope(r, caller, documentId, false)`, then `r.users.searchExisting(query.trim().slice(0, 200), MENTION_LIMIT)`. No `writesEnabled` gate (reading, like follow). Update CLAUDE.md.
- [ ] **Step 4: Run** same, then `make test-unit` — Expected: PASS incl. `share-link-single-exception`.
- [ ] **Step 5: Commit** `feat(review): mention candidate search, scoped to who can comment`.

### Task 7: The `@` list in the composer

**Files:**
- Create: `src/components/knowledge/mention-autocomplete.tsx`
- Modify: `src/components/knowledge/review-thread-list.tsx` (`ReviewReplyForm`), `src/components/knowledge/review-composer.tsx` (`ReviewComposer`), `src/components/knowledge/shared-review-panel.tsx`, `src/components/knowledge/owner-review-panel.tsx`
- Test: `tests/unit/mention-autocomplete.test.tsx` (new), `tests/unit/review-thread-list.test.tsx`

**Interfaces:**
- Consumes: Task 6 route; `GET /api/documents/:id/share-links` → `links[].{ id, label, active }`.
- Produces:
  ```ts
  export type MentionScope = { token: string } | { documentId: string };
  export type MentionPick = { id: string; name: string };
  // ReviewReplyForm / ReviewComposer gain:
  mentionScope?: MentionScope;            // absent → no @ list (anonymous, read-only)
  onSubmit: (body: string, key: string, mentions: string[]) => Promise<void>;   // third arg added
  ```
  Owner panel only: `mentionLinks?: Array<{ id: string; label: string | null }>` (active links); request body carries `mentionLinkId`.

- [ ] **Step 1: Write failing rendered-component tests:**
  - typing `@ming` at a word start opens a `role="listbox"` after fetching candidates; option text shows `陳小明` and `Ming Chen · E1234`; `name_en` null shows `E1234` only.
  - ↓ then Enter inserts `@陳小明 ` at the caret and closes the list; `onSubmit` receives `mentions: [id]`.
  - Esc closes the list without closing the form.
  - `@` inside a word (`a@b`) opens nothing.
  - deleting the inserted `@陳小明` text before submit drops that id from `mentions`.
  - owner, no active link: typing `@` shows `Create a share link first to mention someone` and offers no option.
  - owner, two active links and a pick made: a "Share via" `<select>` appears; submit carries the chosen `mentionLinkId`. One active link: no select, its id sent.
  - no `mentionScope`: `@` does nothing.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/mention-autocomplete.test.tsx tests/unit/review-thread-list.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.** ARIA combobox on the textarea (`aria-controls`, `aria-activedescendant`, `aria-expanded`); fetch debounced 150 ms through `reviewRequest`; popover styled `rounded-md border border-kh-border bg-kh-bg shadow-popover`, rows `text-body-sm` + secondary `text-caption text-kh-text-muted`. Picks kept as `{id,name}`; at submit keep only picks whose `@name` still appears in the body. The form's Esc handler must not fire while the list is open. Shared panel passes `{ token }` only when signed in and writes are enabled; owner panel passes `{ documentId }` and loads active links once when the list first opens.
- [ ] **Step 4: Run** same plus `make test-unit` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): @ list in the discussion composer`.

### Task 8: MENTION entries in the Inbox UI

**Files:**
- Modify: `src/components/knowledge/notification-href.ts`, `src/components/shell/inbox-popover.tsx:129-136`, `src/components/knowledge/inbox-activity-view.tsx:87-95,158-167`, `src/components/knowledge/inbox-discussion.tsx:29,76`, `src/components/knowledge/home-attention.tsx:29`, `src/components/knowledge/share-comment-notifications.ts:17`
- Test: `tests/unit/inbox-split-view.test.tsx`, `tests/unit/primary-nav-inbox.test.tsx`

**Interfaces:**
- Produces: `export const isLinkEntry = (kind?: string) => kind === "FOLLOW" || kind === "MENTION";` in `notification-href.ts`; every `kind === "FOLLOW"` routing/dead-entry check in the files above uses it. Label: MENTION → `"Mentioned you"`; FOLLOW keeps `"Discussion you follow"`. `share-comment-notifications.ts` keeps only `kind === "OWNER" || kind === undefined`.

- [ ] **Step 1: Write failing tests:** a MENTION entry renders `Mentioned you`, links to `/s/<token>?thread=<id>` with `prefetch={false}`, opens in the split view through the token like FOLLOW; a dead MENTION renders `A shared discussion` / `This link is no longer available.` with no link; the owner panel's unread hook ignores MENTION entries.
- [ ] **Step 2: Run** `npx vitest run --config vitest.config.ts tests/unit/inbox-split-view.test.tsx tests/unit/primary-nav-inbox.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run** same plus `make verify` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(inbox): mentions in the Inbox`.

### Task 9: End-to-end

**Files:**
- Create: `tests/e2e/zz-review-mentions.spec.ts` (fixtures and sign-in helpers as in `zz-review-reply-follow.spec.ts`)

- [ ] **Step 1: Write the spec:**
  - reader R on `/s/:token` selects text, types `@` + part of B's name, picks B with the keyboard, posts. B signs in: Inbox badge shows 1, entry reads `Mentioned you`, opening it lands on `/s/:token?thread=…` with the discussion active, badge clears.
  - owner O replies in the owner view; B's Inbox shows a FOLLOW entry for that reply.
  - owner with no share link: typing `@` in the owner composer shows `Create a share link first to mention someone`.
- [ ] **Step 2: Run** `make test-e2e` (or `npx playwright test tests/e2e/zz-review-mentions.spec.ts` against the provisioned DB) — Expected: PASS. If a stale-build symptom appears ("PROBE-NEXT", "Loading document"), move `.next/cache` aside and rerun.
- [ ] **Step 3: Commit** `test(e2e): mentions reach the mentioned reader`.
