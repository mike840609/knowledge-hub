# Inbox Discussion Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Inbox from a notification queue into a discussion index: one row per discussion, all history, relationship tabs plus status/unread filters, and a pane whose writes settle the row without a manual Refresh.

**Architecture:** A new read model aggregates owner share-comment threads, followed discussions and mentions by `threadId` in `DocumentReviewService`, backed by one grouped owner query in `ShareCommentEventRepository`. A new `/api/review-notifications/inbox` read/write pair serves the page; the page's components are split into filters, row, shared-with-you section and the existing pane.

**Tech Stack:** Next.js 15, React 19, TypeScript, MariaDB, Base UI, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-04-inbox-discussion-index-design.md`

## Global Constraints

- One row per **discussion** (`threadId`); owner comments and mentions of one thread never make two rows.
- Scope is only the discussions that reach the reader today: owner comments on their shared documents, follows, mentions. No new access path.
- The page has **no page-level unread count**; the rail badge is the only number.
- Relationship tabs (`All` / `My documents` / `Following` / `Mentions`) and the status/unread filters are server-side and live in the URL.
- Shared-with-you documents are unread-only, visually separate, never in the discussion list or the relationship tabs.
- Selecting a discussion marks owner notices, the follow and mentions in one request; an unknown thread is a no-op.
- A pane write settles the selected row even when it stops matching the active filter; it leaves only on another selection or a filter change.
- Dead links are not listed. A link that dies after the row loads shows the pane's placeholder and requests nothing further.
- Followed and mentioned discussions are the bounded first-page set (100 follows, 100 mention comments); owner discussions page by `(latestAt, threadId)`.
- `?item=<threadId>`; filters are `?kind=`, `?status=`, `?unread=1`.
- No archive/snooze, grouping by document, Inbox search, mobile split/detail, or real-time updates.
- Copy is fixed by the spec: `No discussions yet.`, `No discussions match these filters.`, `No unread discussions.`, `Shared with you`, `See all in Shares`.
- `make verify` must pass before the branch is handed over.

## Review Focus

- A discussion with several owner comments: one row, latest comment, count and unread count agree, never one row per comment.
- A thread both followed and mentioned: one row, both flags, `Mentioned you` label, live follow href, unread replies plus unread mentions.
- A filter change plus a write that makes the selected row stop matching: the row stays and updates; the pane does not close.
- A deep link `?item=` to a discussion not on the loaded page: the one-thread lookup returns it, but a filter that excludes it still selects nothing.
- A dead or revoked link: absent from the list, no title or token leaked; Shares > Discussions still shows the unavailable follow.

---

### Task 1: The discussion view and its pure merge

**Files:**
- Create: `src/modules/knowledge/domain/inbox-discussion.ts`
- Test: `tests/unit/inbox-discussion.test.ts`

**Interfaces:**
- Consumes: `ShareCommentNotificationView` from `./share-comment-event`.
- Produces:
  - `InboxRelationship = "OWNER" | "FOLLOW" | "MENTION"`
  - `InboxKindFilter = "all" | "owner" | "follow" | "mention"`
  - `InboxStatusFilter = "all" | "open" | "resolved"`
  - `InboxCursor = { latestAt: Date; threadId: string }`
  - `InboxDiscussionView` (fields below)
  - `InboxPage = { discussions: InboxDiscussionView[]; shared: ShareCommentNotificationView[]; nextCursor: { latestAt: string; threadId: string } | null }`
  - `mergeInboxDiscussions(views: readonly InboxDiscussionView[]): InboxDiscussionView[]`
  - `filterInboxDiscussions(views: readonly InboxDiscussionView[], filter: { kind: InboxKindFilter; status: InboxStatusFilter; unread: boolean }): InboxDiscussionView[]`
  - `sortInboxDiscussions(views: readonly InboxDiscussionView[]): InboxDiscussionView[]`

```ts
export type InboxDiscussionView = {
  threadId: string;
  kind: InboxRelationship;
  documentId: string;
  sourceId: string;
  documentTitle: string;
  quote: string;
  href: string;
  token?: string;
  latest: { authorName?: string; excerpt: string; createdAt: Date };
  latestAt: Date;
  commentCount: number;
  unreadCount: number;
  status: "OPEN" | "RESOLVED";
  following: boolean;
  mentioned: boolean;
};
```

Merge rules:
- Group by `threadId`. The owner view wins identity (`documentId`, `sourceId`, `documentTitle`, `quote`, `href`, `status`); otherwise a live follow wins, then the newest mention.
- `kind` is `OWNER` if an owner view exists, else `MENTION` if any mention exists, else `FOLLOW`.
- `following` / `mentioned` are the OR of the views.
- `unreadCount` is the owner view's count when one exists; otherwise the sum of the link views' counts.
- `commentCount` is the maximum; `latestAt` and `latest` are the newest view's.
- Sort newest `latestAt` first, then `threadId` descending.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/inbox-discussion.test.ts
import { describe, expect, it } from "vitest";
import { filterInboxDiscussions, mergeInboxDiscussions, sortInboxDiscussions, type InboxDiscussionView } from "@/modules/knowledge/domain/inbox-discussion";

const view = (over: Partial<InboxDiscussionView> & Pick<InboxDiscussionView, "threadId" | "kind">): InboxDiscussionView => ({
  documentId: "doc", sourceId: "src", documentTitle: "Doc", quote: "quote",
  href: `/w/ws/knowledge/src/doc?thread=${over.threadId}`,
  latest: { authorName: "Ann", excerpt: "hello", createdAt: new Date(10) },
  latestAt: new Date(10), commentCount: 1, unreadCount: 0, status: "OPEN",
  following: false, mentioned: false, ...over,
});

it("merges owner and mention of one thread into one owner row", () => {
  const merged = mergeInboxDiscussions([
    view({ threadId: "t", kind: "OWNER", unreadCount: 2, latestAt: new Date(20) }),
    view({ threadId: "t", kind: "MENTION", mentioned: true, unreadCount: 1, latestAt: new Date(10) }),
  ]);
  expect(merged).toHaveLength(1);
  expect(merged[0]).toMatchObject({ kind: "OWNER", mentioned: true, following: false, unreadCount: 2 });
  expect(merged[0].latestAt).toEqual(new Date(20));
});

it("merges a follow and a mention, keeps both flags and the follow's live href", () => {
  const merged = mergeInboxDiscussions([
    view({ threadId: "t", kind: "FOLLOW", following: true, unreadCount: 2, href: "/s/tok?thread=t", token: "tok", documentId: "doc" }),
    view({ threadId: "t", kind: "MENTION", mentioned: true, unreadCount: 1, latestAt: new Date(30), href: "/other", token: "other" }),
  ]);
  expect(merged).toHaveLength(1);
  expect(merged[0]).toMatchObject({ kind: "MENTION", following: true, mentioned: true, unreadCount: 3, href: "/s/tok?thread=t", token: "tok" });
  expect(merged[0].latestAt).toEqual(new Date(30));
});

it("filters by the relationship flags, status and unread", () => {
  const rows = [
    view({ threadId: "a", kind: "OWNER" }),
    view({ threadId: "b", kind: "FOLLOW", following: true, unreadCount: 1 }),
    view({ threadId: "c", kind: "MENTION", mentioned: true, status: "RESOLVED" }),
  ];
  expect(filterInboxDiscussions(rows, { kind: "follow", status: "all", unread: false }).map(r => r.threadId)).toEqual(["b"]);
  expect(filterInboxDiscussions(rows, { kind: "mention", status: "all", unread: false }).map(r => r.threadId)).toEqual(["c"]);
  expect(filterInboxDiscussions(rows, { kind: "all", status: "resolved", unread: false }).map(r => r.threadId)).toEqual(["c"]);
  expect(filterInboxDiscussions(rows, { kind: "all", status: "all", unread: true }).map(r => r.threadId)).toEqual(["b"]);
});

it("sorts newest first, then thread id descending", () => {
  expect(sortInboxDiscussions([
    view({ threadId: "a", kind: "OWNER", latestAt: new Date(10) }),
    view({ threadId: "c", kind: "OWNER", latestAt: new Date(20) }),
    view({ threadId: "b", kind: "OWNER", latestAt: new Date(20) }),
  ]).map(r => r.threadId)).toEqual(["c", "b", "a"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/inbox-discussion.test.ts`
