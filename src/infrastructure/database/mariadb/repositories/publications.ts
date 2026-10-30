import { IntegrityViolationError } from "@/modules/knowledge/domain/errors";
import type {
  Contribution,
  DocumentBinding,
  PlannedMove,
  Publication,
  PublicationDocument,
  ReconcileReport,
} from "@/modules/sources/domain/publication";
import { publicationError } from "@/modules/sources/domain/publication-errors";
import type { PublicationRepository } from "@/modules/sources/ports/publication-repository";
import { asNullableDate, type DbRow, type QueryConnection } from "./shared";

const DEFAULT_EVENT_LIMIT = 100;

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (("errno" in error && Number(error.errno) === 1062) || ("code" in error && String(error.code) === "ER_DUP_ENTRY"))
  );
}

function mapPublication(row: DbRow): Publication {
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    teamWorkspaceId: String(row.workspace_id),
    name: String(row.name),
    kind: String(row.kind) as Publication["kind"],
    creatorUserId: String(row.creator_user_id),
    status: String(row.status) as Publication["status"],
  };
}

function mapContribution(row: DbRow): Contribution {
  const folderNodeId = row.origin_folder_node_id === null ? null : String(row.origin_folder_node_id);
  return {
    id: String(row.id),
    publicationId: String(row.publication_id),
    userId: String(row.user_id),
    origin: folderNodeId === null
      ? { kind: "DOCUMENT", documentId: String(row.origin_document_id) }
      : { kind: "FOLDER", folderNodeId },
    leftAt: asNullableDate(row.left_at),
    rightsFrozenAt: asNullableDate(row.rights_frozen_at),
    pendingCatchUp: Number(row.pending_catch_up) === 1,
  };
}

function mapDocument(row: DbRow): PublicationDocument {
  return {
    teamDocumentId: String(row.team_document_id),
    publicationId: String(row.publication_id),
    creatorContributionId: String(row.creator_contribution_id),
    currentOriginalDocumentId: String(row.current_original_document_id),
    sourcePath: row.source_path === null ? null : String(row.source_path),
    status: String(row.status) as PublicationDocument["status"],
  };
}

function mapBinding(row: DbRow): DocumentBinding {
  return {
    contributionId: String(row.contribution_id),
    originalDocumentId: String(row.original_document_id),
    teamDocumentId: String(row.team_document_id),
  };
}

function claimDuplicateError(message: string): Error {
  return publicationError("PUBLICATION_ORIGINAL_TAKEN", message);
}

export class MariaDbPublicationRepository implements PublicationRepository {
  constructor(private readonly connection: QueryConnection) {}

