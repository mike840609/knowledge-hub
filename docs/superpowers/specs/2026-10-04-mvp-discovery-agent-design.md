# MVP: Folder scope, search filters and Copy for Agent

User instruction: execute the three recommended MVP additions. Scope is approved in the conversation; implement in this session. No images, editor changes, external model calls, deployment or main merge.

## Folder scope

Rules are at most 50 exact root-relative paths/directory prefixes, no glob or traversal. Always exclude .git/.obsidian. First import and resync both expose the editor. The source owns the last successfully applied rules; browser drafts are only migration/recovery input. The client loads authoritative rules and syncVersion before scanning; a server version check prevents scanning stale rules and applying against a newer source. The snapshot stores proposed and previous rules plus excluded-file count, includes them in its integrity hash, and Preview shows the change and affected archives. Apply saves proposed rules in the same transaction as content and version advancement; cancellation/failure saves nothing. Existing previews without scope retain old integrity hashes and do not overwrite source rules. Existing browser-local rules are offered as a migration candidate without silently superseding saved source rules. All endpoints require trusted caller and workspace access. Counts describe the client scan, not server-attested filesystem inventory.

## Search

Extend existing keyword search with optional root-relative path prefix, from/to date, and relevance/newest/oldest sorting. Filters can be used without a keyword. Path matches a file or descendants at segment boundaries, with SQL LIKE metacharacters escaped. Folder-source paths come from SourceEntry. Use current revision creation time as content update time, so move-only updates do not change date matches. Dates are inclusive calendar dates in an explicit UTC offset supplied by the browser, with UTC fallback for no JavaScript. Reject invalid date/path/range/offset/sort inputs visibly. Preserve all filters in pagination URLs. Keep workspace read checks and SQL time/row limits.

## Copy for Agent

Provide a My Space page listing active saved documents, with search and multi-select; also a single-document reader entry. Manually select 1–20 documents; request creates a bounded Markdown bundle from current saved revisions. Include source name/path, document ID, revision ID/number, update instant, and version-pinned original links. Maximum 256 KiB including metadata; reject rather than silently truncate. Current revisions are read in one unit of work with per-document workspace policy and active placement checks. Require the selected PERSONAL workspace and every document to match it. Do not expose share-token shortcuts. Return private/no-store JSON. Preview is plain read-only text; Copy writes only the reviewed generated text to the clipboard, with a selectable fallback and explicit errors. A new selection clears prior generated output. No automatic related-document expansion, token estimates, persistence of bundles or AI calls.

## Verification

Unit: rules, hashes, date boundaries/invalid inputs, SQL escaping/ordering, bundle bounds and authorization, client scope scanning. Integration: initial/resync Apply, rollback and stale-scope conflict, scoped search/date/path and bundle reads. Browser: first import exclusions → Preview → Apply → fresh-device resync; filtered pagination; multi-selection → bundle preview → clipboard/fallback. Run unit, typecheck, lint, build and affected DB/browser suites, recording actual limits.
