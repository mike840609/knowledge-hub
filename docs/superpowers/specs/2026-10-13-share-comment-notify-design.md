# Share-page comments notify the original sharer (in-app unread)

## Intent and agreed product direction

A holder of a document share link (`/s/:token`) can read the visible
discussion and — signed in, on a live token, with writes enabled — leave a
comment. Today that comment lands silently: the document's owner finds it only
by opening the owner review panel by chance. The reader wrote, nobody knew.

Agreed with the user on 2026-10-13:

- **When someone comments on a shared page, the original article sharer gets
  an in-app unread notice.** No email in this cut.
- **No `@` parsing, no directory search, no page-level general comment** in
  this cut. The event table reserves a nullable `mentioned_user_id` column so
  a later `@` cut upgrades the same table instead of replacing it.
- **Scope is the single-document edit/browse surface**, not database, kanban,
  or AI features.

Success means: a signed-in holder comments on `/s/:token`; the PERSONAL
workspace owner sees an unread badge the next time they open the Hub, opens
the list, lands on the thread, and the badge clears.

## Behaviour

**Trigger points.** Only the two link-origin writes that add visible words:

- `DocumentReviewService.create()` via `createForLink` (first comment of a
  new thread) and `reply()` via `replyForLink` (reply), once the thread and
  comment rows commit in the same unit of work.
- Only when `originShareLinkId` is not null — owner comments made in the
  workspace never notify the owner about themselves.
- Never on `edit`, `retract` (delete/withdraw), `setResolution`, or
  `setVisibility`. Editing a typo is not news; resolving is the owner's own
  act.
- Never when the write itself fails: STALE revision (409), quota/capacity
  refusal, HIDDEN target, fully-retracted thread, archived workspace/document,
  or an expired/revoked link. `linkScope` already refuses these before any
  row exists, so no event can exist without its comment.

**Schema and ports.** One new table, no changes to the three review tables:

- `share_comment_events(id, workspace_id, document_id, thread_id, comment_id,
  origin_share_link_id,   created_by_user_id, mentioned_user_id NULL,
  created_at, read_at NULL)`, indexed by `(workspace_id, read_at)`; the
  recipient is derived at read time as the workspace's `personalOwnerUserId`
  and never stored on the row. No changes to the three review tables:
- New ports `ShareCommentEventRepository { insert, listUnreadByRecipient,
  markThreadsRead }` on `KnowledgeUnitOfWork`; MariaDB adapter plus
  migration 022. `mentioned_user_id` stays NULL in this cut.
- Read API `GET /api/review-notifications/unread` returns the caller's own
  unread events (document id/title snapshot, author name, 80-char body
  excerpt, thread anchor status via the existing `relocate` semantics);
  it takes no user id parameter.

**Authorization (no new anonymous entry).** The share-link single exception
stands: exactly `readShared` and `queryForLink` answer without a caller.

- Event writes ride the existing `reviewHttp` boundary:
  `establishTrustedCaller` + live token + `assertReviewOrigin` +
  `KM_REVIEW_WRITES_ENABLED` + quota/capacity. Anonymous callers can only
  read; they can never produce an event.
- Event reads require the owner scope:
  `workspace.personalOwnerUserId === caller.identity.id`, re-verified per
  request through `ownerReviewHttp`/`workspaceHttp`. Knowing a document,
  thread, or link id grants nothing.
- Revoked/expired links: old events remain (the comment rows remain), but
  opening one resolves link validity again; a dead link shows "link expired,
  comment snapshot" with the stored excerpt, never newer private content.

**Read/unread semantics.**

- Unread = event rows with `read_at IS NULL` for the calling owner.
  Opening the owner review panel on a document marks that document's events
  read (per-thread batch, idempotent — re-marking is a no-op).
- UI: one badge on the owner review rail entry plus one dot on the personal
  home updates area; the list shows document → author → time → excerpt;
  clicking lands on the thread anchor (MOVED follows, OUTDATED shows the
  original text without scrolling, reusing `createReviewAnchorRelocator`).
- Freshness: fetch on page/panel open. No polling, no push, no cross-device
  realtime in this cut.

**Error handling.**

- Event insert failure rolls back the whole comment transaction: the comment
  is not saved and the writer sees the ordinary write failure. A notification
  must never exist without its comment, and a comment must never silently
  lose its notification.
- Mark-read failure never blocks reading: retry once in the background,
  log on failure, leave the badge until the next open.

**Testing.**

- Unit: HIDDEN target / fully-retracted thread / owner self-comment /
  edit / retract / resolve produce no event; idempotency-key reuse produces
  exactly one event.
- Integration: link create → owner unread appears; reply → second event;
  open owner panel → badge clears; revoked-link write attempt → neither
  comment nor event.
- E2E: holder comments on `/s/:token` → owner home shows dot (mirror the
  `share-link-single-exception` assertion style: every write carries a
  caller; anonymous write stays refused).

## Non-goals (YAGNI)

Email delivery, `@` mention parsing and directory search, page-level
(no-anchor) discussion, cross-workspace or TEAM inbox, push/polling realtime,
export of notifications, and any change to the HTML-subset, CSP nonce, or
link-index contracts.
