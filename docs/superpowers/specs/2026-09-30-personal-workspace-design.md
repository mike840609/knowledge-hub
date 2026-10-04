# Personal workspace rollout

Approved direction: keep Team entry points visible but disabled, labelled Coming soon. Deliver persistent drafts, document organization and Markdown export, followed by revision restoration, a personal home and account-synced favorites.

## Contracts

- Runtime defaults to personal-only. `KM_TEAM_WORKSPACES_ENABLED=true` restores Team availability without changing stored workspace lifecycle or memberships. Server-established caller scope constrains discovery, reads, writes, search and governance. UI disabled entries are explanatory, never authorization.
- Drafts are separate from published revisions and share links. Persist across tab closure, expose save failures, retain the base revision for conflict protection. Scope drafts to the authenticated account and workspace. Saving or explicitly discarding removes the draft. Never silently overwrite a newer remote draft.
- Organization exposes existing Hub commands: folders, move, archive and restore. Source-managed imports stay read-only. No hard deletion, cross-source moves or lifecycle shortcuts.
- Export reads only authorized content. Single Markdown and workspace ZIP preserve metadata and hierarchy, use safe unique paths, exclude drafts and credentials. Binary attachments remain outside the existing content model.
- Restoring an old revision creates a new revision with optimistic concurrency, preserving all existing history.
- Personal home presents resume/recent documents, drafts and favorites. Favorites persist per account, with authorization rechecked on every document access.
- Existing uncommitted changes in the primary checkout are preserved. Implementation uses a separate worktree.

## Implementation choices

- Draft and favorite state is stored in migration 013 `personal_items`, keyed by authenticated user, workspace and item. Compare-and-set versions and deletion tombstones protect against stale writes. New-note drafts have one slot per personal workspace; editing drafts have one slot per document. Migration 012 is the document link index from the remote mainline.
- Personal draft recovery prefers unsynced local text and stops remote writes when the server version diverged. Discarding a conflict removes only the recovery copy. Team-on retains the legacy tab-local draft behavior.
- Organization uses the existing Knowledge tree, its folder dialogs, move dialog, archive/restore controls and keyboard reorder commands from the remote mainline. Home links to that tree. Archive rejects folders with active children. No drag-and-drop is required.
- ZIP exports include archived documents and each document’s latest saved revision, with stable-ID suffixes and a manifest. Markdown links are preserved as written; binary attachments and revision history are excluded. Export is bounded to 64 MiB and 9,999 documents.
- History comparison is a side-by-side Markdown view of the selected and current revision. Restoring identical content follows the existing no-op revision contract.
- Favorites are per-document account records; browser favorites migrate once without overriding remote deletions. Recent reading stays device-local; Home also lists server-derived recent edits.

## Acceptance

Team-off blocks direct API/page access as well as creation and cross-workspace search; Team-on keeps established governance. Close and reopen a draft, recover it, handle storage/save failure and a revision conflict without losing text. Create a folder, move a note, archive and restore it; reject source-managed mutations. Export and inspect Markdown/ZIP paths and metadata, excluding inaccessible documents. Restore a revision without altering old revisions. Favorites survive a fresh browser context for the same account and stay isolated between accounts.
