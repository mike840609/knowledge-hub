import type { KnowledgeRevision } from "@/modules/knowledge/domain/revision";
import type { RevisionRepository } from "@/modules/knowledge/ports/revision-repository";
import type { QueryConnection, DbRow } from "./shared";
import { asDate, asJsonObject, asNumber } from "./shared";

function mapRevision(row: DbRow): KnowledgeRevision {
  return {
    id: String(row.id), documentId: String(row.document_id), revisionNo: asNumber(row.revision_no, "revision number"),
    title: String(row.title), markdown: String(row.markdown), metadata: asJsonObject(row.metadata, "metadata") as KnowledgeRevision["metadata"],
    contentHash: String(row.content_hash), createdBy: String(row.created_by), createdAt: asDate(row.created_at),
  };
}

export class MariaDbRevisionRepository implements RevisionRepository {
  constructor(private readonly connection: QueryConnection) {}

  async insert(revision: KnowledgeRevision): Promise<void> {
    await this.connection.query(
      `INSERT INTO knowledge_revisions (id, document_id, revision_no, title, markdown, metadata, content_hash, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [revision.id, revision.documentId, revision.revisionNo, revision.title, revision.markdown, JSON.stringify(revision.metadata), revision.contentHash, revision.createdBy, revision.createdAt],
    );
  }

  async findById(id: string): Promise<KnowledgeRevision | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM knowledge_revisions WHERE id = ?", [id]);
    return rows[0] ? mapRevision(rows[0]) : null;
  }

  async findCurrent(documentId: string): Promise<KnowledgeRevision | null> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT r.* FROM knowledge_revisions r
       INNER JOIN knowledge_documents d ON d.current_revision_id = r.id AND r.document_id = d.id
       WHERE d.id = ?`,
      [documentId],
    );
    return rows[0] ? mapRevision(rows[0]) : null;
  }

  async nextRevisionNumber(documentId: string): Promise<number> {
    const rows = await this.connection.query<DbRow[]>("SELECT COALESCE(MAX(revision_no), 0) + 1 AS next_no FROM knowledge_revisions WHERE document_id = ?", [documentId]);
    const next = asNumber(rows[0]?.next_no, "next revision number");
    if (next < 1) throw new Error("Revision number overflow.");
    return next;
  }
}
