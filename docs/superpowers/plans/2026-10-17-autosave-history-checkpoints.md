# Autosave history checkpoints

Implement the approved policy: keep the current 3-second idle/15-second maximum autosave; retain immutable historical checkpoints every 10 minutes of active editing, preserve the final head after 2 minutes without edits, and group one author's activity until a 1-hour idle gap. Comment references, explicitly kept/named versions, author handoffs, and restores retain their snapshots.

## Storage and compatibility

- Add history metadata to revision rows. Existing rows remain immutable checkpoints; only newly created AUTOSAVE working rows can be reclaimed.
- Each save still receives a new revision ID and monotonically increasing change number. Keep optimistic conflict checks and reader revision references compatible.
- A working head is already durably stored. Its two-minute idle boundary is enforced when the next edit arrives, even if the editor/browser was closed; no client timer or background job is required to protect the final state.
- Reclaim superseded working rows only after the current pointer/link index has advanced and only if no review, read-progress or sync reference exists. Read-progress may retain a bounded working row per reader; those rows are excluded from history and become reclaimable when references advance.
- Preserve referenced revisions transactionally when starting a comment. Manual checkpoint naming uses the same author/source/workspace locks and expected-current-ID check as content writes.

## Deliverables

1. Add migration, history policy and repository operations; integrate AUTOSAVE, manual/restore and named checkpoints in the command service.
2. Include history metadata in read models; render one-hour activity groups, current working content and named checkpoints in the inspector. Bound the client's local revision overlay too.
3. Verify boundary times, unchanged saves, author changes, stale concurrent saves, reference retention, immutable restore/naming and storage counts with unit/real MariaDB tests. Run affected browser authoring/history/comment flows, lint and type checks.
4. Apply the additive migration to the local development database and leave the service available for manual testing. Keep earlier uncommitted inline-comment changes intact.
