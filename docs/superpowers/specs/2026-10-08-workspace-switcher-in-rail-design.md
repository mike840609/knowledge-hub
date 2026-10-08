# Workspace switcher in the rail, search in the explorer column

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
- **Search takes the 288px slot** the selector left, aligned with the
  explorer below it. It is drawn as a field (filled `bg-hover`, muted icon and
  placeholder, `⌘K` at its end), not a ghost button, and still opens the same
  palette. Its accessible name stays "Quick search". On narrow screens the slot
  keeps its narrow width and the field keeps its icon and "Search".
- The document title and its contextual actions keep their place after the
  search slot.

## Not changed

Shortcuts (`⌘K`, `/`, `⌘\`), the palette itself, the explorer's tree filter,
rail and explorer widths, and every authorization rule. The switcher remains
navigation, not an access check.
