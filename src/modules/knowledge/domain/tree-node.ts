import type { KnowledgeLifecycle } from "./lifecycle";

export const TREE_NODE_TYPES = ["FOLDER", "DOCUMENT"] as const;
export type TreeNodeType = (typeof TREE_NODE_TYPES)[number];

export type KnowledgeTreeNode = {
  id: string;
  sourceId: string;
  parentId: string | null;
  nodeType: TreeNodeType;
  name: string | null;
  documentId: string | null;
  position: number;
  status: KnowledgeLifecycle;
  updatedBy: string;
  archivedBy: string | null;
  archivedAt: Date | null;
};

export function assertTreeNodeShape(node: Pick<KnowledgeTreeNode, "nodeType" | "name" | "documentId">): void {
  if (node.nodeType === "FOLDER") {
    if (!node.name || node.name.length === 0 || node.documentId !== null) {
      throw new Error("A folder must have a name and no document reference.");
    }
    return;
  }
  if (node.documentId === null || node.name !== null) {
    throw new Error("A document tree node must reference a document and derive its name from its revision.");
  }
}
