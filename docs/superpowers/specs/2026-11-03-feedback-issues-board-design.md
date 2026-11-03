# Reported issues: a shared, read-only board inside the report dialog

## Problem

"Report a problem" now stores each report in `feedback_reports`
(`docs/superpowers/specs/2026-10-13-feedback-reports-to-database-design.md`),
but only a maintainer with database access can see them. Reporters cannot tell
whether a problem they hit has already been reported, so the same bug arrives
many times and each reporter is left wondering whether anyone noticed.

That earlier design deliberately left the reading screen, its access capability
and notifications for a later change. This is that change.

## Decision in one line

The **Report a problem** dialog grows an **Issues** tab: every signed-in
colleague can open it from the account menu, read every report without leaving
the page, filter it, and close it whenever they like. It is not a route and
belongs to no Workspace.

The first draft of this design made it a page at `/w/[workspaceId]/issues` with
a rail row. Review rejected that shape: a board used occasionally is not worth
a navigation row, a page change, or a Workspace anchor. The dialog is the
surface people already open to report; the list belongs there.

## Who may read, and why

- **Any trusted caller may read every report.** The audience is the reporters
  themselves, and every colleague is a potential reporter. No Workspace role,
  membership or platform capability is involved.
- **No Workspace is involved at all.** There is no workspace id in the URL, the
  list request, or the authorization. The panel is available wherever the
  account menu is, and closing it leaves the reader on the page they were
  reading.
- **Nothing is signed-out-visible.** The list endpoint and the report endpoint
  both require a trusted caller, like every other private API.
- **Identity is shown in full: display name and `emp_id`.** The reporter chose
  "show all" over anonymising, so a colleague can see who reported a problem
  and follow up with them. `user_id` is never sent to the browser.

## Status

`feedback_reports` gains a `status` column with four values, stored uppercase:

| DB value | Shown as |
| --- | --- |
| `OPEN` (default) | Open |
| `IN_PROGRESS` | In progress |
| `RESOLVED` | Resolved |
| `DUPLICATE` | Duplicate |

- **The UI never writes status.** There is no update endpoint, no control and
  no audit record of status changes. The maintainer updates rows directly
  (`UPDATE feedback_reports SET status = 'RESOLVED' WHERE id = ?`), and the
  next time the panel opens it reflects that. This is a deliberate trade: no
  write path, no authorization question, no accidental closure by a colleague.
- **The board is one row per submission.** `DUPLICATE` marks a report that
  repeats another; there is no merge, link or de-duplication view.
- **The list is fetched when the tab is shown**, not cached across openings, so
  a status edit made in SQL appears at the next open.

The append-only sentence in the 2026-10-13 spec is amended by this document:
rows are still never edited by the application, and status is the one column a
person may change, outside the application.

## What the panel shows

The account menu's **Report a problem** opens the existing dialog. It carries
two tabs:

- **Report** — the form that already exists: employee ID (read-only, from the
  trusted caller), category, description, Send report, Close.
- **Issues** — the board, fetched on first show and on every open.

### Report tab

Unchanged from the 2026-10-13 design. One sentence is amended because reports
are now colleague-visible:

> Your report appears on the shared Issues board with your name, employee ID
> and the page you are on. Document content is not included.

### Issues tab

- **Each row**, in this order:
  - status, using the shared `Status` primitive — `Open` = `active`,
    `In progress` = `pending`, `Resolved` = `success`, `Duplicate` = `none`
    (a glyph and a word, never colour alone);
  - category, using `Badge` (Sync / Search / Reading / Other);
  - the description, wrapping as written; a long one shows a 280-code-point
    preview and opens the remainder behind a disclosure;
  - reporter: display name and `emp_id`, with a muted "You" marker on the
    reader's own reports;
  - the page path the report was made on, in the monospace face, not a link;
  - `Timestamp` for `created_at`.
- **Filters:** `status` (all, or one of the four) and `Mine only`. Both are
  panel state, not URL state — closing the panel ends them.
- **Paging:** 20 reports per load, newest first, ordered
  `created_at DESC, id DESC` with a composite cursor `(beforeAt, beforeId)`.
  `Load more` appends the next page and keeps what is already shown; it
  disappears when there is nothing older.
- **Empty states:** no reports at all, versus no reports matching these
  filters. No third "page past the end" state exists because pages append.
- **Closing:** Escape, the × in the corner, or the Close button, at any time.
  Opening the panel again starts on the Report tab and refetches the list when
  the Issues tab is shown.
- **No status control** appears anywhere: the only `Status` control is the
  filter.

## Read path and layering

