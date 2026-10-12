# The owner's discussions, beside the article

## Intent and agreed product direction

A reader of a shared page sees discussions the way Google Docs shows them: a
card beside the passage it is about (#168). The document's owner, reading the
same document in the workspace, got them as a collapsed list under the article,
with nothing tying a card to its passage.

Agreed with the user on 2026-10-12:

- **The owner's discussions are a rail on the right, aligned to their
  passages**, as on the shared page.
- **The rail takes the outline's place.** While it is open the outline is shown
  above the article, as it already is in a narrow pane.
- **Collapsed by default** — amended the same day, below: open on arrival where
  a discussion awaits the owner.

Success means an owner can read a remark beside the sentence it is about, on
the page they already use, and that a document nobody has commented on looks
exactly as it did.

## Behaviour

**Open on arrival.** Asked whether the rail should simply be open by default,
the answer agreed on was narrower. The owner opens a document that has been
commented on largely to read the comments, and a 28px mark is easy to miss; but
a rail that is always open is an empty column on a document nobody has remarked
on, a column of history on one where everything is settled, and it costs the
outline its place every time. So:

- The rail opens by itself when the document is opened **if a discussion awaits
  the owner**: one that is open (not resolved) and that the owner has not
  hidden.
- **Only as a rail.** Where the discussions would be a drawer, they wait to be
  asked for: a drawer would cover the article.
- **Closing it is remembered**, per document, as the discussions it was closed
  on (`localStorage`, `kh:review-dismissed:<document>`). It stays closed on
  those, and opens again when a discussion arrives that was not among them.
  Opening it by hand forgets the closing.
- It is decided once, when the discussions first load. Resolving the last one
  does not close the rail under the owner's hands; the next visit finds it
  closed.
- It sets the open state and nothing else: it does not move focus or scroll.

The shared page is not changed. Its readers came for the article, most will
never comment, and #168 chose reading first over an ever-present rail there.

The rule is `opensOnArrival` in `review-auto-open.ts`.

**What is open, first.** Asked what to do when there are many discussions: the
rail keeps cards in document order without overlap, so a passage with several —
or a document with a long history — pushes cards down, away from what they are
about. Most of that crowd is settled. So the owner's list **starts on Open**
where anything is open; resolved discussions are under the filter that was
already there (All comments, Open, Resolved).

- With nothing open the list starts on **All comments**: an empty list would
  say there was nothing at all.
- The Comments entry still counts every discussion.
- A mark or a highlight on a passage whose discussion is resolved switches the
  list to All, as it always did, so it still leads somewhere.
- Resolving a discussion while the list is on Open takes its card out of the
  list; Reopen is under Resolved.

The shared page starts on All comments, as before: its readers are shown the
discussion whole.

Not done, and why: stacking the discussions of one passage into a single card
is the next step if one passage draws many; a rail with a scroll of its own is
no step at all, because then no card can be level with its passage.

**Collapsed.** The article, and the outline beside it where the pane is wide
enough. A passage with a discussion is highlighted and has a count in the
article's right margin. In the document's header, beside Edit, a comments
control showing the count.

**The way in is the header's.** It was first a row above the article, which had
two costs: it did not travel with the reader, so in a long document a closed
rail could only be reopened from a mark; and it appeared when the discussions
loaded, moving the article down. The header is pinned on a wide screen and was
already there. The panel publishes its count and state through
`review-entry.tsx` and the header draws the control and receives focus back on
closing.

**Opening** — the entry, a mark, or a highlighted passage. Where the document
pane is at least 60rem wide, the rail (320px) appears to the right of the
article and the outline moves above it. Cards are in document order, level with
their passages where the cards above leave room, the selected one first; an
unselected card is a preview and opens on activation. Escape, the entry, or the
rail's collapse button closes it and puts the outline back.

**Where the pane is narrower**, the same discussions open in the drawer the
shared page uses, over the article.

**What the owner may do is unchanged:** reply, resolve and reopen, hide a
thread or a comment. An owner does not start a discussion, so there is no
"Add comment" here.

**A document with no discussion** shows no comments control and reserves no
margin for marks. The control appears in the header once the discussions have
loaded and there is at least one; nothing moves when it does.

## The pane decides, not the window

On a shared page the question "is there room for a rail?" is a matter of the
window: at 1200px, yes. In the workspace the article shares the window with the
primary rail, the explorer and the inspector, any of which may be open, so the
window says nothing about the room the article has — the same reason the
outline is placed by a container query.

So the rule is the outline's own: **a rail where the document pane is 60rem or
wider.** That is exactly where the outline rail exists, which is what "takes
the outline's place" means. With the explorer open that is a window of about
1440px; with it closed, about 1000px.

Five places asked the window (`matchMedia("(min-width: 1200px)")`): the drawer
shell, the card layout, the highlight handler and two in the shared panel. They
now ask one function, which asks the stylesheet:

- `--review-rail` on `.kh-review-document` is `drawer`, or `inline` — set by a
  media query under `.kh-share-page` and a container query under
  `.kh-document-pane`.
- `review-rail-mode.ts` reads it (`reviewRailInline`), watches the window and
  the pane for changes, and the panels mirror it as `data-review-inline`.
- The rail's layout keys on `[data-review-inline][data-review-open]`, for both
  pages.

The stylesheet is the one place that knows where there is room.

## Layout in the workspace

Open and inline:

- every `.kh-reading-column` in the pane takes the wider measure (reading +
  320px), so the title, the outline disclosure and the article keep one left
  edge;
- the outline rail is hidden and the outline disclosure shown;
- what follows the article in its column (backlinks) stays the article's width.

The article is given the 32px right margin the marks need only when it has a
mark.

## Shape of the change

- `src/components/knowledge/review-rail-mode.ts` — new; the one answer to
  "rail or drawer".
- `owner-review-panel.tsx` — rebuilt from the shared page's parts
  (`ReviewPassageMarkers`, `ReviewPanelShell`, `ReviewThreadList` in rail
  mode); it now wraps the article.
- `review-panel-shell.tsx`, `review-rail-layout.ts`, `review-highlights.ts`,
  `shared-review-panel.tsx` — ask `review-rail-mode` instead of the window.
- `globals.css` — the rail's rules restated around `data-review-inline`, plus
  the workspace's.

The rail's classes were `kh-shared-*` while only the shared page used them. They
are `kh-review-document`, `kh-review-reading` and `kh-review-panel` now that the
workspace does too.

## Not in this change

- The owner starting a discussion.
- The rail and the outline side by side on a very wide pane.
- The control in the narrow topbar's copy of the header's actions. On a narrow
  screen the header is not pinned; the marks on the passages are the way in.

## Tests

`tests/unit/review-auto-open.test.ts`: when the rail opens by itself — awaiting,
resolved, hidden, closed-on, and a discussion arriving after a closing.

`tests/e2e/owner-review.spec.ts`: the control in the header, on Edit's row and
still in view at the end of a long document; the article not moving when the
discussions arrive; the rail's name and controls on one row; the rail open on arrival without taking the
scroll position; staying closed after a closing and opening for a new
discussion; resolved discussions and a narrow pane not opening it; the list starting on
Open, on All where nothing is open, and a mark leading to a resolved discussion;
the rail beside the article and level with
its passage, in the outline's place, and the outline back on collapse; one left
edge for the title and the article, open or not; the drawer in a narrow pane; a
document without discussions unchanged; and the owner's reply, resolve and hide
through the new entry. `tests/e2e/review-layout.spec.ts` — the shared page's
existing layout tests — hold the refactor of the five window checks.
