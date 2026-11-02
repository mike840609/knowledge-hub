# Reported issues: a shared, read-only board

## Problem

"Report a problem" now stores each report in `feedback_reports`
(`docs/superpowers/specs/2026-10-13-feedback-reports-to-database-design.md`),
but only a maintainer with database access can see them. Reporters cannot tell
whether a problem they hit has already been reported, so the same bug arrives
many times and each reporter is left wondering whether anyone noticed.

That earlier design deliberately left the reading screen, its access capability
and notifications for a later change. This is that change, narrowed to the
reading screen and a status a maintainer sets directly in the database.

## Decision in one line

Every signed-in colleague gets an **Issues** page in their personal workspace
listing every report anyone sent, newest first, with the reporter's name and
employee ID, and a status the maintainer edits with SQL.

## Who may read, and why

- **Any trusted caller may read every report.** The audience is the reporters
  themselves, and every colleague is a potential reporter. No Workspace role,
  membership or platform capability is involved; the reports are not
  Workspace-scoped data.
- **Nothing is signed-out-visible.** The page sits under `/w/[workspaceId]`,
  behind the same trusted-caller middleware as every private page.
- **The page is hosted by the reader's personal workspace.** The board itself
  is global, but every user has a personal workspace, and that is where their
  own surfaces (Inbox, Shares, Insights) already live. The route refuses any
  non-personal workspace with `notFound()`, exactly as `/inbox` does.
- **Identity is shown in full: display name and `emp_id`.** The reporter chose
  "show all" over anonymising, so a colleague can see who reported a problem
  and follow up with them. `user_id` is never sent to the browser — it is an
  internal join key, not part of the board.

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
  next page load reflects it. This is a deliberate trade: no write path, no
  authorization question, no accidental closure by a colleague.
- **The board is one row per submission.** `DUPLICATE` marks a report that
  repeats another; there is no merge, link or de-duplication view in this
  version.
- **The page is dynamic, not cached.** A status edit made in SQL appears on
  reload rather than after a rebuild.

The append-only sentence in the 2026-10-13 spec is amended by this document:
rows are still never edited by the application, and status is the one column a
person may change, outside the application.

## What the page shows

Route: `/w/[workspaceId]/issues` (personal workspace only).

- **Navigation:** a new **Issues** row in the primary rail, for personal
  workspaces only, using the `MessageSquareWarning` glyph the report dialog
  already uses. It sits with the other personal rows.
- **Header:** page title `Issues`; one muted line saying these are the problems
  colleagues reported through "Report a problem", newest first.
- **Each row**, in this order:
  - status, using the shared `Status` primitive — `Open` = `active`,
    `In progress` = `pending`, `Resolved` = `success`, `Duplicate` = `none`
    (a glyph and a word, never colour alone);
  - category, using `Badge` (Sync / Search / Reading / Other);
  - the description, wrapping as written; when it is long, it collapses behind
    a disclosure in the same manner as the audit page's "Technical details";
  - reporter: display name and `emp_id`, with a muted "You" marker on the
    reader's own reports;
  - the page path the report was made on, set in the monospace face and marked
    as a path rather than a link (the reader's access to that page is not
    implied);
  - `Timestamp` for `created_at`, machine-readable `dateTime`.
- **Filters** live in the URL and survive the "Older" link:
  - `status` — all (default) or one value;
  - `category` — all (default) or one value;
  - `mine=true` — only the reader's own reports.
  A plain form with `Select` controls and a checkbox, submitted with the page's
  existing `LiveSearch`/`noscript` filter pattern (`/updates` is the model).
