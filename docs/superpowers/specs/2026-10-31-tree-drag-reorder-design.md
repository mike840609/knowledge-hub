# Dragging rows in the Knowledge tree

## Intent and agreed product direction

Sibling order is keyboard-only today. `Alt+↑/↓` reorders a row among its
siblings (`knowledge-tree.tsx`), and the Move dialog changes a row's folder from
a row menu. Both are complete and accessible; the first is invisible to someone
using a pointer, and the second is two clicks deep. Agreed with the user on
2026-10-31:

- **Drag is a pointer affordance over the existing arrangement, not a new
  capability.** The server already accepts both shapes a drop needs
  (`PATCH /api/tree-nodes/:id`: `{position}` reorders among siblings,
  `{parentId, position?}` moves), and the registry already decides who may
  arrange (`document.move` / `folder.move`).
- **Only `HUB_MANAGED` sources are draggable.** A folder-synced source is
  read-only in the Hub and its order comes from the folder's paths; a drag there
  would either be refused or be undone by the next sync. The user was explicit:
  folder-synced content must not be arranged here.
- **The keyboard path stays exactly as it is.** Drag adds a second way, never
  replaces one.

Success means: with a mouse, a reader can put a document or folder where they
want it — between two siblings, or inside a folder — without opening a menu,
and a synced source offers no such thing at all.

## Approaches considered

| | What it is | Trade-off |
| --- | --- | --- |
| A | Sibling reorder only: drag between rows, never into a folder | Cheapest; but a document dropped on a folder does nothing, which reads as broken, and the Move dialog stays the only way to change folder |
| B | **Chosen:** one drag covering sibling reorder and cross-folder moves | One interaction, one API shape per destination, keyboard path untouched; costs the drop-zone and auto-scroll work |
| C | No drag; put "Move up / Move down" in the row menu and add sort options | Cheapest and helps touch, but a pointer user still cannot place a note exactly, and many notes means many clicks |

B was picked because A is a half-drag that feels broken, and C does not answer
the request. C's menu items remain the obvious next slice for touch (decision 4).

## What exists today (verified)

| Piece | State |
| --- | --- |
| `knowledge_tree_nodes.position` | Contiguous per sibling group, renumbered in one batch write by `placeNodeAtIndex` |
| Reorder | `reorderTreeNode` → `{position}`; the web path toasts a refusal and has no Undo; keyboard only |
| Move (server) | `moveTreeNode` → `{parentId, position?}`; appends when position is omitted |
| Move (web) | `useTreeMutations.moveNode` sends `{parentId}` only — **no destination position today**; the dialog renders its own refusal |
| Gating | `requireHubManagedSource` on the server; `document.move` / `folder.move` in the registry for the UI |
| Destinations | `moveDestinations(items, nodeId)` already computes every ACTIVE folder a node may enter, excluding its own subtree and anything under an archived folder |
| Tree rows | A document row is the `li[role="treeitem"]` holding its `<Link>`; a folder row is an `li[role="treeitem"]` holding a header `<div>` and, separately, its child `<ul>` |
| Scroller | `nav[aria-label="Document tree"]`, `relative overflow-y-auto` |
| Live region | The tree's own polite region (`knowledge-tree.tsx`), deliberately not `role="status"` |

## Out of scope, deliberately

- **Touch / coarse pointers.** No drag is offered on a device without hover;
  the interaction (long-press, scroll conflict) needs its own slice. Ordering
  there remains what it is today.
- **Dragging in Favorites, Recent, search results, the palette, or the graph.**
  Those lists are recency or relevance, not arrangement.
- **Cross-source drag.** A drag may hover another source's tree, but no drop
  there is accepted; each source renders its own `KnowledgeTree`, and the
  server's `CROSS_SOURCE_MOVE` stays the backstop.
- **Sort by name / updated / created.** Order stays the reader's own.
- **Optimistic reordering.** The tree changes when the refreshed tree arrives,
  as every other organize action does.
- **Undo for a same-parent drop.** A step is undone by dragging back, exactly as
  `Alt+↑/↓` has no Undo. A drop into another folder keeps the existing Move
  Undo toast, because that is the same operation the dialog performs.
- **Multi-select drag.**

## The interaction

