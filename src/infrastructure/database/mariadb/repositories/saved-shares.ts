import type { SavedShareRepository } from "@/modules/knowledge/ports/saved-share-repository";
import type { SavedShareQuery, SavedShareRecord, SavedShareView } from "@/modules/knowledge/domain/saved-share";
import { toLikePattern } from "@/modules/knowledge/domain/search-query";
import { shareLinkPath } from "@/modules/knowledge/domain/document-share-link";
import type { DbRow, QueryConnection } from "./shared";
import { asDate, asNullableDate } from "./shared";
function record(row: DbRow): SavedShareRecord {
  return { id: String(row.id), userId: String(row.user_id), shareLinkId: String(row.share_link_id), savedTitle: String(row.saved_title), savedSharedByName: String(row.saved_shared_by_name), savedExpiresAt: asDate(row.saved_expires_at), savedAt: asDate(row.saved_at), updatedAt: asDate(row.updated_at), removedAt: asNullableDate(row.removed_at) };
}
export class MariaDbSavedShareRepository implements SavedShareRepository {
  constructor(private readonly connection: QueryConnection) {}
  async findByToken(userId: string, token: string): Promise<SavedShareRecord | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT b.* FROM saved_document_shares b JOIN document_share_links l ON l.id=b.share_link_id WHERE b.user_id=? AND l.token=?", [userId, token]);
    return rows[0] ? record(rows[0]) : null;
  }
  async save(item: SavedShareRecord): Promise<SavedShareRecord> {
    await this.connection.query(`INSERT INTO saved_document_shares (id,user_id,share_link_id,saved_title,saved_shared_by_name,saved_expires_at,saved_at,updated_at,removed_at)
      VALUES (?,?,?,?,?,?,?,?,NULL) ON DUPLICATE KEY UPDATE
      saved_title=IF(removed_at IS NOT NULL,VALUES(saved_title),saved_title),
      saved_shared_by_name=IF(removed_at IS NOT NULL,VALUES(saved_shared_by_name),saved_shared_by_name),
      saved_expires_at=IF(removed_at IS NOT NULL,VALUES(saved_expires_at),saved_expires_at),
      saved_at=IF(removed_at IS NOT NULL,VALUES(saved_at),saved_at),
      updated_at=IF(removed_at IS NOT NULL,VALUES(updated_at),updated_at),removed_at=NULL`,
      [item.id,item.userId,item.shareLinkId,item.savedTitle,item.savedSharedByName,item.savedExpiresAt,item.savedAt,item.updatedAt]);
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM saved_document_shares WHERE user_id=? AND share_link_id=?", [item.userId,item.shareLinkId]);
    return record(rows[0]);
  }
  async remove(userId: string, id: string, now: Date): Promise<boolean> {
    const rows = await this.connection.query<DbRow[]>("SELECT removed_at FROM saved_document_shares WHERE user_id=? AND id=? FOR UPDATE", [userId,id]);
    if (!rows[0]) return false;
    if (rows[0].removed_at === null) await this.connection.query("UPDATE saved_document_shares SET removed_at=?,updated_at=? WHERE user_id=? AND id=?", [now,now,userId,id]);
    return true;
  }
  async list(userId: string, query: SavedShareQuery, now: Date, limit: number, offset: number): Promise<SavedShareView[]> {
    const rows = await this.connection.query<DbRow[]>(`SET STATEMENT max_statement_time=5 FOR
      SELECT safe.* FROM (
        SELECT b.id,b.saved_at,
          CASE WHEN live.available=1 THEN live.title ELSE b.saved_title END AS title,
          CASE WHEN live.available=1 THEN live.creator_name ELSE b.saved_shared_by_name END AS creator_name,
          CASE WHEN live.available=1 THEN live.expires_at ELSE b.saved_expires_at END AS expires_at,
          CASE WHEN live.available=1 THEN live.revision_at ELSE NULL END AS revision_at,
          CASE WHEN live.available=1 THEN live.token ELSE NULL END AS token,
          CASE WHEN live.available=1 THEN 'available' WHEN b.saved_expires_at<=? THEN 'expired' ELSE 'unavailable' END AS state
        FROM saved_document_shares b JOIN (
          SELECT l.*,r.title,r.created_at AS revision_at,u.name AS creator_name,
            (l.revoked_at IS NULL AND l.expires_at>? AND d.status='ACTIVE' AND s.status='ACTIVE'
             AND w.lifecycle_state='ACTIVE' AND m.user_id IS NOT NULL
             AND (m.role IS NULL OR m.role IN ('OWNER','ADMIN','EDITOR','VIEWER')) AND r.id IS NOT NULL AND u.id IS NOT NULL) AS available
          FROM document_share_links l LEFT JOIN knowledge_documents d ON d.id=l.document_id
          LEFT JOIN knowledge_revisions r ON r.id=d.current_revision_id
          LEFT JOIN knowledge_sources s ON s.id=d.source_id LEFT JOIN workspaces w ON w.id=s.workspace_id
          LEFT JOIN workspace_memberships m ON m.workspace_id=w.id AND m.user_id=l.created_by
          LEFT JOIN users u ON u.id=l.created_by
        ) live ON live.id=b.share_link_id WHERE b.user_id=? AND b.removed_at IS NULL
      ) safe WHERE (?='' OR safe.title COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!' OR safe.creator_name COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!')
      AND (?='all' OR (?='available' AND safe.state='available') OR (?='unavailable' AND safe.state<>'available'))
      ORDER BY safe.saved_at DESC,safe.id DESC LIMIT ? OFFSET ?`,
      [now,now,userId,query.q,toLikePattern(query.q),toLikePattern(query.q),query.status,query.status,query.status,limit,offset]);
    return rows.map(row => ({ id:String(row.id),title:String(row.title),sharedByName:String(row.creator_name),savedAt:asDate(row.saved_at),expiresAt:asDate(row.expires_at),updatedAt:asNullableDate(row.revision_at),status:String(row.state) as SavedShareView["status"],path:row.token ? shareLinkPath(String(row.token)) : null }));
  }
}
