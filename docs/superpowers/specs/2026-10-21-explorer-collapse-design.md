# Knowledge explorer: collapse to a strip

**Superseded** by [2026-10-27-one-sidebar-design.md](2026-10-27-one-sidebar-design.md):
the explorer is now part of the one sidebar, and its strip, Hide/Show documents and
`kh:explorer-collapsed` are gone. Kept as architecture history.

Amends the frontend design language ("The Knowledge explorer beside it has no
collapse"). Desktop (`lg` and up) only; the narrow window's menu is unchanged.

## Why

A document pane of 88rem shows outline, article and the owner's discussions side
by side (owner-comments-rail spec, 2026-10-21 amendment). Beside the 176px primary
rail and the 288px explorer that needs a window of about 1870px, so on a laptop the
three never meet. The primary rail already collapses to 48px; the explorer is the
remaining 288px.

## Behaviour

- The explorer's header ends with **Hide documents** (`ChevronsLeft`). Pressed,
  the explorer becomes a 40px strip in its place — same `bg-explorer` and right
  border — holding one button, **Show documents** (`FolderTree`), which restores
  it. Not the panel glyphs: those are the primary rail's, and collapsed the two
  sit side by side. Focus moves to the button that replaces the one pressed.
- Collapsed is remembered in this browser (`kh:explorer-collapsed`, as
  `kh:nav-collapsed` is). The tree stays mounted while hidden, so open folders, the
  filter and favourites are as they were when it is shown again.
- Under `lg` the explorer is in the navigation menu, where it is never collapsed and
  offers no Hide documents.
- No shortcut: ⌘\ remains the primary rail's. One can be added if wanted.

## Geometry

Primary rail collapsed (48px + 1px border) and explorer strip (40px + 1px) leave a
1512px window — a 14-inch laptop's default — a 1422px pane, past 88rem: outline,
article and discussions side by side. 1440px stays short (1350px) either way; a
zero-width explorer would reach only 1456px, and would need its way back placed
outside itself, so the strip costs nothing that matters.

## Acceptance (`tests/e2e/zz-explorer-collapse.spec.ts`)

- Hide documents leaves the strip and focuses Show documents; the pane widens by the
  explorer's width less the strip's; a reload keeps it collapsed; Show documents
  restores the explorer, focuses Hide documents, and a reload keeps it shown.
- At 1512px with the primary rail and the explorer collapsed, a document with
  discussions shows outline, article and discussions side by side.
- The narrow window's menu shows the explorer without Hide documents.
