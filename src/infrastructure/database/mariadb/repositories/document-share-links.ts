import type { ManagedShareLink, ShareManagementQuery, ShareManagementStatus } from "@/modules/knowledge/domain/share-management";
import { toLikePattern } from "@/modules/knowledge/domain/search-query";
import { shareLinkPath } from "@/modules/knowledge/domain/document-share-link";
import { IntegrityViolationError } from "@/modules/knowledge/domain/errors";
import type { DocumentShareLink, ShareAudience, ShareLinkTarget } from "@/modules/knowledge/domain/document-share-link";
import type { DocumentShareLinkRepository, NamedRecipient, OpenFolderLink, ReceivedShareLink, ShareLinkViewTotals } from "@/modules/knowledge/ports/document-share-link-repository";
import type { DbRow, QueryConnection } from "./shared";
import { affectedRows, asDate, asNullableDate, asNumber } from "./shared";

const ID_CHUNK = 500;

function mapTarget(row: DbRow): ShareLinkTarget {
  if (row.folder_node_id !== null && row.folder_node_id !== undefined) return { kind: "FOLDER", folderNodeId: String(row.folder_node_id) };
  return { kind: "DOCUMENT", documentId: String(row.document_id) };
}

function mapLink(row: DbRow): DocumentShareLink {
  return {
    id: String(row.id),
    target: mapTarget(row),
    token: String(row.token),
    label: row.label === null ? null : String(row.label),
    audience: String(row.audience) as ShareAudience,
    createdBy: String(row.created_by),
    createdAt: asDate(row.created_at),
    expiresAt: asNullableDate(row.expires_at),
    revokedBy: row.revoked_by === null ? null : String(row.revoked_by),
    revokedAt: asNullableDate(row.revoked_at),
  };
}

export class MariaDbDocumentShareLinkRepository implements DocumentShareLinkRepository {
  constructor(private readonly connection: QueryConnection) {}

  async listForWorkspace(workspaceId: string, callerId: string, query: ShareManagementQuery, now: Date, limit: number, offset: number): Promise<ManagedShareLink[]> {
    // Status follows the bearer reader's validity rules. The owner and workspace
    // predicates remain inside the query so pagination never mixes scopes.
    const state = `CASE WHEN l.revoked_at IS NOT NULL THEN 'revoked'
      WHEN l.expires_at IS NOT NULL AND l.expires_at <= ? THEN 'expired'
      WHEN COALESCE(d.status, f.status) <> 'ACTIVE' OR s.status <> 'ACTIVE' OR w.lifecycle_state <> 'ACTIVE' OR m.user_id IS NULL THEN 'unavailable'
      ELSE 'active' END`;
    const rows = await this.connection.query<DbRow[]>(
      `SET STATEMENT max_statement_time=5 FOR SELECT scoped.*
       FROM (
         SELECT l.*, s.id AS source_id, COALESCE(r.title, f.name) AS title, s.name AS source_name, ${state} AS link_status
         FROM document_share_links l
         LEFT JOIN knowledge_documents d ON d.id = l.document_id
         LEFT JOIN knowledge_tree_nodes f ON f.id = l.folder_node_id AND f.node_type = 'FOLDER'
         LEFT JOIN knowledge_revisions r ON r.id = d.current_revision_id
         JOIN knowledge_sources s ON s.id = COALESCE(d.source_id, f.source_id)
         JOIN workspaces w ON w.id = s.workspace_id
         LEFT JOIN workspace_memberships m ON m.workspace_id = w.id AND m.user_id = l.created_by
         WHERE s.workspace_id = ? AND l.created_by = ? AND w.workspace_type = 'PERSONAL' AND w.personal_owner_user_id = ?
           AND (r.id IS NOT NULL OR f.id IS NOT NULL)
           AND (? = '' OR COALESCE(r.title, f.name) COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!' OR l.label COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!')
       ) scoped
       WHERE (? = 'all' OR scoped.link_status = ?)
       ORDER BY scoped.created_at DESC, scoped.id DESC LIMIT ? OFFSET ?`,
      [now, workspaceId, callerId, callerId, query.q, toLikePattern(query.q), toLikePattern(query.q), query.status, query.status, limit, offset],
    );
    const totals = await this.viewTotals(rows.map(row => String(row.id)));
    return rows.map((row): ManagedShareLink => {
      const base = {
        id: String(row.id), sourceId: String(row.source_id), title: String(row.title), sourceName: String(row.source_name),
        label: row.label === null ? null : String(row.label), path: shareLinkPath(String(row.token)), status: String(row.link_status) as ShareManagementStatus,
        createdAt: asDate(row.created_at), expiresAt: asNullableDate(row.expires_at), revokedAt: asNullableDate(row.revoked_at), totalViews: totals.get(String(row.id))?.totalViews ?? 0, lastViewedAt: totals.get(String(row.id))?.lastViewedAt ?? null,
      };
      return row.folder_node_id === null
        ? { ...base, kind: "DOCUMENT", documentId: String(row.document_id), folderNodeId: null }
        : { ...base, kind: "FOLDER", documentId: null, folderNodeId: String(row.folder_node_id) };
    });
  }

