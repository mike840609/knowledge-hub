import { isReachableThroughFolder, type TreeChainNode } from "../../domain/document-share-link";
import type { KnowledgeTreeNode } from "../../domain/tree-node";
import type { KnowledgeRepositories } from "../../ports/unit-of-work";

/**
 * Whether a document is reachable through a folder link's folder right now (folder share spec §2):
 * the document ACTIVE in the folder's Source, and its tree chain reaching the folder through ACTIVE
 * nodes. Returns that chain (the document's node, then its parents upward), or null. Whether the
 * link itself opens is the caller's judgement; this is the other half of it. Reads no content.
 */
export async function reachableChain(
  repositories: KnowledgeRepositories,
  folder: Pick<KnowledgeTreeNode, "id" | "nodeType" | "sourceId">,
  document: { id: string; sourceId: string; status: "ACTIVE" | "ARCHIVED" },
): Promise<TreeChainNode[] | null> {
  if (folder.nodeType !== "FOLDER" || document.status !== "ACTIVE" || document.sourceId !== folder.sourceId) return null;
  const node = await repositories.tree.findByDocumentId(document.id);
  if (!node) return null;
  const chain = await repositories.tree.listChain(node.id);
  return isReachableThroughFolder(chain, folder.id) ? chain : null;
}
