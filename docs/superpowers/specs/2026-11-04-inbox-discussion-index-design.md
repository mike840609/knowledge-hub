# Inbox: a discussion index, not a queue

Status: agreed with the user on 2026-11-04 (approach A: one row per discussion;
the scope is the discussions that reach the reader today). Supersedes the list,
tabs, event-id selection and page-level count in
`2026-10-29-inbox-split-view-design.md`; the split layout itself stays.

## Intent

The Inbox was built as a notification queue: an `Inbox` tab holding unread
notices and open discussions, an `All activity` tab holding the raw event log,
and a page count that mixed the two. The reader asked for the opposite: a place
to go back over **all discussions** — read and resolved included — not a queue
to empty every day.

That changes the unit of the page. Today `listActivityForOwner` returns one row
per share-comment event, so five comments on one discussion are five rows; the
Inbox tab then filters those rows to the ones that "need attention." A review
page wants one row per **discussion**, with its latest activity, its passage,
its status and the reader's relationship to it.

The two-count problem disappears with the queue: the rail badge remains the
unread-notification count, and the page shows no second number. `Mark all read`
still clears the badge; the rows stay, because this page is history.

## Decision

**A. A discussion index.** One row per discussion, all history. The page keeps
a tabbed primary switch: the tabs are relationships over the one discussion
index, not the old queue/activity split; status and unread refine below them.
Chosen.

B (keep the activity log and only change the default tab) was rejected: it
still shows one row per comment, so the same discussion repeats, which is the
noise the reader wants gone. C (group the index by document) was deferred: it
is a presentation layer A can grow later without changing the data.

**Scope.** The index contains the discussions that reach the reader today: the
comments on their shared documents, the discussions they follow, and the
mentions naming them. Every discussion in a Workspace, including ones the
reader never took part in, is **not** in this cut: it needs a new access rule
and is a different product.

## Goals

- One row per discussion, live and reviewable, with the newest activity first.
- All history by default: read, unread, open and resolved are all in the list.
- Relationship tabs plus status and unread filters; the view applies to the
  whole index, not only the loaded page.
- The selected discussion still opens beside the list, and selecting it still
  marks it read.
- A write in the pane (reply, resolve, hide, edit, delete) settles the row
  without a manual Refresh.
- Documents and folders shared with the reader by name stay discoverable in a
  separate "Shared with you" section, not mixed into the discussion list.
- The rail badge is the only unread count on the page.

## Non-goals

- No archive, snooze, done or other queue action.
- No grouping by document (C), no saved searches, no full-text search.
- No mobile split view or mobile discussion detail page; the narrow page stays
  a list whose rows open the document.
- No real-time push or background refresh; Refresh and focus remain.
- No change to share-link access, review access, or the share/read endpoints.
- No raw "all activity" event log. The page is a discussion index.

## Anti-goals

- A discussion appearing twice because it has two comments.
- A second unread count on the page that can disagree with the rail badge.
- A pane write that leaves the row saying "Open" after it was resolved.
- A filter that only filters the rows already loaded.
- A page count that includes read, open discussions while the rail counts unread
  notices.
- A dead link's row naming its document, or a dead row counted as unread.
- A shared document row mixed into the discussion list.

## What does not change

- **No new access path.** The owner rows read the reader's personal-workspace
  documents; the link rows read through the same link judgement as today. The
  pane still calls `/api/documents/:id/peek?brief` and
  `/api/share-review/threads/*` with the entry's token.
- The split view's width rule (75rem of the page's own box), the 25rem list
  column, the 48px path line, the pane for an owner's document and for a
  followed discussion, and the narrow list.
