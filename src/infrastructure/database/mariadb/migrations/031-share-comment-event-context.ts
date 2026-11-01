import type { Migration } from "./types";

/**
 * A link-origin comment event carries a share link; a team comment event
 * carries its recipient member. Exactly one is set, so a row can never be the
 * anonymous both-NULL shape that would name no grant. The writer validates the
 * same rule first; this constraint closes the raw-SQL path.
 */
export const shareCommentEventContextMigration: Migration = {
  version: 31,
  name: "share-comment-event-context",
  statements: [
    `ALTER TABLE share_comment_events
      ADD CONSTRAINT ck_share_comment_events_context
      CHECK ((origin_share_link_id IS NULL) <> (recipient_user_id IS NULL))`,
  ],
};
