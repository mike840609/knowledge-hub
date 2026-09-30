import { requireRouteId } from "@/server/authoring-input";
import { workspaceHttp } from "@/server/workspace-http";

type DocumentRouteContext = { params: Promise<{ documentId: string }> };

/**
 * Archives a document; idempotent, as the service is. It answers with how many documents link to
 * this one, counted before it goes, because archiving turns those links into unresolved ones —
 * links resolve only to ACTIVE documents — and the reader should be told what they just did.
 * The count is a courtesy: if it cannot be read, the archive still happened and the field is null.
 */
export async function POST(_request: Request, context: DocumentRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const documentId = requireRouteId((await context.params).documentId, "the document");
    const backlinks = await services.links
      .getDocumentLinks(caller, documentId)
      .then((view) => view.backlinkTotal)
      .catch(() => null);
    await services.hub.archiveDocument(caller, documentId);
    return { backlinks };
  });
}
