# Knowledge sidebar destinations — option A

## Intent

Move the document tree higher in the expanded workspace sidebar without shrinking controls, adding a navigation row, or removing any destination. The approved prototype uses `Knowledge ▾` in the existing Knowledge heading row. Its placeholder pages, simulated failure control, and custom HTML shell are not product features.

## Approaches

- **A · Knowledge disclosure (selected):** `Graph`, `Sources`, and `Shares` move to a labeled control in the Knowledge heading. Users spend one extra activation to reach them from the expanded sidebar; the document tree gets the space.
- **B · Keep Graph visible:** Keep Graph one activation away in the expanded sidebar and move only Sources and Shares into the disclosure. This leaves more fixed navigation above the tree.
- A naked ellipsis or an icon grid was rejected: one hides the meaning of the control; the other keeps unrelated destinations above the tree.

## Navigation contract

| Destination or action | Expanded desktop and drawer | Existing 48px rail |
| --- | --- | --- |
| Search | Existing Search row and shortcut | Unchanged |
| Home | Existing personal-only row | Unchanged |
| Inbox | Keep the existing single placement: expanded desktop header or drawer row, with the existing unread count | Unchanged |
| Graph | `Knowledge ▾` → `Graph`; same visibility as the existing Graph link | Unchanged |
| Sources | `Knowledge ▾` → `Sources`; existing `canInspectSources` gate | Unchanged |
| Shares | `Knowledge ▾` → `Shares`; existing `PERSONAL && canSearch` gate | Unchanged |
| Tasks | Personal Home → `Open Tasks`; link to the full Tasks page, not a new task preview | Unchanged |
| Insights | Personal Account menu → `Insights`; resolve existing `/profile` route | Unchanged |
| Settings | Workspace switcher → `Settings` for the current team with `canOpenSettings`; add before removing the old row | Unchanged |
| Document options | Existing `⋯`; keep `Import folder` and `Show archived` with their current rules | Unchanged |

Personal desktop has Search and Home above Knowledge, not counting the existing workspace switcher when teams are enabled. The personal drawer also keeps its Inbox row. On teams, keep the workspace switcher and Search, with no empty Primary landmark when there are no primary links. Do not add a second rail, a tab strip, or a footer row.

## States and interaction

- Title reads `Knowledge` normally; while visiting one of the destinations it reads `Knowledge / Graph`, `Knowledge / Sources`, or `Knowledge / Shares`. Visible text communicates location when closed. Match exact paths and slash-delimited descendants within the current workspace. Only exact links have `aria-current="page"`; a parent destination on a child URL uses `aria-current="location"`. Query strings do not change the route family. Home is not current on Tasks.
- Destinations are ordinary links in a nonmodal disclosure, not tabs or an ARIA menu. Keyboard activation opens it; Tab reaches the links, Escape closes it and restores focus. A normal link activation closes the drawer and hands off to the destination without leaving focus in a hidden panel; modified clicks still work like links. Reuse existing Base UI and the workspace drawer instead of porting the prototype shell.
- The Knowledge destination trigger stays available when source headers or a source tree cannot load. Keep the existing error message and Retry separate from the navigation. Preserve the one persistent explorer portal, folder state, selected document and scroll behavior when the drawer or routes change.
- Reuse sidebar tokens, control heights, touch targets and theme/density settings. Keep Account outside the tree scroll area and keep the Knowledge heading/actions in the same row; at narrow widths the popover must fit, and its full trigger label must remain accessible.

## Boundaries and acceptance

- No new dependencies, API, permissions, schema, product routes, or task queries. Keep server authorization, import rules, and ⌘K commands unchanged.
- Preserve existing tests for workspace switching, Inbox, the explorer and document options; update tests and EN/ZH help that point at a moved entry.
- Verify personal desktop, 48px rail, authorized and restricted team, 390px drawer, exact and nested paths, and a source-header error. Compare the same tree at the same viewport and density; check that the task of reaching the first document needs less vertical space instead of treating the prototype's pixel annotation as a shipping target.
