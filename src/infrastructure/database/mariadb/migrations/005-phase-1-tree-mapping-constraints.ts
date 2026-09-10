import type { Migration } from "./types";
import { checkMappingReadiness } from "../mapping-validation";

/**
 * Phase 1 SourceEntry→TreeNode constraint tightening (spec §5.3 step 4).
 *
 * Fixed DDL only. The DOCUMENT `(document_id, tree_node_id)` foreign key
 * references an additional `(document_id, id)` unique key on
 * `knowledge_tree_nodes`; the pre-existing single-document uniqueness is
 * preserved untouched. FOLDER entries carry `document_id = NULL`, so the
 * DOCUMENT key does not constrain them — FOLDER target node type stays an
 * explicit application assertion (see mapping-validation.ts and preflight).
 *
 * The `beforeApply` readiness gate runs fixed read-only queries under the
 * migration lock before any RUNNING ledger write. Incomplete mapping aborts
 * 005 without FAILED/RUNNING ledger pollution; rerun after backfill succeeds.
 * An empty schema passes the gate. The hook takes no operator input, performs
 * no writes, and generates no dynamic manifest statements.
 */
export const treeMappingConstraintsMigration: Migration = {
  version: 5,
  name: "phase-1-tree-mapping-constraints",
  statements: [
    "ALTER TABLE knowledge_tree_nodes ADD CONSTRAINT uq_tree_document_id UNIQUE (document_id, id)",
    "ALTER TABLE source_entries MODIFY tree_node_id UUID NOT NULL",
    "ALTER TABLE source_entries ADD CONSTRAINT fk_entries_tree_same_source FOREIGN KEY (source_id, tree_node_id) REFERENCES knowledge_tree_nodes (source_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT",
    "ALTER TABLE source_entries ADD CONSTRAINT uq_entries_source_tree UNIQUE (source_id, tree_node_id)",
    "ALTER TABLE source_entries ADD CONSTRAINT fk_entries_tree_document FOREIGN KEY (document_id, tree_node_id) REFERENCES knowledge_tree_nodes (document_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT",
  ],
  beforeApply: async (connection) => {
    await checkMappingReadiness(connection);
  },
};
