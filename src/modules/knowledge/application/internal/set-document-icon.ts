import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { isPageIcon } from "@/lib/page-icon";
import { DocumentArchivedError, DocumentNotFoundError, ValidationError } from "../../domain/errors";
import type { KnowledgeRepositories } from "../../ports/unit-of-work";
import { requireHubManagedSource } from "./tree-transaction";

/**
 * A page icon is presentation attached to the document, not content: it gets
 * no revision and does not touch the current-revision pointer. It is still a
 * write, so it takes the same preamble as every other Hub write — caller,
 * source ownership, workspace capability — and is refused on an archived page.
 */
export async function setDocumentIconInTransaction(
  repositories: KnowledgeRepositories,
  caller: CallerContext,
  documentId: string,
  icon: string | null,
): Promise<{ icon: string | null }> {
  if (icon !== null && !isPageIcon(icon)) throw new ValidationError("Choose one of the page icons.");
  const existing = await repositories.documents.findById(documentId);
  if (!existing) throw new DocumentNotFoundError();
  const source = await requireHubManagedSource(repositories, caller, existing.sourceId);
  const document = await repositories.documents.lockById(documentId);
  if (!document || document.sourceId !== source.id) throw new DocumentNotFoundError();
  if (document.status !== "ACTIVE") throw new DocumentArchivedError();
  await repositories.documents.updatePageIcon(document.id, icon, caller.identity.id);
  return { icon };
}
