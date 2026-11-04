import { asDate, asNullableDate, asNumber, type DbRow, type QueryConnection } from "./shared";
import type { ShareCommentEvent } from "@/modules/knowledge/domain/share-comment-event";
import type { InboxOwnerQuery, InboxOwnerSummary, ShareCommentEventRepository, ShareDocumentUnreadCount } from "@/modules/knowledge/ports/share-comment-event-repository";
function map(row: DbRow): ShareCommentEvent {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), documentId: String(row.document_id),
    threadId: String(row.thread_id), commentId: String(row.comment_id),
    originShareLinkId: String(row.origin_share_link_id), createdByUserId: String(row.created_by_user_id),
    mentionedUserId: row.mentioned_user_id === null ? null : String(row.mentioned_user_id),
    createdAt: asDate(row.created_at), readAt: asNullableDate(row.read_at),
  };
}
export class MariaDbShareCommentEventsRepository implements ShareCommentEventRepository {
  constructor(private readonly connection: QueryConnection) {}
  async insert(event: ShareCommentEvent): Promise<void> {
    await this.connection.query(
      "INSERT INTO share_comment_events (id,workspace_id,document_id,thread_id,comment_id,origin_share_link_id,created_by_user_id,mentioned_user_id,created_at,read_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [event.id, event.workspaceId, event.documentId, event.threadId, event.commentId, event.originShareLinkId, event.createdByUserId, event.mentionedUserId, event.createdAt, event.readAt],
    );
  }
  async listUnreadByRecipient(recipientUserId: string): Promise<ShareCommentEvent[]> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT e.* FROM share_comment_events e JOIN workspaces w ON w.id=e.workspace_id
       WHERE w.personal_owner_user_id=? AND e.read_at IS NULL ORDER BY e.created_at DESC, e.id DESC LIMIT 100`,
      [recipientUserId],
    );
    return rows.map(map);
  }
  /**
   * Counts visible, non-retracted link-origin comments without loading comment bodies or
   * truncating at the 100-entry unread Inbox preview limit.
   *
   * One row per document, except that comments made through a folder link count under that link:
   * a folder row has no document of its own. Either way the newest unread thread is picked, so the
   * Shares badge opens its discussion.
   */
  async listUnreadCountsByRecipient(recipientUserId: string): Promise<ShareDocumentUnreadCount[]> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT unread.document_id, unread.folder_link_id, unread.thread_id, unread.unread_count
       FROM (
         SELECT e.document_id, e.thread_id, l.id AS folder_link_id,
                COUNT(*) OVER (PARTITION BY COALESCE(l.id, e.document_id)) AS unread_count,
                ROW_NUMBER() OVER (PARTITION BY COALESCE(l.id, e.document_id)
                                   ORDER BY e.created_at DESC, e.id DESC) AS row_num
         FROM share_comment_events e
         JOIN workspaces w ON w.id = e.workspace_id
         LEFT JOIN document_share_links l ON l.id = e.origin_share_link_id AND l.folder_node_id IS NOT NULL
         JOIN document_review_threads t ON t.id = e.thread_id
         JOIN document_review_comments c ON c.id = e.comment_id
         WHERE w.personal_owner_user_id = ? AND w.workspace_type = 'PERSONAL'
           AND e.read_at IS NULL
           AND t.visibility = 'VISIBLE'
           AND c.deleted_at IS NULL AND c.visibility = 'VISIBLE'
       ) unread
       WHERE unread.row_num = 1`,
      [recipientUserId],
    );
    return rows.map(row => ({
      documentId: String(row.document_id),
      shareLinkId: row.folder_link_id === null ? null : String(row.folder_link_id),
      unreadCount: Number(row.unread_count),
      latestThreadId: String(row.thread_id),
    }));
  }
  async listRecentByRecipient(recipientUserId: string, before: { createdAt: Date; id: string } | undefined, limit: number): Promise<ShareCommentEvent[]> {
    const cursor = before ? "AND (e.created_at < ? OR (e.created_at = ? AND e.id < ?))" : "";
    const args: (string | Date | number)[] = [recipientUserId];
    if (before) args.push(before.createdAt, before.createdAt, before.id);
    args.push(limit);
    const rows = await this.connection.query<DbRow[]>(
      `SELECT e.* FROM share_comment_events e JOIN workspaces w ON w.id=e.workspace_id
       WHERE w.personal_owner_user_id=? ${cursor}
       ORDER BY e.created_at DESC, e.id DESC LIMIT ?`,
      args,
    );
    return rows.map(map);
  }
  async markEventRead(recipientUserId: string, eventId: string, at: Date): Promise<void> {
    await this.connection.query(
      `UPDATE share_comment_events e JOIN workspaces w ON w.id=e.workspace_id
       SET e.read_at=? WHERE w.personal_owner_user_id=? AND e.id=? AND e.read_at IS NULL`,
      [at, recipientUserId, eventId],
    );
  }
  async markAllRead(recipientUserId: string, at: Date): Promise<void> {
    await this.connection.query(
      `UPDATE share_comment_events e JOIN workspaces w ON w.id=e.workspace_id
       SET e.read_at=? WHERE w.personal_owner_user_id=? AND e.read_at IS NULL`,
      [at, recipientUserId],
    );
  }
  async markDocumentRead(recipientUserId: string, documentId: string, at: Date): Promise<void> {
    await this.connection.query(
      `UPDATE share_comment_events e JOIN workspaces w ON w.id=e.workspace_id
       SET e.read_at=? WHERE w.personal_owner_user_id=? AND e.document_id=? AND e.read_at IS NULL`,
      [at, recipientUserId, documentId],
    );
  }
  async markThreadRead(recipientUserId: string, documentId: string, threadId: string, at: Date): Promise<void> {
    await this.connection.query(
      `UPDATE share_comment_events e JOIN workspaces w ON w.id=e.workspace_id
       SET e.read_at=? WHERE w.personal_owner_user_id=? AND e.document_id=? AND e.thread_id=? AND e.read_at IS NULL`,
      [at, recipientUserId, documentId, threadId],
    );
  }
  /**
   * The Inbox index's owner source: one row per visible discussion on a document in the
   * caller's personal Workspace, with at least one share-comment event there. Hidden threads,
   * hidden/deleted comments and retracted threads drop out of the grouped join, so the row's
   * `latestAt`, `commentCount` and unread count always describe what the reader can see.
   * Filters and the `(latestAt, threadId)` cursor run before `LIMIT`.
   */
  async listDiscussionSummaries(query: InboxOwnerQuery): Promise<InboxOwnerSummary[]> {
    if (query.threadIds && query.threadIds.length === 0) return [];
    // The mention recipient binds first (SELECT list), then the Workspace owner (WHERE).
    const args: (string | Date | number)[] = [query.recipientUserId, query.recipientUserId];
    let where = "w.personal_owner_user_id=? AND w.workspace_type='PERSONAL' AND t.visibility='VISIBLE'";
    if (query.status) { where += " AND t.status=?"; args.push(query.status); }
    if (query.threadIds) {
      where += ` AND t.id IN (${query.threadIds.map(() => "?").join(",")})`;
      args.push(...query.threadIds);
    }
    const having: string[] = [];
    if (query.unreadOnly) having.push("unread_count>0");
    if (query.mentionedOnly) having.push("mentioned=1");
    if (query.before) {
      having.push("(latest_at<? OR (latest_at=? AND thread_id<?))");
      args.push(query.before.latestAt, query.before.latestAt, query.before.threadId);
    }
    args.push(query.limit);
    const rows = await this.connection.query<DbRow[]>(
      `SELECT t.id AS thread_id, t.document_id, d.source_id, rv.title AS document_title,
              COALESCE(JSON_UNQUOTE(JSON_EXTRACT(t.anchor_json,'$.exact')),'') AS quote,
              MAX(c.created_at) AS latest_at, COUNT(c.id) AS comment_count,
              (SELECT COUNT(*) FROM share_comment_events e
                WHERE e.thread_id=t.id AND e.workspace_id=w.id AND e.read_at IS NULL) AS unread_count,
              t.status,
              EXISTS (SELECT 1 FROM review_comment_mentions m
                      JOIN document_review_comments mc ON mc.id=m.comment_id
                      WHERE m.mentioned_user_id=? AND mc.thread_id=t.id
                        AND mc.deleted_at IS NULL AND mc.visibility='VISIBLE') AS mentioned
       FROM document_review_threads t
       JOIN knowledge_documents d ON d.id=t.document_id
       JOIN knowledge_sources s ON s.id=d.source_id
       JOIN workspaces w ON w.id=s.workspace_id
       JOIN knowledge_revisions rv ON rv.id=d.current_revision_id
       JOIN document_review_comments c ON c.thread_id=t.id AND c.deleted_at IS NULL AND c.visibility='VISIBLE'
       WHERE ${where}
         AND EXISTS (SELECT 1 FROM share_comment_events e0 WHERE e0.thread_id=t.id AND e0.workspace_id=w.id)
       GROUP BY t.id,t.document_id,d.source_id,rv.title,t.anchor_json,t.status,w.id
       ${having.length ? `HAVING ${having.join(" AND ")}` : ""}
       ORDER BY latest_at DESC, thread_id DESC LIMIT ?`,
      args,
    );
    return rows.map(row => ({
      threadId: String(row.thread_id), documentId: String(row.document_id), sourceId: String(row.source_id),
      documentTitle: String(row.document_title), quote: String(row.quote),
      latestAt: asDate(row.latest_at),
      commentCount: asNumber(row.comment_count, "comment count"),
      unreadCount: asNumber(row.unread_count, "unread count"),
      status: String(row.status) as InboxOwnerSummary["status"],
      mentioned: Number(row.mentioned) === 1,
    }));
  }
}
