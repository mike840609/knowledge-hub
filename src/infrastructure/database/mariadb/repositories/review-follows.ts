import { asDate, asNumber, type DbRow, type QueryConnection } from "./shared";
import { SHARE_CREATOR_READ_ROLES } from "@/modules/knowledge/domain/document-share-link";
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
  /**
   * Mirrors summarizeFollowedThread's unread predicate without ever selecting a
   * comment body. An unread standing reply implies the thread is not retracted.
   * Restrict to the exact latest N follows used by the Discussions list.
   */
  async countUnreadFollowing(userId: string, now: Date, limit: number): Promise<number> {
    const roles = SHARE_CREATOR_READ_ROLES;
    const rows = await this.connection.query<DbRow[]>(
      `SELECT COUNT(*) AS unread
       FROM (
         SELECT thread_id, user_id, share_link_id, seen_at
         FROM review_thread_follows
         WHERE user_id = ? AND following = 1
         ORDER BY updated_at DESC, thread_id DESC LIMIT ?
       ) f
       JOIN document_review_threads t ON t.id = f.thread_id AND t.visibility = 'VISIBLE'
       JOIN document_share_links l ON l.id = f.share_link_id AND l.document_id = t.document_id
       JOIN knowledge_documents d ON d.id = t.document_id AND d.status = 'ACTIVE'
       JOIN knowledge_sources s ON s.id = d.source_id AND s.status = 'ACTIVE'
       JOIN workspaces w ON w.id = s.workspace_id AND w.workspace_type = 'PERSONAL'
         AND w.lifecycle_state = 'ACTIVE' AND w.personal_owner_user_id = l.created_by
       JOIN workspace_memberships m ON m.workspace_id = w.id AND m.user_id = l.created_by
         AND (m.role IS NULL OR m.role IN (${roles.map(() => "?").join(", ")}))
       WHERE l.revoked_at IS NULL AND l.expires_at > ?
         AND EXISTS (
           SELECT 1 FROM document_review_comments c
           WHERE c.thread_id = t.id AND c.visibility = 'VISIBLE'
             AND c.deleted_at IS NULL AND c.author_user_id <> f.user_id AND c.created_at > f.seen_at
         )`,
      [userId, limit, ...roles, now],
    );
    return asNumber(rows[0]?.unread ?? 0, "unread followed discussion count");
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