Expected: FAIL — `Cannot find module .../inbox-discussion`.

- [ ] **Step 3: Implement the module**

Write the types above and the three pure functions. Use a `Map<string, InboxDiscussionView[]>` for grouping. Keep `latest` from the view with the greatest `latestAt`; on a tie prefer the owner, then the mention, then the follow. `filterInboxDiscussions` uses `kind === "owner" ? r.kind === "OWNER" : kind === "follow" ? r.following : kind === "mention" ? r.mentioned : true`, then status and `unreadCount > 0`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/inbox-discussion.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/knowledge/domain/inbox-discussion.ts tests/unit/inbox-discussion.test.ts
git commit -m "feat(inbox): add the discussion view and merge"
```

---

### Task 2: The owner discussion summary query

**Files:**
- Modify: `src/modules/knowledge/ports/share-comment-event-repository.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/share-comment-events.ts`
- Test: `tests/integration/inbox-owner-summary.test.ts`

**Interfaces:**
- Consumes: `QueryConnection` from `./shared`; the migration tables `share_comment_events`, `document_review_threads`, `document_review_comments`, `review_comment_mentions`, `knowledge_documents`, `knowledge_revisions`, `knowledge_sources`, `workspaces`.
- Produces:
  - `InboxOwnerSummary = { threadId: string; documentId: string; sourceId: string; documentTitle: string; quote: string; latestAt: Date; commentCount: number; unreadCount: number; status: "OPEN" | "RESOLVED"; mentioned: boolean }`
  - `InboxOwnerQuery = { recipientUserId: string; status?: "OPEN" | "RESOLVED"; unreadOnly: boolean; mentionedOnly: boolean; threadIds?: readonly string[]; before?: { latestAt: Date; threadId: string }; limit: number }`
  - `ShareCommentEventRepository.listDiscussionSummaries(query: InboxOwnerQuery): Promise<InboxOwnerSummary[]>`

Query requirements:
- One row per `document_review_threads` row whose document lives in the caller's personal Workspace and which has at least one `share_comment_events` row in that Workspace.
- `t.visibility = 'VISIBLE'`; comments counted are `deleted_at IS NULL AND visibility = 'VISIBLE'`; a retracted thread has no visible comments and disappears with the join.
- `latestAt = MAX(c.created_at)`; `commentCount = COUNT(c.id)`; `unreadCount` is a correlated count of `share_comment_events` for the thread with `read_at IS NULL`.
- `documentTitle` is the current revision's title; `sourceId` is the document's source; `quote` is `JSON_UNQUOTE(JSON_EXTRACT(t.anchor_json, '$.exact'))` (empty string when null).
- `mentioned` is `EXISTS` a `review_comment_mentions` row for `recipientUserId` on a visible, non-deleted comment of the thread.
- `status`, `unreadOnly`, `mentionedOnly`, `threadIds` and the `(latestAt, threadId)` descending cursor filter in SQL; `limit` is the page size.
- Order by `latestAt DESC, threadId DESC`; `LIMIT ?`.

- [ ] **Step 1: Write the failing integration test**

Use the fixture pattern from `tests/integration/review-reply-follow.test.ts`. Create an owner, a reader and a third user; a personal Workspace, default source and document; a share link; a thread with a reader comment, an owner reply and a second reader comment. Insert a mention of the owner on one visible comment with `uow.run(r => r.reviewMentions.insertMany(...))` using the thread's `origin_share_link_id`. Then assert:

```ts
const [row] = await f.uow.run(r => r.shareCommentEvents.listDiscussionSummaries({
  recipientUserId: f.ownerUserId, unreadOnly: false, mentionedOnly: false, limit: 50,
}));
expect(row).toMatchObject({
  threadId: f.thread.id, documentId: f.documentId, sourceId: f.sourceId,
  documentTitle: "Review", quote: "secret passage", status: "OPEN",
  commentCount: 3, unreadCount: 2, mentioned: true,
});
expect(row.latestAt).toEqual(f.lastCommentAt); // the time the fixture stamps the second reader comment
```

Then assert: a `limit: 1` query plus a `before` cursor returns the second thread; `unreadOnly: true` excludes a settled thread; `mentionedOnly: true` returns only the mentioned thread; `threadIds: [threadId]` returns one; hiding the thread (`f.service.setVisibility`) removes it; a second Workspace's thread never appears.

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/inbox-owner-summary.test.ts`
Expected: FAIL — the method is not defined.

