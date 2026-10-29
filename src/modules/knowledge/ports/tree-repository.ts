import type { TreeChainNode } from "../domain/document-share-link";
import type { KnowledgeTreeNode } from "../domain/tree-node";

export type TreeViewNode = KnowledgeTreeNode & { title: string | null; pageIcon?: string | null; documentStatus: "ACTIVE" | "ARCHIVED" | null; currentRevisionId: string | null };

export type DocumentSummary = {
  documentId: string; sourceId: string; title: string; updatedAt: Date;
  ownership: "SOURCE_MANAGED" | "HUB_MANAGED";
  status: "ACTIVE" | "ARCHIVED"; sourceStatus: "ACTIVE" | "ARCHIVED";
  pageIcon?: string | null;
};

export interface TreeRepository {
  /** Current metadata only; never loads document bodies. */
  listDocumentsByWorkspace(workspaceId: string, includeArchived: boolean, excludeArchivedAncestors?: boolean): Promise<DocumentSummary[]>;
  /** The named documents in the workspace, with `getDocument()`'s visibility. Missing IDs are simply absent. */
  listDocumentsByIds(workspaceId: string, documentIds: readonly string[], includeArchived: boolean): Promise<DocumentSummary[]>;
  insert(node: KnowledgeTreeNode): Promise<void>;
  insertMany(nodes: readonly KnowledgeTreeNode[]): Promise<void>;
  findById(id: string): Promise<KnowledgeTreeNode | null>;
  /** The one node that places a document (`uq_tree_one_document`), or null. */
  findByDocumentId(documentId: string): Promise<KnowledgeTreeNode | null>;
  lockById(id: string): Promise<KnowledgeTreeNode | null>;
  listBySource(sourceId: string): Promise<TreeViewNode[]>;
  updateParent(nodeId: string, parentId: string | null, actorId: string): Promise<void>;
  updateName(nodeId: string, name: string, actorId: string): Promise<void>;
  updatePosition(nodeId: string, position: number, actorId: string): Promise<void>;
  /** Several nodes in one statement per batch; each node must exist. */
  updatePositions(updates: readonly { nodeId: string; position: number }[], actorId: string): Promise<void>;
  updateStatus(nodeId: string, status: "ACTIVE" | "ARCHIVED", actorId: string): Promise<void>;
  updateStatusForDocument(documentId: string, status: "ACTIVE" | "ARCHIVED", actorId: string): Promise<void>;
  hasDescendant(nodeId: string, possibleDescendantId: string): Promise<boolean>;
  /** The node, then each parent in turn through `parent_id`, at most 256 nodes; empty when the node does not exist. */
  listChain(nodeId: string): Promise<TreeChainNode[]>;
}
