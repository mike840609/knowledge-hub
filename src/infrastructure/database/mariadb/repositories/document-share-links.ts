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