- [ ] **Step 2: Add the port types and method**

Add the types and `listDiscussionSummaries` to the interface.

- [ ] **Step 3: Implement the MariaDB query**

Write the grouped query in `MariaDbShareCommentEventsRepository`. Use a derived table or `HAVING` for the cursor and the `unreadCount > 0` / `mentionedOnly` filters so filtering happens before `LIMIT`. Bind the recipient id wherever the Workspace/mention filters ask. Keep the `sourceId`/title/quote joins in the same statement.

- [ ] **Step 4: Check the query plan**

Run the integration test's query with `EXPLAIN` against the test database. If MariaDB scans `share_comment_events` for the thread's unread count, add migration `src/infrastructure/database/mariadb/migrations/032-inbox-thread-index.ts` with `ALTER TABLE share_comment_events ADD KEY ix_share_comment_thread (thread_id, read_at, created_at)` and register it in `migrations/index.ts`; otherwise do not add an index.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/inbox-owner-summary.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/knowledge/ports/share-comment-event-repository.ts src/infrastructure/database/mariadb/repositories/share-comment-events.ts tests/integration/inbox-owner-summary.test.ts
git commit -m "feat(inbox): add the owner discussion summary query"
```

---

### Task 3: The service merge, filters and mark-read

**Files:**
- Modify: `src/modules/knowledge/application/document-review-service.ts`
- Modify: `src/modules/knowledge/domain/review-follow.ts`
- Test: `tests/integration/inbox-discussion-index.test.ts`

**Interfaces:**
- Consumes: Task 1's `InboxDiscussionView`, `InboxPage`, `mergeInboxDiscussions`, `filterInboxDiscussions`, `sortInboxDiscussions`; Task 2's `listDiscussionSummaries`; the existing `followedThreads`, `judgedMentions`, `mentionViews`, `sharedViews`, `discussionHrefs`, `ownerScope`.
- Produces:
  - `DocumentReviewService.listInbox(caller: CallerContext, input: { kind: InboxKindFilter; status: InboxStatusFilter; unread: boolean; before?: InboxCursor; threadId?: string }): Promise<InboxPage>`
  - `DocumentReviewService.markDiscussionRead(caller: CallerContext, threadId: string): Promise<void>`
  - `summarizeFollowedThread(...)` gains `commentCount: number` in its success return.
  - `judgedMentions(...)`'s success branch gains the thread's `comments: ReviewComment[]` (it already reads them for the judgement), so the mention row can compute `latest` and `commentCount` without a second query.

Behavior:
- `listInbox` runs in one `uow.run`.
- Owner source: call `listDiscussionSummaries` when `kind` is `all`, `owner` or `mention`; for `mention`, pass `mentionedOnly: true` so the `Mentions` tab includes owner threads that mention the reader. Skip the owner query only for `kind === "follow"`. For a `threadId` lookup, pass `threadIds: [threadId]`.
- Link sources: skip them when `kind === "owner"`. Otherwise, when there is no `before` (first page), read `followedThreads` and the judged mentions; skip `before` pages because they are bounded first-page sets. Build one follow view per live thread and one grouped mention view per thread. Skip `unavailable` follows and dead mentions entirely. Read both sources even on the `Following` or `Mentions` tab: one carries the row and the other carries its flag.
- Owner row line: read the page's visible comments in one `reviewComments.listByThreads` call; `latest` is the newest comment whose author is not the reader, falling back to the first visible comment; `commentCount` from the visible comments; `latestAt` from the summary.
- Follow rows: `latest` is `summary.latest` when its author is not the reader, else `summary.latestReply ?? summary.latest`; `commentCount` from the summary. Mention rows: use the thread's full comment set from `judgedMentions`; `latest` is the newest visible comment whose author is not the reader (falling back to the opening comment), `commentCount` is the visible comments, and `unreadCount` is the unread mention rows in the thread.
- When `threadId` is given (the deep-link lookup), keep only that thread from every source: the owner query gets `threadIds: [threadId]`, and the link sources are filtered to it before the merge.
- Merge with Task 1, filter with Task 1, sort with Task 1.
- `shared`: `sharedViews(r, caller, true)` only when there is no `threadId`, no `before`, `kind === "all"`, `status === "all"` and `unread === false`.
- `nextCursor`: only when owner rows were read and more than `limit` exist; use the last kept owner row's `(latestAt, threadId)` as ISO + id. Follow/mention-only pages have no cursor.
- `markDiscussionRead(caller, threadId)`: return immediately when `threadId` is not a UUID (a malformed id is a no-op, as the existing prefixed mark-read paths are); then load the thread, and if none, return. Try `ownerScope(r, caller, thread.documentId, false)`; if it succeeds, `shareCommentEvents.markThreadRead(caller.id, documentId, threadId, now)`. Always `reviewFollows.markSeen(threadId, caller.id, now)` and `reviewMentions.markThreadRead(caller.id, threadId, now)`. Catch only `ShareLinkNotFoundError` around the owner branch.

- [ ] **Step 1: Write the failing service tests**

Use the integration fixture from `tests/integration/named-share-inbox.test.ts` plus the review fixture. Cover:

```ts
// owner: two reader comments on one thread -> one row
const page = await f.review.listInbox(f.ownerCaller, { kind: "all", status: "all", unread: false });
expect(page.discussions).toEqual([expect.objectContaining({
  threadId: thread.id, kind: "OWNER", documentTitle: "Review", quote: "secret passage",
  commentCount: 2, unreadCount: 2, following: false, mentioned: false,
})]);

