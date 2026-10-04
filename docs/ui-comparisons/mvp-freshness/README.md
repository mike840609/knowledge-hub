# Knowledge freshness reminders

Home lists folders awaiting Apply, with a failed latest sync, never imported, or older than the selected threshold. Each row links to the preview or the folder update flow.

Personal workspace only. Default 14 days, with 7/14/30-day choices saved across sessions. Age is measured from the last successfully applied import; external folders are not checked automatically. Pending preview takes priority, then failure, then never imported, then age. Archived folders, uploads and Hub-managed sources are excluded.

## Desktop

![Desktop](desktop.png)

## Mobile

![Mobile](mobile.png)

## Verification

Production build and isolated MariaDB browser test: `tests/e2e/mvp-freshness.spec.ts`. Domain and API tests cover validation, fixed preference keys and version conflicts. Shared preference integration tests cover persistence, concurrent writes and owner/workspace isolation. Screenshots use synthetic test data.

The isolated fixture shows all four states and verifies the pending preview link. Mobile rows keep the full folder name on its own line.
