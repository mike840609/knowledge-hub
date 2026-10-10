import { syncCallerIdentity } from "@/modules/identity/application/sync-caller-identity";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { DocumentNotFoundError, SourceNotFoundError } from "../../domain/errors";
import type { SourcePolicy } from "../../domain/source-policy";
import type { KnowledgeRepositories } from "../../ports/unit-of-work";

export async function requireSourcePolicy(repositories: KnowledgeRepositories, sourceId: string): Promise<SourcePolicy> {
  const policy = await repositories.sourcePolicy.findById(sourceId);
  if (!policy) throw new SourceNotFoundError();
  return policy;
}

/**
 * The document, and the source policy that governs it, for a caller who may
 * see it. Knowing a document id grants nothing: the caller must be a member of
 * the Workspace the document's Source belongs to, and unless archived content
 * was asked for, both the document and its Source must be ACTIVE. Anything
 * short of that is reported as "not found", never as "forbidden", so the
 * answer does not say whether the id exists.
 */
export async function requireVisibleDocument(
  repositories: KnowledgeRepositories,
  caller: CallerContext,
  documentId: string,
  includeArchived: boolean,
): Promise<{ document: { id: string; sourceId: string; status: "ACTIVE" | "ARCHIVED" }; policy: SourcePolicy }> {
  await syncCallerIdentity(repositories.users, caller);
  const document = await repositories.documents.findById(documentId);
  if (!document) throw new DocumentNotFoundError();
  const policy = await requireSourcePolicy(repositories, document.sourceId);
  await repositories.workspaceAccess.requireMembership(caller, policy.workspaceId);
  if (!includeArchived && (document.status !== "ACTIVE" || policy.status !== "ACTIVE")) throw new DocumentNotFoundError();
  return { document, policy };
}