// reader follow: the owner's reply -> one FOLLOW row
expect(await f.review.listInbox(f.readerCaller, { kind: "follow", status: "all", unread: false }))
  .toMatchObject({ discussions: [expect.objectContaining({ threadId: thread.id, kind: "FOLLOW", following: true })] });

// mention of a third user -> one MENTION row
expect(await f.review.listInbox(f.mentionedCaller, { kind: "mention", status: "all", unread: false }))
  .toMatchObject({ discussions: [expect.objectContaining({ kind: "MENTION", mentioned: true })] });

// followed + mentioned -> one row, both flags
expect((await f.review.listInbox(f.mentionedCaller, { kind: "all", status: "all", unread: false })).discussions)
  .toEqual([expect.objectContaining({ following: true, mentioned: true })]);

// mark-read marks owner events, follow seen and mentions; unknown is a no-op
await f.review.markDiscussionRead(f.ownerCaller, thread.id);
expect((await f.review.listInbox(f.ownerCaller, { kind: "owner", status: "all", unread: true })).discussions).toEqual([]);
await expect(f.review.markDiscussionRead(f.ownerCaller, uuidv7())).resolves.toBeUndefined();
```

Also cover: status filters; the `threadId` lookup returns one row even when the first page is empty, and returns nothing when the current filters exclude it; a revoked link is absent from `listInbox` but still in `listFollowedDiscussions` with `linkAvailable: false`; a non-default view returns `shared: []`; a shared named link returns an unread `shared` row on the default first page.

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/inbox-discussion-index.test.ts`
Expected: FAIL — `listInbox` is not a function.

- [ ] **Step 2: Extend the follow summary**

Add `commentCount` to `summarizeFollowedThread`'s success return (`standing.length`). Update `tests/unit/review-follow.test.ts` if it asserts the exact object.

- [ ] **Step 3: Implement `listInbox` and `markDiscussionRead`**

Add the methods next to `listActivityForOwner` / `markThreadRead`. Use `EXCERPT_LIMIT` for the row excerpt and `[...exact].slice(0, 120).join("")` for the quote. Build owner hrefs as `/w/${personal.id}/knowledge/${sourceId}/${documentId}?thread=${threadId}`.

- [ ] **Step 4: Run the service tests to verify they pass**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/inbox-discussion-index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/knowledge/application/document-review-service.ts src/modules/knowledge/domain/review-follow.ts tests/integration/inbox-discussion-index.test.ts tests/unit/review-follow.test.ts
git commit -m "feat(inbox): merge discussions and mark a thread read"
```

---

### Task 4: The inbox API route

**Files:**
- Create: `src/app/api/review-notifications/inbox/route.ts`
- Modify: `tests/unit/review-notifications-routes.test.ts`

**Interfaces:**
- Consumes: Task 3's `listInbox` and `markDiscussionRead`; `reviewHttp`, `reviewBody`.
- Produces: `GET /api/review-notifications/inbox` and `POST /api/review-notifications/inbox`.

GET parses:
- `status=all|open|resolved` (default `all`)
- `kind=all|owner|follow|mention` (default `all`)
- `unread=1`
- `beforeLatestAt` + `beforeThreadId` (both or neither; ISO date; id ≤ 128 characters)
- `threadId` (optional; a deep link lookup)

POST body:
- `{ action: "mark-thread-read", threadId }` -> `markDiscussionRead`
- `{ action: "mark-read", eventId }` -> `markEventRead` (shared-with-you rows)
- `{ action: "mark-all-read" }` -> `markAllActivityRead`
- Anything else -> `INVALID_REQUEST`.

- [ ] **Step 1: Write the failing route tests**

Add to `tests/unit/review-notifications-routes.test.ts` (extend the `authed` mock with `listInbox` and `markDiscussionRead`):

```ts
it("GET inbox passes the tab, filters and cursor to the service", async () => {
  const stubs = authed();
  const response = await inboxGet(new Request("http://127.0.0.1:3000/api/review-notifications/inbox?kind=follow&status=open&unread=1&beforeLatestAt=2026-11-04T00:00:00.000Z&beforeThreadId=t1"));
  expect(response.status).toBe(200);
  expect(stubs.listInbox).toHaveBeenCalledWith(expect.objectContaining({ identity: { id: "owner-1" } }), {
    kind: "follow", status: "open", unread: true, before: { latestAt: new Date("2026-11-04T00:00:00.000Z"), threadId: "t1" },
  });
});

it("GET inbox rejects a partial or invalid cursor and a bad tab", async () => {
  authed();
  expect((await inboxGet(new Request("http://127.0.0.1:3000/api/review-notifications/inbox?beforeThreadId=t1"))).status).toBe(400);
  expect((await inboxGet(new Request("http://127.0.0.1:3000/api/review-notifications/inbox?kind=nope"))).status).toBe(400);
});

