import type { TreeChainNode } from "@/modules/knowledge/domain/document-share-link";
import type { KnowledgeTreeNode } from "@/modules/knowledge/domain/tree-node";
import type { DocumentSummary, TreeRepository, TreeViewNode } from "@/modules/knowledge/ports/tree-repository";
import type { QueryConnection, DbRow } from "./shared";
import { affectedRows, asDate, asNumber, asRequiredString, insertBatches, valueRows } from "./shared";

function mapNode(row: DbRow): KnowledgeTreeNode {
  return {
    id: String(row.id), sourceId: String(row.source_id), parentId: row.parent_id === null ? null : String(row.parent_id),
    nodeType: String(row.node_type) as "FOLDER" | "DOCUMENT", name: row.name === null ? null : String(row.name),
    documentId: row.document_id === null ? null : String(row.document_id), position: asNumber(row.position, "tree position"),
    status: String(row.status) as "ACTIVE" | "ARCHIVED", updatedBy: asRequiredString(row.updated_by, "tree updated_by"),
    archivedBy: row.archived_by === null ? null : String(row.archived_by), archivedAt: row.archived_at === null ? null : new Date(String(row.archived_at)),
  };
}

function mapDocumentSummary(row: DbRow): DocumentSummary {
  return {
    documentId: String(row.document_id), sourceId: String(row.source_id),
    title: asRequiredString(row.title, "document summary title"), updatedAt: asDate(row.updated_at),
    ownership: String(row.ownership) as DocumentSummary["ownership"],
    status: String(row.status) as DocumentSummary["status"], sourceStatus: String(row.source_status) as DocumentSummary["sourceStatus"],
    pageIcon: row.page_icon === null || row.page_icon === undefined ? null : String(row.page_icon),
  };
}

/** One `IN (?…)` batch per statement; well under MariaDB's placeholder limit. */
const DOCUMENT_ID_CHUNK = 500;

const POSITION_BATCH = 500;

/** Deeper than any real tree; a cycle (a defect) ends here instead of looping. MariaDB's default
 * `max_recursive_iterations` is 1000, so the guard stays just under it. */
const MAX_CHAIN_LENGTH = 1000;

function placeholders(count: number): string {
  return Array(count).fill("?").join(", ");
}

export class MariaDbTreeRepository implements TreeRepository {
  constructor(private readonly connection: QueryConnection) {}

  async listDocumentsByWorkspace(workspaceId: string, includeArchived: boolean, excludeArchivedAncestors = false): Promise<DocumentSummary[]> {
    // Sidebar shortcuts must follow the same archived-ancestor rule as the document tree.
    // Keep this opt-in so existing workspace summary projections retain their contract.
    const filterAncestors = excludeArchivedAncestors && !includeArchived;
    const hidden = filterAncestors ? `WITH RECURSIVE hidden_nodes AS (
      SELECT n.id, n.source_id FROM knowledge_tree_nodes n
      JOIN knowledge_sources s ON s.id = n.source_id
      WHERE s.workspace_id = ? AND n.status = 'ARCHIVED'
      UNION DISTINCT
      SELECT child.id, child.source_id FROM knowledge_tree_nodes child
      JOIN hidden_nodes parent ON child.parent_id = parent.id AND child.source_id = parent.source_id
    )` : "";
    const rows = await this.connection.query<DbRow[]>(
      `${hidden} SELECT d.id AS document_id, d.source_id, r.title, r.created_at AS updated_at, d.page_icon,
              s.ownership, s.status AS source_status, d.status
       FROM knowledge_documents d
       JOIN knowledge_sources s ON s.id = d.source_id
       JOIN knowledge_tree_nodes n ON n.document_id = d.id AND n.source_id = s.id
       JOIN knowledge_revisions r ON r.id = d.current_revision_id AND r.document_id = d.id
       WHERE s.workspace_id = ? AND (? = 1 OR (s.status = 'ACTIVE' AND d.status = 'ACTIVE' AND n.status = 'ACTIVE'))
       ${filterAncestors ? "AND NOT EXISTS (SELECT 1 FROM hidden_nodes hidden WHERE hidden.id = n.id)" : ""}
       ORDER BY r.created_at DESC, d.id ASC`, [...(filterAncestors ? [workspaceId] : []), workspaceId, includeArchived ? 1 : 0],
    );
    return rows.map(mapDocumentSummary);
  }

