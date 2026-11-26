import type { Migration } from "./types";

/**
 * Additive read-path indexes for the search and Inbox polling queries. Path
 * filters and `findBySourcePath` gain a source-scoped prefix index, task search
 * gains its workspace/owner composite, and unread recipient polls can skip
 * already-read rows. No data is backfilled and no existing index is removed.
 */
export const searchAndUnreadIndexesMigration: Migration = {
  version: 36,
  name: "search-and-unread-indexes",
  statements: [
    "CREATE INDEX idx_entries_source_path ON source_entries (source_id, source_path(255))",
    "CREATE INDEX idx_task_bindings_workspace_owner ON task_export_bindings (workspace_id, owner_user_id)",
    "CREATE INDEX idx_recipient_user_unread ON document_share_link_recipients (user_id, read_at, added_at)",
  ],
};
