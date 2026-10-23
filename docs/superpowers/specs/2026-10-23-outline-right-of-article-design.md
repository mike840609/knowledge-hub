# The outline is always right of the article

Supersedes the outline's placement in the owner-comments-rail spec's 2026-10-21
amendment ("the outline stays where the pane holds all three"), its base
placement rule and Tests paragraph ("the rail takes the outline's place"), and
the share-page-outline spec §2, §4 and §6. Amends the frontend design
language's description of the owner's reader. Everything else in those
documents stands.

## Why

The workspace outline sat right of the article in a pane narrower than `88rem`
and left of it from `88rem`. The pane, not the window, decides, so actions that
have nothing to do with the outline moved it across the article: hiding the
explorer widens the pane by 248px, collapsing the primary rail by 112px, opening
Details narrows it by 320px. Between windows of about 1625px and 1875px — 1680,
1728 (a 16-inch laptop's default) and 1792 among them — hiding or showing the
explorer flips the outline's side. A reader finds the outline where they last
saw it; one that moves on an unrelated action has to be looked for again, and on
the left, beside the explorer, it reads as a fourth level of the file tree.

Three placements were weighed:

- **Always left.** Beside the explorer the reader crosses three similar lists —
  primary navigation, document tree, headings — before the text. Rejected.
- **Left on the shared page, right in the workspace.** Each page is stable, but
  an author checks their shared link and a member opens one; the outline's place
  relative to the article would depend on which page they are on. Rejected.
- **Always right, discussions between article and outline.** Chosen. It is the
  one side free on both pages.

Why discussions sit between and not outside: a discussion card is placed level
with its passage and scrolls with the text; the reader matches the two by
looking across. The outline is sticky and belongs beside no particular line. Put
between, it would lengthen that look by its 224px and hold still while the cards
on both sides of it move. Opening discussions moves the outline outward once, by
the reader's own action on the same side; a card far from its passage costs every
moment the discussions are open.

## The rule

On both pages, left to right: **article · discussions (when open) · outline**.
The outline never appears left of the article.

Where there is not room for every column, the outline gives way first: it folds
into the disclosure above the article (`OutlineDisclosure`, unchanged). The
discussions keep their own rule for rail versus drawer (`--review-rail`,
unchanged).

## The article narrows before anything moves

Running text is held to `max-w-measure` (40rem, 640px) inside the 860px reading
column, which also carries 24px of padding each side (`kh-reading-column`,
`px-6`); only tables, code and diagrams use the rest. So the article's box can
narrow to **688px** (640 + 2 × 24) without one line of prose rewrapping. When it
has discussion marks it keeps their 32px right margin inside that box, and at the
floor its text is 608px wide.

When the discussions open, the column holding the article keeps its left edge and
the article narrows from the right, down to 688px, before the column moves. Wide
blocks get narrower; prose does not. Below that the column slides left (the
existing 120ms `margin-inline-start` transition) only as far as keeps the article
at 688px. The outline folds into the disclosure only where even a column at the
pane's left edge cannot hold article, discussions and outline.

The path line and the header keep their width and left edge, so Edit, Share,
Comments and Details stay under the pointer whenever the column does not slide.

## Workspace geometry

The outline stays where it already is below `88rem`: the `kh-outline-rail`
sibling (`w-56`, 224px) right of the column's flex area, reserved even for a
document without headings. `kh-outline-rail-left` and the `88rem` container query
are deleted.

Let *A* be the flex area left of the outline slot (pane − 224px).

- Discussions closed: unchanged. Outline rail from a `60rem` pane, disclosure
  below.
- Discussions open, pane ≥ `77rem` (1232px = 224 + 688 + 320): the outline rail
  stays. The column's start margin is `max(0, min((A − 860) / 2, A − 1008))`; the
  column holding the article is `min(1180px, A − margin)` wide, the discussions
  320px of it, so the article is ≥ 688px. Nothing slides from a 1380px pane;
  between 1232px and 1380px the column slides up to 74px.
- Discussions open, pane < `77rem`: the outline rail hides and the disclosure
  shows, as today below `88rem`. The flex area is then the whole pane; the start
  margin is `max(0, min((pane − 1084) / 2, pane − 1008))` — the left edge the
  column had beside the outline slot, moved only as far as keeps the article at
  688px.

With the primary rail (176px) and explorer (288px) both open, all three columns
meet from a window of about 1700px; with both collapsed, from about 1320px.

## Shared page geometry

The shared page is the whole window, its column centred in it.

- The outline rail hangs off the right edge of a zero-height sticky box, as today
  off its left: the rail `absolute left-full w-52` instead of `right-full`. It
  sticks below the pinned Comments bar, as today.
- The box sits inside the reading part of the discussions' layout. While the
  discussions are open inline it is made as wide as reading part and discussions
  together (`width: calc(100% + 320px)`), so the rail hangs off the right edge of
  the discussions, not over them.
- Rail from a `82rem` window (the centred column leaves the 208px rail and a 16px
  edge on its right), disclosure below: the same threshold, mirrored.
- With discussions open inline, from `82rem`: the start margin is
  `max(0, min((100% − 860px) / 2, 100% − 1232px))` (688 + 320 + 224), and the
  discussions' layout is `min(1180px, 100% − margin − 224px)` wide, leaving the
  outline its room. Nothing slides from a 1604px window; at 82rem the column
  slides up to 146px. Below `82rem`, with no outline rail to make room for, the
  terms are `100% − 1008px` and `100% − margin`. The `@media (max-width:
  87.99rem)` fold is deleted.

## Not in this change

- The narrow-window layout, the disclosure, the outline's content and its
  following of the reader.
- When discussions are a rail or a drawer (`--review-rail`): `60rem` pane in the
  workspace, 1200px window on the shared page.
- Merging the primary rail and explorer into one column. It would only lower the
  workspace thresholds above; it is a navigation question for its own spec.

## Acceptance

Tests describe outcomes, not class names.

Workspace (`tests/e2e/owner-review.spec.ts`, `tests/e2e/reading-loading.spec.ts`):

- At a window of 1728px, the outline's left edge is right of the article's right
  edge with the explorer shown and with it hidden.
- At a window of 2000px (pane past 1380px), the outline is right of the article
  and still right of it with discussions open, with the discussions between.
- Opening and closing discussions at windows of 2400px and 1440px leaves the
  article's left edge and the path line's controls where they were.
- At a pane of 1100px with discussions open, the outline is a disclosure above
  the article and never left of it; its paragraphs are at least 608px wide.

Shared page (`tests/e2e/zz-share-outline.spec.ts`):

- At 1440px the outline rail is right of the article; with comments open it is
  right of the comments rail, stays on screen, and its paragraphs are at least 608px wide.
- At 1280px the outline is the disclosure.
- Opening comments at 1680px leaves the article's left edge where it was.

Both: no viewport width puts the outline left of the article.