  /**
   * `getDocument()`'s visibility, without its per-document round trip: the
   * document and its Source must be ACTIVE unless archived content was asked
   * for. The tree node is deliberately not consulted — `getDocument()` does not
   * require it to be active, so filtering on it would hide documents the
   * palette shows today.
   */
  async listDocumentsByIds(workspaceId: string, documentIds: readonly string[], includeArchived: boolean): Promise<DocumentSummary[]> {
    const summaries: DocumentSummary[] = [];
    for (let start = 0; start < documentIds.length; start += DOCUMENT_ID_CHUNK) {
      const batch = documentIds.slice(start, start + DOCUMENT_ID_CHUNK);
      const rows = await this.connection.query<DbRow[]>(
        `SELECT d.id AS document_id, d.source_id, r.title, r.created_at AS updated_at, d.page_icon,
                s.ownership, s.status AS source_status, d.status
         FROM knowledge_documents d
         JOIN knowledge_sources s ON s.id = d.source_id
         JOIN knowledge_revisions r ON r.id = d.current_revision_id AND r.document_id = d.id
         WHERE s.workspace_id = ? AND d.id IN (${placeholders(batch.length)})
           AND (? = 1 OR (s.status = 'ACTIVE' AND d.status = 'ACTIVE'))`,
        [workspaceId, ...batch, includeArchived ? 1 : 0],
      );
      summaries.push(...rows.map(mapDocumentSummary));
    }
    return summaries;
  }

