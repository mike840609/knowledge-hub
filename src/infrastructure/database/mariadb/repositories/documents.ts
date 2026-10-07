import { IntegrityViolationError } from "@/modules/knowledge/domain/errors";
import type { KnowledgeDocument } from "@/modules/knowledge/domain/document";
import type { DocumentRepository } from "@/modules/knowledge/ports/document-repository";
import type { QueryConnection, DbRow } from "./shared";
import { affectedRows, asDate, asRequiredString, insertBatches } from "./shared";

function mapDocument(row: DbRow): KnowledgeDocument {
  return {
    id: String(row.id), sourceId: String(row.source_id), currentRevisionId: row.current_revision_id === null ? null : String(row.current_revision_id),
    status: String(row.status) as "ACTIVE" | "ARCHIVED", createdBy: String(row.created_by), updatedBy: asRequiredString(row.updated_by, "document updated_by"),
    archivedBy: row.archived_by === null ? null : String(row.archived_by), archivedAt: row.archived_at === null ? null : asDate(row.archived_at),
    createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at),
  };
}

export class MariaDbDocumentRepository implements DocumentRepository {
  constructor(private readonly connection: QueryConnection) {}

  async insertDraft(document: KnowledgeDocument): Promise<void> {
    if (document.currentRevisionId !== null) throw new IntegrityViolationError("A document draft must not have a current revision.");
    await this.connection.query(
      `INSERT INTO knowledge_documents (id, source_id, current_revision_id, status, created_by, updated_by, archived_by, archived_at, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      [document.id, document.sourceId, document.status, document.createdBy, document.updatedBy, document.archivedBy, document.archivedAt, document.createdAt, document.updatedAt],
    );
  }

  async insertDrafts(documents: readonly KnowledgeDocument[]): Promise<void> {
    if (documents.some((document) => document.currentRevisionId !== null)) throw new IntegrityViolationError("A document draft must not have a current revision.");
    for (const batch of insertBatches(documents)) {
      await this.connection.query(
        `INSERT INTO knowledge_documents (id, source_id, current_revision_id, status, created_by, updated_by, archived_by, archived_at, created_at, updated_at)
         VALUES ${batch.map(() => "(?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
        batch.flatMap((document) => [document.id, document.sourceId, document.status, document.createdBy, document.updatedBy, document.archivedBy, document.archivedAt, document.createdAt, document.updatedAt]),
      );
    }
  }

  async findById(id: string): Promise<KnowledgeDocument | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM knowledge_documents WHERE id = ?", [id]);
    return rows[0] ? mapDocument(rows[0]) : null;
  }

  async lockById(id: string): Promise<KnowledgeDocument | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM knowledge_documents WHERE id = ? FOR UPDATE", [id]);
    return rows[0] ? mapDocument(rows[0]) : null;
  }

  async setCurrentRevision(documentId: string, revisionId: string, updatedBy: string): Promise<void> {
    const result = await this.connection.query(
      "UPDATE knowledge_documents SET current_revision_id = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?",
      [revisionId, updatedBy, documentId],
    );
    if (affectedRows(result) !== 1) throw new IntegrityViolationError("Document current revision could not be updated.");
  }

  async setFirstRevisions(documentIds: readonly string[], updatedBy: string): Promise<void> {
    for (const batch of insertBatches(documentIds)) {
      const result = await this.connection.query(
        `UPDATE knowledge_documents d JOIN knowledge_revisions r ON r.document_id = d.id
         SET d.current_revision_id = r.id, d.updated_by = ?, d.updated_at = CURRENT_TIMESTAMP(6)
         WHERE d.id IN (${batch.map(() => "?").join(", ")}) AND d.current_revision_id IS NULL`,
        [updatedBy, ...batch],
      );
      if (affectedRows(result) !== batch.length) throw new IntegrityViolationError("Document current revision could not be updated.");
    }
  }

  async assertCompleteMany(documentIds: readonly string[]): Promise<void> {
    for (const batch of insertBatches(documentIds)) {
      const rows = await this.connection.query<DbRow[]>(
        `SELECT COUNT(*) AS complete FROM knowledge_documents d
         JOIN knowledge_revisions r ON r.id = d.current_revision_id AND r.document_id = d.id
         WHERE d.id IN (${batch.map(() => "?").join(", ")})`,
        [...batch],
      );
      if (Number(rows[0]?.complete) !== batch.length) {
        throw new IntegrityViolationError("A committed Knowledge document must have a current revision belonging to itself.");
      }
    }
  }

  async assertComplete(documentId: string): Promise<void> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT d.id, d.current_revision_id, r.document_id AS revision_document_id
       FROM knowledge_documents d
       LEFT JOIN knowledge_revisions r ON r.id = d.current_revision_id
       WHERE d.id = ?`,
      [documentId],
    );
    const row = rows[0];
    if (!row || row.current_revision_id === null || String(row.revision_document_id) !== documentId) {
      throw new IntegrityViolationError("A committed Knowledge document must have a current revision belonging to itself.");
    }
  }

  async updateStatus(documentId: string, status: "ACTIVE" | "ARCHIVED", actorId: string): Promise<void> {
    const archivedBy = status === "ARCHIVED" ? actorId : null;
    const archivedAt = status === "ARCHIVED" ? new Date() : null;
    const result = await this.connection.query(
      "UPDATE knowledge_documents SET status = ?, updated_by = ?, archived_by = ?, archived_at = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?",
      [status, actorId, archivedBy, archivedAt, documentId],
    );
    if (affectedRows(result) !== 1) throw new IntegrityViolationError("Document lifecycle could not be updated.");
  }
}
