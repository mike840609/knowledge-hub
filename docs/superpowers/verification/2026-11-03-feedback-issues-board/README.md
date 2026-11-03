# Reported issues board — visual check

Captures of `/w/[workspaceId]/issues` from the isolated E2E build of
`feat/feedback-issues-board` (`4e10854d` before the rebase onto `main`; the
board itself did not change in the rebase). The database held fixture
reports only — three reporters, all four statuses, one maximum-length path —
and no production data.

| Capture | What it shows |
| --- | --- |
| `issues-light.png` | Desktop 1440×1000, light theme: rail row, header, filters, all six rows |
| `issues-dark.png` | The same page in the dark palette |
| `issues-narrow.png` | 390×844: filters stack, the timestamp wraps under the reporter, and a long unbroken path wraps instead of overflowing (`document.scrollWidth === 390`) |

The 280-character preview ends in `…`; "Show the full report" opens the
remainder. A report the reader sent carries the muted `You` marker.

![Desktop, light](issues-light.png)

![Desktop, dark](issues-dark.png)

![Narrow](issues-narrow.png)

Captured with a throwaway Playwright spec against the E2E harness, which
provisions the isolated database and builds the app; the spec was not
committed.
