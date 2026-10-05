# Home review — 2026-10-05

Scope: current local Home after the four refinements. Actual Next.js application, isolated synthetic database, desktop only. Product files were not changed during this review.

Resolution: both findings were subsequently fixed and verified. See the [fix verification](../home-review-fixes/README.md).

## Confirmed findings

### P2 — Filtering the explorer overwrites the document open time

`source-sidebar.tsx:85` depends on the `documents` map. Changing Show archived rebuilds that map and calls `rememberDocument` again even though the document ID has not changed. The newly added timestamp makes the existing effect's repeated calls visible as a false last-open time.

Browser reproduction: open a document, record its local `openedAt`, open Document display options, select Show archived. Same document remains open; timestamp changes from `2026-10-05T12:27:18.030Z` to `2026-10-05T12:27:20.341Z`.

Recommendation: record a read when entering a document, and guard repeated effects for the same document. Returning to it after leaving must still record a new open. Do not remove permission/document-availability checks.

### P2 — Long source names hide update and unread status

`home-updates.tsx:19` truncates a single string containing the source name followed by Added/Updated and Read/Unread. At desktop two-column widths, a long source name consumes the entire line and both statuses disappear.

Recommendation: constrain/truncate the source label independently; keep the status in a separate non-shrinking element or line.

[1440px reproduction](desktop-1440-long-source.png) · [1280px reproduction](desktop-1280-long-source.png)

## Checks

- 28 unit tests passed: document shortcuts, Home, empty-state guidance, onboarding state.
- TypeScript, affected-file ESLint and git diff whitespace checks passed.
- Browser: Show archived reproduces the false timestamp; legacy recents without `openedAt` display no invented dates.
- Desktop: 1440, 1280 and 1100px have no horizontal page overflow.
- Reused unchanged evidence from the previous capture for mouse/keyboard tab activation, selected underline, pending/failed reminder links, dark theme, and actual read-time recording.
- Layout/type detector reported no deterministic findings.

## Scoped technical audit

| Dimension | Score / 4 | Assessment |
| --- | --- | --- |
| Accessibility | 3 | Labeled search, tabs and keyboard activation checked; statuses can be visually clipped. |
| Performance | 3 | Bounded main lists; relative timestamps use individual minute timers. |
| Responsive design | 2 | No horizontal page overflow; long source names hide essential metadata in desktop columns. |
| Theming | 4 | Home uses shared light/dark tokens and existing control styles. |
| Implementation integrity | 2 | Last-open time changes on a filter operation. |
| Total | 14 / 20 | Two localized corrections needed. |

[Browser evidence](evidence.json). Rerun browser reproduction with `npx tsx scripts/screenshots/home-review.ts`.
