import type { Migration } from "./types";
export const personalItemsMigration: Migration = {
  version: 13, name: "personal-items",
  statements: [`CREATE TABLE personal_items (
    user_id UUID NOT NULL, workspace_id UUID NOT NULL,
    item_key VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    payload JSON NULL, version INT UNSIGNED NOT NULL,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id, workspace_id, item_key),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
};
