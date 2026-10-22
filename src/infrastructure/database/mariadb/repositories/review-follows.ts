import { asDate, type DbRow, type QueryConnection } from "./shared";
import type { ReviewFollow } from "@/modules/knowledge/domain/review-follow";
import type { ReviewFollowRepository } from "@/modules/knowledge/ports/review-follow-repository";
export class MariaDbReviewFollowsRepository implements ReviewFollowRepository {
  constructor(private readonly connection: QueryConnection) {}
  async follow({ threadId, userId, shareLinkId, at }: { threadId: string; userId: string; shareLinkId: string; at: Date }): Promise<void> {
    await this.connection.query(
      `INSERT INTO review_thread_follows (thread_id,user_id,share_link_id,following,seen_at,created_at,updated_at) VALUES (?,?,?,1,?,?,?)
       ON DUPLICATE KEY UPDATE share_link_id=VALUES(share_link_id), following=1, seen_at=VALUES(seen_at), updated_at=VALUES(updated_at)`,
      [threadId, userId, shareLinkId, at, at, at],
    );
  }
  async unfollow(threadId: string, userId: string, at: Date): Promise<void> {
    await this.connection.query("UPDATE review_thread_follows SET following=0, updated_at=? WHERE thread_id=? AND user_id=?", [at, threadId, userId]);
  }
  async markSeen(threadId: string, userId: string, at: Date): Promise<void> {
    await this.connection.query("UPDATE review_thread_follows SET seen_at=GREATEST(seen_at,?) WHERE thread_id=? AND user_id=?", [at, threadId, userId]);
  }
  async markAllSeen(userId: string, at: Date): Promise<void> {
    await this.connection.query("UPDATE review_thread_follows SET seen_at=GREATEST(seen_at,?) WHERE user_id=? AND following=1", [at, userId]);
  }
  async listFollowing(userId: string, limit: number): Promise<ReviewFollow[]> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT * FROM review_thread_follows WHERE user_id=? AND following=1 ORDER BY updated_at DESC, thread_id DESC LIMIT ?",
      [userId, limit],
    );
    return rows.map(row => ({ threadId: String(row.thread_id), userId: String(row.user_id), shareLinkId: String(row.share_link_id), following: Number(row.following) === 1, seenAt: asDate(row.seen_at) }));
  }
  async followingThreadIds(userId: string, threadIds: readonly string[]): Promise<Set<string>> {
    if (threadIds.length === 0) return new Set();
    const rows = await this.connection.query<DbRow[]>(
      `SELECT thread_id FROM review_thread_follows WHERE user_id=? AND following=1 AND thread_id IN (${threadIds.map(() => "?").join(",")})`,
      [userId, ...threadIds],
    );
    return new Set(rows.map(row => String(row.thread_id)));
  }
}
