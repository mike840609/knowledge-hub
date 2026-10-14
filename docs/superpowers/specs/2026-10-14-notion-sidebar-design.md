# One sidebar

**Status:** agreed with the user on 2026-10-14; built by
[../plans/2026-10-14-notion-sidebar.md](../plans/2026-10-14-notion-sidebar.md).
Where the build differs from what was drafted, a **Built:** note sits in the
section, and the text above it is left as drafted. Latency of entering a
workspace: [2026-10-14-notion-sidebar-latency.md](../verification/2026-10-14-notion-sidebar-latency.md).

## Intent

A wide window shows two navigation columns today: the primary rail
(`components/shell/app-shell.tsx`, `w-40`: wordmark, workspace selector, search,
Home/Knowledge/Graph/Sources/Shares/Insights/Settings, user menu) and, on
Knowledge pages only, the Knowledge explorer beside it
(`components/knowledge/knowledge-layout.tsx`, `w-72`: Favorites, Recent, and a
tree per source). They have different backgrounds (`bg-sunken`, `bg-explorer`).

This replaces both with one sidebar, modelled on Notion's: navigation and the
document tree in a single column that is on screen on every workspace page, a
width the reader drags, a sidebar that collapses away entirely and peeks back
when the pointer reaches the left edge, and row and section controls that show
on hover.

Success means: the tree, Favorites and Recent are on Graph, Home, Settings and
every other workspace page, not only Knowledge; there is one sidebar component,
used by the wide layout and the narrow drawer alike; collapsing it gives the
page its full width; and no authorization rule, route or persisted preference a
reader already has changes meaning.

## Decisions

1. **One column, not two** (asked; alternatives were a restyle of the two
   columns, and an icon-only primary rail beside the explorer).
2. **The tree's data moves up to the workspace layout** (asked; approach A).
   The alternatives were a client fetch of the tree outside Knowledge pages
   (two data paths, a loading flash on leaving Knowledge, a new API) and a tree
   on Knowledge pages only (which gives up the point of the change).
3. **The Knowledge navigation item goes.** The tree is the Knowledge
   navigation. The `/w/:id/knowledge` route stays: it is the redirect entry
   point other links use.
4. **Low-frequency destinations scroll after the tree; they are not pinned to
   the bottom** (raised by the user). A pinned group either floats far below a
   short tree or takes ~200px from a long one. Only the user menu, one row, is
   pinned.

## Layout

```text
┌─────────────────────────────┐
│ [▣ My Space ▾]          ⇤   │  header, fixed; ⇤ on hover
│  🔍 Search            ⌘K   │  fixed
│  🏠 Home                    │  (personal workspaces)
│  ◎ Graph                    │
├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤  one scroll region from here
│ Favorites                   │
│ Recent                      │
│ Documents          ⧩ ⋯ +   │  controls on hover
│   ▾ Notes               +  │
│     ▸ Folder          + ⋯  │
│       · Doc           ☆ ⋯  │
│   ▸ Synced source           │
│                             │  16px gap, no rule
│  ⛁ Sources                  │  each where its permission allows,
│  ⇪ Shares                   │  as today
│  ◔ Insights                 │
│  ⚙ Settings                 │
├─────────────────────────────┤
│  👤 Name                ⋯  │  the only pinned row
└─────────────────────────────┘
```

- The header is the workspace selector; the "Knowledge Hub" wordmark goes.
- Which items appear is decided by the conditions `PrimaryNav` uses today,
  unchanged; the list is split into a `top` group (Home, Graph) and a `bottom`
  group (Sources, Shares, Insights, Settings).
- The whole sidebar is `bg-sunken`. `--bg-explorer` is retired.
- Below 1024px the drawer holds the same sidebar component.
- Not built: Notion's Inbox, Trash and Teamspaces. Nothing here corresponds to
  them.

**Built:** every source section the reader has not toggled opens by default, on
every route (`expanded[id] ?? true` in `source-sidebar.tsx`), not only the
current source's (the mockup shows ▸ for a source); a toggle is kept per workspace in `kh:tree-expanded:<workspaceId>`.

