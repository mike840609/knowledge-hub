# Shares → Discussions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A third Shares tab, *Discussions*, lists every discussion the signed-in reader follows, marks the ones with new replies, and lets them Unfollow (live link) or Remove (dead link).

**Architecture:** One domain change (`summarizeFollowedThread` returns `latest` and `latestReply`), two new `DocumentReviewService` entries (`listFollowedDiscussions`, `unfollowOwn`) sharing the follow loop the Inbox already uses, one new route, one new view. No migration.

**Tech Stack:** Next.js 15 app router, TypeScript, MariaDB, Vitest (unit + integration), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-23-followed-discussions-tab-design.md`

## Global Constraints

- No new table, no migration. Read `review_thread_follows` through `ReviewFollowRepository` only.
- A dead link's row carries only `threadId` and `linkAvailable: false` — no title, author, excerpt, time or token.
- `unfollowOwn` reads nothing and answers `{ following: false }` whether or not a row existed.
- Excerpt length is the existing `EXCERPT_LIMIT` (80 code points).
- At most `FOLLOW_LIMIT` (100) follows; the cap carries a `ponytail:` comment naming the upgrade (cursor paging).
- Tailwind tokens only (`text-body`, `text-caption`, `rounded-md`, …); no colour outside `globals.css` variables. Read `docs/superpowers/specs/frontend-design-language.md` before Task 4.
- Bare `npm` may be shadowed in non-interactive shells: run tests with `npx vitest …` and never pipe a test command (it hides the exit code).
- Every commit carries the trailer `Claude-Session: https://claude.ai/code/session_01YXG2rxk4WnFUSkLvqzDNma` (the second `-m` in each commit command below).
- E2E runs serially (`playwright.config.ts`: `workers: 1`), but every test shares the `viewer` reader: find a test's own row by thread id, never by position.

---

### Task 1: Domain — summaries for both callers, row type, order, filter

**Files:**
- Modify: `src/modules/knowledge/domain/review-follow.ts`
- Modify: `src/modules/knowledge/domain/share-comment-event.ts` (export `EXCERPT_LIMIT`)
- Modify: `src/modules/knowledge/application/document-review-service.ts` (`followViews` keeps Inbox output)
- Test: `tests/unit/review-follow.test.ts`

**Interfaces:**
- Produces:
  - `summarizeFollowedThread(...) : { latest: ReviewComment; latestReply: ReviewComment | null; unread: number } | { unavailable: true } | null`
  - `type FollowedDiscussionView = { threadId: string; linkAvailable: true; token: string; documentTitle: string; threadStatus: "OPEN" | "RESOLVED"; authorName: string | undefined; excerpt: string; latestAt: Date; unread: number } | { threadId: string; linkAvailable: false }`
  - `orderFollowedDiscussions(items: FollowedDiscussionView[]): FollowedDiscussionView[]`
  - `type DiscussionFilter = "all" | "unread"`; `parseDiscussionFilter(value: string | undefined): DiscussionFilter` (throws `ValidationError`)
  - `filterFollowedDiscussions(items, filter): FollowedDiscussionView[]`
  - `export const EXCERPT_LIMIT = 80` from `share-comment-event.ts`

- [ ] **Step 1: Update and add failing tests** in `tests/unit/review-follow.test.ts`

Delete these two existing `it` blocks: "never counts the follower's own words" and "lists nothing when no one else has said anything". Keep "lists nothing for a hidden or retracted discussion" (its `toBeNull()` still holds). Add the import change and these three blocks inside the existing `describe`:

```ts
import { filterFollowedDiscussions, orderFollowedDiscussions, parseDiscussionFilter, summarizeFollowedThread, type FollowedDiscussionView } from "@/modules/knowledge/domain/review-follow";

  it("never counts the follower's own words, but still names the latest", () => {
    expect(summarize([comment("a", "reader", 0), comment("b", "reader", 5)])).toMatchObject({ unread: 0, latestReply: null, latest: { id: "b" } });
  });
  it("names the latest reply by others apart from the latest comment", () => {
    expect(summarize([comment("a", "reader", 0), comment("b", "owner", 2), comment("c", "reader", 3)])).toMatchObject({ unread: 1, latestReply: { id: "b" }, latest: { id: "c" } });
  });
  it("lists nothing when the discussion holds no standing comment", () => {
    expect(summarize([])).toBeNull();
  });
```

Keep the other existing cases; in "counts replies by others…" assert `latestReply: { id: "c" }` as well as `latest: { id: "c" }`; in "skips hidden and deleted replies" assert `latestReply: { id: "b" }, latest: { id: "b" }`; in "keeps a reply already seen…" assert `latestReply: { id: "b" }`.

Add:

```ts
const live = (threadId: string, unread: number, minute: number): FollowedDiscussionView => ({ threadId, linkAvailable: true, token: "t", documentTitle: "Doc", threadStatus: "OPEN", authorName: "A", excerpt: "x", latestAt: at(minute), unread });
const dead = (threadId: string): FollowedDiscussionView => ({ threadId, linkAvailable: false });

describe("the reader's list of followed discussions", () => {
  it("puts unread first, then the most recent, and dead links last", () => {
    const ordered = orderFollowedDiscussions([dead("d"), live("old", 0, 1), live("unread", 2, 0), live("new", 0, 9)]);
    expect(ordered.map(item => item.threadId)).toEqual(["unread", "new", "old", "d"]);
  });
  it("filters to unread live rows only", () => {
    const items = [dead("d"), live("read", 0, 1), live("unread", 1, 0)];
    expect(filterFollowedDiscussions(items, "unread").map(item => item.threadId)).toEqual(["unread"]);
    expect(filterFollowedDiscussions(items, "all")).toHaveLength(3);
  });
  it("accepts all or unread, defaulting to all, and refuses anything else", () => {
    expect(parseDiscussionFilter(undefined)).toBe("all");
    expect(parseDiscussionFilter("")).toBe("all");
    expect(parseDiscussionFilter("unread")).toBe("unread");
    expect(() => parseDiscussionFilter("resolved")).toThrow("Choose All or Unread.");
  });
});
```

