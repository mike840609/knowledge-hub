# `@` mentions in discussions

## Intent and agreed product direction

A discussion today reaches only the people already in it: the document's owner
(`share_comment_events`) and readers who wrote there (`review_thread_follows`).
There is no way to pull someone *new* in. Writers paste the link into chat and
say "look at this", outside the Hub, and the person never sees the discussion
in their Inbox.

Agreed with the user on 2026-10-29:

- **Typing `@` in a discussion composer suggests people**, matched on `name`,
  `emp_id` (the user's "emplid") or `name_en` (added by #301,
  migration 027).
- **The candidates are everyone who has signed in to the Hub** (rows in
  `users`), not only people who can already open the document. Pulling in
  someone new is the point.
- **The person mentioned sees it in their Inbox**: who mentioned them, the
  comment, and a way in.
- **A mention in a shared-link discussion carries that link to the person
  mentioned**: they click and can read. This is deliberate; see § Authorization.
- **Being mentioned follows the discussion**, so later replies reach the same
  Inbox through the existing follow machinery.
- **When the owner mentions someone from their own Workspace view**, the
  mention carries one of the document's live share links: the only live one
  automatically, or the one the owner picks when there are several. With no
  live link, the composer says a share link is needed first. The Hub never
  creates a link on the owner's behalf: that would be a new grant nobody issued.

Success means: owner O shares a document; reader R comments on `/s/:token` and
types `@陳`, picks 陳小明 (E1234 · Ming Chen); 陳小明's Inbox shows one unread
"R mentioned you" entry with the excerpt; clicking it lands on
`/s/:token?thread=…` with the discussion open; the entry turns read; a later
reply by O in that discussion appears in 陳小明's Inbox as a follow entry. O
revokes the link; both entries now name nothing.

## Where discussions live (current state, unchanged)

Discussions exist only on documents in a `PERSONAL` Workspace
(`DocumentReviewService.scope`). Their writers are the Workspace's personal
owner (owner view) and signed-in share-link holders (`/s/:token`). So, apart
from the owner, everyone mentioned reads through a share link; there is no
"Workspace member" case to handle.

## Model

One new table. No change to the review tables, `share_comment_events` or
`review_thread_follows`' schema.

```text
review_comment_mentions(
  comment_id         UUID FK document_review_comments
  mentioned_user_id  UUID FK users
  share_link_id      UUID FK document_share_links   -- the link the mention carries
  created_at         DATETIME(6)
  read_at            DATETIME(6) NULL
  PRIMARY KEY (comment_id, mentioned_user_id)
  KEY ix_mention_inbox (mentioned_user_id, read_at, created_at)
)
```

Migration `028-review-comment-mentions`, additive.

`share_comment_events.mentioned_user_id` (reserved in 022) stays NULL and
unused: it holds one user per comment, and one comment may mention several
people. It is not dropped (forward-only migrations).

The comment `body` keeps the plain text the writer sees (`@陳小明 please
check`). The table, not the text, decides who was mentioned. *(Builder's call
noted: the server does not cross-check that `@name` appears in the body; a
mismatch is cosmetic, never an access question.)*

## Behaviour

### Suggesting people

One query, two doors (agreed 2026-10-29):

- **Shared query.** `users.searchExisting` additionally matches `name_en`,
  case-insensitively (the column is `utf8mb4_bin`, so compare lower-cased),
  and returns it. `HubUserLookup` gains `nameEn: string | null`. The Workspace
  member picker behind `GET /api/users` benefits too; its gate is unchanged
  (trusted caller, refused when `personalWorkspaceOnly`).
- **Mention door.** `/api/users` cannot serve mentions: in the default
  deployment (`KM_TEAM_WORKSPACES_ENABLED=false`) every caller is
  `personalWorkspaceOnly` (`src/server/composition.ts`), so it refuses
  everyone, and discussions exist only there. Opening it would hand the whole
  directory to every signed-in user, anywhere. Instead a new
  `GET /api/review-mentions/candidates?query=…&token=…` (link reader) or
  `…&documentId=…` (owner) answers only a caller who could write a comment on
  that document now: trusted caller plus `linkScope` (live token), or
  `ownerScope`. It then runs the same `searchExisting`. A method on
  `DocumentReviewService` (it owns both scopes) reading users through a port.
