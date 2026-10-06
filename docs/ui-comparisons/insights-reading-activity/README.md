# Insights reading activity

Reading activity adds distinct articles viewed, active days, and a daily muted blue bar chart to the existing Insights page. It follows the compact workbench typography, 24px section rhythm, thin separators, and shared tooltip used elsewhere in the application. Reading uses muted blue, synced sources use muted purple, and personal notes use sage green, with theme-specific colors. The current-library all-time counter is grouped here as secondary information.

## Counting and storage

Migration 016 records an explicit UTC tracking start and creates `document_read_activity`, keyed by user, workspace, Taipei calendar date, and article. Opening any revision records one visit per article per day in the same transaction as existing revision read progress. Reopening an article is deduplicated; daily sums may exceed the period's distinct article count. Historical activity remains after archiving; current-library all-time views exclude archived articles and sources.

The period covers 7 or 30 calendar days including today in Asia/Taipei (UTC+8). Existing recent-change statistics continue to cover their documented rolling period. Tracking begins when migration 016 is applied. Earlier dates are marked Not tracked and are not backfilled from revision read progress.

Run the normal migration workflow (`npm run db:migrate`) before starting the updated application against an existing database.

## Interaction

Hover or focus a daily bar for the date and article count. One bar enters the Tab order; left/right arrows, Home, and End move through dates. The chart reuses the shared tooltip and shows zero and the scale maximum. The compact caption states the timezone; a tracking-start notice appears only if the period includes untracked dates. Full counting rules remain in How counts work.

## Captures

- [7 days, desktop light](insights-desktop-light.png)
- [Reading section detail](reading-detail-light.png)
- [30 days, desktop light](insights-30-days-light.png)
- [1280px desktop](insights-desktop-1280.png)
- [Desktop dark](insights-desktop-dark.png)

The captures use actual Next.js components and a disposable synthetic database. Historical visits and the migration start date are staged only in that fixture to demonstrate the chart; no production database is changed.

## Verification

- 18 reading/profile integration tests passed, including daily deduplication, unique period totals, 7/30-day windows, active days, and retained history after archiving.
- 3 targeted unit tests passed, including Taipei midnight and year boundaries.
- 2 profile E2E tests and the production build passed.
- Browser capture script checks both periods, shared tooltip, keyboard navigation, a keyboard entry point after switching from 30 to 7 days, untracked-day states, fresh-browser DB totals, and desktop overflow.

Reproduce: `npx tsx scripts/screenshots/insights-reading-activity.ts`.
