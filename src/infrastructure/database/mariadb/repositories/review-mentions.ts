import { DomainError } from "@/shared/domain/errors";
import { asDate, asNullableString, type DbRow, type QueryConnection } from "./shared";
import type { ReviewMention } from "@/modules/knowledge/domain/review-mention";
import type { ReviewMentionRepository } from "@/modules/knowledge/ports/review-mention-repository";
const toMention = (row: DbRow): ReviewMention => ({
  commentId: String(row.comment_id), mentionedUserId: String(row.mentioned_user_id), shareLinkId: asNullableString(row.share_link_id),
  createdAt: asDate(row.created_at), readAt: row.read_at == null ? null : asDate(row.read_at),
});
export class MariaDbReviewMentionsRepository implements ReviewMentionRepository {
  constructor(private readonly connection: QueryConnection) {}
  async insertMany(rows: ReviewMention[]): Promise<void> {
    for (const row of rows) {
      if (row.shareLinkId === null) {
        // A link-less mention is the team-publication shape only. Any other
        // document would make it an anonymous grant, which never exists.
        const team = await this.connection.query<DbRow[]>(
          `SELECT 1 FROM document_review_comments c
           JOIN document_review_threads t ON t.id = c.thread_id
           JOIN knowledge_documents d ON d.id = t.document_id
           JOIN knowledge_sources s ON s.id = d.source_id
           WHERE c.id = ? AND s.source_type = 'PUBLICATION'`,
          [row.commentId],
        );
        if (team.length === 0) {
          throw new DomainError("INVALID_REQUEST", "A mention without a share link requires a team publication discussion.");
        }
      }
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
  async listUnreadByRecipient(userId: string, limit: number, before?: { createdAt: Date; commentId: string }): Promise<ReviewMention[]> {
    const cursor = before ? "AND (created_at < ? OR (created_at = ? AND comment_id < ?))" : "";
    const rows = await this.connection.query<DbRow[]>(
      `SELECT * FROM review_comment_mentions
       WHERE mentioned_user_id=? AND read_at IS NULL ${cursor} ORDER BY created_at DESC, comment_id DESC LIMIT ?`,
      before ? [userId, before.createdAt, before.createdAt, before.commentId, limit] : [userId, limit],
    );
    return rows.map(toMention);
  }
  async listUnreadTeamByRecipient(userId: string): Promise<ReviewMention[]> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT * FROM review_comment_mentions WHERE mentioned_user_id=? AND read_at IS NULL AND share_link_id IS NULL ORDER BY created_at DESC, comment_id DESC", [userId]);
    return rows.map(toMention);
  }
  async findByThreads(userId: string, threadIds: readonly string[]): Promise<ReviewMention[]> {
    if (threadIds.length === 0) return [];
    const rows = await this.connection.query<DbRow[]>(
      `SELECT m.* FROM review_comment_mentions m JOIN document_review_comments c ON c.id=m.comment_id
       WHERE m.mentioned_user_id=? AND c.thread_id IN (${threadIds.map(() => "?").join(",")})`,
      [userId, ...threadIds]);
    return rows.map(toMention);
  }
  async listMentionedUsersByComments(commentIds: readonly string[]): Promise<{ commentId: string; mentionedUserId: string }[]> {
    if (commentIds.length === 0) return [];
    const rows = await this.connection.query<DbRow[]>(
      `SELECT comment_id, mentioned_user_id FROM review_comment_mentions WHERE comment_id IN (${commentIds.map(() => "?").join(",")})`, [...commentIds]);
    return rows.map(row => ({ commentId: String(row.comment_id), mentionedUserId: String(row.mentioned_user_id) }));
  }
  async markRead(userId: string, commentId: string, at: Date): Promise<void> {
    await this.connection.query("UPDATE review_comment_mentions SET read_at=? WHERE mentioned_user_id=? AND comment_id=? AND read_at IS NULL", [at, userId, commentId]);
  }
  async markAllRead(userId: string, at: Date): Promise<void> {
    // Team mentions are marked by the service once their live access is judged.
    await this.connection.query("UPDATE review_comment_mentions SET read_at=? WHERE mentioned_user_id=? AND share_link_id IS NOT NULL AND read_at IS NULL", [at, userId]);
  }
  async markThreadRead(userId: string, threadId: string, at: Date): Promise<void> {
    await this.connection.query(
      `UPDATE review_comment_mentions m JOIN document_review_comments c ON c.id=m.comment_id
       SET m.read_at=? WHERE m.mentioned_user_id=? AND m.read_at IS NULL AND c.thread_id=?`, [at, userId, threadId]);
  }
}
