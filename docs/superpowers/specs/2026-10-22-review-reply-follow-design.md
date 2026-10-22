# Shared-page readers follow their discussions; the owner reads discussion by discussion

## Intent and agreed product direction

A signed-in reader who comments on `/s/:token` today hears nothing back: the
owner's reply, or another reader's, waits until the reader happens to reopen
the link. And the owner, opening the review panel, has every share-comment
notice on that document marked read at once, whether or not each discussion
was looked at (`2026-10-13-share-comment-notify-design.md`, "Opening the owner
review panel on a document marks that document's events read").

Agreed with the user on 2026-10-22:

- **Commenting follows.** A reader who starts or replies to a discussion
  through a share link follows that discussion. The card offers *Unfollow* and,
  after that, *Follow*.
- **Replies reach the follower's Hub Inbox**, the same Inbox the owner already
  uses (badge, mark one read, mark all read). An entry opens the shared page at
  that discussion.
- **The owner's read state is per discussion.** Opening the panel marks nothing;
  looking at a discussion marks that discussion.
- Out of this cut: email, polling or push, `@` mentions, "next unread".

This amends the share-comment-notify spec's read/unread semantics (§ Read/unread
semantics, first bullet) and adds one reader-side entry to CLAUDE.md's share-link
invariant (§ Authorization below). Both are updated with the code.

Success means: reader R comments on `/s/:token`; the owner replies from the
workspace; R's Inbox shows one unread entry; R opens it, lands on `/s/:token`
with the discussion open and in view, and the badge clears. R unfollows; the
next reply produces nothing.

## Model

One new table. No change to the three review tables or to `share_comment_events`.

```text
review_thread_follows(
  thread_id      UUID  FK document_review_threads
  user_id        UUID  FK users
  share_link_id  UUID  FK document_share_links   -- the link the reader came through, latest wins
  following      BOOL                              -- false after Unfollow; the row stays
  seen_at        DATETIME(6)                       -- read cursor
  created_at, updated_at DATETIME(6)
  PRIMARY KEY (thread_id, user_id)
  KEY ix_follow_user (user_id, following)
)
```

Migration `024-review-thread-follows`, additive.

**Unread is derived, never stored per reply.** For follower U, a comment C is an
unread reply when, at read time:

- U follows C's thread (`following = true`),
- `C.created_at > seen_at`,
- `C.author_user_id <> U`,
- C is visible and not deleted, its thread is visible and not retracted
  (the reviewer projection's own rules: `projectReviewerThread`), and
- the follow's `share_link_id` is valid now (`evaluateShareLinkValidity`,
  the same evaluation `linkScope` makes).

Nothing is written per follower when a reply is posted. A comment the owner
later hides, or its author deletes, stops counting without any cleanup. That is
why there is no per-follower event row (approach B, rejected) and no recipient
column on `share_comment_events` (approach C, rejected: every existing query
derives the recipient as the Workspace owner).

## Behaviour

### Following

- `createForLink` and `replyForLink`, inside their existing unit of work and
  only once the comment row is inserted, upsert `(thread, caller)` with
  `following = true`, `share_link_id = s.link.id`, and `seen_at = now`. The
  caller's own words are read, and they re-follow even after an Unfollow:
  speaking again is asking to hear back.
- An idempotent replay (existing key, same hash) writes nothing new, as today.
- The Workspace's personal owner never gets a follow row; their notices remain
  `share_comment_events`. `createForOwner` / `replyForOwner` write no follow.
- `follow` / `unfollow` (new): `POST /api/share-review/threads/:threadId/follow`
  `{ token, following: boolean }`. Requires a trusted caller, a live token
  (`linkScope`), and a visible, non-retracted thread on that link's document.
  `KM_REVIEW_WRITES_ENABLED` does not gate it. Following adds no words; it is a
  preference, like closing the rail. Following again sets `seen_at = now`
  (no backlog flood). Following a thread you never wrote in is allowed: the
  link already lets you read it.
- `queryForLink` adds `following: boolean` to each thread view for a signed-in
  caller (absent for anonymous). The card shows *Unfollow* when true, *Follow*
  when false or absent and the caller is signed in. Nothing for anonymous.

### The follower's Inbox

- `GET /api/review-notifications/unread` and `.../activity` already answer for
  the trusted caller only. They now return the caller's owner notices **and**
  their follow replies, merged newest first, same view shape plus
  `kind: "OWNER" | "FOLLOW"`, and for `FOLLOW`, `token` and `linkAvailable`.
- A `FOLLOW` entry is one per thread, not one per reply: "N new replies" on the
  discussion, latest author, latest 80-char excerpt. A busy thread does not
  bury the rest of the Inbox.
