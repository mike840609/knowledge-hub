import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { DocumentArchivedError, DocumentNotFoundError, IntegrityViolationError, TreeNodeNotFoundError } from "../../domain/errors";
import type { KnowledgeRepositories } from "../../ports/unit-of-work";
import { duplicateMarkdown, duplicateTitle } from "@/lib/duplicate-document";
import { createDocumentInTransaction } from "./create-document";
import { requireHubManagedSource } from "./tree-transaction";

/**
 * A copy is a new document beside the original, not a revision of it: its own
 * ID, its own R1, its own tree node. The original is read under the write path
 * preamble — caller, source ownership, workspace capability — because reading
 * it to copy is still writing something new into that source.
 */
export async function duplicateDocumentInTransaction(
  repositories: KnowledgeRepositories,
  caller: CallerContext,
  documentId: string,
): Promise<{ documentId: string; revisionId: string; treeNodeId: string }> {
  const existing = await repositories.documents.findById(documentId);
  if (!existing) throw new DocumentNotFoundError();
  const source = await requireHubManagedSource(repositories, caller, existing.sourceId);
  const original = await repositories.documents.lockById(documentId);
  if (!original || original.sourceId !== source.id) throw new DocumentNotFoundError();
  if (original.status !== "ACTIVE") throw new DocumentArchivedError();
  const current = await repositories.revisions.findCurrent(documentId);
  if (!current) throw new IntegrityViolationError("Document current revision is missing.");
  const node = (await repositories.tree.listBySource(source.id)).find(
    (candidate) => candidate.documentId === documentId && candidate.status === "ACTIVE",
  );
  if (!node) throw new TreeNodeNotFoundError("Document tree node was not found.");

  const title = duplicateTitle(current.title);
  const metadata = { ...current.metadata };
  if (typeof metadata.title === "string") metadata.title = title;
  const created = await createDocumentInTransaction(repositories, caller, {
    sourceId: source.id,
    parentId: node.parentId,
    position: node.position + 1,
    title,
    markdown: duplicateMarkdown(current.markdown, title),
    metadata,
  });
  if (original.pageIcon) await repositories.documents.updatePageIcon(created.documentId, original.pageIcon, caller.identity.id);
  return created;
}
