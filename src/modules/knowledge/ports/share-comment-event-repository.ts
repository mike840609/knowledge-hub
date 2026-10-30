import type { ShareCommentEvent } from "../domain/share-comment-event";
/**
 * One row per document link's document, or per folder link (`shareLinkId` set; `documentId` is then
 * the newest unread comment's document). `workspaceId` and `recipientUserId` let the service judge a
 * team row's live access before counting it; a personal row has a null recipient and a PERSONAL Workspace.
 */
export type ShareDocumentUnreadCount = {
  documentId: string; shareLinkId: string | null; unreadCount: number; latestThreadId: string;
  workspaceId: string; recipientUserId: string | null;
};
export interface ShareCommentEventRepository {
  insert(event: ShareCommentEvent): Promise<void>;
  /** The caller's own row by id: a personal owner row or one naming them as the team recipient. */
  findById(recipientUserId: string, eventId: string): Promise<ShareCommentEvent | null>;
  listUnreadByRecipient(recipientUserId: string): Promise<ShareCommentEvent[]>;
  /** Unread rows delivered to the caller as a team recipient, for access-judged bulk marking. */
  listUnreadTeamByRecipient(recipientUserId: string): Promise<ShareCommentEvent[]>;
  listUnreadCountsByRecipient(recipientUserId: string): Promise<ShareDocumentUnreadCount[]>;
  listRecentByRecipient(recipientUserId: string, before: { createdAt: Date; id: string } | undefined, limit: number): Promise<ShareCommentEvent[]>;
  markEventRead(recipientUserId: string, eventId: string, at: Date): Promise<void>;
  /** Personal owner rows only: team rows are marked by the service once their access is judged. */
  markAllRead(recipientUserId: string, at: Date): Promise<void>;
  /** Marks the given team rows of this recipient; the caller has already judged each one readable. */
  markEventsRead(recipientUserId: string, eventIds: readonly string[], at: Date): Promise<void>;
  markDocumentRead(recipientUserId: string, documentId: string, at: Date): Promise<void>;
  markThreadRead(recipientUserId: string, documentId: string, threadId: string, at: Date): Promise<void>;
}
