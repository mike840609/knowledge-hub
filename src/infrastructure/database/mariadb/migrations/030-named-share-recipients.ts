import type { Migration } from "./types";

/**
 * A link may name its readers instead of expiring. `audience` says which: a LINK
 * keeps its expiry, a NAMED link has none and is opened only by a listed recipient.
 * The IS NOT NULL is explicit because a CHECK passes on NULL. Existing rows are LINK. `read_at` is the recipient's own read state.
 */
export const namedShareRecipientsMigration: Migration = {
  version: 30,
  name: "named-share-recipients",
  statements: [
    `ALTER TABLE document_share_links
      ADD COLUMN audience ENUM('LINK','NAMED') NOT NULL DEFAULT 'LINK',
      MODIFY expires_at DATETIME(6) NULL`,
    `ALTER TABLE document_share_links DROP CONSTRAINT ck_share_links_expiry`,
    `ALTER TABLE document_share_links ADD CONSTRAINT ck_share_links_expiry
      CHECK ((audience = 'LINK' AND expires_at IS NOT NULL AND expires_at > created_at) OR (audience = 'NAMED' AND expires_at IS NULL))`,
    `CREATE TABLE document_share_link_recipients (
      share_link_id UUID NOT NULL, user_id UUID NOT NULL, added_by UUID NOT NULL,
      added_at DATETIME(6) NOT NULL, read_at DATETIME(6) NULL,
      PRIMARY KEY (share_link_id, user_id), KEY ix_recipient_user (user_id, added_at),
      FOREIGN KEY (share_link_id) REFERENCES document_share_links(id) ON DELETE RESTRICT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