- Activity (including read) for follows lists followed threads that have any
  reply by someone else, ordered by the latest such reply, `readAt` set when
  `seen_at >= latest`. The cursor stays `(createdAt, id)` across both kinds.
- The badge count is owner unread events plus follow threads with unread replies.
- Href: `/s/:token?thread=:threadId`. The token is the one the reader already
  used. It is in their history, and saved-shares already keeps the same
  reference (`2026-10-12-saved-shares-design.md`).
- **Link no longer valid** (expired, revoked, document archived, owner lost the
  Workspace): the entry stays but shows only "A shared discussion — this link
  is no longer available": no title, excerpt, author or href. It is not counted unread. A dead link never discloses words written
  after it died, or before.
- Mark one read: `POST .../activity { action: "mark-read", threadId }` on a
  `FOLLOW` entry sets `seen_at = now` for `(thread, caller)`. `mark-all-read`
  also sets `seen_at = now` on every row of the caller's. Both only touch the
  caller's own rows.

### Arriving on a discussion: `/s/:token?thread=:id`

- The shared panel reads `thread` from the URL once. When a visible thread with
  that id is in the loaded discussions, it opens the panel (rail or drawer),
  switches the filter to one that shows it, activates it, and scrolls its
  passage into view via `focusReviewAnchor`. An unknown, hidden or foreign id
  does nothing: the parameter is navigation, never authorization.
- For a signed-in follower, activating a followed thread marks it seen, whether
  by a click on its card or by the URL: `POST
  /api/share-review/threads/:threadId/seen { token }` sets `seen_at = now` when
  the caller has a follow row on it, and is a no-op otherwise.

### The owner reads per discussion

- `OwnerReviewPanel` no longer calls `markDocumentRead` on open.
- Activating a thread (card click, passage marker, `?thread=` arrival) or
  replying in it marks that thread's unread events read:
  `POST /api/review-notifications/mark-read { documentId, threadId }`,
  through `ownerScope`, then `markThreadsRead(owner, documentId, [threadId])`
  (the port the 2026-10-13 spec named, now used).
- The panel toolbar gets *Mark all read* when the document has any unread,
  calling the existing document-level `markDocumentRead`.
- Each card with unread events shows a dot (`aria-label="Unread"`).

## Authorization

The share-link single exception stands: `readShared` and `queryForLink` are
still the only entries without a caller, and `follow` / `seen` join the
caller-required list in `tests/unit/share-link-single-exception.test.ts`.

New in CLAUDE.md's invariant: a fourth narrow path, **follow replies in the
reader's own Inbox.** It is reachable only by the trusted caller for their own
follow rows. It shows reply excerpts only while the followed link is valid now,
re-evaluated per request. It never grants Workspace membership, search, tree,
history, MCP, Markdown edits or revision writes. Following never extends a
link's lifetime.

Knowing a `thread_id` grants nothing: follow, seen, and mark-read each resolve
the thread through a live token (reader) or `ownerScope` (owner) before
touching a row, and a mismatch is `ShareLinkNotFoundError`, as today.

## Error handling

- A follow-upsert failure inside `createForLink`/`replyForLink` rolls back the
  comment, the same rule as the share-comment event: a reader's comment must not
  silently lose its follow.
- `follow`, `seen` and owner `mark-read` failures never block reading. The card
  toggle reverts with the ordinary inline error; `seen`/`mark-read` retry once
  in the background, then leave the badge until next time (existing
  `useShareCommentUnread` behaviour).

## Testing

Requirement → case:

- Unit (domain): unread derivation excludes own, hidden, deleted, retracted,
  pre-`seen_at`, and invalid-link replies; counts one per thread; dead link
  yields an entry with no excerpt and not unread.
- Unit: `share-link-single-exception` lists `follow` and `seen` as
  caller-required.
- Integration: link comment → follow row; owner reply → R unread 1; second
  reply → still one entry, "2 new replies"; R `seen` → 0; R unfollows → next
  reply → 0; R replies again → following again; revoke link → R's entry shows
  unavailable, unread 0; owner self-actions create no follow row; another user
  calling `seen`/`mark-read` on R's thread changes nothing.
- Integration (owner): opening the panel marks nothing; activating thread A
  clears A's events only; *Mark all read* clears the document.
- E2E: reader comments on `/s/:token` → owner replies in the workspace → reader
  Inbox shows the entry → click lands on `/s/:token?thread=` with the card active
  and passage in view → badge clears. Anonymous reader sees no Follow control.

## Non-goals (YAGNI)

Email, polling or push, `@` mentions, "next unread/unresolved" navigation,
per-workspace notification settings, following as the owner, following a whole
document, and any change to the HTML-subset, CSP or link-index contracts.
