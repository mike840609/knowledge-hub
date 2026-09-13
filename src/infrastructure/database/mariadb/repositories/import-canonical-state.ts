import type { KnowledgeMetadata } from "@/modules/knowledge/domain/content";
import { fingerprintReconciliationContent } from "@/modules/sources/domain/reconciliation-fingerprint";
import { importError } from "@/modules/sources/domain/import-errors";
import type { CanonicalAssetState, CanonicalDocumentState, CanonicalFolderState, CanonicalImportState } from "@/modules/sources/domain/import-plan";
import type { ImportCanonicalStateRepository } from "@/modules/sources/ports/import-canonical-state-repository";
import type { DbRow, QueryConnection } from "./shared";

function jsonObject(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw importError("CANONICAL_STATE_INVALID", "Canonical metadata is not a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export class MariaDbImportCanonicalStateRepository implements ImportCanonicalStateRepository {
  constructor(private readonly connection: QueryConnection) {}

  async load(sourceId: string): Promise<CanonicalImportState> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT e.id AS entry_id, e.external_id, e.source_path, e.entry_type, e.status AS entry_status,
              e.document_id, e.tree_node_id,
              r.id AS revision_id, r.title, r.markdown, r.metadata, r.content_hash,
              t.node_type AS tree_node_type
       FROM source_entries e
       LEFT JOIN knowledge_documents d ON d.id=e.document_id AND d.source_id=e.source_id
       LEFT JOIN knowledge_revisions r ON r.id=d.current_revision_id AND r.document_id=d.id
       LEFT JOIN knowledge_tree_nodes t ON t.id=e.tree_node_id AND t.source_id=e.source_id
       WHERE e.source_id=?
       ORDER BY e.source_path, e.id`,
      [sourceId],
    );

    const seenPaths = new Set<string>();
    const documents: CanonicalDocumentState[] = [];
    const folders: CanonicalFolderState[] = [];
    for (const row of rows) {
      const sourcePath = String(row.source_path);
      if (seenPaths.has(sourcePath)) {
        throw importError("CANONICAL_PATH_CONFLICT", `Canonical source contains duplicate path: ${sourcePath}`);
      }
      seenPaths.add(sourcePath);
      const entryType = String(row.entry_type);
      if (entryType === "FOLDER") {
        if (row.tree_node_id === null || String(row.tree_node_type) !== "FOLDER") {
          throw importError("CANONICAL_STATE_INVALID", "Folder source entry is missing its folder tree node.");
        }
        folders.push({
          entryId: String(row.entry_id),
          treeNodeId: String(row.tree_node_id),
          sourcePath,
          status: String(row.entry_status) as "ACTIVE" | "ARCHIVED",
        });
        continue;
      }
      if (entryType !== "DOCUMENT" || row.document_id === null || row.tree_node_id === null || row.revision_id === null || String(row.tree_node_type) !== "DOCUMENT") {
        throw importError("CANONICAL_STATE_INVALID", "Document source entry is incomplete.");
      }
      const metadata = jsonObject(row.metadata) as KnowledgeMetadata;
      const markdown = String(row.markdown);
      documents.push({
        entryId: String(row.entry_id),
        documentId: String(row.document_id),
        treeNodeId: String(row.tree_node_id),
        externalId: row.external_id === null ? null : String(row.external_id),
        sourcePath,
        status: String(row.entry_status) as "ACTIVE" | "ARCHIVED",
        currentRevision: {
          id: String(row.revision_id),
          title: String(row.title),
          markdown,
          metadata,
          contentHash: String(row.content_hash),
        },
        reconciliationFingerprint: fingerprintReconciliationContent({ markdown, metadata }),
      });
    }

    const assetRows = await this.connection.query<DbRow[]>(
      "SELECT id, source_path, source_path_hash, content_hash, mime_type, metadata FROM knowledge_assets WHERE source_id=? ORDER BY source_path, id",
      [sourceId],
    );
    const assets: CanonicalAssetState[] = assetRows.map((row) => ({
      id: String(row.id),
      sourcePath: String(row.source_path),
      sourcePathHash: String(row.source_path_hash),
      contentHash: row.content_hash === null ? null : String(row.content_hash),
      mimeType: row.mime_type === null ? null : String(row.mime_type),
      metadata: jsonObject(row.metadata),
    }));
    return { documents, folders, assets };
  }
}
