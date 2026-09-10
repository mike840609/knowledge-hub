import type { KnowledgeTreeNode } from "../domain/tree-node";

export type TreeViewNode = KnowledgeTreeNode & { title: string | null; documentStatus: "ACTIVE" | "ARCHIVED" | null };

export interface TreeRepository {
  insert(node: KnowledgeTreeNode): Promise<void>;
  findById(id: string): Promise<KnowledgeTreeNode | null>;
  lockById(id: string): Promise<KnowledgeTreeNode | null>;
  listBySource(sourceId: string): Promise<TreeViewNode[]>;
  updateParent(nodeId: string, parentId: string | null, actorId: string): Promise<void>;
  updateName(nodeId: string, name: string, actorId: string): Promise<void>;
  updatePosition(nodeId: string, position: number, actorId: string): Promise<void>;
  updateStatusForDocument(documentId: string, status: "ACTIVE" | "ARCHIVED", actorId: string): Promise<void>;
  hasDescendant(nodeId: string, possibleDescendantId: string): Promise<boolean>;
}