## Width, collapse and peek

**Width.** Default 256px; dragged between 220px and 400px; double-click the
handle for 256px. Kept in `localStorage` as `kh:nav-width` through
`usePersistedJson`; an unreadable or out-of-range value falls back to the
default or is clamped. While dragging, width lives in React state and is
written once on release, and the width transition is off.

The handle is a 4px strip on the right edge with `col-resize` and a
`border-strong` line on hover. It is `role="separator"`,
`aria-orientation="vertical"`, `aria-valuenow/min/max`, focusable, and ←/→ move
it 16px.

**Collapse.** Collapsed is width 0: the 48px icon rail and every component's
`compact` mode go. An expand button (») floats at the top left of the main
area, on the 48px top line pages already share; while collapsed, that line
gives way 48px on the left through a `data-nav-collapsed` attribute on the
shell, so pages are not edited one by one. ⌘\ and the palette's "Toggle
navigation" behave as today. The state stays in `kh:nav-collapsed`, so a
reader's existing choice keeps.

**Peek.** Only while collapsed, and only where `(hover: hover)` matches. The
pointer entering an 8px strip at the window's left edge, or resting on », slides
the sidebar in as an overlay (`shadow-popover`) above the content, which does
not move. It leaves about 300ms after the pointer does, not while a menu opened
from it is open, and at once on Esc. » or ⌘\ while peeking pins it open. Peek
is an accelerator for a pointer; the keyboard path is ⌘\ and », which do
everything peek does.

Motion uses the contract's duration tokens and is off under
`prefers-reduced-motion`.

**Built:** four details differ from the draft's wording.

