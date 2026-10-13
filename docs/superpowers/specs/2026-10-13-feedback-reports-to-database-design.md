# Report a problem is stored, not downloaded

## Problem

"Report a problem" (account menu) built a Markdown file in the browser and
downloaded it; the user then had to find the file and send it to a maintainer
themselves. Most reports never made that second trip, and the ones that did
arrived without saying who sent them, so a maintainer could not follow up.

## Decision

- **Sending stores the report in MariaDB.** The dialog's primary action is
  "Send report"; it posts the report and, on success, says "Report sent.
  Thank you." Nothing is downloaded. On failure the error stays beside the
  button (action model §6) and the text the user typed is kept.
- **Every report records who sent it.** `feedback_reports` stores the sender's
  `user_id` and a snapshot of their `emp_id` (and display name) at the time of
  sending. Both come from the trusted caller on the server
  (`caller.identity`); the browser supplies no identity field, and a body that
  carries one is rejected. The snapshot is kept because a maintainer reads
  reports by employee ID and a later identity sync must not rewrite who sent
  an old report.
- **What is stored:** category (`Sync` / `Search` / `Reading` / `Other`), the
  description (trimmed, 1–5000 characters), and the page path the dialog was
  opened on (`window.location.pathname`; must start with `/`, at most 1024
  characters, no query or fragment). Document content is still not included.
  The dialog's description says so: "Your report is sent to the maintainers
  with your employee ID and the page you are on. Document content is not
  included."
- **Endpoint:** `POST /api/feedback-reports` with exactly
  `{ category, description, pagePath }`; `201 { id }`. It requires a trusted
  caller like every other private API. Any signed-in user may report; no
  Workspace capability is involved, and the page path is a string the user
  sent, not something the server resolves or authorizes against.
- **A modest per-user limit**: at most 20 reports in a rolling hour (counted with a plain read before the insert, so two sends racing at the limit may both land — it stops loops, it is not a quota); the 21st
  answers `429 FEEDBACK_RATE_LIMITED` ("Too many reports in the last hour. Try
  again later."). It keeps a stuck retry loop or a script from filling the
  table, and no real user meets it.
- **Layering:** `personal` module — `domain/feedback-report.ts` (validation),
  `ports/feedback-report-store.ts`, `application/feedback-report-service.ts` —
  with a MariaDB adapter in `infrastructure`, wired in `composition.ts`.

## Schema (migration 020)

```sql
CREATE TABLE feedback_reports (
  id UUID NOT NULL,
  user_id UUID NOT NULL,               -- FK users(id)
  emp_id VARCHAR(128) utf8mb4_bin NOT NULL,   -- snapshot at send time
  user_name VARCHAR(512) NOT NULL,             -- snapshot at send time
  category ENUM('Sync','Search','Reading','Other') NOT NULL,
  description TEXT NOT NULL,
  page_path VARCHAR(1024) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_feedback_created (created_at, id),
  KEY idx_feedback_user_created (user_id, created_at),
  KEY idx_feedback_emp (emp_id, created_at)
)
```

Reports are append-only: no update or delete path exists.

## Not in this change

A screen for reading reports. Maintainers query the table directly
(`SELECT … FROM feedback_reports ORDER BY created_at DESC`); a triage view, its
access capability and notifications are a later change with their own spec.
The Markdown export (`src/lib/feedback-report.ts`) is removed with the
download.
