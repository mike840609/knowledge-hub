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
- **Collapsed by default.** Reading first; a mark on each passage that has a
  discussion, and a Comments entry, open it.

Success means an owner can read a remark beside the sentence it is about, on
the page they already use, and that a document nobody has commented on looks
exactly as it did.

## Behaviour

**Collapsed.** The article, and the outline beside it where the pane is wide
enough. A passage with a discussion is highlighted and has a count in the
article's right margin. Above the article, at the right, `Comments (N)`.

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

**A document with no discussion** shows no Comments entry and reserves no
margin for marks. The entry appears once the discussions have loaded and there
is at least one, which moves the article down by the entry's height on such a
document. Reserving the row on every document, to avoid that, would put an
empty band above every article for the sake of the few with comments.

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

- `--review-rail` on `.kh-shared-document` is `drawer`, or `inline` — set by a
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

The class names keep `shared` in them (`.kh-shared-document`,
`.kh-shared-review-panel`) though the workspace uses them now; renaming them is
a change to the shared page's tests and documents for no change in behaviour.

## Not in this change

- The owner starting a discussion.
- The rail and the outline side by side on a very wide pane.
- A Comments control in the document header, which would be constant chrome and
  spare the entry row.

## Tests

`tests/e2e/owner-review.spec.ts`: the rail beside the article and level with
its passage, in the outline's place, and the outline back on collapse; one left
edge for the title and the article, open or not; the drawer in a narrow pane; a
document without discussions unchanged; and the owner's reply, resolve and hide
through the new entry. `tests/e2e/review-layout.spec.ts` — the shared page's
existing layout tests — hold the refactor of the five window checks.
