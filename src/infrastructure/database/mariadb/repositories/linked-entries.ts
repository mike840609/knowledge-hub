import type { QueryConnection, DbRow } from "./shared";
import { asDate, asRequiredString } from "./shared";
import type { KnowledgeLifecycle } from "@/modules/knowledge/domain/lifecycle";
import type { LinkedEntryRepository, LinkedSourceEntry } from "@/modules/knowledge/ports/linked-entry";

function mapLinkedEntry(row: DbRow): LinkedSourceEntry {
  return {
    id: String(row.id), sourceId: String(row.source_id),
    documentId: row.document_id === null ? null : String(row.document_id),
    treeNodeId: row.tree_node_id === null || row.tree_node_id === undefined ? null : String(row.tree_node_id),
    status: String(row.status) as KnowledgeLifecycle,
    updatedBy: asRequiredString(row.updated_by, "source entry updated_by"),
    archivedBy: row.archived_by === null ? null : String(row.archived_by),
    archivedAt: row.archived_at === null ? null : asDate(row.archived_at),
    lastSeenAt: asDate(row.last_seen_at),
  };
}

export class MariaDbLinkedEntryRepository implements LinkedEntryRepository {
  constructor(private readonly connection: QueryConnection) {}

  async findByDocumentId(documentId: string): Promise<LinkedSourceEntry | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM source_entries WHERE document_id = ?", [documentId]);
    return rows[0] ? mapLinkedEntry(rows[0]) : null;
  }

  async findByTreeNodeId(treeNodeId: string): Promise<LinkedSourceEntry | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM source_entries WHERE tree_node_id = ?", [treeNodeId]);
    return rows[0] ? mapLinkedEntry(rows[0]) : null;
  }

  async update(entry: LinkedSourceEntry): Promise<void> {
    await this.connection.query(
      "UPDATE source_entries SET status = ?, updated_by = ?, archived_by = ?, archived_at = ?, last_seen_at = ? WHERE id = ?",
      [entry.status, entry.updatedBy, entry.archivedBy, entry.archivedAt, entry.lastSeenAt, entry.id],
    );
  }
}
