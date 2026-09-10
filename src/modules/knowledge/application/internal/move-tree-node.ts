import type { CallerContext } from "@/modules/identity/domain/caller-context";
import {
  CrossSourceMoveError,
  InvalidParentError,
  TreeCycleError,
  TreeNodeNotFoundError,
  ValidationError,
} from "../../domain/errors";
import { normalizeTreePosition } from "../../domain/tree-rules";
import type { KnowledgeRepositories } from "../../ports/unit-of-work";
import type { MoveTreeNodeInput } from "../hub-knowledge-command-service";
import { assertActiveFolderAncestry } from "../tree-validation";
import { renumberSiblingPositions, placeNodeAtIndex, requireHubManagedSource, requireLockedSourceNode } from "./tree-transaction";

/**
 * Hub-managed Tree move bound to an already-open canonical transaction.
 *
 * Path (spec §7/§9, plan §6): route TreeNode → lock Source FOR UPDATE (one
 * Source serializes all its Tree mutations) → transaction-scoped Workspace
 * access → Source ACTIVE + HUB_MANAGED → latest locked node/parent rows →
 * parent FOLDER/ACTIVE/same-Source, no self/descendant cycle, no cross-Source
 * Document move → reparent → contiguous sibling renumber on both sides.
 * Only hierarchy changes: Document, Revision, Source, and Workspace identity
 * are never rewritten here.
 */
export async function moveTreeNodeInTransaction(
  repositories: KnowledgeRepositories,
  caller: CallerContext,
  input: MoveTreeNodeInput,
): Promise<void> {
  const newPosition = normalizeTreePosition(input.newPosition);
  const routing = await repositories.tree.findById(input.nodeId);
  if (!routing) throw new TreeNodeNotFoundError();
  const source = await requireHubManagedSource(repositories, caller, routing.sourceId);
  const node = await requireLockedSourceNode(repositories, source.id, input.nodeId);
  if (node.status !== "ACTIVE") throw new ValidationError("Archived tree nodes cannot be moved.");
  const previousParentId = node.parentId;
  if (input.newParentId !== null) {
    if (input.newParentId === node.id) throw new TreeCycleError();
    const parent = await repositories.tree.lockById(input.newParentId);
    if (!parent) throw new TreeNodeNotFoundError("Parent folder was not found.");
    if (parent.sourceId !== source.id) throw new CrossSourceMoveError();
    if (parent.nodeType !== "FOLDER" || parent.status !== "ACTIVE") throw new InvalidParentError();
    await assertActiveFolderAncestry(repositories, source.id, parent.id);
    if (await repositories.tree.hasDescendant(node.id, parent.id)) throw new TreeCycleError();
  }
  await repositories.tree.updateParent(node.id, input.newParentId, caller.identity.id);
  await placeNodeAtIndex(repositories, source.id, node.id, input.newParentId, newPosition, caller.identity.id);
  if (previousParentId !== input.newParentId) {
    await renumberSiblingPositions(repositories, source.id, previousParentId, caller.identity.id);
  }
}