- The frame keeps an in-flow placeholder (the only thing that holds the column
  in the page's flow), and the `aside` is `fixed` whenever collapsed, even at
  width 0, so a dismissed peek never puts it back in flow and pushes the page.
- The 8px strip and » start a peek on `pointermove`, not on entry: after Esc the
  pointer is still over them, and the boundary event the layout change fires
  would bring the sidebar straight back.
- Esc closes the innermost layer: while a menu opened from the sidebar is open
  (`[data-popup-open]` inside it), Esc closes the menu and leaves the peek.
- `data-nav-collapsed` is on `<main>`, and the 48px give-way applies to
  `[data-top-line]`, which is on the page header (`page-header.tsx`), the
  document header and the composer's top row, the three rows that sit on the
  top line.

Not built: collapsing automatically by window width (below 1024px is already
the drawer), and keeping width on the server.

## Rows and section headers

Rows stay `md` (32px) with `sm` (24px) controls (contract, "Rows sit on the
ladder too"). Hover reveal is the existing `.kh-row-action`
(`app/globals.css`), which already shows on `focus-within`, while a menu from
it is open, and always on touch.

- **Folder row** in a Hub-managed source: `+` and `⋯` on hover. `+` opens a
  small menu of the existing `folder.new-document` and `folder.new-folder`
  actions.
- **Document row:** ☆ and `⋯`, as today. A document holds no children, so it
  has no `+`. This is where the model differs from Notion's, and it is the
  model's difference, not the sidebar's.
- **Notes source row:** `+` on hover, the same menu at the top of Notes. The
  two buttons always shown there today become hover-only. A source-managed
  source never shows `+`.
- **Section headers** (Favorites, Recent, Documents) stay `caption`, medium,
  `text-muted`. The whole header still toggles with `aria-expanded`; its
  chevron moves to the right and shows on hover. The Documents header's filter,
  `⋯` (Show archived) and `+` show on hover, and stay shown while the filter is
  open or a menu is.
- **Current place:** a navigation item keeps `bg-hover-strong` and neutral
  text; the current document keeps `bg-selected` and the accent. One accent
  block on screen, as §8 of the contract requires.

No type, radius, shadow or duration token is added.

## Data and components

**Data.** `getWorkspaceExplorerModel(workspaceId)` in `server/knowledge-read.ts`
lists the workspace's sources and every tree, with `includeArchived: true`;
each query keeps its own authorization check. `w/[workspaceId]/layout.tsx`
calls it and passes `collections` to `AppShell`. Only where the read happens
moves; no access rule changes, and the scope invariants are untouched.

A workspace layout is not re-fetched on navigation within the workspace, only
on entering it and on `router.refresh()`, which the tree's mutations already
call, so a change made anywhere shows in the sidebar everywhere. If the read
fails, the shell renders and the Documents section shows the failure with a
retry (`router.refresh()`).

`knowledge/[sourceId]/layout.tsx` keeps only its not-found decision, through
the model without collections. The current source and document come from
`useParams()`; outside Knowledge both are absent, and the tree shows with
nothing selected.

**Built:** `getKnowledgeExplorerModel`'s `includeCollections` option is
deleted, not left unused: the Knowledge layout read every source's tree with it
before, and now reads only the current source's. `TreeSkeleton`, the explorer
column's loading placeholder, is deleted with the column. Opening a document
puts it in Recent through `DocumentOpenRecorder`, which `AppShell` mounts, so
Recent is kept at every width; the narrow drawer's sidebar is unmounted while
closed and a recorder inside it would miss documents opened there.

| File | Change |
| --- | --- |
| `components/shell/sidebar.tsx` (new) | The sidebar's content: header, fixed group, scroll region, user row. Used by the wide layout and the drawer. |
| `components/shell/sidebar-frame.tsx` (new) | Collapse, peek, the resize handle, and reading and writing `kh:nav-width`. |
| `components/shell/primary-nav.tsx` | `group: "top" \| "bottom"`; no Knowledge item; no `compact`. |
| `components/shell/app-shell.tsx` | Uses the frame; hosts the Move, FolderName and ShareLink dialogs moved from `KnowledgeLayout`; the explorer portal goes. |
| `components/knowledge/source-sidebar.tsx` | Loses its own `aside` and background and becomes the Documents section; hover-only header controls; `+` on Notes and folder rows. Keeps `aria-label="Knowledge explorer"`. |
| `components/knowledge/knowledge-layout.tsx` | Content container, scroll restoration and inspector context only. |
| `components/shell/navigation-context.tsx` | `mobileExplorerTarget` goes. |
| `app/globals.css`, `tailwind.config.ts`, `frontend-design-language.md` | `--bg-explorer` retired; the navigation colour scheme rewritten from three layers (rail → explorer → canvas) to two (sidebar → canvas). |

## Tests

- **Unit:** the width's clamp and its fallback for an unreadable stored value;
  `PrimaryNav`'s two groups for a personal workspace, a team workspace, a
  member without Settings and one without Sources.
- **e2e, new (`tests/e2e/zz-notion-sidebar.spec.ts`):**
  1. On Graph, the tree is shown; opening a document from it navigates there
     and the tree keeps what was expanded.
  2. Collapsed, the sidebar is 0 wide; the left edge peeks it; Esc hides it;
     ⌘\ pins it.
  3. ←/→ on the handle change the width, and a reload keeps it.
  4. A folder row's `+` creates a document in that folder.
  5. In a narrow window the drawer holds the tree.
  6. A team workspace member does not see items their role does not allow.
- **e2e, existing:** about 13 specs name the Knowledge navigation link, the
  collapse control's label or the compact rail; each is updated.
  `zz-sidebar-comparison.spec.ts`'s baselines are re-taken.
- **Latency:** entering a workspace now reads every tree, which only Knowledge
  pages did. Entering Home is measured before and after by the method of
  `docs/superpowers/verification/2026-09-21-navigation-latency-measurement.md`,
  and the result recorded in `docs/superpowers/verification/`.

## Risk

A workspace with many sources or a large tree enters more slowly. The
measurement above decides whether that matters. If it does, the fallback is to
read the source list in the layout and each tree when its section is first
expanded; it is not built ahead of the measurement.

**Built:** measured in [the latency record](../verification/2026-10-14-notion-sidebar-latency.md); the fallback is not built, pending real workspace sizes.