**Fine pointers only.** The row is draggable only where
`(hover: hover) and (pointer: fine)` matches, the query the explorer already
uses for its hover swaps. `draggable` and the drag handlers are set after mount
from that media query, so a touch device never gets a long-press HTML5 drag that
competes with scrolling.

**A whole row is the drag source.** No grip, no hover-only handle: a row in a
file tree is expected to be draggable, and a handle would either take a slot
from every label or need a hover swap over the leading icon, which the folder
row's chevron already owns. `draggable` goes on the **row header** — the
document's `li[role="treeitem"]`, the folder's header `<div>` and never the
folder's `li`, which also holds the child list (a `draggable` ancestor would
make the whole subtree a handle, so dragging a child would drag its folder).
The document row's `<Link>` gets `draggable={false}` so the browser does not
start a native link drag. A click still navigates; only movement starts a drag.
The header carries `data-row-node-id`; hit-testing uses
`event.target.closest("[data-row-node-id]")` and the drop line uses that
header's rectangle (the folder `li`'s rectangle would cover its subtree).

**Only rows the registry would offer Move to are draggable** — the same test the
keyboard already makes (`actions.some(a => a.id === "document.move" | "folder.move")`).
So a synced source's rows, an archived row, and a row in an archived source are
not draggable, and a source with no Move action offers no drag. Nothing new
decides permission.

**Drop destinations are gated like the Move dialog's.** At `dragstart` the tree
computes `moveDestinations(items, draggedId)` once. A before/after anchor is
valid only when its parent is `null` or one of those destinations; an "into"
target must itself be one. This makes an archived row under an archived folder
invisible as an anchor (the Move dialog would not offer that parent either), and
it excludes the dragged folder's own subtree. A row that is not a valid target
shows no line and no tint, and a drop there does nothing.

**Drop zones.** The pointer's position inside the hovered row header decides:

| Over | Zone | Result |
| --- | --- | --- |
| document row | top half | place before it |
| document row | bottom half | place after it |
| folder row | top quarter | place before the folder |
| folder row | middle half | **into** the folder, appended last |
| folder row | bottom quarter | place after the folder, as its next sibling |
| archived row | before/after only | never "into"; its parent must still be a valid destination |
| the dragged row or its own descendants | — | not a target |
| anywhere that is not a row header | — | no drop |

**Into the folder the node already lives in** appends it to the end of that
folder — a same-parent reorder, not a parent change: no toast, no Undo, the
live region speaks. The Move dialog disables the current parent because it is
about changing parent; dropping "into" one's own folder is about position.

The drop line is a 2px `--kh-primary` line at the target row's top or bottom
edge, starting at that row's indent so it reads at the level it belongs to. An
"after the folder" line is drawn at the bottom of the folder's `li` — below its
whole visible subtree — because that is where the node will land; a collapsed
folder's `li` ends at its header, so the line is directly under the row. An
"into" target tints the folder row `kh-bg-selected` instead of drawing a line.
The dragged row stays tinted `kh-bg-selected` while it moves, as the editor's
blocks do (`frontend-design-language.md`, "Block controls and the `/` list").

**A collapsed folder opens** after the pointer rests in its middle zone for
500 ms, so a drop can reach children. Expansion persists, as the Move dialog's
reveal does — including when the drag is cancelled. **The scroller auto-scrolls**
while the pointer is within 24px of its top or bottom edge, driven by an
animation frame rather than by pointer movement, so a stationary pointer at the
edge keeps scrolling. The hovered row is found with `event.target.closest`,
so a dragover never scans the tree; only the destination set is computed once
per drag.

**Filtering.** A filtered tree's visible neighbours are not the real ones, so a
drop cannot be translated. Rows stay draggable, and `dragstart` cancels itself
and announces `CLEAR_FILTER_TO_REORDER` — the same sentence the keyboard uses —
so a pointer user learns why, rather than finding an inert row.

**At most one request per drop**, chosen by the destination:

