import type { SavedShareRepository } from "@/modules/knowledge/ports/saved-share-repository";
import type { SavedShareQuery, SavedShareRecord, SavedShareView, SavedShareSnapshot } from "@/modules/knowledge/domain/saved-share";
import { toLikePattern } from "@/modules/knowledge/domain/search-query";
import { SHARE_CREATOR_READ_ROLES, shareLinkPath } from "@/modules/knowledge/domain/document-share-link";
import type { DbRow, QueryConnection } from "./shared";
import { asDate, asNullableDate } from "./shared";
function record(row: DbRow): SavedShareRecord {
  return { id: String(row.id), userId: String(row.user_id), shareLinkId: String(row.share_link_id), savedTitle: String(row.saved_title), savedSharedByName: String(row.saved_shared_by_name), savedExpiresAt: asDate(row.saved_expires_at), savedAt: asDate(row.saved_at), updatedAt: asDate(row.updated_at), removedAt: asNullableDate(row.removed_at) };
}
// evaluateShareLinkValidity, restated in SQL for the list; its role set comes from the same constant.
const READ_ROLES = SHARE_CREATOR_READ_ROLES.map((role) => {
  // Interpolated into SQL: a role is a fixed enum word, and anything else must fail loudly here.
  if (!/^[A-Z_]+$/.test(role)) throw new Error(`Unexpected workspace role: ${role}`);
  return `'${role}'`;
}).join(",");
export class MariaDbSavedShareRepository implements SavedShareRepository {
  constructor(private readonly connection: QueryConnection) {}
  async findSnapshotByToken(token: string): Promise<SavedShareSnapshot | null> {
    // READ COMMITTED supplies one consistent view for this statement. All grant
    // inputs and captured metadata must come from that view, not later reads.
    const rows = await this.connection.query<DbRow[]>(`SELECT l.*,d.status AS document_status,s.status AS source_status,
      w.lifecycle_state AS workspace_lifecycle,w.personal_owner_user_id AS workspace_owner,m.user_id AS creator_membership,m.role AS creator_role,
      r.title,u.name AS creator_name
      FROM document_share_links l JOIN knowledge_documents d ON d.id=l.document_id
      JOIN knowledge_sources s ON s.id=d.source_id JOIN workspaces w ON w.id=s.workspace_id
      LEFT JOIN workspace_memberships m ON m.workspace_id=w.id AND m.user_id=l.created_by
      LEFT JOIN knowledge_revisions r ON r.id=d.current_revision_id AND r.document_id=d.id
      LEFT JOIN users u ON u.id=l.created_by WHERE l.token=?`,[token]);
    const row=rows[0];if(!row)return null;
    return {
      link:{id:String(row.id),documentId:String(row.document_id),token:String(row.token),label:row.label===null?null:String(row.label),createdBy:String(row.created_by),createdAt:asDate(row.created_at),expiresAt:asDate(row.expires_at),revokedBy:row.revoked_by===null?null:String(row.revoked_by),revokedAt:asNullableDate(row.revoked_at)},
      validity:{documentStatus:String(row.document_status) as SavedShareSnapshot["validity"]["documentStatus"],sourceStatus:String(row.source_status) as SavedShareSnapshot["validity"]["sourceStatus"],workspaceOwnerUserId:row.workspace_owner===null?null:String(row.workspace_owner),workspaceLifecycle:row.workspace_lifecycle===null?null:String(row.workspace_lifecycle) as SavedShareSnapshot["validity"]["workspaceLifecycle"],creatorDirectRole:row.creator_membership===null?undefined:row.creator_role===null?null:String(row.creator_role) as SavedShareSnapshot["validity"]["creatorDirectRole"]},
      title:row.title===null?null:String(row.title),sharedByName:row.creator_name===null?null:String(row.creator_name),
    };
  }
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
        SELECT b.id,b.saved_at,b.saved_title AS saved_search_title,b.saved_shared_by_name AS saved_search_creator_name,
          CASE WHEN live.available=1 THEN live.title ELSE b.saved_title END AS title,
          CASE WHEN live.available=1 THEN live.creator_name ELSE b.saved_shared_by_name END AS creator_name,
          CASE WHEN live.available=1 THEN live.expires_at ELSE b.saved_expires_at END AS expires_at,
          CASE WHEN live.available=1 THEN live.revision_at ELSE NULL END AS revision_at,
          CASE WHEN live.available=1 THEN live.token ELSE NULL END AS token,
          CASE WHEN live.available=1 THEN 'available' WHEN b.saved_expires_at<=? THEN 'expired' ELSE 'unavailable' END AS state
        FROM saved_document_shares b JOIN (
          SELECT l.*,r.title,r.created_at AS revision_at,u.name AS creator_name,
            (l.revoked_at IS NULL AND l.expires_at>? AND d.status='ACTIVE' AND s.status='ACTIVE'
             AND w.lifecycle_state='ACTIVE' AND w.personal_owner_user_id=l.created_by AND m.user_id IS NOT NULL
             AND (m.role IS NULL OR m.role IN (${READ_ROLES})) AND r.id IS NOT NULL AND u.id IS NOT NULL) AS available
          FROM document_share_links l LEFT JOIN knowledge_documents d ON d.id=l.document_id
          LEFT JOIN knowledge_revisions r ON r.id=d.current_revision_id
          LEFT JOIN knowledge_sources s ON s.id=d.source_id LEFT JOIN workspaces w ON w.id=s.workspace_id
          LEFT JOIN workspace_memberships m ON m.workspace_id=w.id AND m.user_id=l.created_by
          LEFT JOIN users u ON u.id=l.created_by
        ) live ON live.id=b.share_link_id WHERE b.user_id=? AND b.removed_at IS NULL
      ) safe WHERE (?='' OR safe.title COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!' OR safe.creator_name COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!' OR safe.saved_search_title COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!' OR safe.saved_search_creator_name COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!')
      AND (?='all' OR (?='available' AND safe.state='available') OR (?='unavailable' AND safe.state<>'available'))
      ORDER BY safe.saved_at DESC,safe.id DESC LIMIT ? OFFSET ?`,
      [now,now,userId,query.q,toLikePattern(query.q),toLikePattern(query.q),toLikePattern(query.q),toLikePattern(query.q),query.status,query.status,query.status,limit,offset]);
    return rows.map(row => ({ id:String(row.id),title:String(row.title),sharedByName:String(row.creator_name),savedAt:asDate(row.saved_at),expiresAt:asDate(row.expires_at),updatedAt:asNullableDate(row.revision_at),status:String(row.state) as SavedShareView["status"],path:row.token ? shareLinkPath(String(row.token)) : null }));
  }
}