- Selection marks a discussion read; the rail's unread badge and `Mark all
  read` stay.
- A dead link opens nothing; the pane shows its placeholder and makes no
  request. (A link that dies after the row was loaded is the edge case the pane
  still handles.)

## The list

**One row per discussion.** The row is the thread, not the notice:

- Document or folder title (`documentTitle`), truncated to one line.
- The passage quote (`anchor.exact`), one muted line, when the discussion has
  one. If the anchor is outdated the quote is still the original passage; the
  pane marks it.
- The newest visible comment by someone other than the reader: `Author: excerpt`
  (the reader's own replies do not replace this line; if everyone else's
  comments are gone, the opening comment is shown). This is the same rule for
  an owner, followed or mentioned discussion.
- Meta: relative timestamp · number of visible comments · `Open` / `Resolved` ·
  the reader's strongest relationship (`Mentioned you` > `Following` >
  `Your document`).

The unread state is a dot in the row's gutter and the title's weight, as the
tree and Updates use; the words "Unread" and "Read" are not repeated in the
meta. If more than one notice is unread, the meta adds `N unread`. A read row
keeps its place when selected, as it does today. An unread row keeps the
existing per-row `Mark read` control: it settles the thread without selecting
it, the way `global-inbox-activity.spec.ts` does today.

Every row is a link to its document/shared page. In the split layout a plain
click selects it in the pane, a modified click opens it in a new tab, `Enter`
selects and `⌘Enter` / `Ctrl+Enter` opens. Narrow, every row navigates.

**Tabs and filters.** The old `Inbox` / `All activity` tabs are replaced by
four relationship tabs, all over the same discussion index:

- `All` — every discussion.
- `My documents` — threads on the reader's shared documents.
- `Following` — threads the reader follows.
- `Mentions` — threads where someone mentioned the reader.

A thread that is both followed and mentioned appears under both `Following`
and `Mentions`; the row's label is the stronger relationship. The tabs are the
primary view, one click, as the old tabs were; the unit behind every one is a
discussion, never a raw event.

Below the tabs, a compact row refines the view:

- Status: `Any status` / `Open` / `Resolved`.
- Unread: a toggle. Unread means at least one owner notice, follow reply or
  mention in the thread is unread.

The tab, status and unread values are server-side and live in the URL
(`?kind=`, `?status=`, `?unread=1`) as the selection does, so a view can be
bookmarked or reloaded. Changing any of them resets the cursor and the
selection if the selected discussion no longer matches.

**No page count.** The `Inbox · N` tab count and the `All activity` tab go. The
rail's unread badge is the only number; `Mark all read` is disabled when the
badge is zero. The page does not repeat the badge.

**Pagination.** The owner source pages by `(latestAt, threadId)`; the button
says `Load older discussions`. Followed discussions remain the bounded
first-page set they are today (at most 100 follows). Mentions are capped at 100
mention **comments** before grouping, as today: a thread with many mentions can
use several of the 100 rows. Paging either is out of this cut. A page is
merged, deduplicated and sorted by `latestAt` before it is returned; the client
re-sorts when it appends a page.

**Empty states.** No discussions at all: `No discussions yet.` / "Comments on
your shared documents, replies in discussions you follow, and mentions will
appear here." A filter with no matches: `No discussions match these filters.` /
`Clear filters`. Unread with nothing unread: `No unread discussions.` / `Clear
the Unread filter to see everything.` No "You're all caught up": this is not a
queue.

## Shared with you

Documents and folders another person shared with the reader by name are not
discussions and do not enter the index. They keep a compact, separate section
above the discussion list:

- Only unread named shares; the read ones live in Shares, which already has its
  own "Shared with you" section.
- The section is hidden when there are none and when the relationship tab is
  not `All` or a status or unread filter is active; it returns when the default
  view returns.
- A row opens the Hub reader (which marks the share read), offers the existing
  per-row Mark read, and a `See all in Shares` link goes to
  `/w/:workspaceId/shares?tab=saved`.
- The rows are not selectable in the pane and are stepped over by ↑/↓, as
  shared rows are today.

The rail badge still counts unread named shares, so the section and the badge
agree.

## Selection and the pane

- Selection lives in `?item=<threadId>` (the discussion, not the event), written
  with `history.replaceState`. A reload or a bookmark opens the same
  discussion; Back leaves the Inbox. An unknown or filtered-out id selects
  nothing, silently.
- If the id is not on the first page, the page asks the same endpoint for that
  one discussion with the current filters; it opens in the pane without marking
  a row. An id the filters exclude selects nothing, so a bookmark never
  bypasses the view the reader asked for.
- Nothing is selected on arrival. Selecting marks the discussion read in one
  request: the owner's share notices for the thread, the reader's follow, and
  the reader's mentions in the thread. The row's dot clears at once; a failure
  leaves it unread, shows the error and retries when the row is chosen again.
  The request changes only the caller's own rows; an unknown thread is a
  no-op, not an error that reveals whether it exists.
- The pane is unchanged in shape: an owner's document with its discussions as
  the rail, the entry's discussion open; a followed or mentioned discussion
  drawn alone by `ReviewThreadList`; a dead link's placeholder.
- **A write settles the row.** Reply, resolve, hide, edit and delete in the pane
  update the row's status, latest comment, comment count and unread state, and
  re-sort the list if its `latestAt` changed. No manual Refresh is needed for
  the list to agree with the pane. The selected row stays even when the write
  makes it stop matching the active filter (resolving under `Open`, reading
  under `Unread`), as the current Inbox keeps a settled selected entry; it
  leaves when another row is selected or the filter changes. Refresh still
  reloads the first page and clears a selection that is no longer on it.
- The list does not re-read itself after a write in the pane only in the sense
  that it does not refetch every row; the selected row is updated from the
  write's result. A failed write leaves the row as it was.
- ↑/↓ move the selection inside the discussion list; every row is a tab stop.
  Focus stays in the list while the pane changes, as today.

## Data

**Common to every relationship.** `latestAt` is the newest visible comment in
the thread, the reader's own replies included. `latest` (the row's line) is the
newest visible comment by someone other than the reader; if there is none, the
opening comment. `commentCount` is the visible comments in the thread. A
mention-only row uses the thread's comments (which `judgedMentions` already
reads for its judgement), not the mention's own `createdAt`, for all three.

### Owner discussions

A new read-model query returns one row per **thread** (not per event):

- Scope: visible threads whose document belongs to the caller's personal
  Workspace and which have at least one share-comment event. Hidden threads,
  deleted/hidden comments and retracted threads are dropped by the same rules as
  `notificationViews`.
- `latestAt`: the newest visible comment in the thread (the reader's own replies
  included; they are activity).
- `latest` for the row's line: the newest visible comment by someone other than
  the reader (the share event's comment when the reader is the owner).
- `commentCount`: visible comments in the thread.
- `unreadCount`: unread share events for the thread.
- `status`, `documentId`, `sourceId`, `documentTitle`, and the thread anchor's
  `exact` for the quote.
- Cursor: `(latestAt, threadId)` descending; filters for status and unread are
  applied in the query, not after the page.

The page's titles, thread statuses, comments and authors are read in batches for
the page, not one thread at a time. The exact SQL and any supporting index are
the builder's; `share_comment_events` currently has no `thread_id`-leading
index, so check the plan before shipping.

### Followed and mentioned discussions

Reuse the existing judged sources:

- A followed thread is already one row per discussion (`followViews`); add its
  newest visible comment and visible comment count from the comments already
  read for the follow judgement, and keep its `summary.unread` replies.
- Mentions are one row per comment today; group them by thread, keep the newest
  live mention as the relationship, and count the unread mention rows in the
  thread. The row's `latestAt`, `latest` and `commentCount` come from the
  thread's comments, not from the mention's `createdAt`. A mention is a flag on
  the discussion, not a second row.
- A thread in both sources is one row: `mentioned` and `following` are both
  true; the row's label is the stronger one.
- A thread on the reader's own document that also mentions them is one owner
  row with `mentioned` true. The owner's unread count already includes the
  mention comment; do not add the mention count again.
- A link that no longer opens is not listed: there is nothing to review, and the
  row would be a permanent dead entry. The Shares > Discussions page still
  lists followed discussions with their unavailable state. The pane's
  placeholder remains for a link that dies after the row was loaded.

### Merge

Merge by `threadId` with this precedence and these flags:

- Owner row wins the document identity and href; otherwise use a live follow,
  then the newest live mention.
- A dead relationship contributes no flag, unread count or `latestAt`; a row is
  listed only through a live relationship, and its label is that live
  relationship. A dead follow is still visible on Shares > Discussions.
- `latestAt` is the maximum across the merged relationships; the row sorts on
  it.
- `unread` is true if any relationship is unread; `unreadCount` is the owner
  count for owner rows, and the follow's unseen replies plus unread mentions for
  link rows.
- `following` and `mentioned` are the union of the relationships' flags.
- The href is the live follow's link, else the newest live mention's link. The
  token and `documentId` for the pane come from that link.

### Pagination and filters

The owner source is paged; follows and mentions are the bounded first-page set,
as above. The service merges, deduplicates, filters the link rows by the same
status/relationship/unread rules, sorts by `latestAt`, and returns the page.
The cursor is the last owner row's `(latestAt, threadId)`; a client that
appends a page re-sorts the whole list. A filter change starts from no cursor.

## API

- `GET /api/review-notifications/inbox?status=&kind=&unread=&beforeLatestAt=&beforeThreadId=`
  returns `{ discussions, shared, nextCursor }`. `shared` is the unread named
  shares, only on the first page of the default (unfiltered) view.
  `?threadId=<id>` (with the same filters) returns that one discussion in
  `discussions`, for a deep link that is not on the loaded page.
- `POST /api/review-notifications/inbox`:
  - `{ action: "mark-thread-read", threadId }` — owner notices, follow seen,
    mentions in the thread, in one request, idempotent.
  - `{ action: "mark-read", eventId }` — a shared-with-you row, as today.
  - `{ action: "mark-all-read" }` — every source, as today.
- The old `GET /api/review-notifications/activity` is retired once the page
  stops using it; its POST actions move to the new route. If another caller
  remains, keep the route and say so.

## Copy

The page's explanation becomes: "Every discussion on your shared documents, in
discussions you follow, and where someone mentioned you. Opening one marks it
read; resolving it is a separate action." The shared section says: "Documents
and folders shared with you by name. They also live in Shares." The relationship
tabs are `All`, `My documents`, `Following`, `Mentions`; the status control is
`Any status`, `Open`, `Resolved`; the toggle is `Unread`.

## Layout

- Split: the page header is the list column's 48px line; the relationship tabs
  and the status/unread row are sticky under it; the shared section and the
  discussion list scroll beneath. The pane keeps its 48px path line and its
  document/discussion.
- Narrow: `kh-page`, the header, the explanation, the relationship tabs, the
  status/unread row, the shared section and the list; rows navigate. No page
  count.
- The 22rem list column and the 75rem split threshold do not change.

## Out of this cut

Archive / snooze / done, grouping by document, search inside the Inbox, paging
followed and mentioned discussions beyond the first 100, a mobile detail view,
real-time updates, a draggable divider, and any discussion the reader cannot
already reach.

## Tests

- Unit (`InboxActivityView`): two owner events on one thread make one row; the
  row shows the quote, the newest other-person comment and the count; read and
  resolved rows are listed by default; the relationship tabs and the
  status/unread filters; a followed thread with a mention is one row with both
  flags; a shared-with-you row is in the separate section and not in the
  discussion list; selecting writes `?item=<threadId>` and marks the thread read
  once; an unknown id selects nothing; a tab or filter change resets the cursor;
  ↓ goes to the next row; a pane write settles the row without Refresh.
- Integration: the owner summary query is one row per thread, with the right
  latest comment, count, unread count, status and cursor; hidden/retracted rows
  are absent; the merge dedupes owner/follow/mention and prefers a live link;
  filters are applied before the page; `mark-thread-read` marks all three
  sources and is idempotent; an unknown thread is a no-op.
- E2E: an owner receives two comments on one discussion → one row; select it,
  reply, resolve → the row says Resolved without a manual Refresh; a mention
  reaches the index; status filters; the unread toggle; a shared-with-you row
  opens the Hub reader; at a narrow viewport a row navigates to the document.
- Update `inbox-split-view.test.tsx`, `inbox-shared-with-you.test.tsx`,
  `global-inbox-activity.spec.ts` and `inbox-entry.spec.ts` to the new unit,
  filters and copy. `notification-href.test.ts` follows the view changes.

## Contract

`frontend-design-language.md`'s Inbox paragraph gains: from a 75rem box the
Inbox is a 22rem **discussion index** beside the selected discussion — one row
per discussion, newest activity first, with relationship tabs (`All` / `My
documents` / `Following` / `Mentions`) and status/unread filters, selection by
thread in the URL, no page-level unread count, and a separate unread "Shared
with you" section above the list; narrower it is the same index as a plain
list. The 2026-10-29 spec's tab, event-id and count clauses are
superseded. The 2026-10-31 single-entry spec's "the Inbox page ... does not
change" is superseded by this design; its single rail entry and badge stay.

## Left to the builder

- The port/query name and SQL, the supporting index, and whether the owner
  summary lives with the review-thread repository or a small new read port.
- The route name (`inbox` vs `discussions`) and whether the old activity route
  is removed or kept.
- The tab labels' width, the status control's shape (a select or a small
  segmented control), and the shared section's placement/height.
- The row's exact line composition and quote truncation.
- Whether a pane write updates the row optimistically or refetches the current
  page; the outcome is "the row settles without Refresh".
- The dead-row omission and the 100-item follow/mention cap, both stated above.
