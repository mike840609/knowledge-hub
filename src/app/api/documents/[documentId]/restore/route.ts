import { requireRouteId } from "@/server/authoring-input";
import { workspaceHttp } from "@/server/workspace-http";

type DocumentRouteContext = { params: Promise<{ documentId: string }> };

/** Idempotent, as the service is: restoring what is already active is not an error. */
export async function POST(_request: Request, context: DocumentRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const documentId = requireRouteId((await context.params).documentId, "the document");
    await services.hub.restoreDocument(caller, documentId);
  }, 204);
}
