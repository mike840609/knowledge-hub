import type { Migration } from "./types";

/**
 * A recipient of a NAMED link may propose another person by mentioning them; the link's owner decides.
 * One row per (link, person), whatever its status, so a decline is final for proposals. The three
 * `*_read_at` columns are each party's own Inbox read state.
 */
export const shareLinkProposalsMigration: Migration = {
  version: 32,
  name: "share-link-proposals",
  statements: [
    `CREATE TABLE document_share_link_proposals (
      id UUID NOT NULL PRIMARY KEY, share_link_id UUID NOT NULL, user_id UUID NOT NULL, proposed_by UUID NOT NULL, comment_id UUID NOT NULL,
      status ENUM('PENDING','APPROVED','DECLINED') NOT NULL,
      created_at DATETIME(6) NOT NULL, decided_by UUID NULL, decided_at DATETIME(6) NULL,
      owner_read_at DATETIME(6) NULL, proposed_read_at DATETIME(6) NULL, proposer_read_at DATETIME(6) NULL,
      UNIQUE KEY uq_share_proposal (share_link_id, user_id),
      KEY ix_proposal_user (user_id, created_at), KEY ix_proposal_by (proposed_by, created_at),
      FOREIGN KEY (share_link_id) REFERENCES document_share_links(id) ON DELETE RESTRICT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY (proposed_by) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY (comment_id) REFERENCES document_review_comments(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
