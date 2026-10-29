import { asDate, type DbRow, type QueryConnection } from "./shared";
import type { ReviewMention } from "@/modules/knowledge/domain/review-mention";
import type { ReviewMentionRepository } from "@/modules/knowledge/ports/review-mention-repository";
const toMention = (row: DbRow): ReviewMention => ({
  commentId: String(row.comment_id), mentionedUserId: String(row.mentioned_user_id), shareLinkId: String(row.share_link_id),
  createdAt: asDate(row.created_at), readAt: row.read_at == null ? null : asDate(row.read_at),
});
export class MariaDbReviewMentionsRepository implements ReviewMentionRepository {
  constructor(private readonly connection: QueryConnection) {}
  async insertMany(rows: ReviewMention[]): Promise<void> {
    for (const row of rows) {
      await this.connection.query(
        "INSERT INTO review_comment_mentions (comment_id,mentioned_user_id,share_link_id,created_at,read_at) VALUES (?,?,?,?,?)",
        [row.commentId, row.mentionedUserId, row.shareLinkId, row.createdAt, row.readAt],
      );
    }
  }
  async listRecentByRecipient(userId: string, limit: number): Promise<ReviewMention[]> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT * FROM review_comment_mentions WHERE mentioned_user_id=? ORDER BY created_at DESC, comment_id DESC LIMIT ?", [userId, limit]);
    return rows.map(toMention);
  }
  async listUnreadByRecipient(userId: string): Promise<ReviewMention[]> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT * FROM review_comment_mentions WHERE mentioned_user_id=? AND read_at IS NULL ORDER BY created_at DESC, comment_id DESC", [userId]);
    return rows.map(toMention);
  }
  async mentionedCommentIds(userId: string, commentIds: readonly string[]): Promise<Set<string>> {
    if (commentIds.length === 0) return new Set();
    const rows = await this.connection.query<DbRow[]>(
      `SELECT comment_id FROM review_comment_mentions WHERE mentioned_user_id=? AND comment_id IN (${commentIds.map(() => "?").join(",")})`,
      [userId, ...commentIds]);
    return new Set(rows.map(row => String(row.comment_id)));
  }
  async markRead(userId: string, commentId: string, at: Date): Promise<void> {
    await this.connection.query("UPDATE review_comment_mentions SET read_at=? WHERE mentioned_user_id=? AND comment_id=? AND read_at IS NULL", [at, userId, commentId]);
  }
  async markAllRead(userId: string, at: Date): Promise<void> {
    await this.connection.query("UPDATE review_comment_mentions SET read_at=? WHERE mentioned_user_id=? AND read_at IS NULL", [at, userId]);
  }
  async markThreadRead(userId: string, threadId: string, at: Date): Promise<void> {
    await this.connection.query(
      `UPDATE review_comment_mentions m JOIN document_review_comments c ON c.id=m.comment_id
       SET m.read_at=? WHERE m.mentioned_user_id=? AND m.read_at IS NULL AND c.thread_id=?`, [at, userId, threadId]);
  }
}