| Drop | Request | Feedback |
| --- | --- | --- |
| same parent, before/after a sibling | `{ position }` → `reorderNode` | live region says where it landed |
| into the folder it already lives in | `{ position: APPEND }` → `reorderNode` | live region |
| another folder, before/after one of its children | `{ parentId, position }` → `moveNode` | toast `Moved "X" to "Y".` with Undo |
| into another folder | `{ parentId }` (server appends) → `moveNode` | toast with Undo |
| a same-parent drop whose numeric position is unchanged | no request; clear the drag immediately | live region reports the current position |

An append into the current folder still goes to the server: hidden archived siblings mean visible order alone cannot prove it would be unchanged.

`APPEND` is `Number.MAX_SAFE_INTEGER`; `placeNodeAtIndex` clamps it, so the node
lands after every sibling including hidden archived ones — exactly where the
Move dialog's append lands. `reorderNode` already toasts a refusal. `moveNode`
does not (the dialog shows the message it returns), so the drag path calls a
variant that toasts that message; a refusal is never silent.

The destination folder is opened after the drop if it was not already open
(the pointer may have dropped before the 500 ms expansion), and focus returns to
the moved row — both through the mechanisms the Move dialog and keyboard reorder
already use (`REVEAL_FOLDER_EVENT` / `expandFrom`, `focusAfterReorder`).

**While a request is in flight** a second drag is ignored until the refreshed
tree arrives, with the same 3-second give-up the keyboard uses.

## Position math

The client does not always hold the archived siblings, but positions are
contiguous over *all* siblings. So a drop is translated into an index among the
destination parent's siblings with the dragged node removed:

