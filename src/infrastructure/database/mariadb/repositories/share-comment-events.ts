import { DomainError } from "@/shared/domain/errors";
import { asDate, asNullableDate, asNullableString, type DbRow, type QueryConnection } from "./shared";
import type { ShareCommentEvent } from "@/modules/knowledge/domain/share-comment-event";
import type { ShareCommentEventRepository, ShareDocumentUnreadCount } from "@/modules/knowledge/ports/share-comment-event-repository";
function map(row: DbRow): ShareCommentEvent {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), documentId: String(row.document_id),
    threadId: String(row.thread_id), commentId: String(row.comment_id),
    originShareLinkId: asNullableString(row.origin_share_link_id), createdByUserId: String(row.created_by_user_id),
    mentionedUserId: row.mentioned_user_id === null ? null : String(row.mentioned_user_id),
    recipientUserId: asNullableString(row.recipient_user_id),
    createdAt: asDate(row.created_at), readAt: asNullableDate(row.read_at),
  };
}
/** A personal owner's row, or one delivered to this caller as a team recipient. */
const OWNED = "(w.personal_owner_user_id=? OR e.recipient_user_id=?)";
export class MariaDbShareCommentEventsRepository implements ShareCommentEventRepository {
  constructor(private readonly connection: QueryConnection) {}
  async insert(event: ShareCommentEvent): Promise<void> {
    if ((event.originShareLinkId === null) === (event.recipientUserId == null)) {
      throw new DomainError(
        "INVALID_REQUEST",
        "A comment event needs exactly one of a share link or a team recipient; it is never anonymous.",
      );
    }
    await this.connection.query(
      "INSERT INTO share_comment_events (id,workspace_id,document_id,thread_id,comment_id,origin_share_link_id,created_by_user_id,mentioned_user_id,recipient_user_id,created_at,read_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [event.id, event.workspaceId, event.documentId, event.threadId, event.commentId, event.originShareLinkId, event.createdByUserId, event.mentionedUserId, event.recipientUserId ?? null, event.createdAt, event.readAt],
    );
  }
  async findById(recipientUserId: string, eventId: string): Promise<ShareCommentEvent | null> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT e.* FROM share_comment_events e JOIN workspaces w ON w.id=e.workspace_id
       WHERE ${OWNED} AND e.id=?`,
      [recipientUserId, recipientUserId, eventId],
    );
    return rows[0] ? map(rows[0]) : null;
  }
  async listUnreadByRecipient(
    recipientUserId: string,
    before?: { createdAt: Date; id: string },
    limit = 100,
  ): Promise<ShareCommentEvent[]> {
    const cursor = before ? "AND (e.created_at < ? OR (e.created_at = ? AND e.id < ?))" : "";
    const rows = await this.connection.query<DbRow[]>(
      `SELECT e.* FROM share_comment_events e JOIN workspaces w ON w.id=e.workspace_id
       WHERE ${OWNED} AND e.read_at IS NULL ${cursor} ORDER BY e.created_at DESC, e.id DESC LIMIT ?`,
      before
        ? [recipientUserId, recipientUserId, before.createdAt, before.createdAt, before.id, limit]
        : [recipientUserId, recipientUserId, limit],
    );
    return rows.map(map);
  }
  async listUnreadTeamByRecipient(recipientUserId: string): Promise<ShareCommentEvent[]> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT e.* FROM share_comment_events e
       WHERE e.recipient_user_id=? AND e.read_at IS NULL ORDER BY e.created_at DESC, e.id DESC`,
      [recipientUserId],
    );
    return rows.map(map);
  }
  /**
   * Counts visible, non-retracted comments without loading comment bodies or truncating at the
   * 100-entry unread Inbox preview limit. The row's Workspace and recipient let the service judge a
   * team entry's live access before it counts; a personal row has no recipient.
   *
   * One row per document, except that comments made through a folder link count under that link:
   * a folder row has no document of its own. Either way the newest unread thread is picked, so the
   * Shares badge opens its discussion.
   */
  async listUnreadCountsByRecipient(recipientUserId: string): Promise<ShareDocumentUnreadCount[]> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT unread.document_id, unread.folder_link_id, unread.thread_id, unread.unread_count,
              unread.workspace_id, unread.recipient_user_id
       FROM (
         SELECT e.document_id, e.thread_id, e.workspace_id, e.recipient_user_id, l.id AS folder_link_id,
                COUNT(*) OVER (PARTITION BY COALESCE(l.id, e.document_id)) AS unread_count,
                ROW_NUMBER() OVER (PARTITION BY COALESCE(l.id, e.document_id)
                                   ORDER BY e.created_at DESC, e.id DESC) AS row_num
         FROM share_comment_events e
         JOIN workspaces w ON w.id = e.workspace_id
         LEFT JOIN document_share_links l ON l.id = e.origin_share_link_id AND l.folder_node_id IS NOT NULL
         JOIN document_review_threads t ON t.id = e.thread_id
         JOIN document_review_comments c ON c.id = e.comment_id
         WHERE ${OWNED}
           AND e.read_at IS NULL
           AND t.visibility = 'VISIBLE'
           AND c.deleted_at IS NULL AND c.visibility = 'VISIBLE'
       ) unread
       WHERE unread.row_num = 1`,
      [recipientUserId, recipientUserId],
    );
    return rows.map(row => ({
      documentId: String(row.document_id),
      shareLinkId: row.folder_link_id === null ? null : String(row.folder_link_id),
      unreadCount: Number(row.unread_count),
      latestThreadId: String(row.thread_id),
      workspaceId: String(row.workspace_id),
      recipientUserId: asNullableString(row.recipient_user_id),
    }));
  }
  async listRecentByRecipient(recipientUserId: string, before: { createdAt: Date; id: string } | undefined, limit: number): Promise<ShareCommentEvent[]> {
    const cursor = before ? "AND (e.created_at < ? OR (e.created_at = ? AND e.id < ?))" : "";
    const args: (string | Date | number)[] = [recipientUserId, recipientUserId];
    if (before) args.push(before.createdAt, before.createdAt, before.id);
    args.push(limit);
    const rows = await this.connection.query<DbRow[]>(
      `SELECT e.* FROM share_comment_events e JOIN workspaces w ON w.id=e.workspace_id
       WHERE ${OWNED} ${cursor}
       ORDER BY e.created_at DESC, e.id DESC LIMIT ?`,
      args,
    );
    return rows.map(map);
  }
  async markEventRead(recipientUserId: string, eventId: string, at: Date): Promise<void> {
    await this.connection.query(
      `UPDATE share_comment_events e JOIN workspaces w ON w.id=e.workspace_id
       SET e.read_at=? WHERE ${OWNED} AND e.id=? AND e.read_at IS NULL`,
      [at, recipientUserId, recipientUserId, eventId],
    );
  }
  async markAllRead(recipientUserId: string, at: Date): Promise<void> {
    await this.connection.query(
      `UPDATE share_comment_events e JOIN workspaces w ON w.id=e.workspace_id
       SET e.read_at=? WHERE w.personal_owner_user_id=? AND e.recipient_user_id IS NULL AND e.read_at IS NULL`,
      [at, recipientUserId],
    );
  }
  async markEventsRead(recipientUserId: string, eventIds: readonly string[], at: Date): Promise<void> {
    if (eventIds.length === 0) return;
    await this.connection.query(
      `UPDATE share_comment_events e JOIN workspaces w ON w.id=e.workspace_id
       SET e.read_at=? WHERE e.recipient_user_id=? AND e.id IN (${eventIds.map(() => "?").join(",")}) AND e.read_at IS NULL`,
      [at, recipientUserId, ...eventIds],
    );
  }
  async markDocumentRead(recipientUserId: string, documentId: string, at: Date): Promise<void> {
    await this.connection.query(
      `UPDATE share_comment_events e JOIN workspaces w ON w.id=e.workspace_id
       SET e.read_at=? WHERE ${OWNED} AND e.document_id=? AND e.read_at IS NULL`,
      [at, recipientUserId, recipientUserId, documentId],
    );
  }
  async markThreadRead(recipientUserId: string, documentId: string, threadId: string, at: Date): Promise<void> {
    await this.connection.query(
      `UPDATE share_comment_events e JOIN workspaces w ON w.id=e.workspace_id
       SET e.read_at=? WHERE ${OWNED} AND e.document_id=? AND e.thread_id=? AND e.read_at IS NULL`,
      [at, recipientUserId, recipientUserId, documentId, threadId],
    );
  }
}
