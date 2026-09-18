import type { Migration } from "./types";

export const phase2StableSourceIdentityMigration: Migration = {
  version: 10,
  name: "phase-2-stable-source-identity",
  statements: [
    "ALTER TABLE source_import_snapshot_entries ADD COLUMN external_id VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER source_path_hash",
    "ALTER TABLE source_import_snapshots DROP CONSTRAINT ck_import_snapshots_adapter",
    `ALTER TABLE source_import_snapshots ADD CONSTRAINT ck_import_snapshots_adapter CHECK (
      (adapter_type = 'GENERIC_MARKDOWN_FOLDER' AND adapter_version = 'phase2:v1' AND plan_version = 'phase2:v1')
      OR
      (adapter_type = 'GENERIC_MARKDOWN_FOLDER' AND adapter_version = 'phase2:v2' AND plan_version = 'phase2:v2')
    )`,
  ],
};
