import type { Migration } from "./types";
export const savedDocumentSharesMigration: Migration = {
  version: 19, name: "saved-document-shares", statements: [
    `CREATE TABLE saved_document_shares (
      id UUID NOT NULL, user_id UUID NOT NULL, share_link_id UUID NOT NULL,
      saved_title VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      saved_shared_by_name VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      saved_expires_at DATETIME(6) NOT NULL, saved_at DATETIME(6) NOT NULL,
      updated_at DATETIME(6) NOT NULL, removed_at DATETIME(6) NULL,
      PRIMARY KEY (id), UNIQUE KEY uq_saved_share_user_link (user_id, share_link_id),
      CONSTRAINT fk_saved_share_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT fk_saved_share_link FOREIGN KEY (share_link_id) REFERENCES document_share_links(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      KEY idx_saved_share_recipient (user_id, removed_at, saved_at, id)
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
