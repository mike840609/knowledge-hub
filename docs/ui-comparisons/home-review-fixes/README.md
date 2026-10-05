# Home review fixes — 2026-10-05

Both findings from the [Home review](../home-review/README.md) have been corrected.

## Reading time

The explorer records a document visit once per entered workspace/source/document. Rebuilding its document map or switching Show archived keeps the existing open time. Document availability checks remain in place. Leaving for another document and returning records a new open.

Actual browser result: opening time `2026-10-05T12:57:02.834Z` stayed identical after switching Show archived; revisiting the document changed it to `2026-10-05T12:57:05.037Z`.

## Update metadata

The source name has its own truncation area and a full-name tooltip. Added/Updated and Read/Unread have a separate non-shrinking area. Browser measurements confirmed the entire status fits in the link at 1440, 1280 and 1100px, including long source names and both read states.

[Before, 1440px](../home-review/desktop-1440-long-source.png) · [After, 1440px](desktop-1440-long-source.png) · [After, 1280px](desktop-1280-long-source.png) · [After, 1100px](desktop-1100-long-source.png)

## Verification

- Browser regression: filter preserves the time, navigating away and back updates it, legacy history omits unknown dates, long-source status remains visible, and desktop pages have no horizontal overflow.
- 28 unit tests passed across document shortcuts, Home, empty-state guidance and onboarding state.
- TypeScript, affected-file ESLint and whitespace checks passed.
- Actual Next.js pages and an isolated synthetic database; no production data.

[Browser evidence](evidence.json). Re-run: `npx tsx scripts/screenshots/home-review-fixes.ts`.
