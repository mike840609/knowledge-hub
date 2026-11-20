# Inbox keeps the workspace sidebar still

Approved 2026-11-20. Short design.

## Intent

Opening **Inbox** from the workspace navigation should change only the page area.
It must not collapse the desktop sidebar, move the Inbox link to the rail, turn
the expand control into a drawer, or change that control's meaning. Today one
click changes the page and the navigation at once, which reads as a layout jump
and makes the same control behave differently on two routes.

## What happens today

- `src/components/shell/app-shell.tsx:74-113` forces Inbox below 1472px into
  `inboxCompact`: the desktop sidebar shrinks from 272px to 48px, `usesDrawer`
  turns on, and the page gets the drawer instead of the rail.
- `app-shell.tsx:271-276` makes the same toggle open the Menu on Inbox but
  collapse the rail everywhere else. Callback refs hand focus between the header
  Inbox link and the rail link when the placement changes.
- The Inbox split is already independent of the sidebar:
  `inbox-activity-view.tsx:28,86` measures its own box against 75rem.
- The behavior is documented in `frontend-design-language.md:1911` and asserted
  in `tests/e2e/inbox-entry.spec.ts`, `global-inbox-activity.spec.ts`, and
  `retrieval-layout.spec.ts`.

## Decision: A — the sidebar keeps the user's state

Remove the Inbox-specific sidebar reaction. Navigation state belongs to the
reader; content adapts to the room it is given.

- At 1024px and wider, entering or leaving Inbox preserves `navCollapsed`, the
  sidebar width, the header or rail placement of the Inbox link, the toggle's
  label, and the fact that the toggle expands or collapses the rail. It never
  opens the Menu drawer.
- Below 1024px nothing changes: every page, Inbox included, uses the Menu
  drawer.
- Inbox still chooses split or list from its own box. At 1440px with the
  expanded sidebar it is the list; collapsing the sidebar gives it the split;
  from 1472px with the sidebar expanded it is the split.
- Remove the focus handoff refs that exist only for the forced placement switch.
  Keep the drawer's focus return and the existing keyboard-collapse handoff.

## Rejected

**B — keep the forced compact rail and animate the change.** The sidebar still
moves when the reader opens a page, and the toggle still means two things.

## Non-goals

- No change to the 75rem Inbox split threshold, the Inbox content, the compact
  rail design, or the phone drawer.
- No new route, control, permission, dependency, or data.

## Documentation and tests

- Update the sidebar paragraph in `frontend-design-language.md` so Inbox no
  longer claims the compact width and drawer between 1024 and 1471px.
- Add an amendment note to `2026-10-29-inbox-split-view-design.md`: its 75rem
  box excludes the 272px workspace sidebar introduced by #376.
- Add an E2E regression: at 1440px, record the sidebar width, Inbox placement,
  and toggle label on Home; open Inbox; assert all are unchanged and the toggle
  still collapses and expands in place; use browser Back and assert again.
- Rework the 1440px cases in `inbox-entry.spec.ts` to expect the header Inbox
  link to stay current and focused with the sidebar expanded.
- Keep the split/index flow in `global-inbox-activity.spec.ts` by running it at
  1512px or after collapsing the sidebar; move its drawer-overlay assertions to
  a phone width.
- Run the Recent-menu drawer case in `retrieval-layout.spec.ts` at 900px, where
  the Menu drawer is the real narrow layout, instead of relying on Inbox's
  forced compact state at 1100px.
- Verify the 390px Menu, the keyboard toggle, the targeted Inbox specs, and
  then the full CI suite.

## Risk

At 1440px with the sidebar expanded, Inbox shows its list without the discussion
pane until the reader collapses the sidebar. That is the accepted cost of not
moving the sidebar; the split remains automatic whenever Inbox has 75rem of its
own.
