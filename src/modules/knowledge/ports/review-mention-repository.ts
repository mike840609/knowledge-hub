import type { ReviewMention } from "../domain/review-mention";
/** Mentions of a user. Every method is keyed by the user it acts for; none reaches another's rows. */
export interface ReviewMentionRepository {
  insertMany(rows: ReviewMention[]): Promise<void>;
  /** Newest first. */
  listRecentByRecipient(userId: string, limit: number): Promise<ReviewMention[]>;
  /** Unread rows only; whether each may still be shown is judged live by the service. */
  listUnreadByRecipient(userId: string): Promise<ReviewMention[]>;
  mentionedCommentIds(userId: string, commentIds: readonly string[]): Promise<Set<string>>;
  markRead(userId: string, commentId: string, at: Date): Promise<void>;
  markAllRead(userId: string, at: Date): Promise<void>;
  /** Only the user's unread mentions in comments of this thread. */
  markThreadRead(userId: string, threadId: string, at: Date): Promise<void>;
}
