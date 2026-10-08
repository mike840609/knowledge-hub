# Workspace switcher and search in the rail

Amends the topbar order fixed by `2026-10-02-linear-remediation-design.md`
("brand/collapse region, separate workspace selector, then Search"). That
sentence is superseded by this document; the rest of the remediation stands.

## Problem

The topbar read as four clusters of equal weight in one row: the wordmark, a
288px workspace selector, a ghost "Search" button and — once a document
header scrolls away — the document's title and actions. The selector, the
least-used control (Team workspaces are not yet open, so it usually offers one
place), took the widest and most prominent slot. The Search button sat right
after it in the same ghost style and read as a second dropdown rather than a
search field.

## Decision

- **The wordmark stays.** The brand/collapse region (160px, 48px collapsed) is
  unchanged and still carries "Knowledge Hub" alone; the brand mark rules in
  the design language are untouched.
- **The workspace switcher moves to the top of the primary rail**, above the
  navigation it scopes, separated from it by spacing rather than a rule. In
  both rail states it carries the workspace's mark — the name's first letter
  in a small square. Expanded, the mark is followed by the name and a chevron,
  without the "Workspace" caption; collapsed (48px) the mark stands alone, with
  the name in a tooltip. Its accessible name stays `Workspace: <name>` and its menu is the
  same menu, Team "Coming soon" row included — what it offers does not change.
- **On narrow screens** the switcher is the first thing in the Menu drawer,
  above primary navigation. The topbar no longer carries it at any width.
- **Search is the rail's second row**, under the switcher and above the
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
- The topbar is now the brand/collapse region followed by the document title
  and its contextual actions.

## Not changed

Shortcuts (`⌘K`, `/`, `⌘\`), the palette itself, the explorer's tree filter,
rail and explorer widths, and every authorization rule. The switcher remains
navigation, not an access check.
