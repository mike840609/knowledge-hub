# Articles viewed moved to Insights

The cumulative viewed article count now appears as a compact row in Insights → Your knowledge. Home no longer displays this statistic.

## Counting

Uses the existing database read progress records. Each active article opened by the current user in My Space counts once across all time. Archived documents and sources are excluded. The 7/30-day selector only affects recent changes.

## Desktop screenshots

- [Insights — light](insights-desktop-light.png)
- [Insights — dark](insights-desktop-dark.png)
- [Home without the statistic](home-desktop-light.png)

Captured at 1440 × 900 using the actual application and an isolated synthetic database.

## Browser checks

- Insights count increases from 0 → 1 → 2 after opening two articles.
- Both 7-day and 30-day views display the same cumulative count.
- A new browser context displays the same database count.
- Home contains no viewed article counter and retains recent reading entries.

See [evidence.json](evidence.json). Reproduce with `npx tsx scripts/screenshots/insights-browsed-count.ts`.