  async findById(id: string): Promise<Publication | null> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT p.*, s.name, s.workspace_id, s.status
       FROM publications p JOIN knowledge_sources s ON s.id = p.source_id
       WHERE p.id = ?`,
      [id],
    );
    return rows[0] ? mapPublication(rows[0]) : null;
  }

  async findBySourceId(sourceId: string): Promise<Publication | null> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT p.*, s.name, s.workspace_id, s.status
       FROM publications p JOIN knowledge_sources s ON s.id = p.source_id
       WHERE p.source_id = ?`,
      [sourceId],
    );
    return rows[0] ? mapPublication(rows[0]) : null;
  }

  async listByTeam(teamId: string, includeArchived = false): Promise<Publication[]> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT p.*, s.name, s.workspace_id, s.status
       FROM publications p JOIN knowledge_sources s ON s.id = p.source_id
       WHERE s.workspace_id = ?${includeArchived ? "" : " AND s.status = 'ACTIVE'"}
       ORDER BY s.name, p.id`,
      [teamId],
    );
    return rows.map(mapPublication);
  }

  async insert(publication: Publication): Promise<void> {
    const now = new Date();
    await this.connection.query(
      "INSERT INTO publications (id, source_id, kind, creator_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      [publication.id, publication.sourceId, publication.kind, publication.creatorUserId, now, now],
    );
  }

  async listContributions(publicationId: string): Promise<Contribution[]> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT * FROM publication_contributors WHERE publication_id = ? ORDER BY created_at, id",
      [publicationId],
    );
    return rows.map(mapContribution);
  }

  async listByContributor(userId: string): Promise<Contribution[]> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT * FROM publication_contributors WHERE user_id = ? ORDER BY created_at, id",
      [userId],
    );
    return rows.map(mapContribution);
  }

  async insertContribution(contribution: Contribution): Promise<void> {
    const now = new Date();
    await this.connection.query(
      `INSERT INTO publication_contributors
         (id, publication_id, user_id, origin_folder_node_id, origin_document_id, left_at, rights_frozen_at, pending_catch_up, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        contribution.id, contribution.publicationId, contribution.userId,
        contribution.origin.kind === "FOLDER" ? contribution.origin.folderNodeId : null,
        contribution.origin.kind === "DOCUMENT" ? contribution.origin.documentId : null,
        contribution.leftAt, contribution.rightsFrozenAt, contribution.pendingCatchUp ? 1 : 0, now, now,
      ],
    );
  }

  async setContributionState(
    id: string,
    state: Pick<Contribution, "leftAt" | "rightsFrozenAt" | "pendingCatchUp">,
  ): Promise<void> {
    const result = await this.connection.query(
      "UPDATE publication_contributors SET left_at = ?, rights_frozen_at = ?, pending_catch_up = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?",
      [state.leftAt, state.rightsFrozenAt, state.pendingCatchUp ? 1 : 0, id],
    );
    if (Number((result as { affectedRows?: number }).affectedRows ?? 0) === 0) {
      throw new IntegrityViolationError("Publication contribution could not be updated.");
    }
  }

  async listDocuments(publicationId: string): Promise<PublicationDocument[]> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT pd.*, d.status
       FROM publication_documents pd JOIN knowledge_documents d ON d.id = pd.team_document_id
       WHERE pd.publication_id = ? ORDER BY pd.team_document_id`,
      [publicationId],
    );
    return rows.map(mapDocument);
  }

  async listBindings(contributionId: string): Promise<DocumentBinding[]> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT * FROM publication_bindings WHERE contribution_id = ? ORDER BY original_document_id",
      [contributionId],
    );
    return rows.map(mapBinding);
  }

  async bind(binding: DocumentBinding): Promise<void> {
    const now = new Date();
    try {
      const result = await this.connection.query(
        `INSERT INTO publication_bindings
           (contribution_id, original_document_id, team_document_id, active_team_workspace_id, created_at, updated_at)
         SELECT c.id, ?, ?, CASE WHEN s.status = 'ACTIVE' THEN s.workspace_id ELSE NULL END, ?, ?
         FROM publication_contributors c
         JOIN publications p ON p.id = c.publication_id
         JOIN knowledge_sources s ON s.id = p.source_id
         JOIN knowledge_documents td ON td.id = ? AND td.source_id = p.source_id
         WHERE c.id = ?`,
        [binding.originalDocumentId, binding.teamDocumentId, now, now, binding.teamDocumentId, binding.contributionId],
      );
      if (Number((result as { affectedRows?: number }).affectedRows ?? 0) !== 1) {
        throw new IntegrityViolationError("A binding must join a contribution and a team document of one publication.");
      }
    } catch (error) {
      if (isDuplicateKey(error)) throw claimDuplicateError("This original already feeds a team document in this team.");
      throw error;
    }
  }

  async repoint(teamDocumentId: string, originalDocumentId: string): Promise<void> {
    const documents = await this.connection.query<DbRow[]>(
      "SELECT * FROM publication_documents WHERE team_document_id = ? FOR UPDATE",
      [teamDocumentId],
    );
    const document = documents[0];
    if (!document) throw new IntegrityViolationError("Team document was not found in a publication.");
    const creatorContributionId = String(document.creator_contribution_id);

    // The old original stops feeding this copy: only the creator's binding is
    // removed, so other contributors keep their remembered mappings.
    await this.connection.query(
      "DELETE FROM publication_bindings WHERE contribution_id = ? AND team_document_id = ?",
      [creatorContributionId, teamDocumentId],
    );
    await this.connection.query(
      "UPDATE publication_documents SET current_original_document_id = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE team_document_id = ?",
      [originalDocumentId, teamDocumentId],
    );
    const now = new Date();
    try {
      const result = await this.connection.query(
        `INSERT INTO publication_bindings
           (contribution_id, original_document_id, team_document_id, active_team_workspace_id, created_at, updated_at)
         SELECT c.id, ?, ?, CASE WHEN s.status = 'ACTIVE' THEN s.workspace_id ELSE NULL END, ?, ?
         FROM publication_contributors c
         JOIN publications p ON p.id = c.publication_id
         JOIN knowledge_sources s ON s.id = p.source_id
         WHERE c.id = ?`,
        [originalDocumentId, teamDocumentId, now, now, creatorContributionId],
      );
      if (Number((result as { affectedRows?: number }).affectedRows ?? 0) !== 1) {
        throw new IntegrityViolationError("The re-pointed original could not be bound to its creator.");
      }
    } catch (error) {
      if (isDuplicateKey(error)) throw claimDuplicateError("The new original already feeds another team document in this team.");
      throw error;
    }
  }

  async insertDocument(document: PublicationDocument): Promise<void> {
    const ownership = await this.connection.query<DbRow[]>(
      `SELECT 1
       FROM publications p
       JOIN knowledge_sources s ON s.id = p.source_id
       JOIN knowledge_documents td ON td.id = ? AND td.source_id = p.source_id
       JOIN publication_contributors c ON c.id = ? AND c.publication_id = p.id
       WHERE p.id = ?`,
      [document.teamDocumentId, document.creatorContributionId, document.publicationId],
    );
    if (ownership.length === 0) {
      throw new IntegrityViolationError("A team document and its creator must belong to the publication's source.");
    }
    const now = new Date();
    await this.connection.query(
      `INSERT INTO publication_documents
         (team_document_id, publication_id, creator_contribution_id, current_original_document_id, source_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        document.teamDocumentId, document.publicationId, document.creatorContributionId,
        document.currentOriginalDocumentId, document.sourcePath, now, now,
      ],
    );
  }

  async applyPaths(moves: readonly PlannedMove[]): Promise<void> {
    if (moves.length === 0) return;
    const ids = moves.map((move) => move.teamDocumentId);
    const placeholders = ids.map(() => "?").join(", ");
    // Clear every applied path first: a swap would otherwise trip the unique
    // index as each row is written.
    await this.connection.query(
      `UPDATE publication_documents SET source_path = NULL, updated_at = CURRENT_TIMESTAMP(6)
       WHERE team_document_id IN (${placeholders})`,
      ids,
    );
    for (const move of moves) {
      if (move.toPath === null) continue;
      await this.connection.query(
        "UPDATE publication_documents SET source_path = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE team_document_id = ?",
        [move.toPath, move.teamDocumentId],
      );
    }
  }

  async setPublicationStatus(
    publicationId: string,
    status: "ACTIVE" | "ARCHIVED",
    actorId: string,
  ): Promise<void> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT p.source_id, s.workspace_id
       FROM publications p JOIN knowledge_sources s ON s.id = p.source_id
       WHERE p.id = ? FOR UPDATE`,
      [publicationId],
    );
    const row = rows[0];
    if (!row) throw new IntegrityViolationError("Publication was not found.");
    const sourceId = String(row.source_id);
    const workspaceId = String(row.workspace_id);
    const archivedBy = status === "ARCHIVED" ? actorId : null;
    const archivedAt = status === "ARCHIVED" ? new Date() : null;
    await this.connection.query(
      "UPDATE knowledge_sources SET status = ?, updated_by = ?, archived_by = ?, archived_at = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?",
      [status, actorId, archivedBy, archivedAt, sourceId],
    );
    try {
      await this.connection.query(
        `UPDATE publication_bindings b
         JOIN publication_contributors c ON c.id = b.contribution_id
         SET b.active_team_workspace_id = ?, b.updated_at = CURRENT_TIMESTAMP(6)
         WHERE c.publication_id = ?`,
        [status === "ACTIVE" ? workspaceId : null, publicationId],
      );
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw claimDuplicateError("Restoring this publication would claim an original another publication now holds.");
      }
      throw error;
    }
  }

  async prepareDeliveries(limit: number): Promise<void> {
    const events = await this.connection.query<DbRow[]>(
      `SELECT id, document_id, tree_node_id, source_id
       FROM publication_events WHERE consumed_at IS NULL
       ORDER BY created_at, id LIMIT ?`,
      [limit],
    );
    for (const event of events) {
      const contributions = await this.affectedContributions(event);
      if (contributions.length === 0) {
        await this.connection.query(
          "UPDATE publication_events SET consumed_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND consumed_at IS NULL",
          [String(event.id)],
        );
        continue;
      }
      await this.connection.query(
        `INSERT IGNORE INTO publication_event_deliveries (event_id, contribution_id, processed_at, outcome)
         VALUES ${contributions.map(() => "(?, ?, NULL, NULL)").join(", ")}`,
        contributions.flatMap((contributionId) => [String(event.id), contributionId]),
      );
    }
  }

  async listPendingEvents(userId?: string, limit = DEFAULT_EVENT_LIMIT): Promise<{ eventId: string; contributionId: string }[]> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT d.event_id, d.contribution_id
       FROM publication_event_deliveries d
       JOIN publication_events e ON e.id = d.event_id
       JOIN publication_contributors c ON c.id = d.contribution_id
       WHERE d.processed_at IS NULL AND e.consumed_at IS NULL${userId === undefined ? "" : " AND c.user_id = ?"}
       ORDER BY e.created_at, d.event_id, d.contribution_id
       LIMIT ?`,
      userId === undefined ? [limit] : [userId, limit],
    );
    return rows.map((row) => ({ eventId: String(row.event_id), contributionId: String(row.contribution_id) }));
  }

  async completeDelivery(
    eventId: string,
    contributionId: string,
    outcome: "APPLIED" | "SKIPPED",
  ): Promise<void> {
    await this.connection.query(
      `UPDATE publication_event_deliveries SET processed_at = CURRENT_TIMESTAMP(6), outcome = ?
       WHERE event_id = ? AND contribution_id = ? AND processed_at IS NULL`,
      [outcome, eventId, contributionId],
    );
    await this.connection.query(
      `UPDATE publication_events e SET consumed_at = CURRENT_TIMESTAMP(6)
       WHERE e.id = ? AND e.consumed_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM publication_event_deliveries d WHERE d.event_id = e.id AND d.processed_at IS NULL
         )`,
      [eventId],
    );
  }

  async saveReport(contributionId: string, report: ReconcileReport): Promise<void> {
    await this.connection.query(
      `INSERT INTO publication_reconcile_reports (contribution_id, report_json, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP(6))
       ON DUPLICATE KEY UPDATE report_json = VALUES(report_json), updated_at = VALUES(updated_at)`,
      [contributionId, JSON.stringify(report)],
    );
  }

  async findReport(contributionId: string): Promise<ReconcileReport | null> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT report_json FROM publication_reconcile_reports WHERE contribution_id = ?",
      [contributionId],
    );
    const row = rows[0];
    if (!row) return null;
    const parsed = typeof row.report_json === "string" ? JSON.parse(row.report_json) : row.report_json;
    return parsed as ReconcileReport;
  }

  /**
   * Contributions whose published origin contains the event target. A folder
   * contribution is affected by anything at or below its origin folder; a
   * document contribution by its one document; a source event by every origin
   * in that source. Errors and LEFT contributors are still listed so the
   * consumer can record an explicit SKIPPED delivery.
   */
  private async affectedContributions(event: DbRow): Promise<string[]> {
    if (event.document_id !== null) {
      const chain = await this.treeChain("document_id = ?", String(event.document_id));
      const ids = chain.map((node) => node.id);
      const rows = await this.connection.query<DbRow[]>(
        `SELECT DISTINCT c.id
         FROM publication_contributors c
         WHERE c.origin_document_id = ?
            ${ids.length === 0 ? "" : `OR c.origin_folder_node_id IN (${ids.map(() => "?").join(", ")})`}`,
        [String(event.document_id), ...ids],
      );
      return rows.map((row) => String(row.id));
    }
    if (event.tree_node_id !== null) {
      const chain = await this.treeChain("id = ?", String(event.tree_node_id));
      const nodeIds = chain.map((node) => node.id);
      const documentIds = chain.flatMap((node) => (node.documentId === null ? [] : [node.documentId]));
      const conditions = [`c.origin_folder_node_id IN (${nodeIds.map(() => "?").join(", ")})`];
      if (documentIds.length > 0) {
        conditions.push(`c.origin_document_id IN (${documentIds.map(() => "?").join(", ")})`);
      }
      const rows = await this.connection.query<DbRow[]>(
        `SELECT DISTINCT c.id FROM publication_contributors c WHERE ${conditions.join(" OR ")}`,
        [...nodeIds, ...documentIds],
      );
      return rows.map((row) => String(row.id));
    }
    if (event.source_id !== null) {
      const rows = await this.connection.query<DbRow[]>(
        `SELECT DISTINCT c.id
         FROM publication_contributors c
         LEFT JOIN knowledge_tree_nodes f ON f.id = c.origin_folder_node_id
         LEFT JOIN knowledge_documents d ON d.id = c.origin_document_id
         WHERE f.source_id = ? OR d.source_id = ?`,
        [String(event.source_id), String(event.source_id)],
      );
      return rows.map((row) => String(row.id));
    }
    return [];
  }

  private async treeChain(where: string, id: string): Promise<{ id: string; documentId: string | null }[]> {
    const rows = await this.connection.query<DbRow[]>(
      `WITH RECURSIVE chain AS (
         SELECT id, parent_id, document_id FROM knowledge_tree_nodes WHERE ${where}
         UNION ALL
         SELECT parent.id, parent.parent_id, parent.document_id
         FROM knowledge_tree_nodes parent JOIN chain ON parent.id = chain.parent_id
       )
       SELECT id, document_id FROM chain`,
      [id],
    );
    return rows.map((row) => ({ id: String(row.id), documentId: row.document_id === null ? null : String(row.document_id) }));
  }
}
