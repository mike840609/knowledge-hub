# Knowledge tree shows which sources are read-only

## Intent and agreed product direction

Today a reader cannot tell from the Knowledge explorer which documents they may
edit. Every source heading is its name and a chevron
(`source-sidebar.tsx`), and a folder-synced source's documents look exactly
like a Hub note's. The difference appears only after opening one: the document
page says "Read only · Edit the file in your folder, then update from folder"
(`document-header.tsx`), or a row's menu turns out to lack Rename and Move.

Agreed with the user on 2026-10-20:

- **The problem is browsing.** Which documents can be edited should be clear
  before opening them, not explained afterwards.
- **The cue belongs to the source, once.** Ownership (`SOURCE_MANAGED` vs
  `HUB_MANAGED`) is a property of the whole source, and every folder and
  document under it shares it. The heading carries the cue; rows inside the
  tree do not repeat it.
- **Favorites and Recent repeat it**, because they are the two lists that show
  a document without its source heading above it.
- **Notion-style shared slot:** the heading's icon and its expand chevron share
  one position. The icon shows at rest, the chevron on hover or keyboard focus.
- **Hub sources leave the slot empty at rest.** Only the exception, a source the
  Hub cannot write to, is marked.

Success means: someone scanning the explorer can point at every source whose
documents they cannot edit here, without opening a document or a menu.

## What counts as read-only

A source is marked when `source.ownership === "SOURCE_MANAGED"`: the same field
the application services check before every write (`create-revision.ts`,
`tree-transaction.ts`). `sourceType` is not consulted, so the cue cannot drift
from what the server enforces.

Out of scope, deliberately:

- **Workspace-wide read-only** (a member without `canWrite`, an archived
  Workspace). It applies to the whole tree at once, so a per-source mark would
  carry no information; it needs a Workspace-level cue of its own.
- **Archived** sources already show an `Archived` status on the heading.
- **The document page's wording.** A Hub document the viewer cannot write to
  also says "Read only" (`page.tsx`, the `readOnlyReason` branch), against the
  comment above it that reserves the badge for ownership. That is a separate
  fix.

## The source heading

The heading stays one `<button>` with the same `aria-expanded`,
`aria-controls`, click target and toggle behaviour. Only its leading 14px slot
changes.

| State | `SOURCE_MANAGED` | `HUB_MANAGED` |
| --- | --- | --- |
| At rest | `LockKeyhole`, `text-kh-text-muted` | empty (slot kept) |
| Heading hovered, or focus-visible inside it | `ChevronRight` / `ChevronDown` | `ChevronRight` / `ChevronDown` |
| `@media (hover: none)` | `LockKeyhole` always | empty always |

- `LockKeyhole` is the icon the document header already uses for "Read only",
  so the tree and the page say the same thing with the same mark.
  `RefreshCw` is not used: across the app it means "refresh" as an action.
- The slot keeps its width when empty, so source names start at the same x
  whatever the icon.
- The heading button gains `group`, and the slot swaps with
  `group-hover:` / `group-focus-visible:`: CSS only, no state and no
  re-render. (The row around it has no `group` today.)
- On touch devices there is no hover. The lock is not replaced, and the
  expanded state is still visible, because the children are shown or not
  directly below the heading.
- The heading's native `title` of a `SOURCE_MANAGED` source reads
  "<name> · Synced from a folder, read-only in the Hub". (Not `Tooltip`:
  `components/ui/tooltip.tsx` keeps that for controls with no visible label,
  and the heading already uses `title` for its truncated name.)

## Favorites, Recent and "Show all"

- **Sidebar rows** (`shortcutRow`): a `SOURCE_MANAGED` document gets the same
  muted `LockKeyhole` after its label, before the star button. The leading
  `FileText` / `Clock3` stays: it says which list the row is in.
- **"Show all" favorites menu**: the same icon beside the source name.
- Hub documents get nothing in either place.

The `documents` map in `SourceSidebar` gains `ownership`, copied from its
collection's source, beside the `sourceName` it already holds. No API, query or
schema change: the explorer model already carries `source.ownership`.

## Accessibility

The lock is never the only carrier of the information, and it never changes an
accessible name:

- The heading's and each marked row's accessible name stays exactly the source
  or document name. Existing tests locate them by exact name, and so do
  people navigating by name with a screen reader.
- "Synced from a folder, read-only in the Hub" is attached as an accessible
  description (`aria-describedby`, one visually hidden element per sidebar),
  so it is announced after the name.
- The icons are `aria-hidden`.

## Testing

`SourceSidebar` has no unit test, and rendering it alone needs the router and
the Workspace authorization context. The cue is checked in the browser, in
`tests/e2e/phase2.5-knowledge-explorer.spec.ts`, against the seeded
`SOURCE_MANAGED` source (`BROWSER_FIXTURES.sourceManagedSourceName`,
"Vendor Compliance Vault") and a Hub source in the same Workspace:

1. The synced source's heading shows the lock at rest and has the description;
   the Hub source's heading has neither.
2. Hovering the synced heading hides the lock and shows the chevron; it stays
   the same button (`aria-expanded` unchanged by hover).
3. Keyboard focus on the heading shows the chevron.
4. A favorited synced document's row in Favorites shows the lock and carries
   the description; a favorited Hub document's row does not.
5. Existing exact-name lookups of source buttons still pass unchanged
   (the accessible-name rule above).

The design-language contract gains one line under the explorer's rules: a
source heading's leading slot is its icon at rest and its chevron on hover or
focus, and `LockKeyhole` there means `SOURCE_MANAGED`.
