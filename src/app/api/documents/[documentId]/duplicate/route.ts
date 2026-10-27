import { workspaceHttp } from "@/server/workspace-http";

type DocumentRouteContext = { params: Promise<{ documentId: string }> };

export async function POST(_request: Request, context: DocumentRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const { documentId } = await context.params;
    return services.hub.duplicateDocument(caller, documentId);
  }, 201);
}