- **Paging:** 50 reports per page, newest first, ordered
  `created_at DESC, id DESC`. The cursor is composite and carried in two URL
  parameters, the way `/updates` carries `time` and `run`: `beforeAt` (the last
  row's ISO `created_at`) and `beforeId` (its id). An "Older issues" link opens
  the next page; it replaces the current rows rather than accumulating them,
  and the browser's Back returns to the newer page. There is no "Load more"
  client fetch and no new API. A malformed or stale cursor falls back to the
  first page.
- **Empty and filtered-empty states** are one muted sentence in the list's
  place — no second heading, because the page header already carries the title:
  nothing reported yet, versus nothing matching these filters (with the filters
  still visible so they can be cleared).

## Read path and layering

Follows the existing `personal` module and server-read-projection pattern; no
new API route.

- **`domain/feedback-report.ts`**
  - `FEEDBACK_STATUSES`, `FeedbackStatus`, and a guard.
  - `FEEDBACK_ISSUE_PAGE_SIZE = 50`.
  - `parseFeedbackIssueFilter(input)` validating URL-shaped input into
    `{ status?, category?, mineOnly, before?: { createdAt: Date; id: string } }`,
    throwing `INVALID_REQUEST` for an unknown status/category or a cursor that
    is not an ISO timestamp plus a UUID. The domain receives a plain object,
    never `URLSearchParams`.
- **`ports/feedback-report-store.ts`** gains
  `listPage(filter, limit): Promise<FeedbackIssueRecord[]>` returning at most
  `limit + 1` rows so the application can decide whether a next page exists, as
  the audit repository does. `filter` carries `status?`, `category?`, `userId?`
  and the composite `before?`; `FeedbackIssueRecord` carries `userId` because
  the store needs it to filter "mine" and to let the application mark the
  reader's own rows. `userId` stops at the application boundary.
- **`application/feedback-report-query-service.ts`** —
  `FeedbackReportQueryService.list(caller, input)`:
  - parses the filter;
  - passes `caller.identity.id` as the store's `userId` for `mineOnly`;
  - asks the store for one extra row;
  - maps each record to a view that carries `isMine: record.userId ===
    caller.identity.id` and never `userId`;
  - returns `{ items, nextCursor }`, where `nextCursor` is the last returned
    row's `{ createdAt, id }` when another row exists, else `null`.
  - It takes the caller even though every caller may read, so the "any
    colleague may read" rule is expressed in one place and both `mine` and the
    "You" marker have a trusted source.
- **`infrastructure/.../repositories/feedback-reports.ts`** implements
  `listPage` with one parameterised `SELECT`:
  `id, user_id, emp_id, user_name, category, description, page_path, status,
  created_at`; filters `status = ?`, `category = ?`, `user_id = ?`, and the
  composite `(created_at, id) < (?, ?)`; ordered `created_at DESC, id DESC`;
  limit `50 + 1`.
- **`src/server/feedback-issues-read.ts`** — `getFeedbackIssues(workspaceId,
  query)`: normalises URL input first (an unrecognised `status`/`category` is
  dropped and the control falls back to All; an incomplete or malformed cursor
  is dropped and the first page is shown, so a typo never becomes a 404 or an
  error page), then establishes the trusted caller, verifies the workspace is
  the caller's active personal workspace (same rule as the profile/inbox
  reads), maps only workspace/access failure to `null` so the page can
  `notFound()`, and returns the page model with the applied filters.
  `parseFeedbackIssueFilter` still validates for any other caller of the
  query service; normalisation happens at the web edge.
- **`src/app/w/[workspaceId]/issues/page.tsx`** — force-dynamic server
  component; reads `searchParams`, calls the projection, renders the header,
  filter form, list and "Older issues" link.
- **`src/components/knowledge/feedback-issues.tsx`** — the presentational list
  (server component unless a disclosure needs client state). No fetching.

## Schema (migration 028)

```sql
ALTER TABLE feedback_reports
  ADD COLUMN status ENUM('OPEN','IN_PROGRESS','RESOLVED','DUPLICATE')
    NOT NULL DEFAULT 'OPEN' AFTER page_path,
  ADD KEY idx_feedback_status_created (status, created_at, id);
```

Existing rows become `OPEN`. `idx_feedback_created (created_at, id)` already
serves the unfiltered order and `idx_feedback_user_created (user_id, created_at)`
the `mine` filter; a combined status+mine query is allowed to scan the status
index because the table is small and bounded by the write rate limit.

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
- **Integration — repository/service:** two users' reports page in
  `created_at DESC, id DESC` order; status/category/mine filters; cursor paging
  neither repeats nor skips a row at identical `created_at`; new rows default
  to `OPEN`; a direct `UPDATE … SET status='RESOLVED'` is read back.
- **E2E:** the Issues row appears in the personal rail (the nav item is gated
  on `access.workspace.type === "PERSONAL"`); the page lists reporters other
  than the reader with name and emp id; `mine` and `status` filters narrow the
  list; the Older link opens the next page with only older rows and keeps the
  filters; an unrecognised filter value shows the unfiltered page instead of a
  404; a report sent from the dialog appears; no status control exists.
- **Lint/typecheck:** module boundaries unchanged (`personal` still imports no
  Next/React/infrastructure).

## Not in this change

- Status editing in the UI or through an API; status history, actors and audit
  events.
- Anonymous reporting, report editing, deletion or retention policy.
- Comments, voting, "me too", notifications, duplicate linking or merging.
- Search across descriptions; counts or analytics on the board.
- A link from the report dialog to the board (discoverability comes from the
  personal rail).

## Anti-goals

- A signed-out reader, or a reader of a shared document, reaching the board.
- Any colleague being able to change another person's report or its status.
- Sending `user_id`, document content or any identity field beyond the stored
  `emp_id`/`name` snapshot to the browser.
- Loading the whole table in one response.

## Left to the builder

- Exact copy of the header line, empty states and status words beyond the table
  above.
- The description-collapse threshold and disclosure label.
- Whether the row shows a report's count or "showing newest first" wording.
- Index/query micro-optimisation if the table ever outgrows the hourly write
  limit.
