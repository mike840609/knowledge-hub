# Shares → Discussions: every discussion the reader follows, in one list

## Intent and agreed product direction

A signed-in reader who comments through `/s/:token` follows that discussion
(`2026-10-22-review-reply-follow-design.md`). Today the only place a follow
shows up is the Inbox, and only once someone else has replied: a discussion the
reader started that nobody answered yet, or one they have read up on, is
nowhere. The reader has no page that says "these are the discussions I am in,
and these have something new".

Agreed with the user on 2026-10-23:

- **The list is the discussions the caller currently follows.** Commenting
  follows, so it covers "discussions I took part in"; Unfollow removes one,
  which is what the reader asked for. No new participation query.
- **It lives in Shares as a third tab, *Discussions*** (`?tab=discussions`),
  beside My shares and Saved shares. Like saved shares, follows belong to the
  account and are reached through links, so the tab is in the personal
  Workspace only, as the Shares page already is.
- **New comments are discovered the way they are today**: the Inbox badge.
  The tab adds an unread mark per row and an unread count on its label; no
  second notification mechanism.
- **A follow whose link no longer opens shows a placeholder row with
  *Remove*.** Removing is the caller giving up their own preference, so it
  does not need a live link. This is one new trusted-caller entry (§
  Authorization).
- Out of this cut: an Open/Resolved filter, paging beyond the first 100
  follows, following as the owner, following a whole document, email, push or
  polling.

Success means: reader R comments on `/s/:token`; Shares → Discussions shows the
discussion with no unread mark; the owner replies; the row shows "1 new reply"
and the tab reads *Discussions 1*; R opens the row, lands on the discussion,
and the mark clears. R unfollows from the list; the row is gone. The owner
revokes the link; R's row becomes the placeholder; *Remove* clears it.

## Model

No new table and no migration. The list reads `review_thread_follows`
(`following = 1`) for the caller, through the existing
`ReviewFollowRepository.listFollowing(userId, FOLLOW_LIMIT)`.

`summarizeFollowedThread` (`src/modules/knowledge/domain/review-follow.ts`)
today returns `null` for a discussion with no reply by someone else, which is
right for the Inbox and wrong for this list. It is split so one pass answers
both callers:

```ts
{ latest: ReviewComment; latestReply: ReviewComment | null; unread: number }
| { unavailable: true } | null
```

- `latest`: the latest visible, undeleted comment by anyone, the caller
  included. `null` result only when the thread is hidden, retracted, or has no
  such comment.
- `latestReply`: the same, by someone other than the caller.
- `unread`: replies by others created after `seen_at`, as today.

The Inbox keeps its rule by skipping a summary whose `latestReply` is `null`
and using `latestReply` for its excerpt; its output does not change.

## Behaviour

### The list

`DocumentReviewService.listFollowedDiscussions(caller)` returns one row per
followed discussion, at most `FOLLOW_LIMIT` (100), ordered unread first, then
by latest activity (newest first). It carries a `ponytail:` comment naming the
cap and the upgrade (cursor paging) for when a reader follows more.

A live row carries: `threadId`, `token`, document title (the current
revision's title), `threadStatus` (`OPEN` | `RESOLVED`), latest author name,
an 80-character excerpt of `latest`, `latestAt`, `unread`.

A row whose link no longer opens (expired, revoked, document archived, owner
lost the Workspace — the judgement `linkValid` already makes, per request)
carries only `threadId` and `linkAvailable: false`. No title, author, excerpt,
time or token, exactly as the Inbox's dead entry.

### The tab

- `SharesNavigation` gains *Discussions*. Its label shows the number of rows
  with `unread > 0` when there are any (`Discussions 3`, the number with an
  accessible name "3 unread").
- Filter: *All* / *Unread*, as a `status` search parameter like the other two
  tabs. An unknown value is a validation error shown in the view, as today.
- A live row links to `/s/:token?thread=:threadId` (no prefetch, as the Inbox's
  follow entries). Arriving there already marks the discussion seen.
- Each live row has *Unfollow*, calling the existing
  `POST /api/share-review/threads/:threadId/follow { token, following: false }`;
  the row leaves the list on success.
- A dead row reads "A shared discussion — this link is no longer available"
  with *Remove*.
- Empty state: "Discussions you comment on through a shared link appear here."

### Remove

`POST /api/review-follows/:threadId/unfollow`, no body. The service
`unfollowOwn(caller, threadId)` requires a trusted caller and runs
`reviewFollows.unfollow(threadId, caller.identity.id, now)`, which only ever
touches the caller's own row. It responds `{ following: false }` whether or
not such a row existed, so it says nothing about whether the thread exists.
It reads no thread, comment, document or link.

## Authorization

- The list and Remove answer the trusted caller only, for their own follow
  rows. Neither takes a token as proof; the list re-evaluates every row's link
  per request and names nothing for a dead one.
- Remove is a new caller-required entry. CLAUDE.md's share-link invariant gains
  it beside the follow entry: "stopping one's own follow needs no live link and
  discloses nothing". `tests/unit/share-link-single-exception.test.ts` still
  passes: the only caller-free entries remain `readShared` and `queryForLink`.
- Following still grants nothing the link does not; the list shows what the
  link shows now, and nothing once it stops opening.

## Error handling

- No caller: the page redirects to sign-in as the Shares page already does;
  the API answers 401.
- A summary that throws for one row is not swallowed; the page errors as other
  Shares tabs do. A thread that has been deleted from under a follow is skipped,
  as `followViews` does.
- Unfollow or Remove failure: the row stays and shows an inline error.

## Testing

- Unit, domain: `summarizeFollowedThread` — only the caller's comment (live
  row, `latestReply` null, unread 0); replies by others before and after
  `seen_at`; deleted and hidden comments ignored; hidden or retracted thread →
  `null`; dead link → unavailable.
- Unit, service: no caller refused; list ordering (unread first, then
  latest); dead row carries no title/excerpt/token; `unfollowOwn` changes only
  the caller's row and answers the same for a foreign or unknown thread; Inbox
  output unchanged for a thread with no replies by others.
- Unit, UI: the tab label count and its accessible name; the filter; the dead
  row's wording and *Remove*.
- Integration (MariaDB): the list over real follow rows and a revoked link;
  Remove leaves another user's follow on the same thread intact.
- E2E: the success path above end to end.
- `make verify` and the existing follow e2e stay green.

## Non-goals (YAGNI)

Open/Resolved filter, paging past 100, following as the owner, following a
document, participation without a follow, email, push or polling, and any
change to the HTML-subset, CSP or link-index contracts.
