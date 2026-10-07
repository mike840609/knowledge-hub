# Folder import reliability hardening

This follow-up starts at PR #98's verified `c3cc2156e1f5a347709d02920d1709fe6aff4fe8` and preserves its authorization and Strict Mode fixes.

## Session behavior

- Replay transient network failures and HTTP 408/425/429/500/502/503/504 for an upload batch or finalize, against the same snapshot and identical batch. Recheck cancellation and permission before every attempt.
  - **Amended 2026-10-08:** up to three replays (four attempts), waiting about 1, 2 and 4 s before them, each scaled by a random 0.5–1.5. Cancelling ends a wait at once.
  - Was: at most one immediate replay. A folder at the limit uploads in about a thousand batches, so one batch failing twice in a row during a brief network drop abandoned the whole import.
- Treat an unreadable successful finalize body as a lost response and replay finalize. The server already makes both upload and finalize idempotent.
- Session creation is not retried or aborted because it is non-idempotent. Obtain the returned id before discarding a cancelled creation.
- Explicit Cancel import, component unmount and pagehide abort subsequent work. On terminal failure/cancellation, send a best-effort keepalive DELETE for the known snapshot. Offline/unknown-id failures retain the existing two-hour BUILDING TTL fallback.
- DELETE derives the caller from trusted identity and atomically deletes only that creator's BUILDING staging. Cascading entries releases quota immediately. Repeated deletes, another creator and READY/APPLIED/STALE states return `abandoned: false`. Private staging cleanup remains allowed after workspace access is revoked; canonical knowledge is untouched.

## Resource bounds

- Reject assets over 64 MiB individually or 512 MiB combined by default. `KM_IMPORT_MAX_ASSET_FILE_BYTES` and `KM_IMPORT_MAX_ASSET_TOTAL_BYTES` override positive integer byte limits.
- Initial import and resync pages pass server limits to the client. Client preflight inspects all sizes before reading any bytes. The server independently validates the manifest before persisting staging and classifies by extension.
- Hash at most four assets concurrently, preserve sorted manifest order and hashes, and check cancellation between file reading and hashing. Stop scheduling after a failure and drain already active non-abortable reads/digests before returning.
- Binary assets remain reference metadata; Markdown and existing upload limits retain their behavior.

## Verification

Use behavioral unit tests for retry, cancellation, worker bounds, preflight and runtime configuration; MariaDB integration tests for ownership, cascades, quota and terminal-state protection; browser tests for lost responses after server commit, explicit cancellation and API limits. Run complete unit, integration and E2E suites plus typecheck, lint and production build. The new PR is stacked on #98 so its diff contains only this follow-up. Neither PR is merged.
