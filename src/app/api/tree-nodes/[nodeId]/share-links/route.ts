import { reviewWritesEnabled } from "@/server/config";
import { DomainError } from "@/shared/domain/errors";
import { workspaceHttp } from "@/server/workspace-http";

type FolderShareLinksRouteContext = { params: Promise<{ nodeId: string }> };

/** Same bodies and responses as the document route; a path, never an absolute URL. */
export async function POST(request: Request, context: FolderShareLinksRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const { nodeId } = await context.params;
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new DomainError("INVALID_REQUEST", "Provide a JSON object.");
    const { label, expiresInDays } = body as Record<string, unknown>;
    return { link: await services.shares.createForFolder(caller, { folderNodeId: nodeId, label, expiresInDays }) };
  }, 201);
}

export async function GET(_request: Request, context: FolderShareLinksRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const { nodeId } = await context.params;
    return { links: await services.shares.listForFolder(caller, nodeId), reviewReadAvailable: services.reviewReadAvailable, reviewWritesEnabled: reviewWritesEnabled() };
  });
}
