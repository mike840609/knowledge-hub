import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { TreeNodeNotFoundError, ValidationError } from "../../domain/errors";
import { normalizeTreePosition } from "../../domain/tree-rules";
import type { KnowledgeRepositories } from "../../ports/unit-of-work";
import { placeNodeAtIndex, requireHubManagedSource, requireLockedSourceNode } from "./tree-transaction";

export type ReorderTreeNodeInput = {
  nodeId: string;
  newPosition: number;
};

/**
 * Hub-managed sibling reorder bound to an already-open canonical
 * transaction. Same §6 preamble as moves; only positions change inside one
 * sibling group (spec §8 contiguous `ORDER BY position, id`), so Document,
 * Revision, Source, and Workspace identity are untouched.
 */
export async function reorderTreeNodeInTransaction(
  repositories: KnowledgeRepositories,
  caller: CallerContext,
  input: ReorderTreeNodeInput,
): Promise<void> {
  const newPosition = normalizeTreePosition(input.newPosition);
  const routing = await repositories.tree.findById(input.nodeId);
  if (!routing) throw new TreeNodeNotFoundError();
  const source = await requireHubManagedSource(repositories, caller, routing.sourceId);
  const node = await requireLockedSourceNode(repositories, source.id, input.nodeId);
  if (node.status !== "ACTIVE") throw new ValidationError("Archived tree nodes cannot be reordered.");
  await placeNodeAtIndex(repositories, source.id, node.id, node.parentId, newPosition, caller.identity.id);
}