- Results: at most 10, empty for an empty query; shown as `name`, then
  `name_en · emp_id` in secondary text (`name_en` omitted when null; it fills
  on the person's next Company SSO login, #301).
- Anonymous `/s/:token` readers never see the `@` list: they cannot write
  either, and the route refuses them.
- *(My call)* `account` (#301) is not matched in this cut; adding it is one
  `OR` when someone asks.

### Writing a mention

- The composer (new discussion and reply, owner and shared views) opens the
  list on `@` at a word start, filters as the writer types, and inserts
  `@<name>` plus the chosen user id into a `mentions` list it sends with the
  comment. Keyboard: ↑/↓, Enter/Tab to pick, Esc to close. The list is an
  ARIA combobox/listbox.
- The comment write (`createForLink`, `replyForLink`, `createForOwner`,
  `replyForOwner`) accepts `mentions: string[]` (user ids) and, for the owner
  writes, `mentionLinkId?: string`. Inside the existing unit of work, after
  the comment row is inserted:
  - de-duplicate; drop the writer themselves; drop the Workspace's personal
    owner (*my call*: they already get every link comment as an OWNER notice,
    and cannot be mentioned in their own view);
  - refuse the whole write (400) for an unknown user id or more than 10
    mentions;
  - the carried link is `s.link.id` for link writes; for owner writes it is
    `mentionLinkId`, which must belong to this document and be valid now
    (`evaluateShareLinkValidity`), else the write is refused; when
    `mentions` is non-empty and no `mentionLinkId` is given, refused;
  - insert one `review_comment_mentions` row per person;
  - follow: for each person, if they have no follow row on the thread, insert
    `following = true, share_link_id = carried link, seen_at = now`; if they
    have one with `following = false`, set it `true`, `seen_at = now`, link =
    carried link; if already following and that follow's link is valid now,
    leave it alone (their unread replies stay unread); if already following
    through a link that is no longer valid, move it to the carried link and
    keep `seen_at` (*my call*: otherwise later replies would reach nobody).
    The existing `reviewFollows.follow()` always resets `seen_at` and the
    link, so this needs its own repository method.
  - Failure of any of these rolls back the comment, like the notify cut.
- An idempotent replay writes nothing new, as today.
- **Edit** does not add or remove mentions (*my call*). **Delete/retract or
  owner hide** of the comment makes its mention entries name nothing (derived
  at read time, below); no cleanup write.
- The owner composer: when `mentions` is used, it loads the document's live
  links; one → used silently; several → a small "Share via" select before
  Post; none → the `@` list shows "Create a share link first to mention
  someone" and picks nothing.

### The Inbox entry

- `GET /api/review-notifications/unread` and `.../activity` add
  `kind: "MENTION"` entries for the caller's own `review_comment_mentions`
  rows, merged newest first with OWNER and FOLLOW. One entry per mentioning
  comment. View: author name, document title, 80-char excerpt, `token`, href
  `/s/:token?thread=:threadId`.
- Judged per request: the entry shows content only while the carried link is
  valid now **and** the comment and its thread are visible, not deleted, not
  retracted (`projectReviewerThread` rules). Otherwise it shows only "A shared
  discussion — this link is no longer available", no title, author, excerpt or
  href, and is not counted unread. Same wording and rule as dead FOLLOW
  entries.
- No double entry: the follow-unread derivation excludes comments that have a
  `review_comment_mentions` row for the caller.
- Badge count (`unread-count`) adds unread live mentions.
- Activity paging (*my call, recorded deviation*): like FOLLOW entries,
  MENTION entries are not cursor-paged; at most 100 newest are merged into the
  first Activity page, and the `(createdAt, id)` cursor keeps paging owner
  events alone.
- Read: the activity route's `mark-read` action gains a `{ commentId }` form
  for a MENTION entry (today `POST /api/review-notifications/mark-read` takes
  `documentId`/`threadId` and is not the place); `mark-all-read` also marks
  all of the caller's mentions; arriving on the thread
  (`POST /api/share-review/threads/:threadId/seen`) also marks the caller's
  mentions in that thread read. All touch only the caller's own rows.
- Inbox split view (#299): a MENTION entry opens like a FOLLOW entry
  (`InboxDiscussion` through the token).

## Authorization

This adds a fourth reader-side path to CLAUDE.md's share-link invariant, and
CLAUDE.md is updated with the code:

> A **mention** delivers a share link's reference to the Inbox of one named,
> signed-in Hub user. It is the writer handing over the link they already
> hold (a reader) or own (the owner), recorded instead of pasted. It reads
> only through `/s/:token` like any holder, is judged per request against the
> link's validity, never extends the link's lifetime, and grants no Workspace
> membership, search, tree, history, MCP, Markdown edits or revision writes.

- Mention writes ride the existing write boundaries (`reviewHttp` /
  `ownerReviewHttp`): trusted caller, live token or owner scope, origin check,
  `KM_REVIEW_WRITES_ENABLED`, quota/capacity.
- Candidate search is a new caller-required entry, gated as above; it adds
  no anonymous answer, and the share-link single-exception test's scan
  covers its route.
- Mention reads require a trusted caller and return only rows where
  `mentioned_user_id = caller`. No endpoint takes a user id to read someone
  else's mentions.
- No new anonymous entry; `tests/unit/share-link-single-exception.test.ts`
  must still pass unchanged in spirit (add the new routes to what it scans if
  it enumerates them).
- *(Recorded consequence)* The owner cannot see to whom a reader forwarded
  their link by mentioning. A reader could already paste the URL anywhere; the
  grant does not widen. Showing the owner "R mentioned X" is out of this cut.

## Non-goals

Email or push; mentions in the document body (Markdown); mentioning groups or
`@all`; mentioning in edits; owner-visible mention audit; a "request access"
flow; chips that re-render when a user is renamed (the body is plain text);
matching `account`.

## Testing

- Unit: dedupe / self / owner dropped; >10 refused; unknown id refused; owner
  write without a valid `mentionLinkId` refused; edit leaves mentions alone;
  follow upsert's three cases; follow-unread excludes mentioned comments;
  dead link / hidden / deleted comment → entry names nothing and is not
  counted; composer `@` keyboard and insertion (rendered component).
- Integration: link comment with mention → row + follow; mentioned user's
  `/unread` shows MENTION; another user's `/unread` does not; revoke link →
  entry anonymised; `searchExisting` matches `name_en` case-insensitively.
- E2E: reader mentions user B on `/s/:token`; B signs in, Inbox shows the
  entry, opens it, lands on the thread, badge clears; owner with no link sees
  the "create a share link first" hint.
