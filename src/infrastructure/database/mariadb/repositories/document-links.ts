import {
  LINK_EXTRACTOR_VERSION,
  type ExtractedLink,
  type LinkKind,
} from "@/modules/knowledge/domain/document-links";
import type { CatalogDocument } from "@/modules/knowledge/domain/link-resolution";
import type {
  DocumentLinkRepository,
  IndexedDocumentLinks,
  LinkIndexState,
  LinkTargetRow,
} from "@/modules/knowledge/ports/document-link-repository";
import type { DbRow, QueryConnection } from "./shared";
import { asDate, asNumber, asRequiredString, insertBatches, valueRows } from "./shared";

/** Rows per multi-row INSERT: 7 parameters each, well inside the packet and placeholder limits. */
const INSERT_CHUNK = 500;

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

export class MariaDbDocumentLinkRepository implements DocumentLinkRepository {
  constructor(private readonly connection: QueryConnection) {}

  async loadHealthEdges(
    workspaceId: string,
    sourceId: string,
    cursor: { documentId: string; ordinal: number } | null,
    limit: number,
  ): Promise<{ documentId: string; link: ExtractedLink }[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1001)
      throw new Error("Invalid health page size.");
    const rows = await this.connection.query<DbRow[]>(
      `SELECT l.* FROM knowledge_document_links l
      JOIN knowledge_link_index i ON i.document_id=l.document_id JOIN knowledge_documents d ON d.id=l.document_id AND d.current_revision_id=i.revision_id
      JOIN knowledge_sources s ON s.id=d.source_id WHERE s.workspace_id=? AND s.id=? AND s.status='ACTIVE' AND d.status='ACTIVE' AND i.extractor_version=?
      ${cursor ? "AND (l.document_id>? OR (l.document_id=? AND l.ordinal>?))" : ""} ORDER BY l.document_id,l.ordinal LIMIT ?`,
      [
        workspaceId,
        sourceId,
        LINK_EXTRACTOR_VERSION,
        ...(cursor
          ? [cursor.documentId, cursor.documentId, cursor.ordinal]
          : []),
        limit,
      ],
    );
    return rows.map((row) => ({
      documentId: String(row.document_id),
      link: {
        kind: String(row.link_kind) as LinkKind,
        target: String(row.target_text),
        fragment:
          row.target_fragment === null ? null : String(row.target_fragment),
        display: row.display_text === null ? null : String(row.display_text),
        line: asNumber(row.line_no, "link line"),
        ordinal: asNumber(row.ordinal, "link ordinal"),
      },
    }));
  }
  async indexNewDocuments(documents: readonly { documentId: string; revisionId: string; links: readonly ExtractedLink[] }[]): Promise<void> {
    // Markers first: every edge's foreign key points at its document's marker.
    for (const batch of insertBatches(documents)) {
      await this.connection.query(
        `INSERT INTO knowledge_link_index (document_id, revision_id, extractor_version, link_count) VALUES ${valueRows(batch.length, 4)}`,
        batch.flatMap((document) => [document.documentId, document.revisionId, LINK_EXTRACTOR_VERSION, document.links.length]),
      );
    }
    // Edges are built a batch at a time: a large import has millions, and holding them all as
    // one array cost hundreds of MiB at the import limit.
    let parameters: unknown[] = [];
    let rows = 0;
    const flush = async () => {
      if (rows === 0) return;
      await this.connection.query(
        `INSERT INTO knowledge_document_links (document_id, ordinal, link_kind, target_text, target_fragment, display_text, line_no) VALUES ${valueRows(rows, 7)}`,
        parameters,
      );
      parameters = [];
      rows = 0;
    };
    for (const document of documents) {
      for (const link of document.links) {
        parameters.push(document.documentId, link.ordinal, link.kind, link.target, link.fragment, link.display, link.line);
        rows += 1;
        if (rows === INSERT_CHUNK) await flush();
      }
    }
    await flush();
  }

  async replaceForDocument(input: {
    documentId: string;
    revisionId: string;
    links: readonly ExtractedLink[];
  }): Promise<void> {
    // Children first, then the marker, then the new children: every foreign key
    // is RESTRICT, and the marker must exist before a child can point at it.
    await this.connection.query(
      "DELETE FROM knowledge_document_links WHERE document_id = ?",
      [input.documentId],
    );
    await this.connection.query(
      `INSERT INTO knowledge_link_index (document_id, revision_id, extractor_version, link_count)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE revision_id = VALUES(revision_id), extractor_version = VALUES(extractor_version),
         link_count = VALUES(link_count), indexed_at = CURRENT_TIMESTAMP(6)`,
      [
        input.documentId,
        input.revisionId,
        LINK_EXTRACTOR_VERSION,
        input.links.length,
      ],
    );
    for (let start = 0; start < input.links.length; start += INSERT_CHUNK) {
      const chunk = input.links.slice(start, start + INSERT_CHUNK);
      const parameters = chunk.flatMap((link) => [
        input.documentId,
        link.ordinal,
        link.kind,
        link.target,
        link.fragment,
        link.display,
        link.line,
      ]);
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
      sourcePath:
        row.source_path === null || row.source_path === undefined
          ? null
          : String(row.source_path),
      createdAt: asDate(row.created_at),
    }));
  }

  async loadLinkTargets(
    workspaceId: string,
    limit: number,
  ): Promise<LinkTargetRow[]> {
    // The same WHERE as `loadCatalog`, on purpose: what is offered is what a link would resolve to.
    const rows = await this.connection.query<DbRow[]>(
      `SELECT d.id AS document_id, d.source_id AS source_id, r.title AS title, r.created_at AS edited_at
       FROM knowledge_documents d
       JOIN knowledge_sources s ON s.id = d.source_id
       JOIN knowledge_revisions r ON r.id = d.current_revision_id
       JOIN knowledge_tree_nodes n ON n.document_id = d.id
       WHERE s.workspace_id = ? AND s.status = 'ACTIVE' AND d.status = 'ACTIVE' AND n.status = 'ACTIVE'
       ORDER BY r.created_at DESC, d.id
       LIMIT ?`,
      [workspaceId, limit],
    );
    return rows.map((row) => ({
      documentId: String(row.document_id),
      sourceId: String(row.source_id),
      title: asRequiredString(row.title, "link target title"),
      editedAt: asDate(row.edited_at),
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
        fragment:
          row.target_fragment === null ? null : String(row.target_fragment),
        display: row.display_text === null ? null : String(row.display_text),
        line: asNumber(row.line_no, "link line"),
        ordinal: asNumber(row.ordinal, "link ordinal"),
      };
      const bucket = byDocument.get(documentId);
      if (bucket) bucket.push(link);
      else byDocument.set(documentId, [link]);
    }
    return [...byDocument].map(([documentId, links]) => ({
      documentId,
      links,
    }));
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
    return {
      documents: asNumber(rows[0]?.documents ?? 0, "indexed document count"),
      stale: asNumber(rows[0]?.stale ?? 0, "stale document count"),
    };
  }

  async loadCurrentMarkdown(
    workspaceId: string,
    documentIds: readonly string[],
  ): Promise<Map<string, string>> {
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
    for (const row of rows)
      markdown.set(String(row.document_id), String(row.markdown));
    return markdown;
  }

  async listStaleDocumentIds(
    limit: number,
    afterId?: string,
  ): Promise<string[]> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT d.id AS document_id
       FROM knowledge_documents d
       LEFT JOIN knowledge_link_index i ON i.document_id = d.id
       WHERE d.current_revision_id IS NOT NULL
         AND (i.document_id IS NULL OR i.revision_id <> d.current_revision_id OR i.extractor_version <> ?)
         ${afterId === undefined ? "" : "AND d.id > ?"}
       ORDER BY d.id
       LIMIT ?`,
      afterId === undefined
        ? [LINK_EXTRACTOR_VERSION, limit]
        : [LINK_EXTRACTOR_VERSION, afterId, limit],
    );
    return rows.map((row) => String(row.document_id));
  }
}
