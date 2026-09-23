import type { Migration } from "./types";

/**
 * Document share links (share-link spec §7).
 *
 * - The link stores no workspace or source: scope is derived through
 *   Document → Source → Workspace, never stored twice.
 * - `token` is a random UUIDv4, separate from every entity ID (spec §8).
 * - Views are counted per link per UTC day and carry nothing that identifies
 *   the viewer, who is anonymous by design (spec A1).
 */
export const documentShareLinksMigration: Migration = {
  version: 11,
  name: "document-share-links",
  statements: [
    `CREATE TABLE document_share_links (
      id UUID NOT NULL,
      document_id UUID NOT NULL,
      token UUID NOT NULL,
      label VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
      created_by UUID NOT NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      expires_at DATETIME(6) NOT NULL,
      revoked_by UUID NULL,
      revoked_at DATETIME(6) NULL,
      PRIMARY KEY (id),
      CONSTRAINT uq_share_links_token UNIQUE (token),
      CONSTRAINT fk_share_links_document FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT fk_share_links_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT fk_share_links_revoked_by FOREIGN KEY (revoked_by) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ck_share_links_expiry CHECK (expires_at > created_at),
      CONSTRAINT ck_share_links_revoked CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
      KEY idx_share_links_document (document_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE document_share_link_views (
      share_link_id UUID NOT NULL,
      view_date DATE NOT NULL,
      first_viewed_at DATETIME(6) NOT NULL,
      last_viewed_at DATETIME(6) NOT NULL,
      view_count INT UNSIGNED NOT NULL,
      PRIMARY KEY (share_link_id, view_date),
      CONSTRAINT fk_share_views_link FOREIGN KEY (share_link_id) REFERENCES document_share_links(id) ON UPDATE RESTRICT ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
