import type { KnowledgeRevision } from "@/modules/knowledge/domain/revision";
import type { RevisionRepository } from "@/modules/knowledge/ports/revision-repository";
import type { QueryConnection, DbRow } from "./shared";
import { asDate, asJsonObject, asNumber, insertBatches, valueRows } from "./shared";

function mapRevision(row: DbRow): KnowledgeRevision {
  return {
    history: { state: row.history_state === "WORKING" ? "WORKING" : "CHECKPOINT", activityId: row.history_activity_id ? String(row.history_activity_id) : null, windowStartedAt: row.history_window_started_at ? asDate(row.history_window_started_at) : null, name: row.version_name ? String(row.version_name) : null, reason: String(row.history_reason ?? "LEGACY") },
    id: String(row.id), documentId: String(row.document_id), revisionNo: asNumber(row.revision_no, "revision number"),
    title: String(row.title), markdown: String(row.markdown), metadata: asJsonObject(row.metadata, "metadata") as KnowledgeRevision["metadata"],
    contentHash: String(row.content_hash), createdBy: String(row.created_by), createdAt: asDate(row.created_at),
  };
}

export class MariaDbRevisionRepository implements RevisionRepository {
  constructor(private readonly connection: QueryConnection) {}

  async insert(revision: KnowledgeRevision): Promise<void> {
    const h = revision.history;
    await this.connection.query(
      `INSERT INTO knowledge_revisions (id, document_id, revision_no, title, markdown, metadata, content_hash, created_by, created_at,
        history_state, history_activity_id, history_window_started_at, version_name, history_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [revision.id, revision.documentId, revision.revisionNo, revision.title, revision.markdown, JSON.stringify(revision.metadata), revision.contentHash, revision.createdBy, revision.createdAt,
        h?.state ?? "CHECKPOINT", h?.activityId ?? null, h?.windowStartedAt ?? null, h?.name ?? null, h?.reason ?? "LEGACY"],
    );
  }

  async markCheckpoint(id: string, reason: string, name?: string): Promise<void> {
    await this.connection.query(`UPDATE knowledge_revisions SET history_state='CHECKPOINT', history_activity_id=COALESCE(history_activity_id,id), history_window_started_at=COALESCE(history_window_started_at,created_at), history_reason=CASE WHEN version_name IS NULL THEN ? ELSE history_reason END, version_name=COALESCE(?,version_name) WHERE id=?`, [reason,name ?? null,id]);
  }

  async pruneWorking(documentId: string): Promise<void> {
    try {
      await this.connection.query(`DELETE r FROM knowledge_revisions r
        WHERE r.document_id=? AND r.history_state='WORKING'
        AND NOT EXISTS (SELECT 1 FROM knowledge_documents d WHERE d.current_revision_id=r.id)
        AND NOT EXISTS (SELECT 1 FROM knowledge_link_index l WHERE l.revision_id=r.id)
        AND NOT EXISTS (SELECT 1 FROM document_review_threads t WHERE t.created_revision_id=r.id)
        AND NOT EXISTS (SELECT 1 FROM document_read_progress p WHERE p.revision_id=r.id)
        AND NOT EXISTS (SELECT 1 FROM sync_run_changes c WHERE c.before_revision_id=r.id)
        AND NOT EXISTS (SELECT 1 FROM sync_run_changes c WHERE c.after_revision_id=r.id)`, [documentId]);
    } catch (error) {
      // A concurrent reader can acquire a reference after the exclusion check.
      // Its foreign key wins; defer optional cleanup until the next save.
      if ((error as { errno?: number }).errno !== 1451) throw error;
    }
  }

  async insertMany(revisions: readonly KnowledgeRevision[]): Promise<void> {
    const sized = revisions.map((revision) => ({ revision, metadata: JSON.stringify(revision.metadata) }));
    const bytes = ({ revision, metadata }: (typeof sized)[number]) => Buffer.byteLength(revision.markdown) + Buffer.byteLength(revision.title) + Buffer.byteLength(metadata);
    for (const batch of insertBatches(sized, bytes)) {
      await this.connection.query(
        `INSERT INTO knowledge_revisions (id, document_id, revision_no, title, markdown, metadata, content_hash, created_by, created_at)
         VALUES ${valueRows(batch.length, 9)}`,
        batch.flatMap(({ revision, metadata }) => [revision.id, revision.documentId, revision.revisionNo, revision.title, revision.markdown, metadata, revision.contentHash, revision.createdBy, revision.createdAt]),
      );
    }
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

  async findByRevisionNo(documentId: string, revisionNo: number): Promise<KnowledgeRevision | null> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT * FROM knowledge_revisions WHERE document_id = ? AND revision_no = ?",
      [documentId, revisionNo],
    );
    return rows[0] ? mapRevision(rows[0]) : null;
  }

  async listByDocument(documentId: string): Promise<KnowledgeRevision[]> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT r.* FROM knowledge_revisions r WHERE r.document_id = ? AND (r.history_state = 'CHECKPOINT' OR EXISTS (SELECT 1 FROM knowledge_documents d WHERE d.current_revision_id=r.id)) ORDER BY r.revision_no ASC",
      [documentId],
    );
    return rows.map(mapRevision);
  }

  async nextRevisionNumber(documentId: string): Promise<number> {
    const rows = await this.connection.query<DbRow[]>("SELECT COALESCE(MAX(revision_no), 0) + 1 AS next_no FROM knowledge_revisions WHERE document_id = ?", [documentId]);
    const next = asNumber(rows[0]?.next_no, "next revision number");
    if (next < 1) throw new Error("Revision number overflow.");
    return next;
  }
}
