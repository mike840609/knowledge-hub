# Home browsed article count

Continue reading now includes a muted, inline `Viewed X articles` label. It uses the existing database read-progress records for the current account and My Space. No new database table, migration or separate counter is required.

The aggregate counts distinct documents that have a read-progress record and whose document and source are both active. It includes imported articles and authored notes, is independent of the profile's 7/30-day change period, and does not decrease when a document receives a new revision. Archived documents and sources are excluded.

## Browser verification

Actual Next.js application with an isolated synthetic database:

- Zero before opening a document.
- One after opening a document; still one after opening it again.
- Two after opening another document.
- The same two in a fresh browser context without local recent history.
- One after archiving one viewed document; zero after archiving its source containing the remaining viewed document. Archive fixture updates include the database's required lifecycle provenance.
- Counter remains visible when switching to Drafts.
- Light/dark rendering and 1440/1280px desktop screenshots, without horizontal overflow.
- TypeScript, affected-file ESLint and whitespace checks passed.

[Light desktop](desktop-light.png) · [Dark desktop](desktop-dark.png) · [1280px desktop](desktop-1280.png) · [Zero state](desktop-zero.png) · [Evidence](evidence.json)

Re-run the isolated browser check: `npx tsx scripts/screenshots/home-browsed-count.ts`.