- before anchor `A`: `A.position - (draggedBefore ? 1 : 0)`
- after anchor `A`: `A.position + 1 - (draggedBefore ? 1 : 0)`
- into another folder: no position; the server appends (the Move dialog's request)
- into the folder the node already lives in: `APPEND` (decision 6)

`draggedBefore` is true when the dragged node shares the anchor's parent and its
stored position is lower. For a different parent there is no adjustment. This is
the same neighbour-position convention `reorderStep` uses for the keyboard, which
is proven against hidden archived siblings in `tests/integration/organize-api.test.ts`.

A pure `dropPlacement(items, draggedId, targetId, zone)` in
`src/lib/knowledge-navigation.ts` returns a discriminated union — `{ kind:
"reorder"; position } | { kind: "move"; parentId: string | null; position?:
number } | null` — and applies the destination gate above. The tree only sends
what it returns.

## Client interface changes (no API or schema change)

The server is ready; the web layer is not. This slice adds, explicitly:

- `TreeMutations.moveNode` gains `to.position?: number` and sends
  `{ parentId, position }` when it is present. Its Undo already restores
  `from.position`.
- A drag-specific move call that toasts a refusal (the dialog keeps its own
  inline message).
- `KnowledgeTree` gains `onMove`, wired in `source-sidebar.tsx` to that call,
  beside the existing `onReorder`.
- `RowProps` (`action-menu.tsx`) must accept `draggable`, the drag handlers and
  `data-row-node-id`; today it is a closed type.
- The drag state machine lives in `components/knowledge/use-tree-drag.ts`, not
  in `knowledge-tree.tsx`, which already owns keyboard, focus, collapse and
  live-region state. The hook owns the rAF auto-scroll and the 500 ms timer and
  clears both on drop, `dragend` and unmount.

## Accessibility

- `Alt+↑/↓` and the Move dialog are untouched, so drag is never the only way.
- `draggable` adds no tab stop and no accessible action; the row's name is
  unchanged.
- The tree's polite live region announces a same-parent drop with a new
  `placedNode(name, index, count)` message in `organize-messages.ts` ("Placed
  "X". Position 3 of 7."), where index and count are the **visible** siblings,
  as `reorderedNode` already uses. A drag has no direction the way a key press
  does. A cross-folder drop relies on the toast, which is already the page's
  `role="status"`, so nothing is said twice.
- Escape, or a drop outside any target, cancels the drag and leaves the tree's
  order unchanged; a folder the drag opened stays open, as any hover-open does.
- Filtering explains itself through `CLEAR_FILTER_TO_REORDER` at `dragstart`.

## Design-language update

`docs/superpowers/specs/frontend-design-language.md` gains one paragraph beside
the explorer's rules: a tree row is dragged whole; while it moves it is tinted
`kh-bg-selected`, a 2px `--kh-primary` line marks where it will land at the
target's indent (below the whole subtree for "after a folder"), and a folder
that will receive it is tinted instead; a collapsed folder opens after half a
second under the pointer; a source the Hub cannot write to has no drag; no new
token is introduced.

## Testing

- **Unit** (`tests/unit/tree-drag-placement.test.ts`): `dropPlacement` over six
  siblings with two archived ones hidden, both directions, a different parent,
  an append, a folder's three zones, a folder's own descendant, an archived
  folder as a container, and an anchor under an archived folder. Randomized
  steps compare the resulting visible order, as the integration test below does
  for the keyboard.
- **Unit** (`tests/unit/knowledge-tree-drag.test.tsx`, jsdom): wiring only —
  `draggable` is present after a fine-pointer match and absent for a
  `SOURCE_MANAGED` target and an archived row; `dragstart` while filtering
  announces and does not start; a drop on a non-target sends nothing. jsdom has
  no `DataTransfer` or layout, so zone geometry stays in the pure helper; the
  test stubs `DataTransfer` and the media query.
- **Integration** (`tests/integration/organize-api.test.ts`): drive
  `dropPlacement` + the PATCH route over six siblings with two archived, both
  directions and across parents, comparing visible order — the same seeded
  randomized shape the keyboard's step already uses there.
- **E2E** (`tests/e2e/zz-tree-drag.spec.ts`), in the E2E user's My Space with
  documents made through the API so their order is known: drag a document below
  another and read the order back; drag a document into a folder and undo it;
  drag a folder above another; hover a collapsed folder for half a second
  without dropping and assert it opened; separately, drop onto a collapsed
  folder and assert it opened; assert exactly one PATCH per position-changing drop; assert the
  seeded `SOURCE_MANAGED` source's rows are not draggable. Reuses `childrenOf`
  and `row` from `tests/e2e/fixtures/organize.ts` and the local `expectOrder`
  shape of `zz-organize-move.spec.ts`.

## Risks

- **Playwright and HTML5 drag.** `dragTo` does not naturally rest for 500 ms, so
  the auto-expand test drives `dragover` explicitly; Chromium-only CI keeps the
  rest of the drag deterministic.
- **Drag versus click.** A short movement must not become a drag; the browser's
  own threshold handles it, but the E2E asserts a click still opens a document.
- **Large trees.** Destinations are computed once per drag and the hovered row
  is found by `closest`, so a dragover does not scan every row.
- **Expansion persistence.** A cancelled drag leaves opened folders open, which
  is stated rather than undone.

## Supersedes

The daily-driver spec deferred this deliberately: D10 and §12-4 ("Drag
organization: defer, Move dialog/Alt arrows first") and §7.6 ("Exclude drag").
This is that later slice. `2026-09-29-personal-daily-driver-design.md` is
annotated at those two places so the deferral is not read as still standing.

## Decisions made here (check these)

1. **Whole-row drag, no grip.** No layout change, no hover-only control, and the
   file-explorer convention; the link's native drag is disabled to make it work.
2. **Folder middle = into, edges = before/after.** Appending inside matches the
   Move dialog exactly, so the two paths cannot disagree.
3. **No optimistic update and no same-parent Undo**, matching every other
   organize action; a cross-folder drop keeps the Move Undo.
4. **Touch is untouched**, including the fact that coarse pointers have no
   ordering path at all today. A row-menu "Move up / Move down" would close that
   gap cheaply and is a good next slice, but it is not smuggled in here.
5. **Destinations use the Move dialog's own rule** (`moveDestinations`), so the
   UI cannot offer a parent the server refuses, including an archived folder.
6. **Dropping into the folder a node already lives in appends it there**, as a
   same-parent reorder rather than a refusal. The Move dialog's disabled
   "Current" entry is about changing parent; a drag onto one's own folder is
   about place, and silently doing nothing would read as a broken drop.
7. **The drag source is the row header, not the folder's `li`.** A `draggable`
   `li` would make the whole subtree a handle, so dragging a child would drag
   its folder. Hit-testing uses the header's own `data-row-node-id`.
8. **Filtering refuses at `dragstart`, not by removing `draggable`.** The
   pointer user gets the keyboard's sentence instead of an inert row.
