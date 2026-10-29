import type { Migration } from "./types";
// Additive: one row per (comment, mentioned user). read_at is the recipient's own read state;
// whether the mention may still be shown is judged live from the link, never stored here.
export const reviewCommentMentionsMigration: Migration = {
  version: 28, name: "review-comment-mentions", statements: [
`CREATE TABLE review_comment_mentions (
 comment_id UUID NOT NULL, mentioned_user_id UUID NOT NULL, share_link_id UUID NOT NULL,
 created_at DATETIME(6) NOT NULL, read_at DATETIME(6) NULL,
 PRIMARY KEY (comment_id, mentioned_user_id),
 KEY ix_mention_inbox (mentioned_user_id, read_at, created_at),
 FOREIGN KEY (comment_id) REFERENCES document_review_comments(id) ON DELETE RESTRICT,
 FOREIGN KEY (mentioned_user_id) REFERENCES users(id) ON DELETE RESTRICT,
 FOREIGN KEY (share_link_id) REFERENCES document_share_links(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
