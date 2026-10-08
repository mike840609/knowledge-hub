# The rail carries the shell; wide screens drop the topbar

Amends `2026-10-02-linear-remediation-design.md` in two sentences — the topbar
order ("brand/collapse region, separate workspace selector, then Search") and
the reader's contextual actions staying "in the topbar" — both superseded by
this document. The rest of the remediation stands.

## Problem

The topbar read as four clusters of equal weight in one row: the wordmark, a
288px workspace selector, a ghost "Search" button and — once a document
header scrolls away — the document's title and actions. The selector, the
least-used control (Team workspaces are not yet open, so it usually offers one
place), took the widest and most prominent slot. The Search button sat right
after it in the same ghost style and read as a second dropdown rather than a
search field.

## Decision

- **Wide screens (≥1024px) have no topbar.** Once the switcher and Search had
  moved into the rail, the topbar held only the wordmark, the collapse control
  and — after the document header scrolled away — the document's title and
  actions; on every other page it was an empty band. It is removed at that
  width, and rail, explorer and content all start at the top of the window.
- **The wordmark stays, at the head of the rail.** The rail's first row is
  "Knowledge Hub" with the collapse control at its end; collapsed (48px), the
  control alone. The brand mark rules in the design language are untouched.
- **The reader's breadcrumb line is pinned on wide screens.** The document
  header's first line — location › title, with Edit / Share / Details — sticks
  to the top of the reading column while the rest of the header scrolls away.
  Once it has, its lower edge is a short fade (`.kh-fade-below`, 16px from
  `--kh-bg` to transparent) rather than a rule, so the text passes softly under
  it. It replaces the topbar's scrolled-away
  copy of the title and actions, so the reader never loses where they are.
  (`DocumentTopbarContext` still carries the document's state; the palette and
  the narrow topbar read it as before.) *(The first revision of this change laid
  a separate title bar over the pane once the header scrolled away; pinning the
  breadcrumb itself keeps the path in view and shows one bar, not two.)*
- **Narrow screens keep a topbar**: Menu, the wordmark (≥640px), a search icon,
  and, once the header scrolls away, the document's title and actions
  (`DocumentContextBar`); the breadcrumb is not pinned there. The palette
  stays mounted there, once, at every width.
- **The workspace switcher moves to the top of the primary rail**, above the
  navigation it scopes, separated from it by spacing rather than a rule. In
  both rail states it carries the workspace's mark — the name's first letter
  in a small square. Expanded, the mark is followed by the name and a chevron,
  without the "Workspace" caption; collapsed (48px) the mark stands alone, with
  the name in a tooltip. Its accessible name stays `Workspace: <name>` and its menu is the
  same menu, Team "Coming soon" row included — what it offers does not change.
- **On narrow screens** the switcher is the first thing in the Menu drawer,
  above primary navigation. The topbar no longer carries it at any width.
- **Search is the rail's row after the switcher**, under it and above the
  navigation, drawn like a navigation item (search icon, "Search", `⌘K` at its
  end); collapsed it is the icon alone with "Search ⌘K" in a tooltip. It opens
  the same palette, which stays mounted once in the topbar and owns its dialog
  and shortcuts; the row asks for it by event (`kh:open-search`). Its accessible
  name stays "Quick search". On narrow screens, where the rail is not on screen,
  the topbar keeps a search icon button with that name.
  *(An earlier revision of this document put Search in the topbar's 288px slot
  as a filled field. It read as the loudest thing in an otherwise empty bar, and
  the explorer it aligned with exists only on document pages; it was replaced
  the same day.)*

## Not changed

Shortcuts (`⌘K`, `/`, `⌘\`), the palette itself, the explorer's tree filter,
rail and explorer widths, and every authorization rule. The switcher remains
navigation, not an access check.
