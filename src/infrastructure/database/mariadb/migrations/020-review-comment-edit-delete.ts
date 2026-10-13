import type { Migration } from "./types";
// Additive: an author's edit and retraction of their own comment. A deleted row keeps its body; no projection reads it.
export const reviewCommentEditDeleteMigration: Migration = {
  version: 20, name: "review-comment-edit-delete", statements: [
    `ALTER TABLE document_review_comments ADD COLUMN edited_at DATETIME(6) NULL, ADD COLUMN deleted_at DATETIME(6) NULL`,
  ],
};
