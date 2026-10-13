import type { Migration } from "./types";
// Additive: one row per link-origin comment for the document owner's inbox.
// mentioned_user_id stays NULL in this cut; a later @-mention cut fills it.
export const shareCommentEventsMigration: Migration = {
  version: 22, name: "share-comment-events", statements: [
`CREATE TABLE share_comment_events (
 id UUID NOT NULL PRIMARY KEY, workspace_id UUID NOT NULL, document_id UUID NOT NULL,
 thread_id UUID NOT NULL, comment_id UUID NOT NULL, origin_share_link_id UUID NOT NULL,
 created_by_user_id UUID NOT NULL, mentioned_user_id UUID NULL,
 created_at DATETIME(6) NOT NULL, read_at DATETIME(6) NULL,
 UNIQUE KEY uq_share_comment_event (comment_id),
 KEY ix_share_comment_inbox (workspace_id,read_at,created_at),
 KEY ix_share_comment_document (document_id,read_at),
 FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
 FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE RESTRICT,
 FOREIGN KEY (thread_id) REFERENCES document_review_threads(id) ON DELETE RESTRICT,
 FOREIGN KEY (comment_id) REFERENCES document_review_comments(id) ON DELETE RESTRICT,
 FOREIGN KEY (origin_share_link_id) REFERENCES document_share_links(id) ON DELETE RESTRICT,
 FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
 FOREIGN KEY (mentioned_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
