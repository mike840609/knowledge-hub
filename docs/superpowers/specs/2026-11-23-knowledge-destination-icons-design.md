# Workspace page switch

## Intent

Since #376/#377 Graph, Sources and Shares sat behind a "Knowledge ▾" disclosure in the
Knowledge header, and readers did not find them. A first pass made them icons on the
explorer's tool row; they then read as more tools beside Favorites, Recent, Filter and
Options. This design gives the four workspace pages — Home, Graph, Sources, Shares — one
switch of their own under Search, and gives the explorer back a plain heading.

## Decision

- **Where.** In the expanded sidebar (desktop and the Menu drawer) the `Primary` navigation
  holds, in order: the drawer's Inbox row (the desktop header owns Inbox otherwise), then
  the page switch. The Home row is gone; Home is the switch's first item.
- **Look (Notion-like).** A track (`bg-switch-track`, `rounded-lg`, 2px inset) with one item
  per page. The current page is a raised item (`bg-switch-thumb`) with its icon and name in
  `text`; the others are icon-only in `text-muted`, share the remaining width, and name
  themselves by tooltip and `aria-label`.
- **What is current.** Each item is a link with `aria-current` `page` or `location`, matched
  as before (exact path, or a path below it; `/sources-extra` is not Sources). On a page that
  is none of them — a document, Inbox, Tasks, Settings — nothing is raised and the switch is
  four icons on the track.
- **Which items.** Home for a personal workspace; then `knowledgeDestinations` unchanged:
  Graph always, Sources with `canInspectSources`, Shares in a personal workspace with search.
  A team sees Graph and, with the right, Sources.
- **Explorer header.** The tool row starts with a muted `Knowledge` heading, then Favorites,
  Recent, Filter and Options as before.
- **Unchanged.** The collapsed 48px rail lists Home, Graph, Sources, Shares, Tasks, Insights
  and Settings as icons, as it did. Search stays a navigation-styled row without a frame.

## Tokens

Two colour tokens, light / dark: `--kh-switch-track` `#e4e7ec` / `#1d1f24` and
`--kh-switch-thumb` `#ffffff` / `#33363e`. In dark the raised item must be lighter than the
track, which no existing surface token is. `tests/unit/button-contrast.test.ts` holds the
current name to 4.5:1 on the thumb and the idle icons to 3:1 on the track.

## Relation to the control vocabulary

The contract reserves the segmented look for parameters of one page. This switch borrows
the look for navigation between pages, as a recorded exception limited to the sidebar's
top-level pages: it is links with `aria-current`, never `role="tab"`, and it does not swap
a panel — the tree below stays the same on every page.

## Approaches considered

- Icons on the explorer's tool row (first pass): read as tools.
- Labelled rows above or below the tree (Linear / Notion bottom group): clear, but cost one to
  three rows of tree.
- Underline tabs: compliant, but on a document page the strip reads as unfinished, and four
  labels crowd 272px.
- A frameless icon row under Search: hard to tell from Search itself.
- **A Notion-style switch (chosen by the reader)**: one row, no tree moved down, distinct from
  Search and from the tools.

## Verification

`tests/unit/primary-nav-tasks.test.tsx` (order, current name, location, nothing raised,
capabilities, team), `tests/unit/workspace-knowledge-navigation.test.tsx` (the heading),
`tests/unit/button-contrast.test.ts`; `tests/e2e/zz-explorer-collapse.spec.ts` (names, one
line at both densities, collapsed rail, touch drawer) and the specs that open a page through
it (`fixtures/knowledge-destinations.ts`).
