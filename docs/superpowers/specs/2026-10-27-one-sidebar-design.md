# One sidebar

**Status:** agreed with the user, 2026-10-27: default expansion, Settings in
the fixed head, New note with `C` on Home only, Inbox as a row, the three-PR
delivery and retiring `kh:explorer-collapsed`, each as written below. Rewrites PR #201's
`2026-10-14-notion-sidebar-design.md` (agreed 2026-10-14, never merged) against
`main` as it is now. When built, this supersedes
[2026-10-21-explorer-collapse-design.md](2026-10-21-explorer-collapse-design.md),
and PR #201 is closed rather than rebased: it is 70 commits behind and conflicts
in 17 files, most of them the ones this spec changes again.

## Intent

A wide window shows two navigation columns. The primary rail
(`shell/app-shell.tsx`, 176px, `bg-sunken`) holds the wordmark, the Inbox, the
workspace selector, Search, the destinations and the user menu. On Knowledge
pages only, the explorer beside it (`knowledge/knowledge-layout.tsx`, 288px,
`bg-explorer`) holds Favorites, Recent and a tree per source. Each collapses on
its own: the rail to 48px, the explorer to a 40px strip. The tree is gone as soon
as the reader leaves Knowledge.

This replaces both with one sidebar: navigation and the tree in one column, on
every workspace page, with a width the reader drags and a collapse that gives the
page the whole window.

Success means:

- the tree and Favorites are on Home, Graph, Settings and every other workspace
  page;
- one sidebar component serves the wide frame and the narrow drawer;
- entering a page outside Knowledge reads **no** source tree the reader has not
  expanded;
- no authorization rule, route or persisted preference changes meaning.

## What carries over from #201 unchanged

These were decided with the user on 2026-10-14 and nothing on `main` since
contradicts them:

1. **One column, not two.**
2. **The Knowledge navigation item goes.** The tree is the Knowledge navigation.
   The `/w/:id/knowledge` route stays, because other links redirect through it.