- [ ] **Step 2: Run, expect failures**

Run: `npx vitest run --config vitest.config.ts tests/unit/review-follow.test.ts`
Expected: FAIL (`orderFollowedDiscussions` not exported; `latestReply` missing).

- [ ] **Step 3: Implement** in `src/modules/knowledge/domain/review-follow.ts`

```ts
import { isRetractedThread, type ReviewComment, type ReviewThread } from "./document-review";
import { ValidationError } from "./errors";

/** A shared-page reader following one discussion, through the link they last wrote in it by. */
export type ReviewFollow = { threadId: string; userId: string; shareLinkId: string; following: boolean; seenAt: Date };

/** One row of Shares → Discussions. A dead link's row names nothing (spec 2026-10-23 § The list). */
export type FollowedDiscussionView =
  | { threadId: string; linkAvailable: true; token: string; documentTitle: string; threadStatus: "OPEN" | "RESOLVED"; authorName: string | undefined; excerpt: string; latestAt: Date; unread: number }
  | { threadId: string; linkAvailable: false };
export type DiscussionFilter = "all" | "unread";

/**
 * What a followed discussion holds for its follower: the newest standing comment by anyone, the
 * newest by others, and how many of others' arrived after `seenAt`. A link that no longer opens
 * says only that (spec 2026-10-22 § The follower's Inbox): nothing written, before or after, is passed on.
 */
export function summarizeFollowedThread({ thread, comments, userId, seenAt, linkValid }: {
  thread: ReviewThread; comments: ReviewComment[]; userId: string; seenAt: Date; linkValid: boolean;
}): { latest: ReviewComment; latestReply: ReviewComment | null; unread: number } | { unavailable: true } | null {
  if (!linkValid) return { unavailable: true };
  if (thread.visibility === "HIDDEN" || isRetractedThread(comments)) return null;
  const standing = comments.filter(comment => !comment.deletedAt && comment.visibility === "VISIBLE");
  const latest = standing.at(-1);
  if (!latest) return null;
  const replies = standing.filter(comment => comment.authorUserId !== userId);
  return { latest, latestReply: replies.at(-1) ?? null, unread: replies.filter(comment => comment.createdAt > seenAt).length };
}

/** Unread first, then the newest activity; a dead link has no time to sort by and goes last. */
export function orderFollowedDiscussions(items: FollowedDiscussionView[]): FollowedDiscussionView[] {
  const rank = (item: FollowedDiscussionView) => !item.linkAvailable ? 2 : item.unread > 0 ? 0 : 1;
  const time = (item: FollowedDiscussionView) => item.linkAvailable ? item.latestAt.getTime() : 0;
  return [...items].sort((a, b) => rank(a) - rank(b) || time(b) - time(a) || a.threadId.localeCompare(b.threadId));
}

export function parseDiscussionFilter(value: string | undefined): DiscussionFilter {
  if (!value || value === "all") return "all";
  if (value === "unread") return "unread";
  throw new ValidationError("Choose All or Unread.");
}

export function filterFollowedDiscussions(items: FollowedDiscussionView[], filter: DiscussionFilter): FollowedDiscussionView[] {
  return filter === "all" ? items : items.filter(item => item.linkAvailable && item.unread > 0);
}
```

In `src/modules/knowledge/domain/share-comment-event.ts` change `const EXCERPT_LIMIT = 80;` to `export const EXCERPT_LIMIT = 80;`.

- [ ] **Step 4: Keep the Inbox output unchanged** in `followViews` (`src/modules/knowledge/application/document-review-service.ts:136`). After the `unavailable` branch add `if (!summary.latestReply) continue;` and replace every `summary.latest` in that method with `summary.latestReply`.

- [ ] **Step 5: Run unit tests and typecheck**

