import { parseCreateDocumentInput } from "@/server/authoring-input";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { workspaceHttp, type WorkspaceRouteContext } from "@/server/workspace-http";

export async function POST(request: Request, context: WorkspaceRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const { workspaceId } = await context.params;
    const input = parseCreateDocumentInput(await request.json().catch(() => null));
    const sourceId = await ensureDefaultHubSource(services.unitOfWork, caller, workspaceId);
    const created = await services.hub.createDocument(caller, {
      sourceId, parentId: null, title: input.title, markdown: input.markdown, metadata: {},
    });
    return { documentId: created.documentId, sourceId, revisionId: created.revisionId };
  }, 201);
}