3. **The destinations sit in the fixed head and the tree is the only part that
   scrolls** (#201's 2026-10-15 revision). A destination's position does not
   depend on the tree's length.
4. **Width:** 256px by default, dragged between 220px and 400px, double-click
   to reset, ←/→ by 16px on a focusable `role="separator"`. The value lives in
   `kh:nav-width` and is written once, on release.
5. **Collapse to 0, with peek.** An expand button (») sits on the 48px top line.
   Pointing at an 8px left-edge strip (only where `(hover: hover)` holds) slides
   the sidebar in over the content, which does not move. Esc closes the
   innermost layer, and » or ⌘\ pins the sidebar.
   #201's *Built* notes are kept as requirements, because each fixed a real
   defect:
   - a placeholder holds the column in flow, and the `aside` is `fixed` while
     collapsed;
   - a peek starts on `pointermove`, not on entry;
   - Esc closes an open menu before the peek;
   - `data-nav-collapsed` gives the `[data-top-line]` rows their 48px.
6. **One background.** The whole sidebar is `bg-sunken`; `--bg-explorer` is
   retired.

## Layout

```text
┌─────────────────────────────┐
│ [▣ My Space ▾]   ✎ New  ⇤  │  header, fixed; ⇤ on hover and focus
│  🔍 Search            ⌘K   │  fixed head from here
│  🏠 Home                    │  (personal workspaces)
│  📥 Inbox              3    │  (personal workspaces)
│  ◎ Graph                    │
│  ⛁ Sources                  │  each where its permission allows,
│  ⇪ Shares                   │  as today
│  ◔ Insights                 │
│  ⚙ Settings                 │
├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤  one scroll region from here
│ Favorites                   │
│ Documents          ⧩ ⋯ +   │  controls on hover
│   ▾ Notes               +  │  Hub sources open by default
│     ▸ Folder          + ⋯  │
│       · Doc           ☆ ⋯  │
│   ▸ Synced source           │  folder sources closed until opened
├─────────────────────────────┤
│  👤 Name                ⋯  │  the only pinned row
└─────────────────────────────┘
```

Checked against Notion's and Linear's sidebars on 2026-10-27. Kept as theirs:

- one column under a workspace menu;
- collapse to nothing (Notion ⌘\, Linear `[`);
- a `+` beside a section on hover;
- one background.

The three changes under "Header" and "Default expansion" below, and Recent's
removal, came out of that check. Not taken:

- Linear's inset content card, which would add a surface layer the contract
  does not have;
- moving the user menu into the workspace menu, since the reader already knows
  where Theme and Density are.

## What changes from #201

### Trees load as `main` loads them now

#201 read every tree in the workspace layout, and its build opened every source
by default. That is the cost `2026-10-24-lazy-source-trees-design.md` removed.
That spec's rules govern here, on every page:

- **The workspace layout reads source headers, not trees.**
  - `getWorkspaceShellModel` gains the sorted readable sources: one
    `listSources` query, already authorized per caller.
  - The current source's inclusive tree is still read server-side. The
    `knowledge/[sourceId]` layout reads it, as today, and seeds it into the
    shell's cache, so breadcrumbs, ancestor reveal and same-source moves still
    have it on first paint.
- **One `SourceTreeCache` per workspace, owned by `AppShell`**, not by
  `KnowledgeLayout`.
  - Today a tree loaded on Knowledge is thrown away when the reader goes to
    Home. Lifted, it survives every navigation inside the workspace, which is
    the cross-page persistence the lazy spec deferred.
  - A server refresh still invalidates it, by the lazy spec's existing rule.
- **Default expansion.** The saved choice (`kh:tree-expanded:<workspaceId>`)
  decides. Without one:
  - the current source is open, as the lazy spec has it;
  - **every Hub-managed source is open** (Notes, in a personal workspace);
  - folder-sync sources stay closed until opened.

  Notion opens its sections by default, so their first-level pages show. A
  sidebar of closed headers on Home would show a reader none of their writing.
  Hub sources are what the reader wrote, usually one per workspace, so this
  costs one tree read on entry. Folder-sync trees are the large ones, and they
  stay unread until asked for.

  #201's built default (`expanded[id] ?? true`) is **not** carried over: it read
  every tree.
- **Unchanged from the lazy spec:**
  - Favorites resolve through the metadata-only shortcut read;
  - a non-empty filter loads every visible tree;
  - the Move dialog asks the cache for the trees it needs.

### Rows use the rail density

#201 drew rows at 32px. `main` now has `kh-rail-row` / `kh-rail-text` with the
reader's Density choice: Compact is 28px / 13px and the default; Comfortable is
32px / 14px. Every sidebar row (destinations, shortcuts, tree) uses them. The
hover controls stay 24px (`sm`); a Compact row's 2px each side is the margin the
contract already records.

### Header and head

- **The header row** is the workspace selector (it replaces the wordmark), then
  **New note**, then collapse (⇤, shown on hover and focus).
  - New note is always shown, as Notion's new-page button and Linear's new-issue
    button are. It opens `/w/:id/knowledge/new`, which creates in Notes.
  - Its tooltip names `C` only on Home. There `C` keeps working as today
    (`isNewNoteKey`); elsewhere a letter belongs to the inline editor
    (inline-editing spec), so `C` does not become global.
  - The Notes row's hover `+` stays, for creating inside a folder.
- **Inbox becomes a row** in the fixed head, under Home (personal workspaces),
  with the unread count at its end, as Notion's and Linear's are.
  - It opens the existing Inbox popover, anchored to the row; the popover's
    contents, polling and Open Inbox link are unchanged.
  - It was a header button only because the 176px rail could not fit a row's
    label there (`inbox-popover.spec.ts`). At 256px that reason is gone.
  - Collapsed or peeking, it is the same row; the drawer has it too.
- **The head is eight rows** for a personal workspace's owner: Search, Home,
  Inbox, Graph, Sources, Shares, Insights and Settings. That is ~230px fixed at
  Compact, kept fixed by #201's 2026-10-15 decision.

### Recent leaves the sidebar

Home already lists Recent, as Notion's Home holds its Recents. A second copy in
the sidebar costs a section above the tree on every page. The sidebar keeps
Favorites and Documents.

The recents themselves stay; Home and ⌘K read them. Today the sidebar records
each open (`source-sidebar.tsx`, the `recordedOpen` effect). That recording moves
into a recorder that `AppShell` mounts, as #201's `DocumentOpenRecorder` did:

- the sidebar no longer shows recents, so it should not be what keeps them;
- the narrow drawer's sidebar is unmounted while closed, and a document opened
  there would go unrecorded.

The sidebar's section and its `kh:sidebar-recent:<id>` key go; recording and
storage are unchanged.

### Hosts move to the shell

Tree rows are now on every page, so whatever their actions open must be mounted
on every page:

- **`MoveDialogHost`, `FolderNameDialogHost` and `ShareLinkDialogHost`** move
  from `KnowledgeLayout` to `AppShell`, as #201 had it. `PersonalHome`'s own
  `ShareLinkDialogHost` goes.
- **`PeekHost`** (#279) moves to `AppShell` and wraps `<main>`, and the two
  copies in `KnowledgeLayout` and the Home page go.
  - It must sit there. Below the shell, the peek would split a content area that
    no longer holds the explorer.
  - The 50/50 split is then of the page area beside the sidebar, which is what
    the split meant all along.

### Geometry

Expanded, the sidebar and its border take 257px, where the rail and explorer
take 466px today. A document pane gains 209px.

| Window | Pane today, both open | Pane, sidebar open | Pane, collapsed |
| --- | --- | --- | --- |
| 1440 | 974 | 1183 | 1440 |
| 1512 | 1046 | 1255 | 1512 |
| 1680 | 1214 | 1423 | 1680 |

Outline, article and open discussions need a 77rem (1232px) pane (#259). That now
fits at 1512px with the sidebar **open**. Today it needs both columns collapsed.
That geometry was the whole reason for the explorer-collapse spec, so the
explorer's 40px strip, Hide/Show documents and `kh:explorer-collapsed` go.

### Persisted preferences

| Key | Today | After |
| --- | --- | --- |
| `kh:nav-collapsed` | rail at 48px | sidebar collapsed (to 0) — same intent, kept |
| `kh:explorer-collapsed` | explorer strip | retired, ignored |
| `kh:nav-width` | — | new |
| `kh:tree-expanded:<id>`, `kh:density` | as today | unchanged |

A reader who had collapsed only the explorer gets the sidebar open. The width
they had collapsed the explorer to win is already given back by the narrower
column.

## Not built

- Notion's Trash and Teamspaces. Nothing in the model corresponds to them.
- Collapsing automatically by window width: below 1024px the sidebar is already
  the drawer.
- Keeping the width on the server.
- A per-folder lazy read (the lazy spec's approach 3, still deferred).

## Delivery

Three PRs, each green on its own:

1. **One column.**
   - `shell/sidebar.tsx` serves the frame and the drawer;
     `mobileExplorerTarget` goes.
   - The cache, the hosts and `PeekHost` move to `AppShell`; the shell model
     gains source headers.
   - `KnowledgeLayout` keeps the content container, scroll restoration and the
     inspector context.
   - The Knowledge item goes, and `--bg-explorer` is retired.
   - The width is fixed at 256px, and the existing collapse keeps working.
   - The contract's three-layer navigation (rail → explorer → canvas) becomes
     two (sidebar → canvas).
   - The explorer-collapse spec is marked superseded, and README gets this
     spec's row.
2. **Width, collapse to 0, peek.** `shell/sidebar-frame.tsx`, ported from #201
   with its *Built* fixes.
   - Recent leaves the sidebar, and Inbox becomes a row.
   - The header gains New note.
   - Hub sources are open by default.
3. **Hover controls.** `+` on Hub folder rows and on Notes, section-header
   controls on hover, and the chevron on the right. Ported from #201's "Rows and
   section headers", at the current density.

## Tests

- **Unit:**
  - the width clamp and its fallback for an unreadable value;
  - `PrimaryNav`'s head group for a personal workspace, a team workspace and
    members without Settings or Sources;
  - the shell cache surviving a route change and being invalidated by a refresh.
- **e2e (`zz-one-sidebar.spec.ts`, from #201's `zz-notion-sidebar.spec.ts`):**
  1. On Graph, the tree is shown, and a document opened from it lands with the
     same folders expanded.
  2. **Entering Home with no saved expansion requests only the Hub source's
     tree**, counted at `/api/workspaces/:id/sources/:id/tree`.
     - Notes is open, and a folder-sync source is closed and unread.
     - Expanding the folder source requests it once.
     - Going to Graph and back requests nothing more.
  2a. The header's New note opens the composer from Graph. The Inbox row shows
      the unread count and opens the popover. The sidebar has no Recent section,
      and Home's Recent still lists a document just opened.
  3. Collapsed, the sidebar is 0 wide; the left edge peeks it, Esc hides it, and
     ⌘\ pins it.
  4. ←/→ on the handle change the width, and a reload keeps it.
  5. "Open in side peek" from a tree row on Graph splits the page.
  6. A Hub folder's `+` creates a document in that folder.
  7. In a narrow window, the drawer holds the tree.
  8. A team member sees only what their role allows.
- **Existing specs:**
  - those that name the Knowledge link, Hide/Show documents or the 48px rail are
    updated;
  - `zz-explorer-collapse.spec.ts` is deleted, and its 1512px three-columns
    case moves to (1) with the sidebar open;
  - `inbox-popover.spec.ts` is rewritten for the row, and its "fits the 176px
    header" case goes;
  - cases that read the sidebar's Recent move to Home's;
  - `zz-sidebar-comparison` baselines are re-taken.
- **Latency:**
  - entering Home and a document, before and after PR 1, measured by
    `2026-09-21-navigation-latency-measurement.md` on a workspace of at least
    400 documents across several sources;
  - recorded in `docs/superpowers/verification/`, without reusing #201's
    numbers.

## Risk

- **Source headers are now read on every workspace page.** It is one indexed
  query per entry into the workspace: the layout is not re-read on in-workspace
  navigation. The measurement above confirms it.
- **Every page now shares one tree cache.** A late response for a source on one
  page could land after a refresh made on another. The lazy spec's snapshot
  check already drops it, because the cache is replaced with the seed. Test 2
  and the existing stale-response unit cover it.
