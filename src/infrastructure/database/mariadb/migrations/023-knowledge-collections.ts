import type { Migration } from "./types";

export const knowledgeCollectionsMigration: Migration = {
  version: 23,
  name: "knowledge-collections",
  statements: [
    `CREATE TABLE knowledge_collections (
      id UUID NOT NULL,
      workspace_id UUID NOT NULL,
      name VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      description TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      version BIGINT UNSIGNED NOT NULL DEFAULT 1,
      status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
      created_by UUID NOT NULL,
      updated_by UUID NOT NULL,
      archived_by UUID NULL,
      archived_at DATETIME(6) NULL,
      created_at DATETIME(6) NOT NULL,
      updated_at DATETIME(6) NOT NULL,
      PRIMARY KEY (id),
      CONSTRAINT fk_collection_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
      CONSTRAINT fk_collection_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT fk_collection_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT fk_collection_archived_by FOREIGN KEY (archived_by) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT ck_collection_name CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 120),
      CONSTRAINT ck_collection_description CHECK (CHAR_LENGTH(description) <= 2000),
      CONSTRAINT ck_collection_version CHECK (version >= 1),
      CONSTRAINT ck_collection_status CHECK (status IN ('ACTIVE', 'ARCHIVED')),
      CONSTRAINT ck_collection_archive CHECK (
        (status='ACTIVE' AND archived_by IS NULL AND archived_at IS NULL) OR
        (status='ARCHIVED' AND archived_by IS NOT NULL AND archived_at IS NOT NULL)
      ),
      KEY idx_collections_workspace_status (workspace_id, status, updated_at, id)
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE knowledge_collection_items (
      id UUID NOT NULL,
      collection_id UUID NOT NULL,
      document_id UUID NOT NULL,
      position INT UNSIGNED NOT NULL,
      reading_note TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      added_at DATETIME(6) NOT NULL,
      PRIMARY KEY (id),
      CONSTRAINT uq_collection_item_document UNIQUE (collection_id, document_id),
      CONSTRAINT fk_collection_item_parent FOREIGN KEY (collection_id) REFERENCES knowledge_collections(id) ON DELETE RESTRICT,
      CONSTRAINT fk_collection_item_document FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE RESTRICT,
      CONSTRAINT ck_collection_item_note CHECK (CHAR_LENGTH(reading_note) <= 500),
      KEY idx_collection_items_order (collection_id, position, id)
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
