import type { Migration } from "./types";

/**
 * Two lookups had no index to use. Group mappings are read by external group
 * on every request of a caller with SSO groups, but every index there led with
 * the workspace. A source entry is found by its tree node whenever a folder is
 * renamed, moved, archived or restored, and that table grows with every
 * document. Additive only: nothing is dropped or rewritten.
 */
export const lookupIndexesMigration: Migration = {
  version: 18, name: "lookup-indexes",
  statements: [
    "CREATE INDEX idx_group_mappings_external_group ON workspace_group_mappings (external_group_id)",
    "CREATE INDEX idx_entries_tree_node ON source_entries (tree_node_id)",
  ],
};
