import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { KnowledgeQueryService } from "@/modules/knowledge/application/knowledge-query-service";
import { DomainError } from "@/shared/domain/errors";

/** A share grants reading one document; opening the app still requires ordinary document access. */
export async function sharePlatformDestination(
  caller: CallerContext,
  documentId: string,
  personalWorkspaceId: string,
  queries: Pick<KnowledgeQueryService, "getDocument">,
): Promise<string> {
  try {
    const document = await queries.getDocument(caller, documentId);
    return `/w/${document.workspaceId}/knowledge/${document.sourceId}/${document.documentId}`;
  } catch (error) {
    if (!(error instanceof DomainError) || !["DOCUMENT_NOT_FOUND", "SOURCE_NOT_FOUND", "WORKSPACE_NOT_FOUND", "WORKSPACE_ACCESS_DENIED", "INSUFFICIENT_WORKSPACE_CAPABILITY"].includes(error.code)) throw error;
    return `/w/${personalWorkspaceId}/home`;
  }
}
