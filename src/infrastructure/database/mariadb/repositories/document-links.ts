import { LINK_EXTRACTOR_VERSION, type ExtractedLink, type LinkKind } from "@/modules/knowledge/domain/document-links";
import type { CatalogDocument } from "@/modules/knowledge/domain/link-resolution";
import type {
  DocumentLinkRepository,
  IndexedDocumentLinks,
  LinkIndexState,
} from "@/modules/knowledge/ports/document-link-repository";
import type { DbRow, QueryConnection } from "./shared";
import { asDate, asNumber, asRequiredString } from "./shared";

/** Rows per multi-row INSERT: 7 parameters each, well inside the packet and placeholder limits. */
const INSERT_CHUNK = 500;

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

export class MariaDbDocumentLinkRepository implements DocumentLinkRepository {
  constructor(private readonly connection: QueryConnection) {}

  async replaceForDocument(input: { documentId: string; revisionId: string; links: readonly ExtractedLink[] }): Promise<void> {
    // Children first, then the marker, then the new children: every foreign key
    // is RESTRICT, and the marker must exist before a child can point at it.
    await this.connection.query("DELETE FROM knowledge_document_links WHERE document_id = ?", [input.documentId]);
    await this.connection.query(
      `INSERT INTO knowledge_link_index (document_id, revision_id, extractor_version, link_count)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE revision_id = VALUES(revision_id), extractor_version = VALUES(extractor_version),
         link_count = VALUES(link_count), indexed_at = CURRENT_TIMESTAMP(6)`,
      [input.documentId, input.revisionId, LINK_EXTRACTOR_VERSION, input.links.length],
    );
    for (let start = 0; start < input.links.length; start += INSERT_CHUNK) {
      const chunk = input.links.slice(start, start + INSERT_CHUNK);
      const parameters = chunk.flatMap((link) => [input.documentId, link.ordinal, link.kind, link.target, link.fragment, link.display, link.line]);
      await this.connection.query(
        `INSERT INTO knowledge_document_links (document_id, ordinal, link_kind, target_text, target_fragment, display_text, line_no)
         VALUES ${chunk.map(() => `(${placeholders(7)})`).join(", ")}`,
        parameters,
      );
    }
  }

  async loadCatalog(workspaceId: string): Promise<CatalogDocument[]> {
    // uq_entries_source_document keeps the left join row-preserving; uq_tree_one_document does the same for the tree.
    const rows = await this.connection.query<DbRow[]>(
      `SELECT d.id AS document_id, d.source_id AS source_id, r.title AS title, e.source_path AS source_path, d.created_at AS created_at
       FROM knowledge_documents d
       JOIN knowledge_sources s ON s.id = d.source_id
       JOIN knowledge_revisions r ON r.id = d.current_revision_id
       JOIN knowledge_tree_nodes n ON n.document_id = d.id
       LEFT JOIN source_entries e ON e.document_id = d.id AND e.entry_type = 'DOCUMENT'
       WHERE s.workspace_id = ? AND s.status = 'ACTIVE' AND d.status = 'ACTIVE' AND n.status = 'ACTIVE'`,
      [workspaceId],
    );
    return rows.map((row) => ({
      documentId: String(row.document_id),
      sourceId: String(row.source_id),
      title: asRequiredString(row.title, "link catalog title"),
      sourcePath: row.source_path === null || row.source_path === undefined ? null : String(row.source_path),
      createdAt: asDate(row.created_at),
    }));
  }

  async loadValidEdges(workspaceId: string): Promise<IndexedDocumentLinks[]> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT l.document_id AS document_id, l.ordinal AS ordinal, l.link_kind AS link_kind, l.target_text AS target_text,
              l.target_fragment AS target_fragment, l.display_text AS display_text, l.line_no AS line_no
       FROM knowledge_document_links l
       JOIN knowledge_link_index i ON i.document_id = l.document_id
       JOIN knowledge_documents d ON d.id = l.document_id AND d.current_revision_id = i.revision_id
       JOIN knowledge_sources s ON s.id = d.source_id
       WHERE s.workspace_id = ? AND s.status = 'ACTIVE' AND d.status = 'ACTIVE' AND i.extractor_version = ?
       ORDER BY l.document_id, l.ordinal`,
      [workspaceId, LINK_EXTRACTOR_VERSION],
    );
    const byDocument = new Map<string, ExtractedLink[]>();
    for (const row of rows) {
      const documentId = String(row.document_id);
      const link: ExtractedLink = {
        kind: String(row.link_kind) as LinkKind,
        target: asRequiredString(row.target_text, "link target"),
        fragment: row.target_fragment === null ? null : String(row.target_fragment),
        display: row.display_text === null ? null : String(row.display_text),
        line: asNumber(row.line_no, "link line"),
        ordinal: asNumber(row.ordinal, "link ordinal"),
      };
      const bucket = byDocument.get(documentId);
      if (bucket) bucket.push(link);
      else byDocument.set(documentId, [link]);
    }
    return [...byDocument].map(([documentId, links]) => ({ documentId, links }));
  }

  async countIndexState(workspaceId: string): Promise<LinkIndexState> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT COUNT(*) AS documents,
              COALESCE(SUM(CASE WHEN i.document_id IS NULL OR i.revision_id <> d.current_revision_id OR i.extractor_version <> ? THEN 1 ELSE 0 END), 0) AS stale
       FROM knowledge_documents d
       JOIN knowledge_sources s ON s.id = d.source_id
       LEFT JOIN knowledge_link_index i ON i.document_id = d.id
       WHERE s.workspace_id = ? AND s.status = 'ACTIVE' AND d.status = 'ACTIVE'`,
      [LINK_EXTRACTOR_VERSION, workspaceId],
    );
    return { documents: asNumber(rows[0]?.documents ?? 0, "indexed document count"), stale: asNumber(rows[0]?.stale ?? 0, "stale document count") };
  }

  async loadCurrentMarkdown(workspaceId: string, documentIds: readonly string[]): Promise<Map<string, string>> {
    const markdown = new Map<string, string>();
    if (documentIds.length === 0) return markdown;
    const rows = await this.connection.query<DbRow[]>(
      `SELECT d.id AS document_id, r.markdown AS markdown
       FROM knowledge_documents d
       JOIN knowledge_sources s ON s.id = d.source_id
       JOIN knowledge_revisions r ON r.id = d.current_revision_id
       WHERE s.workspace_id = ? AND d.id IN (${placeholders(documentIds.length)})`,
      [workspaceId, ...documentIds],
    );
    for (const row of rows) markdown.set(String(row.document_id), String(row.markdown));
    return markdown;
  }

  async listStaleDocumentIds(limit: number, afterId?: string): Promise<string[]> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT d.id AS document_id
       FROM knowledge_documents d
       LEFT JOIN knowledge_link_index i ON i.document_id = d.id
       WHERE d.current_revision_id IS NOT NULL
         AND (i.document_id IS NULL OR i.revision_id <> d.current_revision_id OR i.extractor_version <> ?)
         ${afterId === undefined ? "" : "AND d.id > ?"}
       ORDER BY d.id
       LIMIT ?`,
      afterId === undefined ? [LINK_EXTRACTOR_VERSION, limit] : [LINK_EXTRACTOR_VERSION, afterId, limit],
    );
    return rows.map((row) => String(row.document_id));
  }
}
