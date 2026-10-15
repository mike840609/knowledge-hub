import type { ShareCommentEvent } from "../domain/share-comment-event";
export interface ShareCommentEventRepository {
  insert(event: ShareCommentEvent): Promise<void>;
  listUnreadByRecipient(recipientUserId: string): Promise<ShareCommentEvent[]>;
  listRecentByRecipient(recipientUserId: string, before: { createdAt: Date; id: string } | undefined, limit: number): Promise<ShareCommentEvent[]>;
  markEventRead(recipientUserId: string, eventId: string, at: Date): Promise<void>;
  markAllRead(recipientUserId: string, at: Date): Promise<void>;
  markDocumentRead(recipientUserId: string, documentId: string, at: Date): Promise<void>;
}