- **`src/app/api/feedback-reports/route.ts`** gains `GET` beside the existing
  `POST`. It establishes the trusted caller through `workspaceHttp`, reads
  `status`, `category`, `mine`, `beforeAt` and `beforeId` from the query
  string, calls `services.feedbackIssues.list(caller, …)`, and returns
  `{ items, nextCursor }` with `Cache-Control: private, no-store`. It takes no
  workspace id. Unknown filter values are a `400 INVALID_REQUEST`; the panel
  only ever sends values it offers.
- **`domain/feedback-report.ts`** carries the statuses, `FeedbackStatus`,
  `FEEDBACK_ISSUE_PAGE_SIZE = 20`, and `parseFeedbackIssueFilter`, which the
  service runs.
- **`ports/feedback-report-store.ts` / the MariaDB adapter** provide
  `listPage(filter, limit)` — one parameterised `SELECT`, ordered
  `created_at DESC, id DESC`, filtered by status, category, reporter and the
  composite cursor.
- **`application/feedback-report-query-service.ts`** asks for one row beyond
  the page, slices to 20, marks `isMine` from the trusted caller id, and never
  emits `userId`.
- **`components/knowledge/feedback-issues.tsx`** is the presentational list.
- **`components/knowledge/feedback-report.tsx`** owns the tabs, the form, the
  list fetch, its filters, `Load more`, loading/error states and its retry.
- **`components/shell/user-menu.tsx`** only opens the dialog; there is no
  `issuesHref`, no rail row, no page.

## Schema (migration 031)

```sql
ALTER TABLE feedback_reports
  ADD COLUMN status ENUM('OPEN','IN_PROGRESS','RESOLVED','DUPLICATE')
    NOT NULL DEFAULT 'OPEN' AFTER page_path,
  ADD KEY idx_feedback_status_created (status, created_at, id);
```

Existing rows become `OPEN`. (The plan first numbered this 028; concurrent
work took 028, 029 and 030, so it landed as 031 at integration.)
`idx_feedback_created (created_at, id)` serves the unfiltered order and
`idx_feedback_user_created (user_id, created_at)` the `mine` filter; a combined
status+mine query may scan the status index because the table is small and
bounded by the write rate limit.

## Documentation to amend

- `docs/superpowers/specs/2026-10-13-feedback-reports-to-database-design.md`:
  replace "Reports are append-only: no update or delete path exists." with a
  pointer to this document (the application still has no update/delete path;
  `status` is changed outside it), and replace the "Not in this change" screen
  sentence with a pointer to this design. Do not rewrite the rest of that
  historical record.

## Tests

- **Unit — query parsing/service:** unknown status/category and malformed
  cursor are `INVALID_REQUEST`; defaults are "all, not mine"; `mineOnly` passes
  the trusted caller's id, never a browser-supplied one; `nextCursor` is
  present only when an extra row was fetched.
- **Unit — list route:** the caller and every query parameter reach the
  service; the response is private/no-store; an invalid status is a 400.
- **Unit — component:** status, category, reporter, employee id, path and the
  "You" marker; a long description collapses and only the remainder is in the
  disclosure; code-point-safe preview; hostile names render as text; the two
  empty states.
- **Integration — repository/service:** two users' reports page in
  `created_at DESC, id DESC` order; status/category/mine filters; cursor paging
  neither repeats nor skips a row at identical `created_at`; new rows default
  to `OPEN`; a direct `UPDATE … SET status='RESOLVED'` is read back.
- **E2E:** no rail row and no URL change when the panel opens; the panel closes
  with Escape; two dialog submissions appear; another reporter's report is
  listed with name and emp id; a SQL status update shows on the next open;
  `Status` and `Mine only` narrow the list; rows hold no controls; `Load more`
  appends 20 then the rest without repeats.
- **Lint/typecheck:** module boundaries unchanged (`personal` still imports no
  Next/React/infrastructure).

## Not in this change

- A standalone page, route or navigation row for the board.
- Status editing in the UI or through an API; status history, actors and audit
  events.
- Anonymous reporting, report editing, deletion or retention policy.
- Comments, voting, "me too", notifications, duplicate linking or merging.
- Search across descriptions; counts or analytics; a category filter in the
  panel (the endpoint accepts one, the panel does not offer it yet).

## Anti-goals

- A signed-out reader, or a reader of a shared document, reaching the board.
- Any Workspace scoping of the list or its authorization.
- Any colleague being able to change another person's report or its status.
- Sending `user_id`, document content or any identity field beyond the stored
  `emp_id`/`name` snapshot to the browser.
- Loading the whole table in one response.

## Left to the builder

- Exact copy of the empty states and loading/error sentences.
- The description-collapse threshold and disclosure label.
- The dialog's width and how the list's own scroll behaves on a phone.
- Index/query micro-optimisation if the table ever outgrows the hourly write
  limit.