it("GET inbox looks up one thread for a deep link", async () => {
  const stubs = authed();
  expect((await inboxGet(new Request("http://127.0.0.1:3000/api/review-notifications/inbox?threadId=t1"))).status).toBe(200);
  expect(stubs.listInbox).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ threadId: "t1" }));
});

it("POST inbox marks a thread read, a shared row read, or everything", async () => {
  const stubs = authed();
  const post = (body: unknown) => inboxPost(new Request("http://127.0.0.1:3000/api/review-notifications/inbox", {
    method: "POST", headers: { Origin: "http://127.0.0.1:3000" }, body: JSON.stringify(body),
  }));
  expect((await post({ action: "mark-thread-read", threadId: "t1" })).status).toBe(200);
  expect(stubs.markDiscussionRead).toHaveBeenCalledWith(expect.anything(), "t1");
  expect((await post({ action: "mark-read", eventId: "shared:l1" })).status).toBe(200);
  expect(stubs.markEventRead).toHaveBeenCalledWith(expect.anything(), "shared:l1");
  expect((await post({ action: "mark-all-read" })).status).toBe(200);
  expect(stubs.markAllActivityRead).toHaveBeenCalledTimes(1);
  expect((await post({ action: "mark-thread-read" })).status).toBe(400);
});
```

Run: `npx vitest run --config vitest.config.ts tests/unit/review-notifications-routes.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 2: Implement the route**

Use `reviewHttp` for both handlers; `reviewBody` for POST. Validate the enums and cursor in the route before calling the service. Return `{ ok: true }` for POST.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/review-notifications-routes.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/review-notifications/inbox/route.ts tests/unit/review-notifications-routes.test.ts
git commit -m "feat(inbox): add the inbox read and mark-read API"
```

---

### Task 5: The filter tabs, the row and the shared section

**Files:**
- Create: `src/components/knowledge/inbox-filters.tsx`
- Create: `src/components/knowledge/inbox-discussion-row.tsx`
- Create: `src/components/knowledge/inbox-shared-with-you.tsx`
- Modify: `src/components/knowledge/notification-href.ts`
- Test: `tests/unit/inbox-list-parts.test.tsx`

**Interfaces:**
- `InboxFilters({ kind, status, unread, onKindChange, onStatusChange, onUnreadChange, sticky }: { kind: InboxKindFilter; status: InboxStatusFilter; unread: boolean; onKindChange: (kind: InboxKindFilter) => void; onStatusChange: (status: InboxStatusFilter) => void; onUnreadChange: (unread: boolean) => void; sticky?: boolean })`
- `InboxDiscussionRow({ discussion, selected, split, busy, onSelect, onMarkRead }: { discussion: InboxDiscussionView; selected: boolean; split: boolean; busy: boolean; onSelect: (discussion: InboxDiscussionView) => void; onMarkRead: (discussion: InboxDiscussionView) => void })`
- `InboxSharedWithYou({ workspaceId, shared, busy, onMarkRead }: { workspaceId: string; shared: ShareCommentNotificationView[]; busy: boolean; onMarkRead: (entry: ShareCommentNotificationView) => void })`

Behavior:
- `InboxFilters` renders a `div role="tablist" aria-label="Inbox relationships"` with four `button role="tab"` using `tabClasses(active)` from `@/components/ui/tab`: `All`, `My documents`, `Following`, `Mentions`. Under it a `Select` labeled `Status` (`Any status` / `Open` / `Resolved`) and a `Button` with `aria-pressed` labeled `Unread`.
- `InboxDiscussionRow` renders `<li>` with the unread dot, a `Link` (`data-inbox-entry={threadId}`, `aria-current`), the title, the quote (when present), `Author: excerpt`, and the meta `timestamp · N comments · Open/Resolved · label`, where label is `Mentioned you` > `Following` > `Your document` and `N unread` is added when `unreadCount > 1`. A plain click in split calls `onSelect` and prevents the link; a modified click is left to the browser. An unread row has a `Mark read` button that calls `onMarkRead`. The title is medium weight when unread.
- `InboxSharedWithYou` returns `null` when `shared` is empty. It renders `<section aria-label="Shared with you">` with the heading, the caption "Documents and folders shared with you by name. They also live in Shares.", a `Link` per row to `notificationHref(entry)` with `notificationTitle(entry)` and `notificationLine(entry)`, a `Timestamp`, a `Mark read` button, and a `See all in Shares` link to `/w/${workspaceId}/shares?tab=saved`.
- `notificationLine` for `SHARED_WITH_YOU` becomes `${authorName ?? "Someone"} shared this with you` (no title repetition, no `《》`).

- [ ] **Step 1: Write the failing component tests**

```tsx
const discussionView = (over: Partial<InboxDiscussionView> = {}): InboxDiscussionView => ({
  threadId: "t1", kind: "OWNER", documentId: "doc", sourceId: "src", documentTitle: "Doc",
  quote: "the passage", href: "/w/ws/knowledge/src/doc?thread=t1",
  latest: { authorName: "Ann", excerpt: "reply", createdAt: new Date(20) },
  latestAt: new Date(20), commentCount: 3, unreadCount: 2, status: "OPEN",
  following: false, mentioned: true, ...over,
});
const sharedEntry = (over: Partial<ShareCommentNotificationView> = {}): ShareCommentNotificationView => ({
  id: "shared:l1", workspaceId: "", documentId: "", sourceId: "", documentTitle: "Quarterly plan",
  threadId: "", commentId: "", authorName: "Dana", excerpt: "", createdAt: new Date(0),
  readAt: null, threadStatus: "OPEN", kind: "SHARED_WITH_YOU", linkAvailable: true,
  href: "/w/me/shares/tok", ...over,
});
const change = (element: HTMLSelectElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("change", { bubbles: true }));
};

