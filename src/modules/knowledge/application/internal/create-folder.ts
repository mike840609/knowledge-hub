import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { InvalidParentError, TreeNodeNotFoundError } from "../../domain/errors";
import { normalizeFolderName, normalizeTreePosition } from "../../domain/tree-rules";
import type { KnowledgeRepositories } from "../../ports/unit-of-work";
import { assertActiveFolderAncestry } from "../tree-validation";
import { placeNodeAtIndex, requireHubManagedSource } from "./tree-transaction";

export type CreateFolderInput = {
  sourceId: string;
  parentId: string | null;
  name: string;
  position?: number;
};

/**
 * Hub-managed folder creation bound to an already-open canonical transaction.
 *
 * Path (§6): trusted CallerContext → lock Source on this connection →
 * transaction-scoped WorkspaceAccessPolicy → Source ACTIVE + HUB_MANAGED →
 * parent validation against the latest hierarchy → insert → contiguous
 * sibling renumber. Never opens a nested unit of work.
 */
export async function createFolderInTransaction(
  repositories: KnowledgeRepositories,
  caller: CallerContext,
  input: CreateFolderInput,
): Promise<{ treeNodeId: string }> {
  const name = normalizeFolderName(input.name);
  const source = await requireHubManagedSource(repositories, caller, input.sourceId);
  if (input.parentId !== null) {
    const parent = await repositories.tree.lockById(input.parentId);
    if (!parent) throw new TreeNodeNotFoundError("Parent folder was not found.");
    if (parent.sourceId !== source.id || parent.nodeType !== "FOLDER" || parent.status !== "ACTIVE") {
      throw new InvalidParentError();
    }
    await assertActiveFolderAncestry(repositories, source.id, parent.id);
  }
  const siblings = (await repositories.tree.listBySource(source.id)).filter((node) => node.parentId === input.parentId);
  const position = input.position === undefined ? siblings.length : Math.min(normalizeTreePosition(input.position), siblings.length);
  const treeNodeId = uuidv7();
  await repositories.tree.insert({
    id: treeNodeId, sourceId: source.id, parentId: input.parentId, nodeType: "FOLDER",
    name, documentId: null, position, status: "ACTIVE",
    updatedBy: caller.identity.id, archivedBy: null, archivedAt: null,
  });
  await placeNodeAtIndex(repositories, source.id, treeNodeId, input.parentId, position, caller.identity.id);
  return { treeNodeId };
}
