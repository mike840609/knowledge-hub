import type { Migration } from "./types";

/**
 * Phase 1 SourceEntry→TreeNode schema expansion (spec §5.3 step 2).
 *
 * Fixed DDL: adds only the nullable `tree_node_id` column. Operator mapping
 * data never enters migration statements or checksums; backfill runs through
 * the independent `scripts/db/backfill-source-tree-mapping.ts` script.
 */
export const treeMappingMigration: Migration = {
  version: 4,
  name: "phase-1-tree-mapping",
  statements: [
    "ALTER TABLE source_entries ADD COLUMN tree_node_id UUID NULL",
  ],
};