  async listOpenFolderLinks(workspaceId: string, ownerId: string, now: Date): Promise<OpenFolderLink[]> {
    // The bearer reader's validity, as one query: a folder is listed only while some link to it would open.
    const rows = await this.connection.query<DbRow[]>(
      `SELECT DISTINCT f.id, f.name
       FROM document_share_links l
       JOIN knowledge_tree_nodes f ON f.id = l.folder_node_id AND f.node_type = 'FOLDER' AND f.status = 'ACTIVE'
       JOIN knowledge_sources s ON s.id = f.source_id AND s.status = 'ACTIVE'
       JOIN workspaces w ON w.id = s.workspace_id AND w.workspace_type = 'PERSONAL' AND w.lifecycle_state = 'ACTIVE'
       JOIN workspace_memberships m ON m.workspace_id = w.id AND m.user_id = l.created_by
       WHERE w.id = ? AND w.personal_owner_user_id = ? AND l.created_by = ?
         AND l.revoked_at IS NULL AND (l.expires_at IS NULL OR l.expires_at > ?)
       ORDER BY f.name, f.id`,
      [workspaceId, ownerId, ownerId, now],
    );
    return rows.map(row => ({ folderNodeId: String(row.id), name: String(row.name ?? "") }));
  }

  async insert(link: DocumentShareLink): Promise<void> {
    await this.connection.query(
      `INSERT INTO document_share_links (id, document_id, folder_node_id, token, label, audience, created_by, created_at, expires_at, revoked_by, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [link.id, link.target.kind === "DOCUMENT" ? link.target.documentId : null, link.target.kind === "FOLDER" ? link.target.folderNodeId : null, link.token, link.label, link.audience, link.createdBy, link.createdAt, link.expiresAt, link.revokedBy, link.revokedAt],
    );
  }

  async findByToken(token: string): Promise<DocumentShareLink | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM document_share_links WHERE token = ?", [token]);
    return rows[0] ? mapLink(rows[0]) : null;
  }

  async findById(id: string): Promise<DocumentShareLink | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM document_share_links WHERE id = ?", [id]);
    return rows[0] ? mapLink(rows[0]) : null;
  }

  async findByIds(ids: readonly string[]): Promise<DocumentShareLink[]> {
    if (ids.length === 0) return [];
    const found: DocumentShareLink[] = [];
    for (let start = 0; start < ids.length; start += ID_CHUNK) {
      const batch = ids.slice(start, start + ID_CHUNK);
      const rows = await this.connection.query<DbRow[]>(`SELECT * FROM document_share_links WHERE id IN (${batch.map(() => "?").join(", ")})`, batch);
      found.push(...rows.map(mapLink));
    }
    return found;
  }

  async lockById(id: string): Promise<DocumentShareLink | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM document_share_links WHERE id = ? FOR UPDATE", [id]);
    return rows[0] ? mapLink(rows[0]) : null;
  }

  async listByDocument(documentId: string): Promise<DocumentShareLink[]> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT * FROM document_share_links WHERE document_id = ? ORDER BY created_at DESC, id DESC",
      [documentId],
    );
    return rows.map(mapLink);
  }

  async countActiveByDocument(documentId: string, now: Date): Promise<number> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT COUNT(*) AS active FROM document_share_links WHERE document_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)",
      [documentId, now],
    );
    return asNumber(rows[0]?.active ?? 0, "active share link count");
  }

  async listByFolder(folderNodeId: string): Promise<DocumentShareLink[]> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT * FROM document_share_links WHERE folder_node_id = ? ORDER BY created_at DESC, id DESC",
      [folderNodeId],
    );
    return rows.map(mapLink);
  }

  async countActiveByFolder(folderNodeId: string, now: Date): Promise<number> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT COUNT(*) AS active FROM document_share_links WHERE folder_node_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)",
      [folderNodeId, now],
    );
    return asNumber(rows[0]?.active ?? 0, "active share link count");
  }

  async revoke(id: string, revokedBy: string, revokedAt: Date): Promise<void> {
    const result = await this.connection.query(
      "UPDATE document_share_links SET revoked_by = ?, revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
      [revokedBy, revokedAt, id],
    );
    if (affectedRows(result) !== 1) throw new IntegrityViolationError("Share link could not be revoked.");
  }

  async viewTotals(linkIds: readonly string[]): Promise<Map<string, ShareLinkViewTotals>> {
    const totals = new Map<string, ShareLinkViewTotals>();
    if (linkIds.length === 0) return totals;
    const rows = await this.connection.query<DbRow[]>(
      `SELECT share_link_id, SUM(view_count) AS total_views, MAX(last_viewed_at) AS last_viewed_at
       FROM document_share_link_views WHERE share_link_id IN (${linkIds.map(() => "?").join(", ")})
       GROUP BY share_link_id`,
      [...linkIds],
    );
    for (const row of rows) {
      totals.set(String(row.share_link_id), {
        totalViews: asNumber(row.total_views, "share link view total"),
        lastViewedAt: asNullableDate(row.last_viewed_at),
      });
    }
    return totals;
  }

  async recordView(linkId: string, at: Date): Promise<void> {
    await this.connection.query(
      `INSERT INTO document_share_link_views (share_link_id, view_date, first_viewed_at, last_viewed_at, view_count)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE last_viewed_at = VALUES(last_viewed_at), view_count = view_count + 1`,
      [linkId, at.toISOString().slice(0, 10), at, at],
    );
  }

  async insertRecipients(linkId: string, userIds: readonly string[], addedBy: string, at: Date): Promise<void> {
    if (userIds.length === 0) return;
    await this.connection.query(
      `INSERT IGNORE INTO document_share_link_recipients (share_link_id, user_id, added_by, added_at) VALUES ${userIds.map(() => "(?, ?, ?, ?)").join(", ")}`,
      userIds.flatMap(userId => [linkId, userId, addedBy, at]),
    );
  }

  async removeRecipient(linkId: string, userId: string): Promise<boolean> {
    const result = await this.connection.query(
      "DELETE FROM document_share_link_recipients WHERE share_link_id = ? AND user_id = ?",
      [linkId, userId],
    );
    return affectedRows(result) === 1;
  }

  async isRecipient(linkId: string, userId: string): Promise<boolean> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT 1 AS found FROM document_share_link_recipients WHERE share_link_id = ? AND user_id = ?",
      [linkId, userId],
    );
    return rows.length === 1;
  }

  async listRecipients(linkId: string): Promise<NamedRecipient[]> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT user_id, added_at FROM document_share_link_recipients WHERE share_link_id = ? ORDER BY added_at DESC, user_id DESC",
      [linkId],
    );
    return rows.map(row => ({ userId: String(row.user_id), addedAt: asDate(row.added_at) }));
  }

  async countRecipients(linkId: string): Promise<number> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT COUNT(*) AS recipients FROM document_share_link_recipients WHERE share_link_id = ?",
      [linkId],
    );
    return asNumber(rows[0]?.recipients ?? 0, "share link recipient count");
  }

  async listForRecipient(userId: string, limit: number): Promise<ReceivedShareLink[]> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT l.*, r.added_at AS recipient_added_at, r.read_at AS recipient_read_at
       FROM document_share_link_recipients r JOIN document_share_links l ON l.id = r.share_link_id
       WHERE r.user_id = ? ORDER BY r.added_at DESC, l.id DESC LIMIT ?`,
      [userId, limit],
    );
    return rows.map(row => ({ link: mapLink(row), addedAt: asDate(row.recipient_added_at), readAt: asNullableDate(row.recipient_read_at) }));
  }

  async markRecipientRead(linkId: string, userId: string, at: Date): Promise<void> {
    await this.connection.query(
      "UPDATE document_share_link_recipients SET read_at = ? WHERE share_link_id = ? AND user_id = ? AND read_at IS NULL",
      [at, linkId, userId],
    );
  }
}
