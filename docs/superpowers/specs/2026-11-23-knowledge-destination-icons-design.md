# Knowledge destination icons

## Intent

Since #376/#377 Graph, Sources and Shares sat behind a "Knowledge ▾" disclosure in the
Knowledge header. Readers did not find them: nothing said the heading opened anything.
They become icon links that are always on screen.

## Decision

- The disclosure is removed. The Knowledge header's left side is a
  `nav "Knowledge destinations"` of icon links, on the same row as the explorer's
  Favorites, Recent, Filter and Options buttons, so the tree does not move down.
- The destination the reader is on (`aria-current` page or location, same matching as
  before) shows its icon and name with the neutral current fill. The others are icon
  only, named by tooltip and `aria-label`. On a page that is none of them (a document,
  Home, Inbox) all three are icons.
- Which links exist is unchanged (`knowledgeDestinations`): Sources needs
  `canInspectSources`, Shares a personal workspace with search.
- The collapsed 48px rail and the Menu drawer are unchanged: the rail still lists the
  three among its icons; the drawer hosts the same explorer header.

## Approaches considered

- Labelled rows above the tree: most discoverable, but pushes the tree down ~100px,
  undoing #377.
- A VS Code activity bar with switching panels: only Knowledge has a panel; a large
  structural change for a discoverability problem.
- Icons with the current one named (chosen, the reader's pick, Notion-like): one row, no
  vertical cost, all three visible.

## Not changed

Tasks, Insights and Settings stay where #377 put them (account / workspace menus when
expanded, rail icons when collapsed).

## Verification

`tests/unit/workspace-knowledge-navigation.test.tsx`; `tests/e2e/zz-explorer-collapse.spec.ts`
(visible icons, current name, one row at both densities, touch drawer).
