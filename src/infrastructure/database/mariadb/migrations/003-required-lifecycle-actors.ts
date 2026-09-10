import type { Migration } from "./types";

/** Lifecycle-bearing rows must always identify the user who last changed them. */
export const requiredLifecycleActorsMigration: Migration = {
  version: 3,
  name: "required-lifecycle-actors",
  statements: [
    "ALTER TABLE knowledge_sources MODIFY updated_by UUID NOT NULL",
    "ALTER TABLE knowledge_documents MODIFY updated_by UUID NOT NULL",
    "ALTER TABLE knowledge_tree_nodes MODIFY updated_by UUID NOT NULL",
    "ALTER TABLE source_entries MODIFY updated_by UUID NOT NULL",
  ],
};
