import type { ShareCommentEvent } from "../domain/share-comment-event";
/** One row per document link's document, or per folder link (`shareLinkId` set; `documentId` is then the newest unread comment's document). */
export type ShareDocumentUnreadCount = { documentId: string; shareLinkId: string | null; unreadCount: number; latestThreadId: string };
export interface ShareCommentEventRepository {
  insert(event: ShareCommentEvent): Promise<void>;
  listUnreadByRecipient(recipientUserId: string): Promise<ShareCommentEvent[]>;
  listUnreadCountsByRecipient(recipientUserId: string): Promise<ShareDocumentUnreadCount[]>;
  listRecentByRecipient(recipientUserId: string, before: { createdAt: Date; id: string } | undefined, limit: number): Promise<ShareCommentEvent[]>;
  markEventRead(recipientUserId: string, eventId: string, at: Date): Promise<void>;
  markAllRead(recipientUserId: string, at: Date): Promise<void>;
  markDocumentRead(recipientUserId: string, documentId: string, at: Date): Promise<void>;
  markThreadRead(recipientUserId: string, documentId: string, threadId: string, at: Date): Promise<void>;
}
