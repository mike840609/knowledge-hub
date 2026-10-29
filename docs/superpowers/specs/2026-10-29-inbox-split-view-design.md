# Inbox: a list and the discussion beside it

Status: agreed with the user on 2026-10-29 (nothing selected on arrival; no `j`/`k` in this cut; the pane reads the whole document's discussions).

## Intent

Today every Inbox entry is a link away. Opening one leaves the Inbox for the
owner's document (`?thread=`) or the shared page (`/s/:token?thread=`); reading
the next means Back, finding the place in the list again, and opening the next.
Working through ten replies is ten round trips.

The Inbox becomes a list on the left and the selected discussion on the right,
so a reader can go down the list, read each discussion, reply or resolve, and
never leave the page. The document stays one click away for when the passage's
surroundings matter.

## What does not change

- **No new access path.** The pane reads and writes through the same entries
  the readers use today: `/api/documents/:documentId/review-threads` for the
  owner, `/api/share-review/threads/*` with the entry's token for a follow. The
  service re-checks policy per request exactly as now. The pane is a second
  caller of existing entries, not a new one, so
  `share-link-single-exception.test.ts` is untouched.
- **A dead link opens nothing.** A follow whose link no longer opens has no
  token in its entry (`linkAvailable: false`); the pane shows the entry's
  placeholder sentence and makes no request.
- **What an entry is**, the Inbox / All activity tabs, Mark read, Mark all
  read, Load older, the popover (still the glance; its rows still open the
  document), and the unread badge.

## Layout

- Where the Inbox's own box is at least **75rem** wide (measured by a
  `ResizeObserver`, as the document pane uses a container query, never the
  window), the page is two columns: a 25rem list column (22rem of rows and its 24px
  gutters) and, after a 1px rule, a document pane of at least **48rem** — the
  width at which the owner's discussions sit beside the article
  (`--review-rail: inline`) rather than in a drawer over it, plus a rem for a
  classic scrollbar, which the pane's stable gutter keeps (17px on Windows). A drawer over the
  Inbox would cover the list being worked through, so the split waits for room
  for the rail. (Amended 2026-10-29: the first build used 44rem with the
  discussion alone; once the pane showed the document, 44rem put the
  discussions in a drawer at a 1180px window.) At a 1440px window the box is
  about 79rem; at 1280px it is about 69rem and the Inbox is the plain list. The
  page widens from `kh-page` to fill the content area.
- Narrower than that, the page is today's list, and a row is today's link.
  Nothing on a phone changes.
- Both columns are the window's height and scroll on their own, with a 1px rule
  between them the full height. Each opens on a 48px line, as the rail, the
  explorer and a document do, so they share one top edge: the list column's is
  the page header ("My Space › Inbox", Refresh, Mark all read — the list's
  actions, over the list), with the tabs pinned under it; the pane's is the
  reader's path line (the entry's title, muted, and **Open document**).
- Under the path line an owner's entry is the document with no frame of its
  own, as the reader and the side peek show one: its `page-title` title (unless
  the Markdown opens with a heading, which then wears that scale), then the
  article and its rail. (Amended 2026-10-29 after a layout review: the first
  build framed the document in a bordered box under a second title line, cut
  off at the window's foot, with the page's actions above the pane.)

## Selection

- **Selection lives in the URL** as `?item=<eventId>`, written with
  `history.replaceState` (Next keeps `useSearchParams` in step, and no server
  render is asked for), so a reload or a shared bookmark of one's own Inbox opens
  the same entry and Back leaves the Inbox rather than stepping through rows.
  An unknown or no-longer-listed id selects nothing, silently.
- **Nothing is selected on arrival.** Selecting marks an entry read (below), so
  auto-selecting the first row would mark something read that the reader never
  looked at. The empty pane carries what the explanatory paragraph says today
  ("Opening a discussion marks it read; resolving it is a separate action"),
  and the paragraph above the list goes. That settles the separate
  "Inbox paragraph" item.
- In the split layout a row is a button-like link: a plain click selects; a
  modifier click or middle click still opens the document in a new tab, because
  the row's `href` is still `notificationHref`. The selected row wears the
  existing selected-row treatment (`bg-selected`, lavender; contract §8).
