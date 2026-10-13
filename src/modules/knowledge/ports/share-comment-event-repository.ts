import type { ShareCommentEvent } from "../domain/share-comment-event";
export interface ShareCommentEventRepository {
  insert(event: ShareCommentEvent): Promise<void>;
  listUnreadByRecipient(recipientUserId: string): Promise<ShareCommentEvent[]>;
  markDocumentRead(recipientUserId: string, documentId: string, at: Date): Promise<void>;
}
