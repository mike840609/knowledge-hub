# Shares: stable section tabs, and one scroll layer

## Intent

Two layout faults on the workspace's Shares page, both visible at narrow widths:

1. On `/w/:workspaceId/shares` the three sections — My shares, Saved shares, Discussions — are
   separate routes. Each renders its own `PageHeader` description above `SharesNavigation`, and the
   three sentences are different lengths. Around 800–944px one or two of them wrap to a second line
   while the shortest stays on one; on a phone they occupy three, three, and two lines. Switching
   section therefore moves the tab row vertically by a line, sometimes under the pointer that just
   clicked it.
2. Scrolling a long Shares list scrolls the document as well as the page's own scroll pane. The
   document's scrollbar is the outer of the two; dragging it lifts the fixed-height shell and
   leaves the bottom of the page blank or cut off.

Both should be fixed without dropping copy, reserving blank space, or hiding scrollbars.

## Goals

- The tab row has the same y position on all three sections at every viewport width.
- All three section descriptions remain, and each is shown only on its own section.
- The workspace shell has exactly one vertical scroll area: `#kh-workspace-main`. The document does
  not scroll, so the shell never moves.
- No new empty space on short sections, and no visual change beyond the bug fixes.

## Non-goals

- No change to `PageHeader`'s general shape or to any other page that uses it.
- No unifying or shortening of the three descriptions.
- No handling of horizontal movement when the Discussions unread count changes; that is a separate
  concern.
- No change to standalone readers (`/s/<token>`), which scroll the window by design.

## Anti-goals

- Reserving a fixed-height description block, clamping copy, or hiding a scrollbar.
- Making the header sticky.

## Constraint

The three sections are server-rendered routes, and `SharesNavigation` is a server component. The
shared header must stay server-compatible — no client hooks.

## Problem 1: the tabs move with the copy

Cause: the description sits between the fixed title line and the tabs, so the tabs' y depends on
how many lines the section's sentence takes.

Approaches:

- **A — description below the tabs (chosen).** Order becomes: `PageHeader` (title only) →
  `SharesNavigation` → the section's description → filters and list. The 48px title line and the
  tabs never depend on the description's height; only the content below moves. All copy survives,
  all widths work, and the hierarchy reads "page, section, what this section holds".
- **B — tabs in `PageHeader`'s actions.** The title row is fixed, so the tabs never move, as on
  Insights with its 7/30-day control. Trades the section bar for a top-right control and wraps
  under the title on phones.
- **C — fixed-height description.** Smallest diff, but reserves blank space and remains vulnerable
  to copy, font, and locale changes.

A wins because it removes the cause instead of hiding it, keeps the sections' navigation prominent,
and needs no guesses about how many lines the longest sentence takes.

### The decided shape

- Add a server component `SharesHeader` (in `shares-navigation.tsx`) that renders:
  1. `PageHeader` with `location="My Space"`, `locationHref`, `title="Shares"`, and no description;
  2. `SharesNavigation` with the section and unread count;
  3. the section's description as the existing muted `text-body-sm` paragraph, with `mt-3`.
- `ShareManagementView`, `SavedSharesView`, and `FollowedDiscussionsView` drop their own
  `PageHeader` + `SharesNavigation` pair and call `SharesHeader` with their description.
- Each view keeps its own filters, empty states, and lists unchanged.

## Problem 2: the document scrolls behind the page

Cause: the shell's scroll pane, `#kh-workspace-main`, has no positioned ancestor of its own.
Absolutely positioned descendants whose only positioning ancestor would be the page — notably the
`md:sr-only` "Expires"/"views" labels in every list row at 768px and up — take the initial
containing block instead. Their static positions run down the list beyond the window, so
`documentElement` grows to the list's full height (measured: 940px in a 600px window, 340px of
document scroll) while the pane keeps its own scrollbar. Dragging the document's scrollbar moves the
fixed-height shell up and leaves its bottom cut off.

Approaches:

- **A — make the scroll pane the containing block (chosen).** Add `relative` to
  `#kh-workspace-main`. Every absolutely positioned descendant then belongs to the pane, and its
  overflow stays inside the pane's existing scroll area. Measured at runtime: document height
  returns from 940px to the 600px window, `window.scrollY` stays 0, and the pane still scrolls.
  One class, no visual change, and it fixes every shell page with the same kind of list (Inbox,
  Shares, and anything else rendered in the shell).
- **B — hide the outer scrollbar.** `overflow: hidden` on html/body or the shell root masks the
  symptom but does not give the absolute boxes a containing block, and it would break standalone
  readers that intentionally scroll the window.
- **C — stop making hidden labels absolute.** Touching every `sr-only` in every list is a large,
  fragile change, and other absolutely positioned content could still escape the pane.

A wins because it fixes the containing block at the one place every shell page shares.

### The decided shape

- `AppShell`'s `<main id="kh-workspace-main">` gains `relative` alongside its existing
  `min-h-0 min-w-0 flex-1 overflow-y-auto`.
- Nothing else in the shell moves.

## Testing

- E2E, section tabs: at 390px wide, open each of the three sections, record the tab row's
  `boundingBox().y`, and assert all three are equal; also assert each section's description is
  visible.
- E2E, scroll layers: at 800×600 with enough share links to overflow, assert
  `documentElement.scrollHeight === documentElement.clientHeight`, that `window.scrollY` stays 0
  after attempting to scroll the window, and that `#kh-workspace-main` still scrolls.
- Existing unit tests for the three views should continue to pass; adjust only if they assert the
  header structure.
