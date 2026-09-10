import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { FolderNotEmptyError, TreeNodeNotFoundError, ValidationError } from "../../domain/errors";
import type { KnowledgeRepositories } from "../../ports/unit-of-work";
import { assertActiveFolderAncestry } from "../tree-validation";
import { requireHubManagedSource, requireLockedSourceNode } from "./tree-transaction";

/**
 * Hub-managed folder lifecycle bound to an already-open canonical
 * transaction.
 *
 * Path (spec §20, plan §6): route TreeNode → lock Source FOR UPDATE on this
 * connection → transaction-scoped Workspace access → Source ACTIVE +
 * HUB_MANAGED → lock the folder node → lifecycle validation → status and
 * provenance write on the folder node (plus its linked SourceEntry when one
 * exists). Archive refuses folders with ACTIVE children (`FOLDER_NOT_EMPTY`)
 * and never cascades to descendants. Restore requires an ACTIVE parent
 * chain. Never opens a nested unit of work; the owning service commits once.
 */
export async function archiveFolderInTransaction(
  repositories: KnowledgeRepositories,
  caller: CallerContext,
  nodeId: string,
): Promise<void> {
  const routing = await repositories.tree.findById(nodeId);
  if (!routing) throw new TreeNodeNotFoundError();
  const source = await requireHubManagedSource(repositories, caller, routing.sourceId);
  const node = await requireLockedSourceNode(repositories, source.id, nodeId);
  if (node.nodeType !== "FOLDER") throw new ValidationError("Only folders can be archived.");
  if (node.status === "ARCHIVED") return;
  if (node.parentId) await assertActiveFolderAncestry(repositories, source.id, node.parentId);
  const nodes = await repositories.tree.listBySource(source.id);
  if (nodes.some((candidate) => candidate.parentId === node.id && candidate.status === "ACTIVE")) {
    throw new FolderNotEmptyError();
  }
  const now = new Date();
  await repositories.tree.updateStatus(node.id, "ARCHIVED", caller.identity.id);
  const linked = await repositories.linkedEntries.findByTreeNodeId(node.id);
  if (linked && linked.sourceId === source.id) {
    await repositories.linkedEntries.update({
      ...linked,
      status: "ARCHIVED",
      updatedBy: caller.identity.id,
      archivedBy: caller.identity.id,
      archivedAt: now,
      lastSeenAt: now,
    });
  }
}

export async function restoreFolderInTransaction(
  repositories: KnowledgeRepositories,
  caller: CallerContext,
  nodeId: string,
): Promise<void> {
  const routing = await repositories.tree.findById(nodeId);
  if (!routing) throw new TreeNodeNotFoundError();
  const source = await requireHubManagedSource(repositories, caller, routing.sourceId);
  const node = await requireLockedSourceNode(repositories, source.id, nodeId);
  if (node.nodeType !== "FOLDER") throw new ValidationError("Only folders can be restored.");
  if (node.status === "ACTIVE") return;
  if (node.parentId) await assertActiveFolderAncestry(repositories, source.id, node.parentId);
  await repositories.tree.updateStatus(node.id, "ACTIVE", caller.identity.id);
  const linked = await repositories.linkedEntries.findByTreeNodeId(node.id);
  if (linked && linked.sourceId === source.id) {
    await repositories.linkedEntries.update({
      ...linked,
      status: "ACTIVE",
      updatedBy: caller.identity.id,
      archivedBy: null,
      archivedAt: null,
      lastSeenAt: new Date(),
    });
  }
}
