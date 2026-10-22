# Review Reply Follow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shared-page reader who comments follows that discussion and hears about replies in the Hub Inbox; the owner's notices are read per discussion.

**Architecture:** One table `review_thread_follows` with a `seen_at` cursor. Unread replies are derived at read time from the review tables plus a live-link check. The Inbox's existing view type gains a `FOLLOW` kind, so routes, popover, page and Home keep one list. Owner per-thread read reuses `share_comment_events` with a new `markThreadRead`.

**Tech Stack:** Next.js 15, TypeScript, MariaDB (`mariadb` driver), Vitest (unit + integration), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-22-review-reply-follow-design.md`

## Global Constraints

- Every new service entry takes a non-optional `CallerContext` (`tests/unit/share-link-single-exception.test.ts` checks it structurally).
- Modules import no `next`/`react`/`mariadb`/`infrastructure` (`make lint`).
- Follow writes are not gated by `KM_REVIEW_WRITES_ENABLED`; comment writes still are.
- A dead link's follow entry carries no title, excerpt, author or href.
- Tailwind tokens only (`text-body-sm`, `text-caption`, …); colours from CSS variables.
- Deviation recorded in the spec: follow entries are not cursor-paged. They ride the first Activity page, capped at 100 threads.

---

### Task 1: Schema, port and adapter

**Files:**
- Create: `src/infrastructure/database/mariadb/migrations/024-review-thread-follows.ts`
- Modify: `src/infrastructure/database/mariadb/migrations/index.ts`
- Create: `src/modules/knowledge/ports/review-follow-repository.ts`
- Modify: `src/modules/knowledge/ports/unit-of-work.ts` (add `reviewFollows`)
- Create: `src/infrastructure/database/mariadb/repositories/review-follows.ts`
- Modify: `src/infrastructure/database/mariadb/repositories/index.ts`
- Modify: `src/modules/knowledge/ports/share-comment-event-repository.ts` + adapter (add `markThreadRead`)

**Interfaces (Produces):**
```ts
export type ReviewFollow = { threadId: string; userId: string; shareLinkId: string; following: boolean; seenAt: Date };
export interface ReviewFollowRepository {
  follow(input: { threadId: string; userId: string; shareLinkId: string; at: Date }): Promise<void>; // upsert following=true, seen_at=at
  unfollow(threadId: string, userId: string, at: Date): Promise<void>;
  markSeen(threadId: string, userId: string, at: Date): Promise<void>;           // no-op without a row
  markAllSeen(userId: string, at: Date): Promise<void>;
  listFollowing(userId: string, limit: number): Promise<ReviewFollow[]>;          // following=true, newest updated first
  followingThreadIds(userId: string, threadIds: readonly string[]): Promise<Set<string>>;
}
// ShareCommentEventRepository
markThreadRead(recipientUserId: string, documentId: string, threadId: string, at: Date): Promise<void>;
```

- [ ] Write the migration (PK `(thread_id,user_id)`, FKs, `KEY (user_id,following,updated_at)`), register it.
- [ ] Port + adapter + UoW wiring.
- [ ] `make typecheck`; `make db-migrate`; commit.

### Task 2: Unread derivation (pure domain)

**Files:**
- Create: `src/modules/knowledge/domain/review-follow.ts`
- Test: `tests/unit/review-follow.test.ts`

**Interfaces (Produces):**
```ts
export function summarizeFollowedThread(input: {
  thread: ReviewThread; comments: ReviewComment[]; userId: string; seenAt: Date; linkValid: boolean;
}): { latest: ReviewComment; unread: number } | { unavailable: true } | null;
```
`null` when nothing by someone else is visible (or thread hidden/retracted); `{unavailable:true}` when `linkValid` is false.

Test cases: own comments excluded; hidden excluded; deleted excluded; pre-`seenAt` counted as read (`unread: 0`, still `latest`); hidden thread → null; retracted → null; dead link → unavailable regardless of comments; `unread` counts only after `seenAt`.

- [ ] Write failing tests → run → implement → pass → commit.

### Task 3: Service

**Files:**
- Modify: `src/modules/knowledge/application/document-review-service.ts`
- Modify: `src/modules/knowledge/domain/share-comment-event.ts` (view gains `kind`, `token`, `replyCount`, `linkAvailable`)
- Modify: `src/modules/knowledge/domain/document-review.ts` (`ReviewThreadView.following?: boolean`)
- Test: `tests/integration/review-reply-follow.test.ts`

**Interfaces (Produces):**
```ts
followForLink(caller: CallerContext, input: { token: string; threadId: string; following: boolean }): Promise<{ following: boolean }>;
markSeenForLink(caller: CallerContext, input: { token: string; threadId: string }): Promise<void>;
markThreadRead(caller: CallerContext, documentId: string, threadId: string): Promise<void>;
// listUnreadForOwner / listActivityForOwner (no cursor) now include FOLLOW views;
// markEventRead accepts "follow:<threadId>"; markAllActivityRead also marks follows seen.
```
`ShareCommentNotificationView` additions: `kind: "OWNER" | "FOLLOW"`, `token?: string`, `replyCount?: number`, `linkAvailable?: boolean`. FOLLOW id is `follow:<threadId>`.

Integration cases (spec § Testing): link comment → follow row; owner reply → reader unread 1; second reply → one entry, `replyCount: 2`; `markSeenForLink` → 0; unfollow → next reply → 0; reader replies again → following again; revoke → entry `linkAvailable:false`, no excerpt, not unread; owner never followed; another user's `markSeenForLink` / `markEventRead("follow:…")` changes nothing; `queryForLink` reports `following`; owner: `markThreadRead` clears that thread only; non-owner `markThreadRead` refused.

- [ ] Write failing integration tests → implement → `make test-integration` passes → commit.

### Task 4: Routes

**Files:**
- Create: `src/app/api/share-review/threads/[threadId]/follow/route.ts` (`{token, following}`)
- Create: `src/app/api/share-review/threads/[threadId]/seen/route.ts` (`{token}`)
- Modify: `src/app/api/review-notifications/mark-read/route.ts` (optional `threadId`)
- Modify: `src/app/api/review-notifications/activity/route.ts` (accept `follow:` ids — length check unchanged)

- [ ] Implement via `reviewHttp`; `make typecheck lint`; commit.

### Task 5: UI

**Files:**
- Create: `src/components/knowledge/notification-href.ts` (`notificationHref(view): string | null`, `notificationLine(view): string`)
- Modify: `src/components/shell/inbox-popover.tsx`, `src/components/knowledge/inbox-activity-view.tsx`, `src/components/knowledge/home-attention.tsx`
- Modify: `src/components/knowledge/review-thread-list.tsx` (`follow?` prop → Follow/Unfollow on open card; `unreadThreadIds?` → dot)
- Modify: `src/components/knowledge/shared-review-panel.tsx` (`?thread=` arrival; seen on activate; follow toggle)
- Modify: `src/components/knowledge/share-comment-notifications.ts` + `owner-review-panel.tsx` (no mark on open; per-thread on activate/reply; Mark all read)
- Test: `tests/unit/notification-href.test.ts`

Unit cases: OWNER → workspace href; FOLLOW live → `/s/:token?thread=`; FOLLOW dead → null and line "This link is no longer available"; `replyCount > 1` → "N new replies".

- [ ] Tests → implement → `make verify` → commit.

### Task 6: E2E and documents

**Files:**
- Create: `tests/e2e/zz-review-reply-follow.spec.ts`
- Modify: `CLAUDE.md` (share-link invariant: fourth path)
- Modify: `docs/superpowers/specs/2026-10-13-share-comment-notify-design.md` (amendment note)
- Modify: spec (pagination deviation)

- [ ] Reader comments on `/s/:token` → owner replies → reader Inbox entry → lands on `/s/:token?thread=` with card active → badge clears.
- [ ] `make test-e2e` (or the single spec) passes; commit.