Run: `npx vitest run --config vitest.config.ts tests/unit/review-follow.test.ts && npx tsc --noEmit -p .`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/knowledge/domain/review-follow.ts src/modules/knowledge/domain/share-comment-event.ts src/modules/knowledge/application/document-review-service.ts tests/unit/review-follow.test.ts
git commit -m "feat(follow): a followed discussion's summary names its latest comment as well as the latest reply" -m "Claude-Session: https://claude.ai/code/session_01YXG2rxk4WnFUSkLvqzDNma"
```

---

### Task 2: Service — `listFollowedDiscussions` and `unfollowOwn`

**Files:**
- Modify: `src/modules/knowledge/application/document-review-service.ts`
- Test: `tests/integration/review-reply-follow.test.ts` (reuse its `fixture()`)

**Interfaces:**
- Consumes: Task 1's `summarizeFollowedThread`, `FollowedDiscussionView`, `orderFollowedDiscussions`, `EXCERPT_LIMIT`.
- Produces:
  - `DocumentReviewService.listFollowedDiscussions(caller: CallerContext): Promise<{ items: FollowedDiscussionView[] }>`
  - `DocumentReviewService.unfollowOwn(caller: CallerContext, threadId: string): Promise<{ following: false }>`

- [ ] **Step 1: Write failing integration tests** — append to `tests/integration/review-reply-follow.test.ts`:

```ts
describe("Shares → Discussions: every discussion the reader follows", () => {
  const discussions = async (f: Awaited<ReturnType<typeof fixture>>, caller = f.reader) => (await f.service.listFollowedDiscussions(caller)).items;

  it("lists a discussion no one has answered yet, and marks it unread once someone does", async () => {
    const f = await fixture();
    const thread = await f.start();
    expect(await discussions(f)).toEqual([expect.objectContaining({ threadId: thread.id, linkAvailable: true, token: f.token, documentTitle: "Review", threadStatus: "OPEN", authorName: "Reader", excerpt: "Reader asks", unread: 0 })]);
    await f.ownerReply(thread.id);
    expect(await discussions(f)).toEqual([expect.objectContaining({ authorName: "Owner", excerpt: "Owner answers", unread: 1 })]);
    await f.service.markSeenForLink(f.reader, { token: f.token, threadId: thread.id });
    f.time.tick();
    expect(await discussions(f)).toEqual([expect.objectContaining({ unread: 0 })]);
  });

  it("drops a discussion once unfollowed, from the link or from the list", async () => {
    const f = await fixture();
    const thread = await f.start();
    await f.service.followForLink(f.reader, { token: f.token, threadId: thread.id, following: false });
    expect(await discussions(f)).toEqual([]);
    await f.service.followForLink(f.reader, { token: f.token, threadId: thread.id, following: true });
    expect(await f.service.unfollowOwn(f.reader, thread.id)).toEqual({ following: false });
    expect(await discussions(f)).toEqual([]);
  });

  it("a dead link's row names nothing, and Remove needs no live link", async () => {
    const f = await fixture();
    const thread = await f.start();
    await f.ownerReply(thread.id, "PRIVATE ANSWER");
    await f.shares.revoke(f.owner, f.link.id);
    const items = await discussions(f);
    expect(items).toEqual([{ threadId: thread.id, linkAvailable: false }]);
    expect(JSON.stringify(items)).not.toContain("PRIVATE");
    await f.service.unfollowOwn(f.reader, thread.id);
    expect(await discussions(f)).toEqual([]);
  });

  it("Remove touches only the caller's own follow and says the same for anything else", async () => {
    const f = await fixture();
    const thread = await f.start();
    await f.service.followForLink(f.other, { token: f.token, threadId: thread.id, following: true });
    expect(await f.service.unfollowOwn(f.other, thread.id)).toEqual({ following: false });
    expect(await discussions(f)).toHaveLength(1);
    expect(await f.service.unfollowOwn(f.reader, randomUUID())).toEqual({ following: false });
    expect(await f.service.unfollowOwn(f.reader, "not-a-uuid")).toEqual({ following: false });
    expect(await discussions(f)).toHaveLength(1);
  });

  it("the Inbox still lists only discussions someone else answered", async () => {
    const f = await fixture();
    await f.start();
    expect((await f.service.listActivityForOwner(f.reader)).notifications.filter(n => n.kind === "FOLLOW")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `make db-up` (once), then `npx vitest run --config vitest.integration.config.ts tests/integration/review-reply-follow.test.ts`
Expected: FAIL (`listFollowedDiscussions is not a function`).

- [ ] **Step 3: Implement** in `document-review-service.ts`

Imports:

```ts
import { projectShareCommentNotification, EXCERPT_LIMIT, type ShareCommentNotificationView } from "../domain/share-comment-event";
import { orderFollowedDiscussions, summarizeFollowedThread, type FollowedDiscussionView } from "../domain/review-follow";
import { isUuid } from "@/shared/ids/uuidv7";
```

Extract the loop that `followViews` and the new list share (place it right above `followViews`, and rewrite `followViews` to iterate it; its body otherwise stays as Task 1 left it):

```ts
  /**
   * The caller's followed discussions with their link's state, judged now.
   * ponytail: at most FOLLOW_LIMIT follows, a few queries each; cursor paging and one joined query once readers follow more.
   */
  private async followedThreads(r: KnowledgeRepositories, userId: string) {
    const found = [];
    for (const follow of await r.reviewFollows.listFollowing(userId, FOLLOW_LIMIT)) {
      const thread = await r.reviewThreads.findById(follow.threadId);
      if (!thread) continue;
      const link = (await r.shareLinks.listByDocument(thread.documentId)).find(candidate => candidate.id === follow.shareLinkId);
      const linkValid = !!link && await this.linkValid(r, link);
      const summary = summarizeFollowedThread({ thread, comments: await r.reviewComments.listByThread(thread.id), userId, seenAt: follow.seenAt, linkValid });
      if (summary) found.push({ follow, thread, link, summary });
    }
    return found;
  }
```

`followViews` becomes `for (const { follow, thread, link, summary } of await this.followedThreads(r, userId)) { … }` with the same body (dead entry, `latestReply` skip, live entry). Remove the old `ponytail:` line from its doc comment (it moved to `followedThreads`).

Public entries (place after `markSeenForLink`):

```ts
  /** Shares → Discussions: every discussion the caller follows, including ones no one has answered. */
  async listFollowedDiscussions(caller: CallerContext): Promise<{ items: FollowedDiscussionView[] }> {
    return this.uow.run(async r => {
      const items: FollowedDiscussionView[] = [];
      for (const { thread, link, summary } of await this.followedThreads(r, caller.identity.id)) {
        if ("unavailable" in summary) { items.push({ threadId: thread.id, linkAvailable: false }); continue; }
        const revision = await r.revisions.findCurrent(thread.documentId);
        items.push({
          threadId: thread.id, linkAvailable: true, token: link!.token, documentTitle: revision?.title ?? "", threadStatus: thread.status,
          authorName: (await r.users.findById(summary.latest.authorUserId))?.name,
          excerpt: [...summary.latest.body].slice(0, EXCERPT_LIMIT).join(""), latestAt: summary.latest.createdAt, unread: summary.unread,
        });
      }
      return { items: orderFollowedDiscussions(items) };
    });
  }
  /** The caller gives up their own follow. It reads nothing, so it needs no live link and answers alike for any id. */
  async unfollowOwn(caller: CallerContext, threadId: string): Promise<{ following: false }> {
    // thread_id is a MariaDB UUID column: a malformed id would fail the query rather than match nothing.
    if (isUuid(threadId)) await this.uow.run(r => r.reviewFollows.unfollow(threadId, caller.identity.id, this.clock()));
    return { following: false };
  }
```

- [ ] **Step 4: Run integration + the single-exception guard**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/review-reply-follow.test.ts`
Run: `npx vitest run --config vitest.config.ts tests/unit/share-link-single-exception.test.ts tests/unit/review-follow.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/knowledge/application/document-review-service.ts tests/integration/review-reply-follow.test.ts
git commit -m "feat(follow): list every followed discussion; a reader can drop their own follow without a live link" -m "Claude-Session: https://claude.ai/code/session_01YXG2rxk4WnFUSkLvqzDNma"
```

---

### Task 3: Route — `POST /api/review-follows/:threadId/unfollow`

**Files:**
- Create: `src/app/api/review-follows/[threadId]/unfollow/route.ts`
- Test: `tests/unit/review-follows-route.test.ts`

**Interfaces:**
- Consumes: `DocumentReviewService.unfollowOwn` (Task 2).
- Produces: `POST /api/review-follows/:threadId/unfollow` → `200 { following: false }`; `401` without a caller; `403` on a foreign Origin (as `reviewHttp` does).

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ services: vi.fn() }));
vi.mock("@/server/composition", () => ({ applicationServices: mocks.services, reviewReadService: vi.fn() }));
import { POST } from "@/app/api/review-follows/[threadId]/unfollow/route";
import { AuthRequiredError } from "@/modules/identity/domain/identity-session-errors";
afterEach(() => vi.clearAllMocks());
const origin = "http://127.0.0.1:3000";
const call = (headers: Record<string, string> = { Origin: origin }) =>
  POST(new Request(`${origin}/api/review-follows/t1/unfollow`, { method: "POST", headers }), { params: Promise.resolve({ threadId: "t1" }) });

describe("stopping one's own follow", () => {
  it("answers for the trusted caller's own follow", async () => {
    const unfollowOwn = vi.fn().mockResolvedValue({ following: false });
    mocks.services.mockReturnValue({ establishTrustedCaller: async () => ({ caller: { identity: { id: "reader" } } }), reviews: { unfollowOwn } });
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ following: false });
    expect(unfollowOwn).toHaveBeenCalledWith({ identity: { id: "reader" } }, "t1");
  });
  it("refuses without a caller", async () => {
    mocks.services.mockReturnValue({ establishTrustedCaller: async () => { throw new AuthRequiredError(); }, reviews: { unfollowOwn: vi.fn() } });
    expect((await call()).status).toBe(401);
  });
  it("refuses a request from another origin", async () => {
    const unfollowOwn = vi.fn();
    mocks.services.mockReturnValue({ establishTrustedCaller: async () => ({ caller: { identity: { id: "reader" } } }), reviews: { unfollowOwn } });
    expect((await call({ Origin: "https://evil.example" })).status).toBe(403);
    expect(unfollowOwn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect failure** (module not found)

Run: `npx vitest run --config vitest.config.ts tests/unit/review-follows-route.test.ts`

- [ ] **Step 3: Implement**

```ts
// Request-bound private review routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { reviewHttp } from "@/server/review-http";
/** The caller drops their own follow; no token, since it reads nothing (spec 2026-10-23 § Remove). */
export async function POST(request:Request, context:{params:Promise<{threadId:string}>}) {
 return reviewHttp(request,async (service,caller)=>{const {threadId}=await context.params; return service.unfollowOwn(caller,threadId);});
}
```

- [ ] **Step 4: Run, expect PASS**

Add `"review-follows/[threadId]/unfollow"` to the `routes` array in `tests/unit/review-http.test.ts` ("keeps every private review route force-dynamic…", line 103).

Run: `npx vitest run --config vitest.config.ts tests/unit/review-follows-route.test.ts tests/unit/review-http.test.ts tests/unit/share-link-single-exception.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/app/api/review-follows tests/unit/review-follows-route.test.ts tests/unit/review-http.test.ts
git commit -m "feat(follow): POST /api/review-follows/:threadId/unfollow drops the caller's own follow" -m "Claude-Session: https://claude.ai/code/session_01YXG2rxk4WnFUSkLvqzDNma"
```

---

### Task 4: UI — the Discussions tab

**Files:**
- Modify: `src/components/knowledge/shares-navigation.tsx`
- Create: `src/components/knowledge/followed-discussions-view.tsx`
- Modify: `src/components/knowledge/share-management-view.tsx:30,98` (pass the count)
- Modify: `src/components/knowledge/saved-shares-view.tsx:16,36` (pass the count)
- Modify: `src/app/w/[workspaceId]/shares/page.tsx`
- Test: `tests/unit/followed-discussions-view.test.tsx`

**Interfaces:**
- Consumes: `FollowedDiscussionView`, `DiscussionFilter`, `parseDiscussionFilter`, `filterFollowedDiscussions` (Task 1); `listFollowedDiscussions` (Task 2); the route (Task 3); existing `POST /api/share-review/threads/:threadId/follow { token, following:false }`.
- Produces: `SharesNavigation({ workspaceId, active: "mine" | "saved" | "discussions", discussionsUnread?: number })`; `FollowedDiscussionsView({ workspaceId, items, filter, unread, filterError? })`.

- [ ] **Step 1: Write the failing view test** `tests/unit/followed-discussions-view.test.tsx`

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FollowedDiscussionsView } from "@/components/knowledge/followed-discussions-view";
import type { FollowedDiscussionView } from "@/modules/knowledge/domain/review-follow";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root;
beforeEach(()=>{host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const live:FollowedDiscussionView={threadId:"t1",linkAvailable:true,token:"tok",documentTitle:"A useful guide",threadStatus:"OPEN",authorName:"Owner",excerpt:"Owner answers",latestAt:new Date(),unread:2};
const dead:FollowedDiscussionView={threadId:"t2",linkAvailable:false};
const mount=async(items=[live,dead],filter:"all"|"unread"="all")=>{await act(async()=>root.render(<FollowedDiscussionsView workspaceId="reader" items={items} filter={filter} unread={items.filter(i=>i.linkAvailable&&i.unread>0).length}/>));};

it("is the active Shares tab and counts unread discussions on its label",async()=>{
 await mount();
 const tab=host.querySelector('a[aria-current="page"]')!;
 expect(tab.textContent).toContain("Discussions");
 expect(tab.querySelector('[aria-label="1 unread"]')?.textContent).toBe("1");
});
it("links a live row to the discussion on the shared page and shows what is new",async()=>{
 await mount();
 const row=host.querySelector('a[href="/s/tok?thread=t1"]');expect(row?.textContent).toContain("A useful guide");
 expect(host.textContent).toContain("Owner answers");expect(host.textContent).toContain("2 new replies");expect(host.textContent).toContain("Open");
});
it("a dead link's row names nothing and offers Remove",async()=>{
 await mount([dead]);
 expect(host.querySelector('li[data-thread-id="t2"]')).not.toBeNull();
 expect(host.textContent).toContain("A shared discussion — this link is no longer available");
 expect(host.querySelector('a[href^="/s/"]')).toBeNull();
 expect(host.querySelector('button[aria-label="Remove discussion"]')).not.toBeNull();
});
it("Unfollow uses the link; Remove uses the caller's own follow; a failure keeps the row",async()=>{
 const calls:string[]=[];let fail=true;
 vi.stubGlobal("fetch",async(url:string,init:RequestInit)=>{calls.push(`${url} ${init.body??""}`);if(fail)return new Response(null,{status:500});return Response.json({following:false});});
 await mount();
 await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Unfollow: A useful guide"]')!.click());
 expect(host.textContent).toContain("Could not update this discussion. Try again.");expect(host.textContent).toContain("A useful guide");
 fail=false;
 await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Unfollow: A useful guide"]')!.click());
 expect(host.textContent).not.toContain("A useful guide");
 await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Remove discussion"]')!.click());
 expect(calls).toContain(`/api/share-review/threads/t1/follow ${JSON.stringify({token:"tok",following:false})}`);
 expect(calls).toContain("/api/review-follows/t2/unfollow ");
 expect(host.textContent).toContain("Discussions you comment on through a shared link appear here.");
});
it("the filter submits tab=discussions with the chosen status",async()=>{
 await mount([live],"unread");
 expect(host.querySelector('input[name="tab"]')?.getAttribute("value")).toBe("discussions");
 expect(host.querySelector('#discussions-status')?.getAttribute("data-value")).toBe("unread");
});
it("a filter error is shown in place of the list and its empty state",async()=>{
 await act(async()=>root.render(<FollowedDiscussionsView workspaceId="reader" items={[]} filter="all" unread={3} filterError="Choose All or Unread."/>));
 expect(host.querySelector('[role="alert"]')?.textContent).toBe("Choose All or Unread.");
 expect(host.textContent).not.toContain("No discussions yet.");
 expect(host.querySelector('[aria-label="3 unread"]')).not.toBeNull();
});
```

- [ ] **Step 2: Run, expect failure** (module not found)

Run: `npx vitest run --config vitest.config.ts tests/unit/followed-discussions-view.test.tsx`

`SelectMenu` puts `id` and `data-value` on its trigger (`src/components/ui/select-menu.tsx`), so this assertion is exact.

- [ ] **Step 3: Navigation** — `src/components/knowledge/shares-navigation.tsx`

```tsx
import Link from "next/link";
import { tabClasses, tabListClasses } from "@/components/ui/tab";

export function SharesNavigation({ workspaceId, active, discussionsUnread = 0 }: { workspaceId: string; active: "mine" | "saved" | "discussions"; discussionsUnread?: number }) {
  const sections = [
    { id: "mine", label: "My shares", href: `/w/${workspaceId}/shares` },
    { id: "saved", label: "Saved shares", href: `/w/${workspaceId}/shares?tab=saved` },
    { id: "discussions", label: "Discussions", href: `/w/${workspaceId}/shares?tab=discussions` },
  ] as const;

  return (
    <nav aria-label="Shares sections" className={`mt-4 ${tabListClasses}`}>
      {sections.map(section => (
        <Link key={section.id} href={section.href} aria-current={active === section.id ? "page" : undefined} className={tabClasses(active === section.id)}>
          {section.label}
          {section.id === "discussions" && discussionsUnread > 0 && <span aria-label={`${discussionsUnread} unread`} className="ml-1 tabular-nums text-caption text-kh-text-muted">{discussionsUnread}</span>}
        </Link>
      ))}
    </nav>
  );
}
```

Add `discussionsUnread?: number` to the props of `ShareManagementView` (`share-management-view.tsx:30`) and `SavedSharesView` (`saved-shares-view.tsx:16`) and pass it on: `<SharesNavigation workspaceId={workspaceId} active="mine" discussionsUnread={discussionsUnread} />` (and `active="saved"`).

- [ ] **Step 4: The view** — `src/components/knowledge/followed-discussions-view.tsx`, following `SavedSharesView`'s structure:

```tsx
"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { Timestamp } from "@/components/ui/timestamp";
import { EmptyState } from "@/components/ui/empty-state";
import { SharesNavigation } from "./shares-navigation";
import { navigateListRows } from "@/lib/list-row-navigation";
import type { DiscussionFilter, FollowedDiscussionView } from "@/modules/knowledge/domain/review-follow";

export function FollowedDiscussionsView({ workspaceId, items, filter, unread, filterError }: { workspaceId: string; items: FollowedDiscussionView[]; filter: DiscussionFilter; unread: number; filterError?: string }) {
  const router = useRouter(), pending = useRef(false);
  const [status, setStatus] = useState<string>(filter);
  useEffect(() => setStatus(filter), [filter]);
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState(""), [removed, setRemoved] = useState(new Set<string>());
  // Optimistic removals belong to this server snapshot; a refresh may bring back a re-followed discussion.
  useEffect(() => setRemoved(new Set()), [items]);
  const shown = items.filter(item => !removed.has(item.threadId));
  async function drop(item: FollowedDiscussionView) {
    if (pending.current) return;
    pending.current = true; setBusy(item.threadId); setError("");
    try {
      const response = item.linkAvailable
        ? await fetch(`/api/share-review/threads/${item.threadId}/follow`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: item.token, following: false }) })
        : await fetch(`/api/review-follows/${item.threadId}/unfollow`, { method: "POST" });
      if (!response.ok) throw new Error();
      setRemoved(current => new Set([...current, item.threadId])); router.refresh();
    } catch { setError("Could not update this discussion. Try again."); }
    finally { pending.current = false; setBusy(null); }
  }
  return <main className="kh-page pb-6">
    <PageHeader location="My Space" locationHref={`/w/${workspaceId}/home`} title="Shares" description="Discussions you follow on shared articles. Following never extends a link's access."/>
    <SharesNavigation workspaceId={workspaceId} active="discussions" discussionsUnread={unread}/>
    <form action={`/w/${workspaceId}/shares`} method="get" aria-label="Filter discussions" className="mt-4 flex flex-wrap items-center gap-2">
      <Input type="hidden" name="tab" value="discussions"/>
      <label className="sr-only" htmlFor="discussions-status">Discussion status</label>
      <SelectMenu id="discussions-status" name="status" value={status} onValueChange={setStatus} options={[{ value: "all", label: "All" }, { value: "unread", label: "Unread" }]}/>
      <Button type="submit" variant="secondary">Filter</Button>
    </form>
    {(error || filterError) && <p role="alert" className="mt-3 text-body-sm text-kh-danger">{filterError || error}</p>}
    {!filterError && shown.length === 0 && <EmptyState icon={MessagesSquare} title={filter === "unread" ? "No unread discussions." : "No discussions yet."} description="Discussions you comment on through a shared link appear here."/>}
    <ul aria-label="Followed discussions" onKeyDown={navigateListRows} className="mt-4 space-y-2 md:space-y-0">{shown.map(item => <li key={item.threadId} data-thread-id={item.threadId} className="rounded-md border border-kh-border bg-kh-bg p-3 hover:bg-kh-bg-hover focus-within:bg-kh-bg-hover md:rounded-none md:border-x-0 md:border-t-0 md:py-2">
      {item.linkAvailable
        ? <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <Link prefetch={false} data-list-row className="kh-focus-ring min-w-0 rounded-md" href={`/s/${item.token}?thread=${item.threadId}`}>
              <span className="flex items-center gap-2">{item.unread > 0 && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-kh-primary"/>}<span className="truncate text-body font-medium text-kh-text">{item.documentTitle}</span></span>
              <span className="block truncate text-caption text-kh-text-muted">{item.authorName ?? "Someone"}: {item.excerpt}</span>
              <span className="block text-caption text-kh-text-muted">{item.threadStatus === "OPEN" ? "Open" : "Resolved"} · <Timestamp value={item.latestAt}/>{item.unread > 0 && <> · {item.unread} new {item.unread === 1 ? "reply" : "replies"}</>}</span>
            </Link>
            <Button variant="ghost" size="sm" aria-label={`Unfollow: ${item.documentTitle}`} disabled={busy !== null} onClick={() => void drop(item)}>Unfollow</Button>
          </div>
        : <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <span className="text-body text-kh-text-muted">A shared discussion — this link is no longer available</span>
            <Button variant="ghost" size="sm" aria-label="Remove discussion" disabled={busy !== null} onClick={() => void drop(item)}>Remove</Button>
          </div>}
    </li>)}</ul>
  </main>;
}
```

The unread dot copies the Inbox's (`src/components/shell/inbox-popover.tsx:126`); the "N new replies" text carries the meaning, so the dot is `aria-hidden`. `data-thread-id` is the id the row already holds for Remove; it names no content.

- [ ] **Step 5: Page wiring** — `src/app/w/[workspaceId]/shares/page.tsx`

Add imports:

```ts
import { FollowedDiscussionsView } from "@/components/knowledge/followed-discussions-view";
import { filterFollowedDiscussions, parseDiscussionFilter } from "@/modules/knowledge/domain/review-follow";
```

Before the `try`, declare `let discussionsUnread = 0;`. As the first statements inside the existing `try`, load the follows and assign the count. This keeps a filter error showing the count and leaves errors from the load inside the page's existing `catch` (so a followed document whose Workspace is gone still reaches `notFound()`, as the other tabs do):

```ts
  let discussionsUnread = 0;
  try {
    // ponytail: the tab's unread count reloads every follow per Shares visit, as the Inbox badge does; a count query if it shows.
    const followed=(await s.reviews.listFollowedDiscussions(caller)).items;
    discussionsUnread=followed.filter(item=>item.linkAvailable&&item.unread>0).length;
```

The existing tab guards and branches stay inside this `try`; the `catch` can read `discussionsUnread`.

Change the tab guard to `if(tab!=="mine"&&tab!=="saved"&&tab!=="discussions")` and its message to `"Choose My shares, Saved shares or Discussions."`. Add before the `saved` branch:

```ts
    if(tab==="discussions") {
      // Prove ownership of this personal Workspace, as the other tabs do.
      await s.shares.listManagement(caller,workspaceId,{});
      const filter=parseDiscussionFilter(input.status);
      return <FollowedDiscussionsView workspaceId={workspaceId} items={filterFollowedDiscussions(followed,filter)} filter={filter} unread={discussionsUnread}/>;
    }
```

Pass `discussionsUnread={discussionsUnread}` to the `SavedSharesView` and `ShareManagementView` in the success branches. In the `catch` `ValidationError` branch add `tab==="discussions"?<FollowedDiscussionsView workspaceId={workspaceId} items={[]} filter="all" unread={discussionsUnread} filterError={error.message}/>:` ahead of the existing ternary, and pass `discussionsUnread={discussionsUnread}` to the `SavedSharesView` and `ShareManagementView` there too.

The `followed` load runs before the ownership proof. That is safe: it reads only the caller's own follows and renders nothing until a branch proves the Workspace; a foreign Workspace still reaches `notFound()`.

- [ ] **Step 6: Run unit tests, typecheck, lint**

Run: `npx vitest run --config vitest.config.ts tests/unit/followed-discussions-view.test.tsx tests/unit/saved-shares-view.test.tsx tests/unit/share-management-view.test.tsx`
Run: `make verify`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/knowledge/shares-navigation.tsx src/components/knowledge/followed-discussions-view.tsx src/components/knowledge/share-management-view.tsx src/components/knowledge/saved-shares-view.tsx "src/app/w/[workspaceId]/shares/page.tsx" tests/unit/followed-discussions-view.test.tsx
git commit -m "feat(shares): a Discussions tab lists the discussions you follow and marks new replies" -m "Claude-Session: https://claude.ai/code/session_01YXG2rxk4WnFUSkLvqzDNma"
```

---

### Task 5: Contracts, guide, end-to-end

**Files:**
- Modify: `CLAUDE.md:101-106` (share-link invariant)
- Modify: `src/components/help/user-guide-content.ts:86,174`
- Modify: `README.md` (canonical documents table, next to the Saved shares row at line 293)
- Create: `tests/e2e/zz-followed-discussions.spec.ts`

- [ ] **Step 1: CLAUDE.md** — after "…grants anything the link does not (`docs/superpowers/specs/2026-10-22-review-reply-follow-design.md`)." insert:

```text
  Shares → Discussions lists those follows to the same trusted caller, under
  the same per-request link judgement, and a reader may stop their own follow
  without a live link (`POST /api/review-follows/:threadId/unfollow`): it reads
  nothing and answers alike for any id
  (`docs/superpowers/specs/2026-10-23-followed-discussions-tab-design.md`).
```

- [ ] **Step 2: Guide** — line 86 (zh-TW): `"在文章的 Share link 管理期限與撤銷；到 Shares 查看 My shares、Saved shares，或在 Discussions 追蹤你參與的討論。",`; line 174 (en): `"Manage expiry and revocation in Share link. Open Shares for My shares, Saved shares, or Discussions to follow the discussions you take part in.",`
Run: `npx vitest run --config vitest.config.ts tests/unit/saved-shares-view.test.tsx` (its guide assertions must still pass).

- [ ] **Step 3: README** — add a row after Saved shares:

```markdown
| Followed discussions | [Spec](docs/superpowers/specs/2026-10-23-followed-discussions-tab-design.md) | [Plan](docs/superpowers/plans/2026-10-23-followed-discussions-tab.md) | Shares → Discussions lists the discussions a reader follows; a reader drops their own follow without a live link. |
```

- [ ] **Step 4: E2E** — `tests/e2e/zz-followed-discussions.spec.ts`, built from `zz-review-reply-follow.spec.ts`'s setup:

```ts
import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument } from "./fixtures/document-review";

// Spec 2026-10-23: Shares → Discussions lists what the reader follows and marks new replies.
test("a reader finds their discussion in Shares → Discussions, sees the reply, and lets it go", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const owner = phase3Origin("reviewOwner"), viewer = phase3Origin("viewer");
  const token = doc.links[0].path.split("/").pop()!;
  const query = await (await request.post(`${viewer}/api/share-review/threads/query`, { headers: { Origin: viewer }, data: { token } })).json();
  const created = await request.post(`${viewer}/api/share-review/threads`, { headers: { Origin: viewer }, data: { token, expectedRevisionId: query.revisionId, anchor: { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 2, endUtf16: 9, exact: "😀 bold", prefix: "A ", suffix: " passage to review." }, body: "Reader question", idempotencyKey: crypto.randomUUID() } });
  expect(created.status()).toBe(201);
  const thread = await created.json();

  await page.goto(`${viewer}/`);
  await expect(page).toHaveURL(/\/w\/[^/]+\//);
  const workspaceId = new URL(page.url()).pathname.split("/")[2];
  const row = () => page.getByRole("list", { name: "Followed discussions" }).locator("li").filter({ has: page.locator(`a[href="/s/${token}?thread=${thread.id}"]`) });
  await page.goto(`${viewer}/w/${workspaceId}/shares?tab=discussions`);
  await expect(row()).toContainText("Reader question");
  await expect(row()).not.toContainText("new repl");

  await request.post(`${owner}/api/documents/${doc.documentId}/review-threads/${thread.id}/replies`, { headers: { Origin: owner }, data: { body: "Owner answer", idempotencyKey: crypto.randomUUID() } });
  await page.reload();
  await expect(row()).toContainText("1 new reply");
  await expect(page.getByRole("link", { name: /Discussions/ }).getByLabel(/\d+ unread/)).toBeVisible();

  // Arriving marks the discussion seen by a request the page sends on its own: wait for it before leaving.
  const seen = page.waitForResponse(response => response.url().includes(`/api/share-review/threads/${thread.id}/seen`) && response.ok());
  await row().locator("a").click();
  await expect(page.locator(`[data-review-thread="${thread.id}"]`)).toHaveAttribute("data-active", "");
  await seen;
  await page.goto(`${viewer}/w/${workspaceId}/shares?tab=discussions`);
  await expect(row()).not.toContainText("new repl");

  await row().getByRole("button", { name: /^Unfollow:/ }).click();
  await expect(row()).toHaveCount(0);
});

test("a revoked link leaves a row that names nothing, and Remove clears it", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const owner = phase3Origin("reviewOwner"), viewer = phase3Origin("viewer");
  const token = doc.links[0].path.split("/").pop()!;
  const created = await request.post(`${viewer}/api/share-review/threads`, { headers: { Origin: viewer }, data: { token, expectedRevisionId: doc.revisionId, anchor: { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 2, endUtf16: 9, exact: "😀 bold", prefix: "A ", suffix: " passage to review." }, body: "Soon gone", idempotencyKey: crypto.randomUUID() } });
  expect(created.status()).toBe(201);
  const thread = await created.json();
  const revoked = await request.post(`${owner}/api/share-links/${doc.links[0].id}/revoke`, { headers: { Origin: owner } });
  expect(revoked.ok()).toBe(true);

  await page.goto(`${viewer}/`);
  await expect(page).toHaveURL(/\/w\/[^/]+\//);
  const workspaceId = new URL(page.url()).pathname.split("/")[2];
  await page.goto(`${viewer}/w/${workspaceId}/shares?tab=discussions`);
  const row = page.locator(`li[data-thread-id="${thread.id}"]`);
  await expect(row).toHaveText(/A shared discussion — this link is no longer available/);
  await expect(row.locator("a")).toHaveCount(0);
  await expect(page.getByText("Soon gone")).toHaveCount(0);
  await row.getByRole("button", { name: "Remove discussion" }).click();
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(page.locator(`li[data-thread-id="${thread.id}"]`)).toHaveCount(0);
});
```

- [ ] **Step 5: Run e2e**

Run: `make browsers` (once), then `make db-up && npm run test:e2e -- --grep "Shares → Discussions|revoked link leaves"` (`scripts/test/e2e.ts` passes its arguments to Playwright), then `make test-e2e` once for the whole suite.
Expected: PASS, including `zz-review-reply-follow.spec.ts`. If docs stall on "Loading document" with `PROBE-NEXT` lines, move `.next/cache` aside and rerun.

- [ ] **Step 6: Final gate and commit**

Run: `make verify` and `make test-integration`.

```bash
git add CLAUDE.md README.md src/components/help/user-guide-content.ts tests/e2e/zz-followed-discussions.spec.ts
git commit -m "docs+test(shares): Discussions in the share-link contract, guide and e2e" -m "Claude-Session: https://claude.ai/code/session_01YXG2rxk4WnFUSkLvqzDNma"
```
