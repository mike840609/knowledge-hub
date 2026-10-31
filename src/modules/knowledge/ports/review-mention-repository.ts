import type { ReviewMention } from "../domain/review-mention";
/**
 * Mentions of a user. Every method is keyed by the user it acts for; none reaches another's rows —
 * except `listMentionedUsersByComments`, keyed by comment, which only the review read paths may
 * call, for comments the caller is already being shown (2026-10-30-review-mention-highlight-design.md §3).
 */
export interface ReviewMentionRepository {
  insertMany(rows: ReviewMention[]): Promise<void>;
  /** Newest first. */
  listRecentByRecipient(userId: string, limit: number): Promise<ReviewMention[]>;
  /** Unread rows only, newest first; whether each may still be shown is judged live by the service. */
  listUnreadByRecipient(userId: string, limit: number, before?: { createdAt: Date; commentId: string }): Promise<ReviewMention[]>;
  /** Unread link-less (team) mentions, newest first; access is judged live by the service. */
  listUnreadTeamByRecipient(userId: string): Promise<ReviewMention[]>;
  /** The user's mention rows (read or not) on comments of these threads. */
  findByThreads(userId: string, threadIds: readonly string[]): Promise<ReviewMention[]>;
  /** Who these comments mention. Empty input reads nothing. */
  listMentionedUsersByComments(commentIds: readonly string[]): Promise<{ commentId: string; mentionedUserId: string }[]>;
  markRead(userId: string, commentId: string, at: Date): Promise<void>;
  markAllRead(userId: string, at: Date): Promise<void>;
  /** Only the user's unread mentions in comments of this thread. */
  markThreadRead(userId: string, threadId: string, at: Date): Promise<void>;
}
