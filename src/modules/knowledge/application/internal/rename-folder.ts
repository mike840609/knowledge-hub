import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { TreeNodeNotFoundError, ValidationError } from "../../domain/errors";
import { normalizeFolderName } from "../../domain/tree-rules";
import type { KnowledgeRepositories } from "../../ports/unit-of-work";
import { assertActiveFolderAncestry } from "../tree-validation";
import { requireHubManagedSource, requireLockedSourceNode } from "./tree-transaction";

export type RenameFolderInput = {
  nodeId: string;
  name: string;
};

/**
 * Hub-managed folder rename bound to an already-open canonical transaction.
 *
 * Path (§6): route TreeNode → lock Source → transaction-scoped Workspace
 * access → Source ACTIVE + HUB_MANAGED → latest locked node must be an ACTIVE
 * FOLDER with an ACTIVE folder ancestry → rename. Hierarchy position,
 * Document identity, and Revisions are untouched.
 */
export async function renameFolderInTransaction(
  repositories: KnowledgeRepositories,
  caller: CallerContext,
  input: RenameFolderInput,
): Promise<void> {
  const name = normalizeFolderName(input.name);
  const routing = await repositories.tree.findById(input.nodeId);
  if (!routing) throw new TreeNodeNotFoundError();
  const source = await requireHubManagedSource(repositories, caller, routing.sourceId);
  const node = await requireLockedSourceNode(repositories, source.id, input.nodeId);
  if (node.nodeType !== "FOLDER") throw new ValidationError("Only folders can be renamed.");
  if (node.status !== "ACTIVE") throw new ValidationError("Archived folders cannot be renamed.");
  if (node.parentId) await assertActiveFolderAncestry(repositories, source.id, node.parentId);
  await repositories.tree.updateName(node.id, name, caller.identity.id);
}
