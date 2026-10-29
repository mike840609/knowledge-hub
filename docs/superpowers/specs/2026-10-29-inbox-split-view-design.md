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

- Where the Inbox's own box is at least **44rem** wide (measured on the box by a
  `ResizeObserver`, as the document pane uses a container query, never the
  window), the page is two columns: the list at **22rem** fixed, the discussion
  taking the rest (at least 22rem, wider than the 20rem review rail), a 1px
  `border` rule between them. 44rem, not the draft's 60rem: at a 1280px window
  the content area beside the rail and the explorer is about 51rem, and the
  split should be there on an ordinary laptop. The page widens from `kh-page`
  to fill the content area; the list keeps its rows' current shape.
- Narrower than that, the page is today's list, and a row is today's link.
  Nothing on a phone changes.
- The list scrolls with the page; the discussion column is sticky at the top
  of the content area and scrolls on its own when taller than the window. The
  page header (title, Refresh, Mark all read) spans both columns; the tabs
  head the list column.

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
- **Selecting marks the entry read**, through the existing
  `mark-read` action by event id, the same rule as "opening a discussion marks
  it read" today.

## The discussion pane

- **Header:** the entry's title (`notificationTitle`), its kind ("Discussion
  you follow" / "Open discussion" / "Resolved"), and **Open document** (the
  entry's `notificationHref`) as a secondary button. A dead link's entry shows
  "A shared discussion" and no button.
- **Body:** that one discussion, drawn by the existing `ReviewThreadList` with
  `threads=[thread]`: the quoted passage, the comments, Reply, and for the
  owner Resolve / Reopen and visibility. Everything the rail lets the caller do
  there, the pane lets them do; nothing more.
- **Data:** the owner pane fetches the document's review threads and picks the
  one by id; the follow pane posts the share query with the entry's token and
  picks the one by id. A discussion the response no longer lists (hidden,
  archived, link expired since the list loaded) shows "This discussion is no
  longer available here." and Open document. `ponytail:` it fetches the whole
  document's discussions to show one; a per-thread read is the upgrade if a
  document's discussions ever make that slow.
- After a write the pane reloads that discussion and the list row updates in
  place (resolved status, read state); no full list reload.
- The pane does not render the document. The quote is the passage; Open
  document is for its surroundings.

## Keyboard

- `↑` / `↓` move the selection when focus is in the list, and focus and the
  pane follow. Every row stays a tab stop, as today. `Enter` on a row in the split layout selects;
  `⌘Enter` / `Ctrl+Enter` opens the document.
- **Open question for the user:** Linear also binds `j` / `k`. The contract
  (§10) lets single keys act on the page while no caret is in a field, so it is
  allowed; it is left out of this cut unless asked.

## Out of this cut

Archive / snooze an entry, grouping by document, a draggable divider,
rendering the document in the pane, and `j` / `k`.

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
the selected discussion side by side from a 44rem box, a plain list below it,
selection in the URL, nothing selected on arrival.
