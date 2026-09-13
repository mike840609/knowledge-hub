import type { Migration } from "./types";
import { assertAssetProjectionReady } from "../asset-projection-validation";

export const phase2AssetProjectionMigration: Migration = {
  version: 7,
  name: "phase-2-asset-projection",
  statements: [
    "ALTER TABLE knowledge_assets ADD COLUMN source_path_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL",
    "ALTER TABLE knowledge_assets ADD COLUMN updated_at DATETIME(6) NULL",
    "UPDATE knowledge_assets SET source_path_hash = LOWER(SHA2(source_path,256)), updated_at = created_at WHERE source_path_hash IS NULL OR updated_at IS NULL",
    "ALTER TABLE knowledge_assets MODIFY source_path_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL",
    "ALTER TABLE knowledge_assets MODIFY updated_at DATETIME(6) NOT NULL",
    "ALTER TABLE knowledge_assets ADD CONSTRAINT uq_assets_source_path_hash UNIQUE (source_id,source_path_hash)",
  ],
  beforeApply: async (connection) => {
    await assertAssetProjectionReady(connection);
  },
};
