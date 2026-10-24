import type { Migration } from "./types";

/**
 * Additive read-path indexes. The sync-run index serves the per-source latest
 * APPLIED lookup; the tree index lets the rewritten order avoid a filesort.
 * No data is backfilled and no existing index is removed.
 */
export const queryPathIndexesMigration: Migration = {
  version: 25,
  name: "query-path-indexes",
  statements: [
    "CREATE INDEX idx_sync_runs_source_status_completed ON sync_runs (source_id, status, completed_at)",
    "CREATE INDEX idx_tree_source_parent_position_order ON knowledge_tree_nodes (source_id, parent_id, position)",
  ],
};
