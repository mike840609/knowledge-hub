import type { Migration } from "./types";
export const sourceImportScopeMigration: Migration = {
  version: 15, name: "source-import-scope",
  statements: [
    "ALTER TABLE knowledge_sources ADD COLUMN excluded_paths JSON NULL",
    "ALTER TABLE source_import_snapshots ADD COLUMN import_scope JSON NULL",
  ],
};
