import { isUuid } from "@/shared/ids/uuidv7";
import type { WorkspaceRole } from "@/modules/workspaces/domain/workspace-membership";
import {
  evaluateShareLinkValidity,
  isReachableThroughFolder,
  isReachableThroughSource,
  type DocumentShareLink,
  type TreeChainNode,
} from "../../domain/document-share-link";
import type { KnowledgeTreeNode } from "../../domain/tree-node";
import type { SourcePolicy } from "../../domain/source-policy";
import type { KnowledgeRepositories } from "../../ports/unit-of-work";

type LifecycleStatus = "ACTIVE" | "ARCHIVED";

/**
 * Whether a link still opens now, from the Source and Workspace already loaded, for anyone in its audience.
 * Private: every caller goes through `linkOpensFor`, which asks the audience first, so none can skip it.
 */
function linkOpens(
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
 * Whether this viewer is among the link's audience (named-recipient share spec, "Authorization
 * summary"). A LINK admits any holder of the token, signed in or not; a NAMED link admits only a
 * signed-in recipient or the link's owner. Ids are compared lower-case. Whether the link opens at
 * all is `linkOpens`; this is the other half, and a refusal here must look like any other.
 */
export async function audienceAdmits(
  repositories: KnowledgeRepositories,
  link: DocumentShareLink,
  viewerId: string | null,
): Promise<boolean> {
  if (link.audience === "LINK") return true;
  // A malformed id would make MariaDB's UUID column raise rather than match nothing.
  if (viewerId === null || !isUuid(viewerId)) return false;
  const viewer = viewerId.toLowerCase();
  return viewer === link.createdBy.toLowerCase() || await repositories.shareLinks.isRecipient(link.id, viewer);
}

/**
 * Whether a link opens now for `viewerId` (null when no one is signed in), from the Source and Workspace
 * already loaded: its audience first, then its own validity with its creator's direct membership read here.
 * The page read, `/s/:token/open`, review's writes and its followed-discussion list all judge here, so a
 * rule added here reaches them together. Saved-share snapshots and the My shares query judge a different
 * input (a stored snapshot; a SQL page) and keep their own copies. A link exists only on a My Space, and the
 * creator-ownership rule in `evaluateShareLinkValidity` is what keeps it there.
 */
export async function linkOpensFor(
  repositories: KnowledgeRepositories,
  link: DocumentShareLink,
  targetStatus: LifecycleStatus,
  source: { status: LifecycleStatus },
  workspace: { id: string; lifecycleState?: LifecycleStatus | null; personalOwnerUserId?: string | null },
  now: Date,
  viewerId: string | null,
): Promise<boolean> {
  if (!await audienceAdmits(repositories, link, viewerId)) return false;
  return linkOpensAfterAudience(repositories, link, targetStatus, source, workspace, now);
}

/** `linkOpensFor` once the audience is already admitted: validity with the creator's direct membership read. */
async function linkOpensAfterAudience(
  repositories: KnowledgeRepositories,
  link: DocumentShareLink,
  targetStatus: LifecycleStatus,
  source: { status: LifecycleStatus },
  workspace: { id: string; lifecycleState?: LifecycleStatus | null; personalOwnerUserId?: string | null },
  now: Date,
): Promise<boolean> {
  const membership = await repositories.workspaceMemberships.find(workspace.id, link.createdBy);
  return linkOpens(link, targetStatus, source, workspace, membership ? membership.role ?? null : undefined, now);
}

/**
 * The link's judgement with its own reads: its target (a document, or a folder node) resolved to
 * its Source and Workspace, its creator's direct membership, and whether `viewerId` (null when no
 * one is signed in) is in its audience. Returns the target's Workspace id, or null for every
 * refusal — callers must not say which rule refused.
 */
export async function openShareLinkTarget(
  repositories: KnowledgeRepositories,
  link: DocumentShareLink,
  target: { sourceId: string; status: LifecycleStatus },
  now: Date,
  viewerId: string | null,
): Promise<{ workspaceId: string } | null> {
  if (!await audienceAdmits(repositories, link, viewerId)) return null;
  const source = await repositories.sourcePolicy.findById(target.sourceId);
  if (!source) return null;
  const workspace = await repositories.workspaces.findById(source.workspaceId);
  if (!workspace) return null;
  return await linkOpensAfterAudience(repositories, link, target.status, source, workspace, now) ? { workspaceId: workspace.id } : null;
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

/** The document half of Source reachability that needs no tree read: ACTIVE in the Source. */
function documentBelongsToSource(
  source: Pick<SourcePolicy, "id" | "status">,
  document: { sourceId: string; status: LifecycleStatus },
): boolean {
  return source.status === "ACTIVE" && document.status === "ACTIVE" && document.sourceId === source.id;
}

/**
 * Whether a document is reachable through a Source right now (source share spec §2): ACTIVE in the
 * Source, and its chain — `chain[0]` the document's node, then its parents upward — reaching a
 * Source root through ACTIVE nodes all in that Source. The document and chain are the caller's reads.
 */
export function documentReachesSource(
  source: Pick<SourcePolicy, "id" | "status">,
  document: { sourceId: string; status: LifecycleStatus },
  chain: readonly TreeChainNode[] | undefined,
): boolean {
  return documentBelongsToSource(source, document) && chain !== undefined && isReachableThroughSource(chain, source.id);
}

/**
 * The document half of Source reachability, with the chain read here. Returns that chain (the
 * document's node, then its parents upward), or null. Whether the link itself opens is the caller's
 * judgement; this is the other half of it. Reads no content.
 */
export async function reachableChainForSource(
  repositories: KnowledgeRepositories,
  source: Pick<SourcePolicy, "id" | "status">,
  document: { id: string; sourceId: string; status: LifecycleStatus },
): Promise<TreeChainNode[] | null> {
  if (!documentBelongsToSource(source, document)) return null;
  const node = await repositories.tree.findByDocumentId(document.id);
  if (!node) return null;
  const chain = await repositories.tree.listChain(node.id);
  return documentReachesSource(source, document, chain) ? chain : null;
}
