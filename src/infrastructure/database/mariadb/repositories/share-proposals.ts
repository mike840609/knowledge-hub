import type { ProposalParty, ShareProposal, ShareProposalStatus } from "@/modules/knowledge/domain/share-proposal";
import type { NewShareProposal, ShareProposalRepository } from "@/modules/knowledge/ports/share-proposal-repository";
import type { DbRow, QueryConnection } from "./shared";
import { affectedRows, asDate, asNullableDate, asNumber } from "./shared";

/** A decision is news for the proposed person and the proposer, even if they marked the pending entry read (mark-all does). */
const DECISION_UNREAD = "proposed_read_at = NULL, proposer_read_at = NULL";
const READ_COLUMN: Record<ProposalParty, string> = { OWNER: "owner_read_at", PROPOSED: "proposed_read_at", PROPOSER: "proposer_read_at" };

function mapProposal(row: DbRow): ShareProposal {
  return {
    id: String(row.id), shareLinkId: String(row.share_link_id), userId: String(row.user_id), proposedBy: String(row.proposed_by),
    commentId: String(row.comment_id), status: String(row.status) as ShareProposalStatus, createdAt: asDate(row.created_at),
    decidedBy: row.decided_by === null ? null : String(row.decided_by), decidedAt: asNullableDate(row.decided_at),
    ownerReadAt: asNullableDate(row.owner_read_at), proposedReadAt: asNullableDate(row.proposed_read_at), proposerReadAt: asNullableDate(row.proposer_read_at),
  };
}

export class MariaDbShareProposalRepository implements ShareProposalRepository {
  constructor(private readonly connection: QueryConnection) {}

  async insertIfAbsent(p: NewShareProposal): Promise<boolean> {
    const result = await this.connection.query(
      `INSERT IGNORE INTO document_share_link_proposals (id, share_link_id, user_id, proposed_by, comment_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`,
      [p.id, p.shareLinkId, p.userId, p.proposedBy, p.commentId, p.createdAt],
    );
    return affectedRows(result) === 1;
  }

  async findById(id: string): Promise<ShareProposal | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM document_share_link_proposals WHERE id = ?", [id]);
    return rows[0] ? mapProposal(rows[0]) : null;
  }

  async lockById(id: string): Promise<ShareProposal | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM document_share_link_proposals WHERE id = ? FOR UPDATE", [id]);
    return rows[0] ? mapProposal(rows[0]) : null;
  }

  async listByLink(linkId: string, status?: ShareProposalStatus): Promise<ShareProposal[]> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT * FROM document_share_link_proposals WHERE share_link_id = ?${status ? " AND status = ?" : ""} ORDER BY created_at, id`,
      status ? [linkId, status] : [linkId],
    );
    return rows.map(mapProposal);
  }

  async countPending(linkId: string): Promise<number> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT COUNT(*) AS pending FROM document_share_link_proposals WHERE share_link_id = ? AND status = 'PENDING'",
      [linkId],
    );
    return asNumber(rows[0]?.pending ?? 0, "pending share proposal count");
  }

  async decide(id: string, status: "APPROVED" | "DECLINED", by: string, at: Date): Promise<boolean> {
    const result = await this.connection.query(
      `UPDATE document_share_link_proposals SET status = ?, decided_by = ?, decided_at = ?, ${DECISION_UNREAD} WHERE id = ? AND status = 'PENDING'`,
      [status, by, at, id],
    );
    return affectedRows(result) === 1;
  }

  async approvePending(linkId: string, userId: string, by: string, at: Date): Promise<void> {
    await this.connection.query(
      `UPDATE document_share_link_proposals SET status = 'APPROVED', decided_by = ?, decided_at = ?, ${DECISION_UNREAD} WHERE share_link_id = ? AND user_id = ? AND status = 'PENDING'`,
      [by, at, linkId, userId],
    );
  }

  async listForOwner(ownerUserId: string, limit: number): Promise<ShareProposal[]> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT p.* FROM document_share_link_proposals p JOIN document_share_links l ON l.id = p.share_link_id
       WHERE l.created_by = ? ORDER BY p.created_at DESC, p.id DESC LIMIT ?`,
      [ownerUserId, limit],
    );
    return rows.map(mapProposal);
  }

  async listForProposed(userId: string, limit: number): Promise<ShareProposal[]> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT * FROM document_share_link_proposals WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
      [userId, limit],
    );
    return rows.map(mapProposal);
  }

  async listForProposer(userId: string, limit: number): Promise<ShareProposal[]> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT * FROM document_share_link_proposals WHERE proposed_by = ? AND status <> 'PENDING' ORDER BY created_at DESC, id DESC LIMIT ?",
      [userId, limit],
    );
    return rows.map(mapProposal);
  }

  async markRead(id: string, party: ProposalParty, at: Date): Promise<void> {
    const column = READ_COLUMN[party];
    await this.connection.query(`UPDATE document_share_link_proposals SET ${column} = ? WHERE id = ? AND ${column} IS NULL`, [at, id]);
  }

  async markAllRead(userId: string, at: Date): Promise<void> {
    await this.connection.query(
      `UPDATE document_share_link_proposals p JOIN document_share_links l ON l.id = p.share_link_id
       SET p.owner_read_at = IF(l.created_by = ? AND p.owner_read_at IS NULL, ?, p.owner_read_at),
           p.proposed_read_at = IF(p.user_id = ? AND p.proposed_read_at IS NULL, ?, p.proposed_read_at),
           p.proposer_read_at = IF(p.proposed_by = ? AND p.proposer_read_at IS NULL, ?, p.proposer_read_at)
       WHERE l.created_by = ? OR p.user_id = ? OR p.proposed_by = ?`,
      [userId, at, userId, at, userId, at, userId, userId, userId],
    );
  }
}
