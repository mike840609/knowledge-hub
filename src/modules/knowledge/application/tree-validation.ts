import { IntegrityError, InvalidParentError, TreeCycleError, TreeNodeNotFoundError } from "../domain/errors";
import type { KnowledgeRepositories } from "../ports/unit-of-work";

export async function assertActiveFolderAncestry(repositories: KnowledgeRepositories, sourceId: string, folderId: string): Promise<void> {
  const nodes = await repositories.tree.listBySource(sourceId);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const folder = byId.get(folderId);
  if (!folder) throw new TreeNodeNotFoundError("Parent folder was not found.");
  if (folder.sourceId !== sourceId || folder.nodeType !== "FOLDER" || folder.status !== "ACTIVE") throw new InvalidParentError();
  const seen = new Set<string>();
  let cursor: string | null = folder.parentId;
  while (cursor) {
    if (seen.has(cursor)) throw new TreeCycleError("A tree cycle exists in the source hierarchy.");
    seen.add(cursor);
    const parent = byId.get(cursor);
    if (!parent || parent.sourceId !== sourceId || parent.nodeType !== "FOLDER" || parent.status !== "ACTIVE") throw new InvalidParentError("An active folder cannot be nested below an archived or invalid parent.");
    cursor = parent.parentId;
  }
}

export async function assertActiveDocumentPlacement(repositories: KnowledgeRepositories, sourceId: string, documentId: string): Promise<void> {
  const nodes = await repositories.tree.listBySource(sourceId);
  const documentNode = nodes.find((node) => node.documentId === documentId);
  if (!documentNode) throw new TreeNodeNotFoundError("Document tree node was not found.");
  if (documentNode.sourceId !== sourceId || documentNode.nodeType !== "DOCUMENT") throw new IntegrityError("Document tree node references a different source.");
  if (documentNode.parentId) await assertActiveFolderAncestry(repositories, sourceId, documentNode.parentId);
}
