import type { ManagedShareLink, ShareManagementQuery } from "@/modules/knowledge/domain/share-management";
import { toLikePattern } from "@/modules/knowledge/domain/search-query";
import { shareLinkPath } from "@/modules/knowledge/domain/document-share-link";
import { IntegrityViolationError } from "@/modules/knowledge/domain/errors";
import type { DocumentShareLink } from "@/modules/knowledge/domain/document-share-link";
import type { DocumentShareLinkRepository, ShareLinkViewTotals } from "@/modules/knowledge/ports/document-share-link-repository";
import type { DbRow, QueryConnection } from "./shared";
import { affectedRows, asDate, asNullableDate, asNumber } from "./shared";

function mapLink(row: DbRow): DocumentShareLink {
  return {
    id: String(row.id),
    documentId: String(row.document_id),
    token: String(row.token),
    label: row.label === null ? null : String(row.label),
    createdBy: String(row.created_by),
    createdAt: asDate(row.created_at),
    expiresAt: asDate(row.expires_at),
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
      WHEN l.expires_at <= ? THEN 'expired'
      WHEN d.status <> 'ACTIVE' OR s.status <> 'ACTIVE' OR w.lifecycle_state <> 'ACTIVE' OR m.user_id IS NULL THEN 'unavailable'
      ELSE 'active' END`;
    const rows = await this.connection.query<DbRow[]>(
      `SET STATEMENT max_statement_time=5 FOR SELECT scoped.*
       FROM (
         SELECT l.*, d.source_id, r.title, s.name AS source_name, ${state} AS link_status
         FROM document_share_links l
         JOIN knowledge_documents d ON d.id = l.document_id
         JOIN knowledge_revisions r ON r.id = d.current_revision_id
         JOIN knowledge_sources s ON s.id = d.source_id
         JOIN workspaces w ON w.id = s.workspace_id
         LEFT JOIN workspace_memberships m ON m.workspace_id = w.id AND m.user_id = l.created_by
         WHERE s.workspace_id = ? AND l.created_by = ? AND w.workspace_type = 'PERSONAL' AND w.personal_owner_user_id = ?
           AND (? = '' OR r.title COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!' OR l.label COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '!')
       ) scoped
       WHERE (? = 'all' OR scoped.link_status = ?)
       ORDER BY scoped.created_at DESC, scoped.id DESC LIMIT ? OFFSET ?`,
      [now, workspaceId, callerId, callerId, query.q, toLikePattern(query.q), toLikePattern(query.q), query.status, query.status, limit, offset],
    );
    const totals = await this.viewTotals(rows.map(row => String(row.id)));
    return rows.map(row => ({
      id: String(row.id), documentId: String(row.document_id), sourceId: String(row.source_id), title: String(row.title), sourceName: String(row.source_name),
      label: row.label === null ? null : String(row.label), path: shareLinkPath(String(row.token)), status: String(row.link_status) as ManagedShareLink["status"],
      createdAt: asDate(row.created_at), expiresAt: asDate(row.expires_at), revokedAt: asNullableDate(row.revoked_at), totalViews: totals.get(String(row.id))?.totalViews ?? 0, lastViewedAt: totals.get(String(row.id))?.lastViewedAt ?? null,
    }));
  }

  async insert(link: DocumentShareLink): Promise<void> {
    await this.connection.query(
      `INSERT INTO document_share_links (id, document_id, token, label, created_by, created_at, expires_at, revoked_by, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [link.id, link.documentId, link.token, link.label, link.createdBy, link.createdAt, link.expiresAt, link.revokedBy, link.revokedAt],
    );
  }

  async findByToken(token: string): Promise<DocumentShareLink | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM document_share_links WHERE token = ?", [token]);
    return rows[0] ? mapLink(rows[0]) : null;
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
      "SELECT COUNT(*) AS active FROM document_share_links WHERE document_id = ? AND revoked_at IS NULL AND expires_at > ?",
      [documentId, now],
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
}