  async insert(node: KnowledgeTreeNode): Promise<void> {
    await this.connection.query(
      `INSERT INTO knowledge_tree_nodes (id, source_id, parent_id, node_type, name, document_id, position, status, updated_by, archived_by, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [node.id, node.sourceId, node.parentId, node.nodeType, node.name, node.documentId, node.position, node.status, node.updatedBy, node.archivedBy, node.archivedAt],
    );
  }

  async insertMany(nodes: readonly KnowledgeTreeNode[]): Promise<void> {
    for (const batch of insertBatches(nodes)) {
      await this.connection.query(
        `INSERT INTO knowledge_tree_nodes (id, source_id, parent_id, node_type, name, document_id, position, status, updated_by, archived_by, archived_at)
         VALUES ${valueRows(batch.length, 11)}`,
        batch.flatMap((node) => [node.id, node.sourceId, node.parentId, node.nodeType, node.name, node.documentId, node.position, node.status, node.updatedBy, node.archivedBy, node.archivedAt]),
      );
    }
  }

  async findById(id: string): Promise<KnowledgeTreeNode | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM knowledge_tree_nodes WHERE id = ?", [id]);
    return rows[0] ? mapNode(rows[0]) : null;
  }

  async findByDocumentId(documentId: string): Promise<KnowledgeTreeNode | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM knowledge_tree_nodes WHERE document_id = ?", [documentId]);
    return rows[0] ? mapNode(rows[0]) : null;
  }

  async lockById(id: string): Promise<KnowledgeTreeNode | null> {
    const rows = await this.connection.query<DbRow[]>("SELECT * FROM knowledge_tree_nodes WHERE id = ? FOR UPDATE", [id]);
    return rows[0] ? mapNode(rows[0]) : null;
  }

  /**
   * MariaDB sorts `NULL` first, so `ORDER BY parent_id` keeps roots first
   * exactly like the old `COALESCE(parent_id, '')` did, and the
   * `(source_id, parent_id, position)` index can supply the order directly.
   *
   * This equivalence assumes the app's UUIDv7 ids and MariaDB's native UUID
   * ordering (10.11.5+). A different id format or an older server could sort
   * `id` differently, so revisit the tie-break before either changes.
   */
  async listBySource(sourceId: string): Promise<TreeViewNode[]> {
    const rows = await this.connection.query<DbRow[]>(
      `SELECT n.*, r.title AS title, d.page_icon AS document_page_icon, d.status AS document_status, d.current_revision_id AS document_current_revision_id
       FROM knowledge_tree_nodes n
       LEFT JOIN knowledge_documents d ON d.id = n.document_id AND d.source_id = n.source_id
       LEFT JOIN knowledge_revisions r ON r.id = d.current_revision_id AND r.document_id = d.id

       WHERE n.source_id = ? ORDER BY n.parent_id, n.position, n.id`,
      [sourceId],
    );
    return rows.map((row) => ({ ...mapNode(row), title: row.title === null ? null : String(row.title), pageIcon: row.document_page_icon === null || row.document_page_icon === undefined ? null : String(row.document_page_icon), documentStatus: row.document_status === null ? null : String(row.document_status) as "ACTIVE" | "ARCHIVED", currentRevisionId: row.document_current_revision_id === null || row.document_current_revision_id === undefined ? null : String(row.document_current_revision_id) }));
  }

  async listSubtree(sourceId: string, folderNodeId: string): Promise<TreeViewNode[]> {
    const rows = await this.connection.query<DbRow[]>(
      `WITH RECURSIVE subtree (id, depth) AS (
         SELECT id, 0 FROM knowledge_tree_nodes
          WHERE parent_id = ? AND source_id = ? AND status = 'ACTIVE'
         UNION ALL
         SELECT child.id, subtree.depth + 1
           FROM knowledge_tree_nodes child JOIN subtree ON child.parent_id = subtree.id
          WHERE child.source_id = ? AND child.status = 'ACTIVE' AND subtree.depth < ?
       )
       SELECT n.*, r.title AS title, d.page_icon AS document_page_icon, d.status AS document_status, d.current_revision_id AS document_current_revision_id
       FROM knowledge_tree_nodes n
       JOIN subtree s ON s.id = n.id
       LEFT JOIN knowledge_documents d ON d.id = n.document_id AND d.source_id = n.source_id
       LEFT JOIN knowledge_revisions r ON r.id = d.current_revision_id AND r.document_id = d.id
       ORDER BY n.position, n.id`,
      // Depth 0 is already one hop below the folder. A chain of MAX_CHAIN_LENGTH nodes reaches a
      // folder at most MAX_CHAIN_LENGTH - 1 hops up, so the tree lists nothing deeper than that:
      // every node it shows is one the reachability check can open.
      [folderNodeId, sourceId, sourceId, MAX_CHAIN_LENGTH - 2],
    );
    return rows.map((row) => ({ ...mapNode(row), title: row.title === null ? null : String(row.title), pageIcon: row.document_page_icon === null || row.document_page_icon === undefined ? null : String(row.document_page_icon), documentStatus: row.document_status === null ? null : String(row.document_status) as "ACTIVE" | "ARCHIVED", currentRevisionId: row.document_current_revision_id === null || row.document_current_revision_id === undefined ? null : String(row.document_current_revision_id) }));
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

  async updatePositions(updates: readonly { nodeId: string; position: number }[], actorId: string): Promise<void> {
    for (let start = 0; start < updates.length; start += POSITION_BATCH) {
      const batch = updates.slice(start, start + POSITION_BATCH);
      const result = await this.connection.query(
        `UPDATE knowledge_tree_nodes SET position = CASE id ${batch.map(() => "WHEN ? THEN ?").join(" ")} END, updated_by = ? WHERE id IN (${placeholders(batch.length)})`,
        [...batch.flatMap((update) => [update.nodeId, update.position]), actorId, ...batch.map((update) => update.nodeId)],
      );
      if (affectedRows(result) !== batch.length) throw new Error("Tree position could not be updated.");
    }
  }

  async updateStatus(nodeId: string, status: "ACTIVE" | "ARCHIVED", actorId: string): Promise<void> {
    const archivedBy = status === "ARCHIVED" ? actorId : null;
    const archivedAt = status === "ARCHIVED" ? new Date() : null;
    const result = await this.connection.query("UPDATE knowledge_tree_nodes SET status = ?, updated_by = ?, archived_by = ?, archived_at = ? WHERE id = ?", [status, actorId, archivedBy, archivedAt, nodeId]);
    if (affectedRows(result) !== 1) throw new Error("Tree node lifecycle could not be updated.");
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

  async listChainsByDocumentIds(documentIds: readonly string[], sourceId: string): Promise<Map<string, TreeChainNode[]>> {
    const chains = new Map<string, TreeChainNode[]>();
    for (let start = 0; start < documentIds.length; start += DOCUMENT_ID_CHUNK) {
      const batch = documentIds.slice(start, start + DOCUMENT_ID_CHUNK);
      const rows = await this.connection.query<DbRow[]>(
        `WITH RECURSIVE chains (root, id, parent_id, node_type, status, depth) AS (
           SELECT n.document_id, n.id, n.parent_id, n.node_type, n.status, 0
           FROM knowledge_tree_nodes n
           WHERE n.document_id IN (${placeholders(batch.length)}) AND n.source_id = ?
           UNION ALL
           SELECT chains.root, parent.id, parent.parent_id, parent.node_type, parent.status, chains.depth + 1
           FROM knowledge_tree_nodes parent JOIN chains ON parent.id = chains.parent_id
           WHERE parent.source_id = ? AND chains.depth < ?
         )
         SELECT root, id, parent_id, node_type, status FROM chains ORDER BY root, depth`,
        [...batch, sourceId, sourceId, MAX_CHAIN_LENGTH - 1],
      );
      for (const row of rows) {
        const root = String(row.root);
        const chain = chains.get(root) ?? [];
        chain.push({ id: String(row.id), parentId: row.parent_id === null ? null : String(row.parent_id), nodeType: String(row.node_type) as TreeChainNode["nodeType"], status: String(row.status) as TreeChainNode["status"] });
        chains.set(root, chain);
      }
    }
    return chains;
  }

  async listChain(nodeId: string): Promise<TreeChainNode[]> {
    const rows = await this.connection.query<DbRow[]>(
      `WITH RECURSIVE chain (id, parent_id, node_type, status, depth) AS (
         SELECT id, parent_id, node_type, status, 0 FROM knowledge_tree_nodes WHERE id = ?
         UNION ALL
         SELECT parent.id, parent.parent_id, parent.node_type, parent.status, chain.depth + 1
         FROM knowledge_tree_nodes parent JOIN chain ON parent.id = chain.parent_id
         WHERE chain.depth < ?
       )
       SELECT id, parent_id, node_type, status FROM chain ORDER BY depth LIMIT ?`,
      [nodeId, MAX_CHAIN_LENGTH - 1, MAX_CHAIN_LENGTH],
    );
    return rows.map((row) => ({
      id: String(row.id),
      parentId: row.parent_id === null ? null : String(row.parent_id),
      nodeType: String(row.node_type) as TreeChainNode["nodeType"],
      status: String(row.status) as TreeChainNode["status"],
    }));
  }
}