it("switches the relationship tab, the status and the unread toggle", async () => {
  const onKindChange = vi.fn(), onStatusChange = vi.fn(), onUnreadChange = vi.fn();
  await act(async () => root.render(<InboxFilters kind="all" status="all" unread={false} onKindChange={onKindChange} onStatusChange={onStatusChange} onUnreadChange={onUnreadChange} />));
  await act(async () => { host.querySelector('[role="tab"]:nth-of-type(3)')!.click(); });
  expect(onKindChange).toHaveBeenCalledWith("follow");
  await act(async () => { change(host.querySelector("select") as HTMLSelectElement, "open"); });
  expect(onStatusChange).toHaveBeenCalledWith("open");
  await act(async () => { [...host.querySelectorAll("button")].find(b => b.textContent === "Unread")!.click(); });
  expect(onUnreadChange).toHaveBeenCalledWith(true);
});

it("renders a discussion row and selects it without navigating", async () => {
  const onSelect = vi.fn();
  const discussion = discussionView();
  await act(async () => root.render(<InboxDiscussionRow discussion={discussion} selected={false} split busy={false} onSelect={onSelect} onMarkRead={() => {}} />));
  expect(host.textContent).toContain("the passage");
  expect(host.textContent).toContain("Ann: reply");
  expect(host.textContent).toContain("3 comments");
  expect(host.textContent).toContain("2 unread");
  expect(host.textContent).toContain("Mentioned you");
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  await act(async () => { host.querySelector("a")!.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(onSelect).toHaveBeenCalledWith(discussion);
});

it("renders the shared section and marks a shared row read", async () => {
  const onMarkRead = vi.fn();
  await act(async () => root.render(<InboxSharedWithYou workspaceId="me" shared={[sharedEntry()]} busy={false} onMarkRead={onMarkRead} />));
  expect(host.textContent).toContain("Shared with you");
  expect(host.textContent).toContain("Dana shared this with you");
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/w/me/shares/tok");
  expect(host.querySelector("a[href='/w/me/shares?tab=saved']")).not.toBeNull();
});
```

Run: `npx vitest run --config vitest.config.ts tests/unit/inbox-list-parts.test.tsx`
Expected: FAIL — the components do not exist.

- [ ] **Step 2: Implement the three components**

Use `tabClasses` for the relationship tabs (a tablist without panels is deliberate: the one discussion list below is the panel). Use `Timestamp` for the meta. Use `buttonClasses` for the row's Mark read and the See all link. Do not use `《》` anywhere.

- [ ] **Step 3: Update `notification-href.ts` and its test**

Change the `SHARED_WITH_YOU` line and add the shared cases to `tests/unit/notification-href.test.ts`: a live entry's title, href and `Dana shared this with you`; a dead entry's `A shared document` / `This link is no longer available.`; no `《》` in any line. The old page test's shared cases move here before that file is deleted.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/inbox-list-parts.test.tsx tests/unit/notification-href.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/knowledge/inbox-filters.tsx src/components/knowledge/inbox-discussion-row.tsx src/components/knowledge/inbox-shared-with-you.tsx src/components/knowledge/notification-href.ts tests/unit/inbox-list-parts.test.tsx tests/unit/notification-href.test.ts
git commit -m "feat(inbox): add the discussion row, tabs and shared section"
```

---

### Task 6: The page: data, URL state and the two layouts

**Files:**
- Modify: `src/components/knowledge/inbox-activity-view.tsx`
- Replace: `tests/unit/inbox-split-view.test.tsx` with `tests/unit/inbox-activity-view.test.tsx`
- Delete: `tests/unit/inbox-shared-with-you.test.tsx` (its cases move to the page and Task 5)

**Interfaces:**
- Consumes: Task 5's `InboxFilters`, `InboxDiscussionRow`, `InboxSharedWithYou`; Task 1's types/functions; `useInboxUnread` from `@/components/shell/use-inbox-unread`.
- Produces: the page's client behavior; no exported API.

Behavior:
- Read `item`, `kind`, `status`, `unread` from `window.location.search` once on mount.
- `load(cursor?)` fetches `/api/review-notifications/inbox` with the current tab/filters and the cursor; on the first page replace, on a cursor append and `sortInboxDiscussions`; set `shared` and `next`.
- On a tab/status/unread change: write the URL with `replaceState`, reset the cursor, refetch; after the first page arrives, clear `item` and the selection only if the selected `threadId` is not in the new `discussions`. If the selection came from the deep-link lookup and is not in the list, re-run that lookup with the new filters and clear it when they exclude it.
- On arrival with `?item=` not in the first page: ask `GET ...?threadId=<id>` with the current filters; show it in the pane as `selectedFallback`; if it returns nothing, clear the selection.
- Selecting: write `?item=<threadId>`; if `unreadCount > 0`, POST `{ action: "mark-thread-read", threadId }` once, set the row's `unreadCount` to 0, dispatch `kh:notification-changed`; on failure leave it unread and show the error.
- `Mark all read`: POST `{ action: "mark-all-read" }`; zero every row's unread count; clear `shared`; dispatch; use `useInboxUnread(true)` for the disabled state.
- Shared row mark-read: POST `{ action: "mark-read", eventId }`; remove it from `shared`; dispatch.
- `Load older discussions`: `load(next)`; the button only when `next`.
- Layout: the existing `useSplit` and 75rem/25rem split; the list column's header + sticky filters + shared section + list; the pane `InboxDiscussion` for the selected row; the empty state `Select a discussion` with the ABOUT copy. Narrow: `kh-page`, the header, ABOUT, filters, shared, list; rows navigate.
- The empty states from Global Constraints; no `Inbox · N` anywhere.
- The `ABOUT` copy: "Every discussion on your shared documents, in discussions you follow, and where someone mentioned you. Opening one marks it read; resolving it is a separate action."

- [ ] **Step 1: Write the failing page tests**

Mock `ResizeObserver`, `fetch`, and `next/navigation` as `inbox-split-view.test.tsx` does. The fetch handles:
- `GET /api/review-notifications/inbox` -> the page fixture; `threadId` -> one discussion; cursor -> the next page.
- `POST /api/review-notifications/inbox` -> record the action; `mark-thread-read` / `mark-all-read` / `mark-read`.
- `GET /api/review-notifications/unread-count` -> `{ count }`.
- `GET /api/documents/:id/peek?brief` and `/review-threads` -> the pane fixture.
- `POST /api/documents/:id/review-threads/:threadId/replies` -> a reply.

Cover the page's own behavior with page fixtures (`discussion(threadId, over)` and `shared()` helpers in the test file):

```ts
it("renders one row per discussion and no page count", async () => {
  page = { discussions: [discussion("t1"), discussion("t2")], shared: [], nextCursor: null };
  await mount();
  expect(host.querySelectorAll("[data-inbox-entry]")).toHaveLength(2);
  expect(host.textContent).not.toContain("Inbox ·");
});

it("selects a row, writes ?item= and marks the thread read once", async () => {
  page = { discussions: [discussion("t1", { unreadCount: 2 })], shared: [], nextCursor: null };
  await mount();
  await click(host.querySelector('[data-inbox-entry="t1"]')!);
  expect(new URL(window.location.href).searchParams.get("item")).toBe("t1");
  expect(posts.filter(p => p.action === "mark-thread-read")).toEqual([{ action: "mark-thread-read", threadId: "t1" }]);
});

it("looks up a deep-linked discussion that is not on the loaded page", async () => {
  window.history.replaceState(null, "", "/w/ws/inbox?item=t2");
  page = { discussions: [discussion("t1")], shared: [], nextCursor: null };
  lookup = discussion("t2", { documentTitle: "Doc t2" });
  await mount(); await settle();
  expect(fetches.some(url => url.includes("threadId=t2"))).toBe(true);
  expect(pane()?.textContent).toContain("Doc t2");
});

it("a filter change clears a selection it excludes", async () => {
  page = { discussions: [discussion("t1")], shared: [], nextCursor: null };
  await mount();
  await click(host.querySelector('[data-inbox-entry="t1"]')!);
  following = [discussion("t2", { kind: "FOLLOW", following: true, href: "/s/tok?thread=t2", token: "tok" })];
  await act(async () => { [...host.querySelectorAll('[role="tab"]')].find(t => t.textContent === "Following")!.click(); });
  await settle();
  expect(pane()).toBeNull();
  expect(new URL(window.location.href).searchParams.get("item")).toBeNull();
});

it("shows the shared section only in the default view and marks a shared row read", async () => {
  page = { discussions: [discussion("t1")], shared: [shared()], nextCursor: null };
  await mount();
  expect(host.textContent).toContain("Shared with you");
  await act(async () => { [...host.querySelectorAll("button")].find(b => b.textContent === "Mark read")!.click(); });
  expect(posts).toContainEqual({ action: "mark-read", eventId: "shared:l1" });
});
```

Also cover: the tabs/status/unread values in the URL and the fetch; an older page appends and sorts; the empty states; narrow rows navigate and render no pane; `Mark all read` zeroes every dot and clears the shared section.

Run: `npx vitest run --config vitest.config.ts tests/unit/inbox-activity-view.test.tsx`
Expected: FAIL — the old page calls `/activity`, not `/inbox`.

- [ ] **Step 2: Rewrite `InboxActivityView`**

Keep `useSplit`, `PageHeader`, the Refresh/Mark all read header and the wrapper. Replace the tabs/list with `InboxFilters`, `InboxSharedWithYou`, the row map and the new empty states. Move the old `ABOUT` copy and the selection/pane code to the new view. Use `sortInboxDiscussions` on append.

- [ ] **Step 3: Run the page tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/inbox-activity-view.test.tsx`
Expected: PASS.

- [ ] **Step 4: Delete the superseded test files**

Delete `tests/unit/inbox-split-view.test.tsx` and `tests/unit/inbox-shared-with-you.test.tsx` after their useful cases are in the new page test / Task 5 test.

- [ ] **Step 5: Commit**

```bash
git add src/components/knowledge/inbox-activity-view.tsx tests/unit/inbox-activity-view.test.tsx
git rm tests/unit/inbox-split-view.test.tsx tests/unit/inbox-shared-with-you.test.tsx
git commit -m "feat(inbox): render the discussion index"
```

---

### Task 7: The pane settles the row

**Files:**
- Modify: `src/components/knowledge/inbox-discussion.tsx`
- Modify: `src/components/knowledge/owner-review-panel.tsx`
- Test: `tests/unit/inbox-activity-view.test.tsx` (extend)

**Interfaces:**
- `InboxDiscussion({ entry, onChanged }: { entry: InboxDiscussionView; onChanged?: (threadId: string) => void })`
- `OwnerReviewPanel` gains `onChanged?: () => void`; it is called after every successful reply, resolve/hide, comment edit and comment delete.

Behavior:
- `InboxDiscussion` takes the new view. `kind === "OWNER"` renders `OwnerDocument` with `documentId`/`threadId`; otherwise `FollowedDiscussion` with `token`, `documentId` and `threadId`. The path line is `entry.documentTitle` + the `Open document` link to `entry.href`.
- `OwnerReviewPanel`'s reply/moderate/author callbacks call `onChanged?.()` after their successful request and own `load()`.
- `FollowedDiscussion`'s `share()` calls `onChanged?.(entry.threadId)` after its own reload.
- The page's `onChanged` fetches `GET .../inbox?threadId=<id>` **without filters**, finds the one discussion, replaces the list row (or the fallback), re-sorts, and dispatches `kh:notification-changed`. The selected row stays even if it no longer matches the active filter.

- [ ] **Step 1: Write the failing pane tests**

Extend `tests/unit/inbox-activity-view.test.tsx`:

```ts
it("a reply in the pane updates the row without Refresh", async () => {
  // select the owner row; fill the pane's Reply; submit
  // the page fetches ?threadId=t1 after the reply; the fixture returns commentCount 2 and the new excerpt
  expect(row.textContent).toContain("2 comments");
  expect(row.textContent).toContain("Answered from the Inbox");
  expect(fetches.some(url => url.includes("threadId=t1"))).toBe(true);
});

it("resolving under the Open filter keeps the selected row, marked Resolved", async () => {
  // ?status=open; select the row; click Resolve; the lookup returns RESOLVED
  expect(row.textContent).toContain("Resolved");
  expect(pane()).not.toBeNull();
});
```

Run: `npx vitest run --config vitest.config.ts tests/unit/inbox-activity-view.test.tsx`
Expected: FAIL — the pane's `onChanged` is not called / the row does not update.

- [ ] **Step 2: Adapt the pane and the owner panel**

Update the props, the owner/follow branches and the href. Add `onChanged` to `OwnerReviewPanel` and call it in the inline write handlers. Add `onChanged` to `FollowedDiscussion`'s `share`.

- [ ] **Step 3: Implement the page's `onChanged` lookup**

Add the unfiltered `?threadId=` fetch, replace-or-insert the row, re-sort, dispatch. Keep `selectedFallback` in step.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/inbox-activity-view.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/knowledge/inbox-discussion.tsx src/components/knowledge/owner-review-panel.tsx src/components/knowledge/inbox-activity-view.tsx tests/unit/inbox-activity-view.test.tsx
git commit -m "feat(inbox): settle the row after a pane write"
```

---

### Task 8: E2E, copy and the contract

**Files:**
- Modify: `tests/e2e/global-inbox-activity.spec.ts`
- Modify: `docs/superpowers/specs/frontend-design-language.md`
- Modify: `docs/superpowers/specs/2026-10-29-inbox-split-view-design.md`
- Modify: `docs/superpowers/specs/2026-10-31-single-inbox-entry-design.md`
- Test: `tests/e2e/global-inbox-activity.spec.ts`

- [ ] **Step 1: Rewrite the E2E flow**

The existing spec creates one thread, marks it read, switches to `All activity`, selects it, replies, opens the document and checks the narrow list. The new flow:
- Owner receives a comment; open `/inbox`; the row is present; no `Inbox ·` text; the default tab is `All`.
- Add a second reader comment on the same thread through the API; reload; still **one** row with the latest excerpt.
- Click the row; the pane shows the discussion; reply; the row shows the reply and the new count without Refresh.
- Resolve in the pane; the row says `Resolved`; under the `Open` status filter it stays selected.
- Click `Open document`; the document opens on `?thread=`.
- Switch to `Following` / `Mentions` and assert the empty state; switch back to `All`.
- At 600px the row navigates to the document and no pane exists.

- [ ] **Step 2: Run the E2E test**

Run: `npx playwright test tests/e2e/global-inbox-activity.spec.ts`
Expected: PASS. (If the local DB/build is not provisioned, run `make test-e2e` or note the prerequisite in the PR.)

- [ ] **Step 3: Update the contract docs**

In `frontend-design-language.md`, replace the Inbox paragraph's list/split/selection clauses ("Where its own box is at least 75rem wide the Inbox page is a 22rem list beside the selected entry ... narrower, it is a plain list whose rows open the document.") with: the Inbox is a discussion index from a 75rem box — one row per discussion, newest activity first, relationship tabs (`All` / `My documents` / `Following` / `Mentions`) plus status/unread filters, selection by thread in the URL, no page-level unread count, and a separate unread "Shared with you" section; narrower it is the same index as a plain list. Keep the single rail entry and badge sentence.

In `2026-10-29-inbox-split-view-design.md`, add to the Status line: "The list, tabs, event-id selection and page count are superseded on 2026-11-04 by `2026-11-04-inbox-discussion-index-design.md`; the split layout stays."

In `2026-10-31-single-inbox-entry-design.md`, add to the Non-goals or Status: "The Inbox page's list is superseded on 2026-11-04 by the discussion index; the single rail entry and badge stay."

- [ ] **Step 4: Run the full verification**

Run: `make verify`
Expected: unit + typecheck + lint + build pass.

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/inbox-owner-summary.test.ts tests/integration/inbox-discussion-index.test.ts`
Expected: PASS (requires `make db-up` / the test database).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/global-inbox-activity.spec.ts docs/superpowers/specs/frontend-design-language.md docs/superpowers/specs/2026-10-29-inbox-split-view-design.md docs/superpowers/specs/2026-10-31-single-inbox-entry-design.md
git commit -m "docs(inbox): record the discussion index and verify it end to end"
```

---

## Self-Review Notes

- **Spec coverage:** one row per discussion (Tasks 1, 3, 6); all history (Task 6 default); relationship tabs + status/unread (Tasks 5, 6); no page count (Task 6); shared-with-you section (Tasks 3, 5, 6); selection by thread + one-request mark-read (Tasks 3, 4, 6); pane write settle (Task 7); server-side filters/pagination (Tasks 2, 3, 4); dead links omitted (Tasks 2, 3); deep link lookup (Tasks 3, 4, 6); copy/contract (Task 8).
- **Type consistency:** `InboxKindFilter`/`InboxStatusFilter`/`InboxCursor`/`InboxDiscussionView`/`InboxPage` are defined once in Task 1 and used verbatim; the API route and the page use the same names; `onChanged` takes the `threadId`.
- **Review Focus:** the five lines each have a test in Tasks 1 (merge), 2 (owner summary filters), 3 (dead link / one row), 5 (row/shared), 6 (filter + deep link) and 7 (filter + write).
- **Proportion:** the plan carries signatures, tests and the decisions the spec leaves; the SQL and component bodies remain the builder's.
