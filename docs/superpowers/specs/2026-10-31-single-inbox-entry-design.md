# Inbox: one entry in the rail

Status: agreed with the user on 2026-10-31 (approach A, Linear's model: one entry).

## Intent

A personal workspace offered three Inbox controls: the primary rail's navigation
row (the place, with the unread count), a popover in the rail's wordmark row (the
glance), and the same popover in the narrow topbar. They share a name and a glyph,
and read the same notifications: the Inbox page's **All activity** tab lists what
the popover's **All activity** tab listed. Linear keeps one Inbox in the sidebar.
Notion has a second surface (Updates), but it is named and scoped differently, so
a reader knows which to open. Two same-named, same-scope controls make the reader
choose for no reason. The 176px header also has no room for a third control
(wordmark + icon + collapse), and a collapsed rail stacks two Inbox icons.

## Decision

One entry: the PrimaryNav **Inbox** row and its unread badge. The header and
topbar controls are removed.

## Goals

- One Inbox control at every width; the navigation row is the only way in.
- The unread count stays live on that row, including the collapsed rail.
- The rail's header row returns to the wordmark and the collapse control.

## Non-goals

- No hover peek or preview on the row; the Inbox page's list is the peek.
- No unread count on narrow screens before the Menu drawer is opened.
- The Inbox page, its split view, its tabs, the notifications APIs, mark-read
  and the notification semantics do not change.

## Anti-goals

- Two controls for one inbox, or an unnamed icon beside the wordmark.

## Approaches considered

- **A. Single Inbox (Linear)** — chosen. One row, one badge, no popover. The
  split view already makes reading an entry a click that does not leave the page,
  so the glance has little left to save. Cost: on a phone the count is seen only
  in the drawer, and there is no one-click peek from an unrelated page.
- **B. Two named surfaces (Notion)** — keep the popover as **Activity/Updates**
  for share-link activity only, and scope the row to discussions awaiting the
  reader. Keeps the glance, but requires splitting content that today shares one
  list, and still leaves two notification surfaces to choose between.
- **C. Bell only (Slack/GitHub)** — drop the row, put the badge on the bell.
  Cleanest rail, but the Inbox is a full page with follows and a split view; it
  would lose its place in navigation.

## What changes

- `src/components/shell/app-shell.tsx`: remove the `InboxPopover` import, the
  header render (expanded) and the `placement="compact"` block. The header is the
  wordmark and the collapse control; the wordmark keeps `flex-1`.
- `src/components/shell/topbar.tsx`: remove the import and the personal-workspace
  render. The document's actions end the bar.
- `src/components/shell/inbox-popover.tsx`: delete.
- `src/components/knowledge/knowledge-skeletons.tsx`: drop
  `NotificationListSkeleton`'s `compact` variant, which the popover alone used.
- `tests/e2e/inbox-popover.spec.ts`: replace with the one-entry contract — the
  rail has exactly one Inbox link with the count, no Inbox button in the aside or
  banner, the row opens `/inbox`, the collapsed rail keeps the icon link and
  badge, and the narrow Menu drawer carries the row. The three popover layout
  tests go with the surface; `global-inbox-activity.spec.ts` already covers the
  page's notifications.
- `docs/superpowers/specs/frontend-design-language.md`: replace "the header's
  Inbox popover stays as the quick peek, so the row is the place and the popover
  is the glance" with the single-entry rule.
- This document supersedes the popover clause in
  `2026-10-29-inbox-split-view-design.md` ("What does not change") and Task 2 of
  `plans/2026-10-28-linear-notion-alignment.md`.

## Verification

- The Inbox E2E spec (desktop expanded, desktop collapsed, mobile drawer).
- `tests/unit/primary-nav-inbox.test.tsx` for the badge and its label.
- `npm run typecheck` and `npm run lint`.

## Left to the builder

- The E2E file's new name; keeping its old name is also fine.
- Whether any popover-only wording remains in the user guide; none was found, but
  a final search for "Inbox" in `docs/` and the guide is cheap.
