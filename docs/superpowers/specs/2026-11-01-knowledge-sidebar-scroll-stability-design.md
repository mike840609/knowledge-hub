# Recent documents as an on-demand menu

## Intent and decision

The user clarified that the problem is items changing position inside Recent,
not Favorites or the article pane. They selected moving Recent out of the
permanent sidebar list into a clock-button menu on 2026-11-01. This replaces the
previous design about navigation intent and tree positioning. This short written
design is pending approval before implementation.

## Approaches

- **Clock-button menu (selected):** remove the inline Recent section, open history
  on demand, and close it when an article is chosen. This removes the shifting
  list from everyday browsing and gives the document tree more room.
- **Keep an inline list with stable order while expanded:** reduces movement but
  adds deferred-refresh behavior to a section the user prefers to remove.
- **Keep live ordering and include the current article:** prevents disappearance
  of that article but still shifts other rows, so it does not solve the complaint.

## User-visible behavior

- Favorites and source/document trees remain in the sidebar. Recent no longer
  occupies a section there and has no separate Show all row.
- Add a clock button labeled **Recent documents** to the Documents header toolbar,
  before the filter control. Use the existing icon-button, tooltip, and menu
  primitives so it works with pointer, keyboard, and touch.
- Opening the menu shows the latest available recent documents, newest first,
  with document icons/titles and source names. Show all eligible entries from
  the existing history (up to eight recorded documents), without a second menu.
- Choosing an article navigates to it and closes the menu. Reopening shows the
  updated history. Do not continuously reorder an open, populated menu under the
  pointer; async loading must still be able to finish and inaccessible entries
  must not remain actionable.
- Keep the clock button discoverable when history is empty; show **No recent
  documents** in the menu. Distinguish loading and failed metadata lookup from
  a genuinely empty history, using existing retry behavior where appropriate.
- Preserve current eligibility rules (workspace/access/archive visibility and
  exclusion of favorites and the currently open article), link semantics, and
  the existing read-only descriptions and indicators.

## Scope and constraints

Continue recording history and use the existing shortcut metadata, links, and
shared menu components. No API, database, dependency, history-limit, or sidebar
width changes. Remove obsolete inline Recent expansion/readiness state and its
count from the tree reveal layout key because it no longer changes tree layout.
The old persisted Recent expansion preference can remain unused in storage.

Do not add Show in document tree, split the sidebar into separate scrollers,
freeze the permanent history order, or redesign the tree's general positioning
behavior. Do not change Favorites or article-pane scrolling.

## Verification and implementation discretion

Replace the test for four inline recents plus Show all with behavioral checks:
no inline Recent list; clock opens eligible recent links; selection closes the
menu; reopening reflects updated history; open-menu ordering stays stable; and
empty/loading/error behavior remains distinguishable. Check keyboard activation,
Escape dismissal, source/read-only cues, and existing Favorites behavior.

Verify in a browser that successive article visits no longer produce an inline
Recent list whose rows change position, and that the header/menu fit the existing
sidebar and drawer. Report any unavailable browser verification honestly.
Internal component/state structure and exact popup sizing are implementation
choices within the existing design system.
