import type { KnowledgeTreeNode } from "@/modules/knowledge/domain/tree-node";
import type { TreeRepository, TreeViewNode } from "@/modules/knowledge/ports/tree-repository";
import type { QueryConnection, DbRow } from "./shared";
import { affectedRows, asNumber, asRequiredString } from "./shared";

function mapNode(row: DbRow): KnowledgeTreeNode {
  return {
    id: String(row.id), sourceId: String(row.source_id), parentId: row.parent_id === null ? null : String(row.parent_id),
    nodeType: String(row.node_type) as "FOLDER" | "DOCUMENT", name: row.name === null ? null : String(row.name),
    documentId: row.document_id === null ? null : String(row.document_id), position: asNumber(row.position, "tree position"),
    status: String(row.status) as "ACTIVE" | "ARCHIVED", updatedBy: asRequiredString(row.updated_by, "tree updated_by"),
    archivedBy: row.archived_by === null ? null : String(row.archived_by), archivedAt: row.archived_at === null ? null : new Date(String(row.archived_at)),
  };
}

export class MariaDbTreeRepository implements TreeRepository {
  constructor(private readonly connection: QueryConnection) {}

  async insert(node: KnowledgeTreeNode): Promise<void> {
    await this.connection.query(
      `INSERT INTO knowledge_tree_nodes (id, source_id, parent_id, node_type, name, document_id, position, status, updated_by, archived_by, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [node.id, node.sourceId, node.parentId, node.nodeType, node.name, node.documentId, node.position, node.status, node.updatedBy, node.archivedBy, node.archivedAt],
    );
  }

  async findById(id: string): Promise<KnowledgeTreeNode | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM knowledge_tree_nodes WHERE id = ?", [id]);
    return rows[0] ? mapNode(rows[0]) : null;
  }

  async lockById(id: string): Promise<KnowledgeTreeNode | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM knowledge_tree_nodes WHERE id = ? FOR UPDATE", [id]);
    return rows[0] ? mapNode(rows[0]) : null;
  }

  async listBySource(sourceId: string): Promise<TreeViewNode[]> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT n.*, r.title AS title, d.status AS document_status
       FROM knowledge_tree_nodes n
       LEFT JOIN knowledge_documents d ON d.id = n.document_id AND d.source_id = n.source_id
       LEFT JOIN knowledge_revisions r ON r.id = d.current_revision_id AND r.document_id = d.id

       WHERE n.source_id = ? ORDER BY COALESCE(n.parent_id, ''), n.position, n.id`,
      [sourceId],
    );
    return rows.map((row) => ({ ...mapNode(row), title: row.title === null ? null : String(row.title), documentStatus: row.document_status === null ? null : String(row.document_status) as "ACTIVE" | "ARCHIVED" }));
  }

  async updateParent(nodeId: string, parentId: string | null, actorId: string): Promise<void> {
    const result = await this.connection.query("UPDATE knowledge_tree_nodes SET parent_id = ?, updated_by = ? WHERE id = ?", [parentId, actorId, nodeId]);
    if (affectedRows(result) !== 1) throw new Error("Tree parent could not be updated.");
  }

  async updateName(nodeId: string, name: string, actorId: string): Promise<void> {
    const result = await this.connection.query("UPDATE knowledge_tree_nodes SET name = ?, updated_by = ? WHERE id = ? AND node_type = 'FOLDER'", [name, actorId, nodeId]);
    if (affectedRows(result) !== 1) throw new Error("Folder name could not be updated.");
  }

  async updatePosition(nodeId: string, position: number, actorId: string): Promise<void> {
    const result = await this.connection.query("UPDATE knowledge_tree_nodes SET position = ?, updated_by = ? WHERE id = ?", [position, actorId, nodeId]);
    if (affectedRows(result) !== 1) throw new Error("Tree position could not be updated.");
  }

  async updateStatusForDocument(documentId: string, status: "ACTIVE" | "ARCHIVED", actorId: string): Promise<void> {
    const archivedBy = status === "ARCHIVED" ? actorId : null;
    const archivedAt = status === "ARCHIVED" ? new Date() : null;
    await this.connection.query("UPDATE knowledge_tree_nodes SET status = ?, updated_by = ?, archived_by = ?, archived_at = ? WHERE document_id = ?", [status, actorId, archivedBy, archivedAt, documentId]);
  }

  async hasDescendant(nodeId: string, possibleDescendantId: string): Promise<boolean> {
    let cursor: string | null = possibleDescendantId;
    const seen = new Set<string>();
    while (cursor) {
      if (cursor === nodeId) return true;
      if (seen.has(cursor)) throw new Error("Existing tree cycle detected.");
      seen.add(cursor);
      const rows: DbRow[] = await this.connection.query("SELECT parent_id FROM knowledge_tree_nodes WHERE id = ? FOR UPDATE", [cursor]);
      cursor = rows[0]?.parent_id === null || !rows[0] ? null : String(rows[0].parent_id);
    }
    return false;
  }
}
