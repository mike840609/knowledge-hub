import type { Migration } from "./types";
// Additive: a shared-page reader following a discussion they wrote in. Unread replies are
// derived from the review tables against seen_at, so nothing is written per reply.
export const reviewThreadFollowsMigration: Migration = {
  version: 24, name: "review-thread-follows", statements: [
`CREATE TABLE review_thread_follows (
 thread_id UUID NOT NULL, user_id UUID NOT NULL, share_link_id UUID NOT NULL,
 following TINYINT(1) NOT NULL, seen_at DATETIME(6) NOT NULL,
 created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL,
 PRIMARY KEY (thread_id, user_id),
 KEY ix_review_follow_user (user_id, following, updated_at),
 FOREIGN KEY (thread_id) REFERENCES document_review_threads(id) ON DELETE RESTRICT,
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
 FOREIGN KEY (share_link_id) REFERENCES document_share_links(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
