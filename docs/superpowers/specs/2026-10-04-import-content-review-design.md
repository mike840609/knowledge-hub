# Personal MVP batch 2 — inspect synced content

Existing Preview statistics and filters remain the change summary. Add an explicit archival reminder when missing source documents will be archived, without creating another live status region.

Updated documents offer a lazy content comparison. New GET `/api/source-imports/:snapshotId/content-diff?path=...` resolves a trusted caller, requires snapshot creator ownership and workspace read capability, then requires a non-expired READY v2 plan. Map the requested path through the persisted updateLocator to its revision action and fetch only that action's staged entry. Compare the immutable `expectedCurrentRevisionId` with staged Markdown and planned title; validate entry content hash binding and document identity. No source reread and no canonical mutation. Unknown paths, expired/stale/applied previews and invalid staging return existing import errors. Responses are private/no-store.

Client compares Markdown using the existing bounded revision diff, memoizes the result, initially renders 100 changed/context lines and offers Show more. Metadata-only changes are explicitly identified when Markdown is unchanged; this batch does not offer field-level metadata comparison.

Validation covers creator isolation, unknown paths, expired/stale states, immutable before/after content in MariaDB, no Source version advance, lazy fetching and paginated rendering, plus real browser expand/collapse and archival warning. Screenshots compare the same READY snapshot against main.