- **The selected entry keeps its place** in the Inbox tab once reading it has
  settled it, so `↓` goes on from there; it leaves on the next selection.
- **Selecting marks the entry read**, through the existing
  `mark-read` action by event id — for an owner's entry, by its discussion
  (`/api/review-notifications/mark-read` with the thread), which is what the
  reader marks, so one request settles every notice of that discussion and
  the list updates them all; the panel inside the pane does not mark that one again, though any other
  discussion looked at there is marked as on the reader. It is the same rule as
  "opening a discussion marks it read" today.

## The discussion pane

Amended 2026-10-29, after the user saw the first build: a quoted passage alone
said too little, so an owner's entry shows the document.

- **Path line:** the entry's title (`notificationTitle`) and **Open document**
  (the entry's `notificationHref`, a small secondary button). The entry's kind
  is not repeated; the row says it. A dead link's entry shows "A shared
  discussion" and no button.
- **An owner's entry shows the document**, as the reader does: the article in
  a `DocumentPane` wrapped by the same `OwnerReviewPanel`, so the passage is
  highlighted, the discussions are the rail beside it, and everything the
  reader allows there (reply, resolve, hide, comment on selected text) works
  here unchanged. The article comes from the existing
  `GET /api/documents/:id/peek?brief` (the side peek's read; `brief` skips the
  header's facts — explorer tree, shell, breadcrumb — and it now returns
  `revisionId`, which the panel compares with its discussions' revision). It reads an
  archived document too, which the pane shows read-only, so its discussions can
  still be seen and settled. The
  panel takes the entry's discussion as a `thread` prop in place of
  `?thread=`, opens on it (showing every discussion, not only open ones, when it is
  resolved) and scrolls its passage into view with `revealReviewAnchor`, the
  scrolling half of `focusReviewAnchor`, which leaves focus in the list. It never opens
  as a drawer from the Inbox. The rail's sticky toolbar stops under the
  reader's 48px path line; the Inbox has none, so the pane sets
  `--kh-review-toolbar-top: 0`.
- **A followed discussion shows that discussion alone**, drawn by
  `ReviewThreadList` with `threads=[thread]`: its quote, comments, Reply,
  Follow, and edit/delete of one's own. The page it is on is reached only
  through `/s/:token`, which this view neither frames (`frame-ancestors
  'none'`) nor reads; showing it here would need a new link-scoped read, a
  change to the share-link invariant that is not part of this work. Its data
  is the share query with the entry's token, picked by id; a discussion the
  response no longer lists shows "This discussion is no longer available
  here." `ponytail:` it reads the whole page's discussions to show one.
- The list does not re-read itself after a write in the pane; Refresh does.

## Keyboard

- `↑` / `↓` move the selection when focus is in the list, and focus and the
  pane follow. Every row stays a tab stop, as today. `Enter` on a row in the split layout selects;
  `⌘Enter` / `Ctrl+Enter` opens the document.
- **Open question for the user:** Linear also binds `j` / `k`. The contract
  (§10) lets single keys act on the page while no caret is in a field, so it is
  allowed; it is left out of this cut unless asked.

## Out of this cut

Archive / snooze an entry, grouping by document, a draggable divider,
the shared page for a followed discussion, and `j` / `k`.

## Tests

- Unit (`InboxActivityView`): no selection on arrival and nothing marked read;
  selecting writes `?item=` and marks that event read once; an unknown `?item=`
  selects nothing; a dead-link entry shows the placeholder and makes **no**
  request; owner and follow entries call their existing endpoints (the follow
  one with the entry's token); a discussion missing from the response shows
  the unavailable sentence; `↑`/`↓` move the selection.
- E2E: owner receives a share comment → Inbox → select → reply in the pane →
  the reply is on the document's rail; a follow entry replies through the
  pane; at a narrow viewport a row still navigates to the document.

## Contract

`frontend-design-language.md` §18 gains one sentence: the Inbox is a list and
the selected discussion side by side from a 75rem box, a plain list below it,
selection in the URL, nothing selected on arrival.
