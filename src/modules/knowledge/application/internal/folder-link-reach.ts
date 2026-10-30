import type { WorkspaceRole } from "@/modules/workspaces/domain/workspace-membership";
import {
  evaluateShareLinkValidity,
  isReachableThroughFolder,
  type DocumentShareLink,
  type TreeChainNode,
} from "../../domain/document-share-link";
import type { KnowledgeTreeNode } from "../../domain/tree-node";
import type { KnowledgeRepositories } from "../../ports/unit-of-work";

type LifecycleStatus = "ACTIVE" | "ARCHIVED";

/**
 * Whether a link still opens now, from the Source and Workspace already loaded. The page read,
 * `/s/:token/open`, review's writes and its followed-discussion list all assemble the conditions
 * here, so a rule added here reaches them together. Saved-share snapshots and the My shares query
 * judge a different input (a stored snapshot; a SQL page) and keep their own copies. A link exists
 * only on a My Space, and the creator-ownership rule below is what keeps it there.
 */
export function linkOpens(
  link: Pick<DocumentShareLink, "revokedAt" | "expiresAt" | "createdBy">,
  targetStatus: LifecycleStatus,
  source: { status: LifecycleStatus },
  workspace: {
    lifecycleState?: LifecycleStatus | null;
    personalOwnerUserId?: string | null;
  },
  creatorDirectRole: WorkspaceRole | null | undefined,
  now: Date,
): boolean {
  return evaluateShareLinkValidity({
    link,
    documentStatus: targetStatus,
    sourceStatus: source.status,
    workspaceLifecycle: workspace.lifecycleState,
    workspaceOwnerUserId: workspace.personalOwnerUserId,
    creatorDirectRole,
    now,
  }).valid;
}

/**
 * The link's judgement with its own reads: its target (a document, or a folder node) resolved to
 * its Source and Workspace, and its creator's direct membership. Returns the target's Workspace id,
 * or null for every refusal — callers must not say which rule refused.
 */
export async function openShareLinkTarget(
  repositories: KnowledgeRepositories,
  link: DocumentShareLink,
  target: { sourceId: string; status: LifecycleStatus },
  now: Date,
): Promise<{ workspaceId: string } | null> {
  const source = await repositories.sourcePolicy.findById(target.sourceId);
  if (!source) return null;
  const workspace = await repositories.workspaces.findById(source.workspaceId);
  if (!workspace) return null;
  const membership = await repositories.workspaceMemberships.find(workspace.id, link.createdBy);
  return linkOpens(link, target.status, source, workspace, membership ? membership.role ?? null : undefined, now)
    ? { workspaceId: workspace.id }
    : null;
}

/** The document half of reachability that needs no tree read: ACTIVE in the folder's Source. */
function documentBelongsToFolder(
  folder: Pick<KnowledgeTreeNode, "id" | "nodeType" | "sourceId">,
  document: { sourceId: string; status: LifecycleStatus },
): boolean {
  return folder.nodeType === "FOLDER" && document.status === "ACTIVE" && document.sourceId === folder.sourceId;
}

/**
 * Whether a document is reachable through a folder right now (folder share spec §2): ACTIVE in the
 * folder's Source, and its chain — `chain[0]` the document's node, then its parents upward —
 * reaching the folder through ACTIVE nodes. The document and chain are the caller's reads.
 */
export function documentReachesFolder(
  folder: Pick<KnowledgeTreeNode, "id" | "nodeType" | "sourceId">,
  document: { sourceId: string; status: LifecycleStatus },
  chain: readonly TreeChainNode[] | undefined,
): boolean {
  return documentBelongsToFolder(folder, document) && chain !== undefined && isReachableThroughFolder(chain, folder.id);
}

/**
 * The document half of folder reachability, with the chain read here. Returns that chain (the
 * document's node, then its parents upward), or null. Whether the link itself opens is the caller's
 * judgement; this is the other half of it. Reads no content.
 */
export async function reachableChain(
  repositories: KnowledgeRepositories,
  folder: Pick<KnowledgeTreeNode, "id" | "nodeType" | "sourceId">,
  document: { id: string; sourceId: string; status: LifecycleStatus },
): Promise<TreeChainNode[] | null> {
  if (!documentBelongsToFolder(folder, document)) return null;
  const node = await repositories.tree.findByDocumentId(document.id);
  if (!node) return null;
  const chain = await repositories.tree.listChain(node.id);
  return documentReachesFolder(folder, document, chain) ? chain : null;
}
